import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function handleRoleRequest(requestId: string, action: "APPROVED" | "REJECTED") {
    "use server";
    try {
        const request = await prisma.roleRequest.findUnique({ where: { id: requestId }, include: { user: true } });
        if (!request) return;

        if (action === "APPROVED") {
            // Update User Role
            await prisma.user.update({
                where: { id: request.userId },
                data: { role: request.requestedRole }
            });
        }

        // Update Request Status
        await prisma.roleRequest.update({
            where: { id: requestId },
            data: { status: action }
        });

        revalidatePath("/dashboard/approvals/roles");
    } catch (e) {
        console.error(e);
    }
}

export default async function RoleApprovalsPage() {
    const session = await auth();
    if (!session?.user?.email) {
        return <div className="p-8">Access Denied: Unauthenticated</div>
    }
    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user || user.role !== "ADMIN") {
        return <div className="p-8">Access Denied: Admins Only</div>
    }

    const requests = await prisma.roleRequest.findMany({
        where: { status: "PENDING" },
        include: { user: true },
        orderBy: { createdAt: 'desc' }
    });

    return (
        <div className="space-y-6 p-8">
            <h1 className="text-3xl font-bold tracking-tight">Role Access <span className="text-muted-foreground">Approvals</span></h1>

            <div className="grid gap-4">
                {requests.map((req) => (
                    <Card key={req.id}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <div className="space-y-1">
                                <CardTitle>{req.user.name || req.user.email}</CardTitle>
                                <CardDescription>Requesting access for:</CardDescription>
                            </div>
                            <Badge>{req.requestedRole}</Badge>
                        </CardHeader>
                        <CardContent className="flex justify-end gap-2">
                            <form action={handleRoleRequest.bind(null, req.id, "REJECTED")}>
                                <Button variant="ghost" size="sm">Reject</Button>
                            </form>
                            <form action={handleRoleRequest.bind(null, req.id, "APPROVED")}>
                                <Button size="sm">Approve Access</Button>
                            </form>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
