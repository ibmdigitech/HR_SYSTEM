/**
 * Error sink: the pluggable seam for a real error backend.
 *
 * WHY THIS EXISTS
 * ---------------
 * Audit item 9.4 is "No Sentry or equivalent. A production error is invisible
 * until a user reports it." The fix is not to add Sentry - `npm install` is out
 * of scope for this change and a vendor SDK is a decision an owning team should
 * make deliberately, with a data-processing decision attached to it.
 *
 * The fix is to make the CALL SITES backend-agnostic now. `reportError()` emits
 * a complete, immutable `ErrorReport` to whatever sink is registered. Adding
 * Sentry or OpenTelemetry later is then one new sink plus one registration call,
 * and ZERO changes to any call site - which is the property that makes it
 * plausible to do the migration at all.
 *
 * WHY THE DEFAULT IS A SINK THAT SAYS SO
 * --------------------------------------
 * The most dangerous outcome of this change is not "no monitoring"; it is
 * "monitoring that looks installed". A team sees `reportError()` in the code,
 * ticks the box on the audit, and nobody ever opens a dashboard - because a
 * silently-succeeding no-op is indistinguishable from a working integration in
 * every observable way.
 *
 * So the default sink reports, loudly and once, that it is a no-op and that
 * errors are going to stdout and nowhere else. If someone sets `SENTRY_DSN` or
 * an OTLP endpoint in the environment and no sink is registered, that is
 * reported as a MISCONFIGURATION, not as silence. See
 * `assertSinkConfiguration()`.
 */

import { logEvent, LOG_LEVEL } from "./log";
import type { ErrorReport } from "./types";

/**
 * A backend that can receive error reports.
 *
 * `capture` MUST be synchronous-safe and MUST NOT throw. `reportError` already
 * guarantees it never throws to its caller; a sink that throws in
 * `flush()` during shutdown is tolerated and logged, because a process that
 * cannot shut down cleanly is worse than a lost report.
 */
export interface ErrorSink {
    /** Stable identifier, e.g. `console` or `sentry`. Appears in the log line. */
    readonly name: string;
    /**
     * `false` means the sink does not transmit anywhere. Used to decide whether
     * the "no remote backend" warning applies.
     */
    readonly remote: boolean;
    capture(report: ErrorReport): void;
    /** Optional drain hook for a batching transport. Called on shutdown. */
    flush?(): Promise<void>;
}

/**
 * The default sink: writes to stdout via the structured logger and goes
 * nowhere else. `remote: false` is the whole point.
 */
export const consoleSink: ErrorSink = {
    name: "console",
    remote: false,
    capture(report) {
        logEvent(
            {
                level: LOG_LEVEL.ERROR,
                event: "error.report",
                correlationId: report.correlationId,
                name: report.name,
                kind: report.kind,
                message: report.message,
                stack: report.stack,
                code: report.code,
                retryable: report.retryable,
                fatal: report.fatal,
                context: report.context,
                extra: report.extra,
                origin: report.origin,
            },
            LOG_LEVEL.ERROR
        );
    },
};

let activeSink: ErrorSink | null = null;

/**
 * Registers a REMOTE backend. Pass `null` (or call `configureErrorSink(null)`)
 * to remove it.
 *
 * This is ADDITIVE, not a replacement: `reportError` always writes the
 * structured line to stdout, because stdout is what a log shipper reads and
 * that is the whole of checklist item 9.3. Registering Sentry must not take the
 * JSON logs away on the way to becoming a better version of 9.4.
 */
export function configureErrorSink(sink: ErrorSink | null): void {
    activeSink = sink;
}

/** The registered remote sink, or `null` when there is none. */
export function getErrorSink(): ErrorSink | null {
    return activeSink;
}

/**
 * Environment variables that mean "someone intended a real backend". Presence
 * without a registered sink is a misconfiguration worth shouting about, and it
 * is the specific failure this module exists to prevent: a DSN in the env that
 * nothing reads.
 */
const REMOTE_SINK_INTENT_VARS = ["SENTRY_DSN", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"] as const;

let warnedNoRemoteSink = false;
let warnedMisconfigured = false;

/**
 * Says, once, that no remote error backend is attached.
 *
 * Idempotent per process, because a per-request log line saying "you have no
 * error monitoring" would be itself a flood - and would train operators to
 * ignore the one message that matters.
 */
export function assertSinkConfiguration(): void {
    const remoteConfigured = REMOTE_SINK_INTENT_VARS.filter(
        (name) => typeof process !== "undefined" && Boolean(process.env?.[name])
    );

    if (remoteConfigured.length > 0) {
        if (warnedMisconfigured) return;
        warnedMisconfigured = true;
        logEvent(
            {
                level: LOG_LEVEL.ERROR,
                event: "observability.sink.misconfigured",
                message:
                    "A remote error backend is configured in the environment but no sink is " +
                    "registered. Errors are being written to stdout only and are being LOST.",
                variables: remoteConfigured,
                hint: "Call configureErrorSink() with a sink for these endpoints during startup.",
            },
            LOG_LEVEL.ERROR
        );
        return;
    }

    if (activeSink?.remote) return;
    if (warnedNoRemoteSink) return;
    warnedNoRemoteSink = true;
    logEvent(
        {
            level: LOG_LEVEL.WARN,
            event: "observability.sink.absent",
            message:
                "No remote error backend is configured. Errors are written to stdout as JSON " +
                "only. Unless a log shipper is collecting stdout into an alerting pipeline, " +
                "this system has NO error monitoring (audit 9.4 is not satisfied by this).",
            sink: activeSink ? activeSink.name : consoleSink.name,
            hint: "Register a sink with configureErrorSink(), and ship stdout to an aggregator.",
        },
        LOG_LEVEL.WARN
    );
}

/** Test seam. Forgets that the warnings have already been emitted. */
export function resetSinkWarnings(): void {
    warnedNoRemoteSink = false;
    warnedMisconfigured = false;
}
