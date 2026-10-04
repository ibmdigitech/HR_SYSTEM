/**
 * Explicit workflow state machines (P1).
 *
 * No server action anywhere in this codebase may accept an arbitrary status
 * value from the browser. Every transition goes through `assertTransition`,
 * which answers three questions:
 *
 *   1. Is the current state a real state?
 *   2. Is the requested transition one the workflow actually permits?
 *   3. Is the actor allowed to perform it?
 *
 * Transition guards (eligibility rules) live in the caller's `guard` callback
 * so this module stays dependency-free and testable.
 *
 * The map is deliberately explicit rather than generated: an auditor should be
 * able to read every legal transition without running code.
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

export interface TransitionCheck {
    allowed: boolean;
    reason?: string;
}

export interface TransitionDefinition {
    /** Actor roles permitted to perform this transition. Empty = any actor. */
    actors?: readonly string[];
    /** Extra business rule. Returning a string blocks the transition. */
    guard?: (context: TransitionContext) => string | null;
}

export interface TransitionContext {
    from: string;
    to: string;
    /** Role of the actor attempting the transition. */
    actorRole: string;
    actorId?: string | null;
    /** Free-form payload the guard may inspect. */
    data?: Record<string, unknown>;
}

export type TransitionMap = Record<string, Record<string, TransitionDefinition>>;

/**
 * Validates a transition. Returns the permitted states for UI rendering, and
 * throws `InvalidTransitionError` when the move is not legal.
 *
 * Throwing is intentional: a caller that ignores the result is a bug, and a
 * silent `false` is easy to drop.
 */
export function assertTransition(
    workflow: string,
    transitions: TransitionMap,
    from: string,
    to: string,
    context: Omit<TransitionContext, "from" | "to">
): void {
    const allowedTargets = transitions[from];

    // An unknown current state is a hard error, not a permissive default.
    if (!allowedTargets) {
        throw new InvalidTransitionError(workflow, from, to);
    }

    const definition = allowedTargets[to];
    if (!definition) {
        throw new InvalidTransitionError(workflow, from, to);
    }

    if (definition.actors && definition.actors.length > 0) {
        const role = String(context.actorRole ?? "").toUpperCase();
        if (!definition.actors.includes(role)) {
            throw new InvalidTransitionError(workflow, from, to);
        }
    }

    if (definition.guard) {
        const reason = definition.guard({ from, to, ...context });
        if (reason) {
            throw new InvalidTransitionError(workflow, from, to);
        }
    }
}

/** Non-throwing variant, for deciding what buttons to render. */
export function canTransition(
    transitions: TransitionMap,
    from: string,
    to: string,
    context: Omit<TransitionContext, "from" | "to">
): TransitionCheck {
    try {
        assertTransition("probe", transitions, from, to, context);
        return { allowed: true };
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            return { allowed: false, reason: (error instanceof Error ? error.message : "Unknown error") };
        }
        throw error;
    }
}

/** All targets reachable from a state, ignoring actor and guards. */
export function nextStates(transitions: TransitionMap, from: string): string[] {
    return Object.keys(transitions[from] ?? {});
}

/* ------------------------------------------------------------------ */
/* LEAVE                                                               */
/* ------------------------------------------------------------------ */

export const LEAVE_STATUS = {
    PENDING_MANAGER: "PENDING_MANAGER",
    MANAGER_APPROVED: "MANAGER_APPROVED",
    PENDING_HR: "PENDING_HR",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    CANCELLED: "CANCELLED",
} as const;

export type LeaveStatus = (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS];

/**
 * Leave approval chain.
 *
 * HR review is reached ONLY when the policy requires it. `PENDING_HR` is
 * reachable from `PENDING_MANAGER` so the existing two-stage shape is
 * preserved, but a short leave goes straight from `PENDING_MANAGER` to
 * `APPROVED` when the policy says HR review is not required. The routing
 * decision is made in the action, not guessed here.
 */
export const LEAVE_TRANSITIONS: TransitionMap = {
    [LEAVE_STATUS.PENDING_MANAGER]: {
        [LEAVE_STATUS.MANAGER_APPROVED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.PENDING_HR]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.APPROVED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.REJECTED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.CANCELLED]: { actors: ["STAFF", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [LEAVE_STATUS.MANAGER_APPROVED]: {
        [LEAVE_STATUS.PENDING_HR]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.APPROVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.REJECTED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.CANCELLED]: { actors: ["STAFF", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [LEAVE_STATUS.PENDING_HR]: {
        [LEAVE_STATUS.APPROVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.REJECTED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [LEAVE_STATUS.CANCELLED]: { actors: ["STAFF", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    // Terminal states. A rejected or approved request cannot be revived; a
    // fresh request must be submitted.
    [LEAVE_STATUS.APPROVED]: {},
    [LEAVE_STATUS.REJECTED]: {},
    [LEAVE_STATUS.CANCELLED]: {},
};

/* ------------------------------------------------------------------ */
/* OFFBOARDING                                                         */
/* ------------------------------------------------------------------ */

export const OFFBOARDING_STATUS = {
    REQUESTED: "REQUESTED",
    IN_REVIEW: "IN_REVIEW",
    NOTICE_PERIOD: "NOTICE_PERIOD",
    CLEARANCE: "CLEARANCE",
    SETTLEMENT_PENDING: "SETTLEMENT_PENDING",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
} as const;

export type OffboardingStatus = (typeof OFFBOARDING_STATUS)[keyof typeof OFFBOARDING_STATUS];

/** Only HR/ADMIN may drive offboarding. Managers may request but not complete. */
export const OFFBOARDING_TRANSITIONS: TransitionMap = {
    [OFFBOARDING_STATUS.REQUESTED]: {
        [OFFBOARDING_STATUS.IN_REVIEW]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [OFFBOARDING_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [OFFBOARDING_STATUS.IN_REVIEW]: {
        [OFFBOARDING_STATUS.NOTICE_PERIOD]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [OFFBOARDING_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [OFFBOARDING_STATUS.NOTICE_PERIOD]: {
        [OFFBOARDING_STATUS.CLEARANCE]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [OFFBOARDING_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [OFFBOARDING_STATUS.CLEARANCE]: {
        [OFFBOARDING_STATUS.SETTLEMENT_PENDING]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [OFFBOARDING_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [OFFBOARDING_STATUS.SETTLEMENT_PENDING]: {
        [OFFBOARDING_STATUS.COMPLETED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [OFFBOARDING_STATUS.CANCELLED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [OFFBOARDING_STATUS.COMPLETED]: {},
    [OFFBOARDING_STATUS.CANCELLED]: {},
};

/* ------------------------------------------------------------------ */
/* SETTLEMENT                                                          */
/* ------------------------------------------------------------------ */

export const SETTLEMENT_STATUS = {
    DRAFT: "DRAFT",
    CALCULATED: "CALCULATED",
    UNDER_REVIEW: "UNDER_REVIEW",
    APPROVED: "APPROVED",
    PAID: "PAID",
} as const;

export const SETTLEMENT_TRANSITIONS: TransitionMap = {
    [SETTLEMENT_STATUS.DRAFT]: {
        [SETTLEMENT_STATUS.CALCULATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [SETTLEMENT_STATUS.CALCULATED]: {
        [SETTLEMENT_STATUS.UNDER_REVIEW]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [SETTLEMENT_STATUS.DRAFT]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [SETTLEMENT_STATUS.UNDER_REVIEW]: {
        [SETTLEMENT_STATUS.APPROVED]: { actors: ["ADMIN", "SUPER_ADMIN"] },
        [SETTLEMENT_STATUS.CALCULATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [SETTLEMENT_STATUS.APPROVED]: {
        [SETTLEMENT_STATUS.PAID]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
    },
    [SETTLEMENT_STATUS.PAID]: {},
};

/* ------------------------------------------------------------------ */
/* PAYROLL RUN                                                         */
/* ------------------------------------------------------------------ */

export const PAYROLL_RUN_STATUS = {
    DRAFT: "DRAFT",
    CALCULATING: "CALCULATING",
    CALCULATED: "CALCULATED",
    UNDER_REVIEW: "UNDER_REVIEW",
    APPROVED: "APPROVED",
    LOCKED: "LOCKED",
    PAID: "PAID",
    CANCELLED: "CANCELLED",
} as const;

export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUS)[keyof typeof PAYROLL_RUN_STATUS];

/**
 * A LOCKED run is terminal for editing. The only way out is CANCELLED, which
 * HR/ADMIN must do deliberately and which is audit-logged — there is no
 * accidental "unlock".
 */
export const PAYROLL_RUN_TRANSITIONS: TransitionMap = {
    [PAYROLL_RUN_STATUS.DRAFT]: {
        [PAYROLL_RUN_STATUS.CALCULATING]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN", "HR"] },
        [PAYROLL_RUN_STATUS.CANCELLED]: { actors: ["ADMIN", "SUPER_ADMIN"] },
    },
    [PAYROLL_RUN_STATUS.CALCULATING]: {
        [PAYROLL_RUN_STATUS.CALCULATED]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN", "HR"] },
        [PAYROLL_RUN_STATUS.CANCELLED]: { actors: ["ADMIN", "SUPER_ADMIN"] },
    },
    [PAYROLL_RUN_STATUS.CALCULATED]: {
        [PAYROLL_RUN_STATUS.UNDER_REVIEW]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN", "HR"] },
        [PAYROLL_RUN_STATUS.CALCULATED]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN", "HR"] },
        [PAYROLL_RUN_STATUS.CANCELLED]: { actors: ["ADMIN", "SUPER_ADMIN"] },
    },
    [PAYROLL_RUN_STATUS.UNDER_REVIEW]: {
        [PAYROLL_RUN_STATUS.APPROVED]: { actors: ["ADMIN", "SUPER_ADMIN"] },
        [PAYROLL_RUN_STATUS.CALCULATED]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN", "HR"] },
    },
    [PAYROLL_RUN_STATUS.APPROVED]: {
        [PAYROLL_RUN_STATUS.LOCKED]: { actors: ["ADMIN", "SUPER_ADMIN"] },
        [PAYROLL_RUN_STATUS.CALCULATED]: { actors: ["ADMIN", "SUPER_ADMIN"] },
    },
    // Terminal.
    [PAYROLL_RUN_STATUS.LOCKED]: {},
    [PAYROLL_RUN_STATUS.PAID]: {},
    [PAYROLL_RUN_STATUS.CANCELLED]: {},
};

/* ------------------------------------------------------------------ */
/* LETTER                                                              */
/* ------------------------------------------------------------------ */

export const LETTER_STATUS = {
    DRAFT: "DRAFT",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    GENERATED: "GENERATED",
    VOID: "VOID",
} as const;

export type LetterStatus = (typeof LETTER_STATUS)[keyof typeof LETTER_STATUS];

export const LETTER_TRANSITIONS: TransitionMap = {
    [LETTER_STATUS.DRAFT]: {
        [LETTER_STATUS.PENDING_APPROVAL]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [LETTER_STATUS.GENERATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [LETTER_STATUS.PENDING_APPROVAL]: {
        [LETTER_STATUS.APPROVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [LETTER_STATUS.REJECTED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [LETTER_STATUS.DRAFT]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [LETTER_STATUS.APPROVED]: {
        [LETTER_STATUS.GENERATED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        // A new version supersedes this one; the row is never overwritten.
        [LETTER_STATUS.DRAFT]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [LETTER_STATUS.REJECTED]: {
        [LETTER_STATUS.DRAFT]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [LETTER_STATUS.GENERATED]: {
        [LETTER_STATUS.VOID]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [LETTER_STATUS.DRAFT]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [LETTER_STATUS.VOID]: {},
};

/* ------------------------------------------------------------------ */
/* DOCUMENT RENEWAL                                                    */
/* ------------------------------------------------------------------ */

export const RENEWAL_STATUS = {
    REQUESTED: "REQUESTED",
    DOCUMENT_SUBMITTED: "DOCUMENT_SUBMITTED",
    UNDER_REVIEW: "UNDER_REVIEW",
    RENEWED: "RENEWED",
    REJECTED: "REJECTED",
    CANCELLED: "CANCELLED",
} as const;

export const RENEWAL_TRANSITIONS: TransitionMap = {
    [RENEWAL_STATUS.REQUESTED]: {
        [RENEWAL_STATUS.DOCUMENT_SUBMITTED]: { actors: ["STAFF", "HR", "ADMIN", "SUPER_ADMIN"] },
        [RENEWAL_STATUS.CANCELLED]: { actors: ["STAFF", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [RENEWAL_STATUS.DOCUMENT_SUBMITTED]: {
        [RENEWAL_STATUS.UNDER_REVIEW]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [RENEWAL_STATUS.UNDER_REVIEW]: {
        [RENEWAL_STATUS.RENEWED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [RENEWAL_STATUS.REJECTED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [RENEWAL_STATUS.RENEWED]: {},
    [RENEWAL_STATUS.REJECTED]: { [RENEWAL_STATUS.REQUESTED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] } },
    [RENEWAL_STATUS.CANCELLED]: {},
};

/* ------------------------------------------------------------------ */
/* SERVICE REQUEST                                                     */
/* ------------------------------------------------------------------ */

export const SERVICE_REQUEST_STATUS = {
    PENDING: "PENDING",
    MANAGER_APPROVED: "MANAGER_APPROVED",
    HR_APPROVED: "HR_APPROVED",
    PRO_PROCESSING: "PRO_PROCESSING",
    FINANCE_APPROVED: "FINANCE_APPROVED",
    COMPLETED: "COMPLETED",
    REJECTED: "REJECTED",
} as const;

export type ServiceRequestStatus =
    (typeof SERVICE_REQUEST_STATUS)[keyof typeof SERVICE_REQUEST_STATUS];

/**
 * Staff service request workflow.
 *
 * The existing schema already defined the status vocabulary
 * (PENDING → MANAGER_APPROVED → HR_APPROVED → PRO_PROCESSING →
 * FINANCE_APPROVED → COMPLETED, or REJECTED), but the action wrote the
 * non-existent value "APPROVED", so approvals produced a status nothing else
 * in the application recognised. This map uses the schema's own values.
 *
 * REJECTED is reachable from any in-flight stage. COMPLETED, REJECTED and
 * FINANCE_APPROVED are terminal for the requester.
 */
export const SERVICE_REQUEST_TRANSITIONS: TransitionMap = {
    [SERVICE_REQUEST_STATUS.PENDING]: {
        [SERVICE_REQUEST_STATUS.MANAGER_APPROVED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [SERVICE_REQUEST_STATUS.REJECTED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [SERVICE_REQUEST_STATUS.MANAGER_APPROVED]: {
        [SERVICE_REQUEST_STATUS.HR_APPROVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [SERVICE_REQUEST_STATUS.REJECTED]: { actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [SERVICE_REQUEST_STATUS.HR_APPROVED]: {
        [SERVICE_REQUEST_STATUS.PRO_PROCESSING]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [SERVICE_REQUEST_STATUS.REJECTED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [SERVICE_REQUEST_STATUS.PRO_PROCESSING]: {
        [SERVICE_REQUEST_STATUS.FINANCE_APPROVED]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
        [SERVICE_REQUEST_STATUS.COMPLETED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [SERVICE_REQUEST_STATUS.FINANCE_APPROVED]: {
        [SERVICE_REQUEST_STATUS.COMPLETED]: { actors: ["FINANCE", "HR", "ADMIN", "SUPER_ADMIN"] },
        [SERVICE_REQUEST_STATUS.REJECTED]: { actors: ["FINANCE", "ADMIN", "SUPER_ADMIN"] },
    },
    [SERVICE_REQUEST_STATUS.COMPLETED]: {},
    [SERVICE_REQUEST_STATUS.REJECTED]: {},
};

/* ------------------------------------------------------------------ */
/* CHECKLIST ITEM                                                      */
/* ------------------------------------------------------------------ */

export const CHECKLIST_STATUS = {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    WAIVED: "WAIVED",
    BLOCKED: "BLOCKED",
} as const;

export const CHECKLIST_TRANSITIONS: TransitionMap = {
    [CHECKLIST_STATUS.PENDING]: {
        [CHECKLIST_STATUS.IN_PROGRESS]: {},
        [CHECKLIST_STATUS.COMPLETED]: {},
        [CHECKLIST_STATUS.WAIVED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [CHECKLIST_STATUS.IN_PROGRESS]: {
        [CHECKLIST_STATUS.COMPLETED]: {},
        [CHECKLIST_STATUS.BLOCKED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [CHECKLIST_STATUS.PENDING]: {},
    },
    [CHECKLIST_STATUS.BLOCKED]: {
        [CHECKLIST_STATUS.IN_PROGRESS]: {},
    },
    // Terminal.
    [CHECKLIST_STATUS.COMPLETED]: {},
    [CHECKLIST_STATUS.WAIVED]: {},
};

/* ------------------------------------------------------------------ */
/* BUSINESS TRAVEL REQUEST                                             */
/* ------------------------------------------------------------------ */

export const TRAVEL_REQUEST_STATUS = {
    REQUESTED: "REQUESTED",
    PENDING_APPROVAL: "PENDING_APPROVAL",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
} as const;

export type TravelRequestStatus = (typeof TRAVEL_REQUEST_STATUS)[keyof typeof TRAVEL_REQUEST_STATUS];

/**
 * Blocker on the decision transitions, for MAKER-CHECKER reasons.
 *
 * An approver who is also the traveller can approve their own trip by pressing
 * one button, which is the same hole `EmployeeChangeRequest` is built to avoid.
 * The travel request's `requestedBy` is an email and the actor is an email, so
 * the comparison is by email rather than by employee id: HR may file a request
 * on an employee's behalf, and that request is still the employee's trip.
 */
function notSelfDecision(context: TransitionContext): string | null {
    const requester = context.data?.requestedBy;
    if (typeof requester === "string" && requester.length > 0 && requester === context.data?.actorEmail) {
        return "The requester cannot decide their own travel request.";
    }
    return null;
}

/**
 * Company-purpose travel outside the country.
 *
 * The request may be raised by the traveller (STAFF) or by HR on their behalf,
 * but only a role holding the travel approval permission may decide it, and
 * never the requester themselves.
 *
 * COMPLETED is the transition that consumes an entitlement ticket, so it is
 * deliberately a separate, later step from APPROVED: a trip being agreed is not
 * a ticket issued. `lib/workflow/business-travel.ts` increments the window's
 * usage counter inside the same transaction that moves the row to COMPLETED.
 */
export const TRAVEL_REQUEST_TRANSITIONS: TransitionMap = {
    [TRAVEL_REQUEST_STATUS.REQUESTED]: {
        [TRAVEL_REQUEST_STATUS.PENDING_APPROVAL]: { actors: ["STAFF", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
        [TRAVEL_REQUEST_STATUS.APPROVED]: {
            actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"],
            guard: notSelfDecision,
        },
        [TRAVEL_REQUEST_STATUS.REJECTED]: {
            actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"],
            guard: notSelfDecision,
        },
        [TRAVEL_REQUEST_STATUS.CANCELLED]: { actors: ["STAFF", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [TRAVEL_REQUEST_STATUS.PENDING_APPROVAL]: {
        [TRAVEL_REQUEST_STATUS.APPROVED]: {
            actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"],
            guard: notSelfDecision,
        },
        [TRAVEL_REQUEST_STATUS.REJECTED]: {
            actors: ["MANAGER", "HR", "ADMIN", "SUPER_ADMIN"],
            guard: notSelfDecision,
        },
        [TRAVEL_REQUEST_STATUS.CANCELLED]: { actors: ["STAFF", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [TRAVEL_REQUEST_STATUS.APPROVED]: {
        // HR records the ticket as issued, which is an administrative fact
        // rather than a judgement, so the requester may mark their own trip
        // completed once an approver has agreed it.
        [TRAVEL_REQUEST_STATUS.COMPLETED]: { actors: ["HR", "ADMIN", "SUPER_ADMIN"] },
        [TRAVEL_REQUEST_STATUS.CANCELLED]: { actors: ["STAFF", "MANAGER", "HR", "ADMIN", "SUPER_ADMIN"] },
    },
    [TRAVEL_REQUEST_STATUS.REJECTED]: {},
    [TRAVEL_REQUEST_STATUS.COMPLETED]: {},
    [TRAVEL_REQUEST_STATUS.CANCELLED]: {},
};
