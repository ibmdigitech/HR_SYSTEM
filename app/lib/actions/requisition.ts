"use server";

/**
 * Job requisition creation.
 *
 * THE GAP THIS FILLS: `JobRequisition` was read-only. The recruitment screen
 * listed open positions and the "New Job Requisition" button was a bare
 * `<Button>` with no handler, no link and no dialog — a control that looked
 * functional and did nothing. This file plus `app/recruitment/requisitions/new`
 * is the other half of that button.
 *
 * Three things live here and nowhere else:
 *
 *  1. AUTHORIZATION. `requirePermission(PERMISSIONS.RECRUITMENT_CREATE)` is the
 *     first statement, before validation and before any query. The permission
 *     string is the one already in `lib/auth/permissions.ts` ("Create/edit
 *     requisitions, jobs, candidates, applications") — nothing is invented here
 *     and no role name is hardcoded. A caller without it is refused without the
 *     database ever being consulted, and the guard's own `logSecurityEvent`
 *     records the denial.
 *  2. SERVER-SIDE VALIDATION. Every rule in
 *     `lib/recruitment/requisition-validation.ts` is re-checked here through
 *     `parseRequisitionFormData`. The form's client check is a convenience;
 *     this is the authority.
 *  3. THE REQUISITION CODE. `requisitionCode` is `@unique`, so two HR users
 *     creating a requisition in the same second WILL collide. A bare
 *     `count() + 1` throws Prisma's P2002 under that race. The code is instead
 *     read from the highest existing value and the insert is retried on P2002 —
 *     see the retry loop for why retrying is safe rather than papering over.
 *
 * NOT HERE, DELIBERATELY: the approval chain. A new requisition is written as
 * DRAFT and is never auto-submitted. The chain (SUBMITTED → MANAGER_REVIEW →
 * HR_REVIEW → FINANCE_REVIEW → APPROVED) is owned by
 * `lib/workflow/recruitment-machine.ts` and driven by the existing
 * `moveRequisition` control on the recruitment screen; this file does not invent
 * transitions or stamp approval fields.
 *
 * A `"use server"` file may only export async functions, so the vocabulary and
 * the type used by the form are imported directly from
 * `@/lib/recruitment/requisition-validation`.
 */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import {
    requirePermission,
    AuthenticationError,
    AuthorizationError,
} from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
    parseRequisitionFormData,
    nextRequisitionCode,
    requisitionCodePrefix,
    REQUISITION_INITIAL_STATUS,
    REQUISITION_POSITION_TYPE_REPLACEMENT,
    type RequisitionFieldErrors,
    type RequisitionInput,
} from "@/lib/recruitment/requisition-validation";

export interface RequisitionFormState {
    success: boolean;
    message: string;
    /** Present on success, so the form can name the code it was issued. */
    requisitionId?: string;
    requisitionCode?: string;
    /** Present on a validation refusal only — the server's own verdict. */
    fieldErrors?: RequisitionFieldErrors;
}

/**
 * How many times a code collision is retried before giving up.
 *
 * Each attempt re-reads the highest existing code and increments, so the second
 * attempt cannot pick the same number the first one lost. Three is already
 * generous for two HR users; five leaves room for a burst without letting a
 * genuinely broken request spin.
 */
const MAX_CODE_ATTEMPTS = 5;

/**
 * P2002 is "unique constraint failed". Read from the Prisma error object
 * rather than guessed from a message, with the message check kept as a
 * fallback because a driver-level error that crosses the interactive
 * transaction boundary can arrive without its code attached.
 */
function isUniqueViolation(error: unknown): boolean {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "P2002") {
        return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("P2002") || message.includes("Unique constraint");
}

/** Maps a guard failure onto the shared result shape. */
function refusal(error: unknown): RequisitionFormState | null {
    if (error instanceof AuthenticationError) {
        return { success: false, message: "Not signed in" };
    }
    if (error instanceof AuthorizationError) {
        return { success: false, message: error.message };
    }
    return null;
}

/**
 * Creates a requisition from a submitted form.
 *
 * Ordered deliberately: authorize → validate → write. Nothing about the
 * payload is read before the caller is known to hold `recruitment.create`, so an
 * unauthorized request cannot use validation messages to probe the rule set.
 */
export async function createJobRequisitionAction(
    _prevState: RequisitionFormState | undefined,
    formData: FormData
): Promise<RequisitionFormState> {
    let user: Awaited<ReturnType<typeof requirePermission>>;
    try {
        user = await requirePermission(PERMISSIONS.RECRUITMENT_CREATE);
    } catch (error) {
        return (
            refusal(error) ?? {
                success: false,
                message: "Could not verify your access. Nothing was changed.",
            }
        );
    }

    // `requestedById` is a required relation to Employee, so an HR login with no
    // employee profile has nothing to attribute the requisition to. Refused
    // explicitly rather than written against a fabricated owner.
    if (!user.employeeId) {
        return {
            success: false,
            message: "No employee profile is linked to your account, so a requisition cannot be raised on your behalf.",
        };
    }
    // Captured before the closure below: TypeScript does not carry a
    // null-check narrowing into a callback for a `let` binding.
    const requestedById: string = user.employeeId;

    const parsed = parseRequisitionFormData(formData);
    if (!parsed.ok) {
        return {
            success: false,
            message: parsed.formError,
            fieldErrors: parsed.fieldErrors,
        };
    }

    const value: RequisitionInput = parsed.value;
    // A NEW_POSITION never carries a replaced employee. Clearing it here rather
    // than trusting the form means a stale value can never survive a change of
    // mind between rendering and submitting.
    const replacementEmployeeId =
        value.positionType === REQUISITION_POSITION_TYPE_REPLACEMENT
            ? value.replacementEmployeeId
            : undefined;

    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
        try {
            const created = await prisma.$transaction(async (tx) => {
                const year = new Date().getFullYear();
                const prefix = requisitionCodePrefix(year);

                // The highest code issued for THIS year. Codes restart at 0001
                // in January, so a global count would either keep climbing
                // across year boundaries or collide with last year's tail.
                const latest = await tx.jobRequisition.findFirst({
                    where: { requisitionCode: { startsWith: prefix } },
                    orderBy: { requisitionCode: "desc" },
                    select: { requisitionCode: true },
                });
                const requisitionCode = nextRequisitionCode(latest?.requisitionCode, year);

                const requisition = await tx.jobRequisition.create({
                    data: {
                        requisitionCode,
                        title: value.title,
                        department: value.department,
                        branch: value.branch ?? null,
                        location: value.location ?? null,
                        employmentType: value.employmentType,
                        positionsCount: value.positionsCount,
                        positionType: value.positionType,
                        replacementEmployeeId: replacementEmployeeId ?? null,
                        reason: value.reason ?? null,
                        requiredSkills: value.requiredSkills ?? null,
                        requiredExperience: value.requiredExperience ?? null,
                        requiredEducation: value.requiredEducation ?? null,
                        budget: value.budget ?? null,
                        minSalary: value.minSalary ?? null,
                        maxSalary: value.maxSalary ?? null,
                        priority: value.priority,
                        targetJoiningDate: value.targetJoiningDate ?? null,
                        // DRAFT, always. The approval chain is a separate,
                        // deliberate walk — see the file header.
                        status: REQUISITION_INITIAL_STATUS,
                        requestedById,
                    },
                    select: { id: true, requisitionCode: true, status: true },
                });

                await tx.auditLog.create({
                    data: {
                        employeeId: requestedById,
                        action: "REQUISITION_CREATED",
                        details:
                            `${requisition.requisitionCode} "${value.title}" in ${value.department} ` +
                            `(${value.positionsCount} position(s), ${value.positionType}, ${value.priority})`,
                        changedBy: user.email,
                    },
                });

                return requisition;
            });

            revalidatePath("/recruitment");

            return {
                success: true,
                message: `Requisition ${created.requisitionCode} created as a draft. It is not submitted for approval yet.`,
                requisitionId: created.id,
                requisitionCode: created.requisitionCode ?? undefined,
            };
        } catch (error) {
            // Two HR users can read the same "highest code" in the same
            // millisecond. The loser gets P2002, its whole transaction rolls
            // back (so the audit row goes with it — no orphan log), and the next
            // attempt re-reads a code the winner has now committed. Retrying
            // here is therefore a correct re-run of an all-or-nothing unit of
            // work, not a retry of a partially applied write.
            if (isUniqueViolation(error) && attempt < MAX_CODE_ATTEMPTS) {
                console.warn(
                    `[REQUISITION_CODE_COLLISION] attempt ${attempt}/${MAX_CODE_ATTEMPTS} — re-reading the sequence`
                );
                continue;
            }
            if (isUniqueViolation(error)) {
                console.error("[CREATE_REQUISITION_FAILED] code exhausted", error);
                return {
                    success: false,
                    message:
                        "Another requisition is taking the same number. Nothing was changed — please try again.",
                };
            }
            console.error("[CREATE_REQUISITION_FAILED]", error);
            return {
                success: false,
                message: "Could not create the requisition. Nothing was changed.",
            };
        }
    }

    return {
        success: false,
        message: "Could not create the requisition. Nothing was changed.",
    };
}
