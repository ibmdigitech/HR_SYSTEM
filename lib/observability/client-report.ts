/**
 * Client-boundary error reporting.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT `reportError`
 * ---------------------------------------------------
 * `report.ts` reaches `@/lib/auth/audit` for `redact()`, and `lib/auth/audit.ts`
 * imports `@/lib/prisma`, which instantiates a Prisma client at MODULE SCOPE and
 * THROWS if `DATABASE_URL` is missing. Importing `report.ts` from a
 * `"use client"` file therefore asks the bundler to put the Prisma client in a
 * browser bundle. That fails the build at best and ships the database driver to
 * every visitor at worst. So this file exists, and it imports NOTHING: no
 * `node:*`, no `@/lib/prisma`, no `@/lib/auth/audit`.
 *
 * The consequence, stated plainly: this path cannot call `redact()`. Instead it
 * is ALLOW-LISTED. Only the four fields below are ever emitted, and each is
 * either framework-generated or developer-written:
 *
 *   - `name`     from the caught value's constructor, coerced to a safe shape
 *   - `message`  the error's own text, truncated
 *   - `digest`   Next.js's opaque id, which is safe to display (it is already
 *                rendered to the user by `app/error.tsx`)
 *   - `correlationId` generated locally
 *
 * There is no `extra`, no `context`, no `userId`: nothing a caller can attach
 * ends up in the line. The allow-list IS the redaction here, which is why this
 * file is small enough to audit in one reading.
 *
 * WHAT THIS ACTUALLY ACHIEVES TODAY
 * ---------------------------------
 * Honest answer: with no ingest endpoint (which would live in `app/api/**`,
 * outside this change's file ownership) this writes to the BROWSER console, not
 * to the server. It makes the browser line a structured, greppable, id-bearing
 * record instead of a devtools blob, and it is the drop-in point for a
 * `navigator.sendBeacon` transport later. It does NOT by itself make 9.4 pass.
 */

import { newCorrelationId } from "./correlation";
import { classifyError, type ErrorKind } from "./taxonomy";

/** Bound on the message copied out of the browser. */
const MAX_MESSAGE_LENGTH = 500;

/**
 * `Error.prototype.name` is a plain string property, but a client-side value
 * may come from a library that overrode it with an object. Coerce to a string
 * and to a shape that cannot smuggle a newline into a log line.
 */
function safeName(value: unknown): string {
    const raw = value instanceof Error ? value.name : "Error";
    const name = typeof raw === "string" && raw.length > 0 ? raw : "Error";
    return name.replace(/[^A-Za-z0-9_.]/g, "").slice(0, 80) || "Error";
}

function safeMessage(value: unknown): string {
    const raw = value instanceof Error && typeof value.message === "string" ? value.message : String(value ?? "");
    // Newlines are escaped because this is a line-oriented format; an embedded
    // raw newline would split one record into two.
    return raw.replace(/[\r\n]+/g, " ").slice(0, MAX_MESSAGE_LENGTH);
}

function safeDigest(value: unknown): string | null {
    if (typeof value !== "string") return null;
    return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

export interface ClientErrorOptions {
    /** Next.js's `error.digest`, if the boundary has one. */
    digest?: string | null;
    correlationId?: string | null;
}

export interface ClientErrorReport {
    ts: string;
    level: "error";
    event: "error.report.client";
    service: "hr-system";
    origin: "client-boundary";
    name: string;
    kind: ErrorKind;
    message: string;
    digest: string | null;
    correlationId: string;
    retryable: boolean;
    fatal: boolean;
}

function writeLine(line: string): void {
    if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error(line);
    }
}

/**
 * Reports an error caught by a client error boundary.
 *
 * Returns the report, including the correlation id, so the boundary can show
 * it to the user. The id is the handle support uses: without it, a user
 * reporting "the page broke" gives an operator nothing to search for.
 */
export function reportClientError(error: unknown, options: ClientErrorOptions = {}): ClientErrorReport {
    const classification = classifyError(error);

    const report: ClientErrorReport = {
        ts: new Date().toISOString(),
        level: "error",
        event: "error.report.client",
        service: "hr-system",
        origin: "client-boundary",
        name: safeName(error),
        kind: classification.kind,
        message: safeMessage(error),
        digest: safeDigest(options.digest),
        correlationId: options.correlationId ?? newCorrelationId(),
        retryable: classification.retryable,
        fatal: classification.fatal,
    };

    try {
        writeLine(JSON.stringify(report));
    } catch {
        // Even this can fail if `JSON.stringify` meets a value it cannot
        // serialise. The fields above are all primitives, so it should not; the
        // catch is here because a reporter that throws inside an error
        // boundary replaces the error being handled.
    }

    return report;
}
