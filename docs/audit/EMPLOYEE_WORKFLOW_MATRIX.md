# EMPLOYEE WORKFLOW MATRIX

**Date**: 2026-09-28 · Read-only audit. No code changed.

Status key: `PASS` wired end to end · `PARTIAL` model+logic but no UI or no scheduler · `MISSING` absent · `BROKEN` present but cannot function

| # | Workflow | State | Action | Actor | Permission | Server Logic | Database | Approval | Notification | Audit | Next State |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Workforce request** | PARTIAL | `createRequisition` | HR, Manager, Admin | `recruitment.create` | `createRequisition` | `JobRequisition` | via `REQUISITION_TRANSITIONS` | none | `REQUISITION_*` | DRAFT |
| 2 | **Requisition approval** | PASS | `RequisitionStatusControl` | Manager, HR, Finance, Admin | `recruitment.approve` | `transitionRequisition` (race-guarded `updateMany`) | same | **is** the approval | none | `REQUISITION_<T>` | SUBMITTED→…→APPROVED |
| 3 | **Job posting** | PARTIAL | none | — | — | `JOB_TRANSITIONS` guard exists | no Job model | — | — | — | — |
| 4 | **Candidate creation** | PASS | form | HR | `recruitment.create` | `applyToJob` — **upsert by email** | `Candidate` | — | — | `APPLICATION_RECEIVED` | — |
| 5 | **Application** | PASS | form | HR | `recruitment.create` | dedup: one live per candidate+job (`@@unique`) | `Application` | — | in-app | `APPLICATION_RECEIVED` | APPLIED |
| 6 | **Screening** | PASS | form | HR | `recruitment.edit` | `recordScreening` | `Application.screening*` | — | — | `APPLICATION_<T>` | SCREENING |
| 7 | **Interview schedule** | PASS | `ScheduleInterviewForm` | HR | `recruitment.interview` | `scheduleInterview` — **panel + double-booking checks** | `Interview`, `InterviewParticipant` | — | none | `INTERVIEW_SCHEDULED` | SCHEDULED |
| 8 | **Interview panel** | PASS | same | HR | `recruitment.interview` | `@@unique([interviewId, interviewerId])` | `InterviewParticipant` | — | — | — | — |
| 9 | **Interview feedback** | PASS | `FeedbackForm` | panel member only | `recruitment.interview` | `submitInterviewFeedback` — **per-participant isolation** | `InterviewFeedback` `@@unique([participantId])` | — | — | `INTERVIEW_FEEDBACK_SUBMITTED` | — |
| 10 | **Assessment** | **MISSING** | none | — | — | none | `Assessment` exists | — | — | — | — |
| 11 | **Selection** | PASS | state machine | HR | `recruitment.edit` | `APPLICATION_TRANSITIONS` | `Application.status=SELECTED` | — | — | `APPLICATION_SELECTED` | SELECTED |
| 12 | **Mark hired** | PASS | none in UI | HR | `recruitment.convert` | `markHired` | `Application=HIRED` | — | — | `APPLICATION_HIRED` | HIRED |
| 13 | **Offer create** | PASS | `CreateOfferForm` | HR | `recruitment.offer` | `createOffer` — versioned | `OfferLetter` `@@unique([candidateId,version])` | — | — | `OFFER_CREATED` | DRAFT |
| 14 | **Offer approval** | PASS | `OfferActions` | Finance, HR, Admin | `recruitment.offer` | `transitionOffer` | same | **is** the approval | — | `OFFER_<T>` | PENDING_APPROVAL→APPROVED |
| 15 | **Offer send** | PARTIAL | `OfferActions` | HR | `recruitment.offer` | state change only | `status=SENT` | — | **none — no delivery** | `OFFER_SENT` | SENT |
| 16 | **Offer viewed** | PARTIAL | manual | HR | `recruitment.offer` | state change only | `status=VIEWED` | — | **none** | `OFFER_VIEWED` | VIEWED |
| 17 | **Offer letter** | PASS | `OfferActions` | HR | `recruitment.offer` | `issueOfferLetter` — reuses existing PDF engine | `Letter` | — | — | `OFFER_LETTER_ISSUED` | — |
| 18 | **Offer acceptance** | PASS | `OfferActions` | HR | `recruitment.offer` | `transitionOffer(→ACCEPTED)` + advances Application | `acceptedAt`, `acceptanceMethod` | — | none | `OFFER_ACCEPTED` | ACCEPTED |
| 19 | **Preboarding** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 20 | **Employee entry (full)** | PASS | `New Master Entry` | HR, Admin | `employees.create` | `upsertEmployee` | `User`+`Employee` in one transaction | — | `Welcome aboard` | `EMPLOYEE_ONBOARDED` | — |
| 21 | **Employee entry (staged)** | **BROKEN** | "Save as provisional" | HR, Admin | `employees.create` | passes validation, then **Prisma rejects** | NOT NULL columns | — | — | — | — |
| 22 | **Joining** | PARTIAL | `CompleteJoining` (not wired) | HR | `recruitment.convert` | `completeJoining` — one transaction | Employee+User+Salary+Leave+Probation+JoiningRecord | — | welcome | `EMPLOYEE_JOINED` | HIRED |
| 23 | **Onboarding checklist** | PARTIAL | none | — | `onboarding.manage` | `ensureChecklist` + `updateChecklistItem` | `OnboardingChecklistItem` | per-item PENDING→COMPLETED | — | `ONBOARDING_ITEM_<T>` | — |
| 24 | **Equipment** | PARTIAL | none | — | `onboarding.manage` | `assignAssets` (AVAILABLE only) | `Asset`, `AssetAssignment` | checklist item | — | `ASSETS_ASSIGNED` | — |
| 25 | **User provisioning** | PASS | automatic | — | — | inside the employee transaction | `User.password = null` | — | activation token | `USER_*` | — |
| 26 | **Login activation** | PASS | `/activate/[token]` | employee | none (token **is** the credential) | `completePasswordChange` — 12-char policy | `PasswordResetToken` (hashed) | — | — | — | — |
| 27 | **Access control** | PASS | — | — | `recruitment.convert` | `lib/auth/guards.ts` — 7 guards | `User.role` + `UserSecurityFlag` | — | — | `ACCESS_DENIED` | — |
| 28 | **Probation** | PARTIAL | none | — | — | created at joining only | `ProbationReview` | — | — | — | NOT_STARTED |
| 29 | **Confirmation** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 30 | **Active employment** | PASS | — | — | per-module | attendance/leave/payroll/letters all keyed on `Employee` | — | — | — | per-module | — |
| 31 | **Transfer** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 32 | **Promotion** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 33 | **Salary revision** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 34 | **Resignation** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 35 | **Notice period** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 36 | **Exit interview** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 37 | **Termination** | **MISSING** | — | — | — | — | — | — | — | — | — |
| 38 | **Clearance** | PARTIAL | none | — | `exit.clearance` | `updateChecklistItem` | `OffboardingChecklistItem` | per-item | — | `OFFBOARDING_ITEM_<T>` | — |
| 39 | **Final settlement** | PARTIAL | none | — | `exit.settlement` | `prepareSettlement`, `advanceSettlement` | `FinalSettlement` | `SETTLEMENT_TRANSITIONS` | — | `SETTLEMENT_<T>` | DRAFT→…→PAID |
| 40 | **Asset return** | PARTIAL | none | — | — | none (no `returnAsset`) | `AssetAssignment.returnedAt` | — | — | — | — |
| 41 | **Access revocation** | PARTIAL | none | — | `employees.edit` | `revokeAccess` — disables + nulls password | `UserSecurityFlag` | — | — | `ACCESS_REVOKED` | — |
| 42 | **Exit documents** | PARTIAL | relieving-letter page | HR | `letters.*` | existing Letters engine | `Letter` | `LETTER_TRANSITIONS` | — | `LETTER_<T>` | — |
| 43 | **Rehire** | **MISSING** | — | — | — | — | — | — | — | — | — |

---

## Cross-module integrity

`Employee` is the hub. `User`, `SalaryStructure`, `LeaveBalance`,
`Attendance`, `LetterRecord`, `OnboardingChecklistItem`, `ProbationReview`,
`JoiningRecord` and `AssetAssignment` all reference it.

**No dangling references found.** The only asymmetry:

- `Employee.userId` is **required**, so every Employee must have a User.
- `User.employee` is optional, so a User may exist with no Employee — correct
  for an admin who has not been onboarded.

**Duplicated implementations** (details in `LIFECYCLE_GAPS.md`):

| Concern | Implementation A | Implementation B | Authoritative? |
|---|---|---|---|
| Leave state | `LeaveRequest.status` (P1 state machine) | `managerStatus` + `hrStatus` (legacy, used by approvals UI) | **Neither** — the approvals page reads B, the action writes A |
| Employment state | `Employee.currentStatus` | `Employee.isActive` | **Neither** — `lifecycle` is the intended one and is barely used |
| Role check | `lib/auth/guards.ts` | inline `["ADMIN","HR"].includes(role)` in ~15 files | **A**, but not fully migrated |
