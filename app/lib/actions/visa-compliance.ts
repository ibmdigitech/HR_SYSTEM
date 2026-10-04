"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { notifyInApp } from "@/lib/workflow/notifications";

/**
 * Inline correction of a document expiry from the compliance directory.
 *
 * WHY THIS EXISTS
 *
 * The directory previously offered exactly one action — "Edit Profile" — which
 * navigated to the full four-tab employee form to change a single date. For the
 * common case (a passport expiry was recorded wrongly, or a renewed visa needs
 * its new date) that is a page load and a dozen fields to find one input, and
 * while there it is easy to disturb unrelated data.
 *
 * So the directory cell is editable in place. This action exists to back that.
 */

/**
 * Document type -> the two Employee columns it owns.
 *
 * A whitelist, not a dynamic key from the request. The type arrives from the
 * browser, so `prisma.employee.update({ data: { [type]: value } })` with an
 * attacker-controlled `type` would be a mass-assignment hole — any Employee
 * column could be written, `isActive` or `salaryStructure` included.
 *
 * Keep in step with TRACKED_DOCUMENTS in lib/workflow/compliance.ts, which
 * drives the scan and the directory header counts. An expiry column that is
 * editable here but absent there would appear in the table and never generate a
 * reminder.
 */
const EDITABLE_DOCUMENTS: Record<
    string,
    { expiryColumn: string; numberColumn: string | null; label: string }
> = {
    VISA: { expiryColumn: "visaExpiry", numberColumn: "visaNumber", label: "Residence visa" },
    PASSPORT: { expiryColumn: "passportExpiry", numberColumn: "passportNumber", label: "Passport" },
    EMIRATES_ID: { expiryColumn: "emiratesIdExpiry", numberColumn: "emiratesId", label: "Emirates ID" },
    RESIDENCE_PERMIT: {
        expiryColumn: "residencePermitExpiry",
        numberColumn: "residencePermitNumber",
        label: "Residence permit",
    },
    LABOUR_CARD: { expiryColumn: "labourCardExpiry", numberColumn: "labourCardNumber", label: "Labour card" },
    MEDICAL_INSURANCE: {
        expiryColumn: "medicalInsuranceExpiry",
        numberColumn: null,
        label: "Medical insurance",
    },
    ILOE_INSURANCE: { expiryColumn: "iloeInsuranceExpiry", numberColumn: null, label: "ILOE insurance" },
};

export async function updateDocumentExpiry(params: {
    employeeId: string;
    documentType: string;
    /** ISO `yyyy-mm-dd`, or empty string to clear the date. */
    expiry?: string | null;
    number?: string | null;
}): Promise<{ success: boolean; message: string }> {
    try {
        const actor = await requirePermission(PERMISSIONS.VISA_MANAGE);

        const doc = EDITABLE_DOCUMENTS[params.documentType];
        if (!doc) {
            return { success: false, message: "That document type cannot be edited here." };
        }

        const employee = await prisma.employee.findUnique({
            where: { id: params.employeeId },
            select: { id: true, firstName: true, lastName: true, email: true },
        });
        if (!employee) return { success: false, message: "Employee not found." };

        const data: Record<string, Date | string | null> = {};

        if (params.expiry !== undefined) {
            const trimmed = params.expiry?.trim() ?? "";
            if (trimmed === "") {
                // Clearing is a real edit, not a no-op: it removes the expiry so
                // the document stops counting as tracked.
                data[doc.expiryColumn] = null;
            } else {
                const parsed = new Date(trimmed);
                if (isNaN(parsed.getTime())) {
                    return { success: false, message: "That is not a valid date." };
                }
                data[doc.expiryColumn] = parsed;
            }
        }

        if (doc.numberColumn && params.number !== undefined) {
            const trimmed = params.number?.trim() ?? "";
            data[doc.numberColumn] = trimmed === "" ? null : trimmed;
        }

        if (Object.keys(data).length === 0) {
            return { success: false, message: "Nothing to update." };
        }

        await prisma.$transaction(async (tx) => {
            await tx.employee.update({ where: { id: params.employeeId }, data });

            await tx.auditLog.create({
                data: {
                    employeeId: params.employeeId,
                    action: "DOCUMENT_EXPIRY_EDITED",
                    details: `${doc.label} corrected via compliance directory by ${actor.email}`,
                    changedBy: actor.email,
                },
            });

            /**
             * Tell the employee their record moved, and — importantly — clear any
             * expiry reminder already raised for the OLD date. The reminder is
             * keyed on (employeeId, documentType, thresholdDays, expiryDate), so
             * correcting a date silently leaves the stale reminder in place and
             * the next scan re-raises one for the new date on top of it.
             */
            if (params.expiry !== undefined) {
                await tx.documentExpiryReminder.deleteMany({
                    where: {
                        employeeId: params.employeeId,
                        documentType: params.documentType,
                    },
                });
            }
        });

        await notifyInApp({
            employeeId: params.employeeId,
            title: `${doc.label} record updated`,
            message: `HR corrected your ${doc.label.toLowerCase()} details. Please check your profile if this looks wrong.`,
            type: "INFO",
            link: "/dashboard/visa",
        });

        revalidatePath("/visa");
        revalidatePath("/dashboard");
        revalidatePath("/dashboard/visa");

        return {
            success: true,
            message: `${doc.label} updated for ${employee.firstName} ${employee.lastName}.`,
        };
    } catch (error) {
        console.error("[UPDATE_DOCUMENT_EXPIRY_FAILED]", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Could not update the document.",
        };
    }
}