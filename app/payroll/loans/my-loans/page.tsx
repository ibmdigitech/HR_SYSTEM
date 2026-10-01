import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
    Banknote,
    Clock,
    CheckCircle2,
    XCircle,
    Plus,
    FileText,
    TrendingDown,
    AlertCircle,
    Landmark,
    
} from "lucide-react";
import Link from "next/link";

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
    DRAFT:            { label: "Draft",           color: "bg-slate-100 text-slate-600",   icon: FileText },
    SUBMITTED:        { label: "Submitted",        color: "bg-blue-100 text-blue-700",     icon: Clock },
    PENDING_MANAGER:  { label: "With Manager",     color: "bg-amber-100 text-amber-700",   icon: Clock },
    PENDING_HR:       { label: "With HR",          color: "bg-purple-100 text-purple-700", icon: Clock },
    PENDING_FINANCE:  { label: "With Finance",     color: "bg-orange-100 text-orange-700", icon: Clock },
    APPROVED:         { label: "Approved",         color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
    REJECTED:         { label: "Rejected",         color: "bg-rose-100 text-rose-700",    icon: XCircle },
    DISBURSED:        { label: "Active / Disbursed", color: "bg-indigo-100 text-indigo-700", icon: Banknote },
    CLOSED:           { label: "Closed",           color: "bg-slate-100 text-slate-500",  icon: CheckCircle2 },
    CANCELLED:        { label: "Cancelled",        color: "bg-red-100 text-red-600",      icon: XCircle },
};

export default async function MyLoansPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user?.employee) redirect("/dashboard");

    const myLoans = await prisma.loanApplication.findMany({
        where: { employeeId: user.employee.id },
        include: {
            loanType: true,
            installments: { orderBy: [{ year: 'asc' }, { month: 'asc' }] },
            approvals: { orderBy: { createdAt: 'asc' } },
            disbursements: true,
        },
        orderBy: { createdAt: 'desc' }
    });

    const activeLoans = myLoans.filter(l => l.status === "DISBURSED");
    const pendingLoans = myLoans.filter(l => ["SUBMITTED", "PENDING_MANAGER", "PENDING_HR", "PENDING_FINANCE"].includes(l.status));
    const totalOwed = activeLoans.reduce((acc, l) => {
        const pendingInstallments = l.installments.filter(i => i.status === "PENDING");
        return acc + pendingInstallments.reduce((a, i) => a + i.amount, 0);
    }, 0);
    const nextInstallment = activeLoans.flatMap(l => l.installments.filter(i => i.status === "PENDING"))[0];

    return (
        <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">My Loans</h1>
                    <p className="text-slate-500 mt-1 font-medium">View and manage your loan applications and repayment schedule.</p>
                </div>
                <Link href="/payroll/loans/apply">
                    <Button className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg hover:shadow-indigo-500/25 transition-all h-11 px-6">
                        <Plus className="h-4 w-4 mr-2" />
                        Apply for Loan
                    </Button>
                </Link>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-3">
                <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-6 text-white shadow-xl shadow-indigo-500/20">
                    <div className="flex items-center gap-2 mb-3 opacity-80">
                        <Banknote className="h-4 w-4" />
                        <p className="text-xs font-bold uppercase tracking-wider">Total Outstanding</p>
                    </div>
                    <p className="text-3xl font-black">AED {totalOwed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    <p className="text-indigo-200 text-sm mt-1">{activeLoans.length} active loan{activeLoans.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-2 mb-3 text-amber-600">
                        <Clock className="h-4 w-4" />
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Pending Applications</p>
                    </div>
                    <p className="text-3xl font-black text-amber-600">{pendingLoans.length}</p>
                    <p className="text-slate-400 text-sm mt-1">awaiting approval</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-2 mb-3 text-emerald-600">
                        <TrendingDown className="h-4 w-4" />
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Next EMI</p>
                    </div>
                    {nextInstallment ? (
                        <>
                            <p className="text-2xl font-black text-emerald-600">AED {nextInstallment.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                            <p className="text-slate-400 text-sm mt-1">{new Date(nextInstallment.year, nextInstallment.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}</p>
                        </>
                    ) : (
                        <>
                            <p className="text-xl font-bold text-slate-300">—</p>
                            <p className="text-slate-400 text-sm mt-1">No pending EMI</p>
                        </>
                    )}
                </div>
            </div>

            {/* Loans List */}
            {myLoans.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="p-6 bg-indigo-50 rounded-full mb-6">
                        <Landmark className="h-12 w-12 text-indigo-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-700">No Loan Applications Yet</h3>
                    <p className="text-slate-400 mt-2 max-w-sm">You haven&#39;t applied for any loans. Click the button above to start your application.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <h2 className="font-bold text-slate-700 dark:text-slate-300 text-sm uppercase tracking-wider">Application History</h2>
                    {myLoans.map((loan) => {
                        const cfg = statusConfig[loan.status] || { label: loan.status, color: "bg-slate-100 text-slate-600", icon: FileText };
                        const StatusIcon = cfg.icon;
                        const pendingInstallments = loan.installments.filter((i) => i.status === "PENDING");
                        const paidInstallments = loan.installments.filter((i) => i.status === "DEDUCTED");
                        const remaining = pendingInstallments.reduce((a: number, i: any) => a + i.amount, 0);
                        const progress = loan.installments.length > 0
                            ? (paidInstallments.length / loan.installments.length) * 100
                            : 0;

                        return (
                            <Card key={loan.id} className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                                <CardContent className="p-0">
                                    <div className="p-6">
                                        <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">
                                                        {loan.loanType?.name || "Loan"}
                                                    </h3>
                                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${cfg.color}`}>
                                                        <StatusIcon className="h-3 w-3" />
                                                        {cfg.label}
                                                    </span>
                                                </div>
                                                <p className="text-slate-500 text-sm">{loan.reason || "No reason provided"}</p>
                                                <p className="text-xs text-slate-400">Applied {format(new Date(loan.createdAt), "MMMM dd, yyyy")}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
                                                    AED {loan.requestedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </p>
                                                <p className="text-sm text-slate-500">{loan.repaymentMonths} months</p>
                                                <p className="text-xs text-indigo-600 font-bold">
                                                    ~AED {(loan.requestedAmount / loan.repaymentMonths).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                                                </p>
                                            </div>
                                        </div>

                                        {/* Approval Timeline */}
                                        <div className="mt-5 flex items-center gap-2">
                                            {[
                                                { key: "managerStatus", label: "Manager" },
                                                { key: "hrStatus", label: "HR" },
                                                { key: "financeStatus", label: "Finance" },
                                            ].map((step, i) => {
                                                // `loan` is a typed Prisma row and `step.key` is a
                                                // runtime string, so a direct index is not allowed.
                                                // A narrow accessor reads the same field without
                                                // widening the row back to `any`.
                                                const val =
                                                    step.key === "managerStatus" ? loan.managerStatus :
                                                    step.key === "hrStatus" ? loan.hrStatus :
                                                    loan.financeStatus;
                                                return (
                                                    <div key={step.key} className="flex items-center gap-2">
                                                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
                                                            val === "APPROVED" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                                                            val === "REJECTED" ? "bg-rose-50 text-rose-700 border border-rose-200" :
                                                            "bg-slate-50 text-slate-400 border border-slate-200"
                                                        }`}>
                                                            {val === "APPROVED" ? <CheckCircle2 className="h-3 w-3" /> :
                                                             val === "REJECTED" ? <XCircle className="h-3 w-3" /> :
                                                             <Clock className="h-3 w-3" />}
                                                            {step.label}
                                                        </div>
                                                        {i < 2 && <div className="h-px w-4 bg-slate-200" />}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Repayment Progress (if disbursed) */}
                                        {loan.status === "DISBURSED" && loan.installments.length > 0 && (
                                            <div className="mt-5 p-4 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl">
                                                <div className="flex justify-between text-xs font-bold text-slate-600 mb-2">
                                                    <span>Repayment Progress</span>
                                                    <span className="text-indigo-600">{paidInstallments.length}/{loan.installments.length} paid</span>
                                                </div>
                                                <Progress value={progress} aria-label="Loan repayment progress" className="h-2 rounded-full bg-indigo-100" indicatorClassName="rounded-full bg-indigo-600" />
                                                <div className="flex justify-between mt-2 text-xs text-slate-500">
                                                    <span>Outstanding: <span className="font-bold text-slate-700">AED {remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
                                                    <span>{Math.round(progress)}% complete</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Approval Comments */}
                                    {loan.approvals.length > 0 && (
                                        <div className="border-t border-slate-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50">
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Approval Trail</p>
                                            <div className="space-y-1.5">
                                                {loan.approvals.map((approval) => (
                                                    <div key={approval.id} className="text-xs text-slate-600 flex items-start gap-2">
                                                        <span className={`font-bold shrink-0 ${
                                                            approval.action === "APPROVED" ? "text-emerald-600" :
                                                            approval.action === "REJECTED" ? "text-rose-600" :
                                                            "text-amber-600"
                                                        }`}>{approval.level}:</span>
                                                        <span>{approval.action}{approval.comments ? ` — ${approval.comments}` : ""}</span>
                                                        <span className="ml-auto text-slate-400 shrink-0">{format(new Date(approval.createdAt), "MMM dd")}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
