import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, FileText } from "lucide-react";
import { approveLeaveManager, approveLeaveHR } from "@/app/lib/actions/leave";
import { redirect } from "next/navigation";

export default async function ApprovalsPage() {
    const session = await auth();
    if (!session?.user) redirect("/login");

    const userRole = session.user.email?.includes("admin") ? "ADMIN" : session.user.email?.includes("manager") ? "MANAGER" : session.user.email?.includes("hr") ? "HR" : "STAFF";

    if (userRole === "STAFF") {
        return (
            <div className="p-8">
                <Card className="border-red-200 bg-red-50">
                    <CardHeader>
                        <CardTitle className="text-red-600">Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view this page.</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    // Fetch Logic
    let pendingLeaves: any[] = [];
    if (userRole === "MANAGER") {
        pendingLeaves = await prisma.leaveRequest.findMany({
            where: { managerStatus: "PENDING" },
            include: { employee: true },
            orderBy: { createdAt: 'desc' }
        });
    } else if (userRole === "HR" || userRole === "ADMIN") {
        // HR sees Approved by Manager but Pending HR
        pendingLeaves = await prisma.leaveRequest.findMany({
            where: {
                managerStatus: "APPROVED",
                hrStatus: "PENDING"
            },
            include: { employee: true },
            orderBy: { createdAt: 'desc' }
        });
    }

    return (
        <div className="space-y-6 p-8">
            <h1 className="text-3xl font-bold tracking-tight">Pending Approvals</h1>
            <p className="text-muted-foreground">
                {userRole === "MANAGER" ? "Review staff leave requests." : "Finalize leave requests approved by managers."}
            </p>

            {pendingLeaves.length === 0 ? (
                <Card className="bg-slate-50 border-dashed">
                    <CardContent className="h-32 flex items-center justify-center text-muted-foreground">
                        No pending approvals found.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {pendingLeaves.map((request) => (
                        <Card key={request.id}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <div className="space-y-1">
                                    <CardTitle>{request.employee.firstName} {request.employee.lastName}</CardTitle>
                                    <CardDescription>{request.employee.designation} - {request.employee.department}</CardDescription>
                                </div>
                                <Badge variant="outline">{request.type}</Badge>
                            </CardHeader>
                            <CardContent>
                                <div className="grid md:grid-cols-2 gap-4 mt-2">
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Duration:</span>
                                            <span className="font-medium">
                                                {request.startDate.toLocaleDateString()} - {request.endDate.toLocaleDateString()}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Reason:</span>
                                            <span className="italic">{request.reason}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-end justify-end gap-2">
                                        <form action={async () => {
                                            'use server';
                                            if (userRole === "MANAGER") await approveLeaveManager(request.id, "REJECTED");
                                            else await approveLeaveHR(request.id, "REJECTED");
                                        }}>
                                            <Button variant="destructive" size="sm" className="gap-2">
                                                <XCircle className="h-4 w-4" />
                                                Reject
                                            </Button>
                                        </form>

                                        <form action={async () => {
                                            'use server';
                                            if (userRole === "MANAGER") await approveLeaveManager(request.id, "APPROVED");
                                            else await approveLeaveHR(request.id, "APPROVED");
                                        }}>
                                            <Button variant="default" size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                                                <CheckCircle2 className="h-4 w-4" />
                                                Approve
                                            </Button>
                                        </form>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
