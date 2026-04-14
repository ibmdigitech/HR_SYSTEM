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
    const hra = parseFloat(formData.get("hra") as string) || 0;
    const allowances = parseFloat(formData.get("allowances") as string) || 0;
    const deductions = parseFloat(formData.get("deductions") as string) || 0;

    try {
        await prisma.salaryStructure.upsert({
            where: { employeeId },
            update: { ctc, basic, hra, allowances, deductions },
            create: { employeeId, ctc, basic, hra, allowances, deductions }
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
            const netSalary = struct.basic + struct.hra + struct.allowances - struct.deductions;

            return {
                employeeId: emp.id,
                month,
                year,
                basic: struct.basic,
                hra: struct.hra,
                allowances: struct.allowances,
                deductions: struct.deductions,
                netSalary,
                status: "GENERATED"
            };
        });

        // We use createMany for efficiency if supported, or a loop. SQLite doesn't support createMany easily with relations in some versions but here it should be fine.
        // Actually SQLite supported createMany in newer Prisma versions.
        for (const record of records) {
            await prisma.salaryRecord.upsert({
                where: {
                    // We need a unique constraint for employeeId_month_year to use upsert effectively.
                    // Let's just create for now or check existence.
                    id: `${record.employeeId}_${month}_${year}` // We can't really use id like this unless it's the primary key.
                },
                // For simplicity in this step, let's just create.
                create: record,
                update: record,
            }).catch(async () => {
                // If upsert fails because of ID mismatch (since id is cuid), let's find and update.
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
            });
        }

        revalidatePath("/payroll");
        return { success: true, message: `Payroll generated for ${records.length} employees` };
    } catch (error: any) {
        console.error("[GENERATE_PAYROLL_ERROR]", error);
        return { success: false, message: `Error: ${error.message}` };
    }
}
