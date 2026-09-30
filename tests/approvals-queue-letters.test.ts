/**
 * Letter and exit-case approval-queue filters.
 *
 * Companion to `tests/approvals-queue.test.ts`, which pins the LEAVE queue. Same
 * reasoning, applied to the two sections that were missing entirely: the letter
 * approval route existed and had zero callers, and the exit actions existed with
 * nowhere to appear, so work in either could reach a state where it was
 * invisible to the person who had to clear it.
 *
 * These assert on the Prisma `where` clause the page actually passes, not on
 * rendered output, because the clause is the thing that decides visibility. A
 * page can render a heading perfectly and still filter on a column nothing
 * writes — which is exactly how the leave queue once lost real pending work.
 */
import { describe, it, expect } from "vitest";

import {
    LETTER_PENDING_APPROVAL_STATUS,
    EXIT_DECISION_STATES,
    canApproveLetters,
    canDecideExitCases,
    buildLetterQueueWhere,
    buildExitQueueWhere,
    type QueueWhere,
} from "@/app/dashboard/approvals/queue-filters";
import { LETTER_STATUS } from "@/lib/workflow/state-machine";
import { EXIT_STATUS, EXIT_TRANSITIONS } from "@/lib/workflow/exit/state-machine";
import { ROLES } from "@/lib/auth/roles";
import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";

/**
 * A deliberately tiny Prisma-`where` evaluator, so "does this row appear?" is
 * answered by the filter's own semantics rather than by a string comparison.
 *
 * It understands the two shapes these filters are allowed to use, and THROWS on
 * anything else. That is the point: if someone later widens a filter to
 * `status: { not: ... }` or adds a relation filter, every test that relied on
 * this evaluator fails loudly instead of quietly passing on a shape it does not
 * understand.
 */
function matchesQueueWhere(where: QueueWhere | null, row: Record<string, unknown>): boolean {
    if (where === null) return false; // "no queue" — nothing is ever visible
    for (const [key, condition] of Object.entries(where)) {
        if (condition === null || typeof condition !== "object") {
            if (row[key] !== condition) return false;
            continue;
        }
        const filter = condition as { in?: readonly unknown[] };
        if (!Array.isArray(filter.in)) {
            throw new Error(`matchesQueueWhere does not understand the filter on "${key}"`);
        }
        if (!filter.in.includes(row[key])) return false;
    }
    return true;
}

/** Every letter state that is NOT the one the approval route will act on. */
const NON_ACTIONABLE_LETTER_STATUSES = [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "GENERATED",
    "VOID",
    // Lower case, because `status` is a free-text String column and nothing in
    // the schema stops a row being written with any casing at all. A filter on
    // `PENDING` must not be widened to a case-insensitive match by accident.
    "pending",
    "",
];

describe("canApproveLetters", () => {
    it("is true for exactly the roles that hold letter.approve", () => {
        for (const role of [ROLES.HR, ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
            expect(hasPermission(role, PERMISSIONS.LETTER_APPROVE)).toBe(true);
            expect(canApproveLetters(role)).toBe(true);
        }
    });

    it("is false for roles without letter.approve", () => {
        // A MANAGER holds letter.view — reading letters is not approving them.
        for (const role of [ROLES.STAFF, ROLES.MANAGER, ROLES.FINANCE]) {
            expect(hasPermission(role, PERMISSIONS.LETTER_APPROVE)).toBe(false);
            expect(canApproveLetters(role)).toBe(false);
        }
    });
});

describe("buildLetterQueueWhere", () => {
    it("gives an approver exactly the PENDING letters", () => {
        const where = buildLetterQueueWhere({ role: ROLES.HR });

        expect(where).toEqual({ status: LETTER_PENDING_APPROVAL_STATUS });
        expect(matchesQueueWhere(where, { status: "PENDING" })).toBe(true);
    });

    it("excludes a letter in any other state", () => {
        // The decisive assertion. A letter that is already generated, drafted,
        // voided or rejected must not appear, or the Approve button renders and
        // the route answers 409 — a queue that offers work it cannot deliver.
        for (const status of NON_ACTIONABLE_LETTER_STATUSES) {
            const where = buildLetterQueueWhere({ role: ROLES.ADMIN });
            expect(matchesQueueWhere(where, { status })).toBe(false);
        }
    });

    it("filters on the status the approval route validates, not the state machine's name", () => {
        // `LETTER_STATUS` names the awaiting-approval state PENDING_APPROVAL and
        // is applied only to `LetterRecord`, a different model. `Letter` rows
        // are gated on "PENDING" by the route's guarded updateMany. If this
        // breaks, the queue and the route have diverged again.
        const where = buildLetterQueueWhere({ role: ROLES.HR });

        expect(where?.status).toBe("PENDING");
        expect(where?.status).not.toBe(LETTER_STATUS.PENDING_APPROVAL);
        expect(matchesQueueWhere(where, { status: LETTER_STATUS.PENDING_APPROVAL })).toBe(false);
    });

    it("gives no queue at all to a role without letter.approve", () => {
        // Null, not "everything": the queue renders letter content, and a role
        // that cannot approve must not be shown documents it may not act on.
        for (const role of [ROLES.STAFF, ROLES.MANAGER, ROLES.FINANCE]) {
            expect(buildLetterQueueWhere({ role })).toBeNull();
        }
    });

    it("shows a SUPER_ADMIN the same queue as HR", () => {
        // The leave queue once used a hardcoded `role === "HR" || role === "ADMIN"`
        // and silently excluded this role. Permission-based, so it cannot recur.
        expect(buildLetterQueueWhere({ role: ROLES.SUPER_ADMIN })).toEqual(
            buildLetterQueueWhere({ role: ROLES.HR })
        );
    });
});

describe("canDecideExitCases", () => {
    it("is true for exactly the roles the exit decision action admits", () => {
        // Mirrors `requireAnyPermission([RESIGNATION_APPROVE, TERMINATION_APPROVE])`
        // at the top of `decideExit` in app/lib/actions/exit.ts.
        for (const role of [ROLES.HR, ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
            expect(canDecideExitCases(role)).toBe(true);
        }
    });

    it("is false for roles without either approval permission", () => {
        // FINANCE holds exit.settlement, not exit approval: settling money on an
        // approved case is not the same authority as approving the departure.
        for (const role of [ROLES.STAFF, ROLES.MANAGER, ROLES.FINANCE]) {
            expect(canDecideExitCases(role)).toBe(false);
        }
    });
});

describe("EXIT_DECISION_STATES", () => {
    it("is exactly the states from which APPROVED or REJECTED is reachable", () => {
        // Derived from EXIT_TRANSITIONS, not hand-listed, so the queue cannot
        // fall behind the state machine. This pins the current answer.
        expect([...EXIT_DECISION_STATES]).toEqual([EXIT_STATUS.PENDING_APPROVAL]);
    });

    it("contains no state whose decision edges are empty", () => {
        // A terminal state in the decision set would put already-decided cases
        // back in front of an approver.
        for (const state of EXIT_DECISION_STATES) {
            const targets = EXIT_TRANSITIONS[state];
            expect(targets).toBeDefined();
            expect(Object.keys(targets).length).toBeGreaterThan(0);
        }
    });

    it("excludes the states an approver cannot act on", () => {
        // REQUESTED is not routed for a decision yet; APPROVED/REJECTED/COMPLETED
        // are terminal. None of them may be queued.
        for (const state of [
            EXIT_STATUS.REQUESTED,
            EXIT_STATUS.APPROVED,
            EXIT_STATUS.REJECTED,
            EXIT_STATUS.WITHDRAWN,
            EXIT_STATUS.COMPLETED,
            EXIT_STATUS.CANCELLED,
        ]) {
            expect(EXIT_DECISION_STATES).not.toContain(state);
        }
    });
});

describe("buildExitQueueWhere", () => {
    it("gives a decision-maker every case awaiting a decision", () => {
        const where = buildExitQueueWhere({ role: ROLES.HR });

        expect(where).toEqual({ status: { in: [EXIT_STATUS.PENDING_APPROVAL] } });
        expect(matchesQueueWhere(where, { status: EXIT_STATUS.PENDING_APPROVAL })).toBe(true);
    });

    it("excludes a case in any other state", () => {
        for (const status of [
            EXIT_STATUS.REQUESTED,
            EXIT_STATUS.APPROVED,
            EXIT_STATUS.REJECTED,
            EXIT_STATUS.WITHDRAWN,
            EXIT_STATUS.NOTICE_PERIOD,
            EXIT_STATUS.INTERVIEW_PENDING,
            EXIT_STATUS.INTERVIEW_COMPLETED,
            EXIT_STATUS.CLEARANCE_PENDING,
            EXIT_STATUS.SETTLEMENT_PENDING,
            EXIT_STATUS.COMPLETED,
            EXIT_STATUS.CANCELLED,
        ]) {
            const where = buildExitQueueWhere({ role: ROLES.ADMIN });
            expect(matchesQueueWhere(where, { status })).toBe(false);
        }
    });

    it("gives no queue at all to a role without an approval permission", () => {
        for (const role of [ROLES.STAFF, ROLES.MANAGER, ROLES.FINANCE]) {
            expect(buildExitQueueWhere({ role })).toBeNull();
        }
    });

    it("does not queue a case the actor is forbidden to decide", () => {
        // `decideExit` refuses an actor deciding their own departure, and the
        // state machine restricts the APPROVED/REJECTED edges to HR and above.
        // The filter is role-based, so this is a property of who may see the
        // queue, asserted here so a future per-employee narrowing stays honest.
        const where = buildExitQueueWhere({ role: ROLES.MANAGER });
        expect(where).toBeNull();
    });
});
