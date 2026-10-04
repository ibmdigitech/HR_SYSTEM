# PRODUCTION READINESS CHECKLIST

**Date**: 2026-09-28
**Purpose**: one consolidated gate. Every item is a real finding with a pass/fail
criterion, not a best practice.

> **Superseded snapshot (2026-10-02).** This checklist records repository state
> observed on 2026-09-28 and is retained as historical evidence. Do not use its
> blocker count or individual statuses as the current release decision: the
> source now contains later fixes and workflows that this snapshot predates.
> The selected target is an internal single-company release; hosting is still
> undecided. See `SAAS_PRODUCTION_READINESS.md` for the refreshed scope and
> current deployment gates, and re-verify every checklist item against source
> before reopening it.

**How to read this**

| Status | Meaning |
|---|---|
| ✅ PASS | Verified, with the command or query that proved it |
| ⚠️ PARTIAL | Works, with a documented limitation |
| ❌ BLOCKER | Must be closed before deployment |
| 🚧 WIP | In progress |

**Current verdict: NOT READY FOR PRODUCTION.** 21 blockers, 5 high-impact.

> **Correction log.** An earlier draft of this document asserted two blockers
> that were false, because the claim was made from a grep of the action layer
> rather than from the mounted component tree:
> - *8.1* "no navigation below 1024px" — false. The drawer lives in `Header.tsx`.
> - *7.2* "offer → employee has no UI" — false. `CompleteJoining` is mounted on
>   the offer detail page.
>
> Both are corrected above. The lesson is recorded deliberately: **a workflow
> cannot be called unreachable without grepping for the component, not the
> action it calls.** Every remaining blocker in this document should be re-verified
> the same way before it is quoted to a stakeholder.
>
> **Correction log — second pass (mount-level re-verification).** Every item in
> this document that could have been asserted from the action layer alone was
> re-checked against the mounted tree: models, server actions, API routes **and**
> page components. Results:
>
> - *`8.7` "no lifecycle stage, outstanding fields, or visa status anywhere in
>   the UI"* — **two of the three claims are false.** Outstanding fields are
>   rendered (`app/employees/employee-list.tsx:1083-1099`) and visa status is
>   rendered (`app/employees/employee-list.tsx:812`, `app/visa/page.tsx:167`).
>   Only the lifecycle stage is genuinely absent. Corrected at `8.7`.
> - *`2.4` "an invalid role is written silently"* — **false through the
>   application.** The column is unconstrained, but the one user-facing write
>   path validates first (`app/dashboard/approvals/roles/page.tsx:66`). Downgraded
>   to ⚠️ PARTIAL; the residual gap is recorded precisely at `2.4`.
> - The exit-workflow blockers (`7.4`–`7.6`, `7.10`, `7.11`) were re-checked and
>   **survive** re-verification: zero models, zero actions, zero routes, zero
>   components. The `rehire` and `promotion` greps return **0 matches** in the
>   whole tree.
> - The header previously said "8 high" while the blocker list said "5
>   high-impact" and contained 6 security entries. The unreconcilable number is
>   replaced by the list's own count.
> - **Net effect on the count: 20 → 21.** This pass **added** one blocker
>   (`1.7`, two deployable apps) and **demoted** one (`2.4`). `5.6` was escalated
>   in severity but was already counted; `8.7` was corrected in wording and
>   remains a blocker on a narrower claim.
>
> **How to audit this document.** The numbered blocker list groups related gate
> rows, so "21 items" maps to **28 ❌ rows** across the ten gates. If you change
> a status, update all four of: the header verdict, the gate row, the numbered
> list, and the honest-assessment table.


---

## GATE 1 — Build and automated quality

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 1.1 | `tsc --noEmit` | ✅ PASS | 0 errors |
| 1.2 | `npm run build` | ✅ PASS | 53 routes, ~19s |
| 1.3 | `npm test` | ✅ PASS | 292 tests / 15 files (`npx vitest run`, 2026-09-28) |
| 1.4 | `npm run lint` | ⚠️ PARTIAL | ~190 problems. Errors are `no-explicit-any` in legacy code. **Not a deploy blocker**, but `--max-warnings` is not set in CI |
| 1.5 | CI pipeline | ❌ BLOCKER | **No CI exists.** Every gate above was run by hand. Nothing prevents a broken commit reaching `main` |
| 1.6 | Test coverage of DB writes | ⚠️ PARTIAL | State machines well covered; **no test asserts a server action rejects a forbidden transition end to end** |
| 1.7 | One declared deployable target | ❌ BLOCKER | **The repository contains two complete Next.js apps and no statement of which one ships.** `hr-system/` is a full second tree — its own `package.json`, `next.config.ts`, `Dockerfile`, `deploy.sh`, `auth.ts`, `auth.config.ts`, `proxy.ts` — that *builds and deploys* (`hr-system/deploy.sh:12,16,19` run `npm install`, `prisma generate`, `prisma db push`). It carries **none** of the P0 security work: `hr-system/auth.ts` is a 3456-byte stale copy of the 13073-byte root `auth.ts` and contains **0** occurrences of `rateLimit`/`checkRateLimit` (root `auth.ts` has 4). It also targets a **different database** — `hr-system/prisma/schema.prisma:7` is `provider = "sqlite"`, with a committed `hr-system/dev.db`, against the root app's PostgreSQL. And `tsconfig.json:33` excludes it (`"exclude": ["node_modules", "hr-system"]`), so it is **never typechecked** and can rot silently while still looking plausible. Anyone running `deploy.sh` deploys the wrong app to the wrong datastore. **Required: delete `hr-system/` or move it out of the repository, and record the deploy target in the README** |

## GATE 2 — Data integrity

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 2.1 | No destructive migration | ✅ PASS | `migrate reset` and `--accept-data-loss` never used |
| 2.2 | Record count preserved | ✅ PASS | 3 users / 3 employees / 2 leave requests, unchanged throughout |
| 2.3 | Employee state constraint | ✅ PASS | `Employee_active_requires_employment_data` validated; 6 tests |
| 2.4 | `User.role` is an enum | ⚠️ PARTIAL | *Re-verified; the stated harm was wrong, the missing constraint is real.* Still a plain `String` — `prisma/schema.prisma:24` — and `grep -c "^enum "` → **0** across 62 models. Read-only `pg_constraint` probe on the live database returns **only `User_pkey`**: no CHECK, so a writer outside the application (psql, a script, a future refactor) can store any string. **But an invalid role is not reachable through the application**: the single user-facing write, `app/dashboard/approvals/roles/page.tsx:113-116`, validates first via `validateRoleValue` (`:66`, implemented at `lib/auth/guards.ts:347`) and aborts; every other write is a hardcoded literal (`app/lib/actions/employees.ts:217`, `lib/workflow/joining.ts:172`, `app/lib/actions/bulk-upload.ts:82`, `app/api/seed/route.ts:167`). All 3 current users hold valid roles. **Residual:** a defence-in-depth gap, not a live vulnerability. **Remaining work: a `Role` enum or a `CHECK (role IN (...))`, which is a migration requiring review and was out of scope for this pass — it touches `prisma/schema.prisma`.** Now measurable via `userRoleConstraintPresent` in the diagnostics at `2.9` |
| 2.5 | Single employment-state field | ❌ BLOCKER | *Re-verified at the mount level. Still three fields, and the divergence is now measured rather than asserted.* `prisma/schema.prisma:536` `currentStatus`, `:537` `isActive`, `:578` `lifecycle`. The table's only CHECK, `Employee_active_requires_employment_data`, constrains `lifecycle` against **completeness** columns (`designation`, `department`, `joiningDate`, `rollNumber`) — never against `currentStatus` or `isActive`. Three reachable write paths create drift: `app/lib/actions/employees.ts:123` writes `currentStatus` alone (its allow-list, `:113-153`, contains neither `lifecycle` nor `isActive`), driven by the mounted select at `app/employees/employee-list.tsx:758-767`; `lib/workflow/offboarding.ts:144` writes `currentStatus="ON_LEAVE"`; `:256` writes `currentStatus="OFFBOARDED"`, a value the entry form's Zod enum would refuse. **No application path ever sets `isActive=false` for an employee** — and `isActive` is what selects the payroll run (`app/lib/actions/payroll.ts:65`), attendance, accrual and compliance. **Measured today: 0 divergent rows across 3 employees, 0 invalid roles** (`2.9`) |
| 2.6 | FK integrity on User↔Employee | ✅ PASS | `userId` unique, FK verified, orphans: 0 |
| 2.7 | Backup and restore | ❌ BLOCKER | **No backup exists.** A Docker container with no volume — `docker rm` destroys all HR data |
| 2.8 | Migration history | ⚠️ PARTIAL | Project uses `db push`, not `migrate`. Production deploys have **no auditable trail** |
| 2.9 | Employment-state divergence is measurable | ✅ PASS | *New this pass.* `GET /api/diagnostics/lifecycle` (`app/api/diagnostics/lifecycle/route.ts`) + `lib/workflow/lifecycle-consistency.ts`. Read-only: two `findMany` selects and one `pg_constraint` catalogue query, no write path in the module. Classifies each `Employee` row against 8 rules and each `User` against 2, and reports whether a CHECK on `User.role` exists. Gated on `system.audit.view` (ADMIN/SUPER_ADMIN only, `lib/auth/permissions.ts:250,272`) because the report crosses organisational scope. 29 tests in `tests/lifecycle-consistency.test.ts`. **Current measurement: 0 divergent employees, 0 invalid roles, `userRoleConstraintPresent: false`** — this is a baseline, not a fix |

## GATE 3 — Authentication and session

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 3.1 | No shared default password | ✅ PASS | `password123` authenticates 0 accounts; regression-locked by 7 tests |
| 3.2 | Forced password change | ✅ PASS | Sign-in refused while a change is outstanding |
| 3.3 | `AUTH_SECRET` from a CSPRNG | ❌ BLOCKER | Generated with PowerShell `Get-Random`, not a CSPRNG. Stored plaintext in `.env` |
| 3.4 | Rate limiting | ⚠️ PARTIAL | Works, but **in-process**: per-node, cleared by restart. See §3.5 |
| 3.5 | Rate limiting does not lock out admin | ❌ BLOCKER | **Observed live.** A DB outage locked `admin` for ~2 hours with no visible reason. Infra failure is counted as a credential guess |
| 3.6 | Account lockout persisted | ⚠️ PARTIAL | `UserSecurityFlag.failedLoginAttempts` / `lockedUntil` exist; **nothing writes them** |
| 3.7 | Session cookie flags | ✅ PASS | httpOnly, sameSite, secure in production |
| 3.8 | Session revocation | ⚠️ PARTIAL | `revokeAccess()` nulls the password, but **no UI reaches it** |
| 3.9 | OAuth providers configured | ❌ BLOCKER | Google and Microsoft are placeholders. Anyone relying on SSO cannot sign in |

## GATE 4 — Authorization

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 4.1 | Centralized permission resolver | ✅ PASS | `lib/auth/permissions.ts`, used by all guards |
| 4.2 | Role re-read from DB per request | ✅ PASS | A token issued before a demotion stops working |
| 4.3 | `/api/**` behind the session gate | ✅ PASS | Was excluded by the proxy matcher; fixed |
| 4.4 | Seed endpoint closed | ✅ PASS | 404 in production, 401 anon, 403 non-SUPER_ADMIN |
| 4.5 | No per-user permission grant | ❌ BLOCKER | *Re-verified.* No `Permission` or `RolePermission` model — the string `Permission` does not appear anywhere in `prisma/schema.prisma` (62 models, 0 enums). `PermissionOverrides` (`lib/auth/permissions.ts:290`) is an optional second parameter on `requirePermission`/`requireAnyPermission`/`requireAllPermissions` (`lib/auth/guards.ts:154,174,193`) and `canImportAttendance` (`lib/attendance/import.ts:202`); **all 50 call sites pass one argument**, and nothing persists overrides. Every user of a role has identical authority |
| 4.6 | Inline role checks consolidated | ⚠️ PARTIAL | ~15 files still use `["ADMIN","HR"].includes(role)` instead of the guard |
| 4.7 | Company / branch scope | ❌ BLOCKER | **No Department, Branch or organisation model.** `department` is free text. "Company" scope is inexpressible |
| 4.8 | Role self-escalation blocked | ✅ PASS | `validateRoleChange` refuses self-change and out-of-authority grants |
| 4.9 | Last SUPER_ADMIN protected | ✅ PASS | Refused when the count would reach zero |

## GATE 5 — Secrets and environment

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 5.1 | No secret in git | ✅ PASS | `.env` ignored; no credential committed |
| 5.2 | `.env.example` | ✅ PASS | Placeholders only |
| 5.3 | Launcher writes a valid `.env` | ✅ PASS | Copies the example; refuses on placeholder secret or MongoDB URL |
| 5.4 | `USER.role` validated | ❌ BLOCKER | Duplicate `User.role`/`Employee.email`/`rollNumber` with no integrity guarantee they match (`EE-09`) |
| 5.5 | Dev credentials rotated | ❌ BLOCKER | Known passwords are in this session's transcript. Must be rotated before any shared environment |
| 5.6 | `csrf_hash.txt` in the legacy tree | ❌ BLOCKER | *Escalated: there are TWO, not one.* `git ls-files` returns **both** `csrf_hash.txt` (repo root) and `hr-system/csrf_hash.txt` — 65 bytes each, last touched by commit `34b6b60` (2026-06-14). `git check-ignore` confirms **neither** is ignored, so the .gitignore rule does not exist. A CSRF secret committed to VCS, in a tree that `1.7` shows is separately deployable. **Rotate both tokens, then remove both from the working tree and git history** |

## GATE 6 — Data protection

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 6.1 | TLS in production | ⚠️ PARTIAL | HSTS configured; **no TLS termination configured** in this repo |
| 6.2 | Security headers | ✅ PASS | CSP, nosniff, frame, referrer, permissions — verified live |
| 6.3 | Employee data exposure | ✅ PASS | `/employees` requires `employees.view`; staff receives 302 |
| 6.4 | Salary data exposure | ✅ PASS | `payroll.export` / `payroll.view` enforced |
| 6.5 | Soft delete / retention | ❌ BLOCKER | *Read and confirmed.* `deleteEmployee` (`app/lib/actions/employees.ts:401-414`) is a single `await prisma.employee.delete({ where: { id } })` at `:408`, then `revalidatePath`. There is no soft-delete column, no tombstone, no retention window — `Employee` has no `deletedAt`/`archivedAt` field, and the function body matches none of those tokens. UAE law requires 5-year retention. Regression-locked by `tests/lifecycle-consistency.test.ts`, which will fail loudly if a soft delete is ever added, so this claim can never be made by accident |
| 6.6 | PII in logs | ✅ PASS | `redact()` covers password/token/secret/connection string; 9 tests |
| 6.7 | File uploads validated | ⚠️ PARTIAL | Attendance import validates size, extension, columns, per-row. **No MIME check**; company-document upload does not exist |

## GATE 7 — Workflow completeness

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 7.1 | Recruitment → offer | ✅ PASS | Gated, versioned, race-safe |
| 7.2 | Offer → Employee | ✅ PASS | Entry point at `app/recruitment/offers/[id]/page.tsx:154`, correctly gated on `status === "ACCEPTED"`. *(Corrected — an earlier draft wrongly called this a blocker.)* |
| 7.3 | Approvals show real pending work | ❌ BLOCKER | Reads a legacy status field; 2 pending leaves **invisible to HR**; 7 of 10 sources never queried |
| 7.4 | Resignation | ❌ BLOCKER | *Re-verified at all four layers — survives.* No `Resignation` model (`grep "^model Resignation" prisma/schema.prisma` → 0), no action, no `app/api` route, no page or component. The only occurrences of the word are permission names (`lib/auth/permissions.ts:119-121,238,255-257`) and a relieving-letter template default. `LIFECYCLE_TRANSITIONS` declares `RESIGNED` as a terminal stage (`lib/workflow/recruitment-machine.ts:402-404`) but **nothing writes it** |
| 7.5 | Termination | ❌ BLOCKER | *Re-verified at all four layers — survives.* No `Termination` model, no action, no route, no component. The transition map offers `TERMINATED` from `ACTIVE`/`PROBATION`/`CONFIRMED`/`ON_LEAVE`/`NOTICE_PERIOD` (`recruitment-machine.ts:375,380,385,393,400`) — no writer exists |
| 7.6 | Notice period | ❌ BLOCKER | *Re-verified at all four layers — survives, with a nuance.* No `NoticePeriod` model and no notice workflow. `NOTICE_PERIOD` exists only as a lifecycle stage and as an `OffboardingRequest` status written by `initiateOffboarding` (`lib/workflow/offboarding.ts:136-139`), which never advances `Employee.lifecycle` to `NOTICE_PERIOD` — the stage is unreachable |
| 7.6a | Exit interview | ❌ BLOCKER | *Re-verified — survives.* `exit.interview` appears only as the permission constant `PERMISSIONS.EXIT_INTERVIEW` (`lib/auth/permissions.ts:128`, granted to ADMIN at `:254`) and a comment (`lib/workflow/offboarding.ts:46`). No model, no action, no component. A permission with no capability behind it |
| 7.7 | Clearance | 🚧 WIP | Model + action exist; **no UI**. `updateChecklistItem` has no caller outside `lib/workflow/onboarding.ts:126` and the action wrapper `app/lib/actions/onboarding.ts:16` — grepped at the component level too: no page, route or component imports it |
| 7.8 | Final settlement | 🚧 WIP | Model + action exist; **no UI**. `prepareSettlement` and `advanceSettlement` appear only at their definitions (`lib/workflow/offboarding.ts:366`, `:473`); zero callers. No statutory calculation (correct — needs policy) |
| 7.9 | Exit / access revocation | 🚧 WIP | `revokeAccess()` is defined at `lib/workflow/credentials.ts:229` and **is** called — but only from `lib/workflow/offboarding.ts:230`, inside `advanceOffboarding(→COMPLETED)`. Its single caller is itself unreachable, so the chain ends at a dead end. No component invokes either |
| 7.10 | Rehire | ❌ BLOCKER | *Re-verified at all four layers.* `grep -i "rehire"` over `app/`, `components/`, `lib/`, `prisma/`, `scripts/`, `tests/` returns **0 matches**. No model, no action, no route, no component. A returning employee would duplicate |
| 7.11 | Transfer / promotion | ❌ BLOCKER | *Re-verified at all four layers.* `grep -i "promotion"` returns **0 matches**; there is no `Transfer`/`Promotion` model and no route or component under `app/`. Every occurrence of "termination" in the tree is a **permission name** (`lib/auth/permissions.ts:122-124,239,258-260`), a relieving-letter **template** default (`app/letters/relieving/page-client.tsx:26-27,213`) or a status badge colour (`app/employees/employee-list.tsx:949-950`) — none is a workflow. A change would overwrite history |
| 7.12 | Probation | 🚧 WIP | `ProbationReview` created at joining, never reviewed |
| 7.13 | Visa expiry reminders | 🚧 WIP | `scanExpiringDocuments()` exists, **never called** |
| 7.14 | Offer "sent" delivers | ❌ BLOCKER | Sets a status. **No email, no portal.** An offer is "sent" by assumption |

## GATE 8 — User experience

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 8.1 | Mobile navigation | ✅ PASS | `components/layout/Header.tsx:78-147` — a `lg:hidden` hamburger opening a Dialog drawer with the full permission-filtered nav, closing on link click. *(Corrected — an earlier draft wrongly claimed navigation was absent below 1024px.)* |
| 8.2 | Responsive data tables | ⚠️ PARTIAL | Employee list has a mobile card view; attendance, payroll, loans, letters do not |
| 8.3 | Horizontal overflow | ✅ PASS | Root cause (missing `min-w-0`) fixed |
| 8.4 | Oversized heroes | 🚧 WIP | 5 pages still on the old `text-6xl` banner; `PageHero` ready |
| 8.5 | Error / empty states | ⚠️ PARTIAL | 404, 500 and error boundaries exist; several pages have none |
| 8.6 | Loading states | ⚠️ PARTIAL | 6 routes have `loading.tsx`; ~30 do not |
| 8.7 | Lifecycle stage visible in the UI | ❌ BLOCKER | *Corrected — two of this item's three original claims were false.* **Outstanding fields ARE shown**: `app/employees/employee-list.tsx:1083-1099` renders a "Provisional · N outstanding" badge with the missing field names on hover, driven by `outstandingProvisionalFields` (`app/lib/validation.ts:259`). **Visa status IS shown**: `app/employees/employee-list.tsx:812-818`, `app/visa/page.tsx:167` (`getDocumentStatus(record.visaExpiry)`), `app/dashboard/page.tsx:53`. What is genuinely absent is the **lifecycle stage**: the only occurrence of the string `lifecycle` in `app/` components is a marketing sentence (`app/employees/employee-list.tsx:418`). Worse, the badge the UI *does* show is `employee.currentStatus` (`employee-list.tsx:1085`) — the field this document already identifies at `2.5` as **not** the authoritative one. The application displays the wrong one of the three |
| 8.8 | Employee detail route | ⚠️ PARTIAL | *New this pass — a prior audit's claim was correct and is now confirmed at the mount level.* There is **no `app/employees/[id]` page and no `app/api/employees/[id]` route**. A glob of every dynamic segment under `app/**` returns exactly five: `recruitment/offers/[id]`, `recruitment/interviews/[id]`, `api/auth/[...nextauth]`, `api/letters/[id]/approve`, `activate/[token]`. `app/employees/` holds only `page.tsx`, `employee-list.tsx`, `onboarding-panel.tsx`, `FormProgress.tsx`, `loading.tsx`; `app/api/employees/` holds only `route.ts`. Every record-level surface is therefore reachable only through the list dialog. This is a usability gap, **not** an additional blocker — it is recorded here because it is the structural reason `8.7` cannot be fixed cheaply |

## GATE 9 — Operations

| # | Item | Status | Evidence / what's required |
|---|------|--------|---------------------------|
| 9.1 | Seed is idempotent | ✅ PASS | Runs twice cleanly; verified |
| 9.2 | Health check | ❌ BLOCKER | **None.** A container that cannot reach the database reports healthy |
| 9.3 | Structured logging | ⚠️ PARTIAL | `console.*` in production paths; no log aggregation |
| 9.4 | Error monitoring | ❌ BLOCKER | **No Sentry or equivalent.** A production error is invisible until a user reports it |
| 9.5 | Uptime monitoring | ❌ BLOCKER | None |
| 9.6 | Audit log retention | ⚠️ PARTIAL | `SecurityAuditLog` grows unbounded; no pruning |
| 9.7 | Database role separation | ✅ PASS | `hr_app` runtime, `postgres` migrations |

## GATE 10 — Compliance and legal

| # | Item | Status | Note |
|---|------|--------|------|
| 10.1 | Data-processing consent | ⚠️ PARTIAL | Recorded on `Candidate`. **No consent for employees**, no retention policy |
| 10.2 | Employee record retention | ❌ BLOCKER | Hard delete; UAE requires 5 years |
| 10.3 | WPS / payroll compliance | ❌ BLOCKER | Implementation exists with **placeholder employer ID and bank code**. Not deployable |
| 10.4 | End-of-service calculation | ⚠️ PARTIAL | Framework built, **arithmetic deliberately absent** — needs jurisdiction and policy |
| 10.5 | Right to access / correction | ⚠️ PARTIAL | Employee self-service portal does not exist |
| 10.6 | Jurisdiction-specific HR rules | ❌ BLOCKER | Probation, notice period, gratuity all hardcoded or absent. **Needs company policy input** |

---

## Blockers — 5 high-impact, 21 items total

**Security**
1. `AUTH_SECRET` not from a CSPRNG, stored plaintext (`5.3`)
2. Rate limiting locks out admins on infrastructure failure (`3.5`)
3. No per-user permission grant (`4.5`)
4. No company/branch scope — no Department model (`4.7`)
5. Known dev credentials in transcript; rotate (`5.5`)
6. `csrf_hash.txt` token committed to VCS — **two of them, root and legacy** (`5.6`)

**Data integrity**
8. Three conflicting employment-state fields (`2.5`) — *now measured: 0 divergent rows today, 3 reachable write paths that will create them*
9. **No backup** — a container with no volume (`2.7`)
10. **Hard delete** of employee records, 5-year retention required (`6.5`)

> *Demoted this pass.* `User.role` is a plain `String` (`2.4`) is no longer counted
> as a blocker: the column is unconstrained, but no application path can write an
> invalid value. It is tracked as ⚠️ PARTIAL at `2.4` with the residual gap stated.

**Workflow — the app cannot complete an exit journey**
11. Approvals show zero for real pending work (`7.3`)
12. Resignation, termination, notice, exit interview absent (`7.4`–`7.6`, `7.6a`)
13. Rehire absent (`7.10`)
14. Transfer / promotion absent (`7.11`)
15. Offer "sent" delivers nothing (`7.14`)

**Product**
16. Lifecycle stage not visible in the UI — the UI shows the non-authoritative field (`8.7`)

**Operations**
17. No CI (`1.5`)
18. No health check, no error monitoring, no uptime monitoring (`9.2`, `9.4`, `9.5`)
19. OAuth unconfigured (`3.9`)
20. WPS not deployable (`10.3`)
21. **Two deployable apps, no declared target** — `hr-system/` builds, deploys and uses a different database (`1.7`)

---

## Minimum to deploy an internal pilot

If the goal is **internal use with HR staff only**, not public deployment:

| # | Must do | Why |
|---|----------|-----|
| 1 | Delete `hr-system/` or move it out of the repo, and state the deploy target | A second app builds, deploys and uses a different database (`1.7`) |
| 2 | Rotate all dev credentials | They are in this transcript |
| 3 | Remove **both** `csrf_hash.txt` files, rotate the tokens | Two live artifacts in VCS (`5.6`) |
| 4 | Add a named-volume + nightly `pg_dump` | One `docker rm` loses everything |
| 5 | Configure real `AUTH_SECRET` (CSPRNG) | Currently predictable-strength |
| 6 | Stop counting DB failures as login failures | Locks out admins on outage |
| 7 | Add a health check | Silent failures otherwise |
| 8 | Show the **lifecycle stage** on the employee list, not `currentStatus` | Staff see the wrong one of three state fields (`8.7`) |
| 9 | Wire `GET /api/diagnostics/lifecycle` into monitoring | Drift between the three state fields is measurable at 0 today and will not stay there (`2.9`) |

## Minimum to deploy publicly

Everything in GATE 1, plus **all 21 blockers**. Items 11–15 (the missing exit
workflows) are not optional for a public HR product: an employee who resigns
cannot be processed, and their access is never revoked.

---

## Tests required before deployment

**Not yet written — these are the gaps.**

| Area | Required test | Why |
|---|---|---|
| Auth | Forced change blocks sign-in; lockout clears on success; DB outage does not count as a failure | `3.2`, `3.5` — *now written, `tests/auth-lockout.test.ts`* |
| Auth | Session invalidated when the role changes | Proves the DB re-read |
| RBAC | Each permission denied to the 3 nearest roles | `4.5` |
| Lifecycle | Illegal transition refused **by the database**, not the UI | `2.5` |
| Lifecycle | **The three state fields are compared against each other on every run** | `2.5`, `2.9` — *now written, `tests/lifecycle-consistency.test.ts` (29 tests, live-DB baseline)* |
| Approvals | A pending manager-stage leave **appears** for HR | `7.3` — the live bug |
| Approvals | FINANCE sees a queue, not a blank page | `7.3` |
| Joining | Employee created once; second attempt refused | `7.2` |
| Exit | Resignation → notice → clearance → settlement, end to end | `7.4`–`7.8` |
| Exit | Access revoked on completion; history retained | `9`, `6.5` |
| Data | Backup restores to a working state | `2.7` — untestable otherwise |
| Retention | Employee record recoverable, not destroyed | `6.5` — *the current test asserts the opposite, deliberately, so the blocker cannot be forgotten* |
| IDOR | Employee A cannot read employee B's payroll, letters, documents | Already true; needs a test |
| Consent | Application refused without consent | Already implemented; needs a test |

> **Fragile test to fix before CI lands.** `tests/sec-027-regression.test.ts:87-91`
> asserts a **literal source string** — `expect(source).toMatch(/mustChangePassword\(user\.id\)/)`
> against the text of `auth.ts`. It is a source-shape assertion, not a behavioural
> one, and it will fail on any refactor of that file that preserves behaviour.
> Rewrite it to call the function.

---

## Honest assessment

| | |
|---|---|
| **Security posture** | Genuinely improved. No shared default, no public write endpoints, centralized RBAC, real session invalidation. **Newly found:** the repository also ships a second, unreviewed app tree that is not typechecked (`1.7`) |
| **Core HR functions** | Sound — attendance, leave, payroll, letters, requests all work and are tested |
| **Employee lifecycle** | **Incomplete.** Recruitment works to "offer accepted", then stops. Exit does not exist |
| **Production readiness** | **Not ready.** 21 blockers, 3 of which lose data or lock out admins. Up 1 from the last revision: `1.7` added, `2.4` demoted |
| **Biggest risk** | Someone resigns and there is no way to process it, no way to revoke access, and no record |
| **What this pass changed** | 6 blockers re-verified at the mount level; **4 confirmed, 2 corrected** (`2.4` downgraded, `8.7` partly refuted). `5.6` escalated. Blocker 2.5 is no longer theoretical — it has a live measurement of **0** and a regression test that fails if that changes |

The gap is not quality — it is **completeness of the lifecycle**, plus the
operational basics (backup, CI, monitoring) that no audit substitutes for.
