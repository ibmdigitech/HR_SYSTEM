# ROUTE INVENTORY

## Complete Route Discovery

Discovered from source tree: `app/**/page.tsx` and `app/api/**/route.ts`

---

## Application Routes (Pages)

| Route | Module | Auth Required | Permission | API Dep | Desktop | Mobile | Status |
|-------|--------|---------------|------------|---------|---------|--------|--------|
| `/` | Landing | No | - | No | PASS | PASS | PASS |
| `/login` | Auth | No | - | Yes | PASS | PASS | PASS |
| `/dashboard` | Dashboard | Yes | - | Yes | PASS | PASS | PASS |
| `/dashboard/approvals` | Approvals | Yes | approvals.view | Yes | PASS | PASS | PASS |
| `/dashboard/approvals/roles` | Approvals | Yes | approvals.manage | Yes | PASS | NEEDS FIX | NEEDS FIX |
| `/dashboard/letters` | Letters | Yes | letters.view | Yes | PASS | PASS | PASS |
| `/dashboard/visa` | Visa | Yes | visa.view | Yes | PASS | PASS | PASS |
| `/dashboard/requests` | Requests | Yes | requests.view | Yes | PASS | PASS | PASS |
| `/dashboard/request-access` | Access Control | Yes | admin | Yes | PASS | NEEDS FIX | NEEDS FIX |
| `/dashboard/admin/services` | Service Config | Yes | admin | Yes | PASS | PASS | PASS |
| `/dashboard/settings` | Settings | Yes | settings.view | Yes | PASS | PASS | PASS |
| `/dashboard/settings/templates` | Letter Templates | Yes | letters.manage | Yes | PASS | PASS | PASS |
| `/dashboard/settings/shifts` | Shift Settings | Yes | attendance.manage | Yes | PASS | PASS | PASS |
| `/employees` | Employees | Yes | employees.view | Yes | PASS | NEEDS FIX | NEEDS FIX |
| `/attendance` | Attendance | Yes | attendance.view | Yes | PASS | PASS | PASS |
| `/attendance/shifts` | Shifts | Yes | attendance.manage | Yes | PASS | PASS | PASS |
| `/attendance/machine-integration` | Machine Integration | Yes | admin | Yes | PASS | NEEDS FIX | NEEDS FIX |
| `/leaves` | Leaves | Yes | leaves.view | Yes | PASS | PASS | PASS |
| `/leaves/apply` | Leave Apply | Yes | leaves.apply | Yes | PASS | PASS | PASS |
| `/payroll` | Payroll | Yes | payroll.view | Yes | PASS | PASS | PASS |
| `/payroll/structure` | Salary Structure | Yes | payroll.manage | Yes | PASS | PASS | PASS |
| `/payroll/generate` | Payroll Generate | Yes | payroll.generate | Yes | PASS | PASS | PASS |
| `/payroll/payslips` | Payslips | Yes | payroll.view | Yes | PASS | PASS | PASS |
| `/payroll/overtime` | Overtime | Yes | payroll.manage | Yes | PASS | PASS | PASS |
| `/payroll/loans` | Loans | Yes | loans.view | Yes | PASS | PASS | PASS |
| `/payroll/loans/apply` | Loan Apply | Yes | loans.apply | Yes | PASS | PASS | PASS |
| `/payroll/loans/my-loans` | My Loans | Yes | loans.view | Yes | PASS | PASS | PASS |
| `/payroll/loans/types` | Loan Types | Yes | loans.manage | Yes | PASS | PASS | PASS |
| `/payroll/loans/admin` | Loan Admin | Yes | loans.manage | Yes | PASS | PASS | PASS |
| `/letters` | Letters | Yes | letters.view | Yes | PASS | PASS | PASS |
| `/letters/offer` | Offer Letter | Yes | letters.generate | Yes | PASS | PASS | PASS |
| `/letters/appointment` | Appointment Letter | Yes | letters.generate | Yes | PASS | PASS | PASS |
| `/letters/relieving` | Relieving Letter | Yes | letters.generate | Yes | PASS | PASS | PASS |
| `/visa` | Visa | Yes | visa.view | Yes | PASS | PASS | PASS |
| `/staff-services` | Staff Services | Yes | services.view | Yes | PASS | PASS | PASS |
| `/requests` | Requests | Yes | requests.view | Yes | PASS | PASS | PASS |
| `/notifications` | Notifications | Yes | - | Yes | PASS | PASS | PASS |
| `/settings` | Settings | Yes | settings.view | Yes | PASS | PASS | PASS |
| `/recruitment` | Recruitment | Yes | recruitment.view | Yes | PASS | PASS | PASS |

**Total Application Routes: 38**

---

## API Routes

| Method | Endpoint | Auth | Permission | Validation | Status |
|--------|----------|------|------------|------------|--------|
| GET/POST | `/api/auth/[...nextauth]` | No | - | Yes | PASS |
| GET | `/api/templates` | Yes | letters.view | Yes | PASS |
| GET/POST | `/api/employees` | Yes | employees.manage | Partial | NEEDS FIX |
| POST | `/api/seed` | No | admin | No | BLOCKED |
| GET/POST | `/api/service-config` | Yes | admin | Yes | PASS |
| GET/POST | `/api/configs` | Yes | admin | Yes | PASS |
| POST | `/api/configs/reset` | Yes | admin | Yes | PASS |
| POST | `/api/letters/[id]/approve` | Yes | letters.approve | Yes | PASS |
| GET | `/api/letters` | Yes | letters.view | Yes | PASS |
| GET | `/api/attendance/download` | Yes | attendance.export | Yes | PASS |
| POST | `/api/attendance/import` | Yes | attendance.manage | Partial | NEEDS FIX |
| GET | `/api/payroll/export` | Yes | payroll.export | Yes | PASS |
| POST | `/api/leaves/update` | Yes | leaves.approve | Yes | PASS |

**Total API Routes: 14**

---

## Server Actions (lib/actions)

| Action File | Functions | Module | Auth Check |
|-------------|-----------|--------|------------|
| `employees.ts` | upsertEmployee, deleteEmployee, getActiveEmployees | Employees | ADMIN/HR |
| `attendance.ts` | markAttendance, bulkMarkAttendance, getAttendance | Attendance | All roles |
| `attendance-import.ts` | importAttendance | Attendance | ADMIN/HR |
| `leave.ts` | applyLeave, approveLeave, rejectLeave, getLeaveBalances | Leaves | Role-based |
| `payroll.ts` | generatePayroll, getPayslips, createSalaryStructure | Payroll | ADMIN/HR |
| `loans.ts` | applyLoan, approveLoan, getLoans | Loans | Role-based |
| `loan-advanced.ts` | advanced loan operations | Loans | ADMIN/HR |
| `letters.ts` | generateLetter, approveLetter, getLetters | Letters | Role-based |
| `letter-templates.ts` | CRUD templates | Letters | ADMIN/HR |
| `visa.ts` | CRUD visa requests | Visa | Role-based |
| `staff-requests.ts` | CRUD service requests | Staff Services | All roles |
| `requests.ts` | CRUD general requests | Requests | All roles |
| `role-request.ts` | CRUD role requests | Access Control | ADMIN/HR |
| `shifts.ts` | CRUD shifts | Attendance | ADMIN/HR |
| `notifications.ts` | getNotifications, markRead | Notifications | All roles |
| `company-settings.ts` | CRUD company settings | Settings | ADMIN |
| `bulk-upload.ts` | uploadMasterFile | Employees | ADMIN/HR |
| `recruitment.ts` | CRUD candidates/jobs | Recruitment | ADMIN/HR |
| `overtime.ts` | CRUD overtime | Payroll | ADMIN/HR |

**Total Server Action Files: 19**

---

## Route Issues

| ID | Route | Issue | Severity |
|----|-------|-------|----------|
| ROUTE-001 | `/employees` | Table overflows on mobile, no card fallback | HIGH |
| ROUTE-002 | `/dashboard/approvals/roles` | Complex permission matrix, mobile unusable | MEDIUM |
| ROUTE-003 | `/dashboard/request-access` | No mobile layout | MEDIUM |
| ROUTE-004 | `/attendance/machine-integration` | Technical page, not mobile-friendly | LOW |
| ROUTE-005 | `/api/employees` | No input validation on POST | HIGH |
| ROUTE-006 | `/api/attendance/import` | No file type/size validation | HIGH |
| ROUTE-007 | `/api/seed` | No authentication, destructive | CRITICAL |

---

## Authentication Flow Routes

| Route | Purpose | Status |
|-------|---------|--------|
| `/login` | Credentials/OAuth sign-in | PASS |
| `/api/auth/callback/credentials` | Credentials callback | PASS |
| `/api/auth/callback/google` | Google OAuth callback | NOT TESTED |
| `/api/auth/callback/microsoft-entra-id` | Microsoft OAuth callback | NOT TESTED |
| `/api/auth/signout` | Sign out | NOT TESTED |
| `/api/auth/session` | Session check | PASS |
| `/api/auth/providers` | Provider list | PASS |
| `/api/auth/csrf` | CSRF token | PASS |

---

## Redirect Rules (from auth.config.ts)

| From | Condition | To |
|------|-----------|-----|
| `/` | Not authenticated | `/login` |
| `/` | Authenticated | `/dashboard` |
| `/login` | Authenticated | `/dashboard` |
| `/dashboard/*` | Not authenticated | `/login` |
| All other | Not authenticated | `/login` |

---

## Route Coverage by Role

| Route | STAFF | MANAGER | HR | ADMIN | PAYROLL_ADMIN | ATTENDANCE_ADMIN |
|-------|-------|---------|-----|-------|---------------|------------------|
| `/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/employees` | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `/attendance` | ✅ (own) | ✅ (team) | ✅ | ✅ | ❌ | ✅ |
| `/leaves` | ✅ (own) | ✅ (team) | ✅ | ✅ | ❌ | ❌ |
| `/payroll` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| `/letters` | ✅ (own) | ✅ (team) | ✅ | ✅ | ❌ | ❌ |
| `/visa` | ✅ (own) | ✅ (team) | ✅ | ✅ | ❌ | ❌ |
| `/staff-services` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/requests` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/settings` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `/recruitment` | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |

*Note: Role-based access enforced in server actions only, not in middleware.*