# PERFORMANCE QA SYSTEM AUDIT

## Executive Summary

A question-and-answer appraisal subsystem exists at the data layer (`PerformanceQuestion`, `PerformanceAnswer`) and has one read/write server action pair, but it lacks configuration UI, type support, weighting, visibility controls, and any connection to the review workflow or approval chain.

---

## 1. Inventory

| Component | Exists | Location | Used? | Auth | Database | Status |
|-----------|--------|----------|-------|------|----------|--------|
| Question model | YES | `prisma/schema.prisma:1766-1785` | Partial | N/A | YES | PARTIAL |
| Answer model | YES | `prisma/schema.prisma:1788-1804` | Partial | N/A | YES | PARTIAL |
| Question CRUD server actions | NO | `app/lib/actions/performance.ts` | NO | N/A | N/A | MISSING |
| Question bank UI | NO | `app/performance/**` | NO | N/A | N/A | MISSING |
| Answer submission UI | NO | `app/performance/reviews/[id]/page.tsx` | NO | N/A | N/A | MISSING |
| Question templates | NO | N/A | NO | N/A | N/A | MISSING |
| Question categories/sections | NO | N/A | NO | N/A | N/A | MISSING |
| Answer evidence/attachments | NO | N/A | NO | N/A | N/A | MISSING |
| Question ordering UI | NO | N/A | NO | N/A | N/A | MISSING |
| Question tests | NO | `tests/**` | NO | N/A | N/A | MISSING |

---

## 2. Data Model Audit

### PerformanceQuestion

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1769` | OK |
| `cycleId` | String | NO | `prisma/schema.prisma:1770` | OK |
| `text` | String | NO | `prisma/schema.prisma:1772` | OK |
| `type` | String | YES, default `COMPETENCY` | `prisma/schema.prisma:1774` | Missing enum enforcement |
| `audience` | String | YES, default `BOTH` | `prisma/schema.prisma:1776` | No visibility enforcement |
| `weight` | Float | YES, default `1` | `prisma/schema.prisma:1778` | OK |
| `order` | Int | YES, default `0` | `prisma/schema.prisma:1780` | OK |
| `isRequired` | Boolean | YES, default `true` | `prisma/schema.prisma:1782` | OK |
| `options` | Json? | YES | `prisma/schema.prisma:1784` | No validation |

### PerformanceAnswer

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1790` | OK |
| `reviewId` | String | NO | `prisma/schema.prisma:1791` | OK |
| `questionId` | String | NO | `prisma/schema.prisma:1793` | OK |
| `answeredBy` | String | NO | `prisma/schema.prisma:1795` | Client-supplied, not verified |
| `answer` | String? | YES | `prisma/schema.prisma:1796` | OK |
| `rating` | Float? | YES | `prisma/schema.prisma:1798` | OK |

### Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **QA-MODEL-01** | No question categories/sections | `prisma/schema.prisma:1766-1785` | MEDIUM |
| **QA-MODEL-02** | No `helpText` field | `prisma/schema.prisma:1766-1785` | LOW |
| **QA-MODEL-03** | No `ratingScale` or `options` validation | `prisma/schema.prisma:1784` | MEDIUM |
| **QA-MODEL-04** | No `employeeVisible`/`managerVisible`/`HRVisible` flags | `prisma/schema.prisma:1776` uses `audience` but not enforced | HIGH |
| **QA-MODEL-05** | `answeredBy` not verified against session | `app/lib/actions/performance.ts:296-337` | HIGH |
| **QA-MODEL-06** | No unique constraint on review+question+answeredBy at DB level | `prisma/schema.prisma:1801` has `@@unique` | OK |

---

## 3. Question Type Audit

### Supported Types

| Type | Model Support | UI Support | Server Support | Status |
|------|---------------|------------|----------------|--------|
| Short Text | YES (`answer` String) | NO | YES | PARTIAL |
| Long Text | YES (`answer` String) | NO | YES | PARTIAL |
| Yes / No | NO | NO | NO | MISSING |
| Single Choice | NO | NO | NO | MISSING |
| Multiple Choice | NO | NO | NO | MISSING |
| Rating Scale | YES (`rating` Float) | NO | YES | PARTIAL |
| Numeric Score | YES (`rating` Float) | NO | YES | PARTIAL |
| Percentage | NO | NO | NO | MISSING |
| Date | NO | NO | NO | MISSING |
| Goal/KPI | NO | NO | NO | MISSING |
| File Attachment | NO | NO | NO | MISSING |
| Manager Comment | NO | NO | NO | MISSING |
| Employee Comment | NO | NO | NO | MISSING |

**Verdict: Only short text and numeric rating are practically usable. All other types are missing from UI and server actions.**

---

## 4. Question Configuration Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| HR can create questions | YES | NO | MISSING |
| Questions are cycle-specific | YES | YES | PARTIAL |
| Questions are orderable | YES | YES | PARTIAL |
| Questions are weightable | YES | YES | PARTIAL |
| Questions are required/optional | YES | YES | PARTIAL |
| Questions have categories | NO | NO | MISSING |
| Questions have help text | NO | NO | MISSING |
| Questions have visibility controls | NO | NO | MISSING |
| Question bank/templates | NO | NO | MISSING |

---

## 5. Answer Submission Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Employee self-assessment | YES | NO | MISSING |
| Manager review answers | YES | NO | MISSING |
| HR comments | YES | NO | MISSING |
| Rating submission | YES | YES | PARTIAL |
| Text answer submission | YES | YES | PARTIAL |
| Answer editing | YES | YES | PARTIAL |
| Answer audit trail | NO | NO | MISSING |
| Evidence attachment | NO | NO | MISSING |

### Evidence

- `app/lib/actions/performance.ts:296-337` (`submitPerformanceAnswer`) accepts any `answeredBy` string and writes it without verifying the caller is the claimed actor.
- `app/performance/reviews/[id]/page.tsx` renders questions and answers read-only. No form exists to submit or edit answers.

---

## 6. Scoring Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Question weight applied | YES | NO | MISSING |
| Category score calculation | NO | NO | MISSING |
| Overall score calculation | NO | NO | MISSING |
| Rating scale enforcement | NO | NO | MISSING |
| Rounding rules | NO | NO | MISSING |
| Missing answer handling | NO | NO | MISSING |

**Verdict: No scoring logic exists anywhere in the codebase. `overallRating` is a free-form float written by `updatePerformanceReview` without calculation.**

---

## 7. Workflow Integration

| Step | Expected | Actual | Status |
|------|----------|--------|--------|
| Cycle created → questions loaded | YES | NO | MISSING |
| Review created → questions visible | YES | NO | MISSING |
| Employee submits answers → status changes | YES | NO | MISSING |
| Manager sees employee answers | YES | NO | MISSING |
| Manager submits answers → status changes | YES | NO | MISSING |
| HR sees all answers | YES | NO | MISSING |
| Answers locked after approval | YES | NO | MISSING |

---

## 8. Recommendations

| Priority | Recommendation | Rationale |
|----------|----------------|-----------|
| P0 | Verify `answeredBy` against session user | Security/authorization gap |
| P0 | Build question CRUD UI and server actions | Configuration impossible |
| P1 | Add question type enforcement and validation | Data quality |
| P1 | Add visibility flags and enforce in queries | Confidentiality |
| P1 | Connect answers to state machine transitions | Workflow completeness |
| P2 | Add scoring calculation service | Rating integrity |
| P2 | Add question categories/sections | Organization |
| P3 | Add evidence/attachment support | Completeness |

AUDIT COMPLETE

Performance Q&A:
PARTIAL

Critical Findings:
- Question configuration UI and server actions missing
- `answeredBy` not verified against session
- No scoring calculation
- No visibility controls
