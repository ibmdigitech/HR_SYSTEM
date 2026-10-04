import Link from "next/link";
import { requirePageRole } from "@/lib/auth/page-guard";
import prisma from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LogPagination } from "./log-pagination";
import { LogFilterBar } from "./log-filter-bar";
import type { Prisma } from "@/prisma/generated/client";

export const dynamic = "force-dynamic";

/**
 * Page size for both lists. Larger pages on an audit table cost more to scan and
 * make the browser render hundreds of articles; smaller pages make paging tedious.
 */
const PAGE_SIZE = 25;

/**
 * Parses and clamps `?page=`.
 *
 * A hand-edited or stale link can carry `page=0`, `page=-4`, `page=abc` or a page
 * far past the end. Clamping here means a bad value degrades to page 1 instead of
 * producing `skip: -50` (a Prisma error) or an empty list that looks like the
 * logs were deleted.
 */
function parsePage(raw: string | string[] | undefined): number {
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isInteger(n) || n < 1) return 1;
    // Hard ceiling: a runaway `?page=999999999` would otherwise compute a skip
    // large enough to be slow, even though it clamps to an empty page later.
    return Math.min(n, 10_000);
}

/** Trims a search term and treats blank as absent. */
function term(raw: string | string[] | undefined): string | undefined {
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    return v ? v : undefined;
}

export default async function SystemLogsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    await requirePageRole("SUPER_ADMIN", "ADMIN");

    const sp = await searchParams;

    // Each list has its OWN page cursor, and each carries the other's filters so
    // that switching tabs or paging one list does not discard a search applied to
    // the other. A single shared `?page=` would make paging the security list
    // jump the activity list to a possibly-nonexistent page.
    const securityPage = parsePage(sp.secPage);
    const activityPage = parsePage(sp.actPage);

    const action = term(sp.action);
    const outcome = term(sp.outcome);
    const q = term(sp.q);

    // `contains` on a case-insensitive column would need `mode: "insensitive"`,
    // which Postgres expresses as ILIKE and cannot use the btree indexes declared
    // on SecurityAuditLog. The term is matched case-insensitively in JS instead,
    // after a bounded indexed fetch — these tables hold thousands of rows, not
    // millions, and the audit view is a browsing tool rather than a hot path.
    const SEARCH_SCAN_LIMIT = 2000;

    const securityWhere: Prisma.SecurityAuditLogWhereInput = {
        ...(action ? { action } : {}),
        ...(outcome ? { outcome } : {}),
    };

    const securityCount = await prisma.securityAuditLog.count({ where: securityWhere });
    const securityRows = await prisma.securityAuditLog.findMany({
        where: securityWhere,
        orderBy: { createdAt: "desc" },
        take: SEARCH_SCAN_LIMIT,
    });
    const securityFiltered = q
        ? securityRows.filter((r) =>
              [r.actorEmail, r.target, r.requestPath, r.action]
                  .filter(Boolean)
                  .some((v) => v!.toLowerCase().includes(q.toLowerCase()))
          )
        : securityRows;
    const securityTotal = q ? securityFiltered.length : securityCount;
    const securityPageCount = Math.max(1, Math.ceil(securityTotal / PAGE_SIZE));
    const securitySlice = q
        ? securityFiltered.slice((securityPage - 1) * PAGE_SIZE, securityPage * PAGE_SIZE)
        : await prisma.securityAuditLog.findMany({
              where: securityWhere,
              orderBy: { createdAt: "desc" },
              skip: (securityPage - 1) * PAGE_SIZE,
              take: PAGE_SIZE,
          });

    const activityWhere: Prisma.AuditLogWhereInput = {
        ...(action ? { action } : {}),
        ...(q ? { changedBy: { contains: q } } : {}),
    };

    const activityTotal = await prisma.auditLog.count({ where: activityWhere });
    const activityPageCount = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
    const activitySlice = await prisma.auditLog.findMany({
        where: activityWhere,
        orderBy: { createdAt: "desc" },
        skip: (activityPage - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
    });

    // Distinct actions power the filter dropdown. Both are bounded by the number
    // of distinct strings in use (a few dozen), not by row count.
    const [securityActions, activityActions] = await Promise.all([
        prisma.securityAuditLog.findMany({ distinct: ["action"], select: { action: true } }),
        prisma.auditLog.findMany({ distinct: ["action"], select: { action: true } }),
    ]);

    const filterParams = { action, outcome, q };

    return (
        <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-900">
                        &lt;- Settings
                    </Link>
                    <h1 className="mt-3 text-3xl font-bold tracking-tight">System logs</h1>
                    <p className="mt-1 text-slate-500">
                        Security events and employee activity, newest first. Both lists are written
                        automatically and paginated — filter or page through the full history.
                    </p>
                </div>
                <LogFilterBar
                    securityActions={securityActions.map((a) => a.action).sort()}
                    activityActions={activityActions.map((a) => a.action).sort()}
                    current={filterParams}
                />
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <CardTitle>Security events</CardTitle>
                            <CardDescription>
                                Access, authentication, and privileged system changes.
                            </CardDescription>
                        </div>
                        <span className="text-xs font-bold text-slate-500">
                            {securityTotal.toLocaleString()} total
                        </span>
                    </div>
                </CardHeader>
                <CardContent>
                    {securityTotal === 0 ? (
                        <p className="text-sm text-slate-500">
                            {q || action || outcome
                                ? "No security events match these filters."
                                : "No security events recorded."}
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {securitySlice.map((entry) => (
                                <article
                                    key={entry.id}
                                    className="grid gap-2 rounded-lg border p-4 md:grid-cols-[180px_1fr_160px]"
                                >
                                    <time
                                        className="text-sm text-slate-500"
                                        dateTime={entry.createdAt.toISOString()}
                                    >
                                        {entry.createdAt.toLocaleString()}
                                    </time>
                                    <div className="min-w-0">
                                        <p className="font-semibold">
                                            {entry.action.replaceAll("_", " ")}
                                        </p>
                                        <p className="break-all text-sm text-slate-500">
                                            {entry.actorEmail ?? "System"}
                                            {entry.target ? ` | ${entry.target}` : ""}
                                        </p>
                                        {entry.requestPath && (
                                            <p className="text-xs text-slate-400">
                                                {entry.requestMethod ?? ""} {entry.requestPath}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <Badge
                                            variant={
                                                entry.outcome === "SUCCESS"
                                                    ? "secondary"
                                                    : "destructive"
                                            }
                                        >
                                            {entry.outcome}
                                        </Badge>
                                        <span className="text-xs text-slate-500">
                                            {entry.actorRole ?? ""}
                                        </span>
                                    </div>
                                </article>
                            ))}
                            <LogPagination
                                basePath="/system/logs"
                                param="secPage"
                                page={securityPage}
                                pageCount={securityPageCount}
                                total={securityTotal}
                                pageSize={PAGE_SIZE}
                                params={{ ...filterParams, actPage: String(activityPage) }}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <CardTitle>Employee activity</CardTitle>
                            <CardDescription>
                                Recent changes recorded against employee records.
                            </CardDescription>
                        </div>
                        <span className="text-xs font-bold text-slate-500">
                            {activityTotal.toLocaleString()} total
                        </span>
                    </div>
                </CardHeader>
                <CardContent>
                    {activityTotal === 0 ? (
                        <p className="text-sm text-slate-500">
                            {q || action
                                ? "No employee activity matches these filters."
                                : "No employee activity recorded."}
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {activitySlice.map((entry) => (
                                <article
                                    key={entry.id}
                                    className="grid gap-2 rounded-lg border p-4 md:grid-cols-[180px_1fr_180px]"
                                >
                                    <time
                                        className="text-sm text-slate-500"
                                        dateTime={entry.createdAt.toISOString()}
                                    >
                                        {entry.createdAt.toLocaleString()}
                                    </time>
                                    <div>
                                        <p className="font-semibold">
                                            {entry.action.replaceAll("_", " ")}
                                        </p>
                                        <p className="text-sm text-slate-500">
                                            {entry.details ?? "No additional details"}
                                        </p>
                                    </div>
                                    <p className="break-all text-sm text-slate-500">
                                        {entry.changedBy}
                                    </p>
                                </article>
                            ))}
                            <LogPagination
                                basePath="/system/logs"
                                param="actPage"
                                page={activityPage}
                                pageCount={activityPageCount}
                                total={activityTotal}
                                pageSize={PAGE_SIZE}
                                params={{ ...filterParams, secPage: String(securityPage) }}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}