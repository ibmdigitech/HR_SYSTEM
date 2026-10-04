import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import Link from "next/link";
import { BackupStatusPanel } from "@/components/settings/backup-status-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Terminal,
    FileCheck2,
    RotateCcw,
    ShieldCheck,
    HardDriveDownload,
    CalendarClock,
} from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Backup and disaster recovery, surfaced in the sidebar.
 *
 * It exists because the backup scripts were only reachable by knowing a file
 * path. A nightly backup nobody opens is a backup nobody notices failing, so the
 * status has to live somewhere the administrator already goes.
 *
 * Role gate matches /system/logs — this exposes host paths, container names and
 * scheduler state, so it is an administrator surface, not an HR one.
 *
 * Every number on the page is read from the host at render time. Nothing here
 * is hardcoded, and nothing reports a state it did not verify.
 */

const SCRIPT = "scripts\\";

export default async function SystemBackupPage() {
    // `SYSTEM_BACKUP_VIEW` rather than a bare role check. The sidebar link is
    // gated on this same permission, so a user can never be shown a link that
    // leads to a refusal — which is what happened while this page was gated on
    // `requirePageRole("SUPER_ADMIN", "ADMIN")` while HR could see the link.
    await requirePermission(PERMISSIONS.SYSTEM_BACKUP_VIEW);

    return (
        <main className="mx-auto max-w-5xl space-y-6 p-6 lg:p-10">
            <div>
                <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
                    &lt;- Settings
                </Link>
                <h1 className="mt-3 text-3xl font-bold tracking-tight">Backup &amp; Recovery</h1>
                <p className="mt-1 text-slate-500 dark:text-slate-400">
                    Live state of the database backup, verified against the host. Nothing on this page
                    is assumed — an unverified state is reported as unknown, never as healthy.
                </p>
            </div>

            <BackupStatusPanel />

            <Tabs defaultValue="run">
                <TabsList className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-1 h-11 rounded-xl shadow-sm">
                    <TabsTrigger value="run" className="rounded-lg px-3 font-bold text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all gap-1.5">
                        <Terminal className="h-3.5 w-3.5" />
                        Commands
                    </TabsTrigger>
                    <TabsTrigger value="schedule" className="rounded-lg px-3 font-bold text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Scheduling
                    </TabsTrigger>
                    <TabsTrigger value="recover" className="rounded-lg px-3 font-bold text-xs data-[state=active]:bg-indigo-600 data-[state=active]:text-white transition-all gap-1.5">
                        <RotateCcw className="h-3.5 w-3.5" />
                        Recovery
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="run" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <FileCheck2 className="h-4 w-4 text-indigo-600" />
                                Take and verify a backup
                            </CardTitle>
                            <CardDescription>
                                Run these from an elevated PowerShell in the repository root.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Command
                                title="Create a backup"
                                note="Dumps, validates, checksums, then applies retention. Retention never deletes the newest good dump."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}backup.ps1`}
                            />
                            <Command
                                title="Verify the newest backup"
                                note="Eight structural checks. Exits non-zero on a truncated, empty or non-SQL file."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}verify-backup.ps1 -Path .\\backups\\<dump>.sql -Checksum`}
                            />
                            <Command
                                title="Prove it is recoverable"
                                note="Restores into a disposable container, compares every table, then destroys it. The live database is never touched."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}restore-drill.ps1`}
                            />
                            <Command
                                title="Run the full test suite"
                                note="Positive cases plus every negative case: truncated, empty, non-SQL, corrupted checksum, missing container, wrong database."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}test-backup-system.ps1`}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="schedule" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Nightly backup task</CardTitle>
                            <CardDescription>
                                Registers <code>HRMS-Backup</code>, daily at 02:00. Re-running is
                                safe — it updates the existing task rather than creating a duplicate.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Command
                                title="Install (requires an Administrator terminal)"
                                note="Registration writes to Task Scheduler, which needs elevation. The installer will not elevate itself or prompt for UAC; it prints the exact command to run instead."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}register-backup-task.ps1`}
                            />
                            <Command
                                title="Verify the installed task"
                                note="Confirms the task exists, is enabled, runs at the right time, points at the right script, and resolves to the production container."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}verify-backup-task.ps1`}
                            />
                            <Command
                                title="Remove the task"
                                note="Touches only the task named HRMS-Backup. No other scheduled task is read or altered."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}unregister-backup-task.ps1`}
                            />
                        </CardContent>
                    </Card>

                    <Card className="border-amber-300 dark:border-amber-800">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base text-amber-800 dark:text-amber-300">
                                <ShieldCheck className="h-4 w-4" />
                                Production must be named explicitly
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                            <p>
                                <code>hr_system_db</code> is the production Compose database.{" "}
                                <code>hr-postgres</code> must not be assumed to be production.
                            </p>
                            <p>
                                Set <code>BACKUP_CONTAINER=hr_system_db</code> on any production
                                host. Running with <code>BACKUP_ENV=production</code> against
                                anything else fails before a dump is written, rather than silently
                                archiving the development database.
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="recover" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <RotateCcw className="h-4 w-4 text-rose-600" />
                                Restore into production
                            </CardTitle>
                            <CardDescription>
                                Destructive and irreversible. The full procedure, including the
                                disaster recovery runbook, is in the operations document.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Command
                                title="Restore"
                                note="Takes a safety backup first, drops and recreates the public schema, and loads with ON_ERROR_STOP=1 so a failure aborts instead of leaving a half-loaded database."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}restore.ps1 -Path .\\backups\\<dump>.sql`}
                            />
                            <Command
                                title="Rehearse without risk"
                                note="Same restore path, into a disposable container that is destroyed afterwards."
                                code={`powershell -ExecutionPolicy Bypass -File .\\${SCRIPT}restore-drill.ps1 -KeepScratch`}
                            />
                        </CardContent>
                    </Card>

                    <Card className="border-amber-300 dark:border-amber-800">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base text-amber-800 dark:text-amber-300">
                                <HardDriveDownload className="h-4 w-4" />
                                Off-site copy
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                            <p>
                                Until <code>OFFSITE_BACKUP_PATH</code> is set, backups live on the
                                same disk as the database they protect. A disk failure, ransomware
                                event, or lost host destroys both together — that is the single
                                largest remaining risk in the backup arrangement.
                            </p>
                            <p>
                                The status panel above reports this as NOT CONFIGURED rather than
                                implying the backup is protected.
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Documentation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                    {[
                        ["docs/operations/BACKUP_AND_RESTORE.md", "Architecture, retention, restore and disaster recovery runbook."],
                        ["docs/audit/BACKUP_DISASTER_RECOVERY_AUDIT.md", "Audit findings, open risks and readiness criteria."],
                        ["docs/audit/BACKUP_AUDIT_PHASE1.md", "The original pre-change audit."],
                    ].map(([path, note]) => (
                        <p key={path} className="text-slate-600 dark:text-slate-400">
                            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{path}</code>
                            {" — "}
                            {note}
                        </p>
                    ))}
                    <p className="pt-1">
                        <Link href="/system/logs" className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                            View system logs &rarr;
                        </Link>
                    </p>
                </CardContent>
            </Card>
        </main>
    );
}

function Command({ title, note, code }: { title: string; note: string; code: string }) {
    return (
        <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{note}</p>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-[11px] text-slate-100">
                {code}
            </pre>
        </div>
    );
}