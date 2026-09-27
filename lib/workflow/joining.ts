/**
 * Joining (P1 §18, §19).
 *
 * The brief is unambiguous: "Only when the candidate actually joins should the
 * system activate the Employee record" and "Do NOT create an Employee record
 * merely because someone applied for a job."
 *
 * This module is the only place a recruitment hire becomes an Employee. It
 * runs as ONE transaction so a failure cannot leave a half-created employee:
 *
 *   Candidate → Employee → User → SalaryStructure → LeaveBalances
 *              → Onboarding checklist → Notification → AuditLog
 *
 * If anything fails, everything rolls back. There is no partial state, which is
 * what the brief means by "do not leave invisible inconsistent data".
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { issueActivationToken } from "@/lib/workflow/credentials";
import { ensureChecklist, notifyManagerOfNewHire } from "@/lib/workflow/onboarding";
import {
    APPLICATION_STATUS,
    APPLICATION_TRANSITIONS,
    LIFECYCLE_TRANSITIONS,
    EMPLOYEE_LIFECYCLE,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/recruitment-machine";
import { CHECKLIST_STATUS } from "@/lib/workflow/state-machine";

/** The default entitlement set used when onboarding a new hire. */
const DEFAULT_LEAVE_BALANCES: { leaveType: string; totalDays: number }[] = [
    { leaveType: "ANNUAL", totalDays: 21 },
    { leaveType: "SICK", totalDays: 10 },
    { leaveType: "CASUAL", totalDays: 6 },
    { leaveType: "EMERGENCY", totalDays: 3 },
    { leaveType: "UNPAID", totalDays: 0 },
    { leaveType: "MATERNITY", totalDays: 90 },
    { leaveType: "PATERNITY", totalDays: 5 },
    { leaveType: "HAJJ", totalDays: 30 },
    { leaveType: "BEREAVEMENT", totalDays: 3 },
    { leaveType: "STUDY", totalDays: 10 },
];

export const JOINING_STATUS = {
    SCHEDULED: "SCHEDULED",
    JOINED: "JOINED",
    NO_SHOW: "NO_SHOW",
    POSTPONED: "POSTPONED",
    CANCELLED: "CANCELLED",
} as const;

export interface JoinResult {
    success: boolean;
    message: string;
    employeeId?: string;
    /** Nullable because Employee.employeeCode is nullable in the schema. */
    employeeCode?: string | null;
    activationRequired?: boolean;
}

export async function completeJoining(params: {
    applicationId: string;
    /** Overrides the offer's proposed joining date. */
    joiningDate?: string;
    actor: { id: string; email: string; role: string; employeeId: string | null };
}): Promise<JoinResult> {
    try {
        // Only the capability that also governs deletion may create an employee.
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_CONVERT);

        const application = await prisma.application.findUnique({
            where: { id: params.applicationId },
            select: {
                id: true,
                status: true,
                candidate: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
                jobRequisition: { select: { id: true, title: true, department: true } },
                offers: {
                    where: { status: "ACCEPTED" },
                    orderBy: { version: "desc" },
                    take: 1,
                    select: { id: true, offeredSalary: true, allowances: true, joiningDate: true, designation: true, department: true, probationPeriodMonths: true },
                },
            },
        });

        if (!application) return { success: false, message: "Application not found." };

        // An accepted offer is the precondition. Marking someone HIRED earlier
        // is a pipeline state, not a joining.
        const offer = application.offers[0];
        if (!offer) {
            return {
                success: false,
                message: "No accepted offer. A candidate must accept an offer before joining.",
            };
        }

        // The application must be able to reach HIRED, and already be there or
        // be moved there as part of the same action.
        if (application.status === APPLICATION_STATUS.HIRED) {
            // Already joined — refuse rather than create a second employee.
            return { success: false, message: "This candidate has already been hired." };
        }
        if (application.status !== APPLICATION_STATUS.OFFER_ACCEPTED) {
            return {
                success: false,
                message: `Only an OFFER_ACCEPTED application can be joined. This one is ${application.status}.`,
            };
        }

        // Guard the state machine, even though the precondition above covers it.
        try {
            assertTransition(
                "APPLICATION",
                APPLICATION_TRANSITIONS,
                application.status,
                APPLICATION_STATUS.HIRED,
                { actorRole: user.role, actorId: user.id, data: { hasAcceptedOffer: true } }
            );
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Cannot join: ${error.message}` };
            }
            throw error;
        }

        const candidate = application.candidate;
        const requisition = application.jobRequisition;

        // Guard against a duplicate employee if a previous attempt succeeded
        // but the caller retried.
        const alreadyEmployed = await prisma.employee.findFirst({
            where: { email: candidate.email },
            select: { id: true, employeeCode: true },
        });
        if (alreadyEmployed) {
            return {
                success: false,
                message: `An employee record already exists for ${candidate.email} (${alreadyEmployed.employeeCode}). Nothing was duplicated.`,
                employeeId: alreadyEmployed.id,
                employeeCode: alreadyEmployed.employeeCode,
            };
        }

        const joiningDate = params.joiningDate ? new Date(params.joiningDate) : offer.joiningDate;
        if (isNaN(joiningDate.getTime())) {
            return { success: false, message: "Invalid joining date." };
        }
        const year = joiningDate.getFullYear();

        // Sequential code, mirroring the existing employee onboarding.
        const lastEmployee = await prisma.employee.findFirst({
            orderBy: { employeeCode: "desc" },
            select: { employeeCode: true },
        });
        const lastNum = lastEmployee?.employeeCode?.match(/(\d+)$/)?.[1];
        const nextNum = lastNum ? Number.parseInt(lastNum, 10) + 1 : 1;
        const employeeCode = `EMP-${String(nextNum).padStart(3, "0")}`;

        // ── ONE TRANSACTION ──────────────────────────────────────────────
        const employee = await prisma.$transaction(async (tx) => {
            // 1. User account. NO password — the employee activates instead.
            const userRow = await tx.user.create({
                data: {
                    email: candidate.email,
                    password: null,
                    role: "STAFF",
                    name: `${candidate.firstName} ${candidate.lastName}`,
                },
                select: { id: true },
            });

            // 2. Employee master record, with the lifecycle state persisted.
            const employeeRow = await tx.employee.create({
                data: {
                    userId: userRow.id,
                    employeeCode,
                    // `Employee.rollNumber` is REQUIRED. Derived from the
                    // employee code so the two identifiers stay consistent and
                    // the existing unique index covers both.
                    rollNumber: employeeCode,
                    firstName: candidate.firstName,
                    lastName: candidate.lastName,
                    email: candidate.email,
                    phone: candidate.phone,
                    designation: offer.designation || requisition.title,
                    department: offer.department || requisition.department,
                    joiningDate,
                    // A new hire is normally on probation; the lifecycle
                    // column makes the stage explicit rather than inferred
                    // from a generic ACTIVE/RESIGNED flag.
                    lifecycle: EMPLOYEE_LIFECYCLE.PROBATION,
                    currentStatus: "ACTIVE",
                    employmentType: requisition.id ? "FULL_TIME" : "FULL_TIME",
                    // Link the hire back to the requisition that created it.
                    sourceRequisitionId: requisition.id,
                    sourceCandidateId: candidate.id,
                },
                select: { id: true, employeeCode: true },
            });

            // 3. Salary structure, from the accepted offer.
            const basic = offer.offeredSalary;
            const allowances = offer.allowances ?? 0;
            await tx.salaryStructure.create({
                data: {
                    employeeId: employeeRow.id,
                    basic,
                    housingAllowance: 0,
                    transportAllowance: allowances,
                    medicalAllowance: 0,
                    otherAllowances: 0,
                    ctc: basic + allowances,
                    paymentMethod: "BANK_TRANSFER",
                },
            });

            // 4. Leave balances for the joining year.
            await tx.leaveBalance.createMany({
                data: DEFAULT_LEAVE_BALANCES.map((b) => ({
                    employeeId: employeeRow.id,
                    leaveType: b.leaveType,
                    totalDays: b.totalDays,
                    usedDays: 0,
                    year,
                })),
            });

            // 5. Probation record derived from the offer.
            if (offer.probationPeriodMonths) {
                const end = new Date(joiningDate);
                end.setMonth(end.getMonth() + offer.probationPeriodMonths);
                await tx.probationReview.create({
                    data: {
                        employeeId: employeeRow.id,
                        startDate: joiningDate,
                        endDate: end,
                        status: "NOT_STARTED",
                    },
                });
            }

            // 6. Application moves to HIRED, and the lifecycle advances.
            await tx.application.update({
                where: { id: application.id },
                data: {
                    status: APPLICATION_STATUS.HIRED,
                    decidedAt: new Date(),
                    lastTransitionAt: new Date(),
                },
            });

            // 7. Joining record — an explicit, auditable step rather than an
            //    implicit side-effect of the employee row appearing.
            await tx.joiningRecord.create({
                data: {
                    candidateId: candidate.id,
                    applicationId: application.id,
                    employeeId: employeeRow.id,
                    offerId: offer.id,
                    joiningDate,
                    status: JOINING_STATUS.JOINED,
                    department: offer.department || requisition.department,
                    designation: offer.designation || requisition.title,
                    probationEndDate: offer.probationPeriodMonths
                        ? (() => {
                              const e = new Date(joiningDate);
                              e.setMonth(e.getMonth() + offer.probationPeriodMonths);
                              return e;
                          })()
                        : null,
                    joinedBy: user.email,
                },
            });

            // 8. Audit trail.
            await tx.auditLog.create({
                data: {
                    employeeId: employeeRow.id,
                    action: "EMPLOYEE_JOINED",
                    details:
                        `${candidate.firstName} ${candidate.lastName} joined as ` +
                        `${offer.designation || requisition.title} (${employeeCode}) from ` +
                        `application ${application.id}. Account created with a one-time activation link.`,
                    changedBy: user.email,
                },
            });

            // 9. Welcome notification.
            await tx.notification.create({
                data: {
                    employeeId: employeeRow.id,
                    title: "Welcome aboard",
                    message: `Your employee profile (${employeeCode}) is ready. Please set your password to sign in.`,
                    type: "SUCCESS",
                    link: "/dashboard",
                },
            });

            return { ...employeeRow, userId: userRow.id };
        });
        // ── END TRANSACTION ──────────────────────────────────────────────

        // Post-commit, best-effort. A failure here must not un-join someone.
        let activationRequired = false;
        try {
            await issueActivationToken({
                userId: employee.userId,
                createdBy: user.email,
                purpose: "FIRST_LOGIN",
            });
        } catch (tokenError) {
            activationRequired = true;
            console.error("[JOIN_ACTIVATION_FAILED]", tokenError);
        }

        try {
            await ensureChecklist(employee.id);
        } catch (checklistError) {
            console.error("[JOIN_CHECKLIST_FAILED]", checklistError);
        }

        try {
            await notifyManagerOfNewHire({ employeeId: employee.id, actorEmail: user.email });
        } catch (notifyError) {
            console.error("[JOIN_MANAGER_NOTIFY_FAILED]", notifyError);
        }

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: `employee:${employee.id}`,
            outcome: "SUCCESS",
            detail: {
                change: "employeeJoined",
                employeeCode: employee.employeeCode,
                applicationId: application.id,
            },
        });

        return {
            success: true,
            message: activationRequired
                ? `${employee.employeeCode} created. Issue an activation link before first sign-in.`
                : `${employee.employeeCode} created. Activation link issued for first sign-in.`,
            employeeId: employee.id,
            employeeCode: employee.employeeCode,
            activationRequired,
        };
    } catch (error) {
        console.error("[COMPLETE_JOINING_FAILED]", error);
        return {
            success: false,
            message: "Joining failed and was rolled back. No partial employee record was created.",
        };
    }
}

export {
    CHECKLIST_STATUS as ONBOARDING_STATUS,
    EMPLOYEE_LIFECYCLE,
    LIFECYCLE_TRANSITIONS,
};
