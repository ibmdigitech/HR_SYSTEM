# PRODUCTION OBSERVABILITY

**Scope:** error reporting (9.4), uptime monitoring (9.5), structured logging
(9.3), audit log retention (9.6).
**Status of the checklist items after this change:** see §7. They are **not**
all closed, and the reason is stated rather than buried.

---

## 0. Read this first: what is and is not actually covered

The most damaging thing an observability change can do is let a team believe
monitoring exists when it does not. So, up front:

| Capability | What exists today | What a real deployment still needs |
|---|---|---|
| Errors reach a structured log | **Yes.** `reportError()` writes one JSON object per line to stdout. | A log shipper reading stdout. |
| Errors reach a searchable dashboard | **No.** There is no backend. | A sink (Sentry / OTel / Datadog) — see §3. |
| An operator is paged | **No.** | A sink plus an alert rule on it. |
| Uptime is checked on a schedule | **Yes**, via `scripts/healthcheck.ps1`. | A scheduler or an external uptime provider — see §4. |
| An operator is paged on downtime | **No.** | An uptime provider with a contact — see §4.3. |
| Correlation id links a request to its error | **Partly.** The id is generated and emitted; per-request propagation is **not wired** — see §2.3. | One line in `proxy.ts`. |
| `SecurityAuditLog` is pruned | **Yes**, via `scripts/prune-audit-log.ps1`. **Not yet scheduled.** | A scheduled task — see §5.4. |

Two of these rows are the whole story: **the code paths exist and the
operational wiring does not.** A repo cannot ship a vendor account.

The application says so out loud. On the first error, once per process:

```json
{"ts":"...","level":"warn","event":"observability.sink.absent","service":"hr-system",
 "message":"No remote error backend is configured. Errors are written to stdout as JSON only.
  Unless a log shipper is collecting stdout into an alerting pipeline, this system has NO
  error monitoring (audit 9.4 is not satisfied by this).","sink":"console",
 "hint":"Register a sink with configureErrorSink(), and ship stdout to an aggregator."}
```

And if `SENTRY_DSN` or an OTLP endpoint is present in the environment with **no
sink registered**, that is reported as an `error`, because it is a
misconfiguration that looks identical to working monitoring:

```json
{"level":"error","event":"observability.sink.misconfigured",
 "message":"A remote error backend is configured in the environment but no sink is registered.
  Errors are being written to stdout only and are being LOST.",
 "variables":["SENTRY_DSN"],
 "hint":"Call configureErrorSink() with a sink for these endpoints during startup."}
```

---

## 1. Error reporting

### 1.1 Files

| File | Role |
|---|---|
| `lib/observability/report.ts` | `reportError()`. **Server only.** |
| `lib/observability/client-report.ts` | `reportClientError()` for `"use client"` boundaries. |
| `lib/observability/taxonomy.ts` | Closed error-kind set + `classifyError()`. No imports. |
| `lib/observability/sinks.ts` | `ErrorSink` interface, registry, loud "no backend" warning. |
| `lib/observability/log.ts` | One-JSON-object-per-line stdout writer. |
| `lib/observability/correlation.ts` | Id generation and inbound-id validation. |
| `lib/observability/context.ts` | `AsyncLocalStorage` request scope. **Server only.** |
| `lib/observability/retention.ts` | The retention rule, stated and unit-tested once. |
| `lib/observability/types.ts` | `ErrorReport` / `ErrorContext`. |

### 1.2 Using it

```ts
import { reportError } from "@/lib/observability/report";

export async function GET(req: Request) {
    try {
        // ...
    } catch (error) {
        const report = reportError(error, {
            origin: "api:/api/payroll/run",
            route: "/api/payroll/run",   // a PATH. A full URL is reduced or dropped.
            method: "GET",
            userId: session.user.id,     // NEVER the email.
            userRole: session.user.role,
            extra: { batchId },          // redacted before it is written
        });
        return NextResponse.json(
            { error: "Payroll run failed", reference: report.correlationId },
            { status: 500 }
        );
    }
}
```

In a client error boundary:

```tsx
import { reportClientError } from "@/lib/observability/client-report";
reportClientError(error, { digest: error.digest });
```

### 1.3 Why two reporters

`report.ts` reaches `@/lib/auth/audit` for `redact()`, and `lib/auth/audit.ts`
imports `@/lib/prisma`, which instantiates a client **at module scope and
throws** if `DATABASE_URL` is missing. Importing `report.ts` from a
`"use client"` file asks the bundler to put the Prisma client in a browser
bundle. `client-report.ts` imports nothing and is allow-listed: only `name`,
`message` (truncated, newlines escaped), `digest` and a generated correlation
id are ever emitted. The allow-list *is* the redaction there.

### 1.4 The emitted record

```json
{"ts":"2026-09-29T14:22:07.881Z","level":"error","event":"error.report",
 "service":"hr-system","env":"production",
 "correlationId":"0f3a9c1d7b2e4a6c8d0e1f2a3b4c5d6e",
 "name":"PrismaClientKnownRequestError","kind":"CONFLICT",
 "message":"Unique constraint failed on the fields: (`email`)",
 "stack":null,"code":"P2002","retryable":false,"fatal":false,
 "context":{"route":"/api/users","method":"POST","userId":"clx1","userRole":"ADMIN"},
 "extra":null,"origin":"api:/api/users"}
```

`stack` is `null` in production; set `OBSERVABILITY_INCLUDE_STACK=1` to include
it while debugging an incident.

### 1.5 The error taxonomy

| Kind | Retryable | Fatal | Examples |
|---|---|---|---|
| `AUTHENTICATION` | no | no | 401, `AuthenticationError`, `CredentialsSignin` |
| `AUTHORIZATION` | no | no | 403, `AuthorizationError` |
| `VALIDATION` | no | no | `ZodError`, Prisma `P2003`/`P2004`/`P2025`* |
| `NOT_FOUND` | no | no | Prisma `P2025`, `NEXT_NOT_FOUND`, 404 |
| `CONFLICT` | no | no | Prisma `P2002` (unique), `P2034` (deadlock) |
| `RATE_LIMIT` | no | no | 429 |
| `DATABASE` | **yes** | **yes** | Prisma `P1001`, `P1008`, `P2010` |
| `NETWORK` | **yes** | no | `ECONNREFUSED`, `ENOTFOUND`, `TLS` |
| `TIMEOUT` | **yes** | no | `AbortError`, Prisma `P1008` deadline |
| `EXTERNAL_SERVICE` | **yes** | no | 502/503/504 from an upstream |
| `CONFIGURATION` | no | **yes** | Prisma `P1000` (bad password), `P3005` (migration not applied) |
| `INTERNAL` | no | no | a plain `Error` — a bug in this codebase |
| `UNKNOWN` | no | no | genuinely unclassifiable |

\* `P2025` maps to `NOT_FOUND`; it is listed twice above only to show that a
single Prisma class (`PrismaClientKnownRequestError`) spans many kinds, which
is why classification reads the `code`, not the class.

`retryable` and `fatal` are the two fields an alert rule should use.
`retryable: true` means "a dependency failed; a human should look".
`fatal: true` means "this instance cannot serve".

### 1.6 Redaction — and its known gap

`redact()` from `lib/auth/audit.ts` is used as-is and is the **only** redaction
in this path. A second implementation would be a liability: two places to keep
in sync, and a secret is only as redacted as the weakest of them.

**What it does cover:** any value whose *key* is sensitive, at any depth, in any
casing or separator style (`password`, `refresh_token`, `REFRESH-TOKEN`,
`authorization`, `cookie`, `apiKey`, `authSecret`, `databaseUrl`,
`connectionString`, `directUrl`, `clientSecret`, `sessionToken`), plus
truncation at 500 characters, array caps at 50, and a depth bound.

**What it does not cover, and this is a real open gap:** free text. A Prisma
initialisation error puts the connection string in the **message**:

```
Can't reach database server at postgresql://hr_app:HUNTER2@db-host:5433/hr_system
```

`redact()` truncates that string; it does not scrub it, and `HUNTER2` reaches
stdout. This is pinned by a deliberately-failing-if-changed test
(`KNOWN GAP: does not pattern-scrub a connection string inside message text`) so
it cannot be forgotten.

**Closing it is a security owner's decision, and there are two ways:**

1. Extend `redact()` in `lib/auth/audit.ts` with a free-text credential
   scrubber. This is the right place — it is the one implementation — but it
   changes the behaviour of the existing security audit log, so it needs
   review and `tests/audit-redaction.test.ts` will need extending with it.
2. Remove the password from `DATABASE_URL` and pass it out of band
   (`PGPASSWORD` / a mounted secret), so no error message can contain it.

Note that `app/api/health/route.ts` already has a private `sanitizeForLog` for
exactly this problem. That duplication is a symptom of `redact()` not covering
free text; option 1 would let it be deleted.

**Until then:** treat the error log as a system that may contain a database
credential, and give the log aggregator the same access controls and retention
as the database itself.

### 1.7 User identity in error reports

`userId` and `userRole` are carried. **`userEmail` is not a field on
`ErrorContext` at all** — it cannot be set by mistake, and it cannot be set at
all. Email is a personal identifier that already appears verbatim in
`SecurityAuditLog.actorEmail`; the error log is a different audience with a
different retention story, and the user id is what an operator joins against.
`tests/observability-error-reporting.test.ts` asserts the field list, so
adding an email field is a deliberate, visible act.

---

## 2. Correlation ids

### 2.1 Format and why

32 lowercase hex characters, generated with `crypto.randomUUID()` (CSPRNG),
falling back to `Math.random` only where no WebCrypto exists. It is a **join
key, never a token** — the fallback is documented as not unpredictable for
exactly that reason.

An inbound `x-correlation-id` header is honoured **only** if it matches
`^[0-9a-f]{32}$` exactly. An attacker-controlled string written verbatim into a
log line is a log-injection vector: embedded newlines can forge an entire
second log record. A malformed value is discarded and a fresh id minted.

### 2.2 Where it appears

`reportError()` resolves exactly one id and writes it into the log envelope,
into the sink payload, and into its return value. Grep the aggregator for it and
you find the error; the returned value is what to put in a user-facing
"Reference:" field.

### 2.3 What is NOT wired: per-request propagation

For the id to link an error to the *ordinary request logs* of the same request,
a scope has to be installed per request. `lib/observability/context.ts` provides
it (`AsyncLocalStorage`, so no signature changes anywhere):

```ts
import { runWithRequestContext } from "@/lib/observability/context";
import { resolveCorrelationId, CORRELATION_HEADER } from "@/lib/observability/correlation";

export function middleware(request: NextRequest) {
    const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_HEADER));
    return runWithRequestContext({ correlationId, route: request.nextUrl.pathname, method: request.method }, () =>
        NextResponse.next()
    );
}
```

**This is not applied.** `proxy.ts` is owned by another change in this
repository and is outside this task's file ownership, so it has not been
touched. Until it lands, `reportError()` mints a fresh id per call and the
request-log join does not exist.

---

## 3. Adding a real error backend

`reportError()` emits an immutable `ErrorReport` to whatever sink is registered.
Adding Sentry or OpenTelemetry is **one new file plus one registration call**,
and **zero changes to any call site**. That is the whole point of the seam.

```ts
// lib/observability/sentry-sink.ts  (new file, no call site changes)
import * as Sentry from "@sentry/node";
import type { ErrorSink } from "@/lib/observability/sinks";

export const sentrySink: ErrorSink = {
    name: "sentry",
    remote: true,
    capture(report) {
        Sentry.captureException(report.message, {
            level: report.fatal ? "fatal" : "error",
            tags: { kind: report.kind, origin: report.origin, code: report.code ?? "" },
            extra: report,
        });
    },
    async flush() { await Sentry.flush(5000); },
};
```

Register it during startup:

```ts
// instrumentation.ts at the repository root (Next.js loads this automatically)
import { configureErrorSink } from "@/lib/observability/sinks";
import { sentrySink } from "@/lib/observability/sentry-sink";

export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
        configureErrorSink(sentrySink);
    }
}
```

`instrumentation.ts` is also outside this change's file ownership, so it does
not exist yet. Until it does, the "no remote sink configured" warning in §0
stands, which is the correct behaviour.

**The sink is additive.** stdout is written **always**, whether or not a remote
sink is registered. Registering Sentry must not take the JSON logs away on the
way to becoming a better version of 9.4.

A sink that throws is contained: `reportError` catches it, writes to stderr, and
still returns a usable report. A reporter that replaces the error it was
reporting is worse than no reporter.

---

## 4. Uptime monitoring

### 4.1 The endpoint

`GET /api/health` — see `docs/audit/OPS_RUNBOOK.md` §1 for the contract.

| Condition | Status | Body |
|---|---|---|
| App serving, database reachable | `200` | `{"status":"ok","database":"up","timestamp":"..."}` |
| App serving, database unreachable | `503` | `{"status":"degraded","database":"down","timestamp":"..."}` |
| `proxy.ts` regresses and re-gates the path | `401` | `{"error":"Authentication required"}` |

**The endpoint is anonymously reachable.** Verified with a cookie-less
`curl.exe -i http://localhost:3000/api/health` → `200`. `proxy.ts` now lists
`/api/health` in `NEVER_REDIRECT_PATHS` and returns it before the session gate.
(Note: `docs/audit/OPS_RUNBOOK.md` §1.3 still describes this as an open
blocker. It is not; that section is stale. The runbook is owned by another
change and was not edited here.)

### 4.2 The monitor: `scripts/healthcheck.ps1`

```powershell
# One-shot, default URL
powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1

# Against a deployed host
powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1 `
    -Url 'https://hr.example.com/api/health' -TimeoutSeconds 5 -Retries 2
```

| Parameter | Default | Purpose |
|---|---|---|
| `-Url` | `http://localhost:3000/api/health` | probe target |
| `-TimeoutSeconds` | `10` | per-attempt HTTP timeout |
| `-Retries` | `3` | total attempts, not additional |
| `-RetryDelaySeconds` | `5` | delay between attempts |
| `-Quiet` | off | suppress per-attempt lines; the summary always prints |

**Exit codes:** `0` healthy, `1` unhealthy, `2` usage/config error.

**Defaults rationale.** Three attempts, because a single dropped packet is not an
outage and a monitor that pages on one is muted within a week. Five seconds
apart, because the probe costs under a millisecond — the gap is politeness, not
load. A ten-second timeout, comfortably above the endpoint's own three-second
probe timeout, so a hung request means the app is not answering rather than the
database being slow.

### 4.3 THE TRAP: "app down" and "database down" are different incidents

A health check that reports one bit produces one alert, and the on-call response
to that alert is usually "restart the app". During a database outage that is
**actively harmful**: the app is fine, restarting it accomplishes nothing, and a
crash-looping app cannot reconnect when the database returns.

The endpoint already draws the line (503 + `database: "down"`), so the script
reads that field instead of collapsing both cases:

```
$ powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1
healthcheck: GET http://localhost:3000/api/health (attempts=3 timeout=10s delay=5s)
  attempt 1/3: http=200 elapsed=1126ms state=HEALTHY database=up (application and database both healthy)
HEALTHCHECK result=HEALTHY http=200 elapsed_ms=1126 database=up url=http://localhost:3000/api/health attempts=1
```

During a database outage (verified against a stub returning the real 503 body):

```
  attempt 1/1: http=503 elapsed=78ms state=DATABASE_DOWN database=down (app is serving; database is unreachable)
HEALTHCHECK result=DATABASE_DOWN http=503 elapsed_ms=78 database=down url=... attempts=1
healthcheck: DATABASE DOWN - the application is running and serving. Do not restart it. Check the database container and DATABASE_URL.
```

And with nothing listening:

```
  attempt 1/2: http=0 elapsed=2084ms state=APP_DOWN database=unknown (Unable to connect to the remote server (ConnectFailure))
  not healthy; retrying in 1s
  attempt 2/2: http=0 elapsed=2031ms state=APP_DOWN database=unknown (Unable to connect to the remote server (ConnectFailure))
HEALTHCHECK result=APP_DOWN http=0 elapsed_ms=2031 database=unknown url=... attempts=2
healthcheck: APPLICATION DOWN - no HTTP response from ... after 2 attempt(s). Check the process, the container and anything between them.
```

**States:** `HEALTHY`, `APP_DOWN`, `DATABASE_DOWN`, `DEGRADED`,
`PROBE_NOT_PUBLIC` (401/403), `PROBE_NOT_FOUND` (404), `UNEXPECTED_STATUS`.

`PROBE_NOT_PUBLIC` does **not** fire today — `/api/health` is anonymous. It is
kept because it is a cheap, unambiguous regression detector: if a future change
re-gates `/api/**`, the symptom is an alert saying "the site is down" when the
real fault is a configuration change, and this state names the actual cause
instead of guessing.

**Readiness, not liveness.** `503` means the process is healthy and the
dependency is not. Never use this endpoint as a Kubernetes **liveness** probe —
restarting the pod would not help and would prevent recovery. It is correct as a
**readiness** probe (stop routing new traffic, keep the instance in the pool).

### 4.4 Wiring it to a public uptime service

Any of UptimeRobot, Better Stack, Hetrixtools, Pingdom, StatusCake.

```
Monitor type : HTTP(S)
URL           : https://hr.example.com/api/health
Interval      : 5 minutes
Timeout       : 30 seconds
```

If the service supports a **keyword** field, use it. The script always prints:

```
HEALTHCHECK result=<STATE> http=<status> elapsed_ms=<n> database=<up|down|unknown> url=<url> attempts=<n>
```

so one monitor can split the two cases:

| Condition | Alert as |
|---|---|
| `HEALTHCHECK result=HEALTHY` absent | App / endpoint unreachable — page |
| `HEALTHCHECK result=APP_DOWN` present | App down — page, restart procedure |
| `HEALTHCHECK result=DATABASE_DOWN` present | Database down — page, **do not restart the app** |
| `HEALTHCHECK result=PROBE_NOT_PUBLIC` present | Configuration fault in `proxy.ts` — fix, do not page |

**A plain HTTP check that only looks at the status code cannot see the "app vs
database" distinction** and will alert "site down" for a database outage. That is
acceptable as a first alert, and it is the reason the split is printed at all.

**The probe is reachable anonymously**, so a public uptime service can reach it
with no credentials. Confirm it from outside the host before relying on it —
`curl.exe -i https://hr.example.com/api/health` must return `200` with a cookie
header you did not send. If it returns `401`, `proxy.ts` has re-gated
`/api/**`; `scripts/healthcheck.ps1` will report that as `PROBE_NOT_PUBLIC`
rather than as an outage.

### 4.5 Windows Task Scheduler

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\HR_SYSTEM-git-check\scripts\healthcheck.ps1" -Url ''https://hr.example.com/api/health'''
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'HRMS-Healthcheck' -Action $action -Trigger $trigger `
    -Description 'Polls /api/health; non-zero exit means unhealthy'
```

**A scheduled task that only runs the check does not alert anyone.** It has to
be paired with something that turns a non-zero exit code into a notification —
§4.3's uptime service, or a wrapper that mails on failure. Without that, this
is a log line nobody reads.

### 4.6 Container healthcheck

```dockerfile
HEALTHCHECK --interval=60s --timeout=15s --start-period=30s --retries=3 \
  CMD powershell -NoProfile -ExecutionPolicy Bypass -File C:\app\scripts\healthcheck.ps1 || exit 1
```

`--interval=60s` deliberately: the endpoint costs under a millisecond, so there
is no reason to poll harder than once a minute, and a probe that runs every few
seconds is indistinguishable from a load generator when the database is already
struggling.

---

## 5. Audit log retention

### 5.1 Why

`SecurityAuditLog` is append-only and grows without bound. Every denied request,
every failed sign-in and every seed attempt is a row, forever. It is an
append-only table with no `updatedAt`, so it is never vacuumed by ordinary
writes and the growth is monotonic.

### 5.2 `scripts/prune-audit-log.ps1` — dry run by default

```powershell
# Dry run. Deletes nothing.
powershell -ExecutionPolicy Bypass -File .\scripts\prune-audit-log.ps1

# Dry run with a 90-day window
powershell -ExecutionPolicy Bypass -File .\scripts\prune-audit-log.ps1 -RetentionDays 90

# Actually delete
powershell -ExecutionPolicy Bypass -File .\scripts\prune-audit-log.ps1 -RetentionDays 400 -Execute
```

| Parameter | Default | Purpose |
|---|---|---|
| `-Container` | `hr-postgres` | container holding the database |
| `-DbUser` / `-DbName` | `postgres` / `hr_system` | role and database |
| `-Table` | `SecurityAuditLog` | target table, verified against the live schema |
| `-TimestampColumn` | `createdAt` | verified to be a timestamp type |
| `-RetentionDays` | `365` | must match `DEFAULT_RETENTION_DAYS` |
| `-Execute` | **off** | the destructive switch |
| `-AllowMassDelete` | off | required above 95% of the table |

Exit codes: `0` (including a dry run), `1` failure or refusal.

**The default is 365 days** because this system has no documented regulatory
retention mandate. It is a conservative first-run default: it cannot delete a
year of security history the first time somebody runs it.

### 5.3 The three safety properties

1. **Dry run unless asked.** Without `-Execute` nothing is written. The report
   is printed so the number can be checked against expectations *before* an
   append-only security log is destroyed.
2. **The live schema is verified before any DELETE is built.** Table and column
   are looked up in `information_schema`, and the column is checked to be a
   timestamp. A typo, or a migration that has since renamed something, stops the
   run instead of deleting the wrong thing.
3. **A run that would remove more than 95% of the table refuses** without
   `-AllowMassDelete`. Short windows and arithmetic mistakes are the normal ways
   a retention script takes out a whole security log.

Plus: identifiers must match `^[A-Za-z_][A-Za-z0-9_]*$` before they are
quoted; the cutoff is computed by the **database**, once, and the same string is
used for the count and the DELETE, so the two cannot be computed against
different `now` values; a future cutoff is refused; `ON_ERROR_STOP=1` is set so
a failed DELETE cannot exit 0; and the post-run row count is verified against
the plan.

### 5.4 Verified output

Default 365-day window, dry run — nothing is old enough:

```
[prune-audit] container=hr-postgres database=hr_system table=SecurityAuditLog retention=365 days mode=DRY RUN
[prune-audit] verified: table [SecurityAuditLog] exists
[prune-audit] verified: column [SecurityAuditLog.createdAt] exists and is timestamp without time zone
[prune-audit] cutoff 2025-09-29 14:20:07 (database UTC time 2026-09-29 14:20:07); rows with createdAt strictly less than the cutoff are in scope
[prune-audit]
[prune-audit] --- SecurityAuditLog retention report ---
[prune-audit]   window            : 365 day(s), cutoff 2025-09-29 14:20:07 (exclusive)
[prune-audit]   rows in table     : 157
[prune-audit]   oldest row        : 2026-09-25 19:01:00.852
[prune-audit]   newest row        : 2026-09-29 14:17:26.638
[prune-audit]   rows in scope     : 0
[prune-audit]   scope oldest      : (none)
[prune-audit]   scope newest      : (none)
[prune-audit]   rows retained     : 157
[prune-audit]   share of table    : 0%
[prune-audit]   breakdown         : (nothing in scope)
[prune-audit]
[prune-audit] DRY RUN: nothing is old enough to prune. No rows deleted.
```

Two-day window, dry run — to show a non-zero scope and what it contains:

```
[prune-audit]   window            : 2 day(s), cutoff 2026-09-27 14:20:13 (exclusive)
[prune-audit]   rows in table     : 157
[prune-audit]   rows in scope     : 128
[prune-audit]   scope oldest      : 2026-09-25 19:01:00.852
[prune-audit]   scope newest      : 2026-09-27 11:08:16.318
[prune-audit]   rows retained     : 29
[prune-audit]   share of table    : 81.5%
[prune-audit]   breakdown (action | outcome | count):
    ACCESS_DENIED | DENIED | 73
    AUTH_FAILURE | ERROR | 24
    AUTH_FAILURE | DENIED | 12
    SEED_DENIED | DENIED | 11
    ACCESS_DENIED | SUCCESS | 5
    ATTENDANCE_IMPORT_DENIED | DENIED | 3
[prune-audit]
[prune-audit] DRY RUN: 128 row(s) WOULD be deleted. No rows were deleted.
```

The `breakdown` is the part to read before enabling deletion. A retention window
is only defensible once you have looked at what it removes: here it is entirely
denials and failed sign-ins, which is exactly what a security audit log is for.

**The destructive path has not been executed.** Both runs above are dry runs.
The `DELETE` statement, the mass-delete guard and the post-run verification are
exercised only by unit tests over the same rules
(`tests/observability-retention.test.ts`) — deliberately, since running a
destructive script to test it is how audit logs get deleted. Before the first
real run, take a backup (`scripts/backup.ps1`) and run once with a window you
expect to match zero rows.

### 5.5 The boundary is EXCLUSIVE

A row is removed when `createdAt < cutoff`. A row exactly at the cutoff is
**kept**.

`<` rather than `<=` because a rule that changes answer depending on whether the
caller's `now` landed on a millisecond of data is a bug an operator cannot
reproduce. `now` is also truncated to whole seconds before the subtraction, so a
row written in the same second as a run gets the same answer on every run.

This rule is stated once, in `lib/observability/retention.ts`, and pinned by
tests. The PowerShell script must match it, and a test asserts the script
contains `<` and does not contain `<=`.

### 5.6 Quoted SQL identifiers in PowerShell 5.1

The tables are capitalised (`"SecurityAuditLog"`), so they are case-sensitive
and need double quotes in SQL. Under Windows PowerShell 5.1, **only one form
survives the trip to psql**:

```powershell
# WORKS
docker exec hr-postgres psql -U postgres -d hr_system -tAc 'SELECT count(*) FROM \"SecurityAuditLog\";'
#  -> 156
```

A **double-quoted** PowerShell string does not work. The C runtime's argv parser
consumes the inner quotes before the argument reaches docker:

```powershell
# FAILS: unterminated quoted identifier at or near "" SecurityAuditLog\;
docker exec hr-postgres psql -U postgres -d hr_system -tAc "SELECT count(*) FROM \"SecurityAuditLog\";"

# FAILS: relation "securityauditlog" does not exist  (quotes stripped, folded to lower case)
docker exec hr-postgres psql -U postgres -d hr_system -tAc 'SELECT count(*) FROM `"SecurityAuditLog`";'
```

Every SQL string in the script is single-quoted and uses `\"`, and identifiers
are built only by `Quote-Identifier` after a strict character check. **Do not
"tidy" that into double quotes.** See also §5.7.

### 5.7 Why these scripts are pure ASCII

`scripts/backup.ps1` and `scripts/restore.ps1` are pure ASCII, and so are the
two new ones. This is a correctness constraint, not a style choice.

Windows PowerShell 5.1 reads a **BOM-less** file using the **system ANSI code
page**. A UTF-8 em dash (U+2014, bytes `E2 80 94`) is read as three CP1252
characters, one of which is `0x94` — a right double quote. Inside a string
literal that quote **terminates the string**, and the script becomes
unparseable. A non-ASCII character in a comment is merely ugly; in a string
literal it is a syntax error, and in a `Write-Host` message it corrupts the
operator's output.

Both new scripts are verified byte-for-byte by
`tests/observability-retention.test.ts`.

### 5.8 Scheduling it

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\HR_SYSTEM-git-check\scripts\prune-audit-log.ps1" -RetentionDays 400 -Execute'
$trigger = New-ScheduledTaskTrigger -Weekly -At 3am -DaysOfWeek Sunday
Register-ScheduledTask -TaskName 'HRMS-AuditPrune' -Action $action -Trigger $trigger `
    -Description 'Prunes SecurityAuditLog older than 400 days'
```

Run it **weekly at a quiet hour**, and check the exit code. A `DELETE` over a
growing append-only table takes a table lock for the duration, and 400 days of
denials and failed sign-ins is a lot of rows on a busy system.

**There is no scheduled task for this yet.** Until one is registered,
`SecurityAuditLog` still grows without bound and item 9.6 is not closed.

---

## 6. Structured logging (9.3)

`lib/observability/log.ts` writes **one JSON object per line** to stdout. This
is what a collector consumes with configuration and no custom parser
(Filebeat, Vector, Fluent Bit, Loki's `json` stage, CloudWatch Logs Insights).

`JSON.stringify` cannot emit a raw newline, so two concurrent requests can never
produce two records that a line-oriented parser has to stitch back together.

Common fields on every line: `ts`, `level`, `event`, `service`, `env`.

```json
{"ts":"...","level":"error","event":"error.report","service":"hr-system","env":"production", ...}
{"ts":"...","level":"warn","event":"observability.sink.absent","service":"hr-system", ...}
```

`event` is a stable token, not prose — aggregators group and alert on it.

**The default threshold is `warn` outside development**, so a process that has
not opted into more is not paying to build debug objects. Errors are always
written.

**What still has not changed:** the ~200 `console.*` call sites elsewhere in the
application are untouched. They produce unparseable, unaggregated output. The
structured format exists and is used for error reporting; converting the rest
of the codebase is a separate, mechanical, and much larger change, and
retrofitting it across every `catch` was explicitly out of scope here. Until
that happens, item 9.3 remains **partial**: errors are structured, the
application's ordinary logging is not.

---

## 7. Checklist status, honestly

| # | Item | Before | After | What is still missing |
|---|---|---|---|---|
| 9.3 | Structured logging | partial | **partial** | Structured error logging exists and is wired at two boundaries. The ~200 `console.*` call sites are untouched. No aggregation is configured. |
| 9.4 | Error monitoring | **none** | **partial** | `reportError()` exists, is wired at two client boundaries, and is loudly honest about having no backend. **A real backend (Sentry/OTel) is not installed and no `instrumentation.ts` registers one.** |
| 9.5 | Uptime monitoring | **none** | **partial** | `scripts/healthcheck.ps1` exists and is verified against healthy, app-down and database-down. `/api/health` is anonymously reachable. **No uptime provider is configured and no scheduled task is registered**, so nothing alerts anyone. |
| 9.6 | Audit log retention | **partial** | **partial** | `scripts/prune-audit-log.ps1` exists and is verified in dry-run mode against the live database. **No scheduled task is registered**, so the table still grows until one is. |

### Where `reportError()` is wired — the exact list

Two call sites. Both are client error boundaries.

| File | What changed |
|---|---|
| `app/error.tsx` | `console.error("[route-error]", {...})` in the `useEffect` → `reportClientError(error, { digest: error.digest })` |
| `app/global-error.tsx` | `console.error("[global-error]", {...})` during render → `reportClientError(error, { digest: error.digest })` |

**That is the complete list.** Nothing else calls `reportError()` yet.

**Not wired, and why:**

- **`app/api/health/route.ts`** — `app/api/**` is owned by another change and is
  outside this task's file ownership, so it was not touched. The change is one
  line in its `catch` block: replace
  `console.error("[health] database unreachable:", sanitizeForLog(error))`
  with a `reportError(error, { origin: "api:/api/health", route: "/api/health", method: "GET" })`.
  **This is the single highest-value wiring left** — a database outage is the
  event most likely to be missed, and it is a two-line change.
- **The 401/403 denial paths in `lib/auth/guards.ts`** — `lib/auth/**` is owned
  by another change. Not forced, deliberately: editing it would collide.
  **Recommended follow-up**, and worth being explicit about *why*: a 401/403 is
  a security control working, not a fault, so these are the **worst** candidate
  for paging. The value is investigative, not alerting. Add
  `reportError(error, { kind: ERROR_KIND.AUTHORIZATION, origin: "guard:authorizePermission", ... })`
  at the `denied()` return in `guards.ts` so denials become searchable by
  correlation id, and rely on `retryable: false` to keep them out of alerts.
- **Every `catch` in the application** — out of scope. A meaningful subset is
  server actions and the API routes that can return 500, not the whole codebase.

### Known gaps, in one list

1. **No error backend.** `reportError()` writes to stdout. A sink interface
   exists; nothing implements it remotely.
2. **No `instrumentation.ts`.** The natural place to register a sink at startup
   and to emit the "no backend" warning at boot rather than at first error. It
   is at the repository root, outside this change's file ownership.
3. **No correlation propagation per request.** §2.3. Needs `proxy.ts`.
4. **No client-side transport.** `client-report.ts` writes to the **browser
   console**, not the server. An ingest endpoint would live in `app/api/**`.
   A user-quoted id from a client boundary is not currently findable in server
   logs.
5. **Free-text secrets in error messages.** §1.6. Pinned by a test, not fixed.
6. **Nothing alerts anyone.** Not scheduled, not connected to an uptime
   provider, and no sink is registered. Every capability in this document is a
   mechanism, not a deployment.
7. **~200 `console.*` call sites** are still unstructured. §6.

---

## 8. Verification

```
npx tsc --noEmit                                                   # 0 errors
npx vitest run tests/observability-error-reporting.test.ts \
             tests/observability-retention.test.ts                # 77 passed
npx vitest run                                                     # 441 passed (21 files)
npx eslint lib/observability app/error.tsx app/global-error.tsx \
             tests/observability-*.test.ts                        # 0 problems
```

`tests/observability-error-reporting.test.ts` (41 tests) covers redaction
through the reporting call path, correlation-id stability and forgery
resistance, the taxonomy, route sanitisation, and the sink registry.

`tests/observability-retention.test.ts` (36 tests) covers the exclusive cutoff
boundary at millisecond resolution, the window guards, the mass-delete guard,
and reads both PowerShell scripts to pin their contract — default window,
dry-run default, schema verification ordering, `ON_ERROR_STOP`, identifier
validation, ASCII-only, and the `database`-field split in the healthcheck.

The destructive path of `prune-audit-log.ps1` is covered by those contract tests
rather than by execution, on purpose.
