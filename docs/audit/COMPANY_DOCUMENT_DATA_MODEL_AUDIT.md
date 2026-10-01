# COMPANY DOCUMENT DATA MODEL AUDIT

## Executive Summary

The `CompanyDocument` model is minimal but functional. It captures core metadata (title, type, category, file reference, version, effective dates) but lacks approval status, access scoping, ownership, review scheduling, and change tracking.

---

## 1. Model Definition

**File**: `prisma/schema.prisma:1831-1856`

```prisma
model CompanyDocument {
  id             String    @id @default(cuid())
  title          String
  type           String    // POLICY | HANDBOOK | PROCEDURE | FORM | OTHER
  category       String    // HR | FINANCE | IT | LEGAL | GENERAL
  description    String?
  fileUrl        String
  fileName       String
  fileType       String
  version        String    @default("1.0")
  effectiveFrom  DateTime?
  effectiveTo    DateTime?
  isActive       Boolean   @default(true)
  publishedBy    String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([category, isActive])
  @@index([type])
}
```

---

## 2. Field Audit

| Field | Type | Nullable | Evidence | Issue |
|-------|------|----------|----------|-------|
| `id` | String | NO | `prisma/schema.prisma:1833` | OK |
| `title` | String | NO | `prisma/schema.prisma:1834` | OK |
| `type` | String | NO | `prisma/schema.prisma:1835` | No enum enforcement |
| `category` | String | NO | `prisma/schema.prisma:1836` | No enum enforcement |
| `description` | String? | YES | `prisma/schema.prisma:1837` | OK |
| `fileUrl` | String | NO | `prisma/schema.prisma:1838` | No signed URL support |
| `fileName` | String | NO | `prisma/schema.prisma:1839` | OK |
| `fileType` | String | NO | `prisma/schema.prisma:1840` | OK |
| `version` | String | NO, default `1.0` | `prisma/schema.prisma:1841` | OK |
| `effectiveFrom` | DateTime? | YES | `prisma/schema.prisma:1842` | OK |
| `effectiveTo` | DateTime? | YES | `prisma/schema.prisma:1843` | OK |
| `isActive` | Boolean | NO, default `true` | `prisma/schema.prisma:1844` | OK |
| `publishedBy` | String? | YES | `prisma/schema.prisma:1845` | OK |
| `createdAt` | DateTime | NO | `prisma/schema.prisma:1846` | OK |
| `updatedAt` | DateTime | NO | `prisma/schema.prisma:1847` | OK |

---

## 3. Missing Fields

| Field | Purpose | Severity |
|-------|---------|----------|
| `status` | DRAFT / UNDER_REVIEW / APPROVED / PUBLISHED / REJECTED / ARCHIVED | HIGH |
| `owner` | Document owner (User/Employee) | MEDIUM |
| `uploadedBy` | Exact uploader reference | MEDIUM |
| `fileSize` | Size in bytes | LOW |
| `tags` | Search/filter tags | MEDIUM |
| `department` | Department scope | MEDIUM |
| `reviewDate` | Next review date | MEDIUM |
| `reminderThreshold` | Days before expiry to remind | MEDIUM |
| `changeSummary` | What changed in this version | LOW |
| `previousVersionId` | Link to prior version | HIGH |

---

## 4. Relationship Audit

| Relationship | Type | Evidence | Issue |
|--------------|------|----------|-------|
| `CompanyDocument` → `User` (publishedBy) | Many-to-One | `prisma/schema.prisma:1845` | No `@relation` declared; raw string only |

### Issue

- `publishedBy` is a plain `String?` with no `@relation` to `User`. This means:
  - No foreign key constraint
  - No cascade behavior
  - No join optimization
  - Orphaned values if user is deleted

---

## 5. Index Audit

| Index | Fields | Purpose | Evidence | Status |
|-------|--------|---------|----------|--------|
| `category+isActive` | category, isActive | Filter active docs by category | `prisma/schema.prisma:1850` | PASS |
| `type` | type | Filter by document type | `prisma/schema.prisma:1851` | PASS |

### Missing Indexes

| Suggested Index | Query Pattern | Severity |
|-----------------|---------------|----------|
| `title` | Search by title | MEDIUM |
| `createdAt` | Sort by date | LOW |
| `effectiveFrom+effectiveTo` | Date range queries | MEDIUM |

---

## 6. Enum Enforcement Audit

| Field | Expected | Actual | Status |
|-------|----------|--------|--------|
| `type` | Enum: POLICY, HANDBOOK, PROCEDURE, FORM, OTHER | Free-form String | BROKEN |
| `category` | Enum: HR, FINANCE, IT, LEGAL, GENERAL | Free-form String | BROKEN |

**Evidence**: `prisma/schema.prisma:1835-1836` declares both as `String`, not Prisma enums.

---

## 7. Uniqueness Audit

| Constraint | Expected | Actual | Status |
|------------|----------|--------|--------|
| Unique title+version | NO | NO | N/A |
| Unique fileName+version | NO | NO | N/A |

**Evidence**: No `@@unique` on `CompanyDocument`.

---

## 8. Recommendations

| Priority | Recommendation |
|----------|----------------|
| P0 | Add `@relation` for `publishedBy` → `User` |
| P0 | Add `status` field with enum enforcement |
| P1 | Add `previousVersionId` for version history |
| P1 | Add `department` and `tags` |
| P1 | Add `reviewDate` and `reminderThreshold` |
| P2 | Convert `type` and `category` to Prisma enums |
| P2 | Add missing indexes |
| P2 | Add `fileSize` and `changeSummary` |
| P3 | Add `owner` field |

AUDIT COMPLETE

Company Document Data Model:
PARTIAL

Critical Findings:
- `publishedBy` is a raw string, not a relation
- No approval status field
- No version history linkage
- `type` and `category` lack enum enforcement
