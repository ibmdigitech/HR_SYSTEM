"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Prisma } from "../../../prisma/generated/client";
import { requirePermission, AuthorizationError } from "@/lib/auth/guards";
import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { ROLES } from "@/lib/auth/roles";
import { recordDocumentReceived } from "@/lib/workflow/onboarding";

/**
 * WHO GETS TOLD ABOUT A CHANGE REQUEST
 *
 * `Notification.employeeId` is NOT NULL and is a foreign key to `Employee`, and
 * the notification centre reads exactly
 *   prisma.notification.findMany({ where: { employeeId: user.employee.id } })
 * (app/notifications/page.tsx:19-20). There is therefore no way to address a
 * notification to a *user* — it can only ever land in an employee's feed.
 *
 * So a notification for "an HR/manager should review this" has to be written
 * once per approver who actually has an Employee row, because an approver
 * without one has no notification centre to receive it into. Rather than
 * addressing a single guessed recipient, every account holding a permission
 * that can approve is notified.
 *
 * The alternative — leaving the submitter to guess who reviews it — is exactly
 * the "request disappeared" failure this closes.
 */
async function notifyApproversOfChangeRequest(params: {
    employeeId: string;
    employeeName: string;
    requestedBy: string;
    documentCount: number;
    changedFields: string[];
}): Promise<void> {
    try {
        const approverRoles = [ROLES.HR, ROLES.ADMIN, ROLES.SUPER_ADMIN];
        const approvers = await prisma.user.findMany({
            where: {
                role: { in: approverRoles },
                employee: { isNot: null },
            },
            select: { email: true, employee: { select: { id: true } } },
        });

        if (approvers.length === 0) return;

        // Names in the title so the notification is meaningful in a list view
        // without opening it.
        const title = `Employee data change awaiting approval`;
        const fieldList = params.changedFields.slice(0, 6).join(", ");
        const more = params.changedFields.length > 6 ? ` +${params.changedFields.length - 6} more` : "";
        const message =
            `${params.employeeName} — requested by ${params.requestedBy}. ` +
            `${params.changedFields.length} field(s) changed: ${fieldList}${more}. ` +
            (params.documentCount > 0
                ? `${params.documentCount} supporting document(s) attached.`
                : "No supporting documents attached.");

        await prisma.notification.createMany({
            data: approvers
                .filter((a): a is typeof a & { employee: { id: string } } => a.employee !== null)
                .map((a) => ({
                    employeeId: a.employee.id,
                    title,
                    message,
                    type: "ALERT",
                    link: "/dashboard/approvals",
                })),
        });
    } catch (error) {
        // A missed notification must never fail the submission. The request is
        // already recorded and still shows in the approvals queue.
        console.error("[CHANGE_REQUEST_NOTIFY_FAILED]", error);
    }
}

/** Tells the record's own management chain that the record moved. */
async function notifyManagerOfUpdate(params: {
    managerId: string | null;
    employeeName: string;
    actorEmail: string;
    isPartial: boolean;
}): Promise<void> {
    if (!params.managerId) return;
    try {
        const manager = await prisma.employee.findUnique({
            where: { id: params.managerId },
            select: { firstName: true, lastName: true, managerId: true },
        });
        if (!manager?.managerId) return;

        await prisma.notification.create({
            data: {
                employeeId: manager.managerId,
                title: `${params.employeeName} — profile ${params.isPartial ? "section saved" : "updated"}`,
                message: `${params.employeeName}'s record was ${params.isPartial ? "partially updated (section save)" : "updated"} by ${params.actorEmail}.`,
                type: "INFO",
                link: "/employees",
            },
        });
    } catch (error) {
        console.error("[EMPLOYEE_UPDATE_NOTIFY_MANAGER_FAILED]", error);
    }
}

/**
 * Change-request document type -> the onboarding checklist category that
 * carries its verification.
 *
 * Deliberately NOT symmetric with the Attachment categories: `BANK_IBAN` is
 * stored as an attachment category but the checklist requirement is `BANK`
 * (app/lib/workflow/onboarding.ts DEFAULT_ONBOARDING_CHECKLIST). Matching the
 * two wrongly would make every bank document look permanently unverified.
 * `null` means the type has no checklist counterpart and so cannot gate
 * approval — supporting evidence, not a verifiable onboarding requirement.
 */
const DOC_TYPE_TO_CHECKLIST: Record<string, string | null> = {
    PASSPORT: "PASSPORT",
    EMIRATES_ID: "EMIRATES_ID",
    VISA: "VISA",
    RESIDENCE_PERMIT: "RESIDENCE_PERMIT",
    LABOUR_CARD: "LABOUR_CARD",
    BANK_IBAN: "BANK",
    MEDICAL_INSURANCE: "MEDICAL_INSURANCE",
    ILOE_INSURANCE: "ILOE_INSURANCE",
    ADDRESS_PROOF: null,
    EMPLOYMENT_CONTRACT: "EMPLOYMENT_CONTRACT",
};

/** Categories whose verification gates approval. */
const CHECKLIST_BACKED = new Set(
    Object.values(DOC_TYPE_TO_CHECKLIST).filter((c): c is string => c !== null)
);

/**
 * THE RE-VERIFICATION TRAP
 *
 * Without this, an employee who legitimately completed onboarding years ago
 * still has `OnboardingChecklistItem.status === COMPLETED` on their passport.
 * Submitting a change request with a brand-new passport scan would then find a
 * COMPLETED item and be approved immediately — the approval gate would be
 * satisfied by a verification of a DIFFERENT, OLDER document.
 *
 * So an upload on a change request must reset the item to IN_PROGRESS and clear
 * `verifiedBy` / `verifiedAt`. The new scan is a new claim and has to be looked
 * at. This runs for every document on the request, before the approver sees it.
 */
async function armVerificationForRequest(params: {
    employeeId: string;
    documents: { documentType: string; documentUrl: string }[];
    requestId: string;
}): Promise<void> {
    for (const doc of params.documents) {
        const checklistCategory = DOC_TYPE_TO_CHECKLIST[doc.documentType];
        if (!checklistCategory) continue;
        try {
            await recordDocumentReceived({
                employeeId: params.employeeId,
                category: checklistCategory,
                // Traceable back to the request the scan arrived on, so the
                // verifier knows which submission they are checking.
                documentRef: `change-request:${params.requestId}:${doc.documentType}`,
            });
        } catch (error) {
            console.error("[CHANGE_REQUEST_ARM_VERIFICATION_FAILED]", doc.documentType, error);
        }
    }
}

export async function submitChangeRequest(data: {
  employeeId: string;
  changes: Record<string, any>;
  documents: { documentType: string; documentUrl: string }[];
}) {
  try {
    const user = await requirePermission(PERMISSIONS.EMPLOYEES_VIEW);

    // Keys that carry no meaning in an approval diff: routing, save-mode flags
    // and the upload plumbing. Sending them would show an approver a wall of
    // unchanged noise and make the diff unreadable.
    const INTERNAL_KEYS = new Set([
      "id",
      "partial",
      "provision",
      "changeRequestDocument",
      "passportDocDraft",
      "emiratesDocDraft",
      "visaDocDraft",
      "addressDocDraft",
      "ibanDocDraft",
      "medicalDocDraft",
      "iloeDocDraft",
      "labourDocDraft",
      "residenceDocDraft",
      "contractDocDraft",
    ]);

    const cleanChanges: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data.changes ?? {})) {
      if (INTERNAL_KEYS.has(key)) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      cleanChanges[key] = value;
    }

    const employee = await prisma.employee.findUnique({
      where: { id: data.employeeId },
      select: { firstName: true, lastName: true, employeeCode: true },
    });

    const request = await prisma.employeeChangeRequest.create({
      data: {
        employeeId: data.employeeId,
        requestedBy: user.email,
        changes: cleanChanges as Prisma.InputJsonValue,
        documents: {
          create: (data.documents ?? []).map((d) => ({
            documentType: d.documentType,
            documentUrl: d.documentUrl,
          })),
        },
      },
    });

    /**
     * Arm the verification gate for the scans that arrived on this request.
     *
     * Done AFTER the request exists (so the traceable reference resolves) and
     * BEFORE the approver is notified, so nobody can approve a document whose
     * checklist item still reads COMPLETED from an earlier onboarding.
     */
    await armVerificationForRequest({
      employeeId: data.employeeId,
      documents: data.documents ?? [],
      requestId: request.id,
    });

    // Best-effort, AFTER the request is durably recorded. An approver who is
    // not notified can still see the row in the approvals queue.
    await notifyApproversOfChangeRequest({
      employeeId: data.employeeId,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}` : "An employee",
      requestedBy: user.email,
      documentCount: data.documents?.length ?? 0,
      changedFields: Object.keys(cleanChanges),
    });

    revalidatePath("/dashboard/approvals");
    revalidatePath("/notifications");

    return { success: true, request };
  } catch (error: any) {
    console.error("Failed to submit change request", error);
    return { success: false, message: error.message || "Failed to submit change request." };
  }
}

/**
 * Notifies the manager that a partial or full save landed on a record they own.
 * Exported so `upsertEmployee` can call it without duplicating the recipient
 * lookup.
 */
export async function announceEmployeeSave(params: {
    managerId: string | null;
    employeeName: string;
    actorEmail: string;
    isPartial: boolean;
}): Promise<void> {
  await notifyManagerOfUpdate(params);
}

/**
 * Approval is the SECOND gate, not the first.
 *
 * A change request carries supporting documents precisely because the data being
 * changed is sensitive (passport, visa, bank, address). Approving it writes that
 * data straight to `Employee`, and it used to do so without anyone ever opening
 * the attachment — so the "supporting document" was decoration and the
 * verification columns on the checklist were never consulted.
 *
 * Approval is therefore refused while any document attached to this request is
 * unverified. `OnboardingChecklistItem.status === COMPLETED` is the only
 * accepted proof, because that is the state that `updateChecklistItem` writes
 * together with `verifiedBy` + `verifiedAt` and an audit row.
 *
 * Requests with NO documents are unaffected: a change that legitimately needs no
 * scan (a designation correction) must not be blocked by a rule about scans.
 */
async function unverifiedDocumentTypes(requestId: string): Promise<string[]> {
    const docs = await prisma.changeRequestDocument.findMany({
        where: { requestId },
        select: { documentType: true },
    });
    if (docs.length === 0) return [];

    const types = [...new Set(docs.map((d) => d.documentType))];

    // Supporting evidence such as an address proof has no checklist counterpart
    // and so cannot be "verified" this way; it does not gate approval.
    const relevant = types.filter((t) => CHECKLIST_BACKED.has(t));
    if (relevant.length === 0) return [];

    // Compared against the CHECKLIST category, not the document type — the two
    // differ (BANK_IBAN -> BANK), so comparing raw types would never match.
    const checklistCategories = relevant.map((t) => DOC_TYPE_TO_CHECKLIST[t] as string);

    const request = await prisma.employeeChangeRequest.findUnique({
        where: { id: requestId },
        select: { employeeId: true },
    });
    if (!request) return [];

    const verified = await prisma.onboardingChecklistItem.findMany({
        where: {
            employeeId: request.employeeId,
            category: { in: checklistCategories },
            status: "COMPLETED",
            verifiedAt: { not: null },
        },
        select: { category: true },
    });
    const verifiedCategories = new Set(verified.map((v) => v.category));

    return relevant.filter((t) => !verifiedCategories.has(DOC_TYPE_TO_CHECKLIST[t] as string));
}

/**
 * Promotes the approved request's scans into `Attachment` rows.
 *
 * WHY THIS MUST HAPPEN
 *
 * A document uploaded against an EXISTING employee lives on
 * `ChangeRequestDocument` — it never passed through `upsertEmployee`, so without
 * this step it would exist only as approval evidence. The employee's document
 * of record — what the Residency Vault, `/visa` and any future download read —
 * would keep showing the PREVIOUS scan, or nothing at all, after the change was
 * approved.
 *
 * Approval is the point the evidence becomes fact: the scan is promoted and the
 * superseded attachment of the same category is replaced, not accumulated.
 *
 * Runs AFTER the approve transaction. A promotion failure leaves the approved
 * change in place and is logged, because silently reverting an approved change
 * is worse than a missing file that can be re-uploaded.
 */
async function promoteApprovedDocuments(params: {
    employeeId: string;
    requestId: string;
}): Promise<number> {
    const docs = await prisma.changeRequestDocument.findMany({
        where: { requestId: params.requestId },
        select: { documentType: true, documentUrl: true },
    });

    let promoted = 0;
    for (const doc of docs) {
        try {
            const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(doc.documentUrl);
            if (!match) continue;
            const mimeType = match[1];
            const fileExt = mimeType === "image/png" ? ".png"
                : mimeType === "image/jpeg" ? ".jpg"
                : mimeType === "application/pdf" ? ".pdf"
                : ".bin";

            await prisma.attachment.deleteMany({
                where: { employeeId: params.employeeId, category: doc.documentType },
            });
            await prisma.attachment.create({
                data: {
                    employeeId: params.employeeId,
                    fileName: `${doc.documentType.toLowerCase()}_${params.employeeId}${fileExt}`,
                    fileUrl: doc.documentUrl,
                    fileType: mimeType,
                    category: doc.documentType,
                },
            });
            promoted++;
        } catch (error) {
            console.error("[PROMOTE_APPROVED_DOCUMENT_FAILED]", doc.documentType, error);
        }
    }
    return promoted;
}

/**
 * Asserts the approver may decide THIS employee's change.
 *
 * `employees.approve` is deliberately narrower than `employees.create`, and
 * MANAGER now holds it. Without a scope check that grant would let any manager
 * approve a correction to any employee in the company, which is a wider power
 * than the one HR has and is not what "a manager approves their team" means.
 *
 * HR, ADMIN and SUPER_ADMIN clear `employees.create`, which is the existing
 * signal for "may act on any record", and are unrestricted.
 */
async function assertCanDecideFor(
    approver: { role: string; employeeId?: string | null },
    employeeId: string
): Promise<void> {
    if (hasPermission(approver.role, PERMISSIONS.EMPLOYEES_CREATE)) return;

    const target = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { managerId: true },
    });
    if (!target) return;

    if (target.managerId !== approver.employeeId) {
        throw new AuthorizationError(
            "You can only approve changes for employees who report directly to you.",
            PERMISSIONS.EMPLOYEES_APPROVE
        );
    }
}

export async function approveChangeRequest(id: string) {
  try {
    // `employees.approve`, not `employees.create`. See the note on the
    // permission: every other approval domain owns a dedicated `*.approve`, and
    // borrowing a record-mutation permission both hid the Data Changes queue from
    // managers and made it impossible to delegate approval without also delegating
    // record rewriting.
    const user = await requirePermission(PERMISSIONS.EMPLOYEES_APPROVE);

    const request = await prisma.employeeChangeRequest.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    if (!request) return { success: false, message: "Request not found" };
    if (request.status !== "PENDING") return { success: false, message: "Request is not pending" };

    await assertCanDecideFor(user, request.employeeId);

    // Gate: refuse to apply a sensitive change whose evidence nobody has
    // checked. This runs BEFORE the transaction so nothing is written.
    const unverified = await unverifiedDocumentTypes(id);
    if (unverified.length > 0) {
      return {
        success: false,
        message:
          `Cannot approve yet: the following document(s) must be verified first — ${unverified.join(", ")}. ` +
          "Open the employee record, review the uploaded scan, then mark the checklist item complete.",
        code: "DOCUMENTS_UNVERIFIED",
      };
    }

    // Apply the changes to the employee
    await prisma.$transaction([
      prisma.employee.update({
        where: { id: request.employeeId },
        data: request.changes as any,
      }),
      prisma.employeeChangeRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedBy: user.email,
          approvedAt: new Date(),
        },
      })
    ]);

    // The verified scans become the employee's documents of record, replacing
    // whatever was on file before. This is the step that makes an edit visible
    // in the visa / compliance surfaces rather than living only as evidence.
    const promoted = await promoteApprovedDocuments({
        employeeId: request.employeeId,
        requestId: id,
    });

    // Tell the person the record belongs to that their change was applied.
    try {
      await prisma.notification.create({
        data: {
          employeeId: request.employeeId,
          title: "Your profile change was approved",
          message: `${user.email} approved ${Object.keys(request.changes ?? {}).length} change(s) to your record.`,
          type: "SUCCESS",
          link: "/employees",
        },
      });
    } catch (notifyError) {
      console.error("[CHANGE_REQUEST_APPROVE_NOTIFY_FAILED]", notifyError);
    }

    revalidatePath("/employees");
    revalidatePath("/dashboard/approvals");
    revalidatePath("/dashboard/visa");
    revalidatePath("/notifications");
    return { success: true, message: promoted > 0 ? "Change request approved. The verified documents are now on the employee record." : "Change request approved." };
  } catch (error: any) {
    console.error("Failed to approve change request", error);
    return { success: false, message: error.message || "Failed to approve change request." };
  }
}

export async function rejectChangeRequest(id: string, reason: string) {
  try {
    const user = await requirePermission(PERMISSIONS.EMPLOYEES_APPROVE);

    const request = await prisma.employeeChangeRequest.findUnique({
      where: { id },
      select: { employeeId: true, employee: { select: { firstName: true, lastName: true } } },
    });

    // Same scope rule as approval. A manager who cannot approve a stranger's
    // change must not be able to reject it either, or the queue becomes a way to
    // interfere with another department's records.
    if (request) {
      await assertCanDecideFor(user, request.employeeId);
    }

    await prisma.employeeChangeRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedBy: user.email,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
    });

    if (request) {
      try {
        await prisma.notification.create({
          data: {
            employeeId: request.employeeId,
            title: "Your profile change was rejected",
            message: `${user.email} rejected the change: ${reason}`,
            type: "WARNING",
            link: "/employees",
          },
        });
      } catch (notifyError) {
        console.error("[CHANGE_REQUEST_REJECT_NOTIFY_FAILED]", notifyError);
      }
    }

    revalidatePath("/dashboard/approvals");
    revalidatePath("/notifications");
    return { success: true, message: "Change request rejected." };
  } catch (error: any) {
    console.error("Failed to reject change request", error);
    return { success: false, message: error.message || "Failed to reject change request." };
  }
}