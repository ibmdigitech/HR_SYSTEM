/**
 * Document expiry reminders and renewals (P1.6).
 *
 * The audit found visa tracking worked but produced no automated alerts —
 * statutory documents could expire with nobody notified.
 *
 * IDEMPOTENCY IS A DATABASE CONSTRAINT, not an application check. Each reminder
 * is one row of `DocumentExpiryReminder` with a unique key on
 * (employeeId, documentType, thresholdDays, expiryDate). A second run for the
 * same window cannot insert a duplicate, so the cron can run as often as it
 * likes without spamming anybody — even if two instances run concurrently,
 * which a findFirst-then-create check would not prevent.
 *
 * Reminder windows are configurable through `ServiceConfig` (module `visa`,
 * key `expiry_reminder_days`) with a documented default, rather than being
 * hardcoded here.
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { notifyInApp } from "@/lib/workflow/notifications";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import {
    RENEWAL_STATUS,
    RENEWAL_TRANSITIONS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

/** Document types tracked, mapped to the Employee column that holds the date. */
const TRACKED_DOCUMENTS = [
    { type: "VISA", column: "visaExpiry", label: "Residence visa" },
    { type: "PASSPORT", column: "passportExpiry", label: "Passport" },
    { type: "EMIRATES_ID", column: "emiratesIdExpiry", label: "Emirates ID" },
    { type: "MEDICAL_INSURANCE", column: "medicalInsuranceExpiry", label: "Medical insurance" },
    { type: "ILOE_INSURANCE", column: "iloeInsuranceExpiry", label: "ILOE insurance" },
] as const;

type DocumentType = (typeof TRACKED_DOCUMENTS)[number]["type"];

/** Documented defaults, used when no ServiceConfig override exists. */
const DEFAULT_THRESHOLDS = [90, 60, 30, 14, 7];

export interface ExpiryCandidate {
    employeeId: string;
    employeeName: string;
    department: string | null;
    documentType: DocumentType;
    documentLabel: string;
    expiryDate: Date;
    daysRemaining: number;
    thresholdDays: number;
    status: "EXPIRING" | "EXPIRED";
}

export interface ExpiryScanResult {
    thresholds: number[];
    scanned: number;
    candidates: ExpiryCandidate[];
    remindersCreated: number;
    remindersSkipped: number;
    notificationsSent: number;
    errors: number;
}

/** Thresholds from configuration, falling back to the documented default. */
async function resolveThresholds(): Promise<number[]> {
    try {
        const config = await prisma.serviceConfig.findFirst({
            where: { module: "visa", key: "expiry_reminder_days" },
            select: { value: true },
        });
        if (!config?.value) return DEFAULT_THRESHOLDS;

        const parsed = config.value
            .split(",")
            .map((v) => Number.parseInt(v.trim(), 10))
            .filter((n) => Number.isFinite(n) && n > 0);

        return parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => b - a) : DEFAULT_THRESHOLDS;
    } catch (error) {
        console.error("[EXPIRY_CONFIG_FAILED]", error);
        return DEFAULT_THRESHOLDS;
    }
}

/**
 * The reminder window a document has actually reached.
 *
 * A document 45 days out satisfies `days <= 90` AND `days <= 60`, but not
 * `<= 30`. Its 90-day reminder fired 45 days ago, so the reminder due now is
 * the 60-day one — the SMALLEST window it has entered.
 *
 * Taking the first match on a descending array would wrongly return 90 and
 * fire every reminder early. This was a real bug, caught by the P1 tests.
 *
 * Returns undefined when the document is outside every window.
 */
export function selectReminderThreshold(
    thresholds: readonly number[],
    daysRemaining: number
): number | undefined {
    let smallest: number | undefined;
    for (const t of thresholds) {
        if (daysRemaining > t) continue;
        if (smallest === undefined || t < smallest) smallest = t;
    }
    return smallest;
}

/**
 * Scans for expiring documents and creates reminders.
 *
 * Safe to run repeatedly: reminders are deduplicated by the database.
 */
export async function scanExpiringDocuments(options?: {
    reference?: Date;
    actor?: { email: string; role: string };
}): Promise<ExpiryScanResult> {
    const reference = options?.reference ?? new Date();
    const thresholds = await resolveThresholds();
    const actorEmail = options?.actor?.email ?? "system";

    // Widest threshold bounds the query; narrower windows are selected after.
    const widest = Math.max(...thresholds);
    const horizon = new Date(reference.getTime() + widest * 24 * 60 * 60 * 1000);
    // Include already-expired documents, which are the most urgent of all.
    const pastLimit = new Date(reference.getTime() - 365 * 24 * 60 * 60 * 1000);

    const employees = await prisma.employee.findMany({
        where: {
            currentStatus: { in: ["ACTIVE", "ON_LEAVE"] },
        },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            department: true,
            visaExpiry: true,
            passportExpiry: true,
            emiratesIdExpiry: true,
            medicalInsuranceExpiry: true,
            iloeInsuranceExpiry: true,
        },
    });

    const candidates: ExpiryCandidate[] = [];
    let remindersCreated = 0;
    let remindersSkipped = 0;
    let notificationsSent = 0;
    let errors = 0;

    for (const employee of employees) {
        for (const doc of TRACKED_DOCUMENTS) {
            const raw = employee[doc.column];
            if (!raw) continue;

            const expiryDate = new Date(raw);
            if (isNaN(expiryDate.getTime())) continue;
            if (expiryDate > horizon || expiryDate < pastLimit) continue;

            const daysRemaining = Math.ceil(
                (expiryDate.getTime() - reference.getTime()) / (24 * 60 * 60 * 1000)
            );

            // Smallest window actually reached — see selectReminderThreshold.
            const reached = selectReminderThreshold(thresholds, daysRemaining);
            if (reached === undefined) continue;

            const candidate: ExpiryCandidate = {
                employeeId: employee.id,
                employeeName: `${employee.firstName} ${employee.lastName}`,
                department: employee.department,
                documentType: doc.type,
                documentLabel: doc.label,
                expiryDate,
                daysRemaining,
                thresholdDays: reached,
                status: daysRemaining < 0 ? "EXPIRED" : "EXPIRING",
            };
            candidates.push(candidate);

            // --- Idempotent reminder creation ---------------------------
            try {
                const existing = await prisma.documentExpiryReminder.findUnique({
                    where: {
                        employeeId_documentType_thresholdDays_expiryDate: {
                            employeeId: employee.id,
                            documentType: doc.type,
                            thresholdDays: reached,
                            expiryDate,
                        },
                    },
                    select: { id: true },
                });

                if (existing) {
                    remindersSkipped++;
                    continue;
                }

                const reminder = await prisma.documentExpiryReminder.create({
                    data: {
                        employeeId: employee.id,
                        documentType: doc.type,
                        thresholdDays: reached,
                        expiryDate,
                        recipientRole: "HR",
                    },
                    select: { id: true },
                });
                remindersCreated++;

                // The in-app notification is separate from the reminder row and
                // cannot fail the scan.
                await notifyInApp({
                    employeeId: employee.id,
                    title:
                        candidate.status === "EXPIRED"
                            ? `${doc.label} EXPIRED`
                            : `${doc.label} expires in ${daysRemaining} day(s)`,
                    message:
                        candidate.status === "EXPIRED"
                            ? `Your ${doc.label.toLowerCase()} expired on ${expiryDate.toDateString()}. Contact HR immediately.`
                            : `Your ${doc.label.toLowerCase()} expires on ${expiryDate.toDateString()}. Start the renewal process early.`,
                    type: candidate.status === "EXPIRED" ? "ALERT" : "WARNING",
                    link: "/visa",
                    templateKey: `document_expiry_${doc.type.toLowerCase()}`,
                });
                notificationsSent++;

                await logSecurityEvent({
                    action: SECURITY_ACTION.ACCESS_DENIED,
                    actorEmail,
                    target: `reminder:${reminder.id}`,
                    outcome: "SUCCESS",
                    detail: {
                        change: "expiryReminderCreated",
                        documentType: doc.type,
                        daysRemaining,
                    },
                });
            } catch (error) {
                // A unique-constraint race is expected under concurrent runs and
                // is not a failure: the other process created the reminder.
                const message = error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "";
                if (message.includes("Unique constraint")) {
                    remindersSkipped++;
                } else {
                    errors++;
                    console.error("[EXPIRY_REMINDER_FAILED]", error);
                }
            }
        }
    }

    return {
        thresholds,
        scanned: employees.length,
        candidates,
        remindersCreated,
        remindersSkipped,
        notificationsSent,
        errors,
    };
}

/** Documents needing action, for the HR dashboard. */
export async function getExpiringDocuments(withinDays = 90) {
    await requirePermission(PERMISSIONS.VISA_VIEW);

    const horizon = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    const pastLimit = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const employees = await prisma.employee.findMany({
        where: { currentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            department: true,
            visaExpiry: true,
            passportExpiry: true,
            emiratesIdExpiry: true,
            medicalInsuranceExpiry: true,
            iloeInsuranceExpiry: true,
        },
    });

    const rows: ExpiryCandidate[] = [];
    for (const employee of employees) {
        for (const doc of TRACKED_DOCUMENTS) {
            const raw = employee[doc.column];
            if (!raw) continue;
            const expiryDate = new Date(raw);
            if (isNaN(expiryDate.getTime())) continue;
            if (expiryDate > horizon || expiryDate < pastLimit) continue;

            const daysRemaining = Math.ceil(
                (expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
            );
            rows.push({
                employeeId: employee.id,
                employeeName: `${employee.firstName} ${employee.lastName}`,
                department: employee.department,
                documentType: doc.type,
                documentLabel: doc.label,
                expiryDate,
                daysRemaining,
                thresholdDays: Math.max(0, daysRemaining),
                status: daysRemaining < 0 ? "EXPIRED" : "EXPIRING",
            });
        }
    }

    return rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/** Opens a renewal case. Previous document history is never touched. */
export async function requestRenewal(params: {
    employeeId: string;
    documentType: DocumentType;
    actor: { id: string; email: string; role: string };
}): Promise<{ success: boolean; message: string; renewalId?: string }> {
    try {
        await requirePermission(PERMISSIONS.VISA_VIEW);

        const employee = await prisma.employee.findUnique({
            where: { id: params.employeeId },
            select: { id: true, firstName: true, lastName: true },
        });
        if (!employee) return { success: false, message: "Employee not found." };

        const doc = TRACKED_DOCUMENTS.find((d) => d.type === params.documentType);
        if (!doc) return { success: false, message: "Unknown document type." };

        // The expiry columns are DateTime?, but Prisma types the dynamic key
        // access as a union including string. Read it safely rather than
        // asserting.
        const currentValue = employee[doc.column as keyof typeof employee] as unknown;
        const currentExpiry =
            currentValue instanceof Date ? currentValue : null;
        if (!currentExpiry) {
            return { success: false, message: `No ${doc.label.toLowerCase()} expiry is recorded for this employee.` };
        }

        const open = await prisma.documentRenewal.findFirst({
            where: {
                employeeId: params.employeeId,
                documentType: params.documentType,
                status: {
                    in: [
                        RENEWAL_STATUS.REQUESTED,
                        RENEWAL_STATUS.DOCUMENT_SUBMITTED,
                        RENEWAL_STATUS.UNDER_REVIEW,
                    ],
                },
            },
            select: { id: true },
        });
        if (open) {
            return { success: false, message: "A renewal is already open for this document." };
        }

        const renewal = await prisma.$transaction(async (tx) => {
            const created = await tx.documentRenewal.create({
                data: {
                    employeeId: params.employeeId,
                    documentType: params.documentType,
                    currentExpiry,
                    status: RENEWAL_STATUS.REQUESTED,
                    createdBy: params.actor.email,
                },
                select: { id: true },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: params.employeeId,
                    action: "VISA_RENEWAL_REQUESTED",
                    details: `${doc.label} renewal requested, current expiry ${currentExpiry.toDateString()}`,
                    changedBy: params.actor.email,
                },
            });

            return created;
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: params.actor.email,
            actorRole: params.actor.role,
            target: `documentRenewal:${renewal.id}`,
            outcome: "SUCCESS",
            detail: { change: "renewalRequested", documentType: params.documentType },
        });

        return { success: true, message: `${doc.label} renewal requested.`, renewalId: renewal.id };
    } catch (error) {
        console.error("[REQUEST_RENEWAL_FAILED]", error);
        return { success: false, message: "Could not open the renewal request." };
    }
}

/**
 * Advances a renewal and, on RENEWED, writes the new expiry back to the
 * Employee. The previous expiry is preserved in `DocumentRenewal.currentExpiry`,
 * so history is not lost.
 */
export async function advanceRenewal(params: {
    renewalId: string;
    to: string;
    newExpiry?: Date;
    notes?: string;
    actor: { id: string; email: string; role: string };
}): Promise<{ success: boolean; message: string }> {
    try {
        await requirePermission(PERMISSIONS.VISA_MANAGE);

        const renewal = await prisma.documentRenewal.findUnique({
            where: { id: params.renewalId },
            select: { id: true, status: true, employeeId: true, documentType: true },
        });
        if (!renewal) return { success: false, message: "Renewal not found." };

        try {
            assertTransition("RENEWAL", RENEWAL_TRANSITIONS, renewal.status, params.to, {
                actorRole: params.actor.role,
                actorId: params.actor.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
            }
            throw error;
        }

        if (params.to === RENEWAL_STATUS.RENEWED && !params.newExpiry) {
            return { success: false, message: "A new expiry date is required to mark a document renewed." };
        }

        const doc = TRACKED_DOCUMENTS.find((d) => d.type === renewal.documentType);

        await prisma.$transaction(async (tx) => {
            const updated = await tx.documentRenewal.updateMany({
                where: { id: params.renewalId, status: renewal.status },
                data: {
                    status: params.to,
                    newExpiry: params.newExpiry ?? null,
                    notes: params.notes ?? null,
                    ...(params.to === RENEWAL_STATUS.RENEWED ||
                    params.to === RENEWAL_STATUS.REJECTED
                        ? { reviewedBy: params.actor.email, reviewedAt: new Date() }
                        : {}),
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            if (params.to === RENEWAL_STATUS.RENEWED && params.newExpiry && doc) {
                await tx.employee.update({
                    where: { id: renewal.employeeId },
                    data: { [doc.column]: params.newExpiry },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: renewal.employeeId,
                    action: `DOCUMENT_RENEWAL_${params.to}`,
                    details:
                        `${doc?.label ?? renewal.documentType} renewal ${renewal.status} → ${params.to}` +
                        (params.newExpiry ? `, new expiry ${params.newExpiry.toDateString()}` : ""),
                    changedBy: params.actor.email,
                },
            });
        });

        return { success: true, message: `Renewal ${params.to.toLowerCase().replace(/_/g, " ")}.` };
    } catch (error) {
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "This renewal changed a moment ago. Reload and try again." };
        }
        console.error("[ADVANCE_RENEWAL_FAILED]", error);
        return { success: false, message: "Could not update the renewal." };
    }
}

export { TRACKED_DOCUMENTS };
export type { DocumentType };
