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

        // Audit Log
        await prisma.auditLog.create({
            data: {
                employeeId: user.employee.id,
                action: "LEAVE_SUBMIT",
                details: `Submitted ${type} leave request from ${startDate} to ${endDate}`,
                changedBy: session.user.email
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

    try {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user || user.role !== "MANAGER") {
            return { message: "Unauthorized: Manager role required", success: false };
        }

        await prisma.leaveRequest.update({
            where: { id: leaveId },
            data: {
                managerStatus: status,
                managerId: session.user.id,
                ...(status === 'REJECTED' ? { hrStatus: 'REJECTED' } : {})
            }
        });

        // Audit Log
        const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveId } });
        await prisma.auditLog.create({
            data: {
                employeeId: leave?.employeeId || "",
                action: `LEAVE_MGR_${status}`,
                details: `Manager ${status.toLowerCase()}ed leave request ID: ${leaveId}`,
                changedBy: session.user.email
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

    try {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user || (user.role !== "HR" && user.role !== "ADMIN")) {
            return { message: "Unauthorized: HR or Admin role required", success: false };
        }

        await prisma.leaveRequest.update({
            where: { id: leaveId },
            data: {
                hrStatus: status,
                hrId: session.user.id
            }
        });

        // Audit Log
        const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveId } });
        await prisma.auditLog.create({
            data: {
                employeeId: leave?.employeeId || "",
                action: `LEAVE_HR_${status}`,
                details: `HR ${status.toLowerCase()}ed leave request ID: ${leaveId}`,
                changedBy: session.user.email
            }
        });

        revalidatePath("/dashboard/approvals");
        return { message: `Request ${status}`, success: true };
    } catch (e) {
        return { message: "Error updating status", success: false };
    }
}
