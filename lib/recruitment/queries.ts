import "server-only";
import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/guards";
import { redirect } from "next/navigation";

/**
 * Recruitment read models (P1).
 *
 * Every read goes through the centralized guard — a hidden nav item is not
 * access control. Scope: a user without `recruitment.view` is redirected rather
 * than shown an empty list, so the screen itself is not an information leak.
 */

export const RECRUITMENT_PAGE_SIZE = 20;

/** Redirects unless the caller may read recruitment data. */
export async function requireRecruitmentAccess() {
    const session = await getSessionUser();
    if (!session.ok) redirect("/login");
    await requirePermission(PERMISSIONS.RECRUITMENT_VIEW);
    return session.user;
}

export interface InterviewListItem {
    id: string;
    status: string;
    interviewType: string;
    round: number;
    mode: string;
    location: string | null;
    meetingLink: string | null;
    startAt: Date;
    endAt: Date;
    candidateName: string;
    candidateEmail: string;
    jobTitle: string | null;
    requisitionCode: string | null;
    panel: { id: string; name: string; isLead: boolean; hasFeedback: boolean }[];
    /** True when every panel member has submitted feedback. */
    feedbackComplete: boolean;
}

/**
 * Interview list with the panel and feedback completeness inlined, so the
 * screen does not need N+1 follow-up requests per row.
 */
export async function listInterviews(params?: {
    status?: string;
    round?: number;
    page?: number;
}): Promise<{ items: InterviewListItem[]; total: number; page: number; pageSize: number }> {
    await requireRecruitmentAccess();

    const page = Math.max(1, params?.page ?? 1);
    const pageSize = RECRUITMENT_PAGE_SIZE;

    const where = {
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.round ? { round: params.round } : {}),
    };

    const [total, rows] = await Promise.all([
        prisma.interview.count({ where }),
        prisma.interview.findMany({
            where,
            orderBy: { startAt: "asc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                status: true,
                interviewType: true,
                round: true,
                mode: true,
                location: true,
                meetingLink: true,
                startAt: true,
                endAt: true,
                candidate: { select: { firstName: true, lastName: true, email: true } },
                application: {
                    select: {
                        jobRequisition: { select: { title: true, requisitionCode: true } },
                    },
                },
                interviewers: {
                    select: {
                        id: true,
                        interviewerName: true,
                        isLead: true,
                        // One boolean per panel member, computed in the query
                        // rather than by fetching each feedback separately.
                        feedback: { select: { id: true }, take: 1 },
                    },
                },
            },
        }),
    ]);

    return {
        total,
        page,
        pageSize,
        items: rows.map((row) => {
            const panel = row.interviewers.map((p) => ({
                id: p.id,
                name: p.interviewerName,
                isLead: p.isLead,
                hasFeedback: p.feedback.length > 0,
            }));
            return {
                id: row.id,
                status: row.status,
                interviewType: row.interviewType,
                round: row.round,
                mode: row.mode,
                location: row.location,
                meetingLink: row.meetingLink,
                startAt: row.startAt,
                endAt: row.endAt,
                candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`,
                candidateEmail: row.candidate.email,
                jobTitle: row.application?.jobRequisition.title ?? null,
                requisitionCode: row.application?.jobRequisition.requisitionCode ?? null,
                panel,
                feedbackComplete: panel.length > 0 && panel.every((p) => p.hasFeedback),
            };
        }),
    };
}

export interface InterviewDetail {
    id: string;
    status: string;
    interviewType: string;
    round: number;
    mode: string;
    location: string | null;
    meetingLink: string | null;
    startAt: Date;
    endAt: Date;
    notes: string | null;
    candidate: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        phone: string | null;
        resumeUrl: string | null;
        currentEmployer: string | null;
        currentPosition: string | null;
        source: string | null;
    };
    application: {
        id: string;
        status: string;
        screeningRecommendation: string | null;
        jobRequisition: { id: string } | null;
    } | null;
    job: { id: string; title: string; requisitionCode: string | null; department: string } | null;
    /** Panel with each member's own feedback, so one interviewer never sees
     * another's as their own. */
    panel: {
        id: string;
        interviewerId: string;
        interviewerName: string;
        isLead: boolean;
        feedback: {
            id: string;
            technicalSkills: number | null;
            communication: number | null;
            problemSolving: number | null;
            domainKnowledge: number | null;
            teamFit: number | null;
            leadership: number | null;
            overall: number | null;
            strengths: string | null;
            concerns: string | null;
            comments: string | null;
            recommendation: string | null;
            submittedAt: Date;
        } | null;
    }[];
}

export async function getInterviewDetail(id: string): Promise<InterviewDetail | null> {
    await requireRecruitmentAccess();

    const row = await prisma.interview.findUnique({
        where: { id },
        select: {
            id: true,
            status: true,
            interviewType: true,
            round: true,
            mode: true,
            location: true,
            meetingLink: true,
            startAt: true,
            endAt: true,
            candidate: {
                select: {
                    id: true, firstName: true, lastName: true, email: true,
                    phone: true, resumeUrl: true, currentEmployer: true,
                    currentPosition: true, source: true,
                },
            },
            application: {
                select: {
                    id: true,
                    status: true,
                    screeningRecommendation: true,
                    jobRequisition: { select: { id: true, title: true, requisitionCode: true, department: true } },
                },
            },
            interviewers: {
                select: {
                    id: true,
                    interviewerId: true,
                    interviewerName: true,
                    isLead: true,
                    feedback: {
                        select: {
                            id: true,
                            technicalSkills: true, communication: true,
                            problemSolving: true, domainKnowledge: true,
                            teamFit: true, leadership: true, overall: true,
                            strengths: true, concerns: true, comments: true,
                            recommendation: true, submittedAt: true,
                        },
                        take: 1,
                    },
                },
            },
        },
    });

    if (!row) return null;

    return {
        id: row.id,
        status: row.status,
        interviewType: row.interviewType,
        round: row.round,
        mode: row.mode,
        location: row.location,
        meetingLink: row.meetingLink,
        startAt: row.startAt,
        endAt: row.endAt,
        notes: null,
        candidate: row.candidate,
        application: row.application
            ? {
                  id: row.application.id,
                  status: row.application.status,
                  screeningRecommendation: row.application.screeningRecommendation,
                  jobRequisition: row.application.jobRequisition
                      ? { id: row.application.jobRequisition.id }
                      : null,
              }
            : null,
        job: row.application?.jobRequisition ?? null,
        panel: row.interviewers.map((p) => ({
            id: p.id,
            interviewerId: p.interviewerId,
            interviewerName: p.interviewerName,
            isLead: p.isLead,
            feedback: p.feedback[0] ?? null,
        })),
    };
}

/**
 * Candidates that can be interviewed, and employees who can interview.
 *
 * An application is interviewable from SHORTLISTED onwards, matching the
 * Application state machine: scheduling an interview before shortlisting would
 * create an interview the pipeline does not allow.
 */
export async function getInterviewable(): Promise<{
    candidates: { id: string; name: string; applicationId: string | null; jobTitle: string | null }[];
    interviewers: { id: string; name: string }[];
}> {
    await requireRecruitmentAccess();

    const INTERVIEWABLE = ["SHORTLISTED", "INTERVIEW", "ASSESSMENT", "SELECTED", "OFFERED", "OFFER_ACCEPTED"];

    const [applications, employees] = await Promise.all([
        prisma.application.findMany({
            where: { status: { in: INTERVIEWABLE } },
            orderBy: { appliedAt: "desc" },
            select: {
                id: true,
                candidate: { select: { id: true, firstName: true, lastName: true } },
                jobRequisition: { select: { title: true } },
            },
        }),
        prisma.employee.findMany({
            where: { currentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
            orderBy: { firstName: "asc" },
            select: { id: true, firstName: true, lastName: true },
        }),
    ]);

    return {
        candidates: applications.map((a) => ({
            id: a.candidate.id,
            name: `${a.candidate.firstName} ${a.candidate.lastName}`,
            applicationId: a.id,
            jobTitle: a.jobRequisition.title,
        })),
        interviewers: employees.map((e) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`,
        })),
    };
}

/**
 * Interviews for one interviewer — the "my interviews" view.
 *
 * Scoped by the participant row, so an interviewer only ever sees interviews
 * they are actually on.
 */
export async function listMyInterviews() {
    const session = await getSessionUser();
    if (!session.ok) redirect("/login");
    if (!session.user.employeeId) return [];

    return prisma.interview.findMany({
        where: {
            interviewers: { some: { interviewerId: session.user.employeeId } },
            status: { in: ["SCHEDULED", "RESCHEDULED", "IN_PROGRESS"] },
        },
        orderBy: { startAt: "asc" },
        select: {
            id: true,
            interviewType: true,
            round: true,
            startAt: true,
            endAt: true,
            mode: true,
            location: true,
            candidate: { select: { firstName: true, lastName: true } },
            application: { select: { jobRequisition: { select: { title: true } } } },
            interviewers: {
                select: {
                    id: true,
                    feedback: { select: { id: true }, take: 1 },
                },
            },
        },
    });
}
