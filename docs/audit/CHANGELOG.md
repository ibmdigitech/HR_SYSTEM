# CHANGELOG

Major implementation and audit-driven changes to the ANTIGRAVITY ENTERPRISE HRMS.

Format: Date · Change · Reason · Affected Areas · Migration · Testing

---

## 2026-09-26 — P0 Security, Authorization & Data-Integrity Remediation

**Change**: Closed all 5 critical audit findings, introduced centralized authorization, replaced database `trust` authentication, repaired the seed script, and established an automated test foundation.

**Reason**: The application had two publicly reachable write endpoints, no capability-based authorization, a database accepting any local connection as superuser, and a seed script that could not complete. The earlier audit was also found to contain errors, which were corrected rather than carried forward.

**Affected Areas**:
- `lib/auth/**` — new authorization module (6 files)
- `lib/attendance/import.ts` — new shared import core
- `proxy.ts` — rewritten to gate `/api/**`
- `prisma/schema.prisma` — +1 additive model
- 18 page files, 11 extracted `page-client.tsx`
- 4 API routes, 3 action files, `components/layout/Sidebar.tsx`
- `eslint.config.mjs`, `package.json`, `vitest.config.ts`, `.env`
- `tests/**` — 5 new test files
- `docs/audit/**` — 2 new documents, 4 rewritten

**Migration**: One additive model, `SecurityAuditLog`. No column altered, no table dropped, no row deleted, no migration reverted.

**Testing**:
- `npx tsc --noEmit` → **0 errors**
- `npm run build` → **PASS**, 26.3s, 48 routes
- `npm test` → **PASS**, 85/85
- `npm run lint` → 387 problems / 200 errors (down from 12,244 / 3,922)
- Live HTTP → 76 assertions across 8 endpoints × 4 roles and 13 pages × 3 roles, all as expected
- Security audit log → 44 events, **0** containing a password, secret, or connection string
- Data → 3 users / 3 employees / 40 tables, all preserved

**Fixed**:

| ID | Issue | Fix |
|----|-------|-----|
| `API-010` | Public `GET /api/seed` with a placeholder password hash | 404 in production, 401 anon, 403 non-SUPER_ADMIN, 400 without confirmation, real bcrypt, idempotent, logged |
| `API-021` | Import returned 200 on denial; no capability; no transaction; crashed on null `rollNumber` | `attendance.import` capability, real 401/403, shared core, `prisma.$transaction`, null-safe, scoped, validated |
| `RBAC-001` | No capability enforcement; `proxy.ts` matcher excluded `/api` | `lib/auth/` module, `/api` edge gate, 18 page guards, 4 API rewrites |
| `DB-001` | `pg_hba.conf` blanket `trust` as superuser | `scram-sha-256` + least-privilege `hr_app` role with scoped grants |
| `ERROR-006` | `prisma.staffServiceType` — a model that does not exist | Repointed to `ServiceCategory`; block made idempotent |
| `RBAC-012` | `handleRoleRequest` wrote `User.role` with **no authorization** | Gated on `access.approve`, role-validated, scoped, transactional, logged |
| `RBAC-014` | `ServiceConfig` readable by any authenticated user | `service.config.manage` enforced |
| `RBAC-010` | No session invalidation on role change | Role re-read from the database on every request |
| `BUILD-002` | `prisma/generated/**` linted (~3,900 false errors) | Scoped `globalIgnores` |
| `BUILD-004` | No test framework | Vitest 5, 85 tests |

**Additional holes closed** (found during remediation):
- `toggleLoanType` and `seedDefaultTypes` — unauthenticated server actions
- `GET /api/service-config` — open to any authenticated session
- `/employees`, `/payroll`, `/settings` — session check only, no role check
- `GET /api/seed` was a `GET`, reachable by prefetch and crawlers

**Corrections to the earlier audit** (documented, not silently dropped):
- A `proxy.ts` already existed and did gate page routes; the gap was its matcher excluding `api`
- `/api/attendance/import` already returned 401; the real defects were different
- `/api/employees` and `/api/letters/[id]/approve` already had role checks
- `HR_ADMIN`, `PAYROLL_ADMIN`, `ATTENDANCE_ADMIN`, `CUSTOM_ADMIN` do not exist in the code

---

## 2026-09-25 — Full Application Audit & Build Unblock

**Change**: Completed a 26-document audit of the entire application, documented 76 real findings, and fixed the production build blocker.

**Reason**: The application could not be built for production (`next build` exited 1), sessions could not be validated, and the database was unreachable. A structured audit was required to establish a trustworthy baseline and prioritise remediation.

**Affected Areas**:
- `app/dashboard/settings/templates/page.tsx` — 1-line type-guard fix
- `.env` — PostgreSQL `DATABASE_URL` + `DIRECT_URL` + valid `AUTH_SECRET`
- Local Docker PostgreSQL (`hr-postgres`, host port 5433) — created
- `docs/audit/**` — 26 new documentation files

**Migration**: None. No schema change. No data change.

**Testing**:
- `npx tsc --noEmit` → **0 errors** (was 3)
- `npm run build` → **PASS**, `✓ Compiled successfully in 12.5s`, 52 routes emitted
- `npx prisma db push` → **PASS**, 39 tables in sync
- Manual route sweep → **22/22 PASS**
- Data integrity check → 3 Employee rows, 3 User rows, all intact
- Regression report → **no regression detected**

**Fixed**:
| ID | Issue |
|----|-------|
| BUILD-001 | 3 TypeScript errors blocked `next build` |
| SEC-001 | Placeholder `AUTH_SECRET` broke JWT session decryption |
| DB-002 | MongoDB URI in a PostgreSQL application |
| DB-001 | No reachable PostgreSQL for local development |
| ENV-001 | Docker CLI blocked by a missing credential helper |

---

## 2026-09-25 — Database Schema Synchronised

**Change**: Created the PostgreSQL database and pushed the full Prisma schema — 39 tables created.

**Reason**: The application had never been successfully provisioned with a working database. Every previous `prisma db push` failed on authentication.

**Affected Areas**: Local database `hr_system` only. No application code changed.

**Migration**: `npx prisma db push` (not `prisma migrate` — see `DB-021`).

**Testing**: `\dt` confirms 39 tables. `SELECT * FROM "Employee"` returns the 3 seeded records.

**Data created**:
- 3 `User` rows — `admin@company.com` (ADMIN), `manager@company.com` (MANAGER), `staff@company.com` (STAFF)
- 3 `Employee` rows — ADM-001, MGR-001, STF-001, each linked to its `User`

**Incomplete**: The seed script crashes at Service Types creation (`ERROR-006`), so Shifts, LoanTypes, LetterTemplates, and Candidates remain unseeded.

---

## 2026-09-25 — Session Secret Replaced

**Change**: Replaced the placeholder `AUTH_SECRET` with a generated 32-byte secret.

**Reason**: `___RUN_APP_CLICK_ME.bat` wrote `AUTH_SECRET="secret-key-generated-by-launcher"`, producing `JWTSessionError: no matching decryption secret` on every authenticated request. The login form and sidebar could never resolve.

**Affected Areas**: `.env` only.

**Migration**: Rotating an `AUTH_SECRET` invalidates every issued session cookie. All browsers must clear `localhost` site data once after this change.

**Testing**: `[AUTH] Passwords match: true` → `POST /api/auth/callback/credentials 200` → `/dashboard 200`.

**Residual risk**: Generated with PowerShell `Get-Random`, which is not a CSPRNG. Tracked as `SEC-025`.

---

## 2026-09-25 — Audit Documentation Established

**Change**: Created `/docs/audit/` with 26 documents covering routes, pages, workflows, RBAC, APIs, database, security, UI/UX, CSS, mobile, accessibility, performance, errors, forms, file upload, notifications, integrations, tests, build, regression, fixes, remaining issues, and changelog.

**Reason**: The project had no engineering audit record. Findings were scattered across conversation, making prioritisation and verification impossible.

**Affected Areas**: `docs/audit/**` (new). No application code touched.

**Migration**: None.

**Testing**: Every finding is backed by file path, line number, a command's actual output, or a marked `NOT TESTED` / `BLOCKED` status. No finding is asserted without evidence.

---

# Historical Changes (pre-audit, from git)

## 34b6b60 — Shift Management System

**Change**: Implemented shift management including assignment UI, database actions, and an attendance overview dashboard.

**Reason**: Introduce shift-based attendance tracking.

**Affected Areas**:
- `app/attendance/shifts/` — new
- `app/attendance/machine-integration/` — new
- `app/lib/actions/shifts.ts` — new
- `app/lib/actions/attendance-import.ts` — new
- `prisma/schema.prisma` — `Shift` model, `Employee.shiftId`, `Attendance.shiftId`

**Migration**: Applied.

**Testing**: Not recorded in the repository.

---

# Pre-Audit State Summary

Recorded so future readers can distinguish what existed before this audit from what the audit changed.

| Area | State before audit | State after audit |
|------|--------------------|-------------------|
| Production build | **Broken** (3 TS errors) | **Passing** |
| Database | Unreachable (bad credentials) | Provisioned, 39 tables, 3 users seeded |
| Sessions | Broken (placeholder secret) | Working |
| Dev server | Ran, but on a broken config | Verified on port 3001 |
| Lint | Never measured | **408 problems** in app code (222 errors) |
| Typecheck | Never measured standalone | **0 errors** |
| Tests | None exist | None exist (`BUILD-004`) |
| Audit trail | None | 26 documents, 76 open issues |

---

# Version History

| Version | Date | Commit | Notes |
|---------|------|--------|-------|
| `hr-system@0.1.0` | 2026-09-25 | `34b6b60` + audit fixes | First audited, buildable release |
