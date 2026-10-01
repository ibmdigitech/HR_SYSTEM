"use client";

import { useEffect, useState } from "react";

const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function AnimatedLeaveProgress({
    usedPercentage,
    remainingDays,
    totalDays,
}: {
    usedPercentage: number;
    remainingDays: number;
    totalDays: number;
}) {
    const percentage = Math.min(100, Math.max(0, usedPercentage));
    const [animated, setAnimated] = useState(false);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setAnimated(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    const replay = () => {
        setAnimated(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
    };

    const color = percentage >= 90 ? "#f43f5e" : percentage >= 70 ? "#f59e0b" : "#4f46e5";
    const targetOffset = CIRCUMFERENCE * (1 - percentage / 100);

    return (
        <button
            type="button"
            onClick={replay}
            aria-label={`Replay leave usage animation: 0 to ${percentage} percent used. ${remainingDays} of ${totalDays} days remain.`}
            className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-200 dark:text-slate-800" />
                <circle
                    cx="50"
                    cy="50"
                    r={RADIUS}
                    fill="none"
                    stroke={color}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={animated ? targetOffset : CIRCUMFERENCE}
                    className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
                />
            </svg>
            <span className="absolute inset-[7px] grid place-content-center rounded-full bg-white text-center dark:bg-slate-950">
                <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-white">{remainingDays}</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">days left</span>
            </span>
        </button>
    );
}
