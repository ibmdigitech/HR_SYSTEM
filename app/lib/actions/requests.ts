"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

export async function submitStaffRequest(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Not authenticated" };

    const typeId = formData.get("typeId") as string;
    const details = formData.get("details") as string;
    const amountVal = formData.get("amount") as string;
    const startDateVal = formData.get("startDate") as string;
    const endDateVal = formData.get("endDate") as string;

    if (!typeId || !details) {
        return { success: false, message: "Missing required fields" };
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true }
        });

        if (!user?.employee) {
            return { success: false, message: "Employee profile not found" };
        }

        const amount = amountVal ? parseFloat(amountVal) : null;
        const startDate = startDateVal ? new Date(startDateVal) : null;
        const endDate = endDateVal ? new Date(endDateVal) : null;

        await prisma.staffRequest.create({
            data: {
                employeeId: user.employee.id,
                typeId,
                details,
                amount,
                startDate,
                endDate,
                status: "PENDING"
            }
        });

        // Audit Log
        await prisma.auditLog.create({
            data: {
                employeeId: user.employee.id,
                action: "REQUEST_SUBMIT",
                details: `Submitted a request of type ID: ${typeId}`,
                changedBy: session.user.email
            }
        });

        revalidatePath("/requests");
        revalidatePath("/staff-services");
        return { success: true, message: "Your request has been submitted successfully!" };
    } catch (e: any) {
        console.error("[SUBMIT_REQUEST_ERROR]", e);
        return { success: false, message: e.message || "Failed to submit request" };
    }
}

export async function handleRequestAction(requestId: string, action: "APPROVED" | "REJECTED" | "COMPLETED", hrNote?: string) {
    const session = await auth();
    if (!session?.user?.email) return { success: false, message: "Not authenticated" };

    const userRole = (session.user as any).role;
    if (!["ADMIN", "HR"].includes(userRole)) {
        return { success: false, message: "Unauthorized action" };
    }

    try {
        const req = await prisma.staffRequest.update({
            where: { id: requestId },
            data: {
                status: action,
                hrNote: hrNote || null
            },
            include: {
                employee: true,
                serviceType: true
            }
        });

        // Notify the employee
        await prisma.notification.create({
            data: {
                employeeId: req.employeeId,
                title: `Request ${action === "APPROVED" ? "Approved ✅" : action === "REJECTED" ? "Rejected ❌" : "Completed 🎉"}`,
                message: `Your request for "${req.serviceType.name}" has been ${action.toLowerCase()}${hrNote ? `. Note: ${hrNote}` : ""}.`,
                type: action === "APPROVED" || action === "COMPLETED" ? "SUCCESS" : "WARNING",
                link: "/requests"
            }
        });

        // Audit Log
        await prisma.auditLog.create({
            data: {
                employeeId: req.employeeId,
                action: `REQUEST_${action}`,
                details: `Request for ${req.serviceType.name} was ${action.toLowerCase()}`,
                changedBy: session.user.email
            }
        });

        revalidatePath("/requests");
        revalidatePath("/staff-services");
        return { success: true, message: `Request successfully ${action.toLowerCase()}` };
    } catch (e: any) {
        console.error("[REQUEST_ACTION_ERROR]", e);
        return { success: false, message: e.message || "Failed to update request" };
    }
}
