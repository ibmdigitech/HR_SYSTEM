/**
 * Recruitment workflow (P1, brief §3–§16).
 *
 * One implementation, permission-checked, transactional where several records
 * change, and every status change validated against an explicit state machine.
 *
 * Key rules encoded here rather than left to the UI:
 *   - A job cannot be published before its requisition is APPROVED (§3).
 *   - A candidate is deduplicated by email, not created twice (§5).
 *   - A candidate may hold many applications, but only ONE live application per
 *     job (§6).
 *   - One interviewer can never overwrite another's feedback (§10, §11).
 *   - An interviewer cannot be scheduled on two overlapping interviews (§9).
 *   - HIRED requires an accepted offer (§6).
 */

import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { notifyInApp } from "@/lib/workflow/notifications";
import {
    REQUISITION_TRANSITIONS,
    APPLICATION_TRANSITIONS,
    INTERVIEW_TRANSITIONS,
    OFFER_TRANSITIONS,
    REQUISITION_STATUS,
    APPLICATION_STATUS,
    OFFER_STATUS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/recruitment-machine";

export interface WorkflowResult {
    success: boolean;
    message: string;
    id?: string;
}

function denied(error: unknown, fallback: string): WorkflowResult {
    if (error instanceof InvalidTransitionError) return { success: false, message: `Not permitted: ${error.message}` };
    console.error("[RECRUITMENT_WORKFLOW]", error);
    return { success: false, message: fallback };
}

/* ================================================================== */
/* §3 — Job requisition                                                 */
/* ================================================================== */

export async function createRequisition(params: {
    title: string;
    department: string;
    location?: string;
    employmentType?: string;
    positionsCount?: number;
    positionType?: string;
    reason?: string;
    requiredSkills?: string;
    minSalary?: number;
    maxSalary?: number;
    priority?: string;
    targetJoiningDate?: Date;
    actor: { id: string; email: string; role: string; employeeId: string | null };
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_CREATE);
        if (!user.employeeId) return { success: false, message: "No employee profile linked to your account." };
        if (!params.title?.trim()) return { success: false, message: "Job title is required." };
        if (!params.department?.trim()) return { success: false, message: "Department is required." };

        const count = await prisma.jobRequisition.count();
        const code = `REQ-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

        const requisition = await prisma.$transaction(async (tx) => {
            const created = await tx.jobRequisition.create({
                data: {
                    requisitionCode: code,
                    title: params.title.trim(),
                    department: params.department.trim(),
                    location: params.location ?? null,
                    employmentType: params.employmentType ?? "FULL_TIME",
                    positionsCount: params.positionsCount ?? 1,
                    positionType: params.positionType ?? "NEW_POSITION",
                    reason: params.reason ?? null,
                    requiredSkills: params.requiredSkills ?? null,
                    minSalary: params.minSalary ?? null,
                    maxSalary: params.maxSalary ?? null,
                    priority: params.priority ?? "MEDIUM",
                    targetJoiningDate: params.targetJoiningDate ?? null,
                    status: REQUISITION_STATUS.DRAFT,
                    requestedById: user.employeeId!,
                },
                select: { id: true, requisitionCode: true },
            });

            await tx.auditLog.create({
                data: {
                    employeeId: user.employeeId!,
                    action: "REQUISITION_CREATED",
                    details: `${created.requisitionCode} "${params.title}" (${params.positionsCount ?? 1} position(s))`,
                    changedBy: user.email,
                },
            });
            return created;
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: `jobRequisition:${requisition.id}`,
            outcome: "SUCCESS",
            detail: { change: "requisitionCreated", code: requisition.requisitionCode },
        });

        return { success: true, message: `Requisition ${requisition.requisitionCode} created as DRAFT.`, id: requisition.id };
    } catch (error) {
        return denied(error, "Could not create the requisition.");
    }
}

/** Moves a requisition along its approval chain, with the status machine enforced. */
export async function transitionRequisition(params: {
    requisitionId: string;
    to: string;
    note?: string;
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_APPROVE);

        const current = await prisma.jobRequisition.findUnique({
            where: { id: params.requisitionId },
            select: { id: true, status: true, title: true, requestedById: true, department: true },
        });
        if (!current) return { success: false, message: "Requisition not found." };

        try {
            assertTransition("REQUISITION", REQUISITION_TRANSITIONS, current.status, params.to, {
                actorRole: user.role,
                actorId: user.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Cannot move ${current.status} → ${params.to}.` };
            }
            throw error;
        }

        // Record which approval stage produced the change.
        const approvalField =
            params.to === REQUISITION_STATUS.MANAGER_REVIEW ? "managerApprovedById"
            : params.to === REQUISITION_STATUS.HR_REVIEW ? "hrApprovedById"
            : params.to === REQUISITION_STATUS.FINANCE_REVIEW ? "financeApprovedById"
            : null;

        await prisma.$transaction(async (tx) => {
            // Guarded on the current status so two concurrent approvals cannot
            // both succeed and double-record an approval.
            const updated = await tx.jobRequisition.updateMany({
                where: { id: params.requisitionId, status: current.status },
                data: {
                    status: params.to,
                    ...(approvalField ? { [approvalField]: user.email } : {}),
                    ...(params.to === REQUISITION_STATUS.APPROVED ? { approvedAt: new Date() } : {}),
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.auditLog.create({
                data: {
                    employeeId: current.requestedById,
                    action: `REQUISITION_${params.to}`,
                    details: `"${current.title}" ${current.status} → ${params.to}` + (params.note ? ` — ${params.note}` : ""),
                    changedBy: user.email,
                },
            });
        });

        return { success: true, message: `Requisition moved to ${params.to}.`, id: params.requisitionId };
    } catch (error) {
        if (error instanceof Error && error.message === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "Someone else moved this requisition. Reload and try again." };
        }
        return denied(error, "Could not move the requisition.");
    }
}

/* ================================================================== */
/* §5/§6 — Candidate + application, with deduplication                   */
/* ================================================================== */

export async function applyToJob(params: {
    jobRequisitionId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    nationality?: string;
    currentLocation?: string;
    resumeUrl?: string;
    skills?: string;
    currentEmployer?: string;
    currentPosition?: string;
    expectedSalary?: number;
    noticePeriodDays?: number;
    source?: string;
    consentGiven: boolean;
    actor: { id: string; email: string; role: string; employeeId: string | null };
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_CREATE);

        // GDPR-style consent gate: refuse an application without it.
        if (!params.consentGiven) {
            return { success: false, message: "Data-processing consent is required to record an application." };
        }

        const email = params.email?.trim().toLowerCase();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return { success: false, message: "A valid email address is required." };
        }
        if (!params.firstName?.trim() || !params.lastName?.trim()) {
            return { success: false, message: "First and last name are required." };
        }

        const job = await prisma.jobRequisition.findUnique({
            where: { id: params.jobRequisitionId },
            select: { id: true, title: true, status: true, department: true },
        });
        if (!job) return { success: false, message: "Job requisition not found." };

        // Only an APPROVED requisition may receive applications.
        if (job.status !== REQUISITION_STATUS.APPROVED) {
            return {
                success: false,
                message: `This requisition is ${job.status}. Applications are accepted only after approval.`,
            };
        }

        // Deduplicate: the same person is one Candidate, however many jobs they
        // apply to. The unique email index is the authority; the upsert makes
        // concurrent submissions converge instead of erroring.
        const application = await prisma.$transaction(async (tx) => {
            const candidate = await tx.candidate.upsert({
                where: { email },
                update: {
                    // Enrich on repeat, never blank an existing field.
                    ...(params.phone ? { phone: params.phone } : {}),
                    ...(params.skills ? { skills: params.skills } : {}),
                    ...(params.currentEmployer ? { currentEmployer: params.currentEmployer } : {}),
                    ...(params.consentGiven ? { consentGiven: true, consentAt: new Date() } : {}),
                },
                create: {
                    firstName: params.firstName.trim(),
                    lastName: params.lastName.trim(),
                    email,
                    phone: params.phone ?? null,
                    nationality: params.nationality ?? null,
                    currentLocation: params.currentLocation ?? null,
                    resumeUrl: params.resumeUrl ?? null,
                    skills: params.skills ?? null,
                    currentEmployer: params.currentEmployer ?? null,
                    currentPosition: params.currentPosition ?? null,
                    expectedSalary: params.expectedSalary ?? null,
                    noticePeriodDays: params.noticePeriodDays ?? null,
                    source: params.source ?? "DIRECT",
                    consentGiven: true,
                    consentAt: new Date(),
                },
                select: { id: true, firstName: true, lastName: true },
            });

            // One live application per candidate per job. A re-application
            // returns the existing record rather than creating a duplicate.
            const existing = await tx.application.findUnique({
                where: {
                    candidateId_jobRequisitionId: {
                        candidateId: candidate.id,
                        jobRequisitionId: job.id,
                    },
                },
                select: { id: true, status: true },
            });

            if (existing) {
                return { ...candidate, applicationId: existing.id, duplicate: true as const, status: existing.status };
            }

            const created = await tx.application.create({
                data: {
                    candidateId: candidate.id,
                    jobRequisitionId: job.id,
                    status: APPLICATION_STATUS.APPLIED,
                },
                select: { id: true },
            });

            await tx.auditLog.create({
                data: {
                    // The subject is a candidate, not an employee — see the note
                    // on `model AuditLog` in prisma/schema.prisma. This row used
                    // to carry the sentinel "SYSTEM", which no Employee matches,
                    // so the foreign key refused it and the whole application
                    // rolled back.
                    employeeId: null,
                    action: "APPLICATION_RECEIVED",
                    details: `${candidate.firstName} ${candidate.lastName} applied for "${job.title}"`,
                    changedBy: user.email,
                },
            });

            return { ...candidate, applicationId: created.id, duplicate: false as const, status: APPLICATION_STATUS.APPLIED };
        });

        // Notification must never fail the application.
        try {
            await notifyInApp({
                employeeId: user.employeeId ?? "SYSTEM",
                title: application.duplicate ? "Existing application" : "Application received",
                message: application.duplicate
                    ? `${application.firstName} ${application.lastName} already has an application for this role (${application.status}).`
                    : `${application.firstName} ${application.lastName} applied for "${job.title}".`,
                type: "INFO",
                link: "/recruitment",
                templateKey: "application_received",
            });
        } catch (notifyError) {
            console.error("[APPLICATION_NOTIFY_FAILED]", notifyError);
        }

        return {
            success: true,
            message: application.duplicate
                ? `This candidate already applied for this role (${application.status}).`
                : `Application received from ${application.firstName} ${application.lastName}.`,
            id: application.applicationId,
        };
    } catch (error) {
        return denied(error, "Could not record the application.");
    }
}

/* ================================================================== */
/* §7 — Screening                                                       */
/* ================================================================== */

export async function recordScreening(params: {
    applicationId: string;
    to: string;
    relevantExperience?: string;
    skillsMatch?: string;
    salaryMatch?: string;
    noticePeriodMatch?: string;
    locationMatch?: string;
    visaStatus?: string;
    availability?: string;
    comments?: string;
    /// SHORTLIST | HOLD | REJECT
    recommendation?: string;
    rating?: number;
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_EDIT);

        const application = await prisma.application.findUnique({
            where: { id: params.applicationId },
            select: { id: true, status: true, candidate: { select: { firstName: true, lastName: true } } },
        });
        if (!application) return { success: false, message: "Application not found." };

        try {
            assertTransition("APPLICATION", APPLICATION_TRANSITIONS, application.status, params.to, {
                actorRole: user.role,
                actorId: user.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Cannot screen an application in ${application.status}.` };
            }
            throw error;
        }

        if (params.rating != null && (params.rating < 0 || params.rating > 5)) {
            return { success: false, message: "Rating must be between 0 and 5." };
        }

        await prisma.$transaction(async (tx) => {
            const updated = await tx.application.updateMany({
                where: { id: params.applicationId, status: application.status },
                data: {
                    status: params.to,
                    screeningStatus: params.to,
                    screeningNotes: params.comments ?? null,
                    screeningRecommendation: params.recommendation ?? null,
                    screenedBy: user.email,
                    screenedAt: new Date(),
                    rating: params.rating ?? null,
                    lastTransitionAt: new Date(),
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            await tx.auditLog.create({
                data: {
                    // The subject is a candidate, not an employee — see the note
                    // on `model AuditLog` in prisma/schema.prisma.
                    employeeId: null,
                    action: `APPLICATION_${params.to}`,
                    details: `${application.candidate.firstName} ${application.candidate.lastName}: ` +
                        `${application.status} → ${params.to}` +
                        (params.recommendation ? ` (${params.recommendation})` : ""),
                    changedBy: user.email,
                },
            });
        });

        return { success: true, message: `Application moved to ${params.to}.`, id: params.applicationId };
    } catch (error) {
        if (error instanceof Error && error.message === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "Someone else updated this application. Reload and try again." };
        }
        return denied(error, "Could not record the screening.");
    }
}

/* ================================================================== */
/* §9/§11 — Interview scheduling with a panel                            */
/* ================================================================== */

export async function scheduleInterview(params: {
    candidateId: string;
    applicationId?: string;
    interviewType: string;
    round: number;
    mode?: string;
    location?: string;
    meetingLink?: string;
    startAt: Date;
    endAt: Date;
    coordinatorId?: string;
    interviewerIds: string[];
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_INTERVIEW);

        if (params.interviewerIds.length === 0) {
            return { success: false, message: "Select at least one interviewer." };
        }
        if (params.endAt.getTime() <= params.startAt.getTime()) {
            return { success: false, message: "The end time must be after the start time." };
        }
        if (params.startAt.getTime() < Date.now() - 60_000) {
            return { success: false, message: "The interview cannot be scheduled in the past." };
        }

        // §9: prevent an interviewer being double-booked. Overlap, not equality.
        const clash = await prisma.interviewParticipant.findFirst({
            where: {
                interviewerId: { in: params.interviewerIds },
                interview: {
                    status: { in: ["SCHEDULED", "RESCHEDULED", "IN_PROGRESS"] },
                    startAt: { lt: params.endAt },
                    endAt: { gt: params.startAt },
                },
            },
            select: { interviewerName: true, interviewId: true },
        });
        if (clash) {
            return {
                success: false,
                message: `${clash.interviewerName} is already booked at that time.`,
            };
        }

        // Candidate cannot be in two places at once either.
        const candidateClash = await prisma.interview.findFirst({
            where: {
                candidateId: params.candidateId,
                status: { in: ["SCHEDULED", "RESCHEDULED", "IN_PROGRESS"] },
                startAt: { lt: params.endAt },
                endAt: { gt: params.startAt },
            },
            select: { id: true },
        });
        if (candidateClash) {
            return { success: false, message: "This candidate already has an interview at that time." };
        }

        const names = await prisma.employee.findMany({
            where: { id: { in: params.interviewerIds } },
            select: { id: true, firstName: true, lastName: true },
        });
        if (names.length !== params.interviewerIds.length) {
            return { success: false, message: "One or more interviewers could not be found." };
        }

        const interview = await prisma.$transaction(async (tx) => {
            const created = await tx.interview.create({
                data: {
                    candidateId: params.candidateId,
                    applicationId: params.applicationId ?? null,
                    interviewType: params.interviewType,
                    round: params.round,
                    mode: params.mode ?? "ONSITE",
                    location: params.location ?? null,
                    meetingLink: params.meetingLink ?? null,
                    startAt: params.startAt,
                    endAt: params.endAt,
                    scheduledAt: params.startAt,
                    coordinatorId: params.coordinatorId ?? null,
                    status: "SCHEDULED",
                    interviewers: {
                        create: names.map((n, i) => ({
                            interviewerId: n.id,
                            interviewerName: `${n.firstName} ${n.lastName}`,
                            isLead: i === 0,
                        })),
                    },
                },
                select: { id: true },
            });

            await tx.auditLog.create({
                data: {
                    // The subject is the candidate being interviewed, not an
                    // employee — see the note on `model AuditLog` in
                    // prisma/schema.prisma. The panel is named in `details`.
                    employeeId: null,
                    action: "INTERVIEW_SCHEDULED",
                    details: `${params.interviewType} round ${params.round} with ` +
                        names.map((n) => `${n.firstName} ${n.lastName}`).join(", "),
                    changedBy: user.email,
                },
            });

            return created;
        });

        return { success: true, message: "Interview scheduled.", id: interview.id };
    } catch (error) {
        return denied(error, "Could not schedule the interview.");
    }
}

/* ================================================================== */
/* §10 — Per-interviewer feedback                                        */
/* ================================================================== */

export async function submitInterviewFeedback(params: {
    interviewId: string;
    participantId: string;
    scores: {
        technicalSkills?: number;
        communication?: number;
        problemSolving?: number;
        domainKnowledge?: number;
        teamFit?: number;
        leadership?: number;
        overall?: number;
    };
    strengths?: string;
    concerns?: string;
    comments?: string;
    /// STRONG_HIRE | HIRE | HOLD | NO_HIRE
    recommendation?: string;
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_INTERVIEW);

        // An interviewer may only submit their OWN feedback. This is the
        // isolation guarantee in §10/§11.
        const participant = await prisma.interviewParticipant.findUnique({
            where: { id: params.participantId },
            select: { id: true, interviewerId: true, interviewerName: true, interviewId: true, feedback: { select: { id: true } } },
        });
        if (!participant) return { success: false, message: "Interview participant not found." };
        if (participant.interviewId !== params.interviewId) {
            return { success: false, message: "That participant is not on this interview." };
        }
        if (participant.interviewerId !== user.employeeId && !["ADMIN", "SUPER_ADMIN", "HR"].includes(user.role)) {
            return { success: false, message: "You may only submit feedback for interviews you are on." };
        }

        // Scores are 1-5. Validated rather than clamped, so bad data is
        // rejected instead of silently reinterpreted.
        for (const [key, value] of Object.entries(params.scores)) {
            if (value == null) continue;
            if (!Number.isInteger(value) || value < 1 || value > 5) {
                return { success: false, message: `${key} must be a whole number from 1 to 5.` };
            }
        }

        const VALID = ["STRONG_HIRE", "HIRE", "HOLD", "NO_HIRE"];
        if (params.recommendation && !VALID.includes(params.recommendation)) {
            return { success: false, message: `Recommendation must be one of ${VALID.join(", ")}.` };
        }

        // The feedback row and its audit entry are written in ONE transaction.
        // They used to be two independent writes, which meant a failure in the
        // second one surfaced to the interviewer as "Could not save the
        // feedback." for a submission that had in fact already committed — the
        // feedback was on the panel but the panel member was told it was not.
        // Everything else in this file already treats the audit entry as part of
        // the change, not as a side effect of it.
        const saved = await prisma.$transaction(async (tx) => {
            // The unique key is participantId, so a second submission UPDATES
            // this interviewer's own feedback and cannot touch another
            // interviewer's.
            const row = await tx.interviewFeedback.upsert({
                where: { participantId: params.participantId },
                update: {
                    ...params.scores,
                    strengths: params.strengths ?? null,
                    concerns: params.concerns ?? null,
                    comments: params.comments ?? null,
                    recommendation: params.recommendation ?? null,
                    updatedAt: new Date(),
                },
                create: {
                    interviewId: params.interviewId,
                    participantId: params.participantId,
                    ...params.scores,
                    strengths: params.strengths ?? null,
                    concerns: params.concerns ?? null,
                    comments: params.comments ?? null,
                    recommendation: params.recommendation ?? null,
                },
                select: { id: true },
            });

            // `AuditLog.employeeId` is a real foreign key to `Employee`, so it
            // has to name a row that exists. It is the INTERVIEWER, not a
            // "SYSTEM" sentinel: the audit trail is read per employee
            // (`@@index([employeeId, createdAt])`) and this entry exists to say
            // "this interviewer's feedback was recorded", which is precisely
            // the person whose employee id the panel row already carries. Using
            // the actor here instead would file a panel member's feedback under
            // whoever happened to press the button.
            await tx.auditLog.create({
                data: {
                    employeeId: participant.interviewerId,
                    action: "INTERVIEW_FEEDBACK_SUBMITTED",
                    details: `Feedback recorded by ${participant.interviewerName}` +
                        (params.recommendation ? ` — ${params.recommendation}` : ""),
                    changedBy: user.email,
                },
            });

            return row;
        });

        return { success: true, message: "Feedback recorded.", id: saved.id };
    } catch (error) {
        return denied(error, "Could not save the feedback.");
    }
}

/* ================================================================== */
/* §14 — Offer, versioned                                                */
/* ================================================================== */

export async function createOffer(params: {
    applicationId: string;
    candidateId: string;
    offeredSalary: number;
    designation: string;
    department: string;
    joiningDate: Date;
    allowances?: number;
    benefits?: string;
    probationPeriodMonths?: number;
    offerExpiry?: Date;
    contractType?: string;
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_OFFER);

        if (!Number.isFinite(params.offeredSalary) || params.offeredSalary <= 0) {
            return { success: false, message: "Offered salary must be a positive number." };
        }

        const application = await prisma.application.findUnique({
            where: { id: params.applicationId },
            select: { id: true, status: true, candidateId: true },
        });
        if (!application) return { success: false, message: "Application not found." };

        // The candidate is DERIVED from the application, not taken from the
        // request. `candidateId` arrived as a form field, so honouring it would
        // let a mismatched payload file an offer against application A in the
        // name of candidate B — and because `OfferLetter` is versioned per
        // candidate, it would also compute the version number from the wrong
        // person. The application is the only trustworthy link here.
        if (params.candidateId && params.candidateId !== application.candidateId) {
            return {
                success: false,
                message: "The candidate does not match the selected application. Reload and try again.",
            };
        }
        const candidateId = application.candidateId;

        // A candidate cannot jump from APPLIED straight to an offer.
        try {
            assertTransition("APPLICATION", APPLICATION_TRANSITIONS, application.status, APPLICATION_STATUS.OFFERED, {
                actorRole: user.role,
                actorId: user.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return {
                    success: false,
                    message: `An offer can only follow SELECTED. This application is ${application.status}.`,
                };
            }
            throw error;
        }

        // Next version, so a revised offer never overwrites the previous one.
        const latest = await prisma.offerLetter.findFirst({
            where: { candidateId },
            orderBy: { version: "desc" },
            select: { id: true, version: true },
        });
        const version = (latest?.version ?? 0) + 1;

        const offer = await prisma.$transaction(async (tx) => {
            const created = await tx.offerLetter.create({
                data: {
                    candidateId,
                    applicationId: params.applicationId,
                    offeredSalary: params.offeredSalary,
                    allowances: params.allowances ?? 0,
                    designation: params.designation,
                    department: params.department,
                    joiningDate: params.joiningDate,
                    probationPeriodMonths: params.probationPeriodMonths ?? null,
                    offerExpiry: params.offerExpiry ?? null,
                    contractType: params.contractType ?? null,
                    benefits: params.benefits ?? null,
                    offeredById: user.email,
                    status: OFFER_STATUS.DRAFT,
                    version,
                },
                select: { id: true, version: true },
            });

            if (latest) {
                await tx.offerLetter.update({
                    where: { id: latest.id },
                    data: { supersededById: created.id },
                });
            }

            await tx.application.update({
                where: { id: params.applicationId },
                data: { status: APPLICATION_STATUS.OFFERED, lastTransitionAt: new Date() },
            });

            await tx.auditLog.create({
                data: {
                    // The subject is a candidate, not an employee — see the note
                    // on `model AuditLog` in prisma/schema.prisma. Filing this
                    // under the acting recruiter would be the same mistake the
                    // interview-feedback fix corrected: it would put a hiring
                    // event in that person's per-employee trail.
                    employeeId: null,
                    action: "OFFER_CREATED",
                    details: `Offer v${version} for candidate ${candidateId}: ${params.designation} @ ${params.offeredSalary}`,
                    changedBy: user.email,
                },
            });

            return created;
        });

        return { success: true, message: `Offer v${version} created as DRAFT.`, id: offer.id };
    } catch (error) {
        return denied(error, "Could not create the offer.");
    }
}

/** Moves an offer, e.g. DRAFT → PENDING_APPROVAL → APPROVED → SENT. */
export async function transitionOffer(params: {
    offerId: string;
    to: string;
    acceptanceMethod?: string;
    acceptedBy?: string;
}): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_OFFER);

        const offer = await prisma.offerLetter.findUnique({
            where: { id: params.offerId },
            select: { id: true, status: true, version: true, candidateId: true, applicationId: true, supersededById: true },
        });
        if (!offer) return { success: false, message: "Offer not found." };

        // A superseded offer is history and must not be acted on.
        if (offer.supersededById) {
            return { success: false, message: "This offer version has been superseded." };
        }

        try {
            assertTransition("OFFER", OFFER_TRANSITIONS, offer.status, params.to, {
                actorRole: user.role,
                actorId: user.id,
            });
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return { success: false, message: `Cannot move offer from ${offer.status} to ${params.to}.` };
            }
            throw error;
        }

        const isAcceptance = params.to === OFFER_STATUS.ACCEPTED;

        await prisma.$transaction(async (tx) => {
            const updated = await tx.offerLetter.updateMany({
                where: { id: params.offerId, status: offer.status },
                data: {
                    status: params.to,
                    ...(params.to === OFFER_STATUS.APPROVED ? { approvedById: user.email, approvedAt: new Date() } : {}),
                    ...(isAcceptance ? { acceptedAt: new Date(), acceptanceMethod: params.acceptanceMethod ?? "ONLINE" } : {}),
                    ...(params.to === OFFER_STATUS.DECLINED ? { declinedAt: new Date() } : {}),
                },
            });
            if (updated.count === 0) throw new Error("CONCURRENT_MODIFICATION");

            // Acceptance advances the application, which is what later permits
            // the HIRED transition.
            if (isAcceptance && offer.applicationId) {
                await tx.application.update({
                    where: { id: offer.applicationId },
                    data: { status: APPLICATION_STATUS.OFFER_ACCEPTED, lastTransitionAt: new Date() },
                });
            }

            await tx.auditLog.create({
                data: {
                    // The subject is a candidate, not an employee — see the note
                    // on `model AuditLog` in prisma/schema.prisma.
                    employeeId: null,
                    action: `OFFER_${params.to}`,
                    details: `Offer v${offer.version} ${offer.status} → ${params.to}`,
                    changedBy: user.email,
                },
            });
        });

        return { success: true, message: `Offer moved to ${params.to}.`, id: params.offerId };
    } catch (error) {
        if (error instanceof Error && error.message === "CONCURRENT_MODIFICATION") {
            return { success: false, message: "Someone else moved this offer. Reload and try again." };
        }
        return denied(error, "Could not move the offer.");
    }
}

/** §6: the final hire step. Refused unless an offer was accepted. */
export async function markHired(applicationId: string): Promise<WorkflowResult> {
    try {
        const user = await requirePermission(PERMISSIONS.RECRUITMENT_CONVERT);

        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            select: {
                id: true,
                status: true,
                candidateId: true,
                offers: { select: { id: true, status: true }, orderBy: { version: "desc" }, take: 1 },
            },
        });
        if (!application) return { success: false, message: "Application not found." };

        const hasAcceptedOffer = application.offers[0]?.status === OFFER_STATUS.ACCEPTED;

        try {
            assertTransition(
                "APPLICATION",
                APPLICATION_TRANSITIONS,
                application.status,
                APPLICATION_STATUS.HIRED,
                { actorRole: user.role, actorId: user.id, data: { hasAcceptedOffer } }
            );
        } catch (error) {
            if (error instanceof InvalidTransitionError) {
                return {
                    success: false,
                    message: hasAcceptedOffer
                        ? `Cannot mark HIRED from ${application.status}.`
                        : "An accepted offer is required before this candidate can be hired.",
                };
            }
            throw error;
        }

        // Status and audit trail move together. They were two separate awaited
        // calls, so an audit failure left the application marked HIRED on disk
        // while the caller was told the whole thing failed — the false negative
        // the interview-feedback fix removed from the feedback path.
        await prisma.$transaction(async (tx) => {
            await tx.application.update({
                where: { id: applicationId },
                data: { status: APPLICATION_STATUS.HIRED, decidedAt: new Date(), lastTransitionAt: new Date() },
            });

            await tx.auditLog.create({
                data: {
                    // The subject is a candidate, not an employee — which is
                    // exactly what the next line says, and §19 is why. See the
                    // note on `model AuditLog` in prisma/schema.prisma.
                    employeeId: null,
                    action: "APPLICATION_HIRED",
                    details: "Candidate marked as hired. Employee record is created at joining (§19).",
                    changedBy: user.email,
                },
            });
        });

        return {
            success: true,
            message: "Marked as hired. Create the Employee record at the joining stage.",
            id: applicationId,
        };
    } catch (error) {
        return denied(error, "Could not mark the application as hired.");
    }
}

export {
    REQUISITION_STATUS,
    APPLICATION_STATUS,
    OFFER_STATUS,
};
