import prisma from "@/lib/prisma";import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Plus, CheckCircle2, XCircle, Banknote, ArrowLeft } from "lucide-react";import Link from "next/link";import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { requirePermission, AuthenticationError, AuthorizationError } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";

/**
 * Enable/disable a loan type.
 *
 * SECURITY: this action previously performed NO authorization, so any
 * authenticated client could invoke it and change the loan configuration. It
 * now requires `loan.manage` and is audit-logged.
 */
async function toggleLoanType(id: string, isActive: boolean) {
    "use server";
    let actorEmail = "unknown";
    try {
        const actor = await requirePermission(PERMISSIONS.LOAN_MANAGE);
        actorEmail = actor.email;

        await prisma.loanType.update({ where: { id }, data: { isActive: !isActive } });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED, // configuration change
            actorEmail,
            actorRole: actor.role,
            target: `loanType:${id}`,
            outcome: "SUCCESS",
            detail: { change: "loanType.isActive", from: isActive, to: !isActive },
        });

        revalidatePath("/payroll/loans/types");
    } catch (error) {
        if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ACCESS_DENIED,
                actorEmail,
                outcome: "DENIED",
                detail: { target: `loanType:${id}`, reason: (error instanceof Error ? error.message : "Unknown error") },
            });
            return;
        }
        console.error("[toggleLoanType]", error);
    }
}

/**
 * Seed the default loan-type catalogue.
 *
 * SECURITY: previously performed NO authorization. Now requires `loan.manage`.
 * Idempotent via upsert, so repeated invocation creates no duplicates.
 */
async function seedDefaultTypes() {
    "use server";
    let actorEmail = "unknown";
    try {
        const actor = await requirePermission(PERMISSIONS.LOAN_MANAGE);
        actorEmail = actor.email;

        const defaults = [
            { name: "Salary Advance", description: "Short-term salary advance for immediate needs", maxAmount: 15000, interestRate: 0, maxRepaymentMonths: 3, requiresProbation: false },
            { name: "Personal Loan", description: "Personal loan for general expenses", maxAmount: 50000, interestRate: 0, maxRepaymentMonths: 24, requiresProbation: true },
            { name: "Emergency Loan", description: "Emergency financial assistance", maxAmount: 20000, interestRate: 0, maxRepaymentMonths: 12, requiresProbation: false },
            { name: "Education Loan", description: "Loan to support employee or family education expenses", maxAmount: 75000, interestRate: 0, maxRepaymentMonths: 36, requiresProbation: true },
            { name: "Medical Loan", description: "Medical emergency or planned treatment expenses", maxAmount: 30000, interestRate: 0, maxRepaymentMonths: 18, requiresProbation: false },
            { name: "Vehicle Loan", description: "Vehicle purchase or major repair assistance", maxAmount: 100000, interestRate: 0, maxRepaymentMonths: 48, requiresProbation: true },
            { name: "Housing Loan", description: "Home purchase or renovation assistance", maxAmount: 200000, interestRate: 0, maxRepaymentMonths: 60, requiresProbation: true },
        ];

        for (const t of defaults) {
            await prisma.loanType.upsert({
                where: { name: t.name },
                update: {},
                create: t,
            });
        }

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole: actor.role,
            target: "loanType:catalogue",
            outcome: "SUCCESS",
            detail: { change: "seedDefaultLoanTypes", count: defaults.length },
        });

        revalidatePath("/payroll/loans/types");
    } catch (error) {
        if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ACCESS_DENIED,
                actorEmail,
                outcome: "DENIED",
                detail: { target: "loanType:catalogue", reason: (error instanceof Error ? error.message : "Unknown error") },
            });
            return;
        }
        console.error("[seedDefaultTypes]", error);
    }
}

export default async function LoanTypesPage() {
    // Loan configuration is a finance/admin capability. FINANCE is included
    // here because loan types are finance configuration; previously the check
    // allowed only ADMIN/HR, which blocked the finance department from its own
    // settings.
    await requirePageAnyPermission([PERMISSIONS.LOAN_MANAGE, PERMISSIONS.LOAN_VIEW]);

    const loanTypes = await prisma.loanType.findMany({ orderBy: { name: "asc" } });

    return (
        <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <div className="p-2.5 bg-violet-600 rounded-xl shadow-lg shadow-violet-600/20">
                            <Settings className="h-6 w-6 text-white" />
                        </div>
                        Loan Type Policies
                    </h1>
                    <p className="text-slate-500 mt-1 ml-14">Configure loan policies, limits, and approval requirements.</p>
                </div>
                <div className="flex flex-wrap gap-2">                    <Link href="/payroll/loans">                        <Button variant="outline" className="font-bold rounded-xl">                            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Loan Management                        </Button>                    </Link>                    {loanTypes.length === 0 && (                        <form action={seedDefaultTypes}>                            <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl">                                <Plus className="h-4 w-4 mr-2" />                                Seed Default Loan Types                            </Button>                        </form>                    )}                </div>            </div>

            {loanTypes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-200 rounded-2xl text-center">
                    <Banknote className="h-12 w-12 text-slate-300 mb-4" />
                    <p className="font-bold text-slate-600">No Loan Types Configured</p>
                    <p className="text-slate-400 text-sm mt-1">Click &quot;Seed Default Loan Types&quot; to add standard UAE HRMS loan policies.</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {loanTypes.map((lt) => (
                        <Card key={lt.id} className={`rounded-2xl border shadow-sm transition-opacity ${lt.isActive ? "" : "opacity-60"}`}>
                            <CardContent className="p-6 space-y-3">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h3 className="font-black text-slate-900 dark:text-slate-100">{lt.name}</h3>
                                        <p className="text-sm text-slate-500 mt-0.5">{lt.description}</p>
                                    </div>
                                    <Badge className={lt.isActive ? "bg-emerald-100 text-emerald-700 border-0" : "bg-slate-100 text-slate-500 border-0"}>
                                        {lt.isActive ? "Active" : "Inactive"}
                                    </Badge>
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                    <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Max Amount</p>
                                        <p className="text-sm font-black text-indigo-600 mt-0.5">AED {lt.maxAmount.toLocaleString()}</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Max Term</p>
                                        <p className="text-sm font-black text-slate-700 dark:text-slate-300 mt-0.5">{lt.maxRepaymentMonths} mo.</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Interest</p>
                                        <p className="text-sm font-black text-emerald-600 mt-0.5">{lt.interestRate}%</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                        {lt.requiresProbation ? (
                                            <><XCircle className="h-3.5 w-3.5 text-amber-500" /> Requires probation completion</>
                                        ) : (
                                            <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Available during probation</>
                                        )}
                                    </div>
                                    <form action={toggleLoanType.bind(null, lt.id, lt.isActive)}>
                                        <Button
                                            type="submit"
                                            size="sm"
                                            variant="outline"
                                            className={`text-xs rounded-xl font-bold ${lt.isActive ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
                                        >
                                            {lt.isActive ? "Deactivate" : "Activate"}
                                        </Button>
                                    </form>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
