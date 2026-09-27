'use server';

/**
 * Credential actions (P1.1 — SEC-027).
 *
 * This file has a file-level "use server" directive, so it may only export
 * async functions.
 */

import { revalidatePath } from "next/cache";
import { requirePermission, AuthenticationError, AuthorizationError } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { issueActivationToken } from "@/lib/workflow/credentials";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import prisma from "@/lib/prisma";

export interface CredentialActionResult {
    success: boolean;
    message: string;
    /** One-time link. Returned only when this action generated it. */
    activation?: { token: string; expiresAt: string };
}

/**
 * Issues a fresh activation link for an employee whose password was never set
 * or whose link was lost.
 *
 * Issuing a new link invalidates any previous unused one, so only the newest
 * link works. That is deliberate: a leaked older link must not remain usable.
 */
export async function reissueActivationLink(employeeId: string): Promise<CredentialActionResult> {
    let actorEmail = "unknown";
    try {
        const user = await requirePermission(PERMISSIONS.EMPLOYEES_EDIT);
        actorEmail = user.email;

        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true, firstName: true, userId: true, currentStatus: true },
        });
        if (!employee) return { success: false, message: "Employee not found." };
        if (!employee.userId) {
            return { success: false, message: "This employee has no linked user account." };
        }
        if (employee.currentStatus === "OFFBOARDED") {
            return { success: false, message: "This employee has been offboarded." };
        }

        const issued = await issueActivationToken({
            userId: employee.userId,
            createdBy: user.email,
            purpose: "FIRST_LOGIN",
        });

        await prisma.auditLog.create({
            data: {
                employeeId: employee.id,
                action: "ACTIVATION_LINK_REISSUED",
                details: `Activation link reissued for ${employee.firstName}. Previous unused link invalidated.`,
                changedBy: user.email,
            },
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole: user.role,
            target: `user:${employee.userId}`,
            outcome: "SUCCESS",
            detail: { change: "activationLinkReissued", employeeId: employee.id },
        });

        revalidatePath("/employees");

        return {
            success: true,
            message: "A new activation link has been issued. The previous link no longer works.",
            activation: { token: issued.token, expiresAt: issued.expiresAt.toISOString() },
        };
    } catch (error) {
        if (error instanceof AuthenticationError) {
            return { success: false, message: "Not signed in." };
        }
        if (error instanceof AuthorizationError) {
            return { success: false, message: (error instanceof Error ? error.message : "Unknown error") };
        }
        console.error("[REISSUE_ACTIVATION_FAILED]", error);
        return { success: false, message: "Could not issue a new link." };
    }
}
