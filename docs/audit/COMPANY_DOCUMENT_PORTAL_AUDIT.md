# COMPANY DOCUMENT PORTAL AUDIT

## Executive Summary

A basic company document portal exists with a Prisma model, server actions, two pages, and a settings-page link. However, it lacks sidebar navigation, search/filter, version history UI, approval workflows, expiry handling, access control, audit logging, and secure download mechanisms.

---

## 1. Inventory

| Component | Exists | Location | Used? | Auth | Database | Status |
|-----------|--------|----------|-------|------|----------|--------|
| `CompanyDocument` model | YES | `prisma/schema.prisma:1831-1856` | Partial | N/A | YES | PARTIAL |
| Server actions | YES | `app/lib/actions/company-documents.ts` | Partial | YES | YES | PARTIAL |
| List page | YES | `app/company/documents/page.tsx` | Partial | YES | YES | PARTIAL |
| Create page | YES | `app/company/documents/new/page.tsx` | Partial | YES | YES | PARTIAL |
| Settings link | YES | `components/settings/SettingsPageClient.tsx:210` | YES | N/A | N/A | PARTIAL |
| Sidebar navigation | NO | `components/layout/Sidebar.tsx` | NO | N/A | N/A | MISSING |
| API routes | NO | `app/api/company-documents/**` | NO | N/A | N/A | MISSING |
| Search/filter UI | NO | `app/company/documents/page.tsx` | NO | N/A | N/A | MISSING |
| Category navigation | NO | N/A | NO | N/A | N/A | MISSING |
| Version history UI | NO | N/A | NO | N/A | N/A | MISSING |
| Approval workflow | NO | N/A | NO | N/A | N/A | MISSING |
| Expiry handling | NO | N/A | NO | N/A | N/A | MISSING |
| Audit logging | NO | N/A | NO | N/A | N/A | MISSING |
| Download security | NO | N/A | NO | N/A | N/A | MISSING |
| Tests | NO | `tests/**` | NO | N/A | N/A | MISSING |

---

## 2. Route Audit

| Route | File | Auth | Database | Search | Filter | Status |
|-------|------|------|----------|--------|--------|--------|
| `/company/documents` | `app/company/documents/page.tsx` | YES | YES | NO | NO | PARTIAL |
| `/company/documents/new` | `app/company/documents/new/page.tsx` | YES | YES | NO | NO | PARTIAL |

---

## 3. UI Audit

### List Page (`app/company/documents/page.tsx`)

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Document table/cards | YES | YES | PASS |
| Stats cards | YES | YES | PASS |
| Category filter | YES | NO | MISSING |
| Type filter | YES | NO | MISSING |
| Search | YES | NO | MISSING |
| Pagination | YES | NO | MISSING |
| Sort | YES | NO | MISSING |
| Empty state | YES | YES | PASS |
| Loading state | YES | NO | MISSING |
| Error state | YES | NO | MISSING |
| Mobile UI | YES | NO | MISSING |

### Create Page (`app/company/documents/new/page.tsx`)

| Feature | Expected | Actual | Actual | Status |
|---------|----------|--------|--------|--------|
| Title field | YES | YES | PASS | OK |
| Type select | YES | YES | PASS | OK |
| Category select | YES | YES | PASS | OK |
| Description | YES | YES | PASS | OK |
| File URL input | YES | YES | PASS | OK |
| File name input | YES | YES | PASS | OK |
| File type input | YES | YES | PASS | OK |
| Version input | YES | YES | PASS | OK |
| Effective date | YES | YES | PASS | OK |
| Expiry date | YES | YES | PASS | OK |
| File upload | NO | NO | MISSING | MISSING |
| Preview | NO | NO | MISSING | MISSING |

---

## 4. Navigation Audit

| Navigation Point | Expected | Actual | Status |
|------------------|----------|--------|--------|
| Sidebar link | YES | NO | MISSING |
| Breadcrumbs | YES | NO | MISSING |
| Settings page link | YES | YES | PASS |
| Document cards link to detail | NO | NO | MISSING |

---

## 5. Access Control Audit

| Role | View | Create | Edit | Delete | Evidence |
|------|------|--------|------|--------|----------|
| SUPER_ADMIN | YES | YES | YES | YES | `SETTINGS_VIEW`/`SETTINGS_MANAGE` grants |
| ADMIN | YES | YES | YES | YES | `SETTINGS_VIEW`/`SETTINGS_MANAGE` grants |
| HR | YES | YES | YES | YES | `SETTINGS_VIEW`/`SETTINGS_MANAGE` grants |
| MANAGER | YES | NO | NO | NO | No `SETTINGS_VIEW` in MANAGER grants (`lib/auth/permissions.ts:179-187`) |
| STAFF | YES | NO | NO | NO | No `SETTINGS_VIEW` in STAFF grants (`lib/auth/permissions.ts:162-176`) |
| FINANCE | NO | NO | NO | NO | No `SETTINGS_VIEW` in FINANCE grants (`lib/auth/permissions.ts:190-205`) |

### Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **DOC-NAV-01** | No sidebar navigation for documents | `components/layout/Sidebar.tsx` | MEDIUM |
| **DOC-NAV-02** | MANAGER/STAFF cannot access documents at all | `lib/auth/permissions.ts` | HIGH |
| **DOC-NAV-03** | Settings link uses `SETTINGS_VIEW` which is broad | `components/settings/SettingsPageClient.tsx:210` | LOW |

---

## 6. Search and Filter Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Full-text search | NO | NO | N/A |
| Category filter | NO | NO | N/A |
| Type filter | NO | NO | N/A |
| Status filter | NO | NO | N/A |
| Date range filter | NO | NO | N/A |

---

## 7. Version Control Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Version number field | YES | YES | PASS |
| Previous version reference | NO | NO | MISSING |
| Version history UI | NO | NO | MISSING |
| Rollback to previous version | NO | NO | MISSING |
| Change summary | NO | NO | MISSING |

---

## 8. Approval Workflow Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Draft status | NO | NO | N/A |
| Under review status | NO | NO | N/A |
| Approved status | NO | NO | N/A |
| Published status | NO | NO | N/A |
| Rejected status | NO | NO | N/A |
| Archived status | NO | NO | N/A |
| Approval queue | NO | NO | N/A |

**Evidence**: `CompanyDocument` model has only `isActive` boolean, no approval status field.

---

## 9. Expiry and Review Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Effective date | YES | YES | PASS |
| Expiry date | YES | YES | PASS |
| Review date | NO | NO | MISSING |
| Reminder threshold | NO | NO | MISSING |
| Automated reminders | NO | NO | MISSING |
| Integration with document-expiry system | NO | NO | MISSING |

**Evidence**: `prisma/schema.prisma:1844-1845` has `effectiveFrom` and `effectiveTo`. `DocumentExpiryReminder` model exists (`prisma/schema.prisma:410-424`) but is only linked to `Employee`, not `CompanyDocument`.

---

## 10. Download Security Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Authenticated download | NO | NO | N/A |
| Authorized download | NO | NO | N/A |
| Signed URLs | NO | NO | N/A |
| Audit logging | NO | NO | N/A |
| IDOR protection | NO | NO | N/A |

**Evidence**: `fileUrl` is a raw string stored and displayed directly. No download API route exists. No authorization check on file access.

---

## 11. Audit Trail Audit

| Event | Expected | Actual | Status |
|-------|----------|--------|--------|
| Upload | NO | NO | N/A |
| View | NO | NO | N/A |
| Download | NO | NO | N/A |
| Edit | NO | NO | N/A |
| Replace | NO | NO | N/A |
| Version created | NO | NO | N/A |
| Approved | NO | NO | N/A |
| Published | NO | NO | N/A |
| Archived | NO | NO | N/A |
| Deleted | NO | NO | N/A |

**Evidence**: No audit log entries are created in `app/lib/actions/company-documents.ts`.

---

## 12. Recommendations

| Priority | Recommendation |
|----------|----------------|
| P0 | Add sidebar navigation for documents |
| P0 | Extend document access to MANAGER/STAFF with role-based visibility |
| P1 | Add search and category/type filters |
| P1 | Add version history UI with rollback |
| P1 | Add approval workflow states and queue integration |
| P2 | Add expiry reminder integration with `DocumentExpiryReminder` |
| P2 | Add audit logging for all document actions |
| P2 | Add secure download API with authorization |
| P3 | Add document preview UI |
| P3 | Add pagination and sorting |

AUDIT COMPLETE

Company Document Portal:
PARTIAL

Critical Findings:
- No sidebar navigation
- MANAGER/STAFF cannot access documents
- No search/filter
- No approval workflow
- No version history UI
- No audit logging
- No secure download
