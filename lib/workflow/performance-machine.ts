/**
 * Performance review state machines (P2).
 *
 * Two independent machines:
 *  1. PerformanceCycle  — lifecycle of the review period itself
 *  2. PerformanceReview — lifecycle of an individual employee's review
 *
 * Every transition is role-guarded so the UI can render exactly what the
 * current actor may do. A bad transition is refused by the machine, never
 * silently corrected.
 */

export class InvalidTransitionError extends Error {
    readonly from: string;
    readonly to: string;
    readonly code = "INVALID_TRANSITION";
    constructor(workflow: string, from: string, to: string) {
        super(`${workflow}: cannot move from ${from} to ${to}`);
        this.name = "InvalidTransitionError";
        this.from = from;
        this.to = to;
    }
}

export interface TransitionDefinition {
    /** Actor roles permitted. Empty = any authorised actor. */
    actors?: readonly string[];
    /** Extra business rule. Returning a string blocks the move. */
    guard?: (ctx: TransitionContext) => string | null;
}

export interface TransitionContext {
    from: string;
    to: string;
    actorRole: string;
    actorId?: string | null;
    data?: Record<string, unknown>;
}

export type TransitionMap = Record<string, Record<string, TransitionDefinition>>;

export function assertTransition(
    workflow: string,
    transitions: TransitionMap,
    from: string,
    to: string,
    context: Omit<TransitionContext, "from" | "to">
): void {
    const targets = transitions[from];
    if (!targets) throw new InvalidTransitionError(workflow, from, to);

    const def = targets[to];
    if (!def) throw new InvalidTransitionError(workflow, from, to);

    if (def.actors?.length) {
        const role = String(context.actorRole ?? "").toUpperCase();
        if (!def.actors.includes(role)) throw new InvalidTransitionError(workflow, from, to);
    }
    if (def.guard) {
        const reason = def.guard({ from, to, ...context });
        if (reason) throw new InvalidTransitionError(workflow, from, to);
    }
}

export function canTransition(
    transitions: TransitionMap,
    from: string,
    to: string,
    context: Omit<TransitionContext, "from" | "to">
): { allowed: boolean; reason?: string } {
    try {
        assertTransition("probe", transitions, from, to, context);
        return { allowed: true };
    } catch (error) {
        if (error instanceof InvalidTransitionError) return { allowed: false, reason: error.message };
        throw error;
    }
}

export function nextStates(transitions: TransitionMap, from: string): string[] {
    return Object.keys(transitions[from] ?? {});
}

/* ================================================================== */
/* PERFORMANCE CYCLE (review period lifecycle)                         */
/* ================================================================== */

export const CYCLE_STATUS = {
    PLANNING: "PLANNING",
    ACTIVE: "ACTIVE",
    CLOSED: "CLOSED",
    ARCHIVED: "ARCHIVED",
} as const;

export type CycleStatus = (typeof CYCLE_STATUS)[keyof typeof CYCLE_STATUS];

/**
 * Cycle transitions:
 *  - PLANNING → ACTIVE  (HR/ADMIN starts the cycle)
 *  - ACTIVE → CLOSED    (HR/ADMIN closes submissions)
 *  - CLOSED → ARCHIVED  (HR/ADMIN archives after approvals complete)
 *  - PLANNING → ARCHIVED (HR/ADMIN cancels before starting)
 */
export const CYCLE_TRANSITIONS: TransitionMap = {
    [CYCLE_STATUS.PLANNING]: {
        [CYCLE_STATUS.ACTIVE]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [CYCLE_STATUS.ARCHIVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [CYCLE_STATUS.ACTIVE]: {
        [CYCLE_STATUS.CLOSED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [CYCLE_STATUS.CLOSED]: {
        [CYCLE_STATUS.ARCHIVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [CYCLE_STATUS.ARCHIVED]: {},
};

/* ================================================================== */
/* PERFORMANCE REVIEW (individual employee review lifecycle)          */
/* ================================================================== */

export const REVIEW_STATUS = {
    DRAFT: "DRAFT",
    SELF_ASSESSMENT: "SELF_ASSESSMENT",
    MANAGER_REVIEW: "MANAGER_REVIEW",
    CALIBRATION: "CALIBRATION",
    APPROVED: "APPROVED",
    ACKNOWLEDGED: "ACKNOWLEDGED",
} as const;

export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];

const HR_ADMIN = ["HR", "ADMIN", "SUPER_ADMIN"] as const;
const MANAGER_HR_ADMIN = ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] as const;
const ALL_ROLES = ["EMPLOYEE", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Review transitions:
 *
 *  DRAFT
 *    └─► SELF_ASSESSMENT     (EMPLOYEE starts self-assessment)
 *    └─► MANAGER_REVIEW      (MANAGER skips self-assessment, starts review directly)
 *    └─► CANCELLED           (HR/ADMIN cancels)
 *
 *  SELF_ASSESSMENT
 *    └─► MANAGER_REVIEW      (EMPLOYEE submits; MANAGER begins review)
 *    └─► DRAFT               (EMPLOYEE reopens draft before submit)
 *
 *  MANAGER_REVIEW
 *    └─► CALIBRATION         (MANAGER submits; HR/ADMIN begins calibration)
 *    └─► SELF_ASSESSMENT     (MANAGER returns to employee for changes)
 *    └─► APPROVED            (MANAGER approves directly if calibration disabled)
 *
 *  CALIBRATION
 *    └─► APPROVED            (HR/ADMIN finalizes after calibration)
 *    └─► MANAGER_REVIEW      (HR/ADMIN returns to manager for changes)
 *
 *  APPROVED
 *    └─► ACKNOWLEDGED        (EMPLOYEE acknowledges)
 *
 *  ACKNOWLEDGED              (Terminal)
 *
 * Notes:
 *  - The cycle's flags (selfAssessmentEnabled, managerReviewEnabled, calibrationEnabled)
 *    control which paths are available. The machine validates against the cycle config.
 *  - A review cannot skip SELF_ASSESSMENT if the cycle requires it.
 *  - A review cannot skip CALIBRATION if the cycle requires it.
 */
export const REVIEW_TRANSITIONS: TransitionMap = {
    [REVIEW_STATUS.DRAFT]: {
        [REVIEW_STATUS.SELF_ASSESSMENT]: {
            actors: ["EMPLOYEE"],
            guard: ({ data }) => data?.selfAssessmentEnabled ? null : "Self-assessment is not enabled for this cycle",
        },
        [REVIEW_STATUS.MANAGER_REVIEW]: {
            actors: ["MANAGER"],
            guard: ({ data }) => data?.managerReviewEnabled ? null : "Manager review is not enabled for this cycle",
        },
        // HR/ADMIN can cancel a draft review
        "CANCELLED": { actors: HR_ADMIN },
    },
    [REVIEW_STATUS.SELF_ASSESSMENT]: {
        [REVIEW_STATUS.MANAGER_REVIEW]: {
            actors: ["EMPLOYEE"],
            guard: ({ data }) => data?.hasGoalsAndAnswers ? null : "Complete all required goals and questions before submitting",
        },
        [REVIEW_STATUS.DRAFT]: { actors: ["EMPLOYEE"] },
    },
    [REVIEW_STATUS.MANAGER_REVIEW]: {
        [REVIEW_STATUS.CALIBRATION]: {
            actors: ["MANAGER"],
            guard: ({ data }) => data?.calibrationEnabled ? null : "Calibration is not enabled for this cycle",
        },
        [REVIEW_STATUS.APPROVED]: {
            actors: ["MANAGER"],
            guard: ({ data }) => !data?.calibrationEnabled ? null : "Calibration is required before approval",
        },
        [REVIEW_STATUS.SELF_ASSESSMENT]: { actors: ["MANAGER"] },
    },
    [REVIEW_STATUS.CALIBRATION]: {
        [REVIEW_STATUS.APPROVED]: { actors: HR_ADMIN },
        [REVIEW_STATUS.MANAGER_REVIEW]: { actors: HR_ADMIN },
    },
    [REVIEW_STATUS.APPROVED]: {
        [REVIEW_STATUS.ACKNOWLEDGED]: { actors: ["EMPLOYEE"] },
    },
    [REVIEW_STATUS.ACKNOWLEDGED]: {},
    "CANCELLED": {},
};

