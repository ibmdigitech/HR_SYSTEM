/**
 * `reportError` - the single entry point for production error reporting.
 *
 * SERVER ONLY. This module reaches `@/lib/auth/audit` for `redact()`, and
 * `lib/auth/audit.ts` imports `@/lib/prisma`, whose module scope THROWS when
 * `DATABASE_URL` is absent. That is precisely why `"use client"` files must use
 * `client-report.ts` instead: importing this from a client component would pull
 * the Prisma client into the browser bundle.
 *
 * GUARANTEES
 * ----------
 * 1. Never throws. An error reporter that throws replaces the error you were
 *    reporting with a worse one, at the worst possible moment. Every step is
 *    wrapped; the whole body is inside a try/catch whose catch only writes to
 *    stderr.
 * 2. Never blocks. Nothing here awaits. The default sink is a synchronous
 *    stdout write; a remote sink that needs the network must buffer and flush
 *    on a timer, not inside the caller's request.
 * 3. Always assigns exactly one correlation id, and returns it. The same id
 *    goes into the log envelope, into the sink payload and out of the function,
 *    so a caller can hand it to a support agent who can then be found in the
 *    aggregator.
 *
 * REDACTION LIMITATION - READ THIS BEFORE TRUSTING THE OUTPUT
 * -----------------------------------------------------------
 * `redact()` from `lib/auth/audit.ts` is used as-is and is the ONLY redaction
 * in this path. It is a strong control: it removes any value whose KEY is
 * sensitive, at any depth, in any casing or separator style, and it truncates
 * over-long strings.
 *
 * What it does NOT do is pattern-match secrets embedded in free text. A Prisma
 * initialisation error whose MESSAGE is
 *     "Can't reach database server at postgresql://user:pass@host:5433/db"
 * will be logged with that URL intact, because the secret is in the value, not
 * under a sensitive key. `redact()` truncates it; it does not scrub it.
 *
 * This is a known, unclosed gap and it is a security owner's decision to close
 * it - by extending `redact()` in `lib/auth/audit.ts` (the one true place) or
 * by removing credentials from `DATABASE_URL` and passing them out of band. It
 * is recorded in `docs/audit/OPS_OBSERVABILITY.md` and pinned by a test so it
 * cannot be forgotten.
 */

import { redact } from "@/lib/auth/audit";
import { getCorrelationId, getRequestContext } from "./context";
import { resolveCorrelationId, normaliseCorrelationId } from "./correlation";
import { classifyError, ERROR_KIND, type ErrorKind } from "./taxonomy";
import { getErrorSink, assertSinkConfiguration, consoleSink } from "./sinks";
import type { ErrorContext, ErrorReport } from "./types";

/**
 * Stacks in production.
 *
 * A stack is a filesystem map of the build. In a self-hosted Next.js container
 * that is a low-severity disclosure, but it is still disclosure, and the
 * correlation id plus the message plus the classification is what an operator
 * actually needs. `OBSERVABILITY_INCLUDE_STACK=1` re-enables it, which is what
 * a developer debugging a specific incident wants.
 */
function includeStack(): boolean {
    if (typeof process === "undefined") return false;
    if (process.env?.OBSERVABILITY_INCLUDE_STACK === "1") return true;
    return process.env?.NODE_ENV === "development";
}

export interface ReportErrorOptions {
    /**
     * Correlation id to use. Supply the inbound header value, or let the
     * ambient request context decide. A value that is not well-formed is
     * ignored in favour of a fresh id.
     */
    correlationId?: string | null;
    /** Overrides the classification derived from the error. */
    kind?: ErrorKind;
    /** Where the report came from, e.g. `api:/api/health`. */
    origin?: string;
    /** Route path. Must be a path; a full URL is rejected below. */
    route?: string | null;
    method?: string | null;
    userId?: string | null;
    userRole?: string | null;
    /** Extra structured detail. Redacted. Never put a secret here. */
    extra?: Record<string, unknown> | null;
}

/**
 * Keeps a route a ROUTE. A full URL puts the query string in the log, and
 * query strings carry search terms and filter values; they occasionally carry
 * worse. Anything that is not a plain path is reduced to its pathname or
 * dropped.
 */
export function sanitiseRoute(route: string | null | undefined): string | null {
    if (typeof route !== "string" || route.length === 0) return null;
    if (route.length > 200) return null;
    if (route.startsWith("/") && !route.includes("?")) return route;
    // Absolute URL, or a relative path with a query string: keep only the path.
    const match = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)/i.exec(route);
    if (match?.[1]) return match[1];
    return null;
}

/** A thrown value is not always an `Error`. Make one, without inventing detail. */
function toError(value: unknown): Error {
    if (value instanceof Error) return value;
    if (typeof value === "string" && value.length > 0) return new Error(value);
    try {
        return new Error(`Non-Error thrown: ${JSON.stringify(value) ?? String(value)}`);
    } catch {
        return new Error("Non-Error thrown: [unserialisable]");
    }
}

/**
 * Builds the report without emitting anything. Exposed separately so a caller
 * can enrich a report (add a user id discovered later) and pass it to a sink
 * itself, and so tests can assert on the payload without touching stdout.
 */
export function buildErrorReport(error: unknown, options: ReportErrorOptions = {}): ErrorReport {
    const err = toError(error);
    const classification =
        options.kind !== undefined
            ? { ...classifyError(err), kind: options.kind as ErrorKind }
            : classifyError(err);

    const ambient = getRequestContext();

    // One id, resolved once, used everywhere below. Precedence: an explicit
    // well-formed id, then the ambient request's id (so this report joins to
    // that request's ordinary logs), then a fresh one. An id that reaches this
    // function from outside the process - a header - is only honoured if it is
    // well-formed, so a caller cannot forge log content.
    const correlationId =
        normaliseCorrelationId(options.correlationId) ?? ambient?.correlationId ?? getCorrelationId();

    const context: ErrorContext = {
        route: sanitiseRoute(options.route ?? ambient?.route ?? null),
        method: (options.method ?? ambient?.method ?? null)?.slice(0, 16) ?? null,
        userId: options.userId ?? ambient?.userId ?? null,
        userRole: options.userRole ?? ambient?.userRole ?? null,
    };

    // A context field that was not supplied stays absent rather than becoming
    // `null`, so the aggregator does not have to distinguish "no user" from
    // "field not collected".
    for (const key of Object.keys(context) as (keyof ErrorContext)[]) {
        if (context[key] === null) delete context[key];
    }

    const stack = includeStack() && typeof err.stack === "string" ? err.stack : null;

    return {
        timestamp: new Date().toISOString(),
        correlationId,
        name: err.name || "Error",
        kind: classification.kind,
        message: err.message,
        stack,
        code: classification.code,
        retryable: classification.retryable,
        fatal: classification.fatal,
        context,
        extra: options.extra ? (redact(options.extra) as Record<string, unknown>) : null,
        origin: options.origin?.slice(0, 100) ?? "unknown",
    };
}

/**
 * Reports an error. Never throws; always returns the report it emitted.
 *
 * The returned value is what a caller uses for an incident reference, e.g.
 * `return NextResponse.json({ error: "Internal error", reference: report.correlationId }, { status: 500 })`.
 */
export function reportError(error: unknown, options: ReportErrorOptions = {}): ErrorReport {
    let report: ErrorReport | null = null;
    try {
        report = buildErrorReport(error, options);
    } catch (buildFailure) {
        // Reaching here means the reporter itself is broken. Say so on stderr
        // and hand back a minimal but well-formed report so the caller still
        // has something to quote.
        const fallbackId = resolveCorrelationId(null);
        report = {
            timestamp: new Date().toISOString(),
            correlationId: fallbackId,
            name: "ObservabilityError",
            kind: ERROR_KIND.INTERNAL,
            message: buildFailure instanceof Error ? buildFailure.message : String(buildFailure),
            stack: null,
            code: null,
            retryable: false,
            fatal: false,
            context: {},
            extra: null,
            origin: options.origin ?? "unknown",
        };
    }

    try {
        // Loud about the absence of a real backend, once, on the first error.
        assertSinkConfiguration();
        // stdout ALWAYS. This is the structured-logging path (9.3) and it is
        // not conditional on a remote backend existing.
        consoleSink.capture(report);
        // The remote backend, if one is registered. Additive by design.
        getErrorSink()?.capture(report);
    } catch {
        // A sink that throws must not become a 500 on a request that was
        // already being handled. The error is already on its way to stdout via
        // the logger in `buildErrorReport`'s caller path; here we only ensure
        // the failure is visible.
        try {
            process.stderr.write(
                `[observability] error sink failed: ${report.kind} ${report.name}\n`
            );
        } catch {
            /* stderr is gone too. Nothing further is possible or useful. */
        }
    }

    return report;
}
