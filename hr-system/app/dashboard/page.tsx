import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, DollarSign, Activity, Calendar, ShieldAlert, UserCheck, Clock, TrendingUp, Plus, CheckCircle2, AlertCircle } from "lucide-react";
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
        take: 5
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
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Dashboard</h1>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-slate-500 dark:text-slate-400">Welcome back, {user.name}</p>
                        <Badge variant="secondary" className="text-xs">{userRole}</Badge>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {userRole === "STAFF" && (
                        <>
                            <Link href="/leaves/apply">
                                <Button className="gap-2">
                                    <Plus className="h-4 w-4" />
                                    Apply Leave
                                </Button>
                            </Link>
                            <Link href="/dashboard/request-access">
                                <Button variant="outline" className="gap-2">
                                    <ShieldAlert className="h-4 w-4" />
                                    Request Role
                                </Button>
                            </Link>
                        </>
                    )}
                    {(userRole === "ADMIN" || userRole === "HR" || userRole === "MANAGER") && (
                        <Link href="/dashboard/approvals">
                            <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
                                <CheckCircle2 className="h-4 w-4" />
                                Approvals
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">
                            Total Employees
                        </CardTitle>
                        <Users className="h-4 w-4 text-slate-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalEmployees}</div>
                        <p className="text-xs text-slate-500">
                            Active in system
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">
                            Present Today
                        </CardTitle>
                        <UserCheck className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{presentTodayCount}</div>
                        <p className="text-xs text-slate-500">
                            Clocked-in staff
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">
                            Quick Actions
                        </CardTitle>
                        <Activity className="h-4 w-4 text-slate-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-2">
                            <Link href="/attendance"><Badge variant="outline" className="cursor-pointer hover:bg-indigo-50">Attendance</Badge></Link>
                            <Link href="/payroll"><Badge variant="outline" className="cursor-pointer hover:bg-indigo-50">Payroll</Badge></Link>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">
                            Pending Tasks
                        </CardTitle>
                        <Clock className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{pendingLeavesCount}</div>
                        <p className="text-xs text-slate-500">
                            Awaiting approval
                        </p>
                    </CardContent>
                </Card>
            </div>

            {userRole === "STAFF" && myPendingLeaves.length > 0 && (
                <div className="grid gap-4">
                    <h2 className="text-xl font-semibold">Request Status Tracker</h2>
                    {myPendingLeaves.map((leave) => (
                        <Card key={leave.id} className="overflow-hidden">
                            <CardHeader className="bg-slate-50 dark:bg-slate-900 py-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm">{leave.type} Request</CardTitle>
                                    <span className="text-xs text-slate-500">{new Date(leave.createdAt).toLocaleDateString()}</span>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="relative flex items-center justify-between w-full max-w-md mx-auto">
                                    {/* Line */}
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-slate-200 dark:bg-slate-800" />

                                    {/* Step 1: Submission */}
                                    <div className="relative z-10 flex flex-col items-center gap-2">
                                        <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white">
                                            <CheckCircle2 className="h-5 w-5" />
                                        </div>
                                        <span className="text-[10px] font-medium">Submitted</span>
                                    </div>

                                    {/* Step 2: Manager Approval */}
                                    <div className="relative z-10 flex flex-col items-center gap-2">
                                        <div className={cn(
                                            "h-8 w-8 rounded-full flex items-center justify-center text-white",
                                            leave.managerStatus === "APPROVED" ? "bg-indigo-600" : leave.managerStatus === "REJECTED" ? "bg-red-500" : "bg-slate-200 dark:bg-slate-800"
                                        )}>
                                            {leave.managerStatus === "APPROVED" ? <CheckCircle2 className="h-5 w-5" /> : leave.managerStatus === "REJECTED" ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5 text-slate-400" />}
                                        </div>
                                        <span className="text-[10px] font-medium">Manager</span>
                                    </div>

                                    {/* Step 3: HR Approval */}
                                    <div className="relative z-10 flex flex-col items-center gap-2">
                                        <div className={cn(
                                            "h-8 w-8 rounded-full flex items-center justify-center text-white",
                                            leave.hrStatus === "APPROVED" ? "bg-indigo-600" : leave.hrStatus === "REJECTED" ? "bg-red-500" : "bg-slate-200 dark:bg-slate-800"
                                        )}>
                                            {leave.hrStatus === "APPROVED" ? <CheckCircle2 className="h-5 w-5" /> : leave.hrStatus === "REJECTED" ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5 text-slate-400" />}
                                        </div>
                                        <span className="text-[10px] font-medium">HR Dept</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {recentAuditLogs.length === 0 ? (
                                <div className="text-muted-foreground text-sm italic py-4">
                                    No recent activity found.
                                </div>
                            ) : (
                                recentAuditLogs.map((log) => (
                                    <div key={log.id} className="flex items-start gap-4 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                                        <div className={cn(
                                            "mt-1 rotate-45 h-2 w-2 rounded-sm",
                                            log.action.includes("CREATE") ? "bg-emerald-500" : log.action.includes("UPDATE") ? "bg-amber-500" : "bg-indigo-500"
                                        )} />
                                        <div className="flex-1 space-y-1">
                                            <p className="text-sm font-medium leading-none">{log.action}</p>
                                            <p className="text-xs text-slate-500">{log.details}</p>
                                        </div>
                                        <span className="text-[10px] text-slate-400 font-medium">
                                            {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Quick Stats</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-sm font-medium leading-none">On-Time Arrival</p>
                                    <p className="text-xs text-slate-500">Last 7 days</p>
                                </div>
                                <div className="font-bold text-emerald-600">{onTimeRate}%</div>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${onTimeRate}%` }} />
                            </div>

                            <div className="flex items-center justify-between pt-4">
                                <div className="space-y-1">
                                    <p className="text-sm font-medium leading-none">Leave Balance</p>
                                    <p className="text-xs text-slate-500">Current Year</p>
                                </div>
                                <div className="font-bold text-indigo-600">-- Days</div>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div className="h-full bg-indigo-500 w-[0%]" />
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
