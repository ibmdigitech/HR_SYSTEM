# PERFORMANCE WORKFLOW MATRIX

## Executive Summary

The performance workflow is partially implemented at the database and basic CRUD page level, but the end-to-end chain from cycle creation through employee acknowledgement is broken. The state machine exists as dead code, approvals/notifications are missing, and several core steps have no UI or server enforcement.

---

## 1. Workflow Trace: Cycle Creation → Archive

```
HR creates Performance Cycle
    ↓
UI: /performance/cycles/new
    ↓
Server Action: createPerformanceCycle
    ↓
Auth: requireAnyPermission(PERFORMANCE_VIEW, PERFORMANCE_REVIEW)
    ↓
Database: INSERT PerformanceCycle
    ↓
State Change: PLANNING
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Manual navigation to add employees
```

| Step | Status | Evidence |
|------|--------|----------|
| UI | PARTIAL | `app/performance/cycles/new/page.tsx` exists |
| Server Action | PARTIAL | `app/lib/actions/performance.ts:53-93` |
| Authorization | PARTIAL | Uses `PERFORMANCE_REVIEW` for creation, not a dedicated create permission |
| Database | PASS | `prisma/schema.prisma:1692-1710` |
| State Machine | BROKEN | `lib/workflow/performance-machine.ts` not called |
| Approval | MISSING | No approval queue entry |
| Notification | MISSING | No `prisma.notification.create` |
| Audit Log | MISSING | No `prisma.auditLog.create` |

---

## 2. Workflow Trace: Add Employees to Cycle

```
HR selects employees
    ↓
UI: /performance/cycles/[id]/add-reviews
    ↓
Server Action: createPerformanceReview (per employee)
    ↓
Auth: requireAnyPermission(PERFORMANCE_VIEW, PERFORMANCE_REVIEW)
    ↓
Database: INSERT PerformanceReview (status: DRAFT)
    ↓
State Change: DRAFT
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Employee self-assessment
```

| Step | Status | Evidence |
|------|--------|----------|
| UI | PARTIAL | `app/performance/cycles/[id]/add-reviews/page.tsx` exists |
| Server Action | PARTIAL | `app/lib/actions/performance.ts:142-174` |
| Authorization | PARTIAL | No employee-scoped restriction |
| Database | PASS | `prisma/schema.prisma:1713-1744` |
| State Machine | BROKEN | Not enforced |
| Approval | MISSING | N/A |
| Notification | MISSING | N/A |
| Audit Log | MISSING | N/A |

---

## 3. Workflow Trace: Employee Self-Assessment

```
Employee opens review
    ↓
UI: EXPECTED BUT MISSING
    ↓
Server Action: EXPECTED BUT MISSING
    ↓
Auth: EXPECTED BUT MISSING
    ↓
Database: UPDATE PerformanceReview + INSERT/UPDATE PerformanceAnswer
    ↓
State Change: SELF_ASSESSMENT
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Manager review
```

| Step | Status | Evidence |
|------|--------|----------|
| UI | MISSING | No self-assessment page or form |
| Server Action | MISSING | `submitPerformanceAnswer` exists but no workflow action to advance status |
| Authorization | MISSING | No EMPLOYEE-scoped action |
| Database | PARTIAL | `PerformanceAnswer` model exists |
| State Machine | BROKEN | Not enforced |
| Approval | MISSING | N/A |
| Notification | MISSING | N/A |
| Audit Log | MISSING | N/A |

---

## 4. Workflow Trace: Manager Review

```
Manager opens review
    ↓
UI: EXPECTED BUT MISSING
    ↓
Server Action: EXPECTED BUT MISSING
    ↓
Auth: EXPECTED BUT MISSING
    ↓
Database: UPDATE PerformanceReview + INSERT/UPDATE PerformanceAnswer + UPDATE PerformanceGoal
    ↓
State Change: MANAGER_REVIEW
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Calibration or approval
```

| Step | Status | Evidence |
|------|--------|----------|
| UI | MISSING | No manager review form |
| Server Action | PARTIAL | `updatePerformanceReview` accepts any status |
| Authorization | MISSING | No MANAGER-scoped action |
| Database | PARTIAL | Models exist |
| State Machine | BROKEN | Not enforced |
| Approval | MISSING | N/A |
| Notification | MISSING | N/A |
| Audit Log | MISSING | N/A |

---

## 5. Workflow Trace: Calibration

```
HR/ADMIN calibrates ratings
    ↓
UI: EXPECTED BUT MISSING
    ↓
Server Action: EXPECTED BUT MISSING
    ↓
Auth: EXPECTED BUT MISSING
    ↓
Database: UPDATE PerformanceReview
    ↓
State Change: CALIBRATION
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Final approval
```

| Step | Status | Evidence |
|------|--------|----------|
| UI | MISSING | No calibration UI |
| Server Action | MISSING | No dedicated action |
| Authorization | MISSING | No HR-specific calibration action |
| Database | PARTIAL | `status` field can hold `CALIBRATION` |
| State Machine | BROKEN | Not enforced |
| Approval | MISSING | N/A |
| Notification | MISSING | N/A |
| Audit Log | MISSING | N/A |

---

## 6. Workflow Trace: Final Approval

```
HR/ADMIN approves
    ↓
UI: EXPECTED BUT MISSING
    ↓
Server Action: EXPECTED BUT MISSING
    ↓
Auth: EXPECTED BUT MISSING
    ↓
Database: UPDATE PerformanceReview
    ↓
State Change: APPROVED
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Employee acknowledgement
```

---

## 7. Workflow Trace: Employee Acknowledgement

```
Employee acknowledges review
    ↓
UI: EXPECTED BUT MISSING
    ↓
Server Action: EXPECTED BUT MISSING
    ↓
Auth: EXPECTED BUT MISSING
    ↓
Database: UPDATE PerformanceReview
    ↓
State Change: ACKNOWLEDGED
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Closed/archived
```

---

## 8. Workflow Trace: Close and Archive

```
HR/ADMIN closes cycle
    ↓
UI: EXPECTED BUT MISSING
    ↓
Server Action: EXPECTED BUT MISSING
    ↓
Auth: EXPECTED BUT MISSING
    ↓
Database: UPDATE PerformanceCycle + PerformanceReview
    ↓
State Change: CLOSED → ARCHIVED
    ↓
Approval: NONE
    ↓
Notification: NONE
    ↓
Audit Log: NONE
    ↓
Next Step: Historical record
```

---

## 9. Missing Workflow Steps Summary

| Step | Status | Severity |
|------|--------|----------|
| HR creates cycle | PARTIAL | LOW |
| HR adds employees | PARTIAL | LOW |
| Employee self-assessment | MISSING | HIGH |
| Manager review | MISSING | HIGH |
| Calibration | MISSING | MEDIUM |
| Final approval | MISSING | MEDIUM |
| Employee acknowledgement | MISSING | MEDIUM |
| Close/archive | MISSING | LOW |
| Notifications | MISSING | HIGH |
| Approval queue | MISSING | HIGH |
| Audit logging | MISSING | MEDIUM |

---

## 10. Dead / Unreachable Code

| File | Status | Evidence |
|------|--------|----------|
| `lib/workflow/performance-machine.ts` | DEAD | Defined but never imported or called by any server action, page, or API route |

---

## 11. Recommendations

| Priority | Recommendation |
|----------|----------------|
| P0 | Enforce state machine in `updatePerformanceReview` and add dedicated transition actions |
| P0 | Build employee self-assessment UI and manager review UI |
| P0 | Add IDOR scoping to all performance reads |
| P1 | Add notifications for every state change |
| P1 | Connect performance to `/dashboard/approvals` |
| P1 | Add audit logging to all state changes |
| P2 | Add calibration UI |
| P2 | Add employee acknowledgement UI |
| P2 | Add historical lock after ACKNOWLEDGED |
| P3 | Remove dead state machine or integrate it |

AUDIT COMPLETE

Performance Workflow:
BROKEN

Critical Findings:
- State machine defined but dead
- No employee self-assessment or manager review UI
- No notifications or approval integration
- No audit logging on state changes
