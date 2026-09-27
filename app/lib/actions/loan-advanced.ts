'use server';

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function applyForLoan(formData: FormData) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    const amountStr = formData.get("amount") as string;
    const monthsStr = formData.get("months") as string;
    const loanTypeId = formData.get("loanTypeId") as string;
    const reason = formData.get("reason") as string;

    const requestedAmount = parseFloat(amountStr);
    const repaymentMonths = parseInt(monthsStr);

    if (isNaN(requestedAmount) || requestedAmount <= 0 || isNaN(repaymentMonths) || repaymentMonths <= 0 || !loanTypeId) {
        return { message: "Invalid inputs provided.", success: false };
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { employee: true },
        });

        if (!user?.employee) return { message: "Employee profile not found.", success: false };

        const loanType = await prisma.loanType.findUnique({ where: { id: loanTypeId } });
        if (!loanType) return { message: "Invalid Loan Type selected.", success: false };

        if (requestedAmount > loanType.maxAmount) {
            return { message: `Requested amount exceeds the maximum allowed (${loanType.maxAmount} AED).`, success: false };
        }

        if (repaymentMonths > loanType.maxRepaymentMonths) {
            return { message: `Repayment months exceed the maximum allowed (${loanType.maxRepaymentMonths} months).`, success: false };
        }

        const application = await prisma.loanApplication.create({
            data: {
                employeeId: user.employee.id,
                loanTypeId: loanType.id,
                requestedAmount,
                repaymentMonths,
                reason,
                status: "SUBMITTED",
                managerStatus: "PENDING",
                hrStatus: "PENDING",
                financeStatus: "PENDING"
            },
        });

        // Notify Manager
        if (user.employee.managerId) {
            const manager = await prisma.employee.findUnique({ where: { id: user.employee.managerId } });
            if (manager && manager.email) {
                await prisma.loanNotification.create({
                    data: {
                        targetEmail: manager.email,
                        title: "New Loan Request",
                        message: `${user.name} has applied for a ${loanType.name} of ${requestedAmount} AED.`
                    }
                });
            }
        }

        revalidatePath("/payroll/loans");
        revalidatePath("/dashboard/approvals");
        return { message: "Loan application submitted successfully!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}

export async function processLoanApproval(applicationId: string, level: "MANAGER" | "HR" | "FINANCE" | "FINAL", action: "APPROVED" | "REJECTED" | "ON_HOLD", comments: string) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    try {
        const application = await prisma.loanApplication.findUnique({ 
            where: { id: applicationId },
            include: { employee: true, loanType: true }
        });
        if (!application) return { message: "Application not found.", success: false };

        await prisma.loanApproval.create({
            data: {
                applicationId,
                approverEmail: session.user.email,
                level,
                action,
                comments
            }
        });

        const updateData: Record<string, unknown> = {};
        
        if (level === "MANAGER") {
            updateData.managerStatus = action;
            if (action === "REJECTED") updateData.status = "REJECTED";
            else if (action === "APPROVED") updateData.status = "PENDING_HR";
        } else if (level === "HR") {
            updateData.hrStatus = action;
            if (action === "REJECTED") updateData.status = "REJECTED";
            else if (action === "APPROVED") updateData.status = "PENDING_FINANCE";
        } else if (level === "FINANCE") {
            updateData.financeStatus = action;
            if (action === "REJECTED") updateData.status = "REJECTED";
            else if (action === "APPROVED") updateData.status = "APPROVED"; // Ready for final disbursement
        }

        await prisma.loanApplication.update({
            where: { id: applicationId },
            data: updateData
        });

        // Notify Employee
        await prisma.loanNotification.create({
            data: {
                targetEmail: application.employee.email,
                title: `Loan Application ${action}`,
                message: `Your ${application.loanType.name} application has been ${action.toLowerCase()} by ${level}.`
            }
        });

        revalidatePath("/payroll/loans/admin");
        revalidatePath("/dashboard/approvals");
        return { message: `Successfully processed as ${action}.`, success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}

export async function disburseLoan(applicationId: string, method: string) {
    const session = await auth();
    if (!session?.user?.email) return { message: "Not authenticated", success: false };

    try {
        const application = await prisma.loanApplication.findUnique({ where: { id: applicationId } });
        if (!application || application.status !== "APPROVED") return { message: "Application not approved.", success: false };

        const disbursement = await prisma.loanDisbursement.create({
            data: {
                applicationId,
                method,
                amount: application.requestedAmount,
                transactionRef: `TRX-${Date.now()}`
            }
        });

        // Generate Installments
        const emi = application.requestedAmount / application.repaymentMonths;
        const currentDate = new Date();
        
        for (let i = 1; i <= application.repaymentMonths; i++) {
            const installmentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
            await prisma.loanInstallment.create({
                data: {
                    applicationId,
                    month: installmentDate.getMonth() + 1,
                    year: installmentDate.getFullYear(),
                    amount: emi,
                    status: "PENDING"
                }
            });
        }

        await prisma.loanApplication.update({
            where: { id: applicationId },
            data: { status: "DISBURSED" }
        });

        revalidatePath("/payroll/loans/admin");
        return { message: "Loan disbursed and EMI schedule generated successfully!", success: true };
    } catch (e) {
        console.error(e);
        return { message: "Database Error", success: false };
    }
}
