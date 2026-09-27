# EMPLOYEE LIFECYCLE — P1 IMPLEMENTATION

**Date**: 2026-09-27
**Commit base**: `34b6b60`
**Scope delivered**: Recruitment foundation + the structural work that Phases 2–6 depend on.

---

## Honest scope statement

The brief describes 38 lifecycle stages across 6 phases and ~22 UI screens.
That is a multi-week programme. What is delivered here is **Phase 1 in full,
plus the data restructuring that every later phase requires**. Phases 2–6 are
**not** delivered and are listed as remaining work below.

Nothing in this phase is stubbed to look complete: each delivered item works
end-to-end and is covered by tests.

---

## 1. What the inspection found

The brief instructed: *"Do not blindly create these exact Prisma models without
first inspecting the existing schema"* and *"Avoid duplicate entities."*

A recruitment module already existed. Inspecting it revealed **structural
defects that made parts of the brief impossible as written**:

| Existing state | Consequence |
|---|---|
| `Candidate.jobId` **required** | A candidate could only ever have **one** job. Brief §6 ("a candidate may apply to multiple jobs") was unimplementable. |
| `OfferLetter.candidateId` **`@unique`** | A candidate could never receive a **second** offer. Brief §14/§23 (versioning) unimplementable. |
| `Interview.interviewerId` single | No interview panel. Brief §11 unimplementable. |
| `Interview.feedback` one `String`, one `rating` | One interviewer overwrites another. Brief §10 unimplementable. |
| **No `Application` entity** | The pipeline state machine had nowhere to live; `Candidate.status` jumped APPLIED → HIRED. Brief §6 unimplementable. |
| No state machines, no permissions, no audit | Any status could be set by any caller. |

So the work was **restructuring**, not duplication.

---

## 2. Data model changes

**All additive except three provably-safe drops.** Pre-flight verified
`0` rows in `Candidate`, `JobRequisition`, `Interview` and `OfferLetter` before
anything was applied.

### New models

| Model | Purpose | Brief |
|---|---|---|
| `Application` | A candidate applying to one job. **The pipeline state lives here.** | §6 |
| `InterviewParticipant` | One row per interviewer — enables a panel | §11 |
| `InterviewFeedback` | Structured per-interviewer scores; `@@unique([participantId])` | §10 |
| `Assessment` | Candidate assessments | §12 |

### Restructured models

| Model | Change |
|---|---|
| `Candidate` | **Dropped** `jobId`, `status`. Added `candidateCode`, `nationality`, `currentLocation`, `skills`, `currentEmployer`, `currentPosition`, `expectedSalary`, `noticePeriodDays`, `source`, `tags`, `consentGiven`/`consentAt`. Now linked to jobs via `Application`. |
| `JobRequisition` | **Dropped** `candidates`. Added approval chain fields, `requisitionCode`, `positionType`, `priority`, `requiredSkills`, `targetJoiningDate`, and per-stage approvers. |
| `Interview` | **Dropped** `interviewerId`, `durationMins`, `feedback`, `rating`. Added `applicationId`, `interviewType`, `round`, `mode`, `startAt`/`endAt`, `meetingLink`, `coordinatorId`. |
| `OfferLetter` | **Dropped** `@unique` on `candidateId`. Added `applicationId`, `version`, `allowances`, `offerExpiry`, `contractType`, approval and acceptance fields, `supersededById`. |

### Migration safety

`--accept-data-loss` and `prisma migrate reset` were **never used**. Prisma
refused to apply the changes, so each risky step was applied by explicit SQL
with a **guard that re-verifies row counts and refuses to run if data appeared**:

```
NOTICE:  Pre-flight row counts -> candidates=0, requisitions=0, interviews=0, offers=0
NOTICE:  Step 3 complete: unique constraints created.
```

Three-step pattern: drop the pending constraints from the schema → `db push`
adds columns → recreate the constraints in SQL with duplicate guards → restore
the schema declarations. This is the same approach used earlier for
`BiometricLog.punchHash` and `SalaryRecord(employeeId, year, month)`.

---

## 3. State machines

`lib/workflow/recruitment-machine.ts` — five explicit maps. Every status
change is validated; an unknown current state is a hard error, never a
permissive default.

| Machine | States | Notable rules encoded |
|---|---|---|
| `REQUISITION_TRANSITIONS` | DRAFT → SUBMITTED → MANAGER_REVIEW → HR_REVIEW → FINANCE_REVIEW → APPROVED / REJECTED / CANCELLED | Cannot skip to APPROVED. Terminal after approval. |
| `JOB_TRANSITIONS` | DRAFT → OPEN → PAUSED → CLOSED / FILLED | **A guard blocks publishing unless the requisition is APPROVED** (brief §3). |
| `APPLICATION_TRANSITIONS` | APPLIED → SCREENING → SHORTLISTED → INTERVIEW → ASSESSMENT → SELECTED → OFFERED → OFFER_ACCEPTED → HIRED | **HIRED requires an accepted offer** (guard). REJECTED / WITHDRAWN / OFFER_DECLINED / HIRED are terminal. Supports re-offer (OFFERED → SELECTED). |
| `INTERVIEW_TRANSITIONS` | SCHEDULED → RESCHEDULED → IN_PROGRESS → COMPLETED / CANCELLED / NO_SHOW | COMPLETED / CANCELLED / NO_SHOW terminal. |
| `OFFER_TRANSITIONS` | DRAFT → PENDING_APPROVAL → APPROVED → SENT → VIEWED → ACCEPTED / DECLINED / EXPIRED | SENT blocked until APPROVED. Revision path back to DRAFT creates a new version. |
| `LIFECYCLE_TRANSITIONS` | PRE_JOINING → ACTIVE → PROBATION → CONFIRMED → NOTICE_PERIOD → EXITED | TERMINATED requires HR+. **EXITED is never self-service.** ON_LEAVE returns to the *substantive* state (a confirmed employee on leave returns to CONFIRMED, not ACTIVE). |

---

## 4. Workflow implementation

`lib/workflow/recruitment.ts` — one implementation, permission-checked,
transactional, audit-logged.

| Function | Brief | Key rules |
|---|---|---|
| `createRequisition` | §3 | Auto-generates `REQ-YYYY-NNNN`. |
| `transitionRequisition` | §3 | Guarded `updateMany` on current status, so two concurrent approvals cannot both succeed. |
| `applyToJob` | §5/§6 | **Refuses without explicit data-processing consent.** Only accepts applications against an APPROVED requisition. **Deduplicates candidates by email** via upsert. **One live application per candidate per job** — a re-application returns the existing record. |
| `recordScreening` | §7 | Records recommendation, validates rating 0–5. Rejected candidates are archived, never deleted. |
| `scheduleInterview` | §9/§11 | Refuses past times and end-before-start. **Detects interviewer double-booking** via overlap query across the panel. **Detects candidate double-booking.** |
| `submitInterviewFeedback` | §10/§11 | **Validates each score is a whole number 1–5** (rejected, not clamped). **An interviewer may only submit for interviews they are on.** Upsert keyed on `participantId`, so one interviewer cannot overwrite another's. |
| `createOffer` | §14 | **Versioned** — a revision supersedes rather than overwrites. Blocked unless the application is SELECTED. |
| `transitionOffer` | §14/§16 | Refuses to act on a superseded version. Acceptance advances the application, which is what later permits HIRED. |
| `markHired` | §19 | Guarded by an accepted offer. **Does not create an Employee record** — that happens at joining (brief §1: do not create an employee because someone applied). |

---

## 5. Permissions

20 new capabilities, all resolved through the existing centralized
`lib/auth/permissions.ts` — no ad-hoc role checks.

```
recruitment.view  .create  .edit  .approve  .interview  .offer  .convert
performance.view  .review  .approve
training.view     .manage
resignation.view  .create  .approve
termination.view  .create  .approve
exit.clearance  .settlement  .complete  .interview
```

| Role | Recruitment | Exit |
|---|---|---|
| STAFF | — | — |
| MANAGER | — | — |
| FINANCE | `recruitment.offer`, `exit.settlement` | settlement |
| HR | full `recruitment.*` | clearance, settlement, approvals |
| ADMIN | full | full including `exit.complete` |
| SUPER_ADMIN | full | full |

The pre-existing coarse `recruitment.manage` is retained for backwards
compatibility; new code uses the granular capabilities.

---

## 6. Tests

**211 passing** (181 pre-existing, unchanged + 30 new in
`tests/recruitment-p1.test.ts`).

No existing test was modified. All 181 still pass.

Covered: requisition chain, job-publish guard, full application pipeline,
HIRED-requires-offer, terminal-state immutability, re-offer path, offer
approval and revision, interview scheduling, and the full employee lifecycle
including role enforcement on termination and exit.

Two of my own test assertions were **wrong** and were corrected against the
intended security model rather than the code being changed: HR legitimately
handles termination and notice-period entry (brief §32/§33), while
`EXITED` is never self-service.

---

## 7. UI routes

| Route | Status |
|---|---|
| `/recruitment` | **Updated** for the new model — counts come from `Application`, status is per-application |
| `/recruitment/jobs`, `/candidates`, `/applications`, `/interviews`, `/offers`, `/settings` | **Not delivered** — see remaining work |

---

## 8. Not delivered

| Area | Status |
|---|---|
| §9–§12 interview UI, assessment UI, selection screen | Workflow logic only |
| §14–§16 offer UI, offer letter integration | Workflow logic only |
| §17–§20 pre-boarding, joining, employee creation from a hire | **Not started** |
| §21–§23 probation, review, confirmation | **Not started** |
| §24–§27 movement, promotion, performance, training | **Not started** |
| §29 self-service portal | **Not started** |
| §30–§38 resignation, termination, exit interview, clearance, settlement, exit documents | State machine defined (`LIFECYCLE_TRANSITIONS`); workflow + UI not built |
| §39 access revocation at exit | `lib/workflow/credentials.ts` `revokeAccess()` exists; not wired to the exit flow |
| §43 lifecycle notification templates | Uses the existing notification system; per-stage templates not authored |
| §44 recruitment / lifecycle dashboards | **Not started** |
| §52 UI screens | **Not started** |

---

## 9. Provider and configuration dependencies

| Item | Status |
|---|---|
| Email / SMS delivery | Not implemented. `NotificationDelivery` records `SKIPPED` with a reason; **nothing is faked**. |
| Offer letter PDF | Must reuse the existing Letters engine (`app/lib/utils/letter-generator.ts`). `OfferLetter.letterRecordId` exists to link, but the integration is not written. |
| Meeting links for online interviews | `Interview.meetingLink` is a stored field; no calendar/meeting provider is integrated. |
| Final settlement arithmetic | Intentionally **not** implemented. UAE end-of-service rules are company- and jurisdiction-specific; inventing them would be worse than leaving them configurable. `FinalSettlement` exists with explicit input fields and an approval chain. |
| Termination reasons | Configurable field, not hard-coded. |
| Notice period calculation | Requires company policy; not implemented. |

**No claim of legal or regulatory compliance is made anywhere in this work.**

---

## 10. Verification

```
tsc:     0 errors
tests:   211 passed (10 files) — 181 pre-existing unchanged
build:   PASS, 48 routes
lint:    187 problems / 47 errors
seed:    exit 0
migrate: no --accept-data-loss, no reset, 0 rows deleted
```

---

## 11. Recommended next phase

**Phase 2 — Interview** (brief §8–§12). The data model and state machine are
in place; it needs the scheduling UI, the feedback form, and the conflict
visibility the brief describes.

Before Phase 4 (joining) lands, note the open question the brief raises and this
phase did not resolve: `Employee` currently has no `lifecycle` column, so
`LIFECYCLE_TRANSITIONS` is not yet persisted. Adding it is a safe additive
change, but it should land with the joining workflow that first writes to it.
