"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { createPerformanceCycle } from "@/app/lib/actions/performance";
import { Calendar, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewPerformanceCyclePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    async function handleSubmit(formData: FormData) {
        setLoading(true);
        try {
            const res = await createPerformanceCycle(formData);
            if (res.success) {
                toast.success("Performance cycle created successfully");
                router.push("/performance");
            } else {
                toast.error(res.error || "Failed to create cycle");
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
                <Link href="/performance">
                    <Button variant="ghost" size="icon" className="rounded-xl">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">New Review Cycle</h1>
                    <p className="text-slate-500 text-sm font-medium">Configure a new performance review period</p>
                </div>
            </div>

            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-violet-600" />
                        Cycle Details
                    </CardTitle>
                    <CardDescription>Set the name, type, and duration for this review cycle</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="name">Cycle Name</Label>
                            <Input id="name" name="name" placeholder="e.g. 2026 H1 Review" required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="type">Cycle Type</Label>
                            <Select name="type" required defaultValue="YEARLY">
                                <SelectTrigger>
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="YEARLY">Yearly</SelectItem>
                                    <SelectItem value="HALF_YEARLY">Half Yearly</SelectItem>
                                    <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="startDate">Start Date</Label>
                                <DatePicker id="startDate" name="startDate" required aria-label="Cycle start date" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="endDate">End Date</Label>
                                <DatePicker id="endDate" name="endDate" required aria-label="Cycle end date" />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <Label className="text-sm font-bold">Features</Label>
                            <div className="space-y-3">
                                <label className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 cursor-pointer">
                                    <input type="checkbox" name="selfAssessmentEnabled" defaultChecked className="h-4 w-4 rounded" />
                                    <div>
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">Self Assessment</span>
                                        <p className="text-xs text-slate-500">Allow employees to rate themselves</p>
                                    </div>
                                </label>
                                <label className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 cursor-pointer">
                                    <input type="checkbox" name="managerReviewEnabled" defaultChecked className="h-4 w-4 rounded" />
                                    <div>
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">Manager Review</span>
                                        <p className="text-xs text-slate-500">Enable manager feedback and ratings</p>
                                    </div>
                                </label>
                                <label className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 cursor-pointer">
                                    <input type="checkbox" name="calibrationEnabled" defaultChecked className="h-4 w-4 rounded" />
                                    <div>
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">Calibration</span>
                                        <p className="text-xs text-slate-500">Enable rating calibration across teams</p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Link href="/performance">
                                <Button type="button" variant="outline">Cancel</Button>
                            </Link>
                            <Button type="submit" disabled={loading} className="gap-2">
                                {loading ? "Creating..." : "Create Cycle"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
