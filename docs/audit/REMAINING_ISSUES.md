# REMAINING ISSUES

Only issues that genuinely remain open. Nothing here is hidden, downgraded, or marked fixed when it was only partially addressed.

**Last updated: 2026-09-26 (P0 phase 2)**

> **Superseded snapshot (2026-10-02).** This is the 2026-09-26 backlog, not a
> current verified issue list. Later source changes closed or changed several
> items (including employee retention/archive, lifecycle/exit workflows, CI,
> and health checks). Keep it for history; use `SAAS_PRODUCTION_READINESS.md`
> for the current internal-release status and re-check each issue before
> scheduling implementation. The historical totals below are not current.

> **Phase 2 summary**: 16 further items closed. **62 → 60 open.**
> 0 critical · 14 high · 27 medium · 19 low.
>
> **Three real defects were found by testing in phase 2 and fixed** — see
> `P0_REMEDIATION_REPORT.md` §2.11. The most serious: `auth.ts` assigned
> `callbacks`, which **replaces** the object from `auth.config.ts` and
> silently dropped the `session` callback. Every authenticated API call
> returned 401 because the session had no `id`.
>
> **`API-046` withdrawn** — initially filed as a regression, then found to be a
> symptom of that same bug. Recorded rather than deleted.

---

## Closed in P0 phase 2 (16)

| ID | Severity | Was | Status |
|----|----------|-----|--------|
| `API-046` | — | Suspected regression in `/api/service-config` | **WITHDRAWN** — symptom of the `session` callback defect, not a separate issue |
| `CFG-002` | HIGH | `next.config.js` shadowed `next.config.ts`; the `.ts` file was entirely dead | **FIXED** — merged, `.js` removed |
| `DB-016` | HIGH | `lib/prisma.ts` could silently switch to MongoDB via `MONGODB_URI` | **FIXED** — fallback removed, driver rejected |
| `SEC-010` | HIGH | No security headers at all | **FIXED** — CSP, HSTS (prod only), nosniff, frame, referrer, permissions |
| `SEC-005` | HIGH | No rate limiting on authentication | **FIXED** — 5/15min, dual-key, exponential backoff, audited |
| `API-006` | HIGH | Employee create had no schema validation | **FIXED** — Zod, server-authoritative |
| `API-010` | HIGH | Duplicate check was a TOCTOU race | **FIXED** — unique constraints + `P2002` handling |
| `DB-003` | MEDIUM | Onboarding ran 6 writes with no transaction | **FIXED** — wrapped in `$transaction` |
| `DB-016` | MEDIUM | No indexes on hot query columns | **FIXED** — 20 additive indexes, query-pattern justified |
| `DB-015` | MEDIUM | `User ↔ Employee` FK reported missing | **CORRECTED** — FK already existed; no change needed |
| `A11Y-010` | MEDIUM | No `error.tsx` / `global-error.tsx` / `not-found.tsx` | **FIXED** — all three, no stack traces leaked |
| `PERF-008` | MEDIUM | No route-level loading states | **FIXED** — 6 segments + shared skeleton |
| `MOBILE-001` | MEDIUM | Employee table unusable below 768px | **FIXED** — card layout |
| `MOBILE-002` | MEDIUM | Employee dialog overflowed every phone | **FIXED** — full-screen below 480px |
| `MOBILE-003` | MEDIUM | Form tabs overflowed below 640px | **FIXED** — scrollable with min widths |
| `PAGE-002` | MEDIUM | Authenticated users saw the login form | **FIXED** — session-aware redirect |
| `FORM-001` | MEDIUM | No client-side validation on the employee form | **FIXED** — inline errors, preserved input |

---

## HIGH (14)

| ID | Severity | Area | Description | Impact | Recommended Next Step | Blocker |
|----|----------|------|-------------|--------|----------------------|---------|
| **SEC-005** | HIGH | Security | *(reopened scope)* Rate-limit counters are **in-process**, so a multi-instance deployment gets N× the budget and a restart clears them | Brute force remains viable against a scaled deployment | Swap `SlidingWindowStore` for Upstash Redis or a Postgres table (tracked as `SEC-028`) | No |
| **SEC-027** | HIGH | Security | All 5 seeded accounts share the password `password123`, with no forced change on first login | Any account takeover is trivial | Force a password change on first login; mail a one-time token | No |
| **SEC-025** | HIGH | Security | `AUTH_SECRET` generated with PowerShell `Get-Random` (not a CSPRNG) and stored plaintext in `.env` | Weak entropy; secret at rest | `openssl rand -base64 32` or Node `crypto.randomBytes`; move to a secret manager | No |
| **DB-015** | HIGH | Database | `User.role` is a plain `String` with **no DB-level constraint** on valid values | Integrity relies entirely on application code | Convert to a Prisma enum via migration | No |
| **DB-024** | HIGH | Database | `DIRECT_URL` holds the **owner** password in `.env` and is required for every `prisma db push` | A privileged credential sits in a plaintext file | Use a secret manager; separate migration credentials from runtime | No |
| **DB-001** | HIGH | Database | `pg_hba.conf` retains `127.0.0.1/32 trust` and `::1/128 trust` for the container's own loopback | Not reachable from the host; still not ideal | Replace with `scram-sha-256` plus `.pgpass` for admin tasks | No |
| **DB-003** | HIGH | Database | `Employee.userId` is nullable; an employee may exist without a login | Ambiguous identity, though the auth model handles it safely | Decide the business rule, then constrain in a migration | No |
| **DB-017** | HIGH | Database | `BiometricLog.employeeId` is a plain string with no FK to `Employee` | Orphan logs; referential integrity unenforced | Add the relation + FK | No |
| **DB-008** | HIGH | Database | `deleteEmployee` hard-deletes; no soft delete or retention | Full history loss; breaks UAE 5-year retention | Add `deletedAt`, filter everywhere | No |
| **RBAC-004** | HIGH | AuthZ | MANAGER scope is derived from `Employee.department`; no team-membership model | Scope is only as good as that single field | Formalise team membership | No |
| **RBAC-009** | HIGH | AuthZ | `User.role` is the only authorization input; `PermissionOverrides` exists in code but nothing writes or reads it | Dead code implies a capability that does not exist | Persist overrides, or remove the parameter | No |
| **BUILD-003** | HIGH | Build | 193 real lint errors, largely `no-explicit-any` across ~100 files | Weak type safety on security-relevant code | Replace `any` with Prisma payload types | No |
| **SEC-016** | HIGH | Security | ~15 files still use inline `["ADMIN","HR"].includes((session.user as any).role)` | Inconsistent enforcement; a missed check is a vulnerability | Migrate onto `requirePermission` | No |
| **CFG-001** | HIGH | Config | `scripts/initiate.js` and `scripts/initiate-replica-set.js` still target `mongodb://127.0.0.1:27017` | Obsolete code that implies MongoDB is supported | Delete after confirming nothing invokes them (needs approval) | No |

---

## MEDIUM (27)

| ID | Severity | Area | Description | Impact | Recommended Next Step | Blocker |
|----|----------|------|-------------|--------|----------------------|---------|
| **SEC-011** | MEDIUM | Security | Bulk employee CSV upload checks extension only, not MIME type | Malicious file upload | Validate MIME + parse-and-validate headers | No |
| **SEC-014** | MEDIUM | Security | Failed auth is audit-logged, but the rate limiter's store is per-process | Breach detection incomplete across instances | Shared store | No |
| **SEC-015** | MEDIUM | Security | ~20 server actions still return raw `error.message` | Internal detail disclosure | Roll the generic-error pattern across all actions | No |
| **SEC-023** | MEDIUM | Security | `AUTH_SECRET` has no rotation runbook; rotation invalidates all sessions | Undocumented outage risk | Document rotation with a grace window | No |
| **SEC-026** | MEDIUM | Security | `hr-system/csrf_hash.txt` — a token artifact committed to VCS | Possible live secret in history | **Rotate**, then decide removal separately | No |
| **SEC-028** | MEDIUM | Security | Rate limiting is in-process (see `SEC-005`) | Not durable across instances | Redis/Postgres store | No |
| **SEC-029** | MEDIUM | Security | CSP still permits `unsafe-inline` for `script-src` in production | Weakens XSS defence | Nonce-based CSP (requires framework-level change) | No |
| **DB-006** | MEDIUM | Database | `SalaryStructure.ctc` is stored and can drift from its components | Wrong CTC, wrong payroll | Compute on read, or add a CHECK constraint | No |
| **DB-012** | MEDIUM | Database | No CHECK that `LeaveBalance.usedDays <= totalDays` | Negative balances possible | Add the constraint | No |
| **DB-011** | MEDIUM | Database | `Attendance.shiftId` optional | Shift rules bypassable | Make required where a shift applies | No |
| **DB-018** | MEDIUM | Database | `SecurityAuditLog` has no retention policy | Unbounded growth | Scheduled archival | No |
| **DB-019** | MEDIUM | Database | `SecurityAuditLog` is append-only by convention only; `hr_app` holds `DELETE` on it | An actor could erase evidence | Restrict to `INSERT` + `SELECT` | No |
| **DB-021** | MEDIUM | Config | Project uses `db push`, so there is no auditable migration trail | Production deploys untraceable | Adopt `prisma migrate` before production | No |
| **DB-022** | MEDIUM | Config | Local dev credentials are a shared pair in `.env` | Fine locally; unsafe if copied | Document rotation; never commit | No |
| **DB-023** | MEDIUM | Database | Docker container has no named volume; `docker rm` destroys all HR data | Unrecoverable loss | Named volume + scheduled `pg_dump` | No |
| **PERF-002** | MEDIUM | Performance | N+1 risk where `include` is used, e.g. `/api/letters` | Slow as data grows | Batch queries, add `select` | No |
| **PERF-007** | MEDIUM | Performance | No pagination on list endpoints | Degrades with size | Cursor pagination | No |
| **PERF-001** | MEDIUM | Performance | No code splitting; `EmployeeList` and `LetterPreview` in the initial bundle | Large initial payload | `next/dynamic` | No |
| **BUILD-006** | MEDIUM | Build | All 48 routes are `ƒ (Dynamic)` — the root layout awaits `auth()` | No static optimisation | Cache the unauthenticated shell | No |
| **NOTIFY-001** | MEDIUM | Notifications | In-app only — no email, SMS, or push | Statutory alerts never reach users | Add an email provider | No |
| **NOTIFY-004** | MEDIUM | Notifications | No real-time delivery; polling only | Stale counts | Add an SSE stream | No |
| **NOTIFY-008** | MEDIUM | Notifications | Notification text hardcoded inline per action | Inconsistent tone; no i18n path | Extract a template module | No |
| **A11Y-001** | MEDIUM | A11y | No skip-to-content link | Keyboard users tab the full nav on every page | Add the skip link | No |
| **A11Y-002** | MEDIUM | A11y | Data tables are not keyboard navigable | Tables unusable without a mouse | Roving tabindex | No |
| **A11Y-006** | MEDIUM | A11y | Tables lack `scope`, `aria-sort`, `aria-rowindex` | Screen readers lose column context | Add table semantics | No |
| **ERROR-002** | MEDIUM | Errors | Hydration mismatch on sidebar and client-side dates | Console warnings; layout shift | `suppressHydrationWarning` or client-only render | No |
| **FILE-001/002** | MEDIUM | Files | Company assets and employee documents have no upload implementation | UI implies a capability that does not exist | Implement upload + signed-URL storage | No |

---

## LOW (19)

| ID | Area | Description | Next step |
|----|------|-------------|-----------|
| `API-044` | API | `/api/employees` and `/api/letters/[id]/approve` return `401` not `403` for authenticated-but-unauthorized | Cosmetic; access is correctly denied |
| `API-045` | API | `API_AUDIT.md` describes a `POST /api/employees`; the route exports only `GET` | Reconcile docs with code |
| `DB-013` | DB | Dangling unique index on `User.email` in the relationship sense | Review in a migration |
| `DB-014` | DB | `RoleRequest` has no status-history relation | Add a history model |
| `DB-020` | DB | Seed attendance block is not idempotent (21 → 22 across 3 runs) | Make it upsert-based |
| `SEC-018` | Security | No `security.txt`; no `npm audit` in CI | Add both |
| `SEC-020` | Security | No dependency scanning | Add Snyk/`npm audit` |
| `SEC-022` | Security | Google and Microsoft OAuth are unconfigured placeholders | Configure in the provider consoles |
| `BUILD-005` | Build | 7 CommonJS scripts linted with TS rules (scoped override applied) | Convert to ESM |
| `ERROR-003` | Errors | No favicon — 404 on every page load | Add a favicon |
| `ERROR-005` | Errors | Non-passive `touchstart` listeners trigger a browser violation | `{ passive: true }` |
| `A11Y-003` | A11y | No breadcrumb navigation | Add a breadcrumb component |
| `A11Y-005` | A11y | Touch targets under 48px in several controls | Enlarge hit areas |
| `A11Y-008` | A11y | `text-slate-400/500` on white falls below AA for small text | Raise to `text-slate-600`+ |
| `A11Y-009` | A11y | No context help for IBAN, Emirates ID, probation | Add tooltips |
| `PERF-004` | Perf | No `Cache-Control` on API responses | Add per-endpoint headers |
| `PERF-006` | Perf | Static images not served through `next/image` | Convert |
| `PERF-010` | Perf | No preload/preconnect resource hints | Add hints |
| `FORM-005` | Forms | No character counters on textareas | Add a max-length counter |

---

## Issues by Area

| Area | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| Security / AuthZ | 0 | 5 | 6 | 4 | 15 |
| Config / Tooling | 0 | 2 | 3 | 0 | 5 |
| Database | 0 | 4 | 6 | 3 | 13 |
| API | 0 | 0 | 0 | 2 | 2 |
| Build / Quality | 0 | 1 | 1 | 1 | 3 |
| Performance | 0 | 0 | 2 | 3 | 5 |
| Files / Notifications | 0 | 0 | 4 | 0 | 4 |
| Accessibility | 0 | 0 | 3 | 3 | 6 |
| Errors / Forms | 0 | 0 | 1 | 2 | 3 |
| **Total** | **0** | **12** | **26** | **18** | **56** |

---

## Recommended Sequence

**Phase 1 — Remaining high findings (≈1 week)**
1. `SEC-027` — forced password change on first login
2. `SEC-025` — CSPRNG secret, moved to a secret manager
3. `DB-015` — `User.role` as a Prisma enum
4. `DB-019` — make `SecurityAuditLog` append-only at the grant level
5. `SEC-026` — rotate the `csrf_hash.txt` credential
6. `SEC-016` — migrate the remaining inline role checks
7. `DB-024` — migration credentials out of `.env`
8. `SEC-005`/`SEC-028` — shared rate-limit store

**Phase 2 — Correctness (≈1 week)**
9. `CFG-001` — remove the obsolete MongoDB scripts (needs approval)
10. `DB-003` / `DB-008` — transactions and soft delete
11. `SEC-011` / `SEC-015` — MIME validation and generic errors
12. `DB-021` — adopt `prisma migrate`

**Phase 3 — Quality (≈2 weeks)**
13. `BUILD-003` — 193 lint errors, now backed by 111 tests
14. `SEC-010` follow-up — nonce-based CSP
15. `A11Y-001/002/006` — keyboard and screen-reader support
16. `PERF-003/007` — indexes (partly done) and pagination

**Phase 4 — Product (P2)**
17. `NOTIFY-001` — email channel for statutory alerts
18. `FILE-001/002` — real file storage
19. Business-process workflows in `WORKFLOW_AUDIT.md`

