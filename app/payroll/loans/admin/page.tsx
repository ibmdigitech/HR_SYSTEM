import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoanApprovalActions } from "@/components/payroll/LoanApprovalActions";
import {
    Banknote,
    Users,
    CheckCircle,
    Clock,
    XCircle,
    Shield,
    FileText,
    TrendingUp
} from "lucide-react";
import Link from "next/link";

const statusConfig: Record<string, { label: string; color: string }> = {
    SUBMITTED:        { label: "Submitted",        color: "bg-blue-100 text-blue-700" },
    PENDING_MANAGER:  { label: "Pending Manager",  color: "bg-amber-100 text-amber-700" },
    PENDING_HR:       { label: "Pending HR",       color: "bg-purple-100 text-purple-700" },
    PENDING_FINANCE:  { label: "Pending Finance",  color: "bg-orange-100 text-orange-700" },
    APPROVED:         { label: "Approved",         color: "bg-emerald-100 text-emerald-700" },
    REJECTED:         { label: "Rejected",         color: "bg-rose-100 text-rose-700" },
    DISBURSED:        { label: "Disbursed",        color: "bg-indigo-100 text-indigo-700" },
};

export default async function LoansAdminDashboard() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user || user.role === "STAFF") redirect("/dashboard");

    const userRole = user.role;
    const employeeId = user.employee?.id;

    // Get applications relevant to this user's role
    const pendingApplications = await prisma.loanApplication.findMany({
        where: {
            OR: [
                // Manager sees apps from their direct reports
                { managerStatus: "PENDING", status: "SUBMITTED", employee: { managerId: employeeId } },
                // HR sees apps pending HR review
                { hrStatus: "PENDING", status: "PENDING_HR" },
                // Finance sees apps pending finance
                { financeStatus: "PENDING", status: "PENDING_FINANCE" },
                // Admin/Finance can see approved ready for disbursement
                { status: "APPROVED" },
            ]
        },
        include: {
            employee: true,
            loanType: true,
            approvals: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' }
    });

    // Stats
    const allApps = await prisma.loanApplication.findMany({
        select: { status: true, requestedAmount: true }
    });
    const totalDisbursed = allApps.filter(a => a.status === "DISBURSED").reduce((acc, a) => acc + a.requestedAmount, 0);
    const approvedCount = allApps.filter(a => a.status === "APPROVED").length;
    const rejectedCount = allApps.filter(a => a.status === "REJECTED").length;

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
                        <div className="p-2.5 bg-amber-500 rounded-xl shadow-lg shadow-amber-500/20">
                            <Shield className="h-6 w-6 text-white" />
                        </div>
                        Loan Approvals
                    </h1>
                    <p className="text-slate-500 font-medium mt-1 ml-14">Review and process employee loan requests.</p>
                </div>
                <Link href="/payroll/loans" className="text-sm font-bold text-indigo-600 hover:text-indigo-700 underline underline-offset-4">
                    View All Loans →
                </Link>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-amber-50 rounded-xl shrink-0"><Clock className="h-6 w-6 text-amber-600" /></div>
                    <div>
                        <p className="text-3xl font-black text-amber-600">{pendingApplications.length}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Need Action</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 rounded-xl shrink-0"><CheckCircle className="h-6 w-6 text-emerald-600" /></div>
                    <div>
                        <p className="text-3xl font-black text-emerald-600">{approvedCount}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Approved</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-rose-50 rounded-xl shrink-0"><XCircle className="h-6 w-6 text-rose-600" /></div>
                    <div>
                        <p className="text-3xl font-black text-rose-600">{rejectedCount}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Rejected</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 rounded-xl shrink-0"><Banknote className="h-6 w-6 text-indigo-600" /></div>
                    <div>
                        <p className="text-xl font-black text-indigo-600">AED {totalDisbursed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Total Disbursed</p>
                    </div>
                </div>
            </div>

            {/* Application Cards */}
            <div className="space-y-4">
                <h2 className="font-bold text-slate-600 dark:text-slate-400 text-sm uppercase tracking-wider">
                    Applications Requiring Action
                </h2>
                {pendingApplications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-slate-200 rounded-2xl text-center">
                        <CheckCircle className="h-12 w-12 text-emerald-300 mb-4" />
                        <p className="font-bold text-slate-600">All Clear!</p>
                        <p className="text-slate-400 text-sm mt-1">No pending loan applications require your attention.</p>
                    </div>
                ) : (
                    pendingApplications.map(app => {
                        const cfg = statusConfig[app.status] || { label: app.status, color: "bg-slate-100 text-slate-600" };
                        const isManager = app.employee.managerId === employeeId;

                        return (
                            <Card key={app.id} className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-md overflow-hidden">
                                <CardContent className="p-0">
                                    <div className="p-6 flex flex-col md:flex-row gap-6">
                                        {/* Employee Info */}
                                        <div className="flex-1 space-y-3">
                                            <div className="flex items-start gap-3">
                                                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-black text-sm shrink-0">
                                                    {app.employee.firstName[0]}{app.employee.lastName[0]}
                                                </div>
                                                <div>
                                                    <h3 className="text-base font-black text-slate-900 dark:text-slate-100">
                                                        {app.employee.firstName} {app.employee.lastName}
                                                    </h3>
                                                    <p className="text-xs text-slate-500">{app.employee.department} · {app.employee.designation}</p>
                                                </div>
                                                <span className={`ml-auto inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${cfg.color}`}>
                                                    {cfg.label}
                                                </span>
                                            </div>

                                            {/* Loan Details */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loan Type</p>
                                                    <p className="font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{app.loanType?.name}</p>
                                                </div>
                                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Amount</p>
                                                    <p className="font-black text-indigo-600 text-sm mt-0.5">AED {app.requestedAmount.toLocaleString()}</p>
                                                </div>
                                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Term</p>
                                                    <p className="font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{app.repaymentMonths} months</p>
                                                </div>
                                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Monthly EMI</p>
                                                    <p className="font-bold text-emerald-600 text-sm mt-0.5">AED {(app.requestedAmount / app.repaymentMonths).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                                                </div>
                                            </div>

                                            {/* Reason */}
                                            {app.reason && (
                                                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-100 dark:border-amber-900/30">
                                                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Applicant's Reason</p>
                                                    <p className="text-sm text-slate-700 dark:text-slate-300 italic">&ldquo;{app.reason}&rdquo;</p>
                                                </div>
                                            )}

                                            {/* Approval Trail */}
                                            {app.approvals.length > 0 && (
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Previous Actions</p>
                                                    {app.approvals.map(a => (
                                                        <div key={a.id} className="text-xs text-slate-500 flex gap-2">
                                                            <span className={`font-bold ${a.action === "APPROVED" ? "text-emerald-600" : a.action === "REJECTED" ? "text-rose-600" : "text-amber-600"}`}>
                                                                [{a.level}] {a.action}
                                                            </span>
                                                            {a.comments && <span>— {a.comments}</span>}
                                                            <span className="ml-auto">{format(new Date(a.createdAt), "MMM dd, yy")}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Panel */}
                                        <div className="md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-4 md:pt-0 md:pl-6">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">Your Action</p>
                                            <LoanApprovalActions
                                                applicationId={app.id}
                                                currentStatus={app.status}
                                                managerStatus={app.managerStatus}
                                                hrStatus={app.hrStatus}
                                                financeStatus={app.financeStatus}
                                                userRole={userRole}
                                                isManager={isManager}
                                            />
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="border-t border-slate-100 dark:border-slate-800 px-6 py-3 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                                        <span className="text-xs text-slate-400">
                                            Applied {format(new Date(app.createdAt), "MMMM dd, yyyy 'at' HH:mm")}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            {[
                                                { s: app.managerStatus, l: "Mgr" },
                                                { s: app.hrStatus, l: "HR" },
                                                { s: app.financeStatus, l: "Fin" },
                                            ].map(({ s, l }) => (
                                                <span key={l} className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                                                    s === "APPROVED" ? "bg-emerald-100 text-emerald-700" :
                                                    s === "REJECTED" ? "bg-rose-100 text-rose-700" :
                                                    "bg-slate-100 text-slate-500"
                                                }`}>{l}</span>
                                            ))}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>
        </div>
    );
}
