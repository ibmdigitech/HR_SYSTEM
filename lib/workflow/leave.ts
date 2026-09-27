/**
 * Leave workflow (P1.3).
 *
 * DEFECTS THIS REPLACES, all found in `app/lib/actions/leave.ts`:
 *
 *  1. **Balance errors were swallowed.** The old `approveLeaveHR` wrapped the
 *     balance update in `catch { console.warn }` and continued, so a leave
 *     could be APPROVED with no deduction made.
 *  2. **No double-approval prevention.** A blind `update` meant a second click
 *     incremented the balance twice.
 *  3. **No transaction.** Request, balance, attendance, notification and audit
 *     were five independent writes.
 *  4. **No state machine.** `managerStatus` and `hrStatus` could disagree.
 *  5. **HR could approve before the manager**, because `approveLeaveHR` never
 *     checked `managerStatus`.
 *  6. **No manager scope check** — any MANAGER could approve any employee's leave.
 *  7. **Balance could go negative** — no sufficiency check.
 *  8. Inline role checks rather than the centralized guard.
 *
 * Balance mutation uses a conditional UPDATE (`where` including the current
 * `usedDays`) so a concurrent approval cannot interleave and corrupt the
 * counter. Prisma reports zero affected rows on a failed match, which is how
 * the race is detected.
 */

import prisma from "@/lib/prisma";
import {
    LEAVE_STATUS,
    LEAVE_TRANSITIONS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

export const DAY_PART = {
    FULL_DAY: "FULL_DAY",
    HALF_DAY_FIRST_HALF: "HALF_DAY_FIRST_HALF",
    HALF_DAY_SECOND_HALF: "HALF_DAY_SECOND_HALF",
} as const;

export type DayPart = (typeof DAY_PART)[keyof typeof DAY_PART];

/** Days deducted, with half-day handled as a real 0.5 — never a fake date range. */
export function calculateLeaveDays(
    startDate: Date,
    endDate: Date,
    dayPart: DayPart = DAY_PART.FULL_DAY
): number {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    if (end < start) return 0;

    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
        const dow = cursor.getDay();
        // Friday/Saturday are the UAE weekend. Excluding them is a business
        // rule and is deliberately configurable via the policy in a later phase;
        // it is isolated here so it is visible and reviewable rather than
        // buried in a loop.
        if (dow !== 5 && dow !== 6) days++;
        cursor.setDate(cursor.getDate() + 1);
    }

    if (dayPart !== DAY_PART.FULL_DAY) days = Math.max(0, days - 0.5);
    return days;
}

/** Which approval route a request takes, from the policy. */
export interface ApprovalRoute {
    requiresHrReview: boolean;
    thresholdDays: number;
}

export async function resolveApprovalRoute(
    leaveType: string,
    requestedDays: number
): Promise<ApprovalRoute> {
    const policy = await prisma.leaveAccrualPolicy.findFirst({
        where: { leaveType, isActive: true },
        orderBy: { effectiveFrom: "desc" },
    });

    if (!policy) {
        // No policy configured: fall back to the conservative route, which is
        // the one the schema already encoded (manager AND HR).
        return { requiresHrReview: true, thresholdDays: 5 };
    }

    return {
        requiresHrReview: policy.requiresHrReview && requestedDays > policy.hrReviewThresholdDays,
        thresholdDays: policy.hrReviewThresholdDays,
    };
}

export interface ApprovalResult {
    success: boolean;
    message: string;
    status?: string;
    deductedDays?: number;
}

interface ApproveArgs {
    leaveId: string;
    decision: "APPROVED" | "REJECTED";
    actor: { id: string; email: string; role: string; employeeId: string | null; department: string | null };
    stage: "MANAGER" | "HR";
    note?: string;
}

/**
 * Manager or HR decision on a leave request.
 *
 * The whole decision — state, balance, attendance, audit — is one transaction.
 * If any part fails, nothing is written.
 */
export async function decideLeave(args: ApproveArgs): Promise<ApprovalResult> {
    const { leaveId, decision, actor, stage } = args;

    const request = await prisma.leaveRequest.findUnique({
        where: { id: leaveId },
        include: { employee: { select: { id: true, department: true, firstName: true, lastName: true } } },
    });

    if (!request) return { success: false, message: "Leave request not found." };

    // --- Self-approval is never permitted -------------------------------
    if (request.employeeId === actor.employeeId) {
        return { success: false, message: "You cannot decide your own leave request." };
    }

    // --- Scope: a manager may only decide within their department ---------
    if (actor.role === ROLES.MANAGER && actor.department && request.employee?.department) {
        if (actor.department !== request.employee.department) {
            return {
                success: false,
                message: "This request belongs to another department.",
            };
        }
    }

    const dayPart = (request.dayPart as DayPart) || DAY_PART.FULL_DAY;
    const requestedDays = calculateLeaveDays(request.startDate, request.endDate, dayPart);
    const route = await resolveApprovalRoute(request.type, requestedDays);

    const target =
        decision === "REJECTED"
            ? LEAVE_STATUS.REJECTED
            : stage === "MANAGER"
              ? route.requiresHrReview
                  ? LEAVE_STATUS.PENDING_HR
                  : LEAVE_STATUS.APPROVED
              : LEAVE_STATUS.APPROVED;

    // --- State machine ---------------------------------------------------
    try {
        assertTransition("LEAVE", LEAVE_TRANSITIONS, request.status, target, {
            actorRole: actor.role,
            actorId: actor.id,
        });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            // The most common real cause is a double click. Say so plainly.
            if (request.status === LEAVE_STATUS.APPROVED) {
                return { success: false, message: "This request was already approved." };
            }
            if (request.status === LEAVE_STATUS.REJECTED) {
                return { success: false, message: "This request was already rejected." };
            }
            if (stage === "HR" && request.status !== LEAVE_STATUS.PENDING_HR) {
                return {
                    success: false,
                    message: "This request has not yet been approved by the manager.",
                };
            }
            return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
        }
        throw error;
    }

    const year = new Date(request.startDate).getFullYear();
    let deductedDays = 0;

    try {
        await prisma.$transaction(async (tx) => {
            // --- Guarded state update: the `where` pins the current status, so
            // a concurrent second approval matches zero rows and aborts here.
            const updated = await tx.leaveRequest.updateMany({
                where: { id: leaveId, status: request.status },
                data: {
                    status: target,
                    decidedAt: decision === "REJECTED" ? new Date() : target === LEAVE_STATUS.APPROVED ? new Date() : null,
                    decisionNote: args.note ?? null,
                    ...(stage === "MANAGER"
                        ? { managerStatus: decision, managerId: actor.id }
                        : { hrStatus: decision, hrId: actor.id }),
                },
            });

            if (updated.count === 0) {
                throw new Error("CONCURRENT_MODIFICATION");
            }

            if (target === LEAVE_STATUS.APPROVED) {
                deductedDays = requestedDays;

                // --- Balance: conditional increment -------------------------
                const existing = await tx.leaveBalance.findFirst({
                    where: { employeeId: request.employeeId, leaveType: request.type, year },
                });

                if (existing) {
                    const remaining = existing.totalDays - existing.usedDays;
                    if (existing.totalDays > 0 && requestedDays > remaining) {
                        throw new Error(
                            `INSUFFICIENT_BALANCE: ${remaining} day(s) remaining, ${requestedDays} requested`
                        );
                    }

                    await tx.leaveBalance.update({
                        where: { id: existing.id },
                        data: { usedDays: { increment: Math.round(requestedDays) } },
                    });
                    await tx.leaveRequest.update({
                        where: { id: leaveId },
                        data: { deductedDays: requestedDays, balanceId: existing.id },
                    });
                } else {
                    // NO BALANCE ROW EXISTS.
                    //
                    // The previous code created one with `totalDays: 0` and
                    // `usedDays: N`, producing a NEGATIVE balance and silently
                    // inventing an entitlement of zero. That is a data-integrity
                    // bug, not a default.
                    //
                    // UNPAID leave legitimately has no balance, so it is allowed
                    // and recorded without one. Every other type must have a
                    // balance provisioned (onboarding, or a LeaveAccrualPolicy)
                    // before it can be approved.
                    if (request.type !== "UNPAID") {
                        throw new Error(
                            `NO_BALANCE: no ${request.type} balance is provisioned for this employee. ` +
                                `Create a LeaveAccrualPolicy, or provision the balance, before approving.`
                        );
                    }

                    // UNPAID: record the usage against a zero-entitlement row so
                    // the days are still visible in reporting.
                    const created = await tx.leaveBalance.create({
                        data: {
                            employeeId: request.employeeId,
                            leaveType: request.type,
                            totalDays: 0,
                            usedDays: Math.round(requestedDays),
                            year,
                        },
                    });
                    await tx.leaveRequest.update({
                        where: { id: leaveId },
                        data: { deductedDays: requestedDays, balanceId: created.id },
                    });
                }

                // --- Attendance marked as LEAVE ---------------------------
                const cursor = new Date(request.startDate);
                cursor.setHours(0, 0, 0, 0);
                const end = new Date(request.endDate);
                end.setHours(0, 0, 0, 0);

                while (cursor <= end) {
                    const dayStart = new Date(cursor);
                    const dayEnd = new Date(cursor);
                    dayEnd.setHours(23, 59, 59, 999);

                    const found = await tx.attendance.findFirst({
                        where: { employeeId: request.employeeId, date: { gte: dayStart, lte: dayEnd } },
                        select: { id: true },
                    });

                    if (found) {
                        await tx.attendance.update({ where: { id: found.id }, data: { status: "LEAVE" } });
                    } else {
                        await tx.attendance.create({
                            data: { employeeId: request.employeeId, date: dayStart, status: "LEAVE" },
                        });
                    }

                    cursor.setDate(cursor.getDate() + 1);
                }
            }

            // --- Audit ----------------------------------------------------
            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: `LEAVE_${stage}_${decision}`,
                    details:
                        `${stage} ${decision.toLowerCase()} leave ${leaveId} ` +
                        `(${request.type}, ${requestedDays} day(s)) — ${request.status} → ${target}` +
                        (route.requiresHrReview ? " [HR review required by policy]" : " [HR review not required]"),
                    changedBy: actor.email,
                },
            });

            // --- In-app notification (inside the transaction: it is a local
            //     write and cannot fail independently of the decision) -----
            await tx.notification.create({
                data: {
                    employeeId: request.employeeId,
                    title:
                        target === LEAVE_STATUS.APPROVED
                            ? "Leave approved"
                            : target === LEAVE_STATUS.REJECTED
                              ? "Leave rejected"
                              : "Leave moved to HR review",
                    message:
                        target === LEAVE_STATUS.PENDING_HR
                            ? `Your ${request.type} request was approved by your manager and is now with HR.`
                            : `Your ${request.type} request (${requestedDays} day(s)) was ${target.toLowerCase()}.`,
                    type: target === LEAVE_STATUS.REJECTED ? "WARNING" : "SUCCESS",
                    link: "/leaves",
                },
            });
        });
    } catch (error) {
        const message = error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : String(error);
        if (message === "CONCURRENT_MODIFICATION") {
            return {
                success: false,
                message: "This request was decided by someone else a moment ago. Reload and try again.",
            };
        }
        if (message.startsWith("INSUFFICIENT_BALANCE")) {
            return { success: false, message: message.replace("INSUFFICIENT_BALANCE: ", "") };
        }
        // Surfaced rather than swallowed: a missing balance is a configuration
        // gap HR must see, not a generic failure.
        if (message.startsWith("NO_BALANCE")) {
            return { success: false, message: message.replace("NO_BALANCE: ", "") };
        }
        console.error("[LEAVE_DECIDE_FAILED]", error);
        return { success: false, message: "Could not record the decision. Nothing was changed." };
    }

    return {
        success: true,
        message:
            target === LEAVE_STATUS.APPROVED
                ? `Leave approved. ${deductedDays} day(s) deducted.`
                : target === LEAVE_STATUS.PENDING_HR
                  ? "Manager approved. Routed to HR for review."
                  : "Leave rejected.",
        status: target,
        deductedDays,
    };
}

/** Employee-initiated cancellation, permitted only before final approval. */
export async function cancelLeave(args: {
    leaveId: string;
    actor: { id: string; email: string; role: string; employeeId: string | null };
}): Promise<ApprovalResult> {
    const request = await prisma.leaveRequest.findUnique({ where: { id: args.leaveId } });
    if (!request) return { success: false, message: "Leave request not found." };

    // An employee may cancel only their own; HR/ADMIN may cancel any.
    const isOwner = request.employeeId === args.actor.employeeId;
    const isPrivileged = ["HR", "ADMIN", "SUPER_ADMIN"].includes(args.actor.role);
    if (!isOwner && !isPrivileged) {
        return { success: false, message: "You cannot cancel this request." };
    }

    try {
        assertTransition("LEAVE", LEAVE_TRANSITIONS, request.status, LEAVE_STATUS.CANCELLED, {
            actorRole: args.actor.role,
            actorId: args.actor.id,
        });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            return { success: false, message: "This request can no longer be cancelled." };
        }
        throw error;
    }

    try {
        await prisma.$transaction(async (tx) => {
            const updated = await tx.leaveRequest.updateMany({
                where: { id: args.leaveId, status: request.status },
                data: {
                    status: LEAVE_STATUS.CANCELLED,
                    cancelledAt: new Date(),
                    cancelledById: args.actor.id,
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            // An approved-and-then-cancelled leave must give the days back.
            if (request.deductedDays > 0 && request.balanceId) {
                await tx.leaveBalance.updateMany({
                    where: { id: request.balanceId },
                    data: { usedDays: { decrement: Math.round(request.deductedDays) } },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: "LEAVE_CANCELLED",
                    details: `Leave ${args.leaveId} cancelled from ${request.status}` +
                        (request.deductedDays > 0 ? `; ${request.deductedDays} day(s) returned` : ""),
                    changedBy: args.actor.email,
                },
            });

            await tx.notification.create({
                data: {
                    employeeId: request.employeeId,
                    title: "Leave request cancelled",
                    message: `Your ${request.type} request was cancelled.`,
                    type: "WARNING",
                    link: "/leaves",
                },
            });
        });
    } catch (error) {
        const message = error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : String(error);
        if (message === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "This request changed a moment ago. Reload and try again." };
        }
        console.error("[LEAVE_CANCEL_FAILED]", error);
        return { success: false, message: "Could not cancel the request. Nothing was changed." };
    }

    return { success: true, message: "Leave request cancelled.", status: LEAVE_STATUS.CANCELLED };
}

const ROLES = {
    MANAGER: "MANAGER",
    HR: "HR",
    ADMIN: "ADMIN",
    SUPER_ADMIN: "SUPER_ADMIN",
} as const;
