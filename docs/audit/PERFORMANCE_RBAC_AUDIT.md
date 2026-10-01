# PERFORMANCE RBAC AUDIT

## Executive Summary

Performance permissions are defined but narrowly granted. Only ADMIN and HR can view or manage performance. STAFF and MANAGER roles have no access, meaning employees cannot see their own reviews and managers cannot see their team's reviews. IDOR scoping is also absent from server actions.

---

## 1. Permission Definitions

| Permission | Code | File | Line |
|------------|------|------|------|
| `performance.view` | `PERFORMANCE_VIEW` | `lib/auth/permissions.ts` | 110 |
| `performance.review` | `PERFORMANCE_REVIEW` | `lib/auth/permissions.ts` | 111 |
| `performance.approve` | `PERFORMANCE_APPROVE` | `lib/auth/permissions.ts` | 112 |

---

## 2. Role Grants

| Role | PERFORMANCE_VIEW | PERFORMANCE_REVIEW | PERFORMANCE_APPROVE | Evidence |
|------|------------------|--------------------|---------------------|----------|
| SUPER_ADMIN | YES | YES | YES | `lib/auth/permissions.ts:261-268` |
| ADMIN | YES | YES | YES | `lib/auth/permissions.ts:245-268` |
| HR | NO | YES | YES | `lib/auth/permissions.ts:207-243` |
| MANAGER | NO | NO | NO | `lib/auth/permissions.ts:179-187` |
| STAFF | NO | NO | NO | `lib/auth/permissions.ts:162-176` |
| FINANCE | NO | NO | NO | `lib/auth/permissions.ts:190-205` |

---

## 3. Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **PERF-RBAC-01** | HR cannot view performance (`PERFORMANCE_VIEW` missing) | `lib/auth/permissions.ts:207-243` | HIGH |
| **PERF-RBAC-02** | MANAGER cannot view team reviews | `lib/auth/permissions.ts:179-187` | HIGH |
| **PERF-RBAC-03** | STAFF cannot view own reviews | `lib/auth/permissions.ts:162-176` | HIGH |
| **PERF-RBAC-04** | No employee-scoped read permission | All-or-nothing grants | HIGH |
| **PERF-RBAC-05** | No manager-scoped read permission | Managers excluded entirely | HIGH |
| **PERF-RBAC-06** | No `PERFORMANCE_CREATE` permission | Cycle creation uses `PERFORMANCE_REVIEW` | LOW |
| **PERF-RBAC-07** | No `PERFORMANCE_MANAGE` permission | Cannot distinguish review from configuration | LOW |

---

## 4. IDOR Scoping Audit

| Action | Expected Scoping | Actual | Status |
|--------|------------------|--------|--------|
| `getPerformanceCycles` | All authorized users | All cycles returned | BROKEN |
| `getPerformanceCycleById` | All authorized users | Any cycle returned | BROKEN |
| `getPerformanceReviews` | Own + team (role-dependent) | All reviews returned | BROKEN |
| `getPerformanceReviewById` | Own + team (role-dependent) | Any review returned | BROKEN |

### Evidence

- `app/lib/actions/performance.ts:13-27` (`getPerformanceCycles`) has no employeeId, managerId, or department filter.
- `app/lib/actions/performance.ts:99-118` (`getPerformanceReviews`) accepts optional `cycleId` but no employee/manager scope.
- No `scopeEmployeeWhere` or equivalent is used, unlike `app/api/letters/route.ts:30`.

---

## 5. UI Authorization Audit

| Page | Current Auth | Correct? | Issue |
|------|--------------|----------|-------|
| `/performance` | `requirePageAnyPermission(PERFORMANCE_VIEW, PERFORMANCE_REVIEW, PERFORMANCE_APPROVE)` | PARTIAL | STAFF/MANAGER excluded |
| `/performance/cycles/new` | Inherits page guard | PARTIAL | Only HR/ADMIN should create |
| `/performance/cycles/[id]` | Inherits page guard | PARTIAL | Employees should see own reviews |
| `/performance/cycles/[id]/add-reviews` | Inherits page guard | PARTIAL | Only HR/ADMIN |
| `/performance/reviews/[id]` | Inherits page guard | PARTIAL | Employees should see own |
| `/performance/reviews/[id]/goals/new` | Inherits page guard | PARTIAL | Only HR/ADMIN/manager |

---

## 6. Recommendations

| Priority | Recommendation |
|----------|----------------|
| P0 | Add `PERFORMANCE_VIEW` to HR role grant |
| P0 | Add performance permissions to MANAGER role (team scope) |
| P0 | Add performance permissions to STAFF role (own scope) |
| P0 | Add IDOR scoping to all performance server actions |
| P1 | Add `scopeEmployeeWhere` equivalent for performance |
| P1 | Add manager-scoped review queries |
| P1 | Add employee-scoped review queries |
| P2 | Add `PERFORMANCE_CREATE` and `PERFORMANCE_MANAGE` permissions |

AUDIT COMPLETE

Performance RBAC:
BROKEN

Critical Findings:
- HR missing PERFORMANCE_VIEW
- MANAGER and STAFF have no performance access
- No IDOR scoping on any performance query
- No employee or manager scope in server actions
