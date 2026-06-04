"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

export async function createOvertime(formData: FormData) {
    const session = await auth();
    if (!session || !["ADMIN", "HR", "MANAGER"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    const employeeId = formData.get("employeeId") as string;
    const date = new Date(formData.get("date") as string);
    const hours = parseFloat(formData.get("hours") as string) || 0;
    const ratePerHour = parseFloat(formData.get("ratePerHour") as string) || 0;

    if (!employeeId || hours <= 0 || ratePerHour <= 0) {
        return { success: false, message: "Invalid overtime details" };
    }

    const totalPay = hours * ratePerHour;

    try {
        await prisma.overtime.create({
            data: {
                employeeId,
                date,
                hours,
                ratePerHour,
                totalPay,
                status: "APPROVED" // Assuming it is approved upon creation for simplicity, or we can make it PENDING
            }
        });

        await prisma.auditLog.create({
            data: {
                employeeId,
                action: "OVERTIME_LOGGED",
                details: `Logged ${hours} hours of overtime for ${date.toISOString().split('T')[0]}`,
                changedBy: session.user.email || "System"
            }
        });

        revalidatePath("/payroll/overtime");
        return { success: true, message: "Overtime logged successfully" };
    } catch (error: any) {
        console.error("[CREATE_OVERTIME_ERROR]", error);
        return { success: false, message: "Failed to log overtime" };
    }
}
