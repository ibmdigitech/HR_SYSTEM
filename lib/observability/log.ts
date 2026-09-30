/**
 * Structured JSON logging.
 *
 * THE POINT
 * ---------
 * The audit checklist is blunt about 9.3: "`console.*` in production paths; no
 * log aggregation". Half of that is a format problem. `console.error("[x]", obj)`
 * writes an object graph that a log shipper renders differently per collector
 * and that a human has to read by eye.
 *
 * This module writes ONE JSON object per line to stdout. One object, one line,
 * no interleaving: `JSON.stringify` cannot contain a raw newline (it escapes
 * them), so two concurrent requests can never produce two records that a
 * line-oriented parser has to stitch back together. A collector such as
 * Filebeat, Vector, Fluent Bit, Loki's JSON stage or CloudWatch's
 * `awslogs` + a JSON extractor consumes this with configuration only and no
 * custom parser.
 *
 * NOT A LOGGER
 * ------------
 * There is deliberately no log level routing, no buffering, no file rotation
 * and no transport here. Anything beyond "write one line to stdout" belongs to
 * the process supervisor (systemd, Docker's json-file driver, the platform's
 * log agent), which already does those jobs better and with back-pressure.
 * Re-implementing them in-process is how a log library becomes the reason the
 * app falls over.
 *
 * SINGLE REDACTION AUTHORITY
 * --------------------------
 * Every value that reaches this module has already been through
 * `redact()` from `@/lib/auth/audit` - see `report.ts`. There is exactly one
 * redaction implementation in this codebase and this module does not add a
 * second one. See `REDACTION_LIMITATION` in `report.ts` for what that helper
 * does and does not cover.
 */

import { redact } from "@/lib/auth/audit";

export const LOG_LEVEL = {
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
} as const;

export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

/** Numeric rank, so a threshold can drop cheap lines before the JSON is built. */
const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
    [LOG_LEVEL.DEBUG]: 10,
    [LOG_LEVEL.INFO]: 20,
    [LOG_LEVEL.WARN]: 30,
    [LOG_LEVEL.ERROR]: 40,
};

/**
 * Fields that must never be a number: `NaN` and `Infinity` are not JSON, and
 * `JSON.stringify` turns both into `null`, which silently merges "NaN" and
 * "no value" in the aggregator.
 */
function jsonSafe(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value ?? null;
    const t = typeof value;
    if (t === "string" || t === "boolean") return value;
    if (t === "number") return Number.isFinite(value as number) ? value : String(value);
    if (t === "bigint") return (value as bigint).toString();
    if (t === "function" || t === "symbol") return undefined;
    if (depth > 6) return "[deep]";
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return jsonSafe(errorToPlain(value), depth + 1);
    if (Array.isArray(value)) return value.slice(0, 100).map((v) => jsonSafe(v, depth + 1));
    if (t === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const safe = jsonSafe(v, depth + 1);
            if (safe !== undefined) out[k] = safe;
        }
        return out;
    }
    return String(value);
}

/** Flattens an `Error` into its inspectable parts. Stacks are handled by callers. */
export function errorToPlain(error: Error): Record<string, unknown> {
    return { name: error.name, message: error.message };
}

/**
 * `process.stdout.write` is the sink on the server.
 *
 * Replaced wholesale in tests, and on any runtime where `process` is absent
 * (a browser) the writer falls back to `console.log`. The fallback is chosen by
 * feature detection, never by a build flag, so a bundled client copy behaves
 * correctly without a second code path to keep in sync.
 */
export type LogWriter = (line: string) => void;

const defaultWriter: LogWriter = (line) => {
    if (typeof process !== "undefined" && typeof process.stdout?.write === "function") {
        process.stdout.write(`${line}\n`);
        return;
    }
    // Browser fallback. There is no `no-console` rule in this project's config,
    // so no disable directive is needed here or in client-report.ts.
    console.log(line);
};

let writer: LogWriter = defaultWriter;

/** Redirects every log line. Intended for tests and for a future file sink. */
export function setLogWriter(next: LogWriter | null): void {
    writer = next ?? defaultWriter;
}

export function getLogWriter(): LogWriter {
    return writer;
}

export interface LogFields {
    [key: string]: unknown;
}

export interface LogEvent {
    level: LogLevel;
    /**
     * A stable, greppable event name. Prefer an enum over a prose message:
     * aggregators group and alert on this, not on the message.
     */
    event: string;
    message?: string;
    correlationId?: string | null;
    [key: string]: unknown;
}

/**
 * Writes one JSON object per line.
 *
 * `threshold` drops anything below it BEFORE `JSON.stringify` runs, so debug
 * logging in a hot path costs a rank comparison and not an allocation.
 * Defaults to `warn` outside development: a production process that has not
 * opted into more is not going to pay to build the objects.
 */
export function logEvent(event: LogEvent, threshold: LogLevel = defaultThreshold()): void {
    if (LEVEL_RANK[event.level] < LEVEL_RANK[threshold]) return;

    const { level, event: name, ...rest } = event;

    const envelope: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        event: name,
        service: "hr-system",
        env: envNodeEnv() ?? "unknown",
    };

    for (const [key, value] of Object.entries(rest)) {
        if (value === undefined) continue;
        envelope[key] = jsonSafe(value);
    }

    // `redact()` is the single redaction authority for the whole system. It is
    // applied here as a second gate over the SAME helper, not as a second
    // implementation: a caller that forgets to redact before handing over a
    // context object is still covered, and there is only ever one place where
    // the rules live.
    const line = JSON.stringify(redact(envelope));
    writer(line);
}

function defaultThreshold(): LogLevel {
    return envNodeEnv() === "development" ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN;
}

/** `process` is not declared at all in a browser bundle, so probe for it. */
export function envNodeEnv(): string | undefined {
    if (typeof process === "undefined") return undefined;
    return process.env?.NODE_ENV;
}
