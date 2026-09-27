# API AUDIT

## API Endpoint Inventory

| Method | Endpoint | Auth | Permission | Validation | Rate Limit | Status |
|--------|----------|------|------------|------------|------------|--------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth | - | Zod | ❌ | PASS |
| GET | `/api/templates` | Session | letters.view | ❌ | ❌ | PASS |
| GET/POST | `/api/employees` | Session | employees.manage | Partial | ❌ | NEEDS FIX |
| POST | `/api/seed` | None | admin | ❌ | ❌ | BLOCKED |
| GET/POST | `/api/service-config` | Session | admin | Zod | ❌ | PASS |
| GET/POST | `/api/configs` | Session | admin | Zod | ❌ | PASS |
| POST | `/api/configs/reset` | Session | admin | ❌ | ❌ | PASS |
| POST | `/api/letters/[id]/approve` | Session | letters.approve | ❌ | ❌ | PASS |
| GET | `/api/letters` | Session | letters.view | ❌ | ❌ | PASS |
| GET | `/api/attendance/download` | Session | attendance.export | Query params | ❌ | PASS |
| POST | `/api/attendance/import` | None | attendance.manage | ❌ | ❌ | NEEDS FIX |
| GET | `/api/payroll/export` | Session | payroll.export | Query params | ❌ | PASS |
| POST | `/api/leaves/update` | Session | leaves.approve | ❌ | ❌ | PASS |

**Total: 14 endpoints**

---

## Detailed Endpoint Audits

### API-001: `/api/auth/[...nextauth]`

**Handler**: NextAuth.js v5

**Methods**: GET, POST

**Auth**: Self-handled (credentials, OAuth)

**Validation**: Built-in (Zod in authorize callback)

**Security**:
- ✅ CSRF protection (double-submit cookie)
- ✅ Secure cookies (httpOnly, sameSite=lax)
- ✅ JWT encryption (AUTH_SECRET)
- ❌ No rate limiting on credential endpoint
- ❌ No brute force detection

**Issues**:
- **API-001**: Credential endpoint vulnerable to brute force
- **API-002**: No account lockout after failed attempts

---

### API-002: `/api/templates`

**Handler**: `app/api/templates/route.ts`

**Methods**: GET, POST

**Auth**: Session required

**Permission**: letters.view (GET), letters.manage (POST) - **NOT ENFORCED**

**Validation**: 
- GET: None
- POST: Partial (template structure)

**Response**: Array of LetterTemplate

**Issues**:
- **API-003**: No permission check in handler
- **API-004**: No input validation on POST
- **API-005**: No pagination on GET (returns all)

---

### API-003: `/api/employees`

**Handler**: `app/api/employees/route.ts`

**Methods**: GET, POST

**Auth**: Session required

**Permission**: employees.view (GET), employees.manage (POST) - **NOT ENFORCED**

**Validation**:
- GET: Query params (search, status, page)
- POST: **None** - directly passes to Prisma

**Response**: Employee[] or created Employee

**Issues**:
- **API-006**: No permission enforcement
- **API-007**: No input validation on POST (mass assignment risk)
- **API-008**: No pagination metadata in response
- **API-009**: Exposes all employee fields (including salary)

---

### API-004: `/api/seed`

**Handler**: `app/api/seed/route.ts`

**Methods**: POST

**Auth**: **NONE** - PUBLIC ENDPOINT

**Permission**: **NONE**

**Validation**: None

**Action**: Runs database seed script

**Issues**:
- **API-010**: **CRITICAL** - Public destructive endpoint
- **API-011**: Can be called repeatedly, creates duplicate data
- **API-012**: No authentication or authorization
- **API-013**: No rate limiting

**Recommendation**: Remove or protect with ADMIN-only secret token

---

### API-005: `/api/service-config`

**Handler**: `app/api/service-config/route.ts`

**Methods**: GET, POST

**Auth**: Session required

**Permission**: admin - **ENFORCED** (checks session.role === 'ADMIN')

**Validation**: Zod schema for config keys

**Response**: ServiceConfig[]

**Status**: PASS - Properly protected

---

### API-006: `/api/configs` & `/api/configs/reset`

**Handler**: `app/api/configs/route.ts`

**Methods**: GET, POST, POST (reset)

**Auth**: Session required

**Permission**: admin - **ENFORCED**

**Validation**: Zod schema

**Status**: PASS - Properly protected

---

### API-007: `/api/letters/[id]/approve`

**Handler**: `app/api/letters/[id]/approve/route.ts`

**Methods**: POST

**Auth**: Session required

**Permission**: letters.approve - **NOT ENFORCED**

**Validation**: None

**Action**: Updates LetterRecord status to APPROVED

**Issues**:
- **API-014**: No permission check
- **API-015**: No validation of letter existence
- **API-016**: No audit log in API (only in server action)

---

### API-008: `/api/letters`

**Handler**: `app/api/letters/route.ts`

**Methods**: GET

**Auth**: Session required

**Permission**: letters.view - **NOT ENFORCED**

**Validation**: Query params

**Response**: LetterRecord[] with relations

**Issues**:
- **API-017**: No permission enforcement
- **API-018**: Returns all letters (no scoping to user/team)

---

### API-009: `/api/attendance/download`

**Handler**: `app/api/attendance/download/route.ts`

**Methods**: GET

**Auth**: Session required

**Permission**: attendance.export - **NOT ENFORCED**

**Validation**: Query params (month, year)

**Response**: CSV file download

**Issues**:
- **API-019**: No permission enforcement
- **API-020**: No scoping (returns all employees)

---

### API-010: `/api/attendance/import`

**Handler**: `app/api/attendance/import/route.ts`

**Methods**: POST

**Auth**: **NONE**

**Permission**: **NONE**

**Validation**: **None** - accepts any file

**Action**: Parses CSV, creates BiometricLog/Attendance

**Issues**:
- **API-021**: **CRITICAL** - Public endpoint for data ingestion
- **API-022**: No file type validation
- **API-023**: No file size limit
- **API-024**: No employee validation (creates logs for unknown IDs)
- **API-025**: No duplicate detection
- **API-026**: No authentication (device/API key)

---

### API-011: `/api/payroll/export`

**Handler**: `app/api/payroll/export/route.ts`

**Methods**: GET

**Auth**: Session required

**Permission**: payroll.export - **NOT ENFORCED**

**Validation**: Query params

**Response**: CSV/XLSX

**Issues**:
- **API-027**: No permission enforcement
- **API-028**: Exposes all salary data

---

### API-012: `/api/leaves/update`

**Handler**: `app/api/leaves/update/route.ts`

**Methods**: POST

**Auth**: Session required

**Permission**: leaves.approve - **NOT ENFORCED**

**Validation**: Body (id, status)

**Action**: Updates LeaveRequest status

**Issues**:
- **API-029**: No permission enforcement
- **API-030**: No balance check on approve
- **API-031**: Duplicate logic with server action

---

## Server Actions as API

Server actions are the primary mutation interface. They have proper auth checks.

| Action File | Functions | Auth Check | Validation |
|-------------|-----------|------------|------------|
| employees.ts | upsertEmployee, deleteEmployee | ADMIN/HR | Partial (required fields) |
| attendance.ts | markAttendance, bulkMark | All | Basic |
| leave.ts | applyLeave, approveLeave | Role-based | Balance check |
| payroll.ts | generatePayroll | ADMIN/HR/PAYROLL_ADMIN | Basic |
| loans.ts | applyLoan, approveLoan | Role-based | Basic |
| letters.ts | generateLetter, approveLetter | Role-based | Template check |
| visa.ts | CRUD | Role-based | Basic |
| staff-requests.ts | CRUD | All | Category validation |
| requests.ts | CRUD | All | Basic |
| role-request.ts | CRUD | ADMIN | Basic |
| shifts.ts | CRUD | ADMIN/HR | Basic |
| notifications.ts | get, markRead | All | Basic |
| company-settings.ts | CRUD | ADMIN | Zod |
| bulk-upload.ts | uploadMasterFile | ADMIN/HR | CSV validation |
| recruitment.ts | CRUD | ADMIN/HR | Basic |
| overtime.ts | CRUD | ADMIN/HR | Basic |

**Common Issues**:
- **API-032**: No centralized validation (Zod schemas duplicated)
- **API-033**: Inconsistent error response format
- **API-034**: No request logging/audit
- **API-035**: No idempotency keys for mutations

---

## Security Vulnerabilities

| ID | Endpoint | Vulnerability | Severity |
|----|----------|---------------|----------|
| **API-010** | `/api/seed` | Public destructive endpoint | CRITICAL |
| **API-021** | `/api/attendance/import` | Unauthenticated data ingestion | CRITICAL |
| **API-006** | `/api/employees` POST | Mass assignment (no validation) | HIGH |
| **API-007** | `/api/letters/[id]/approve` | IDOR potential | HIGH |
| **API-009** | `/api/attendance/download` | Data exposure (all employees) | HIGH |
| **API-011** | `/api/payroll/export` | Salary data exposure | HIGH |
| **API-001** | `/api/auth/...` credentials | No rate limiting | HIGH |
| **API-003** | `/api/templates` POST | No validation | MEDIUM |
| **API-014** | `/api/letters/[id]/approve` | No permission check | MEDIUM |
| **API-017** | `/api/letters` | Data exposure (all letters) | MEDIUM |
| **API-027** | `/api/payroll/export` | No permission check | MEDIUM |
| **API-029** | `/api/leaves/update` | No permission check | MEDIUM |

---

## API Design Issues

| ID | Issue | Impact |
|----|-------|--------|
| **API-036** | No API versioning | Breaking changes risk |
| **API-037** | Mixed REST and RPC patterns | Inconsistent |
| **API-038** | Server actions + API routes for same operations | Duplication |
| **API-039** | No OpenAPI/Swagger documentation | Developer experience |
| **API-040** | No request/response logging | Debugging difficulty |
| **API-041** | Inconsistent error formats | Client handling complexity |
| **API-042** | No pagination standard | Client implementation varies |
| **API-043** | No webhook support for integrations | Extensibility limited |

---

## Recommendations

1. **Immediate**: Remove `/api/seed` or protect with secret token
2. **Immediate**: Add authentication to `/api/attendance/import`
3. **Immediate**: Add middleware permission checks to all API routes
4. **Immediate**: Add Zod validation to all POST/PUT endpoints
5. **Short-term**: Implement rate limiting on auth endpoints
5. **Short-term**: Add API versioning (`/api/v1/...`)
6. **Short-term**: Standardize error responses
7. **Short-term**: Add request logging
8. **Medium-term**: Consolidate server actions vs API routes
9. **Medium-term**: Add OpenAPI documentation
10. **Medium-term**: Implement idempotency for mutations