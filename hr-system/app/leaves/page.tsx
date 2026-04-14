import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Calendar, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-700 border-amber-200",
    APPROVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
    REJECTED: "bg-red-100 text-red-700 border-red-200",
};

const LEAVE_TYPE_COLORS: Record<string, string> = {
    SICK: "bg-rose-50 text-rose-700 border-rose-200",
    CASUAL: "bg-sky-50 text-sky-700 border-sky-200",
    ANNUAL: "bg-violet-50 text-violet-700 border-violet-200",
};

function StatusBadge({ status }: { status: string }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] || "bg-slate-100 text-slate-600"}`}>
            {status === "PENDING" && <Clock className="h-3 w-3" />}
            {status === "APPROVED" && <CheckCircle2 className="h-3 w-3" />}
            {status === "REJECTED" && <XCircle className="h-3 w-3" />}
            {status}
        </span>
    );
}

function LeaveTable({ leaves, showEmployee }: { leaves: any[]; showEmployee: boolean }) {
    if (leaves.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Calendar className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">No leave requests found</p>
            </div>
        );
    }

    const diffDays = (start: Date, end: Date) =>
        Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return (
        <Table>
            <TableHeader>
                <TableRow className="border-slate-100 dark:border-slate-800">
                    {showEmployee && <TableHead>Employee</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>HR</TableHead>
                    <TableHead>Submitted</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {leaves.map((leave: any) => (
                    <TableRow key={leave.id} className="border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                        {showEmployee && (
                            <TableCell className="font-semibold text-slate-900 dark:text-white">
                                <div>{leave.employee.firstName} {leave.employee.lastName}</div>
                                <div className="text-xs text-slate-400 font-normal">{leave.employee.designation}</div>
                            </TableCell>
                        )}
                        <TableCell>
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold border ${LEAVE_TYPE_COLORS[leave.type] || "bg-slate-100 text-slate-700"}`}>
                                {leave.type}
                            </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                            <div>{new Date(leave.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                            <div className="text-xs text-slate-400">to {new Date(leave.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
                        </TableCell>
                        <TableCell>
                            <span className="font-bold text-slate-900 dark:text-white">
                                {diffDays(leave.startDate, leave.endDate)}d
                            </span>
                        </TableCell>
                        <TableCell><StatusBadge status={leave.managerStatus} /></TableCell>
                        <TableCell><StatusBadge status={leave.hrStatus} /></TableCell>
                        <TableCell className="text-xs text-slate-400">
                            {new Date(leave.createdAt).toLocaleDateString()}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
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
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Leave Management</h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        {isAdmin ? "Manage all employee leave requests." : userRole === "MANAGER" ? "Review your team's leave requests." : "Track and manage your leave requests."}
                    </p>
                </div>
                {(userRole === "STAFF" || isAdmin) && (
                    <Link href="/leaves/apply">
                        <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none">
                            <Plus className="h-4 w-4" />
                            Apply for Leave
                        </Button>
                    </Link>
                )}
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="border-slate-200 dark:border-slate-800">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">Total Requests</CardTitle>
                        <Calendar className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">{allLeaves.length}</div>
                        <p className="text-xs text-slate-500">All time</p>
                    </CardContent>
                </Card>
                <Card className="border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-900/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-amber-700 dark:text-amber-400">Pending</CardTitle>
                        <Clock className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{pending.length}</div>
                        <p className="text-xs text-amber-600/70">Awaiting approval</p>
                    </CardContent>
                </Card>
                <Card className="border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/50 dark:bg-emerald-900/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Approved</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{approved.length}</div>
                        <p className="text-xs text-emerald-600/70">Fully approved</p>
                    </CardContent>
                </Card>
                <Card className="border-slate-200 dark:border-slate-800">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">Sick Days Used</CardTitle>
                        <AlertCircle className="h-4 w-4 text-rose-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">{sickDays}</div>
                        <p className="text-xs text-slate-500">Approved sick leaves</p>
                    </CardContent>
                </Card>
            </div>

            {/* Tabbed Leave Table */}
            <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle>Leave Requests</CardTitle>
                    <CardDescription>
                        {showEmployee ? "All employee leave requests" : "Your submitted leave requests"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <Tabs defaultValue="all">
                        <div className="px-6 pt-4 border-b border-slate-100 dark:border-slate-800">
                            <TabsList className="h-9 bg-slate-100/80 dark:bg-slate-800/80">
                                <TabsTrigger value="all" className="text-xs font-semibold">
                                    All ({allLeaves.length})
                                </TabsTrigger>
                                <TabsTrigger value="pending" className="text-xs font-semibold">
                                    Pending ({pending.length})
                                </TabsTrigger>
                                <TabsTrigger value="approved" className="text-xs font-semibold">
                                    Approved ({approved.length})
                                </TabsTrigger>
                                <TabsTrigger value="rejected" className="text-xs font-semibold">
                                    Rejected ({rejected.length})
                                </TabsTrigger>
                            </TabsList>
                        </div>
                        <TabsContent value="all" className="mt-0 px-0">
                            <LeaveTable leaves={allLeaves} showEmployee={showEmployee} />
                        </TabsContent>
                        <TabsContent value="pending" className="mt-0 px-0">
                            <LeaveTable leaves={pending} showEmployee={showEmployee} />
                        </TabsContent>
                        <TabsContent value="approved" className="mt-0 px-0">
                            <LeaveTable leaves={approved} showEmployee={showEmployee} />
                        </TabsContent>
                        <TabsContent value="rejected" className="mt-0 px-0">
                            <LeaveTable leaves={rejected} showEmployee={showEmployee} />
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            {/* Quick Action for approvals */}
            {(isAdmin || userRole === "MANAGER") && pending.length > 0 && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
                    <AlertCircle className="h-5 w-5 text-indigo-600 shrink-0" />
                    <p className="text-sm font-medium text-indigo-700 dark:text-indigo-400">
                        {pending.length} leave request{pending.length > 1 ? "s" : ""} awaiting your approval.
                    </p>
                    <Link href="/dashboard/approvals" className="ml-auto">
                        <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                            Go to Approvals
                        </Button>
                    </Link>
                </div>
            )}
        </div>
    );
}
