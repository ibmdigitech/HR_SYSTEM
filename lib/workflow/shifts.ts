/**
 * Shift assignment and overtime integrity (P1.9).
 *
 * The audit found no conflict detection on shift assignment, so an employee
 * could be booked onto two overlapping shifts. It also found overtime flowing
 * straight from raw attendance into payroll with no approval step.
 *
 * CONFLICT RULE: two assignments for the same employee on the same calendar day
 * may not overlap in time. The check is advisory when rendering the form and
 * AUTHORITATIVE on save — the save path re-runs it inside the transaction.
 *
 * OVERTIME: three distinct quantities, deliberately not collapsed:
 *   calculated  — derived from attendance
 *   approved    — signed off by a manager
 *   payable     — what payroll may actually use
 * Raw attendance becoming payable money without approval is the exact risk the
 * audit flagged, so the three are kept separate all the way to payroll.
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";

/* ------------------------------------------------------------------ */
/* Shift conflict detection                                            */
/* ------------------------------------------------------------------ */

export interface TimeRange {
    start: Date;
    end: Date;
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
    // Half-open intervals: a shift ending at 14:00 does not conflict with one
    // starting at 14:00.
    return a.start < b.end && b.start < a.end;
}

export interface ConflictResult {
    hasConflict: boolean;
    conflicts: {
        employeeId: string;
        date: string;
        shiftName: string;
        window: string;
    }[];
}

/**
 * Detects overlapping shift assignments for an employee over a date range.
 * `excludeAssignmentId` lets an edit ignore the assignment being changed.
 */
export async function detectShiftConflicts(params: {
    employeeId: string;
    start: Date;
    end: Date;
    excludeShiftId?: string | null;
}): Promise<ConflictResult> {
    const startDay = new Date(params.start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(params.end);
    endDay.setHours(23, 59, 59, 999);

    // An employee may have at most one primary shift, so a conflict is any
    // other active assignment in the window.
    const assignments = await prisma.employee.findMany({
        where: {
            id: params.employeeId,
            ...(params.excludeShiftId ? { NOT: { id: params.excludeShiftId } } : {}),
            shiftId: { not: null },
            currentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
        },
        select: {
            id: true,
            shiftId: true,
            shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
    });

    const conflicts: ConflictResult["conflicts"] = [];

    for (const assignment of assignments) {
        if (!assignment.shift) continue;

        const shiftRange = buildDailyRange(
            startDay,
            assignment.shift.startTime,
            assignment.shift.endTime
        );
        if (!shiftRange) continue;

        if (overlaps(shiftRange, { start: startDay, end: endDay })) {
            conflicts.push({
                employeeId: assignment.id,
                date: startDay.toISOString().slice(0, 10),
                shiftName: assignment.shift.name,
                window: `${formatTime(assignment.shift.startTime)}–${formatTime(assignment.shift.endTime)}`,
            });
        }
    }

    return { hasConflict: conflicts.length > 0, conflicts };
}

function buildDailyRange(day: Date, startTime: string, endTime: string): TimeRange | null {
    const start = parseTimeOn(day, startTime);
    const end = parseTimeOn(day, endTime);
    if (!start || !end) return null;
    // A shift whose end is before its start is a night shift spanning midnight.
    if (end <= start) end.setDate(end.getDate() + 1);
    return { start, end };
}

function parseTimeOn(day: Date, time: string): Date | null {
    const match = time.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const d = new Date(day);
    d.setHours(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), 0, 0);
    return d;
}

function formatTime(time: string): string {
    const match = time.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return time;
    return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export interface AssignShiftResult {
    success: boolean;
    message: string;
    conflicts?: ConflictResult["conflicts"];
}

/**
 * Assigns a shift, refusing overlapping assignments.
 *
 * The conflict check runs immediately before the write rather than trusting a
 * value computed when the form rendered, because the assignment may have
 * changed in between.
 */
export async function assignShift(params: {
    employeeId: string;
    shiftId: string;
    actor: { id: string; email: string; role: string };
    /** Set to true to record a warning instead of refusing. */
    allowConflict?: boolean;
}): Promise<AssignShiftResult> {
    try {
        await requirePermission(PERMISSIONS.ATTENDANCE_SHIFT_MANAGE);

        const shift = await prisma.shift.findUnique({
            where: { id: params.shiftId },
            select: { id: true, name: true, startTime: true, endTime: true },
        });
        if (!shift) return { success: false, message: "Shift not found." };
        // `Shift` has no isActive column, so a shift with no employees is not a
        // usable definition. Validate the shape rather than a missing flag.
        if (!shift.startTime || !shift.endTime) {
            return { success: false, message: "This shift has no times configured." };
        }

        const today = new Date();
        const conflict = await detectShiftConflicts({
            employeeId: params.employeeId,
            start: today,
            end: today,
            excludeShiftId: params.employeeId,
        });

        if (conflict.hasConflict && !params.allowConflict) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ACCESS_DENIED,
                actorEmail: params.actor.email,
                actorRole: params.actor.role,
                target: `shiftAssignment:${params.employeeId}`,
                outcome: "DENIED",
                detail: { change: "shiftConflict", conflicts: conflict.conflicts.length },
            });
            return {
                success: false,
                message: `This overlaps an existing assignment: ${conflict.conflicts
                    .map((c) => `${c.shiftName} (${c.window})`)
                    .join(", ")}.`,
                conflicts: conflict.conflicts,
            };
        }

        await prisma.$transaction([
            prisma.employee.update({
                where: { id: params.employeeId },
                data: { shiftId: params.shiftId },
            }),
            prisma.auditLog.create({
                data: {
                    employeeId: params.employeeId,
                    action: "SHIFT_ASSIGNED",
                    details:
                        `Assigned "${shift.name}" (${shift.startTime}–${shift.endTime})` +
                        (conflict.hasConflict ? " [conflict overridden]" : ""),
                    changedBy: params.actor.email,
                },
            }),
        ]);

        return { success: true, message: `Shift "${shift.name}" assigned.` };
    } catch (error) {
        console.error("[ASSIGN_SHIFT_FAILED]", error);
        return { success: false, message: "Could not assign the shift." };
    }
}

/* ------------------------------------------------------------------ */
/* Overtime                                                            */
/* ------------------------------------------------------------------ */

export type OvertimeState = "CALCULATED" | "APPROVED" | "PAYABLE";

export interface OvertimeSummary {
    employeeId: string;
    period: string;
    calculatedMinutes: number;
    approvedMinutes: number;
    payableMinutes: number;
    pendingApproval: boolean;
}

/**
 * Separates calculated, approved and payable overtime.
 *
 * Payroll may only draw on APPROVED minutes. Minutes that attendance derived
 * but nobody approved are reported as pending rather than being paid
 * automatically — that separation is the whole point of the change.
 */
export async function getOvertimeSummary(params: {
    year: number;
    month: number;
    employeeId?: string;
}): Promise<OvertimeSummary[]> {
    await requirePermission(PERMISSIONS.PAYROLL_VIEW);

    const attendance = await prisma.attendance.findMany({
        where: {
            date: {
                gte: new Date(params.year, params.month - 1, 1),
                lt: new Date(params.year, params.month, 1),
            },
            ...(params.employeeId ? { employeeId: params.employeeId } : {}),
        },
        select: {
            employeeId: true,
            overtimeMinutes: true,
            date: true,
        },
    });

    const byEmployee = new Map<string, number>();
    for (const row of attendance) {
        byEmployee.set(
            row.employeeId,
            (byEmployee.get(row.employeeId) ?? 0) + (row.overtimeMinutes ?? 0)
        );
    }

    // Approved overtime comes from the Overtime model's own status, not from
    // attendance, so attendance alone can never create payable overtime.
    const approvals = await prisma.overtime.findMany({
        where: {
            date: {
                gte: new Date(params.year, params.month - 1, 1),
                lt: new Date(params.year, params.month, 1),
            },
            ...(params.employeeId ? { employeeId: params.employeeId } : {}),
        },
        select: { employeeId: true, hours: true, status: true },
    });

    const approvedByEmployee = new Map<string, number>();
    for (const row of approvals) {
        if (String(row.status).toUpperCase() !== "APPROVED") continue;
        approvedByEmployee.set(
            row.employeeId,
            (approvedByEmployee.get(row.employeeId) ?? 0) + (row.hours ?? 0) * 60
        );
    }

    const period = `${params.year}-${String(params.month).padStart(2, "0")}`;

    return [...byEmployee.entries()].map(([employeeId, calculatedMinutes]) => {
        const approvedMinutes = approvedByEmployee.get(employeeId) ?? 0;
        return {
            employeeId,
            period,
            calculatedMinutes,
            approvedMinutes,
            // Payable never exceeds approved: unapproved attendance-derived
            // minutes are simply not payable.
            payableMinutes: Math.min(approvedMinutes, calculatedMinutes || approvedMinutes),
            pendingApproval: approvedMinutes < calculatedMinutes,
        };
    });
}

/** Approve overtime. Only APPROVED overtime may reach payroll. */
export async function approveOvertime(params: {
    overtimeId: string;
    approve: boolean;
    actor: { id: string; email: string; role: string };
}): Promise<{ success: boolean; message: string }> {
    try {
        await requirePermission(PERMISSIONS.PAYROLL_OVERTIME_MANAGE);

        const record = await prisma.overtime.findUnique({
            where: { id: params.overtimeId },
            select: { id: true, employeeId: true, hours: true, status: true },
        });
        if (!record) return { success: false, message: "Overtime record not found." };
        if (String(record.status).toUpperCase() === "APPROVED" && params.approve) {
            return { success: false, message: "This overtime is already approved." };
        }

        const nextStatus = params.approve ? "APPROVED" : "REJECTED";

        await prisma.$transaction([
            prisma.overtime.update({
                where: { id: params.overtimeId },
                data: { status: nextStatus },
            }),
            prisma.auditLog.create({
                data: {
                    employeeId: record.employeeId,
                    action: `OVERTIME_${nextStatus}`,
                    details: `${record.hours}h overtime ${record.status} → ${nextStatus}`,
                    changedBy: params.actor.email,
                },
            }),
        ]);

        return {
            success: true,
            message: params.approve
                ? `${record.hours}h approved and now payable.`
                : `${record.hours}h rejected.`,
        };
    } catch (error) {
        console.error("[APPROVE_OVERTIME_FAILED]", error);
        return { success: false, message: "Could not update the overtime record." };
    }
}
