import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, DollarSign, Activity, Calendar, ShieldAlert, UserCheck, Clock, TrendingUp, Plus, CheckCircle2, AlertCircle, ArrowUpRight, Zap, Briefcase,  } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import prisma from "@/lib/prisma";

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");

    const userRole = user.role;

    // Dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    // Parallelize all independent root queries
    const [
        totalEmployees,
        todayRecords,
        expiringVisasCount,
        payrollAgg,
        recentAuditLogs,
        recentAttendance,
        deptGroup,
        allEmployees
    ] = await Promise.all([
        prisma.employee.count({ where: { isActive: true } }),
        prisma.attendance.findMany({ where: { date: { gte: today, lt: tomorrow } } }),
        prisma.employee.count({
            where: {
                isActive: true,
                OR: [
                    { passportExpiry: { gte: today, lte: thirtyDaysFromNow } },
                    { emiratesIdExpiry: { gte: today, lte: thirtyDaysFromNow } },
                    { visaExpiry: { gte: today, lte: thirtyDaysFromNow } }
                ]
            }
        }),
        prisma.salaryRecord.aggregate({ _sum: { netSalary: true }, where: { month: currentMonth, year: currentYear } }),
        prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
        prisma.attendance.findMany({ where: { date: { gte: sevenDaysAgo } } }),
        prisma.employee.groupBy({ by: ["department"], _count: { id: true }, where: { isActive: true } }),
        prisma.employee.findMany({
            where: { isActive: true },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                photo: true,
                designation: true,
                department: true,
                managerId: true,
            },
            orderBy: [{ department: "asc" }, { firstName: "asc" }],
        })
    ]);

    // Handle Pending Leaves Count which depends on userRole sequentially
    let pendingLeavesCount = 0;
    if (userRole === "MANAGER" && user.employee) {
        pendingLeavesCount = await prisma.leaveRequest.count({
            where: { managerStatus: "PENDING", employee: { managerId: user.employee.id } }
        });
    } else if (userRole === "HR" || userRole === "ADMIN") {
        pendingLeavesCount = await prisma.leaveRequest.count({ where: { hrStatus: "PENDING" } });
    } else if (userRole === "STAFF" && user.employee) {
        pendingLeavesCount = await prisma.leaveRequest.count({
            where: { employeeId: user.employee.id, hrStatus: "PENDING" }
        });
    }

    const presentTodayCount = todayRecords.filter(r => r.status === "PRESENT" || r.status === "LATE").length;
    const lateTodayCount = todayRecords.filter(r => r.status === "LATE" || r.lateMinutes > 0).length;
    const leavesTodayCount = todayRecords.filter(r => r.status === "LEAVE").length;
    const absentTodayCount = Math.max(0, totalEmployees - presentTodayCount - leavesTodayCount);
    const attendanceRate = totalEmployees > 0 ? Math.min(100, Math.round((presentTodayCount / totalEmployees) * 100)) : 0;

    const monthlyNetSalarySpent = payrollAgg._sum.netSalary || 0;

    const totalPresent = recentAttendance.length;
    const onTimeCount = recentAttendance.filter(a => a.status === "PRESENT").length;
    const onTimeRate = totalPresent > 0 ? Math.round((onTimeCount / totalPresent) * 100) : 0;

    // Fetch Last 7 Days Attendance Trend in parallel
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        d.setHours(0, 0, 0, 0);
        return d;
    }).reverse();

    const attendanceTrendCounts = await Promise.all(
        last7Days.map(day => {
            const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
            return prisma.attendance.count({
                where: {
                    date: { gte: day, lt: nextDay },
                    status: { in: ["PRESENT", "LATE"] }
                }
            });
        })
    );

    const attendanceTrend = last7Days.map((day, idx) => ({
        dayName: day.toLocaleDateString(undefined, { weekday: "short" }),
        count: attendanceTrendCounts[idx]
    }));
    const departmentHeadcounts = deptGroup.map(g => ({
        department: g.department || "General",
        count: g._count.id
    }));

    const companyTree = buildCompanyTree(allEmployees);

    return (
        <div className="mx-auto w-full max-w-7xl space-y-7 p-4 md:p-8">
            {/* Hero Section */}
            <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-6 shadow-lg shadow-indigo-950/10 sm:p-8">
                <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
                <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 left-1/3 h-64 w-64 rounded-full bg-violet-500/15 blur-3xl" />
                <div className="relative z-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-indigo-100">
                            <Zap className="h-3.5 w-3.5 text-indigo-300" />
                            Workforce overview
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                            Welcome back, <span className="text-indigo-200">{user.name?.split(' ')[0] || "User"}</span>
                        </h1>
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
                            Here is the latest overview of your people and daily operations.
                        </p>
                    </div>

                    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                        {userRole === "STAFF" ? (
                            <>
                                <Link href="/leaves" className="w-full sm:w-auto">
                                        <Button className="h-12 w-full gap-2 rounded-xl border-0 bg-white px-5 text-sm font-bold text-indigo-950 shadow-sm transition-colors hover:bg-indigo-50 sm:w-auto sm:px-6 sm:text-base">
                                        <Plus className="h-5 w-5" />
                                        Request Leave
                                    </Button>
                                </Link>
                                <Link href="/requests" className="w-full sm:w-auto">
                                    <Button variant="outline" className="h-12 w-full gap-2 rounded-xl border-white/20 bg-white/5 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10 hover:text-white sm:w-auto sm:px-6 sm:text-base">
                                        <ShieldAlert className="h-5 w-5" />
                                        Operation Requests
                                    </Button>
                                </Link>
                            </>
                        ) : (
                            <Link href="/requests" className="w-full sm:w-auto">
                                <Button className="h-12 w-full gap-2 rounded-xl border-0 bg-indigo-500 px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-400 sm:w-auto sm:px-6 sm:text-base">
                                    <CheckCircle2 className="h-5 w-5" />
                                    Manage Requests
                                    <Badge className="ml-2 bg-white/20 text-white border-0">{pendingLeavesCount}</Badge>
                                </Button>
                            </Link>
                        )}
                    </div>
                </div>
            </section>

            {/* Quick Stats Grid */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="group overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600 dark:text-slate-300">Active employees</CardTitle>
                        <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">{totalEmployees}</div>
                        <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">Current workforce</p>
                    </CardContent>
                </Card>

                <Card className="group overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600 dark:text-slate-300">Attendance today</CardTitle>
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <UserCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
                            {presentTodayCount} <span className="text-sm font-medium text-slate-400">/ {totalEmployees}</span>
                        </div>
                        <Progress value={attendanceRate} aria-label="Attendance rate" className="mt-3 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800" indicatorClassName="rounded-full bg-emerald-500" />
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                            <span>{attendanceRate}% present</span>
                            <span className="text-amber-700 dark:text-amber-400">{lateTodayCount} late</span>
                            <span className="text-rose-700 dark:text-rose-400">{absentTodayCount} absent</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600 dark:text-slate-300">Payroll net spend</CardTitle>
                        <div className="p-2.5 bg-teal-50 dark:bg-teal-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <DollarSign className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                            AED {monthlyNetSalarySpent.toLocaleString([], { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>
                        <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                            <span>Net payout this month</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className={cn(
                    "group relative overflow-hidden rounded-2xl border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                    expiringVisasCount > 0 ? "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/40 dark:text-white" : "border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                )}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-semibold text-slate-600 dark:text-slate-300">Compliance due soon</CardTitle>
                        <div className={cn("rounded-xl p-2.5", expiringVisasCount > 0 ? "bg-rose-100 dark:bg-rose-900/50" : "bg-indigo-50 dark:bg-indigo-950/50")}>
                            <ShieldAlert className={cn("h-5 w-5", expiringVisasCount > 0 ? "text-rose-700 dark:text-rose-300" : "text-indigo-600 dark:text-indigo-300")} />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold tracking-tight">{expiringVisasCount}</div>
                        <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                            <span>Documents expiring within 30 days</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-7">
                {/* Visual Charts Block */}
                <div className="space-y-6 xl:col-span-4">
                    {/* Attendance Trend Chart */}
                    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 px-4 sm:px-6 py-4 sm:py-6 border-b border-slate-100 dark:border-slate-800/60">
                            <div>
                                <CardTitle className="text-lg font-bold">Attendance Velocity</CardTitle>
                                <CardDescription className="text-xs text-slate-500 font-bold uppercase tracking-wider">Present headcount over latest 7 days</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6">
                            <div className="flex items-end justify-between h-48 pt-4 border-b border-slate-100 dark:border-slate-800">
                                {attendanceTrend.map((t, idx) => {
                                    const maxVal = Math.max(...attendanceTrend.map(d => d.count), 1);
                                    const pct = Math.round((t.count / maxVal) * 80) + 10; // offset
                                    return (
                                        <div key={idx} className="flex flex-col items-center flex-1 space-y-3">
                                            <div className="text-xs font-black text-slate-700 dark:text-slate-300">{t.count}</div>
                                            <div 
                                                className="w-8 rounded-t-lg bg-gradient-to-t from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-violet-500 transition-all duration-1000 shadow-lg shadow-indigo-500/10"
                                                style={{ height: `${pct}px` }}
                                            />
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">{t.dayName}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Headcount distribution by department */}
                    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 px-4 sm:px-6 py-4 sm:py-6 border-b border-slate-100 dark:border-slate-800/60">
                            <div>
                                <CardTitle className="text-lg font-bold">Workforce Segmentation</CardTitle>
                                <CardDescription className="text-xs text-slate-500 font-bold uppercase tracking-wider">Departmental distribution hierarchy</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6 space-y-6">
                            {departmentHeadcounts.map((dept, idx) => {
                                const maxStaff = Math.max(...departmentHeadcounts.map(d => d.count), 1);
                                const progressPct = Math.round((dept.count / maxStaff) * 100);
                                return (
                                    <div key={idx} className="space-y-2">
                                        <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-slate-300">
                                            <span className="uppercase tracking-wider">{dept.department}</span>
                                            <span>{dept.count} Employee(s)</span>
                                        </div>
                                        <Progress value={progressPct} aria-label={`${dept.department} workforce share`} className="h-2.5 rounded-full bg-slate-100 shadow-inner dark:bg-slate-850" indicatorClassName="bg-gradient-to-r from-violet-500 to-indigo-600" />
                                    </div>
                                );
                            })}
                            {departmentHeadcounts.length === 0 && (
                                <p className="text-center text-xs text-slate-400 italic py-6">No employee records in database.</p>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 px-4 sm:px-6 py-4 sm:py-6 border-b border-slate-100 dark:border-slate-800/60">
                            <div>
                                <CardTitle className="text-lg font-bold">Company hierarchy</CardTitle>
                                <CardDescription className="text-xs text-slate-500 font-bold uppercase tracking-wider">Top to bottom reporting structure</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6">
                            <div className="space-y-4">
                                {companyTree.length > 0 ? companyTree.map((root) => (
                                    <HierarchyNode key={root.id} employee={root} />
                                )) : (
                                    <p className="text-sm text-slate-500 dark:text-slate-400">No hierarchy data available yet.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar Operations Block */}
                <div className="space-y-6 xl:col-span-3">
                    {/* Quick Access Actions */}
                    {userRole !== "STAFF" && (
                        <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                            <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 dark:border-slate-800/60">
                                <CardTitle className="text-base font-bold">HR Management Shortcuts</CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 sm:p-6 space-y-4">
                                <Link href="/employees" className="block">
                                    <Button variant="outline" className="w-full justify-between h-12 rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400">
                                        Onboard New Employee
                                        <ArrowUpRight className="h-4 w-4" />
                                    </Button>
                                </Link>
                                <Link href="/payroll" className="block">
                                    <Button variant="outline" className="w-full justify-between h-12 rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400">
                                        Execute Monthly Payroll
                                        <ArrowUpRight className="h-4 w-4" />
                                    </Button>
                                </Link>
                                <Link href="/visa" className="block">
                                    <Button variant="outline" className="w-full justify-between h-12 rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400">
                                        Check Expiry Warnings
                                        <ArrowUpRight className="h-4 w-4" />
                                    </Button>
                                </Link>
                                <Link href="/requests" className="block">
                                    <Button variant="outline" className="w-full justify-between h-12 rounded-xl text-xs font-bold border-slate-200 dark:border-slate-800 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400">
                                        Fulfill Service Requests
                                        <Badge className="ml-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 border-0">{pendingLeavesCount}</Badge>
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}

                    {/* Audit Logs events */}
                    <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                            <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 dark:border-slate-800/60">
                                <CardTitle className="text-base font-bold">Compliance Logs</CardTitle>
                            </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                                {recentAuditLogs.map((log) => (
                                    <div key={log.id} className="p-4 flex gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-all">
                                        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 shrink-0 h-fit">
                                            <Activity className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-tighter truncate">{log.action.replace(/_/g, ' ')}</p>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{log.details}</p>
                                            <span className="block text-[9px] text-slate-400 font-bold mt-1">
                                                {new Date(log.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {recentAuditLogs.length === 0 && (
                                    <p className="text-center text-xs text-slate-400 italic py-10">No recent audit logs.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

type CompanyEmployeeNode = {
    id: string;
    firstName: string;
    lastName: string;
    photo: string | null;
    designation: string | null;
    department: string | null;
    managerId: string | null;
    reportees: CompanyEmployeeNode[];
};

function buildCompanyTree(employees: Array<Omit<CompanyEmployeeNode, 'reportees'>>): CompanyEmployeeNode[] {
    const byId = new Map(employees.map((employee) => [employee.id, { ...employee, reportees: [] as CompanyEmployeeNode[] }]));

    for (const employee of employees) {
        const node = byId.get(employee.id);
        if (!node) continue;

        if (employee.managerId && byId.has(employee.managerId)) {
            const manager = byId.get(employee.managerId);
            if (manager) {
                manager.reportees.push(node);
            }
        }
    }

    return employees
        .filter((employee) => !employee.managerId || !byId.has(employee.managerId))
        .map((employee) => byId.get(employee.id)!)
        .sort((a, b) => a.firstName.localeCompare(b.firstName));
}

function HierarchyNode({ employee }: { employee: CompanyEmployeeNode }) {
    const initials = `${employee.firstName?.[0] ?? ""}${employee.lastName?.[0] ?? ""}`.toUpperCase();

    return (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 p-3 sm:p-4">
            <div className="flex items-center gap-3">
                <Link href={`/employees/${employee.id}`} className="shrink-0">
                    {employee.photo ? (
                        <img src={employee.photo} alt={`${employee.firstName} ${employee.lastName}`} className="h-11 w-11 rounded-full object-cover ring-2 ring-indigo-200 dark:ring-indigo-900" />
                    ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-black text-white">
                            {initials || "HR"}
                        </div>
                    )}
                </Link>
                <div className="min-w-0 flex-1">
                    <Link href={`/employees/${employee.id}`} className="block truncate text-sm font-black text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400">
                        {employee.firstName} {employee.lastName}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {employee.designation && <span>{employee.designation}</span>}
                        {employee.department && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">{employee.department}</span>}
                    </div>
                </div>
            </div>
            {employee.reportees.length > 0 && (
                <div className="ml-6 mt-4 border-l-2 border-indigo-200 dark:border-indigo-900 pl-4 space-y-3">
                    {employee.reportees.map((reportee) => (
                        <HierarchyNode key={reportee.id} employee={reportee} />
                    ))}
                </div>
            )}
        </div>
    );
}

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(" ");
}

function XCircle(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
        </svg>
    )
}
