/**
 * Scope and IDOR tests.
 *
 * The reusable primitive is `canActOnEmployeeRecord`. Every request that
 * carries an entity id must go through a check like this, so the primitive
 * itself needs to be proven correct for all scope kinds.
 */
import { describe, it, expect } from "vitest";
import {
    scopeKindForRole,
    canActOnEmployeeRecord,
    scopeEmployeeWhere,
    isSelfAction,
    type AuthorizationSubject,
} from "@/lib/auth/scope";
import { ROLES } from "@/lib/auth/roles";

function subject(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
    return {
        userId: "u1",
        email: "user@test.com",
        role: ROLES.STAFF,
        employeeId: "emp-self",
        department: "Operations",
        ...overrides,
    };
}

describe("scope kind by role", () => {
    it("maps roles to the correct boundary", () => {
        expect(scopeKindForRole(ROLES.SUPER_ADMIN)).toBe("ALL");
        expect(scopeKindForRole(ROLES.ADMIN)).toBe("ALL");
        expect(scopeKindForRole(ROLES.HR)).toBe("ALL");
        expect(scopeKindForRole(ROLES.FINANCE)).toBe("ALL");
        expect(scopeKindForRole(ROLES.MANAGER)).toBe("DEPARTMENT");
        expect(scopeKindForRole(ROLES.STAFF)).toBe("SELF");
    });

    it("treats an unknown role as SELF (least privilege)", () => {
        expect(scopeKindForRole("GHOST")).toBe("SELF");
    });
});

describe("canActOnEmployeeRecord (IDOR primitive)", () => {
    it("ALL scope may act on any record", () => {
        const admin = subject({ role: ROLES.ADMIN, employeeId: "emp-admin" });
        expect(canActOnEmployeeRecord(admin, { employeeId: "emp-a" })).toBe(true);
        expect(canActOnEmployeeRecord(admin, { employeeId: "emp-b", department: "Finance" })).toBe(true);
        expect(canActOnEmployeeRecord(admin, { employeeId: null })).toBe(true);
    });

    it("SELF scope may act only on its own record", () => {
        const staff = subject({ role: ROLES.STAFF });
        expect(canActOnEmployeeRecord(staff, { employeeId: "emp-self" })).toBe(true);
        // The IDOR case: changing the id must not grant access.
        expect(canActOnEmployeeRecord(staff, { employeeId: "emp-other" })).toBe(false);
        // Even a same-department peer is out of scope for SELF.
        expect(canActOnEmployeeRecord(staff, { employeeId: "emp-peer", department: "Operations" })).toBe(false);
    });

    it("SELF scope with no linked employee can act on nothing", () => {
        const orphan = subject({ role: ROLES.STAFF, employeeId: null });
        expect(canActOnEmployeeRecord(orphan, { employeeId: null })).toBe(false);
        expect(canActOnEmployeeRecord(orphan, { employeeId: "emp-other" })).toBe(false);
    });

    it("DEPARTMENT scope may act within its department and on itself", () => {
        const manager = subject({ role: ROLES.MANAGER, employeeId: "emp-mgr" });
        expect(canActOnEmployeeRecord(manager, { employeeId: "emp-peer", department: "Operations" })).toBe(true);
        expect(canActOnEmployeeRecord(manager, { employeeId: "emp-mgr", department: "IT" })).toBe(true);
        // Cross-department is denied.
        expect(canActOnEmployeeRecord(manager, { employeeId: "emp-fin", department: "Finance" })).toBe(false);
    });

    it("DEPARTMENT scope with no department falls back to self only", () => {
        const manager = subject({ role: ROLES.MANAGER, employeeId: "emp-mgr", department: null });
        expect(canActOnEmployeeRecord(manager, { employeeId: "emp-mgr" })).toBe(true);
        expect(canActOnEmployeeRecord(manager, { employeeId: "emp-peer", department: "Operations" })).toBe(false);
    });

    it("denies when the target record has no owner", () => {
        const manager = subject({ role: ROLES.MANAGER });
        expect(canActOnEmployeeRecord(manager, { employeeId: null })).toBe(false);
    });
});

describe("scopeEmployeeWhere", () => {
    it("leaves the clause untouched for ALL scope", () => {
        const admin = subject({ role: ROLES.ADMIN });
        const where = { currentStatus: "ACTIVE" };
        expect(scopeEmployeeWhere(admin, where)).toEqual({ currentStatus: "ACTIVE" });
    });

    it("constrains to the own id for SELF scope", () => {
        const staff = subject({ role: ROLES.STAFF });
        expect(scopeEmployeeWhere(staff, { currentStatus: "ACTIVE" })).toEqual({
            currentStatus: "ACTIVE",
            id: "emp-self",
        });
    });

    it("returns a match-nothing clause when a SELF subject has no employee id", () => {
        const orphan = subject({ role: ROLES.STAFF, employeeId: null });
        expect(scopeEmployeeWhere(orphan)).toEqual({ id: "__none__" });
    });

    it("constrains to the department for DEPARTMENT scope", () => {
        const manager = subject({ role: ROLES.MANAGER });
        expect(scopeEmployeeWhere(manager, { currentStatus: "ACTIVE" })).toEqual({
            currentStatus: "ACTIVE",
            department: "Operations",
        });
    });

    it("does not mutate the caller's clause", () => {
        const staff = subject({ role: ROLES.STAFF });
        const original = { currentStatus: "ACTIVE" };
        scopeEmployeeWhere(staff, original);
        expect(original).toEqual({ currentStatus: "ACTIVE" });
    });
});

describe("isSelfAction", () => {
    it("detects self-directed action", () => {
        expect(isSelfAction(subject(), "emp-self")).toBe(true);
        expect(isSelfAction(subject(), "emp-other")).toBe(false);
        expect(isSelfAction(subject({ employeeId: null }), "emp-self")).toBe(false);
        expect(isSelfAction(subject(), null)).toBe(false);
    });
});
