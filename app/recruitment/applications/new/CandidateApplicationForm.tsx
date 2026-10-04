"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { submitCandidateApplication } from "@/app/lib/actions/recruitment";

type Requisition = { id: string; title: string; requisitionCode: string | null; department: string };

export function CandidateApplicationForm({
    requisitions,
    initialJobId,
}: {
    requisitions: Requisition[];
    initialJobId?: string;
}) {
    const router = useRouter();
    const [jobId, setJobId] = useState(requisitions.some((job) => job.id === initialJobId) ? initialJobId! : "");
    const [busy, setBusy] = useState(false);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        const formData = new FormData(form);
        formData.set("jobId", jobId);
        setBusy(true);
        const result = await submitCandidateApplication(null, formData);
        setBusy(false);
        if (!result.success) {
            toast.error(result.message);
            return;
        }
        toast.success(result.message);
        router.push("/recruitment");
        router.refresh();
    }

    return (
        <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
            <CardContent className="p-5 md:p-7">
                <form onSubmit={submit} className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="candidate-job">Approved vacancy *</Label>
                        <Select value={jobId} onValueChange={setJobId}>
                            <SelectTrigger id="candidate-job" className="h-11"><SelectValue placeholder="Choose a vacancy" /></SelectTrigger>
                            <SelectContent>
                                {requisitions.map((job) => (
                                    <SelectItem key={job.id} value={job.id}>
                                        {job.title} · {job.department}{job.requisitionCode ? ` · ${job.requisitionCode}` : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2"><Label htmlFor="candidate-first">First name *</Label><Input id="candidate-first" name="firstName" required maxLength={80} /></div>
                        <div className="space-y-2"><Label htmlFor="candidate-last">Last name *</Label><Input id="candidate-last" name="lastName" required maxLength={80} /></div>
                        <div className="space-y-2"><Label htmlFor="candidate-email">Email *</Label><Input id="candidate-email" name="email" type="email" required maxLength={200} /></div>
                        <div className="space-y-2"><Label htmlFor="candidate-phone">Phone</Label><Input id="candidate-phone" name="phone" type="tel" /></div>
                        <div className="space-y-2"><Label htmlFor="candidate-position">Current position</Label><Input id="candidate-position" name="currentPosition" maxLength={120} /></div>
                        <div className="space-y-2"><Label htmlFor="candidate-employer">Current employer</Label><Input id="candidate-employer" name="currentEmployer" maxLength={120} /></div>
                        <div className="space-y-2 sm:col-span-2"><Label htmlFor="candidate-resume">Resume PDF *</Label><Input id="candidate-resume" name="resumeFile" type="file" accept="application/pdf,.pdf" required /><p className="text-xs text-slate-500">PDF only, maximum 5 MB.</p></div>
                        <div className="space-y-2 sm:col-span-2"><Label htmlFor="candidate-skills">Skills / notes</Label><Input id="candidate-skills" name="skills" maxLength={2000} /></div>
                    </div>
                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
                        <input name="consentGiven" type="checkbox" required className="mt-1 h-4 w-4 accent-indigo-600" />
                        <span>I confirm the candidate has consented to the company storing and processing their recruitment information.</span>
                    </label>
                    <Button type="submit" disabled={busy || !jobId} className="h-11 rounded-xl bg-indigo-600 px-5 font-bold hover:bg-indigo-700">
                        {busy ? "Saving application…" : "Add candidate to vacancy"}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
