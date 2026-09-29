/**
 * Health / readiness probe.
 *
 * WHY THIS EXISTS (PRODUCTION_READINESS_CHECKLIST 9.2, 9.5)
 * --------------------------------------------------------
 * The system had no health endpoint at all. An uptime monitor pointed at `/`
 * or any page route only proves that the Node process can serve HTML — a
 * container whose `DATABASE_URL` points at a dead host, a revoked password or
 * a stopped Postgres still answers 200. Every HR screen then fails, and the
 * first person to notice is a user.
 *
 * This route closes that gap by answering a different question: *can this
 * process actually reach its database right now?*
 *
 * DESIGN RULES
 * ------------
 * 1. Cheap. An uptime monitor may poll this every few seconds. The only query
 *    issued is `SELECT 1`, which touches no table, takes no lock and returns
 *    in well under a millisecond on a healthy link. It must never become a
 *    load generator for its own database.
 *
 * 2. Unauthenticated. A probe behind a session gate is useless to a monitor —
 *    there is no session to present. This handler performs no auth check of its
 *    own and deliberately exposes no business data, so there is nothing to
 *    protect. The response is a status word and a timestamp.
 *
 *    Making it reachable required an edit OUTSIDE this file, and the reason is
 *    worth recording. There are two edge gates, not one: `proxy.ts` matches
 *    every `/api/**` path, but the gate that actually answers is NextAuth's
 *    `authorized()` callback in `auth.config.ts`, which short-circuits with a
 *    `Response` before `proxy.ts`'s own callback ever runs. Editing
 *    `isPublicPath()` in `proxy.ts` alone changes nothing — the request never
 *    reaches it. `auth.config.ts` now returns `true` for `/api/health` ahead of
 *    its public-route branch, and `proxy.ts` carries a matching
 *    `NEVER_REDIRECT_PATHS` entry so a signed-in operator debugging an outage
 *    receives JSON rather than a redirect to /dashboard.
 *
 * 3. Never leaks. The response body is a fixed three-field object. Driver
 *    errors, which routinely embed the full connection string, are logged
 *    server-side only — and even there they are scrubbed of credentials, since
 *    a connection string in a log aggregator is still a credential leak.
 *
 * 4. Bounded. A blackholed host (packets dropped rather than refused) does not
 *    produce a fast TCP RST, so the probe is raced against a timeout. An
 *    unanswered health check is worse than a false "down": a monitor that
 *    blocks on a dead socket reports no failure at all.
 */

import { NextResponse } from "next/server";

// Probes must never be served from a cache or statically prerendered. A
// prerendered 200 would be the exact failure this route exists to prevent.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Upper bound on the probe. Long enough to absorb normal latency on a busy
 * link, short enough that a monitor polling every few seconds gets an answer
 * before the next tick and never has to multiplex requests behind a hung
 * socket.
 */
const PROBE_TIMEOUT_MS = 3000;

/** `postgresql://user:secret@host:5433/db` -> `postgresql://***@host:5433/db` */
const CREDENTIALS_IN_URL = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi;

/** `password=secret`, `PGPASSWORD=secret` — the key/value spelling. */
const CREDENTIALS_IN_KV = /\b(password|pgpassword|pwd)\s*=\s*\S+/gi;

const MAX_LOGGED_LENGTH = 500;

/**
 * Renders a caught value as a log-safe single line.
 *
 * Prisma and `pg` errors embed the connection string verbatim in `message`, so
 * logging `error` directly would write the database password into stdout on
 * every failed probe. Only the name and message are logged, never the stack,
 * which is both noisy at a 3-second poll interval and a second chance for a
 * secret to appear.
 */
function sanitizeForLog(error: unknown): string {
    const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return raw
        .replace(CREDENTIALS_IN_URL, "$1***@")
        .replace(CREDENTIALS_IN_KV, "$1=***")
        .slice(0, MAX_LOGGED_LENGTH);
}

/** Rejects with a timeout error if `promise` has not settled in time. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("database probe timed out")), ms);
        // The underlying query is not cancelled — Prisma has no portable abort.
        // It is left to fail on its own; the monitor has already moved on.
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/**
 * `200 { status: "ok", database: "up", timestamp }`
 * `503 { status: "degraded", database: "down", timestamp }`
 *
 * 503 rather than 500 is deliberate: the process is healthy and serving, it is
 * the dependency that is not. That distinction is what lets a load balancer
 * stop routing new traffic while leaving the instance in the pool for
 * recovery, and it is what a Kubernetes liveness probe must NOT see (that
 * would restart an otherwise-working pod during a database outage).
 */
export async function GET() {
    const timestamp = new Date().toISOString();
    // Proxies and the browser must not cache a verdict that is already stale.
    const headers = { "Cache-Control": "no-store, no-cache, must-revalidate" };

    try {
        // Imported dynamically, and this is not incidental. `lib/prisma.ts`
        // throws at module scope when `DATABASE_URL` is missing or points at
        // MongoDB. A static top-level import would move that failure to module
        // evaluation, where it becomes an opaque 500 from the framework. Here
        // it is caught and reported as the honest answer: not ready.
        const { default: prisma } = await import("@/lib/prisma");

        await withTimeout(prisma.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);

        return NextResponse.json({ status: "ok", database: "up", timestamp }, { status: 200, headers });
    } catch (error) {
        console.error("[health] database unreachable:", sanitizeForLog(error));
        return NextResponse.json(
            { status: "degraded", database: "down", timestamp },
            { status: 503, headers }
        );
    }
}
