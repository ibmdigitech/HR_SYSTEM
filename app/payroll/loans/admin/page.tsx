import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Banknote, Users, CheckCircle, Clock } from "lucide-react";

export default async function LoansAdminDashboard() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user || user.role === "STAFF") redirect("/dashboard");

    const pendingApplications = await prisma.loanApplication.findMany({
        where: {
            OR: [
                { managerStatus: "PENDING", employee: { managerId: user.employee?.id } },
                { hrStatus: "PENDING", status: "PENDING_HR" },
                { financeStatus: "PENDING", status: "PENDING_FINANCE" }
            ]
        },
        include: {
            employee: true,
            loanType: true
        },
        orderBy: { createdAt: 'asc' }
    });

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
            <div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Loan Approvals</h1>
                <p className="text-slate-500 font-medium mt-1">Review and process employee loan requests.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="rounded-[2rem] border-slate-100 shadow-lg">
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="p-4 bg-amber-50 rounded-2xl">
                            <Clock className="h-6 w-6 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-3xl font-black">{pendingApplications.length}</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Pending Review</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="space-y-4">
                {pendingApplications.length === 0 ? (
                    <Card className="p-12 border-dashed flex flex-col items-center justify-center text-slate-400 rounded-[2rem]">
                        <CheckCircle className="h-10 w-10 mb-4 opacity-50" />
                        <p className="font-medium">No pending loan applications require your attention.</p>
                    </Card>
                ) : (
                    pendingApplications.map(app => (
                        <Card key={app.id} className="rounded-[2rem] border-slate-100 shadow-md">
                            <CardContent className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-lg font-black">{app.employee.firstName} {app.employee.lastName}</h3>
                                        <Badge variant="outline">{app.loanType.name}</Badge>
                                    </div>
                                    <p className="text-sm font-medium text-slate-500">
                                        Requested: <span className="font-bold text-slate-800">{app.requestedAmount} AED</span> over {app.repaymentMonths} months
                                    </p>
                                    <p className="text-xs text-slate-400 italic">"{app.reason}"</p>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <Badge className="bg-amber-100 text-amber-800 border-0">{app.status.replace("_", " ")}</Badge>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
