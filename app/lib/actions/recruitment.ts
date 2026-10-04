"use server";

/**
 * Recruitment server actions (P1).
 *
 * These previously wrote the OLD schema directly (`Candidate.jobId`,
 * `Interview.interviewerId`, a free-text `Candidate.status`) with only an
 * inline role check. They are now thin wrappers over
 * `lib/workflow/recruitment.ts`, which owns authorization, the state machines,
 * transactions and audit logging.
 *
 * A `"use server"` file may only export async functions, so these delegate
 * rather than re-export.
 */

import {
    createRequisition,
    transitionRequisition,
    applyToJob,
    recordScreening,
    scheduleInterview as scheduleInterviewCore,
    submitInterviewFeedback,
    createOffer,
    transitionOffer,
    markHired,
} from "@/lib/workflow/recruitment";
import { requireUser } from "@/lib/auth/guards";
import { getSessionUser } from "@/lib/auth/guards";

export type ActionResult = { success: boolean; message: string; id?: string };

/* ---------------------------------------------------------------- */
/* §3 — Job requisition                                              */
/* ---------------------------------------------------------------- */

export async function createJobRequisition(
    _prevState: unknown,
    formData: FormData
): Promise<ActionResult> {
    const user = await requireUser();

    const num = (key: string): number | undefined => {
        const raw = formData.get(key);
        if (typeof raw !== "string" || raw.trim() === "") return undefined;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    const str = (key: string): string | undefined => {
        const raw = formData.get(key);
        return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    };

    const targetJoiningDate = str("targetJoiningDate");
    const consentGiven = formData.get("consentGiven") === "on" || formData.get("consentGiven") === "true";

    return createRequisition({
        title: str("title") ?? "",
        department: str("department") ?? "",
        location: str("location"),
        employmentType: str("employmentType") ?? "FULL_TIME",
        positionsCount: num("positionsCount") ?? 1,
        positionType: str("positionType") ?? "NEW_POSITION",
        reason: str("reason"),
        requiredSkills: str("requiredSkills"),
        minSalary: num("minSalary"),
        maxSalary: num("maxSalary"),
        priority: str("priority") ?? "MEDIUM",
        targetJoiningDate: targetJoiningDate ? new Date(targetJoiningDate) : undefined,
        // `applyToJob` requires explicit consent; a requisition does not.
        actor: { id: user.id, email: user.email, role: user.role, employeeId: user.employeeId },
        consentGiven,
    } as Parameters<typeof createRequisition>[0] & { consentGiven: boolean });
}

export async function moveRequisition(requisitionId: string, to: string, note?: string): Promise<ActionResult> {
    return transitionRequisition({ requisitionId, to, note });
}

/* ---------------------------------------------------------------- */
/* §5/§6 — Candidate application                                     */
/* ---------------------------------------------------------------- */

export async function submitCandidateApplication(
    _prevState: unknown,
    formData: FormData
): Promise<ActionResult> {
    const user = await requireUser();
    const str = (key: string): string | undefined => {
        const raw = formData.get(key);
        return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    };
    const num = (key: string): number | undefined => {
        const raw = formData.get(key);
        if (typeof raw !== "string" || raw.trim() === "") return undefined;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    const resume = formData.get("resumeFile");
    if (!(resume instanceof File) || resume.size === 0) {
        return { success: false, message: "Attach the candidate's resume as a PDF." };
    }
    if (resume.size > 5 * 1024 * 1024) {
        return { success: false, message: "The resume PDF must be 5 MB or smaller." };
    }
    const resumeBytes = new Uint8Array(await resume.arrayBuffer());
    if (new TextDecoder().decode(resumeBytes.slice(0, 5)) !== "%PDF-") {
        return { success: false, message: "The resume must be a valid PDF file." };
    }

    return applyToJob({
        jobRequisitionId: str("jobId") ?? str("jobRequisitionId") ?? "",
        firstName: str("firstName") ?? "",
        lastName: str("lastName") ?? "",
        email: str("email") ?? "",
        phone: str("phone"),
        nationality: str("nationality"),
        currentLocation: str("currentLocation"),
        resumeData: resumeBytes,
        resumeFileName: resume.name.split(/[\\/]/).pop()?.slice(0, 180) || "resume.pdf",
        skills: str("skills"),
        currentEmployer: str("currentEmployer"),
        currentPosition: str("currentPosition"),
        expectedSalary: num("expectedSalary"),
        noticePeriodDays: num("noticePeriodDays"),
        source: str("source") ?? "DIRECT",
        // Consent is mandatory and is not inferred from a missing checkbox.
        consentGiven: formData.get("consentGiven") === "on" || formData.get("consentGiven") === "true",
        actor: { id: user.id, email: user.email, role: user.role, employeeId: user.employeeId },
    });
}

/* ---------------------------------------------------------------- */
/* §7 — Screening                                                    */
/* ---------------------------------------------------------------- */

export async function screenApplication(_prevState: unknown, formData: FormData): Promise<ActionResult> {
    const str = (key: string): string | undefined => {
        const raw = formData.get(key);
        return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    };
    const ratingRaw = str("rating");
    const rating = ratingRaw ? Number(ratingRaw) : undefined;

    return recordScreening({
        applicationId: str("applicationId") ?? "",
        to: str("to") ?? "",
        relevantExperience: str("relevantExperience"),
        skillsMatch: str("skillsMatch"),
        salaryMatch: str("salaryMatch"),
        noticePeriodMatch: str("noticePeriodMatch"),
        locationMatch: str("locationMatch"),
        visaStatus: str("visaStatus"),
        availability: str("availability"),
        comments: str("comments"),
        recommendation: str("recommendation"),
        rating: rating != null && Number.isFinite(rating) ? rating : undefined,
    });
}

/* ---------------------------------------------------------------- */
/* §9/§10/§11 — Interviews                                          */
/* ---------------------------------------------------------------- */

export async function scheduleInterview(_prevState: unknown, formData: FormData): Promise<ActionResult> {
    const str = (key: string): string | undefined => {
        const raw = formData.get(key);
        return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    };
    const num = (key: string): number | undefined => {
        const raw = formData.get(key);
        if (typeof raw !== "string" || raw.trim() === "") return undefined;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    // A multi-select posts repeated keys under one name.
    const interviewers = formData.getAll("interviewerIds").filter((v): v is string => typeof v === "string");

    const startAt = str("startAt");
    const endAt = str("endAt");
    if (!startAt || !endAt) {
        return { success: false, message: "Start and end time are required." };
    }

    return scheduleInterviewCore({
        candidateId: str("candidateId") ?? "",
        applicationId: str("applicationId"),
        interviewType: str("interviewType") ?? "HR",
        round: num("round") ?? 1,
        mode: str("mode") ?? "ONSITE",
        location: str("location"),
        meetingLink: str("meetingLink"),
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        coordinatorId: str("coordinatorId"),
        interviewerIds: interviewers,
    });
}

export async function submitFeedback(_prevState: unknown, formData: FormData): Promise<ActionResult> {
    const str = (key: string): string | undefined => {
        const raw = formData.get(key);
        return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    };
    const score = (key: string): number | undefined => {
        const raw = str(key);
        if (!raw) return undefined;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    return submitInterviewFeedback({
        interviewId: str("interviewId") ?? "",
        participantId: str("participantId") ?? "",
        scores: {
            technicalSkills: score("technicalSkills"),
            communication: score("communication"),
            problemSolving: score("problemSolving"),
            domainKnowledge: score("domainKnowledge"),
            teamFit: score("teamFit"),
            leadership: score("leadership"),
            overall: score("overall"),
        },
        strengths: str("strengths"),
        concerns: str("concerns"),
        comments: str("comments"),
        recommendation: str("recommendation"),
    });
}

/* ---------------------------------------------------------------- */
/* §14 — Offers                                                     */
/* ---------------------------------------------------------------- */

export async function createOfferRecord(_prevState: unknown, formData: FormData): Promise<ActionResult> {
    const str = (key: string): string | undefined => {
        const raw = formData.get(key);
        return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    };
    const salary = Number(str("offeredSalary"));

    return createOffer({
        applicationId: str("applicationId") ?? "",
        candidateId: str("candidateId") ?? "",
        offeredSalary: salary,
        designation: str("designation") ?? "",
        department: str("department") ?? "",
        joiningDate: new Date(str("joiningDate") ?? Date.now()),
        allowances: Number(str("allowances") ?? 0) || 0,
        benefits: str("benefits"),
        probationPeriodMonths: Number(str("probationPeriodMonths") ?? 0) || undefined,
        offerExpiry: str("offerExpiry") ? new Date(str("offerExpiry")!) : undefined,
        contractType: str("contractType"),
    });
}

export async function moveOffer(offerId: string, to: string, acceptanceMethod?: string): Promise<ActionResult> {
    return transitionOffer({ offerId, to, acceptanceMethod });
}

/**
 * §15 — issues the offer letter through the EXISTING letters engine. No second
 * PDF renderer is created; this writes a `Letter` row that the current
 * `generateLetterPDF` already renders.
 */
export async function issueOfferLetterAction(offerId: string): Promise<ActionResult> {
    const { issueOfferLetter } = await import("@/lib/workflow/offer-letter");
    const result = await issueOfferLetter(offerId);
    return { success: result.success, message: result.message, id: result.letterId };
}

/* ---------------------------------------------------------------- */
/* §19 — Candidate to employee                                      */
/* ---------------------------------------------------------------- */

/**
 * P1 §19: the Employee record is created at the JOINING stage, not here.
 * This marks the application hired and points at the joining workflow. Creating
 * an Employee merely because someone applied is explicitly prohibited.
 */
export async function convertCandidateToEmployee(candidateId: string): Promise<ActionResult> {
    const user = await requireUser();
    // Resolve the most recent application for this candidate.
    const application = await (await import("@/lib/prisma")).default.application.findFirst({
        where: { candidateId },
        orderBy: { appliedAt: "desc" },
        select: { id: true },
    });
    if (!application) {
        return { success: false, message: "No application found for this candidate." };
    }
    void user;
    return markHired(application.id);
}

/**
 * §19 — completes a joining. This is the ONLY path that turns a candidate into
 * an Employee, and it runs as a single transaction. An Employee is never
 * created merely because someone applied.
 */
export async function completeJoiningAction(applicationId: string, joiningDate?: string): Promise<ActionResult> {
    try {
        const user = await requireUser();
        const { completeJoining } = await import("@/lib/workflow/joining");
        const result = await completeJoining({
            applicationId,
            joiningDate,
            actor: { id: user.id, email: user.email, role: user.role, employeeId: user.employeeId },
        });
        return {
            success: result.success,
            message: result.success && result.employeeCode
                ? `${result.message} (${result.employeeCode})`
                : result.message,
            id: result.employeeId,
        };
    } catch (error) {
        console.error("[COMPLETE_JOINING_ACTION_FAILED]", error);
        return { success: false, message: "Joining failed. Nothing was changed." };
    }
}

/** Read-only helper for the recruitment screens. */
export async function getRecruitmentSummary() {
    const session = await getSessionUser();
    if (!session.ok) return { success: false as const, message: "Not authenticated" };
    return { success: true as const, role: session.user.role };
}
