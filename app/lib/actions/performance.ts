"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { requireAnyPermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";

export type PerformanceResult<T = any> =
    | { success: true; data: T }
    | { success: false; error: string; data?: undefined };

/* ------------------------------------------------------------------ */
/* Performance Cycles                                                  */
/* ------------------------------------------------------------------ */

export async function getPerformanceCycles(): Promise<PerformanceResult<any[]>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    try {
        const cycles = await prisma.performanceCycle.findMany({
            orderBy: { startDate: "desc" },
            include: {
                createdBy: { select: { name: true, email: true } },
                _count: { select: { reviews: true } }
            }
        });
        return { success: true, data: cycles };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function getPerformanceCycleById(id: string): Promise<PerformanceResult<any>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    try {
        const cycle = await prisma.performanceCycle.findUnique({
            where: { id },
            include: {
                createdBy: { select: { name: true, email: true } },
                reviews: {
                    include: {
                        subject: { select: { firstName: true, lastName: true, employeeCode: true } },
                        manager: { select: { firstName: true, lastName: true } },
                    }
                }
            }
        });
        if (!cycle) return { success: false, error: "Cycle not found" };
        return { success: true, data: cycle };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

const DEFAULT_PERFORMANCE_QUESTIONS: Record<string, { text: string; type: string; order: number }[]> = {
    YEARLY: [
        { text: "How did you perform against your annual KPIs and agreed targets?", type: "KPI", order: 1 },
        { text: "What were your most important contributions and measurable results this year?", type: "COMPETENCY", order: 2 },
        { text: "How effectively did you collaborate and demonstrate our workplace values?", type: "BEHAVIORAL", order: 3 },
        { text: "What skills or development goals will help you succeed next year?", type: "OPEN_ENDED", order: 4 },
    ],
    HALF_YEARLY: [
        { text: "How are you progressing against your half-year KPIs and targets?", type: "KPI", order: 1 },
        { text: "Which results have had the greatest impact during this half-year?", type: "COMPETENCY", order: 2 },
        { text: "What has helped or blocked your performance during this half-year?", type: "OPEN_ENDED", order: 3 },
        { text: "What are your top priorities for the next half-year?", type: "OPEN_ENDED", order: 4 },
    ],
    QUARTERLY: [
        { text: "How did you perform against your quarterly KPIs and targets?", type: "KPI", order: 1 },
        { text: "What key outcomes did you deliver this quarter?", type: "COMPETENCY", order: 2 },
        { text: "What obstacles affected your work, and what support would help?", type: "OPEN_ENDED", order: 3 },
        { text: "What are your main priorities for the next quarter?", type: "OPEN_ENDED", order: 4 },
    ],
};
export async function createPerformanceCycle(formData: FormData): Promise<PerformanceResult<any>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW]);

    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    const name = formData.get("name") as string;
    const type = formData.get("type") as string;
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    const selfAssessmentEnabled = formData.get("selfAssessmentEnabled") === "true";
    const managerReviewEnabled = formData.get("managerReviewEnabled") === "true";
    const calibrationEnabled = formData.get("calibrationEnabled") === "true";

    if (!DEFAULT_PERFORMANCE_QUESTIONS[type]) {
        return { success: false, error: "Choose a valid performance period" };
    }
    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);
    if (Number.isNaN(parsedStartDate.getTime()) || Number.isNaN(parsedEndDate.getTime()) || parsedStartDate > parsedEndDate) {
        return { success: false, error: "Enter a valid date range" };
    }
    if (!name || !type || !startDate || !endDate) {
        return { success: false, error: "Missing required fields" };
    }

    try {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return { success: false, error: "User not found" };

        const cycle = await prisma.$transaction(async (tx) => {
            const createdCycle = await tx.performanceCycle.create({
                data: {
                    name,
                    type,
                    startDate: parsedStartDate,
                    endDate: parsedEndDate,
                    selfAssessmentEnabled,
                    managerReviewEnabled,
                    calibrationEnabled,
                    createdById: user.id,
                },
            });
            await tx.performanceQuestion.createMany({
                data: DEFAULT_PERFORMANCE_QUESTIONS[type].map((question) => ({
                    ...question,
                    cycleId: createdCycle.id,
                    audience: "BOTH",
                    weight: 1,
                    isRequired: true,
                })),
            });
            return createdCycle;
        });

        revalidatePath("/performance");
        return { success: true, data: cycle };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

/** Add a question to a planning cycle so its questionnaire is ready before launch. */
export async function addPerformanceQuestion(formData: FormData): Promise<PerformanceResult<{ id: string }>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW]);

    const cycleId = String(formData.get("cycleId") ?? "").trim();
    const text = String(formData.get("text") ?? "").trim();
    const type = String(formData.get("type") ?? "");
    const audience = String(formData.get("audience") ?? "BOTH");
    const isRequired = formData.get("isRequired") === "on";

    if (!cycleId) return { success: false, error: "Choose a performance cycle" };
    if (text.length < 8 || text.length > 500) {
        return { success: false, error: "Question must be between 8 and 500 characters" };
    }
    if (!["KPI", "COMPETENCY", "BEHAVIORAL", "GOAL", "OPEN_ENDED"].includes(type)) {
        return { success: false, error: "Choose a valid question type" };
    }
    if (!["EMPLOYEE", "MANAGER", "BOTH"].includes(audience)) {
        return { success: false, error: "Choose a valid audience" };
    }

    try {
        const cycle = await prisma.performanceCycle.findUnique({
            where: { id: cycleId },
            select: { id: true, status: true },
        });
        if (!cycle) return { success: false, error: "Performance cycle not found" };
        if (cycle.status !== "PLANNING") {
            return { success: false, error: "Questions can only be added while a cycle is in planning" };
        }

        const lastQuestion = await prisma.performanceQuestion.findFirst({
            where: { cycleId },
            orderBy: { order: "desc" },
            select: { order: true },
        });
        const question = await prisma.performanceQuestion.create({
            data: {
                cycleId,
                text,
                type,
                audience,
                isRequired,
                weight: 1,
                order: (lastQuestion?.order ?? 0) + 1,
            },
            select: { id: true },
        });

        revalidatePath("/performance");
        revalidatePath(`/performance/cycles/${cycleId}`);
        return { success: true, data: question };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Unable to add question" };
    }
}

/* ------------------------------------------------------------------ */
/* Performance Reviews                                                 */
/* ------------------------------------------------------------------ */

export async function getPerformanceReviews(cycleId?: string): Promise<PerformanceResult<any[]>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    try {
        const where = cycleId ? { cycleId } : {};
        const reviews = await prisma.performanceReview.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                cycle: { select: { name: true, type: true } },
                subject: { select: { firstName: true, lastName: true, employeeCode: true, designation: true, department: true } },
                manager: { select: { firstName: true, lastName: true } },
                goals: true,
                answers: { include: { question: true } },
            }
        });
        return { success: true, data: reviews };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function getPerformanceReviewById(id: string): Promise<PerformanceResult<any>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    try {
        const review = await prisma.performanceReview.findUnique({
            where: { id },
            include: {
                cycle: true,
                subject: { select: { firstName: true, lastName: true, employeeCode: true, designation: true, department: true } },
                manager: { select: { firstName: true, lastName: true } },
                goals: { orderBy: { order: "asc" } },
                answers: { include: { question: true } },
            }
        });
        if (!review) return { success: false, error: "Review not found" };
        return { success: true, data: review };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function createPerformanceReview(formData: FormData): Promise<PerformanceResult<any>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW]);

    const cycleId = formData.get("cycleId") as string;
    const employeeId = formData.get("employeeId") as string;

    if (!cycleId || !employeeId) {
        return { success: false, error: "Missing required fields" };
    }

    try {
        const cycle = await prisma.performanceCycle.findUnique({ where: { id: cycleId } });
        if (!cycle) return { success: false, error: "Cycle not found" };

        const existing = await prisma.performanceReview.findFirst({
            where: { cycleId, employeeId }
        });
        if (existing) return { success: false, error: "Review already exists for this employee in this cycle" };

        const review = await prisma.performanceReview.create({
            data: {
                cycleId,
                employeeId,
                status: "DRAFT",
            }
        });

        revalidatePath("/performance");
        return { success: true, data: review };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function updatePerformanceReview(id: string, formData: FormData): Promise<PerformanceResult<any>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    const status = formData.get("status") as string;
    const overallRating = formData.get("overallRating") as string;
    const overallComment = formData.get("overallComment") as string;
    const managerId = formData.get("managerId") as string;

    try {
        const data: any = {};
        if (status) data.status = status;
        if (overallRating) data.overallRating = parseFloat(overallRating);
        if (overallComment) data.overallComment = overallComment;
        if (managerId) data.managerId = managerId;

        if (status === "SELF_ASSESSMENT") data.selfAssessmentAt = new Date();
        if (status === "MANAGER_REVIEW") data.managerReviewAt = new Date();
        if (status === "CALIBRATION") data.calibrationAt = new Date();
        if (status === "APPROVED") data.approvedAt = new Date();

        const review = await prisma.performanceReview.update({
            where: { id },
            data
        });

        revalidatePath("/performance");
        return { success: true, data: review };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

/* ------------------------------------------------------------------ */
/* Performance Goals                                                    */
/* ------------------------------------------------------------------ */

export async function createPerformanceGoal(formData: FormData): Promise<PerformanceResult<any>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_REVIEW]);

    const reviewId = formData.get("reviewId") as string;
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const weight = parseFloat(formData.get("weight") as string) || 1;
    const target = formData.get("target") as string;
    const order = parseInt(formData.get("order") as string) || 0;

    if (!reviewId || !title || !target) {
        return { success: false, error: "Missing required fields" };
    }

    try {
        const goal = await prisma.performanceGoal.create({
            data: {
                reviewId,
                title,
                description,
                weight,
                target,
                order,
            }
        });

        revalidatePath("/performance");
        return { success: true, data: goal };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function updatePerformanceGoal(id: string, formData: FormData): Promise<PerformanceResult<any>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_REVIEW]);

    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const weight = formData.get("weight") as string;
    const target = formData.get("target") as string;
    const actual = formData.get("actual") as string;
    const rating = formData.get("rating") as string;
    const comment = formData.get("comment") as string;

    try {
        const data: any = {};
        if (title) data.title = title;
        if (description) data.description = description;
        if (weight) data.weight = parseFloat(weight);
        if (target) data.target = target;
        if (actual) data.actual = actual;
        if (rating) {

            const numericRating = Number(rating);
            if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
                return { success: false, error: "Rating must be from one to five stars" };
            }
            data.rating = numericRating;
        }
        if (comment) data.comment = comment;

        const existingGoal = await prisma.performanceGoal.findUnique({ where: { id }, select: { reviewId: true } });
        if (!existingGoal) return { success: false, error: "KPI or goal not found" };
        const goal = await prisma.performanceGoal.update({ where: { id }, data });
        revalidatePath(`/performance/reviews/${existingGoal.reviewId}`);
        revalidatePath("/performance");
        return { success: true, data: goal };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

/* ------------------------------------------------------------------ */
/* Performance Questions & Answers                                      */
/* ------------------------------------------------------------------ */

export async function getPerformanceQuestions(cycleId: string): Promise<PerformanceResult<any[]>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    try {
        let questions = await prisma.performanceQuestion.findMany({ where: { cycleId }, orderBy: { order: "asc" } });
        if (questions.length === 0) {
            const cycle = await prisma.performanceCycle.findUnique({ where: { id: cycleId }, select: { type: true } });
            const defaults = cycle ? DEFAULT_PERFORMANCE_QUESTIONS[cycle.type] : undefined;
            if (defaults) {
                await prisma.performanceQuestion.createMany({
                    data: defaults.map((question) => ({
                        ...question,
                        cycleId,
                        audience: "BOTH",
                        weight: 1,
                        isRequired: true,
                    })),
                });
                questions = await prisma.performanceQuestion.findMany({ where: { cycleId }, orderBy: { order: "asc" } });
            }
        }
        return { success: true, data: questions };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function submitPerformanceAnswer(formData: FormData): Promise<PerformanceResult<any>> {
    const user = await requireAnyPermission([PERMISSIONS.PERFORMANCE_REVIEW]);

    const reviewId = String(formData.get("reviewId") ?? "");
    const questionId = String(formData.get("questionId") ?? "");
    const answer = String(formData.get("answer") ?? "").trim();
    const ratingValue = Number(formData.get("rating"));

    if (!reviewId || !questionId || !Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
        return { success: false, error: "Choose a rating from one to five stars" };
    }

    try {
        const [review, question] = await Promise.all([
            prisma.performanceReview.findUnique({
                where: { id: reviewId },
                select: { id: true, cycleId: true, employeeId: true, managerId: true },
            }),
            prisma.performanceQuestion.findUnique({
                where: { id: questionId },
                select: { id: true, cycleId: true, audience: true },
            }),
        ]);
        if (!review || !question || review.cycleId !== question.cycleId) {
            return { success: false, error: "Question does not belong to this review" };
        }

        const answeredBy = user.employeeId === review.employeeId
            ? "EMPLOYEE"
            : user.employeeId && user.employeeId === review.managerId
                ? "MANAGER"
                : (user.role === "ADMIN" || user.role === "HR")
                    ? "MANAGER"
                    : null;
        if (!answeredBy || (question.audience !== "BOTH" && question.audience !== answeredBy)) {
            return { success: false, error: "You cannot answer this review question" };
        }

        const saved = await prisma.performanceAnswer.upsert({
            where: {
                reviewId_questionId_answeredBy: { reviewId, questionId, answeredBy },
            },
            create: { reviewId, questionId, answeredBy, answer: answer || null, rating: ratingValue },
            update: { answer: answer || null, rating: ratingValue },
        });
        revalidatePath(`/performance/reviews/${reviewId}`);
        revalidatePath("/performance");
        return { success: true, data: saved };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

/* ------------------------------------------------------------------ */
/* Review Scenarios                                                    */
/* ------------------------------------------------------------------ */

export async function getReviewScenarios(): Promise<PerformanceResult<any[]>> {
    await requireAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    try {
        const scenarios = await prisma.reviewScenario.findMany({
            orderBy: { order: "asc" }
        });
        return { success: true, data: scenarios };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}
