# COMPANY DOCUMENT SECURITY AUDIT

## Executive Summary

The company document portal has basic authentication via `SETTINGS_VIEW`/`SETTINGS_MANAGE`, but lacks IDOR protection, access scoping, secure download, audit logging, and safe file handling. The `fileUrl` is exposed directly without authorization checks.

---

## 1. Authentication Audit

| Route | Auth Mechanism | Evidence | Status |
|-------|----------------|----------|--------|
| `/company/documents` | `requirePageAnyPermission(SETTINGS_VIEW, SETTINGS_MANAGE)` | `app/company/documents/page.tsx` | PASS |
| `/company/documents/new` | Inherits page guard + `SETTINGS_MANAGE` in action | `app/company/documents/new/page.tsx` | PASS |

---

## 2. Authorization Audit

| Action | Required Permission | Evidence | Issue |
|--------|---------------------|----------|-------|
| `getCompanyDocuments` | `SETTINGS_VIEW` or `SETTINGS_MANAGE` | `app/lib/actions/company-documents.ts:9` | Broad; no document-level scope |
| `getCompanyDocumentById` | `SETTINGS_VIEW` or `SETTINGS_MANAGE` | `app/lib/actions/company-documents.ts:22` | No IDOR check beyond auth |
| `createCompanyDocument` | `SETTINGS_MANAGE` | `app/lib/actions/company-documents.ts:36` | OK |
| `updateCompanyDocument` | `SETTINGS_MANAGE` | `app/lib/actions/company-documents.ts:81` | OK |
| `deleteCompanyDocument` | `SETTINGS_MANAGE` | `app/lib/actions/company-documents.ts:122` | OK |

### Issues

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| **DOC-SEC-01** | No document-level authorization | Any authorized user can read/update/delete any document | HIGH |
| **DOC-SEC-02** | No employee/manager/staff access | MANAGER/STAFF lack `SETTINGS_VIEW` | HIGH |
| **DOC-SEC-03** | `getCompanyDocumentById` has no ownership check | Returns any document by ID to any authorized user | HIGH |

---

## 3. IDOR Protection Audit

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| Employee A reads Employee B's document | DENIED | DENIED (no SETTINGS_VIEW) | PASS (by accident) |
| Manager A reads Manager B's document | DENIED | DENIED (no SETTINGS_VIEW) | PASS (by accident) |
| HR reads HR-only document | DENIED | DENIED (no HR-only scope) | PARTIAL |
| Admin reads any document | DENIED | DENIED (no document-level scope) | PARTIAL |

**Verdict: IDOR is not explicitly prevented. Access is gated by broad role permissions rather than document-level scoping.**

---

## 4. File Download Security Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| Download API route | YES | NO | MISSING |
| Authorization check | YES | NO | MISSING |
| Signed URLs | NO | NO | MISSING |
| Audit logging | NO | NO | MISSING |
| IDOR prevention | YES | NO | MISSING |

**Evidence**:
- `fileUrl` is stored and rendered as a raw string in `app/company/documents/page.tsx`.
- No `app/api/company-documents/[id]/download/route.ts` exists.
- No server-side check ensures the requesting user can access the specific file.

---

## 5. File Upload Security Audit

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| File type validation | YES | NO | MISSING |
| File size limit | YES | NO | MISSING |
| Malicious file scan | NO | NO | MISSING |
| Path traversal prevention | YES | NO | MISSING |
| Virus scan | NO | NO | MISSING |

**Evidence**: `app/company/documents/new/page.tsx` accepts `fileUrl` as a plain text input. No upload handling exists.

---

## 6. Audit Trail Audit

| Event | Expected | Actual | Status |
|-------|----------|--------|--------|
| Upload | YES | NO | MISSING |
| View | YES | NO | MISSING |
| Download | YES | NO | MISSING |
| Edit | YES | NO | MISSING |
| Replace | YES | NO | MISSING |
| Version created | YES | NO | MISSING |
| Approved | YES | NO | MISSING |
| Published | YES | NO | MISSING |
| Archived | YES | NO | MISSING |
| Deleted | YES | NO | MISSING |

**Evidence**: `app/lib/actions/company-documents.ts` contains zero `prisma.auditLog.create` calls.

---

## 7. Access Scope Audit

| Document Type | Expected Access | Current Access | Issue |
|---------------|-----------------|----------------|-------|
| Public company policy | All employees | ADMIN/HR only | HIGH |
| HR policy | Employees + HR | ADMIN/HR only | HIGH |
| Finance procedure | Finance + HR | ADMIN/HR only | HIGH |
| Management policy | Managers + HR + Admin | ADMIN/HR only | HIGH |

---

## 8. Recommendations

| Priority | Recommendation |
|----------|----------------|
| P0 | Add document-level authorization with role/department scope |
| P0 | Extend access to MANAGER and STAFF with role-based visibility |
| P0 | Add secure download API with authorization and audit logging |
| P1 | Add signed URLs for file access |
| P1 | Add file type and size validation |
| P2 | Add document-level audit logging |
| P2 | Add access control matrix per document |
| P3 | Add virus scanning integration |

AUDIT COMPLETE

Company Document Security:
BROKEN

Critical Findings:
- No document-level authorization
- No IDOR protection
- No secure download mechanism
- No file upload validation
- No audit logging
- MANAGER/STAFF cannot access documents
