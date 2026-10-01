import Link from "next/link";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { requirePageAnyPermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PerformanceQuestionManager } from "@/components/performance/PerformanceQuestionManager";

export default async function PerformanceQuestionsPage() {
    await requirePageAnyPermission([PERMISSIONS.PERFORMANCE_VIEW, PERMISSIONS.PERFORMANCE_REVIEW]);

    const planningCycles = await prisma.performanceCycle.findMany({
        where: { status: "PLANNING" },
        orderBy: { startDate: "asc" },
        select: { id: true, name: true, type: true, startDate: true, endDate: true },
    });

    return (
        <main className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
            <Link href="/performance">
                <Button variant="ghost" className="gap-2 px-0 text-slate-600 hover:text-slate-950">
                    <ArrowLeft className="h-4 w-4" /> Back to Performance
                </Button>
            </Link>

            <header className="rounded-3xl bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-900 p-6 text-white shadow-lg sm:p-8">
                <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-white/10 p-3"><ClipboardCheck className="h-6 w-6" /></div>
                    <div>
                        <h1 className="text-2xl font-bold sm:text-3xl">Manage performance questions</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-indigo-100 sm:text-base">
                            Add questions to a planning cycle now. They will be included when that cycle opens for reviews.
                        </p>
                    </div>
                </div>
            </header>

            {planningCycles.length > 0 ? (
                <PerformanceQuestionManager cycles={planningCycles.map((cycle) => ({
                    ...cycle,
                    startDate: cycle.startDate.toISOString(),
                    endDate: cycle.endDate.toISOString(),
                }))} />
            ) : (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle>No planning cycles yet</CardTitle>
                        <CardDescription>Create a performance cycle first, then add its custom questions here.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link href="/performance/cycles/new">
                            <Button>Create a performance cycle</Button>
                        </Link>
                    </CardContent>
                </Card>
            )}
        </main>
    );
}
