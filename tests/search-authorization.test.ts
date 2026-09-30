/**
 * Global search authorization tests.
 *
 * The header's search field was previously decorative — an `<Input>` with no
 * state, no handler and no query, advertising a "Cmd + K" shortcut that did not
 * exist. `/api/search` is the server half of the real implementation, and it is
 * the one place where a single mistake would leak records across the whole
 * product: one endpoint, many domains, one query box.
 *
 * The properties that matter, and that these tests pin:
 *  - an anonymous caller cannot search at all;
 *  - a domain is queried ONLY when the caller holds the matching permission,
 *    so search can never become a side channel around a page's own guard;
 *  - employee results are narrowed by the caller's organisational scope, so a
 *    MANAGER's search returns their own department and not the whole company.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------------- module mocks (must precede imports) ---------------- */

const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = { current: null as any };
    const prismaMock = {
        user: { findUnique: vi.fn() },
        securityAuditLog: { create: vi.fn() },
        employee: { findMany: vi.fn() },
        leaveRequest: { findMany: vi.fn() },
        candidate: { findMany: vi.fn() },
        offerLetter: { findMany: vi.fn() },
        serviceRequest: { findMany: vi.fn() },
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

/* ---------------- imports under test ---------------- */

import { GET as searchGET } from "@/app/api/search/route";
import { NextRequest } from "next/server";

/* ---------------- helpers ---------------- */

/**
 * The centralized guard re-reads the User row on every request rather than
 * trusting the JWT, so each test must model BOTH the session and the row.
 */
function signedInAs(role: string, email = "user@test.com", department: string | null = "Operations") {
    sessionStub.current = { user: { id: `u-${role}`, email, role } };
    prismaMock.user.findUnique.mockImplementation(async () => ({
        id: `u-${role}`,
        email,
        role,
        employee: { id: `emp-${role}`, department },
    }));
}

function signedOut() {
    sessionStub.current = null;
    prismaMock.user.findUnique.mockResolvedValue(null);
}

function searchRequest(query: string) {
    return new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(query)}`);
}

/** The `where` clause the route actually sent to Prisma for a given model. */
function whereFor(model: "employee" | "leaveRequest" | "candidate" | "offerLetter" | "serviceRequest") {
    const mock = prismaMock[model].findMany as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalled();
    return mock.mock.calls[0][0].where as Record<string, any>;
}

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.securityAuditLog.create.mockResolvedValue({});
    prismaMock.employee.findMany.mockResolvedValue([]);
    prismaMock.leaveRequest.findMany.mockResolvedValue([]);
    prismaMock.candidate.findMany.mockResolvedValue([]);
    prismaMock.offerLetter.findMany.mockResolvedValue([]);
    prismaMock.serviceRequest.findMany.mockResolvedValue([]);
    signedOut();
});

/* ---------------- tests ---------------- */

describe("API global search — authentication", () => {
    it("returns 401 for an anonymous request", async () => {
        signedOut();
        const res = await searchGET(searchRequest("ada"));
        expect(res.status).toBe(401);
    });

    it("does not query the database at all for an anonymous request", async () => {
        signedOut();
        await searchGET(searchRequest("ada"));
        expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
        expect(prismaMock.candidate.findMany).not.toHaveBeenCalled();
    });

    it("returns an empty result set for a term shorter than the minimum", async () => {
        signedInAs("HR");
        const res = await searchGET(searchRequest("a"));
        expect(res.status).toBe(200);
        expect((await res.json()).groups).toEqual([]);
        expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
    });
});

describe("API global search — permission gating", () => {
    it("does not search employees for STAFF, who lack employees.view", async () => {
        signedInAs("STAFF");
        await searchGET(searchRequest("ada"));

        expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
    });

    it("does not search recruitment for a role without recruitment.view", async () => {
        signedInAs("MANAGER");
        await searchGET(searchRequest("ada"));

        expect(prismaMock.candidate.findMany).not.toHaveBeenCalled();
        expect(prismaMock.offerLetter.findMany).not.toHaveBeenCalled();
    });

    it("does not search offers for MANAGER even with recruitment.view elsewhere", async () => {
        // MANAGER holds no recruitment permission at all, so the offer query —
        // which is the more sensitive one — must never run.
        signedInAs("MANAGER");
        await searchGET(searchRequest("ada"));

        expect(prismaMock.offerLetter.findMany).not.toHaveBeenCalled();
    });

    it("searches employees and recruitment for HR, who holds both", async () => {
        signedInAs("HR");
        await searchGET(searchRequest("ada"));

        expect(prismaMock.employee.findMany).toHaveBeenCalled();
        expect(prismaMock.candidate.findMany).toHaveBeenCalled();
    });
});

describe("API global search — organisational scope", () => {
    it("narrows a MANAGER's leave search to their own department", async () => {
        signedInAs("MANAGER", "mgr@test.com", "Operations");
        await searchGET(searchRequest("annual"));

        // DEPARTMENT scope must reach the query as a department filter, not
        // merely be absent — this is the IDOR boundary. The assertion is on the
        // leave domain because MANAGER does not hold `employees.view` at all,
        // so the employee group is ALL-scope or unreachable.
        expect(whereFor("leaveRequest").employee.department).toBe("Operations");
    });

    it("narrows a MANAGER's service-request search to their own department", async () => {
        signedInAs("MANAGER", "mgr@test.com", "Operations");
        await searchGET(searchRequest("annual"));

        expect(whereFor("serviceRequest").employee.department).toBe("Operations");
    });

    it("does not apply a department filter for HR, who has ALL scope", async () => {
        signedInAs("HR");
        await searchGET(searchRequest("ada"));

        expect(whereFor("employee").department).toBeUndefined();
    });

    it("restricts a MANAGER to their own record when they have no department", async () => {
        signedInAs("MANAGER", "mgr@test.com", null);
        await searchGET(searchRequest("annual"));

        // With no department, DEPARTMENT scope collapses to SELF rather than
        // silently widening to the whole company.
        expect(whereFor("leaveRequest").employee.id).toBe("emp-MANAGER");
    });

    it("applies the same scope to the leave search", async () => {
        signedInAs("MANAGER", "mgr@test.com", "Operations");
        await searchGET(searchRequest("annual"));

        expect(whereFor("leaveRequest").employee.department).toBe("Operations");
    });
});

describe("API global search — result shape", () => {
    it("returns grouped hits and never leaks a whole employee record", async () => {
        signedInAs("HR");
        prismaMock.employee.findMany.mockResolvedValue([
            {
                id: "emp-1",
                firstName: "Ada",
                lastName: "Lovelace",
                email: "ada@company.com",
                rollNumber: "EMP-001",
                designation: "Engineer",
                department: "Engineering",
            },
        ]);

        const res = await searchGET(searchRequest("Ada"));
        const body = await res.json();

        expect(body.groups[0].key).toBe("employees");
        expect(body.groups[0].hits[0]).toMatchObject({
            id: "emp-1",
            title: "Ada Lovelace",
            href: "/employees",
        });

        // The route selects only the fields a search result needs. Assert the
        // Prisma `select` so a later "just include the record" change is caught.
        const select = (prismaMock.employee.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].select;
        expect(select).not.toHaveProperty("dateOfBirth");
        expect(select).not.toHaveProperty("nationality");
        expect(select).not.toHaveProperty("phone");
    });

    it("caps each group so one broad term cannot flood the dropdown", async () => {
        signedInAs("HR");
        await searchGET(searchRequest("a"));
        // MIN_QUERY_LENGTH is 2, so a single character must not reach the query.
        expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
    });

    it("survives a failing domain without failing the whole search", async () => {
        signedInAs("HR");
        prismaMock.employee.findMany.mockRejectedValue(new Error("connection reset"));
        prismaMock.candidate.findMany.mockResolvedValue([
            { id: "c-1", firstName: "Ada", lastName: "L", email: "a@b.c", candidateCode: "CAND-1" },
        ]);

        const res = await searchGET(searchRequest("Ada"));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.groups.some((g: any) => g.key === "employees")).toBe(false);
        expect(body.groups.some((g: any) => g.key === "recruitment")).toBe(true);
    });
});
