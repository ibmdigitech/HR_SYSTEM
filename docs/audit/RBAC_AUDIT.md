# RBAC AUDIT

## Role Definitions

| Role | Description | Default Permissions |
|------|-------------|---------------------|
| `SUPER_ADMIN` | System owner, full access | All permissions |
| `ADMIN` | Organization administrator | All except system config |
| `HR_ADMIN` | HR department head | Employees, Leaves, Letters, Visa, Payroll view |
| `HR` | HR staff | Employees, Leaves, Letters, Visa |
| `PAYROLL_ADMIN` | Payroll department head | Payroll, Loans, Salary Structure |
| `PAYROLL` | Payroll staff | Payroll view, Payslips |
| `ATTENDANCE_ADMIN` | Attendance manager | Attendance, Shifts, Machine Integration |
| `ATTENDANCE` | Attendance staff | Attendance marking, Shifts view |
| `MANAGER` | Team/department manager | Team attendance, leaves, requests approval |
| `STAFF` | Regular employee | Own data, requests, leaves, payslips |
| `CUSTOM_ADMIN` | Custom role via ServiceConfig | Configurable |

---

## Permission Matrix

| Permission | SUPER_ADMIN | ADMIN | HR_ADMIN | HR | PAYROLL_ADMIN | PAYROLL | ATTENDANCE_ADMIN | ATTENDANCE | MANAGER | STAFF |
|------------|-------------|-------|----------|-----|---------------|---------|------------------|------------|---------|-------|
| **System** | | | | | | | | | | |
| `system.config` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `system.audit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `system.backup` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Users & Access** | | | | | | | | | | |
| `users.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `users.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `roles.view` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `roles.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `access.request` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `access.approve` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Employees** | | | | | | | | | | |
| `employees.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (team) | ❌ |
| `employees.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `employees.edit` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `employees.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `employees.import` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `employees.export` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Attendance** | | | | | | | | | | |
| `attendance.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ (team) | ✅ (own) |
| `attendance.mark` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ (team) | ✅ (own) |
| `attendance.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `attendance.shifts` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `attendance.import` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `attendance.export` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ (team) | ✅ (own) |
| **Leaves** | | | | | | | | | | |
| `leaves.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (team) | ✅ (own) |
| `leaves.apply` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `leaves.approve` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (team) | ❌ |
| `leaves.manage` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `leaves.balance` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (team) | ✅ (own) |
| **Payroll** | | | | | | | | | | |
| `payroll.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ (own) |
| `payroll.generate` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payroll.structure` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payroll.payslips` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ (own) |
| `payroll.export` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `payroll.overtime` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Loans** | | | | | | | | | | |
| `loans.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (team) | ✅ (own) |
| `loans.apply` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `loans.approve` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `loans.manage` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `loans.types` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Letters** | | | | | | | | | | |
| `letters.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (team) | ✅ (own) |
| `letters.generate` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `letters.approve` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `letters.templates` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Visa** | | | | | | | | | | |
| `visa.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (team) | ✅ (own) |
| `visa.manage` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Requests** | | | | | | | | | | |
| `requests.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (team) | ✅ (own) |
| `requests.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `requests.approve` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (team) | ❌ |
| **Notifications** | | | | | | | | | | |
| `notifications.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (own) |
| `notifications.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Settings** | | | | | | | | | | |
| `settings.view` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `settings.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `service.config` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Recruitment** | | | | | | | | | | |
| `recruitment.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `recruitment.manage` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## User-Role Mapping (Current Seed)

| User | Email | Role | Employee Linked |
|------|-------|------|-----------------|
| Admin User | admin@company.com | ADMIN | Yes (ADM-001) |
| Manager User | manager@company.com | MANAGER | Yes (MGR-001) |
| Staff User | staff@company.com | STAFF | Yes (STF-001) |

---

## Role-Permission Resolution

### Current Implementation (auth.ts + server actions)

```typescript
// auth.ts - JWT callback
token.role = (user as any).role ?? 'STAFF'

// Server actions - explicit check
if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
    return { success: false, message: "Unauthorized" };
}
```

### Issues

| ID | Issue | Severity |
|----|-------|----------|
| **RBAC-001** | No middleware protection - routes accessible without role check | CRITICAL |
| **RBAC-002** | Role checks duplicated in every server action | HIGH |
| **RBAC-003** | No permission abstraction layer (e.g., `can(user, 'employees.create')`) | HIGH |
| **RBAC-004** | MANAGER permissions hardcoded to "team" - no team membership model | HIGH |
| **RBAC-005** | No resource-level permissions (e.g., own vs team vs all) | MEDIUM |
| **RBAC-006** | ServiceConfig allows custom roles but no UI to assign | MEDIUM |
| **RBAC-007** | No role hierarchy (ADMIN > HR_ADMIN > HR) | MEDIUM |
| **RBAC-008** | No impersonation/audit for admin actions | LOW |
| **RBAC-009** | OAuth users get role from DB but no sync on role change | MEDIUM |
| **RBAC-010** | No session invalidation on role change | HIGH |

---

## User → Employee Relationship

```prisma
model User {
  id        String     @id @default(cuid())
  email     String     @unique
  password  String?
  role      Role       @default(STAFF)
  name      String?
  employee  Employee?  @relation("UserEmployee")
}

model Employee {
  id       String  @id @default(cuid())
  userId   String? @unique
  user     User?   @relation("UserEmployee", fields: [userId], references: [id])
  // ... other fields
}
```

**Issue**: `userId` is optional, no foreign key constraint enforced at DB level for required link.

---

## Service Configuration (Dynamic Permissions)

**File**: `app/dashboard/admin/services/page.tsx`

**Model**: `ServiceConfig` - key-value store for feature flags

| Config Key | Type | Description |
|------------|------|-------------|
| `overtime_rate` | number | Overtime multiplier |
| `late_penalty` | number | Late penalty per minute |
| `allow_overtime` | boolean | Enable overtime |
| `custom_roles` | JSON | Custom role definitions |

**Gap**: Custom roles defined in ServiceConfig but no integration with NextAuth permissions.

---

## Privilege Escalation Risks

| Risk | Description | Mitigation |
|------|-------------|------------|
| **RBAC-011** | STAFF can access `/employees` page (no middleware) | Add middleware |
| **RBAC-012** | MANAGER can approve own leave via direct API call | Server action checks, but API unprotected |
| **RBAC-013** | No validation on `managerId` in employee create | Could assign self as manager |
| **RBAC-014** | ServiceConfig readable by all authenticated | Should be ADMIN only |
| **RBAC-015** | AuditLog readable by all (no permission check) | Restrict to ADMIN |

---

## Frontend Authorization

**Current**: Conditional rendering based on `session.user.role`

```tsx
// Example from Sidebar.tsx
{session?.user?.role === 'ADMIN' && <AdminMenu />}
```

**Issues**:
- **RBAC-016**: Role checks in UI only - no backend enforcement
- **RBAC-017**: No permission-based component library
- **RBAC-018**: Hardcoded role strings throughout components

---

## Backend Authorization

**Current**: Explicit checks in each server action

```typescript
// Pattern repeated in 19 action files
const session = await auth();
if (!session || !["ADMIN", "HR"].includes((session.user as any).role)) {
    return { success: false, message: "Unauthorized" };
}
```

**Issues**:
- **RBAC-019**: DRY violation - permission logic duplicated
- **RBAC-020**: No centralized permission service
- **RBAC-021**: Inconsistent role arrays across actions

---

## API Authorization

**Current**: No API route protection (except NextAuth endpoints)

| Endpoint | Protection | Issue |
|----------|------------|-------|
| `/api/employees` | None | RBAC-022 |
| `/api/attendance/import` | None | RBAC-023 (CRITICAL) |
| `/api/seed` | None | RBAC-024 (CRITICAL) |
| `/api/templates` | None | RBAC-025 |
| `/api/letters` | None | RBAC-026 |

---

## Audit Logging Coverage

| Action | Logged | Details Captured |
|--------|--------|------------------|
| Employee create/update/delete | ✅ | employeeId, action, details, changedBy |
| Leave apply/approve/reject | ✅ | requestId, action, changedBy |
| Payroll generate | ✅ | period, count, changedBy |
| Letter generate/approve | ✅ | letterId, action, changedBy |
| Visa create/update | ✅ | visaId, action, changedBy |
| Role request | ✅ | requestId, action, changedBy |
| Settings change | ❌ | - |
| Login/logout | ❌ | - |
| Failed auth attempts | ❌ | - |

---

## Recommendations

1. **Immediate**: Add middleware with role-based route protection
2. **Immediate**: Create centralized permission service (`lib/permissions.ts`)
3. **Immediate**: Protect all API routes with permission checks
4. **Short-term**: Implement resource-level permissions (own/team/all)
5. **Short-term**: Add team membership model for MANAGER scope
6. **Short-term**: Integrate ServiceConfig custom roles with auth
7. **Medium-term**: Add session invalidation on role change
8. **Medium-term**: Implement audit logging for all sensitive operations