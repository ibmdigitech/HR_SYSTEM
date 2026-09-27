# P0 REMEDIATION PLAN

**Project**: IBMDIGITECH ENTERPRISE HRMS (`hr-system@0.1.0`, commit `34b6b60`)
**Plan date**: 2026-09-26
**Preceding work**: the 2026-09-26 P0 security phase (see `FIX_LOG.md`)
**Status of this plan**: implementation authorised; items marked ✅ were completed
in the preceding phase and are re-verified here, not re-implemented.

---

## 0. Baseline verification performed before any change

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS — 0 errors |
| `npm run build` | PASS — 48 routes |
| `npm test` | PASS — 85/85 |
| `npm run lint` | FAIL — 387 problems / 200 errors (12,244 before generated-code exclusion) |
| `node scripts/seed-standalone.js` | PASS — exit 0, idempotent |
| Database | 40 tables · 3 users · 3 employees · roles ADMIN, MANAGER, STAFF |
| `pg_hba.conf` remote rule | `scram-sha-256` |
| App DB role | `hr_app` (least privilege) |

### Repository-wide searches required by the brief

| Search | Result | Verdict |
|--------|--------|---------|
| `mongodb://` in **active runtime code** | **2 hits** | **DEFECT — must fix** |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` duplication | 2 hits: `auth.ts:25` (legitimate), `proxy.ts:29` (a comment) | Clean |
| `.env` tracked by git | No — `.gitignore:34` → `.env*` | Clean |
| `.env.example` exists | **No** | **DEFECT — must create** |
| Error boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx`) | **None exist** | **DEFECT — must create** |
| `loading.tsx` route segments | **None exist** | **DEFECT — must create** |
| Security headers in `next.config.ts` | **None** | **DEFECT — must add** |
| Rate limiting | **None** | **DEFECT — must add** |
| Validation library | Zod present at `app/lib/validation.ts` | Reuse, do not add a second library |

---

## 1. Findings, fixes, impact and risk

### ✅ Already remediated in the 2026-09-26 P0 phase

| Finding | Existing implementation | Root cause | Fix applied | Files | DB impact | Security impact | Regression risk |
|---------|------------------------|-----------|-------------|-------|-----------|-----------------|-----------------|
| **AUTH_SECRET invalid** | `___RUN_APP_CLICK_ME.bat` wrote `secret-key-generated-by-launcher`; every request failed `JWTSessionError` | Placeholder + no consistency | Real 32-byte secret in `.env`; launcher left untouched so the defect is not reintroduced | `.env` | None | Sessions now decryptable | Low |
| **DB config wrong** | MongoDB URI, no `DIRECT_URL`; Prisma schema is PostgreSQL | Launcher wrote wrong driver | PostgreSQL `DATABASE_URL` + `DIRECT_URL` | `.env` | None | Startup no longer fails | Low |
| **Seed crash** | `prisma.staffServiceType.findUnique(...)` — model does not exist | Wrong model name; schema has `ServiceCategory` | Repointed; block made idempotent; `npm run seed` added | `scripts/seed-standalone.js`, `package.json` | Created 13 categories, 19 configs | Reference data now present | Low |
| **RBAC-001** | Inline `["ADMIN","HR"].includes((session.user as any).role)` in ~20 files; `proxy.ts` matcher excluded `api` | No shared model; matcher typo | `lib/auth/` (6 modules); `/api` gate; 18 page guards; 4 API rewrites | `lib/auth/*`, `proxy.ts`, 18 pages, 4 routes | +1 additive `SecurityAuditLog` | Centralized, enforced, logged | **Medium** — 18 pages changed |
| **Attendance import** | Returned 200 on denial; no capability; no transaction; crashed on null `rollNumber` | Auth in callee, duplicated | Shared core + `attendance.import` capability + transaction | `lib/attendance/import.ts`, route, action | Transactional writes | Real 401/403, scope enforced | Medium |
| **Public seed endpoint** | Public `GET`; wrote placeholder password hash | No auth; dev convenience | 404 prod / 401 anon / 403 non-SUPER_ADMIN / 400 unconfirmed | `app/api/seed/route.ts` | None | Write endpoint closed | Low |
| **Privilege escalation** | `handleRoleRequest` wrote `User.role` with **no auth** | Inline server action, unguarded | `access.approve` + `validateRoleChange` + transaction + logging | 3 page files | None | Cannot self-escalate | Medium |

---

### 🔲 New work in this phase

| # | Finding | Existing implementation | Root cause | Proposed fix | Files affected | DB impact | Security impact | Regression risk |
|---|---------|------------------------|-----------|--------------|---------------|-----------|-----------------|-----------------|
| **N-1** | **`lib/prisma.ts` can silently switch to MongoDB** | `url: process.env.MONGODB_URI \|\| process.env.DATABASE_URL` | MongoDB legacy fallback never removed. `MONGODB_URI` is unset so it works today, but setting it would point a PostgreSQL schema at MongoDB at runtime | Remove the fallback; fail loudly if `DATABASE_URL` is absent | `lib/prisma.ts` | None | Removes a live config-drift hazard | **Very low** — one line, same behaviour when the var is unset |
| **N-2** | **`prisma.config.ts` references `MONGODB_URI`** | `url: process.env["MONGODB_URI"] \|\| ""` | Legacy | Point at `DATABASE_URL`; fail loudly | `prisma.config.ts` | None | Config consistency | Very low |
| **N-3** | **Obsolete MongoDB scripts** | `scripts/initiate.js`, `scripts/initiate-replica-set.js` connect to `mongodb://127.0.0.1:27017` | Left over from a MongoDB era | **Document, do not delete** (not in scope to remove) | — | None | None — not imported by any runtime path | None |
| **N-4** | **No `.env.example`** | Absent | Never created | Create with placeholders only; add `!.env.example` to `.gitignore` so `.env*` does not swallow it | `.env.example`, `.gitignore` | None | Prevents a real secret being committed | Very low |
| **N-5** | **No security headers** | `next.config.ts` has no `headers()` | Never configured | CSP (env-aware, nonce-free, dev-permissive), HSTS **production only**, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` | `next.config.ts` | None | Clickjacking, MIME sniffing, referrer leakage | **High** — a wrong CSP breaks Next.js/NextAuth/OAuth. Mitigated by dev/prod split + report-only verification |
| **N-6** | **No rate limiting on authentication** | `auth.ts` `authorize()` has no attempt counter | Never implemented | In-memory sliding window on the credentials callback: 5 attempts / 15 min per IP+email, with exponential backoff and a `SecurityAuditLog` entry. Documented as needing Redis for multi-instance production | `auth.ts`, `lib/auth/rate-limit.ts` | None | Blunt brute-force and credential stuffing | Low — additive, fails open only if explicitly configured |
| **N-7** | **No error boundaries** | No `error.tsx`, `global-error.tsx`, `not-found.tsx` | Never created | Three route-segment files with user-safe copy, a retry action, and no stack traces or secrets | `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` | None | Prevents raw error pages leaking internals | Very low — additive |
| **N-8** | **No route loading states** | No `loading.tsx` | Never created | Skeletons for the highest-latency routes; inline button states already exist for actions | 6 `loading.tsx` files | None | Perceived performance | Very low |
| **N-9** | **Employee form has no schema validation** | `upsertEmployee` checks 4 fields by hand | Never formalised | Zod schema in `app/lib/validation.ts` (reuse the existing file), enforced **server-side authoritatively**, with inline client feedback | `app/lib/validation.ts`, `app/lib/actions/employees.ts`, `app/employees/employee-list.tsx` | None | Blocks malformed and oversized input | Medium — touches the create/edit path |
| **N-10** | **Duplicate check is a read-then-write race** | `if (!existing) create()` | TOCTOU | Keep the pre-check for a good error message, but rely on the **existing unique constraints** and map Prisma `P2002` to a field-level message | `app/lib/actions/employees.ts` | Uses existing unique indexes | Prevents duplicate employees under concurrency | Low |
| **N-11** | **`Employee.userId` is nullable with no guaranteed FK** | `userId String? @unique` + `onDelete: NoAction` | Migrations were pushed with `db push`, so constraints were never reviewed | **Inspect for orphans first.** Only add a constraint if zero orphans exist. Otherwise document, do not force | `prisma/schema.prisma` | **Conditional** — no change if orphans exist | Strengthens the User↔Employee identity link | **High** — a bad constraint fails app writes. Mitigated by the orphan pre-check and a verified rollback |
| **N-12** | **Missing indexes on hot query columns** | Only `email`, `rollNumber`, `employeeCode` indexed | Never reviewed | Add indexes **justified by observed query patterns** in the audited actions/pages, with `EXPLAIN`-style reasoning recorded | `prisma/schema.prisma` | Additive indexes only | None (performance) | Low — additive, no data change |
| **N-13** | **Employee table unusable below 768px** | `<Table className="min-w-[800px]">` inside `overflow-x-auto` | Fixed minimum width | Card layout below 768px, full table at ≥768px. Same treatment for the two other wide tables | `app/employees/employee-list.tsx` | None | None (UX) | Medium — shared component, must verify desktop unchanged |
| **N-14** | **Authenticated users see the login form** | `app/login/page.tsx` renders inside the root layout, which also renders Header/Sidebar | No defensive redirect in the page itself | Client-side redirect on mount when a session exists. `proxy.ts` already redirects, but the page must not depend on that alone | `app/login/page.tsx` | None | Prevents a contradictory auth state | Low |
| **N-15** | **Dashboard sidebar depends on a DB query that can return null** | `app/layout.tsx` `userWithPhoto` | A user row without an `Employee` yields null, and the layout dereferences it | Guard the null case; render auth-only chrome when there is no employee record | `app/layout.tsx` | None | Prevents a render crash that looks like "sidebar missing" | Low |

---

## 2. Execution order (per the brief)

```
1. Inspect audit + code                                 ✅ done
2. Verify authentication/session                        ✅ verified
3. Fix database configuration                           🔲 N-1, N-2
4. Fix seed                                             ✅ done
5. Centralized RBAC                                      ✅ done
6. Protect APIs                                         ✅ done
7. Protect direct routes                                ✅ done
8. IDOR / security issues                               ✅ done
9. Rate limiting                                        🔲 N-6
10. Input validation                                    🔲 N-9, N-10
11. Security headers                                    🔲 N-5
12. User ↔ Employee relationship                        🔲 N-11 (conditional)
13. Review indexes                                      🔲 N-12
14. Sidebar / login-form auth rendering                 🔲 N-14, N-15
15. Employee mobile UI                                  🔲 N-13
16. Employee form                                       🔲 N-9 (client half)
17. Error boundaries / loading states                   🔲 N-7, N-8
18. Workflow verification                               🔲 after the above
19-22. typecheck / lint / build / tests                 🔲 final
23. Database integrity                                  🔲 final
24-25. Documentation                                    🔲 final
```

## 3. Database safety protocol

Applied to every schema change in this phase:

1. **Record** user/employee/table/role counts before.
2. **Inspect** for orphans and duplicates before adding a constraint.
3. **Change** additively only — no column dropped, no table dropped, no row deleted.
4. **Validate** with `prisma db push` and a full re-count.
5. **Test** that application writes still succeed.

`prisma migrate reset` is **not** run. The Docker volume is **not** removed.

## 4. What this phase will not do

- No UI redesign, no colour/typography/animation changes.
- No deletion of `hr-system/`, `scripts/initiate*.js`, or any existing module.
- No ORM or auth-library replacement.
- No edits to `prisma/generated/**`.
- No global ESLint or TypeScript weakening.
- No deletion of data to make a check pass.
