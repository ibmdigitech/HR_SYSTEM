import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { getSessionUser } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

/**
 * Real backup status for the Settings panel.
 *
 * WHY THIS ROUTE EXISTS
 *
 * The Backup tab used to render static text telling the administrator to run the
 * installer "once". It had no idea whether that ever happened, so the panel
 * reported nothing on a system where backups had silently not run for a month.
 * A status panel that cannot fail is worse than no panel: it reads as
 * reassurance.
 *
 * This route reports only what it can verify. Anything it cannot determine is
 * reported as `unknown`, never as `ok`.
 *
 * RELATIONSHIP TO scripts/backup-health.ps1
 *
 * Both read the same three sources - the backups directory, the Windows
 * scheduled task, and the off-site environment variables - and must agree on
 * states and thresholds. The PowerShell script is the operator/CI tool and
 * returns a richer JSON document; this route exists because a browser cannot run
 * PowerShell, and shelling out to it from a request handler would make the panel
 * depend on a Windows-only subprocess on every page load. If you change a
 * threshold or a state name here, change it there too.
 *
 * SECURITY
 * Admin-only. The response contains infrastructure detail (host paths, container
 * names, scheduler state) which is not appropriate for a general HR user. No
 * credential, connection string or secret is ever included.
 */

type Status = "ok" | "warn" | "fail" | "unknown" | "not_configured";

const BACKUP_FILE_RE = /^hr_system-(\d{8})-(\d{6})\.sql$/;
const TASK_NAME = "HRMS-Backup";
/** 26h: one daily run plus slack, so a run slightly late is not a warning. */
const MAX_AGE_HOURS = 26;
/**
 * A floor, not a real integrity check. The real check is scripts/verify-backup.ps1.
 * A dump below this is certainly broken; a dump above it may still be truncated,
 * which is why the structural verification stays in the PowerShell script.
 */
const MIN_DUMP_BYTES = 1024;

function safeJoin(root: string, name: string): string | null {
    const resolved = path.resolve(root, name);
    // Defence in depth: this route only ever reads, but a filename that escapes
    // the backup directory must never be stat'd or hashed.
    return resolved.startsWith(path.resolve(root)) ? resolved : null;
}

async function schedulerState(): Promise<{
    state: Status;
    detail: string;
    lastRun: string | null;
    lastResult: number | null;
    nextRun: string | null;
}> {
    if (process.platform !== "win32") {
        return {
            state: "unknown",
            detail: "Scheduled tasks are a Windows facility; this host is not Windows.",
            lastRun: null,
            lastResult: null,
            nextRun: null,
        };
    }

    try {
        // /XML gives LastRunTime and NextRunTime, which /FO LIST does not, and
        // avoids the locale-dependent column layout of the human-readable form.
        const { stdout } = await execFileAsync(
            "schtasks.exe",
            ["/Query", "/TN", TASK_NAME, "/XML"],
            { timeout: 10_000, windowsHide: true }
        );

        const enabled = !/<Enabled>false<\/Enabled>/i.test(stdout);

        const lastRunRaw = pickTag(stdout, "LastRunTime");
        const nextRunRaw = pickTag(stdout, "NextRunTime");
        const lastResultRaw = pickTag(stdout, "LastTaskResult");

        // 267009 (0x41301) is SCHED_S_TASK_HAS_NOT_RUN. It means "never", not
        // "failed", and conflating the two would page someone on a fresh host.
        const lastResult = lastResultRaw === null ? null : Number(lastResultRaw);
        const neverRun = lastResult === 267009;

        return {
            state: enabled ? "ok" : "warn",
            detail: enabled
                ? neverRun
                    ? `${TASK_NAME} is registered and enabled but has never run.`
                    : `${TASK_NAME} is registered and enabled.`
                : `${TASK_NAME} is registered but DISABLED.`,
            lastRun: neverRun ? null : lastRunRaw,
            lastResult,
            nextRun: nextRunRaw,
        };
    } catch (error: any) {
        // schtasks exits non-zero when the task does not exist. That is the
        // common case on an unconfigured host and is the single most important
        // thing this panel has to say honestly.
        const notFound =
            error?.code === 1 ||
            /cannot find|no tasks|ERROR:/i.test(String(error?.stderr ?? error?.message ?? ""));

        return {
            state: notFound ? "warn" : "unknown",
            detail: notFound
                ? `${TASK_NAME} is NOT registered. Automatic backup is not running on this host.`
                : `Could not query the scheduled task: ${String(error?.message ?? "unknown error").slice(0, 200)}`,
            lastRun: null,
            lastResult: null,
            nextRun: null,
        };
    }
}

function pickTag(xml: string, tag: string): string | null {
    const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
    return m ? m[1].trim() : null;
}

export async function GET() {
    try {
        const session = await getSessionUser();
        if (!session.ok) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }
        // Same permission as the page and the sidebar link. It was VISA_MANAGE,
        // which is semantically unrelated and had two consequences: a role with
        // visa rights but no admin rights could read host paths, container names
        // and scheduler state, while an administrator with no visa rights could
        // open the page and be refused by its own status fetch.
        if (!hasPermission(session.user.role, PERMISSIONS.SYSTEM_BACKUP_VIEW)) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const backupDir = path.join(process.cwd(), "backups");
        const now = Date.now();

        // --- newest dump -----------------------------------------------------
        let newest: {
            name: string;
            sizeBytes: number;
            modifiedAt: string;
            ageHours: number | null;
        } | null = null;

        try {
            const entries = await readdir(backupDir);
            const dumps = entries
                .map((name) => ({ name, match: BACKUP_FILE_RE.exec(name) }))
                .filter((e): e is { name: string; match: RegExpExecArray } => e.match !== null);

            const resolved = await Promise.all(
                dumps.map(async (d) => {
                    const full = safeJoin(backupDir, d.name);
                    if (!full) return null;
                    const s = await stat(full);
                    return { name: d.name, sizeBytes: s.size, modifiedAt: s.mtime.toISOString() };
                })
            );

            const valid = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
            // Newest by the timestamp in its own name, not by mtime: a file that
            // was copied or restored has a misleading mtime.
            valid.sort((a, b) => (BACKUP_FILE_RE.exec(b.name)![1] + BACKUP_FILE_RE.exec(b.name)![2]).localeCompare(BACKUP_FILE_RE.exec(a.name)![1] + BACKUP_FILE_RE.exec(a.name)![2]));

            const top = valid[0];
            if (top) {
                newest = {
                    ...top,
                    ageHours: Math.round(((now - new Date(top.modifiedAt).getTime()) / 3_600_000) * 10) / 10,
                };
            }
        } catch (error: any) {
            if (error?.code !== "ENOENT") throw error;
            newest = null;
        }

        const dumpCount = await countDumps(backupDir);

        // --- checksum --------------------------------------------------------
        let checksum: { state: Status; detail: string } = {
            state: "unknown",
            detail: "No backup to verify.",
        };
        if (newest) {
            checksum = await verifyChecksum(backupDir, newest.name);
        }

        // --- structural verification marker -----------------------------------
        // Full structural verification lives in scripts/verify-backup.ps1 because
        // it means reading a multi-megabyte file. This route reports only what it
        // can check cheaply, and says so rather than implying more.
        const integrity: { state: Status; detail: string } = newest
            ? {
                  state: newest.sizeBytes < MIN_DUMP_BYTES ? "fail" : "ok",
                  detail:
                      newest.sizeBytes < MIN_DUMP_BYTES
                          ? `Dump is only ${newest.sizeBytes} bytes, which cannot be a full database.`
                          : `Size looks plausible. Run scripts\\verify-backup.ps1 for structural verification.`,
              }
            : { state: "fail", detail: "No backup found." };

        // --- scheduler -------------------------------------------------------
        const scheduler = await schedulerState();

        // --- off-site --------------------------------------------------------
        const offsiteEnabled = process.env.OFFSITE_BACKUP_ENABLED === "true";
        const offsitePath = process.env.OFFSITE_BACKUP_PATH;
        const offsite = offsiteEnabled && offsitePath
            ? { state: "ok" as Status, detail: `Configured: ${offsitePath}` }
            : {
                  state: "not_configured" as Status,
                  detail:
                      "NOT CONFIGURED. Backups exist only on the same disk as the database. A disk failure loses both.",
              };

        // --- restore drill ---------------------------------------------------
        const restoreTest = await readRestoreDrillRecord();

        // --- retention -------------------------------------------------------
        const keep = Number(process.env.BACKUP_KEEP ?? "14");
        const retention = {
            configured: Number.isFinite(keep) ? keep : 14,
            present: dumpCount,
        };

        // --- overall ---------------------------------------------------------
        // HEALTHY is only reachable when a recent dump exists AND the scheduler is
        // registered. Off-site being unconfigured is a WARNING, never a pass:
        // a local-only backup is not a protected backup.
        const hasRecentDump = newest !== null && newest.ageHours !== null && newest.ageHours <= MAX_AGE_HOURS;
        const schedulerRegistered = scheduler.state === "ok";

        let overall: Status;
        if (!newest) overall = "fail";
        else if (!hasRecentDump) overall = "fail";
        else if (!schedulerRegistered) overall = "warn";
        else if (offsite.state === "not_configured") overall = "warn";
        else overall = "ok";

        return NextResponse.json({
            overall,
            backup: newest,
            dumpCount,
            maxAgeHours: MAX_AGE_HOURS,
            staleThresholdHours: MAX_AGE_HOURS,
            integrity,
            checksum,
            scheduler,
            offsite,
            restoreTest,
            retention,
            checkedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error("[BACKUP_STATUS_FAILED]", error);
        return NextResponse.json({ error: "Could not determine backup status" }, { status: 500 });
    }
}

async function countDumps(dir: string): Promise<number> {
    try {
        const entries = await readdir(dir);
        return entries.filter((n) => BACKUP_FILE_RE.test(n)).length;
    } catch {
        return 0;
    }
}

async function verifyChecksum(
    dir: string,
    dumpName: string
): Promise<{ state: Status; detail: string }> {
    const sidecar = safeJoin(dir, `${dumpName}.sha256`);
    if (!sidecar) return { state: "unknown", detail: "Could not resolve checksum path." };

    let expected: string;
    try {
        const raw = await readFile(sidecar, "utf8");
        // sha256sum layout: "<hash>  <think>" (two spaces).
        expected = raw.trim().split(/\s+/)[0].toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expected)) {
            return { state: "fail", detail: "Checksum file is malformed." };
        }
    } catch {
        return {
            state: "unknown",
            detail: "No .sha256 sidecar for the newest dump. It predates checksum support.",
        };
    }

    const dumpPath = safeJoin(dir, dumpName);
    if (!dumpPath) return { state: "unknown", detail: "Could not resolve dump path." };

    try {
        const buf = await readFile(dumpPath);
        const actual = createHash("sha256").update(buf).digest("hex");
        return actual === expected
            ? { state: "ok", detail: "SHA-256 matches." }
            : { state: "fail", detail: "SHA-256 MISMATCH. The file has changed since it was written." };
    } catch (error: any) {
        return { state: "unknown", detail: `Could not read the dump: ${error?.code ?? "error"}` };
    }
}

/**
 * Reads the record the restore drill writes. A drill that passed is the only
 * evidence that the backup is actually recoverable, so its absence must be
 * visible rather than assumed.
 */
async function readRestoreDrillRecord(): Promise<{
    state: Status;
    detail: string;
    ranAt: string | null;
    passed: boolean | null;
}> {
    try {
        const file = path.join(process.cwd(), "docs", "audit", "restore-drill-last.json");
        const raw = await readFile(file, "utf8");
        // Windows PowerShell 5.1's `Out-File -Encoding utf8` writes a BOM, and
        // `JSON.parse` throws on a leading U+FEFF. Observed on this host: the
        // record existed and was valid, but every parse failed and the panel
        // reported "no drill has ever been recorded" for a drill that had passed.
        // The file is produced by a PowerShell tool, so the reader absorbs the
        // BOM rather than assuming a well-behaved producer.
        const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
        const passed = Boolean(parsed.passed);
        return {
            state: passed ? "ok" : "fail",
            detail: passed
                ? `Drill passed: ${parsed.tables?.length ?? "?"} tables compared, ${parsed.mismatches ?? "?"} mismatches.`
                : "The most recent restore drill FAILED. The backup is not proven recoverable.",
            ranAt: parsed.completedAt ?? null,
            passed,
        };
    } catch {
        return {
            state: "warn",
            detail: "No readable restore drill record. Recoverability is unproven.",
            ranAt: null,
            passed: null,
        };
    }
}