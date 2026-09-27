# DATABASE AUDIT

## Schema Overview

**ORM**: Prisma 6.19.3
**Database**: PostgreSQL 16
**Connection**: localhost:5433 (Docker)
**Models**: 39 tables

---

## Model Inventory

| Model | Table | Relations | Indexes | Constraints |
|-------|-------|-----------|---------|-------------|
| User | User | Employee (1:1), Account (1:M), Session (1:M), AuditLog (1:M), Notification (1:M), RoleRequest (1:M) | email (unique) | PK: id |
| Account | Account | User (M:1) | provider_providerAccountId (unique) | PK: id, FK: userId |
| Session | Session | User (M:1) | sessionToken (unique) | PK: id, FK: userId |
| Employee | Employee | User (1:1), SalaryStructure (1:1), LeaveBalance (1:M), Attendance (1:M), LeaveRequest (1:M), LetterRecord (1:M), VisaRequest (1:M), ServiceRequest (1:M), ReimbursementRequest (1:M), LoanApplication (1:M), Overtime (1:M), AuditLog (1:M), Notification (1:M) | rollNumber, employeeCode, userId (unique) | PK: id |
| SalaryStructure | SalaryStructure | Employee (1:1) | employeeId (unique) | PK: id, FK: employeeId |
| LeaveBalance | LeaveBalance | Employee (M:1) | employeeId_leaveType_year (unique) | PK: id, FK: employeeId |
| LeaveRequest | LeaveRequest | Employee (M:1), User (approver M:1) | - | PK: id, FK: employeeId, approverId |
| Attendance | Attendance | Employee (M:1), Shift (M:1) | employeeId_date (unique) | PK: id, FK: employeeId, shiftId |
| Shift | Shift | Employee (1:M), Attendance (1:M) | - | PK: id |
| BiometricLog | BiometricLog | - | employeeId_timestamp | PK: id |
| LetterTemplate | LetterTemplate | LetterRecord (1:M) | - | PK: id |
| LetterRecord | LetterRecord | Employee (M:1), LetterTemplate (M:1) | - | PK: id, FK: employeeId, templateId |
| Letter | Letter | LetterRecord (1:1) | - | PK: id |
| VisaRequest | VisaRequest | Employee (M:1) | - | PK: id, FK: employeeId |
| ServiceRequest | ServiceRequest | Employee (M:1), ServiceCategory (M:1) | - | PK: id, FK: employeeId, categoryId |
| ServiceCategory | ServiceCategory | ServiceRequest (1:M) | - | PK: id |
| ServiceApproval | ServiceApproval | ServiceRequest (1:1), User (approver M:1) | - | PK: id |
| ServiceConfig | ServiceConfig | - | key (unique) | PK: id |
| ServiceComment | ServiceComment | ServiceRequest (M:1), User (M:1) | - | PK: id |
| Notification | Notification | Employee (M:1), User (M:1) | - | PK: id, FK: employeeId, userId |
| ReimbursementRequest | ReimbursementRequest | Employee (M:1) | - | PK: id, FK: employeeId |
| Overtime | Overtime | Employee (M:1) | - | PK: id, FK: employeeId |
| SalaryRecord | SalaryRecord | Employee (M:1) | employeeId_period (unique) | PK: id, FK: employeeId |
| SalaryAdvanceRequest | SalaryAdvanceRequest | Employee (M:1) | - | PK: id, FK: employeeId |
| LoanType | LoanType | LoanApplication (1:M) | - | PK: id |
| LoanApplication | LoanApplication | Employee (M:1), LoanType (M:1) | - | PK: id, FK: employeeId, loanTypeId |
| LoanApproval | LoanApproval | LoanApplication (1:1), User (approver M:1) | - | PK: id |
| LoanDisbursement | LoanDisbursement | LoanApplication (1:1) | - | PK: id |
| LoanInstallment | LoanInstallment | LoanDisbursement (1:M) | - | PK: id, FK: disbursementId |
| LoanDocument | LoanDocument | LoanApplication (1:M) | - | PK: id, FK: loanApplicationId |
| LoanNotification | LoanNotification | LoanApplication (M:1) | - | PK: id |
| AuditLog | AuditLog | Employee (M:1) | employeeId | PK: id, FK: employeeId |
| Candidate | Candidate | JobRequisition (M:1) | email | PK: id |
| JobRequisition | JobRequisition | Candidate (1:M), Interview (1:M) | - | PK: id |
| Interview | Interview | JobRequisition (M:1) | - | PK: id |
| OfferLetter | OfferLetter | Candidate (1:1) | - | PK: id |
| RoleRequest | RoleRequest | User (M:1) | - | PK: id, FK: userId |
| Attachment | Attachment | - | - | PK: id |

---

## Critical Relationships

### User ↔ Employee (1:1, Optional)
```prisma
model User {
  employee Employee? @relation("UserEmployee")
}

model Employee {
  userId String? @unique
  user   User?   @relation("UserEmployee", fields: [userId], references: [id])
}
```
**Issues**:
- **DB-001**: `userId` optional - employee can exist without user, user without employee
- **DB-002**: No FK constraint enforcement at application level for required link
- **DB-003**: Onboarding creates both but no transaction wrapping

### Employee → LeaveBalance (1:M)
```prisma
model LeaveBalance {
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  leaveType  LeaveType
  totalDays  Int
  usedDays   Int @default(0)
  year       Int
  @@unique([employeeId, leaveType, year])
}
```
**Issues**:
- **DB-004**: No automatic accrual job
- **DB-005**: No carry-over logic for unused days

### Employee → SalaryStructure (1:1)
```prisma
model SalaryStructure {
  employeeId       String @unique
  employee         Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  basic            Float
  housingAllowance Float
  transportAllowance Float
  medicalAllowance Float
  otherAllowances  Float
  ctc              Float
}
```
**Issues**:
- **DB-006**: `ctc` stored as computed field - can drift from components
- **DB-007**: No version history for salary changes

---

## Missing Indexes

| Table | Column(s) | Query Pattern | Impact |
|-------|-----------|---------------|--------|
| Employee | email | Login, lookup | HIGH |
| Employee | rollNumber | Attendance import, search | HIGH |
| Employee | department | Filtering, reporting | MEDIUM |
| Employee | currentStatus | Dashboard filters | MEDIUM |
| Attendance | employeeId, date | Daily marking, reports | HIGH |
| LeaveRequest | employeeId, status | Manager approval queue | HIGH |
| LeaveBalance | employeeId, year | Balance checks | HIGH |
| SalaryRecord | employeeId, period | Payslip generation | HIGH |
| Notification | employeeId, read | Unread count | MEDIUM |
| AuditLog | employeeId, createdAt | Audit trails | MEDIUM |
| VisaRequest | employeeId, visaExpiry | Expiry alerts | HIGH |
| ServiceRequest | employeeId, status | User requests | MEDIUM |

---

## Data Integrity Issues

| ID | Issue | Severity |
|----|-------|----------|
| **DB-008** | No soft delete on Employee - hard delete loses history | HIGH |
| **DB-009** | No FK from User to Employee (optional both ways) | HIGH |
| **DB-010** | LeaveRequest.approverId not required for PENDING | MEDIUM |
| **DB-011** | Attendance.shiftId optional - breaks shift rules | MEDIUM |
| **DB-012** | No check constraint on LeaveBalance.usedDays <= totalDays | MEDIUM |
| **DB-013** | No unique constraint on User.email (has unique index but not FK) | LOW |
| **DB-014** | SalaryRecord.ctc can drift from SalaryStructure | MEDIUM |
| **DB-015** | No audit log for User role changes | HIGH |
| **DB-016** | No audit log for Settings changes | MEDIUM |
| **DB-017** | BiometricLog no FK to Employee (string employeeId) | HIGH |

---

## Migration History

| Migration | Description | Status |
|-----------|-------------|--------|
| `20241201000000_init` | Initial schema | APPLIED |
| `20241215000000_add_visa` | Visa tracking | APPLIED |
| `20250101000000_add_loans` | Loan management | APPLIED |
| `20250201000000_add_recruitment` | Recruitment module | APPLIED |
| `20250301000000_add_shifts` | Shift management | APPLIED |
| `20250401000000_add_service_config` | Service configuration | APPLIED |

**Current**: `prisma db push` used (no new migrations generated)

---

## Seed Data Analysis

**Script**: `scripts/seed-standalone.js`

**Creates**:
- 3 Users (admin, manager, staff)
- 3 Employees linked to users
- 10 LeaveBalance per employee (current year)
- 3 SalaryStructures
- 3 Notifications (welcome)
- 3 AuditLogs (onboarded)
- ServiceConfig (overtime_rate, late_penalty)
- ServiceCategories (8 categories)

**Fails At**: Service Types creation (TypeError: Cannot read properties of undefined)

**Missing Seed Data**:
- Shifts
- LoanTypes
- LetterTemplates
- JobRequisitions
- Candidates

---

## Orphan Records Check

| Check | Query | Expected | Actual |
|-------|-------|----------|--------|
| Employee without User | `SELECT * FROM Employee WHERE userId IS NULL` | 0 | 0 |
| User without Employee | `SELECT * FROM User WHERE id NOT IN (SELECT userId FROM Employee)` | 0 | 0 |
| LeaveBalance without Employee | `SELECT * FROM LeaveBalance WHERE employeeId NOT IN (SELECT id FROM Employee)` | 0 | PENDING |
| Attendance without Employee | `SELECT * FROM Attendance WHERE employeeId NOT IN (SELECT id FROM Employee)` | 0 | PENDING |
| AuditLog without Employee | `SELECT * FROM AuditLog WHERE employeeId NOT IN (SELECT id FROM Employee)` | 0 | PENDING |

---

## Unsafe Queries Found

| File | Query | Risk |
|------|-------|------|
| `app/employees/page.tsx` | `prisma.employee.findMany()` - no select, no pagination | Memory leak on large datasets |
| `app/api/employees/route.ts` | `prisma.employee.findMany()` - returns all fields including salary | Data exposure |
| `app/lib/actions/employees.ts` | `prisma.employee.findMany({ select: {...} })` - proper select | PASS |
| `app/api/letters/route.ts` | `prisma.letterRecord.findMany({ include: { template: true, employee: true } })` - N+1 risk | Performance |

---

## Migration Risks

| Risk | Description | Mitigation |
|------|-------------|------------|
| **DB-018** | No down migrations tested | Test rollback in staging |
| **DB-019** | `db push` in production loses migration history | Use `migrate deploy` |
| **DB-020** | No seeding strategy for production | Create idempotent seed |
| **DB-021** | No data backup before migrations | Automated backup |

---

## Recommendations

1. **Immediate**: Add missing indexes (email, rollNumber, department, currentStatus)
2. **Immediate**: Fix BiometricLog FK to Employee
3. **Immediate**: Add CHECK constraint `usedDays <= totalDays`
4. **Immediate**: Make Employee.userId required (with migration)
5. **Short-term**: Implement soft delete on Employee
6. **Short-term**: Add salary change history table
7. **Short-term**: Create automatic leave accrual job
8. **Short-term**: Add pagination to all list queries
9. **Medium-term**: Implement audit log for all model changes
10. **Medium-term**: Add database-level constraints for business rules