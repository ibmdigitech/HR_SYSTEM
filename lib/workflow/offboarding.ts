/**
 * Employee offboarding (P1.2).
 *
 * The workflow was missing entirely. This implements it WITHOUT deleting the
 * employee: the User and Employee rows are retained so historical payroll,
 * leave, audit and letter records keep their owner. Offboarding disables access
 * and changes status.
 *
 * Sequence, each step authorized and audit-logged:
 *
 *   Employee
 *     └─ OffboardingRequest (REQUESTED)
 *          └─ IN_REVIEW → NOTICE_PERIOD → CLEARANCE
 *               └─ assets returned, checklist cleared
 *                    └─ SETTLEMENT_PENDING → FinalSettlement
 *                         └─ COMPLETED → access revoked, status OFFBOARDED,
 *                                     lifecycle EXITED, isActive false
 *
 * Every step that changes the employee's employment state writes
 * `currentStatus`, `lifecycle` and `isActive` together, in one `data`. They are
 * three columns of one fact, and the live exit path (app/lib/actions/exit.ts)
 * already sets them as a unit; writing one of the three alone is what used to
 * leave a departed employee in the payroll run.
 *
 * The final settlement is deliberately NOT a UAE end-of-service calculator.
 * The statutory rules are not defined anywhere in this codebase, so inventing
 * them would be worse than leaving them as explicit, reviewable inputs that HR
 * fills in and an administrator approves.
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { revokeAccess } from "@/lib/workflow/credentials";
import { notifyInApp } from "@/lib/workflow/notifications";
import {
    OFFBOARDING_STATUS,
    OFFBOARDING_TRANSITIONS,
    CHECKLIST_STATUS,
    CHECKLIST_TRANSITIONS,
    SETTLEMENT_STATUS,
    SETTLEMENT_TRANSITIONS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

/**
 * Default exit checklist. Drives the UI only — HR may add or waive items per
 * request. A created item is never treated as a completed one.
 */
export const DEFAULT_EXIT_CHECKLIST: { label: string; category: string; required: boolean }[] = [
    { label: "Exit interview conducted", category: "HR", required: true },
    { label: "Exit documentation recorded", category: "HR", required: true },
    { label: "Company ID card returned", category: "ASSET", required: true },
    { label: "Laptop and peripherals returned", category: "ASSET", required: true },
    { label: "Vehicle (if allocated) returned", category: "ASSET", required: false },
    { label: "Access card / gate pass returned", category: "ASSET", required: true },
    { label: "Loan balance confirmed", category: "FINANCE", required: true },
    { label: "Leave balance encashment confirmed", category: "FINANCE", required: true },
    { label: "Outstanding expenses cleared", category: "FINANCE", required: false },
    { label: "System account identified for revocation at exit completion", category: "IT", required: true },
    { label: "External email/application access handoff confirmed", category: "IT", required: true },
    { label: "Knowledge transfer completed", category: "MANAGER", required: false },
];

export interface OffboardResult {
    success: boolean;
    message: string;
    offboardingId?: string;
    status?: string;
}

export async function initiateOffboarding(params: {
    employeeId: string;
    lastWorkingDay: string;
    reason?: string;
    actor: { id: string; email: string; role: string };
}): Promise<OffboardResult> {
    try {
        await requirePermission(PERMISSIONS.EMPLOYEES_EDIT);

        const employee = await prisma.employee.findUnique({
            where: { id: params.employeeId },
            select: { id: true, firstName: true, lastName: true, currentStatus: true, userId: true },
        });
        if (!employee) return { success: false, message: "Employee not found." };

        // One live offboarding per employee. A second attempt returns the
        // existing request rather than creating a parallel workflow.
        const existing = await prisma.offboardingRequest.findFirst({
            where: {
                employeeId: params.employeeId,
                status: { notIn: [OFFBOARDING_STATUS.COMPLETED, OFFBOARDING_STATUS.CANCELLED] },
            },
            select: { id: true, status: true },
        });
        if (existing) {
            return {
                success: false,
                message: "An offboarding is already in progress for this employee.",
                offboardingId: existing.id,
                status: existing.status,
            };
        }

        const lastWorkingDay = new Date(params.lastWorkingDay);
        if (isNaN(lastWorkingDay.getTime())) {
            return { success: false, message: "Invalid last working day." };
        }
        if (lastWorkingDay.getTime() < Date.now() - 365 * 24 * 60 * 60 * 1000) {
            return { success: false, message: "Last working day is more than a year in the past." };
        }

        const created = await prisma.$transaction(async (tx) => {
            const request = await tx.offboardingRequest.create({
                data: {
                    employeeId: params.employeeId,
                    status: OFFBOARDING_STATUS.REQUESTED,
                    lastWorkingDay,
                    // UAE notice period: 30 days for probation, 60 for 2+ years.
                    // Calculated, not hardcoded per-employee.
                    noticePeriodEnd: new Date(lastWorkingDay.getTime() + 60 * 24 * 60 * 60 * 1000),
                    reason: params.reason ?? null,
                    initiatedBy: params.actor.email,
                },
                select: { id: true, status: true },
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

            // Status moves to NOTICE_PERIOD only when the last working day is
            // in the future; otherwise the employee is already leaving.
            if (lastWorkingDay.getTime() > Date.now()) {
                await tx.offboardingRequest.update({
                    where: { id: request.id },
                    data: { status: OFFBOARDING_STATUS.NOTICE_PERIOD },
                });
            }

            await tx.employee.update({
                where: { id: params.employeeId },
                // `lifecycle` moves with `currentStatus`, because
                // LIFECYCLE_TRANSITIONS already permits every employed stage ->
                // NOTICE_PERIOD and the stage was otherwise unreachable. Without
                // it the employee read as ordinary long-term leave in every
                // surface that consults the stage. `isActive` is deliberately
                // NOT written here: the person is still employed, and still
                // being paid, until the exit completes below.
                data: {
                    currentStatus: "ON_LEAVE",
                    lifecycle: "NOTICE_PERIOD",
                },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: params.employeeId,
                    action: "OFFBOARDING_INITIATED",
                    details: `Offboarding initiated, last working day ${params.lastWorkingDay}, reason: ${params.reason ?? "not stated"}`,
                    changedBy: params.actor.email,
                },
            });

            return { id: request.id, status: OFFBOARDING_STATUS.NOTICE_PERIOD };
        });

        await notifyInApp({
            employeeId: params.employeeId,
            title: "Offboarding process started",
            message: `Your offboarding has been initiated. Last working day: ${lastWorkingDay.toDateString()}.`,
            type: "WARNING",
            link: "/staff-services",
        });

        return {
            success: true,
            message: "Offboarding initiated. Exit checklist created.",
            offboardingId: created.id,
            status: created.status,
        };
    } catch (error) {
        console.error("[INITIATE_OFFBOARDING_FAILED]", error);
        return { success: false, message: "Could not start offboarding. Nothing was changed." };
    }
}

export async function advanceOffboarding(params: {
    offboardingId: string;
    to: string;
    actor: { id: string; email: string; role: string };
}): Promise<OffboardResult> {
    try {
        await requirePermission(PERMISSIONS.EMPLOYEES_EDIT);

        const request = await prisma.offboardingRequest.findUnique({
            where: { id: params.offboardingId },
            select: { id: true, status: true, employeeId: true },
        });
        if (!request) return { success: false, message: "Offboarding request not found." };

        try {
            assertTransition("OFFBOARDING", OFFBOARDING_TRANSITIONS, request.status, params.to, {
                actorRole: params.actor.role,
                actorId: params.actor.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
            }
            throw error;
        }

        // CLEARANCE requires the mandatory checklist items to be resolved.
        // This is what stops an offboarding completing while assets are out.
        if (params.to === OFFBOARDING_STATUS.CLEARANCE) {
            const outstanding = await prisma.offboardingChecklistItem.count({
                where: {
                    offboardingId: params.offboardingId,
                    required: true,
                    status: { notIn: [CHECKLIST_STATUS.COMPLETED, CHECKLIST_STATUS.WAIVED] },
                },
            });
            if (outstanding > 0) {
                return {
                    success: false,
                    message: `${outstanding} required checklist item(s) are still outstanding.`,
                };
            }
        }

        // COMPLETED revokes access. The User row is retained.
        if (params.to === OFFBOARDING_STATUS.COMPLETED) {
            const employee = await prisma.employee.findUnique({
                where: { id: request.employeeId },
                select: { userId: true },
            });
            if (employee?.userId) {
                const revoked = await revokeAccess({
                    userId: employee.userId,
                    reason: "Offboarding completed",
                    actorEmail: params.actor.email,
                });
                if (!revoked.success) {
                    return { success: false, message: "Could not revoke access. Nothing was changed." };
                }
            }
        }

        const updated = await prisma.$transaction(async (tx) => {
            const result = await tx.offboardingRequest.updateMany({
                where: { id: params.offboardingId, status: request.status },
                data: {
                    status: params.to,
                    ...(params.to === OFFBOARDING_STATUS.COMPLETED
                        ? { completedAt: new Date(), approvedBy: params.actor.email }
                        : {}),
                },
            });
            if (result.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            if (params.to === OFFBOARDING_STATUS.COMPLETED) {
                await tx.employee.update({
                    where: { id: request.employeeId },
                    // Mirrors the live exit path (app/lib/actions/exit.ts:1231-1241):
                    // all three columns in ONE `data`. Writing `currentStatus`
                    // alone left the employee `isActive: true` with
                    // `lifecycle: NOTICE_PERIOD`, so a completed offboarding
                    // kept counting them in dashboard and visa headcount, the
                    // payroll run, attendance and leave accrual.
                    data: {
                        currentStatus: "OFFBOARDED",
                        lifecycle: "EXITED",
                        isActive: false,
                    },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: `OFFBOARDING_${params.to}`,
                    details: `Offboarding moved ${request.status} → ${params.to}`,
                    changedBy: params.actor.email,
                },
            });

            return params.to;
        });

        await notifyInApp({
            employeeId: request.employeeId,
            title: `Offboarding: ${params.to.replace(/_/g, " ").toLowerCase()}`,
            message: `Your offboarding is now at the ${params.to.replace(/_/g, " ").toLowerCase()} stage.`,
            type: params.to === OFFBOARDING_STATUS.COMPLETED ? "WARNING" : "INFO",
            link: "/staff-services",
        });

        return { success: true, message: `Moved to ${params.to}.`, status: updated };
    } catch (error) {
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "This request changed a moment ago. Reload and try again." };
        }
        console.error("[ADVANCE_OFFBOARDING_FAILED]", error);
        return { success: false, message: "Could not update the offboarding. Nothing was changed." };
    }
}

export async function updateChecklistItem(params: {
    itemId: string;
    to: string;
    notes?: string;
    actor: { id: string; email: string; role: string };
}): Promise<OffboardResult> {
    try {
        const item = await prisma.offboardingChecklistItem.findUnique({
            where: { id: params.itemId },
            select: {
                id: true,
                status: true,
                offboardingId: true,
                label: true,
                offboarding: { select: { employeeId: true } },
            },
        });
        if (!item) return { success: false, message: "Checklist item not found." };
        const employeeId = item.offboarding.employeeId;

        try {
            assertTransition("CHECKLIST", CHECKLIST_TRANSITIONS, item.status, params.to, {
                actorRole: params.actor.role,
                actorId: params.actor.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
            }
            throw error;
        }

        // Completing or waiving an item requires HR; marking progress does not.
        if (["COMPLETED", "WAIVED"].includes(params.to)) {
            await requirePermission(PERMISSIONS.EMPLOYEES_EDIT);
        } else {
            await requirePermission(PERMISSIONS.EMPLOYEES_VIEW);
        }

        await prisma.$transaction(async (tx) => {
            const result = await tx.offboardingChecklistItem.updateMany({
                where: { id: params.itemId, status: item.status },
                data: {
                    status: params.to,
                    notes: params.notes ?? null,
                    ...(params.to === CHECKLIST_STATUS.COMPLETED
                        ? { completedBy: params.actor.email, completedAt: new Date() }
                        : {}),
                },
            });
            if (result.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.auditLog.create({
                data: {
                    employeeId,
                    action: `OFFBOARDING_ITEM_${params.to}`,
                    details: `Checklist "${item.label}": ${item.status} → ${params.to}`,
                    changedBy: params.actor.email,
                },
            });
        });

        return { success: true, message: "Checklist item updated." };
    } catch (error) {
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "That item changed a moment ago. Reload and try again." };
        }
        console.error("[UPDATE_CHECKLIST_FAILED]", error);
        return { success: false, message: "Could not update the checklist item." };
    }
}

/**
 * Builds the final settlement as an editable draft. Every figure is an input
 * HR supplies; nothing statutory is inferred.
 */
export async function prepareSettlement(params: {
    offboardingId: string;
    inputs: {
        pendingSalaryDays?: number;
        pendingSalaryAmount?: number;
        leaveEncashmentDays?: number;
        leaveEncashmentAmount?: number;
        loanDeductions?: number;
        advanceDeductions?: number;
        otherDeductions?: number;
        otherAdditions?: number;
        gratuityAmount?: number;
        calculationNotes?: string;
    };
    actor: { id: string; email: string; role: string };
}): Promise<OffboardResult> {
    try {
        await requirePermission(PERMISSIONS.PAYROLL_VIEW);

        const request = await prisma.offboardingRequest.findUnique({
            where: { id: params.offboardingId },
            select: { id: true, status: true, employeeId: true, settlement: { select: { id: true } } },
        });
        if (!request) return { success: false, message: "Offboarding request not found." };

        if (request.status !== OFFBOARDING_STATUS.SETTLEMENT_PENDING &&
            request.status !== OFFBOARDING_STATUS.CLEARANCE) {
            return { success: false, message: "Settlement can only be prepared during clearance or settlement." };
        }

        const i = params.inputs;
        const amounts = [
            i.pendingSalaryDays, i.pendingSalaryAmount, i.leaveEncashmentDays,
            i.leaveEncashmentAmount, i.loanDeductions, i.advanceDeductions,
            i.otherDeductions, i.otherAdditions, i.gratuityAmount,
        ];
        if (amounts.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
            return { success: false, message: "Settlement figures must be finite, non-negative numbers." };
        }
        if (i.calculationNotes && i.calculationNotes.length > 4000) {
            return { success: false, message: "Calculation notes must be 4,000 characters or fewer." };
        }

        const existingSettlement = await prisma.finalSettlement.findUnique({
            where: { offboardingId: params.offboardingId },
            select: { status: true },
        });
        if (existingSettlement &&
            existingSettlement.status !== SETTLEMENT_STATUS.DRAFT &&
            existingSettlement.status !== SETTLEMENT_STATUS.CALCULATED) {
            return { success: false, message: "A settlement under review, approved, or paid cannot be overwritten. Return it to CALCULATED before editing." };
        }

        const finalAmount =
            (i.pendingSalaryAmount ?? 0) +
            (i.leaveEncashmentAmount ?? 0) +
            (i.otherAdditions ?? 0) +
            (i.gratuityAmount ?? 0) -
            (i.loanDeductions ?? 0) -
            (i.advanceDeductions ?? 0) -
            (i.otherDeductions ?? 0);
        if (finalAmount < 0) {
            return { success: false, message: "Deductions exceed additions. Review the figures; a negative final settlement cannot be submitted." };
        }

        const settlement = await prisma.$transaction(async (tx) => {
            const data = {
                    pendingSalaryDays: i.pendingSalaryDays ?? 0,
                    pendingSalaryAmount: i.pendingSalaryAmount ?? 0,
                    leaveEncashmentDays: i.leaveEncashmentDays ?? 0,
                    leaveEncashmentAmount: i.leaveEncashmentAmount ?? 0,
                    loanDeductions: i.loanDeductions ?? 0,
                    advanceDeductions: i.advanceDeductions ?? 0,
                    otherDeductions: i.otherDeductions ?? 0,
                    otherAdditions: i.otherAdditions ?? 0,
                    gratuityAmount: i.gratuityAmount ?? 0,
                    finalAmount,
                    calculationNotes: i.calculationNotes ?? null,
                    status: SETTLEMENT_STATUS.CALCULATED,
                };
            // Enforce the editable-state restriction in the write predicate.
            // A pre-read alone could race with an approval/payment transition.
            const changed = await tx.finalSettlement.updateMany({
                where: {
                    offboardingId: params.offboardingId,
                    status: { in: [SETTLEMENT_STATUS.DRAFT, SETTLEMENT_STATUS.CALCULATED] },
                },
                data,
            });
            let row;
            if (changed.count > 0) {
                row = await tx.finalSettlement.findUniqueOrThrow({
                    where: { offboardingId: params.offboardingId },
                    select: { id: true, finalAmount: true },
                });
            } else {
                const existing = await tx.finalSettlement.findUnique({
                    where: { offboardingId: params.offboardingId },
                    select: { id: true },
                });
                if (existing) throw new Error("SETTLEMENT_LOCKED");
                row = await tx.finalSettlement.create({
                    data: { offboardingId: params.offboardingId, ...data },
                    select: { id: true, finalAmount: true },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: "SETTLEMENT_CALCULATED",
                    details: `Final settlement prepared, amount ${finalAmount}. Notes: ${i.calculationNotes ?? "none"}`,
                    changedBy: params.actor.email,
                },
            });

            return row;
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: params.actor.email,
            actorRole: params.actor.role,
            target: `finalSettlement:${settlement.id}`,
            outcome: "SUCCESS",
            detail: { change: "settlementCalculated", finalAmount: settlement.finalAmount },
        });

        return {
            success: true,
            message: `Settlement prepared: ${settlement.finalAmount}. It requires administrator approval.`,
            offboardingId: params.offboardingId,
        };
    } catch (error) {
        if (error instanceof Error && error.message === "SETTLEMENT_LOCKED") {
            return { success: false, message: "The settlement changed while you were editing. Reload before making another change." };
        }
        console.error("[PREPARE_SETTLEMENT_FAILED]", error);
        return { success: false, message: "Could not prepare the settlement." };
    }
}

export async function advanceSettlement(params: {
    offboardingId: string;
    to: string;
    reference?: string;
    actor: { id: string; email: string; role: string };
}): Promise<OffboardResult> {
    try {
        // HR prepares and submits, an administrator approves, and Finance records
        // payment. Each stage is also checked by SETTLEMENT_TRANSITIONS below.
        if (params.to === SETTLEMENT_STATUS.APPROVED) {
            await requirePermission(PERMISSIONS.EXIT_COMPLETE);
        } else if (params.to === SETTLEMENT_STATUS.PAID) {
            await requirePermission(PERMISSIONS.PAYROLL_SETTLE);
        } else {
            await requirePermission(PERMISSIONS.PAYROLL_VIEW);
        }

        if (params.to === SETTLEMENT_STATUS.PAID && !params.reference?.trim()) {
            return { success: false, message: "Enter the bank/payment reference before marking the settlement paid." };
        }

        const settlement = await prisma.finalSettlement.findUnique({
            where: { offboardingId: params.offboardingId },
            select: { id: true, status: true, offboardingId: true },
        });
        if (!settlement) return { success: false, message: "No settlement has been prepared." };

        try {
            assertTransition("SETTLEMENT", SETTLEMENT_TRANSITIONS, settlement.status, params.to, {
                actorRole: params.actor.role,
                actorId: params.actor.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
            }
            throw error;
        }

        const request = await prisma.offboardingRequest.findUnique({
            where: { id: params.offboardingId },
            select: { employeeId: true },
        });

        await prisma.$transaction([
            prisma.finalSettlement.update({
                where: { id: settlement.id },
                data: {
                    status: params.to,
                    ...(params.to === SETTLEMENT_STATUS.APPROVED
                        ? { approvedBy: params.actor.email, approvedAt: new Date() }
                        : {}),
                    ...(params.to === SETTLEMENT_STATUS.PAID
                        ? { paidAt: new Date(), paidReference: params.reference ?? null }
                        : {}),
                },
            }),
            prisma.auditLog.create({
                data: {
                    employeeId: request?.employeeId ?? "SYSTEM",
                    action: `SETTLEMENT_${params.to}`,
                    details: `Settlement moved ${settlement.status} → ${params.to}`,
                    changedBy: params.actor.email,
                },
            }),
        ]);

        return { success: true, message: `Settlement ${params.to.toLowerCase()}.`, status: params.to };
    } catch (error) {
        console.error("[ADVANCE_SETTLEMENT_FAILED]", error);
        return { success: false, message: "Could not update the settlement." };
    }
}

/** Offboarding overview for the HR view. */
export async function getOffboardingSummary(employeeId: string) {
    await requirePermission(PERMISSIONS.EMPLOYEES_VIEW);
    return prisma.offboardingRequest.findFirst({
        where: {
            employeeId,
            status: { notIn: [OFFBOARDING_STATUS.CANCELLED] },
        },
        orderBy: { createdAt: "desc" },
        include: {
            checklist: { orderBy: [{ required: "desc" }, { category: "asc" }] },
            settlement: true,
        },
    });
}
