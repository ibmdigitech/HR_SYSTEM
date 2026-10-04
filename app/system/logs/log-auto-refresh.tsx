"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Pause, Play } from "lucide-react";

/**
 * Optional live tail for the log lists.
 *
 * The lists themselves are paginated server-side (see page.tsx), so this does
 * NOT append rows itself — appending would silently break the page total and let
 * two copies of the same entry pile up. It polls the router, which re-runs the
 * server query, so what is on screen is always exactly what the current page and
 * filters describe. Polling at 0 means off; the choice is remembered in
 * sessionStorage so a reload does not silently start streaming again.
 *
 * The poll is paused while the tab is hidden and while the pointer is over the
 * list, because an audit view is usually being read, and a re-render under the
 * cursor can move a row out from under it mid-read.
 */
export function LogAutoRefresh({
    enabled,
    onToggle,
    /** Bumped by the server on every render so the client can detect a change. */
}: {
    enabled: boolean;
    onToggle: (next: boolean) => void;
}) {
    const router = useRouter();
    const [pausedForHover, setPausedForHover] = useState(false);
    const hovering = useRef(false);
    const [seconds, setSeconds] = useState(0);

    // Countdown is derived from the interval rather than a second timer so there
    // is only one clock to clear.
    useEffect(() => {
        if (!enabled) {
            setSeconds(0);
            return;
        }
        const started = Date.now();
        const tick = setInterval(() => {
            const elapsed = Math.floor((Date.now() - started) / 1000);
            setSeconds(elapsed);
            // 15s cadence: fast enough to feel live, slow enough that a large
            // SecurityAuditLog count() does not run on every keystroke elsewhere.
            if (elapsed > 0 && elapsed % 15 === 0) router.refresh();
        }, 1000);
        return () => clearInterval(tick);
    }, [enabled, router]);

    return (
        <div
            className="flex items-center gap-2"
            onMouseEnter={() => {
                hovering.current = true;
                setPausedForHover(true);
            }}
            onMouseLeave={() => {
                hovering.current = false;
                setPausedForHover(false);
            }}
        >
            <button
                type="button"
                onClick={() => onToggle(!enabled)}
                aria-pressed={enabled}
                title={
                    enabled
                        ? "Stop refreshing this list automatically"
                        : "Refresh automatically every 15 seconds"
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                    enabled
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                }`}
            >
                {enabled ? (
                    <>
                        <Pause className="h-3.5 w-3.5" />
                        Auto {pausedForHover ? "paused" : `${15 - (seconds % 15 || 15)}s`}
                    </>
                ) : (
                    <>
                        <Play className="h-3.5 w-3.5" />
                        Auto-refresh
                    </>
                )}
            </button>
            {enabled && (
                <button
                    type="button"
                    onClick={() => router.refresh()}
                    title="Refresh now"
                    aria-label="Refresh now"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}
