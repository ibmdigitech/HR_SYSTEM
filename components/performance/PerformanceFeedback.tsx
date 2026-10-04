"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { submitPerformanceAnswer, updatePerformanceGoal } from "@/app/lib/actions/performance";

// Defined in a plain module so the server-rendered review detail page can read
// the same map; see ./rating-labels for why it cannot live in this file.
import { PERFORMANCE_RATING_LABELS } from "./rating-labels";

export { PERFORMANCE_RATING_LABELS };

function RatingStars({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Performance rating">
            {[1, 2, 3, 4, 5].map((rating) => (
                <button
                    key={rating}
                    type="button"
                    onClick={() => onChange(rating)}
                    aria-label={`${rating} stars: ${PERFORMANCE_RATING_LABELS[rating]}`}
                    aria-pressed={value === rating}
                    title={`${rating} stars — ${PERFORMANCE_RATING_LABELS[rating]}`}
                    className="rounded-md p-1.5 outline-none transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-950/40"
                >
                    <Star
                        className={`h-6 w-6 ${rating <= value ? "fill-amber-400 text-amber-500" : "text-slate-300 dark:text-slate-600"}`}
                        aria-hidden="true"
                    />
                </button>
            ))}
            <span className="ml-2 min-w-36 text-sm font-semibold text-slate-700 dark:text-slate-200" aria-live="polite">
                {value ? `${value}/5 · ${PERFORMANCE_RATING_LABELS[value]}` : "Select a rating"}
            </span>
        </div>
    );
}

export function PerformanceQuestionForm({
    reviewId,
    questionId,
    initialAnswer,
    initialRating,
}: {
    reviewId: string;
    questionId: string;
    initialAnswer?: string | null;
    initialRating?: number | null;
}) {
    const [rating, setRating] = useState(initialRating ?? 0);
    const [answer, setAnswer] = useState(initialAnswer ?? "");
    const [pending, startTransition] = useTransition();

    function save() {
        if (!rating) {
            toast.error("Choose a star rating first");
            return;
        }
        const formData = new FormData();
        formData.set("reviewId", reviewId);
        formData.set("questionId", questionId);
        formData.set("answer", answer);
        formData.set("rating", String(rating));
        startTransition(async () => {
            const result = await submitPerformanceAnswer(formData);
            if (result.success) toast.success("Assessment saved");
            else toast.error(result.error);
        });
    }

    return (
        <div className="mt-4 space-y-3">
            <RatingStars value={rating} onChange={setRating} />
            <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Comments (optional)</span>
                <textarea
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Add evidence, results, or context for this rating…"
                    className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-indigo-950"
                />
            </label>
            <button
                type="button"
                onClick={save}
                disabled={pending || !rating}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {pending ? "Saving…" : "Save assessment"}
            </button>
        </div>
    );
}

export function KpiRatingForm({ goalId, initialRating, initialActual }: { goalId: string; initialRating?: number | null; initialActual?: string | null }) {
    const [rating, setRating] = useState(initialRating ?? 0);
    const [actual, setActual] = useState(initialActual ?? "");
    const [pending, startTransition] = useTransition();

    function save() {
        if (!rating) {
            toast.error("Choose a star rating first");
            return;
        }
        const formData = new FormData();
        formData.set("rating", String(rating));
        formData.set("actual", actual);
        startTransition(async () => {
            const result = await updatePerformanceGoal(goalId, formData);
            if (result.success) toast.success("KPI result and rating saved");
            else toast.error(result.error);
        });
    }

    return (
        <div className="mt-4 space-y-3">
            <label className="block max-w-xl space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Actual result</span>
                <input
                    value={actual}
                    onChange={(event) => setActual(event.target.value)}
                    maxLength={500}
                    placeholder="Enter the result achieved"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900"
                />
            </label>
            <RatingStars value={rating} onChange={setRating} />
            <button
                type="button"
                onClick={save}
                disabled={pending || !rating}
                className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
                {pending ? "Saving…" : "Save KPI result and rating"}
            </button>
        </div>
    );
}