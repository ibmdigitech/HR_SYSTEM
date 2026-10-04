import Link from "next/link";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, CreditCard, History, Plus, Building, UserCheck, TrendingUp, Receipt, ChevronRight, Clock, AlertTriangle, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { DownloadPDFButton } from "@/components/payroll/DownloadPDFButton";
import { PayrollStatusDropdown } from "@/components/payroll/PayrollStatusDropdown";
import { PayrollCharts } from "@/components/payroll/PayrollCharts";
import { PayrollExportButtons } from "@/components/payroll/PayrollExportButtons";

export default async function PayrollPage() {
    // Payroll aggregates salary data for every employee. This page previously
    // checked only that a session existed, so a STAFF account could read the
    // organisation-wide payroll. Requires an explicit payroll capability now.
    await requirePagePermission(PERMISSIONS.PAYROLL_VIEW);

    const session = await auth();

    const user = await prisma.user.findUnique({
        where: { email: session!.user!.email! },
        include: { employee: true }
    });

    if (!user) redirect("/dashboard");

    const userRole = user.role;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const canViewAllPayroll = userRole === "ADMIN" || userRole === "HR";
    // `null` means "this account has no employee profile", so there is nothing it
    // is entitled to see — not the same as "an employee with no records".
    const payrollScope: { employeeId?: string } | null = canViewAllPayroll
        ? {}
        : user.employee
            ? { employeeId: user.employee.id }
            : null;

    let salaryRecords: any[] = [];
    if (payrollScope) {
        salaryRecords = await prisma.salaryRecord.findMany({
            where: payrollScope,
            include: { employee: true },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: canViewAllPayroll ? 20 : 12
        });
    }

    const monthName = (m: number) => new Date(2000, m - 1).toLocaleString("default", { month: "short" });
    const longMonthName = (m: number) => new Date(2000, m - 1).toLocaleString("default", { month: "long" });

    // Every card on this page describes ONE period, and every period figure is
    // aggregated over the whole period rather than over the truncated
    // `salaryRecords` list used by the table below.
    //
    // The current calendar month is preferred. When nothing has been run for it
    // the latest recorded period is shown instead — previously the cards summed
    // the current month unconditionally, so a payroll run last month rendered as
    // a row of hard zeros that were indistinguishable from real totals. The
    // active period is labelled on every card and the gap is called out below.
    const periodSeries = payrollScope
        ? await prisma.salaryRecord.groupBy({
            by: ["year", "month"],
            where: payrollScope,
            _sum: { netSalary: true },
            orderBy: [{ year: "desc" }, { month: "desc" }],
            take: 6
        })
        : [];

    const latestPeriod = periodSeries[0] ?? null;
    const activePeriod =
        periodSeries.find((p) => p.month === currentMonth && p.year === currentYear) ?? latestPeriod;
    const isCurrentPeriod = Boolean(
        activePeriod && activePeriod.month === currentMonth && activePeriod.year === currentYear
    );

    const statusTotals = activePeriod
        ? await prisma.salaryRecord.groupBy({
            by: ["status"],
            where: { ...payrollScope, year: activePeriod.year, month: activePeriod.month },
            _count: { _all: true },
            _sum: {
                netSalary: true,
                overtimePay: true,
                latePenalty: true,
                penalty: true,
                leaveDeduction: true,
                loanDeduction: true,
                advanceSalary: true,
                otherDeductions: true
            }
        })
        : [];

    const netOf = (row: (typeof statusTotals)[number]) => row._sum.netSalary ?? 0;
    const periodNetSalary = statusTotals.reduce((acc, row) => acc + netOf(row), 0);
    const periodPaidCount = statusTotals
        .filter((row) => row.status === "PAID")
        .reduce((acc, row) => acc + row._count._all, 0);
    const periodPendingNet = statusTotals
        .filter((row) => row.status !== "PAID" && row.status !== "CANCELLED")
        .reduce((acc, row) => acc + netOf(row), 0);
    const recordCount = statusTotals.reduce((acc, row) => acc + row._count._all, 0);
    const periodAverageSalary = recordCount > 0 ? periodNetSalary / recordCount : 0;
    const periodOvertimePay = statusTotals.reduce((acc, row) => acc + (row._sum.overtimePay ?? 0), 0);
    const periodDeductions = statusTotals.reduce(
        (acc, row) => acc
            + (row._sum.latePenalty ?? 0)
            + (row._sum.penalty ?? 0)
            + (row._sum.leaveDeduction ?? 0)
            + (row._sum.loanDeduction ?? 0)
            + (row._sum.advanceSalary ?? 0)
            + (row._sum.otherDeductions ?? 0),
        0
    );

    // Charts read the same scoped rows as the cards. They are derived, never
    // placeholder: an empty array renders an explicit "no data" state in the
    // chart card instead of a plausible-looking invented series.
    const trendData = periodSeries
        .slice()
        .reverse()
        .map((p) => ({
            label: `${monthName(p.month)} ${String(p.year).slice(2)}`,
            total: p._sum.netSalary ?? 0
        }));

    const departmentRows = activePeriod
        ? await prisma.salaryRecord.findMany({
            where: { ...payrollScope, year: activePeriod.year, month: activePeriod.month },
            select: { netSalary: true, employee: { select: { department: true } } }
        })
        : [];

    const departmentTotals = new Map<string, number>();
    for (const row of departmentRows) {
        const name = row.employee.department?.trim() || "Unassigned";
        departmentTotals.set(name, (departmentTotals.get(name) ?? 0) + row.netSalary);
    }
    const departmentData = [...departmentTotals.entries()]
        .map(([name, cost]) => ({ name, cost }))
        .sort((a, b) => b.cost - a.cost);

    // Six calendar months ending with the current one, so a month with no
    // overtime logged reads as zero hours rather than silently disappearing.
    const overtimeWindowStart = new Date(currentYear, currentMonth - 6, 1);
    const overtimeRows = payrollScope
        ? await prisma.overtime.findMany({
            where: { ...payrollScope, date: { gte: overtimeWindowStart } },
            select: { date: true, hours: true }
        })
        : [];
    const overtimeHours = new Map<string, number>();
    for (const row of overtimeRows) {
        const key = `${row.date.getFullYear()}-${row.date.getMonth()}`;
        overtimeHours.set(key, (overtimeHours.get(key) ?? 0) + row.hours);
    }
    const overtimeMonths = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(currentYear, currentMonth - 6 + i, 1);
        return { label: monthName(d.getMonth() + 1), hours: overtimeHours.get(`${d.getFullYear()}-${d.getMonth()}`) ?? 0 };
    });
    const totalOvertimeHours = overtimeMonths.reduce((acc, m) => acc + m.hours, 0);
    const overtimeData = totalOvertimeHours > 0 ? overtimeMonths : [];

    const periodLabel = activePeriod ? `${monthName(activePeriod.month)} ${activePeriod.year}` : null;
    const trendCaption = periodSeries.length > 0
        ? `Net salary · ${periodSeries.length} recorded period${periodSeries.length === 1 ? "" : "s"}`
        : "Net salary by payroll period";
    const departmentCaption = periodLabel
        ? `Net salary by department · ${periodLabel}`
        : "Net salary by department";
    const overtimeCaption = `Logged overtime hours · ${overtimeMonths[0].label}–${overtimeMonths[5].label} ${currentYear}`;

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-slate-900 to-indigo-950 p-5 sm:p-6 md:p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-blue-500/20 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>

                <div className="relative z-10 min-w-0">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white mb-2">Payroll Center</h1>
                    <p className="text-indigo-200 text-sm md:text-base font-medium max-w-xl">
                        Manage enterprise salary distributions, track bulk processing, and monitor overall financial compliance.
                    </p>
                </div>
                {canViewAllPayroll && (
                    <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 w-full sm:w-auto">
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
            {canViewAllPayroll && (
                <PayrollExportButtons />
            )}

            {/* The cards describe the active period. When that period is not the
                current month the gap is stated outright, because a silent
                fallback would attribute last month's money to this month. */}
            {activePeriod && !isCurrentPeriod && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 p-4">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200 flex-1">
                        No payroll has been run for {longMonthName(currentMonth)} {currentYear}. The figures below are the latest
                        recorded period, {longMonthName(activePeriod.month)} {activePeriod.year}.
                    </p>
                    {canViewAllPayroll && (
                        <Link href="/payroll/generate" className="shrink-0">
                            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 font-bold rounded-xl">
                                Run {longMonthName(currentMonth)} Payroll
                            </Button>
                        </Link>
                    )}
                </div>
            )}

            {/* Dashboard Stats */}
            {!periodLabel ? (
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardContent className="py-16 text-center px-4">
                        <Receipt className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">No payroll totals yet</h3>
                        <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
                            There are no salary records for {longMonthName(currentMonth)} {currentYear} or any earlier period, so
                            there is nothing to total.
                        </p>
                        {canViewAllPayroll && (
                            <Link href="/payroll/generate">
                                <Button className="mt-6 bg-indigo-600 hover:bg-indigo-700 font-bold rounded-xl">Run Payroll Now</Button>
                            </Link>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Payroll ({periodLabel})</CardTitle>
                            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                                <DollarSign className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black text-slate-800 dark:text-white">AED {periodNetSalary.toLocaleString()}</div>
                            <p className="text-xs text-slate-500 mt-1">{recordCount} salary record{recordCount === 1 ? "" : "s"}</p>
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
                            <div className="text-3xl font-black text-slate-800 dark:text-white">{periodPaidCount}</div>
                            <p className="text-xs text-slate-500 mt-1">Marked PAID in {periodLabel}</p>
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
                            <div className="text-3xl font-black text-slate-800 dark:text-white">AED {periodPendingNet.toLocaleString()}</div>
                            <p className="text-xs text-slate-500 mt-1">Not yet paid or cancelled</p>
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
                            <div className="text-3xl font-black text-slate-800 dark:text-white">AED {periodAverageSalary.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                            <p className="text-xs text-slate-500 mt-1">Mean net salary in {periodLabel}</p>
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
                            <div className="text-3xl font-black text-slate-800 dark:text-white">AED {periodOvertimePay.toLocaleString()}</div>
                            <p className="text-xs text-slate-500 mt-1">Overtime pay in {periodLabel}</p>
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
                            <div className="text-3xl font-black text-slate-800 dark:text-white">AED {periodDeductions.toLocaleString()}</div>
                            <p className="text-xs text-slate-500 mt-1">Penalties, leave, loans and advances in {periodLabel}</p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Charts Area */}
            {canViewAllPayroll && (
                <PayrollCharts
                    trendData={trendData}
                    departmentData={departmentData}
                    overtimeData={overtimeData}
                    trendCaption={trendCaption}
                    departmentCaption={departmentCaption}
                    overtimeCaption={overtimeCaption}
                />
            )}

            {/* Main Table */}
            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)] rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
                            {canViewAllPayroll && (
                                <Link href="/payroll/generate">
                                    <Button className="mt-6 bg-indigo-600 hover:bg-indigo-700 font-bold rounded-xl">Run Payroll Now</Button>
                                </Link>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* MOBILE: card list, same six fields as the table
                                below, so nothing is hidden or dropped. */}
                            <ul className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/60">
                                {salaryRecords.map((record) => (
                                    <li key={record.id} className="p-4 flex flex-col gap-2.5">
                                        <div className="flex items-start gap-3">
                                            <div className="h-10 w-10 shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-400 font-bold text-xs">
                                                {record.employee.firstName[0]}{record.employee.lastName[0]}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold text-slate-900 dark:text-white truncate">
                                                    {record.employee.firstName} {record.employee.lastName}
                                                </p>
                                                <p className="text-[11px] text-slate-500 truncate">
                                                    {record.employee.designation} &bull; {monthName(record.month)} {record.year}
                                                </p>
                                            </div>
                                            <span className="shrink-0 text-sm font-black text-slate-900 dark:text-white">
                                                AED {record.netSalary?.toLocaleString()}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 pl-[52px]">
                                            <Badge variant="outline" className="font-semibold bg-slate-50 dark:bg-slate-900 text-[10px]">
                                                {record.paymentMethod?.replace('_', ' ') || "BANK TRANSFER"}
                                            </Badge>
                                            {canViewAllPayroll ? (
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
                                            <DownloadPDFButton record={record} />
                                        </div>
                                    </li>
                                ))}
                            </ul>

                            <div className="hidden md:block overflow-x-auto">
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
                                    {salaryRecords.map((record) => (
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
                                                {canViewAllPayroll ? (
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
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
