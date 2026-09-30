/**
 * First-login password change (P1.1 — closes SEC-027).
 *
 * THE DEFECT: `upsertEmployee` created every new account with the hardcoded
 * password `password123`. All five seeded accounts shared it, and no change was
 * ever forced.
 *
 * THE FLOW:
 *   HR creates employee
 *     └─ account created with NO usable password
 *     └─ a single-use token is generated; only its SHA-256 hash is stored
 *     └─ HR is shown the activation link ONCE (it cannot be retrieved later)
 *   Employee opens the link, sets a password
 *     └─ token marked used, mustChangePassword cleared
 *
 * The plaintext password is never stored, never emailed, and never logged. The
 * raw token is shown to the invoking HR user exactly once, at creation.
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";

const TOKEN_TTL_HOURS = 48;
const BCRYPT_ROUNDS = 10;

export interface ActivationCredential {
    userId: string;
    userEmail: string;
    /** Shown ONCE. Not recoverable — only the hash is persisted. */
    token: string;
    expiresAt: Date;
}

export function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

/** Timing-safe lookup: a token is compared by hash equality, never in plaintext. */
export async function findValidToken(token: string) {
    const tokenHash = hashToken(token);
    const record = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: { select: { id: true, email: true, securityFlag: true } } },
    });

    if (!record) return null;
    if (record.usedAt) return null;
    if (record.expiresAt.getTime() < Date.now()) return null;

    return record;
}

/**
 * Issues a single-use activation token and disables password sign-in until it
 * is redeemed. Any previously issued, unused token for the same purpose is
 * invalidated so only the newest link works.
 */
export async function issueActivationToken(params: {
    userId: string;
    createdBy: string;
    purpose?: "FIRST_LOGIN" | "PASSWORD_RESET";
    invalidatePassword?: boolean;
}): Promise<ActivationCredential> {
    const purpose = params.purpose ?? "FIRST_LOGIN";

    // One live token per purpose. A superseded link must stop working.
    await prisma.passwordResetToken.updateMany({
        where: { userId: params.userId, purpose, usedAt: null },
        data: { usedAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

    await prisma.$transaction([
        prisma.passwordResetToken.create({
            data: {
                userId: params.userId,
                tokenHash: hashToken(token),
                purpose,
                expiresAt,
                createdBy: params.createdBy,
            },
        }),
        prisma.userSecurityFlag.upsert({
            where: { userId: params.userId },
            update: {
                mustChangePassword: true,
                mustChangeReason: purpose === "FIRST_LOGIN" ? "First sign-in" : "Password reset requested",
                updatedAt: new Date(),
            },
            create: {
                userId: params.userId,
                mustChangePassword: true,
                mustChangeReason: purpose === "FIRST_LOGIN" ? "First sign-in" : "Password reset requested",
            },
        }),
        // Password sign-in is disabled until the token is redeemed. A null
        // password cannot be matched by bcrypt, so no known default works.
        ...(params.invalidatePassword === false
            ? []
            : [prisma.user.update({ where: { id: params.userId }, data: { password: null } })]),
    ]);

    const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { email: true },
    });

    return {
        userId: params.userId,
        userEmail: user?.email ?? "",
        token,
        expiresAt,
    };
}

/** Password strength rules applied server-side. Client checks are UX only. */
export interface PasswordCheck {
    ok: boolean;
    problems: string[];
}

export function checkPasswordStrength(password: string): PasswordCheck {
    const problems: string[] = [];

    if (password.length < 12) problems.push("Must be at least 12 characters");
    if (password.length > 128) problems.push("Must be at most 128 characters");
    if (!/[a-z]/.test(password)) problems.push("Must contain a lowercase letter");
    if (!/[A-Z]/.test(password)) problems.push("Must contain an uppercase letter");
    if (!/\d/.test(password)) problems.push("Must contain a digit");
    if (!/[^A-Za-z0-9]/.test(password)) problems.push("Must contain a symbol");

    // The exact string that caused the original finding must never be accepted.
    if (password.toLowerCase() === "password123") {
        problems.push("This password is already in use elsewhere in the system");
    }

    return { ok: problems.length === 0, problems };
}

export async function completePasswordChange(params: {
    token: string;
    newPassword: string;
    ipAddress?: string | null;
}): Promise<{ success: boolean; message: string }> {
    const record = await findValidToken(params.token);
    if (!record) {
        return {
            success: false,
            message: "This activation link is invalid, has expired, or has already been used.",
        };
    }

    const strength = checkPasswordStrength(params.newPassword);
    if (!strength.ok) {
        return { success: false, message: strength.problems.join(". ") };
    }

    if (params.newPassword !== params.newPassword.trim()) {
        return { success: false, message: "Password must not start or end with a space." };
    }

    const hashed = await bcrypt.hash(params.newPassword, BCRYPT_ROUNDS);

    // Consume the token and set the password in one transaction, with the
    // token update guarded on `usedAt: null` so two concurrent redemptions
    // cannot both succeed.
    const now = new Date();
    try {
        await prisma.$transaction(async (tx) => {
            const consumed = await tx.passwordResetToken.updateMany({
                where: { id: record.id, usedAt: null },
                data: { usedAt: now, usedByIp: params.ipAddress ?? null },
            });
            if (consumed.count === 0) {
                throw new Error("TOKEN_ALREADY_USED");
            }

            await tx.user.update({
                where: { id: record.userId },
                data: { password: hashed },
            });

            await tx.userSecurityFlag.upsert({
                where: { userId: record.userId },
                update: {
                    mustChangePassword: false,
                    mustChangeReason: null,
                    passwordChangedAt: now,
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                },
                create: {
                    userId: record.userId,
                    mustChangePassword: false,
                    passwordChangedAt: now,
                },
            });
        });
    } catch (error) {
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "TOKEN_ALREADY_USED") {
            return { success: false, message: "This activation link has already been used." };
        }
        console.error("[PASSWORD_CHANGE_FAILED]", error);
        return { success: false, message: "Could not update the password. Please request a new link." };
    }

    return { success: true, message: "Password set. You can now sign in." };
}

/** Whether a user must change their password before doing anything else. */
export async function mustChangePassword(userId: string): Promise<boolean> {
    const flag = await prisma.userSecurityFlag.findUnique({
        where: { userId },
        select: { mustChangePassword: true, accountDisabled: true, lockedUntil: true },
    });
    if (!flag) return false;
    if (flag.accountDisabled) return true;
    if (flag.lockedUntil && flag.lockedUntil.getTime() > Date.now()) return true;
    return flag.mustChangePassword;
}

/**
 * Disables an account and terminates access (P1.2 access revocation).
 * The User row is retained so historical records keep their owner.
 */
export async function revokeAccess(params: {
    userId: string;
    reason: string;
    actorEmail: string;
}): Promise<{ success: boolean; message: string }> {
    try {
        // The subject of this event is a USER, not an employee. A user usually
        // has an Employee row and sometimes does not — staged employee entry
        // (GAP-01) creates the login first — so the id is resolved rather than
        // assumed, and left NULL when there is genuinely no employee to name.
        // The old "SYSTEM" sentinel matched no Employee and violated the
        // foreign key, rolling the whole revocation back. See the note on
        // `model AuditLog` in prisma/schema.prisma for why the ACTOR's employee
        // was rejected as the substitute.
        const subject = await prisma.user.findUnique({
            where: { id: params.userId },
            select: { employee: { select: { id: true } } },
        });

        await prisma.$transaction([
            prisma.userSecurityFlag.upsert({
                where: { userId: params.userId },
                update: {
                    accountDisabled: true,
                    disabledReason: params.reason,
                    disabledAt: new Date(),
                    mustChangePassword: false,
                },
                create: {
                    userId: params.userId,
                    accountDisabled: true,
                    disabledReason: params.reason,
                    disabledAt: new Date(),
                },
            }),
            // Nulling the password is what actually prevents sign-in: bcrypt
            // cannot match against null, so even a leaked hash is useless.
            // The User row itself is preserved.
            prisma.user.update({ where: { id: params.userId }, data: { password: null } }),
            prisma.passwordResetToken.updateMany({
                where: { userId: params.userId, usedAt: null },
                data: { usedAt: new Date() },
            }),
            prisma.auditLog.create({
                data: {
                    employeeId: subject?.employee?.id ?? null,
                    action: "ACCESS_REVOKED",
                    details: `Access revoked for user ${params.userId}: ${params.reason}`,
                    changedBy: params.actorEmail,
                },
            }),
        ]);
        return { success: true, message: "Access revoked." };
    } catch (error) {
        console.error("[REVOKE_ACCESS_FAILED]", error);
        return { success: false, message: "Could not revoke access." };
    }
}
