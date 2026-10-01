# PERFORMANCE DOCUMENT RECOMMENDATIONS

## Executive Summary

Both the performance module and the company document portal are partial implementations. This document consolidates the highest-priority gaps and recommends an ordered implementation sequence that respects existing patterns, security requirements, and data integrity.

---

## 1. Critical Gaps (P0)

### Performance

| Gap | Evidence | Recommendation |
|-----|----------|----------------|
| State machine not enforced | `lib/workflow/performance-machine.ts` is dead code | Integrate `assertTransition` into every status-changing server action |
| No IDOR scoping | `app/lib/actions/performance.ts:13-118` returns all data | Add employee/manager/department scope to all list/detail actions |
| No employee self-assessment UI | `app/performance/reviews/[id]/page.tsx` read-only | Build self-assessment form with answer submission |
| No manager review UI | Same file | Build manager review form with goal rating and answer submission |
| HR missing PERFORMANCE_VIEW | `lib/auth/permissions.ts:207-243` | Add `PERFORMANCE_VIEW` to HR grants |

### Company Documents

| Gap | Evidence | Recommendation |
|-----|----------|----------------|
| No sidebar navigation | `components/layout/Sidebar.tsx` | Add Company Documents link under Administration |
| No document-level authorization | `app/lib/actions/company-documents.ts:9-133` | Add role/department scoping to queries |
| No secure download | `fileUrl` exposed as raw string | Build download API with auth + audit log |
| No access for MANAGER/STAFF | `lib/auth/permissions.ts:179-187,162-176` | Add document view permission to broader roles |

---

## 2. High-Priority Gaps (P1)

### Performance

| Gap | Recommendation |
|-----|----------------|
| No notifications | Add `prisma.notification.create` on every state transition |
| No approval queue integration | Add performance to `/dashboard/approvals` |
| No audit logging | Add `prisma.auditLog.create` on every mutation |
| No calibration UI | Build calibration page with rating adjustment |
| No employee acknowledgement UI | Build acknowledgement action and UI |
| `answeredBy` not verified | Verify caller identity against session in `submitPerformanceAnswer` |

### Company Documents

| Gap | Recommendation |
|-----|----------------|
| No search/filter | Add category, type, and text search to list page |
| No version history UI | Build version history with diff/rollback |
| No approval workflow | Add status field and approval queue |
| No expiry reminders | Link to `DocumentExpiryReminder` system |
| `publishedBy` not a relation | Convert to `@relation` to `User` |

---

## 3. Medium-Priority Gaps (P2)

### Performance

| Gap | Recommendation |
|-----|----------------|
| No historical immutability | Add `version` and `lock` fields to `PerformanceReview` |
| No deadline fields | Add `deadline` to `PerformanceCycle` and `dueDate` to `PerformanceGoal` |
| No question categories | Add `category` and `helpText` to `PerformanceQuestion` |
| No visibility controls | Add `employeeVisible`/`managerVisible`/`hrVisible` |
| No scoring calculation | Add weighted scoring service for goals and questions |
| No probation linkage | Auto-create `PerformanceReview` from `ProbationReview` |
| No reporting | Add dashboard widgets and export |

### Company Documents

| Gap | Recommendation |
|-----|----------------|
| No enum enforcement | Convert `type` and `category` to Prisma enums |
| No indexes on title/date | Add indexes for search and sorting |
| No file size/tracking | Add `fileSize` and `changeSummary` |
| No department scoping | Add `department` field for access control |

---

## 4. Low-Priority Gaps (P3)

### Performance

| Gap | Recommendation |
|-----|----------------|
| No `PERFORMANCE_CREATE` permission | Split create from review permission |
| No `PERFORMANCE_MANAGE` permission | Add manage permission for configuration |
| No tests | Add unit and integration tests for actions and state machine |
| No API routes | Consider REST API for external integrations |

### Company Documents

| Gap | Recommendation |
|-----|----------------|
| No preview UI | Add inline preview for common file types |
| No pagination | Add cursor-based pagination |
| No tags | Add tag system for flexible categorization |

---

## 5. Recommended Implementation Order

```text
PHASE 0
Architecture decisions
- Choose permission model for document access (role-based vs ACL)
- Choose state machine enforcement strategy (centralized vs per-action)

PHASE 1
Security + RBAC
- Fix performance IDOR scoping
- Add PERFORMANCE_VIEW to HR
- Extend document access to MANAGER/STAFF
- Add document-level authorization

PHASE 2
Performance data model
- Add version/lock to PerformanceReview
- Add deadline/dueDate fields
- Add question visibility controls

PHASE 3
Question bank + templates
- Build question CRUD UI
- Add question categories and help text
- Add visibility enforcement

PHASE 4
Performance cycle workflow
- Integrate state machine into server actions
- Add audit logging to all mutations
- Add notifications for state changes

PHASE 5
Self review + manager review
- Build employee self-assessment UI
- Build manager review UI
- Verify answeredBy against session

PHASE 6
Scoring + KPI integration
- Add weighted scoring service
- Add goal progress tracking
- Add rating calculation

PHASE 7
Approvals + notifications
- Connect performance to /dashboard/approvals
- Add notification templates for all events
- Add email channel if required

PHASE 8
Performance history + reporting
- Add dashboard widgets
- Add export functionality
- Add historical lock after acknowledgement

PHASE 9
Company document portal
- Add sidebar navigation
- Add search/filter
- Add version history UI

PHASE 10
Document versioning + approval
- Add approval status field
- Add approval queue integration
- Add version diff/rollback

PHASE 11
Document search + secure downloads
- Add search indexes
- Build download API with auth + audit
- Add signed URLs

PHASE 12
Employee self-service
- Extend document access to employees
- Add employee-specific document categories
- Add acknowledgement workflows

PHASE 13
Cross-module integration
- Link ProbationReview to PerformanceCycle
- Link Attachment to PerformanceReview
- Add performance widgets to dashboard

PHASE 14
Testing + production verification
- Add performance tests
- Add document portal tests
- Add end-to-end workflow tests
```

---

## 6. Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| State machine bypass | HIGH | HIGH | Enforce in server actions, not UI |
| IDOR exposure | HIGH | HIGH | Add scoping before any data is returned |
| Data loss from missing migrations | MEDIUM | HIGH | Create versioned migrations before further changes |
| Audit compliance gap | HIGH | MEDIUM | Add audit logging to all mutations |
| Access control bypass | MEDIUM | HIGH | Add document-level authorization |
| File exposure | MEDIUM | HIGH | Add secure download API with signed URLs |

AUDIT COMPLETE

Recommendations:
- P0: Enforce state machine, fix IDOR, add self-assessment/manager review UIs
- P1: Add notifications, approvals, audit logging, document search
- P2: Add immutability, deadlines, scoring, probation linkage
- P3: Add tests, API routes, preview UI
