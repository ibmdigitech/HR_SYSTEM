import Link from "next/link";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, DollarSign, CreditCard, History, Plus, Building, UserCheck, TrendingUp, Receipt, ChevronRight, Clock, AlertTriangle, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { DownloadPDFButton } from "@/components/payroll/DownloadPDFButton";
import { PayrollStatusDropdown } from "@/components/payroll/PayrollStatusDropdown";
import { PayrollCharts } from "@/components/payroll/PayrollCharts";
import { PayrollExportButtons } from "@/components/payroll/PayrollExportButtons";

export default async function PayrollPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    const userRole = user.role;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    let salaryRecords: any[] = [];
    if (userRole === "ADMIN" || userRole === "HR") {
        salaryRecords = await prisma.salaryRecord.findMany({
            include: { employee: true },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 20
        });
    } else if (user.employee) {
        salaryRecords = await prisma.salaryRecord.findMany({
            where: { employeeId: user.employee.id },
            include: { employee: true },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 12
        });
    }

    const currentMonthRecords = salaryRecords.filter(r => r.month === currentMonth && r.year === currentYear);
    
    const totalPayrollThisMonth = currentMonthRecords.reduce((acc, curr) => acc + curr.netSalary, 0);
    const totalEmployeesPaidThisMonth = currentMonthRecords.filter(r => r.status === "PAID").length;
    const totalPendingPayroll = currentMonthRecords.filter(r => r.status !== "PAID" && r.status !== "CANCELLED").reduce((acc, curr) => acc + curr.netSalary, 0);
    const averageSalary = currentMonthRecords.length > 0 ? totalPayrollThisMonth / currentMonthRecords.length : 0;
    
    const totalOvertimeThisMonth = currentMonthRecords.reduce((acc, curr) => acc + curr.overtimePay, 0);
    const totalDeductionsThisMonth = currentMonthRecords.reduce((acc, curr) => acc + curr.latePenalty + curr.penalty + curr.leaveDeduction + curr.loanDeduction + curr.advanceSalary + curr.otherDeductions, 0);

    const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("default", { month: "short" });

    // Mock data for charts if no real data (for demonstration of the new UI as requested)
    const trendData = [
        { month: 'Jan', total: 120000 },
        { month: 'Feb', total: 125000 },
        { month: 'Mar', total: 128000 },
        { month: 'Apr', total: 130000 },
        { month: 'May', total: 135000 },
        { month: 'Jun', total: totalPayrollThisMonth || 140000 },
    ];

    const departmentData = [
        { name: 'Engineering', cost: 65000 },
        { name: 'Sales', cost: 45000 },
        { name: 'HR', cost: 15000 },
        { name: 'Marketing', cost: 25000 },
    ];

    const overtimeData = [
        { month: 'Jan', hours: 45 },
        { month: 'Feb', hours: 52 },
        { month: 'Mar', hours: 38 },
        { month: 'Apr', hours: 60 },
        { month: 'May', hours: 40 },
        { month: 'Jun', hours: 55 },
    ];

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-slate-900 to-indigo-950 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-blue-500/20 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>
                
                <div className="relative z-10">
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2">Payroll Center</h1>
                    <p className="text-indigo-200 text-sm md:text-base font-medium max-w-xl">
                        Manage enterprise salary distributions, track bulk processing, and monitor overall financial compliance.
                    </p>
                </div>
                {(userRole === "ADMIN" || userRole === "HR") && (
                    <div className="relative z-10 grid grid-cols-2 gap-3">
                        <Link href="/payroll/structure">
                            <Button variant="secondary" className="gap-2 w-full rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 border-0 backdrop-blur-md">
                                <Building className="h-4 w-4" />
                                Structures
                            </Button>
                        </Link>
                        <Link href="/payroll/generate">
                            <Button className="gap-2 w-full rounded-xl font-bold bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.4)] border-0">
                                <Plus className="h-4 w-4" />
                                Run Payroll
                            </Button>
                        </Link>
                        <Link href="/payroll/loans">
                            <Button variant="secondary" className="gap-2 w-full rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 border-0 backdrop-blur-md">
                                <DollarSign className="h-4 w-4" />
                                Loans
                            </Button>
                        </Link>
                        <Link href="/payroll/overtime">
                            <Button variant="secondary" className="gap-2 w-full rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 border-0 backdrop-blur-md">
                                <Clock className="h-4 w-4" />
                                Overtime
                            </Button>
                        </Link>
                    </div>
                )}
            </div>

            {/* Export Buttons - Admin/HR only */}
            {(userRole === "ADMIN" || userRole === "HR") && (
                <PayrollExportButtons />
            )}

            {/* Dashboard Stats */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Payroll ({monthName(currentMonth)})</CardTitle>
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <DollarSign className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">AED {totalPayrollThisMonth.toLocaleString()}</div>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Employees Paid</CardTitle>
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{totalEmployeesPaidThisMonth}</div>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Pending Payroll</CardTitle>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">AED {totalPendingPayroll.toLocaleString()}</div>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Average Salary</CardTitle>
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                            <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">AED {averageSalary.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Overtime</CardTitle>
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">AED {totalOvertimeThisMonth.toLocaleString()}</div>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Deductions</CardTitle>
                        <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-lg">
                            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">AED {totalDeductionsThisMonth.toLocaleString()}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Area */}
            {(userRole === "ADMIN" || userRole === "HR") && (
                <PayrollCharts trendData={trendData} departmentData={departmentData} overtimeData={overtimeData} />
            )}

            {/* Main Table */}
            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)] rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-5 flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-xl font-bold">Recent Distributions</CardTitle>
                        <CardDescription className="font-medium text-slate-500">Comprehensive overview of recent payroll batches.</CardDescription>
                    </div>
                    <Link href="/payroll/payslips">
                        <Button variant="ghost" className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-bold gap-1">
                            View All <ChevronRight className="h-4 w-4" />
                        </Button>
                    </Link>
                </CardHeader>
                <CardContent className="p-0">
                    {salaryRecords.length === 0 ? (
                        <div className="text-center py-20 px-4">
                            <Receipt className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                            <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">No payroll records</h3>
                            <p className="text-sm text-slate-500 max-w-sm mx-auto mt-2">Generate your first payroll batch to see distribution records here.</p>
                            {(userRole === "ADMIN" || userRole === "HR") && (
                                <Link href="/payroll/generate">
                                    <Button className="mt-6 bg-indigo-600 hover:bg-indigo-700 font-bold rounded-xl">Run Payroll Now</Button>
                                </Link>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-transparent">
                                    <TableRow className="border-slate-100 dark:border-slate-800/60 hover:bg-transparent">
                                        <TableHead className="py-4 font-bold text-slate-500">Employee Details</TableHead>
                                        <TableHead className="py-4 font-bold text-slate-500">Period</TableHead>
                                        <TableHead className="py-4 font-bold text-slate-500">Payment Method</TableHead>
                                        <TableHead className="py-4 font-bold text-slate-500">Net Amount</TableHead>
                                        <TableHead className="py-4 font-bold text-slate-500">Status</TableHead>
                                        <TableHead className="py-4 font-bold text-slate-500 text-right pr-6">Statement</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {salaryRecords.map((record: any) => (
                                        <TableRow key={record.id} className="border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                                            <TableCell className="py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-400 font-bold">
                                                        {record.employee.firstName[0]}{record.employee.lastName[0]}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-slate-900 dark:text-white">
                                                            {record.employee.firstName} {record.employee.lastName}
                                                        </div>
                                                        <div className="text-xs font-medium text-slate-500">
                                                            {record.employee.designation} • ID: {record.employee.rollNumber || "N/A"}
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <div className="font-bold text-slate-700 dark:text-slate-300">{monthName(record.month)} {record.year}</div>
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <Badge variant="outline" className="font-semibold bg-slate-50 dark:bg-slate-900">
                                                    {record.paymentMethod?.replace('_', ' ') || "BANK TRANSFER"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <div className="font-black text-slate-900 dark:text-white">AED {record.netSalary?.toLocaleString()}</div>
                                            </TableCell>
                                            <TableCell className="py-4">
                                                {(userRole === "ADMIN" || userRole === "HR") ? (
                                                    <PayrollStatusDropdown record={record} />
                                                ) : (
                                                    <Badge 
                                                        className={`font-bold px-3 py-1 rounded-full border-0 ${
                                                            record.status === "PAID" 
                                                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" 
                                                                : record.status === "PENDING"
                                                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                        }`}
                                                    >
                                                        {record.status}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4 text-right pr-6">
                                                <DownloadPDFButton record={record} />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
