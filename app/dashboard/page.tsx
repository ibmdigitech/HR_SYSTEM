import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, DollarSign, Activity, Calendar, ShieldAlert, UserCheck, Clock, TrendingUp, Plus, CheckCircle2, AlertCircle, ArrowUpRight, Zap, Briefcase, Bell } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

    // Fetch Stats
    const totalEmployees = await prisma.employee.count();
    const pendingLeavesCount = await prisma.leaveRequest.count({
        where: { hrStatus: "PENDING" }
    });

    const presentTodayCount = await prisma.attendance.count({
        where: {
            date: {
                gte: today,
                lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
            }
        }
    });

    const recentAuditLogs = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6
    });

    // On-time check (last 7 days)
    const recentAttendance = await prisma.attendance.findMany({
        where: { date: { gte: sevenDaysAgo } }
    });
    const totalPresent = recentAttendance.length;
    const onTimeCount = recentAttendance.filter(a => a.status === "PRESENT").length;
    const onTimeRate = totalPresent > 0 ? Math.round((onTimeCount / totalPresent) * 100) : 0;

    // Fetch User specific data if STAFF
    let myPendingLeaves: any[] = [];
    if (userRole === "STAFF" && user.employee) {
        myPendingLeaves = await prisma.leaveRequest.findMany({
            where: {
                employeeId: user.employee.id,
                hrStatus: "PENDING"
            },
            orderBy: { createdAt: 'desc' },
            take: 3
        });
    }

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Hero Section */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all duration-500">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 group-hover:bg-indigo-500/20 transition-all duration-700"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2 group-hover:bg-violet-500/20 transition-all duration-700"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-6">
                            <Zap className="h-3 w-3 fill-indigo-400" />
                            System Overview
                        </div>
                        <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
                            Welcome back,<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                                {user.name?.split(' ')[0] || 'User'}
                            </span>
                        </h1>
                        <p className="text-slate-300 text-lg font-medium max-w-xl leading-relaxed">
                            Your workspace is updated with the latest workforce metrics and real-time operational insights.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                        {userRole === "STAFF" ? (
                            <>
                                <Link href="/leaves/apply">
                                    <Button className="h-14 px-8 rounded-2xl bg-white text-indigo-900 hover:bg-indigo-50 font-black text-base shadow-xl border-0 transition-transform hover:scale-105 active:scale-95 gap-2">
                                        <Plus className="h-5 w-5" />
                                        Request Leave
                                    </Button>
                                </Link>
                                <Link href="/dashboard/request-access">
                                    <Button variant="outline" className="h-14 px-8 rounded-2xl bg-white/5 backdrop-blur-md border-white/20 text-white hover:bg-white/10 font-bold text-base transition-transform hover:scale-105 active:scale-95 gap-2">
                                        <ShieldAlert className="h-5 w-5" />
                                        Access Request
                                    </Button>
                                </Link>
                            </>
                        ) : (
                            <Link href="/dashboard/approvals" className="w-full sm:w-auto">
                                <Button className="h-14 px-10 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:shadow-indigo-500/40 font-black text-base shadow-2xl border-0 transition-all hover:scale-105 active:scale-95 gap-2 group">
                                    <CheckCircle2 className="h-5 w-5 group-hover:animate-bounce" />
                                    Manage Approvals
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
                            <span>Active Employees</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group relative bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-emerald-500/10 transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-widest">Presence</CardTitle>
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <UserCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{presentTodayCount}</div>
                        <div className="flex items-center gap-1 mt-2 text-emerald-600 font-bold text-xs">
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span>Live Check-ins</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group relative bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-amber-500/10 transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-widest">Actions</CardTitle>
                        <div className="p-2.5 bg-amber-50 dark:bg-amber-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{pendingLeavesCount}</div>
                        <div className="flex items-center gap-1 mt-2 text-amber-600 font-bold text-xs">
                            <span>Pending Approvals</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="group relative bg-gradient-to-br from-indigo-600 to-violet-700 shadow-xl rounded-[2rem] overflow-hidden border-0 transition-all duration-300">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10"></div>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-xs font-bold text-white/70 uppercase tracking-widest">Compliance</CardTitle>
                        <div className="p-2.5 bg-white/20 backdrop-blur-md rounded-xl">
                            <ShieldAlert className="h-5 w-5 text-white" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-white tracking-tighter">{onTimeRate}%</div>
                        <div className="flex items-center gap-1 mt-2 text-white/80 font-bold text-xs">
                            <ArrowUpRight className="h-3 w-3" />
                            <span>Punctuality Rate</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-7">
                {/* Activity Feed */}
                <Card className="lg:col-span-4 bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 px-8 py-8 border-b border-slate-100 dark:border-slate-800/60">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-2xl font-black text-slate-800 dark:text-white">Audit Stream</CardTitle>
                                <CardDescription className="font-bold text-slate-400 uppercase text-[10px] tracking-[0.2em] mt-1">Real-time system events</CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" className="rounded-full h-10 w-10 p-0 hover:bg-white dark:hover:bg-slate-900">
                                <Bell className="h-5 w-5 text-slate-400" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y divide-slate-50 dark:divide-slate-900">
                            {recentAuditLogs.length === 0 ? (
                                <div className="text-slate-400 text-sm font-bold italic py-20 text-center">
                                    No recent activity found.
                                </div>
                            ) : (
                                recentAuditLogs.map((log) => (
                                    <div key={log.id} className="group flex items-center gap-6 px-8 py-6 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-all duration-300">
                                        <div className={cn(
                                            "flex items-center justify-center h-12 w-12 rounded-2xl shadow-sm transition-transform group-hover:scale-110",
                                            log.action.includes("CREATE") ? "bg-emerald-100 text-emerald-600" : 
                                            log.action.includes("UPDATE") ? "bg-amber-100 text-amber-600" : "bg-indigo-100 text-indigo-600"
                                        )}>
                                            {log.action.includes("CREATE") ? <Plus className="h-6 w-6" /> : 
                                             log.action.includes("UPDATE") ? <Activity className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-base font-black text-slate-900 dark:text-white truncate uppercase tracking-tight">{log.action.replace(/_/g, ' ')}</p>
                                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">{log.details}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="block text-sm font-black text-slate-900 dark:text-white">
                                                {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                                {new Date(log.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="p-6 bg-slate-50/50 dark:bg-slate-900/10 text-center">
                            <Button variant="link" className="text-indigo-600 font-black uppercase text-xs tracking-widest hover:no-underline">View Full Audit Log</Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Performance Box */}
                <Card className="lg:col-span-3 bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
                    <CardHeader className="bg-indigo-600 text-white p-8">
                        <div className="flex items-center justify-between mb-4">
                            <Zap className="h-8 w-8 fill-white/20" />
                            <Badge className="bg-white/20 text-white border-0 font-black">LIVE</Badge>
                        </div>
                        <CardTitle className="text-2xl font-black">Performance</CardTitle>
                        <CardDescription className="text-indigo-100 font-medium">Weekly operational efficiency</CardDescription>
                    </CardHeader>
                    <CardContent className="p-8 space-y-8">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Arrival Accuracy</p>
                                    <p className="text-xs font-bold text-slate-400">Target: 95%</p>
                                </div>
                                <div className="text-2xl font-black text-emerald-600">{onTimeRate}%</div>
                            </div>
                            <div className="h-4 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden shadow-inner">
                                <div 
                                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 ease-out shadow-lg" 
                                    style={{ width: `${onTimeRate}%` }} 
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Leave Utilization</p>
                                    <p className="text-xs font-bold text-slate-400">Across department</p>
                                </div>
                                <div className="text-2xl font-black text-indigo-600">--%</div>
                            </div>
                            <div className="h-4 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden shadow-inner">
                                <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 w-[0%] transition-all duration-1000 ease-out shadow-lg" />
                            </div>
                        </div>

                        <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
                                <div className="h-10 w-10 rounded-xl bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm">
                                    <Briefcase className="h-5 w-5 text-indigo-600" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Next Milestone</p>
                                    <p className="text-sm font-black text-slate-900 dark:text-white">Payroll Cycle: May 2026</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

// Helper for dynamic classes
function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(" ");
}

function XCircle(props: any) {
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
