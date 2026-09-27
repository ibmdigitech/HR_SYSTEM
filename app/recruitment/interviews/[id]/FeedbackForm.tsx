"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { submitFeedback } from "@/app/lib/actions/recruitment";

/**
 * Structured interview feedback (brief §10).
 *
 * Six dimensions scored 1–5, plus strengths / concerns / comments and a
 * recommendation. Two rules are enforced here and re-checked on the server:
 *
 *  - Scores are validated, not clamped. A 0 or a 6 is a data-entry error and
 *    is rejected rather than silently reinterpreted.
 *  - Scores NEVER decide the outcome. The brief is explicit that the hiring
 *    process determines the final decision, so this form shows an average as
 *    information only and the recommendation is the interviewer's judgement.
 *
 * The submit path is the server action, which verifies the caller is on this
 * interview's panel — the form is a convenience, not the authority.
 */

const DIMENSIONS = [
    { key: "technicalSkills", label: "Technical skills" },
    { key: "problemSolving", label: "Problem solving" },
    { key: "domainKnowledge", label: "Domain knowledge" },
    { key: "communication", label: "Communication" },
    { key: "teamFit", label: "Team fit" },
    { key: "leadership", label: "Leadership" },
    { key: "overall", label: "Overall" },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]["key"];
type Scores = Partial<Record<DimensionKey, number>>;

const RECOMMENDATIONS = [
    { value: "STRONG_HIRE", label: "Strong hire" },
    { value: "HIRE", label: "Hire" },
    { value: "HOLD", label: "Hold" },
    { value: "NO_HIRE", label: "No hire" },
] as const;

const RECOMMENDATION_STYLE: Record<string, string> = {
    STRONG_HIRE: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    HIRE: "border-emerald-300 bg-emerald-50/50 text-emerald-700 dark:text-emerald-300",
    HOLD: "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    NO_HIRE: "border-rose-400 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

function ScoreRow({
    label,
    value,
    onChange,
    error,
    id,
}: {
    label: string;
    value?: number;
    onChange: (v: number) => void;
    error?: string;
    id: string;
}) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Label htmlFor={id} className="text-xs font-bold text-slate-600 dark:text-slate-300 sm:w-40 shrink-0">
                {label}
            </Label>
            <div
                className="flex gap-1"
                role="radiogroup"
                aria-labelledby={id}
                onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                        e.preventDefault();
                        const delta = e.key === "ArrowRight" ? 1 : -1;
                        const next = Math.min(5, Math.max(1, (value ?? 0) + delta));
                        if (next >= 1 && next <= 5) onChange(next);
                    }
                }}
            >
                {[1, 2, 3, 4, 5].map((n) => (
                    <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={value === n}
                        aria-label={`${label}: ${n} of 5`}
                        onClick={() => onChange(n)}
                        className={cn(
                            // 40px tall on touch, 36 on pointer devices.
                            "h-9 sm:h-8 w-9 rounded-lg border text-xs font-black transition-colors",
                            value === n
                                ? "bg-indigo-600 border-indigo-600 text-white"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-400"
                        )}
                    >
                        {n}
                    </button>
                ))}
            </div>
            {error && (
                <p role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-400 sm:ml-2">
                    {error}
                </p>
            )}
        </div>
    );
}

export function FeedbackForm({
    interviewId,
    participantId,
    existing,
    canSubmit,
    reason,
}: {
    interviewId: string;
    participantId: string;
    existing: {
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
        submittedAt: string | Date;
    } | null;
    /** False when the viewer is not on this panel. */
    canSubmit: boolean;
    /** Why the form is unavailable, for a clear message rather than silence. */
    reason?: string;
}) {
    const router = useRouter();
    const [scores, setScores] = useState<Scores>(() => ({
        technicalSkills: existing?.technicalSkills ?? undefined,
        problemSolving: existing?.problemSolving ?? undefined,
        domainKnowledge: existing?.domainKnowledge ?? undefined,
        communication: existing?.communication ?? undefined,
        teamFit: existing?.teamFit ?? undefined,
        leadership: existing?.leadership ?? undefined,
        overall: existing?.overall ?? undefined,
    }));
    const [strengths, setStrengths] = useState(existing?.strengths ?? "");
    const [concerns, setConcerns] = useState(existing?.concerns ?? "");
    const [comments, setComments] = useState(existing?.comments ?? "");
    const [recommendation, setRecommendation] = useState<string>(existing?.recommendation ?? "");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);

    if (!canSubmit) {
        return (
            <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-xl p-4 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
                {reason ?? "You are not on this panel, so you cannot submit feedback for it."}
            </p>
        );
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (submitting) return;

        // Client-side mirror of the server rule: a blank or out-of-range score is
        // rejected, not defaulted.
        const nextErrors: Record<string, string> = {};
        for (const dim of DIMENSIONS) {
            const value = scores[dim.key];
            if (value === undefined) nextErrors[dim.key] = "Not scored";
            else if (!Number.isInteger(value) || value < 1 || value > 5) {
                nextErrors[dim.key] = "Must be 1–5";
            }
        }
        if (!recommendation) nextErrors.recommendation = "Choose a recommendation";

        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            toast.error("Please complete every score and choose a recommendation.");
            return;
        }

        setSubmitting(true);
        const formData = new FormData();
        formData.set("interviewId", interviewId);
        formData.set("participantId", participantId);
        for (const dim of DIMENSIONS) formData.set(dim.key, String(scores[dim.key]));
        formData.set("strengths", strengths);
        formData.set("concerns", concerns);
        formData.set("comments", comments);
        formData.set("recommendation", recommendation);

        const result = await submitFeedback(null, formData);
        setSubmitting(false);

        if (result.success) {
            toast.success(existing ? "Your feedback was updated." : "Feedback recorded.");
            router.refresh();
        } else {
            toast.error(result.message);
        }
    }

    const scored = DIMENSIONS.filter((d) => scores[d.key] != null);
    const average =
        scored.length > 0
            ? (scored.reduce((sum, d) => sum + (scores[d.key] ?? 0), 0) / scored.length).toFixed(1)
            : "—";

    return (
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
            {existing && (
                <p className="text-xs font-bold text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-xl p-3">
                    You submitted this on{" "}
                    {new Date(existing.submittedAt).toLocaleDateString("en-GB")}. Saving again updates your own
                    feedback only — other panel members&apos; entries are unaffected.
                </p>
            )}

            <fieldset className="space-y-3">
                <legend className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">
                    Scores (1 = poor, 5 = exceptional)
                </legend>
                {DIMENSIONS.map((dim) => (
                    <ScoreRow
                        key={dim.key}
                        id={`score-${dim.key}`}
                        label={dim.label}
                        value={scores[dim.key]}
                        onChange={(v) => setScores((s) => ({ ...s, [dim.key]: v }))}
                        error={errors[dim.key]}
                    />
                ))}
                <p className="text-[11px] text-slate-500 pt-1">
                    Average of {scored.length} scored dimension(s):{" "}
                    <span className="font-black">{average}</span> — shown for information only. The hiring
                    decision is made through the pipeline, not by this average.
                </p>
            </fieldset>

            <div className="space-y-3">
                <Label htmlFor="strengths" className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Strengths
                </Label>
                <Textarea
                    id="strengths"
                    value={strengths}
                    onChange={(e) => setStrengths(e.target.value)}
                    rows={2}
                    className="bg-slate-50 dark:bg-slate-900"
                />
            </div>

            <div className="space-y-3">
                <Label htmlFor="concerns" className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Concerns
                </Label>
                <Textarea
                    id="concerns"
                    value={concerns}
                    onChange={(e) => setConcerns(e.target.value)}
                    rows={2}
                    className="bg-slate-50 dark:bg-slate-900"
                />
            </div>

            <div className="space-y-3">
                <Label htmlFor="comments" className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Comments
                </Label>
                <Textarea
                    id="comments"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    rows={2}
                    className="bg-slate-50 dark:bg-slate-900"
                />
            </div>

            <fieldset className="space-y-2">
                <legend className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                    Your recommendation
                </legend>
                <div className="flex flex-wrap gap-2">
                    {RECOMMENDATIONS.map((r) => (
                        <button
                            key={r.value}
                            type="button"
                            role="radio"
                            aria-checked={recommendation === r.value}
                            onClick={() => setRecommendation(r.value)}
                            className={cn(
                                "h-9 px-4 rounded-xl border text-xs font-black uppercase tracking-widest transition-colors",
                                recommendation === r.value
                                    ? RECOMMENDATION_STYLE[r.value]
                                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500"
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
                {errors.recommendation && (
                    <p role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                        {errors.recommendation}
                    </p>
                )}
            </fieldset>

            <Button
                type="submit"
                disabled={submitting}
                aria-busy={submitting}
                className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 font-black uppercase text-xs tracking-widest"
            >
                {submitting ? (
                    <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving…
                    </>
                ) : (
                    <>
                        <Check className="h-4 w-4 mr-2" />
                        {existing ? "Update my feedback" : "Submit feedback"}
                    </>
                )}
            </Button>

            <Input type="hidden" value={interviewId} readOnly aria-hidden="true" tabIndex={-1} />
        </form>
    );
}
