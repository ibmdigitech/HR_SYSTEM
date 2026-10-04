"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, BellRing, CheckCircle2, AlertTriangle, Clock, Loader2, ChevronDown } from "lucide-react";

/**
 * Drives `scanExpiringDocuments`, which had no caller anywhere in the app.
 *
 * The scan is idempotent by a database unique key on
 * (employeeId, documentType, thresholdDays, expiryDate), so pressing this twice
 * does not double-notify — it reports `remindersSkipped` instead. That is what
 * makes it safe to expose as a button rather than hiding it behind a scheduler
 * an operator would have to configure before seeing anything work.
 */
export function ComplianceControls({
    canManage,
    summary,
    compact = false,
}: {
    canManage: boolean;
    summary: { expired: number; critical: number; warning: number; total: number };
    /** Renders as a single button; the panel below expands on demand. */
    compact?: boolean;
}) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [open, setOpen] = useState(!compact);
    const triggerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    // Viewport coordinates for the fixed panel, measured from the button.
    const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
    const [result, setResult] = useState<{
        scanned: number;
        remindersCreated: number;
        remindersSkipped: number;
        notificationsSent: number;
        errors: number;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    /**
     * Measure the trigger and place the fixed panel directly under it.
     *
     * Runs on open and on resize/scroll so the panel stays anchored to the
     * button instead of drifting. Width is taken from the button so the panel
     * matches the control's footprint, clamped to the viewport so it never hangs
     * off the right edge on a narrow screen.
     */
    const positionPanel = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const width = Math.max(r.width, 260);
        const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
        setPanelPos({ top: r.bottom + 6, left, width });
    }, []);

    useEffect(() => {
        if (!open) {
            setPanelPos(null);
            return;
        }
        positionPanel();
        window.addEventListener("resize", positionPanel);
        window.addEventListener("scroll", positionPanel, true);
        return () => {
            window.removeEventListener("resize", positionPanel);
            window.removeEventListener("scroll", positionPanel, true);
        };
    }, [open, positionPanel]);

    // Dismiss on outside click and on Escape — a floating panel whose only exit
    // is the chevron traps the pointer and the keyboard.
    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: MouseEvent) {
            const t = e.target as Node;
            if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
            setOpen(false);
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false);
        }
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    function runScan() {
        setError(null);
        startTransition(async () => {
            try {
                const res = await fetch("/api/compliance/scan", { method: "POST" });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || "Scan failed");
                setResult(json);
                router.refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : "Scan failed");
            }
        });
    }

    return (
        <div className={compact ? "relative" : "grid gap-4 lg:grid-cols-3"}>
            {compact ? (
                <div ref={triggerRef} className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={runScan}
                        disabled={isPending || !canManage}
                        title={canManage ? "Scan every active employee for expiring documents" : "Requires visa management permission"}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-1.5 transition-colors whitespace-nowrap"
                    >
                        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {isPending ? "Scanning…" : "Run scan"}
                    </button>
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        title="Scan details"
                        className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 px-1.5 py-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                </div>
            ) : (
                <>
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-base font-bold flex items-center gap-2">
                            <RefreshCw className="h-4 w-4 text-indigo-600" />
                            Expiry Reminder Scan
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-prose">
                            Walks every active employee, finds documents inside a reminder window
                            (90 / 60 / 30 / 14 / 7 days), and raises a notification in the
                            employee&apos;s Notification Centre. Safe to re-run — reminders are
                            de-duplicated, so a repeat run reports &quot;skipped&quot; instead of
                            re-alerting.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={runScan}
                        disabled={isPending || !canManage}
                        title={canManage ? undefined : "Requires visa management permission"}
                        className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-4 py-2.5 transition-colors"
                    >
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                        {isPending ? "Scanning…" : "Run scan now"}
                    </button>
                </div>

                {error && (
                    <p className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                        {error}
                    </p>
                )}

                {result && (
                    <dl className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                        {[
                            { k: "Employees scanned", v: result.scanned },
                            { k: "Reminders created", v: result.remindersCreated },
                            { k: "Already sent", v: result.remindersSkipped },
                            { k: "Notified", v: result.notificationsSent },
                            { k: "Errors", v: result.errors },
                        ].map((m) => (
                            <div key={m.k} className="rounded-xl bg-slate-50 dark:bg-slate-900 px-2 py-3">
                                <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{m.k}</dt>
                                <dd className="text-lg font-black mt-0.5">{m.v}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-5">
                <h3 className="text-base font-bold flex items-center gap-2">
                    <BellRing className="h-4 w-4 text-amber-600" />
                    Needs attention
                </h3>
                <ul className="mt-4 space-y-2.5">
                    {[
                        { icon: AlertTriangle, label: "Expired", n: summary.expired, cls: "text-rose-600" },
                        { icon: Clock, label: "Due ≤ 30 days", n: summary.critical, cls: "text-orange-600" },
                        { icon: CheckCircle2, label: "Due ≤ 90 days", n: summary.warning, cls: "text-amber-600" },
                    ].map((r) => {
                        const Icon = r.icon;
                        return (
                            <li key={r.label} className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                    <Icon className={`h-4 w-4 ${r.cls}`} />
                                    {r.label}
                                </span>
                                <span className="font-black tabular-nums">{r.n}</span>
                            </li>
                        );
                    })}
                </ul>
                <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-3">
                    {summary.total === 0
                        ? "No document falls inside a reminder window."
                        : `${summary.total} document${summary.total === 1 ? "" : "s"} across the tracked types fall inside the 90-day window.`}
                </p>
            </div>
                </>
            )}

            {/*
                The scan report is FIXED-positioned, not absolute.

                Anchoring it with `absolute` inside a `relative` parent that is
                itself a flex child of the command bar let it contribute to the
                bar's height once a result existed, so pressing "Run scan" made
                the bar grow and pushed the directory further down the page — the
                opposite of what running a scan should do. `fixed` takes it out
                of flow entirely, and the inline width/height are measured so it
                can be positioned against the button without a layout effect.

                `z-50` and the opaque background keep it above the sticky header.
            */}
            {compact && open && (
                <div
                    ref={panelRef}
                    style={
                        panelPos
                            ? { top: panelPos.top, left: panelPos.left, width: panelPos.width }
                            : undefined
                    }
                    className="fixed z-50 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 shadow-2xl space-y-2.5"
                >
                    <div className="flex items-start gap-2">
                        <RefreshCw className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                            Scans every active employee for documents inside a reminder window
                            (90/60/30/14/7d) and raises a notification. Safe to re-run — reminders
                            are de-duplicated.
                        </p>
                    </div>
                    {error && (
                        <p className="rounded bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                            {error}
                        </p>
                    )}
                    {result && (
                        <dl className="grid grid-cols-3 gap-1.5 text-center">
                            {[
                                { k: "Scanned", v: result.scanned },
                                { k: "Created", v: result.remindersCreated },
                                { k: "Notified", v: result.notificationsSent },
                            ].map((m) => (
                                <div key={m.k} className="rounded bg-slate-50 dark:bg-slate-900 px-1.5 py-1.5">
                                    <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{m.k}</dt>
                                    <dd className="text-sm font-black tabular-nums">{m.v}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </div>
            )}
        </div>
    );
}