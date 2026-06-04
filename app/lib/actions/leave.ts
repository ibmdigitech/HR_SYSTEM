'use server';

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function submitLeaveRequest(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    const type      = formData.get("type") as string;
    const startDate = formData.get("startDate") as string;
    const endDate   = formData.get("endDate") as string;
    const reason    = formData.get("reason") as string;
    const attachment = formData.get("attachment") as File;

    if (!type || !startDate || !endDate || !reason)
        return { message: "Missing required fields", success: false };

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true },
        });
        if (!user?.employee) return { message: "Employee profile not found. Contact HR.", success: false };

        const leave = await prisma.leaveRequest.create({
            data: {
                employeeId:    user.employee.id,
                type,
                startDate:     new Date(startDate),
                endDate:       new Date(endDate),
                reason,
                managerStatus: "PENDING",
                hrStatus:      "PENDING",
            },
        });

        await prisma.auditLog.create({
            data: {
                employeeId: user.employee.id,
                action:     "LEAVE_SUBMIT",
                details:    `Submitted ${type} leave from ${startDate} to ${endDate}`,
                changedBy:  session.user.email,
            },
        });

        if (attachment?.name && attachment.size > 0) {
            await prisma.attachment.create({
                data: {
                    employeeId: user.employee.id,
                    fileName:   attachment.name,
                    fileUrl:    `/uploads/${attachment.name}`,
                    fileType:   attachment.type,
                    category:   "LEAVE_ATTACHMENT",
                },
            });
        }

        revalidatePath("/leaves");
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
        if (!user || user.role !== "MANAGER") return { message: "Unauthorized: Manager role required", success: false };

        const leave = await prisma.leaveRequest.update({
            where: { id: leaveId },
            data: {
                managerStatus: status,
                managerId:     session.user.id,
                ...(status === "REJECTED" ? { hrStatus: "REJECTED" } : {}),
            },
            include: { employee: true },
        });

        // Notify employee
        if (leave.employee) {
            await prisma.notification.create({
                data: {
                    employeeId: leave.employeeId,
                    title:      status === "APPROVED" ? "Leave Approved by Manager ✅" : "Leave Rejected by Manager ❌",
                    message:    `Your ${leave.type} leave request (${new Date(leave.startDate).toLocaleDateString()} – ${new Date(leave.endDate).toLocaleDateString()}) has been ${status.toLowerCase()} by your manager.`,
                    type:       status === "APPROVED" ? "SUCCESS" : "WARNING",
                    link:       "/leaves",
                },
            });
        }

        await prisma.auditLog.create({
            data: {
                employeeId: leave.employeeId,
                action:     `LEAVE_MGR_${status}`,
                details:    `Manager ${status.toLowerCase()}ed leave ID: ${leaveId}`,
                changedBy:  session.user.email,
            },
        });

        revalidatePath("/dashboard/approvals");
        revalidatePath("/leaves");
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
        if (!user || (user.role !== "HR" && user.role !== "ADMIN"))
            return { message: "Unauthorized: HR or Admin role required", success: false };

        const leave = await prisma.leaveRequest.update({
            where: { id: leaveId },
            data: { hrStatus: status, hrId: session.user.id },
            include: { employee: true },
        });

        // ── On full approval: update leave balance + attendance ──────────────
        if (status === "APPROVED") {
            const start    = new Date(leave.startDate);
            const end      = new Date(leave.endDate);
            const days     = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            const year     = start.getFullYear();

            // Decrement leave balance
            try {
                await prisma.leaveBalance.upsert({
                    where: {
                        employeeId_leaveType_year: {
                            employeeId: leave.employeeId,
                            leaveType:  leave.type,
                            year,
                        },
                    },
                    update: { usedDays: { increment: days } },
                    create: {
                        employeeId: leave.employeeId,
                        leaveType:  leave.type,
                        totalDays:  0,
                        usedDays:   days,
                        year,
                    },
                });
            } catch (balErr) {
                console.warn("[LEAVE_BALANCE_UPDATE_WARN]", balErr);
            }

            // Mark attendance as LEAVE for each date in range
            try {
                const dateList: Date[] = [];
                const cur = new Date(start);
                while (cur <= end) {
                    dateList.push(new Date(cur));
                    cur.setDate(cur.getDate() + 1);
                }

                for (const d of dateList) {
                    const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
                    const dayEnd   = new Date(d); dayEnd.setHours(23, 59, 59, 999);

                    const existing = await prisma.attendance.findFirst({
                        where: {
                            employeeId: leave.employeeId,
                            date: { gte: dayStart, lte: dayEnd },
                        },
                    });

                    if (existing) {
                        await prisma.attendance.update({
                            where: { id: existing.id },
                            data:  { status: "LEAVE" },
                        });
                    } else {
                        await prisma.attendance.create({
                            data: {
                                employeeId: leave.employeeId,
                                date:       dayStart,
                                status:     "LEAVE",
                            },
                        });
                    }
                }
            } catch (attErr) {
                console.warn("[ATTENDANCE_LEAVE_UPDATE_WARN]", attErr);
            }
        }

        // Notify employee
        if (leave.employee) {
            await prisma.notification.create({
                data: {
                    employeeId: leave.employeeId,
                    title:      status === "APPROVED" ? "Leave Fully Approved ✅" : "Leave Rejected by HR ❌",
                    message:    `Your ${leave.type} leave (${new Date(leave.startDate).toLocaleDateString()} – ${new Date(leave.endDate).toLocaleDateString()}) has been ${status === "APPROVED" ? "fully approved by HR" : "rejected by HR"}.`,
                    type:       status === "APPROVED" ? "SUCCESS" : "WARNING",
                    link:       "/leaves",
                },
            });
        }

        await prisma.auditLog.create({
            data: {
                employeeId: leave.employeeId,
                action:     `LEAVE_HR_${status}`,
                details:    `HR ${status.toLowerCase()}ed leave ID: ${leaveId}`,
                changedBy:  session.user.email,
            },
        });

        revalidatePath("/dashboard/approvals");
        revalidatePath("/leaves");
        revalidatePath("/attendance");
        return { message: `Request ${status}`, success: true };
    } catch (e) {
        return { message: "Error updating status", success: false };
    }
}
