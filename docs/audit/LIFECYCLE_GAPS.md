# LIFECYCLE GAPS

**Date**: 2026-09-28 · Read-only audit. Nothing in this document has been implemented.

Priority: **CRITICAL** blocks the stated business requirement · **HIGH** blocks a
lifecycle stage or weakens a security property · **MEDIUM** degrades a
workflow · **LOW** hygiene.

---

## CRITICAL

### GAP-01 — Staged employee entry is impossible

- **Area**: Employee Entry
- **Current**: `Employee.designation`, `.department`, `.joiningDate` and `.userId`
  are NOT NULL. A record cannot be created before the visa is processed.
- **Expected**: Create on offer, complete after visa processing.
- **Evidence**: Read-only insert probe — missing `joiningDate` → REJECTED;
  missing `userId` → REJECTED. Both rolled back.
- **Files**: `prisma/schema.prisma` (model `Employee`)
- **Models**: `Employee`
- **Security**: none
- **Data**: blocks hires; encourages placeholder data that later looks real
- **Workflow**: Employee Entry, Visa, Joining
- **Fix**: make `designation`, `department`, `joiningDate` and `userId` nullable;
  add a non-null `lifecycle` guarantee instead
- **Depends on**: nothing — this is the first thing to change

### GAP-02 — Staged-entry UI ships a capability the schema forbids

- **Area**: Employee Entry
- **Current**: `employeeSchemaProvisional` marks the three fields optional, the
  checkbox appears, the progress bar advances, the badge renders — then Prisma
  rejects the write.
- **Expected**: Either work, or not offered.
- **Evidence**: validation ACCEPTED + database REJECTED on the same input
- **Files**: `app/lib/validation.ts`, `app/lib/actions/employees.ts`,
  `app/employees/employee-list.tsx`
- **Security**: none
- **Data**: silent user-facing failure at the last step
- **Workflow**: Employee Entry
- **Fix**: resolve GAP-01 first; then this resolves itself. Until then the
  checkbox should be removed to stop promising something the DB refuses
- **Depends on**: GAP-01

---

## HIGH

### GAP-03 — Approvals reads a legacy status field

- **Area**: Approvals
- **Current**: The dashboard filters `managerStatus`/`hrStatus`; the
  authoritative field is `status`. Two pending leaves are invisible to HR.
- **Expected**: One status, read by every consumer.
- **Evidence**: 2 rows at `PENDING_MANAGER`; HR branch wants `APPROVED`+`PENDING`
- **Files**: `app/dashboard/approvals/page.tsx`, `lib/workflow/leave.ts`
- **Models**: `LeaveRequest`
- **Security**: approvals bypassed by data shape
- **Data**: pending work invisible
- **Workflow**: Leave
- **Fix**: migrate the page to `status`, then drop the legacy columns
- **Depends on**: nothing

### GAP-04 — 7 of 10 approval sources are never queried

- **Current**: Only Leave, ServiceRequest, VisaRequest are read. RoleRequest,
  OfferLetter, LoanApplication, SalaryAdvanceRequest, OffboardingRequest,
  JoiningRecord, ProbationReview are not.
- **Evidence**: query inspection + a `SHORTLISTED` Application visible nowhere
- **Files**: `app/dashboard/approvals/page.tsx`
- **Models**: all listed
- **Workflow**: every approval-driven flow
- **Fix**: one aggregation service; retire the bespoke page queries
- **Depends on**: GAP-03

### GAP-05 — No resignation, termination, notice or rehire

- **Current**: No model, no action, no UI. `LIFECYCLE_TRANSITIONS` defines
  `NOTICE_PERIOD → EXITED` but nothing writes those values.
- **Evidence**: `grep` for Promotion/Transfer/Rehire/Resignation/Termination
  models → all MISSING; "rehire" → 0 occurrences
- **Models**: MISSING
- **Workflow**: exit side entirely
- **Fix**: Resignation → notice → clearance → settlement → exit, reusing the
  offboarding models that already exist
- **Depends on**: GAP-06 (lifecycle must be authoritative first)

### GAP-06 — Three conflicting employment-state fields

- **Current**: `currentStatus` (String), `isActive` (Boolean), `lifecycle`
  (String?). Nothing enforces agreement; `lifecycle` is written twice and read
  nowhere.
- **Evidence**: schema inspection; `lifecycle` referenced in exactly 2 writes
- **Files**: `prisma/schema.prisma`, `lib/workflow/joining.ts`
- **Security**: status checks that can disagree
- **Fix**: make `lifecycle` the single source; derive the rest
- **Depends on**: nothing

### GAP-07 — Zero enums in 62 models

- **Current**: Every status is an unchecked `String`.
- **Evidence**: `grep -c "^enum " prisma/schema.prisma` → **0**
- **Models**: all
- **Security**: an invalid `User.role` silently degrades to STAFF; invalid
  statuses bypass state machines that read the column
- **Fix**: Prisma enums for the six lifecycle-critical columns first
- **Depends on**: nothing

### GAP-08 — `completeJoining` has no working entry point

- **Current**: Recruitment stalls at OFFER_ACCEPTED. The only path to an Employee
  is the HR form, which is intended for direct hires.
- **Expected**: A joined candidate becomes an employee through the pipeline.
- **Evidence**: `CompleteJoining` is mounted but never receives a joined state
- **Files**: `app/recruitment/offers/[id]/page.tsx`, `app/recruitment/CompleteJoining.tsx`
- **Fix**: wire the join action into the offer detail page
- **Depends on**: nothing

### GAP-09 — No per-user permission grant

- **Current**: No `Permission`/`RolePermission` model. Authority comes only
  from `User.role`. `PermissionOverrides` is accepted by the resolver but
  nothing persists it.
- **Evidence**: schema has no permission model; `resolvePermissions` takes
  overrides that no caller supplies
- **Models**: MISSING
- **Security**: no way to grant a capability to one person
- **Fix**: either add the models or delete the override parameter so it stops
  implying a capability that does not exist
- **Depends on**: nothing

### GAP-10 — Offboarding, clearance and settlement are unreachable

- **Current**: Models and actions exist for offboarding, clearance and final
  settlement. **No UI invokes any of them.**
- **Evidence**: `advanceOffboarding`, `updateChecklistItem`, `prepareSettlement`,
  `advanceSettlement` have no caller
- **Files**: `lib/workflow/offboarding.ts`
- **Workflow**: Offboarding, Final Settlement
- **Fix**: build the pages over the existing actions
- **Depends on**: GAP-05

---

## MEDIUM

### GAP-11 — No draft or resume-later state

An employee cannot be half-entered and resumed. Current behaviour: either fill
everything or start again. (Related to GAP-01 but a separate capability.)

### GAP-12 — Field phases are not modelled

No `phase`/`requiredPhase` column. Deferral is a Zod-schema convention with no
database backing — the direct cause of GAP-02 going unnoticed.

### GAP-13 — Visa has no state machine and no scheduler

`VisaRequest.status` is free text. `scanExpiringDocuments()` exists but is
**never called**. Visa completion does not change employee lifecycle.

### GAP-14 — Offer send/viewed have no delivery mechanism

`transitionOffer(→SENT)` and `(→VIEWED)` change a column and stop. No email, no
portal, no candidate-facing surface. An offer "sent" is an assumption.

### GAP-15 — FINANCE is never granted a branch in the approvals page

Falls through both `if` branches and sees an empty page with no explanation.

### GAP-16 — Manager scope depends on a nullable field

Approvals scope to `employee.managerId`. No seeded employee has one, so no
manager owns anything.

### GAP-17 — Three parallel authorization implementations

`lib/auth/guards.ts` (authoritative), inline `["ADMIN","HR"].includes(role)`
(~15 files), and page-level `auth()` checks. `no-explicit-any` cleanup in P1
added the guards but did not migrate the inline checks.

### GAP-18 — `Assessment` has no creating action

Model and relations exist; nothing writes a row.

### GAP-19 — Document checklist unreachable from the entry form

`updateChecklistItem` exists; the employee form does not surface it.

### GAP-20 — Account lockout fields are dead

`UserSecurityFlag.failedLoginAttempts` / `.lockedUntil` exist; nothing writes
them. Protection is the in-memory limiter, which is per-process and resets on
restart.

### GAP-21 — Conditional form fields not category-driven

`ServiceCategory.requiresAmount` / `.requiresDates` are not read by any form.

---

## LOW

### GAP-22 — Duplicate email/rollNumber across `User` and `Employee`
Two independent unique constraints with no guarantee the values match.

### GAP-23 — No autosave on a long form
Refresh loses everything.

### GAP-24 — `NotificationDelivery` is written but never delivered
`EMAIL` and `SMS` have no provider; records sit at `PENDING` or `SKIPPED`.

### GAP-25 — `probationDays` on `Employee` duplicates `ProbationReview`
`ProbationReview` is created at joining from the offer; the Employee column is
never kept in sync.

### GAP-26 — No `Department` / `Branch` / organisation model
`Employee.department` is free text. Company or branch scope is inexpressible,
and department matching is string comparison.

### GAP-27 — Security audit log is not written for most actions
`SecurityAuditLog` covers auth, role and recruitment. Employee entry writes
`AuditLog`, not `SecurityAuditLog` — the two are not reconciled.

---

## Suggested sequence

1. **GAP-01, GAP-02** — unblock the requirement the business actually asked for
2. **GAP-06, GAP-07** — one lifecycle field, real enums
3. **GAP-03, GAP-04** — make approvals trustworthy
4. **GAP-08** — connect offer → joining
5. **GAP-05, GAP-10** — build the exit side over existing models
6. **GAP-09, GAP-17** — one authorization path
7. Remainder

## What this audit did not do

No schema change, no migration, no new record, no state change, no UI edit, no
route rename, no deletion. The two read-only probes ran inside transactions that
were always rolled back; no data was created or modified.
