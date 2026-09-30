/**
 * Employee detail endpoint — authorization and data-minimisation.
 *
 * `/api/employees/[id]` is the first endpoint in the product that takes an
 * employee id from the URL. That makes it the exact shape of an IDOR: a
 * permission answers "may this caller read employee records at all?", and only
 * a scope predicate answers "which one?". These tests pin the second half,
 * because the first half is already proven by `rbac.test.ts`.
 *
 * The properties that matter:
 *  - an anonymous caller is refused and the database is never touched;
 *  - a role with no reason to read employee records is refused (FINANCE);
 *  - a MANAGER's read reaches Prisma as a DEPARTMENT filter, not as a bare id
 *    followed by an application-side check — asserted on the `where` clause the
 *    route actually sent, as `search-authorization.test.ts` does;
 *  - an out-of-scope id is 404, never 403, so the endpoint cannot be used as an
 *    oracle for "does this person work here?";
 *  - the `select` excludes salary, bank, government ID, date of birth and
 *    nationality for a caller that does not already hold `employees.view`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------------- module mocks (must precede imports) ---------------- */

const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = {
        current: null as { user: { id: string; email: string; role: string } } | null,
    };
    const prismaMock = {
        user: { findUnique: vi.fn() },
        securityAuditLog: { create: vi.fn() },
        employee: { findFirst: vi.fn(), findMany: vi.fn() },
        $transaction: vi.fn(),
        $disconnect: vi.fn(),
    };
    return { prismaMock, sessionStub };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    // Exercise the real action vocabulary but never write to the database.
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionStub.current) }));

/* ---------------- imports under test ---------------- */

import { GET as employeeGET } from "@/app/api/employees/[id]/route";
import { ROLES } from "@/lib/auth/roles";

/* ---------------- helpers ---------------- */

/**
 * `getSessionUser` re-reads the User row on every request rather than trusting
 * the JWT, so each test must model BOTH the session and the row.
 */
function signedInAs(role: string, department: string | null = "Operations", employeeId = `emp-${role}`) {
    sessionStub.current = { user: { id: `u-${role}`, email: `${role}@test.com`, role } };
    prismaMock.user.findUnique.mockImplementation(async () => ({
        id: `u-${role}`,
        email: `${role}@test.com`,
        role,
        employee: { id: employeeId, department },
    }));
}

function signedOut() {
    sessionStub.current = null;
    prismaMock.user.findUnique.mockResolvedValue(null);
}

function get(id: string) {
    return employeeGET(new Request(`http://localhost/api/employees/${id}`), {
        params: Promise.resolve({ id }),
    });
}

/** The `where` clause the route actually sent to Prisma. */
function whereSent() {
    const mock = prismaMock.employee.findFirst as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    return mock.mock.calls[0][0].where as Record<string, unknown>;
}

/** The Prisma `select` the route actually sent. */
function selectSent() {
    const mock = prismaMock.employee.findFirst as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    return mock.mock.calls[0][0].select as Record<string, unknown>;
}

function record(overrides: Record<string, unknown> = {}) {
    return {
        id: "emp-target",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@test.com",
        rollNumber: "EMP-001",
        lifecycle: "ACTIVE",
        currentStatus: "ACTIVE",
        isActive: true,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.securityAuditLog.create.mockResolvedValue({});
    prismaMock.employee.findFirst.mockResolvedValue(null);
    prismaMock.employee.findMany.mockResolvedValue([]);
    signedOut();
});

/* ---------------- tests ---------------- */

describe("GET /api/employees/[id] — authentication and capability", () => {
    it("returns 401 for an anonymous request", async () => {
        signedOut();
        const res = await get("emp-target");
        expect(res.status).toBe(401);
    });

    it("does not query the database for an anonymous request", async () => {
        signedOut();
        await get("emp-target");
        expect(prismaMock.employee.findFirst).not.toHaveBeenCalled();
    });

    it("returns 403 for FINANCE, who holds neither employees.view nor leave.view", async () => {
        // FINANCE reaches employee data through payroll; the profile endpoint
        // is not a second way in.
        signedInAs(ROLES.FINANCE);
        const res = await get("emp-target");
        expect(res.status).toBe(403);
        expect(prismaMock.employee.findFirst).not.toHaveBeenCalled();
    });

    it("returns the record to an HR caller with ALL scope", async () => {
        signedInAs(ROLES.HR, "People");
        prismaMock.employee.findFirst.mockResolvedValue(record());

        const res = await get("emp-target");
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.employee.id).toBe("emp-target");
    });
});

describe("GET /api/employees/[id] — organisational scope (IDOR boundary)", () => {
    // The requested id and the caller's scope are two SEPARATE conjuncts, not a
    // flat merge. `scopeEmployeeWhere(subject, { id })` looked equivalent but was
    // not: under SELF scope it returns `{ id: subject.employeeId }`, silently
    // discarding the requested id, so the query matched the caller's own row
    // whatever was asked for and answered 200 with the wrong person. The live
    // probe that caught it is documented in tests/employee-detail-idor.test.ts.

    it("sends BOTH the requested id and the DEPARTMENT filter to Prisma for a MANAGER", async () => {
        // The assertion is on the predicate, not on the result. If a future
        // refetch fetched by id and filtered in application code, this fails
        // even though the response body would still look correct.
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(record({ id: "emp-peer" }));

        await get("emp-peer");

        expect(whereSent()).toEqual({ AND: [{ id: "emp-peer" }, { department: "Operations" }] });
    });

    it("a MANAGER's department filter survives an id that belongs to another department", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        // The scoped query returns nothing for a cross-department id.
        prismaMock.employee.findFirst.mockResolvedValue(null);

        const res = await get("emp-finance");

        expect(whereSent()).toEqual({ AND: [{ id: "emp-finance" }, { department: "Operations" }] });
        expect(res.status).toBe(404);
    });

    it("contributes no constraint for HR, who has ALL scope", async () => {
        signedInAs(ROLES.HR, "People");
        prismaMock.employee.findFirst.mockResolvedValue(record());

        await get("emp-target");

        // ALL scope yields an empty clause, so only the requested id constrains
        // the query. The id must still be present as its own conjunct.
        expect(whereSent()).toEqual({ AND: [{ id: "emp-target" }, {}] });
    });

    it("constrains a STAFF caller to their own record id", async () => {
        signedInAs(ROLES.STAFF, "Operations", "emp-self");
        prismaMock.employee.findFirst.mockResolvedValue(record({ id: "emp-self" }));

        await get("emp-self");

        expect(whereSent()).toEqual({ AND: [{ id: "emp-self" }, { id: "emp-self" }] });
    });

    it("does not let the SELF scope id REPLACE the requested id", async () => {
        // The regression, stated directly. A flat merge would leave a top-level
        // `id` equal to the caller's own id and drop the requested one entirely.
        signedInAs(ROLES.STAFF, "Operations", "emp-self");
        prismaMock.employee.findFirst.mockResolvedValue(null);

        await get("emp-someone-else");

        const where = whereSent();
        expect(where.id).toBeUndefined();
        expect((where.AND as Record<string, unknown>[])[0]).toEqual({ id: "emp-someone-else" });
        expect((where.AND as Record<string, unknown>[])[1]).toEqual({ id: "emp-self" });
    });

    it("collapses a department-less MANAGER to their own record rather than widening", async () => {
        signedInAs(ROLES.MANAGER, null, "emp-mgr");
        prismaMock.employee.findFirst.mockResolvedValue(null);

        const res = await get("emp-peer");

        expect(whereSent()).toEqual({ AND: [{ id: "emp-peer" }, { id: "emp-mgr" }] });
        expect(res.status).toBe(404);
    });
});

describe("GET /api/employees/[id] — out-of-scope is 404, not 403", () => {
    it("returns 404 rather than 403 for a record outside the caller's scope", async () => {
        // 403 here would confirm the record exists. 404 makes "missing" and
        // "not yours" the same answer.
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(null);

        const res = await get("emp-finance");

        expect(res.status).toBe(404);
        expect(res.status).not.toBe(403);
    });

    it("returns 404 for an id that does not exist at all", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(null);

        expect((await get("emp-does-not-exist")).status).toBe(404);
    });

    it("returns the same body for missing and out-of-scope", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(null);
        const missing = await (await get("emp-nope")).json();
        const outOfScope = await (await get("emp-finance")).json();
        expect(outOfScope).toEqual(missing);
    });

    it("does not leak the record in the body of a 404", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(null);

        const body = JSON.stringify(await (await get("emp-finance")).json());
        expect(body).not.toContain("Lovelace");
        expect(body).not.toContain("ada@test.com");
    });
});

describe("GET /api/employees/[id] — field minimisation", () => {
    it("omits salary, bank, government ID, date of birth and nationality for a MANAGER", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(record());

        await get("emp-peer");

        // Assert the Prisma `select` itself, so a later "just include the
        // record" change is caught at the query rather than at the response.
        const select = selectSent();
        for (const field of [
            "basicSalary",
            "housingAllowance",
            "transportAllowance",
            "otherAllowance",
            "bankName",
            "accountNumber",
            "iban",
            "ifscCode",
            "governmentId",
            "dateOfBirth",
            "nationality",
            "passportNumber",
            "emiratesId",
            "visaNumber",
        ]) {
            expect(select).not.toHaveProperty(field);
        }
    });

    it("omits the identity-document numbers for a STAFF caller reading themselves", async () => {
        signedInAs(ROLES.STAFF, "Operations", "emp-self");
        prismaMock.employee.findFirst.mockResolvedValue(record({ id: "emp-self" }));

        await get("emp-self");

        const select = selectSent();
        expect(select).not.toHaveProperty("passportNumber");
        expect(select).not.toHaveProperty("governmentId");
    });

    it("still carries the fields a profile legitimately needs", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(record());

        await get("emp-peer");

        const select = selectSent();
        for (const field of [
            "id",
            "firstName",
            "lastName",
            "email",
            "rollNumber",
            "designation",
            "department",
            "joiningDate",
            "lifecycle",
        ]) {
            expect(select[field]).toBe(true);
        }
    });

    it("selects the authoritative lifecycle stage", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(record());

        await get("emp-peer");

        expect(selectSent().lifecycle).toBe(true);
    });

    it("includes the restricted columns for an employees.view holder", async () => {
        // HR sees these columns on the list page today, so the detail surface
        // matching that is deliberate, not a widening.
        signedInAs(ROLES.HR, "People");
        prismaMock.employee.findFirst.mockResolvedValue(record());

        await get("emp-target");

        const select = selectSent();
        expect(select.basicSalary).toBe(true);
        expect(select.iban).toBe(true);
        expect(select.dateOfBirth).toBe(true);
    });

    it("tells the client whether the restricted block was included", async () => {
        signedInAs(ROLES.MANAGER, "Operations");
        prismaMock.employee.findFirst.mockResolvedValue(record());
        const asManager = await (await get("emp-peer")).json();
        expect(asManager.includedRestrictedFields).toBe(false);

        signedInAs(ROLES.HR, "People");
        prismaMock.employee.findFirst.mockResolvedValue(record());
        const asHr = await (await get("emp-target")).json();
        expect(asHr.includedRestrictedFields).toBe(true);
    });
});

describe("GET /api/employees/[id] — failure handling", () => {
    it("does not leak a driver error", async () => {
        signedInAs(ROLES.HR, "People");
        prismaMock.employee.findFirst.mockRejectedValue(new Error("column employee.salary_ does not exist"));

        const res = await get("emp-target");
        const body = JSON.stringify(await res.json());

        expect(res.status).toBe(500);
        expect(body).not.toMatch(/salary/);
        expect(body).not.toMatch(/at .*\.ts:\d+/);
    });
});
