# P0 REMEDIATION REPORT — PHASE 2

**Project**: IBMDIGITECH ENTERPRISE HRMS (`hr-system@0.1.0`, commit `34b6b60`)
**Date**: 2026-09-26
**Preceding work**: P0 security phase (2026-09-26, first pass) — see `FIX_LOG.md`
**Plan**: [`P0_REMEDIATION_PLAN.md`](./P0_REMEDIATION_PLAN.md)

---

## RESULT

```
P0 REMEDIATION RESULT

Authentication:        PASS
Database:              PASS
Seed:                  PASS
RBAC:                  PASS
API Security:          PASS
IDOR:                  PASS
Security Headers:      PASS
Rate Limiting:         PASS
Mobile:                PASS
Error Handling:        PASS
TypeScript:            PASS
Lint:                  FAIL  (385 problems / 193 errors)
Build:                 PASS
Automated Tests:       PASS  (111/111)
Database Integrity:    PASS
```

**Nothing is reported as PASS unless it was measured.** The lint result is
reported as FAIL with its real count, not softened.

---

## 1. Corrections to the earlier audit

Found by inspecting the implementation rather than trusting the prior report:

| Prior claim | Reality | Evidence |
|-------------|---------|----------|
| "No FK constraint between `User` and `Employee`" (`DB-015`, `DATABASE-001`) | **Wrong.** The FK already exists at the database level | `pg_constraint` returns `Employee_userId_fkey FOREIGN KEY ("userId") REFERENCES "User"(id)` |
| "`User.role` is a plain String with no constraint" (`DB-015`) | **Correct.** Still true, still open | `schema.prisma` — `role String @default("STAFF")` |
| Page guards return `307` for unauthorized users | **Wrong / overstated.** They returned `200` with a client-side redirect | Measured: a plain `redirect()` in any page returns 200 in this app |
| `SalaryRecord` has a `period` column | **Wrong.** It has `month` and `year` | `schema.prisma:304-309` |
| `Notification` has a `read` column | **Wrong.** It does not | `schema.prisma:172+` |
| Schema declares indexes on hot tables | **Wrong.** Only 3 existed, all added in the previous phase | `pg_indexes` |
| `next.config.ts` is the active config | **Wrong.** `next.config.js` took precedence; the `.ts` file was dead code | Both files existed; Next.js resolves `.js` first |

---

## 2. Findings fixed this phase

### 2.1 `lib/prisma.ts` could silently switch to MongoDB — FIXED

```ts
// BEFORE
url: process.env.MONGODB_URI || process.env.DATABASE_URL
```

`MONGODB_URI` was undefined, so the fallback never fired. But if it were ever
set, a **PostgreSQL** schema would be pointed at a **MongoDB** server at runtime.

Now reads only `DATABASE_URL`, throws a clear error when it is missing, and
**actively rejects** a `mongodb://` URL. `prisma.config.ts` had the same defect
and was fixed identically.

**Not deleted** (out of scope): `scripts/initiate.js` and
`scripts/initiate-replica-set.js` still reference `mongodb://127.0.0.1:27017`.
They are obsolete and imported by nothing.

### 2.2 `.env.example` did not exist — CREATED

`.gitignore` contained `.env*`, which would also have swallowed the example
file. Added `!.env.example` so the template is committable while every real
`.env` stays ignored. Verified:

| File | Ignored? | Correct? |
|------|----------|----------|
| `.env` | yes | yes |
| `.env.local` | yes | yes |
| `.env.example` | no | yes — committable |

### 2.3 Security headers — ADDED

`next.config.ts` had no `headers()`. Now emits:

| Header | Dev | Production |
|--------|-----|-----------|
| `Content-Security-Policy` | permissive (HMR needs it) | strict |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `X-Frame-Options` | `DENY` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | same |
| `Permissions-Policy` | camera/mic/geo/payment/usb disabled | same |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | same |
| `X-DNS-Prefetch-Control` | `off` | `off` |
| `Strict-Transport-Security` | **absent** | 2 years + subdomains + preload |

**HSTS is deliberately production-only** — sending it over plain HTTP on
localhost pins the browser to HTTPS and breaks local development.

`'unsafe-inline'` is retained for `style-src` (Tailwind/Radix inject inline
styles) and for `script-src` in production (Next.js RSC bootstrap). This is a
documented trade-off; a nonce-based CSP is a larger change than this phase.

### 2.4 `next.config.js` was shadowing `next.config.ts` — FIXED

Two config files existed. Next.js resolves `.js` → `.mjs` → `.ts`, so the `.ts`
file was **entirely dead** — meaning `turbopack.root`, `images.formats` and
`serverExternalPackages` had never been applied.

All settings were merged into `next.config.ts` (including the
`serverActions.bodySizeLimit: '2mb'` that only existed in the `.js` file) and
`next.config.js` was removed so they cannot drift apart again. This is a merge,
not a loss of behaviour.

### 2.5 Auth rate limiting — ADDED

`lib/auth/rate-limit.ts` + wiring into the credentials `authorize()`.

| Property | Value |
|----------|-------|
| Policy | 5 failures / 15 min |
| Keys | **two independent budgets** — IP+email, and email alone |
| Backoff | exponential, capped at 8× |
| Counts | failures only, so a legitimate user is not penalised for typos |
| Response | identical for wrong password vs lockout, so accounts cannot be probed |
| Logging | every failure to `SecurityAuditLog` |
| Failure mode | fails **open** — a limiter bug cannot lock everyone out |

**Measured at runtime:**

| Scenario | Result |
|----------|--------|
| Correct password, clean state | ALLOWED |
| 6 wrong attempts | all DENIED |
| Correct password after lockout | **DENIED** |
| Different account during lockout | ALLOWED |

**Production scaling note:** the store is in-process, so it is per-instance.
With N instances behind a load balancer the budget is N×, and a restart clears
it. `SlidingWindowStore` is the only thing to swap for Redis/Postgres — the
caller-facing interface (`checkRateLimit`, `recordFailure`) does not change.

### 2.6 Error boundaries — ADDED

`app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`.

All three **do not render `error.message` or `error.stack` to the user** — a
server-rendered error can carry a Prisma message, a file path, or a connection
string. The opaque `digest` is shown so a user can quote it in a support
request. Stack traces appear only under `NODE_ENV === "development"`.

Verified: `/nonexistent-page-xyz` returns **404** with the branded page.

### 2.7 Loading states — ADDED

Six `loading.tsx` segments (`app`, `dashboard`, `employees`, `attendance`,
`payroll`, `letters`) using a shared `PageSkeleton` with
`role="status" aria-busy="true"`.

### 2.8 Employee validation — ADDED

`app/lib/validation.ts` (the existing Zod file — no second library added).

**Server-side is authoritative**; the client runs the same rules for feedback.
Validates: names, email (normalised to lowercase), roll number charset, UAE
phone, IBAN, salary bounds, length caps, and cross-field rules (joining date
not future, expiry dates in the future, DOB before joining date).

### 2.9 Duplicate employee — RACE-SAFE

The brief explicitly warned that `if (!existing) create()` is a TOCTOU race.
Implemented as:

1. **Pre-check** → a *useful* error message naming the field.
2. **Existing unique indexes** on `Employee.email` / `Employee.rollNumber` → the authoritative guard.
3. **`P2002` handler** → maps the constraint violation to a field-level error.

The pre-check is documented in-code as advisory, not enforcement.

### 2.10 Onboarding made transactional — FIXED

`upsertEmployee` performed 6 sequential writes with no transaction, so a
mid-way failure left a `User` with no `Employee`, or an `Employee` with no leave
balances. Now wrapped in `prisma.$transaction`.

### 2.11 Page authorization status code — FIXED (real finding)

**This was a genuine defect found by testing, not by reading.**

I verified a plain `redirect()` in any page of this app returns **200**, not
307, because the root layout begins streaming before the page resolves. The
authorization boundary **held** — the guard ran (45 denials logged) and the
response body contained no employee data — but the status code was a weak
signal for monitoring and automation.

Fixed by moving the coarse role gate into `auth.config.ts`'s `authorized`
callback, which runs inside `auth()` in `proxy.ts` at the edge, before any
component renders.

**That immediately exposed a second, more serious bug.** The edge redirected
*everyone*, including admins, because:

```
[EDGE_DEBUG] /employees role= undefined keys= ["name","email","image"]
```

`proxy.ts` builds a **separate** `NextAuth(authConfig)` instance, and the
`session` callback that attaches `role` was defined only in `auth.ts`. The edge
session therefore had no `role` at all.

Fixed by defining `session` once in `auth.config.ts` (edge-safe, no Prisma
imports) and removing the duplicate from `auth.ts`. The two instances now
produce an identical session shape.

**Final measured matrix** (19 routes × 3 roles):

| | Anonymous | STAFF | ADMIN |
|---|---|---|---|
| `/dashboard` | 302 | 200 | 200 |
| `/employees` | 302 | 302 | 200 |
| `/payroll`, `/payroll/generate` | 302 | 302 | 200 |
| `/settings`, `/dashboard/admin/services` | 302 | 302 | 200 |
| `/dashboard/approvals/roles`, `/dashboard/request-access` | 302 | 302 | 200 |
| `/attendance/machine-integration`, `/letters/offer` | 302 | 302 | 200 |
| `/visa`, `/recruitment` | 302 | 302 | 200 |
| `/leaves/apply`, `/attendance`, `/leaves`, `/letters`, `/staff-services`, `/requests`, `/notifications` | 302 | 200 | 200 |

### 2.12 Mobile employee table — FIXED

| Viewport | Before | After |
|----------|--------|-------|
| < 768px | 6-column table, `min-w-[800px]`, horizontal scroll | card list |
| ≥ 768px | table | table (unchanged) |

Both render from the same `filteredEmployees`, so search, filter and empty
state behave identically. Card actions are **44px** (meets the touch minimum);
the table's icon buttons were 40px. Added `aria-label` to both.

Dialog: full-screen below 480px (`h-[100dvh]`, so mobile browser chrome does not
clip the footer), 95vw to `sm`, original 4xl above. Tabs: horizontally
scrollable with per-tab minimum widths. `ScrollArea` got `min-h-0` so it scrolls
instead of clipping the last field.

### 2.13 Employee form UX — FIXED

Inline field errors with `aria-invalid` + `aria-describedby` + `role="alert"`;
focus moves to the first invalid control; **entered data is preserved** on
failure; submit disabled with a spinner while saving; generic server errors.

### 2.14 Login form visible to authenticated users — FIXED

`app/login/page.tsx` now calls `useSession()` and redirects (or shows a
loading state) when a session exists. `proxy.ts` already redirected, but the
page no longer depends on the edge alone.

### 2.15 Indexes — ADDED (20 indexes, additive only)

Added only where an actual query pattern was located in the code:

| Table | Index | Query that needs it |
|-------|-------|---------------------|
| Employee | `isActive`, `(department, isActive)`, `currentStatus` | active-employee dropdowns, department scope |
| Attendance | `(employeeId, date)`, `date` | import duplicate check, daily lookups |
| LeaveRequest | `managerStatus`, `hrStatus`, `(employeeId, createdAt)` | approval queues |
| LeaveBalance | `(employeeId, year)` | balance lookup |
| Notification | `(employeeId, createdAt)` | per-employee feed |
| SalaryRecord | `(year, month)`, `(employeeId, year, month)` | payroll period queries |
| AuditLog | `(employeeId, createdAt)` | per-employee trail |
| ServiceRequest | `(employeeId, status)`, `status` | request lists |

**A privilege problem surfaced and was fixed.** After the previous phase's
least-privilege change, `hr_app` cannot run DDL, so `db push` failed with
`must be owner of table Attendance`. This is precisely what `DIRECT_URL` is
for. Split correctly:

- `DATABASE_URL` → `hr_app` (runtime, least privilege, no DDL)
- `DIRECT_URL` → `postgres` (migrations only, owner)

This is why `directUrl` exists in the schema.

### 2.16 `User ↔ Employee` relationship — REVIEWED, NO CHANGE NEEDED

Per the brief: inspect first, and do not delete orphans.

| Check | Result |
|-------|--------|
| Orphan employees (userId set, user missing) | 0 |
| Orphan users (no employee) | 0 |
| Employees with null userId | 0 |
| Duplicate userId in Employee | 0 |
| Duplicate email / rollNumber | 0 |
| FK constraints on Employee | **3** |

**Decision: no schema change.** The FK and the unique index already exist.
Making `userId` required would be a breaking change with no security benefit:
the authorization model already handles an employee-less user correctly
(`buildSubject` returns `employeeId: null` → SELF scope → can act on nothing).

---

## 3. Files changed

**New (14)**
```
lib/auth/rate-limit.ts
app/error.tsx
app/global-error.tsx
app/not-found.tsx
app/loading.tsx
app/dashboard/loading.tsx
app/employees/loading.tsx
app/attendance/loading.tsx
app/payroll/loading.tsx
app/letters/loading.tsx
components/common/Skeletons.tsx
components/common/FieldError.tsx
tests/p0-remediation.test.ts
.env.example
```

**Modified**
```
lib/prisma.ts                     removed MONGODB_URI fallback + driver guard
prisma.config.ts                  same
next.config.ts                    headers + merged settings
next.config.js                    REMOVED (dead config shadowing the .ts)
auth.config.ts                    session callback + edge role gate
auth.ts                           duplicate session callback removed
.gitignore                        !.env.example
.env                              DIRECT_URL split (migration vs runtime)
prisma/schema.prisma              20 additive indexes
app/lib/validation.ts             employeeSchema (Zod)
app/lib/actions/employees.ts      validation, transaction, P2002, centralized guard
app/employees/employee-list.tsx   mobile cards, dialog, tabs, field errors
app/login/page.tsx                session-aware redirect
docs/audit/*.md                   updated
```

**Removed: 1** — `next.config.js`, after its single setting was merged. No
behaviour lost.

## 4. Database changes

| Change | Type | Rows affected |
|--------|------|---------------|
| 20 indexes | additive | 0 |
| `SecurityAuditLog` (previous phase) | additive table | 0 |
| **Any row deleted** | — | **0** |
| **Any table dropped** | — | **0** |
| `prisma migrate reset` | **never run** | — |
| Docker volume | **never removed** | — |

| Metric | Before | After |
|--------|--------|-------|
| Tables | 40 | **40** |
| Users | 3 | **3** |
| Employees | 3 | **3** |
| Attendance | 22 | **22** |
| Service categories | 13 | **13** |
| Service configs | 19 | **19** |
| Orphan employees | 0 | **0** |
| Roles in use | ADMIN, MANAGER, STAFF | unchanged |

## 5. Build results

| Gate | Command | Result |
|------|---------|--------|
| TypeScript | `npx tsc --noEmit` | **PASS** — 0 errors |
| Build | `npm run build` | **PASS** — 16.7s |
| Lint | `npm run lint` | **FAIL** — 385 problems (193 errors, 192 warnings) |
| Tests | `npm test` | **PASS** — 111/111, 6 files |
| Seed | `node scripts/seed-standalone.js` ×2 | **PASS** — exit 0 both runs |
| Schema | `npx prisma validate` | **PASS** |

Lint improved from 12,244 → 385. The remaining 193 errors are `no-explicit-any`
in pre-existing code, tracked as `BUILD-003`.

## 6. Security test results

| Layer | Assertions | Passed | Failed |
|-------|-----------|--------|--------|
| Automated (Vitest, 6 files) | 111 | 111 | 0 |
| Page authorization (19 routes × 3 roles) | 57 | 57 | 0 |
| API authorization (4 endpoints × 3 roles) | 12 | 12 | 0 |
| Rate limiting (4 scenarios) | 4 | 4 | 0 |
| Security headers (7 headers) | 7 | 7 | 0 |
| 404 handling | 1 | 1 | 0 |
| Data leak check (STAFF → /employees) | 1 | 1 | 0 |
| **Total** | **193** | **193** | **0** |

Full detail in [`SECURITY_TEST_MATRIX.md`](./SECURITY_TEST_MATRIX.md).

## 7. Remaining issues

**0 critical.** 12 high, 29 medium, 21 low — see
[`REMAINING_ISSUES.md`](./REMAINING_ISSUES.md).

Newly opened this phase:

| ID | Severity | Issue |
|----|----------|-------|
| `SEC-028` | MEDIUM | Rate-limit counters are in-process; multi-instance deployments need a shared store |
| `DB-024` | MEDIUM | `DIRECT_URL` holds the owner password in `.env`; use a secret manager in production |
| `SEC-029` | LOW | CSP still permits `unsafe-inline` for scripts; a nonce-based policy needs a framework change |
| `CFG-001` | MEDIUM | Obsolete `scripts/initiate*.js` still reference MongoDB and are a maintenance trap |

## 8. Next recommended phase

1. **`SEC-027`** — force a password change on first login. All 5 accounts share
   `password123`. This remains the single highest-value fix.
2. **`SEC-025`** — CSPRNG-generated secret, moved to a secret manager.
3. **`DB-015`** — `User.role` as a Prisma enum with a DB-level constraint.
4. **`SEC-016`** — migrate the ~15 remaining inline role checks onto
   `requirePermission`.
5. **`DB-003` / `DB-019`** — transaction the remaining multi-write actions;
   make `SecurityAuditLog` append-only at the grant level.
6. **`BUILD-003`** — the 193 remaining lint errors, now protected by 111 tests.
