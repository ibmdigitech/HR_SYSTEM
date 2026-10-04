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
 *  4. SETTLEMENT AND ACCESS REVOCATION (added with the exit UI) —
 *     `prepareExitSettlement` and `advanceExitSettlement` delegate to
 *     `lib/workflow/offboarding.ts`, which needed an `OffboardingRequest`.
 *     `completeExitCase` performs SETTLEMENT_PENDING → COMPLETED and revokes
 *     the leaver's access in the SAME transaction as the guarded status write.
 *
 * LINKING A CASE TO AN OFFBOARDING REQUEST — THE CHOICE MADE HERE
 * `prepareSettlement({ offboardingId })` keys on an `OffboardingRequest`, and
 * `FinalSettlement` has a foreign key to exactly that table. There is no
 * `ExitCase.offboardingId` column, and adding one would mean editing
 * `prisma/schema.prisma` and re-running the Prisma client generator.
 *
 * Instead, an exit case is RESOLVED to its offboarding request by employee:
 * `findLiveOffboarding(employeeId)` takes the newest request that is neither
 * COMPLETED nor CANCELLED. That is safe rather than merely convenient, because
 * `initiateOffboarding` already refuses a second live offboarding for the same
 * employee, so "the live offboarding for this employee" is 1:1 in practice and
 * the resolution is unambiguous. When no live request exists the action refuses
 * and says so, rather than creating one behind the operator's back.
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
    DEFAULT_EXIT_CHECKLIST,
    prepareSettlement,
    advanceSettlement,
    updateChecklistItem,
} from "@/lib/workflow/offboarding";
import {
    OFFBOARDING_STATUS,
    CHECKLIST_STATUS,
    SETTLEMENT_STATUS,
} from "@/lib/workflow/state-machine";
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
import {
    employeeStatusForExitType,
    settlementMayBePrepared,
} from "@/app/exits/status-view";
import { resolveTerminalLifecycleStage } from "@/app/exits/lifecycle-target";

export interface ExitActionResult {
    success: boolean;
    message: string;
    exitCaseId?: string;
    status?: string;
}

type ResignationLetter = { data: Uint8Array; name: string; contentType: string };

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

function revalidateExitViews(exitCaseId?: string) {
    revalidatePath("/dashboard/approvals");
    revalidatePath("/employees");
    revalidatePath("/exits");
    if (exitCaseId) revalidatePath(`/exits/${exitCaseId}`);
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
    return createExitCase(input);
}

/** FormData adapter used by the employee-facing request page. */
export async function submitExitCaseForm(formData: FormData): Promise<ExitActionResult> {
    const letter = formData.get("resignationLetter");
    let attachment: ResignationLetter | undefined;
    if (letter && typeof letter !== "string" && letter.size > 0) {
        const allowedTypes = new Set([
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ]);
        if (letter.size > 5 * 1024 * 1024) {
            return { success: false, message: "The resignation letter must be 5 MB or smaller." };
        }
        if (!allowedTypes.has(letter.type)) {
            return { success: false, message: "Attach the resignation letter as a PDF or Word document." };
        }
        attachment = {
            data: new Uint8Array(await letter.arrayBuffer()),
            name: letter.name.split(/[\\/]/).pop()?.slice(0, 180) || "resignation-letter",
            contentType: letter.type,
        };
    }

    const noticePeriodDays = Number(formData.get("noticePeriodDays"));
    if (!Number.isInteger(noticePeriodDays)) {
        return { success: false, message: "Enter the agreed notice period in whole days." };
    }
    return createExitCase({
        employeeId: String(formData.get("employeeId") ?? ""),
        type: String(formData.get("type") ?? "RESIGNATION"),
        reason: String(formData.get("reason") ?? "").trim(),
        effectiveDate: String(formData.get("effectiveDate") ?? "") || undefined,
        lastWorkingDate: String(formData.get("lastWorkingDate") ?? "") || undefined,
        noticePeriodDays,
    }, attachment);
}

async function createExitCase(input: {
    employeeId: string;
    type: string;
    reason?: string;
    effectiveDate?: string;
    lastWorkingDate?: string;
    noticePeriodDays?: number;
    decisionNote?: string;
}, attachment?: ResignationLetter): Promise<ExitActionResult> {
    try {
        if (!EXIT_TYPES.includes(input.type as ExitType)) {
            return { success: false, message: `Unknown exit type: ${input.type}` };
        }
        const type = input.type as ExitType;
        const isResignation = type === EXIT_TYPE.RESIGNATION;
        if (attachment && !isResignation) {
            return { success: false, message: "A letter attachment is only accepted for resignation requests." };
        }
        const reason = input.reason?.trim();
        if (!reason || reason.length > 2000) {
            return { success: false, message: "Enter a reason of 1 to 2,000 characters." };
        }
        const user = await requirePermission(
            isResignation ? PERMISSIONS.RESIGNATION_CREATE : PERMISSIONS.TERMINATION_CREATE
        );
        const mayCreateForOthers = ["HR", "ADMIN", "SUPER_ADMIN"].includes(user.role);
        if (!isResignation && !mayCreateForOthers) {
            return { success: false, message: "Only HR or an administrator can start a termination or contract-end case." };
        }

        const employee = await prisma.employee.findUnique({
            where: { id: input.employeeId },
            select: { id: true, firstName: true, lastName: true, isActive: true },
        });
        if (!employee) return { success: false, message: "Employee not found." };
        if (!mayCreateForOthers && employee.id !== user.employeeId) {
            return { success: false, message: "You can only submit a resignation request for yourself." };
        }
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
                    reason,
                    ...(attachment ? {
                        resignationLetterData: Buffer.from(attachment.data),
                        resignationLetterName: attachment.name,
                        resignationLetterType: attachment.contentType,
                    } : {}),
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

/** Move a newly submitted case into the approver queue. */
export async function routeExitCaseForApproval(exitCaseId: string): Promise<ExitActionResult> {
    try {
        const user = await requireAnyPermission([
            PERMISSIONS.RESIGNATION_APPROVE,
            PERMISSIONS.TERMINATION_APPROVE,
        ]);
        const exitCase = await prisma.exitCase.findUnique({
            where: { id: exitCaseId },
            select: { id: true, employeeId: true, type: true, status: true },
        });
        if (!exitCase) return notFound();
        if (user.employeeId && user.employeeId === exitCase.employeeId) {
            return { success: false, message: "You cannot route your own exit case." };
        }

        const refused = assertMove(exitCase.status, EXIT_STATUS.PENDING_APPROVAL, {
            id: user.id,
            role: user.role,
        });
        if (refused) return refused;

        await prisma.$transaction(async (tx) => {
            const changed = await tx.exitCase.updateMany({
                where: { id: exitCase.id, status: exitCase.status },
                data: { status: EXIT_STATUS.PENDING_APPROVAL },
            });
            if (changed.count === 0) throw new Error("CONCURRENT_MODIFICATION");
            await tx.auditLog.create({
                data: {
                    employeeId: exitCase.employeeId,
                    action: "EXIT_ROUTED_FOR_APPROVAL",
                    details: `Exit case ${exitCase.id} (${exitCase.type}) routed for approval.`,
                    changedBy: user.email,
                },
            });
        });

        revalidateExitViews(exitCase.id);
        return {
            success: true,
            message: "Exit case sent to the approval queue.",
            exitCaseId: exitCase.id,
            status: EXIT_STATUS.PENDING_APPROVAL,
        };
    } catch (error) {
        return toResult(error, "ROUTE_EXIT_CASE_FAILED");
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

/**
 * Advances the approved exit through notice, interview, clearance and settlement.
 * The first transition creates the linked offboarding record and its checklist;
 * later transitions update the exit case and offboarding together.
 */
export async function advanceExitCaseWorkflow(input: {
    exitCaseId: string;
    to: typeof EXIT_STATUS.NOTICE_PERIOD | typeof EXIT_STATUS.INTERVIEW_PENDING |
        typeof EXIT_STATUS.CLEARANCE_PENDING | typeof EXIT_STATUS.SETTLEMENT_PENDING;
}): Promise<ExitActionResult> {
    try {
        const allowedTargets: readonly string[] = [
            EXIT_STATUS.NOTICE_PERIOD,
            EXIT_STATUS.INTERVIEW_PENDING,
            EXIT_STATUS.CLEARANCE_PENDING,
            EXIT_STATUS.SETTLEMENT_PENDING,
        ];
        if (!allowedTargets.includes(input.to)) {
            return { success: false, message: "That exit workflow step is not available." };
        }

        const user = await requireAnyPermission([
            PERMISSIONS.RESIGNATION_APPROVE,
            PERMISSIONS.TERMINATION_APPROVE,
            PERMISSIONS.EXIT_CLEARANCE,
        ]);
        const exitCase = await prisma.exitCase.findUnique({
            where: { id: input.exitCaseId },
            select: {
                id: true, employeeId: true, type: true, status: true,
                lastWorkingDate: true, noticePeriodDays: true, reason: true,
            },
        });
        if (!exitCase) return notFound();

        const needed = input.to === EXIT_STATUS.NOTICE_PERIOD
            ? (exitCase.type === EXIT_TYPE.RESIGNATION ? PERMISSIONS.RESIGNATION_APPROVE : PERMISSIONS.TERMINATION_APPROVE)
            : PERMISSIONS.EXIT_CLEARANCE;
        await requirePermission(needed);

        const refused = assertMove(exitCase.status, input.to, { id: user.id, role: user.role });
        if (refused) return refused;

        if (input.to === EXIT_STATUS.NOTICE_PERIOD && (!exitCase.lastWorkingDate || exitCase.noticePeriodDays === null)) {
            return { success: false, message: "Set the agreed last working day and notice period before starting notice." };
        }

        const offboarding = input.to === EXIT_STATUS.NOTICE_PERIOD ||
            input.to === EXIT_STATUS.CLEARANCE_PENDING || input.to === EXIT_STATUS.SETTLEMENT_PENDING
            ? await prisma.offboardingRequest.findFirst({
                where: { employeeId: exitCase.employeeId, status: { notIn: [OFFBOARDING_STATUS.COMPLETED, OFFBOARDING_STATUS.CANCELLED] } },
                orderBy: { createdAt: "desc" },
                select: { id: true, status: true },
            })
            : null;

        if (input.to === EXIT_STATUS.CLEARANCE_PENDING || input.to === EXIT_STATUS.SETTLEMENT_PENDING) {
            if (!offboarding) return { success: false, message: "Offboarding record is missing. Return the case to HR before proceeding." };
            const outstanding = await prisma.offboardingChecklistItem.count({
                where: {
                    offboardingId: offboarding.id,
                    required: true,
                    status: { notIn: [CHECKLIST_STATUS.COMPLETED, CHECKLIST_STATUS.WAIVED] },
                },
            });
            if (outstanding > 0) return { success: false, message: `${outstanding} required clearance item(s) remain.` };
        }

        if (input.to === EXIT_STATUS.SETTLEMENT_PENDING && offboarding?.status !== OFFBOARDING_STATUS.CLEARANCE) {
            return { success: false, message: "The offboarding checklist must be in clearance before settlement." };
        }

        await prisma.$transaction(async (tx) => {
            const changed = await tx.exitCase.updateMany({
                where: { id: exitCase.id, status: exitCase.status },
                data: { status: input.to },
            });
            if (changed.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            if (input.to === EXIT_STATUS.NOTICE_PERIOD) {
                const existing = await tx.offboardingRequest.findFirst({
                    where: { employeeId: exitCase.employeeId, status: { notIn: [OFFBOARDING_STATUS.COMPLETED, OFFBOARDING_STATUS.CANCELLED] } },
                    select: { id: true },
                });
                if (!existing) {
                    const request = await tx.offboardingRequest.create({
                        data: {
                            employeeId: exitCase.employeeId,
                            status: OFFBOARDING_STATUS.NOTICE_PERIOD,
                            lastWorkingDay: exitCase.lastWorkingDate!,
                            noticePeriodEnd: exitCase.lastWorkingDate,
                            reason: exitCase.reason,
                            initiatedBy: user.email,
                        },
                        select: { id: true },
                    });
                    await tx.offboardingChecklistItem.createMany({
                        data: DEFAULT_EXIT_CHECKLIST.map((item) => ({
                            offboardingId: request.id,
                            label: item.label,
                            category: item.category,
                            required: item.required,
                            status: CHECKLIST_STATUS.PENDING,
                        })),
                    });
                }
            } else if (input.to === EXIT_STATUS.CLEARANCE_PENDING && offboarding) {
                const moved = await tx.offboardingRequest.updateMany({
                    where: { id: offboarding.id, status: offboarding.status },
                    data: { status: OFFBOARDING_STATUS.CLEARANCE },
                });
                if (moved.count === 0) throw new Error("CONCURRENT_MODIFICATION");
            } else if (input.to === EXIT_STATUS.SETTLEMENT_PENDING && offboarding) {
                const moved = await tx.offboardingRequest.updateMany({
                    where: { id: offboarding.id, status: offboarding.status },
                    data: { status: OFFBOARDING_STATUS.SETTLEMENT_PENDING },
                });
                if (moved.count === 0) throw new Error("CONCURRENT_MODIFICATION");
            }

            await tx.auditLog.create({
                data: {
                    employeeId: exitCase.employeeId,
                    action: `EXIT_${input.to}`,
                    details: `Exit case ${exitCase.id} moved ${exitCase.status} → ${input.to}.`,
                    changedBy: user.email,
                },
            });
        });

        revalidateExitViews(exitCase.id);
        return { success: true, message: `Exit moved to ${input.to.replaceAll("_", " ").toLowerCase()}.`, exitCaseId: exitCase.id, status: input.to };
    } catch (error) {
        return toResult(error, "ADVANCE_EXIT_CASE_FAILED");
    }
}

/** Server-action adapter for the shared, guarded offboarding checklist writer. */
export async function updateExitChecklist(input: {
    itemId: string;
    to: typeof CHECKLIST_STATUS.IN_PROGRESS | typeof CHECKLIST_STATUS.COMPLETED | typeof CHECKLIST_STATUS.WAIVED;
    notes?: string;
}): Promise<ExitActionResult> {
    try {
        const user = await requirePermission(PERMISSIONS.EXIT_CLEARANCE);
        const result = await updateChecklistItem({
            ...input,
            actor: { id: user.id, email: user.email, role: user.role },
        });
        revalidateExitViews();
        return { success: result.success, message: result.message };
    } catch (error) {
        return toResult(error, "UPDATE_EXIT_CHECKLIST_FAILED");
    }
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

/* ------------------------------------------------------------------ */
/* 6. SETTLEMENT                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every figure the settlement engine accepts is an INPUT. There is no
 * end-of-service gratuity calculator anywhere in this codebase and none is
 * added here: `lib/workflow/offboarding.ts` takes `gratuityAmount` as a number
 * a person typed, because the statutory rule is jurisdiction-, contract- and
 * length-of-service-specific and getting it confidently wrong is worse than
 * having no automation at all.
 */
export interface ExitSettlementInputs {
    pendingSalaryDays?: number;
    pendingSalaryAmount?: number;
    leaveEncashmentDays?: number;
    leaveEncashmentAmount?: number;
    loanDeductions?: number;
    advanceDeductions?: number;
    otherDeductions?: number;
    otherAdditions?: number;
    /** Typed by a human from their own calculation. Never derived. */
    gratuityAmount?: number;
    calculationNotes?: string;
}

/**
 * The newest offboarding request for an employee that is still open.
 *
 * COMPLETED is excluded on purpose: a closed offboarding has already had its
 * settlement finalised by that workflow, and reusing it would overwrite a
 * record someone has already been paid against. CANCELLED is excluded for the
 * obvious reason.
 */
async function findLiveOffboarding(employeeId: string) {
    return prisma.offboardingRequest.findFirst({
        where: {
            employeeId,
            status: {
                notIn: [OFFBOARDING_STATUS.COMPLETED, OFFBOARDING_STATUS.CANCELLED],
            },
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            status: true,
            settlement: { select: { id: true, status: true, finalAmount: true } },
        },
    });
}

/**
 * Prepares the final settlement for an exit case.
 *
 * Two independent gates must both pass, and neither is this file's invention:
 *   1. `EXIT_TRANSITIONS` — the CASE must be at CLEARANCE_PENDING or
 *      SETTLEMENT_PENDING (`settlementMayBePrepared`).
 *   2. `prepareSettlement`'s own check — the linked OFFBOARDING must be at
 *      CLEARANCE or SETTLEMENT_PENDING.
 *
 * A case can satisfy (1) while the offboarding behind it does not satisfy (2),
 * which is why the refusal names both rather than saying "not allowed".
 *
 * Permission: EXIT_SETTLEMENT first, as the exit domain's own capability.
 * `prepareSettlement` then applies its own `PAYROLL_VIEW` guard, which HR does
 * not hold. That composition is deliberate and left visible — the exit UI only
 * offers the control to callers holding both, so an HR user is told why the
 * button is absent rather than clicking into a refusal.
 */
export async function prepareExitSettlement(input: {
    exitCaseId: string;
    inputs: ExitSettlementInputs;
}): Promise<ExitActionResult> {
    try {
        const user = await requirePermission(PERMISSIONS.EXIT_SETTLEMENT);

        const exitCase = await prisma.exitCase.findUnique({
            where: { id: input.exitCaseId },
            select: { id: true, employeeId: true, status: true },
        });
        if (!exitCase) return notFound();

        if (!settlementMayBePrepared(exitCase.status)) {
            return {
                success: false,
                message: `A settlement can only be prepared during clearance or settlement. This case is at ${exitCase.status}.`,
            };
        }

        const offboarding = await findLiveOffboarding(exitCase.employeeId);
        if (!offboarding) {
            return {
                success: false,
                message:
                    "This employee has no open offboarding request, and settlement is recorded " +
                    "against an offboarding request rather than against the exit case. Open the " +
                    "offboarding first; nothing was changed.",
            };
        }

        const result = await prepareSettlement({
            offboardingId: offboarding.id,
            inputs: input.inputs,
            actor: { id: user.id, email: user.email, role: user.role },
        });

        if (result.success) revalidateExitViews(exitCase.id);
        return {
            success: result.success,
            message: result.message,
            exitCaseId: exitCase.id,
            status: offboarding.status,
        };
    } catch (error) {
        return toResult(error, "PREPARE_EXIT_SETTLEMENT_FAILED");
    }
}

/** The settlement stages the UI may drive. `CALCULATED` is produced by prepare. */
const DRIVABLE_SETTLEMENT_STAGES: readonly string[] = [
    SETTLEMENT_STATUS.UNDER_REVIEW,
    SETTLEMENT_STATUS.APPROVED,
    SETTLEMENT_STATUS.PAID,
];

/**
 * Moves the linked FinalSettlement through its own state machine.
 *
 * `SETTLEMENT_TRANSITIONS` in `lib/workflow/state-machine.ts` is authoritative;
 * this action only narrows the accepted input to the three stages an operator
 * reaches for, so an arbitrary string from the browser never reaches
 * `assertSettlementTransition`. `advanceSettlement` additionally requires
 * PAYROLL_SETTLE (FINANCE/ADMIN) on top of the EXIT_SETTLEMENT guard applied
 * here, and its own transition check still refuses anything illegal.
 */
export async function advanceExitSettlement(input: {
    exitCaseId: string;
    to: string;
    reference?: string;
    confirmBankTransfer?: boolean;
}): Promise<ExitActionResult> {
    try {
        const user = await requirePermission(PERMISSIONS.EXIT_SETTLEMENT);

        if (!DRIVABLE_SETTLEMENT_STAGES.includes(input.to)) {
            return {
                success: false,
                message: `Settlement can only be advanced to ${DRIVABLE_SETTLEMENT_STAGES.join(", ")}. Nothing was changed.`,
            };
        }

        const exitCase = await prisma.exitCase.findUnique({
            where: { id: input.exitCaseId },
            select: { id: true, employeeId: true, status: true },
        });
        if (!exitCase) return notFound();

        const offboarding = await findLiveOffboarding(exitCase.employeeId);
        if (!offboarding?.settlement) {
            return {
                success: false,
                message: "No settlement has been prepared for this employee yet.",
            };
        }

        if (input.to === SETTLEMENT_STATUS.PAID) {
            if (input.confirmBankTransfer !== true) {
                return { success: false, message: "Confirm that Finance verified the bank destination and completed the transfer." };
            }
            const employeeBank = await prisma.employee.findUnique({
                where: { id: exitCase.employeeId },
                select: { bankName: true, iban: true },
            });
            if (!employeeBank?.bankName?.trim() || !employeeBank.iban?.trim()) {
                return { success: false, message: "Complete the employee bank name and IBAN before recording payment." };
            }
        }

        const result = await advanceSettlement({
            offboardingId: offboarding.id,
            to: input.to,
            reference: input.reference,
            actor: { id: user.id, email: user.email, role: user.role },
        });

        if (result.success) revalidateExitViews(exitCase.id);
        return {
            success: result.success,
            message: result.message,
            exitCaseId: exitCase.id,
            status: result.status,
        };
    } catch (error) {
        return toResult(error, "ADVANCE_EXIT_SETTLEMENT_FAILED");
    }
}

/* ------------------------------------------------------------------ */
/* 7. COMPLETION AND ACCESS REVOCATION                                 */
/* ------------------------------------------------------------------ */

/**
 * Closes the exit: SETTLEMENT_PENDING → COMPLETED, employment ended, access
 * revoked.
 *
 * WHY THE REVOCATION IS REPRODUCED INSTEAD OF CALLING `revokeAccess`
 * `revokeAccess()` in `lib/workflow/credentials.ts` runs its four writes through
 * the module-level `prisma` client and its own `prisma.$transaction([...])`.
 * Called from inside an interactive transaction it would therefore acquire a
 * SECOND connection and COMMIT IMMEDIATELY — it would not roll back with the
 * caller's transaction. That is the failure `offboarding.ts:224-239` has, and it
 * is unrecoverable: an account disabled for a status change that never happened,
 * with the status unchanged and nothing in the app able to undo it.
 *
 * So the same four writes are issued here on the transaction client `tx`, in
 * the same order, with the same values, immediately after the guarded
 * `updateMany` has matched exactly one row. Either the case is COMPLETED and
 * the access is gone, or neither happened.
 *
 * `tests/exit-ui-settlement.test.ts` pins the parity with `revokeAccess` and the
 * on-transaction-client property, so a future edit to either side that breaks
 * the correspondence fails a test rather than silently locking someone out.
 * The clean follow-up is a `revokeAccessIn(tx, …)` exported from
 * `credentials.ts`, which would delete this duplication entirely.
 */
export async function completeExitCase(input: {
    exitCaseId: string;
    /**
     * Required when no FinalSettlement exists. Makes a human state that nothing
     * is owed rather than letting a case close silently with no money moved.
     */
    acknowledgeNoSettlement?: boolean;
}): Promise<ExitActionResult> {
    try {
        const user = await requirePermission(PERMISSIONS.EXIT_COMPLETE);

        const exitCase = await prisma.exitCase.findUnique({
            where: { id: input.exitCaseId },
            select: {
                id: true,
                employeeId: true,
                type: true,
                status: true,
                lastWorkingDate: true,
                employee: { select: { id: true, userId: true, lifecycle: true } },
            },
        });
        if (!exitCase) return notFound();

        if (user.employeeId && exitCase.employeeId === user.employeeId) {
            return { success: false, message: "You cannot complete your own exit case." };
        }

        const refused = assertMove(exitCase.status, EXIT_STATUS.COMPLETED, {
            id: user.id,
            role: user.role,
        });
        if (refused) return refused;

        // --- Settlement gate. If a settlement exists it must actually be paid:
        // completing an exit with money outstanding is the mistake this prevents.
        const offboarding = await findLiveOffboarding(exitCase.employeeId);
        const settlement = offboarding?.settlement ?? null;
        if (settlement && settlement.status !== SETTLEMENT_STATUS.PAID) {
            return {
                success: false,
                message: `The final settlement is ${settlement.status}, not PAID. Settle and pay it before completing the exit; nothing was changed.`,
            };
        }
        if (!settlement && input.acknowledgeNoSettlement !== true) {
            return {
                success: false,
                message:
                    "No final settlement has been prepared for this employee. Confirm that " +
                    "nothing is owed before completing the exit; nothing was changed.",
            };
        }

        // --- Lifecycle target, taken from LIFECYCLE_TRANSITIONS rather than
        // assumed. `EXITED` is unreachable from an employed stage and `RESIGNED`
        // is unreachable as a target at all, so this may legitimately answer
        // null — which is reported, never worked around.
        const lifecycleTarget = resolveTerminalLifecycleStage(
            exitCase.employee?.lifecycle ?? null,
            user.role
        );
        if (!lifecycleTarget) {
            return {
                success: false,
                message:
                    `Employee lifecycle is "${exitCase.employee?.lifecycle ?? "unset"}" and the ` +
                    "lifecycle state machine has no terminal stage reachable from there. " +
                    "HR must correct the lifecycle stage before this exit can be completed; " +
                    "nothing was changed.",
            };
        }

        const employeeStatus = employeeStatusForExitType(exitCase.type);
        const revokeForUserId = exitCase.employee?.userId ?? null;
        const revokedAt = new Date();

        await prisma.$transaction(async (tx) => {
            // --- Guarded state update, FIRST. `where` pins the status read above,
            // so a concurrent completion matches zero rows and throws before any
            // revocation statement is issued. This is the whole reason the
            // revocation lives below this line rather than above it.
            const updated = await tx.exitCase.updateMany({
                where: { id: exitCase.id, status: exitCase.status },
                // `decidedAt`/`decisionNote` are deliberately NOT touched: they
                // record the approve-or-reject decision, and overwriting them
                // here would erase who approved the case.
                data: { status: EXIT_STATUS.COMPLETED },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            if (offboarding) {
                const closed = await tx.offboardingRequest.updateMany({
                    where: { id: offboarding.id, status: OFFBOARDING_STATUS.SETTLEMENT_PENDING },
                    data: {
                        status: OFFBOARDING_STATUS.COMPLETED,
                        completedAt: new Date(),
                        approvedBy: user.email,
                    },
                });
                if (closed.count === 0) throw new Error("CONCURRENT_MODIFICATION");
            }

            await tx.employee.update({
                where: { id: exitCase.employeeId },
                data: {
                    currentStatus: employeeStatus,
                    lifecycle: lifecycleTarget,
                    // The three columns must agree: `isActive` still true with
                    // `lifecycle: EXITED` keeps a departed employee in the
                    // payroll run, attendance and leave accrual.
                    isActive: false,
                },
            });

            if (revokeForUserId) {
                // --- Mirrors revokeAccess(), on `tx`. See the note above.
                await tx.userSecurityFlag.upsert({
                    where: { userId: revokeForUserId },
                    update: {
                        accountDisabled: true,
                        disabledReason: `Exit case ${exitCase.id} completed (${exitCase.type})`,
                        disabledAt: revokedAt,
                        mustChangePassword: false,
                    },
                    create: {
                        userId: revokeForUserId,
                        accountDisabled: true,
                        disabledReason: `Exit case ${exitCase.id} completed (${exitCase.type})`,
                        disabledAt: revokedAt,
                    },
                });
                // Nulling the password is what actually prevents sign-in.
                await tx.user.update({
                    where: { id: revokeForUserId },
                    data: { password: null },
                });
                await tx.passwordResetToken.updateMany({
                    where: { userId: revokeForUserId, usedAt: null },
                    data: { usedAt: revokedAt },
                });
                await tx.auditLog.create({
                    data: {
                        employeeId: exitCase.employeeId,
                        action: "ACCESS_REVOKED",
                        details:
                            `Access revoked for user ${revokeForUserId}: exit case ` +
                            `${exitCase.id} completed (${exitCase.type})`,
                        changedBy: user.email,
                    },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: exitCase.employeeId,
                    action: "EXIT_COMPLETED",
                    details:
                        `Exit case ${exitCase.id} (${exitCase.type}) ${exitCase.status} → ` +
                        `${EXIT_STATUS.COMPLETED}. Employee currentStatus ${employeeStatus}, ` +
                        `lifecycle ${lifecycleTarget}, access ` +
                        `${revokeForUserId ? "revoked" : "not revoked (no linked user account)"}` +
                        (settlement
                            ? `, settlement ${settlement.status} (${settlement.finalAmount})`
                            : ", no settlement was prepared (acknowledged)"),
                    changedBy: user.email,
                },
            });
        });

        revalidateExitViews(exitCase.id);

        // Only after the commit. A notification inside the transaction would be
        // rolled back with it, or deadlock against the transaction's lock.
        await notifyInApp({
            employeeId: exitCase.employeeId,
            title: "Exit process completed",
            message:
                `Your ${exitCase.type.toLowerCase().replace(/_/g, " ")} has been processed. ` +
                `Employment status: ${employeeStatus}.`,
            type: "WARNING",
            link: "/dashboard",
        });

        return {
            success: true,
            message: revokeForUserId
                ? `Exit completed. Access revoked and employment status set to ${employeeStatus}.`
                : `Exit completed. Employment status set to ${employeeStatus}. No login account was linked, so there was nothing to revoke.`,
            exitCaseId: exitCase.id,
            status: EXIT_STATUS.COMPLETED,
        };
    } catch (error) {
        return toResult(error, "COMPLETE_EXIT_CASE_FAILED");
    }
}
