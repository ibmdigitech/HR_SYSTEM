'use server';

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function submitLeaveRequest(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) {
        return { message: "Not authenticated", success: false };
    }

    const type = formData.get("type") as string;
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    const reason = formData.get("reason") as string;
    const attachment = formData.get("attachment") as File;

    if (!type || !startDate || !endDate || !reason) {
        return { message: "Missing required fields", success: false };
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true }
        });

        if (!user || !user.employee) {
            return { message: "Employee profile not found. Contact HR.", success: false };
        }

        // Create Leave Request
        const leave = await prisma.leaveRequest.create({
            data: {
                employeeId: user.employee.id,
                type,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                reason,
                managerStatus: "PENDING",
                hrStatus: "PENDING",
            }
        });

        // If there's an attachment (mocking storage, just saving info)
        if (attachment && attachment.name && attachment.size > 0) {
            await prisma.attachment.create({
                data: {
                    employeeId: user.employee.id,
                    fileName: attachment.name,
                    fileUrl: `/uploads/${attachment.name}`, // Placeholder path
                    fileType: attachment.type,
                    category: "LEAVE_ATTACHMENT",
                }
            });
        }

        revalidatePath("/dashboard");
        return { message: "Leave request submitted successfully!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}

export async function approveLeaveManager(leaveId: string, status: "APPROVED" | "REJECTED") {
    const session = await auth();
    if (!session?.user?.email) return { message: "Unauthorized", success: false };

    // In real app, verify session.user is MANAGER

    try {
        await prisma.leaveRequest.update({
            where: { id: leaveId },
            data: {
                managerStatus: status,
                managerId: session.user.id // assuming ID is available/fetched
            }
        });
        revalidatePath("/dashboard/approvals");
        return { message: `Request ${status}`, success: true };
    } catch (e) {
        return { message: "Error updating status", success: false };
    }
}

export async function approveLeaveHR(leaveId: string, status: "APPROVED" | "REJECTED") {
    const session = await auth();
    if (!session?.user?.email) return { message: "Unauthorized", success: false };

    // In real app, verify session.user is HR

    try {
        await prisma.leaveRequest.update({
            where: { id: leaveId },
            data: {
                hrStatus: status,
                hrId: session.user.id
            }
        });
        revalidatePath("/dashboard/approvals");
        return { message: `Request ${status}`, success: true };
    } catch (e) {
        return { message: "Error updating status", success: false };
    }
}
