# FIX LOG

Every fix applied, with root cause, solution, and verification. `TEST-*` entries
are P0 phase 2 (2026-09-26, second pass); `API-*`/`RBAC-*`/`DB-*`/`ERROR-*`/
`BUILD-*` entries are P0 phase 1; `FIX-*` entries are the initial audit phase.

---

# P0 PHASE 2 — 2026-09-26 (SECOND PASS)

Full narrative in [`P0_REMEDIATION_REPORT.md`](./P0_REMEDIATION_REPORT.md).

## TEST-001 — `auth.ts` silently dropped the `session` callback

| Field | Value |
|-------|-------|
| **Issue ID** | RBAC-001 regression, found by testing |
| **Severity** | CRITICAL (deny-all) |
| **Status** | **FIXED** |
| **File** | `auth.ts`, `auth.config.ts` |

### Problem
After moving the `session` callback from `auth.ts` into `auth.config.ts`
(so the edge instance would also have it), **every authenticated API call
returned 401**. Caught by re-running the API matrix.

### Root cause
`NextAuth({ ...authConfig, callbacks: { jwt } })` — assigning `callbacks`
**replaces** the whole object, so `authConfig.callbacks.session` was discarded.
The session then carried neither `role` nor `id`:

```
{"user":{"name":"Admin User","email":"admin@company.com","image":null}}
```

`lib/auth/guards.ts` reads `session.user.id` and falls back to email, so it
looked up the User row with `where: { id: "admin@company.com" }`, found nothing,
and returned 401.

`proxy.ts` builds a **separate** `NextAuth(authConfig)` that relies on the same
callback, so it must be preserved in both places.

### Solution
Spread the shared callbacks first, then extend:

```ts
callbacks: {
    ...authConfig.callbacks,   // MUST be first
    async jwt({ token, user, account }) { /* role resolution */ },
}
```

### Verification
| Check | Before | After |
|-------|--------|-------|
| `/api/auth/session` | no `role`, no `id` | `role:"ADMIN"`, `id:"cmuh5t4u…"` |
| `/api/employees` ADMIN | 401 | **200** |
| `/api/service-config` STAFF | 401 | **403** |
| API matrix (8 endpoints × 4 roles) | — | **32/32 as expected** |

---

## TEST-002 — Page authorization returned 200, not 307

| Field | Value |
|-------|-------|
| **Issue ID** | `PAGE-001` / authorization signal |
| **Severity** | MEDIUM |
| **Status** | **FIXED** |
| **Files** | `auth.config.ts`, `auth.ts` |

### Problem
Phase 1 reported `307` for unauthorized page access. **That was wrong.**
Measured: a plain `redirect()` in any page of this app returns **200** with a
meta-refresh, because the root layout begins streaming before the page resolves
and the status can no longer be changed.

The boundary held — the guard ran (45 denials logged) and the response body
contained no employee data — but the status code was a weak signal for
monitoring, WAFs and automation.

### Solution
Moved the coarse role gate into `auth.config.ts`'s `authorized` callback, which
executes inside `auth()` in `proxy.ts` at the edge, before any component renders.

### Verification
21 routes × 3 roles. Anonymous → 302 everywhere; STAFF → 302 on 12 restricted
routes, 200 on 9 self-service routes; ADMIN → 200 throughout. **63/63.**

Also confirmed: `/login` returns 200 to anonymous and 302 to authenticated users.

---

## TEST-003 — `next.config.js` shadowed `next.config.ts`

| Field | Value |
|-------|-------|
| **Issue ID** | CFG-002 |
| **Severity** | HIGH |
| **Status** | **FIXED** |
| **Files** | `next.config.ts`, `next.config.js` (removed) |

### Problem
Two config files existed. Next.js resolves `.js` → `.mjs` → `.ts`, so the `.ts`
file was **entirely dead**: `turbopack.root`, `images.formats` and
`serverExternalPackages` had never been applied. Discovered when the security
headers I added to `next.config.ts` produced no response headers.

### Solution
Merged every setting into `next.config.ts` — including the
`serverActions.bodySizeLimit: '2mb'` that only existed in the `.js` file — and
removed `next.config.js` so they cannot drift apart again.

### Verification
All 7 dev headers now present; HSTS correctly absent in dev. Build passes.

---

## TEST-004 — `lib/prisma.ts` could silently switch to MongoDB

| Field | Value |
|-------|-------|
| **Issue ID** | DB-016 |
| **Severity** | HIGH |
| **Status** | **FIXED** |
| **Files** | `lib/prisma.ts`, `prisma.config.ts` |

### Problem
```ts
url: process.env.MONGODB_URI || process.env.DATABASE_URL
```
`MONGODB_URI` is undefined so the fallback never fired — but if it were ever
set, a **PostgreSQL** schema would be pointed at a **MongoDB** server at runtime.

### Solution
Reads only `DATABASE_URL`; throws a clear error when absent; **rejects** a
`mongodb://` URL outright. Same fix in `prisma.config.ts`.

### Verification
`prisma validate` and `prisma db push` both succeed; the app boots.

---

## TEST-005 — `DIRECT_URL` privilege split

| Field | Value |
|-------|-------|
| **Issue ID** | DB-024 |
| **Severity** | HIGH (surfaced during this phase) |
| **Status** | **FIXED** (mechanism); credential storage still open |
| **File** | `.env` |

### Problem
`prisma db push` failed with `must be owner of table Attendance`. This was a
direct consequence of the phase-1 least-privilege change: `hr_app` correctly
has no DDL rights.

### Root cause
One connection string was used for both runtime and migrations.

### Solution
Split them, which is exactly what `directUrl` exists for:
- `DATABASE_URL` → `hr_app` (runtime, no DDL)
- `DIRECT_URL` → `postgres` (migrations only, owner)

### Verification
Index creation succeeds; `hr_app` confirmed unable to run DDL and able to read/write.

---

## TEST-006 — Auth rate limiting

| Field | Value |
|-------|-------|
| **Issue ID** | SEC-005 |
| **Severity** | HIGH |
| **Status** | **FIXED** |
| **Files** | `lib/auth/rate-limit.ts`, `auth.ts` |

Policy: 5 failures / 15 min, on **two independent keys** (IP+email, and email
alone) so neither rotating IPs nor spraying one account across IPs suffices.
Counts failures only, so a legitimate user is not penalised for typos. Returns
`null` on lockout rather than a distinct error, so accounts cannot be probed.
Fails **open** on an internal fault.

### Verification (live)
| Scenario | Result |
|----------|--------|
| Correct password, clean state | ALLOWED |
| 6 wrong attempts | DENIED ×6 |
| Correct password after lockout | **DENIED** |
| Different account during lockout | ALLOWED |

9 unit tests in `tests/p0-remediation.test.ts`.

---

## TEST-007 — Security headers

`next.config.ts` had no `headers()`. Now emits CSP, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`, `X-DNS-Prefetch-Control`, and HSTS
**production-only**. Verified live; HSTS confirmed absent in dev.

---

## TEST-008 — Error boundaries

`app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` created. None
renders `error.message` or `error.stack` to the user — only the opaque
`digest`. Stack traces appear only under `NODE_ENV === "development"`.

Verified: unknown route → 404 with the branded page.

---

## TEST-009 — Employee validation, duplicates, transaction

| Change | Detail |
|--------|--------|
| Schema | Zod `employeeSchema` in the existing `app/lib/validation.ts` — server-authoritative |
| Duplicates | Pre-check for a useful message; **existing unique indexes** are the real guard; `P2002` mapped to a field error |
| Transaction | Onboarding's 6 writes wrapped in `prisma.$transaction` |
| Guard | `upsertEmployee` / `deleteEmployee` / `getActiveEmployees` moved onto `requirePermission` |

The in-code comment states explicitly that the pre-check is advisory and must
never replace the database constraint.

---

## TEST-010 — Mobile employee table, dialog, tabs, form UX

| Viewport | Change |
|----------|--------|
| < 768px | Card list replaces the table; 44px actions; `aria-label` on both |
| ≥ 768px | Table unchanged |
| < 480px | Dialog full-screen `h-[100dvh]` |
| < 640px | Tabs horizontally scrollable with per-tab minimum widths |
| all | `ScrollArea` got `min-h-0` so it scrolls instead of clipping |

Form: inline errors with `aria-invalid`/`aria-describedby`/`role="alert"`,
focus moves to the first invalid control, entered data preserved on failure,
submit disabled with a spinner.

---

## TEST-011 — `User ↔ Employee` reviewed, no change

Pre-flight returned **0** orphans, **0** null `userId`, **0** duplicates, and
**3** FK constraints on `Employee` — including `Employee_userId_fkey`.

**The earlier audit's claim that the FK was missing was wrong.** No schema
change made: making `userId` required would be a breaking change with no
security benefit, since the authorization model already handles an
employee-less user safely (`SELF` scope, can act on nothing).

---

# P0 PHASE 1 — 2026-09-26

## API-010 — Public seed endpoint

| Field | Value |
|-------|-------|
| **Issue ID** | API-010 (CRITICAL) |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |
| **Files changed** | `app/api/seed/route.ts`, `proxy.ts`, `package.json` |

### Problem

`GET /api/seed` was reachable by anyone, with no authentication, and it wrote to
the database. Three compounding defects:

1. **No authentication of any kind.**
2. **It was a `GET`**, so it was reachable by link prefetch, crawler, or a
   pasted URL — not only by a deliberate `POST`.
3. **It wrote the literal string `'hashed-password-placeholder'` as the password
   hash**, so any admin account it created could never sign in. It also wrote a
   role of `ADMIN` for a fixed email.

### Root Cause

The route was written as an unauthenticated development convenience and was
never gated. Because the pre-existing `proxy.ts` matcher was:

```
matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)']
```

the `api` segment was **excluded from the session gate**, so no `/api/**` route
passed through any auth check at all.

### Solution

The route was kept — it creates letter-template reference data the app reads,
and the brief forbids blind deletion — and fenced:

1. **`NODE_ENV === "production"` → `404`**, evaluated before any DB access, with
   a generic body so the capability is not disclosed.
2. **No session → `401`**.
3. **`SUPER_ADMIN` only → `403`** for every other role, including `ADMIN`.
4. **Explicit confirmation** (`?confirm=SEED` or `x-seed-confirmation`) → `400`
   otherwise, so a stray GET, prefetch or crawler can never write.
5. **A real bcrypt hash** replaces the placeholder.
6. **Idempotent upserts** — `update: {}` on the user, keyed upserts on templates.
7. **Every outcome logged** to `SecurityAuditLog`.
8. The supported path is now the CLI: `npm run seed`.

### Testing

| Check | Result |
|-------|--------|
| Anonymous `GET /api/seed?confirm=SEED` | **401** |
| STAFF | **403** |
| MANAGER | **403** |
| HR | **403** |
| ADMIN | **403** |
| `NODE_ENV=production`, any role | **404**, body does not match `/seed/i` |
| `NODE_ENV=production`, anonymous | **404** |
| SUPER_ADMIN, no confirmation | **400** |
| SUPER_ADMIN + confirmation (dev) | **200**, `outcome: ALLOWED` |
| DB writes on denial | **none** |
| Automated | 10 tests in `tests/api-authorization.test.ts` |

---

## API-021 — Attendance import authorization

| Field | Value |
|-------|-------|
| **Issue ID** | API-021 (CRITICAL) |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |
| **Files changed** | `app/api/attendance/import/route.ts`, `app/lib/actions/attendance-import.ts`, `lib/attendance/import.ts` (new) |

### Problem — with a correction to the earlier audit

**The original audit finding was partly wrong and is corrected here.** The route
was **not** fully unauthenticated: it already returned `401` without a session,
and the server action it called performed an inline `["ADMIN","HR"]` check.

The real defects were:

| # | Defect | Impact |
|---|--------|--------|
| 1 | A missing permission was reported as **HTTP 200** with `success: false` | No caller could distinguish "forbidden" from "bad data" |
| 2 | No expressible `attendance.import` capability | Only ADMIN/HR hardcoded; no other attendance role was possible |
| 3 | **No transaction** | A mid-import failure left attendance and biometric rows partially written |
| 4 | `emp.rollNumber.toLowerCase()` **threw on a null `rollNumber`** | One bad employee row aborted the entire import |
| 5 | No organizational scope | A department-scoped importer could write attendance for any employee |
| 6 | The **server action** was the real attack surface — it is directly client-invokable | Its own check was ad-hoc and answered `200` on denial |

### Root Cause

Authorization logic lived in the callee, was duplicated between a route and a
server action, and could not return a meaningful status code.

### Solution

Extracted a single implementation and made both entry points delegate to it:

- **`lib/attendance/import.ts`** (new) — parsing, validation, scope resolution
  and the transactional write. Not a server-action file, so it can never be
  imported by a client.
- **`app/lib/actions/attendance-import.ts`** — thin wrapper, now calls
  `requirePermission(PERMISSIONS.ATTENDANCE_IMPORT)`, logs, and revalidates. The
  page's imports are unchanged.
- **`app/api/attendance/import/route.ts`** — calls
  `authorizePermission(PERMISSIONS.ATTENDANCE_IMPORT)`, so a missing capability
  returns a real **403** and a missing session a real **401**.

Additional hardening: 5 MB size cap, 20,000-row cap, extension **and** content
validation (NUL-byte rejection for binary masquerading as CSV), required-column
detection, per-row error collection, null-safe roll-number handling, and
department scope for non-ALL-scope importers.

### Testing

| Check | Result |
|-------|--------|
| Anonymous | **401** |
| STAFF | **403** |
| MANAGER | **403** |
| ADMIN | authorization passed (400 — no file supplied) |
| Non-CSV extension | **415** |
| File > 5 MB | **413** |
| Null `rollNumber` | no longer aborts the import |
| Rollback on DB error | no partial attendance data |
| Automated | 20 unit + 21 API tests |

---

## RBAC-001 — Centralized authorization

| Field | Value |
|-------|-------|
| **Issue ID** | RBAC-001 (CRITICAL), plus RBAC-002/003/010/012–015, API-006, SEC-008/009, SEC-014/015 |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |
| **Files changed** | `lib/auth/*` (6 new), `proxy.ts`, `prisma/schema.prisma`, 18 pages, 4 API routes, 3 action files, `components/layout/Sidebar.tsx` |

### Problem — with a correction to the earlier audit

**Correction**: a `proxy.ts` **did already exist** and exported
`NextAuth(authConfig).auth`, so the `authorized` callback in `auth.config.ts`
**was** being evaluated and anonymous visitors **were** redirected. The earlier
claim that "every page route was reachable anonymously" was **wrong**.

The genuine gaps were:

1. The `proxy.ts` matcher **excluded `api`**, so no `/api/**` route passed
   through the session gate.
2. **No role or capability enforcement anywhere in the edge layer.**
3. Permission logic was **duplicated inline in ~20 files** as
   `["ADMIN","HR"].includes((session.user as any).role)`.
4. **No effective-permission resolver.**
5. **3 inline server actions had no authorization at all** (below).

### Root Cause

Authorization was written ad-hoc per call site, with no shared model, so it
could not be reasoned about and drifted between endpoints.

### Solution

**New module `lib/auth/`**

| File | Purpose |
|------|---------|
| `roles.ts` | The 5 real roles + reserved `SUPER_ADMIN`. Unknown values normalise to `STAFF` — least privilege. |
| `permissions.ts` | ~50-permission catalog, role→permission grants, and `resolvePermissions()` — the **one** authoritative resolver. DENY beats ALLOW. |
| `scope.ts` | Organizational scope derived from existing `Employee.department` (no migration). Provides the IDOR primitive. |
| `guards.ts` | `requirePermission` / `requireAnyPermission` / `requireRole` / `requireSuperAdmin` (throwing) and `authorize*` (status-code returning). Plus `validateRoleChange` for Super Admin protection. |
| `page-guard.ts` | Server-component guards that `redirect()` before any query runs. |
| `audit.ts` | Append-only `SecurityAuditLog` writer with secret redaction that never throws. |

**Key design decision**: the role is **re-read from the database on every
request**, not trusted from the JWT. A token issued before a demotion stops
being authoritative immediately — this closes RBAC-010.

**Edge layer (`proxy.ts`)**: now gates `/api/**` too, returns a JSON `401` for
API callers instead of an HTML redirect. It deliberately does **not** decide
roles: the session is a JWE and the role claim is inside the encrypted payload;
reading it at the edge would require shipping `AUTH_SECRET` to the edge runtime.

**Page layer**: 18 pages now call a guard before rendering. 11 client pages were
converted to the standard server-wrapper pattern (`page.tsx` guards and renders
`page-client.tsx`). Three pages that only checked for a *session* — `/employees`,
`/payroll`, `/settings` — were leaking the full employee directory,
organisation-wide payroll and company configuration to any STAFF account.

**API layer**: `/api/configs`, `/api/service-config`, `/api/attendance/import`
rewritten onto the guards. `GET /api/service-config` previously accepted **any**
authenticated session and returned full system configuration.

**Super Admin protection** (`validateRoleChange`): refuses self-role-change,
refuses SUPER_ADMIN modification without SUPER_ADMIN, protects the last
SUPER_ADMIN from demotion, and refuses out-of-authority grants.

**Schema**: one additive model, `SecurityAuditLog`. No existing table or row
touched.

### Privilege-escalation hole closed

`handleRoleRequest` in `app/dashboard/approvals/roles/page.tsx` performed **no
authorization whatsoever** and wrote `User.role` directly:

```typescript
// BEFORE — no auth check at all
const request = await prisma.roleRequest.findUnique({ where: { id: requestId }, include: { user: true } });
if (action === "APPROVED") {
    await prisma.user.update({ where: { id: request.userId }, data: { role: request.requestedRole } });
}
```

Any authenticated client able to invoke that server action could set any role,
including `SUPER_ADMIN`. It is now gated on `access.approve`, role-validated,
scope-checked, transactional, and audit-logged with before/after values.

Two more unauthenticated server actions were fixed: `toggleLoanType` and
`seedDefaultTypes` in `app/payroll/loans/types/page.tsx` now require
`loan.manage`.

### Testing

| Check | Result |
|-------|--------|
| 13 pages × 3 roles, live | 39/39 as expected |
| 8 endpoints × 4 roles, live | 32/32 as expected |
| `validateRoleChange` unit tests | PASS |
| Permission resolution unit tests | PASS (21) |
| Scope/IDOR unit tests | PASS (14) |
| Audit-log events written | 44, zero secrets |

---

## DB-001 — PostgreSQL `trust` authentication

| Field | Value |
|-------|-------|
| **Issue ID** | DB-001 (CRITICAL) |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |
| **Changed** | `pg_hba.conf` in the container, database roles/grants, `.env` |

### Problem

`pg_hba.conf` ended with a blanket rule:

```
host all all all trust
```

Any local process could connect as `postgres` — a superuser — with no password.

### Root Cause

The container was created without a `POSTGRES_HOST_AUTH_METHOD` setting, and the
default `pg_hba.conf` was edited to `trust` during the earlier debugging phase
to get `prisma db push` working. The relaxed rule was never reverted.

### Solution

Inspected, backed up (data counted before and after), then changed — the
database was **not** recreated and the volume was **not** removed.

1. Created a least-privilege application role:

```sql
CREATE ROLE hr_app LOGIN PASSWORD '<rotated>';
GRANT CONNECT ON DATABASE hr_system TO hr_app;
GRANT USAGE, CREATE ON SCHEMA public TO hr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hr_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO hr_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO hr_app;
```

2. Replaced the blanket rule:

```
host all all all trust            →    host all all all scram-sha-256
```

3. Repointed `.env` at the least-privilege role rather than `postgres`.
4. Reloaded with `pg_reload_conf()` (no restart, no data loss).

The remaining `127.0.0.1/32 trust` and `::1/128 trust` lines are the
**container's own loopback** and are not reachable from the host; host traffic
arrives via the Docker bridge and matches the final `scram-sha-256` rule.

### Testing

| Check | Result |
|-------|--------|
| `pg_hba.conf` remote rule | `scram-sha-256` |
| App connects with password | PASS |
| `prisma db push` | PASS |
| `node scripts/seed-standalone.js` | PASS |
| Password auth from outside the container | PASS |
| Users before / after | 3 / 3 |
| Employees before / after | 3 / 3 |
| Tables before / after | 39 / 40 (+1 additive `SecurityAuditLog`) |
| Database recreated? | **No** |
| Volume removed? | **No** |
| Any row deleted? | **No** |

**Residual**: credentials are still a local-development pair in `.env`. Tracked
as `SEC-025`.

---

## ERROR-006 — Seed script crash

| Field | Value |
|-------|-------|
| **Issue ID** | ERROR-006 (CRITICAL) |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |
| **File changed** | `scripts/seed-standalone.js:168-190` |

### Problem

```
Seeding failed: TypeError: Cannot read properties of undefined (reading 'findUnique')
    at main (scripts/seed-standalone.js:169:64)
```

The script exited `1`, so the `ServiceConfig` block below never ran.

### Root Cause

The script referenced a Prisma model that does not exist:

```javascript
await prisma.staffServiceType.findUnique({ where: { name: type.name } });
await prisma.staffServiceType.create({ data: type });
```

`prisma/schema.prisma:384` defines the model as **`ServiceCategory`**, not
`StaffServiceType`. `prisma.staffServiceType` was `undefined`.

### Solution

Repointed to the correct model and made the block idempotent:

```javascript
const existingType = await prisma.serviceCategory.findUnique({ where: { name: type.name } });
if (!existingType) {
    await prisma.serviceCategory.create({ data: { name, description, requiresAmount, requiresDates } });
} else {
    await prisma.serviceCategory.update({ where: { name }, data: { /* keep in sync */ } });
}
```

The `ServiceConfig` block below it was already correct and now actually runs.

### Testing

| Check | Result |
|-------|--------|
| Seed completes | `Seeding Complete!`, exit `0` |
| Run twice (idempotency) | Exit `0`, no duplicate users/employees/configs |
| `ServiceCategory` rows | 13 |
| `ServiceConfig` rows | 19 (the full default catalogue) |
| Users / Employees | 3 / 3 — unchanged |
| Existing business data deleted | **No** |
| Attendance rows | 21 → 22 |

> **The attendance block is still not idempotent** (`DB-020`): the script
> creates attendance rows without checking for existing ones, so the three seed
> runs in this phase produced one additional row. This is a pre-existing
> behaviour of `seed-standalone.js`, not a regression from this fix, and is
> tracked as `DB-020` (LOW). Users, employees, roles, service categories and
> service configs are all idempotent and unchanged.

---

## BUILD-002 — Generated code excluded from lint

| Field | Value |
|-------|-------|
| **Issue ID** | BUILD-002 (HIGH) |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |
| **File changed** | `eslint.config.mjs` |

### Problem

`npm run lint` reported **12,244 problems (3,922 errors)**. ~3,900 came from
`prisma/generated/**` — machine-generated Prisma runtime code — and buried the
real application errors.

### Root Cause

`globalIgnores([...])` **replaces** ESLint's default ignore list, so anything
not listed is linted. `prisma/generated/**` was not listed. Separately,
`.kilo/worktrees/**` contained full copies of the repository.

### Solution

Scoped ignores — no rule was disabled and no application path was hidden:

```js
globalIgnores([
  ".next/**", "out/**", "build/**", "next-env.d.ts",
  "prisma/generated/**",        // BUILD-002 — generated, never edited to satisfy lint
  "prisma/migrations/**",
  "hr-system/**",               // legacy duplicate tree — see LEGACY_APP_ANALYSIS.md
  "coverage/**", "test-results/**", "playwright-report/**", "firebase-debug.log",
  ".kilo/**",                   // agent worktree copies
])
```

Plus a scoped override for the CommonJS seed scripts (`no-require-imports` off
for `scripts/**/*.js`, `seed-*.js`, `prisma/seed.js`) — BUILD-005.

### Result

| | Before | After |
|---|--------|-------|
| Whole repo | 12,244 problems / 3,922 errors | **387 problems / 200 errors** |
| False errors removed | — | ~3,722 |

The remaining 200 errors are all genuine `no-explicit-any` in pre-existing
code. See `REMAINING_ISSUES.md` → `BUILD-003`.

---

## BUILD-004 — Automated test foundation

| Field | Value |
|-------|-------|
| **Issue ID** | BUILD-004 (HIGH) |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |
| **Files added** | `vitest.config.ts`, `tests/*.test.ts` (5 files) |

### Solution

Vitest 5 + Vite, chosen because the stack is TypeScript with no existing test
framework. Scoped to the security-critical pure modules so no database or live
server is needed. `npm test` and `npm run test:watch` scripts added, plus
`typecheck`, `seed`, `db:push`, `db:studio`.

| Test file | Tests | Covers |
|-----------|-------|--------|
| `tests/rbac.test.ts` | 21 | Role normalisation, permission resolution, overrides, DENY-beats-ALLOW |
| `tests/scope-idor.test.ts` | 14 | IDOR primitive across SELF/DEPARTMENT/ALL |
| `tests/attendance-import.test.ts` | 20 | CSV parsing, validation, import authorization, scope |
| `tests/audit-redaction.test.ts` | 9 | Secret redaction contract |
| `tests/api-authorization.test.ts` | 21 | Real route handlers, 401/403/404 wiring |
| **Total** | **85** | **all passing** |

The suite immediately caught a **real bug** in my own redaction code: comparing
lower-cased keys alone missed snake_case names, so `refresh_token` was logged in
clear. Fixed by normalising keys (strip `_ - . space`) before comparison.

---

## FIX-006 — 3 unauthenticated inline server actions

| Field | Value |
|-------|-------|
| **Issue ID** | RBAC-012 (CRITICAL) |
| **Date** | 2026-09-26 |
| **Status** | **FIXED** |

### Problem

Three `"use server"` actions defined inline inside pages performed **no
authorization at all**. A server action is directly invocable by any client, so
each was a live mutation endpoint with an open door.

| Action | File | Could do |
|--------|------|----------|
| `handleRoleRequest` | `app/dashboard/approvals/roles/page.tsx:10` | Write **any** value to `User.role` — full privilege escalation |
| `toggleLoanType` | `app/payroll/loans/types/page.tsx:11` | Enable/disable loan configuration |
| `seedDefaultTypes` | `app/payroll/loans/types/page.tsx:17` | Write loan types |

### Solution

All three now call the centralized guards, log to `SecurityAuditLog`, and
handle denials explicitly. `handleRoleRequest` additionally validates the
requested role, applies `validateRoleChange`, and updates the user and the
request in a single transaction.

### Testing

| Check | Result |
|-------|--------|
| Anonymous invoke | Denied by `requirePermission` |
| STAFF invoke | Denied, logged |
| Unknown requested role | Rejected, not written |
| Self role change | Rejected |
| Data unchanged | Yes — `roles_in_use` still `ADMIN,MANAGER,STAFF` |

---

# EARLIER AUDIT PHASE — 2026-09-25

## FIX-001 — BUILD-001: Production build blocked by TypeScript

| Field | Value |
|-------|-------|
| **Issue ID** | BUILD-001 (CRITICAL) |
| **Files changed** | `app/dashboard/settings/templates/page.tsx:33` |
| **Status** | **FIXED** |

**Problem**: `npm run build` exited 1 — `TS2345`, and `TS18048` ×2 at
`app/dashboard/settings/templates/page.tsx:34-36`.

**Root cause**: `getLetterTemplates()` returns
`{ success: true, data } | { success: false, error }`. TypeScript widens
`success` to `boolean`, so the union is not discriminated and `res.data` cannot
be narrowed.

**Solution**:
```diff
-        if (res.success) {
+        if (res.success && res.data) {
```

**Runtime impact**: none — on the success path `res.data` is always defined.

**Testing**: `tsc --noEmit` 0 errors; `npm run build` PASS; route manifest
identical (52 routes); 22/22 module sweep; data intact.

---

## FIX-002 — SEC-001: Invalid AUTH_SECRET

| Field | Value |
|-------|-------|
| **Issue ID** | SEC-001 (CRITICAL) |
| **Files changed** | `.env` |
| **Status** | **FIXED** (environment) |

**Problem**: `JWTSessionError: no matching decryption secret` on every request.
The launcher wrote `AUTH_SECRET="secret-key-generated-by-launcher"`.

**Solution**: generated a 32-byte secret and wrote it with the correct
PostgreSQL URLs.

**Testing**: `[AUTH] Passwords match: true` → `POST /api/auth/callback/credentials 200` → `/dashboard 200`.

**Residual**: generated with PowerShell `Get-Random`, not a CSPRNG. Tracked as
`SEC-025`.

---

## FIX-003 — DB-002: MongoDB URI in a PostgreSQL application

| Field | Value |
|-------|-------|
| **Issue ID** | DB-002, SEC-002, SEC-004 (CRITICAL) |
| **Files changed** | `.env` |
| **Status** | **FIXED** |

**Problem**: `P1012 Environment variable not found: DIRECT_URL` and
"the URL must start with the protocol `postgresql://`".

**Root cause**: `prisma/schema.prisma` declares a PostgreSQL datasource, but the
launcher wrote a MongoDB URI and omitted `DIRECT_URL`. `prisma.config.ts` also
references `MONGODB_URI`.

**Solution**: wrote a PostgreSQL `DATABASE_URL` and matching `DIRECT_URL`.

**Testing**: `prisma generate` PASS; `prisma db push` PASS (39 tables);
`npm run dev` PASS; `/dashboard` 200.

**Residual**: `prisma.config.ts` still references `MONGODB_URI` — `DB-021`.

---

## FIX-004 — DB-001 (earlier phase): No reachable database

| Field | Value |
|-------|-------|
| **Issue ID** | DB-001 (environment) |
| **Status** | **FIXED** |

**Problem**: `P1000: Authentication failed` and `Bind for 0.0.0.0:5432 failed`.

**Root cause**: host port 5432 occupied by a local PostgreSQL install; the image
defaulted to `scram-sha-256`; Docker Desktop was shutting down mid-command,
leaving containers with no published port.

**Solution**: moved to host port 5433; started Docker Desktop and waited for
readiness; created the container.

**Superseded** by the P0 `DB-001` fix above, which replaced the `trust` rule
with `scram-sha-256` and a least-privilege role.

---

## FIX-005 — ENV-001: Docker credential helper

| Field | Value |
|-------|-------|
| **Issue ID** | ENV-001 (MEDIUM) |
| **Files changed** | `C:\Users\lenovo\.docker\config.json` |
| **Status** | **FIXED** |

**Problem**: `error getting credentials - err: exec: "docker-credential-desktop": executable file not found`.

**Solution**: wrote `{"credHelpers":{}}` to suppress the helper lookup.

**Testing**: `docker pull`, `docker run`, `docker exec`, `docker cp` all PASS.

---

# Summary

| Fix | Issue IDs | Severity | Status |
|-----|-----------|----------|--------|
| API-010 | `API-010` | CRITICAL | **FIXED** |
| API-021 | `API-021` | CRITICAL | **FIXED** |
| RBAC-001 | `RBAC-001/002/003/010/012–015`, `API-006`, `SEC-008/009/014/015` | CRITICAL | **FIXED** |
| DB-001 | `DB-001` | CRITICAL | **FIXED** |
| ERROR-006 | `ERROR-006` | CRITICAL | **FIXED** |
| FIX-006 | `RBAC-012` | CRITICAL | **FIXED** |
| BUILD-002 | `BUILD-002` | HIGH | **FIXED** |
| BUILD-004 | `BUILD-004` | HIGH | **FIXED** |
| FIX-001 | `BUILD-001` | CRITICAL | **FIXED** |
| FIX-002 | `SEC-001` | CRITICAL | **FIXED** |
| FIX-003 | `DB-002` | CRITICAL | **FIXED** |
| FIX-004 | `DB-001` (env) | CRITICAL | **FIXED** |
| FIX-005 | `ENV-001` | MEDIUM | **FIXED** |

**12 fixes, 12 verified.**

---

# Deliberately NOT fixed

| Item | Why |
|------|-----|
| 200 `no-explicit-any` lint errors | 16–24h refactor across ~100 files; needs regression cover first. `BUILD-003` |
| Role-enforcement in `proxy.ts` | Requires shipping `AUTH_SECRET` to the edge. Deliberately server-side instead. |
| Rate limiting on auth | `SEC-005` — open |
| `/api/employees` returning 401 instead of 403 | Cosmetic; correctly denied. `API-044` |
| `prisma.config.ts` referencing `MONGODB_URI` | `DB-021` — open |
| CSPRNG for `AUTH_SECRET` | `SEC-025` — open |
| Deleting `hr-system/` | Explicitly prohibited. See `LEGACY_APP_ANALYSIS.md` |
| Email / SMS / storage integrations | Need third-party accounts. P2 |

---

# Files modified in the P0 phase

**New (11)**
```
lib/auth/roles.ts
lib/auth/permissions.ts
lib/auth/scope.ts
lib/auth/guards.ts
lib/auth/page-guard.ts
lib/auth/audit.ts
lib/attendance/import.ts
vitest.config.ts
tests/rbac.test.ts
tests/scope-idor.test.ts
tests/attendance-import.test.ts
tests/audit-redaction.test.ts
tests/api-authorization.test.ts
```

**Modified**
```
proxy.ts                              (rewritten: /api gate)
prisma/schema.prisma                  (+SecurityAuditLog — additive)
eslint.config.mjs                     (generated-code + legacy excludes)
package.json                          (test, seed, typecheck scripts)
.env                                  (least-privilege DB role)
app/api/seed/route.ts                 (fenced)
app/api/attendance/import/route.ts    (guards + shared core)
app/api/configs/route.ts              (guards + allow-list)
app/api/configs/reset/route.ts        (guards)
app/api/service-config/route.ts       (guards — was open to all)
app/lib/actions/attendance-import.ts  (guards + shared core)
app/lib/actions/shifts.ts             (guards)
app/lib/actions/letter-templates.ts   (guards)
components/layout/Sidebar.tsx         (permission-aware)
18 page files                         (page guards / server wrappers)
11 page-client.tsx                    (extracted client bodies)
docs/audit/*.md                       (updated + 2 new)
```

**Database migrations**: one additive model (`SecurityAuditLog`). No column
altered, no table dropped, no row deleted.
