'use server';

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function requestLoan(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    const amountStr = formData.get("amount") as string;
    const installmentStr = formData.get("installmentAmount") as string;
    const reason = formData.get("reason") as string;

    const amount = parseFloat(amountStr);
    const installmentAmount = parseFloat(installmentStr);

    if (isNaN(amount) || amount <= 0 || isNaN(installmentAmount) || installmentAmount <= 0) {
        return { message: "Invalid amount or installment", success: false };
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true },
        });

        if (!user?.employee) return { message: "Employee profile not found.", success: false };

        const loan = await prisma.loan.create({
            data: {
                employeeId: user.employee.id,
                amount,
                installmentAmount,
                reason,
                status: "REQUESTED",
                managerStatus: "PENDING",
                hrStatus: "PENDING",
                financeStatus: "PENDING"
            },
        });

        revalidatePath("/payroll/loans");
        revalidatePath("/dashboard/approvals");
        return { message: "Loan request submitted successfully!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}

export async function approveLoan(loanId: string, role: "MANAGER" | "HR" | "FINANCE", action: "APPROVE" | "REJECT") {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    try {
        const loan = await prisma.loan.findUnique({ where: { id: loanId } });
        if (!loan) return { message: "Loan not found", success: false };

        const updateData: any = {};
        
        if (role === "MANAGER") {
            updateData.managerStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
            if (action === "REJECT") updateData.status = "REJECTED";
        } else if (role === "HR") {
            updateData.hrStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
            if (action === "REJECT") updateData.status = "REJECTED";
        } else if (role === "FINANCE") {
            updateData.financeStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
            if (action === "REJECT") {
                updateData.status = "REJECTED";
            } else if (action === "APPROVE") {
                // Final approval by finance makes it active
                updateData.status = "ACTIVE";
                updateData.issueDate = new Date();
                updateData.remainingBalance = loan.amount;
            }
        }

        await prisma.loan.update({
            where: { id: loanId },
            data: updateData
        });

        // Add audit log
        await prisma.auditLog.create({
            data: {
                action: `LOAN_${action}`,
                details: `Loan ${loanId} ${action.toLowerCase()}ed by ${role}.`,
                userId: session.user.email
            }
        });

        revalidatePath("/payroll/loans");
        revalidatePath("/dashboard/approvals");
        return { message: `Loan successfully ${action.toLowerCase()}ed!`, success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}
