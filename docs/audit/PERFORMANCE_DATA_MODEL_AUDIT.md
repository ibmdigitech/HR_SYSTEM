# PERFORMANCE DATA MODEL AUDIT

## Executive Summary

The Prisma schema contains a complete set of performance models with sensible relationships and indexes, but several fields required for a full HR performance lifecycle are missing. No migration history for performance models was found in `prisma/migrations/`, indicating these models may have been added via `db push` without versioned migrations.

---

## 1. Model Inventory

| Model | Location | Indexes | Unique Constraints |
|-------|----------|---------|-------------------|
| `PerformanceCycle` | `prisma/schema.prisma:1692-1710` | `status`, `startDate+endDate` | `type+startDate+endDate` |
| `PerformanceReview` | `prisma/schema.prisma:1713-1744` | `cycleId+status`, `employeeId`, `managerId` | `cycleId+employeeId` |
| `PerformanceGoal` | `prisma/schema.prisma:1747-1763` | `reviewId` | NONE |
| `PerformanceQuestion` | `prisma/schema.prisma:1766-1785` | `cycleId+order` | NONE |
| `PerformanceAnswer` | `prisma/schema.prisma:1788-1804` | `reviewId`, `questionId` | `reviewId+questionId+answeredBy` |
| `ReviewScenario` | `prisma/schema.prisma:1807-1819` | `isActive+order` | NONE |

---

## 2. PerformanceCycle Audit

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1693` | OK |
| `name` | String | NO | `prisma/schema.prisma:1694` | OK |
| `type` | String | NO | `prisma/schema.prisma:1695` | No enum enforcement |
| `startDate` | DateTime | NO | `prisma/schema.prisma:1697` | OK |
| `endDate` | DateTime | NO | `prisma/schema.prisma:1698` | OK |
| `status` | String | NO, default `PLANNING` | `prisma/schema.prisma:1700` | No enum enforcement |
| `selfAssessmentEnabled` | Boolean | NO, default `true` | `prisma/schema.prisma:1702` | OK |
| `managerReviewEnabled` | Boolean | NO, default `true` | `prisma/schema.prisma:1704` | OK |
| `calibrationEnabled` | Boolean | NO, default `true` | `prisma/schema.prisma:1706` | OK |
| `createdById` | String | NO | `prisma/schema.prisma:1708` | OK |
| `createdBy` | User | NO | `prisma/schema.prisma:1709` | Named relation OK |

### Missing Fields

| Field | Purpose | Severity |
|-------|---------|----------|
| `deadline` | Self-assessment/manager-review deadline | MEDIUM |
| `reopenAllowed` | Whether closed cycles can be reopened | LOW |
| `description` | Cycle description/context | LOW |

---

## 3. PerformanceReview Audit

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1715` | OK |
| `cycleId` | String | NO | `prisma/schema.prisma:1716` | OK |
| `employeeId` | String | NO | `prisma/schema.prisma:1718` | OK |
| `managerId` | String? | YES | `prisma/schema.prisma:1720` | OK |
| `status` | String | NO, default `DRAFT` | `prisma/schema.prisma:1723` | No enum enforcement |
| `overallRating` | Float? | YES | `prisma/schema.prisma:1724` | OK |
| `overallComment` | String? | YES | `prisma/schema.prisma:1725` | OK |
| `selfAssessmentAt` | DateTime? | YES | `prisma/schema.prisma:1726` | OK |
| `managerReviewAt` | DateTime? | YES | `prisma/schema.prisma:1727` | OK |
| `calibrationAt` | DateTime? | YES | `prisma/schema.prisma:1728` | OK |
| `approvedAt` | DateTime? | YES | `prisma/schema.prisma:1729` | OK |
| `approvedById` | String? | YES | `prisma/schema.prisma:1731` | OK |
| `acknowledgedAt` | DateTime? | YES | `prisma/schema.prisma:1733` | OK |
| `acknowledgedById` | String? | YES | `prisma/schema.prisma:1735` | OK |

### Missing Fields

| Field | Purpose | Severity |
|-------|---------|----------|
| `version` | Historical immutability | HIGH |
| `lock` / `lockedAt` | Prevent edits after acknowledgement | HIGH |
| `reopenCount` | Track reopenings | MEDIUM |
| `department` | Scope filtering at review level | MEDIUM |
| `previousReviewId` | Link to prior cycle review | LOW |

---

## 4. PerformanceGoal Audit

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1750` | OK |
| `reviewId` | String | NO | `prisma/schema.prisma:1751` | OK |
| `title` | String | NO | `prisma/schema.prisma:1753` | OK |
| `description` | String? | YES | `prisma/schema.prisma:1754` | OK |
| `weight` | Float | NO, default `1` | `prisma/schema.prisma:1755` | OK |
| `target` | String | NO | `prisma/schema.prisma:1756` | OK |
| `actual` | String? | YES | `prisma/schema.prisma:1757` | OK |
| `rating` | Float? | YES | `prisma/schema.prisma:1758` | OK |
| `comment` | String? | YES | `prisma/schema.prisma:1759` | OK |
| `order` | Int | NO, default `0` | `prisma/schema.prisma:1760` | OK |

### Missing Fields

| Field | Purpose | Severity |
|-------|---------|----------|
| `dueDate` | Goal deadline | MEDIUM |
| `startDate` | Goal start | LOW |
| `progress` | Percentage complete | MEDIUM |
| `status` | NOT_STARTED / IN_PROGRESS / COMPLETED / BLOCKED | MEDIUM |
| `evidence` | File attachment reference | LOW |

---

## 5. PerformanceQuestion Audit

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1770` | OK |
| `cycleId` | String | NO | `prisma/schema.prisma:1771` | OK |
| `text` | String | NO | `prisma/schema.prisma:1773` | OK |
| `type` | String | NO, default `COMPETENCY` | `prisma/schema.prisma:1775` | No enum enforcement |
| `audience` | String | NO, default `BOTH` | `prisma/schema.prisma:1777` | No enum enforcement |
| `weight` | Float | NO, default `1` | `prisma/schema.prisma:1779` | OK |
| `order` | Int | NO, default `0` | `prisma/schema.prisma:1781` | OK |
| `isRequired` | Boolean | NO, default `true` | `prisma/schema.prisma:1783` | OK |
| `options` | Json? | YES | `prisma/schema.prisma:1785` | No validation |

### Missing Fields

| Field | Purpose | Severity |
|-------|---------|----------|
| `category` | Goal Achievement / Communication / Teamwork | MEDIUM |
| `helpText` | UI guidance | LOW |
| `ratingScale` | Min/max/step for numeric questions | MEDIUM |
| `employeeVisible` | Visibility control | HIGH |
| `managerVisible` | Visibility control | HIGH |
| `hrVisible` | Visibility control | HIGH |

---

## 6. PerformanceAnswer Audit

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1791` | OK |
| `reviewId` | String | NO | `prisma/schema.prisma:1792` | OK |
| `questionId` | String | NO | `prisma/schema.prisma:1794` | OK |
| `answeredBy` | String | NO | `prisma/schema.prisma:1796` | Not verified server-side |
| `answer` | String? | YES | `prisma/schema.prisma:1797` | OK |
| `rating` | Float? | YES | `prisma/schema.prisma:1799` | OK |

### Missing Fields

| Field | Purpose | Severity |
|-------|---------|----------|
| `evidenceUrl` | Attachment link | LOW |
| `comment` | Free-text comment | LOW |
| `version` | Immutability | MEDIUM |

---

## 7. ReviewScenario Audit

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1810` | OK |
| `name` | String | NO | `prisma/schema.prisma:1811` | OK |
| `description` | String | NO | `prisma/schema.prisma:1812` | OK |
| `rating` | Float | NO | `prisma/schema.prisma:1813` | OK |
| `behaviors` | Json? | YES | `prisma/schema.prisma:1814` | OK |
| `isActive` | Boolean | NO, default `true` | `prisma/schema.prisma:1815` | OK |
| `order` | Int | NO, default `0` | `prisma/schema.prisma:1816` | OK |

### Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **PERF-DM-01** | No relation to `PerformanceCycle` or `PerformanceReview` | `prisma/schema.prisma:1807-1819` | MEDIUM |
| **PERF-DM-02** | No `minRating`/`maxRating` bounds | `prisma/schema.prisma:1813` | LOW |

---

## 8. Relationship Audit

| Relationship | Type | Evidence | Issue |
|--------------|------|----------|-------|
| `PerformanceCycle` → `User` (createdBy) | Many-to-One | `prisma/schema.prisma:1709` | OK, named relation |
| `PerformanceCycle` → `PerformanceReview` | One-to-Many | `prisma/schema.prisma:1711` | OK |
| `PerformanceCycle` → `PerformanceQuestion` | One-to-Many | `prisma/schema.prisma:1712` | OK |
| `PerformanceReview` → `PerformanceCycle` | Many-to-One | `prisma/schema.prisma:1716` | OK |
| `PerformanceReview` → `Employee` (subject) | Many-to-One | `prisma/schema.prisma:1718` | Named relation OK |
| `PerformanceReview` → `Employee` (manager) | Many-to-One | `prisma/schema.prisma:1720` | Named relation OK |
| `PerformanceReview` → `User` (approvedBy) | Many-to-One | `prisma/schema.prisma:1731` | Named relation OK |
| `PerformanceReview` → `User` (acknowledgedBy) | Many-to-One | `prisma/schema.prisma:1735` | Named relation OK |
| `PerformanceReview` → `PerformanceGoal` | One-to-Many | `prisma/schema.prisma:1737` | OK |
| `PerformanceReview` → `PerformanceAnswer` | One-to-Many | `prisma/schema.prisma:1738` | OK |
| `PerformanceGoal` → `PerformanceReview` | Many-to-One | `prisma/schema.prisma:1751` | OK |
| `PerformanceQuestion` → `PerformanceCycle` | Many-to-One | `prisma/schema.prisma:1771` | OK |
| `PerformanceQuestion` → `PerformanceAnswer` | One-to-Many | `prisma/schema.prisma:1786` | OK |
| `PerformanceAnswer` → `PerformanceReview` | Many-to-One | `prisma/schema.prisma:1792` | OK |
| `PerformanceAnswer` → `PerformanceQuestion` | Many-to-One | `prisma/schema.prisma:1794` | OK |

---

## 9. Index Audit

| Model | Index | Query Pattern | Evidence | Status |
|-------|-------|---------------|----------|--------|
| `PerformanceCycle` | `type+startDate+endDate` | Unique, prevent duplicate cycles | `prisma/schema.prisma:1707` | PASS |
| `PerformanceCycle` | `status` | Filter active/closed | `prisma/schema.prisma:1708` | PASS |
| `PerformanceCycle` | `startDate+endDate` | Date range queries | `prisma/schema.prisma:1709` | PASS |
| `PerformanceReview` | `cycleId+employeeId` | Unique, prevent duplicate reviews | `prisma/schema.prisma:1740` | PASS |
| `PerformanceReview` | `cycleId+status` | Filter by cycle and status | `prisma/schema.prisma:1741` | PASS |
| `PerformanceReview` | `employeeId` | Employee history | `prisma/schema.prisma:1742` | PASS |
| `PerformanceReview` | `managerId` | Manager dashboard | `prisma/schema.prisma:1743` | PASS |
| `PerformanceGoal` | `reviewId` | Goals by review | `prisma/schema.prisma:1762` | PASS |
| `PerformanceQuestion` | `cycleId+order` | Ordered questions by cycle | `prisma/schema.prisma:1784` | PASS |
| `PerformanceAnswer` | `reviewId+questionId+answeredBy` | Unique answer per actor | `prisma/schema.prisma:1801` | PASS |
| `PerformanceAnswer` | `reviewId` | Answers by review | `prisma/schema.prisma:1802` | PASS |
| `PerformanceAnswer` | `questionId` | Answers by question | `prisma/schema.prisma:1803` | PASS |

---

## 10. Migration Audit

| Finding | Evidence | Status |
|---------|----------|--------|
| No performance-specific migration files | `prisma/migrations/` contains no performance migration | WARNING |
| Models likely added via `db push` | Schema exists but no versioned migration | WARNING |
| Existing migrations use `sqlite` lock | `prisma/migrations/migration_lock.toml` | WARNING |

---

## 11. Recommendations

| Priority | Recommendation |
|----------|----------------|
| P0 | Add `version` and `lock` fields to `PerformanceReview` |
| P0 | Add `employeeVisible`/`managerVisible`/`hrVisible` to `PerformanceQuestion` |
| P1 | Add `deadline` to `PerformanceCycle` |
| P1 | Add `status`/`progress`/`dueDate` to `PerformanceGoal` |
| P1 | Add `category`/`helpText`/`ratingScale` to `PerformanceQuestion` |
| P2 | Create versioned migrations for all performance models |
| P2 | Add `ReviewScenario` relation to `PerformanceCycle` |
| P3 | Add `evidenceUrl` to `PerformanceAnswer` |

AUDIT COMPLETE

Performance Data Model:
PARTIAL

Critical Findings:
- No historical immutability fields
- No visibility controls on questions
- No versioned migrations for performance models
- Scoring fields exist but no calculation logic
