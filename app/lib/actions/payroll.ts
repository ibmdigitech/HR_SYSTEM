"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getConfig } from "@/lib/config-service";

export async function upsertSalaryStructure(formData: FormData) {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    const employeeId = formData.get("employeeId") as string;
    const ctc = parseFloat(formData.get("ctc") as string) || 0;
    const basic = parseFloat(formData.get("basic") as string) || 0;
    const housingAllowance = parseFloat(formData.get("housingAllowance") as string) || 0;
    const transportAllowance = parseFloat(formData.get("transportAllowance") as string) || 0;
    const medicalAllowance = parseFloat(formData.get("medicalAllowance") as string) || 0;
    const otherAllowances = parseFloat(formData.get("otherAllowances") as string) || 0;
    const paymentMethod = formData.get("paymentMethod") as string || "BANK_TRANSFER";

    try {
        const data = {
            ctc, basic, housingAllowance, transportAllowance, medicalAllowance, otherAllowances, paymentMethod
        };

        await prisma.salaryStructure.upsert({
            where: { employeeId },
            update: data,
            create: { employeeId, ...data }
        });

        await prisma.auditLog.create({
            data: {
                employeeId: employeeId,
                action: "SALARY_UPDATE",
                details: `Updated salary structure. CTC: ${ctc}`,
                changedBy: session?.user?.email || "System"
            }
        });

        revalidatePath("/payroll/structure");
        return { success: true, message: "Salary structure saved successfully" };
    } catch (error: any) {
        console.error("[UPSERT_SALARY_STRUCTURE_ERROR]", error);
        return { success: false, message: `Error: ${error.message}` };
    }
}

export async function generatePayroll(month: number, year: number) {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    try {
        const employees = await prisma.employee.findMany({
            include: { salaryStructure: true }
        });

        const activeEmployees = employees.filter(e => e.isActive && e.salaryStructure);

        // Fetch dynamic configs
        const defaultLatePenalty = await getConfig('payroll', 'late_penalty_amount') || 50;

        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

        const records = [];
        for (const emp of activeEmployees) {
            const struct = emp.salaryStructure!;
            const totalAllowances = struct.housingAllowance + struct.transportAllowance + struct.medicalAllowance + struct.otherAllowances;

            // 1. Count late check-ins from Attendance in this month
            const attendances = await prisma.attendance.findMany({
                where: {
                    employeeId: emp.id,
                    date: {
                        gte: startOfMonth,
                        lte: endOfMonth
                    }
                }
            });
            const lateCount = attendances.filter(a => a.status === "LATE" || a.lateMinutes > 0).length;
            const latePenalty = lateCount * defaultLatePenalty;

            // 2. Count unpaid leave days in this month
            const leaves = await prisma.leaveRequest.findMany({
                where: {
                    employeeId: emp.id,
                    type: "UNPAID",
                    hrStatus: "APPROVED",
                    startDate: { lte: endOfMonth },
                    endDate: { gte: startOfMonth }
                }
            });

            let unpaidDays = 0;
            for (const leave of leaves) {
                const start = new Date(Math.max(new Date(leave.startDate).getTime(), startOfMonth.getTime()));
                const end = new Date(Math.min(new Date(leave.endDate).getTime(), endOfMonth.getTime()));
                if (start <= end) {
                    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                    unpaidDays += days;
                }
            }

            const leaveDeduction = unpaidDays * (struct.basic / 30);
            const loanDeduction = 0;
            const otherDeductions = 0;
            const overtimePay = 0;
            const bonus = 0;
            
            const totalDeductions = latePenalty + leaveDeduction + loanDeduction + otherDeductions;
            const netSalary = struct.basic + totalAllowances + overtimePay + bonus - totalDeductions;

            records.push({
                employeeId: emp.id,
                month,
                year,
                basic: struct.basic,
                housingAllowance: struct.housingAllowance,
                transportAllowance: struct.transportAllowance,
                medicalAllowance: struct.medicalAllowance,
                otherAllowances: struct.otherAllowances,
                latePenalty,
                leaveDeduction,
                loanDeduction,
                otherDeductions,
                overtimePay,
                bonus,
                netSalary,
                status: "PENDING",
                paymentMethod: struct.paymentMethod
            });
        }

        const monthNames = [
            "January", "February", "March", "April", "May", "June", 
            "July", "August", "September", "October", "November", "December"
        ];
        const monthName = monthNames[month - 1] || `${month}`;

        for (const record of records) {
            const existing = await prisma.salaryRecord.findFirst({
                where: { employeeId: record.employeeId, month, year }
            });
            if (existing) {
                await prisma.salaryRecord.update({
                    where: { id: existing.id },
                    data: record
                });
            } else {
                await prisma.salaryRecord.create({ data: record });
            }

            // Create in-app notification
            await prisma.notification.create({
                data: {
                    employeeId: record.employeeId,
                    title: `Payslip Generated for ${monthName} ${year} 📄`,
                    message: `Your payslip for ${monthName} ${year} has been generated. Net Pay: AED ${record.netSalary.toFixed(2)}.`,
                    type: "SUCCESS",
                    link: "/staff-services",
                }
            });
        }

        revalidatePath("/payroll");
        return { success: true, message: `Payroll generated and notifications dispatched for ${records.length} employees` };
    } catch (error: any) {
        console.error("[GENERATE_PAYROLL_ERROR]", error);
        return { success: false, message: `Error: ${error.message}` };
    }
}
