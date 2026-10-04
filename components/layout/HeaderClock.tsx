"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Exactly as many glyphs as the formatted time, so the swap from placeholder to
 * live value is the same width. In a proportional face `10:45:21 PM` is both
 * wider than the `--:--:--` placeholder AND a different width every second, so
 * the digits pushed the timezone block sideways and the header visibly jumped
 * once a second. Monospace plus `tabular-nums` makes every tick occupy the same
 * advance, which is the actual fix — not merely deferring the first render.
 */
const PLACEHOLDER = "--:--:--";

/**
 * Header clock.
 *
 * The server has no meaningful "now", and even if it computed one it would
 * disagree with the client by the network round-trip, so the first paint is the
 * placeholder on BOTH sides and only the effect writes real time. Because the
 * two trees are identical until after hydration there is nothing to suppress,
 * hence no `suppressHydrationWarning` — adding it would only hide a regression.
 */
export function HeaderClock({ className }: { className?: string }) {
    const [time, setTime] = useState<Date | null>(null);

    useEffect(() => {
        // The first tick is deferred behind a macrotask: a synchronous state
        // update in an effect body forces a cascading render before paint, which
        // React flags (react-hooks/set-state-in-effect). Only the interval
        // updates the value thereafter, exactly once per second.
        const startTimer = window.setTimeout(() => setTime(new Date()), 0);
        const timer = window.setInterval(() => setTime(new Date()), 1000);

        return () => {
            window.clearTimeout(startTimer);
            window.clearInterval(timer);
        };
    }, []);

    return (
        <span className={cn("flex shrink-0 items-center gap-2", className)}>
            <Clock aria-hidden="true" className="h-4 w-4 shrink-0 text-indigo-500" />
            {/* `time` without `dateTime` is valid: the element exists for the
                semantics of "a moment in time", not for a machine value. */}
            <time className="whitespace-nowrap font-mono text-sm font-bold tabular-nums tracking-tight text-slate-700 dark:text-slate-300">
                {/* `h23` rather than `hour12: false`, because some ICU builds
                    resolve the latter to hour cycle 24 and render midnight as
                    "24:00:00" — nine glyphs where the placeholder has eight. */}
                {time
                    ? time.toLocaleTimeString("en-GB", {
                          hourCycle: "h23",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                      })
                    : PLACEHOLDER}
            </time>
        </span>
    );
}