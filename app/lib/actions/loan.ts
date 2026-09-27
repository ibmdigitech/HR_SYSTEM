'use server';

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function requestLoan(prevState: unknown, formData: FormData) {
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

        // Get a default loan type or create one
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
                employeeId: user.employee.id,
                loanTypeId: loanType.id,
                requestedAmount: amount,
                repaymentMonths,
                reason,
                status: "SUBMITTED",
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
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true },
        });

        const loan = await prisma.loanApplication.findUnique({ where: { id: loanId } });
        if (!loan) return { message: "Loan not found", success: false };

        const updateData: Record<string, unknown> = {};
        
        if (role === "MANAGER") {
            updateData.managerStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
            if (action === "REJECT") updateData.status = "REJECTED";
            else updateData.status = "PENDING_HR";
        } else if (role === "HR") {
            updateData.hrStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
            if (action === "REJECT") updateData.status = "REJECTED";
            else updateData.status = "PENDING_FINANCE";
        } else if (role === "FINANCE") {
            updateData.financeStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
            if (action === "REJECT") {
                updateData.status = "REJECTED";
            } else if (action === "APPROVE") {
                updateData.status = "APPROVED";
            }
        }

        await prisma.loanApplication.update({
            where: { id: loanId },
            data: updateData
        });

        // Add audit log
        if (user?.employee) {
            await prisma.auditLog.create({
                data: {
                    action: `LOAN_${action}`,
                    details: `Loan ${loanId} ${action.toLowerCase()}d by ${role}.`,
                    employeeId: user.employee.id,
                    changedBy: session.user.email
                }
            });
        }

        revalidatePath("/payroll/loans");
        revalidatePath("/dashboard/approvals");
        return { message: `Loan successfully ${action.toLowerCase()}d!`, success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}
