# WORKFLOW AUDIT

## Workflow Inventory

| Workflow | Module | Status | Critical Gaps |
|----------|--------|--------|---------------|
| Authentication | Auth | PASS | - |
| Employee Onboarding | Employees | PARTIAL | Missing visa, document checklist, equipment assignment |
| Employee Offboarding | Employees | NOT IMPLEMENTED | No exit workflow |
| Attendance Marking | Attendance | PASS | - |
| Attendance Import | Attendance | PASS | No validation preview |
| Shift Management | Attendance | PASS | No conflict detection |
| Leave Application | Leaves | PASS | - |
| Leave Approval | Leaves | PARTIAL | Missing HR review step |
| Leave Balance Accrual | Leaves | NOT IMPLEMENTED | No automatic accrual |
| Payroll Generation | Payroll | PASS | - |
| Payslip Distribution | Payroll | PARTIAL | No email delivery |
| Loan Application | Payroll/Loans | PASS | - |
| Loan Approval | Payroll/Loans | PASS | - |
| Letter Generation | Letters | PASS | - |
| Letter Approval | Letters | PARTIAL | Only for sensitive letters |
| Visa Tracking | Visa | PASS | No automated alerts |
| Staff Service Requests | Staff Services | PASS | - |
| General Requests | Requests | PASS | - |
| Role/Access Requests | Access Control | PASS | - |
| Notification Delivery | Notifications | PARTIAL | No email/SMS channels |
| Service Configuration | Settings | PASS | - |

---

## Detailed Workflow Audits

### FLOW-001: Authentication Workflow

**Start**: User navigates to any protected route

**Steps**:
1. Middleware checks session via `auth()`
2. If no session → redirect to `/login`
3. User submits credentials
4. `authorize()` validates against User table
5. JWT created with `id`, `role`, `email`
6. Redirect to `/dashboard`

**Database Changes**: Session created in JWT (stateless), User.lastLogin updated

**API Calls**: `/api/auth/callback/credentials`, `/api/auth/session`

**Permissions**: None required

**Notifications**: None

**End State**: Authenticated session, dashboard access

**Failure States**:
- Invalid credentials → toast error, stay on login
- Expired session → redirect to login
- JWT decryption error → redirect to login (SEC-001)

**Current Status**: PASS (after AUTH_SECRET fix)

**Issues**:
- **FLOW-001**: No rate limiting on login attempts
- **FLOW-002**: No MFA support
- **FLOW-003**: No brute force protection

---

### FLOW-002: Employee Onboarding

**Start**: ADMIN/HR clicks "Add New Record" on `/employees`

**Steps**:
1. Fill 4-tab form (Personal, Employment, Finance, Verification)
2. Submit → `upsertEmployee` server action
3. Validate permissions (ADMIN/HR)
4. Generate employee code (EMP-XXX)
5. Hash default password ("password123")
6. Create User record (role: STAFF)
7. Create Employee record (linked to User)
8. Create SalaryStructure record
9. Create LeaveBalance records (10 types, current year)
10. Create welcome Notification
11. Create AuditLog entry
12. Revalidate paths
13. Toast success, reload page

**Database Changes**:
- INSERT User
- INSERT Employee
- INSERT SalaryStructure
- INSERT LeaveBalance (10 rows)
- INSERT Notification
- INSERT AuditLog

**API Calls**: Server action `upsertEmployee`

**Permissions**: ADMIN, HR

**Notifications**: Welcome notification to new employee

**End State**: Employee in directory, can login with email/password123

**Failure States**:
- Duplicate email/rollNumber → DB constraint error
- Validation error → toast with message
- DB error → toast with error message

**Current Status**: PARTIAL

**Issues**:
- **FLOW-004**: No visa/work permit provisioning
- **FLOW-005**: No document checklist creation
- **FLOW-006**: No equipment/asset assignment
- **FLOW-007**: No department/team notification
- **FLOW-008**: Default password not forced to change on first login
- **FLOW-009**: No email sent with credentials

---

### FLOW-003: Leave Request → Approval

**Start**: Employee submits leave request on `/leaves/apply`

**Steps**:
1. Select leave type, dates, reason
2. Submit → `applyLeave` server action
3. Validate balance (LeaveBalance check)
4. Create LeaveRequest (status: PENDING)
5. Create Notification to manager
6. Manager views on `/dashboard/approvals` or `/leaves`
7. Manager approves/rejects → `approveLeave`/`rejectLeave`
8. Update LeaveRequest status
9. If approved: decrement LeaveBalance.usedDays
10. Create Notification to employee
11. Create AuditLog

**Database Changes**:
- INSERT LeaveRequest
- UPDATE LeaveBalance (if approved)
- INSERT Notification (x2)
- INSERT AuditLog

**API Calls**: Server actions (leave.ts)

**Permissions**: 
- Apply: All (own)
- Approve: MANAGER (team), HR, ADMIN

**Notifications**: Manager notified on submit, employee notified on decision

**End State**: LeaveRequest APPROVED/REJECTED, balance updated

**Failure States**:
- Insufficient balance → validation error
- Overlapping dates → validation error
- Unauthorized approval → 403

**Current Status**: PARTIAL

**Issues**:
- **FLOW-010**: No HR review step for extended leave (> 5 days)
- **FLOW-011**: No automatic balance accrual (monthly/annual)
- **FLOW-012**: No calendar integration
- **FLOW-013**: No half-day leave support

---

### FLOW-004: Payroll Generation

**Start**: PAYROLL_ADMIN/ADMIN clicks "Generate Payroll" on `/payroll/generate`

**Steps**:
1. Select month/year
2. Select employees (or all)
3. Submit → `generatePayroll` server action
4. For each employee:
   - Get SalaryStructure
   - Calculate gross (basic + allowances)
   - Calculate deductions (loan installments, advances)
   - Calculate net
   - Create SalaryRecord
   - Generate PDF payslip
5. Create AuditLog
6. Revalidate payroll paths

**Database Changes**:
- INSERT SalaryRecord (multiple)
- INSERT AuditLog

**API Calls**: Server action, `/api/payroll/export`

**Permissions**: ADMIN, HR, PAYROLL_ADMIN

**Notifications**: None (should notify employees)

**End State**: SalaryRecords created, payslips available

**Failure States**:
- Missing salary structure → error
- Duplicate generation → prevented by unique constraint
- Calculation error → partial rollback needed

**Current Status**: PASS

**Issues**:
- **FLOW-014**: No bank file export (UAE WPS format)
- **FLOW-015**: No email delivery of payslips
- **FLOW-016**: No payroll lock period enforcement
- **FLOW-017**: No year-end processing workflow

---

### FLOW-005: Letter Generation

**Start**: User selects letter type on `/letters` or `/letters/offer`

**Steps**:
1. Select template (Offer, Appointment, Relieving, Salary Cert, NOC)
2. Select employee
3. Fill dynamic fields
4. Preview live A4 render
5. Generate → `generateLetter` server action
6. Apply digital stamp & signature
7. Create LetterRecord
8. Download PDF

**Database Changes**:
- INSERT LetterRecord
- INSERT Letter (if new template)

**API Calls**: `/api/templates`, `/api/letters`, server actions (letters.ts)

**Permissions**: 
- Generate: ADMIN, HR
- View own: STAFF
- Approve: ADMIN, HR (for sensitive)

**Notifications**: None

**End State**: PDF downloaded, record in LetterRecord

**Failure States**:
- Missing template → error
- Missing stamp/signature assets → error
- Employee not found → error

**Current Status**: PASS

**Issues**:
- **FLOW-018**: No approval workflow for offer/appointment letters
- **FLOW-019**: No version control on generated letters
- **FLOW-020**: No bulk letter generation

---

### FLOW-006: Visa & Compliance Tracking

**Start**: HR/ADMIN adds visa document on `/visa`

**Steps**:
1. Select employee
2. Enter document details (Emirates ID, Passport, Visa, Medical Insurance)
3. Set expiry dates
4. Save → `createVisaRequest` server action
5. System tracks expiry
6. Dashboard shows expiring soon alerts

**Database Changes**:
- INSERT VisaRequest (or update Employee visa fields)

**API Calls**: Server actions (visa.ts)

**Permissions**: ADMIN, HR

**Notifications**: Dashboard alerts only

**End State**: Document tracked, expiry monitored

**Failure States**:
- Duplicate document → validation
- Past expiry date → warning

**Current Status**: PASS

**Issues**:
- **FLOW-021**: No automated expiry alerts (email/SMS)
- **FLOW-022**: No renewal workflow
- **FLOW-023**: No government portal integration

---

### FLOW-007: Staff Service Requests

**Start**: Employee submits request on `/staff-services`

**Steps**:
1. Select category (Reimbursement, Overtime, Letter, etc.)
2. Fill form, attach files
3. Submit → `createServiceRequest` server action
4. Create ServiceRequest (status: DRAFT → SUBMITTED)
5. Notify approver (based on category)
6. Approver reviews on `/dashboard/approvals` or `/requests`
7. Approve/Reject → update status
8. Notify requester
9. Create AuditLog

**Database Changes**:
- INSERT ServiceRequest
- INSERT ServiceApproval
- INSERT Notification (x2)
- INSERT AuditLog

**API Calls**: Server actions (staff-requests.ts)

**Permissions**: 
- Submit: All
- Approve: Based on ServiceConfig

**Notifications**: Approver and requester notified

**End State**: Request APPROVED/REJECTED

**Failure States**:
- Invalid category → error
- Missing attachment → validation

**Current Status**: PASS

---

### FLOW-008: Attendance Machine Integration

**Start**: Biometric device sends data to `/api/attendance/import`

**Steps**:
1. Device POSTs CSV/JSON
2. Parse and validate
3. Match employee by device ID/roll number
4. Create BiometricLog
5. Create/Update Attendance record
6. Handle shift rules (late, early, overtime)
7. Return sync status

**Database Changes**:
- INSERT BiometricLog
- INSERT/UPDATE Attendance

**API Calls**: `/api/attendance/import`

**Permissions**: Service account / API key

**Notifications**: None

**End State**: Attendance synced

**Failure States**:
- Unknown employee → log error, continue
- Invalid format → 400
- Duplicate punch → handle gracefully

**Current Status**: PASS

**Issues**:
- **FLOW-024**: No API key authentication on import endpoint
- **FLOW-025**: No device registration/management
- **FLOW-026**: No real-time sync status dashboard

---

### FLOW-009: Role/Access Request

**Start**: Employee requests role change on `/dashboard/request-access`

**Steps**:
1. Select desired role
2. Provide justification
3. Submit → `createRoleRequest` server action
4. Create RoleRequest (status: PENDING)
5. Notify ADMIN
6. ADMIN reviews on `/dashboard/request-access`
7. Approve/Reject → update User.role
8. Notify requester
9. Create AuditLog

**Database Changes**:
- INSERT RoleRequest
- UPDATE User.role (if approved)
- INSERT Notification (x2)
- INSERT AuditLog

**API Calls**: Server actions (role-request.ts)

**Permissions**: 
- Request: All
- Approve: ADMIN only

**Notifications**: ADMIN and requester

**End State**: Role updated or request rejected

**Failure States**:
- Invalid role → error
- Self-approval attempt → blocked

**Current Status**: PASS

---

## Workflow Dependencies

```
Employee Onboarding
  → User Creation
  → Salary Structure
  → Leave Balances
  → Welcome Notification
  → Audit Log

Leave Request
  → Leave Balance Check
  → Manager Notification
  → Approval
  → Balance Update
  → Employee Notification

Payroll Generation
  → Salary Structure
  → Loan Installments
  → Advance Deductions
  → Net Calculation
  → Payslip PDF
  → Audit Log

Letter Generation
  → Template Selection
  → Employee Data Merge
  → Stamp/Signature
  → PDF Generation
  → Record Creation
```

---

## Missing Workflows

| Workflow | Priority | Description |
|----------|----------|-------------|
| Employee Offboarding | HIGH | Exit interview, asset return, access revocation, final settlement |
| Leave Balance Accrual | HIGH | Monthly/annual automatic accrual based on policy |
| Performance Reviews | MEDIUM | Periodic review cycles, goals, feedback |
| Document Expiry Alerts | HIGH | Automated email/SMS for visa, passport, insurance |
| Payroll Bank Export | HIGH | UAE WPS SIF file generation |
| Shift Conflict Detection | MEDIUM | Prevent overlapping shift assignments |
| Overtime Auto-Calculation | MEDIUM | Based on attendance vs shift hours |
| Emergency Contact Workflow | LOW | Notify emergency contact on incidents |

---

## Workflow Issue Summary

| ID | Workflow | Issue | Severity |
|----|----------|-------|----------|
| FLOW-001 | Auth | No rate limiting | HIGH |
| FLOW-002 | Auth | No MFA | MEDIUM |
| FLOW-003 | Auth | No brute force protection | HIGH |
| FLOW-004 | Onboarding | No visa provisioning | MEDIUM |
| FLOW-005 | Onboarding | No document checklist | MEDIUM |
| FLOW-006 | Onboarding | No equipment assignment | LOW |
| FLOW-007 | Onboarding | No team notification | LOW |
| FLOW-008 | Onboarding | No password change enforcement | HIGH |
| FLOW-009 | Onboarding | No credential email | MEDIUM |
| FLOW-010 | Leave | No HR review step | HIGH |
| FLOW-011 | Leave | No auto accrual | HIGH |
| FLOW-012 | Leave | No calendar integration | MEDIUM |
| FLOW-013 | Leave | No half-day support | MEDIUM |
| FLOW-014 | Payroll | No bank file export | HIGH |
| FLOW-015 | Payroll | No payslip email | MEDIUM |
| FLOW-016 | Payroll | No lock period | MEDIUM |
| FLOW-017 | Payroll | No year-end | LOW |
| FLOW-018 | Letters | No approval workflow | HIGH |
| FLOW-019 | Letters | No version control | MEDIUM |
| FLOW-020 | Letters | No bulk generation | LOW |
| FLOW-021 | Visa | No automated alerts | HIGH |
| FLOW-022 | Visa | No renewal workflow | MEDIUM |
| FLOW-023 | Visa | No gov integration | LOW |
| FLOW-024 | Attendance | No API auth on import | CRITICAL |
| FLOW-025 | Attendance | No device management | MEDIUM |
| FLOW-026 | Attendance | No sync dashboard | LOW |