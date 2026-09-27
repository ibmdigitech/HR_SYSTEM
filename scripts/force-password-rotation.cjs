/**
 * Force every account still using the shared default password through the
 * activation flow (P1.1 — closes SEC-027).
 *
 * The defect: `upsertEmployee` created every account with the literal password
 * `password123`, and the seed created three more the same way. New hires are
 * fixed already; this handles the accounts that predate the fix.
 *
 * SAFETY:
 *  - READ-ONLY by default. It reports what it would change and exits.
 *  - Requires --apply to actually write.
 *  - Never deletes a user, never touches an account that has already been
 *    changed.
 *  - Idempotent: re-running finds nothing left to do.
 *
 * Detection is by comparing the stored bcrypt hash against the hash of the
 * known default. That is safe: bcrypt is salted, so a match is a genuine
 * equality, and the comparison happens inside bcrypt.
 *
 * Usage:
 *   node scripts/force-password-rotation.cjs           # dry run
 *   node scripts/force-password-rotation.cjs --apply   # write
 */

const bcrypt = require("bcryptjs");
const { PrismaClient } = require("../prisma/generated/client");
const crypto = require("crypto");

const APPLY = process.argv.includes("--apply");
const DEFAULT_PASSWORD = "password123";
const TTL_HOURS = 48;

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function main() {
    const prisma = new PrismaClient();
    const defaultHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

    const users = await prisma.user.findMany({
        where: { password: { not: null } },
        select: {
            id: true,
            email: true,
            role: true,
            password: true,
            securityFlag: { select: { mustChangePassword: true, passwordChangedAt: true } },
        },
        orderBy: { email: "asc" },
    });

    const onDefault = [];
    for (const user of users) {
        if (await bcrypt.compare(DEFAULT_PASSWORD, user.password)) {
            onDefault.push(user);
        }
    }

    console.log("=".repeat(72));
    console.log("PASSWORD ROTATION SCAN");
    console.log("=".repeat(72));
    console.log(`Mode:                ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
    console.log(`Accounts scanned:    ${users.length}`);
    console.log(`On default password: ${onDefault.length}`);
    console.log("");

    if (onDefault.length === 0) {
        console.log("Nothing to do — no account uses the shared default.");
        await prisma.$disconnect();
        return;
    }

    for (const user of onDefault) {
        const alreadyFlagged = user.securityFlag?.mustChangePassword === true;
        console.log(`  ${user.email.padEnd(30)} role=${(user.role || "").padEnd(8)} ${
            alreadyFlagged ? "already flagged" : "NEEDS ROTATION"
        }`);
    }

    if (!APPLY) {
        console.log("");
        console.log("Dry run only. Re-run with --apply to flag these accounts.");
        await prisma.$disconnect();
        return;
    }

    console.log("");
    console.log("Applying...");

    let flagged = 0;
    let already = 0;

    for (const user of onDefault) {
        if (user.securityFlag?.mustChangePassword) {
            already++;
            continue;
        }

        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);

        await prisma.$transaction([
            // Supersede any earlier unused link so only the newest works.
            prisma.passwordResetToken.updateMany({
                where: { userId: user.id, usedAt: null },
                data: { usedAt: new Date() },
            }),
            prisma.passwordResetToken.create({
                data: {
                    userId: user.id,
                    tokenHash: hashToken(token),
                    purpose: "PASSWORD_RESET",
                    expiresAt,
                    createdBy: "scripts/force-password-rotation.cjs",
                },
            }),
            prisma.userSecurityFlag.upsert({
                where: { userId: user.id },
                update: {
                    mustChangePassword: true,
                    mustChangeReason: "Rotated off the shared default password",
                    updatedAt: new Date(),
                },
                create: {
                    userId: user.id,
                    mustChangePassword: true,
                    mustChangeReason: "Rotated off the shared default password",
                },
            }),
            // Sign-in is refused while the flag is set (see auth.ts), so the
            // password itself is left in place rather than nulled — nulling
            // would lock the account out entirely with no way back in.
        ]);

        flagged++;
        // The token is NOT printed: it is shown to the user through the
        // reissue UI, which is the only supported delivery path.
    }

    console.log(`  newly flagged: ${flagged}`);
    console.log(`  already flagged: ${already}`);
    console.log("");
    console.log("These accounts can no longer sign in until they set a new password.");
    console.log("Issue each activation link from the employee record in the UI.");
    console.log("No user was deleted and no other data was changed.");

    await prisma.$disconnect();
}

main().catch(async (error) => {
    console.error("FAILED:", error.message);
    process.exit(1);
});
