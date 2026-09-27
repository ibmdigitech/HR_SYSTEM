/**
 * Recruitment and employment lifecycle state machines.
 *
 * Every stage of the lifecycle in the brief is an explicit map here rather
 * than a free-text status column, so an illegal move is refused by the
 * application AND recorded, not merely discouraged.
 *
 * The EXISTING recruitment models (JobRequisition.status, Candidate.status,
 * Interview.status, OfferLetter.status) carried status values with no
 * transition rules at all — `Candidate.status` jumped from APPLIED straight to
 * HIRED. These maps give each one a real contract.
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
    // An unknown current state is a hard error, never a permissive default.
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
/* JOB REQUISITION (brief §3)                                            */
/* ================================================================== */

export const REQUISITION_STATUS = {
    DRAFT: "DRAFT",
    SUBMITTED: "SUBMITTED",
    MANAGER_REVIEW: "MANAGER_REVIEW",
    HR_REVIEW: "HR_REVIEW",
    FINANCE_REVIEW: "FINANCE_REVIEW",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    CANCELLED: "CANCELLED",
} as const;

export type RequisitionStatus = (typeof REQUISITION_STATUS)[keyof typeof REQUISITION_STATUS];

/**
 * A job may only be published after APPROVED — that is the brief's explicit
 * requirement ("Do not allow a job to be published before approval where
 * approval is configured"). Terminal: APPROVED, REJECTED, CANCELLED.
 */
export const REQUISITION_TRANSITIONS: TransitionMap = {
    [REQUISITION_STATUS.DRAFT]: {
        [REQUISITION_STATUS.SUBMITTED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [REQUISITION_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [REQUISITION_STATUS.SUBMITTED]: {
        [REQUISITION_STATUS.MANAGER_REVIEW]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [REQUISITION_STATUS.REJECTED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [REQUISITION_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [REQUISITION_STATUS.MANAGER_REVIEW]: {
        [REQUISITION_STATUS.HR_REVIEW]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [REQUISITION_STATUS.REJECTED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [REQUISITION_STATUS.HR_REVIEW]: {
        [REQUISITION_STATUS.FINANCE_REVIEW]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
        [REQUISITION_STATUS.APPROVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [REQUISITION_STATUS.REJECTED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [REQUISITION_STATUS.FINANCE_REVIEW]: {
        [REQUISITION_STATUS.APPROVED]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
        [REQUISITION_STATUS.REJECTED]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
    },
    // Terminal — approval cannot be undone into review.
    [REQUISITION_STATUS.APPROVED]: {},
    [REQUISITION_STATUS.REJECTED]: {},
    [REQUISITION_STATUS.CANCELLED]: {},
};

/* ================================================================== */
/* JOB OPENING (brief §4)                                               */
/* ================================================================== */

export const JOB_STATUS = {
    DRAFT: "DRAFT",
    OPEN: "OPEN",
    PAUSED: "PAUSED",
    CLOSED: "CLOSED",
    FILLED: "FILLED",
    CANCELLED: "CANCELLED",
} as const;

export const JOB_TRANSITIONS: TransitionMap = {
    [JOB_STATUS.DRAFT]: {
        // Guarded: publishing requires an APPROVED requisition.
        [JOB_STATUS.OPEN]: {
            actors: ["HR", "ADMIN", "SUPER_ADMIN"],
            guard: ({ data }) =>
                data?.requisitionStatus === REQUISITION_STATUS.APPROVED
                    ? null
                    : "The requisition must be APPROVED before the job can be published",
        },
        [JOB_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [JOB_STATUS.OPEN]: {
        [JOB_STATUS.PAUSED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [JOB_STATUS.CLOSED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [JOB_STATUS.FILLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [JOB_STATUS.PAUSED]: {
        [JOB_STATUS.OPEN]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [JOB_STATUS.CLOSED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [JOB_STATUS.CLOSED]: { [JOB_STATUS.OPEN]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] } },
    [JOB_STATUS.FILLED]: {},
    [JOB_STATUS.CANCELLED]: {},
};

/* ================================================================== */
/* APPLICATION (brief §6) — the state machine the old schema lacked     */
/* ================================================================== */

export const APPLICATION_STATUS = {
    APPLIED: "APPLIED",
    SCREENING: "SCREENING",
    SHORTLISTED: "SHORTLISTED",
    REJECTED: "REJECTED",
    INTERVIEW: "INTERVIEW",
    ASSESSMENT: "ASSESSMENT",
    SELECTED: "SELECTED",
    OFFERED: "OFFERED",
    OFFER_ACCEPTED: "OFFER_ACCEPTED",
    OFFER_DECLINED: "OFFER_DECLINED",
    WITHDRAWN: "WITHDRAWN",
    HIRED: "HIRED",
} as const;

export type ApplicationStatus = (typeof APPLICATION_STATUS)[keyof typeof APPLICATION_STATUS];

const RECRUITERS = ["HR", "ADMIN", "SUPER_ADMIN"] as const;

/**
 * Two rules encoded here rather than left to the UI:
 *  - REJECTED / WITHDRAWN / OFFER_DECLINED are terminal. A rejected candidate is
 *    never silently revived (brief §7: "Do not permanently delete rejected
 *    candidates" — archived, not reactivated).
 *  - HIRED requires an accepted offer, so a candidate cannot jump straight from
 *    SELECTED to HIRED without one.
 */
export const APPLICATION_TRANSITIONS: TransitionMap = {
    [APPLICATION_STATUS.APPLIED]: {
        [APPLICATION_STATUS.SCREENING]: { actors: RECRUITERS },
        [APPLICATION_STATUS.REJECTED]: { actors: RECRUITERS },
        [APPLICATION_STATUS.WITHDRAWN]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
    },
    [APPLICATION_STATUS.SCREENING]: {
        [APPLICATION_STATUS.SHORTLISTED]: { actors: RECRUITERS },
        [APPLICATION_STATUS.REJECTED]: { actors: RECRUITERS },
        [APPLICATION_STATUS.WITHDRAWN]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
    },
    [APPLICATION_STATUS.SHORTLISTED]: {
        [APPLICATION_STATUS.INTERVIEW]: { actors: RECRUITERS },
        [APPLICATION_STATUS.ASSESSMENT]: { actors: RECRUITERS },
        [APPLICATION_STATUS.REJECTED]: { actors: RECRUITERS },
    },
    [APPLICATION_STATUS.INTERVIEW]: {
        [APPLICATION_STATUS.ASSESSMENT]: { actors: RECRUITERS },
        [APPLICATION_STATUS.SELECTED]: { actors: RECRUITERS },
        [APPLICATION_STATUS.REJECTED]: { actors: RECRUITERS },
    },
    [APPLICATION_STATUS.ASSESSMENT]: {
        [APPLICATION_STATUS.SELECTED]: { actors: RECRUITERS },
        [APPLICATION_STATUS.REJECTED]: { actors: RECRUITERS },
    },
    [APPLICATION_STATUS.SELECTED]: {
        [APPLICATION_STATUS.OFFERED]: { actors: RECRUITERS },
        // A candidate can decline before an offer is formally issued.
        [APPLICATION_STATUS.REJECTED]: { actors: RECRUITERS },
    },
    [APPLICATION_STATUS.OFFERED]: {
        [APPLICATION_STATUS.OFFER_ACCEPTED]: { actors: RECRUITERS },
        [APPLICATION_STATUS.OFFER_DECLINED]: { actors: RECRUITERS },
        // Re-offer path: decline one version, issue another.
        [APPLICATION_STATUS.SELECTED]: { actors: RECRUITERS },
    },
    [APPLICATION_STATUS.OFFER_ACCEPTED]: {
        [APPLICATION_STATUS.HIRED]: {
            actors: RECRUITERS,
            guard: ({ data }) => (data?.hasAcceptedOffer ? null : "An accepted offer is required before HIRED"),
        },
    },
    // Terminal states.
    [APPLICATION_STATUS.REJECTED]: {},
    [APPLICATION_STATUS.WITHDRAWN]: {},
    [APPLICATION_STATUS.OFFER_DECLINED]: {},
    [APPLICATION_STATUS.HIRED]: {},
};

/* ================================================================== */
/* INTERVIEW (brief §8)                                                 */
/* ================================================================== */

export const INTERVIEW_STATUS = {
    SCHEDULED: "SCHEDULED",
    RESCHEDULED: "RESCHEDULED",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    NO_SHOW: "NO_SHOW",
} as const;

export const INTERVIEW_TRANSITIONS: TransitionMap = {
    [INTERVIEW_STATUS.SCHEDULED]: {
        [INTERVIEW_STATUS.RESCHEDULED]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.IN_PROGRESS]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.COMPLETED]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.CANCELLED]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.NO_SHOW]: { actors: RECRUITERS },
    },
    [INTERVIEW_STATUS.RESCHEDULED]: {
        [INTERVIEW_STATUS.IN_PROGRESS]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.COMPLETED]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.CANCELLED]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.NO_SHOW]: { actors: RECRUITERS },
    },
    [INTERVIEW_STATUS.IN_PROGRESS]: {
        [INTERVIEW_STATUS.COMPLETED]: { actors: RECRUITERS },
        [INTERVIEW_STATUS.NO_SHOW]: { actors: RECRUITERS },
    },
    [INTERVIEW_STATUS.COMPLETED]: {},
    [INTERVIEW_STATUS.CANCELLED]: {},
    [INTERVIEW_STATUS.NO_SHOW]: {},
};

/* ================================================================== */
/* OFFER (brief §14)                                                    */
/* ================================================================== */

export const OFFER_STATUS = {
    DRAFT: "DRAFT",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    APPROVED: "APPROVED",
    SENT: "SENT",
    VIEWED: "VIEWED",
    ACCEPTED: "ACCEPTED",
    DECLINED: "DECLINED",
    EXPIRED: "EXPIRED",
    WITHDRAWN: "WITHDRAWN",
} as const;

export const OFFER_TRANSITIONS: TransitionMap = {
    [OFFER_STATUS.DRAFT]: {
        [OFFER_STATUS.PENDING_APPROVAL]: { actors: RECRUITERS },
        [OFFER_STATUS.WITHDRAWN]: { actors: RECRUITERS },
    },
    [OFFER_STATUS.PENDING_APPROVAL]: {
        [OFFER_STATUS.APPROVED]: { actors: ["FINANCE", "HR", "ADMIN", "SUPER_ADMIN"] },
        [OFFER_STATUS.DRAFT]: { actors: RECRUITERS },
        [OFFER_STATUS.WITHDRAWN]: { actors: RECRUITERS },
    },
    [OFFER_STATUS.APPROVED]: {
        [OFFER_STATUS.SENT]: { actors: RECRUITERS },
        [OFFER_STATUS.DRAFT]: { actors: RECRUITERS },
        [OFFER_STATUS.WITHDRAWN]: { actors: RECRUITERS },
    },
    [OFFER_STATUS.SENT]: {
        [OFFER_STATUS.VIEWED]: { actors: RECRUITERS },
        [OFFER_STATUS.ACCEPTED]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
        [OFFER_STATUS.DECLINED]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
        [OFFER_STATUS.EXPIRED]: { actors: RECRUITERS },
        [OFFER_STATUS.WITHDRAWN]: { actors: RECRUITERS },
        // Re-offer: revise and re-send as a new version.
        [OFFER_STATUS.DRAFT]: { actors: RECRUITERS },
    },
    [OFFER_STATUS.VIEWED]: {
        [OFFER_STATUS.ACCEPTED]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
        [OFFER_STATUS.DECLINED]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
        [OFFER_STATUS.EXPIRED]: { actors: RECRUITERS },
        [OFFER_STATUS.DRAFT]: { actors: RECRUITERS },
    },
    [OFFER_STATUS.ACCEPTED]: {},
    [OFFER_STATUS.DECLINED]: {},
    [OFFER_STATUS.EXPIRED]: {},
    [OFFER_STATUS.WITHDRAWN]: {},
};

/* ================================================================== */
/* EMPLOYEE LIFECYCLE (brief §40)                                       */
/* ================================================================== */

export const EMPLOYEE_LIFECYCLE = {
    PRE_JOINING: "PRE_JOINING",
    ACTIVE: "ACTIVE",
    PROBATION: "PROBATION",
    CONFIRMED: "CONFIRMED",
    ON_LEAVE: "ON_LEAVE",
    NOTICE_PERIOD: "NOTICE_PERIOD",
    RESIGNED: "RESIGNED",
    TERMINATED: "TERMINATED",
    EXITED: "EXITED",
} as const;

/**
 * Lifecycle transitions. `ON_LEAVE` is a temporary overlay that returns to the
 * underlying employment state, so a confirmed employee on leave is still
 * CONFIRMED when they return.
 */
export const LIFECYCLE_TRANSITIONS: TransitionMap = {
    [EMPLOYEE_LIFECYCLE.PRE_JOINING]: {
        [EMPLOYEE_LIFECYCLE.PROBATION]: { actors: RECRUITERS },
        [EMPLOYEE_LIFECYCLE.ACTIVE]: { actors: RECRUITERS },
    },
    [EMPLOYEE_LIFECYCLE.ACTIVE]: {
        [EMPLOYEE_LIFECYCLE.PROBATION]: { actors: RECRUITERS },
        [EMPLOYEE_LIFECYCLE.CONFIRMED]: { actors: RECRUITERS },
        [EMPLOYEE_LIFECYCLE.ON_LEAVE]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
        [EMPLOYEE_LIFECYCLE.NOTICE_PERIOD]: { actors: RECRUITERS },
        [EMPLOYEE_LIFECYCLE.TERMINATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [EMPLOYEE_LIFECYCLE.PROBATION]: {
        [EMPLOYEE_LIFECYCLE.CONFIRMED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [EMPLOYEE_LIFECYCLE.ACTIVE]: { actors: RECRUITERS },
        [EMPLOYEE_LIFECYCLE.TERMINATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [EMPLOYEE_LIFECYCLE.CONFIRMED]: {
        [EMPLOYEE_LIFECYCLE.ON_LEAVE]: { actors: [...RECRUITERS, "STAFF", "MANAGER"] },
        [EMPLOYEE_LIFECYCLE.NOTICE_PERIOD]: { actors: RECRUITERS },
        [EMPLOYEE_LIFECYCLE.TERMINATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [EMPLOYEE_LIFECYCLE.ON_LEAVE]: {
        // Returns to the substantive state, not always ACTIVE.
        [EMPLOYEE_LIFECYCLE.ACTIVE]: { actors: [...RECRUITERS, "MANAGER"] },
        [EMPLOYEE_LIFECYCLE.CONFIRMED]: { actors: [...RECRUITERS, "MANAGER"] },
        [EMPLOYEE_LIFECYCLE.PROBATION]: { actors: [...RECRUITERS, "MANAGER"] },
        [EMPLOYEE_LIFECYCLE.NOTICE_PERIOD]: { actors: RECRUITERS },
        [EMPLOYEE_LIFECYCLE.TERMINATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [EMPLOYEE_LIFECYCLE.NOTICE_PERIOD]: {
        [EMPLOYEE_LIFECYCLE.EXITED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        // Resignation can be withdrawn before the last working day.
        [EMPLOYEE_LIFECYCLE.ACTIVE]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [EMPLOYEE_LIFECYCLE.CONFIRMED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [EMPLOYEE_LIFECYCLE.TERMINATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [EMPLOYEE_LIFECYCLE.RESIGNED]: {
        [EMPLOYEE_LIFECYCLE.EXITED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [EMPLOYEE_LIFECYCLE.TERMINATED]: {
        [EMPLOYEE_LIFECYCLE.EXITED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    // Terminal.
    [EMPLOYEE_LIFECYCLE.EXITED]: {},
};
