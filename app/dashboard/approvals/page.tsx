import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle,  } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, FileText, Briefcase, Globe, HeartHandshake, Clock, AlertCircle, Zap } from "lucide-react";
import { approveLeaveManager, approveLeaveHR } from "@/app/lib/actions/leave";
import { approveStaffRequest } from "@/app/lib/actions/staff-requests";
import { updateVisaStatus } from "@/app/lib/actions/visa";
import { redirect } from "next/navigation";
import { hasPermission, hasAnyPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { buildLeaveQueueWhere } from "@/lib/approvals/leave-queue";

export default async function ApprovalsPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user) redirect("/login");
    const userRole = user.role;

    if (userRole === "STAFF") {
        return (
            <div className="p-8 max-w-4xl mx-auto">
                <Card className="border-0 shadow-2xl bg-rose-50/50 dark:bg-rose-950/20 backdrop-blur-xl rounded-[2.5rem] overflow-hidden">
                    <div className="p-12 text-center">
                        <div className="h-20 w-20 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center mx-auto mb-6">
                            <AlertCircle className="h-10 w-10 text-rose-600" />
                        </div>
                        <h2 className="text-3xl font-black text-rose-900 dark:text-rose-100 mb-4 tracking-tight uppercase">Access Denied</h2>
                        <p className="text-rose-700/70 dark:text-rose-300/70 text-lg font-medium leading-relaxed max-w-md mx-auto">
                            You do not have permission to view this page. Approvals are restricted to Manager, HR, and Admin roles.
                        </p>
                    </div>
                </Card>
            </div>
        );
    }

    // ── Fetch Leave Requests ──
    // The where-clause lives in lib/approvals/leave-queue.ts as a pure function
    // so the rule governing *whose work an approver sees* is unit-tested
    // rather than buried in JSX. See that file for why the legacy
    // `managerStatus`/`hrStatus` columns must not be used here.
    let pendingLeaves: any[] = [];
    const canApproveLeave = hasPermission(userRole, PERMISSIONS.LEAVE_APPROVE);
    const leaveQueueWhere = buildLeaveQueueWhere({
        role: userRole,
        approverEmployeeId: user.employee?.id ?? null,
    });

    if (leaveQueueWhere) {
        pendingLeaves = await prisma.leaveRequest.findMany({
            where: leaveQueueWhere,
            include: { employee: true },
            orderBy: { createdAt: 'desc' }
        });
    }

    // ── Fetch Staff Requests ──
    let pendingStaffRequests: any[] = [];
    if (hasAnyPermission(userRole, [PERMISSIONS.SERVICE_APPROVE, PERMISSIONS.REQUEST_APPROVE])) {
        pendingStaffRequests = await prisma.serviceRequest.findMany({
            where: { status: "PENDING" },
            include: { employee: true, category: true },
            orderBy: { createdAt: 'desc' }
        });
    }

    // ── Fetch Visa Requests ──
    let pendingVisaRequests: any[] = [];
    if (hasPermission(userRole, PERMISSIONS.VISA_VIEW)) {
        pendingVisaRequests = await prisma.visaRequest.findMany({
            where: { status: "PENDING" },
            include: { employee: true, attachments: true },
            orderBy: { createdAt: 'desc' }
        });
    }

    const totalPending = pendingLeaves.length + pendingStaffRequests.length + pendingVisaRequests.length;

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all duration-500">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 group-hover:bg-indigo-500/20 transition-all duration-700"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2 group-hover:bg-violet-500/20 transition-all duration-700"></div>

                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-6">
                        <Zap className="h-3 w-3 fill-indigo-400" />
                        Approval Center
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-4 leading-tight">
                        Pending<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                            Approvals
                        </span>
                    </h1>
                    <p className="text-slate-300 text-base font-medium max-w-xl leading-relaxed">
                        {userRole === "MANAGER"
                            ? "Review and action your team's leave and service requests."
                            : "Manage all pending leave, staff service, and visa requests across the organization."}
                    </p>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card className="group bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-indigo-500/10 transition-all duration-300">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <AlertCircle className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-black text-slate-900 dark:text-white">{totalPending}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Pending</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="group bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-amber-500/10 transition-all duration-300">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-3 bg-amber-50 dark:bg-amber-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <Briefcase className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-black text-slate-900 dark:text-white">{pendingLeaves.length}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Leave Requests</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="group bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-emerald-500/10 transition-all duration-300">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <HeartHandshake className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-black text-slate-900 dark:text-white">{pendingStaffRequests.length}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Staff Requests</p>
                        </div>
                    </CardContent>
                </Card>
                <Card className="group bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden hover:shadow-violet-500/10 transition-all duration-300">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-3 bg-violet-50 dark:bg-violet-900/30 rounded-xl group-hover:scale-110 transition-transform">
                            <Globe className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div>
                            <p className="text-3xl font-black text-slate-900 dark:text-white">{pendingVisaRequests.length}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visa Requests</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Tabbed Content */}
            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-xl rounded-[2.5rem] overflow-hidden">
                <Tabs defaultValue="leaves" className="w-full">
                    <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-6 py-6">
                        <TabsList className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-1 h-12 rounded-2xl shadow-sm">
                            <TabsTrigger value="leaves" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-amber-500 data-[state=active]:text-white transition-all gap-2">
                                <Briefcase className="h-4 w-4" />
                                Leaves
                                {pendingLeaves.length > 0 && (
                                    <Badge className="ml-1 bg-amber-600/20 text-amber-700 dark:text-amber-300 border-0 text-[10px]">{pendingLeaves.length}</Badge>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="staff" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white transition-all gap-2">
                                <HeartHandshake className="h-4 w-4" />
                                Staff Services
                                {pendingStaffRequests.length > 0 && (
                                    <Badge className="ml-1 bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 border-0 text-[10px]">{pendingStaffRequests.length}</Badge>
                                )}
                            </TabsTrigger>
                            {(userRole === "HR" || userRole === "ADMIN") && (
                                <TabsTrigger value="visa" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-violet-600 data-[state=active]:text-white transition-all gap-2">
                                    <Globe className="h-4 w-4" />
                                    Visa
                                    {pendingVisaRequests.length > 0 && (
                                        <Badge className="ml-1 bg-violet-600/20 text-violet-700 dark:text-violet-300 border-0 text-[10px]">{pendingVisaRequests.length}</Badge>
                                    )}
                                </TabsTrigger>
                            )}
                        </TabsList>
                    </CardHeader>

                    {/* ═══ LEAVES TAB ═══ */}
                    <TabsContent value="leaves" className="m-0">
                        <CardContent className="p-0">
                            {pendingLeaves.length === 0 ? (
                                <EmptyState icon={<Briefcase className="h-12 w-12" />} message="No pending leave requests" />
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {pendingLeaves.map((request) => (
                                        <div key={request.id} className="p-6 hover:bg-slate-50/80 dark:hover:bg-slate-900/40 transition-all duration-200">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-400 font-black text-sm shadow-sm">
                                                        {request.employee.firstName[0]}{request.employee.lastName[0]}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-slate-900 dark:text-white tracking-tight">
                                                            {request.employee.firstName} {request.employee.lastName}
                                                        </h4>
                                                        <p className="text-xs font-bold text-slate-400">
                                                            {request.employee.designation} — {request.employee.department}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className="self-start md:self-auto font-black text-[10px] uppercase tracking-widest">{request.type}</Badge>
                                            </div>

                                            <div className="mt-4 grid md:grid-cols-3 gap-4 items-end">
                                                <div className="space-y-2 text-sm">
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-400 font-medium">Duration:</span>
                                                        <span className="font-bold text-slate-700 dark:text-slate-300">
                                                            {request.startDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} → {request.endDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-400 font-medium">Reason:</span>
                                                        <span className="italic text-slate-600 dark:text-slate-400 text-right max-w-[200px] truncate">{request.reason}</span>
                                                    </div>
                                                </div>
                                                <div></div>
                                                <div className="flex items-end justify-end gap-2">
                                                    <form action={async () => {
                                                        'use server';
                                                        if (userRole === "MANAGER") await approveLeaveManager(request.id, "REJECTED");
                                                        else await approveLeaveHR(request.id, "REJECTED");
                                                    }}>
                                                        <Button variant="destructive" size="sm" className="gap-2 rounded-xl font-bold">
                                                            <XCircle className="h-4 w-4" />
                                                            Reject
                                                        </Button>
                                                    </form>
                                                    <form action={async () => {
                                                        'use server';
                                                        if (userRole === "MANAGER") await approveLeaveManager(request.id, "APPROVED");
                                                        else await approveLeaveHR(request.id, "APPROVED");
                                                    }}>
                                                        <Button variant="default" size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                            Approve
                                                        </Button>
                                                    </form>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </TabsContent>

                    {/* ═══ STAFF REQUESTS TAB ═══ */}
                    <TabsContent value="staff" className="m-0">
                        <CardContent className="p-0">
                            {pendingStaffRequests.length === 0 ? (
                                <EmptyState icon={<HeartHandshake className="h-12 w-12" />} message="No pending staff service requests" />
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {pendingStaffRequests.map((request) => (
                                        <div key={request.id} className="p-6 hover:bg-slate-50/80 dark:hover:bg-slate-900/40 transition-all duration-200">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-black text-sm shadow-sm">
                                                        {request.employee.firstName[0]}{request.employee.lastName[0]}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-slate-900 dark:text-white tracking-tight">
                                                            {request.employee.firstName} {request.employee.lastName}
                                                        </h4>
                                                        <p className="text-xs font-bold text-slate-400">
                                                            {request.employee.designation} — {request.employee.department}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Badge className="self-start md:self-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 font-black text-[10px] uppercase tracking-widest">
                                                    {request.serviceType.name}
                                                </Badge>
                                            </div>

                                            <div className="mt-4 grid md:grid-cols-3 gap-4 items-end">
                                                <div className="space-y-2 text-sm md:col-span-2">
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-400 font-medium">Details:</span>
                                                        <span className="text-slate-600 dark:text-slate-400 text-right max-w-[300px] truncate">{request.details}</span>
                                                    </div>
                                                    {request.amount && (
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-400 font-medium">Amount:</span>
                                                            <span className="font-black text-emerald-600">AED {request.amount.toLocaleString()}</span>
                                                        </div>
                                                    )}
                                                    {request.startDate && request.endDate && (
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-400 font-medium">Period:</span>
                                                            <span className="font-bold text-slate-700 dark:text-slate-300">
                                                                {new Date(request.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} → {new Date(request.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-400 font-medium">Submitted:</span>
                                                        <span className="text-xs font-bold text-slate-500">
                                                            {new Date(request.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-end justify-end gap-2">
                                                    <form action={async () => {
                                                        'use server';
                                                        await approveStaffRequest(request.id, "REJECTED");
                                                    }}>
                                                        <Button variant="destructive" size="sm" className="gap-2 rounded-xl font-bold">
                                                            <XCircle className="h-4 w-4" />
                                                            Reject
                                                        </Button>
                                                    </form>
                                                    <form action={async () => {
                                                        'use server';
                                                        await approveStaffRequest(request.id, "APPROVED");
                                                    }}>
                                                        <Button variant="default" size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                            Approve
                                                        </Button>
                                                    </form>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </TabsContent>

                    {/* ═══ VISA REQUESTS TAB ═══ */}
                    <TabsContent value="visa" className="m-0">
                        <CardContent className="p-0">
                            {pendingVisaRequests.length === 0 ? (
                                <EmptyState icon={<Globe className="h-12 w-12" />} message="No pending visa requests" />
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {pendingVisaRequests.map((request) => (
                                        <div key={request.id} className="p-6 hover:bg-slate-50/80 dark:hover:bg-slate-900/40 transition-all duration-200">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 rounded-2xl bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center text-violet-700 dark:text-violet-400 font-black text-sm shadow-sm">
                                                        {request.employee.firstName[0]}{request.employee.lastName[0]}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-slate-900 dark:text-white tracking-tight">
                                                            {request.employee.firstName} {request.employee.lastName}
                                                        </h4>
                                                        <p className="text-xs font-bold text-slate-400">
                                                            {request.employee.designation} — {request.employee.department}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 self-start md:self-auto">
                                                    <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-0 font-black text-[10px] uppercase tracking-widest">
                                                        {request.visaType}
                                                    </Badge>
                                                    <Badge variant="outline" className="font-bold text-[10px] uppercase tracking-widest">
                                                        {request.destinationCountry}
                                                    </Badge>
                                                </div>
                                            </div>

                                            <div className="mt-4 grid md:grid-cols-3 gap-4 items-end">
                                                <div className="space-y-2 text-sm md:col-span-2">
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-400 font-medium">Purpose:</span>
                                                        <span className="text-slate-600 dark:text-slate-400 text-right max-w-[300px] truncate">{request.purpose}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-400 font-medium">Documents:</span>
                                                        <span className="font-bold text-slate-700 dark:text-slate-300">{request.attachments?.length || 0} attached</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-slate-400 font-medium">Submitted:</span>
                                                        <span className="text-xs font-bold text-slate-500">
                                                            {new Date(request.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-end justify-end gap-2">
                                                    <form action={async () => {
                                                        'use server';
                                                        await updateVisaStatus(request.id, "REJECTED");
                                                    }}>
                                                        <Button variant="destructive" size="sm" className="gap-2 rounded-xl font-bold">
                                                            <XCircle className="h-4 w-4" />
                                                            Reject
                                                        </Button>
                                                    </form>
                                                    <form action={async () => {
                                                        'use server';
                                                        await updateVisaStatus(request.id, "APPROVED");
                                                    }}>
                                                        <Button variant="default" size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                            Approve
                                                        </Button>
                                                    </form>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </TabsContent>
                </Tabs>
            </Card>
        </div>
    );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400/50">
            <div className="opacity-20 mb-4">{icon}</div>
            <p className="text-xs font-black uppercase tracking-widest italic text-center">{message}</p>
            <p className="text-[10px] font-bold text-slate-300 mt-2">All caught up!</p>
        </div>
    );
}
