# IMPLEMENTATION PLAN

**Date**: 2026-09-28
**Derived from**: `EMPLOYEE_LIFECYCLE_AUDIT.md`, `EMPLOYEE_WORKFLOW_MATRIX.md`,
`USER_PROVISIONING_AUDIT.md`, `APPROVAL_CONNECTIVITY_AUDIT.md`,
`EMPLOYEE_ENTRY_AUDIT.md`, `LIFECYCLE_GAPS.md`
**Status**: plan only. No code was changed to produce this.

---

## How this plan was built

Every phase traces to specific gaps. Nothing is included because it is
"standard practice" — only because an audit finding demanded it. Where a gap has
already been partly addressed, the plan says so and scopes only the remainder.

Effort is **engineering days** for one engineer, excluding review.

---

## Guiding constraints

These hold across every phase and are not negotiable per-phase.

1. **No destructive migration.** `prisma migrate reset` and
   `db push --accept-data-loss` are never used. Every constraint change is
   explicit SQL with a pre-flight guard that aborts rather than rewrites.
2. **The database stays the authority.** A new state machine is not "valid until
   the form says so" — it is valid because the database refuses the illegal move.
3. **One implementation per concept.** Where the audit found duplicates
   (`LeaveRequest.status` vs `managerStatus`; `currentStatus` vs `isActive` vs
   `lifecycle`), the phase that touches it consolidates rather than adds a third.
4. **Every state change is audited** with actor, before and after.
5. **Tests before the change**, not after.

---

## PHASE 0 — Unblock what is already broken (2 days)

Everything else depends on this. Two gaps mean the application currently
promises a capability it cannot deliver.

| # | Gap | Work |
|---|-----|------|
| 0.1 | **GAP-02** | Either apply the `GAP-01` migration, or **remove the "Save as provisional" checkbox and the "N outstanding" badge**. Today the UI claims a capability the database refuses. Shipping the false promise is the bug; the fastest correct fix is to withdraw the claim until Phase 1 lands. |
| 0.2 | **GAP-01 pre-work** | Fix the four null-dereference sites so they cannot break when the columns become nullable: `app/api/letters/route.ts:107`, `app/payroll/loans/apply/page.tsx:26-28`, `app/settings/page.tsx:151`, `app/staff-services/page.tsx:212`. Note `new Date(null)` returns **1970**, so two of these fail silently rather than loudly. |
| 0.3 | **GAP-01 proof** | The proof harness has failed twice — both times because Prisma applies `@default(cuid())` and `@updatedAt` client-side, so raw SQL inserts omit them. The migration is currently **undisproved**. Re-run supplying `id` and `updatedAt` explicitly, confirm TEST 1/2/3/4, then roll back. |
| 0.4 | — | Commit the uncommitted UI work (layout overflow fix, table redesign, progress bar, `PageHero`, launcher rewrite) **before** starting new work, so the baseline is clean. |

**Exit criteria**: no false capability in the UI; the migration is either applied
or withdrawn; the tree is committed.

**Decision needed from you**: apply `GAP-01` now, or withdraw the provisional
UI until Phase 1? Phase 1 is better product; withdrawing is 30 minutes.

---

## PHASE 1 — Lifecycle data model and state machine (4 days)

The structural foundation. `GAP-06` and `GAP-07` mean there is no single source
of employment truth and no database-level state protection.

| # | Gap | Work |
|---|-----|------|
| 1.1 | `GAP-01` | Apply `20260928_make_employee_entry_staged`. Relax NOT NULL on `designation`, `department`, `joiningDate`, `userId`; add `CHECK (lifecycle NOT IN ('ACTIVE','CONFIRMED','PROBATION') OR (…all present…))`; backfill and constrain `lifecycle`. |
| 1.2 | `GAP-07` | Prisma enums for the six lifecycle-critical columns: `EmployeeLifecycle`, `ApplicationStatus`, `LeaveStatus`, `OfferStatus`, `RequisitionStatus`, `UserRole`. Start with `UserRole` — today an invalid role silently degrades to `STAFF`, which is a security property resting on a string. |
| 1.3 | `GAP-06` | Make `lifecycle` authoritative. Derive `isActive` and retire or deprecate `currentStatus`. Every reader of the old fields moves in the same change — the audit found three fields that can disagree with nothing enforcing agreement. |
| 1.4 | `GAP-12` | Add `phase` metadata so field deferral is modelled, not a Zod-schema convention. This is the direct cause of `GAP-02` going unnoticed. |
| 1.5 | `GAP-07 tests** | Add a migration test that proves the database **refuses** an illegal transition. A state machine not exercised by a negative test is a comment. |

**Exit criteria**: one employment-state field; a CHECK that blocks activating an
incomplete employee; invalid role values rejected by the database.

**Risk**: medium. Converting `role` to an enum touches every role check.

---

## PHASE 2 — Employee entry and progressive onboarding (5 days)

Delivers the requirement from the audit, properly this time.

| # | Gap | Work |
|---|-----|------|
| 2.1 | `GAP-11` | Draft state. A half-entered record can be saved and resumed — requires the Phase 1 nullability. |
| 2.2 | `GAP-23` | Autosave on the long entry form. |
| 2.3 | `GAP-19` | Surface the document checklist inside the entry form. The action (`updateChecklistItem`) already exists and is unreachable. |
| 2.4 | `GAP-21` | Drive conditional fields from `ServiceCategory.requiresAmount` / `.requiresDates`. |
| 2.5 | `GAP-06 UI** | Filter the employee list on `lifecycle`, and make the "outstanding" badge read from it rather than recomputing from a field list. |
| 2.6 | `EE-09` | Guarantee `User.email` and `Employee.email` cannot diverge. |

**Exit criteria**: an employee can be created with identity only, completed after
visa processing, and the outstanding work is visible on the record.

---

## PHASE 3 — Make approvals trustworthy (3 days)

The audit classified this root cause as **multiple (B+C+D+E+F+G)**, not a single
bug. Fixing one symptom will not fix it.

| # | Gap | Work |
|---|-----|------|
| 3.1 | `GAP-03` | Migrate `app/dashboard/approvals` off `managerStatus`/`hrStatus` onto `LeaveRequest.status`. Two pending leaves are invisible to HR **because** the page reads the legacy pair. |
| 3.2 | `GAP-04` | One aggregation service reading all approval sources. Seven are never queried today. |
| 3.3 | `GAP-08` | Central approver resolution. Manager scope currently keys on a nullable `managerId` that no seeded employee has. |
| 3.4 | `GAP-15` | Assign FINANCE a branch, or explain the empty page. Today it falls through both `if` branches silently. |
| 3.5 | `GAP-09 UI` | Empty-state that distinguishes "nothing pending" from "you cannot see anything". |
| 3.6 | `AP-06` | Visa approval action + audit entry. `VisaRequest` has neither. |

**Exit criteria**: an HR admin sees pending manager-stage leave requests; every
approval source appears in one queue.

---

## PHASE 4 — Connect recruitment end to end (3 days)

Recruitment works but **stalls at offer acceptance** — the only path to an
Employee is the HR form.

| # | Gap | Work |
|---|-----|------|
| 4.1 | `GAP-08` | Wire `completeJoining` into the offer detail page. The action is correct and transactional; it simply has no working entry point. |
| 4.2 | `GAP-18` | Create `Assessment` rows. The model has no creating action. |
| 4.3 | `GAP-14` | Give offer "sent" a real delivery mechanism, or rename the state so it does not imply one. |
| 4.4 | `GAP-13` | Visa state machine + a scheduled reminder run. `scanExpiringDocuments()` exists and is never called. |

**Exit criteria**: an accepted offer becomes an employee through the pipeline.

---

## PHASE 5 — Exit side (6 days)

The largest single absence: resignation, termination, notice, clearance, exit
interview and rehire are **entirely missing**. Offboarding, clearance and
settlement *logic* already exists from P1 and is simply unreachable.

| # | Gap | Work |
|---|-----|------|
| 5.1 | `GAP-05` | `ResignationRequest` model + workflow: SUBMITTED → MANAGER → HR → NOTICE_PERIOD. |
| 5.2 | `GAP-05` | `TerminationRequest` as a **separate** model — not a status flag on Employee. Configurable reasons. |
| 5.3 | `GAP-10` | UI over the existing `initiateOffboarding`, `updateChecklistItem`, `prepareSettlement`, `advanceSettlement`, `revokeAccess`. No new logic — only pages. |
| 5.4 | `GAP-05` | Notice-period calculation from company policy, made configurable rather than hardcoded. |
| 5.5 | `GAP-05` | Exit interview. |
| 5.6 | — | Rehire. Requires `EmploymentEpisode` or equivalent, so a returning employee does not create a duplicate record. |

**Exit criteria**: resignation through to exit, with access revoked and
settlement approved, and no employee record destroyed.

---

## PHASE 6 — Movement and performance (6 days)

| # | Gap | Work |
|---|-----|------|
| 6.1 | `GAP-05` | Transfer / promotion / salary revision, all with approval and **history** — never overwriting the previous value. |
| 6.2 | `GAP-05` | Probation review and confirmation. `ProbationReview` is created at joining and never read. |
| 6.3 | `GAP-25` | Reconcile `Employee.probationDays` with `ProbationReview`. |
| 6.4 | — | Performance cycle, goals, configurable rating scale — not one hardcoded methodology. |

---

## PHASE 7 — Authorisation consolidation (4 days, can run parallel to 5–6)

| # | Gap | Work |
|---|-----|------|
| 7.1 | `GAP-09` | `Permission` / `RolePermission` models, **or** delete the `PermissionOverrides` parameter so it stops implying a capability that does not exist. Pick one; leaving it is the worst option. |
| 7.2 | `GAP-17` | Retire the ~15 inline `["ADMIN","HR"].includes(role)` checks in favour of `lib/auth/guards.ts`. |
| 7.3 | `GAP-20` | Either implement account lockout, or remove the dead `failedLoginAttempts` / `lockedUntil` fields. The in-memory limiter is per-process and resets on restart. |
| 7.4 | `GAP-26` | `Department` / `Branch` / organisation models. "Company" scope is currently inexpressible and `department` is free text. |

---

## PHASE 8 — UI workflow visibility (5 days)

Explicitly **not** started now; this is the P2 visual work.

| # | Gap | Work |
|---|-----|------|
| 8.1 | `EE-06` | Employee detail page showing lifecycle, outstanding fields, checklist and readiness. None of this is visible today. |
| 8.2 | `GAP-05 UI` | Offboarding and settlement pages over existing actions. |
| 8.3 | — | Recruitment pipeline and interview calendar polish. |
| 8.4 | — | Replace the five remaining oversized heroes with `PageHero`. |

---

## Sequencing and dependencies

```
Phase 0 (2d)  ──┬──> Phase 1 (4d) ──┬──> Phase 2 (5d)   staged entry
                │                       └──> Phase 4 (3d)   joining wired
                └──> Phase 3 (3d)      approvals trustworthy
                                        Phase 5 (6d)   exit side
Phase 7 (4d) ──────────────────────────► parallel, any time
Phase 6 (6d) ──────────► after 5
Phase 8 (5d) ──────────► after 2, 4, 5
```

**Critical path**: 0 → 1 → 2. Roughly 11 days to the outcome the business asked
for. Everything else can proceed in parallel.

---

## Risk register

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | Converting `role` to an enum breaks every inline role check | Do it in Phase 1 with `GAP-17` in the same change, not separately |
| 2 | Relaxing NOT NULL weakens integrity | Compensating CHECK; pre-flight aborts; test proves the CHECK blocks an incomplete activation |
| 3 | The approvals fix exposes that other sources have never been wired | Expected. Add each source with its own queue rather than one big change |
| 4 | The exit-side build is large and touches payroll | Phase 5 after 1–4; settlement reuses `FinalSettlement` rather than new models |
| 5 | `lifecycle` migration backfills from `currentStatus` | Pre-flight verifies no active employee is incomplete; those already have all three fields |

---

## What I would not do

- **Do not** make `lifecycle` optional again — it is the authority.
- **Do not** delete `currentStatus` in the same change that stops reading it;
  deprecate first, remove when nothing reads it.
- **Do not** build a generic workflow engine. Four explicit state machines beat
  one configurable one nobody can reason about.
- **Do not** add a `Permission` model without a UI to manage it, or it becomes a
  second dead capability like `PermissionOverrides`.
- **Do not** implement UAE end-of-service arithmetic without confirmed
  jurisdiction and company policy. `FinalSettlement` is a formula of explicit
  inputs, and that is correct.

---

## Open decisions for you

1. **Phase 0** — apply the migration, or withdraw the provisional UI for ~2 weeks?
2. **Phase 7.1** — add real per-user permissions, or delete the dead override
   parameter?
3. **Phase 5.6** — is rehire in scope now, or is an `EmploymentEpisode` history
   worth deferring until it is actually needed?
