import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";import { revalidatePath } from "next/cache";
import { requirePageRole } from "@/lib/auth/page-guard";
import { ROLES } from "@/lib/auth/roles";
import {
    requirePermission,
    validateRoleChange,
    validateRoleValue,
    assignableRoles,
    AuthenticationError,
    AuthorizationError,
} from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";

/**
 * Approve or reject a role-change request.
 *
 * SECURITY: this action writes `User.role` directly. It previously performed NO
 * authorization at all, so any authenticated client able to reach this action
 * could grant itself any role — a direct privilege-escalation path. It now:
 *   - requires `access.approve` (ADMIN and above),
 *   - rejects an unrecognised requested role rather than writing it blindly,
 *   - refuses self-approval and out-of-authority grants,
 *   - protects the last SUPER_ADMIN,
 *   - records actor / target / before / after in the security audit log.
 */
async function handleRoleRequest(requestId: string, action: "APPROVED" | "REJECTED") {
    "use server";
    let actorEmail = "unknown";
    let actorRole = "unknown";

    try {
        const actor = await requirePermission(PERMISSIONS.ACCESS_APPROVE);
        actorEmail = actor.email;
        actorRole = actor.role;

        const request = await prisma.roleRequest.findUnique({
            where: { id: requestId },
            include: { user: true },
        });
        if (!request) return;
        if (request.status !== "PENDING") return; // idempotent: ignore replays

        if (action === "REJECTED") {
            await prisma.roleRequest.update({
                where: { id: requestId },
                data: { status: action },
            });
            await logSecurityEvent({
                action: SECURITY_ACTION.ROLE_REQUEST_REJECTED,
                actorEmail,
                actorRole,
                target: `user:${request.userId}`,
                outcome: "SUCCESS",
                detail: { requestId, requestedRole: request.requestedRole },
            });
            revalidatePath("/dashboard/approvals/roles");
            return;
        }

        // --- APPROVED: validate before writing ---------------------------
        const validated = validateRoleValue(request.requestedRole);
        if (!validated.ok) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ROLE_REQUEST_APPROVED,
                actorEmail,
                actorRole,
                target: `user:${request.userId}`,
                outcome: "DENIED",
                detail: { requestId, reason: validated.error },
            });
            return;
        }
        const nextRole = validated.role;

        if (!assignableRoles(actor.role).includes(nextRole) && actor.role !== ROLES.SUPER_ADMIN) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ROLE_REQUEST_APPROVED,
                actorEmail,
                actorRole,
                target: `user:${request.userId}`,
                outcome: "DENIED",
                detail: { requestId, requestedRole: nextRole, reason: "role not assignable by actor" },
            });
            return;
        }

        const guard = await validateRoleChange({
            actorRole: actor.role,
            targetUserId: request.userId,
            currentRole: request.user ? (request.user.role as never) : ROLES.STAFF,
            nextRole,
        });
        if (!guard.allowed) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ROLE_REQUEST_APPROVED,
                actorEmail,
                actorRole,
                target: `user:${request.userId}`,
                outcome: "DENIED",
                detail: { requestId, requestedRole: nextRole, reason: guard.reason },
            });
            return;
        }

        const previousRole = request.user?.role ?? null;

        await prisma.$transaction([
            prisma.user.update({
                where: { id: request.userId },
                data: { role: nextRole },
            }),
            prisma.roleRequest.update({
                where: { id: requestId },
                data: { status: action },
            }),
        ]);

        await logSecurityEvent({
            action: SECURITY_ACTION.ROLE_CHANGED,
            actorEmail,
            actorRole,
            target: `user:${request.userId}`,
            outcome: "SUCCESS",
            detail: {
                requestId,
                targetEmail: request.user?.email ?? null,
                previousRole,
                newRole: nextRole,
            },
        });

        revalidatePath("/dashboard/approvals/roles");
    } catch (error) {
        if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
            await logSecurityEvent({
                action: SECURITY_ACTION.ROLE_CHANGED,
                actorEmail,
                actorRole,
                outcome: "DENIED",
                detail: { requestId, reason: (error instanceof Error ? error.message : "Unknown error") },
            });
            return;
        }
        console.error("[handleRoleRequest]", error);
    }
}

export default async function RoleApprovalsPage() {
    // Page-level guard: requires ADMIN (or SUPER_ADMIN) before any query runs.
    await requirePageRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);

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
