"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

export async function createLoan(formData: FormData) {
    const session = await auth();
    if (!session || !["ADMIN", "HR", "FINANCE"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    const employeeId = formData.get("employeeId") as string;
    const amount = parseFloat(formData.get("amount") as string) || 0;
    const installmentAmount = parseFloat(formData.get("installmentAmount") as string) || 0;

    if (!employeeId || amount <= 0 || installmentAmount <= 0) {
        return { success: false, message: "Invalid loan details" };
    }

    try {
        // Get or create default loan type
        let loanType = await prisma.loanType.findFirst({ where: { isActive: true } });
        if (!loanType) {
            loanType = await prisma.loanType.create({
                data: {
                    name: "Salary Advance",
                    maxAmount: 50000,
                    maxRepaymentMonths: 12,
                    requiresProbation: false,
                }
            });
        }

        const repaymentMonths = Math.ceil(amount / installmentAmount);

        await prisma.loanApplication.create({
            data: {
                employeeId,
                loanTypeId: loanType.id,
                requestedAmount: amount,
                repaymentMonths,
                reason: `Admin-created loan: AED ${amount} with AED ${installmentAmount}/month`,
                status: "APPROVED",
                managerStatus: "APPROVED",
                hrStatus: "APPROVED",
                financeStatus: "APPROVED"
            }
        });

        await prisma.auditLog.create({
            data: {
                employeeId,
                action: "LOAN_CREATED",
                details: `Loan of AED ${amount} issued with monthly installment of AED ${installmentAmount}`,
                changedBy: session.user?.email || "System"
            }
        });

        revalidatePath("/payroll/loans");
        return { success: true, message: "Loan created successfully" };
    } catch (error: any) {
        console.error("[CREATE_LOAN_ERROR]", error);
        return { success: false, message: "Failed to create loan" };
    }
}

export async function cancelLoan(loanId: string) {
    const session = await auth();
    if (!session || !["ADMIN", "HR", "FINANCE"].includes((session.user as any).role)) {
        return { success: false, message: "Unauthorized" };
    }

    try {
        await prisma.loanApplication.update({
            where: { id: loanId },
            data: { status: "CANCELLED" }
        });

        revalidatePath("/payroll/loans");
        return { success: true, message: "Loan cancelled successfully" };
    } catch (error: any) {
        return { success: false, message: "Failed to cancel loan" };
    }
}
