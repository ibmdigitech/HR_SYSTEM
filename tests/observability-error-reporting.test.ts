/**
 * Error reporting tests (PRODUCTION_READINESS_CHECKLIST 9.4).
 *
 * WHAT IS ACTUALLY BEING PROVEN HERE
 * ----------------------------------
 * `tests/audit-redaction.test.ts` already proves that `redact()` works. That is
 * not the same claim as "secrets do not reach the error log", which is the claim
 * that matters. A redaction helper that is correct and then not called on the
 * path that writes production output passes the first test and leaks in
 * production.
 *
 * So the tests below drive the real `reportError()` and assert on the bytes it
 * would write. One of them (`free text is NOT pattern-scrubbed`) pins a known
 * limitation on purpose, so it cannot quietly persist.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { reportError, buildErrorReport, sanitiseRoute } from "@/lib/observability/report";
import { setLogWriter } from "@/lib/observability/log";
import {
    configureErrorSink,
    consoleSink,
    resetSinkWarnings,
    getErrorSink,
    type ErrorSink,
} from "@/lib/observability/sinks";
import { classifyError, ERROR_KIND, kindFromHttpStatus, AppError } from "@/lib/observability/taxonomy";
import { normaliseCorrelationId, CORRELATION_ID_PATTERN, newCorrelationId } from "@/lib/observability/correlation";
import { runWithRequestContext } from "@/lib/observability/context";
import type { ErrorReport } from "@/lib/observability/types";

/** Captures the exact stdout bytes the logger would write. */
let written: string[] = [];

beforeEach(() => {
    written = [];
    setLogWriter((line) => {
        written.push(line);
    });
    configureErrorSink(null);
    resetSinkWarnings();
});

afterEach(() => {
    setLogWriter(null);
    configureErrorSink(null);
    resetSinkWarnings();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

function lastLine(): Record<string, unknown> {
    return JSON.parse(written[written.length - 1]);
}

/* ------------------------------------------------------------------ */
/* Redaction through the reporting call path                          */
/* ------------------------------------------------------------------ */

describe("redaction through reportError", () => {
    it("redacts a sensitive key inside caller-supplied extra context", () => {
        reportError(new Error("boom"), {
            extra: { action: "SEED_EXECUTED", password: "hunter2", role: "ADMIN" },
        });

        const line = lastLine();
        const extra = line.extra as Record<string, unknown>;

        expect(extra.password).toBe("[redacted]");
        // Proves redact() ran on OUR path: operational detail survived intact
        // in the same object, so this is not a blanket "[unserialisable]".
        expect(extra.action).toBe("SEED_EXECUTED");
        expect(extra.role).toBe("ADMIN");
        expect(written.join("\n")).not.toContain("hunter2");
    });

    it("redacts every key spelling redact() normalises, in one payload", () => {
        reportError(new Error("credential leak"), {
            extra: {
                password: "a",
                PASSWORD: "b",
                refresh_token: "c",
                refreshToken: "d",
                "REFRESH-TOKEN": "e",
                authorization: "Bearer x",
                cookie: "sid=1",
                apiKey: "k",
                authSecret: "s",
                connectionString: "postgres://u:p@h/db",
                databaseUrl: "postgres://u:p@h/db",
            },
        });

        const output = written.join("\n");
        expect(output).not.toContain("Bearer x");
        expect(output).not.toContain("sid=1");
        expect(output).not.toContain("postgres://u:p@h/db");
        expect((lastLine().extra as Record<string, unknown>).refresh_token).toBe("[redacted]");
    });

    it("redacts nested and array-nested secrets, not just top-level keys", () => {
        reportError(new Error("nested"), {
            extra: { request: { headers: { authorization: "Bearer deep" } }, users: [{ email: "a@b.c", password: "p" }] },
        });

        const output = written.join("\n");
        expect(output).not.toContain("Bearer deep");
        expect(output).not.toContain('"password":"p"');
        // The non-sensitive sibling is still there, so this is redaction and
        // not truncation of the whole payload.
        expect(output).toContain("a@b.c");
    });

    it("never carries a user email, because there is no field to put one in", () => {
        reportError(new Error("denied"), {
            userId: "user_123",
            userRole: "HR",
        });

        const line = lastLine();
        const context = line.context as Record<string, unknown>;
        expect(context.userId).toBe("user_123");
        expect(context.userRole).toBe("HR");
        expect(Object.keys(context)).not.toContain("userEmail");
        expect(Object.keys(context).sort()).toEqual(["userId", "userRole"]);
    });

    it("omits a context field entirely rather than emitting it as null", () => {
        reportError(new Error("no user"));
        expect(Object.keys(lastLine().context as object)).toEqual([]);
    });

    it("truncates a long message rather than writing it whole", () => {
        reportError(new Error("x".repeat(5000)));
        const message = lastLine().message as string;
        expect(message).toContain("[truncated]");
        expect(message.length).toBeLessThan(600);
    });

    /**
     * GAP NOW CLOSED — THIS TEST WAS INVERTED, NOT DELETED.
     *
     * This originally asserted the OPPOSITE: that `redact()` is purely
     * KEY-based and therefore leaves a connection string intact when it appears
     * inside a Prisma error MESSAGE. It was written as a deliberate marker so
     * that changing the behaviour would fail the suite and force a conscious
     * decision.
     *
     * That decision was taken. `redact()` in `lib/auth/audit.ts` now also runs
     * `scrubCredentials()` over every string value, covering credential-bearing
     * URLs, `key=value` pairs, and Bearer/Basic auth headers. The marker now
     * asserts the CLOSED behaviour, so a future regression re-opens the test
     * rather than silently re-introducing the leak. Coverage of the scrubbing
     * rules themselves lives in tests/audit-credential-scrubbing.test.ts.
     */
    it("pattern-scrubs a connection string inside message text", () => {
        reportError(
            new Error("Can't reach database server at postgresql://hr_app:s3cr3t@db-host:5433/hr_system")
        );

        const output = written.join("\n");
        // The password must not reach the log...
        expect(output).not.toContain("s3cr3t");
        // ...but the host must, or the entry is useless for diagnosis.
        expect(output).toContain("db-host:5433");

        // The key-based control still applies alongside it.
        reportError(new Error("both"), { extra: { password: "removed", note: "kept" } });
        expect(written.join("\n")).not.toContain("removed");
    });
});

/* ------------------------------------------------------------------ */
/* Correlation id                                                      */
/* ------------------------------------------------------------------ */

describe("correlation id", () => {
    it("is one 32-hex value, stable across every appearance in a single report", () => {
        const report = reportError(new Error("boom"), { route: "/api/health", method: "GET" });

        expect(report.correlationId).toMatch(CORRELATION_ID_PATTERN);
        // The id in the returned report and the id in the emitted line are the
        // same value, so a support agent quoting one finds the other.
        expect(lastLine().correlationId).toBe(report.correlationId);
    });

    it("is unique per report, so one report cannot be confused with another", () => {
        const a = reportError(new Error("one"));
        const b = reportError(new Error("two"));
        expect(a.correlationId).not.toBe(b.correlationId);
    });

    it("carries the ambient request id so the error joins that request's logs", () => {
        const ambient = newCorrelationId();
        let captured: ErrorReport | null = null;

        runWithRequestContext({ correlationId: ambient, route: "/payroll", method: "GET" }, () => {
            captured = reportError(new Error("inside a request"));
        });

        expect(captured).not.toBeNull();
        expect((captured as unknown as ErrorReport).correlationId).toBe(ambient);
        expect((lastLine().correlationId as string)).toBe(ambient);
        // The ambient route and method are picked up without being passed again.
        expect((lastLine().context as Record<string, unknown>).route).toBe("/payroll");
    });

    it("prefers an explicit well-formed id over the ambient one", () => {
        const explicit = newCorrelationId();
        let captured: ErrorReport | null = null;
        runWithRequestContext({ correlationId: newCorrelationId() }, () => {
            captured = reportError(new Error("x"), { correlationId: explicit });
        });
        expect((captured as unknown as ErrorReport).correlationId).toBe(explicit);
    });

    it("rejects a malformed inbound id rather than logging it", () => {
        // A header value is attacker-controlled. Accepting it verbatim would let
        // a caller forge log content.
        const forged = 'aaaa\n{"level":"info","event":"fake"}';
        expect(normaliseCorrelationId(forged)).toBeNull();

        const report = reportError(new Error("x"), { correlationId: forged });
        expect(report.correlationId).toMatch(CORRELATION_ID_PATTERN);
        expect(report.correlationId).not.toBe(forged);
    });

    it("emits exactly one physical line per report, so a parser can split on newlines", () => {
        reportError(new Error("multi\nline\tmessage\r\nhere"));
        const reports = written.filter((l) => l.includes('"event":"error.report"'));
        expect(reports).toHaveLength(1);
        expect(reports[0]).not.toContain("\n");
        // The embedded newlines are escaped rather than dropped, so the message
        // stays readable AND the record stays one line.
        expect(JSON.parse(reports[0]).message).toContain("multi");
        expect(JSON.parse(reports[0]).message).toContain("line");
    });
});

/* ------------------------------------------------------------------ */
/* Taxonomy                                                            */
/* ------------------------------------------------------------------ */

describe("error taxonomy", () => {
    /**
     * Minimal stand-ins shaped exactly like Prisma's real errors. Structural
     * detection is a deliberate design choice (no `@prisma/client` import, so
     * the module can be used from a client boundary), so these fixtures have to
     * match the real `name` and `code`.
     */
    const prismaKnown = (code: string, message = "prisma") => {
        const e = new Error(message);
        e.name = "PrismaClientKnownRequestError";
        (e as unknown as { code: string }).code = code;
        return e;
    };

    it("maps a Prisma unique-constraint violation to CONFLICT, not to a generic database error", () => {
        const c = classifyError(prismaKnown("P2002", "Unique constraint failed on the fields: (`email`)"));
        expect(c.kind).toBe(ERROR_KIND.CONFLICT);
        expect(c.code).toBe("P2002");
        // A duplicate email is a user or form problem, not an incident.
        expect(c.retryable).toBe(false);
        expect(c.fatal).toBe(false);
    });

    it("maps a Prisma missing-record to NOT_FOUND", () => {
        const c = classifyError(prismaKnown("P2025", "An operation failed because it depends on one or more records that were required but not found"));
        expect(c.kind).toBe(ERROR_KIND.NOT_FOUND);
    });

    it("maps an unreachable database to DATABASE, retryable and fatal", () => {
        const c = classifyError(prismaKnown("P1001", "Can't reach database server"));
        expect(c.kind).toBe(ERROR_KIND.DATABASE);
        expect(c.retryable).toBe(true);
        // Losing the database makes the instance unfit to serve, which is what
        // separates it from a request that merely failed.
        expect(c.fatal).toBe(true);
    });

    it("maps a Prisma auth failure to CONFIGURATION, not to an outage", () => {
        const c = classifyError(prismaKnown("P1000", "Authentication failed against database server"));
        expect(c.kind).toBe(ERROR_KIND.CONFIGURATION);
        expect(c.retryable).toBe(false);
        expect(c.fatal).toBe(true);
    });

    it("maps a foreign-key violation to VALIDATION", () => {
        expect(classifyError(prismaKnown("P2003")).kind).toBe(ERROR_KIND.VALIDATION);
    });

    it("maps a transaction deadlock to CONFLICT so a retry is the correct response", () => {
        expect(classifyError(prismaKnown("P2034")).kind).toBe(ERROR_KIND.CONFLICT);
    });

    it("maps an unmapped Prisma code to DATABASE rather than to UNKNOWN", () => {
        const c = classifyError(prismaKnown("P2999"));
        expect(c.kind).toBe(ERROR_KIND.DATABASE);
        expect(c.code).toBe("P2999");
    });

    it("maps this codebase's own error classes", () => {
        const auth = new Error("Authentication required");
        auth.name = "AuthenticationError";
        const authz = new Error("Insufficient permissions");
        authz.name = "AuthorizationError";
        expect(classifyError(auth).kind).toBe(ERROR_KIND.AUTHENTICATION);
        expect(classifyError(authz).kind).toBe(ERROR_KIND.AUTHORIZATION);
    });

    it("never marks a 401 or 403 as retryable: a denied request is the control working", () => {
        expect(classifyError({ status: 401 }).retryable).toBe(false);
        expect(classifyError({ status: 403 }).retryable).toBe(false);
        expect(classifyError({ status: 429 }).kind).toBe(ERROR_KIND.RATE_LIMIT);
        expect(classifyError({ status: 429 }).retryable).toBe(false);
    });

    it("treats a Next.js redirect as a navigation, not as a fault", () => {
        expect(classifyError({ digest: "NEXT_REDIRECT" }).retryable).toBe(false);
        expect(classifyError({ digest: "NEXT_NOT_FOUND" }).kind).toBe(ERROR_KIND.NOT_FOUND);
    });

    it("follows a fetch error to its cause", () => {
        const e = new Error("fetch failed");
        (e as unknown as { cause: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        expect(classifyError(e).kind).toBe(ERROR_KIND.NETWORK);
    });

    it("is total: it classifies every junk value without throwing", () => {
        for (const junk of [null, undefined, 0, "", [], {}, Symbol("s"), () => 1, new Error()]) {
            expect(() => classifyError(junk)).not.toThrow();
        }
        expect(classifyError(null).kind).toBe(ERROR_KIND.UNKNOWN);
    });

    it("survives a hostile getter on the thrown value", () => {
        const hostile = {
            get code(): string {
                throw new Error("getter exploded");
            },
        };
        expect(() => classifyError(hostile)).not.toThrow();
    });

    it("maps an explicit AppError kind over the heuristic", () => {
        const e = new AppError(ERROR_KIND.RATE_LIMIT, "too many attempts", { code: "LIMIT" });
        const c = classifyError(e);
        expect(c.kind).toBe(ERROR_KIND.RATE_LIMIT);
        expect(c.retryable).toBe(false);
    });

    it("maps HTTP statuses to the kind an operator would reason about", () => {
        expect(kindFromHttpStatus(404)).toBe(ERROR_KIND.NOT_FOUND);
        expect(kindFromHttpStatus(409)).toBe(ERROR_KIND.CONFLICT);
        expect(kindFromHttpStatus(503)).toBe(ERROR_KIND.EXTERNAL_SERVICE);
        expect(kindFromHttpStatus(500)).toBe(ERROR_KIND.INTERNAL);
    });
});

/* ------------------------------------------------------------------ */
/* Route, stack, sink, and non-throwing guarantees                     */
/* ------------------------------------------------------------------ */

describe("report hygiene", () => {
    it("keeps a route a path and drops the query string", () => {
        expect(sanitiseRoute("/api/employees")).toBe("/api/employees");
        expect(sanitiseRoute("/api/employees?q=hassan&salary=90000")).toBeNull();
        expect(sanitiseRoute("https://hr.example.com/api/employees?x=1")).toBe("/api/employees");
        expect(sanitiseRoute(null)).toBeNull();
        expect(sanitiseRoute("x".repeat(500))).toBeNull();
    });

    it("omits the stack in production and includes it in development", () => {
        // vi.stubEnv, not `process.env.NODE_ENV = ...`: Next.js declares
        // NODE_ENV as read-only on ProcessEnv, so a direct assignment is a
        // compile error, and `delete` would be silently ignored at runtime.
        vi.stubEnv("NODE_ENV", "production");
        expect(reportError(new Error("no stack")).stack).toBeNull();

        vi.stubEnv("NODE_ENV", "development");
        expect(reportError(new Error("with stack")).stack).toContain("Error");
    });

    it("honours OBSERVABILITY_INCLUDE_STACK as an explicit opt-in", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("OBSERVABILITY_INCLUDE_STACK", "1");
        expect(reportError(new Error("forced")).stack).toContain("Error");
    });

    it("never throws, whatever it is handed", () => {
        for (const junk of [null, undefined, 0, "", [], Symbol("s"), new Error("x")]) {
            expect(() => reportError(junk)).not.toThrow();
        }
    });

    it("wraps a non-Error throw instead of discarding it", () => {
        const report = reportError("a bare string was thrown");
        expect(report.kind).toBe(ERROR_KIND.INTERNAL);
        expect(report.message).toContain("a bare string was thrown");
    });
});

describe("sink registry", () => {
    it("has no remote sink by default; stdout is the only destination", () => {
        expect(getErrorSink()).toBeNull();
        expect(consoleSink.name).toBe("console");
        expect(consoleSink.remote).toBe(false);
    });

    it("routes a report to a registered sink without any change to the call site", () => {
        // This is the property that makes adding Sentry later a one-file change:
        // the call site above is identical, only the registered sink differs.
        const received: ErrorReport[] = [];
        const sentryLike: ErrorSink = {
            name: "sentry-like",
            remote: true,
            capture: (r) => received.push(r),
        };
        configureErrorSink(sentryLike);

        const returned = reportError(new Error("to the backend"), { route: "/api/health" });

        expect(received).toHaveLength(1);
        expect(received[0]).toBe(returned);
        expect(received[0].kind).toBe(ERROR_KIND.INTERNAL);
        expect(received[0].context.route).toBe("/api/health");
    });

    it("says ONCE, loudly, that there is no remote backend", () => {
        reportError(new Error("first"));
        const warnings = written.filter((l) => l.includes("observability.sink.absent"));
        expect(warnings).toHaveLength(1);
        expect(JSON.parse(warnings[0]).level).toBe("warn");
        expect(JSON.parse(warnings[0]).message).toContain("NO error monitoring");

        reportError(new Error("second"));
        reportError(new Error("third"));
        // Once, not once per error: a per-request "you have no monitoring" line
        // is itself a flood and trains operators to ignore it.
        expect(written.filter((l) => l.includes("observability.sink.absent"))).toHaveLength(1);
    });

    it("stays silent when a real remote sink is registered", () => {
        configureErrorSink({ name: "remote", remote: true, capture: () => undefined });
        reportError(new Error("with a backend"));
        expect(written.filter((l) => l.includes("observability.sink.absent"))).toHaveLength(0);
    });

    it("shouts about a DSN in the environment that nothing reads", () => {
        // The failure this whole module exists to prevent: a team sets
        // SENTRY_DSN, assumes errors are being shipped, and they are not.
        vi.stubEnv("SENTRY_DSN", "https://examplePublicKey@o0.ingest.sentry.io/0");
        reportError(new Error("into the void"));
        const misconfigured = written.filter((l) => l.includes("observability.sink.misconfigured"));
        expect(misconfigured).toHaveLength(1);
        const parsed = JSON.parse(misconfigured[0]);
        expect(parsed.level).toBe("error");
        expect(parsed.variables).toContain("SENTRY_DSN");
        // And it must not claim the quiet-but-wrong thing.
        expect(written.filter((l) => l.includes("observability.sink.absent"))).toHaveLength(0);
    });

    it("survives a sink that throws, and still returns a usable report", () => {
        configureErrorSink({
            name: "broken",
            remote: true,
            capture: () => {
                throw new Error("network is down");
            },
        });
        let report: ErrorReport | null = null;
        expect(() => {
            report = reportError(new Error("original"));
        }).not.toThrow();
        expect((report as unknown as ErrorReport).message).toBe("original");
        // stdout ran first, so the report is on disk even though the backend
        // that was supposed to receive it threw.
        expect(written.filter((l) => l.includes('"event":"error.report"'))).toHaveLength(1);
    });

    it("still logs to stdout when a remote sink is registered", () => {
        // The remote sink is additive, not a replacement: stdout is what a log
        // shipper reads, and losing it would regress 9.3.
        configureErrorSink({ name: "remote", remote: true, capture: () => undefined });
        reportError(new Error("both places"));
        expect(written.filter((l) => l.includes('"event":"error.report"'))).toHaveLength(1);
    });
});

describe("buildErrorReport does not emit", () => {
    it("builds without writing, so a caller can enrich before reporting", () => {
        const report = buildErrorReport(new Error("dry"), { route: "/x" });
        expect(written).toHaveLength(0);
        expect(report.kind).toBe(ERROR_KIND.INTERNAL);
        expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
