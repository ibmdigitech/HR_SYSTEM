/**
 * Organisational scope.
 *
 * A permission answers "may this user perform this capability at all?".
 * Scope answers "over which records?" — the second half of every IDOR check.
 *
 * The schema has no organisation/branch table today, so the only reliable
 * boundary is department + reporting line, both of which already exist on
 * `Employee`. This module derives scope from those fields rather than
 * inventing new tables, so no migration is required.
 */

import prisma from "@/lib/prisma";
import { Role, ROLES, toRole } from "./roles";
import { resolvePermissions } from "./permissions";

export type ScopeKind = "ALL" | "DEPARTMENT" | "SELF";

export interface AuthorizationSubject {
    userId: string;
    email: string;
    role: Role;
    /** Employee record linked to this User, when one exists. */
    employeeId: string | null;
    department: string | null;
}

export const SCOPE_KIND_BY_ROLE: Record<Role, ScopeKind> = {
    [ROLES.SUPER_ADMIN]: "ALL",
    [ROLES.ADMIN]: "ALL",
    [ROLES.HR]: "ALL",
    [ROLES.FINANCE]: "ALL",
    [ROLES.MANAGER]: "DEPARTMENT",
    [ROLES.STAFF]: "SELF",
};

export function scopeKindForRole(roleInput: unknown): ScopeKind {
    return SCOPE_KIND_BY_ROLE[toRole(roleInput)];
}

/**
 * Builds the subject from the authenticated session by loading the User row
 * server-side. The role is re-read from the database rather than trusted from
 * the JWT, so a stale or forged token cannot grant authority.
 */
export async function buildSubject(userId: string, email: string): Promise<AuthorizationSubject | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            role: true,
            employee: { select: { id: true, department: true } },
        },
    });
    if (!user) return null;

    return {
        userId: user.id,
        email: user.email,
        role: toRole(user.role),
        employeeId: user.employee?.id ?? null,
        department: user.employee?.department ?? null,
    };
}

/**
 * Returns true when `subject` is permitted to act on the record owned by
 * `owner`. This is the reusable IDOR primitive: call it whenever a request
 * carries an entity id.
 *
 * Rules:
 *  - ALL scope      → anything
 *  - DEPARTMENT     → records whose owner shares the subject's department
 *  - SELF           → only the subject's own employee record
 */
export function canActOnEmployeeRecord(
    subject: AuthorizationSubject,
    owner: { employeeId: string | null; department?: string | null }
): boolean {
    const kind = scopeKindForRole(subject.role);
    if (kind === "ALL") return true;
    if (kind === "SELF") return owner.employeeId !== null && owner.employeeId === subject.employeeId;
    // DEPARTMENT
    if (!owner.employeeId) return false;
    if (owner.employeeId === subject.employeeId) return true;
    if (!subject.department) return false;
    return (owner.department ?? null) === subject.department;
}

/**
 * Applies the subject's scope to an employee `where` clause.
 * `ALL` returns the clause unchanged so callers can compose it freely.
 */
export function scopeEmployeeWhere(
    subject: AuthorizationSubject,
    where: Record<string, unknown> = {}
): Record<string, unknown> {
    const kind = scopeKindForRole(subject.role);
    if (kind === "ALL") return where;
    if (kind === "SELF") {
        return { ...where, ...(subject.employeeId ? { id: subject.employeeId } : { id: "__none__" }) };
    }
    if (!subject.department) {
        // A manager with no department can only see their own record.
        return { ...where, ...(subject.employeeId ? { id: subject.employeeId } : { id: "__none__" }) };
    }
    return { ...where, department: subject.department };
}

/**
 * A manager may never approve or act on their own request even though
 * SELF-or-DEPARTMENT scope would technically allow it.
 */
export function isSelfAction(subject: AuthorizationSubject, ownerEmployeeId: string | null): boolean {
    return ownerEmployeeId !== null && subject.employeeId !== null && ownerEmployeeId === subject.employeeId;
}

/** True when the subject can read records outside their own scope. */
export function hasBroadScope(subject: AuthorizationSubject): boolean {
    const { permissions } = resolvePermissions(subject.role);
    return (
        scopeKindForRole(subject.role) === "ALL" ||
        permissions.has("employees.view") ||
        permissions.has("payroll.payroll.view.all") ||
        permissions.has("payroll.payslip.view.all")
    );
}
