/**
 * Employee onboarding (P1.1).
 *
 * The employee record itself is still created by `upsertEmployee` — this module
 * deliberately does NOT re-implement it. Onboarding adds the parts the audit
 * found missing (FLOW-004 … FLOW-009):
 *
 *   FLOW-004  configurable onboarding checklist
 *   FLOW-005  document requirements, tracked separately from "requirement created"
 *   FLOW-006  equipment / asset assignment
 *   FLOW-007  manager + department notification
 *   FLOW-008  first-login forced password change (already in credentials.ts)
 *   FLOW-009  one-time activation credential (already in credentials.ts)
 *
 * IDEMPOTENCY: checklist items carry a stable `category`, and
 * `@@unique([employeeId, category])` is enforced by a unique index created
 * separately. `ensureChecklist` therefore cannot produce duplicates even if the
 * employee record page is opened repeatedly.
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { notifyInApp } from "@/lib/workflow/notifications";
import {
    CHECKLIST_TRANSITIONS,
    CHECKLIST_STATUS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

/**
 * The default onboarding checklist.
 *
 * Configurable: pass `categories` to override. Nothing here is hardcoded into
 * the workflow — it is data, and the same shape can be seeded into a
 * configuration table later.
 */
export const DEFAULT_ONBOARDING_CHECKLIST: { category: string; label: string; required: boolean }[] = [
    { category: "EMPLOYMENT_CONTRACT", label: "Signed employment contract on file", required: true },
    { category: "OFFER_LETTER", label: "Signed offer letter", required: true },
    { category: "APPOINTMENT_LETTER", label: "Signed appointment letter", required: true },
    { category: "PASSPORT", label: "Passport copy collected", required: true },
    { category: "EMIRATES_ID", label: "Emirates ID collected", required: true },
    { category: "VISA", label: "Residence visa / work permit collected", required: true },
    { category: "RESIDENCE_PERMIT", label: "Residence permit collected", required: true },
    { category: "LABOUR_CARD", label: "Labour card collected", required: true },
    { category: "MEDICAL_INSURANCE", label: "Medical insurance card collected", required: true },
    { category: "ILOE_INSURANCE", label: "ILOE insurance card collected", required: false },
    { category: "BANK", label: "Bank / IBAN details confirmed", required: true },
    { category: "EMERGENCY_CONTACT", label: "Emergency contact recorded", required: false },
    { category: "POLICY_ACK", label: "Company policy acknowledged", required: true },
    { category: "EQUIPMENT", label: "Equipment issued", required: false },
    { category: "ACCESS", label: "System access provisioned", required: true },
];

export interface ChecklistProgress {
    total: number;
    completed: number;
    requiredOutstanding: number;
    percent: number;
    ready: boolean;
}

export async function ensureChecklist(
    employeeId: string,
    categories: { category: string; label: string; required: boolean }[] = DEFAULT_ONBOARDING_CHECKLIST
): Promise<{ created: number; skipped: number }> {
    const existing = await prisma.onboardingChecklistItem.findMany({
        where: { employeeId },
        select: { category: true },
    });
    const have = new Set(existing.map((r) => r.category));

    // Skip categories already present, so repeated calls add nothing.
    const toCreate = categories.filter((c) => !have.has(c.category));
    if (toCreate.length === 0) return { created: 0, skipped: categories.length };

    await prisma.onboardingChecklistItem.createMany({
        data: toCreate.map((c) => ({
            employeeId,
            category: c.category,
            label: c.label,
            required: c.required,
            status: CHECKLIST_STATUS.PENDING,
        })),
    });

    return { created: toCreate.length, skipped: categories.length - toCreate.length };
}

export async function getChecklistProgress(employeeId: string): Promise<ChecklistProgress> {
    const items = await prisma.onboardingChecklistItem.findMany({
        where: { employeeId },
        select: { required: true, status: true },
    });

    const resolved = (s: string) => s === CHECKLIST_STATUS.COMPLETED || s === CHECKLIST_STATUS.WAIVED;
    const completed = items.filter((i) => resolved(i.status)).length;
    const requiredOutstanding = items.filter((i) => i.required && !resolved(i.status)).length;

    return {
        total: items.length,
        completed,
        requiredOutstanding,
        percent: items.length === 0 ? 0 : Math.round((completed / items.length) * 100),
        ready: requiredOutstanding === 0 && items.length > 0,
    };
}

/**
 * Advances a checklist item.
 *
 * `COMPLETED` requires a document reference when the category is a document
 * type. This is FLOW-005's core rule: a requirement is not evidence, so a
 * document cannot be considered received until something is attached.
 */
const DOCUMENT_CATEGORIES = new Set([
    "PASSPORT",
    "EMIRATES_ID",
    "VISA",
    "MEDICAL_INSURANCE",
    "ILOE_INSURANCE",
    "OFFER_LETTER",
    "APPOINTMENT_LETTER",
]);

export async function updateChecklistItem(params: {
    itemId: string;
    to: string;
    documentRef?: string | null;
    notes?: string | null;
    actor: { id: string; email: string; role: string };
}): Promise<{ success: boolean; message: string }> {
    let actorEmail = "unknown";
    try {
        const user = await requirePermission(PERMISSIONS.EMPLOYEES_EDIT);
        actorEmail = user.email;

        const item = await prisma.onboardingChecklistItem.findUnique({
            where: { id: params.itemId },
            select: { id: true, status: true, employeeId: true, category: true, label: true },
        });
        if (!item) return { success: false, message: "Checklist item not found." };

        try {
            assertTransition("CHECKLIST", CHECKLIST_TRANSITIONS, item.status, params.to, {
                actorRole: user.role,
                actorId: user.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Not permitted: ${error.message}` };
            }
            throw error;
        }

        // A document requirement cannot be completed without a reference.
        if (
            params.to === CHECKLIST_STATUS.COMPLETED &&
            DOCUMENT_CATEGORIES.has(item.category) &&
            !params.documentRef?.trim()
        ) {
            return {
                success: false,
                message: "Attach a document reference before marking this complete.",
            };
        }

        const updated = await prisma.$transaction(async (tx) => {
            const result = await tx.onboardingChecklistItem.updateMany({
                where: { id: params.itemId, status: item.status },
                data: {
                    status: params.to,
                    documentRef: params.documentRef ?? null,
                    notes: params.notes ?? null,
                    ...(params.to === CHECKLIST_STATUS.COMPLETED
                        ? { verifiedBy: user.email, verifiedAt: new Date() }
                        : {}),
                },
            });
            if (result.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.auditLog.create({
                data: {
                    employeeId: item.employeeId,
                    action: `ONBOARDING_ITEM_${params.to}`,
                    details: `"${item.label}": ${item.status} → ${params.to}` +
                        (params.documentRef ? ` (document: ${params.documentRef})` : ""),
                    changedBy: user.email,
                },
            });

            return true;
        });

        return { success: true, message: `${item.label} marked ${params.to.toLowerCase()}.` };
    } catch (error) {
        if (error instanceof Error && error.message === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "That item changed a moment ago. Reload and try again." };
        }
        console.error("[ONBOARDING_CHECKLIST_UPDATE_FAILED]", error);
        return { success: false, message: "Could not update the checklist item." };
    }
}

/** Assigns company property to the new hire (FLOW-006). */
export async function assignAssets(params: {
    employeeId: string;
    assetIds: string[];
    actor: { id: string; email: string; role: string };
}): Promise<{ success: boolean; message: string; assigned: number }> {
    try {
        const user = await requirePermission(PERMISSIONS.EMPLOYEES_EDIT);
        if (params.assetIds.length === 0) return { success: true, message: "No assets selected.", assigned: 0 };

        const assets = await prisma.asset.findMany({
            where: { id: { in: params.assetIds } },
            select: { id: true, assetTag: true, name: true, status: true, condition: true },
        });

        // Only property that is actually free may be assigned.
        const unavailable = assets.filter((a) => a.status !== "AVAILABLE");
        if (unavailable.length > 0) {
            return {
                success: false,
                message: `Not available: ${unavailable.map((a) => a.assetTag).join(", ")}`,
                assigned: 0,
            };
        }

        const assigned = await prisma.$transaction(async (tx) => {
            for (const asset of assets) {
                await tx.assetAssignment.create({
                    data: {
                        assetId: asset.id,
                        employeeId: params.employeeId,
                        assignedBy: user.email,
                        condition: asset.condition,
                    },
                });
                await tx.asset.update({
                    where: { id: asset.id },
                    data: { status: "ASSIGNED" },
                });
            }

            await tx.onboardingChecklistItem.updateMany({
                where: { employeeId: params.employeeId, category: "EQUIPMENT" },
                data: { status: CHECKLIST_STATUS.COMPLETED, verifiedBy: user.email, verifiedAt: new Date() },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: params.employeeId,
                    action: "ASSETS_ASSIGNED",
                    details: `Assigned ${assets.length} item(s): ${assets.map((a) => a.assetTag).join(", ")}`,
                    changedBy: user.email,
                },
            });

            return assets.length;
        });

        return { success: true, message: `${assigned} item(s) assigned.`, assigned };
    } catch (error) {
        console.error("[ASSIGN_ASSETS_FAILED]", error);
        return { success: false, message: "Could not assign the assets.", assigned: 0 };
    }
}

/**
 * Notifies the manager that their new report has started (FLOW-007).
 * Called after the employee record exists; never blocks onboarding.
 */
export async function notifyManagerOfNewHire(params: {
    employeeId: string;
    actorEmail: string;
}): Promise<void> {
    try {
        const employee = await prisma.employee.findUnique({
            where: { id: params.employeeId },
            select: { firstName: true, lastName: true, managerId: true, department: true },
        });
        if (!employee?.managerId) return;

        await notifyInApp({
            employeeId: employee.managerId,
            title: "New team member",
            message: `${employee.firstName} ${employee.lastName} has joined ${employee.department ?? "the team"}.`,
            type: "INFO",
            link: "/staff-services",
            templateKey: "employee_onboarded",
        });
    } catch (error) {
        // A missed notification must never fail the onboarding.
        console.error("[NOTIFY_MANAGER_FAILED]", error);
    }
}

/**
 * Records that a document scan has been RECEIVED for a checklist item, WITHOUT
 * marking it verified.
 *
 * WHY THIS EXISTS — the difference between "received" and "verified"
 *
 * An earlier implementation treated an upload as the finish line: the document
 * landed and the checklist item went straight to COMPLETED. That made the
 * `verifiedBy` / `verifiedAt` columns decorative, because the only way to reach
 * COMPLETED was a system action that had verified nothing. A forged or
 * illegible scan and a genuine one were indistinguishable downstream.
 *
 * So an upload moves the item to IN_PROGRESS and records what arrived. A human
 * with `employees.edit` still has to look at the scan and call
 * `updateChecklistItem(..., to: COMPLETED)`, which is what writes `verifiedBy`
 * / `verifiedAt` and the audit row.
 *
 * Idempotent: re-uploading keeps the item at IN_PROGRESS and clears any stale
 * verification, because a NEW scan is a NEW claim that has not been checked.
 * Leaving the previous `verifiedBy` in place would let an unverified
 * replacement inherit the earlier sign-off.
 */
export async function recordDocumentReceived(params: {
    employeeId: string;
    /** Checklist category, e.g. PASSPORT / EMIRATES_ID / VISA. */
    category: string;
    /** Human-readable reference stored on the item, usually the file name. */
    documentRef: string;
    /** Creates the item when the checklist has not been seeded yet. */
    label?: string;
    required?: boolean;
}): Promise<{ linked: boolean; reason?: string }> {
    try {
        const item = await prisma.onboardingChecklistItem.findFirst({
            where: { employeeId: params.employeeId, category: params.category },
            select: { id: true, status: true, verifiedAt: true },
        });

        if (!item) {
            // The checklist has not been seeded for this employee. Create the
            // single item this upload satisfies, rather than the whole default
            // list — the rest is `ensureChecklist`'s job and inventing it here
            // would create rows nobody asked for.
            await prisma.onboardingChecklistItem.create({
                data: {
                    employeeId: params.employeeId,
                    category: params.category,
                    label: params.label ?? `${params.category.replace(/_/g, " ").toLowerCase()} document`,
                    required: params.required ?? true,
                    status: CHECKLIST_STATUS.IN_PROGRESS,
                    documentRef: params.documentRef,
                },
            });
            return { linked: true };
        }

        if (item.status === CHECKLIST_STATUS.COMPLETED) {
            // A verified document is being replaced. The item returns to
            // IN_PROGRESS and its verification is cleared, so the new scan must
            // be checked again rather than inheriting the old sign-off.
            await prisma.onboardingChecklistItem.update({
                where: { id: item.id },
                data: {
                    status: CHECKLIST_STATUS.IN_PROGRESS,
                    documentRef: params.documentRef,
                    verifiedBy: null,
                    verifiedAt: null,
                    notes: null,
                },
            });
            return { linked: true, reason: "REVERIFICATION_REQUIRED" };
        }

        await prisma.onboardingChecklistItem.update({
            where: { id: item.id },
            data: {
                status: CHECKLIST_STATUS.IN_PROGRESS,
                documentRef: params.documentRef,
            },
        });
        return { linked: true };
    } catch (error) {
        // A failed link must not undo the employee save that produced the file.
        console.error("[RECORD_DOCUMENT_RECEIVED_FAILED]", error);
        return { linked: false, reason: "LINK_FAILED" };
    }
}

/** Everything HR needs to see before completing onboarding. */
export async function getOnboardingSummary(employeeId: string) {
    await requirePermission(PERMISSIONS.EMPLOYEES_VIEW);

    const [items, progress, assets, employee] = await Promise.all([
        prisma.onboardingChecklistItem.findMany({
            where: { employeeId },
            orderBy: [{ required: "desc" }, { category: "asc" }],
        }),
        getChecklistProgress(employeeId),
        prisma.asset.findMany({
            where: { status: "AVAILABLE" },
            select: { id: true, assetTag: true, name: true, category: true },
            orderBy: { assetTag: "asc" },
        }),
        prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true },
        }),
    ]);

    return { items, progress, availableAssets: assets, employee };
}

export { CHECKLIST_STATUS };
