import type { LucideIcon } from "lucide-react";

/**
 * Presentation for each AUTHORITATIVE employment stage.
 *
 * Keyed on `Employee.lifecycle` values, deliberately NOT on the values of
 * `Employee.currentStatus`. The directory badge is `currentStatus`, which the
 * entry/edit form and offboarding both write without advancing the stage, so
 * the two columns can disagree; styling one in terms of the other is what makes
 * the disagreement invisible. `LIFECYCLE_STAGE` is also the vocabulary the
 * state machine in `lib/workflow/recruitment-machine.ts` governs.
 *
 * Every stage in `EMPLOYEE_LIFECYCLE` has an entry, so the detail page can
 * never render a blank badge for a stage a transition produced.
 */
export const LIFECYCLE_STAGE: Record<
    string,
    { badge: string; note: string }
> = {
    PRE_JOINING: {
        badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
        note: "Created but not yet working. Must not be counted as headcount.",
    },
    ACTIVE: {
        badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
        note: "Employed and working, past probation.",
    },
    PROBATION: {
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        note: "Employed and working, within the probation period.",
    },
    CONFIRMED: {
        badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
        note: "Probation completed and confirmed.",
    },
    ON_LEAVE: {
        badge: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
        note: "Temporarily away; returns to the substantive stage.",
    },
    NOTICE_PERIOD: {
        badge: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
        note: "Notice served; employment ends on the last working day.",
    },
    RESIGNED: {
        badge: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
        note: "Resigned. Offboarding still to be closed out.",
    },
    TERMINATED: {
        badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
        note: "Employment terminated by the company.",
    },
    EXITED: {
        badge: "bg-slate-300 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
        note: "Employment has ended and the exit is closed. Terminal stage.",
    },
};

/** Neutral presentation for a value no transition can produce. */
export const UNKNOWN_STAGE = {
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    note: "Stage not recognised by the lifecycle state machine.",
} as const;

export type LifecycleStageIcon = LucideIcon;
