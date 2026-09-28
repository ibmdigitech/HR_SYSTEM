# APPROVAL CONNECTIVITY AUDIT

**Date**: 2026-09-28 · Read-only. No approval record was created, altered or deleted.

## The symptom

`/dashboard/approvals` can display `Total Pending = 0` while work demonstrably
exists.

## What was actually pending at the time of the audit

Read from the live database:

```
 source           | status           | n
------------------+------------------+---
 Application      | SHORTLISTED      | 1
 LeaveRequest     | PENDING_MANAGER  | 2
 ServiceRequest   | MANAGER_APPROVED | 1
```

```
 id            | type     | workflow_status | managerStatus | hrStatus
---------------+----------+-----------------+---------------+----------
 …bnfqr        | ANNUAL   | PENDING_MANAGER | PENDING       | PENDING
 …sniucw       | EMERGENCY| PENDING_MANAGER | PENDING       | PENDING
```

`RoleRequest`, `OfferLetter`, `LoanApplication`, `VisaRequest`,
`OffboardingRequest`, `JoiningRecord` and `ProbationReview` contain **zero
rows**, so they cannot contribute to a non-zero total regardless of the query.

## The query

`app/dashboard/approvals/page.tsx` reads exactly **three** sources:

| Source | Filter | Role gate |
|---|---|---|
| Leave | `managerStatus: "PENDING"` **and** `employee.managerId = me` | MANAGER only |
| Leave | `managerStatus: "APPROVED"` **and** `hrStatus: "PENDING"` | HR, ADMIN |
| Staff requests | `status: "PENDING"` | MANAGER, HR, ADMIN |
| Visa | `status: "PENDING"` | HR, ADMIN |

STAFF sees an Access Denied card. **FINANCE falls through both branches and
sees zero leaves** with no explanation.

## Root cause: **I (F: status mismatch) + (E: requests do not create the
approval records the page queries)**

### Evidence 1 — the status mismatch

The two `LeaveRequest` records that DO exist are `managerStatus = PENDING`.
The HR/ADMIN branch looks for `managerStatus: "APPROVED", hrStatus: "PENDING"`.
Those two conditions are mutually exclusive, so **an HR admin correctly sees
zero leaves** for records awaiting a *manager* — even though two are pending.

The MANAGER branch would find them, but only for employees whose `managerId`
equals that manager's employee id. The seeded employees have no `managerId`, so
no manager owns anything.

### Evidence 2 — parallel state on the same row

`LeaveRequest` carries **two independent status representations**:

| Field | Written by | Read by |
|---|---|---|
| `status` (PENDING_MANAGER, MANAGER_APPROVED, PENDING_HR, APPROVED, …) | `decideLeave()` — the state machine | the new state machine tests |
| `managerStatus`, `hrStatus` (PENDING, APPROVED) | `decideLeave()` also writes both | **the approvals dashboard** |

Both are written by the same action, which is the one saving grace — but the
page reads the legacy pair and ignores the authoritative `status`. This is the
duplication recorded in `EMPLOYEE_WORKFLOW_MATRIX.md`.

### Evidence 3 — service request vocabulary mismatch

The one `ServiceRequest` is `MANAGER_APPROVED`. The page filters
`status: "PENDING"`, so it is invisible. The service-request workflow advances
through a vocabulary the approvals page does not know about.

## Classification

| Code | Applicable? | Evidence |
|---|---|---|
| A. No pending records | **Partly** | 7 of 10 sources are genuinely empty |
| B. Query problem | **YES** | 3 sources queried of 10 |
| C. Authorization problem | **YES** | FINANCE is never assigned a branch |
| D. Scope problem | **YES** | manager scope keys on `managerId`, which no seeded employee has |
| E. Requests do not create approval records | **YES** | RoleRequest, OfferLetter, OffboardingRequest are never queried |
| F. Status mismatch | **YES** | `managerStatus` vs `status`; `MANAGER_APPROVED` vs `"PENDING"` |
| G. Approver resolution problem | **YES** | no approver field is resolved for most sources |
| H. UI state problem | No | the page renders what it is given |
| **I. Multiple** | **YES** | **B + C + D + E + F + G** |

## Sources the page does not query

| Source | Model | Has records? | Has its own queue? |
|---|---|---|---|
| Access/role requests | `RoleRequest` | no | yes — `/dashboard/request-access` |
| Offers | `OfferLetter` | no | no |
| Loan applications | `LoanApplication` | no | no |
| Salary advances | `SalaryAdvanceRequest` | no | no |
| Letters | `LetterApproval` | no | no |
| Offboarding | `OffboardingRequest` | no | no |
| Joining | `JoiningRecord` | no | no |
| Probation | `ProbationReview` | no | no |
| Recruitment pipeline | `Application` | 1 | no — `/recruitment` only |

**A candidate sitting at `SHORTLISTED` is invisible to every approval surface.**

## Per-source verdict

| Source | Request created? | Approval record? | Approver resolved? | In the queue? | Approve/reject? | Audit? | Notification? |
|---|---|---|---|---|---|---|---|
| Leave | yes | dual status columns | by role branch | partly, with a mismatch | yes (`approveLeaveManager`/`HR`) | yes | in-app |
| Staff request | yes | `ServiceApproval` | **not resolved** | with a mismatch | yes | yes | in-app |
| Visa | yes | **none** | none | yes | none — no visa approve action | **none** | **none** |
| Role request | yes | `RoleRequest` itself | yes (ADMIN) | separate page | yes | yes | in-app |
| Offer | yes | state machine | role-based | **no queue** | yes | yes | **none** |
| Offboarding | yes | state machine | role-based | **no queue** | yes | yes | **none** |

## Defects

| ID | Defect | Severity |
|---|---|---|
| `AP-01` | Approvals reads `managerStatus`/`hrStatus` while the authoritative field is `status` | **CRITICAL** |
| `AP-02` | 7 of 10 approval sources are never queried | **HIGH** |
| `AP-03` | Service-request queue filters `"PENDING"` but the workflow writes `MANAGER_APPROVED` first | **HIGH** |
| `AP-04` | FINANCE is never assigned a branch and sees an empty page with no explanation | **HIGH** |
| `AP-05` | Manager scope depends on `managerId`, which is nullable and unset for most employees | **HIGH** |
| `AP-06` | `VisaRequest` has no approval action and no audit entry | **HIGH** |
| `AP-07` | Offer and offboarding have transitions but no queue at all | **MEDIUM** |
| `AP-08` | No central approver-resolution service; every source resolves approvers differently | **MEDIUM** |
| `AP-09` | The page renders no empty-state explanation, so zero is indistinguishable from broken | **MEDIUM** |

## Note on what this audit did not do

No pending record was created to test the queue, because doing so would change
data. Every finding above is derived from reading the query, reading the
workflow that writes the statuses, and reading the current row values.
