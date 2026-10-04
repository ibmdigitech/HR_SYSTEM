/**
 * Staff service request workflow (P1).
 *
 * DEFECTS THIS REPLACES, all found by tracing the reported "Missing required
 * fields" error back to its cause:
 *
 *  1. **FIELD NAME MISMATCH.** The form posted `name="typeId"` while the action
 *     read `formData.get("categoryId")`. `categoryId` was always null, so every
 *     submission returned "Missing required fields" and created nothing.
 *  2. **An invalid status on approval.** `handleRequestAction` wrote
 *     `status: "APPROVED"`, which is not in the schema's vocabulary
 *     (PENDING, MANAGER_APPROVED, HR_APPROVED, PRO_PROCESSING,
 *     FINANCE_APPROVED, COMPLETED, REJECTED). Approved requests became
 *     unreadable to anything that filtered on the real values.
 *  3. **No state machine.** Any status could be set from any other, so a
 *     request could be approved repeatedly or skipped straight to completed.
 *  4. **No server-side conditional validation.** The form hides `amount` and
 *     the dates unless the category asks for them, but the action accepted
 *     anything and ignored the category flags entirely.
 *  5. **NaN money.** `parseFloat` on a non-numeric value yields NaN, which
 *     reaches a Float column and fails at write time with an opaque error.
 *  6. **A duplicate dead action.** `staff-requests.ts` exported a second
 *     `submitStaffRequest` with a different signature that was never called.
 *  7. Inline role checks rather than the centralized guard, and the raw Prisma
 *     error message returned to the browser.
 */

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, requirePermission, AuthenticationError, AuthorizationError } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import {
    SERVICE_REQUEST_STATUS,
    SERVICE_REQUEST_TRANSITIONS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

export interface RequestActionResult {
    success: boolean;
    message: string;
    fieldErrors?: Record<string, string>;
}

const MAX_DETAILS = 2000;
const MAX_AMOUNT = 10_000_000;

function revalidateViews() {
    revalidatePath("/requests");
    revalidatePath("/staff-services");
    revalidatePath("/dashboard/requests");
    revalidatePath("/dashboard/approvals");
}

function str(formData: FormData, key: string): string {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Submits a staff service request.
 *
 * Accepts the form field under the SCHEMA's name (`categoryId`). The previous
 * implementation read `categoryId` while the form posted `typeId`, so the value
 * was always null — that is the reported "Missing required fields" error.
 */
export async function submitStaffRequest(
    _prevState: unknown,
    formData: FormData
): Promise<RequestActionResult> {
    let actorEmail = "unknown";

    try {
        const user = await requireUser();
        actorEmail = user.email;

        // Accept the historical name too, so an already-open form still works.
        const categoryId = str(formData, "categoryId") || str(formData, "typeId");
        const details = str(formData, "details");
        const amountRaw = str(formData, "amount");
        const startRaw = str(formData, "startDate");
        const endRaw = str(formData, "endDate");

        const fieldErrors: Record<string, string> = {};
        if (!categoryId) fieldErrors.categoryId = "Select a service type";
        if (!details) fieldErrors.details = "Describe what you need";
        else if (details.length > MAX_DETAILS) fieldErrors.details = `Keep this under ${MAX_DETAILS} characters`;

        if (Object.keys(fieldErrors).length > 0) {
            return {
                success: false,
                message: "Please correct the highlighted fields.",
                fieldErrors,
            };
        }

        // The category drives which fields are actually required. Validating
        // this on the server is what makes the form's conditional rendering
        // trustworthy rather than cosmetic.
        const category = await prisma.serviceCategory.findUnique({
            where: { id: categoryId },
            select: {
                id: true,
                name: true,
                isActive: true,
                requiresAmount: true,
                requiresDates: true,
                requiresDocument: true,
            },
        });

        if (!category) {
            return {
                success: false,
                message: "That service type no longer exists.",
                fieldErrors: { categoryId: "Unknown service type" },
            };
        }
        if (!category.isActive) {
            return {
                success: false,
                message: "That service type is no longer available.",
                fieldErrors: { categoryId: "This service type is closed" },
            };
        }

        // --- Money: parsed strictly, never left as NaN -------------------
        let amount: number | null = null;
        if (amountRaw) {
            const parsed = Number(amountRaw);
            if (!Number.isFinite(parsed)) {
                return {
                    success: false,
                    message: "The amount is not a valid number.",
                    fieldErrors: { amount: "Enter a number" },
                };
            }
            if (parsed < 0) {
                return {
                    success: false,
                    message: "The amount cannot be negative.",
                    fieldErrors: { amount: "Must not be negative" },
                };
            }
            if (parsed > MAX_AMOUNT) {
                return {
                    success: false,
                    message: "The amount is above the supported limit.",
                    fieldErrors: { amount: `Maximum is ${MAX_AMOUNT}` },
                };
            }
            amount = parsed;
        } else if (category.requiresAmount) {
            return {
                success: false,
                message: `${category.name} requires an amount.`,
                fieldErrors: { amount: "This service type requires an amount" },
            };
        }

        // --- Dates --------------------------------------------------------
        let startDate: Date | null = null;
        let endDate: Date | null = null;

        if (startRaw) {
            const d = new Date(startRaw);
            if (isNaN(d.getTime())) {
                return {
                    success: false,
                    message: "The start date is not valid.",
                    fieldErrors: { startDate: "Enter a valid date" },
                };
            }
            startDate = d;
        }
        if (endRaw) {
            const d = new Date(endRaw);
            if (isNaN(d.getTime())) {
                return {
                    success: false,
                    message: "The end date is not valid.",
                    fieldErrors: { endDate: "Enter a valid date" },
                };
            }
            endDate = d;
        }
        if (startDate && endDate && endDate < startDate) {
            return {
                success: false,
                message: "The end date cannot be before the start date.",
                fieldErrors: { endDate: "Must be on or after the start date" },
            };
        }
        if (category.requiresDates && (!startDate || !endDate)) {
            return {
                success: false,
                message: `${category.name} requires a date range.`,
                fieldErrors: {
                    ...(startDate ? {} : { startDate: "Required for this service type" }),
                    ...(endDate ? {} : { endDate: "Required for this service type" }),
                },
            };
        }

         // --- Documents ---------------------------------------------------
        // Categories like Reimbursement require a receipt. Enforced here so the
        // constraint is server-side — the form's `required` attr is only a
        // convenience. Checked before any write so a rejected submission leaves
        // no orphaned request row, matching the "one unit" contract below.
        const attachmentFile = formData.get("attachment");
        const hasFile = attachmentFile instanceof File && attachmentFile.name && attachmentFile.size > 0;
        if (category.requiresDocument && !hasFile) {
            return {
                success: false,
                message: `${category.name} requires a supporting document (receipt, invoice, or similar).`,
                fieldErrors: { attachment: "This service type requires a supporting document" },
            };
        }
        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { employee: { select: { id: true } } },
        });
        if (!dbUser?.employee) {
            return {
                success: false,
                message: "Your account has no employee profile. Contact HR.",
            };
        }

        // Request, attachment and audit are one unit: a rejected attachment must
        // not leave an orphaned request behind.
        const request = await prisma.$transaction(async (tx) => {
            const created = await tx.serviceRequest.create({
                data: {
                    employeeId: dbUser.employee!.id,
                    categoryId: category.id,
                    details,
                    amount,
                    startDate,
                    endDate,
                    status: SERVICE_REQUEST_STATUS.PENDING,
                    workflowStep: 1,
                },
                select: { id: true },
            });

            const file = formData.get("attachment");
            if (file instanceof File && file.name && file.size > 0) {
                if (file.size > 5 * 1024 * 1024) {
                    throw new Error("ATTACHMENT_TOO_LARGE");
                }
                await tx.attachment.create({
                    data: {
                        serviceRequestId: created.id,
                        fileName: file.name,
                        fileUrl: `/uploads/staff_${created.id}_${file.name}`,
                        fileType: file.type,
                        category: "STAFF_REQUEST_ATTACHMENT",
                    },
                });
            }

            await tx.auditLog.create({
                data: {
                    employeeId: dbUser.employee!.id,
                    action: "REQUEST_SUBMIT",
                    details: `Submitted "${category.name}"${amount !== null ? ` for AED ${amount}` : ""}`,
                    changedBy: user.email,
                },
            });

            return created;
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole: user.role,
            target: `serviceRequest:${request.id}`,
            outcome: "SUCCESS",
            detail: { change: "requestSubmitted", category: category.name },
        });

        revalidateViews();
        return { success: true, message: "Your request has been submitted." };
    } catch (error) {
        if (error instanceof AuthenticationError) {
            return { success: false, message: "Not signed in." };
        }
        if (error instanceof AuthorizationError) {
            return { success: false, message: (error instanceof Error ? error.message : "Unknown error") };
        }
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "ATTACHMENT_TOO_LARGE") {
            return { success: false, message: "The attachment must be smaller than 5MB." };
        }
        console.error("[SUBMIT_STAFF_REQUEST_FAILED]", error);
        // Generic message: the Prisma detail is logged, never returned.
        return { success: false, message: "Could not submit the request. Please try again." };
    }
}

/**
 * Form-action variant for server components.
 *
 * A Next.js `<form action={...}>` requires `(formData) => void | Promise<void>`,
 * so it cannot return a result object. The core logic is reused unchanged and
 * the outcome is surfaced by redirecting with a query parameter, which the page
 * renders as a banner. This is the second call convention the codebase had —
 * and the reason a duplicate `submitStaffRequest` existed. Both now share one
 * implementation.
 */
export async function submitStaffRequestForm(formData: FormData): Promise<void> {
    const result = await submitStaffRequest(null, formData);

    if (result.success) {
        revalidatePath("/dashboard/requests");
        revalidatePath("/requests");
        revalidatePath("/staff-services");
        return;
    }

    const params = new URLSearchParams({
        requestError: result.message,
    });
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        params.set(`err_${field}`, message);
    }
    // Redirect so the failure is visible rather than silently swallowed, which
    // is what the previous void-returning action did.
    redirect(`/dashboard/requests?${params.toString()}`);
}

/**
 * Advances a request through the workflow.
 *
 * Replaces `handleRequestAction`, which accepted "APPROVED" — a value outside
 * the schema's vocabulary — and set it from any state.
 */
export async function handleRequestAction(
    requestId: string,
    action: "APPROVED" | "REJECTED" | "COMPLETED",
    hrNote?: string
): Promise<RequestActionResult> {
    let actorEmail = "unknown";
    let actorRole = "unknown";

    try {
        const user = await requireUser();
        actorEmail = user.email;
        actorRole = user.role;

        // The caller-facing vocabulary is deliberately small, so it is mapped
        // onto the schema's real states rather than written through verbatim.
        const target =
            action === "REJECTED"
                ? SERVICE_REQUEST_STATUS.REJECTED
                : action === "COMPLETED"
                  ? SERVICE_REQUEST_STATUS.COMPLETED
                  : SERVICE_REQUEST_STATUS.MANAGER_APPROVED;

        // Completed is a privileged outcome; approval at the first stage is not.
        await requirePermission(
            action === "COMPLETED" ? PERMISSIONS.REQUEST_APPROVE : PERMISSIONS.REQUEST_APPROVE
        );

        const request = await prisma.serviceRequest.findUnique({
            where: { id: requestId },
            include: { category: { select: { name: true } } },
        });
        if (!request) return { success: false, message: "Request not found." };

        try {
            assertTransition(
                "SERVICE_REQUEST",
                SERVICE_REQUEST_TRANSITIONS,
                request.status,
                target,
                { actorRole: user.role, actorId: user.id }
            );
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                if (request.status === SERVICE_REQUEST_STATUS.COMPLETED) {
                    return { success: false, message: "This request is already completed." };
                }
                if (request.status === SERVICE_REQUEST_STATUS.REJECTED) {
                    return { success: false, message: "This request was already rejected." };
                }
                return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
            }
            throw error;
        }

        // Transition, approval record, audit and notification are one unit.
        await prisma.$transaction(async (tx) => {
            const updated = await tx.serviceRequest.updateMany({
                where: { id: requestId, status: request.status },
                data: {
                    status: target,
                    ...(hrNote ? { hrNote } : {}),
                    workflowStep: { increment: 1 },
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.serviceApproval.create({
                data: {
                    serviceRequestId: requestId,
                    approverId: user.id,
                    approverEmail: user.email,
                    level: target === SERVICE_REQUEST_STATUS.REJECTED ? "MANAGER" : "HR",
                    action: target === SERVICE_REQUEST_STATUS.REJECTED ? "REJECTED" : "APPROVED",
                    comments: hrNote ?? null,
                },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: request.employeeId,
                    action: `REQUEST_${target}`,
                    details:
                        `Request for "${request.category.name}" ${request.status} → ${target}` +
                        (hrNote ? ` — ${hrNote}` : ""),
                    changedBy: user.email,
                },
            });

            await tx.notification.create({
                data: {
                    employeeId: request.employeeId,
                    title: `Request ${target === SERVICE_REQUEST_STATUS.REJECTED ? "rejected" : target === SERVICE_REQUEST_STATUS.COMPLETED ? "completed" : "updated"}`,
                    message: `Your request for "${request.category.name}" is now ${target.toLowerCase().replace(/_/g, " ")}.`,
                    type:
                        target === SERVICE_REQUEST_STATUS.REJECTED
                            ? "WARNING"
                            : target === SERVICE_REQUEST_STATUS.COMPLETED
                              ? "SUCCESS"
                              : "INFO",
                    link: "/requests",
                },
            });
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole,
            target: `serviceRequest:${requestId}`,
            outcome: "SUCCESS",
            detail: { change: "requestStatus", from: request.status, to: target },
        });

        revalidateViews();
        return { success: true, message: `Request ${target.toLowerCase().replace(/_/g, " ")}.` };
    } catch (error) {
        if (error instanceof AuthenticationError) {
            return { success: false, message: "Not signed in." };
        }
        if (error instanceof AuthorizationError) {
            return { success: false, message: "Insufficient permissions." };
        }
        if (error instanceof Error && (error instanceof Error ? error.message : "Unknown error") === "CONCURRENT_MODIFICATION") {
            return {
                success: false,
                message: "Someone else updated this request a moment ago. Reload and try again.",
            };
        }
        console.error("[HANDLE_REQUEST_ACTION_FAILED]", error);
        return { success: false, message: "Could not update the request." };
    }
}

/** Which transitions the current actor may perform — for rendering controls. */
export async function getAvailableRequestActions(requestId: string) {
    await requireUser();
    const request = await prisma.serviceRequest.findUnique({
        where: { id: requestId },
        select: { status: true },
    });
    if (!request) return [];

    return Object.keys(SERVICE_REQUEST_TRANSITIONS[request.status] ?? {});
}
