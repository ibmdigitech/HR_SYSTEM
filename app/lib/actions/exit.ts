'use server';

/**
 * Exit lifecycle server actions (resignation / termination / end of contract).
 *
 * This file is a thin, permission-checked adapter. The status vocabulary and the
 * legal moves live in `lib/workflow/exit/state-machine.ts`; this file owns three
 * things and nothing else:
 *
 *  1. AUTHORIZATION — every action starts with a helper from
 *     `lib/auth/guards.ts`. There is no raw role-string comparison in this file,
 *     and the state machine's actor list is a second, independent check rather
 *     than the only one.
 *  2. DOUBLE-SUBMIT PROTECTION — the status is re-read, then re-validated
 *     INSIDE the transaction with a guarded `updateMany({ where: { id, status } })`.
 *     A second click matches zero rows and the whole transaction aborts, so a
 *     decision cannot be recorded twice. This is the same pattern as
 *     `lib/workflow/leave.ts:190`.
 *  3. THE `{ success, message }` SHAPE the existing actions return.
 *
 * NOT WIRED HERE, DELIBERATELY: `prepareSettlement` / `advanceSettlement` from
 * `lib/workflow/offboarding.ts` and `revokeAccess()` from
 * `lib/workflow/credentials.ts`. This task establishes the case; the next task
 * hooks settlement into SETTLEMENT_PENDING and revokes access on COMPLETED. See
 * the report for the exact call sites.
 *
 * Because this file carries a file-level "use server" directive it may only
 * export async functions. Constants such as `EXIT_STATUS` are imported directly
 * from `@/lib/workflow/exit/state-machine` by anything that needs them.
 */

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
    requireAnyPermission,
    requirePermission,
    AuthenticationError,
    AuthorizationError,
} from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { notifyInApp } from "@/lib/workflow/notifications";
import {
    EXIT_STATUS,
    EXIT_TYPE,
    EXIT_TYPES,
    EXIT_TRANSITIONS,
    REHIRE_ELIGIBILITY_STATES,
    assertTransition,
    resolveNoticePeriodDays,
    InvalidTransitionError,
    type ExitType,
} from "@/lib/workflow/exit/state-machine";

export interface ExitActionResult {
    success: boolean;
    message: string;
    exitCaseId?: string;
    status?: string;
}

/** States in which a case is still open. A second live case is refused. */
const LIVE_STATES: readonly string[] = [
    EXIT_STATUS.REQUESTED,
    EXIT_STATUS.PENDING_APPROVAL,
    EXIT_STATUS.APPROVED,
    EXIT_STATUS.NOTICE_PERIOD,
    EXIT_STATUS.INTERVIEW_PENDING,
    EXIT_STATUS.INTERVIEW_COMPLETED,
    EXIT_STATUS.CLEARANCE_PENDING,
    EXIT_STATUS.SETTLEMENT_PENDING,
];

function revalidateExitViews() {
    revalidatePath("/dashboard/approvals");
    revalidatePath("/employees");
}

function notFound(): ExitActionResult {
    return { success: false, message: "Exit case not found." };
}

/** Returned for a supplied-but-unparseable date, so "absent" and "bad" differ. */
const INVALID_DATE = Symbol("invalid-date");

/**
 * `null` means the caller did not supply a date and the stored value should be
 * left alone. `INVALID_DATE` means they did supply one and it is nonsense.
 * Collapsing those two would make every optional date look invalid.
 */
function parseDateInput(value: string | undefined): Date | null | typeof INVALID_DATE {
    if (value === undefined) return null;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? INVALID_DATE : parsed;
}

/** Maps a thrown guard/transition/concurrency error onto the shared result shape. */
function toResult(error: unknown, context: string): ExitActionResult {
    if (error instanceof AuthenticationError) {
        return { success: false, message: "Not signed in" };
    }
    if (error instanceof AuthorizationError) {
        return { success: false, message: error.message };
    }
    if (error instanceof InvalidTransitionError) {
        return { success: false, message: `Not permitted: ${error.message}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === "CONCURRENT_MODIFICATION") {
        return {
            success: false,
            message: "This exit case changed a moment ago. Reload and try again.",
        };
    }
    if (message.startsWith("NO_NOTICE_POLICY")) {
        return { success: false, message: message.replace("NO_NOTICE_POLICY: ", "") };
    }
    if (message.startsWith("CASE_NOT_ASSESSABLE")) {
        return { success: false, message: message.replace("CASE_NOT_ASSESSABLE: ", "") };
    }
    // P2002 — the unique constraint on `ExitInterview.exitCaseId` and
    // `RehireRecord.exitCaseId` firing is a double submission, not corruption.
    if (message.includes("P2002") || message.includes("Unique constraint")) {
        return { success: false, message: "That record already exists. Reload and try again." };
    }
    console.error(`[${context}]`, error);
    return { success: false, message: "Could not complete the request. Nothing was changed." };
}

/** Asserts the move is legal for this actor, converting refusal into a message. */
function assertMove(
    from: string,
    to: string,
    actor: { id: string; role: string }
): ExitActionResult | null {
    try {
        assertTransition("EXIT", EXIT_TRANSITIONS, from, to, {
            actorRole: actor.role,
            actorId: actor.id,
        });
        return null;
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            return { success: false, message: `Not permitted: ${error.message}` };
        }
        throw error;
    }
}

/* ------------------------------------------------------------------ */
/* 1. INITIATE                                                         */
/* ------------------------------------------------------------------ */

/**
 * Opens an exit case.
 *
 * NOTHING STATUTORY IS INFERRED. The notice period must arrive from the caller
 * or from `EXIT_POLICY`; when neither is configured the request is refused with
 * an explicit message rather than defaulting to a plausible-looking number.
 */
export async function initiateExitCase(input: {
    employeeId: string;
    type: string;
    reason?: string;
    effectiveDate?: string;
    lastWorkingDate?: string;
    noticePeriodDays?: number;
    decisionNote?: string;
}): Promise<ExitActionResult> {
    try {
        const user = await requireAnyPermission([
            PERMISSIONS.RESIGNATION_CREATE,
            PERMISSIONS.TERMINATION_CREATE,
            PERMISSIONS.EMPLOYEES_EDIT,
        ]);

        if (!EXIT_TYPES.includes(input.type as ExitType)) {
            return { success: false, message: `Unknown exit type: ${input.type}` };
        }
        const type = input.type as ExitType;

        const employee = await prisma.employee.findUnique({
            where: { id: input.employeeId },
            select: { id: true, firstName: true, lastName: true, isActive: true },
        });
        if (!employee) return { success: false, message: "Employee not found." };
        if (!employee.isActive) {
            return {
                success: false,
                message: "This employee is already marked inactive; an exit case cannot be opened.",
            };
        }

        const effectiveDate = parseDateInput(input.effectiveDate);
        const lastWorkingDate = parseDateInput(input.lastWorkingDate);
        if (effectiveDate === INVALID_DATE || lastWorkingDate === INVALID_DATE) {
            return { success: false, message: "Invalid date." };
        }
        // A last working day more than a year in the past is a data-entry error,
        // not a retroactive exit. Mirrors lib/workflow/offboarding.ts.
        if (lastWorkingDate && lastWorkingDate.getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000) {
            return { success: false, message: "Last working date is more than a year in the past." };
        }

        // --- Notice period: input, or company policy, or an explicit refusal.
        const noticePeriodDays =
            input.noticePeriodDays ?? resolveNoticePeriodDays(type);
        if (noticePeriodDays === null || noticePeriodDays === undefined) {
            return {
                success: false,
                message:
                    "NO_NOTICE_POLICY: Notice period is not configured. Enter the agreed " +
                    "notice period for this exit, or configure EXIT_POLICY.noticePeriodDaysByExitType " +
                    "in lib/workflow/exit/state-machine.ts from company policy. It is not guessed.",
            };
        }
        if (!Number.isInteger(noticePeriodDays) || noticePeriodDays < 0) {
            return { success: false, message: "Notice period must be a whole number of days." };
        }

        const created = await prisma.$transaction(async (tx) => {
            // Re-checked inside the transaction. Prisma cannot express a partial
            // unique index on "not in a terminal state", so one-live-case-per-
            // employee is enforced here; the worst a race can produce is a second
            // open case, never a destroyed record.
            const existing = await tx.exitCase.findFirst({
                where: { employeeId: employee.id, status: { in: [...LIVE_STATES] } },
                select: { id: true, status: true },
            });
            if (existing) {
                throw new Error(`LIVE_CASE_EXISTS:${existing.id}:${existing.status}`);
            }

            const exitCase = await tx.exitCase.create({
                data: {
                    employeeId: employee.id,
                    type,
                    status: EXIT_STATUS.REQUESTED,
                    reason: input.reason ?? null,
                    decisionNote: input.decisionNote ?? null,
                    effectiveDate: effectiveDate ?? null,
                    lastWorkingDate: lastWorkingDate ?? null,
                    noticePeriodDays,
                    initiatedById: user.id,
                },
                select: { id: true, status: true },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: employee.id,
                    action: "EXIT_INITIATED",
                    details:
                        `Exit case opened (${type}) for ${employee.firstName} ${employee.lastName}. ` +
                        `Notice period ${noticePeriodDays} day(s). Reason: ${input.reason ?? "not stated"}`,
                    changedBy: user.email,
                },
            });

            return exitCase;
        });

        revalidateExitViews();
        await notifyInApp({
            employeeId: employee.id,
            title: "Exit process started",
            message: `A ${type.toLowerCase().replace(/_/g, " ")} case has been opened for you.`,
            type: "WARNING",
            link: "/dashboard",
        });

        return {
            success: true,
            message: "Exit case opened.",
            exitCaseId: created.id,
            status: created.status,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("LIVE_CASE_EXISTS:")) {
            const [, id, status] = message.split(":");
            return {
                success: false,
                message: `An exit case is already open for this employee (${status}).`,
                exitCaseId: id,
                status,
            };
        }
        return toResult(error, "INITIATE_EXIT_FAILED");
    }
}

/* ------------------------------------------------------------------ */
/* 2 & 3. APPROVE / REJECT                                             */
/* ------------------------------------------------------------------ */

async function decideExit(
    exitCaseId: string,
    decision: typeof EXIT_STATUS.APPROVED | typeof EXIT_STATUS.REJECTED,
    input: { decisionNote?: string; effectiveDate?: string; lastWorkingDate?: string; noticePeriodDays?: number }
): Promise<ExitActionResult> {
    try {
        const user = await requireAnyPermission([
            PERMISSIONS.RESIGNATION_APPROVE,
            PERMISSIONS.TERMINATION_APPROVE,
        ]);

        const exitCase = await prisma.exitCase.findUnique({
            where: { id: exitCaseId },
            select: { id: true, employeeId: true, type: true, status: true, decisionNote: true, employee: { select: { firstName: true, lastName: true } } },
        });
        if (!exitCase) return notFound();

        // Nobody decides their own departure.
        if (user.employeeId && exitCase.employeeId === user.employeeId) {
            return { success: false, message: "You cannot decide your own exit case." };
        }

        const note = input.decisionNote?.trim();
        if (decision === EXIT_STATUS.REJECTED && !note) {
            return {
                success: false,
                message: "A rejection must record why. The note is kept on the case.",
            };
        }

        const refused = assertMove(exitCase.status, decision, { id: user.id, role: user.role });
        if (refused) return refused;

        const effectiveDate = parseDateInput(input.effectiveDate);
        const lastWorkingDate = parseDateInput(input.lastWorkingDate);
        if (effectiveDate === INVALID_DATE || lastWorkingDate === INVALID_DATE) {
            return { success: false, message: "Invalid date." };
        }
        if (input.noticePeriodDays !== undefined) {
            if (!Number.isInteger(input.noticePeriodDays) || input.noticePeriodDays < 0) {
                return { success: false, message: "Notice period must be a whole number of days." };
            }
        }

        await prisma.$transaction(async (tx) => {
            // --- Guarded state update. The `where` pins the status read a moment
            // ago, so a concurrent second decision matches zero rows and aborts.
            const updated = await tx.exitCase.updateMany({
                where: { id: exitCase.id, status: exitCase.status },
                data: {
                    status: decision,
                    decidedById: user.id,
                    decidedAt: new Date(),
                    // A rejection always carries a note (enforced above); an
                    // approval keeps whatever the case already recorded unless a
                    // new note is supplied. It is never blanked by a later call.
                    decisionNote: note ?? exitCase.decisionNote ?? null,
                    ...(effectiveDate ? { effectiveDate } : {}),
                    ...(lastWorkingDate ? { lastWorkingDate } : {}),
                    ...(input.noticePeriodDays !== undefined
                        ? { noticePeriodDays: input.noticePeriodDays }
                        : {}),
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.auditLog.create({
                data: {
                    employeeId: exitCase.employeeId,
                    action: `EXIT_${decision}`,
                    details:
                        `Exit case ${exitCase.id} (${exitCase.type}) ${exitCase.status} → ${decision} ` +
                        `for ${exitCase.employee?.firstName ?? ""} ${exitCase.employee?.lastName ?? ""}` +
                        (note ? ` — ${note}` : ""),
                    changedBy: user.email,
                },
            });
        });

        revalidateExitViews();
        await notifyInApp({
            employeeId: exitCase.employeeId,
            title: decision === EXIT_STATUS.APPROVED ? "Exit approved" : "Exit request declined",
            message:
                decision === EXIT_STATUS.APPROVED
                    ? `Your ${exitCase.type.toLowerCase().replace(/_/g, " ")} has been approved.`
                    : `Your ${exitCase.type.toLowerCase().replace(/_/g, " ")} was not approved.`,
            type: decision === EXIT_STATUS.APPROVED ? "WARNING" : "INFO",
            link: "/dashboard",
        });

        return {
            success: true,
            message: decision === EXIT_STATUS.APPROVED ? "Exit case approved." : "Exit case rejected.",
            exitCaseId: exitCase.id,
            status: decision,
        };
    } catch (error) {
        return toResult(error, `EXIT_${decision}_FAILED`);
    }
}

export async function approveExitCase(
    exitCaseId: string,
    input: {
        decisionNote?: string;
        effectiveDate?: string;
        lastWorkingDate?: string;
        noticePeriodDays?: number;
    } = {}
): Promise<ExitActionResult> {
    return decideExit(exitCaseId, EXIT_STATUS.APPROVED, input);
}

export async function rejectExitCase(
    exitCaseId: string,
    input: { decisionNote: string }
): Promise<ExitActionResult> {
    return decideExit(exitCaseId, EXIT_STATUS.REJECTED, input);
}

/* ------------------------------------------------------------------ */
/* 4. EXIT INTERVIEW                                                   */
/* ------------------------------------------------------------------ */

/**
 * Records the exit interview and advances the case to INTERVIEW_COMPLETED.
 *
 * `wouldRejoin` is nullable on purpose: null means the question was not asked or
 * was declined, which is different from "no". Nothing here defaults it.
 */
export async function recordExitInterview(input: {
    exitCaseId: string;
    rating?: number;
    wouldRejoin?: boolean;
    comments?: string;
}): Promise<ExitActionResult> {
    try {
        const user = await requirePermission(PERMISSIONS.EXIT_INTERVIEW);

        if (
            input.rating !== undefined &&
            (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
        ) {
            return { success: false, message: "Rating must be a whole number from 1 to 5." };
        }

        const exitCase = await prisma.exitCase.findUnique({
            where: { id: input.exitCaseId },
            select: { id: true, employeeId: true, status: true, interview: { select: { id: true } } },
        });
        if (!exitCase) return notFound();
        if (exitCase.interview) {
            return {
                success: false,
                message: "An exit interview has already been recorded for this case.",
            };
        }

        const refused = assertMove(exitCase.status, EXIT_STATUS.INTERVIEW_COMPLETED, {
            id: user.id,
            role: user.role,
        });
        if (refused) return refused;

        await prisma.$transaction(async (tx) => {
            // Same guarded re-validation as the decision path: a double click
            // matches zero rows here and never reaches the interview insert.
            const updated = await tx.exitCase.updateMany({
                where: { id: exitCase.id, status: exitCase.status },
                data: { status: EXIT_STATUS.INTERVIEW_COMPLETED },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.exitInterview.create({
                data: {
                    exitCaseId: exitCase.id,
                    conductedById: user.id,
                    rating: input.rating ?? null,
                    wouldRejoin: input.wouldRejoin ?? null,
                    comments: input.comments ?? null,
                },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: exitCase.employeeId,
                    action: "EXIT_INTERVIEW_RECORDED",
                    details:
                        `Exit interview recorded for case ${exitCase.id} ` +
                        `(rating ${input.rating ?? "not scored"}, would rejoin ` +
                        `${input.wouldRejoin === undefined || input.wouldRejoin === null ? "not asked" : input.wouldRejoin ? "yes" : "no"})`,
                    changedBy: user.email,
                },
            });
        });

        revalidateExitViews();
        return {
            success: true,
            message: "Exit interview recorded.",
            exitCaseId: exitCase.id,
            status: EXIT_STATUS.INTERVIEW_COMPLETED,
        };
    } catch (error) {
        return toResult(error, "RECORD_EXIT_INTERVIEW_FAILED");
    }
}

/* ------------------------------------------------------------------ */
/* 5. REHIRE ELIGIBILITY                                               */
/* ------------------------------------------------------------------ */

/**
 * Records whether this former employee may be rehired.
 *
 * Guarded with EXIT_CLEARANCE because no `exit.rehire` capability exists yet;
 * inventing a permission string here would create one nothing grants. Adding
 * `PERMISSIONS.EXIT_REHIRE` to `lib/auth/permissions.ts` and the HR grant list
 * is the clean follow-up.
 *
 * This does NOT move the case status, so there is no `updateMany` guard here;
 * instead the case status is re-read inside the transaction so an assessment
 * cannot be recorded against a case that was rejected a moment earlier.
 */
export async function recordRehireEligibility(input: {
    exitCaseId: string;
    eligible: boolean;
    notes?: string;
}): Promise<ExitActionResult> {
    try {
        const user = await requirePermission(PERMISSIONS.EXIT_CLEARANCE);

        const exitCase = await prisma.exitCase.findUnique({
            where: { id: input.exitCaseId },
            select: { id: true, employeeId: true, status: true },
        });
        if (!exitCase) return notFound();
        if (!REHIRE_ELIGIBILITY_STATES.includes(exitCase.status)) {
            return {
                success: false,
                message: `Rehire eligibility can only be assessed once a case has been approved (current: ${exitCase.status}).`,
            };
        }

        await prisma.$transaction(async (tx) => {
            const current = await tx.exitCase.findUnique({
                where: { id: input.exitCaseId },
                select: { status: true, employeeId: true },
            });
            if (!current || !REHIRE_ELIGIBILITY_STATES.includes(current.status)) {
                throw new Error(
                    `CASE_NOT_ASSESSABLE: The exit case changed to ${
                        current?.status ?? "unknown"
                    } and can no longer be assessed. Reload and try again.`
                );
            }

            // Upsert on the unique exitCaseId: re-assessment replaces the current
            // answer rather than accumulating contradictions. The audit row below
            // is what keeps the previous answer recoverable.
            await tx.rehireRecord.upsert({
                where: { exitCaseId: exitCase.id },
                update: {
                    eligible: input.eligible,
                    assessedAt: new Date(),
                    assessedById: user.id,
                    notes: input.notes ?? null,
                },
                create: {
                    employeeId: current.employeeId,
                    exitCaseId: exitCase.id,
                    eligible: input.eligible,
                    assessedById: user.id,
                    notes: input.notes ?? null,
                },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: current.employeeId,
                    action: "REHIRE_ELIGIBILITY_RECORDED",
                    details:
                        `Rehire eligibility for case ${exitCase.id} set to ` +
                        `${input.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}` +
                        (input.notes ? ` — ${input.notes}` : ""),
                    changedBy: user.email,
                },
            });
        });

        revalidateExitViews();
        return {
            success: true,
            message: input.eligible ? "Marked eligible for rehire." : "Marked not eligible for rehire.",
            exitCaseId: exitCase.id,
        };
    } catch (error) {
        return toResult(error, "RECORD_REHIRE_ELIGIBILITY_FAILED");
    }
}
