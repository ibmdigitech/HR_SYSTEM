/**
 * Exit lifecycle presentation.
 *
 * This module is the UI's single source of truth for how an exit case is
 * LABELLED, and — more importantly — for what the UI is allowed to SAY about
 * statutory figures.
 *
 * WHY IT IS NOT IN `app/lib/actions/exit.ts`
 * That file carries a file-level `"use server"` directive and may therefore only
 * export async functions. A badge map is data, not an action. Splitting them
 * keeps the action module honest about what a "use server" file can export, and
 * lets the tests import the view functions directly instead of parsing JSX.
 *
 * NO STATUTORY ARITHMETIC LIVES HERE
 * `EXIT_POLICY` ships with every field `null`, deliberately. The one thing this
 * module must never do is paper over that with a plausible-looking number: a
 * confidently wrong gratuity or notice figure is a legal exposure, while an
 * explicit "not configured" is the correct answer until HR supplies the real
 * policy. `exitPolicyView` therefore has exactly two outcomes — a number that
 * came from `EXIT_POLICY` (which nobody has configured yet), or an explicit
 * refusal. It never returns a default.
 */

import {
    EXIT_STATUS,
    EXIT_TYPE,
    isExitPolicyConfigured,
    resolveNoticePeriodDays,
    type ExitType,
} from "@/lib/workflow/exit/state-machine";

/* ------------------------------------------------------------------ */
/* Status labels                                                       */
/* ------------------------------------------------------------------ */

export interface StatusView {
    /** Short label for a badge. */
    label: string;
    /** One line explaining what this state MEANS, not what to do next. */
    note: string;
    /** Badge classes. `transition-colors duration-200`, never `animate-*`. */
    badge: string;
}

const AMBER_BADGE =
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-0";
const INDIGO_BADGE =
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-0";
const EMERALD_BADGE =
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0";
const SLATE_BADGE =
    "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-0";
const ROSE_BADGE =
    "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-0";

/**
 * Covers every `EXIT_STATUS` value. A status added to the state machine without
 * an entry here would render `UNKNOWN_STATUS`, which is the failure this map
 * exists to prevent.
 */
export const EXIT_STATUS_VIEW: Record<string, StatusView> = {
    [EXIT_STATUS.REQUESTED]: {
        label: "Requested",
        note: "The case is open and has not been routed for a decision.",
        badge: SLATE_BADGE,
    },
    [EXIT_STATUS.PENDING_APPROVAL]: {
        label: "Awaiting decision",
        note: "Waiting on an approve-or-reject decision from HR or an administrator.",
        badge: AMBER_BADGE,
    },
    [EXIT_STATUS.APPROVED]: {
        label: "Approved",
        note: "The exit is agreed. It has not yet been put into effect.",
        badge: EMERALD_BADGE,
    },
    [EXIT_STATUS.REJECTED]: {
        label: "Rejected",
        note: "The exit was refused. Terminal — a new case is opened to try again.",
        badge: ROSE_BADGE,
    },
    [EXIT_STATUS.WITHDRAWN]: {
        label: "Withdrawn",
        note: "Withdrawn after approval. Terminal.",
        badge: SLATE_BADGE,
    },
    [EXIT_STATUS.NOTICE_PERIOD]: {
        label: "Notice period",
        note: "The employee is serving notice up to the last working date.",
        badge: INDIGO_BADGE,
    },
    [EXIT_STATUS.INTERVIEW_PENDING]: {
        label: "Exit interview due",
        note: "Waiting for the exit interview to be conducted and recorded.",
        badge: AMBER_BADGE,
    },
    [EXIT_STATUS.INTERVIEW_COMPLETED]: {
        label: "Interview recorded",
        note: "The exit interview is on file.",
        badge: EMERALD_BADGE,
    },
    [EXIT_STATUS.CLEARANCE_PENDING]: {
        label: "Clearance",
        note: "Assets, documents and access are being cleared before settlement.",
        badge: AMBER_BADGE,
    },
    [EXIT_STATUS.SETTLEMENT_PENDING]: {
        label: "Settlement pending",
        note: "Final settlement is being prepared. Access has NOT been revoked yet.",
        badge: AMBER_BADGE,
    },
    [EXIT_STATUS.COMPLETED]: {
        label: "Completed",
        note: "The exit is closed, employment has ended and access has been revoked.",
        badge: EMERALD_BADGE,
    },
    [EXIT_STATUS.CANCELLED]: {
        label: "Cancelled",
        note: "The case was cancelled. Terminal.",
        badge: SLATE_BADGE,
    },
};

export const UNKNOWN_STATUS: StatusView = {
    label: "Unknown state",
    note: "This status is not one the exit state machine defines. It is shown verbatim rather than guessed at.",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-0",
};

export const EXIT_TYPE_VIEW: Record<string, { label: string; hint: string }> = {
    [EXIT_TYPE.RESIGNATION]: {
        label: "Resignation",
        hint: "The employee has resigned.",
    },
    [EXIT_TYPE.TERMINATION]: {
        label: "Termination",
        hint: "Employment ended by the company.",
    },
    [EXIT_TYPE.END_OF_CONTRACT]: {
        label: "End of contract",
        hint: "A fixed-term engagement reached its end date.",
    },
};

export const SETTLEMENT_STATUS_VIEW: Record<string, { label: string; note: string }> = {
    DRAFT: { label: "Draft", note: "No figures recorded yet." },
    CALCULATED: {
        label: "Calculated",
        note: "Figures recorded by HR. Nothing statutory is computed by this system.",
    },
    UNDER_REVIEW: { label: "Under review", note: "An administrator is reviewing the figures." },
    APPROVED: { label: "Approved", note: "The figures are approved for payment." },
    PAID: { label: "Paid", note: "Recorded as paid." },
};

/* ------------------------------------------------------------------ */
/* Terminal states                                                     */
/* ------------------------------------------------------------------ */

/** Matches `EXIT_TRANSITIONS`' empty maps. A terminal case offers no actions. */
export const TERMINAL_EXIT_STATUSES: readonly string[] = [
    EXIT_STATUS.REJECTED,
    EXIT_STATUS.WITHDRAWN,
    EXIT_STATUS.COMPLETED,
    EXIT_STATUS.CANCELLED,
];

/**
 * The states a settlement may be prepared from.
 *
 * `EXIT_TRANSITIONS` moves CLEARANCE_PENDING → SETTLEMENT_PENDING, and
 * `prepareSettlement` in `lib/workflow/offboarding.ts` accepts an offboarding
 * request in CLEARANCE or SETTLEMENT_PENDING. Both gates must agree, so the
 * case-side half of the rule is this list and the offboarding-side half is that
 * function's own check — neither is invented here.
 */
export const SETTLEMENT_PREPARABLE_STATES: readonly string[] = [
    EXIT_STATUS.CLEARANCE_PENDING,
    EXIT_STATUS.SETTLEMENT_PENDING,
];

export function settlementMayBePrepared(caseStatus: string): boolean {
    return SETTLEMENT_PREPARABLE_STATES.includes(caseStatus);
}

/* ------------------------------------------------------------------ */
/* Employee status on completion                                       */
/* ------------------------------------------------------------------ */

/**
 * `Employee.currentStatus` for a completed exit.
 *
 * RESIGNATION → RESIGNED and TERMINATION → TERMINATED are the two values
 * `ENTRY_FORM_STATUS_VALUES` accepts for a departure.
 *
 * END_OF_CONTRACT has no value of its own. `RESIGNED` would assert that the
 * person chose to leave, which is false — the contract simply expired — and
 * `TERMINATED` is the only remaining value that means "no longer on the
 * workforce". The distinction that actually matters is preserved on the case
 * (`ExitCase.type`) and in the audit row, and both are shown on the detail page.
 * Inventing an `EXPIRED` value would mean writing a fifth `currentStatus` that
 * the employee form's Zod enum cannot round-trip.
 */
export function employeeStatusForExitType(type: string): "RESIGNED" | "TERMINATED" {
    return type === EXIT_TYPE.TERMINATION || type === EXIT_TYPE.END_OF_CONTRACT
        ? "TERMINATED"
        : "RESIGNED";
}

/* ------------------------------------------------------------------ */
/* Statutory policy — refusal, not a guess                              */
/* ------------------------------------------------------------------ */

export const POLICY_UNCONFIGURED_LABEL = "Not configured";
export const POLICY_UNCONFIGURED_NOTE =
    "This system does not calculate statutory notice periods or end-of-service gratuity. " +
    "They are set per jurisdiction, contract and length of service, and none have been " +
    "configured here, so no figure is shown. Enter the agreed value from company policy, or " +
    "configure EXIT_POLICY in lib/workflow/exit/state-machine.ts — it is deliberately not guessed.";

export interface ExitPolicyView {
    /** False while `EXIT_POLICY` ships unconfigured, as it does today. */
    configured: boolean;
    /** The value from `EXIT_POLICY`, or null. NEVER a default. */
    noticePeriodDays: number | null;
    /** What the UI prints in place of the number. */
    noticeLabel: string;
    note: string;
}

/**
 * Resolves what the UI may say about the notice period for an exit type.
 *
 * Returns `null` — rendered as `POLICY_UNCONFIGURED_LABEL` — whenever the policy
 * is unset. The alternative, defaulting to 30 or 60 days, is the specific
 * failure this function exists to prevent: those numbers are plausible, would
 * pass a glance in review, and would be wrong for anyone on probation, on a
 * contract term, or outside the UAE.
 */
export function exitPolicyView(type: string): ExitPolicyView {
    const configured = isExitPolicyConfigured();
    const days = EXIT_TYPES_SAFE.includes(type)
        ? resolveNoticePeriodDays(type as ExitType)
        : null;

    return {
        configured,
        noticePeriodDays: days,
        noticeLabel: days === null ? POLICY_UNCONFIGURED_LABEL : `${days} day${days === 1 ? "" : "s"}`,
        note: days === null ? POLICY_UNCONFIGURED_NOTE : "From the configured exit policy.",
    };
}

/** Narrowed copy of the state machine's list, so an unknown type cannot index it. */
const EXIT_TYPES_SAFE: readonly string[] = [
    EXIT_TYPE.RESIGNATION,
    EXIT_TYPE.TERMINATION,
    EXIT_TYPE.END_OF_CONTRACT,
];

/**
 * The notice period actually RECORDED on the case, which is an input HR
 * supplied, not a computed value.
 *
 * Kept distinct from `exitPolicyView`: a case can carry 45 days because someone
 * typed it, while the company policy is still unset. Both facts are true and the
 * page shows both.
 */
export function recordedNoticeView(noticePeriodDays: number | null): string {
    if (noticePeriodDays === null || noticePeriodDays === undefined) return "Not recorded";
    return `${noticePeriodDays} day${noticePeriodDays === 1 ? "" : "s"} (agreed, not calculated)`;
}