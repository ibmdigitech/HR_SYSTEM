# PERFORMANCE SYSTEM AUDIT

## Executive Summary

A performance management module exists in the Prisma schema and has partial server-side and UI implementation, but it is not a fully connected workflow. The data model and basic CRUD pages are present; state machines, approvals, notifications, reporting, employee self-service, manager review workflows, and historical immutability are incomplete or missing.

---

## 1. Inventory

| Component | Exists | Location | Used? | Auth | Database | Status |
|-----------|--------|----------|-------|------|----------|--------|
| Performance models | YES | `prisma/schema.prisma:1684-1819` | Partial | N/A | YES | PARTIAL |
| Performance state machine | YES | `lib/workflow/performance-machine.ts` | NO | N/A | N/A | DEAD |
| Performance server actions | YES | `app/lib/actions/performance.ts` | Partial | YES | YES | PARTIAL |
| Performance API routes | NO | `app/api/performance/**` | NO | N/A | N/A | MISSING |
| Performance pages | YES | `app/performance/**` | Partial | YES | YES | PARTIAL |
| Performance sidebar | YES | `components/layout/Sidebar.tsx:50` | YES | YES | N/A | PARTIAL |
| Performance permissions | YES | `lib/auth/permissions.ts:109-112` | Partial | YES | N/A | PARTIAL |
| Performance notifications | NO | `app/lib/actions/notifications.ts` | NO | N/A | N/A | MISSING |
| Performance approval queue | NO | `app/dashboard/approvals/**` | NO | N/A | N/A | MISSING |
| Performance PDF/reporting | NO | N/A | NO | N/A | N/A | MISSING |
| Performance tests | NO | `tests/**` | NO | N/A | N/A | MISSING |

---

## 2. Data Model Audit

### Models Present

| Model | Fields | Status | Timestamps | Notes |
|-------|--------|--------|------------|-------|
| `PerformanceCycle` | id, name, type, startDate, endDate, status, selfAssessmentEnabled, managerReviewEnabled, calibrationEnabled, createdById | YES | YES | No deadline fields, no reopen flag |
| `PerformanceReview` | id, cycleId, employeeId, managerId, status, overallRating, overallComment, selfAssessmentAt, managerReviewAt, calibrationAt, approvedAt, approvedById, acknowledgedAt, acknowledgedById | YES | YES | No version, no lock flag |
| `PerformanceGoal` | id, reviewId, title, description, weight, target, actual, rating, comment, order | YES | YES | No due date, no progress %, no status |
| `PerformanceQuestion` | id, cycleId, text, type, audience, weight, order, isRequired, options | YES | YES | No category, no helpText, no visibility flags |
| `PerformanceAnswer` | id, reviewId, questionId, answeredBy, answer, rating | YES | YES | No timestamp per answer beyond createdAt |
| `ReviewScenario` | id, name, description, rating, behaviors, isActive, order | YES | YES | No link to cycles or reviews |

### Model Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **PERF-MODEL-01** | No version/immutability on `PerformanceReview` | `prisma/schema.prisma:1713-1744` | HIGH |
| **PERF-MODEL-02** | No `lock`/`freeze` flag on completed reviews | `prisma/schema.prisma:1713-1744` | HIGH |
| **PERF-MODEL-03** | No `deadline` or `dueDate` on cycles or reviews | `prisma/schema.prisma:1692-1710` | MEDIUM |
| **PERF-MODEL-04** | No `reopen`/`reopenCount` on reviews | `prisma/schema.prisma:1713-1744` | MEDIUM |
| **PERF-MODEL-05** | `ReviewScenario` not connected to cycles or reviews | `prisma/schema.prisma:1807-1819` | LOW |
| **PERF-MODEL-06** | `PerformanceQuestion.options` is `Json?` but no validation | `prisma/schema.prisma:1779` | LOW |

---

## 3. State Machine Audit

### Current State Machine

File: `lib/workflow/performance-machine.ts`

The file defines:
- `CYCLE_TRANSITIONS`: PLANNING → ACTIVE, ARCHIVED; ACTIVE → CLOSED; CLOSED → ARCHIVED
- `REVIEW_TRANSITIONS`: DRAFT → SELF_ASSESSMENT, MANAGER_REVIEW, CANCELLED; SELF_ASSESSMENT → MANAGER_REVIEW, DRAFT; MANAGER_REVIEW → CALIBRATION, APPROVED, SELF_ASSESSMENT; CALIBRATION → APPROVED, MANAGER_REVIEW; APPROVED → ACKNOWLEDGED

### Integration Status

| Integration Point | Expected | Actual | Status |
|-------------------|----------|--------|--------|
| Server actions enforce transitions | YES | NO | BROKEN |
| UI uses transition guards | YES | NO | BROKEN |
| Cycle flags control review paths | YES | NO | BROKEN |
| Invalid transitions rejected | YES | NO | BROKEN |

### Evidence

- `app/lib/actions/performance.ts:176-205` (`updatePerformanceReview`) accepts any `status` string and writes it directly without calling `assertTransition` or checking cycle flags.
- `app/performance/cycles/new/page.tsx` creates cycles but does not validate type against allowed enum.
- `app/performance/reviews/[id]/page.tsx` displays status but does not expose transition controls.

**Verdict: The state machine exists as a pure utility but is dead code. No runtime path enforces it.**

---

## 4. Page / Route Audit

| Route | File | Auth | Database | State Machine | Notifications | Status |
|-------|------|------|----------|---------------|---------------|--------|
| `/performance` | `app/performance/page.tsx` | YES | YES | NO | NO | PARTIAL |
| `/performance/cycles/new` | `app/performance/cycles/new/page.tsx` | YES | YES | NO | NO | PARTIAL |
| `/performance/cycles/[id]` | `app/performance/cycles/[id]/page.tsx` | YES | YES | NO | NO | PARTIAL |
| `/performance/cycles/[id]/add-reviews` | `app/performance/cycles/[id]/add-reviews/page.tsx` | YES | YES | NO | NO | PARTIAL |
| `/performance/reviews/[id]` | `app/performance/reviews/[id]/page.tsx` | YES | YES | NO | NO | PARTIAL |
| `/performance/reviews/[id]/goals/new` | `app/performance/reviews/[id]/goals/new/page.tsx` | YES | YES | NO | NO | PARTIAL |

### Page-Level Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **PERF-PAGE-01** | No employee self-assessment UI | `app/performance/reviews/[id]/page.tsx` shows goals/questions read-only | HIGH |
| **PERF-PAGE-02** | No manager review submission UI | Same file; no submit/review form | HIGH |
| **PERF-PAGE-03** | No calibration UI | Status shown but no calibration action | MEDIUM |
| **PERF-PAGE-04** | No employee acknowledgement UI | Status shown but no acknowledge button | MEDIUM |
| **PERF-PAGE-05** | No review history/previous cycles | No previous-reviews query | MEDIUM |
| **PERF-PAGE-06** | No scope filtering in UI for managers | `getPerformanceReviews()` returns all | HIGH |

---

## 5. Server Action Audit

| Action | Auth | Database | State Machine | Audit Log | Revalidation | Status |
|--------|------|----------|---------------|-----------|--------------|--------|
| `getPerformanceCycles` | YES | YES | NO | NO | YES | PARTIAL |
| `getPerformanceCycleById` | YES | YES | NO | NO | YES | PARTIAL |
| `createPerformanceCycle` | YES | YES | NO | NO | YES | PARTIAL |
| `getPerformanceReviews` | YES | YES | NO | NO | YES | PARTIAL |
| `getPerformanceReviewById` | YES | YES | NO | NO | YES | PARTIAL |
| `createPerformanceReview` | YES | YES | NO | NO | YES | PARTIAL |
| `updatePerformanceReview` | YES | YES | NO | NO | YES | PARTIAL |
| `createPerformanceGoal` | YES | YES | NO | NO | YES | PARTIAL |
| `updatePerformanceGoal` | YES | YES | NO | NO | YES | PARTIAL |
| `getPerformanceQuestions` | YES | YES | NO | NO | NO | PARTIAL |
| `submitPerformanceAnswer` | YES | YES | NO | NO | YES | PARTIAL |
| `getReviewScenarios` | YES | YES | NO | NO | NO | PARTIAL |

### Server Action Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **PERF-ACT-01** | No IDOR scoping on `getPerformanceCycles` | Returns all cycles to any authorized user | HIGH |
| **PERF-ACT-02** | No IDOR scoping on `getPerformanceReviews` | Returns all reviews to any authorized user | HIGH |
| **PERF-ACT-03** | No audit log on any performance action | No `prisma.auditLog.create` calls | MEDIUM |
| **PERF-ACT-04** | `updatePerformanceReview` allows any status | `formData.get("status")` written directly | HIGH |
| **PERF-ACT-05** | No notification dispatch on state changes | No `prisma.notification.create` calls | MEDIUM |
| **PERF-ACT-06** | `submitPerformanceAnswer` allows any `answeredBy` | Client-supplied, not verified against session | MEDIUM |
| **PERF-ACT-07** | No revalidation on `getPerformanceQuestions` | Only `revalidatePath("/performance")` on some actions | LOW |

---

## 6. RBAC Audit

### Current Permissions

| Permission | Code | Granted To |
|------------|------|------------|
| `performance.view` | `PERFORMANCE_VIEW` | ADMIN only (`lib/auth/permissions.ts:261`) |
| `performance.review` | `PERFORMANCE_REVIEW` | ADMIN, HR (`lib/auth/permissions.ts:240,261`) |
| `performance.approve` | `PERMISSION_APPROVE` | ADMIN, HR (`lib/auth/permissions.ts:240,261`) |

### Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **PERF-RBAC-01** | STAFF/MANAGER cannot view performance | `PERFORMANCE_VIEW` not in STAFF/MANAGER grants | HIGH |
| **PERF-RBAC-02** | No `PERFORMANCE_CREATE` permission | Cycle creation uses `PERFORMANCE_REVIEW` | LOW |
| **PERF-RBAC-03** | No employee-scoped read permission | All-or-nothing grants | HIGH |
| **PERF-RBAC-04** | No manager-scoped read permission | Managers cannot see direct reports' reviews | HIGH |

---

## 7. Notification Audit

| Event | Expected | Actual | Status |
|-------|----------|--------|--------|
| Cycle created | YES | NO | MISSING |
| Self review due | YES | NO | MISSING |
| Manager review due | YES | NO | MISSING |
| Review overdue | YES | NO | MISSING |
| Review submitted | YES | NO | MISSING |
| HR review required | YES | NO | MISSING |
| Final review completed | YES | NO | MISSING |
| Acknowledgement required | YES | NO | MISSING |
| Review closed | YES | NO | MISSING |

**Verdict: No performance notifications are implemented.**

---

## 8. Approval Workflow Audit

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Pending performance reviews in queue | YES | NO | MISSING |
| Manager approval | YES | NO | MISSING |
| HR approval | YES | NO | MISSING |
| Calibration | YES | NO | MISSING |
| Final approval | YES | NO | MISSING |
| Rejection/resubmission | YES | NO | MISSING |

**Verdict: Performance reviews do not integrate with `/dashboard/approvals`.**

---

## 9. Reporting & History Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Employee performance history | YES | NO | MISSING |
| Department performance | YES | NO | MISSING |
| Completion rate | YES | NO | MISSING |
| Average scores | YES | NO | MISSING |
| Rating distribution | YES | NO | MISSING |
| Overdue reviews | YES | NO | MISSING |
| Export reports | YES | NO | MISSING |
| Historical immutability | YES | NO | MISSING |

---

## 10. Probation Integration Audit

| Integration | Expected | Actual | Status |
|-------------|----------|--------|--------|
| Probation review template | YES | NO | MISSING |
| Confirmation recommendation | YES | NO | MISSING |
| Auto-create review at joining | YES | NO | MISSING |

**Evidence**: `prisma/schema.prisma:232-257` defines `ProbationReview` with ratings and recommendations, but no server action or page connects it to `PerformanceCycle`/`PerformanceReview`.

---

## 11. Recommendations

| Priority | Recommendation | Rationale |
|----------|----------------|-----------|
| P0 | Integrate state machine into server actions | Current machine is dead code |
| P0 | Add IDOR scoping to all performance reads | Security risk |
| P1 | Add notifications for state changes | Workflow incomplete |
| P1 | Connect performance to approvals queue | Missing workflow step |
| P1 | Add employee self-assessment UI | Core workflow missing |
| P1 | Add manager review submission UI | Core workflow missing |
| P2 | Add historical immutability/lock | Data integrity |
| P2 | Add reporting/analytics | Management visibility |
| P2 | Add probation auto-link | Integration gap |
| P3 | Add performance tests | Coverage gap |

AUDIT COMPLETE

Performance System:
PARTIAL

Critical Findings:
- State machine defined but not enforced
- No IDOR scoping on list reads
- No notifications or approval integration
- No employee self-service UI
- No historical immutability
