'use server';

/**
 * Leave server actions (P1.3).
 *
 * Every decision delegates to `lib/workflow/leave.ts`, which owns the state
 * machine, the transaction, the balance guard and the double-approval
 * prevention. This file is a thin, permission-checked adapter — it contains no
 * business rules of its own, so the rules cannot diverge between the two
 * approval entry points.
 */

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireUser, AuthorizationError, AuthenticationError } from "@/lib/auth/guards";
import { buildSubject } from "@/lib/auth/scope";
import { decideLeave, cancelLeave, calculateLeaveDays, DAY_PART } from "@/lib/workflow/leave";
import { LEAVE_STATUS, assertTransition,  } from "@/lib/workflow/state-machine";

// NOTE: this file has a file-level "use server" directive, so it may only
// export async functions. Day-part constants live in `@/lib/workflow/leave`
// and are re-imported directly by any component that needs them — re-exporting
// the object from here is a build error ("A 'use server' file can only export
// async functions").

const ALLOWED_LEAVE_TYPES = [
    "ANNUAL", "SICK", "CASUAL", "EMERGENCY", "UNPAID",
    "MATERNITY", "PATERNITY", "HAJJ", "BEREAVEMENT", "STUDY",
];

export interface LeaveActionResult {
    message: string;
    success: boolean;
}

function revalidateLeaveViews() {
    revalidatePath("/leaves");
    revalidatePath("/leaves/apply");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/approvals");
    revalidatePath("/attendance");
}

export async function submitLeaveRequest(
    _prevState: unknown,
    formData: FormData
): Promise<LeaveActionResult> {
    let actorEmail = "unknown";
    try {
        const user = await requireUser();
        actorEmail = user.email;

        const type = String(formData.get("type") ?? "");
        const startRaw = String(formData.get("startDate") ?? "");
        const endRaw = String(formData.get("endDate") ?? "");
        const reason = String(formData.get("reason") ?? "");
        const dayPartRaw = String(formData.get("dayPart") ?? "FULL_DAY");
        const attachment = formData.get("attachment");

        if (!type || !startRaw || !endRaw || !reason) {
            return { message: "Missing required fields", success: false };
        }
        if (!ALLOWED_LEAVE_TYPES.includes(type)) {
            return { message: "Unknown leave type", success: false };
        }
        if (!Object.values(DAY_PART).includes(dayPartRaw as never)) {
            return { message: "Unknown day part", success: false };
        }

        const startDate = new Date(startRaw);
        const endDate = new Date(endRaw);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return { message: "Invalid dates", success: false };
        }
        if (endDate < startDate) {
            return { message: "End date cannot be before the start date", success: false };
        }

        const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            include: { employee: true },
        });
        if (!dbUser?.employee) {
            return { message: "Employee profile not found. Contact HR.", success: false };
        }

        const days = calculateLeaveDays(startDate, endDate, dayPartRaw as never);
        if (days <= 0) {
            return { message: "The selected range contains no working days", success: false };
        }

        // Overlap check — SAME LEAVE TYPE ONLY.
        //
        // The original check blocked any overlapping request regardless of type,
        // which made a sick-leave request impossible for anyone already on
        // planned or emergency leave for the same dates. That is precisely the
        // situation sick leave exists for: you are unwell during an approved
        // absence. A different type overlapping is legitimate and is allowed.
        //
        // A duplicate of the SAME type over the same dates is still refused,
        // because that is a double submission.
        const overlap = await prisma.leaveRequest.findFirst({
            where: {
                employeeId: dbUser.employee.id,
                // Same type only.
                type,
                status: { in: [LEAVE_STATUS.PENDING_MANAGER, LEAVE_STATUS.PENDING_HR, LEAVE_STATUS.MANAGER_APPROVED, LEAVE_STATUS.APPROVED] },
                startDate: { lte: endDate },
                endDate: { gte: startDate },
            },
            select: { id: true },
        });
        if (overlap) {
            return {
                message: `You already have a ${type.toLowerCase().replace(/_/g, " ")} request covering those dates.`,
                success: false,
            };
        }

        // Submission, audit and optional attachment are one unit: a rejected
        // attachment must not leave an orphaned request.
        const leave = await prisma.$transaction(async (tx) => {
            const created = await tx.leaveRequest.create({
                data: {
                    employeeId: dbUser.employee!.id,
                    type,
                    startDate,
                    endDate,
                    reason,
                    dayPart: dayPartRaw,
                    status: LEAVE_STATUS.PENDING_MANAGER,
                    managerStatus: "PENDING",
                    hrStatus: "PENDING",
                },
            });

            if (attachment instanceof File && attachment.name && attachment.size > 0) {
                if (attachment.size > 5 * 1024 * 1024) {
                    throw new Error("ATTACHMENT_TOO_LARGE");
                }
                await tx.attachment.create({
                    data: {
                        employeeId: dbUser.employee!.id,
                        fileName: attachment.name,
                        fileUrl: `/uploads/${attachment.name}`,
                        fileType: attachment.type,
                        category: "LEAVE_ATTACHMENT",
                    },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: dbUser.employee!.id,
                    action: "LEAVE_SUBMIT",
                    details: `Submitted ${type} leave ${startRaw} → ${endRaw} (${days} day(s), ${dayPartRaw})`,
                    changedBy: user.email,
                },
            });

            return created;
        });

        revalidateLeaveViews();
        return { message: "Leave request submitted successfully!", success: true };
    } catch (error) {
        if (error instanceof AuthenticationError) {
            return { message: "Not signed in", success: false };
        }
        if (error instanceof AuthorizationError) {
            return { message: (error instanceof Error ? error.message : "Unknown error"), success: false };
        }
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "ATTACHMENT_TOO_LARGE") {
            return { message: "Attachment must be smaller than 5MB", success: false };
        }
        console.error("[SUBMIT_LEAVE_FAILED]", error);
        return { message: "Could not submit the request. Nothing was changed.", success: false };
    }
}

export async function approveLeaveManager(
    leaveId: string,
    status: "APPROVED" | "REJECTED"
): Promise<LeaveActionResult> {
    try {
        await requireUser();
        const subject = await buildSubject(
            (await requireUser()).id,
            (await requireUser()).email
        );
        if (!subject) return { message: "Profile not found", success: false };

        const result = await decideLeave({
            leaveId,
            decision: status,
            stage: "MANAGER",
            actor: {
                id: subject.userId,
                email: subject.email,
                role: subject.role,
                employeeId: subject.employeeId,
                department: subject.department,
            },
        });

        if (result.success) revalidateLeaveViews();
        return { message: result.message, success: result.success };
    } catch (error) {
        if (error instanceof AuthenticationError) return { message: "Not signed in", success: false };
        if (error instanceof AuthorizationError) return { message: (error instanceof Error ? error.message : "Unknown error"), success: false };
        console.error("[APPROVE_LEAVE_MANAGER_FAILED]", error);
        return { message: "Could not record the decision.", success: false };
    }
}

export async function approveLeaveHR(
    leaveId: string,
    status: "APPROVED" | "REJECTED"
): Promise<LeaveActionResult> {
    try {
        const user = await requireUser();
        const subject = await buildSubject(user.id, user.email);
        if (!subject) return { message: "Profile not found", success: false };

        const result = await decideLeave({
            leaveId,
            decision: status,
            stage: "HR",
            actor: {
                id: subject.userId,
                email: subject.email,
                role: subject.role,
                employeeId: subject.employeeId,
                department: subject.department,
            },
        });

        if (result.success) revalidateLeaveViews();
        return { message: result.message, success: result.success };
    } catch (error) {
        if (error instanceof AuthenticationError) return { message: "Not signed in", success: false };
        if (error instanceof AuthorizationError) return { message: (error instanceof Error ? error.message : "Unknown error"), success: false };
        console.error("[APPROVE_LEAVE_HR_FAILED]", error);
        return { message: "Could not record the decision.", success: false };
    }
}

export async function cancelLeaveRequest(leaveId: string): Promise<LeaveActionResult> {
    try {
        const user = await requireUser();
        const result = await cancelLeave({
            leaveId,
            actor: { id: user.id, email: user.email, role: user.role, employeeId: user.employeeId },
        });
        if (result.success) revalidateLeaveViews();
        return { message: result.message, success: result.success };
    } catch (error) {
        if (error instanceof AuthenticationError) return { message: "Not signed in", success: false };
        console.error("[CANCEL_LEAVE_FAILED]", error);
        return { message: "Could not cancel the request.", success: false };
    }
}

/** Read-only helper for the approvals UI. */
export async function getLeaveRequest(id: string) {
    const user = await requireUser();
    return prisma.leaveRequest.findUnique({
        where: { id },
        select: {
            id: true,
            status: true,
            type: true,
            dayPart: true,
            deductedDays: true,
            managerStatus: true,
            hrStatus: true,
            decisionNote: true,
            startDate: true,
            endDate: true,
            employeeId: true,
        },
    });
}

/** Which transitions the current actor may perform — for rendering buttons. */
export async function getAvailableLeaveActions(leaveId: string) {
    const user = await requireUser();
    const request = await prisma.leaveRequest.findUnique({
        where: { id: leaveId },
        select: { status: true, employeeId: true, type: true, startDate: true, endDate: true, dayPart: true },
    });
    if (!request) return [];

    const { LEAVE_TRANSITIONS } = await import("@/lib/workflow/state-machine");
    const days = calculateLeaveDays(
        request.startDate,
        request.endDate,
        (request.dayPart as never) || "FULL_DAY"
    );
    const { resolveApprovalRoute } = await import("@/lib/workflow/leave");
    const route = await resolveApprovalRoute(request.type, days);

    const targets = Object.keys(LEAVE_TRANSITIONS[request.status] ?? {});
    return targets.filter((target) => {
        try {
            assertTransition("LEAVE", LEAVE_TRANSITIONS, request.status, target, {
                actorRole: user.role,
                actorId: user.id,
            });
            return true;
        } catch {
            return false;
        }
    });
}
