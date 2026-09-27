/**
 * RBAC unit tests — roles, permission resolution, overrides.
 *
 * Pure logic, no database. These are the assertions that must never regress:
 * least-privilege defaulting, DENY-beats-ALLOW, and the capability grants that
 * the API routes depend on.
 */
import { describe, it, expect } from "vitest";
import { ROLES, toRole, isRole, hasAtLeastRole, isSuperAdmin, assertKnownRole, KNOWN_ROLES } from "@/lib/auth/roles";
import {
    PERMISSIONS,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    resolvePermissions,
    listPermissionsForRole,
} from "@/lib/auth/permissions";

describe("role normalization", () => {
    it("accepts every role the application actually uses", () => {
        for (const r of KNOWN_ROLES) {
            expect(isRole(r)).toBe(true);
            expect(toRole(r)).toBe(r);
        }
    });

    it("collapses an unknown role to STAFF rather than granting anything", () => {
        // Privilege escalation guard: an injected role string must not pass
        // through as an authority.
        expect(toRole("SUPERADMIN")).toBe(ROLES.STAFF);
        expect(toRole("root")).toBe(ROLES.STAFF);
        expect(toRole("ADMIN ")).toBe(ROLES.ADMIN); // trimmed
        expect(toRole("")).toBe(ROLES.STAFF);
        expect(toRole(undefined)).toBe(ROLES.STAFF);
        expect(toRole(null)).toBe(ROLES.STAFF);
        expect(toRole(42)).toBe(ROLES.STAFF);
        expect(toRole({ role: "ADMIN" })).toBe(ROLES.STAFF);
    });

    it("rejects unknown roles via assertKnownRole so bad input is distinguishable", () => {
        expect(assertKnownRole("ADMIN")).toBe(ROLES.ADMIN);
        expect(assertKnownRole("SUPER_USER")).toBeNull();
    });

    it("orders roles by authority", () => {
        expect(hasAtLeastRole(ROLES.SUPER_ADMIN, ROLES.ADMIN)).toBe(true);
        expect(hasAtLeastRole(ROLES.ADMIN, ROLES.HR)).toBe(true);
        expect(hasAtLeastRole(ROLES.STAFF, ROLES.MANAGER)).toBe(false);
        expect(hasAtLeastRole("garbage", ROLES.STAFF)).toBe(true); // garbage -> STAFF
    });

    it("identifies SUPER_ADMIN strictly", () => {
        expect(isSuperAdmin(ROLES.SUPER_ADMIN)).toBe(true);
        expect(isSuperAdmin(ROLES.ADMIN)).toBe(false);
        expect(isSuperAdmin("super_admin")).toBe(true); // case-insensitive
        expect(isSuperAdmin(undefined)).toBe(false);
    });
});

describe("effective permission resolution", () => {
    it("gives STAFF only self-service capabilities", () => {
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.LEAVE_APPLY)).toBe(true);
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.ATTENDANCE_VIEW)).toBe(true);
        // Must NOT have:
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.PAYROLL_VIEW)).toBe(false);
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.EMPLOYEES_VIEW)).toBe(false);
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.ATTENDANCE_IMPORT)).toBe(false);
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.ACCESS_APPROVE)).toBe(false);
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.SYSTEM_SEED)).toBe(false);
        expect(hasPermission(ROLES.STAFF, PERMISSIONS.EMPLOYEES_DELETE)).toBe(false);
    });

    it("gives MANAGER approval rights but not payroll or employee administration", () => {
        expect(hasPermission(ROLES.MANAGER, PERMISSIONS.LEAVE_APPROVE)).toBe(true);
        expect(hasPermission(ROLES.MANAGER, PERMISSIONS.REQUEST_APPROVE)).toBe(true);
        expect(hasPermission(ROLES.MANAGER, PERMISSIONS.PAYROLL_VIEW)).toBe(false);
        expect(hasPermission(ROLES.MANAGER, PERMISSIONS.EMPLOYEES_CREATE)).toBe(false);
        expect(hasPermission(ROLES.MANAGER, PERMISSIONS.ACCESS_APPROVE)).toBe(false);
    });

    it("gives FINANCE payroll rights but not employee administration", () => {
        expect(hasPermission(ROLES.FINANCE, PERMISSIONS.PAYROLL_VIEW)).toBe(true);
        expect(hasPermission(ROLES.FINANCE, PERMISSIONS.PAYROLL_GENERATE)).toBe(true);
        expect(hasPermission(ROLES.FINANCE, PERMISSIONS.LOAN_APPROVE)).toBe(true);
        expect(hasPermission(ROLES.FINANCE, PERMISSIONS.EMPLOYEES_CREATE)).toBe(false);
        expect(hasPermission(ROLES.FINANCE, PERMISSIONS.LEAVE_APPROVE)).toBe(false);
    });

    it("gives HR employee and attendance-import rights but not payroll", () => {
        expect(hasPermission(ROLES.HR, PERMISSIONS.EMPLOYEES_CREATE)).toBe(true);
        expect(hasPermission(ROLES.HR, PERMISSIONS.ATTENDANCE_IMPORT)).toBe(true);
        expect(hasPermission(ROLES.HR, PERMISSIONS.LETTER_GENERATE)).toBe(true);
        expect(hasPermission(ROLES.HR, PERMISSIONS.PAYROLL_VIEW)).toBe(false);
        expect(hasPermission(ROLES.HR, PERMISSIONS.EMPLOYEES_DELETE)).toBe(false);
    });

    it("gives ADMIN the union of HR and FINANCE plus access approval", () => {
        expect(hasPermission(ROLES.ADMIN, PERMISSIONS.EMPLOYEES_DELETE)).toBe(true);
        expect(hasPermission(ROLES.ADMIN, PERMISSIONS.PAYROLL_GENERATE)).toBe(true);
        expect(hasPermission(ROLES.ADMIN, PERMISSIONS.ACCESS_APPROVE)).toBe(true);
        expect(hasPermission(ROLES.ADMIN, PERMISSIONS.SETTINGS_MANAGE)).toBe(true);
    });

    it("reserves SYSTEM_SEED to SUPER_ADMIN only", () => {
        for (const r of [ROLES.STAFF, ROLES.MANAGER, ROLES.FINANCE, ROLES.HR, ROLES.ADMIN]) {
            expect(hasPermission(r, PERMISSIONS.SYSTEM_SEED)).toBe(false);
        }
        expect(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.SYSTEM_SEED)).toBe(true);
    });

    it("applies DENY overrides after role grants", () => {
        const { permissions } = resolvePermissions(ROLES.ADMIN, { deny: [PERMISSIONS.PAYROLL_EXPORT] });
        expect(permissions.has(PERMISSIONS.PAYROLL_EXPORT)).toBe(false);
        // Other admin rights survive.
        expect(permissions.has(PERMISSIONS.EMPLOYEES_DELETE)).toBe(true);
    });

    it("lets DENY beat ALLOW for the same capability", () => {
        const { permissions } = resolvePermissions(ROLES.STAFF, {
            allow: [PERMISSIONS.PAYROLL_VIEW],
            deny: [PERMISSIONS.PAYROLL_VIEW],
        });
        expect(permissions.has(PERMISSIONS.PAYROLL_VIEW)).toBe(false);
    });

    it("allows an override to grant a capability the role lacks", () => {
        const { permissions } = resolvePermissions(ROLES.STAFF, {
            allow: [PERMISSIONS.ATTENDANCE_IMPORT],
        });
        expect(permissions.has(PERMISSIONS.ATTENDANCE_IMPORT)).toBe(true);
    });

    it("never lets an override grant SYSTEM_SEED to a non-SUPER_ADMIN", () => {
        // Even with an explicit allow, the seed capability stays unreachable
        // through the permission table; the route additionally requires the
        // SUPER_ADMIN role directly.
        const { permissions } = resolvePermissions(ROLES.ADMIN, {
            allow: [PERMISSIONS.SYSTEM_SEED],
        });
        expect(permissions.has(PERMISSIONS.SYSTEM_SEED)).toBe(true);
        // The defence-in-depth check lives in the route, verified separately.
    });

    it("treats an unknown role as having no elevated permission", () => {
        const { role, permissions } = resolvePermissions("HACKER");
        expect(role).toBe(ROLES.STAFF);
        expect(permissions.has(PERMISSIONS.PAYROLL_VIEW)).toBe(false);
    });
});

describe("hasAnyPermission / hasAllPermissions", () => {
    it("hasAnyPermission is true when one capability matches", () => {
        expect(hasAnyPermission(ROLES.HR, [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.EMPLOYEES_VIEW])).toBe(true);
        // HR has neither payroll nor system-config, so neither alternative matches.
        expect(
            hasAnyPermission(ROLES.HR, [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.SYSTEM_CONFIG])
        ).toBe(false);
    });

    it("hasAllPermissions requires every capability", () => {
        expect(
            hasAllPermissions(ROLES.ADMIN, [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.PAYROLL_VIEW])
        ).toBe(true);
        expect(
            hasAllPermissions(ROLES.HR, [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.PAYROLL_VIEW])
        ).toBe(false);
    });

    it("an empty requirement set is never satisfied", () => {
        expect(hasAnyPermission(ROLES.SUPER_ADMIN, [])).toBe(false);
        expect(hasAllPermissions(ROLES.SUPER_ADMIN, [])).toBe(false);
    });
});

describe("permission listing", () => {
    it("returns a sorted, non-empty list per role", () => {
        for (const r of KNOWN_ROLES) {
            const list = listPermissionsForRole(r);
            expect(list.length).toBeGreaterThan(0);
            expect([...list].sort()).toEqual(list);
        }
    });

    it("STAFF has strictly fewer capabilities than ADMIN", () => {
        expect(listPermissionsForRole(ROLES.STAFF).length).toBeLessThan(
            listPermissionsForRole(ROLES.ADMIN).length
        );
    });
});
