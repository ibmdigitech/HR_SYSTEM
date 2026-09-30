/**
 * Interview feedback submission tests (brief §10/§11).
 *
 * Regression cover for "COULD NOT SAVE THE FEED OF INTERVIEW".
 *
 * The save itself was never the problem: `interviewFeedback.upsert` committed
 * fine. The `auditLog.create` that ran immediately after it passed
 * `employeeId: "SYSTEM"`, and `AuditLog.employeeId` is a real foreign key to
 * `Employee`, so Postgres rejected it with P2003. The throw was swallowed by
 * the function's own catch and reported back as `success: false, "Could not
 * save the feedback."` — a submission that had landed on disk, reported to the
 * interviewer as a failure, every time, with no audit row to show for it.
 *
 * So these tests drive the SERVER ACTION with hostile and well-formed
 * FormData, the way `tests/requisition-create.test.ts` does, and pin:
 *
 *  - the audit entry is attributed to the INTERVIEWER's employee id, a row
 *    that exists, rather than a sentinel that violates the foreign key;
 *  - the feedback row and its audit entry commit together, so a saved
 *    submission can never be reported as unsaved;
 *  - the panel-membership and 1–5 score rules are unchanged, and are proven
 *    here by the action refusing to reach Prisma at all.
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
        interviewParticipant: { findUnique: vi.fn() },
        interviewFeedback: { upsert: vi.fn() },
        auditLog: { create: vi.fn() },
    };
    db.$transaction = vi.fn(async (arg: any) =>
        typeof arg === "function" ? arg(db) : Promise.all(arg)
    );
    return { prismaMock: db, sessionStub };
});

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => sessionStub.current) }));
vi.mock("@/lib/auth/audit", async (importOriginal) => {
    // Real action vocabulary, no database writes.
    const actual = await importOriginal<typeof import("@/lib/auth/audit")>();
    return { ...actual, logSecurityEvent: vi.fn().mockResolvedValue(undefined) };
});

/* ---------------- imports under test ---------------- */

import { submitFeedback } from "@/app/lib/actions/recruitment";
import { PERMISSIONS, resolvePermissions } from "@/lib/auth/permissions";
import { ROLES } from "@/lib/auth/roles";

/* ---------------- fixtures ---------------- */

const INTERVIEW_ID = "int-1";
const PANEL_MEMBER_EMPLOYEE = "emp-panel";
/** The Employee the viewer is logged in as — a different person entirely. */
const VIEWER_EMPLOYEE = "emp-viewer";

/**
 * The guard re-reads the User row from the database on every call rather than
 * trusting the JWT, so both the session and the row must be modelled.
 */
function signedInAs(role: string, employeeId: string | null = VIEWER_EMPLOYEE) {
    const email = `${role.toLowerCase()}@test.com`;
    sessionStub.current = { user: { id: `u-${role}`, email, role } };
    prismaMock.user.findUnique.mockResolvedValue({
        id: `u-${role}`,
        email,
        role,
        employee: employeeId ? { id: employeeId, department: "Operations" } : null,
    });
}

/**
 * A panel row, as `interviewParticipant.findUnique` returns it. The
 * `interviewerId` is the Employee the feedback belongs to, and is what the
 * audit entry must be filed under.
 */
function panelMember(overrides: Record<string, unknown> = {}) {
    return {
        id: "part-1",
        interviewerId: PANEL_MEMBER_EMPLOYEE,
        interviewerName: "Panel Member",
        interviewId: INTERVIEW_ID,
        feedback: [],
        ...overrides,
    };
}

/** A complete, valid submission — the same keys FeedbackForm puts in FormData. */
function validPayload(overrides: Record<string, string> = {}): FormData {
    const form = new FormData();
    const fields: Record<string, string> = {
        interviewId: INTERVIEW_ID,
        participantId: "part-1",
        technicalSkills: "5",
        problemSolving: "4",
        domainKnowledge: "3",
        communication: "5",
        teamFit: "4",
        leadership: "3",
        overall: "4",
        strengths: "Strong system design.",
        concerns: "Limited exposure to our stack.",
        comments: "Would join a second round.",
        recommendation: "HIRE",
    };
    for (const [key, value] of Object.entries({ ...fields, ...overrides })) {
        if (value !== "") form.set(key, value);
    }
    return form;
}

/** The `where` the action used to find the participant it is submitting for. */
function participantLookup() {
    expect(prismaMock.interviewParticipant.findUnique).toHaveBeenCalled();
    return prismaMock.interviewParticipant.findUnique.mock.calls[0][0];
}

/** The single `interviewFeedback.upsert` argument the action produced. */
function upsertArgs() {
    expect(prismaMock.interviewFeedback.upsert).toHaveBeenCalledTimes(1);
    return prismaMock.interviewFeedback.upsert.mock.calls[0][0];
}

/** The single `auditLog.create` argument the action produced. */
function auditArgs() {
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    return prismaMock.auditLog.create.mock.calls[0][0].data;
}

/** What the driver reports for a foreign-key violation. */
function foreignKeyViolation() {
    const error = new Error(
        "Foreign key constraint violated on the constraint: `AuditLog_employeeId_fkey`"
    );
    (error as unknown as { code: string }).code = "P2003";
    return error;
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStub.current = null;
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.interviewParticipant.findUnique.mockResolvedValue(panelMember());
    prismaMock.interviewFeedback.upsert.mockResolvedValue({ id: "fb-1" });
    prismaMock.auditLog.create.mockResolvedValue({});
});

/* ------------------------------------------------------------------ */
/* The reported bug: the audit entry, not the feedback row            */
/* ------------------------------------------------------------------ */

describe("the save reports success and files a usable audit entry", () => {
    it("files the audit entry under the interviewer's real Employee id", async () => {
        // THE REGRESSION. `employeeId: "SYSTEM"` is not a real row, so this
        // insert raised P2003 every time and the whole submission was reported
        // to the interviewer as a failure.
        signedInAs(ROLES.ADMIN);

        const result = await submitFeedback(null, validPayload());

        expect(result.success).toBe(true);
        expect(auditArgs().employeeId).toBe(PANEL_MEMBER_EMPLOYEE);
        expect(auditArgs().employeeId).not.toBe("SYSTEM");
    });

    it("records the action, the interviewer's name and the actor who pressed save", async () => {
        // `changedBy` is the human account; `employeeId` is the subject. Keeping
        // the two distinct is what makes the trail readable.
        signedInAs(ROLES.ADMIN);

        await submitFeedback(null, validPayload());

        const audit = auditArgs();
        expect(audit.action).toBe("INTERVIEW_FEEDBACK_SUBMITTED");
        expect(audit.details).toContain("Panel Member");
        expect(audit.details).toContain("HIRE");
        expect(audit.changedBy).toBe("admin@test.com");
    });

    it("commits the feedback and its audit entry in one transaction", async () => {
        // Two independent writes meant a failure in the audit insert surfaced
        // as "Could not save the feedback." for a row that had already been
        // persisted — the exact false negative the report describes.
        signedInAs(ROLES.ADMIN);

        const result = await submitFeedback(null, validPayload());

        expect(result.success).toBe(true);
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(auditArgs().action).toBe("INTERVIEW_FEEDBACK_SUBMITTED");
    });

    it("does not report success when the whole thing rolls back", async () => {
        // The transaction is a guard, not a licence to lie: if neither the
        // feedback nor the audit entry survives, the action must still fail.
        signedInAs(ROLES.ADMIN);
        prismaMock.auditLog.create.mockRejectedValue(foreignKeyViolation());

        const result = await submitFeedback(null, validPayload());

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/could not save/i);
    });
});

/* ------------------------------------------------------------------ */
/* The feedback row itself                                            */
/* ------------------------------------------------------------------ */

describe("the feedback row is written per interviewer", () => {
    it("keys the upsert on participantId, so one panel member cannot touch another's", async () => {
        // §10/§11 isolation. `@@unique([participantId])` is what makes a second
        // submission an UPDATE of this interviewer's own row.
        signedInAs(ROLES.ADMIN);

        await submitFeedback(null, validPayload());

        const args = upsertArgs();
        expect(args.where).toEqual({ participantId: "part-1" });
        expect(args.create).toMatchObject({
            interviewId: INTERVIEW_ID,
            participantId: "part-1",
            technicalSkills: 5,
            problemSolving: 4,
            domainKnowledge: 3,
            communication: 5,
            teamFit: 4,
            leadership: 3,
            overall: 4,
            recommendation: "HIRE",
        });
    });

    it("carries every dimension the form collects", async () => {
        // A silently dropped key here is the kind of bug that only shows up
        // weeks later as "the panel scores are wrong".
        signedInAs(ROLES.ADMIN);

        await submitFeedback(null, validPayload());

        for (const key of [
            "technicalSkills",
            "problemSolving",
            "domainKnowledge",
            "communication",
            "teamFit",
            "leadership",
            "overall",
        ]) {
            expect(upsertArgs().create).toHaveProperty(key);
        }
    });

    it("rewrites the same row, and only that row, on a second submission", async () => {
        // `update` must not re-send the interview or the participant: the row
        // is already keyed by both and overwriting them would move feedback
        // between interviews.
        signedInAs(ROLES.ADMIN);

        await submitFeedback(null, validPayload({ overall: "2", recommendation: "NO_HIRE" }));

        const args = upsertArgs();
        expect(args.update).toMatchObject({ overall: 2, recommendation: "NO_HIRE" });
        expect(args.update).not.toHaveProperty("interviewId");
        expect(args.update).not.toHaveProperty("participantId");
    });

    it("writes blank optional text as NULL, not an empty string", async () => {
        signedInAs(ROLES.ADMIN);

        await submitFeedback(null, validPayload({ strengths: "", concerns: "", comments: "" }));

        const create = upsertArgs().create;
        expect(create.strengths).toBeNull();
        expect(create.concerns).toBeNull();
        expect(create.comments).toBeNull();
    });
});

/* ------------------------------------------------------------------ */
/* The security model — unchanged, and proven by refusing to write    */
/* ------------------------------------------------------------------ */

describe("the panel-membership check still holds", () => {
    it("refuses a participant that does not exist", async () => {
        signedInAs(ROLES.ADMIN);
        prismaMock.interviewParticipant.findUnique.mockResolvedValue(null);

        const result = await submitFeedback(null, validPayload());

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/not found/i);
        expect(prismaMock.interviewFeedback.upsert).not.toHaveBeenCalled();
    });

    it("refuses a participant who is not on THIS interview", async () => {
        // The page hands the client an id, so the action cannot trust it.
        signedInAs(ROLES.ADMIN);

        const result = await submitFeedback(
            null,
            validPayload({ interviewId: "int-other" })
        );

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/not on this interview/i);
        expect(prismaMock.interviewFeedback.upsert).not.toHaveBeenCalled();
    });

    it("looks the participant up by the id in the request, nothing else", async () => {
        // The scope of the lookup is the whole check: a lookup that accepted a
        // second filter would quietly widen what the action is willing to read.
        signedInAs(ROLES.ADMIN);

        await submitFeedback(null, validPayload());

        expect(participantLookup().where).toEqual({ id: "part-1" });
    });

    it("lets HR submit for a panel member who is not them, and still files it under the interviewer", async () => {
        // HR/ADMIN are the deliberate exception: a coordinator may have to
        // record a round themselves when a panel member no-shows. The audit
        // entry follows the FEEDBACK, not the actor — filing it under the HR
        // user would put a panel member's score on the wrong employee's trail.
        signedInAs(ROLES.HR, VIEWER_EMPLOYEE);

        const result = await submitFeedback(null, validPayload());

        expect(result.success).toBe(true);
        expect(auditArgs().employeeId).toBe(PANEL_MEMBER_EMPLOYEE);
        expect(auditArgs().employeeId).not.toBe(VIEWER_EMPLOYEE);
        expect(auditArgs().changedBy).toBe("hr@test.com");
    });

    it("never uses the signed-in user id as the audit subject", async () => {
        // Regression guard on the fix itself: the tempting one-line repair for a
        // foreign-key failure is `employeeId: user.employeeId`, which type-checks
        // and silently re-attributes every panel member's feedback to whoever
        // happened to press the button.
        signedInAs(ROLES.ADMIN, VIEWER_EMPLOYEE);

        await submitFeedback(null, validPayload());

        expect(auditArgs().employeeId).not.toBe(VIEWER_EMPLOYEE);
        expect(auditArgs().employeeId).toBe(PANEL_MEMBER_EMPLOYEE);
    });
});

/* ------------------------------------------------------------------ */
/* Score and recommendation validation — unchanged                      */
/* ------------------------------------------------------------------ */

describe("scores are validated, not clamped", () => {
    it("holds no recruitment.interview capability without the grant", () => {
        for (const role of [ROLES.STAFF, ROLES.MANAGER, ROLES.FINANCE]) {
            expect(
                resolvePermissions(role).permissions.has(PERMISSIONS.RECRUITMENT_INTERVIEW)
            ).toBe(false);
        }
    });

    it("refuses a role without recruitment.interview before any query runs", async () => {
        // A MANAGER can open /recruitment and read interviews, so this is the
        // exact case where the button is reachable and the action is not. The
        // message is deliberately generic: `denied()` in this module collapses
        // every thrown AuthorizationError into one fallback string, so what is
        // pinned here is the refusal and the absence of a query, not the copy.
        signedInAs(ROLES.MANAGER);

        const result = await submitFeedback(null, validPayload());

        expect(result.success).toBe(false);
        expect(prismaMock.interviewParticipant.findUnique).not.toHaveBeenCalled();
        expect(prismaMock.interviewFeedback.upsert).not.toHaveBeenCalled();
        expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it("refuses an unauthenticated caller before any query runs", async () => {
        sessionStub.current = null;

        const result = await submitFeedback(null, validPayload());

        expect(result.success).toBe(false);
        expect(prismaMock.interviewParticipant.findUnique).not.toHaveBeenCalled();
        expect(prismaMock.interviewFeedback.upsert).not.toHaveBeenCalled();
    });

    it.each([
        ["zero", "0"],
        ["six", "6"],
        ["negative", "-1"],
        ["fractional", "2.5"],
    ])("refuses a %s score rather than reinterpreting it", async (_label, value) => {
        signedInAs(ROLES.ADMIN);

        const result = await submitFeedback(null, validPayload({ overall: value }));

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/whole number from 1 to 5/i);
        expect(prismaMock.interviewFeedback.upsert).not.toHaveBeenCalled();
    });

    it("leaves a dimension the form never filled unset rather than zeroing it", async () => {
        // Absent is not the same as bad. Zeroing would invent a score nobody gave.
        signedInAs(ROLES.ADMIN);

        const form = validPayload();
        form.delete("leadership");

        const result = await submitFeedback(null, form);

        expect(result.success).toBe(true);
        expect(upsertArgs().create.leadership).toBeUndefined();
    });

    it("refuses an unknown recommendation", async () => {
        signedInAs(ROLES.ADMIN);

        const result = await submitFeedback(null, validPayload({ recommendation: "DEFINITELY" }));

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/STRONG_HIRE, HIRE, HOLD, NO_HIRE/);
        expect(prismaMock.interviewFeedback.upsert).not.toHaveBeenCalled();
    });

    it("refuses an interview with no id at all", async () => {
        signedInAs(ROLES.ADMIN);

        const result = await submitFeedback(null, validPayload({ interviewId: "" }));

        expect(result.success).toBe(false);
        expect(prismaMock.interviewFeedback.upsert).not.toHaveBeenCalled();
    });
});
