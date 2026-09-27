# PAGE AUDIT

## Page Audit Summary

| Page | Route | Status | Issues |
|------|-------|--------|--------|
| Landing | `/` | PASS | - |
| Login | `/login` | PASS | - |
| Dashboard | `/dashboard` | PASS WITH WARNINGS | PAGE-001 |
| Approvals | `/dashboard/approvals` | PASS | - |
| Approval Roles | `/dashboard/approvals/roles` | NEEDS FIX | PAGE-002 |
| Letters Dashboard | `/dashboard/letters` | PASS | - |
| Visa Dashboard | `/dashboard/visa` | PASS | - |
| Requests Dashboard | `/dashboard/requests` | PASS | - |
| Request Access | `/dashboard/request-access` | NEEDS FIX | PAGE-003 |
| Admin Services | `/dashboard/admin/services` | PASS | - |
| Settings | `/dashboard/settings` | PASS | - |
| Letter Templates | `/dashboard/settings/templates` | PASS | - |
| Shift Settings | `/dashboard/settings/shifts` | PASS | - |
| Employees | `/employees` | NEEDS FIX | PAGE-004, PAGE-005 |
| Attendance | `/attendance` | PASS | - |
| Shifts | `/attendance/shifts` | PASS | - |
| Machine Integration | `/attendance/machine-integration` | PASS | - |
| Leaves | `/leaves` | PASS | - |
| Apply Leave | `/leaves/apply` | PASS | - |
| Payroll | `/payroll` | PASS | - |
| Salary Structure | `/payroll/structure` | PASS | - |
| Generate Payroll | `/payroll/generate` | PASS | - |
| Payslips | `/payroll/payslips` | PASS | - |
| Overtime | `/payroll/overtime` | PASS | - |
| Loans | `/payroll/loans` | PASS | - |
| Apply Loan | `/payroll/loans/apply` | PASS | - |
| My Loans | `/payroll/loans/my-loans` | PASS | - |
| Loan Types | `/payroll/loans/types` | PASS | - |
| Loan Admin | `/payroll/loans/admin` | PASS | - |
| Letters | `/letters` | PASS | - |
| Offer Letter | `/letters/offer` | PASS | - |
| Appointment Letter | `/letters/appointment` | PASS | - |
| Relieving Letter | `/letters/relieving` | PASS | - |
| Visa | `/visa` | PASS | - |
| Staff Services | `/staff-services` | PASS | - |
| Requests | `/requests` | PASS | - |
| Notifications | `/notifications` | PASS | - |
| Settings | `/settings` | PASS | - |
| Recruitment | `/recruitment` | PASS | - |

---

## Detailed Page Audits

### PAGE-001: Dashboard (`/dashboard`)

**Purpose**: Main landing page after login, shows organizational health metrics

**Components**: 
- Stats cards (employee count, attendance rate, pending approvals, etc.)
- Recent activity feed
- Quick action buttons
- System health indicators

**Data Sources**: Prisma queries for counts, recent records

**API Dependencies**: `/api/auth/session`, server actions for stats

**Database Dependencies**: User, Employee, Attendance, LeaveRequest, Notification

**Permissions**: Any authenticated user

**Loading State**: Skeleton cards shown

**Empty State**: Shows zero counts

**Error State**: Generic error boundary needed

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: PASS WITH WARNINGS - Stats cards stack correctly

**Issues**:
- **PAGE-001**: Sidebar not rendering on initial load (session hydration issue)
  - Root Cause: JWT decryption error on first render
  - Fix: Clear browser data, ensure AUTH_SECRET consistent

---

### PAGE-002: Approval Roles (`/dashboard/approvals/roles`)

**Purpose**: Configure approval workflow roles and hierarchies

**Components**:
- Role matrix table
- Permission checkboxes
- Drag-drop hierarchy
- Save/cancel actions

**Data Sources**: RoleRequest, User, Employee

**API Dependencies**: Server actions for role requests

**Database Dependencies**: RoleRequest, User, Employee

**Permissions**: ADMIN only

**Loading State**: Table skeleton

**Empty State**: "No roles configured"

**Error State**: Toast notifications

**Desktop Status**: PASS

**Tablet Status**: NEEDS FIX - Horizontal overflow

**Mobile Status**: NEEDS FIX - Table unusable, no card view

**Issues**:
- **PAGE-002**: Complex table not responsive
  - Root Cause: Fixed column widths, no mobile alternative
  - Fix: Implement card layout for mobile, horizontal scroll wrapper

---

### PAGE-003: Request Access (`/dashboard/request-access`)

**Purpose**: Manage user role requests and access grants

**Components**:
- Pending requests table
- Approve/reject actions
- Role assignment dropdown
- Search/filter

**Data Sources**: RoleRequest, User

**API Dependencies**: Server actions (role-request.ts)

**Database Dependencies**: RoleRequest, User

**Permissions**: ADMIN only

**Loading State**: Table skeleton

**Empty State**: "No pending requests"

**Error State**: Toast notifications

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: NEEDS FIX - Action buttons overflow

**Issues**:
- **PAGE-003**: Action dropdown overflows on mobile
  - Root Cause: Fixed button group width
  - Fix: Stack buttons vertically on mobile

---

### PAGE-004: Employees (`/employees`)

**Purpose**: Master employee directory with CRUD operations

**Components**:
- EmployeeList (client component)
- Add/Edit dialog with 4 tabs (Personal, Employment, Finance, Verification)
- Search, filter, export CSV
- Bulk import CSV
- Data table with avatar, name, role, status, actions

**Data Sources**: 
- `prisma.employee.findMany()` (server)
- `prisma.employee.findMany()` for managers (server)
- Server actions: upsertEmployee, deleteEmployee, uploadMasterFile

**API Dependencies**: None (uses server actions)

**Database Dependencies**: Employee, User, SalaryStructure, LeaveBalance, Notification, AuditLog

**Permissions**: ADMIN, HR (enforced in server actions)

**Loading State**: Page-level loading.tsx needed

**Empty State**: "No records found" with clear filters button

**Error State**: Toast notifications from server actions

**Desktop Status**: PASS

**Tablet Status**: PASS WITH WARNINGS - Table scrolls

**Mobile Status**: NEEDS FIX - Table overflows, no card fallback

**Issues**:
- **PAGE-004**: Employee table overflows on mobile (< 768px)
  - Root Cause: `min-w-[800px]` on Table, no responsive strategy
  - Fix: Add mobile card layout, horizontal scroll container
- **PAGE-005**: No client-side validation on employee form
  - Root Cause: Form relies solely on server validation
  - Fix: Add Zod schema validation on client, show inline errors

---

### PAGE-005: Employee Form Dialog (Component)

**Purpose**: Create/edit employee records

**Components**:
- Dialog with Tabs (Personal, Employment, Finance, Verification)
- Form fields: Input, Select, DatePicker
- Submit/Cancel actions

**Data Sources**: Initial data from props, managers list

**API Dependencies**: upsertEmployee server action

**Database Dependencies**: Employee, User, SalaryStructure, LeaveBalance

**Permissions**: ADMIN, HR

**Loading State**: Button loading state on submit

**Empty State**: N/A (form)

**Error State**: Toast from server action

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: NEEDS FIX - Dialog too wide, tabs overflow

**Issues**:
- **PAGE-006**: Dialog `max-w-4xl` exceeds mobile viewport
  - Root Cause: Fixed max-width, no mobile breakpoint
  - Fix: `max-w-[95vw]` on mobile, full-screen on < 480px
- **PAGE-007**: TabsList overflows on mobile
  - Root Cause: 4 tabs with long labels, no scroll
  - Fix: Add scrollable tabs or accordion on mobile

---

### PAGE-008: Attendance (`/attendance`)

**Purpose**: Daily attendance marking and overview

**Components**:
- Date picker
- Employee list with attendance status
- Bulk mark actions
- Shift assignment
- Export/download

**Data Sources**: Attendance, Employee, Shift

**API Dependencies**: Server actions (attendance.ts), `/api/attendance/download`, `/api/attendance/import`

**Database Dependencies**: Attendance, Employee, Shift, BiometricLog

**Permissions**: All (scoped to own/team)

**Loading State**: Skeleton rows

**Empty State**: "No attendance records"

**Error State**: Toast notifications

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: PASS WITH WARNINGS - Action buttons stack

---

### PAGE-009: Leaves (`/leaves`)

**Purpose**: Leave request management and balances

**Components**:
- Leave balance cards
- Request table with status badges
- Apply leave dialog
- Approval actions (Manager/HR)
- Calendar view

**Data Sources**: LeaveRequest, LeaveBalance, Employee

**API Dependencies**: Server actions (leave.ts), `/api/leaves/update`

**Database Dependencies**: LeaveRequest, LeaveBalance, Employee, User

**Permissions**: All (scoped)

**Loading State**: Skeleton

**Empty State**: "No leave requests"

**Error State**: Toast

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: PASS

---

### PAGE-010: Payroll (`/payroll`)

**Purpose**: Payroll overview and generation

**Components**:
- Month/year selector
- Employee payroll summary table
- Generate payroll button
- Payslip download
- Salary structure link

**Data Sources**: SalaryRecord, SalaryStructure, Employee

**API Dependencies**: Server actions (payroll.ts), `/api/payroll/export`

**Database Dependencies**: SalaryRecord, SalaryStructure, Employee, User

**Permissions**: ADMIN, HR, PAYROLL_ADMIN

**Loading State**: Table skeleton

**Empty State**: "No payroll records"

**Error State**: Toast

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: PASS WITH WARNINGS - Table scrolls

---

### PAGE-011: Letters (`/letters`)

**Purpose**: Document generation (Offer, Appointment, Relieving, Salary Cert, NOC)

**Components**:
- Letter type tabs
- Template selector
- Employee search
- Live A4 preview
- Download PDF
- Digital stamp/signature

**Data Sources**: LetterTemplate, Employee, LetterRecord

**API Dependencies**: `/api/templates`, `/api/letters`, server actions (letters.ts)

**Database Dependencies**: LetterTemplate, LetterRecord, Letter, Employee

**Permissions**: ADMIN, HR (generate), STAFF (view own)

**Loading State**: Preview loading spinner

**Empty State**: "Select template and employee"

**Error State**: Toast, preview error message

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: PASS WITH WARNINGS - Preview iframe small

---

### PAGE-012: Settings (`/settings`, `/dashboard/settings`)

**Purpose**: Company settings, letter templates, shift configuration

**Components**:
- Tabbed interface
- Company info form
- Template editor
- Shift CRUD
- Service config

**Data Sources**: CompanySettings, LetterTemplate, Shift, ServiceConfig

**API Dependencies**: `/api/configs`, `/api/service-config`, server actions

**Database Dependencies**: CompanySettings, LetterTemplate, Shift, ServiceConfig

**Permissions**: ADMIN only

**Loading State**: Form loading states

**Empty State**: Default configs shown

**Error State**: Toast

**Desktop Status**: PASS

**Tablet Status**: PASS

**Mobile Status**: PASS WITH WARNINGS - Template editor cramped

---

## Common Issues Across Pages

| ID | Issue | Affected Pages | Severity |
|----|-------|----------------|----------|
| PAGE-008 | No loading.tsx for route-level loading | All pages | MEDIUM |
| PAGE-009 | No error boundary for client components | All client pages | HIGH |
| PAGE-010 | Inconsistent empty state messaging | Employees, Attendance, Payroll | LOW |
| PAGE-011 | Toast notifications not accessible | All pages | MEDIUM |
| PAGE-012 | No keyboard shortcuts for power users | Employees, Attendance | LOW |
| PAGE-013 | Date pickers not localized | All date inputs | LOW |
| PAGE-014 | No unsaved changes warning | Employee form, Letter preview | MEDIUM |