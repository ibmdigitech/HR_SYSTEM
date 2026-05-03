"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

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
                changedBy: session.user.email || "System"
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

        const records = activeEmployees.map(emp => {
            const struct = emp.salaryStructure!;
            const totalAllowances = struct.housingAllowance + struct.transportAllowance + struct.medicalAllowance + struct.otherAllowances;
            // Defaults for dynamic deductions / bonuses (can be hooked to attendance later)
            const latePenalty = 0;
            const leaveDeduction = 0;
            const loanDeduction = 0;
            const otherDeductions = 0;
            const overtimePay = 0;
            const bonus = 0;
            
            const totalDeductions = latePenalty + leaveDeduction + loanDeduction + otherDeductions;
            const netSalary = struct.basic + totalAllowances + overtimePay + bonus - totalDeductions;

            return {
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
            };
        });

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
        }

        revalidatePath("/payroll");
        return { success: true, message: `Payroll generated for ${records.length} employees` };
    } catch (error: any) {
        console.error("[GENERATE_PAYROLL_ERROR]", error);
        return { success: false, message: `Error: ${error.message}` };
    }
}
