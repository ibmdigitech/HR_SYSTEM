"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addPerformanceQuestion } from "@/app/lib/actions/performance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PlanningCycle = {
    id: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
};

export function PerformanceQuestionManager({ cycles }: { cycles: PlanningCycle[] }) {
    const [saving, setSaving] = useState(false);
    const router = useRouter();

    async function handleSubmit(formData: FormData) {
        setSaving(true);
        try {
            const result = await addPerformanceQuestion(formData);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success("Question added to the performance cycle");
            router.refresh();
            const form = document.getElementById("performance-question-form") as HTMLFormElement | null;
            form?.reset();
        } catch {
            toast.error("Could not add the question. Please try again.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
            <CardHeader>
                <CardTitle>Add a question</CardTitle>
                <CardDescription>Questions are saved to one planning cycle and become part of its review form.</CardDescription>
            </CardHeader>
            <CardContent>
                <form id="performance-question-form" action={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="cycleId">Planning cycle</Label>
                        <select id="cycleId" name="cycleId" required defaultValue="" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <option value="" disabled>Select a planning cycle</option>
                            {cycles.map((cycle) => (
                                <option key={cycle.id} value={cycle.id}>
                                    {cycle.name} · {cycle.type.replaceAll("_", " ")} · {new Date(cycle.startDate).toLocaleDateString()}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="text">Question</Label>
                        <textarea id="text" name="text" required minLength={8} maxLength={500} rows={4} placeholder="For example: What measurable results did you deliver toward your goals?" className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                        <p className="text-xs text-slate-500">Use a clear question that employees or managers can answer during the review.</p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="type">Question category</Label>
                            <select id="type" name="type" defaultValue="COMPETENCY" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <option value="KPI">KPI</option>
                                <option value="COMPETENCY">Competency</option>
                                <option value="BEHAVIORAL">Behavioral</option>
                                <option value="GOAL">Goal</option>
                                <option value="OPEN_ENDED">Open ended</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="audience">Who answers?</Label>
                            <select id="audience" name="audience" defaultValue="BOTH" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <option value="BOTH">Employee and manager</option>
                                <option value="EMPLOYEE">Employee</option>
                                <option value="MANAGER">Manager</option>
                            </select>
                        </div>
                    </div>

                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
                        <Input type="checkbox" name="isRequired" defaultChecked className="mt-0.5 h-4 w-4" />
                        <span><span className="font-semibold">Required question</span><span className="mt-1 block text-xs text-slate-500">Reviewers must answer this question before submitting their review.</span></span>
                    </label>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                            {saving ? "Saving question…" : "Add question to cycle"}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
