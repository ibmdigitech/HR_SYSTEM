import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, DollarSign, Activity, Calendar, ShieldAlert, UserCheck, Clock, TrendingUp, Plus, CheckCircle2, AlertCircle, ArrowUpRight, Zap, Briefcase,  } from "lucide-react";import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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
        deptGroup
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
        prisma.employee.groupBy({ by: ["department"], _count: { id: true }, where: { isActive: true } })
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

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Hero Section */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 p-5 sm:p-6 md:p-8 lg:p-12 rounded-[2.5rem] shadow-2xl transition-all duration-500">
                <div className="absolute top-0 right-0 w-64 h-64 sm:w-[500px] sm:h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 group-hover:bg-indigo-500/20 transition-all duration-700"></div>
                <div className="absolute bottom-0 left-0 w-56 h-56 sm:w-[400px] sm:h-[400px] bg-violet-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2 group-hover:bg-violet-500/20 transition-all duration-700"></div>

                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 sm:gap-8">
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-4 sm:mb-6">
                            <Zap className="h-3 w-3 fill-indigo-400" />
                            System Overview
                        </div>
                        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white mb-3 sm:mb-4 leading-tight">
                            Welcome back,<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                                {user.name?.split(' ')[0] || 'User'}
                            </span>
                        </h1>
                        <p className="text-slate-300 text-sm sm:text-base md:text-lg font-medium max-w-xl leading-relaxed">
                            Your workspace is updated with the latest workforce metrics and real-time operational insights.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full md:w-auto">
                        {userRole === "STAFF" ? (
                            <>
                                <Link href="/leaves" className="w-full sm:w-auto">
                                    <Button className="w-full sm:w-auto h-12 sm:h-14 px-5 sm:px-8 rounded-2xl bg-white text-indigo-900 hover:bg-indigo-50 font-black text-sm sm:text-base shadow-xl border-0 transition-transform hover:scale-105 active:scale-95 gap-2">
                                        <Plus className="h-5 w-5" />
                                        Request Leave
                                    </Button>
                                </Link>
                                <Link href="/requests" className="w-full sm:w-auto">
                                    <Button variant="outline" className="w-full sm:w-auto h-12 sm:h-14 px-5 sm:px-8 rounded-2xl bg-white/5 backdrop-blur-md border-white/20 text-white hover:bg-white/10 font-bold text-sm sm:text-base transition-transform hover:scale-105 active:scale-95 gap-2">
                                        <ShieldAlert className="h-5 w-5" />
                                        Operation Requests
                                    </Button>
                                </Link>
                            </>
                        ) : (
                            <Link href="/requests" className="w-full sm:w-auto">
                                <Button className="w-full sm:w-auto h-12 sm:h-14 px-5 sm:px-10 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:shadow-indigo-500/40 font-black text-sm sm:text-base shadow-2xl border-0 transition-all hover:scale-105 active:scale-95 gap-2 group">
                                    <CheckCircle2 className="h-5 w-5 group-hover:animate-bounce" />
                                    Manage Requests
                                    <Badge className="ml-2 bg-white/20 text-white border-0">{pendingLeavesCount}</Badge>
                                </Button>
                            </Link>
                        )}
                    </div>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Card className="group relative bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-indigo-500/10 transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-widest">Workforce</CardTitle>
                        <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{totalEmployees}</div>
                        <div className="flex items-center gap-1 mt-2 text-emerald-600 font-bold text-xs">
                            <TrendingUp className="h-3 w-3" />
                            <span>Active Sponsorships</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group relative bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-emerald-500/10 transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-widest">Attendance Today</CardTitle>
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <UserCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">
                            {presentTodayCount} <span className="text-sm font-medium text-slate-400">/ {totalEmployees}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-xs font-medium text-slate-500">
                            <span className="text-amber-600 font-bold">{lateTodayCount} Late</span> &bull;
                            <span className="text-rose-600 font-bold">{absentTodayCount} Absent</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group relative bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-amber-500/10 transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-widest">Payroll Net Spend</CardTitle>
                        <div className="p-2.5 bg-teal-50 dark:bg-teal-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <DollarSign className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                            AED {monthlyNetSalarySpent.toLocaleString([], { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>
                        <div className="flex items-center gap-1 mt-2 text-slate-500 font-bold text-xs">
                            <span>Current Month net payout</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className={cn(
                    "group relative shadow-xl rounded-[2rem] overflow-hidden border-0 transition-all duration-300",
                    expiringVisasCount > 0 ? "bg-gradient-to-br from-rose-600 to-red-700 text-white" : "bg-gradient-to-br from-indigo-600 to-violet-700 text-white"
                )}>
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10"></div>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-bold text-white/70 uppercase tracking-widest">Compliance Warnings</CardTitle>
                        <div className="p-2.5 bg-white/20 backdrop-blur-md rounded-xl">
                            <ShieldAlert className="h-5 w-5 text-white" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-white tracking-tighter">{expiringVisasCount} File(s)</div>
                        <div className="flex items-center gap-1 mt-2 text-white/80 font-bold text-xs">
                            <ArrowUpRight className="h-3 w-3" />
                            <span>Document expiries (&lt;30d)</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-8 lg:grid-cols-7">
                {/* Visual Charts Block */}
                <div className="lg:col-span-4 space-y-8">
                    {/* Attendance Trend Chart */}
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
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
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
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
                                        <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-850 overflow-hidden shadow-inner">
                                            <div 
                                                className="h-full bg-gradient-to-r from-violet-500 to-indigo-600 transition-all duration-1000"
                                                style={{ width: `${progressPct}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                            {departmentHeadcounts.length === 0 && (
                                <p className="text-center text-xs text-slate-400 italic py-6">No employee records in database.</p>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar Operations Block */}
                <div className="lg:col-span-3 space-y-8">
                    {/* Quick Access Actions */}
                    {userRole !== "STAFF" && (
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
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
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
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
