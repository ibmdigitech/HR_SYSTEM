"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

/**
 * HR Action: Create or Update a Service Type (Tab)
 */
export async function upsertServiceType(formData: FormData) {
    const session = await auth();
    if (!session || !session.user || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const icon = formData.get("icon") as string;
    const description = formData.get("description") as string;
    const requiresAmount = formData.get("requiresAmount") === "true";
    const requiresDates = formData.get("requiresDates") === "true";

    try {
        if (id) {
            await prisma.staffServiceType.update({
                where: { id },
                data: { name, icon, description, requiresAmount, requiresDates }
            });
        } else {
            await prisma.staffServiceType.create({
                data: { name, icon, description, requiresAmount, requiresDates }
            });
        }
        revalidatePath("/dashboard/admin/services");
        revalidatePath("/dashboard/requests");
        return { success: true, message: "Service type saved successfully" };
    } catch (error) {
        return { success: false, message: "Failed to save service type" };
    }
}

/**
 * Staff Action: Submit a Request
 */
// Staff Action: Submit a Request (form action must return void)
export async function submitStaffRequest(formData: FormData): Promise<void> {
    const session = await auth();
    if (!session || !session.user) {
        console.log("Not authenticated");
        return;
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email! },
        include: { employee: true }
    });

    if (!user || !user.employee) {
        console.log("Employee profile not found");
        return;
    }

    const typeId = formData.get("typeId") as string;
    const details = formData.get("details") as string;
    const amount = formData.get("amount") ? parseFloat(formData.get("amount") as string) : null;
    const startDate = formData.get("startDate") ? new Date(formData.get("startDate") as string) : null;
    const endDate = formData.get("endDate") ? new Date(formData.get("endDate") as string) : null;

    try {
        const staffRequest = await prisma.staffRequest.create({
            data: {
                employeeId: user.employee.id,
                typeId,
                details,
                amount,
                startDate,
                endDate,
                status: "PENDING",
            },
        });

        // Handle attachments
        const file = formData.get("attachment") as File;
        if (file && file.size > 0) {
            await prisma.attachment.create({
                data: {
                    staffRequestId: staffRequest.id,
                    fileName: file.name,
                    fileUrl: `/uploads/staff_${Date.now()}_${file.name}`,
                    fileType: file.type,
                    category: "STAFF_REQUEST_ATTACHMENT",
                },
            });
        }
        revalidatePath("/dashboard/requests");
        console.log("Request submitted successfully");
    } catch (error) {
        console.error("Failed to submit request", error);
    }
}

    // Duplicate old submitStaffRequest implementation removed

/**
 * HR Action: Delete a Service Type
 */
export async function deleteServiceType(id: string) {
    const session = await auth();
    if (!session || !session.user || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    try {
        await prisma.staffServiceType.delete({ where: { id } });
        revalidatePath("/dashboard/admin/services");
        revalidatePath("/dashboard/requests");
        return { success: true, message: "Service type deleted" };
    } catch (error) {
        return { success: false, message: "Failed to delete service type" };
    }
}

/**
 * HR/Manager Action: Approve or Reject a Staff Request
 */
export async function approveStaffRequest(requestId: string, status: "APPROVED" | "REJECTED") {
    const session = await auth();
    if (!session || !session.user) {
        return { success: false, message: "Unauthorized" };
    }

    try {
        const user = await prisma.user.findUnique({ where: { email: session.user.email! } });
        if (!user || !["ADMIN", "HR", "MANAGER"].includes(user.role)) {
            return { success: false, message: "Unauthorized: Required role not found" };
        }

        await prisma.staffRequest.update({
            where: { id: requestId },
            data: { status }
        });
        revalidatePath("/dashboard/approvals");
        revalidatePath("/dashboard/requests");
        return { success: true, message: `Request ${status.toLowerCase()}` };
    } catch (error) {
        return { success: false, message: "Failed to update request" };
    }
}
