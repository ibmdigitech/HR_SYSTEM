import * as React from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getPerformanceReviewById, getPerformanceQuestions } from "@/app/lib/actions/performance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { KpiRatingForm, PerformanceQuestionForm, PERFORMANCE_RATING_LABELS } from "@/components/performance/PerformanceFeedback";
import {
    ArrowLeft,
    Target,
    ClipboardList,
    BarChart3,
    ArrowRight
} from "lucide-react";

export default async function PerformanceReviewDetailPage({
    params
}: {
    params: Promise<{ id: string }>
}) {
    await requirePageAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const { id } = await params;
    const reviewRes = await getPerformanceReviewById(id);
    const questionsRes = await getPerformanceQuestions(
        reviewRes.success && reviewRes.data ? reviewRes.data.cycleId : ""
    );

    if (!reviewRes.success || !reviewRes.data) {
        redirect("/performance");
    }

    const review = reviewRes.data;
    const questions = questionsRes.success ? questionsRes.data : [];

    const statusColors: Record<string, string> = {
        DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
        SELF_ASSESSMENT: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
        MANAGER_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
        CALIBRATION: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
        APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
        ACKNOWLEDGED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
    };

    const userRole = session.user.role;
    const isAdmin = userRole === "ADMIN" || userRole === "HR";

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/performance/cycles/${review.cycleId}`}>
                        <Button variant="ghost" size="icon" className="rounded-xl">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                            {review.subject.firstName} {review.subject.lastName}
                        </h1>
                        <p className="text-slate-500 text-sm font-medium">
                            {review.cycle.name} · {review.subject.designation} · {review.subject.department}
                        </p>
                    </div>
                </div>
                <Badge className={`font-bold px-3 py-1 rounded-full border-0 ${statusColors[review.status] || statusColors.DRAFT}`}>
                    {review.status.replace(/_/g, " ")}
                </Badge>
            </div>

            {review.overallRating && (
                <Card className="bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg rounded-2xl">
                    <CardContent className="p-6 flex items-center gap-4">
                        <BarChart3 className="h-8 w-8" />
                        <div>
                            <p className="text-sm font-medium opacity-80">Overall Rating</p>
                            <p className="text-3xl font-black">{review.overallRating.toFixed(1)} <span className="text-sm font-medium opacity-80">/ 5.0</span></p>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Tabs defaultValue="goals" className="space-y-6">
                <TabsList className="bg-white dark:bg-slate-900 p-1 rounded-xl">
                    <TabsTrigger value="goals" className="gap-2 font-bold">
                        <Target className="h-4 w-4" />
                        Goals
                    </TabsTrigger>
                    <TabsTrigger value="questions" className="gap-2 font-bold">
                        <ClipboardList className="h-4 w-4" />
                        Questions
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="goals">
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl">
                        <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-4 sm:px-6 sm:py-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-xl font-bold">KPI Scorecard</CardTitle>
                                    <CardDescription className="font-medium text-slate-500">
                                        Track each KPI target, actual result, weight, and rating for this review period
                                    </CardDescription>
                                </div>
                                {isAdmin && (
                                    <Link href={`/performance/reviews/${id}/goals/new`}>
                                        <Button size="sm" className="gap-2 rounded-xl font-bold">
                                            <Target className="h-4 w-4" />
                                            Add KPI
                                        </Button>
                                    </Link>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {review.goals.length === 0 ? (
                                <div className="p-12 text-center">
                                    <Target className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">No KPIs Set</h3>
                                    <p className="text-sm text-slate-500 max-w-sm mx-auto">
                                        KPIs will appear here once added to this review.
                                    </p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {review.goals.map((goal: any) => (
                                        <div key={goal.id} className="p-4 sm:p-6">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h4 className="font-bold text-slate-900 dark:text-white">{goal.title}</h4>
                                                        <Badge variant="outline" className="text-xs">Weight {goal.weight}</Badge>
                                                    </div>
                                                    {goal.description && <p className="mt-1 text-sm text-slate-500">{goal.description}</p>}
                                                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                                                        <p><span className="font-semibold text-slate-500">Target:</span> {goal.target}</p>
                                                        <p><span className="font-semibold text-slate-500">Actual:</span> {goal.actual || "Not recorded yet"}</p>
                                                    </div>
                                                </div>
                                                {isAdmin && <KpiRatingForm goalId={goal.id} initialRating={goal.rating} initialActual={goal.actual} />}
                                            </div>
                                            {goal.rating != null && (
                                                <p className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300">
                                                    KPI rating: {goal.rating}/5 · {PERFORMANCE_RATING_LABELS[Math.round(goal.rating)] ?? "Not rated"}
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="questions">
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl">
                        <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-4 sm:px-6 sm:py-5">
                            <CardTitle className="text-xl font-bold">Questionnaire</CardTitle>
                            <CardDescription className="font-medium text-slate-500">
                                Period-specific KPI, competency, and behavior questions. Ratings use 1 Average, 2 Good, 3 Very good, 4 Excellent, and 5 Exceeds expectations.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            {questions.length === 0 ? (
                                <div className="p-12 text-center">
                                    <ClipboardList className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">No Questions</h3>
                                    <p className="text-sm text-slate-500 max-w-sm mx-auto">
                                        Questions configured for this cycle will appear here.
                                    </p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {questions.map((q: any) => {
                                        const answerRole = isAdmin ? "MANAGER" : "EMPLOYEE";
                                        const answer = review.answers.find((a: any) => a.questionId === q.id && a.answeredBy === answerRole);
                                        return (
                                            <div key={q.id} className="p-4 sm:p-6">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant="outline" className="text-xs">{q.type.replace(/_/g, " ")}</Badge>
                                                    <span className="text-xs font-medium text-slate-500">{q.audience === "BOTH" ? "Employee and manager" : q.audience.toLowerCase()}</span>
                                                </div>
                                                <p className="mt-2 font-bold text-slate-900 dark:text-white">{q.text}</p>
                                                {isAdmin ? (
                                                    <PerformanceQuestionForm
                                                        reviewId={review.id}
                                                        questionId={q.id}
                                                        initialAnswer={answer?.answer}
                                                        initialRating={answer?.rating}
                                                    />
                                                ) : answer ? (
                                                    <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                                                        <p className="font-semibold text-amber-700 dark:text-amber-300">
                                                            {answer.rating}/5 · {PERFORMANCE_RATING_LABELS[Math.round(answer.rating)] ?? "Rated"}
                                                        </p>
                                                        {answer.answer && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{answer.answer}</p>}
                                                    </div>
                                                ) : (
                                                    <p className="mt-3 text-sm text-slate-500">Not rated yet.</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
