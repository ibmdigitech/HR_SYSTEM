/**
 * Server-component page guards.
 *
 * 16 of 38 page routes had no `redirect("/login")`, so a signed-out visitor
 * could render them. The middleware now blocks anonymous requests at the edge,
 * but middleware is a coarse gate: it answers "is there a session", not "is
 * this role allowed here". These helpers add the authoritative per-page check.
 *
 * Usage inside a page:
 *   await requirePageAccess({ permission: PERMISSIONS.PAYROLL_VIEW });
 *
 * An unauthenticated or under-privileged visitor is redirected, so the page
 * body is never rendered and the underlying data is never queried.
 */

import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./guards";
import { AuthorizationSubject } from "./scope";
import { Permission, resolvePermissions, hasAnyPermission } from "./permissions";
import type { Role } from "./roles";
import { logSecurityEvent, SECURITY_ACTION } from "./audit";

export interface PageAccess {
    user: SessionUser;
    subject: AuthorizationSubject;
}

/** Requires a session; redirects to sign-in otherwise. */
export async function requirePageUser(): Promise<PageAccess> {
    const result = await getSessionUser();
    if (!result.ok) redirect("/login");
    return { user: result.user, subject: result.subject };
}

/** Requires a session plus one of the given roles. */
export async function requirePageRole(...allowed: readonly Role[]): Promise<PageAccess> {
    const access = await requirePageUser();
    if (!allowed.includes(access.user.role)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: access.user.email,
            actorRole: access.user.role,
            target: `page:role:${allowed.join("|")}`,
            outcome: "DENIED",
        });
        // Not `notFound()` — a 404 would hide that the route exists from a
        // legitimate-but-unauthorized user. The dashboard is the safe landing.
        redirect("/dashboard");
    }
    return access;
}

/** Requires a session plus a single capability. */
export async function requirePagePermission(permission: Permission | string): Promise<PageAccess> {
    const access = await requirePageUser();
    const { permissions } = resolvePermissions(access.user.role);
    if (!permissions.has(permission)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: access.user.email,
            actorRole: access.user.role,
            target: `page:permission:${permission}`,
            outcome: "DENIED",
        });
        redirect("/dashboard");
    }
    return access;
}

/** Requires a session plus at least one of the given capabilities. */
export async function requirePageAnyPermission(
    required: readonly (Permission | string)[]
): Promise<PageAccess> {
    const access = await requirePageUser();
    if (!hasAnyPermission(access.user.role, required)) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: access.user.email,
            actorRole: access.user.role,
            target: `page:permission-any:${required.join("|")}`,
            outcome: "DENIED",
        });
        redirect("/dashboard");
    }
    return access;
}
