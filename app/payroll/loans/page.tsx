import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { NewLoanForm } from "@/components/payroll/NewLoanForm";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Landmark, AlertCircle, CheckCircle2 } from "lucide-react";

export default async function LoansPage() {
    const session = await auth();
    if (!session || !["ADMIN", "HR", "FINANCE"].includes((session.user as any).role)) {
        redirect("/");
    }

    const loans = await prisma.loanApplication.findMany({
        include: { employee: true },
        orderBy: { createdAt: 'desc' }
    });

    const activeEmployees = await prisma.employee.findMany({
        where: { isActive: true },
        orderBy: { firstName: 'asc' }
    });

    const totalActiveLoans = loans.filter((l: any) => l.status === "ACTIVE").reduce((acc: any, l: any) => acc + l.remainingBalance, 0);

    return (
        <div className="p-8 space-y-8">
            <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <Landmark className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Loan Management
                    </h1>
                    <p className="text-slate-500 mt-2">Manage employee loans and track monthly deductions.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right mr-4">
                        <p className="text-sm font-medium text-slate-500">Total Active Loans</p>
                        <p className="text-2xl font-bold text-indigo-600">AED {totalActiveLoans.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <NewLoanForm employees={activeEmployees} />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-50/50 dark:bg-slate-800/50">
                        <TableRow>
                            <TableHead className="font-semibold text-slate-600">Employee</TableHead>
                            <TableHead className="font-semibold text-slate-600">Issue Date</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-right">Total Amount</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-right">Installment</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-right">Remaining</TableHead>
                            <TableHead className="font-semibold text-slate-600 text-center">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loans.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                                    <AlertCircle className="mx-auto h-8 w-8 text-slate-400 mb-3" />
                                    No loans found
                                </TableCell>
                            </TableRow>
                        ) : (
                            loans.map((loan: any) => (
                                <TableRow key={loan.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                                    <TableCell>
                                        <div className="font-medium text-slate-900 dark:text-slate-100">
                                            {loan.employee.firstName} {loan.employee.lastName}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {loan.employee.employeeCode || loan.employee.id.substring(0,6)}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-slate-600">
                                        {format(new Date(loan.issueDate), "MMM dd, yyyy")}
                                    </TableCell>
                                    <TableCell className="text-right font-medium text-slate-900">
                                        {loan.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell className="text-right text-slate-600">
                                        {loan.installmentAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell className="text-right font-medium text-indigo-600">
                                        {loan.remainingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge className={`px-3 py-1 rounded-full border-0 ${
                                            loan.status === 'ACTIVE' ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' :
                                            loan.status === 'PAID' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' :
                                            'bg-rose-100 text-rose-700 hover:bg-rose-100'
                                        }`}>
                                            {loan.status === 'PAID' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                            {loan.status}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
