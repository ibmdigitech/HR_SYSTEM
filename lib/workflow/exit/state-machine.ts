/**
 * Exit lifecycle state machine (resignation / termination / end of contract).
 *
 * This module owns the EXIT workflow's status vocabulary and its legal moves.
 * It deliberately reuses the generic `assertTransition` from
 * `lib/workflow/state-machine.ts` rather than re-implementing a second, subtly
 * different transition check: one rule engine, one error type, one way to be
 * refused.
 *
 * The actor lists below are not decorative. They are the state machine's second
 * half of authorization, and they are kept aligned with the ACTUAL grants in
 * `lib/auth/permissions.ts`:
 *
 *   - Approval      → RESIGNATION_APPROVE / TERMINATION_APPROVE  → HR, ADMIN, SUPER_ADMIN
 *   - Exit interview→ EXIT_INTERVIEW                            → ADMIN, SUPER_ADMIN
 *                     (HR is deliberately absent: the grant table does not give
 *                     HR this capability, and widening it here would make the
 *                     state machine promise an authority the RBAC layer refuses)
 *   - Clearance     → EXIT_CLEARANCE                             → HR, ADMIN, SUPER_ADMIN
 *   - Completion    → EXIT_COMPLETE                              → ADMIN, SUPER_ADMIN
 *
 * A role appearing in this map is not sufficient on its own: the server actions
 * in `app/lib/actions/exit.ts` call `requirePermission` before every one of
 * these, so a transition needs BOTH a state-machine role and a granted
 * capability.
 *
 * NOT CALCULATED HERE: statutory notice periods and end-of-service gratuity.
 * Those are jurisdiction-, contract- and length-of-service-specific, and
 * getting them confidently wrong is worse than not having them. See
 * `EXIT_POLICY` below, which ships deliberately unconfigured.
 */

import {
    assertTransition,
    InvalidTransitionError,
    type TransitionMap,
} from "@/lib/workflow/state-machine";

export { assertTransition, InvalidTransitionError };

/* ------------------------------------------------------------------ */
/* EXIT STATUS                                                         */
/* ------------------------------------------------------------------ */

export const EXIT_STATUS = {
    /** Case opened, not yet routed for a decision. */
    REQUESTED: "REQUESTED",
    /** With HR/ADMIN for an approve-or-reject decision. */
    PENDING_APPROVAL: "PENDING_APPROVAL",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    /** Withdrawn after approval — a resignation the employee took back. */
    WITHDRAWN: "WITHDRAWN",
    /** Serving notice; `lastWorkingDate` is the target. */
    NOTICE_PERIOD: "NOTICE_PERIOD",
    INTERVIEW_PENDING: "INTERVIEW_PENDING",
    INTERVIEW_COMPLETED: "INTERVIEW_COMPLETED",
    CLEARANCE_PENDING: "CLEARANCE_PENDING",
    SETTLEMENT_PENDING: "SETTLEMENT_PENDING",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
} as const;

export type ExitStatus = (typeof EXIT_STATUS)[keyof typeof EXIT_STATUS];

export const EXIT_TYPE = {
    RESIGNATION: "RESIGNATION",
    TERMINATION: "TERMINATION",
    END_OF_CONTRACT: "END_OF_CONTRACT",
} as const;

export type ExitType = (typeof EXIT_TYPE)[keyof typeof EXIT_TYPE];

export const EXIT_TYPES: readonly ExitType[] = [
    EXIT_TYPE.RESIGNATION,
    EXIT_TYPE.TERMINATION,
    EXIT_TYPE.END_OF_CONTRACT,
] as const;

/* ------------------------------------------------------------------ */
/* ACTOR SETS                                                          */
/* ------------------------------------------------------------------ */

/** Mirrors RESIGNATION_APPROVE / TERMINATION_APPROVE / EXIT_CLEARANCE grants. */
const HR_AND_ABOVE = ["HR", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Mirrors the EXIT_INTERVIEW grant, which the permission table gives to ADMIN
 * and SUPER_ADMIN only. HR is intentionally not listed.
 */
const INTERVIEWERS = ["ADMIN", "SUPER_ADMIN"] as const;

/** Mirrors EXIT_COMPLETE. Completion also revokes access, so it is not casual. */
const COMPLETERS = ["ADMIN", "SUPER_ADMIN"] as const;

/* ------------------------------------------------------------------ */
/* TRANSITIONS                                                         */
/* ------------------------------------------------------------------ */

/**
 * The exit lifecycle, readable without running anything:
 *
 *   REQUESTED → PENDING_APPROVAL → APPROVED → NOTICE_PERIOD
 *                                            → INTERVIEW_PENDING
 *                                            → INTERVIEW_COMPLETED
 *                                            → CLEARANCE_PENDING
 *                                            → SETTLEMENT_PENDING
 *                                            → COMPLETED
 *
 * with REJECTED from any pre-approval state, WITHDRAWN after approval, and
 * CANCELLED available until the case reaches settlement.
 *
 * REJECTED, WITHDRAWN, COMPLETED and CANCELLED are terminal. A case that went
 * wrong is corrected by opening a new one, which is auditable, rather than by
 * reviving a rejected termination — reviving it would erase the fact that it was
 * ever refused.
 */
export const EXIT_TRANSITIONS: TransitionMap = {
    [EXIT_STATUS.REQUESTED]: {
        [EXIT_STATUS.PENDING_APPROVAL]: { actors: ["MANAGER", ...HR_AND_ABOVE] },
        [EXIT_STATUS.CANCELLED]: { actors: HR_AND_ABOVE },
    },
    [EXIT_STATUS.PENDING_APPROVAL]: {
        [EXIT_STATUS.APPROVED]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.REJECTED]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.CANCELLED]: { actors: HR_AND_ABOVE },
    },
    [EXIT_STATUS.APPROVED]: {
        [EXIT_STATUS.NOTICE_PERIOD]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.WITHDRAWN]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.CANCELLED]: { actors: HR_AND_ABOVE },
    },
    [EXIT_STATUS.NOTICE_PERIOD]: {
        [EXIT_STATUS.INTERVIEW_PENDING]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.WITHDRAWN]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.CANCELLED]: { actors: HR_AND_ABOVE },
    },
    [EXIT_STATUS.INTERVIEW_PENDING]: {
        [EXIT_STATUS.INTERVIEW_COMPLETED]: { actors: INTERVIEWERS },
        [EXIT_STATUS.CANCELLED]: { actors: HR_AND_ABOVE },
    },
    [EXIT_STATUS.INTERVIEW_COMPLETED]: {
        [EXIT_STATUS.CLEARANCE_PENDING]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.CANCELLED]: { actors: HR_AND_ABOVE },
    },
    [EXIT_STATUS.CLEARANCE_PENDING]: {
        [EXIT_STATUS.SETTLEMENT_PENDING]: { actors: HR_AND_ABOVE },
        [EXIT_STATUS.CANCELLED]: { actors: HR_AND_ABOVE },
    },
    [EXIT_STATUS.SETTLEMENT_PENDING]: {
        [EXIT_STATUS.COMPLETED]: { actors: COMPLETERS },
    },
    // Terminal states. A rejected or withdrawn case is never revived in place.
    [EXIT_STATUS.REJECTED]: {},
    [EXIT_STATUS.WITHDRAWN]: {},
    [EXIT_STATUS.COMPLETED]: {},
    [EXIT_STATUS.CANCELLED]: {},
};

/**
 * States from which a rehire eligibility assessment is meaningful. An
 * assessment recorded before anyone has decided the case would be a judgement
 * on a departure that never happened.
 *
 * Recorded separately rather than encoded as a transition because recording
 * rehire eligibility does not move the case: it is an assessment ABOUT the
 * case, and the case keeps its own status.
 */
export const REHIRE_ELIGIBILITY_STATES: readonly string[] = [
    EXIT_STATUS.APPROVED,
    EXIT_STATUS.NOTICE_PERIOD,
    EXIT_STATUS.INTERVIEW_PENDING,
    EXIT_STATUS.INTERVIEW_COMPLETED,
    EXIT_STATUS.CLEARANCE_PENDING,
    EXIT_STATUS.SETTLEMENT_PENDING,
    EXIT_STATUS.COMPLETED,
];

/* ------------------------------------------------------------------ */
/* POLICY — INTENTIONALLY UNCONFIGURED                                 */
/* ------------------------------------------------------------------ */

export interface EndOfServiceGratuityPolicy {
    /** Days of basic salary per completed year of service. */
    daysPerYear: number;
    /** Portion of a final incomplete year that is payable. */
    proRataFraction: number;
    /** Whether the reference period is the whole basic salary or part of it. */
    basis: "BASIC_SALARY" | "LAST_BASIC_SALARY" | "TOTAL_WAGES";
}

export interface ExitPolicy {
    /**
     * Notice period in days, per exit type. Null means UNCONFIGURED.
     */
    noticePeriodDaysByExitType: Record<ExitType, number> | null;
    /**
     * End-of-service gratuity rule. Null means UNCONFIGURED.
     *
     * There is deliberately no arithmetic anywhere in this codebase for
     * gratuity. `lib/workflow/offboarding.ts` takes every figure as an input
     * for exactly this reason, and the `gratuityAmount` on `FinalSettlement`
     * is written by a human.
     */
    endOfServiceGratuity: EndOfServiceGratuityPolicy | null;
}

/**
 * ⚠️ NOT CONFIGURED. ⚠️
 *
 * Every field is `null`, and `null` means "this company has not told us".
 *
 * Statutory notice and end-of-service gratuity are set per JURISDICTION, and
 * are frequently amended per CONTRACT and per LENGTH OF SERVICE. A value baked
 * into source would look authoritative, pass review, and quietly mis-pay
 * people. An explicit `null` fails loudly in the UI and in the action, which is
 * the correct outcome until HR supplies the real numbers.
 *
 * TO CONFIGURE: replace the nulls below with the figures from company policy /
 * the applicable labour law, and record the source and effective date in the
 * commit message. Do not fill these in from memory.
 */
export const EXIT_POLICY: ExitPolicy = {
    noticePeriodDaysByExitType: null,
    endOfServiceGratuity: null,
};

/** True only when HR has actually filled `EXIT_POLICY` in. */
export function isExitPolicyConfigured(): boolean {
    return (
        EXIT_POLICY.noticePeriodDaysByExitType !== null ||
        EXIT_POLICY.endOfServiceGratuity !== null
    );
}

/**
 * Notice period for an exit type, or null when the policy is not configured.
 *
 * Returning null is meaningful: the caller must ask HR for the number rather
 * than substitute a guess. Callers should surface that as a prompt, never
 * silently default it.
 */
export function resolveNoticePeriodDays(type: ExitType): number | null {
    const table = EXIT_POLICY.noticePeriodDaysByExitType;
    if (!table) return null;
    const days = table[type];
    return typeof days === "number" && Number.isFinite(days) && days >= 0 ? days : null;
}
