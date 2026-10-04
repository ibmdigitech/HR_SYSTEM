"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";
import { LogAutoRefresh } from "./log-auto-refresh";

/**
 * Filter bar for the two log lists, driven entirely by the URL.
 *
 * A GET form rather than controlled state so that applying a filter is a plain
 * navigation: the result is shareable, survives reload and back/forward, and the
 * server does the querying. No client-side filtering of a capped page, which is
 * what made the old view look empty whenever the 100 rows it held did not match.
 */
export function LogFilterBar({
    securityActions,
    activityActions,
    current,
}: {
    securityActions: string[];
    activityActions: string[];
    current: { action?: string; outcome?: string; q?: string };
}) {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Auto-refresh is a per-tab preference, not a URL concern: it is a viewing
    // mode, and baking it into a shareable link would make the recipient inherit
    // someone else's polling choice.
    const [auto, setAuto] = useState(false);
    useEffect(() => {
        setAuto(sessionStorage.getItem("logs:auto") === "1");
    }, []);

    function toggleAuto(next: boolean) {
        setAuto(next);
        sessionStorage.setItem("logs:auto", next ? "1" : "0");
    }

    function apply(formData: FormData) {
        const q = new URLSearchParams(searchParams.toString());
        // Any filter change invalidates both cursors — page 7 of the old result
        // set is meaningless against the new one.
        q.delete("secPage");
        q.delete("actPage");
        for (const key of ["action", "outcome", "q"] as const) {
            const v = String(formData.get(key) ?? "").trim();
            if (v) q.set(key, v);
            else q.delete(key);
        }
        router.push(`/system/logs?${q.toString()}`);
    }

    function clear() {
        router.push("/system/logs");
    }

    const hasFilters = Boolean(current.action || current.outcome || current.q);
    // Actions are unioned so one dropdown serves both lists; an action that only
    // exists in one table simply matches nothing in the other.
    const allActions = [...new Set([...securityActions, ...activityActions])].sort();

    return (
        <div className="flex flex-col gap-2">
            <form
                action="/system/logs"
                method="get"
                onSubmit={(e) => {
                    e.preventDefault();
                    apply(new FormData(e.currentTarget));
                }}
                className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
            >
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Search
                    </span>
                    <input
                        type="search"
                        name="q"
                        defaultValue={current.q ?? ""}
                        placeholder="actor, target or path"
                        className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-900"
                    />
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Action
                    </span>
                    <select
                        name="action"
                        defaultValue={current.action ?? ""}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-900"
                    >
                        <option value="">All actions</option>
                        {allActions.map((a) => (
                            <option key={a} value={a}>
                                {a.replaceAll("_", " ")}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Outcome
                    </span>
                    <select
                        name="outcome"
                        defaultValue={current.outcome ?? ""}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-900"
                    >
                        <option value="">Any outcome</option>
                        <option value="SUCCESS">SUCCESS</option>
                        <option value="DENIED">DENIED</option>
                        <option value="ERROR">ERROR</option>
                    </select>
                </label>

                <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white transition-colors hover:bg-indigo-700"
                >
                    <Filter className="h-3.5 w-3.5" />
                    Apply
                </button>

                {hasFilters && (
                    <button
                        type="button"
                        onClick={clear}
                        className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900"
                    >
                        <X className="h-3.5 w-3.5" />
                        Clear
                    </button>
                )}

                <div className="ml-auto">
                    <LogAutoRefresh enabled={auto} onToggle={toggleAuto} />
                </div>
            </form>

            {hasFilters && (
                <p className="px-1 text-[11px] text-slate-500">
                    Filtered
                    {current.q ? ` on “${current.q}”` : ""}
                    {current.action ? ` · action ${current.action.replaceAll("_", " ")}` : ""}
                    {current.outcome ? ` · outcome ${current.outcome}` : ""}
                </p>
            )}
        </div>
    );
}
