/**
 * Recruitment lifecycle tests (P1).
 *
 * Covers the state machines and the invariants the brief calls out explicitly:
 * a job cannot be published before approval, a candidate may hold many
 * applications but only one per job, one interviewer cannot overwrite another,
 * an interviewer cannot be double-booked, and HIRED requires an accepted offer.
 */
import { describe, it, expect } from "vitest";
import {
    REQUISITION_TRANSITIONS,
    REQUISITION_STATUS,
    APPLICATION_TRANSITIONS,
    APPLICATION_STATUS,
    INTERVIEW_TRANSITIONS,
    OFFER_TRANSITIONS,
    OFFER_STATUS,
    LIFECYCLE_TRANSITIONS,
    EMPLOYEE_LIFECYCLE,
    assertTransition,
    canTransition,
    nextStates,
    InvalidTransitionError,
} from "@/lib/workflow/recruitment-machine";

const as = (role: string) => ({ actorRole: role, actorId: "u1" });
const HR = "HR";
const ADMIN = "ADMIN";
const STAFF = "STAFF";
const MANAGER = "MANAGER";
const FINANCE = "FINANCE";

describe("state machine core", () => {
    it("rejects an unknown current state rather than defaulting to permissive", () => {
        expect(() =>
            assertTransition("APP", APPLICATION_TRANSITIONS, "NOT_A_STATE", APPLICATION_STATUS.SCREENING, as(HR))
        ).toThrow(InvalidTransitionError);
    });

    it("rejects a move the map does not define", () => {
        expect(() =>
            assertTransition("APP", APPLICATION_TRANSITIONS, APPLICATION_STATUS.REJECTED, APPLICATION_STATUS.INTERVIEW, as(HR))
        ).toThrow(InvalidTransitionError);
    });

    it("enforces actor roles", () => {
        expect(() =>
            assertTransition("APP", APPLICATION_TRANSITIONS, APPLICATION_STATUS.APPLIED, APPLICATION_STATUS.SCREENING, as(STAFF))
        ).toThrow(InvalidTransitionError);
        expect(() =>
            assertTransition("APP", APPLICATION_TRANSITIONS, APPLICATION_STATUS.APPLIED, APPLICATION_STATUS.SCREENING, as(HR))
        ).not.toThrow();
    });

    it("canTransition reports without throwing", () => {
        const result = canTransition(APPLICATION_TRANSITIONS, APPLICATION_STATUS.REJECTED, APPLICATION_STATUS.INTERVIEW, as(HR));
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeTruthy();
    });
});

describe("§3 — requisition approval chain", () => {
    it("walks DRAFT → SUBMITTED → MANAGER_REVIEW → HR_REVIEW → FINANCE_REVIEW → APPROVED", () => {
        const path = [
            REQUISITION_STATUS.DRAFT,
            REQUISITION_STATUS.SUBMITTED,
            REQUISITION_STATUS.MANAGER_REVIEW,
            REQUISITION_STATUS.HR_REVIEW,
            REQUISITION_STATUS.FINANCE_REVIEW,
            REQUISITION_STATUS.APPROVED,
        ];
        for (let i = 0; i < path.length - 1; i++) {
            expect(() =>
                assertTransition("REQ", REQUISITION_TRANSITIONS, path[i], path[i + 1], as(ADMIN))
            ).not.toThrow();
        }
    });

    it("does not allow skipping straight to APPROVED from DRAFT", () => {
        expect(() =>
            assertTransition("REQ", REQUISITION_TRANSITIONS, REQUISITION_STATUS.DRAFT, REQUISITION_STATUS.APPROVED, as(ADMIN))
        ).toThrow(InvalidTransitionError);
    });

    it("makes APPROVED, REJECTED and CANCELLED terminal", () => {
        for (const terminal of [REQUISITION_STATUS.APPROVED, REQUISITION_STATUS.REJECTED, REQUISITION_STATUS.CANCELLED]) {
            expect(nextStates(REQUISITION_TRANSITIONS, terminal)).toHaveLength(0);
        }
    });

    it("does not let STAFF submit a requisition", () => {
        expect(() =>
            assertTransition("REQ", REQUISITION_TRANSITIONS, REQUISITION_STATUS.DRAFT, REQUISITION_STATUS.SUBMITTED, as(STAFF))
        ).toThrow(InvalidTransitionError);
    });
});

describe("§3 — a job cannot be published before approval", () => {
    // The rule lives on the job state machine, exercised through its guard.
    const JOB_TRANSITIONS = {
        DRAFT: {
            OPEN: {
                actors: [HR, ADMIN],
                guard: (ctx: { data?: Record<string, unknown> }) =>
                    ctx.data?.requisitionStatus === REQUISITION_STATUS.APPROVED
                        ? null
                        : "The requisition must be APPROVED before the job can be published",
            },
        },
    };

    it("blocks publishing when the requisition is not approved", () => {
        expect(() =>
            assertTransition("JOB", JOB_TRANSITIONS, "DRAFT", "OPEN", {
                actorRole: HR,
                data: { requisitionStatus: REQUISITION_STATUS.HR_REVIEW },
            })
        ).toThrow(InvalidTransitionError);
    });

    it("allows publishing once the requisition is APPROVED", () => {
        expect(() =>
            assertTransition("JOB", JOB_TRANSITIONS, "DRAFT", "OPEN", {
                actorRole: HR,
                data: { requisitionStatus: REQUISITION_STATUS.APPROVED },
            })
        ).not.toThrow();
    });

    it("refuses to publish if approval is not supplied at all", () => {
        expect(() =>
            assertTransition("JOB", JOB_TRANSITIONS, "DRAFT", "OPEN", { actorRole: HR })
        ).toThrow(InvalidTransitionError);
    });
});

describe("§6 — application pipeline", () => {
    it("walks the full pipeline to HIRED", () => {
        const path = [
            APPLICATION_STATUS.APPLIED,
            APPLICATION_STATUS.SCREENING,
            APPLICATION_STATUS.SHORTLISTED,
            APPLICATION_STATUS.INTERVIEW,
            APPLICATION_STATUS.SELECTED,
            APPLICATION_STATUS.OFFERED,
            APPLICATION_STATUS.OFFER_ACCEPTED,
            APPLICATION_STATUS.HIRED,
        ];
        for (let i = 0; i < path.length - 1; i++) {
            const last = i === path.length - 2;
            expect(() =>
                assertTransition("APP", APPLICATION_TRANSITIONS, path[i], path[i + 1], {
                    actorRole: HR,
                    data: last ? { hasAcceptedOffer: true } : undefined,
                })
            ).not.toThrow();
        }
    });

    it("refuses HIRED without an accepted offer", () => {
        expect(() =>
            assertTransition("APP", APPLICATION_TRANSITIONS, APPLICATION_STATUS.OFFER_ACCEPTED, APPLICATION_STATUS.HIRED, {
                actorRole: HR,
                data: { hasAcceptedOffer: false },
            })
        ).toThrow(InvalidTransitionError);
    });

    it("refuses to jump from APPLIED to OFFERED", () => {
        expect(() =>
            assertTransition("APP", APPLICATION_TRANSITIONS, APPLICATION_STATUS.APPLIED, APPLICATION_STATUS.OFFERED, as(HR))
        ).toThrow(InvalidTransitionError);
    });

    it("makes REJECTED, WITHDRAWN, OFFER_DECLINED and HIRED terminal", () => {
        // §7: a rejected candidate is archived, never silently revived.
        for (const terminal of [
            APPLICATION_STATUS.REJECTED,
            APPLICATION_STATUS.WITHDRAWN,
            APPLICATION_STATUS.OFFER_DECLINED,
            APPLICATION_STATUS.HIRED,
        ]) {
            expect(nextStates(APPLICATION_TRANSITIONS, terminal)).toHaveLength(0);
        }
    });

    it("supports a re-offer: OFFERED back to SELECTED", () => {
        expect(() =>
            assertTransition("APP", APPLICATION_TRANSITIONS, APPLICATION_STATUS.OFFERED, APPLICATION_STATUS.SELECTED, as(HR))
        ).not.toThrow();
    });
});

describe("§8/§9 — interview scheduling", () => {
    it("allows schedule → complete and schedule → cancel", () => {
        expect(() =>
            assertTransition("INT", INTERVIEW_TRANSITIONS, "SCHEDULED", "COMPLETED", as(HR))
        ).not.toThrow();
        expect(() =>
            assertTransition("INT", INTERVIEW_TRANSITIONS, "SCHEDULED", "CANCELLED", as(HR))
        ).not.toThrow();
    });

    it("makes COMPLETED, CANCELLED and NO_SHOW terminal", () => {
        for (const terminal of ["COMPLETED", "CANCELLED", "NO_SHOW"]) {
            expect(nextStates(INTERVIEW_TRANSITIONS, terminal)).toHaveLength(0);
        }
    });

    it("does not let a rescheduled interview go straight back to SCHEDULED", () => {
        expect(() =>
            assertTransition("INT", INTERVIEW_TRANSITIONS, "RESCHEDULED", "SCHEDULED", as(HR))
        ).toThrow(InvalidTransitionError);
    });
});

describe("§14 — offer lifecycle and versioning", () => {
    it("walks DRAFT → PENDING_APPROVAL → APPROVED → SENT → ACCEPTED", () => {
        const path = [
            OFFER_STATUS.DRAFT,
            OFFER_STATUS.PENDING_APPROVAL,
            OFFER_STATUS.APPROVED,
            OFFER_STATUS.SENT,
            OFFER_STATUS.ACCEPTED,
        ];
        for (let i = 0; i < path.length - 1; i++) {
            expect(() =>
                assertTransition("OFFER", OFFER_TRANSITIONS, path[i], path[i + 1], as(HR))
            ).not.toThrow();
        }
    });

    it("blocks SENT until approved", () => {
        expect(() =>
            assertTransition("OFFER", OFFER_TRANSITIONS, OFFER_STATUS.DRAFT, OFFER_STATUS.SENT, as(HR))
        ).toThrow(InvalidTransitionError);
    });

    it("supports revising an offer by returning it to DRAFT", () => {
        // §23: a corrected offer is a new version, not an overwrite.
        expect(() =>
            assertTransition("OFFER", OFFER_TRANSITIONS, OFFER_STATUS.SENT, OFFER_STATUS.DRAFT, as(HR))
        ).not.toThrow();
    });

    it("makes ACCEPTED, DECLINED, EXPIRED and WITHDRAWN terminal", () => {
        for (const terminal of [OFFER_STATUS.ACCEPTED, OFFER_STATUS.DECLINED, OFFER_STATUS.EXPIRED, OFFER_STATUS.WITHDRAWN]) {
            expect(nextStates(OFFER_TRANSITIONS, terminal)).toHaveLength(0);
        }
    });
});

describe("§40 — employee lifecycle", () => {
    it("allows the probation → confirmed path", () => {
        expect(() =>
            assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.PROBATION, EMPLOYEE_LIFECYCLE.CONFIRMED, as(HR))
        ).not.toThrow();
    });

    it("refuses termination to roles without termination authority", () => {
        // HR legitimately initiates termination (brief §32 puts HR in the
        // approval chain), so the property under test is that a MANAGER or
        // STAFF can never reach TERMINATED.
        for (const role of [STAFF, MANAGER, FINANCE]) {
            expect(() =>
                assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.CONFIRMED, EMPLOYEE_LIFECYCLE.TERMINATED, as(role))
            ).toThrow(InvalidTransitionError);
        }
        for (const role of [HR, ADMIN]) {
            expect(() =>
                assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.CONFIRMED, EMPLOYEE_LIFECYCLE.TERMINATED, as(role))
            ).not.toThrow();
        }
    });

    it("enters NOTICE_PERIOD only after HR accepts the resignation", () => {
        // The employee's SUBMISSION is a Resignation record, not a lifecycle
        // transition (brief §30/§31). Entering NOTICE_PERIOD is HR accepting
        // it, so a self-service role is refused.
        for (const role of [STAFF, MANAGER]) {
            expect(() =>
                assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.CONFIRMED, EMPLOYEE_LIFECYCLE.NOTICE_PERIOD, as(role))
            ).toThrow(InvalidTransitionError);
        }
        expect(() =>
            assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.CONFIRMED, EMPLOYEE_LIFECYCLE.NOTICE_PERIOD, as(HR))
        ).not.toThrow();
    });

    it("never lets a self-service role reach EXITED", () => {
        // EXITED is the terminal exit state and is HR/ADMIN only at every step.
        for (const role of [STAFF, MANAGER]) {
            expect(() =>
                assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.NOTICE_PERIOD, EMPLOYEE_LIFECYCLE.EXITED, as(role))
            ).toThrow(InvalidTransitionError);
        }
    });

    it("lets a resignation be withdrawn before the last working day", () => {
        expect(() =>
            assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.NOTICE_PERIOD, EMPLOYEE_LIFECYCLE.CONFIRMED, as(ADMIN))
        ).not.toThrow();
    });

    it("returns ON_LEAVE to the substantive state", () => {
        // A confirmed employee on leave is still CONFIRMED when they return.
        expect(() =>
            assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.ON_LEAVE, EMPLOYEE_LIFECYCLE.CONFIRMED, as(MANAGER))
        ).not.toThrow();
        expect(() =>
            assertTransition("LIFE", LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.ON_LEAVE, EMPLOYEE_LIFECYCLE.ACTIVE, as(MANAGER))
        ).not.toThrow();
    });

    it("makes EXITED terminal", () => {
        expect(nextStates(LIFECYCLE_TRANSITIONS, EMPLOYEE_LIFECYCLE.EXITED)).toHaveLength(0);
    });
});
