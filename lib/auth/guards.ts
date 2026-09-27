/**
 * Server-side authorization guards.
 *
 * Every server action and API route must call one of these. Frontend hiding is
 * a usability affordance only — these guards are the security boundary.
 *
 * Two families are provided:
 *  - `require*`  → throws `AuthorizationError`; for server actions and pages.
 *  - `authorize*` → returns a discriminated result; for API routes that need a
 *                   specific HTTP status (401 vs 403).
 */

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Role, ROLES, toRole, assertKnownRole, isSuperAdmin } from "./roles";
import {
    Permission,
    PermissionOverrides,
    resolvePermissions,
    hasAnyPermission,
    hasAllPermissions,
} from "./permissions";
import { AuthorizationSubject, buildSubject, scopeKindForRole } from "./scope";
import { logSecurityEvent, SECURITY_ACTION } from "./audit";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class AuthenticationError extends Error {
    readonly status = 401;
    constructor(message = "Authentication required") {
        super(message);
        this.name = "AuthenticationError";
    }
}

export class AuthorizationError extends Error {
    readonly status = 403;
    readonly permission?: string;
    constructor(message = "Insufficient permissions", permission?: string) {
        super(message);
        this.name = "AuthorizationError";
        this.permission = permission;
    }
}

/* ------------------------------------------------------------------ */
/* Session loading                                                     */
/* ------------------------------------------------------------------ */

export interface SessionUser {
    id: string;
    email: string;
    role: Role;
    employeeId: string | null;
    department: string | null;
}

export type SessionResult =
    | { ok: true; user: SessionUser; subject: AuthorizationSubject }
    | { ok: false; reason: "unauthenticated" | "unknown_user"; user: null; subject: null };

/**
 * Loads the authenticated user.
 *
 * The role and employee link are re-read from the database on every call
 * instead of trusting `session.user.role` from the JWT. A token issued before
 * a demotion therefore stops being authoritative immediately, which is what
 * RBAC-010 requires.
 */
export async function getSessionUser(): Promise<SessionResult> {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    const email = session?.user?.email;

    if (!session?.user || !email) {
        return { ok: false, reason: "unauthenticated", user: null, subject: null };
    }

    const subject = await buildSubject(userId ?? email, email);
    if (!subject) {
        return { ok: false, reason: "unknown_user", user: null, subject: null };
    }

    return {
        ok: true,
        subject,
        user: {
            id: subject.userId,
            email: subject.email,
            role: subject.role,
            employeeId: subject.employeeId,
            department: subject.department,
        },
    };
}

/* ------------------------------------------------------------------ */
/* Throwing guards — server actions and pages                           */
/* ------------------------------------------------------------------ */

export async function requireUser(): Promise<SessionUser> {
    const result = await getSessionUser();
    if (!result.ok) throw new AuthenticationError();
    return result.user;
}

export async function requireSubject(): Promise<AuthorizationSubject> {
    const result = await getSessionUser();
    if (!result.ok) throw new AuthenticationError();
    return result.subject;
}

export async function requireRole(...allowed: readonly Role[]): Promise<SessionUser> {
    const user = await requireUser();
    if (!allowed.includes(user.role)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: `role:${allowed.join("|")}`,
            outcome: "DENIED",
            detail: { requiredRoles: allowed, actualRole: user.role },
        });
        throw new AuthorizationError(`Requires one of: ${allowed.join(", ")}`);
    }
    return user;
}

/**
 * Grants a SUPER_ADMIN capability that is deliberately absent from every
 * static role grant table, so that it can only be exercised through this
 * explicit call and is always audit-logged.
 */
export async function requireSuperAdmin(capability: string): Promise<SessionUser> {
    const user = await requireUser();
    if (!isSuperAdmin(user.role)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: capability,
            outcome: "DENIED",
            detail: { requiredCapability: capability },
        });
        throw new AuthorizationError(`Requires SUPER_ADMIN for: ${capability}`);
    }
    return user;
}

export async function requirePermission(
    permission: Permission | string,
    overrides?: PermissionOverrides | null
): Promise<SessionUser> {
    const user = await requireUser();
    const { permissions } = resolvePermissions(user.role, overrides);
    if (!permissions.has(permission)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: `permission:${permission}`,
            outcome: "DENIED",
            detail: { requiredPermission: permission },
        });
        throw new AuthorizationError(`Missing permission: ${permission}`, permission);
    }
    return user;
}

export async function requireAnyPermission(
    required: readonly (Permission | string)[],
    overrides?: PermissionOverrides | null
): Promise<SessionUser> {
    const user = await requireUser();
    if (!hasAnyPermission(user.role, required, overrides)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: `permission-any:${required.join("|")}`,
            outcome: "DENIED",
            detail: { requiredAny: required },
        });
        throw new AuthorizationError(`Missing one of: ${required.join(", ")}`);
    }
    return user;
}

export async function requireAllPermissions(
    required: readonly (Permission | string)[],
    overrides?: PermissionOverrides | null
): Promise<SessionUser> {
    const user = await requireUser();
    if (!hasAllPermissions(user.role, required, overrides)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: `permission-all:${required.join("|")}`,
            outcome: "DENIED",
            detail: { requiredAll: required },
        });
        throw new AuthorizationError(`Missing all of: ${required.join(", ")}`);
    }
    return user;
}

/* ------------------------------------------------------------------ */
/* Result-returning guards — API routes                                */
/* ------------------------------------------------------------------ */

export type AuthorizeResult =
    | { ok: true; user: SessionUser; subject: AuthorizationSubject }
    | { ok: false; status: 401 | 403; error: string; user: null; subject: null };

function denied(status: 401 | 403, error: string): AuthorizeResult {
    return { ok: false, status, error, user: null, subject: null };
}

export async function authorizePermission(
    permission: Permission | string
): Promise<AuthorizeResult> {
    const result = await getSessionUser();
    if (!result.ok) return denied(401, "Authentication required");

    const { permissions } = resolvePermissions(result.user.role);
    if (!permissions.has(permission)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: result.user.email,
            actorRole: result.user.role,
            target: `permission:${permission}`,
            outcome: "DENIED",
        });
        return denied(403, "Insufficient permissions");
    }
    return { ok: true, user: result.user, subject: result.subject };
}

export async function authorizeAnyPermission(
    required: readonly (Permission | string)[]
): Promise<AuthorizeResult> {
    const result = await getSessionUser();
    if (!result.ok) return denied(401, "Authentication required");

    if (!hasAnyPermission(result.user.role, required)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: result.user.email,
            actorRole: result.user.role,
            target: `permission-any:${required.join("|")}`,
            outcome: "DENIED",
        });
        return denied(403, "Insufficient permissions");
    }
    return { ok: true, user: result.user, subject: result.subject };
}

export async function authorizeRole(...allowed: readonly Role[]): Promise<AuthorizeResult> {
    const result = await getSessionUser();
    if (!result.ok) return denied(401, "Authentication required");

    if (!allowed.includes(result.user.role)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: result.user.email,
            actorRole: result.user.role,
            target: `role:${allowed.join("|")}`,
            outcome: "DENIED",
        });
        return denied(403, "Insufficient role");
    }
    return { ok: true, user: result.user, subject: result.subject };
}

/* ------------------------------------------------------------------ */
/* Super Admin protection (RBAC-012 .. RBAC-015)                        */
/* ------------------------------------------------------------------ */

export interface RoleChangeValidation {
    allowed: boolean;
    reason?: string;
}

/**
 * Guards every role mutation so that:
 *  - only a sufficiently privileged actor may grant or revoke a role;
 *  - an actor cannot escalate themselves beyond their own authority;
 *  - the last SUPER_ADMIN can never be demoted, disabled or deleted.
 */
export async function validateRoleChange(params: {
    actorRole: Role;
    targetUserId: string;
    currentRole: Role;
    nextRole: Role;
    /** True when the target account is being disabled or deleted. */
    removingAccess?: boolean;
}): Promise<RoleChangeValidation> {
    const { actorRole, targetUserId, currentRole, nextRole } = params;

    // The final SUPER_ADMIN must remain.
    if (currentRole === ROLES.SUPER_ADMIN && nextRole !== ROLES.SUPER_ADMIN) {
        const superAdmins = await prisma.user.count({ where: { role: ROLES.SUPER_ADMIN } });
        if (superAdmins <= 1) {
            return { allowed: false, reason: "Cannot remove the last SUPER_ADMIN" };
        }
    }

    // Nobody may grant or revoke SUPER_ADMIN without already being one.
    if ((nextRole === ROLES.SUPER_ADMIN || currentRole === ROLES.SUPER_ADMIN) && actorRole !== ROLES.SUPER_ADMIN) {
        return { allowed: false, reason: "Only SUPER_ADMIN may modify a SUPER_ADMIN account" };
    }

    // No self-escalation.
    if (targetUserId && actorRole !== ROLES.SUPER_ADMIN) {
        const actor = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: { id: true },
        });
        if (actor?.id === targetUserId) {
            return { allowed: false, reason: "Cannot change your own role" };
        }
    }

    // An ADMIN may not create another ADMIN of equal standing without authority.
    if (nextRole === ROLES.ADMIN && actorRole !== ROLES.SUPER_ADMIN && actorRole !== ROLES.ADMIN) {
        return { allowed: false, reason: "Insufficient authority to grant ADMIN" };
    }

    return { allowed: true };
}

/** Roles a given actor is permitted to assign. Used to filter the UI options. */
export function assignableRoles(actorRole: Role): Role[] {
    if (actorRole === ROLES.SUPER_ADMIN) {
        return [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.HR, ROLES.FINANCE, ROLES.MANAGER, ROLES.STAFF];
    }
    if (actorRole === ROLES.ADMIN) {
        return [ROLES.HR, ROLES.FINANCE, ROLES.MANAGER, ROLES.STAFF];
    }
    return [];
}

/** Rejects an unrecognised role string rather than silently downgrading it. */
export function validateRoleValue(value: unknown): { ok: true; role: Role } | { ok: false; error: string } {
    const role = assertKnownRole(value);
    if (!role) {
        return { ok: false, error: `Unknown role: ${typeof value === "string" ? value : typeof value}` };
    }
    return { ok: true, role };
}

export { toRole, isSuperAdmin, scopeKindForRole };
