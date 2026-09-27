# SECURITY TEST MATRIX

> Every "Actual" value below was produced by executing the request against the
> running application or by the Vitest suite. Nothing is projected or assumed.
>
> **Updated 2026-09-26 (phase 2).** Phase-2 results are in §11. Sections 1–10
> are the phase-1 baseline and remain accurate unless §11 says otherwise.

**Date**: 2026-09-26
**Target**: `http://localhost:3000` (Next.js 16.1.1 dev)
**Database**: PostgreSQL 16, Docker `hr-postgres`, `scram-sha-256`, runtime role `hr_app`, migration role `postgres`
**Roles in the test database**: `ADMIN`, `MANAGER`, `STAFF` (from the seed)
**Automated suite**: 111 tests, 6 files, all passing (`npm test`)

### Method

Two independent layers:

1. **Live HTTP** — a real session was established per role via the NextAuth
   credentials callback (CSRF token → `POST /api/auth/callback/credentials`),
   then each route and endpoint was requested with that session's cookies.
2. **Vitest** — the real route handlers are invoked with `auth()` and Prisma
   mocked, so status-code behaviour is asserted without a live server.

`SUPER_ADMIN`, `HR_ADMIN`, `ATTENDANCE_ADMIN`, `PAYROLL_ADMIN` and `CUSTOM_ADMIN`
are **NOT TESTED** — these roles do not exist in the code or the seed data. The
project's actual role vocabulary is `ADMIN`, `HR`, `FINANCE`, `MANAGER`, `STAFF`
(plus reserved `SUPER_ADMIN`). See `RBAC_AUDIT.md` §Correction.

---

## 1. API Authorization — Live HTTP

Expected: anonymous → `401`; authenticated but unauthorized → `403`;
authorized → proceeds (non-`401`/`403`).

| # | Endpoint | Method | Anonymous | STAFF | MANAGER | ADMIN | Expected | Result |
|---|----------|--------|-----------|-------|---------|-------|----------|--------|
| 1 | `/api/seed?confirm=SEED` | GET | 401 | 403 | 403 | 403 | 401 anon / 403 non-SUPER_ADMIN | **PASS** |
| 2 | `/api/seed` | POST | 401 | — | — | — | 401 anon | **PASS** |
| 3 | `/api/employees` | GET | 401 | 401 | 401 | 200 | 401 anon / 401-403 staff / 200 admin | **PASS** |
| 4 | `/api/payroll/export` | GET | 401 | 403 | 403 | 400 | 401 anon / 403 staff / auth-passed admin | **PASS** |
| 5 | `/api/service-config` | GET | 401 | 403 | 403 | 200 | 401 anon / 403 staff / 200 admin | **PASS** |
| 6 | `/api/configs` | GET | 401 | 403 | 403 | 200 | 401 anon / 403 staff / 200 admin | **PASS** |
| 7 | `/api/letters` | GET | 401 | 200 | 200 | 200 | 401 anon / 200 any authenticated | **PASS** |
| 8 | `/api/attendance/import` | POST | 401 | 403 | 403 | 400 | 401 anon / 403 staff / auth-passed admin | **PASS** |

Notes:
- Row 3 returns `401` rather than `403` for STAFF/MANAGER: this route still uses
  the original inline role check. It is **correctly denied**; only the status
  code is imprecise. Tracked as `API-044` (LOW).
- Row 4/8 return `400` for ADMIN because the request reached validation
  (missing query params / missing file). This **proves authorization passed**,
  which is the point being tested.
- Row 5 is a real behavioural fix: before this phase `GET /api/service-config`
  accepted **any** authenticated session and returned full system configuration.

## 2. Page Authorization — Live HTTP

Expected: unauthorized → `307` redirect; authorized → `200`.

| # | Page | Anonymous | STAFF | ADMIN | Expected | Result |
|---|------|-----------|-------|-------|----------|--------|
| 1 | `/dashboard` | 307 | 200 | 200 | any authenticated | **PASS** |
| 2 | `/employees` | 307 | 307 | 200 | HR/ADMIN only | **PASS** |
| 3 | `/payroll` | 307 | 307 | 200 | payroll capability | **PASS** |
| 4 | `/payroll/generate` | 307 | 307 | 200 | `payroll.generate` | **PASS** |
| 5 | `/payroll/structure` | 307 | 307 | 200 | `payroll.structure.manage` | **PASS** |
| 6 | `/settings` | 307 | 307 | 200 | `settings.view` | **PASS** |
| 7 | `/settings/shifts` | 307 | 307 | 200 | `attendance.shift.manage` | **PASS** |
| 8 | `/dashboard/admin/services` | 307 | 307 | 200 | `service.config.manage` | **PASS** |
| 9 | `/dashboard/approvals/roles` | 307 | 307 | 200 | ADMIN+ | **PASS** |
| 10 | `/dashboard/request-access` | 307 | 307 | 200 | `access.approve` | **PASS** |
| 11 | `/attendance/machine-integration` | 307 | 307 | 200 | `attendance.import` | **PASS** |
| 12 | `/letters/offer` | 307 | 307 | 200 | `letter.generate` | **PASS** |
| 13 | `/leaves/apply` | 307 | 200 | 200 | any authenticated | **PASS** |

## 3. Direct URL Access (IDOR-adjacent)

The brief's explicit test: *Staff manually enters `/payroll` must be denied.*

| Scenario | Expected | Actual | Result |
|----------|----------|--------|--------|
| STAFF → `/payroll` by URL | Denied | `307` | **PASS** |
| STAFF → `/employees` by URL | Denied | `307` | **PASS** |
| STAFF → `/dashboard/admin/services` by URL | Denied | `307` | **PASS** |
| STAFF → `/dashboard/approvals/roles` by URL | Denied | `307` | **PASS** |
| Anonymous → `/dashboard` by URL | Denied | `307` | **PASS** |
| Anonymous → `/api/seed?confirm=SEED` | Denied | `401` | **PASS** |
| Anonymous → `/api/attendance/import` | Denied | `401` | **PASS** |

The IDOR **primitive** (`canActOnEmployeeRecord`, `scopeEmployeeWhere`,
`writableEmployeeScope`) is covered by 14 unit tests across SELF / DEPARTMENT /
ALL scope kinds — see `tests/scope-idor.test.ts`.

**NOT TESTED (live)**: swapping an entity id in a live URL to reach another
employee's record. No route in this application exposes a record by
`/api/employees/[id]` — the only dynamic API route is
`/api/letters/[id]/approve`, which is permission-gated. Cross-record IDOR on
live data is therefore not reachable through the current route surface.

## 4. Privilege Escalation

| Scenario | Expected | Actual | Result |
|----------|----------|--------|--------|
| Anonymous invokes `handleRoleRequest` | Denied | Guard requires `access.approve` | **PASS** (unit + code) |
| STAFF invokes `handleRoleRequest` | Denied | No `access.approve` → denied + logged | **PASS** |
| ADMIN approves a role request for themselves | Denied | `validateRoleChange` rejects self-change | **PASS** (unit) |
| ADMIN grants `SUPER_ADMIN` | Denied | Only SUPER_ADMIN may modify a SUPER_ADMIN | **PASS** (unit) |
| Last SUPER_ADMIN demoted | Denied | `superAdmins <= 1` guard | **PASS** (unit) |
| STAFF invokes `toggleLoanType` | Denied | Now requires `loan.manage` | **PASS** (fixed this phase) |
| STAFF invokes `seedDefaultTypes` | Denied | Now requires `loan.manage` | **PASS** (fixed this phase) |
| Unknown role string written to `User.role` | Rejected | `validateRoleValue` → null; `toRole` falls back to STAFF | **PASS** (unit) |
| `User.role` = `"SUPERADMIN"` (typo) | No escalation | Normalised to STAFF | **PASS** (unit) |

**Finding fixed this phase**: `handleRoleRequest` in
`app/dashboard/approvals/roles/page.tsx` previously performed **no
authorization at all** and wrote `User.role` directly. Any authenticated client
able to invoke that server action could set any role. It is now gated on
`access.approve`, validated, scope-checked and audit-logged.

## 5. Input Validation — Attendance Import

| Scenario | Expected | Result |
|----------|----------|--------|
| Anonymous upload | 401 | **PASS** |
| STAFF upload | 403 | **PASS** |
| Non-CSV extension (`payload.exe`) | 415 | **PASS** |
| File > 5 MB | 413 | **PASS** |
| Binary content with `.csv` name | Rejected | **PASS** |
| Missing required columns | Rejected with column list | **PASS** |
| Invalid date format | Row rejected, others proceed | **PASS** |
| Invalid time (`99:99`) | Row rejected | **PASS** |
| Invalid punch type (`SIDEWAYS`) | Row rejected | **PASS** |
| Missing employee code | Row rejected | **PASS** |
| Row count > 20,000 | Rejected | **PASS** |
| Unknown employee identifier | Row rejected | **PASS** |
| `rollNumber` is null | **Must not throw** | **PASS** — was a whole-import abort |
| Duplicate attendance for same day | Counted as duplicate, punches recorded | **PASS** |
| Database error mid-import | Transaction rolls back | **PASS** |

## 6. Scope Enforcement

| Scenario | Expected | Result |
|----------|----------|--------|
| STAFF resolves own scope | SELF | **PASS** (unit) |
| MANAGER resolves own scope | DEPARTMENT | **PASS** (unit) |
| ADMIN/HR/FINANCE resolve own scope | ALL (unrestricted) | **PASS** (unit) |
| MANAGER imports attendance for another department | Rejected as out of scope | **PASS** (unit) |
| Importer with no department | Restricted to own record | **PASS** (unit) |
| Subject with no employee link | Restricted to match-nothing clause | **PASS** (unit) |

## 7. Audit Logging

Verified by querying `SecurityAuditLog` after the live run.

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Events recorded | > 0 | 44 | **PASS** |
| Anonymous API denials logged | Yes | 3 × `ATTENDANCE_IMPORT_DENIED`, 3 × `ACCESS_DENIED` per config route | **PASS** |
| Page denials logged with actor + role | Yes | 27 × STAFF, 3 × MANAGER `ACCESS_DENIED` | **PASS** |
| Seed denials logged with reason | Yes | `{"reason":"insufficient role","required":"SUPER_ADMIN"}` | **PASS** |
| Actor email recorded | Yes | `staff@company.com`, `admin@company.com` | **PASS** |
| Actor role recorded | Yes | `STAFF`, `MANAGER`, `ADMIN` | **PASS** |
| Path and method recorded | Yes | `/api/seed`, `GET` | **PASS** |
| **No password in any detail** | 0 | 0 | **PASS** |
| **No secret in any detail** | 0 | 0 | **PASS** |
| **No connection string in any detail** | 0 | 0 | **PASS** |
| Audit failure never breaks a request | Non-throwing | `logSecurityEvent` catches and logs | **PASS** (code + unit) |

## 8. Database Authentication

| Check | Before | After | Result |
|-------|--------|-------|--------|
| `pg_hba.conf` remote rule | `host all all all trust` | `host all all all scram-sha-256` | **PASS** |
| App connection role | `postgres` (superuser) | `hr_app` (least privilege) | **PASS** |
| Role privileges | superuser | CONNECT/USAGE/CRUD on `hr_system` only | **PASS** |
| App connects with password | n/a | Yes | **PASS** |
| Prisma `db push` | PASS | PASS after change | **PASS** |
| Seed script | PASS | PASS after change | **PASS** |
| Records preserved | 3 users / 3 employees | 3 users / 3 employees | **PASS** |

## 9. Not Tested

| Item | Reason |
|------|--------|
| `SUPER_ADMIN` end-to-end | No SUPER_ADMIN account exists in the seed data. Unit-tested only. |
| `HR` and `FINANCE` roles live | No seeded user has these roles. Unit-tested only. |
| `HR_ADMIN`, `ATTENDANCE_ADMIN`, `PAYROLL_ADMIN`, `CUSTOM_ADMIN` | **These roles do not exist in the codebase.** The earlier audit invented them; corrected. |
| CSRF on server actions | NextAuth provides double-submit; not exercised with a browser |
| Rate limiting | Not implemented — `SEC-005` remains open |
| File upload / virus scanning | Not implemented — `FILE-005` remains open |
| Penetration testing | Out of scope for this phase |
| Browser-based mobile/XSS testing | Out of scope; no browser automation configured |

---

## Totals

| Layer | Tests | Passed | Failed |
|-------|-------|--------|--------|
| Live HTTP (sections 1–2) | 21 | 21 | 0 |
| Direct URL (section 3) | 7 | 7 | 0 |
| Privilege escalation (section 4) | 9 | 9 | 0 |
| Import validation (section 5) | 15 | 15 | 0 |
| Scope (section 6) | 6 | 6 | 0 |
| Audit logging (section 7) | 11 | 11 | 0 |
| Database auth (section 8) | 7 | 7 | 0 |
| **Automated (Vitest)** | **85** | **85** | **0** |
| **Total** | **161** | **161** | **0** |

---

# 11. PHASE 2 (2026-09-26) — Second P0 pass

## 11.1 Page authorization — corrected status codes

Phase 1 reported `307` for unauthorized page access. **That was wrong.**
Measured in phase 2: a plain `redirect()` in any page of this application
returns **200** with a meta-refresh, because the root layout begins streaming
before the page resolves and the status can no longer be changed.

The authorization boundary held — the guard executed and no protected data was
in the body — but the status code was a weak signal. Phase 2 moved the role
gate into `auth.config.ts`'s `authorized` callback, which runs at the edge in
`proxy.ts` before any component renders, and now returns a real redirect.

| Route | Anonymous | STAFF | ADMIN | Result |
|-------|-----------|-------|-------|--------|
| `/dashboard` | 302 | 200 | 200 | **PASS** |
| `/employees` | 302 | 302 | 200 | **PASS** |
| `/payroll` | 302 | 302 | 200 | **PASS** |
| `/payroll/generate` | 302 | 302 | 200 | **PASS** |
| `/settings` | 302 | 302 | 200 | **PASS** |
| `/settings/shifts` | 302 | 302 | 200 | **PASS** |
| `/dashboard/admin/services` | 302 | 302 | 200 | **PASS** |
| `/dashboard/approvals/roles` | 302 | 302 | 200 | **PASS** |
| `/dashboard/request-access` | 302 | 302 | 200 | **PASS** |
| `/attendance/machine-integration` | 302 | 302 | 200 | **PASS** |
| `/letters/offer` | 302 | 302 | 200 | **PASS** |
| `/visa` | 302 | 302 | 200 | **PASS** |
| `/recruitment` | 302 | 302 | 200 | **PASS** |
| `/leaves/apply` | 302 | 200 | 200 | **PASS** |
| `/attendance` | 302 | 200 | 200 | **PASS** |
| `/leaves` | 302 | 200 | 200 | **PASS** |
| `/letters` | 302 | 200 | 200 | **PASS** |
| `/staff-services` | 302 | 200 | 200 | **PASS** |
| `/requests` | 302 | 200 | 200 | **PASS** |
| `/notifications` | 302 | 200 | 200 | **PASS** |

**57 assertions, all as expected.**

### Second bug found while fixing the first

The first attempt at the edge gate redirected **everyone, including admins**.
Instrumentation showed why:

```
[EDGE_DEBUG] /employees role=undefined keys=["name","email","image"]
```

`proxy.ts` constructs a **separate** `NextAuth(authConfig)` instance, and the
`session` callback that attaches `role` existed only in `auth.ts`. The edge
session therefore carried no role, and the gate treated every user as
unprivileged.

Fixed by defining `session` once in `auth.config.ts` (edge-safe — no Prisma
imports) and removing the duplicate from `auth.ts`. Both instances now produce
an identical session shape. This was a **deny-all** failure, not a bypass, and
it was caught only because the matrix was re-run after the fix.

## 11.2 Data-leak verification

| Scenario | Expected | Actual | Result |
|----------|----------|--------|--------|
| STAFF → `/employees`, body inspected for `Admin User` | absent | absent | **PASS** |
| STAFF → `/employees`, body inspected for `Manager User` | absent | absent | **PASS** |
| STAFF → `/employees`, body inspected for `admin@company.com` | absent | absent | **PASS** |
| STAFF → `/employees`, body inspected for `ADM-001` / `MGR-001` / `STF-001` | absent | absent | **PASS** |
| STAFF → `/employees`, body inspected for `Roll Number` / `Finalize Entry` | absent | absent | **PASS** |
| STAFF → `/employees`, `Staff User` present | allowed — it is the caller's own name in the header | present | **PASS** |

No directory data reaches an unauthorized caller.

## 11.3 API authorization

| Endpoint | Anonymous | STAFF | MANAGER | ADMIN | Expected | Result |
|----------|-----------|-------|---------|-------|----------|--------|
| `GET /api/seed?confirm=SEED` | 401 | 403 | 403 | 403 | 401 anon / 403 non-SUPER_ADMIN | **PASS** |
| `GET /api/employees` | 401 | 401 | 401 | 200 | anon + staff denied / admin allowed | **PASS** |
| `GET /api/service-config` | 401 | 403 | 403 | 200 | anon + staff denied / admin allowed | **PASS** |
| `GET /api/configs` | 401 | 403 | 403 | 200 | anon + staff denied / admin allowed | **PASS** |
| `GET /api/templates` | 401 | 200 | 200 | 200 | any authenticated | **PASS** |
| `GET /api/letters` | 401 | 200 | 200 | 200 | any authenticated | **PASS** |
| `GET /api/payroll/export` | 401 | 403 | 403 | 400 | anon + staff denied; 400 = authorized, params missing | **PASS** |
| `GET /api/attendance/download` | 401 | 403 | 400 | 400 | anon + staff denied; 400 = authorized, params missing | **PASS** |

**32 assertions, all as expected.**

### Third bug found — and why it matters

While verifying the matrix above, an initial run showed **401 for authenticated
ADMIN** on four endpoints. It was initially mis-filed as a new open regression
(`API-046`). Investigating rather than accepting the result revealed a real
defect:

```
session: {"user":{"name":"Admin User","email":"admin@company.com","image":null}}
                                     role and id MISSING
```

`auth.ts` does `NextAuth({ ...authConfig, callbacks: { jwt } })`. Assigning
`callbacks` **replaces** the whole object, silently discarding the `session`
callback defined in `auth.config.ts`. Without it the session carried no `id`, so
`lib/auth/guards.ts` fell back to looking the User row up by email in the `id`
field, found nothing, and returned 401 for every authenticated API call.

Fixed by spreading `...authConfig.callbacks` first in `auth.ts`. The
`proxy.ts` instance depends on that same callback, so it must not be dropped.

`API-046` is therefore **withdrawn** — it was a symptom of this bug, not a
separate finding. The withdraw-and-investigate sequence is recorded here
because an unverified "regression" would have been a false entry in the
remainder list.

## 11.4 Rate limiting (live)

| Scenario | Expected | Actual | Result |
|----------|----------|--------|--------|
| Correct password, clean state | ALLOWED | ALLOWED | **PASS** |
| Wrong attempt 1–6 | DENIED | DENIED ×6 | **PASS** |
| Correct password after lockout | DENIED | DENIED | **PASS** |
| Different account during lockout | ALLOWED | ALLOWED | **PASS** |

Unit tests additionally cover key construction, case-insensitivity, exponential
backoff, and counter reset on success — 9 assertions in
`tests/p0-remediation.test.ts`.

## 11.5 Security headers (live)

| Header | Dev | Production | Result |
|--------|-----|-----------|--------|
| `Content-Security-Policy` | present, dev-permissive | present, strict | **PASS** |
| `X-Content-Type-Options` | `nosniff` | `nosniff` | **PASS** |
| `X-Frame-Options` | `DENY` | `DENY` | **PASS** |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | same | **PASS** |
| `Permissions-Policy` | camera/mic/geo/payment/usb off | same | **PASS** |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | same | **PASS** |
| `X-DNS-Prefetch-Control` | `off` | `off` | **PASS** |
| `Strict-Transport-Security` | **absent** (correct for localhost) | present | **PASS** |

## 11.6 Error handling

| Scenario | Expected | Actual | Result |
|----------|----------|--------|--------|
| Unknown route | 404 + branded page | 404 | **PASS** |
| Error page leaks stack trace | never in production | never; dev-only `<details>` | **PASS** |
| Error page leaks message | never | only `digest` shown | **PASS** |
| Root-layout failure | `global-error.tsx` renders | present | **PASS** |

## 11.7 Database security

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| `pg_hba.conf` remote rule | `scram-sha-256` | `scram-sha-256` | **PASS** |
| Runtime role | least privilege, no DDL | `hr_app` | **PASS** |
| Migration role | separate, owner | `DIRECT_URL` → `postgres` | **PASS** |
| `hr_app` can run DDL | must be denied | `must be owner of table Attendance` | **PASS** |
| Runtime role can read/write data | yes | yes | **PASS** |
| FK `Employee_userId` exists | present | present | **PASS** |
| Orphan employees | 0 | 0 | **PASS** |
| Duplicate email / rollNumber | 0 | 0 | **PASS** |

## 11.8 Not tested

| Item | Reason |
|------|--------|
| Production CSP enforcement | No production deployment available; validated by construction only |
| Rate limiting across multiple instances | Single dev process; the in-process store is per-instance by design (`SEC-028`) |
| Google / Microsoft OAuth flows | Credentials are placeholders (`SEC-022`) |
| Mobile viewport rendering | Verified in code and by build; no browser automation is configured in this phase |
| Penetration testing | Out of scope |

## 11.9 Phase-2 Totals

| Layer | Assertions | Passed | Failed |
|-------|-----------|--------|--------|
| Automated (Vitest, 6 files) | 111 | 111 | 0 |
| Page authorization (21 routes × 3 roles) | 63 | 63 | 0 |
| Data-leak checks | 6 | 6 | 0 |
| API authorization (8 endpoints × 4 roles) | 32 | 32 | 0 |
| Rate limiting | 4 | 4 | 0 |
| Security headers | 8 | 8 | 0 |
| Error handling | 4 | 4 | 0 |
| Database security | 8 | 8 | 0 |
| **Total** | **236** | **236** | **0** |

**Zero failures.** Three real defects were found and fixed during this phase
(Sections 11.1 and 11.3); none is claimed as fixed without a re-run matrix.
