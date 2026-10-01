import * as React from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getPerformanceCycles, getPerformanceReviews } from "@/app/lib/actions/performance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import {
    Target,
    TrendingUp,
    Users,
    Calendar,
    Plus,
    ArrowRight,
    ClipboardCheck,
    BarChart3,
    Award
} from "lucide-react";

export default async function PerformancePage() {
    await requirePageAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW, PERMISSIONS.PERFORMANCE_APPROVE]);

    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await auth();
    const userRole = session.user.role;

    const [cyclesRes, reviewsRes] = await Promise.all([
        getPerformanceCycles(),
        getPerformanceReviews()
    ]);

    const cycles = cyclesRes.success ? cyclesRes.data : [];
    const reviews = reviewsRes.success ? reviewsRes.data : [];

    const stats = {
        totalCycles: cycles.length,
        activeCycles: cycles.filter((c: any) => c.status === "ACTIVE").length,
        totalReviews: reviews.length,
        avgRating: reviews.length > 0
            ? (reviews.reduce((acc: number, r: any) => acc + (r.overallRating || 0), 0) / reviews.length).toFixed(1)
            : "0.0"
    };

    const statusColors: Record<string, string> = {
        DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
        SELF_ASSESSMENT: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
        MANAGER_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
        CALIBRATION: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
        APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
        ACKNOWLEDGED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
    };

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-violet-900 to-indigo-950 p-5 sm:p-6 md:p-8 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4"></div>

                <div className="relative z-10 min-w-0">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white mb-2">Performance</h1>
                    <p className="text-violet-100 text-sm md:text-base font-medium max-w-xl">
                        Manage review cycles, track goals, and calibrate ratings across the workforce.
                    </p>
                </div>
                <div className="relative z-10 flex flex-col sm:flex-row gap-3 flex-wrap">
                    {(userRole === "ADMIN" || userRole === "HR") && (
                        <>
                            <Link href="/performance/questions">
                                <Button variant="outline" className="gap-2 w-full sm:w-auto rounded-xl border-white/40 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white">
                                    <ClipboardCheck className="h-4 w-4" />
                                    Manage Questions
                                </Button>
                            </Link>
                            <Link href="/performance/cycles/new">
                                <Button className="gap-2 w-full sm:w-auto rounded-xl font-bold bg-white text-violet-900 hover:bg-violet-100">
                                    <Plus className="h-4 w-4" />
                                    New Cycle
                                </Button>
                            </Link>
                        </>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid gap-4 sm:gap-6 md:grid-cols-4">
                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Cycles</CardTitle>
                        <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
                            <Calendar className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{stats.totalCycles}</div>
                        <p className="text-xs font-medium text-violet-600 mt-1">Review cycles</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Active Cycles</CardTitle>
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{stats.activeCycles}</div>
                        <p className="text-xs font-medium text-emerald-600 mt-1">Currently active</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Reviews</CardTitle>
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <ClipboardCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{stats.totalReviews}</div>
                        <p className="text-xs font-medium text-indigo-600 mt-1">All time</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500 uppercase tracking-wider">Avg Rating</CardTitle>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <Award className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black text-slate-800 dark:text-white">{stats.avgRating}</div>
                        <p className="text-xs font-medium text-amber-600 mt-1">Out of 5.0</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="cycles" className="space-y-6">
                <TabsList className="bg-white dark:bg-slate-900 p-1 rounded-xl">
                    <TabsTrigger value="cycles" className="gap-2 font-bold">
                        <Calendar className="h-4 w-4" />
                        Review Cycles
                    </TabsTrigger>
                    <TabsTrigger value="reviews" className="gap-2 font-bold">
                        <ClipboardCheck className="h-4 w-4" />
                        Reviews
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="cycles">
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                        <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-4 sm:px-6 sm:py-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-xl font-bold">Performance Cycles</CardTitle>
                                    <CardDescription className="font-medium text-slate-500">
                                        Configure and track review periods
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {cycles.length === 0 ? (
                                <div className="p-12 text-center">
                                    <div className="h-16 w-16 rounded-2xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center mx-auto mb-4">
                                        <Target className="h-8 w-8 text-violet-400" />
                                    </div>
                                    <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">No Cycles Yet</h3>
                                    <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                                        Create your first performance review cycle to start tracking employee goals and feedback.
                                    </p>
                                    {(userRole === "ADMIN" || userRole === "HR") && (
                                        <Link href="/performance/cycles/new">
                                            <Button className="rounded-xl font-bold">
                                                <Plus className="h-4 w-4 mr-2" />
                                                Create First Cycle
                                            </Button>
                                        </Link>
                                    )}
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {cycles.map((cycle: any) => (
                                        <Link
                                            key={cycle.id}
                                            href={`/performance/cycles/${cycle.id}`}
                                            className="flex items-center justify-between p-4 sm:p-6 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="h-12 w-12 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                                                    <Calendar className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-slate-900 dark:text-white">{cycle.name}</h4>
                                                    <p className="text-xs text-slate-500 font-medium">
                                                        {new Date(cycle.startDate).toLocaleDateString()} - {new Date(cycle.endDate).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Badge className={`font-bold px-3 py-1 rounded-full border-0 ${statusColors[cycle.status] || statusColors.DRAFT}`}>
                                                    {cycle.status.replace(/_/g, " ")}
                                                </Badge>
                                                <span className="text-xs text-slate-400 font-medium">{cycle._count?.reviews || 0} reviews</span>
                                                <ArrowRight className="h-4 w-4 text-slate-400" />
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="reviews">
                    <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                        <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-4 sm:px-6 sm:py-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-xl font-bold">Performance Reviews</CardTitle>
                                    <CardDescription className="font-medium text-slate-500">
                                        Employee review status and ratings
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {reviews.length === 0 ? (
                                <div className="p-12 text-center">
                                    <div className="h-16 w-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center mx-auto mb-4">
                                        <BarChart3 className="h-8 w-8 text-indigo-400" />
                                    </div>
                                    <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">No Reviews Yet</h3>
                                    <p className="text-sm text-slate-500 max-w-sm mx-auto">
                                        Reviews will appear here once employees are added to a performance cycle.
                                    </p>
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
                                                        {review.cycle.name} {review.manager ? `· Manager: ${review.manager.firstName} ${review.manager.lastName}` : ""}
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
                </TabsContent>
            </Tabs>
        </div>
    );
}
