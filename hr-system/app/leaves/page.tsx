import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Calendar, Clock, CheckCircle2, XCircle, AlertCircle, TrendingDown, Sun, Umbrella, HeartPulse, ChevronRight } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0",
    APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0",
    REJECTED: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-0",
};

const LEAVE_TYPE_COLORS: Record<string, string> = {
    SICK: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400 border-rose-100 dark:border-rose-900/50",
    CASUAL: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 border-sky-100 dark:border-sky-900/50",
    ANNUAL: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 border-violet-100 dark:border-violet-900/50",
};

function StatusBadge({ status }: { status: string }) {
    return (
        <Badge className={`font-bold px-3 py-1 rounded-full ${STATUS_COLORS[status] || "bg-slate-100 text-slate-600"}`}>
            {status === "PENDING" && <Clock className="h-3 w-3 mr-1" />}
            {status === "APPROVED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
            {status === "REJECTED" && <XCircle className="h-3 w-3 mr-1" />}
            {status}
        </Badge>
    );
}

function LeaveTable({ leaves, showEmployee }: { leaves: any[]; showEmployee: boolean }) {
    if (leaves.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 bg-white/50 dark:bg-slate-950/50">
                <Umbrella className="h-16 w-16 mb-4 opacity-10" />
                <p className="text-sm font-bold tracking-tight">No leave records found</p>
                <p className="text-xs mt-1">Enjoy your time or submit a new request!</p>
            </div>
        );
    }

    const diffDays = (start: Date, end: Date) =>
        Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader className="bg-slate-50/50 dark:bg-slate-900/20">
                    <TableRow className="border-slate-100 dark:border-slate-800/60 hover:bg-transparent">
                        {showEmployee && <TableHead className="font-bold py-4">Employee</TableHead>}
                        <TableHead className="font-bold py-4">Type</TableHead>
                        <TableHead className="font-bold py-4">Duration</TableHead>
                        <TableHead className="font-bold py-4">Days</TableHead>
                        <TableHead className="font-bold py-4">Manager</TableHead>
                        <TableHead className="font-bold py-4">HR</TableHead>
                        <TableHead className="font-bold py-4 text-right pr-6">Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {leaves.map((leave: any) => (
                        <TableRow key={leave.id} className="border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-all duration-200">
                            {showEmployee && (
                                <TableCell className="py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-400 font-bold text-xs shadow-sm">
                                            {leave.employee.firstName[0]}{leave.employee.lastName[0]}
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-900 dark:text-white">{leave.employee.firstName} {leave.employee.lastName}</div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{leave.employee.designation}</div>
                                        </div>
                                    </div>
                                </TableCell>
                            )}
                            <TableCell className="py-4">
                                <Badge variant="outline" className={`font-black text-[10px] uppercase tracking-widest ${LEAVE_TYPE_COLORS[leave.type] || "bg-slate-100 text-slate-700"}`}>
                                    {leave.type}
                                </Badge>
                            </TableCell>
                            <TableCell className="py-4">
                                <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                    {new Date(leave.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                    <span className="mx-1 opacity-40">→</span>
                                    {new Date(leave.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                </div>
                            </TableCell>
                            <TableCell className="py-4">
                                <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 font-black text-slate-900 dark:text-white text-xs">
                                    {diffDays(leave.startDate, leave.endDate)}
                                </div>
                            </TableCell>
                            <TableCell className="py-4"><StatusBadge status={leave.managerStatus} /></TableCell>
                            <TableCell className="py-4"><StatusBadge status={leave.hrStatus} /></TableCell>
                            <TableCell className="py-4 text-right pr-6">
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
                                    <ChevronRight className="h-4 w-4 text-slate-400" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

export default async function LeavesPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });
    if (!user) redirect("/login");

    const userRole = user.role;
    const isAdmin = userRole === "ADMIN" || userRole === "HR";

    // Fetch leave requests based on role
    let allLeaves: any[] = [];

    if (isAdmin) {
        allLeaves = await prisma.leaveRequest.findMany({
            include: { employee: true },
            orderBy: { createdAt: "desc" },
        });
    } else if (userRole === "MANAGER") {
        allLeaves = await prisma.leaveRequest.findMany({
            include: { employee: true },
            orderBy: { createdAt: "desc" },
        });
    } else if (user.employee) {
        allLeaves = await prisma.leaveRequest.findMany({
            where: { employeeId: user.employee.id },
            include: { employee: true },
            orderBy: { createdAt: "desc" },
        });
    }

    const pending = allLeaves.filter(l => l.managerStatus === "PENDING" || l.hrStatus === "PENDING");
    const approved = allLeaves.filter(l => l.managerStatus === "APPROVED" && l.hrStatus === "APPROVED");
    const rejected = allLeaves.filter(l => l.managerStatus === "REJECTED" || l.hrStatus === "REJECTED");

    const showEmployee = isAdmin || userRole === "MANAGER";

    // Stats
    const sickDays = allLeaves.filter(l => l.type === "SICK" && l.hrStatus === "APPROVED")
        .reduce((acc, l) => acc + Math.ceil((new Date(l.endDate).getTime() - new Date(l.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1, 0);

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-violet-900 to-indigo-950 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>
                
                <div className="relative z-10">
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2">Leave Center</h1>
                    <p className="text-violet-100 text-sm md:text-base font-medium max-w-xl">
                        {isAdmin ? "Manage all employee leave requests and balances." : userRole === "MANAGER" ? "Review and approve your team's availability." : "Submit requests and track your personal leave history."}
                    </p>
                </div>
                {(userRole === "STAFF" || isAdmin) && (
                    <Link href="/leaves/apply" className="relative z-10">
                        <Button className="gap-2 rounded-xl font-bold bg-white text-violet-900 hover:bg-violet-50 shadow-xl border-0 h-12 px-6">
                            <Plus className="h-5 w-5" />
                            Apply for Leave
                        </Button>
                    </Link>
                )}
            </div>

            {/* Premium Stats Grid */}
            <div className="grid gap-6 md:grid-cols-4">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Filed</CardTitle>
                        <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                            <Calendar className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{allLeaves.length}</div>
                        <p className="text-xs font-medium text-slate-500 mt-1">Request history</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl border-l-4 border-l-amber-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Pending</CardTitle>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{pending.length}</div>
                        <p className="text-xs font-medium text-amber-600 mt-1">Awaiting decision</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl border-l-4 border-l-emerald-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Approved</CardTitle>
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{approved.length}</div>
                        <p className="text-xs font-medium text-emerald-600 mt-1">Ready for vacation</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">Sick Days</CardTitle>
                        <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-lg">
                            <HeartPulse className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{sickDays}</div>
                        <p className="text-xs font-medium text-rose-600 mt-1">Approved sick leaves</p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Content Area */}
            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-3xl overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl font-black text-slate-800 dark:text-white">Request History</CardTitle>
                            <CardDescription className="font-bold text-slate-400 text-xs uppercase tracking-widest mt-1">
                                {showEmployee ? "Enterprise-wide leave tracking" : "Your personal presence metrics"}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Tabs defaultValue="all" className="w-full">
                        <div className="px-6 py-4 bg-slate-50/30 dark:bg-slate-900/10 border-b border-slate-100 dark:border-slate-800/60">
                            <TabsList className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-1 h-12 rounded-2xl shadow-sm">
                                <TabsTrigger value="all" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-violet-600 data-[state=active]:text-white transition-all">
                                    All <Badge variant="secondary" className="ml-2 bg-slate-100 dark:bg-slate-800 text-[10px]">{allLeaves.length}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="pending" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-amber-500 data-[state=active]:text-white transition-all">
                                    Pending <Badge variant="secondary" className="ml-2 bg-slate-100 dark:bg-slate-800 text-[10px]">{pending.length}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="approved" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white transition-all">
                                    Approved <Badge variant="secondary" className="ml-2 bg-slate-100 dark:bg-slate-800 text-[10px]">{approved.length}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="rejected" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-rose-600 data-[state=active]:text-white transition-all">
                                    Rejected <Badge variant="secondary" className="ml-2 bg-slate-100 dark:bg-slate-800 text-[10px]">{rejected.length}</Badge>
                                </TabsTrigger>
                            </TabsList>
                        </div>
                        <TabsContent value="all" className="m-0 border-0 outline-none">
                            <LeaveTable leaves={allLeaves} showEmployee={showEmployee} />
                        </TabsContent>
                        <TabsContent value="pending" className="m-0 border-0 outline-none">
                            <LeaveTable leaves={pending} showEmployee={showEmployee} />
                        </TabsContent>
                        <TabsContent value="approved" className="m-0 border-0 outline-none">
                            <LeaveTable leaves={approved} showEmployee={showEmployee} />
                        </TabsContent>
                        <TabsContent value="rejected" className="m-0 border-0 outline-none">
                            <LeaveTable leaves={rejected} showEmployee={showEmployee} />
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            {/* Quick Action for approvals */}
            {(isAdmin || userRole === "MANAGER") && pending.length > 0 && (
                <div className="group relative flex items-center gap-6 p-6 rounded-[2rem] bg-indigo-600 text-white shadow-2xl overflow-hidden transition-all hover:scale-[1.01]">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl translate-x-1/2 -translate-y-1/2"></div>
                    <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 shadow-inner">
                        <AlertCircle className="h-8 w-8 text-white" />
                    </div>
                    <div className="flex-1">
                        <h4 className="text-xl font-black">Action Required</h4>
                        <p className="text-indigo-100 font-medium text-sm">
                            You have <span className="text-white font-black underline decoration-2 underline-offset-4">{pending.length} leave requests</span> waiting for your review. Keep the workflow moving!
                        </p>
                    </div>
                    <Link href="/dashboard/approvals">
                        <Button className="bg-white text-indigo-600 hover:bg-indigo-50 font-black rounded-xl px-8 h-12 shadow-xl border-0">
                            Approve Now
                        </Button>
                    </Link>
                </div>
            )}
        </div>
    );
}
