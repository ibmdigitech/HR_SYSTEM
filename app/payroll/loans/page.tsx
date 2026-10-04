import prisma from "@/lib/prisma";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { format } from "date-fns";import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Landmark, AlertCircle, Clock, Banknote, TrendingUp, ArrowLeft } from "lucide-react";
import Link from "next/link";

const statusConfig: Record<string, { label: string; color: string }> = {
    DRAFT:            { label: "Draft",           color: "bg-slate-100 text-slate-600" },
    SUBMITTED:        { label: "Submitted",        color: "bg-blue-100 text-blue-700" },
    PENDING_MANAGER:  { label: "Pending Manager",  color: "bg-amber-100 text-amber-700" },
    PENDING_HR:       { label: "Pending HR",       color: "bg-purple-100 text-purple-700" },
    PENDING_FINANCE:  { label: "Pending Finance",  color: "bg-orange-100 text-orange-700" },
    APPROVED:         { label: "Approved",         color: "bg-emerald-100 text-emerald-700" },
    REJECTED:         { label: "Rejected",         color: "bg-rose-100 text-rose-700" },
    DISBURSED:        { label: "Disbursed",        color: "bg-indigo-100 text-indigo-700" },
    CLOSED:           { label: "Closed",           color: "bg-slate-100 text-slate-500" },
    CANCELLED:        { label: "Cancelled",        color: "bg-red-100 text-red-600" },
};

export default async function LoansPage() {
    // Loan administration requires a loan capability rather than an inline role
    // list. FINANCE holds loan.manage, so the finance department keeps access.
    await requirePageAnyPermission([PERMISSIONS.LOAN_MANAGE, PERMISSIONS.LOAN_APPROVE]);

    const loans = await prisma.loanApplication.findMany({
        include: { employee: true, loanType: true, installments: true },
        orderBy: { createdAt: 'desc' }
    });

    const disbursedLoans = loans.filter((l) => l.status === "DISBURSED");
    const totalDisbursed = disbursedLoans.reduce((acc, l) => acc + l.requestedAmount, 0);
    const pendingCount = loans.filter((l) => ["SUBMITTED", "PENDING_MANAGER", "PENDING_HR", "PENDING_FINANCE"].includes(l.status)).length;
    const totalInstallmentsDue = loans.reduce((acc, l) => {
        const pendingInstallments = l.installments.filter((i) => i.status === "PENDING");
        return acc + pendingInstallments.reduce((a, i) => a + i.amount, 0);
    }, 0);

    return (
        <div className="p-4 sm:p-6 md:p-8 space-y-6 sm:space-y-8 min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-600/20 shrink-0">
                            <Landmark className="h-6 w-6 text-white" />
                        </div>
                        Loan Management
                    </h1>
                    <p className="text-slate-500 mt-1.5 sm:ml-14">Monitor and manage all employee loan applications.</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <Link href="/dashboard" className="w-full md:w-auto">
                        <Button variant="outline" className="w-full md:w-auto rounded-xl font-bold">
                            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
                        </Button>
                    </Link>
                    <Link href="/payroll/loans/admin" className="w-full md:w-auto">
                        <Button variant="outline" className="w-full md:w-auto rounded-xl border-amber-300 text-amber-700 hover:bg-amber-50 font-bold">
                            <Clock className="h-4 w-4 mr-2" />
                            Pending Approvals
                            {pendingCount > 0 && (
                                <span className="ml-2 bg-amber-500 text-white text-xs font-black rounded-full h-5 w-5 flex items-center justify-center">{pendingCount}</span>
                            )}
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-3 sm:gap-4 md:grid-cols-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-indigo-50 rounded-xl shrink-0"><Landmark className="h-5 w-5 text-indigo-600" /></div>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Total Applications</p>
                    </div>
                    <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">{loans.length}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-amber-50 rounded-xl shrink-0"><Clock className="h-5 w-5 text-amber-600" /></div>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Pending Review</p>
                    </div>
                    <p className="text-2xl sm:text-3xl font-black text-amber-600">{pendingCount}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-emerald-50 rounded-xl shrink-0"><Banknote className="h-5 w-5 text-emerald-600" /></div>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Total Disbursed</p>
                    </div>
                    <p className="text-xl sm:text-2xl font-black text-emerald-600">AED {totalDisbursed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-purple-50 rounded-xl shrink-0"><TrendingUp className="h-5 w-5 text-purple-600" /></div>
                        <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">EMI Due (Pending)</p>
                    </div>
                    <p className="text-xl sm:text-2xl font-black text-purple-600">AED {totalInstallmentsDue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                </div>
            </div>

            {/* Loan Applications — mobile card list, same seven fields as the
                table below, so no approval step is lost on a phone. */}
            <div className="md:hidden bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-4 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="font-bold text-slate-800 dark:text-slate-200">All Loan Applications</h2>
                    <p className="text-xs text-slate-400">{loans.length} records</p>
                </div>
                {loans.length === 0 ? (
                    <div className="py-16 px-4 text-center text-slate-500">
                        <AlertCircle className="mx-auto h-10 w-10 mb-3 text-slate-300" />
                        <p className="font-medium">No loan applications found</p>
                        <p className="text-sm text-slate-400 mt-1">Applications submitted by employees will appear here.</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {loans.map((loan) => {
                            const cfg = statusConfig[loan.status] || { label: loan.status, color: "bg-slate-100 text-slate-600" };
                            return (
                                <li key={loan.id} className="p-4 flex flex-col gap-2.5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                                {loan.employee.firstName} {loan.employee.lastName}
                                            </p>
                                            <p className="text-[11px] text-slate-500">
                                                {loan.employee.employeeCode || loan.employee.id.substring(0, 6)}
                                            </p>
                                        </div>
                                        <span className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold ${cfg.color}`}>
                                            {cfg.label}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                                        <span className="font-medium text-slate-700 dark:text-slate-200">{loan.loanType?.name || "—"}</span>
                                        <span className="text-slate-500">{format(new Date(loan.createdAt), "MMM dd, yyyy")}</span>
                                        <span className="text-slate-500">{loan.repaymentMonths} mo.</span>
                                        <span className="font-bold text-slate-900 dark:text-slate-100">
                                            AED {loan.requestedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        {["managerStatus", "hrStatus", "financeStatus"].map((key, i) => {
                                            const labels = ["M", "HR", "F"];
                                            const val =
                                                key === "managerStatus" ? loan.managerStatus :
                                                key === "hrStatus" ? loan.hrStatus :
                                                    loan.financeStatus;
                                            return (
                                                <span
                                                    key={key}
                                                    title={`${["Manager", "HR", "Finance"][i]}: ${val}`}
                                                    className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
                                                        val === "APPROVED" ? "bg-emerald-100 text-emerald-700" :
                                                        val === "REJECTED" ? "bg-rose-100 text-rose-700" :
                                                        "bg-slate-100 text-slate-500"
                                                    }`}
                                                >
                                                    {labels[i]}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div className="hidden md:block bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="font-bold text-slate-800 dark:text-slate-200">All Loan Applications</h2>
                    <p className="text-xs text-slate-400">{loans.length} records</p>
                </div>
                <div className="overflow-x-auto">
                <Table>
                    <TableHeader className="bg-slate-50/50 dark:bg-slate-800/50">
                        <TableRow>
                            <TableHead className="font-semibold text-slate-600">Employee</TableHead>
                            <TableHead className="font-semibold text-slate-600">Loan Type</TableHead>
                            <TableHead className="font-semibold text-slate-600">Applied On</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-right">Amount (AED)</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-center">Term</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-center">Status</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-center">Approvals</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loans.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-16 text-slate-500">
                                    <AlertCircle className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                                    <p className="font-medium">No loan applications found</p>
                                    <p className="text-sm text-slate-400 mt-1">Applications submitted by employees will appear here.</p>
                                </TableCell>
                            </TableRow>
                        ) : (
                            loans.map((loan) => {
                                const cfg = statusConfig[loan.status] || { label: loan.status, color: "bg-slate-100 text-slate-600" };
                                return (
                                    <TableRow key={loan.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                                        <TableCell>
                                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                                                {loan.employee.firstName} {loan.employee.lastName}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {loan.employee.employeeCode || loan.employee.id.substring(0, 6)}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="font-medium text-slate-700">{loan.loanType?.name || "—"}</span>
                                        </TableCell>
                                        <TableCell className="text-slate-600 text-sm">
                                            {format(new Date(loan.createdAt), "MMM dd, yyyy")}
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-slate-900 dark:text-slate-100">
                                            {loan.requestedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="text-center text-sm text-slate-600">
                                            {loan.repaymentMonths} mo.
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${cfg.color}`}>
                                                {cfg.label}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-center gap-1.5">
                                                {["managerStatus", "hrStatus", "financeStatus"].map((key, i) => {
                                                    const labels = ["M", "HR", "F"];
                                                    // Narrow accessor instead of indexing a typed row
                                                    // with a runtime string.
                                                    const val =
                                                        key === "managerStatus" ? loan.managerStatus :
                                                        key === "hrStatus" ? loan.hrStatus :
                                                            loan.financeStatus;
                                                    return (
                                                        <span
                                                            key={key}
                                                            title={`${["Manager", "HR", "Finance"][i]}: ${val}`}
                                                            className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
                                                                val === "APPROVED" ? "bg-emerald-100 text-emerald-700" :
                                                                val === "REJECTED" ? "bg-rose-100 text-rose-700" :
                                                                "bg-slate-100 text-slate-500"
                                                            }`}
                                                        >
                                                            {labels[i]}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
                </div>
            </div>
        </div>
    );
}
