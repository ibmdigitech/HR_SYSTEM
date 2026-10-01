import * as React from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getPerformanceCycleById, getPerformanceReviews } from "@/app/lib/actions/performance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import {
    Users,
    ClipboardCheck,
    ArrowLeft,
    Plus,
    ArrowRight
} from "lucide-react";

export default async function PerformanceCycleDetailPage({
    params
}: {
    params: Promise<{ id: string }>
}) {
    await requirePageAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const { id } = await params;
    const [cycleRes, reviewsRes] = await Promise.all([
        getPerformanceCycleById(id),
        getPerformanceReviews(id)
    ]);

    if (!cycleRes.success || !cycleRes.data) {
        redirect("/performance");
    }

    const cycle = cycleRes.data;
    const reviews = reviewsRes.success ? reviewsRes.data : [];

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
                    <Link href="/performance">
                        <Button variant="ghost" size="icon" className="rounded-xl">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{cycle.name}</h1>
                        <p className="text-slate-500 text-sm font-medium">
                            {cycle.type} · {new Date(cycle.startDate).toLocaleDateString()} - {new Date(cycle.endDate).toLocaleDateString()}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Badge className={`font-bold px-3 py-1 rounded-full border-0 ${statusColors[cycle.status] || statusColors.DRAFT}`}>
                        {cycle.status.replace(/_/g, " ")}
                    </Badge>
                    {isAdmin && (
                        <Link href={`/performance/cycles/${id}/add-reviews`}>
                            <Button className="gap-2 rounded-xl font-bold">
                                <Plus className="h-4 w-4" />
                                Add Reviews
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            <div className="grid gap-4 sm:gap-6 md:grid-cols-4">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Reviews</CardTitle>
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <ClipboardCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{reviews.length}</div>
                    </CardContent>
                </Card>
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Draft</CardTitle>
                        <div className="p-2 bg-slate-100 dark:bg-slate-900/30 rounded-lg">
                            <ClipboardCheck className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            {reviews.filter((r: any) => r.status === "DRAFT").length}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">In Progress</CardTitle>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <ClipboardCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            {reviews.filter((r: any) => !["DRAFT", "APPROVED", "ACKNOWLEDGED"].includes(r.status)).length}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Completed</CardTitle>
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <ClipboardCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">
                            {reviews.filter((r: any) => ["APPROVED", "ACKNOWLEDGED"].includes(r.status)).length}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-4 sm:px-6 sm:py-5">
                    <CardTitle className="text-xl font-bold">Reviews in this Cycle</CardTitle>
                    <CardDescription className="font-medium text-slate-500">
                        {reviews.length} review{reviews.length !== 1 ? "s" : ""} enrolled
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {reviews.length === 0 ? (
                        <div className="p-12 text-center">
                            <Users className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">No Reviews</h3>
                            <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                                Add employees to this cycle to start the performance review process.
                            </p>
                            {isAdmin && (
                                <Link href={`/performance/cycles/${id}/add-reviews`}>
                                    <Button className="rounded-xl font-bold">
                                        <Plus className="h-4 w-4 mr-2" />
                                        Add Employees
                                    </Button>
                                </Link>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {reviews.map((review: any) => (
                                <Link
                                    key={review.id}
                                    href={`/performance/reviews/${review.id}`}
                                    className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="h-12 w-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                                            <Users className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-900 dark:text-white">
                                                {review.subject.firstName} {review.subject.lastName}
                                            </h4>
                                            <p className="text-xs text-slate-500 font-medium">
                                                {review.subject.designation} {review.manager ? `· Manager: ${review.manager.firstName} ${review.manager.lastName}` : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {review.overallRating && (
                                            <span className="text-sm font-black text-amber-600">
                                                {review.overallRating.toFixed(1)}
                                            </span>
                                        )}
                                        <Badge className={`font-bold px-3 py-1 rounded-full border-0 ${statusColors[review.status] || statusColors.DRAFT}`}>
                                            {review.status.replace(/_/g, " ")}
                                        </Badge>
                                        <ArrowRight className="h-4 w-4 text-slate-400" />
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
