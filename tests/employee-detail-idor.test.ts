/**
 * The requested id must be INTERSECTED with the caller's scope, not replaced by it.
 *
 * The bug this guards against was found by probing the running app, not by
 * reading it. `scopeEmployeeWhere(subject, { id })` looks like "this employee,
 * if in scope", but under SELF scope it returns `{ id: subject.employeeId }` —
 * which OVERWRITES the requested id. The query then matched the caller's own
 * row no matter what was asked for, and the route answered 200 with the wrong
 * person instead of 404.
 *
 * That is not a cross-user data leak: the scope predicate still held, and the
 * sensitive-field block was still withheld. It is a correctness and API-contract
 * bug, and it is the kind that becomes a data leak the moment a write endpoint
 * is added to the same route, because a client that read employee A and then
 * wrote to employee A's URL would be operating on employee B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = { current: null as any };
    const prismaMock = {
        user: { findUnique: vi.fn() },
        securityAuditLog: { create: vi.fn() },
        employee: { findFirst: vi.fn() },
        $transaction: vi.fn(),
        $disconnect: vi.fn(),
    };
    return { prismaMock, sessionStub };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionStub.current) }));

import { GET } from "@/app/api/employees/[id]/route";
import { ROLES } from "@/lib/auth/roles";

const TARGET = "employee-admin";
const OTHER = "employee-staff";

function signedInAs(role: string, employeeId: string | null, department: string | null) {
    sessionStub.current = { user: { id: `u-${role}`, email: `${role}@test.com`, role } };
    prismaMock.user.findUnique.mockImplementation(async () => ({
        id: `u-${role}`,
        email: `${role}@test.com`,
        role,
        employee: employeeId ? { id: employeeId, department } : null,
    }));
}

function getWhere() {
    const call = (prismaMock.employee.findFirst as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call).toBeDefined();
    return call[0].where as any;
}

async function callRoute(id: string) {
    const req = new Request("http://localhost/api/employees/x");
    return GET(req as any, { params: Promise.resolve({ id }) } as any);
}

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.securityAuditLog.create.mockResolvedValue({});
    prismaMock.employee.findFirst.mockResolvedValue(null);
});

describe("employee detail - requested id is intersected with scope", () => {
    it("ANDs the requested id with the scope clause for a STAFF caller", async () => {
        signedInAs(ROLES.STAFF, OTHER, "Engineering");
        await callRoute(TARGET);

        const where = getWhere();
        // The requested id must survive as its own conjunct...
        expect(JSON.stringify(where)).toContain(TARGET);
        // ...and the scope clause must be present alongside it, not merged over it.
        expect(where.AND).toHaveLength(2);
        expect(where.AND[0]).toEqual({ id: TARGET });
        expect(where.AND[1]).toEqual({ id: OTHER });
    });

    it("does NOT let the SELF scope id overwrite the requested id", async () => {
        signedInAs(ROLES.STAFF, OTHER, "Engineering");
        await callRoute(TARGET);

        const where = getWhere();
        // The regression: a flat `{ id }` merge would make the top-level id equal
        // to the caller's own id and silently answer with the wrong person.
        expect(where.id).toBeUndefined();
    });

    it("applies the department clause alongside the id for a MANAGER", async () => {
        signedInAs(ROLES.MANAGER, "emp-mgr", "Operations");
        await callRoute(TARGET);

        const where = getWhere();
        expect(where.AND[0]).toEqual({ id: TARGET });
        expect(where.AND[1]).toEqual({ department: "Operations" });
    });

    it("leaves the requested id unrestricted for an ALL-scope ADMIN", async () => {
        signedInAs(ROLES.ADMIN, "emp-admin", "IT");
        await callRoute(TARGET);

        const where = getWhere();
        expect(where.AND[0]).toEqual({ id: TARGET });
        // ALL scope contributes no constraint at all.
        expect(where.AND[1]).toEqual({});
    });

    it("returns 404 when the scoped query matches nothing", async () => {
        signedInAs(ROLES.STAFF, OTHER, "Engineering");
        prismaMock.employee.findFirst.mockResolvedValue(null);

        const res = await callRoute(TARGET);
        expect(res.status).toBe(404);
    });

    it("returns 200 with the caller when the id IS their own", async () => {
        signedInAs(ROLES.STAFF, OTHER, "Engineering");
        prismaMock.employee.findFirst.mockResolvedValue({ id: OTHER, firstName: "Staff" });

        const res = await callRoute(OTHER);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.employee.id).toBe(OTHER);
    });

    it("withholds the restricted field block from a non-employees.view caller", async () => {
        signedInAs(ROLES.STAFF, OTHER, "Engineering");
        prismaMock.employee.findFirst.mockResolvedValue({ id: OTHER, firstName: "Staff" });

        const res = await callRoute(OTHER);
        const body = await res.json();

        expect(body.includedRestrictedFields).toBe(false);
        const select = (prismaMock.employee.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].select;
        expect(select).not.toHaveProperty("basicSalary");
        expect(select).not.toHaveProperty("accountNumber");
        expect(select).not.toHaveProperty("passportNumber");
    });

    it("includes the restricted block for an employees.view holder", async () => {
        signedInAs(ROLES.ADMIN, "emp-admin", "IT");
        prismaMock.employee.findFirst.mockResolvedValue({ id: TARGET, firstName: "Admin" });

        const res = await callRoute(TARGET);
        const body = await res.json();

        expect(body.includedRestrictedFields).toBe(true);
    });
});
