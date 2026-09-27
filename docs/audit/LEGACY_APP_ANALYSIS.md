# LEGACY `hr-system/` TREE ANALYSIS

> **Status: RETAINED — NOT DELETED.**
> The P0 brief explicitly forbids deleting `hr-system/`. This document records
> the evidence a future decision would need, so the decision is informed rather
> than deferred indefinitely.

**Analysis date**: 2026-09-26
**Path**: `hr-system/`
**Decision**: No deletion, no modification. Read-only inspection only.

---

## 1. Summary

`hr-system/` is an **older snapshot of the same application**. It is a strict
subset of the active `app/` tree: every route it contains also exists in the
active tree, and it lacks 15 routes that the active tree has. It shares nothing
that the active tree depends on.

| Property | Finding |
|----------|---------|
| Type | Duplicate/earlier copy of the same Next.js application |
| Files | 148 (all git-tracked) |
| Pages (`page.tsx`) | 23 |
| API routes (`route.ts`) | 10 |
| Referenced by the active app | **No** |
| Part of the build | **No** — `tsconfig.json` excludes it |
| Part of typecheck | **No** — excluded by tsconfig |
| Part of lint | **No** — added to ESLint `globalIgnores` in this phase |
| Contains unique functionality | **No** — 0 routes exist only here |
| Owns data | **No** — the active `DATABASE_URL` points to the Docker instance |
| Deleted | **No** |

---

## 2. Evidence

### 2.1 Not imported by the active application

A search across `app/`, `components/`, `lib/`, `scripts/` and `tests/` for any
reference to the `hr-system/` path returned **zero matches**.

```
Get-ChildItem app,components,lib,scripts,tests -Recurse -Include *.ts,*.tsx,*.js,*.json,*.mjs |
  ForEach-Object { if ((Get-Content $_ -Raw) -match 'hr-system/') { $_.FullName } }
# -> no output
```

The only two matches anywhere in the active project are:

| File | Line | Content | Effect |
|------|------|---------|--------|
| `tsconfig.json` | 33 | `"exclude": ["node_modules", "hr-system"]` | Excludes it from typecheck |
| `package.json` | 2 | `"name": "hr-system"` | The active package is *named after* the folder; unrelated to the tree |

No import, alias (`@/…`), webpack/Turbopack alias, or `next.config` path
mapping points into the directory.

### 2.2 Excluded from every quality gate

| Gate | Excluded by | Verified |
|------|-------------|----------|
| TypeScript | `tsconfig.json` → `exclude: ["hr-system"]` | Yes — `npx tsc --noEmit` reports 0 errors and does not traverse it |
| ESLint | `globalIgnores(["hr-system/**"])` added in `eslint.config.mjs` this phase | Yes — lint counts are application-only |
| Next.js build | Next.js only compiles `app/`, `components/`, `lib/` from the project root | Yes — the build route manifest contains no legacy route |
| Tests | `vitest.config.ts` → `include: ["tests/**/*.test.ts"]` | Yes |

### 2.3 Strict subset — no unique functionality

Route-by-route comparison of `page.tsx` files:

```
legacy pages: 23    current pages: 38

ONLY IN LEGACY (0):
  (none)

ONLY IN CURRENT (15):
  attendance\machine-integration
  attendance\shifts
  dashboard\settings\templates
  notifications
  payroll\loans
  payroll\loans\admin
  payroll\loans\apply
  payroll\loans\my-loans
  payroll\loans\types
  payroll\overtime
  recruitment
  requests
  settings\shifts
  staff-services
  visa
```

**Every route in the legacy tree also exists in the active tree.** There is no
page, API route, or component that exists only in `hr-system/`. The active tree
is a strict superset, having gained 15 routes (the loans module, shifts, visa,
recruitment, staff services, notifications and related pages).

### 2.4 Diverged schema

`prisma/schema.prisma` differs between the two trees. The active tree has 40
tables after this phase's additive migration; the legacy tree reflects an older
schema. Because the active `DATABASE_URL` targets the single Docker PostgreSQL
instance and nothing in the legacy tree is executed, the legacy schema file is
inert.

### 2.5 It carries deployment and credential-adjacent files

The legacy tree contains files that do not belong in a source snapshot:

| File | Concern |
|------|---------|
| `deploy.sh` | A deployment script |
| `Dockerfile` | A container build definition |
| `dev.db` | A **binary SQLite database file** checked into git |
| `___RESET_PROJECT_DATA.bat` | A data-deletion script |
| `___RUN_APP_CLICK_ME.bat` | The launcher that writes a placeholder `AUTH_SECRET` |
| `csrf_hash.txt` | A token artifact |
| `package.json` / `package-lock.json` | A second dependency manifest |

`dev.db` and `csrf_hash.txt` are the notable ones: they are **binary/token
artifacts committed to version control**, and `csrf_hash.txt` in particular
should not be in any repository. These deserve attention independently of
whether the tree is kept or removed.

---

## 3. Why it was NOT deleted

1. **Explicit instruction.** The P0 brief prohibits deleting `hr-system/`.
2. **Deletion is irreversible.** It removes 148 git-tracked files in one
   operation; the brief's safety rules require inspect → verify → change →
   validate, and destructive tree removal fails that bar without sign-off.
3. **Open questions remain.** The `dev.db` and `csrf_hash.txt` artifacts warrant
   a decision from the owner: are they backups, or are they stale secrets that
   should be rotated? Deleting the tree would destroy the evidence needed to
   answer that.
4. **The 15 missing routes prove the active tree is not a copy of the legacy
   tree** — the relationship runs one way only, so there is no migration
   concern, but equally no urgency.

---

## 4. Risk of Retaining

| Risk | Severity | Assessment |
|------|----------|------------|
| Confusion about which tree is canonical | LOW | Mitigated: all quality gates exclude it; active tree is a strict superset |
| Accidental import of legacy code | LOW | No import path resolves into it |
| Stale secrets in VCS (`csrf_hash.txt`) | MEDIUM | Needs owner decision, independent of deletion |
| Binary `dev.db` in VCS inflates the repository | LOW | No runtime effect |
| Schema drift misleads a future reader | LOW | Documented here |

**No security boundary depends on this directory.** The active application
cannot reach it, and it cannot reach the database.

---

## 5. Recommendation

**Retain for now**, excluded from all quality gates as it already is.

Recommended follow-up, requiring an explicit owner decision:

1. Determine whether `dev.db` holds any data not present in PostgreSQL.
2. **Rotate** any credential that `csrf_hash.txt` may correspond to.
3. Confirm no deployment process (`deploy.sh`, CI) references the directory.
4. Only then consider `git rm -r hr-system/` in a **separate, explicitly
   approved change** — not folded into a security patch.

---

## 6. Related

- `FIX_LOG.md` → `FIX-006` (lint exclusion of `hr-system/**`)
- `REMAINING_ISSUES.md` → `SEC-026` (stale token artifact in VCS)
- `UI-009` (duplicate application tree) — resolved by this document
