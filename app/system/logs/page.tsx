import Link from "next/link";
import { requirePageRole } from "@/lib/auth/page-guard";
import prisma from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SystemLogsPage() {
  await requirePageRole("SUPER_ADMIN", "ADMIN");

  const [securityLogs, activityLogs] = await Promise.all([
    prisma.securityAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-10">
      <div>
        <Link href="/settings" className="text-sm text-slate-500 hover:text-slate-900">&lt;- Settings</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">System logs</h1>
        <p className="mt-1 text-slate-500">Recent security events and employee activity. Showing up to 100 records in each list.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Security events</CardTitle>
          <CardDescription>Access, authentication, and privileged system changes.</CardDescription>
        </CardHeader>
        <CardContent>
          {securityLogs.length === 0 ? <p className="text-sm text-slate-500">No security events recorded.</p> : (
            <div className="space-y-3">
              {securityLogs.map((entry) => (
                <article key={entry.id} className="grid gap-2 rounded-lg border p-4 md:grid-cols-[180px_1fr_160px]">
                  <time className="text-sm text-slate-500" dateTime={entry.createdAt.toISOString()}>{entry.createdAt.toLocaleString()}</time>
                  <div className="min-w-0">
                    <p className="font-semibold">{entry.action.replaceAll("_", " ")}</p>
                    <p className="break-all text-sm text-slate-500">{entry.actorEmail ?? "System"}{entry.target ? ` | ${entry.target}` : ""}</p>
                    {entry.requestPath && <p className="text-xs text-slate-400">{entry.requestMethod ?? ""} {entry.requestPath}</p>}
                  </div>
                  <div className="flex items-start gap-2"><Badge variant={entry.outcome === "SUCCESS" ? "secondary" : "destructive"}>{entry.outcome}</Badge><span className="text-xs text-slate-500">{entry.actorRole ?? ""}</span></div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employee activity</CardTitle>
          <CardDescription>Recent changes recorded against employee records.</CardDescription>
        </CardHeader>
        <CardContent>
          {activityLogs.length === 0 ? <p className="text-sm text-slate-500">No employee activity recorded.</p> : (
            <div className="space-y-3">
              {activityLogs.map((entry) => (
                <article key={entry.id} className="grid gap-2 rounded-lg border p-4 md:grid-cols-[180px_1fr_180px]">
                  <time className="text-sm text-slate-500" dateTime={entry.createdAt.toISOString()}>{entry.createdAt.toLocaleString()}</time>
                  <div><p className="font-semibold">{entry.action.replaceAll("_", " ")}</p><p className="text-sm text-slate-500">{entry.details ?? "No additional details"}</p></div>
                  <p className="break-all text-sm text-slate-500">{entry.changedBy}</p>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
