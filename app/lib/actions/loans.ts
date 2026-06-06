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
    const issueDate = new Date(formData.get("issueDate") as string);
    const installmentAmount = parseFloat(formData.get("installmentAmount") as string) || 0;

    if (!employeeId || amount <= 0 || installmentAmount <= 0) {
        return { success: false, message: "Invalid loan details" };
    }

    try {
        await prisma.loan.create({
            data: {
                employeeId,
                amount,
                issueDate,
                installmentAmount,
                remainingBalance: amount,
                status: "ACTIVE"
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
        await prisma.loan.update({
            where: { id: loanId },
            data: { status: "CANCELLED" }
        });

        revalidatePath("/payroll/loans");
        return { success: true, message: "Loan cancelled successfully" };
    } catch (error: any) {
        return { success: false, message: "Failed to cancel loan" };
    }
}
