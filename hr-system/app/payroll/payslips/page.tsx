import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, DollarSign, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { DownloadPDFButton } from "@/components/payroll/DownloadPDFButton";

export default async function PayslipPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });
    if (!user) redirect("/login");

    const isAdmin = user.role === "ADMIN" || user.role === "HR";

    let salaryRecords: any[] = [];
    if (isAdmin) {
        salaryRecords = await prisma.salaryRecord.findMany({
            include: { employee: true },
            orderBy: [{ year: "desc" }, { month: "desc" }],
            take: 50,
        });
    } else if (user.employee) {
        salaryRecords = await prisma.salaryRecord.findMany({
            where: { employeeId: user.employee.id },
            include: { employee: true },
            orderBy: [{ year: "desc" }, { month: "desc" }],
        });
    }

    const monthName = (m: number) =>
        new Date(2000, m - 1).toLocaleString("default", { month: "long" });

    const totalNetPaid = salaryRecords
        .filter(r => r.status === "PAID")
        .reduce((acc, r) => acc + r.netSalary, 0);

    return (
        <div className="space-y-6">
            {/* Back Button */}
            <Link href="/payroll" className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 transition-colors w-fit">
                <ArrowLeft className="h-4 w-4" />
                <span className="text-sm font-medium">Back to Payroll</span>
            </Link>

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Payslips</h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        {isAdmin ? "Download salary statements for all employees." : "Download your salary statements."}
                    </p>
                </div>
                {isAdmin && (
                    <Link href="/payroll/generate">
                        <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
                            Run Payroll
                        </Button>
                    </Link>
                )}
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">Total Records</CardTitle>
                        <FileText className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{salaryRecords.length}</div>
                        <p className="text-xs text-slate-500">Payroll entries</p>
                    </CardContent>
                </Card>
                <Card className="border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/50 dark:bg-emerald-900/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Total Disbursed</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                            AED {totalNetPaid.toLocaleString()}
                        </div>
                        <p className="text-xs text-emerald-600/70">Paid records only</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">Pending Payment</CardTitle>
                        <AlertCircle className="h-4 w-4 text-amber-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {salaryRecords.filter(r => r.status === "PENDING").length}
                        </div>
                        <p className="text-xs text-slate-500">Awaiting disbursement</p>
                    </CardContent>
                </Card>
            </div>

            {/* Table */}
            <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle>Payroll History</CardTitle>
                    <CardDescription>
                        {isAdmin ? "All employee salary records" : "Your salary history"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {salaryRecords.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileText className="h-12 w-12 mb-3 opacity-30" />
                            <p className="text-sm font-medium">No payroll records found.</p>
                            {isAdmin && (
                                <Link href="/payroll/generate" className="mt-3">
                                    <Button size="sm" variant="outline">Run First Payroll</Button>
                                </Link>
                            )}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-100 dark:border-slate-800">
                                    {isAdmin && <TableHead>Employee</TableHead>}
                                    <TableHead>Period</TableHead>
                                    <TableHead>Basic</TableHead>
                                    <TableHead>Housing</TableHead>
                                    <TableHead>Allowances</TableHead>
                                    <TableHead>Deductions</TableHead>
                                    <TableHead className="font-bold text-slate-900 dark:text-white">Net Pay</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Payslip</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {salaryRecords.map((record: any) => {
                                    const totalAllowances = (record.transportAllowance || 0) + (record.medicalAllowance || 0) + (record.otherAllowances || 0) + (record.bonus || 0);
                                    const totalDeductions = (record.latePenalty || 0) + (record.leaveDeduction || 0) + (record.loanDeduction || 0) + (record.otherDeductions || 0);
                                    
                                    return (
                                    <TableRow key={record.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                        {isAdmin && (
                                            <TableCell>
                                                <div className="font-semibold text-slate-900 dark:text-white">
                                                    {record.employee.firstName} {record.employee.lastName}
                                                </div>
                                                <div className="text-xs text-slate-400">{record.employee.designation}</div>
                                            </TableCell>
                                        )}
                                        <TableCell className="font-semibold text-slate-700 dark:text-slate-300">
                                            {monthName(record.month)} {record.year}
                                        </TableCell>
                                        <TableCell className="text-sm">AED {record.basic?.toLocaleString() ?? "--"}</TableCell>
                                        <TableCell className="text-sm">AED {record.housingAllowance?.toLocaleString() ?? "--"}</TableCell>
                                        <TableCell className="text-sm">AED {totalAllowances.toLocaleString() ?? "--"}</TableCell>
                                        <TableCell className="text-sm text-rose-600">
                                            - AED {totalDeductions.toLocaleString() ?? "--"}
                                        </TableCell>
                                        <TableCell className="font-bold text-emerald-700 dark:text-emerald-400">
                                            AED {record.netSalary?.toLocaleString() ?? "--"}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                className={
                                                    record.status === "PAID"
                                                        ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                                        : "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100"
                                                }
                                                variant="outline"
                                            >
                                                {record.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DownloadPDFButton record={record} />
                                        </TableCell>
                                    </TableRow>
                                )})}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
