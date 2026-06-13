"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";

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
        return { success: true, data: shifts };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function createShift(data: ShiftData) {
    const session = await auth();
    if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "HR")) {
        throw new Error("Unauthorized");
    }

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
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateShift(id: string, data: Partial<ShiftData>) {
    const session = await auth();
    if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "HR")) {
        throw new Error("Unauthorized");
    }

    try {
        const shift = await prisma.shift.update({
            where: { id },
            data,
        });
        return { success: true, data: shift };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteShift(id: string) {
    const session = await auth();
    if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "HR")) {
        throw new Error("Unauthorized");
    }

    try {
        await prisma.shift.delete({
            where: { id },
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
