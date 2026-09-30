/**
 * Approval-queue filters for LETTERS and EXIT CASES.
 *
 * Sibling of `lib/approvals/leave-queue.ts`, built the same way on purpose: the
 * rule that decides *whose pending work an approver can see* is a pure function
 * returning a Prisma `where` object, so it can be unit-tested instead of living
 * inside JSX where a wrong column fails silently.
 *
 * ── Why the letter queue exists ────────────────────────────────────────────
 * `app/api/letters/[id]/approve/route.ts` validates its transition with
 * `updateMany({ where: { id, status: "PENDING" } })`, and before this module
 * NOTHING in the product mounted a queue for it. A letter that reached PENDING
 * was therefore invisible to every approver in the system: no queue, no
 * notification path, no dashboard entry. Mounting the route without the queue
 * would not have added an approval workflow, it would have added an invisible
 * one.
 *
 * ── Why `PENDING` and not `LETTER_STATUS.PENDING_APPROVAL` ──────────────────
 * Two vocabularies exist for one field and they disagree:
 *
 *   - `LETTER_STATUS` in `lib/workflow/state-machine.ts` names the awaiting-
 *     approval state `PENDING_APPROVAL`, and `LETTER_TRANSITIONS` is applied
 *     ONLY to `LetterRecord` (`lib/workflow/letters.ts`) — a different model
 *     that has zero writers and zero rows in this deployment.
 *   - `app/api/letters/[id]/approve/route.ts` pins the guarded write to
 *     `status: "PENDING"`.
 *
 * The queue MUST match what the route will act on. A queue filtered on
 * `PENDING_APPROVAL` would show nothing today, and if a row ever did appear the
 * approve button would return 409. This is the same class of bug as the leave
 * queue filtering on the legacy `managerStatus` / `hrStatus` columns while the
 * state machine validated `status`: one piece of state, two sources of truth,
 * and the queue is the one that goes quietly wrong.
 *
 * NOTE (reported, not worked around): `POST /api/letters` requires
 * `LETTER_GENERATE` (HR / ADMIN / SUPER_ADMIN) and then writes `PENDING` only
 * for roles OUTSIDE that set, so the PENDING branch is unreachable today and
 * this queue is legitimately empty until self-service letter requests exist.
 * That is an upstream defect in a file this task does not own. The queue is
 * still correct: the moment a producer writes PENDING, the work is visible.
 */

import { hasAnyPermission, hasPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { EXIT_STATUS, EXIT_TRANSITIONS } from "@/lib/workflow/exit/state-machine";

/** The `where` clause Prisma expects; kept loose because it is composed. */
export type QueueWhere = Record<string, unknown>;

/**
 * The one and only `Letter.status` value the approval route will act on.
 *
 * Deliberately a local constant rather than an import from
 * `lib/workflow/state-machine.ts`: `LETTER_STATUS` describes a different model
 * (`LetterRecord`) and does not contain this value. See the header.
 */
export const LETTER_PENDING_APPROVAL_STATUS = "PENDING";

export interface QueueInput {
    role: string;
}

/* ------------------------------------------------------------------ */
/* Letters                                                            */
/* ------------------------------------------------------------------ */

/**
 * True when the role may act on a pending letter.
 *
 * Permission-based, and it is the SAME permission the route guards with
 * (`authorizePermission(PERMISSIONS.LETTER_APPROVE)`). Graded out by the grant
 * table: HR, ADMIN and SUPER_ADMIN.
 */
export function canApproveLetters(roleInput: unknown): boolean {
    return hasPermission(roleInput, PERMISSIONS.LETTER_APPROVE);
}

/**
 * The letter queue for a given approver, or `null` for "no queue".
 *
 * `null` rather than "everything" for a role without `letter.approve`: showing
 * a role the documents it may not act on is the same invisible-work failure in
 * the other direction, and the queue carries rendered letter content.
 */
export function buildLetterQueueWhere({ role }: QueueInput): QueueWhere | null {
    if (!canApproveLetters(role)) return null;
    return { status: LETTER_PENDING_APPROVAL_STATUS };
}

/* ------------------------------------------------------------------ */
/* Exit cases                                                         */
/* ------------------------------------------------------------------ */

/**
 * The states from which an approve/reject decision is LEGAL, derived from
 * `EXIT_TRANSITIONS` rather than hand-listed.
 *
 * `decideExit` in `app/lib/actions/exit.ts` calls `assertTransition(status,
 * APPROVED | REJECTED)`, so the set of states it will accept is a property of
 * the transition map, not of this file. Deriving it means a later change to
 * `EXIT_TRANSITIONS` moves the queue with it instead of silently leaving
 * actionable cases invisible — the exact failure this queue is being added to
 * fix.
 *
 * As shipped this resolves to `["PENDING_APPROVAL"]` and nothing else: a case
 * in `REQUESTED` has not been routed for a decision yet, and a case in
 * `APPROVED` has already had one.
 */
export const EXIT_DECISION_STATES: readonly string[] = Object.freeze(
    Object.entries(EXIT_TRANSITIONS)
        .filter(([, targets]) => EXIT_STATUS.APPROVED in targets || EXIT_STATUS.REJECTED in targets)
        .map(([from]) => from)
);

/**
 * True when the role may record an exit decision.
 *
 * Mirrors `requireAnyPermission([RESIGNATION_APPROVE, TERMINATION_APPROVE])`
 * at the top of `decideExit` — the guard the action itself runs. Both strings
 * are granted to HR, ADMIN and SUPER_ADMIN and to nobody else, so a MANAGER
 * sees no exit queue even though the state machine would technically let one
 * route a case forward. The action is the authority; the queue agrees with it.
 */
export function canDecideExitCases(roleInput: unknown): boolean {
    return hasAnyPermission(roleInput, [
        PERMISSIONS.RESIGNATION_APPROVE,
        PERMISSIONS.TERMINATION_APPROVE,
    ]);
}

/** The exit-case queue for a given approver, or `null` for "no queue". */
export function buildExitQueueWhere({ role }: QueueInput): QueueWhere | null {
    if (!canDecideExitCases(role)) return null;
    return { status: { in: [...EXIT_DECISION_STATES] } };
}
