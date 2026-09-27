/**
 * Letter approval and versioning (P1.5).
 *
 * The audit found letter generation worked but had no approval step for
 * sensitive documents and no version history — a corrected letter overwrote the
 * original, so "what was issued when" was unrecoverable.
 *
 * VERSIONING: a correction creates a NEW `LetterRecord` with the next version
 * number under the same `documentKey`. Rows are never updated in place, and the
 * superseded row is marked rather than removed. The full chain is traceable.
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { notifyInApp } from "@/lib/workflow/notifications";
import {
    LETTER_STATUS,
    LETTER_TRANSITIONS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

/**
 * Letter types that require approval before they can be generated.
 * Configurable via ServiceConfig (module `letters`, key
 * `approval_required_types`); this is the documented default.
 */
const DEFAULT_APPROVAL_REQUIRED = ["OFFER", "APPOINTMENT", "RELIEVING", "NOC", "SALARY_CERTIFICATE"];

async function approvalRequiredTypes(): Promise<string[]> {
    try {
        const config = await prisma.serviceConfig.findFirst({
            where: { module: "letters", key: "approval_required_types" },
            select: { value: true },
        });
        if (!config?.value) return DEFAULT_APPROVAL_REQUIRED;
        const parsed = config.value.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
        return parsed.length > 0 ? parsed : DEFAULT_APPROVAL_REQUIRED;
    } catch (error) {
        console.error("[LETTER_CONFIG_FAILED]", error);
        return DEFAULT_APPROVAL_REQUIRED;
    }
}

export interface LetterDraftInput {
    employeeId?: string | null;
    type: string;
    recipientName: string;
    details?: string;
    /**
     * Stable identity for a version chain. When omitted a new chain is started.
     * Re-issue with the same key to add a version.
     */
    documentKey?: string;
    actor: { id: string; email: string; role: string };
}

export interface LetterResult {
    success: boolean;
    message: string;
    letterId?: string;
    version?: number;
    status?: string;
}

/** Creates a new letter, or the next version of an existing one. */
export async function createLetter(input: LetterDraftInput): Promise<LetterResult> {
    try {
        await requirePermission(PERMISSIONS.LETTER_GENERATE);

        const required = await approvalRequiredTypes();
        const needsApproval = required.includes(input.type.toUpperCase());
        const documentKey =
            input.documentKey ??
            `LTR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Determine the next version under this document key.
        const latest = await prisma.letterRecord.findFirst({
            where: { documentKey },
            orderBy: { version: "desc" },
            select: { id: true, version: true, status: true },
        });

        if (latest && latest.status === LETTER_STATUS.PENDING_APPROVAL) {
            return {
                success: false,
                message: `Version ${latest.version} of this document is still awaiting approval.`,
            };
        }

        const version = (latest?.version ?? 0) + 1;
        const status = needsApproval ? LETTER_STATUS.PENDING_APPROVAL : LETTER_STATUS.GENERATED;

        const letter = await prisma.$transaction(async (tx) => {
            const created = await tx.letterRecord.create({
                data: {
                    employeeId: input.employeeId ?? null,
                    type: input.type,
                    recipientName: input.recipientName,
                    details: input.details ?? null,
                    documentKey,
                    version,
                    status,
                    requiresApproval: needsApproval,
                    requestedById: input.actor.email,
                },
                select: { id: true, version: true, status: true, employeeId: true },
            });

            // Mark the previous version superseded. It is never deleted, so the
            // chain of what was issued and when remains complete.
            if (latest) {
                await tx.letterRecord.update({
                    where: { id: latest.id },
                    data: { supersededById: created.id },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: created.employeeId ?? "SYSTEM",
                    action: latest ? "LETTER_REVISED" : "LETTER_CREATED",
                    details:
                        `${input.type} "${input.recipientName}" ` +
                        `${latest ? `version ${version} (supersedes v${latest.version})` : "version 1"} ` +
                        `— ${status}`,
                    changedBy: input.actor.email,
                },
            });

            return created;
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: input.actor.email,
            actorRole: input.actor.role,
            target: `letterRecord:${letter.id}`,
            outcome: "SUCCESS",
            detail: { change: latest ? "letterRevised" : "letterCreated", version, status },
        });

        if (letter.employeeId) {
            await notifyInApp({
                employeeId: letter.employeeId,
                title: needsApproval ? "Letter awaiting approval" : "Letter ready",
                message: `Your ${input.type.toLowerCase().replace(/_/g, " ")} is ${
                    needsApproval ? "pending HR approval" : "available to download"
                }.`,
                type: "INFO",
                link: "/letters",
            });
        }

        return {
            success: true,
            message: needsApproval
                ? `Version ${version} created and sent for approval.`
                : `Version ${version} generated.`,
            letterId: letter.id,
            version: letter.version,
            status: letter.status,
        };
    } catch (error) {
        console.error("[CREATE_LETTER_FAILED]", error);
        return { success: false, message: "Could not create the letter." };
    }
}

export async function advanceLetter(params: {
    letterId: string;
    to: string;
    reason?: string;
    actor: { id: string; email: string; role: string };
}): Promise<LetterResult> {
    try {
        await requirePermission(PERMISSIONS.LETTER_APPROVE);

        const letter = await prisma.letterRecord.findUnique({
            where: { id: params.letterId },
            select: { id: true, status: true, employeeId: true, type: true, version: true },
        });
        if (!letter) return { success: false, message: "Letter not found." };

        try {
            assertTransition("LETTER", LETTER_TRANSITIONS, letter.status, params.to, {
                actorRole: params.actor.role,
                actorId: params.actor.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
            }
            throw error;
        }

        await prisma.$transaction(async (tx) => {
            const updated = await tx.letterRecord.updateMany({
                where: { id: params.letterId, status: letter.status },
                data: {
                    status: params.to,
                    ...(params.to === LETTER_STATUS.APPROVED
                        ? { approvedById: params.actor.email, approvedAt: new Date() }
                        : {}),
                    ...(params.to === LETTER_STATUS.REJECTED
                        ? { rejectedReason: params.reason ?? null }
                        : {}),
                    ...(params.to === LETTER_STATUS.VOID
                        ? { voidedAt: new Date(), voidReason: params.reason ?? null }
                        : {}),
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.auditLog.create({
                data: {
                    employeeId: letter.employeeId ?? "SYSTEM",
                    action: `LETTER_${params.to}`,
                    details:
                        `${letter.type} v${letter.version} ${letter.status} → ${params.to}` +
                        (params.reason ? ` — ${params.reason}` : ""),
                    changedBy: params.actor.email,
                },
            });
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: params.actor.email,
            actorRole: params.actor.role,
            target: `letterRecord:${params.letterId}`,
            outcome: "SUCCESS",
            detail: { change: "letterStatus", from: letter.status, to: params.to },
        });

        if (letter.employeeId) {
            await notifyInApp({
                employeeId: letter.employeeId,
                title: `Letter ${params.to.toLowerCase()}`,
                message: `Your ${letter.type.toLowerCase().replace(/_/g, " ")} was ${params.to.toLowerCase()}.`,
                type: params.to === LETTER_STATUS.REJECTED ? "WARNING" : "SUCCESS",
                link: "/letters",
            });
        }

        return { success: true, message: `Letter ${params.to.toLowerCase()}.`, status: params.to };
    } catch (error) {
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "This letter changed a moment ago. Reload and try again." };
        }
        console.error("[ADVANCE_LETTER_FAILED]", error);
        return { success: false, message: "Could not update the letter." };
    }
}

/**
 * Full history for a document, newest first. Every version is returned,
 * including superseded and voided ones.
 */
export async function getLetterHistory(documentKey: string) {
    await requirePermission(PERMISSIONS.LETTER_VIEW);
    return prisma.letterRecord.findMany({
        where: { documentKey },
        orderBy: { version: "desc" },
        select: {
            id: true,
            version: true,
            status: true,
            type: true,
            recipientName: true,
            generatedAt: true,
            approvedAt: true,
            approvedById: true,
            rejectedReason: true,
            voidedAt: true,
            voidReason: true,
            supersededById: true,
        },
    });
}

/**
 * Bulk generation (P1.5).
 *
 * Per-employee outcome is tracked: one failure never hides the others, and the
 * caller receives a full result list rather than a single success flag.
 */
export async function bulkGenerateLetters(params: {
    employeeIds: string[];
    type: string;
    reason?: string;
    actor: { id: string; email: string; role: string };
}): Promise<{
    success: boolean;
    message: string;
    total: number;
    succeeded: number;
    failed: number;
    results: { employeeId: string; name: string; ok: boolean; error?: string; letterId?: string; version?: number }[];
}> {
    let user;
    try {
        user = await requirePermission(PERMISSIONS.LETTER_GENERATE);
    } catch {
        return {
            success: false,
            message: "Insufficient permissions.",
            total: params.employeeIds.length,
            succeeded: 0,
            failed: params.employeeIds.length,
            results: [],
        };
    }

    if (params.employeeIds.length === 0) {
        return { success: false, message: "Select at least one employee.", total: 0, succeeded: 0, failed: 0, results: [] };
    }

    const employees = await prisma.employee.findMany({
        where: { id: { in: params.employeeIds } },
        select: { id: true, firstName: true, lastName: true },
    });

    const results: {
        employeeId: string;
        name: string;
        ok: boolean;
        error?: string;
        letterId?: string;
        version?: number;
    }[] = [];

    for (const employee of employees) {
        const outcome = await createLetter({
            employeeId: employee.id,
            type: params.type,
            recipientName: `${employee.firstName} ${employee.lastName}`,
            details: params.reason ?? undefined,
            actor: { id: user.id, email: user.email, role: user.role },
        });

        results.push({
            employeeId: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
            ok: outcome.success,
            error: outcome.success ? undefined : outcome.message,
            letterId: outcome.letterId,
            version: outcome.version,
        });
    }

    // Report employees that were requested but not found, so a bad id is not
    // silently dropped from the totals.
    const found = new Set(employees.map((e) => e.id));
    for (const id of params.employeeIds) {
        if (!found.has(id)) {
            results.push({ employeeId: id, name: "(not found)", ok: false, error: "Employee not found" });
        }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;

    return {
        success: succeeded > 0,
        message:
            failed === 0
                ? `${succeeded} letter(s) generated.`
                : `${succeeded} generated, ${failed} failed. See the per-employee results.`,
        total: results.length,
        succeeded,
        failed,
        results,
    };
}

export { DEFAULT_APPROVAL_REQUIRED };
