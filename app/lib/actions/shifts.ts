"use server";

import prisma from "@/lib/prisma";
import { requireAnyPermission,  } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

export interface ShiftData {
    name: string;
    startTime: string;
    endTime: string;
    lateThreshold?: number;
    monthlyLateThresholdHours?: number;
    weeklyOffs: string;
}

export async function getShifts() {
    try {
        const shifts = await prisma.shift.findMany({
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: { employees: true }
                }
            }
        });
        return { success: true, data: shifts ?? [] };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error"), data: [] };
    }
}

export async function createShift(data: ShiftData) {
    await requireAnyPermission([PERMISSIONS.ATTENDANCE_SHIFT_MANAGE]);

    try {
        const shift = await prisma.shift.create({
            data: {
                name: data.name,
                startTime: data.startTime,
                endTime: data.endTime,
                lateThreshold: data.lateThreshold ?? 15,
                monthlyLateThresholdHours: data.monthlyLateThresholdHours ?? 4,
                weeklyOffs: data.weeklyOffs,
            },
        });
        return { success: true, data: shift };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function updateShift(id: string, data: Partial<ShiftData>) {
    await requireAnyPermission([PERMISSIONS.ATTENDANCE_SHIFT_MANAGE]);

    try {
        const shift = await prisma.shift.update({
            where: { id },
            data,
        });
        return { success: true, data: shift };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function deleteShift(id: string) {
    await requireAnyPermission([PERMISSIONS.ATTENDANCE_SHIFT_MANAGE]);

    try {
        await prisma.shift.delete({
            where: { id },
        });
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

// ─── SHIFT ASSIGNMENT ACTIONS ───────────────────────────────────────────────────

export async function assignShift(employeeId: string, shiftId: string | null) {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Not authenticated" };

    const userRole = (session.user as { role?: string })?.role ?? "";
    if (!["ADMIN", "HR", "MANAGER"].includes(userRole)) {
        return { success: false, message: "Unauthorized" };
    }

    try {
        // If manager, verify the employee is a direct report
        if (userRole === "MANAGER") {
            const currentUser = await prisma.user.findUnique({
                where: { email: session.user.email },
                include: { employee: true }
            });
            if (!currentUser?.employee) return { success: false, message: "Profile not found" };

            const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
            if (!employee || employee.managerId !== currentUser.employee.id) {
                return { success: false, message: "You can only manage shifts for your direct reports." };
            }
        }

        await prisma.employee.update({
            where: { id: employeeId },
            data: { shiftId: shiftId || null }
        });

        revalidatePath("/attendance");
        revalidatePath("/attendance/shifts");
        return { success: true, message: "Shift assigned successfully" };
    } catch (error: unknown) {
        return { success: false, message: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function bulkAssignShift(employeeIds: string[], shiftId: string) {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Not authenticated" };

    const userRole = (session.user as { role?: string })?.role ?? "";
    if (!["ADMIN", "HR"].includes(userRole)) {
        return { success: false, message: "Only HR/Admin can perform bulk assignments" };
    }

    try {
        await prisma.employee.updateMany({
            where: { id: { in: employeeIds } },
            data: { shiftId }
        });

        revalidatePath("/attendance");
        revalidatePath("/attendance/shifts");
        return { success: true, message: `${employeeIds.length} employee(s) assigned successfully` };
    } catch (error: unknown) {
        return { success: false, message: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function getShiftRoster() {
    const session = await auth();
    if (!session?.user?.email) return { success: false, data: { shifts: [], unassigned: [] } };

    const userRole = (session.user as { role?: string })?.role ?? "";

    try {
        const currentUser = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true }
        });

        const shifts = await prisma.shift.findMany({
            include: {
                employees: {
                    where: { isActive: true },
                    include: { manager: true },
                    orderBy: { firstName: 'asc' }
                },
                _count: { select: { employees: true } }
            },
            orderBy: { name: 'asc' }
        });

        let unassigned = await prisma.employee.findMany({
            where: { isActive: true, shiftId: null },
            orderBy: { firstName: 'asc' }
        });

        // Manager: filter to only their direct reports
        if (userRole === "MANAGER" && currentUser?.employee) {
            const managerId = currentUser.employee.id;
            const filteredShifts = shifts.map(s => ({
                ...s,
                employees: s.employees.filter(e => e.managerId === managerId),
                _count: { employees: s.employees.filter(e => e.managerId === managerId).length }
            }));
            unassigned = unassigned.filter(e => e.managerId === managerId);
            return { success: true, data: { shifts: filteredShifts, unassigned } };
        }

        return { success: true, data: { shifts, unassigned } };
    } catch (error: unknown) {
        return { success: false, data: { shifts: [], unassigned: [] }, message: (error instanceof Error ? error.message : "Unknown error") };
    }
}
