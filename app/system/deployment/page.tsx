import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {
    GitCommitHorizontal,
    Database,
    Rocket,
    ShieldAlert,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    FileWarning,
    Clock,
} from "lucide-react";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

/**
 * Read-only deployment and migration status.
 *
 * WHY THIS PAGE EXISTS
 *
 * The audit in `docs/audit/DEPLOYMENT_INFRASTRUCTURE_AUDIT.md` found that
 * `prisma migrate deploy` cannot run against this project at all — the migration
 * lock declares `sqlite` while the schema declares `postgresql` (Prisma P3019) —
 * and that neither database has a `_prisma_migrations` table, because both were
 * built with `db push`. That means production schema changes today are
 * unreviewed DDL with no migration record and no rollback.
 *
 * That is a serious finding and it was invisible: nothing in the product
 * reported it. This page surfaces the real state rather than a reassuring
 * summary, and it is deliberately READ-ONLY. It performs no deploy, no migrate
 * and no write of any kind. Putting a production migration behind a button in an
 * admin UI is how databases get damaged.
 *
 * The verification commands an operator needs are shown as text to copy, not as
 * clickable actions.
 */

interface Check {
    id: string;
    label: string;
    status: "ok" | "warn" | "fail" | "unknown";
    detail: string;
}

async function gitInfo(): Promise<{ commit: string; branch: string; dirty: boolean } | null> {
    try {
        const run = async (args: string[]) => (await execFileAsync("git", args, { timeout: 5000 })).stdout.trim();
        const [commit, branch, status] = await Promise.all([
            run(["rev-parse", "--short", "HEAD"]),
            run(["rev-parse", "--abbrev-ref", "HEAD"]),
            run(["status", "--porcelain"]),
        ]);
        return { commit, branch, dirty: status.length > 0 };
    } catch {
        return null;
    }
}

export default async function SystemDeploymentPage() {
    await requirePermission(PERMISSIONS.SYSTEM_BACKUP_VIEW);

    const checks: Check[] = [];

    // ── Application identity ────────────────────────────────────────────────
    let version = "unknown";
    try {
        const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
        version = pkg.version ?? "unknown";
    } catch {
        /* leave unknown */
    }
    const git = await gitInfo();

    checks.push({
        id: "git",
        label: "Git state",
        status: git ? (git.dirty ? "warn" : "ok") : "unknown",
        detail: git
            ? `${git.branch} @ ${git.commit}${git.dirty ? " — UNCOMMITTED CHANGES present" : " — clean working tree"}`
            : "git is not available to this process",
    });

    checks.push({
        id: "commit-traceable",
        label: "Production traceability",
        status: git && !git.dirty ? "ok" : "warn",
        detail: git
            ? `Deployments should be traceable to a commit. Current tree is ${git.dirty ? "NOT clean — do not deploy this" : "clean"}.`
            : "Cannot confirm.",
    });

    // ── Database target ─────────────────────────────────────────────────────
    let dbTarget = "unknown";
    let dbReachable = false;
    let employeeCount: number | null = null;
    try {
        const rows = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM "Employee" WHERE "deletedAt" IS NULL`;
        employeeCount = Number(rows[0]?.n ?? 0);
        dbReachable = true;
        dbTarget = process.env.DATABASE_URL
            ? process.env.DATABASE_URL.replace(/\/\/([^:]+):[^@]+@/, "//$1:***@")
            : "DATABASE_URL not set";
    } catch (error) {
        dbTarget = `unreachable: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`;
    }

    checks.push({
        id: "database",
        label: "Database connectivity",
        status: dbReachable ? "ok" : "fail",
        detail: dbReachable ? `Reachable. ${employeeCount} active employee row(s).` : dbTarget,
    });

    // ── Migration state — the finding that matters ───────────────────────────
    let lockProvider: string | null = null;
    try {
        const lock = await readFile(path.join(process.cwd(), "prisma", "migrations", "migration_lock.toml"), "utf8");
        lockProvider = lock.match(/provider\s*=\s*"([^"]+)"/)?.[1] ?? null;
    } catch {
        /* absent */
    }

    let migrationDirs: string[] = [];
    try {
        const entries = await readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
        migrationDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
        /* absent */
    }

    let hasMigrationTable = false;
    if (dbReachable) {
        try {
            const rows = await prisma.$queryRaw<{ n: bigint }[]>`
                SELECT count(*)::bigint AS n FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`;
            hasMigrationTable = Number(rows[0]?.n ?? 0) > 0;
        } catch {
            hasMigrationTable = false;
        }
    }

    const schemaIsPostgres = true; // schema.prisma declares provider = "postgresql"
    const providerMismatch = lockProvider !== null && lockProvider !== "postgresql";

    checks.push({
        id: "migration-lock",
        label: "Migration provider lock",
        status: providerMismatch ? "fail" : lockProvider ? "ok" : "warn",
        detail: providerMismatch
            ? `migration_lock.toml declares "${lockProvider}" but the schema declares "postgresql". ` +
              "`prisma migrate deploy` fails with P3019 and cannot run."
            : lockProvider
              ? `Lock declares "${lockProvider}", matching the schema.`
              : "No migration_lock.toml found.",
    });

    checks.push({
        id: "migration-history",
        label: "Migration history in database",
        status: hasMigrationTable ? "ok" : "fail",
        detail: hasMigrationTable
            ? "_prisma_migrations exists, so applied migrations are recorded."
            : "No _prisma_migrations table. This database was built with `prisma db push`, " +
              "so schema changes are applied as direct DDL with no migration record, no review " +
              "and no rollback path.",
    });

    checks.push({
        id: "migrations-on-disk",
        label: "Migrations on disk",
        status: migrationDirs.length > 0 ? "ok" : "warn",
        detail:
            migrationDirs.length > 0
                ? `${migrationDirs.length} migration folder(s), oldest ${migrationDirs[0]}, newest ${migrationDirs[migrationDirs.length - 1]}.`
                : "No migration folders.",
    });

    // ── Backups ─────────────────────────────────────────────────────────────
    let backupDetail = "No backup directory found.";
    let backupStatus: Check["status"] = "unknown";
    try {
        const dir = path.join(process.cwd(), "backups");
        const entries = await readdir(dir);
        const dumps = entries.filter((n) => /^hr_system-\d{8}-\d{6}\.sql$/.test(n)).sort().reverse();
        if (dumps.length > 0) {
            const newest = dumps[0];
            const s = await stat(path.join(dir, newest));
            const ageH = Math.round(((Date.now() - s.mtimeMs) / 3_600_000) * 10) / 10;
            const sidecar = entries.includes(`${newest}.sha256`);
            backupStatus = ageH <= 26 && sidecar ? "ok" : ageH <= 26 ? "warn" : "fail";
            backupDetail =
                `${dumps.length} dump(s). Newest ${newest} (${Math.round(s.size / 1024)} KB, ${ageH}h old)` +
                `${sidecar ? ", checksum present" : ", NO CHECKSUM SIDECAR"}.`;
        }
    } catch {
        /* absent */
    }
    checks.push({ id: "backup", label: "Latest backup", status: backupStatus, detail: backupDetail });

    const overall: Check["status"] = checks.some((c) => c.status === "fail")
        ? "fail"
        : checks.some((c) => c.status === "warn")
          ? "warn"
          : "ok";

    const icon = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle, unknown: Clock };
    const tone = {
        ok: "text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20",
        warn: "text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20",
        fail: "text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20",
        unknown: "text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40",
    };

    return (
        <main className="mx-auto max-w-5xl space-y-6 p-6 lg:p-10">
            <div>
                <Link href="/system/backup" className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
                    &lt;- Backup &amp; Recovery
                </Link>
                <h1 className="mt-3 flex items-center gap-3 text-3xl font-bold tracking-tight">
                    <Rocket className="h-7 w-7 text-indigo-600" />
                    Deployment &amp; Health
                </h1>
                <p className="mt-1 text-slate-500 dark:text-slate-400">
                    Read-only status of this deployment and its migration state. Nothing on this page
                    deploys, migrates or writes — the commands are shown so you can run them
                    deliberately.
                </p>
            </div>

            {/* Honest headline */}
            <div className={`flex items-start gap-3 rounded-2xl border-2 px-4 py-3 ${tone[overall]}`}>
                {overall === "fail" ? (
                    <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0" />
                ) : (
                    <IconFor overall={overall} />
                )}
                <div>
                    <p className="text-base font-black">
                        {overall === "ok"
                            ? "Deployment state healthy"
                            : overall === "warn"
                              ? "Deployment state needs attention"
                              : "Deployment state has blocking problems"}
                    </p>
                    <p className="mt-0.5 text-xs opacity-90">
                        Application version {version}
                        {git ? ` · ${git.branch} @ ${git.commit}` : ""}
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <GitCommitHorizontal className="h-4 w-4 text-slate-500" />
                        Checks
                    </CardTitle>
                    <CardDescription>
                        Read live from the repository and the database at render time.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {checks.map((c) => {
                        const Icon = icon[c.status];
                        return (
                            <div
                                key={c.id}
                                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${tone[c.status]}`}
                            >
                                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                                        <span className="text-xs font-bold uppercase tracking-wider">
                                            {c.label}
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-wider">
                                            {c.status}
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-xs leading-snug opacity-90">{c.detail}</p>
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            {providerMismatch && (
                <Card className="border-rose-300 dark:border-rose-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base text-rose-700 dark:text-rose-400">
                            <FileWarning className="h-4 w-4" />
                            Schema changes are not currently safe to deploy
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                        <p>
                            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">prisma migrate deploy</code>{" "}
                            fails with <strong>P3019</strong> because the migration folder is locked to{" "}
                            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">sqlite</code> while the schema
                            declares <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">postgresql</code>. The
                            database has no migration history at all.
                        </p>
                        <p>
                            The only mechanism that currently works is{" "}
                            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">prisma db push</code>, which
                            applies DDL straight to the database with no migration file, no review gate and no rollback. That
                            is a live risk for every future schema change until the migration history is re-baselined.
                        </p>
                        <p className="text-xs">
                            Full analysis and the recommended fix order:{" "}
                            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                                docs/audit/DEPLOYMENT_INFRASTRUCTURE_AUDIT.md
                            </code>
                        </p>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Database className="h-4 w-4 text-slate-500" />
                        Commands
                    </CardTitle>
                    <CardDescription>
                        Deliberately not buttons. Copy and run these yourself, against the environment you
                        have confirmed.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {[
                        {
                            t: "Inspect migration state (read-only)",
                            c: "npx prisma migrate status",
                            n: "Safe. Currently expected to fail with P3019 — that failure IS the finding.",
                        },
                        {
                            t: "Create a migration (development only)",
                            c: "npx prisma migrate dev --name <change>",
                            n: "Never against production.",
                        },
                        {
                            t: "Apply migrations (staging / production)",
                            c: "npx prisma migrate deploy",
                            n: "The correct production mechanism once the history is re-baselined.",
                        },
                        {
                            t: "Verify backups before any schema change",
                            c: "powershell -ExecutionPolicy Bypass -File .\\scripts\\verify-backup.ps1 -Path <dump> -Checksum",
                            n: "Back up, checksum and validate BEFORE migrating. Never after.",
                        },
                    ].map((row) => (
                        <div key={row.t}>
                            <p className="text-sm font-semibold">{row.t}</p>
                            <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 text-[11px] text-slate-100">
                                {row.c}
                            </pre>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.n}</p>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Documentation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                    {[
                        ["docs/audit/DEPLOYMENT_INFRASTRUCTURE_AUDIT.md", "Infrastructure audit and readiness matrix."],
                        ["docs/audit/BACKUP_DISASTER_RECOVERY_AUDIT.md", "Backup, restore drill and off-site status."],
                        ["docs/audit/BENEFITS_INFRASTRUCTURE_AUDIT.md", "Reusable infrastructure for benefits/allowances."],
                    ].map(([p, note]) => (
                        <p key={p} className="text-slate-600 dark:text-slate-400">
                            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{p}</code>
                            {" — "}
                            {note}
                        </p>
                    ))}
                </CardContent>
            </Card>
        </main>
    );
}

function IconFor({ overall }: { overall: Check["status"] }) {
    if (overall === "ok") return <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />;
    return <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />;
}