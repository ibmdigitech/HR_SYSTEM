/**
 * The shape handed to a sink.
 *
 * Defined in its own module so `sinks.ts` does not have to import `report.ts`
 * to name a type. That would be a cycle: `report.ts` imports the sink registry,
 * the registry imports the report type.
 */

import type { ErrorKind } from "./taxonomy";

/**
 * Request context attached to a report.
 *
 * `userId` AND `userRole` ARE ALLOWED. `userEmail` IS NOT, and is not merely
 * "redacted by default" - it is not a field, so it cannot be set by mistake and
 * cannot be set at all. Email is a personal identifier that appears verbatim in
 * a security log elsewhere in this system (`SecurityAuditLog.actorEmail`); the
 * error log is a different audience with a different retention story, and the
 * id is what an operator actually needs to join against a user.
 *
 * `route` is a PATH, not a URL. A full URL carries the query string, and query
 * strings are where this application puts search terms, filters and, in a
 * forms app, occasionally more than that.
 */
export interface ErrorContext {
    route?: string | null;
    method?: string | null;
    userId?: string | null;
    userRole?: string | null;
}

export interface ErrorReport {
    /** ISO-8601, UTC. Assigned once, at capture. */
    timestamp: string;
    /** 32 lowercase hex. Stable across the whole report. */
    correlationId: string;
    /** The error's class name, e.g. `PrismaClientKnownRequestError`. */
    name: string;
    kind: ErrorKind;
    message: string;
    /** Scrubbed and truncated. Absent in production unless explicitly enabled. */
    stack: string | null;
    /** Stable machine code, e.g. `P2002`. `null` when the error carried none. */
    code: string | null;
    retryable: boolean;
    fatal: boolean;
    context: ErrorContext;
    /** Caller-supplied structured detail. Redacted like everything else. */
    extra: Record<string, unknown> | null;
    /** Which boundary reported this, e.g. `api:/api/health` or `client-boundary`. */
    origin: string;
}
