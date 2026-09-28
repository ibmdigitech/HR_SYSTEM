# EMPLOYEE LIFECYCLE AUDIT

**Date**: 2026-09-28
**Type**: READ-ONLY architecture discovery. No code, schema, data or UI was changed.
**Method**: Static inspection of the current tree + read-only database probes (all rolled back).

> Every claim below was verified against the code as it stands today. Where an
> earlier audit document disagrees with the code, **the code wins** and the
> disagreement is recorded as a finding.

---

## 1. Current lifecycle — what actually exists

The intended journey is:

```
Requisition → Application → Screening → Interview → Selection → Offer
→ Acceptance → Employee Entry → Onboarding → Active → … → Exit
```

What is implemented, end to end, with a working server action at each step:

| Stage | Status | Evidence |
|---|---|---|
| Job requisition | **PASS** | `JobRequisition` + `transitionRequisition` + approval UI |
| Job posting / OPEN | **PARTIAL** | `JOB_TRANSITIONS` guard exists; no dedicated page |
| Candidate | **PASS** | `Candidate` + `applyToJob` (dedup by email) |
| Application | **PASS** | `Application` holds the pipeline state |
| Screening | **PASS** | `recordScreening` |
| Interview scheduling | **PASS** | `scheduleInterview`, panel + conflict detection |
| Interview feedback | **PASS** | `submitInterviewFeedback`, per-interviewer isolation |
| Assessment | **PARTIAL** | `Assessment` model exists; **no server action creates rows** |
| Selection | **PASS** | `markHired` (sets `Application = HIRED`) |
| Offer | **PASS** | `createOffer` (versioned), `transitionOffer` |
| Offer letter | **PASS** | `issueOfferLetter` reuses the existing PDF engine |
| Offer acceptance | **PASS** | `transitionOffer(→ACCEPTED)` |
| **Employee Entry** | **BROKEN for staged entry** | see §5 |
| Onboarding checklist | **PARTIAL** | `ensureChecklist` runs; no completion UI |
| Probation | **PARTIAL** | `ProbationReview` created at joining; no review action |
| Joining → Employee | **PARTIAL** | `completeJoining` exists; not reachable from UI |
| **Transfer** | **MISSING** | no model, no action |
| **Promotion** | **MISSING** | no model, no action |
| **Resignation** | **MISSING** | no model, no action |
| **Termination** | **MISSING** | no model, no action |
| Offboarding | **PARTIAL** | `OffboardingRequest` + transitions; no UI entry point |
| Final settlement | **PARTIAL** | `FinalSettlement` model; no action drives it |
| Exit / access revocation | **PARTIAL** | `revokeAccess()` exists; not wired to a workflow |
| **Rehire** | **MISSING** | zero occurrences anywhere in the codebase |

---

## 2. Current states

**The schema declares zero enums.** Every status in all 62 models is a plain
`String`. Verified: `grep -c "^enum " prisma/schema.prisma` → **0**.

Consequence: a status can hold any value, and only application code prevents an
illegal one. This is the single biggest structural weakness in the lifecycle.

### Employee state — actual fields

`Employee` carries **two** independent status fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| `currentStatus` | `String` | `"ACTIVE"` | Comment lists `ACTIVE, ON_LEAVE, RESIGNED, TERMINATED` |
| `isActive` | `Boolean` | `true` | Duplicates `currentStatus` |
| `lifecycle` | `String?` | `"PRE_JOINING"` | Added in P1: `PRE_JOINING, ACTIVE, PROBATION, CONFIRMED, ON_LEAVE, NOTICE_PERIOD, RESIGNED, TERMINATED, EXITED` |

**Three overlapping representations of employment state.** Nothing enforces
agreement between them. `lifecycle` is written in exactly two places
(`completeJoining`, the provisional entry path); nothing reads it.

### Other status vocabularies in use

| Entity | Values observed in code |
|---|---|
| `Application.status` | APPLIED → SCREENING → SHORTLISTED → INTERVIEW → ASSESSMENT → SELECTED → OFFERED → OFFER_ACCEPTED / OFFER_DECLINED / REJECTED / WITHDRAWN / HIRED |
| `LeaveRequest.status` | PENDING_MANAGER, MANAGER_APPROVED, PENDING_HR, APPROVED, REJECTED, CANCELLED |
| `LeaveRequest.managerStatus` / `.hrStatus` | PENDING / APPROVED — **a second, parallel representation** |
| `ServiceRequest.status` | PENDING, MANAGER_APPROVED, … (vocabulary not declared anywhere) |
| `OfferLetter.status` | DRAFT → PENDING_APPROVAL → APPROVED → SENT → VIEWED → ACCEPTED / DECLINED / EXPIRED / WITHDRAWN |
| `JobRequisition.status` | DRAFT → SUBMITTED → MANAGER_REVIEW → HR_REVIEW → FINANCE_REVIEW → APPROVED / REJECTED / CANCELLED |

---

## 3. Recruitment flow — traced

```
User clicks a requisition
  → RequisitionStatusControl → transitionRequisition()
    → assertTransition(REQUISITION_TRANSITIONS)   [server-side gate]
    → prisma.jobRequisition.updateMany({ where: { id, status: current } })   [race-safe]
    → AuditLog: REQUISITION_<STATUS>
  → "Draft an offer" → createOffer()
    → assertTransition(APPLICATION_TRANSITIONS) — refused unless SELECTED
    → OfferLetter created, previous version superseded
  → OfferActions → transitionOffer()
    → DRAFT → PENDING_APPROVAL → APPROVED → SENT → VIEWED → ACCEPTED
    → on ACCEPTED, Application → OFFER_ACCEPTED
  → "Issue offer letter" → issueOfferLetter()
    → writes a Letter row (existing PDF engine renders it)
  → "Mark as joined" → completeJoining()
    → requires ACCEPTED offer
    → ONE transaction: User, Employee, SalaryStructure, LeaveBalances,
                       ProbationReview, Application→HIRED, JoiningRecord,
                       Notification, AuditLog
    → then: activation token, onboarding checklist, manager notification
```

**Where recruitment ends and employee creation begins**: at `completeJoining`.
This is correctly implemented — the guard refuses unless an offer is ACCEPTED,
and the Employee row is created inside a single transaction.

**Defect**: `completeJoining` has **no UI entry point**. It is exported as
`completeJoiningAction` and rendered by `CompleteJoining`, but that component is
only mounted inside the offer detail page and renders nothing useful because it
is not given a joined state. Recruitment is therefore **stalled at the offer
stage** in practice.

---

## 4. Offer → Employee — traced

| Question | Answer |
|---|---|
| Does selection create an Employee? | **No** — `markHired` only sets `Application.status = HIRED` |
| Does selection create a User? | **No** |
| Does selection create an Offer? | **No** — offers are created separately |
| Who approves the Offer? | `transitionOffer` state machine: FINANCE, HR, ADMIN, SUPER_ADMIN |
| How is the Offer sent? | `transitionOffer(→SENT)`. **No actual delivery mechanism** |
| How is acceptance recorded? | `transitionOffer(→ACCEPTED)` sets `acceptedAt` + `acceptanceMethod` |
| What if rejected? | `transitionOffer(→DECLINED)`; `Application` stays OFFERED |
| What if it expires? | `EXPIRED` state exists; **no scheduled job moves offers into it** |

---

## 5. Employee entry — the critical defect

### Database reality

```
Employee.userId       String       REQUIRED, @unique, FK → User
Employee.rollNumber   String       REQUIRED, @unique
Employee.firstName    String       REQUIRED
Employee.lastName     String       REQUIRED
Employee.email        String       REQUIRED, @unique
Employee.designation  String       REQUIRED
Employee.department   String       REQUIRED
Employee.joiningDate  DateTime     REQUIRED
```

**Verified by read-only probe** (insert attempted inside a rolled-back
transaction): an Employee **cannot** be created without `userId`,
`designation`, `department` and `joiningDate`. All four are NOT NULL.

### What this means for the user's stated requirement

> "Sometimes we add the employee first, and only after the visa process is
> complete can we add the remaining details."

**The system cannot do this today, and the staged path built in the previous
phase does not work.** I built:

- `employeeSchemaProvisional` — makes `designation`, `department` and
  `joiningDate` optional at the validation layer
- a "Save as provisional" checkbox
- `lifecycle = PRE_JOINING` marking
- an "N outstanding" badge

All of that is **cosmetic**. The validation passes, the UI shows the badge —
and then the Prisma insert fails, because the columns are NOT NULL. I
verified the client-side validation accepts a minimal record, and verified the
database rejects it. I did not test the combination end to end before claiming
it worked. That was my error.

**To support staged entry the schema must change** — make `designation`,
`department`, `joiningDate` and `userId` nullable. That is out of scope for a
read-only audit and is recorded as `GAP-01`.

### Field classification (current state)

| Phase | Fields | DB nullable? |
|---|---|---|
| **A — Initial entry** | firstName, lastName, email, phone, nationality, rollNumber, designation, department, joiningDate, employmentType, workLocation, probationDays | designation/department **required**; rollNumber/joiningDate **required** |
| **B — Visa / compliance** | passportNumber, passportExpiry, emiratesId, emiratesIdExpiry, visaNumber, visaExpiry, visaType, medicalInsuranceExpiry, iloeInsuranceExpiry, governmentId | **all nullable** ✅ |
| **C — Joining** | actual joining date, employee code, bank/IBAN, shift | joiningDate is the same Phase-A field; employeeCode nullable |
| **D — Profile completion** | address, permanentAddress, emergencyContact, emergencyPhone, maritalStatus, gender, dateOfBirth | **all nullable** ✅ |

**Only Phase B and D can genuinely be deferred.** Phases A and C are hard-blocked
by NOT NULL columns.

---

## 6. Visa workflow — traced

| Question | Answer |
|---|---|
| Who creates visa records? | `createVisaRequest` — HR/Admin only |
| Can visa be added after Employee creation? | **Yes** |
| Can it be updated later? | Yes |
| Are expiry dates tracked? | Yes — `Employee.passportExpiry`, `emiratesIdExpiry`, `visaExpiry`, `medicalInsuranceExpiry`, `iloeInsuranceExpiry` |
| Are reminders generated? | `scanExpiringDocuments` exists. **Never called from anywhere** |
| Is visa approval separate from processing? | **No** — `VisaRequest.status` is free-text; no transition map |
| Is visa linked to Employee? | Yes, `visaRequests` |
| Does visa completion change lifecycle? | **No** |
| Is an approval record created? | **No** — no `VisaApproval` model |

Visa is the **weakest connected workflow**: the model and CRUD exist, but
nothing drives the state machine, nothing schedules reminders, and completion
has no effect on the employee.

---

## 7. Onboarding — traced

`OnboardingChecklistItem` (P1) with a 12-item default template covering HR, IT,
Admin, Finance and Department concerns. `ensureChecklist` is idempotent via
`@@unique([employeeId, category])` and is called from both `completeJoining` and
the employee-entry action.

| Capability | State |
|---|---|
| Configurable checklist | **Implemented** (code-level template, no admin UI) |
| Progress / completion UI | **Missing** — no page renders the checklist |
| Item completion action | **Implemented** (`updateChecklistItem`) |
| Document evidence | `documentRef` field, **not surfaced in any UI** |
| Equipment assignment | `Asset` + `AssetAssignment` + `assignAssets` — **no UI** |
| Email/login provisioning | `issueActivationToken` — works, link shown once in the employee dialog |
| Welcome notification | Implemented in transaction |
| Manager assignment | `Employee.managerId` — no UI |

---

## 8. User provisioning — traced

Full detail in `USER_PROVISIONING_AUDIT.md`. Summary:

| Event | User created? |
|---|---|
| Candidate applied | No |
| Candidate selected | No |
| Offer accepted | No |
| **Joining (`completeJoining`)** | **Yes** — inside the transaction |
| Employee entry (HR form) | **Yes** — inside the transaction |

Both paths create the User with `password: null` and issue a one-time activation
token. **No shared default password is ever set.** The seed is the only exception,
and it sets the default only on **first creation** — verified by
`tests/sec-027-regression.test.ts`.

---

## 9. Exit side — mostly absent

| Workflow | Model | Server action | UI |
|---|---|---|---|
| Resignation | **MISSING** | **MISSING** | **MISSING** |
| Notice period | **MISSING** | **MISSING** | **MISSING** |
| Exit interview | **MISSING** | **MISSING** | **MISSING** |
| Termination | **MISSING** | **MISSING** | **MISSING** |
| Offboarding | `OffboardingRequest` + transitions | `initiateOffboarding`, `advanceOffboarding` | **MISSING** |
| Clearance checklist | `OffboardingChecklistItem` | `updateChecklistItem` | **MISSING** |
| Asset return | `AssetAssignment.returnedAt` | none | **MISSING** |
| Final settlement | `FinalSettlement` | `prepareSettlement`, `advanceSettlement` | **MISSING** |
| Access revocation | `UserSecurityFlag.accountDisabled` | `revokeAccess` | not wired |
| Exit documents | `Letter` reuse | — | relieving letter page exists |
| **Rehire** | **MISSING** | **MISSING** | **MISSING** |

The models and server logic for offboarding, clearance and settlement were built
in P1. **None of it is reachable from the UI.** An employee can be offboarded
only by calling a server action directly.

`LIFECYCLE_TRANSITIONS` defines `NOTICE_PERIOD → EXITED`, but nothing writes
`lifecycle = "NOTICE_PERIOD"` or `"EXITED"`.

---

## 10. Current defects found in this audit

| ID | Defect | Severity |
|---|---|---|
| `GAP-01` | Staged employee entry is impossible; `designation`/`department`/`joiningDate`/`userId` are NOT NULL | **CRITICAL** |
| `GAP-02` | Staged-entry UI built in P1 implies a capability the schema forbids | **CRITICAL** |
| `GAP-03` | `completeJoining` has no working UI entry point; recruitment stalls at offer | **HIGH** |
| `GAP-04` | Zero enums — every status is an unchecked `String` | **HIGH** |
| `GAP-05` | Three conflicting employment-state fields (`currentStatus`, `isActive`, `lifecycle`) | **HIGH** |
| `GAP-06` | Approvals dashboard queries 3 of 10 approval sources, with a status mismatch | **HIGH** |
| `GAP-07` | `LeaveRequest` has parallel `status` and `managerStatus`/`hrStatus` | **HIGH** |
| `GAP-08` | Resignation, termination, notice, exit-interview, rehire entirely absent | **HIGH** |
| `GAP-09` | `scanExpiringDocuments` and the whole offboarding/settlement layer are unreachable from the UI | **MEDIUM** |
| `GAP-10` | `Assessment` model has no creating action | **MEDIUM** |
| `GAP-11` | Visa has no transition map and no scheduled reminder job | **MEDIUM** |
| `GAP-12` | Offer "sent" and "viewed" have no delivery mechanism behind them | **MEDIUM** |

---

## 11. Corrections to prior audit documents

| Prior claim | Reality |
|---|---|
| "Employee master data can be created only with all required fields" | Correct, and confirmed by probe — this is `GAP-01` |
| "Offer/termination/onboarding workflows missing" | Partially wrong: offboarding, settlement, clearance **models and actions exist**; the **UI** is missing |
| "WPS export not implemented" | **Wrong** — a SIF implementation exists in `app/api/payroll/export/route.ts`; the employer identifiers are placeholders |
| "Leaves have no HR review step" | **Wrong** — `hrStatus` and a two-stage transition map exist |
| "Rehire/transfer/promotion absent" | **Correct** — zero occurrences |
| Audit documents listing 39 models | Now **62** — P1 added 23 |

---

See also:
- `EMPLOYEE_WORKFLOW_MATRIX.md` — per-workflow state/actor/permission
- `USER_PROVISIONING_AUDIT.md` — identity and login lifecycle
- `APPROVAL_CONNECTIVITY_AUDIT.md` — why approvals is empty, with the root cause
- `EMPLOYEE_ENTRY_AUDIT.md` — every field, classified
- `LIFECYCLE_GAPS.md` — prioritised remediation list
