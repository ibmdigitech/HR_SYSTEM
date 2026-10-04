"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Rendered on the server and on the first client paint. The zone cannot be
 * known there: the browser's zone is a user setting, and the server's is the
 * host's, so anything computed during render is either wrong on one side or a
 * hydration mismatch. This string is only a shape to hold the layout until the
 * effect reports the real zone.
 */
const PLACEHOLDER = "GMT · Local time";

/**
 * `getTimezoneOffset` reports minutes BEHIND UTC, so the sign inverts to give
 * the offset written on a wall clock. Fractional zones keep their minutes rather
 * than being rounded away — Kathmandu is +5:45 and Chatham is +12:45, and both
 * render as `GMT+5:45` rather than the wrong `GMT+6`.
 */
function offsetLabel(now: Date): string {
    const minutes = -now.getTimezoneOffset();
    const sign = minutes < 0 ? "-" : "+";
    const magnitude = Math.abs(minutes);
    const hours = Math.floor(magnitude / 60);
    const rest = magnitude % 60;
    return `${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * `Asia/Dubai` → `Dubai`, `America/Argentina/Buenos_Aires` → `Buenos Aires`.
 * A zone with no area prefix (`UTC`, `GMT`) is already a city-or-world label,
 * so it is used verbatim.
 */
function cityLabel(zone: string): string {
    const segment = zone.split("/").pop() ?? zone;
    return segment.replace(/_/g, " ");
}

interface ZoneLabel {
    /** `GMT+4 · Dubai` — the whole one-line badge. */
    text: string;
    /** The raw IANA id, carried in `title` and for assistive tech. */
    zone: string;
}

function describeZone(): ZoneLabel | null {
    const now = new Date();
    let zone: string | undefined;
    try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return null;
    }
    // Some embedded engines resolve no zone at all. `getTimezoneOffset` still
    // works there, so the offset is kept and only the city is dropped.
    if (!zone) {
        return { text: `GMT${offsetLabel(now)}`, zone: "UTC" };
    }

    return {
        text: `GMT${offsetLabel(now)} · ${cityLabel(zone)}`,
        zone,
    };
}

/**
 * Header timezone badge.
 *
 * One line, always. The previous block had no `whitespace-nowrap` and no
 * `shrink-0`, so when the row ran short of width it wrapped at the spaces and
 * stacked "GMT" / "+4" / "(UAE)" on three lines, tripling the header height.
 */
export function HeaderTimezone({ className }: { className?: string }) {
    const [label, setLabel] = useState<ZoneLabel | null>(null);

    useEffect(() => {
        // Deferred for the same reason as the clock's first tick: a synchronous
        // state update inside the effect body re-renders before paint.
        const startTimer = window.setTimeout(() => setLabel(describeZone()), 0);
        return () => window.clearTimeout(startTimer);
    }, []);

    return (
        <span
            className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap", className)}
            title={label ? `Time zone: ${label.zone}` : undefined}
        >
            <Globe aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                {label ? label.text : PLACEHOLDER}
            </span>
            {/* The IANA id is the only unambiguous answer to "which zone is
                that?", and `title` is not reachable by keyboard or touch, so the
                zone is appended to the accessible name rather than replacing
                the visible text. */}
            {label && <span className="sr-only">, time zone {label.zone}</span>}
        </span>
    );
}