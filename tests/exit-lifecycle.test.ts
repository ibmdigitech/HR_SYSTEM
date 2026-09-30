/**
 * Exit lifecycle tests.
 *
 * Four things are proven here, in the order the brief asks for them:
 *
 *  1. The legal transitions succeed — the whole REQUESTED → COMPLETED walk.
 *  2. Illegal transitions are refused by `assertTransition`, including the
 *     terminal states and a role the map does not list.
 *  3. A stale-status `updateMany` affects zero rows and the action aborts
 *     without writing anything else. This is the double-click guarantee, and it
 *     is asserted on the `where` clause the action actually builds.
 *  4. A role without `exit.clearance` is refused, and the refusal happens at the
 *     guard before any write is attempted.
 *
 * Prisma and `auth()` are mocked, so these are DB-free and cannot disturb the
 * live HR data. The `updateMany` behaviour asserted here is the same contract
 * Prisma gives against a real database: zero rows matched means the guarded
 * write did not happen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ---------------- module mocks (must precede imports) ---------------- */

const { prismaMock, sessionStub } = vi.hoisted(() => {
    const sessionStub = { current: null as { user: { id: string; email: string; role: string } } | null };

    // One object serves as both the client and the transaction client, so the
    // `tx.*` calls inside `$transaction` are observable exactly like the
    // `prisma.*` calls outside it.
    const db: Record<string, any> = {
        user: { findUnique: vi.fn() },
        employee: { findUnique: vi.fn(), findMany: vi.fn() },
        exitCase: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            create: vi.fn(),
            updateMany: vi.fn(),
        },
        exitInterview: { create: vi.fn() },
        rehireRecord: { upsert: vi.fn() },
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

import {
    EXIT_STATUS,
    EXIT_TYPE,
    EXIT_TRANSITIONS,
    REHIRE_ELIGIBILITY_STATES,
    EXIT_POLICY,
    isExitPolicyConfigured,
    resolveNoticePeriodDays,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/exit/state-machine";
import { nextStates } from "@/lib/workflow/state-machine";
import { ROLES } from "@/lib/auth/roles";
import { PERMISSIONS, resolvePermissions } from "@/lib/auth/permissions";
import {
    approveExitCase,
    recordExitInterview,
    recordRehireEligibility,
    rejectExitCase,
} from "@/app/lib/actions/exit";

const as = (role: string) => ({ actorRole: role, actorId: "u1" });

/**
 * The guard re-reads the User row from the database on every call rather than
 * trusting the JWT, so both the session and the database row must be modelled.
 */
function signedInAs(role: string, employeeId: string | null = null) {
    const email = `${role.toLowerCase()}@test.com`;
    sessionStub.current = { user: { id: `u-${role}`, email, role } };
    prismaMock.user.findUnique.mockResolvedValue({
        id: `u-${role}`,
        email,
        role,
        employee: employeeId ? { id: employeeId, department: "Operations" } : null,
    });
}

/** An exit case as the action would read it, at the given status. */
function exitCaseAt(status: string, extra: Record<string, unknown> = {}) {
    return {
        id: "exit-1",
        employeeId: "emp-1",
        type: EXIT_TYPE.RESIGNATION,
        status,
        decisionNote: null,
        interview: null,
        employee: { firstName: "Amina", lastName: "Rashid" },
        ...extra,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStub.current = null;
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.notification.create.mockResolvedValue({ id: "n1" });
    prismaMock.exitCase.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.exitCase.create.mockResolvedValue({ id: "exit-1", status: EXIT_STATUS.REQUESTED });
    prismaMock.exitInterview.create.mockResolvedValue({ id: "int-1" });
    prismaMock.rehireRecord.upsert.mockResolvedValue({ id: "rehire-1" });
});

/* ------------------------------------------------------------------ */
/* 1. Legal transitions                                                */
/* ------------------------------------------------------------------ */

describe("exit state machine — legal transitions", () => {
    const happyPath = [
        EXIT_STATUS.REQUESTED,
        EXIT_STATUS.PENDING_APPROVAL,
        EXIT_STATUS.APPROVED,
        EXIT_STATUS.NOTICE_PERIOD,
        EXIT_STATUS.INTERVIEW_PENDING,
        EXIT_STATUS.INTERVIEW_COMPLETED,
        EXIT_STATUS.CLEARANCE_PENDING,
        EXIT_STATUS.SETTLEMENT_PENDING,
        EXIT_STATUS.COMPLETED,
    ];

    it("walks the full REQUESTED → COMPLETED lifecycle as HR/ADMIN", () => {
        for (let i = 0; i < happyPath.length - 1; i++) {
            // The interview step is ADMIN-only (EXIT_INTERVIEW grant) and the
            // final COMPLETED step is ADMIN-only (EXIT_COMPLETE grant); the rest
            // of the lifecycle is HR-and-above. This mirrors permissions.ts.
            const from = happyPath[i];
            const actor =
                from === EXIT_STATUS.INTERVIEW_PENDING || from === EXIT_STATUS.SETTLEMENT_PENDING
                    ? "ADMIN"
                    : "HR";
            expect(() =>
                assertTransition("EXIT", EXIT_TRANSITIONS, happyPath[i], happyPath[i + 1], as(actor))
            ).not.toThrow();
        }
    });

    it("allows a manager to route a case for approval but not to decide it", () => {
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, EXIT_STATUS.REQUESTED, EXIT_STATUS.PENDING_APPROVAL, as("MANAGER"))
        ).not.toThrow();
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, EXIT_STATUS.PENDING_APPROVAL, EXIT_STATUS.APPROVED, as("MANAGER"))
        ).toThrow(InvalidTransitionError);
    });

    it("allows a withdrawal after approval and cancellation before settlement", () => {
        expect(nextStates(EXIT_TRANSITIONS, EXIT_STATUS.APPROVED)).toContain(EXIT_STATUS.WITHDRAWN);
        expect(nextStates(EXIT_TRANSITIONS, EXIT_STATUS.NOTICE_PERIOD)).toContain(EXIT_STATUS.WITHDRAWN);
        expect(nextStates(EXIT_TRANSITIONS, EXIT_STATUS.CLEARANCE_PENDING)).toContain(EXIT_STATUS.CANCELLED);
    });

    it("restricts completion to ADMIN and above", () => {
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, EXIT_STATUS.SETTLEMENT_PENDING, EXIT_STATUS.COMPLETED, as("HR"))
        ).toThrow(InvalidTransitionError);
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, EXIT_STATUS.SETTLEMENT_PENDING, EXIT_STATUS.COMPLETED, as("ADMIN"))
        ).not.toThrow();
    });

    it("allows rehire assessment only after the case has been approved", () => {
        expect(REHIRE_ELIGIBILITY_STATES).not.toContain(EXIT_STATUS.REQUESTED);
        expect(REHIRE_ELIGIBILITY_STATES).not.toContain(EXIT_STATUS.PENDING_APPROVAL);
        expect(REHIRE_ELIGIBILITY_STATES).not.toContain(EXIT_STATUS.REJECTED);
        expect(REHIRE_ELIGIBILITY_STATES).toContain(EXIT_STATUS.COMPLETED);
    });
});

/* ------------------------------------------------------------------ */
/* 2. Illegal transitions                                              */
/* ------------------------------------------------------------------ */

describe("exit state machine — illegal transitions are refused", () => {
    it("rejects an unknown current state rather than defaulting to permissive", () => {
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, "NOT_A_STATE", EXIT_STATUS.APPROVED, as("ADMIN"))
        ).toThrow(InvalidTransitionError);
    });

    it("refuses to skip from REQUESTED straight to APPROVED", () => {
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, EXIT_STATUS.REQUESTED, EXIT_STATUS.APPROVED, as("ADMIN"))
        ).toThrow(InvalidTransitionError);
    });

    it("refuses to skip the interview by going straight to clearance", () => {
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, EXIT_STATUS.NOTICE_PERIOD, EXIT_STATUS.CLEARANCE_PENDING, as("ADMIN"))
        ).toThrow(InvalidTransitionError);
    });

    it("refuses a STAFF member at every stage", () => {
        for (const from of [EXIT_STATUS.REQUESTED, EXIT_STATUS.PENDING_APPROVAL, EXIT_STATUS.APPROVED]) {
            for (const to of nextStates(EXIT_TRANSITIONS, from)) {
                expect(() => assertTransition("EXIT", EXIT_TRANSITIONS, from, to, as("STAFF"))).toThrow();
            }
        }
    });

    it("makes REJECTED, WITHDRAWN, COMPLETED and CANCELLED terminal", () => {
        for (const terminal of [
            EXIT_STATUS.REJECTED,
            EXIT_STATUS.WITHDRAWN,
            EXIT_STATUS.COMPLETED,
            EXIT_STATUS.CANCELLED,
        ]) {
            expect(nextStates(EXIT_TRANSITIONS, terminal)).toHaveLength(0);
        }
    });

    it("refuses to re-approve an already-approved case (double approval)", () => {
        expect(() =>
            assertTransition("EXIT", EXIT_TRANSITIONS, EXIT_STATUS.APPROVED, EXIT_STATUS.APPROVED, as("HR"))
        ).toThrow(InvalidTransitionError);
    });
});

/* ------------------------------------------------------------------ */
/* 3. Stale-status updateMany — the double-click guarantee              */
/* ------------------------------------------------------------------ */

describe("stale-status updateMany aborts the transaction", () => {
    it("pins the status in the where clause so a second decision matches nothing", async () => {
        signedInAs(ROLES.HR, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.PENDING_APPROVAL));
        // The concurrent writer has already moved the case on.
        prismaMock.exitCase.updateMany.mockResolvedValue({ count: 0 });

        const result = await approveExitCase("exit-1", { decisionNote: "Approved." });

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/changed a moment ago/i);

        const guarded = prismaMock.exitCase.updateMany.mock.calls[0][0];
        expect(guarded.where).toEqual({ id: "exit-1", status: EXIT_STATUS.PENDING_APPROVAL });
        expect(guarded.data.status).toBe(EXIT_STATUS.APPROVED);
    });

    it("writes no audit row when the guarded update matched zero rows", async () => {
        signedInAs(ROLES.HR, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.PENDING_APPROVAL));
        prismaMock.exitCase.updateMany.mockResolvedValue({ count: 0 });

        await approveExitCase("exit-1");

        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("aborts before inserting an interview when the status moved", async () => {
        signedInAs(ROLES.ADMIN, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.INTERVIEW_PENDING));
        prismaMock.exitCase.updateMany.mockResolvedValue({ count: 0 });

        const result = await recordExitInterview({ exitCaseId: "exit-1", wouldRejoin: true });

        expect(result.success).toBe(false);
        // The interview row is never created on a failed guard.
        expect(prismaMock.exitInterview.create).not.toHaveBeenCalled();
    });

    it("aborts a rejection on a stale status the same way", async () => {
        signedInAs(ROLES.HR, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.PENDING_APPROVAL));
        prismaMock.exitCase.updateMany.mockResolvedValue({ count: 0 });

        const result = await rejectExitCase("exit-1", { decisionNote: "Not accepted." });

        expect(result.success).toBe(false);
        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("still writes everything when the guarded update matches exactly one row", async () => {
        signedInAs(ROLES.HR, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.PENDING_APPROVAL));
        prismaMock.exitCase.updateMany.mockResolvedValue({ count: 1 });

        const result = await approveExitCase("exit-1", { decisionNote: "Approved." });

        expect(result.success).toBe(true);
        expect(result.status).toBe(EXIT_STATUS.APPROVED);
        expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    });
});

/* ------------------------------------------------------------------ */
/* 4. Permission enforcement                                           */
/* ------------------------------------------------------------------ */

describe("a role without the required permission is refused", () => {
    it("FINANCE holds exit.settlement but NOT exit.clearance", () => {
        // The capability set is granular, which is the point of the refusal
        // below: settlement and clearance are separate grants.
        const { permissions } = resolvePermissions(ROLES.FINANCE);
        expect(permissions.has(PERMISSIONS.EXIT_SETTLEMENT)).toBe(true);
        expect(permissions.has(PERMISSIONS.EXIT_CLEARANCE)).toBe(false);
    });

    it("refuses a FINANCE rehire assessment before any write is attempted", async () => {
        signedInAs(ROLES.FINANCE, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.APPROVED));

        const result = await recordRehireEligibility({ exitCaseId: "exit-1", eligible: true });

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/exit\.clearance/i);
        // The guard runs first: nothing was read for update and nothing written.
        expect(prismaMock.rehireRecord.upsert).not.toHaveBeenCalled();
        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("refuses a MANAGER approving an exit case", async () => {
        signedInAs(ROLES.MANAGER, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.PENDING_APPROVAL));

        const result = await approveExitCase("exit-1");

        expect(result.success).toBe(false);
        expect(prismaMock.exitCase.updateMany).not.toHaveBeenCalled();
    });

    it("refuses HR recording an exit interview, which the grant table gives to ADMIN only", async () => {
        // The state machine and the RBAC table agree: HR cannot conduct an exit
        // interview here, and neither layer pretends otherwise.
        const { permissions } = resolvePermissions(ROLES.HR);
        expect(permissions.has(PERMISSIONS.EXIT_INTERVIEW)).toBe(false);

        signedInAs(ROLES.HR, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.INTERVIEW_PENDING));

        const result = await recordExitInterview({ exitCaseId: "exit-1", rating: 4 });

        expect(result.success).toBe(false);
        expect(prismaMock.exitInterview.create).not.toHaveBeenCalled();
    });

    it("refuses an unauthenticated caller", async () => {
        sessionStub.current = null;
        const result = await approveExitCase("exit-1");
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/not signed in/i);
    });

    it("refuses a rejection with no recorded reason", async () => {
        signedInAs(ROLES.HR, "emp-9");
        prismaMock.exitCase.findUnique.mockResolvedValue(exitCaseAt(EXIT_STATUS.PENDING_APPROVAL));

        const result = await rejectExitCase("exit-1", { decisionNote: "   " });

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/must record why/i);
        expect(prismaMock.exitCase.updateMany).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------ */
/* Policy is stored as an input, not computed                          */
/* ------------------------------------------------------------------ */

describe("exit policy ships unconfigured rather than guessed", () => {
    it("has no notice period and no gratuity rule baked in", () => {
        expect(EXIT_POLICY.noticePeriodDaysByExitType).toBeNull();
        expect(EXIT_POLICY.endOfServiceGratuity).toBeNull();
        expect(isExitPolicyConfigured()).toBe(false);
    });

    it("returns null rather than a default for every exit type", () => {
        for (const type of [EXIT_TYPE.RESIGNATION, EXIT_TYPE.TERMINATION, EXIT_TYPE.END_OF_CONTRACT]) {
            expect(resolveNoticePeriodDays(type)).toBeNull();
        }
    });
});
