"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
    describeLeaveBar,
    LEAVE_RING_CIRCUMFERENCE,
    LEAVE_RING_RADIUS as RADIUS,
    type LeaveBarState,
} from "./leave-bar-math";

// The geometry lives in ./leave-bar-math so the server component and the
// balance API can call it too — a server module may import from a "use client"
// file but may not call into one. Re-exported here so existing importers of
// `<AnimatedLeaveProgress>`'s types keep resolving from this path.
export { describeLeaveBar, type LeaveBarState };

export function AnimatedLeaveProgress({
    totalDays,
    usedDays,
    leaveType,
}: {
    totalDays: number;
    usedDays: number;
    /** Used only to name the bar for assistive tech. */
    leaveType?: string;
}) {
    const state = describeLeaveBar(totalDays, usedDays);
    const [animated, setAnimated] = useState(false);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setAnimated(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    const replay = () => {
        setAnimated(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    };

    const barPercentage = Math.min(100, Math.max(0, state.usedPercentage));
    const targetOffset = LEAVE_RING_CIRCUMFERENCE * (1 - barPercentage / 100);
    const color = state.isOverdrawn
        ? "#e11d48"
        : barPercentage >= 90
          ? "#f43f5e"
          : barPercentage >= 70
            ? "#f59e0b"
            : "#4f46e5";

    // No entitlement and no usage: an honest empty state, not a 0% bar.
    const unallocated = !state.hasEntitlement && !state.isOverdrawn;

    const valueText = state.isInvalid
        ? "Balance unavailable"
        : state.isOverdrawn
          ? `${state.used} of ${state.entitled} days used — overdrawn by ${Math.abs(state.remaining)} day(s)`
          : unallocated
            ? "No days allocated"
            : `${state.used} of ${state.entitled} days used — ${state.remaining} remaining`;

    const name = leaveType ? `${leaveType} leave` : "Leave";

    return (
        <button
            type="button"
            onClick={replay}
            aria-label={`Replay ${name} usage animation. ${valueText}.`}
            className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
            <div
                role="progressbar"
                aria-label={`${name} usage`}
                aria-valuenow={barPercentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={valueText}
                className="absolute inset-0"
            >
                <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                    <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-200 dark:text-slate-800" />
                    <circle
                        cx="50"
                        cy="50"
                        r={RADIUS}
                        fill="none"
                        stroke={color}
                        strokeWidth="7"
                        strokeLinecap="round"
                        strokeDasharray={LEAVE_RING_CIRCUMFERENCE}
                        strokeDashoffset={animated ? targetOffset : LEAVE_RING_CIRCUMFERENCE}
                        className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
                    />
                </svg>
                <span className="absolute inset-[7px] grid place-content-center rounded-full bg-white text-center dark:bg-slate-950">
                    {state.isInvalid ? (
                        <>
                            <span className="text-xl font-black tabular-nums text-slate-900 dark:text-white">—</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">no data</span>
                        </>
                    ) : (
                        <>
                            <span
                                className={`text-2xl font-black tabular-nums ${
                                    state.isOverdrawn
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-slate-900 dark:text-white"
                                }`}
                            >
                                {unallocated ? "—" : state.remaining}
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                {state.isOverdrawn ? "days over" : unallocated ? "not allocated" : "days left"}
                            </span>
                        </>
                    )}
                </span>
            </div>

            {state.isOverdrawn && (
                <span className="absolute -bottom-1 -right-1 z-10 inline-flex items-center gap-0.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow-sm">
                    <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
                    Over
                </span>
            )}
        </button>
    );
}