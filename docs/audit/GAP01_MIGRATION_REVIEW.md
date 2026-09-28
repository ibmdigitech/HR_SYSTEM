# GAP-01 MIGRATION — REVIEW PACKAGE

**Status**: **PREPARED, NOT APPLIED**
**Date**: 2026-09-28
**File**: `prisma/migrations/20260928_make_employee_entry_staged/migration.sql`

Nothing has been executed. No column was altered, no row was written, no schema
was changed. The Prisma schema file is also unchanged — see §5.

---

## 1. What it does

Relaxes four `NOT NULL` constraints on `Employee` so a partial record can be
created, then **restores a stronger guarantee** than the one it replaces:

```sql
CHECK (
    "lifecycle" NOT IN ('ACTIVE','CONFIRMED','PROBATION')
    OR ( "designation" IS NOT NULL
      AND "department"  IS NOT NULL
      AND "joiningDate" IS NOT NULL
      AND "rollNumber"  IS NOT NULL )
)
```

An employee may be incomplete **only while they are not yet working**. The
instant it becomes `ACTIVE`, `CONFIRMED` or `PROBATION`, the full set is required
again — enforced by PostgreSQL, not by a form.

This is the important design decision: a bare `DROP NOT NULL` would have
allowed a half-entered record to be treated as a working employee. That is the
data-integrity failure this project exists to prevent, so the migration
substitutes a better rule rather than removing the rule.

`lifecycle` becomes `NOT NULL` and is backfilled from `currentStatus`, so it
starts carrying meaning instead of being written twice and read nowhere
(`GAP-06`).

---

## 2. Safety properties

| Property | How |
|---|---|
| Cannot corrupt existing employees | Pre-flight `DO` block aborts if any `ACTIVE`/`CONFIRMED`/`PROBATION` row already has a NULL in those fields |
| Cannot silently alter data | The CHECK is added `NOT VALID`, then explicitly `VALIDATE`d — so PostgreSQL verifies every row before the migration completes |
| No data loss | The file contains no `UPDATE` other than the `lifecycle` backfill, no `DELETE`, no `DROP TABLE` |
| Reversible | ROLLBACK block provided; it is pure constraint work and cannot lose data |
| Transactional | Whole migration runs inside `BEGIN`/`COMMIT` |

Expected pre-flight output on the current database:

```
NOTICE:  Pre-flight passed: every active employee has designation, department and joiningDate.
```

---

## 3. ⚠️ Four breakages this migration WILL cause

**This is the reason it must not be applied on its own.** Relaxing these
columns exposes code that assumes they are always present.

### BREAK-1 — `app/api/letters/route.ts:107` — silent 1970 date in a legal document

```js
'employee.joiningDate': new Date(employee.joiningDate).toLocaleDateString(),
```

`new Date(null)` does not throw — it returns **1 Jan 1970**. A salary
certificate for a provisional employee would read *"has been employed since
01/01/1970"*. This is the most dangerous item: it produces a plausible-looking
but false legal document with no error anywhere.

**Fix**: guard before formatting —
```js
employee.joiningDate
  ? new Date(employee.joiningDate).toLocaleDateString()
  : "— pending —"
```

### BREAK-2 — `app/payroll/loans/apply/page.tsx:26-28` — **page crash**

```js
const joinDate = user.employee.joiningDate;
const monthsSinceJoin = (today.getFullYear() - joinDate.getFullYear()) * 12 + ...
```

`null.getFullYear()` throws `TypeError`. Any `PRE_JOINING` employee opening the
loan page gets a hard 500.

**Fix**: `const joinDate = user.employee.joiningDate ?? today;` plus a notice
that probation tenure is unavailable for a provisional employee.

### BREAK-3 — `app/settings/page.tsx:151` — false tenure

```js
{ label: "Tenure Start", value: new Date(emp.joiningDate).toLocaleDateString(...) }
```

A provisional employee shows **"Jan 1970"** — 56 years of tenure.

**Fix**: same null guard as BREAK-1.

### BREAK-4 — `app/staff-services/page.tsx:212` — false tenure

```jsx
{new Date(emp.joiningDate).toLocaleDateString()}
```

Same 1970 result.

**Fix**: same null guard.

### Not a breakage, but worth knowing

19 files read `designation` and 19 read `department`. These are all display
contexts where React renders `null` as nothing, so they are safe. The four above
are the only ones that **compute** with the value.

---

## 4. Order of work if approved

1. Fix BREAK-1 … BREAK-4 (four small null guards)
2. Apply the migration
3. Remove the guard in `employeeSchemaProvisional` that currently lets a
   missing `joiningDate` through the validation layer — it is correct once the
   column is nullable
4. Confirm `completeJoining` moves `lifecycle` `PRE_JOINING → PROBATION`
5. Verify the CHECK holds by attempting to activate an incomplete employee

Step 5 is the real test: the migration is only doing its job if the database
**refuses** to activate a half-entered record.

---

## 5. Why `prisma/schema.prisma` is unchanged

Editing the schema to `String?` **before** the migration runs would let
`prisma db push` apply the same relaxation without the compensating CHECK, and
without the pre-flight guard. That path gives up the integrity guarantee this
migration is specifically designed to keep.

So the schema stays as-is until the SQL has been reviewed and run. After it has
been applied, the four fields in `schema.prisma` should be changed to
`designation String?`, `department String?`, `joiningDate DateTime?`,
`userId String?` and `lifecycle String @default("PRE_JOINING")` so the two stay
in agreement. Prisma has no way to express the CHECK constraint, which is why it
lives in SQL only — a comment in the schema should point here.

---

## 6. Decision needed

| Question | Recommendation |
|---|---|
| Relax NOT NULL, or require full entry? | Relax — it is the stated business requirement |
| Keep a compensating CHECK? | **Yes** — otherwise the relaxation is a straight integrity loss |
| Should `userId` become nullable too? | Yes — an account is provisioned at entry, but a pre-onboarding hire legitimately has none yet |
| Apply now? | No — fix BREAK-1…4 first |

---

## 7. Verification I can and cannot do

**Verified:** current column nullability (`userId NO`, `designation NO`,
`department NO`, `joiningDate NO`, `lifecycle YES`), and the pre-flight
condition passes against current data.

**Not verified:** the migration has not been executed, so the `VALIDATE` step
and the CHECK constraint have not been proven against a live database. Applying
it in a transaction and rolling back is the way to prove that before committing.
