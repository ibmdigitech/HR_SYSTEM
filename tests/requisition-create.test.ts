/**
 * Job requisition creation tests.
 *
 * The button on /recruitment was decorative and `JobRequisition` was read-only,
 * so the risk here is not "does the happy path work" — it is that a form is not
 * a security boundary. These tests therefore drive the SERVER ACTION with
 * hostile `FormData` and assert on the exact `where` / `data` the action sends
 * to Prisma, the way `tests/search-authorization.test.ts` does.
 *
 * What is pinned here:
 *
 *  - a valid payload writes a DRAFT requisition with a `REQ-<year>-0001` code,
 *    an approver-free status and `requestedById` taken from the session's
 *    employee — never from the request;
 *  - every rule the form enforces is ALSO enforced here, proven by the action
 *    refusing to reach Prisma at all;
 *  - the sequence is read from the highest existing code, and a P2002 collision
 *    is retried against a fresh read instead of surfacing as an error;
 *  - a role without `recruitment.create` is refused at the guard, before any
 *    query runs.
 *
 * Prisma and `auth()` are mocked, so these are DB-free.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------------- module mocks (must precede imports) ---------------- */

const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = { current: null as any };

    // One object serves as both the client and the transaction client, so the
    // `tx.*` calls inside `$transaction` are observable exactly like the
    // `prisma.*` calls outside it.
    const db: Record<string, any> = {
        user: { findUnique: vi.fn() },
        employee: { findUnique: vi.fn(), findMany: vi.fn() },
        jobRequisition: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
        auditLog: { create: vi.fn() },
        notification: { create: vi.fn() },
    };
    db.$transaction = vi.fn(async (arg: any) =>
        typeof arg === "function" ? arg(db) : Promise.all(arg)
    );
    return { prismaMock: db, sessionStub };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionStub.current) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    // Real action vocabulary, no database writes.
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent: vi.fn().mockResolvedValue(undefined) };
});

/* ---------------- imports under test ---------------- */

import { createJobRequisitionAction } from "@/app/lib/actions/requisition";
import { PERMISSIONS, resolvePermissions } from "@/lib/auth/permissions";
import { ROLES } from "@/lib/auth/roles";
import { REQUISITION_STATUS } from "@/lib/workflow/recruitment-machine";

/* ---------------- helpers ---------------- */

/**
 * The guard re-reads the User row from the database on every call rather than
 * trusting the JWT, so both the session and the row must be modelled.
 */
function signedInAs(role: string, employeeId: string | null = "emp-7") {
    const email = `${role.toLowerCase()}@test.com`;
    sessionStub.current = { user: { id: `u-${role}`, email, role } };
    prismaMock.user.findUnique.mockResolvedValue({
        id: `u-${role}`,
        email,
        role,
        employee: employeeId ? { id: employeeId, department: "Operations" } : null,
    });
}

/** A complete, valid submission. Every refusal test overrides one field. */
function validPayload(overrides: Record<string, string> = {}): FormData {
    const form = new FormData();
    const fields: Record<string, string> = {
        title: "Senior Finance Analyst",
        department: "Finance",
        branch: "",
        location: "Dubai HQ",
        employmentType: "FULL_TIME",
        positionsCount: "2",
        positionType: "NEW_POSITION",
        replacementEmployeeId: "",
        reason: "Approved headcount in the FY budget",
        requiredSkills: "Oracle Financials, FP&A",
        requiredExperience: "5+ years",
        requiredEducation: "Bachelor's degree",
        budget: "240000",
        minSalary: "18000",
        maxSalary: "24000",
        priority: "HIGH",
        targetJoiningDate: "2026-11-02",
    };
    for (const [key, value] of Object.entries({ ...fields, ...overrides })) {
        if (value !== "") form.set(key, value);
    }
    return form;
}

/** The single `jobRequisition.create` argument the action produced. */
function createdData(): Record<string, any> {
    expect(prismaMock.jobRequisition.create).toHaveBeenCalledTimes(1);
    return prismaMock.jobRequisition.create.mock.calls[0][0].data;
}

/** The `where` the action used to find the highest code for the year. */
function sequenceLookup() {
    expect(prismaMock.jobRequisition.findFirst).toHaveBeenCalled();
    return prismaMock.jobRequisition.findFirst.mock.calls[0][0];
}

/** A Prisma unique-constraint failure, as the driver reports it. */
function uniqueViolation() {
    const error = new Error("Unique constraint failed on the fields: (`requisitionCode`)");
    (error as unknown as { code: string }).code = "P2002";
    return error;
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStub.current = null;
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.jobRequisition.findFirst.mockResolvedValue(null);
    prismaMock.jobRequisition.create.mockResolvedValue({
        id: "req-1",
        requisitionCode: "REQ-2026-0001",
        status: REQUISITION_STATUS.DRAFT,
    });
    prismaMock.auditLog.create.mockResolvedValue({});
});

/* ------------------------------------------------------------------ */
/* The happy path                                                      */
/* ------------------------------------------------------------------ */

describe("a valid requisition is created as a draft", () => {
    it("writes the whole payload with a generated REQ-<year>-0001 code", async () => {
        signedInAs(ROLES.HR);
        const year = new Date().getFullYear();

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(true);
        expect(result.requisitionCode).toBe(`REQ-${year}-0001`);
        expect(result.message).toMatch(/draft/i);

        const data = createdData();
        expect(data).toMatchObject({
            requisitionCode: `REQ-${year}-0001`,
            title: "Senior Finance Analyst",
            department: "Finance",
            location: "Dubai HQ",
            employmentType: "FULL_TIME",
            positionsCount: 2,
            positionType: "NEW_POSITION",
            priority: "HIGH",
            minSalary: 18000,
            maxSalary: 24000,
            budget: 240000,
            reason: "Approved headcount in the FY budget",
            requiredSkills: "Oracle Financials, FP&A",
            requiredExperience: "5+ years",
            requiredEducation: "Bachelor's degree",
        });
        // Optional fields the form left blank are written as NULL, not "".
        expect(data.branch).toBeNull();
        expect(data.targetJoiningDate).toBeInstanceOf(Date);
    });

    it("starts at DRAFT and does not touch any approval field", async () => {
        // The approval chain is a deliberate walk. Creating a requisition must
        // not imply that anybody approved it.
        signedInAs(ROLES.HR);

        await createJobRequisitionAction(undefined, validPayload());

        const data = createdData();
        expect(data.status).toBe(REQUISITION_STATUS.DRAFT);
        for (const field of [
            "managerApprovedById",
            "managerApprovedAt",
            "hrApprovedById",
            "hrApprovedAt",
            "financeApprovedById",
            "financeApprovedAt",
            "approvedAt",
        ]) {
            expect(data).not.toHaveProperty(field);
        }
    });

    it("takes requestedById from the session, never from the request", async () => {
        signedInAs(ROLES.HR, "emp-42");
        // A crafted request trying to file the requisition under someone else.
        const form = validPayload({ requestedById: "emp-attacker" });

        await createJobRequisitionAction(undefined, form);

        expect(createdData().requestedById).toBe("emp-42");
    });

    it("records the creation in the audit log inside the same transaction", async () => {
        signedInAs(ROLES.HR, "emp-7");

        await createJobRequisitionAction(undefined, validPayload());

        expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
        const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
        expect(audit.employeeId).toBe("emp-7");
        expect(audit.action).toBe("REQUISITION_CREATED");
        expect(audit.details).toMatch(/REQ-\d{4}-0001/);
    });

    it("clears the replaced employee on a NEW_POSITION", async () => {
        signedInAs(ROLES.HR);
        // A stale value left in the DOM from a previous choice must not persist.
        const form = validPayload({ positionType: "NEW_POSITION", replacementEmployeeId: "emp-99" });

        await createJobRequisitionAction(undefined, form);

        expect(createdData().replacementEmployeeId).toBeNull();
    });

    it("keeps the replaced employee on a REPLACEMENT", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ positionType: "REPLACEMENT", replacementEmployeeId: "emp-99" })
        );

        expect(result.success).toBe(true);
        expect(createdData()).toMatchObject({
            positionType: "REPLACEMENT",
            replacementEmployeeId: "emp-99",
        });
    });

    it("refuses when the account has no employee profile to attribute it to", async () => {
        signedInAs(ROLES.HR, null);

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/employee profile/i);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------ */
/* Server-side validation — the action refuses, not just the form     */
/* ------------------------------------------------------------------ */

describe("the action refuses an invalid payload before touching the database", () => {
    it("refuses a missing title", async () => {
        signedInAs(ROLES.HR);
        const form = validPayload();
        form.delete("title");

        const result = await createJobRequisitionAction(undefined, form);

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.title).toMatch(/required/i);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a blank title that only looks filled to the database", async () => {
        signedInAs(ROLES.HR);
        const form = validPayload({ title: "   " });

        const result = await createJobRequisitionAction(undefined, form);

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.title).toBeTruthy();
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a missing department", async () => {
        signedInAs(ROLES.HR);
        const form = validPayload();
        form.delete("department");

        const result = await createJobRequisitionAction(undefined, form);

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.department).toMatch(/required/i);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a missing headcount rather than assuming one position", async () => {
        // The column defaults to 1, but a silent default would turn a dropped
        // field into a one-person requisition nobody asked for.
        signedInAs(ROLES.HR);
        const form = validPayload();
        form.delete("positionsCount");

        const result = await createJobRequisitionAction(undefined, form);

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.positionsCount).toBeTruthy();
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses zero positions", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ positionsCount: "0" })
        );

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.positionsCount).toMatch(/at least one/i);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a negative headcount", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ positionsCount: "-3" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a fractional headcount", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ positionsCount: "2.5" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses an absurd headcount", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ positionsCount: "100000" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a minimum salary above the maximum", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ minSalary: "24000", maxSalary: "18000" })
        );

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.minSalary).toMatch(/minimum salary/i);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a half-specified salary range", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ minSalary: "18000", maxSalary: "" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a half-specified salary range in the other direction", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ minSalary: "", maxSalary: "24000" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("accepts a wholly blank salary range", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ minSalary: "", maxSalary: "", budget: "" })
        );

        expect(result.success).toBe(true);
        const data = createdData();
        expect(data.minSalary).toBeNull();
        expect(data.maxSalary).toBeNull();
    });

    it("refuses a REPLACEMENT with no employee to replace", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ positionType: "REPLACEMENT", replacementEmployeeId: "" })
        );

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.replacementEmployeeId).toBeTruthy();
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses an unknown priority", async () => {
        // `priority` is a free-text String column. This is the only thing
        // standing between a typo and a requisition no filter can ever match.
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ priority: "TREASURER" })
        );

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.priority).toBeTruthy();
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses an unknown position type", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ positionType: "TEMPORARY" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses an unknown employment type", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ employmentType: "GIG" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses an unparseable target date", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ targetJoiningDate: "next tuesday" })
        );

        expect(result.success).toBe(false);
        expect(result.fieldErrors?.targetJoiningDate).toBeTruthy();
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a negative salary", async () => {
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({ minSalary: "-1", maxSalary: "24000" })
        );

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("cannot be told to write an approving status", async () => {
        // `status` is not accepted from the request at all. Even a request that
        // names APPROVED, SUBMITTED or the approval timestamps creates a draft.
        signedInAs(ROLES.HR);

        const result = await createJobRequisitionAction(
            undefined,
            validPayload({
                status: "APPROVED",
                hrApprovedById: "emp-1",
                hrApprovedAt: "2026-01-01",
            })
        );

        expect(result.success).toBe(true);
        const data = createdData();
        expect(data.status).toBe(REQUISITION_STATUS.DRAFT);
        expect(data).not.toHaveProperty("hrApprovedById");
        expect(data).not.toHaveProperty("hrApprovedAt");
    });
});

/* ------------------------------------------------------------------ */
/* The requisition code                                                */
/* ------------------------------------------------------------------ */

describe("requisition code allocation", () => {
    it("starts at 0001 for a year with no requisitions", async () => {
        signedInAs(ROLES.HR);
        prismaMock.jobRequisition.findFirst.mockResolvedValue(null);
        const year = new Date().getFullYear();

        await createJobRequisitionAction(undefined, validPayload());

        expect(createdData().requisitionCode).toBe(`REQ-${year}-0001`);
    });

    it("continues from the highest existing code for the year, not from a count", async () => {
        // A count would be fooled by a deleted requisition; reading the maximum
        // is monotonic, which is what the approvals screen needs.
        signedInAs(ROLES.HR);
        const year = new Date().getFullYear();
        prismaMock.jobRequisition.findFirst.mockResolvedValue({
            requisitionCode: `REQ-${year}-0007`,
        });

        await createJobRequisitionAction(undefined, validPayload());

        expect(createdData().requisitionCode).toBe(`REQ-${year}-0008`);
    });

    it("scopes the lookup to the current year so last year's tail cannot win", async () => {
        signedInAs(ROLES.HR);
        const year = new Date().getFullYear();

        await createJobRequisitionAction(undefined, validPayload());

        const lookup = sequenceLookup();
        expect(lookup.where.requisitionCode).toEqual({ startsWith: `REQ-${year}-` });
        expect(lookup.orderBy).toEqual({ requisitionCode: "desc" });
    });

    it("retries a unique-code collision instead of surfacing the error", async () => {
        // Two HR users read the same highest code in the same millisecond. The
        // loser gets P2002; the whole transaction rolls back and the next
        // attempt re-reads a code the winner has committed.
        signedInAs(ROLES.HR);
        const year = new Date().getFullYear();
        prismaMock.jobRequisition.findFirst
            .mockResolvedValueOnce({ requisitionCode: `REQ-${year}-0001` })
            .mockResolvedValueOnce({ requisitionCode: `REQ-${year}-0002` });
        prismaMock.jobRequisition.create
            .mockRejectedValueOnce(uniqueViolation())
            .mockResolvedValueOnce({ id: "req-2", requisitionCode: `REQ-${year}-0002`, status: "DRAFT" });

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(true);
        expect(result.requisitionCode).toBe(`REQ-${year}-0002`);
        expect(prismaMock.jobRequisition.create).toHaveBeenCalledTimes(2);
        expect(prismaMock.jobRequisition.findFirst).toHaveBeenCalledTimes(2);
        // The rolled-back attempt must not leave an audit row behind.
        expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it("stops after repeated collisions and reports that nothing changed", async () => {
        signedInAs(ROLES.HR);
        prismaMock.jobRequisition.create.mockRejectedValue(uniqueViolation());

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/nothing was changed/i);
        // Bounded, not an unbounded spin.
        expect(prismaMock.jobRequisition.create).toHaveBeenCalledTimes(5);
    });

    it("does not retry a failure that is not a unique violation", async () => {
        signedInAs(ROLES.HR);
        prismaMock.jobRequisition.create.mockRejectedValue(new Error("connection reset"));

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).toHaveBeenCalledTimes(1);
    });
});

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

describe("a role without recruitment.create is refused", () => {
    it("holds no recruitment.create capability in the grant table", () => {
        // The refusal below is only meaningful because STAFF, MANAGER and
        // FINANCE genuinely lack the grant.
        for (const role of [ROLES.STAFF, ROLES.MANAGER, ROLES.FINANCE]) {
            expect(resolvePermissions(role).permissions.has(PERMISSIONS.RECRUITMENT_CREATE)).toBe(false);
        }
        expect(resolvePermissions(ROLES.HR).permissions.has(PERMISSIONS.RECRUITMENT_CREATE)).toBe(true);
    });

    it("refuses a MANAGER before any query runs", async () => {
        // A MANAGER can open /recruitment, so this is the exact case the button
        // is reachable for and the action is not.
        signedInAs(ROLES.MANAGER);

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/recruitment\.create/i);
        expect(prismaMock.jobRequisition.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses a STAFF member", async () => {
        signedInAs(ROLES.STAFF);

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(false);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("refuses an unauthenticated caller", async () => {
        sessionStub.current = null;

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/not signed in/i);
        expect(prismaMock.jobRequisition.create).not.toHaveBeenCalled();
    });

    it("allows an ADMIN as well as HR", async () => {
        signedInAs(ROLES.ADMIN);

        const result = await createJobRequisitionAction(undefined, validPayload());

        expect(result.success).toBe(true);
    });
});
