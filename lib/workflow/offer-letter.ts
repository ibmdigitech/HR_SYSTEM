/**
 * Offer letter generation (P1 §15, §38).
 *
 * The brief is explicit: "Integrate with the existing Letters module. Do NOT
 * create a second PDF engine." So this does not render anything. It writes a
 * `Letter` row — the same model the employee-letter flow uses — and the
 * existing `generateLetterPDF` renders it.
 *
 * That is only possible because `Letter.employeeId` was made optional: an offer
 * belongs to a CANDIDATE, who only becomes an Employee at joining (§19).
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { notifyInApp } from "@/lib/workflow/notifications";
import { OFFER_STATUS, OFFER_TRANSITIONS, assertTransition } from "@/lib/workflow/recruitment-machine";

/** Template key/id used for offer letters. Falls back to any OFFER template. */
async function resolveOfferTemplate(): Promise<string | null> {
    const explicit = await prisma.letterTemplate.findFirst({
        where: { type: "OFFER" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
    });
    if (explicit) return explicit.id;

    const anyTemplate = await prisma.letterTemplate.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
    });
    return anyTemplate?.id ?? null;
}

export async function issueOfferLetter(offerId: string): Promise<{
    success: boolean;
    message: string;
    letterId?: string;
}> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_OFFER);

        const offer = await prisma.offerLetter.findUnique({
            where: { id: offerId },
            select: {
                id: true,
                status: true,
                version: true,
                offeredSalary: true,
                allowances: true,
                designation: true,
                department: true,
                joiningDate: true,
                benefits: true,
                probationPeriodMonths: true,
                letterRecordId: true,
                candidate: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
                // The job is reached THROUGH the application, not directly:
                // an offer belongs to a candidate applying to a requisition.
                application: {
                    select: {
                        jobRequisition: {
                            select: { id: true, title: true, requisitionCode: true },
                        },
                    },
                },
            },
        });
        if (!offer) return { success: false, message: "Offer not found." };

        // A letter is only meaningful once the offer is APPROVED, and never
        // twice for the same version.
        if (offer.letterRecordId) {
            return { success: false, message: `Offer v${offer.version} already has a letter.` };
        }
        if (offer.status !== OFFER_STATUS.APPROVED) {
            return {
                success: false,
                message: `Approve the offer before issuing the letter. Current status: ${offer.status}.`,
            };
        }

        const templateId = await resolveOfferTemplate();
        if (!templateId) {
            return {
                success: false,
                message: "No letter template exists. Create one before issuing an offer letter.",
            };
        }

        const gross = offer.offeredSalary + (offer.allowances ?? 0);
        const candidateName = `${offer.candidate.firstName} ${offer.candidate.lastName}`;
        const requisition = offer.application?.jobRequisition;
        const referenceNumber = requisition?.requisitionCode ?? `OFFER-${new Date().getFullYear()}`;

        const content_en = [
            "Dear " + candidateName + ",",
            "",
            `We are pleased to offer you the position of ${offer.designation} in our ${offer.department} department.`,
            "",
            `Your starting date will be ${offer.joiningDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}.`,
            `Your gross monthly salary will be AED ${gross.toLocaleString("en-GB", { minimumFractionDigits: 2 })}.` +
                (offer.benefits ? ` You will additionally be entitled to ${offer.benefits}.` : ""),
            offer.probationPeriodMonths
                ? `You will be on probation for ${offer.probationPeriodMonths} month(s).`
                : "",
            "",
            "This offer is subject to verification of your documents and obtaining any required work permits.",
            "",
            "We look forward to welcoming you to the team.",
            "",
            "Human Resources",
        ]
            .filter((line) => line !== undefined)
            .join("\n");

        // Letter + offer link + audit are one unit.
        const letter = await prisma.$transaction(async (tx) => {
            const created = await tx.letter.create({
                data: {
                    // The subject is a candidate, not yet an employee.
                    candidateId: offer.candidate.id,
                    jobRequisitionId: requisition?.id ?? null,
                    templateId,
                    referenceNumber: `OFFER-${referenceNumber}-V${offer.version}`,
                    content_en,
                    status: "GENERATED",
                    approvedBy: user.email,
                    approvedAt: new Date(),
                },
                select: { id: true, referenceNumber: true },
            });

            await tx.offerLetter.update({
                where: { id: offerId },
                data: { letterRecordId: created.id, fileUrl: `/letters/${created.id}` },
            });

            await tx.auditLog.create({
                data: {
                    // NULL, not a sentinel and not the candidate's id: the
                    // subject of this event is a candidate who has not joined,
                    // and §19 creates the Employee at the joining stage. The
                    // rationale for a nullable `AuditLog.employeeId` — and the
                    // two rejected alternatives — is on `model AuditLog` in
                    // prisma/schema.prisma. Passing "SYSTEM" here violated the
                    // foreign key, and because this write is inside the same
                    // `$transaction` as the Letter and the offer link, that
                    // single row rolled the whole letter back and HR could
                    // never issue an offer letter at all.
                    employeeId: null,
                    action: "OFFER_LETTER_ISSUED",
                    details: `Offer v${offer.version} letter ${created.referenceNumber} for ${candidateName}`,
                    changedBy: user.email,
                },
            });

            return created;
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: `offer:${offerId}`,
            outcome: "SUCCESS",
            detail: { change: "offerLetterIssued", letterId: letter.id, version: offer.version },
        });

        return {
            success: true,
            message: `Offer letter ${letter.referenceNumber} issued via the existing letters engine.`,
            letterId: letter.id,
        };
    } catch (error) {
        console.error("[ISSUE_OFFER_LETTER_FAILED]", error);
        return { success: false, message: "Could not issue the offer letter." };
    }
}

export {
    OFFER_STATUS,
};
