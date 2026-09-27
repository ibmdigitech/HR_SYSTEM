# LINT CLASSIFICATION

> Produced by `node scripts/lint-classify.cjs`, which parses the ESLint stylish
> report and attributes every problem to a category and a rule. Reproduce with:
>
> ```bash
> npm run lint 2>&1 | Out-File lint-full.txt -Encoding utf8
> node scripts/lint-classify.cjs lint-full.txt
> ```

**Date**: 2026-09-26
**Baseline**: 396 problems (196 errors, 200 warnings)

---

## Totals

| | Count |
|---|---|
| **Total problems** | **373** |
| **Errors** | **180** |
| **Warnings** | **193** |

> The baseline of 396 predates the service-request fix. The current run is 373
> because 23 problems were resolved as part of that work.

---

## By category

| Category | Errors | Warnings | Total |
|----------|--------|----------|-------|
| **A. Generated code** (`prisma/generated/**`) | 0 | 0 | **0** |
| **C. Auth / RBAC** (`lib/auth/**`, `auth.ts`, `auth.config.ts`, `proxy.ts`) | 4 | 1 | **5** |
| **D. Database / Seed** (`prisma/**`, `scripts/**`) | 0 | 0 | **0** |
| **E. Workflow modules** (`lib/workflow/**`) | 0 | 2 | **2** |
| **F. Tests** (`tests/**`) | 2 | 3 | **5** |
| **B. Application source** (`app/**`, `components/**`, `lib/**`) | 174 | 186 | **360** |
| **G. Config / Other** | 0 | 1 | **1** |

### Category A — Generated code: clean

`prisma/generated/**` is excluded via `globalIgnores` in `eslint.config.mjs`
(fixed as `BUILD-002`). It contributes **zero** problems. No generated file was
edited to achieve this, and none needs to be.

---

## Top 10 rules by error count

| # | Count | Rule | Files | Nature |
|---|-------|------|-------|--------|
| 1 | 160 | `@typescript-eslint/no-explicit-any` | 61 | Type-safety debt, concentrated in `any` annotations |
| 2 | 8 | `react/no-unescaped-entities` | 7 | Correctness — bare `'`/`"` in JSX text |
| 3 | 6 | `prefer-const` | 3 | Correctness — `let` never reassigned |
| 4 | 2 | `@typescript-eslint/ban-ts-comment` | 1 | Suppression comments |
| 5 | 2 | `@typescript-eslint/no-empty-object-type` | 2 | `{}` used as a type |
| 6 | 1 | `@next/next/no-assign-module-variable` | 1 | **Correctness** — `module` reassigned |
| 7 | 1 | `@next/next/no-html-link-for-pages` | 1 | **Correctness** — internal link via `<a>` |

## Top 10 rules by warning count

| # | Count | Rule | Files | Nature |
|---|-------|------|-------|--------|
| 1 | 187 | `@typescript-eslint/no-unused-vars` | 62 | Dead code — unused imports and locals |
| 2 | 5 | `@next/next/no-img-element` | 2 | Perf/a11y — should use `next/image` |
| 3 | 1 | `react-hooks/exhaustive-deps` | 1 | **Potential correctness** — stale closure risk |

### Genuine correctness issues hiding in the noise

Four of these are real defects, not style:

- `@next/next/no-assign-module-variable` — reassigning `module` breaks
  server-action registration.
- `@next/next/no-html-link-for-pages` — an internal link that does a full page
  reload instead of a client transition.
- `react-hooks/exhaustive-deps` — a stale-closure risk.
- `react/no-unescaped-entities` (8) — JSX text containing bare quotes, which
  renders incorrectly.

---

## Highest-error files

| Errors | Warnings | File | Note |
|--------|----------|------|------|
| 11 | 9 | `app/staff-services/page.tsx` | Unused imports dominate |
| 10 | 1 | `app/lib/actions/shifts.ts` | Unused imports + `any` |
| 7 | 13 | `app/employees/employee-list.tsx` | `any` + unused |
| 7 | 1 | `app/lib/actions/payroll.ts` | **Server action — security relevant** |
| 7 | 3 | `app/payroll/loans/my-loans/page.tsx` | |
| 7 | 5 | `app/payroll/loans/page.tsx` | |
| 6 | 1 | `app/lib/utils/payslip-generator.ts` | |
| 5 | 2 | `app/attendance/shifts/page.tsx` | |
| 5 | 2 | `app/lib/actions/letter-templates.ts` | **Server action** |
| 5 | 6 | `app/requests/request-client.tsx` | |

---

## Remediation approach

The brief requires **0 application lint errors** achieved by fixing code, not by
weakening configuration. No rule is disabled globally and no
`eslint-disable` comment is added to hide a real defect.

Two of the 180 errors are in `tests/**` and four in `lib/auth/**`; these are
fixed first, since they are the most security-sensitive.

`@typescript-eslint/no-explicit-any` (160) is the dominant cost. These are
**not** suppressed — each `any` is replaced with a real type, or the
annotation is removed where the inferred type is already correct. Where a
genuinely dynamic value exists, a narrow, documented type or `unknown` with a
type guard is used instead of `any`.
