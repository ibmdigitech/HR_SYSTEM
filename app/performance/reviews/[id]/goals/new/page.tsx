"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { createPerformanceGoal } from "@/app/lib/actions/performance";
import { Target, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewPerformanceGoalPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const [reviewId, setReviewId] = useState<string>("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        params.then(p => setReviewId(p.id));
    }, [params]);

    async function handleSubmit(formData: FormData) {
        formData.append("reviewId", reviewId);
        formData.append("order", "0");
        setLoading(true);
        try {
            const res = await createPerformanceGoal(formData);
            if (res.success) {
                toast.success("Goal added successfully");
                router.push(`/performance/reviews/${reviewId}`);
            } else {
                toast.error(res.error || "Failed to add goal");
            }
        } catch (e) {
            toast.error("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-3xl mx-auto">
            <div className="flex items-center gap-4">
                <Link href={`/performance/reviews/${reviewId}`}>
                    <Button variant="ghost" size="icon" className="rounded-xl">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Add KPI or Goal</h1>
                    <p className="text-slate-500 text-sm font-medium">Add a measurable KPI with a target, weight, and outcome</p>
                </div>
            </div>

            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Target className="h-5 w-5 text-violet-600" />
                        KPI Details
                    </CardTitle>
                    <CardDescription>Define the measure, target, and importance for this review period</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="title">KPI or Goal Name</Label>
                            <Input id="title" name="title" placeholder="e.g. Improve customer satisfaction score to 4.5/5" required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea id="description" name="description" placeholder="Describe the goal and its importance..." rows={3} />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="target">KPI Target</Label>
                            <Input id="target" name="target" placeholder="e.g. CSAT score of at least 4.5/5" required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="weight">Weight</Label>
                            <Input id="weight" name="weight" type="number" step="0.1" defaultValue="1" min="0.1" />
                            <p className="text-xs text-slate-500">Relative importance of this KPI in the review score</p>
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Link href={`/performance/reviews/${reviewId}`}>
                                <Button type="button" variant="outline">Cancel</Button>
                            </Link>
                            <Button type="submit" disabled={loading} className="gap-2">
                                {loading ? "Adding..." : "Add KPI"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
