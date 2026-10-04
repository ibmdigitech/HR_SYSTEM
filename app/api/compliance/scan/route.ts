import { NextResponse } from "next/server";
import { scanExpiringDocuments } from "@/lib/workflow/compliance";

export const dynamic = "force-dynamic";

/**
 * Runs the document-expiry scan.
 *
 * WHY THIS EXISTS
 *
 * `scanExpiringDocuments` was fully implemented but had no caller anywhere in
 * the app, so reminders were never produced: a visa could lapse with nobody
 * alerted. This route is the missing caller.
 *
 * Two ways in, both deliberate:
 *
 *  1. CRON — a scheduler POSTs here with `x-cron-secret`. This path performs no
 *     session check because a cron has no cookie, and it must NOT be reachable
 *     unauthenticated.
 *  2. MANUAL — an HR/Admin clicks "Run scan" on /visa with a normal session, so
 *     the page can be driven without waiting for the schedule.
 *
 * The cron path is refused when no secret is configured. Defaulting to "open"
 * would let anyone on the internet make this server write notifications and
 * audit rows on demand.
 */
export async function POST(request: Request) {
    const configuredSecret = process.env.CRON_SECRET;

    const cronSecret = request.headers.get("x-cron-secret");
    const isCronCall = Boolean(cronSecret) && Boolean(configuredSecret) && cronSecret === configuredSecret;

    if (!isCronCall) {
        // No usable cron credential in the header, so this must be an
        // interactive request. Require a real session with visa authority.
        const { getSessionUser } = await import("@/lib/auth/guards");
        const { hasAnyPermission, PERMISSIONS } = await import("@/lib/auth/permissions");

        const session = await getSessionUser();
        if (!session.ok) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }
        if (!hasAnyPermission(session.user.role, [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_MANAGE])) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }
    }

    try {
        const result = await scanExpiringDocuments();

        return NextResponse.json({
            success: true,
            thresholds: result.thresholds,
            scanned: result.scanned,
            candidates: result.candidates.length,
            remindersCreated: result.remindersCreated,
            remindersSkipped: result.remindersSkipped,
            notificationsSent: result.notificationsSent,
            errors: result.errors,
            detail: result.candidates
                .slice(0, 100)
                .map((c) => ({
                    employee: c.employeeName,
                    document: c.documentLabel,
                    daysRemaining: c.daysRemaining,
                    status: c.status,
                })),
        });
    } catch (error) {
        console.error("[COMPLIANCE_SCAN_FAILED]", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Scan failed" },
            { status: 500 }
        );
    }
}