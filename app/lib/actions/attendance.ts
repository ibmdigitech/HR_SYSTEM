"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

export async function checkIn() {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Unauthorized" };

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true }
        });

        if (!user || !user.employee) return { success: false, message: "Employee profile not found" };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if already checked in
        const existing = await prisma.attendance.findFirst({
            where: {
                employeeId: user.employee.id,
                date: {
                    gte: today,
                    lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                }
            }
        });

        if (existing) return { success: false, message: "Already checked in today" };

        const now = new Date();
        const checkInTime = now;

        // Determine status (simple logic for now: before 9:15 AM is PRESENT, after is LATE)
        const threshold = new Date(today);
        threshold.setHours(9, 15, 0, 0);
        const status = now > threshold ? "LATE" : "PRESENT";

        await prisma.attendance.create({
            data: {
                employeeId: user.employee.id,
                date: today,
                checkIn: checkInTime,
                status: status
            }
        });

        // Audit Log
        await prisma.auditLog.create({
            data: {
                employeeId: user.employee.id,
                action: "CHECK_IN",
                details: `Checked in at ${now.toLocaleTimeString()}`,
                changedBy: session.user.email
            }
        });

        revalidatePath("/attendance");
        revalidatePath("/dashboard");
        return { success: true, message: "Checked in successfully" };
    } catch (error: unknown) {
        console.error("[CHECK_IN_ERROR]", error);
        return { success: false, message: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function checkOut() {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Unauthorized" };

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true }
        });

        if (!user || !user.employee) return { success: false, message: "Employee profile not found" };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await prisma.attendance.findFirst({
            where: {
                employeeId: user.employee.id,
                date: {
                    gte: today,
                    lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                }
            }
        });

        if (!existing) return { success: false, message: "No check-in record found for today" };
        if (existing.checkOut) return { success: false, message: "Already checked out today" };

        const now = new Date();
        
        await prisma.attendance.update({
            where: { id: existing.id },
            data: { checkOut: now }
        });

        // Audit Log
        await prisma.auditLog.create({
            data: {
                employeeId: user.employee.id,
                action: "CHECK_OUT",
                details: `Checked out at ${now.toLocaleTimeString()}`,
                changedBy: session.user.email
            }
        });

        revalidatePath("/attendance");
        revalidatePath("/dashboard");
        return { success: true, message: "Checked out successfully" };
    } catch (error: unknown) {
        console.error("[CHECK_OUT_ERROR]", error);
        return { success: false, message: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function getTodayStatus() {
    const session = await auth();
    if (!session?.user?.email) return { success: false, data: null };

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true }
        });

        if (!user || !user.employee) return { success: false, data: null };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attendance = await prisma.attendance.findFirst({
            where: {
                employeeId: user.employee.id,
                date: {
                    gte: today,
                    lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                }
            }
        });

        return { success: true, data: attendance };
    } catch (error) {
        return { success: false, data: null };
    }
}
