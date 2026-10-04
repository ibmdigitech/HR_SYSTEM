"use client";

import { useEffect, useState } from "react";
import {
    CheckCircle2,
    AlertTriangle,
    XCircle,
    HelpCircle,
    Clock,
    ShieldCheck,
    RefreshCw,
} from "lucide-react";

/**
 * Backup status for the Settings panel.
 *
 * Shows ONLY what /api/system/backup-status could verify. The previous panel
 * printed a command and implied everything was fine; this one leads with the
 * state and treats every unverified claim as unverified.
 *
 * Three rules it will not break, because each corresponds to a specific way a
 * backup panel misleads an administrator:
 *   1. It never shows HEALTHY when the scheduled task is missing.
 *   2. It never shows off-site as protected when no destination is configured.
 *   3. It never shows restore as verified until a drill has actually passed.
 */

type Status = "ok" | "warn" | "fail" | "unknown" | "not_configured";

interface BackupStatus {
    overall: Status;
    backup: { name: string; sizeBytes: number; modifiedAt: string; ageHours: number } | null;
    dumpCount: number;
    maxAgeHours: number;
    integrity: { state: Status; detail: string };
    checksum: { state: Status; detail: string };
    scheduler: {
        state: Status;
        detail: string;
        lastRun: string | null;
        lastResult: number | null;
        nextRun: string | null;
    };
    offsite: { state: Status; detail: string };
    restoreTest: { state: Status; detail: string; ranAt: string | null; passed: boolean | null };
    retention: { configured: number; present: number };
    checkedAt: string;
}

const TONE: Record<Status, { icon: typeof CheckCircle2; ring: string; text: string; bg: string }> = {
    ok: {
        icon: CheckCircle2,
        ring: "border-emerald-300 dark:border-emerald-800",
        text: "text-emerald-700 dark:text-emerald-400",
        bg: "bg-emerald-50 dark:bg-emerald-950/30",
    },
    warn: {
        icon: AlertTriangle,
        ring: "border-amber-300 dark:border-amber-800",
        text: "text-amber-700 dark:text-amber-400",
        bg: "bg-amber-50 dark:bg-amber-950/30",
    },
    fail: {
        icon: XCircle,
        ring: "border-rose-300 dark:border-rose-800",
        text: "text-rose-700 dark:text-rose-400",
        bg: "bg-rose-50 dark:bg-rose-950/30",
    },
    unknown: {
        icon: HelpCircle,
        ring: "border-slate-300 dark:border-slate-700",
        text: "text-slate-600 dark:text-slate-400",
        bg: "bg-slate-50 dark:bg-slate-900/50",
    },
    not_configured: {
        icon: ShieldCheck,
        ring: "border-amber-300 dark:border-amber-800",
        text: "text-amber-700 dark:text-amber-400",
        bg: "bg-amber-50 dark:bg-amber-950/30",
    },
};

const LABEL: Record<Status, string> = {
    ok: "OK",
    warn: "WARNING",
    fail: "FAILED",
    unknown: "UNKNOWN",
    not_configured: "NOT CONFIGURED",
};

function Row({
    label,
    status,
    detail,
    value,
}: {
    label: string;
    status: Status;
    detail: string;
    value?: string;
}) {
    const tone = TONE[status];
    const Icon = tone.icon;
    return (
        <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${tone.ring} ${tone.bg}`}>
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.text}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        {label}
                    </span>
                    <span className={`text-[10px] font-black uppercase tracking-wider ${tone.text}`}>
                        {LABEL[status]}
                        {value ? <span className="ml-2 text-slate-500 normal-case tracking-normal">{value}</span> : null}
                    </span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400">{detail}</p>
            </div>
        </div>
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatWhen(iso: string | null): string {
    if (!iso) return "never";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

export function BackupStatusPanel() {
    const [data, setData] = useState<BackupStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);
        try {
            const res = await fetch("/api/system/backup-status", { cache: "no-store" });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "Could not read backup status");
            setData(json);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not read backup status");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    if (loading && !data) {
        return (
            <p className="py-8 text-center text-sm text-slate-500">
                Checking backup status on the server...
            </p>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-800 dark:bg-rose-950/30">
                <p className="text-sm font-bold text-rose-700 dark:text-rose-400">
                    Could not determine backup status
                </p>
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{error}</p>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                    Status UNKNOWN is not the same as healthy. Check the host directly with{" "}
                    <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">scripts\backup-health.ps1</code>.
                </p>
            </div>
        );
    }

    if (!data) return null;

    const head = TONE[data.overall];
    const HeadIcon = head.icon;
    const headline =
        data.overall === "ok"
            ? "Backup healthy"
            : data.overall === "warn"
              ? "Backup needs attention"
              : data.overall === "not_configured"
                ? "Backup not configured"
                : data.overall === "fail"
                  ? "Backup failing"
                  : "Backup status unknown";

    const stale =
        data.backup !== null && data.backup.ageHours > data.maxAgeHours;

    return (
        <div className="space-y-4">
            {/* Headline */}
            <div className={`flex items-start gap-3 rounded-2xl border-2 px-4 py-3 ${head.ring} ${head.bg}`}>
                <HeadIcon className={`mt-0.5 h-6 w-6 shrink-0 ${head.text}`} aria-hidden="true" />
                <div className="min-w-0">
                    <p className={`text-base font-black ${head.text}`}>{headline}</p>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                        Live state read from the host at {formatWhen(data.checkedAt)}.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    aria-label="Refresh backup status"
                    className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            <div className="grid gap-2">
                <Row
                    label="Last backup"
                    status={
                        !data.backup
                            ? "fail"
                            : stale
                              ? "fail"
                              : "ok"
                    }
                    detail={
                        !data.backup
                            ? "No dump found in backups/."
                            : `${data.backup.name} — ${formatBytes(data.backup.sizeBytes)}, taken ${data.backup.ageHours}h ago${stale ? ` (threshold ${data.maxAgeHours}h)` : ""}.`
                    }
                />
                <Row label="Integrity" status={data.integrity.state} detail={data.integrity.detail} />
                <Row label="Checksum" status={data.checksum.state} detail={data.checksum.detail} />
                <Row label="Scheduler" status={data.scheduler.state} detail={data.scheduler.detail} />
                <Row
                    label="Next run"
                    status={data.scheduler.nextRun ? "ok" : "unknown"}
                    detail={
                        data.scheduler.nextRun
                            ? `Next scheduled run: ${formatWhen(data.scheduler.nextRun)}.`
                            : "No next run is scheduled."
                    }
                />
                <Row
                    label="Last run"
                    status={
                        data.scheduler.lastResult === 0
                            ? "ok"
                            : data.scheduler.lastResult === null
                              ? "unknown"
                              : "fail"
                    }
                    detail={
                        data.scheduler.lastResult === null
                            ? "The scheduled task has not run, or its last result is unavailable."
                            : data.scheduler.lastResult === 0
                              ? `Last run ${formatWhen(data.scheduler.lastRun)} succeeded.`
                              : `Last run ${formatWhen(data.scheduler.lastRun)} returned result ${data.scheduler.lastResult}. Check Task Scheduler.`
                    }
                />
                <Row label="Off-site" status={data.offsite.state} detail={data.offsite.detail} />
                <Row
                    label="Restore test"
                    status={data.restoreTest.state}
                    detail={
                        data.restoreTest.ranAt
                            ? `${data.restoreTest.detail} Run ${formatWhen(data.restoreTest.ranAt)}.`
                            : data.restoreTest.detail
                    }
                />
                <Row
                    label="Retention"
                    status={data.retention.present > data.retention.configured ? "warn" : "ok"}
                    detail={`${data.retention.present} dump(s) present, ${data.retention.configured} configured to be kept.`}
                    value={`${data.retention.present}/${data.retention.configured}`}
                />
            </div>

            {/* Only shown when something is actually wrong, so it is not noise. */}
            {data.scheduler.state !== "ok" && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
                        <Clock className="h-4 w-4" />
                        Automatic backup not configured
                    </p>
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Nothing is taking backups on a schedule. Run this once in an ELEVATED PowerShell on
                        the database host:
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-[11px] text-slate-100">
                        {`powershell -ExecutionPolicy Bypass -File .\\scripts\\register-backup-task.ps1`}
                    </pre>
                </div>
            )}

            {data.offsite.state === "not_configured" && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
                        <ShieldCheck className="h-4 w-4" />
                        Off-site backup: NOT CONFIGURED
                    </p>
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Backups are on the same disk as the database. A disk failure, ransomware event or
                        lost host destroys both together. Until a remote destination is set, this backup
                        is not protected against the most common cause of total loss.
                    </p>
                </div>
            )}
        </div>
    );
}