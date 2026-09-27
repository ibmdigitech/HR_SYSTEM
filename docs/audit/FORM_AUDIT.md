# FORM AUDIT

## Form Inventory

| Form | Page | Fields | Validation | Status |
|------|------|--------|------------|--------|
| Login | `/login` | Email, Password | Zod (server) | PASS |
| Employee Create/Edit | `/employees` | 45 fields | Server only | NEEDS FIX |
| Leave Apply | `/leaves/apply` | 8 fields | Server only | PASS |
| Loan Apply | `/payroll/loans/apply` | 12 fields | Server only | PASS |
| Letter Generate | `/letters/offer` | 15 fields | Server + template | PASS |
| Shift Create/Edit | `/attendance/shifts` | 10 fields | Server only | PASS |
| Service Request | `/staff-services` | 12 fields | Server only | PASS |
| Role Request | `/dashboard/request-access` | 5 fields | Server only | PASS |
| Company Settings | `/settings` | 20 fields | Zod (server) | PASS |
| Service Config | `/dashboard/admin/services` | 8 fields | Zod (server) | PASS |
| Bulk Upload | `/employees` | CSV file | Extension + size | PARTIAL |

---

## Detailed Form Audits

### FORM-001: Login Form (`/login`)

**Fields**:
- Email (email, required)
- Password (min 6, required)

**Validation**:
- Client: HTML5 + Zod in `authorize()`
- Server: Zod in NextAuth credentials provider

**Error Handling**: Toast notifications

**Loading State**: Button disabled + spinner

**Submit State**: Prevents double-submit

**Accessibility**: Labels, autocomplete, focus visible

**Mobile**: Stacks vertically, native keyboard types

**Status**: PASS

---

### FORM-002: Employee Create/Edit (`/employees` Dialog)

**Tabs & Fields**:

#### Personal Tab (4 fields)
- First Name (text, required)
- Last Name (text, required)
- Email (email, required)
- Phone (tel, optional)

#### Employment Tab (6 fields)
- Roll Number (text, required)
- Designation (text, required)
- Department (text, required)
- Joining Date (date, required)
- Employment Type (select, default FULL_TIME)
- Work Location (text, optional)

#### Finance Tab (8 fields)
- Basic Salary (number, optional)
- Housing Allowance (number, optional)
- Transport Allowance (number, optional)
- Other Allowance (number, optional)
- Bank Name (text, optional)
- Account Number (text, optional)
- IBAN (text, optional)
- IFSC Code (text, optional)

#### Verification Tab (10 fields)
- Nationality (text, optional)
- Current Status (select: ACTIVE/ON_LEAVE/RESIGNED)
- Passport Number (text, optional)
- Passport Expiry (date, optional)
- Emirates ID (text, optional)
- Emirates ID Expiry (date, optional)
- Visa Number (text, optional)
- Visa Expiry (date, optional)
- Visa Type (text, optional)
- Medical Insurance Expiry (date, optional)

**Validation**:
- **Server Only**: `upsertEmployee` action
- Required: firstName, lastName, email, rollNumber
- Email format validated
- No client-side validation

**Error Handling**: Toast from server action

**Loading State**: Button "Finalize Entry" → loading spinner

**Cancel Behavior**: Closes dialog, resets form

**Reset Behavior**: On close, `setSelectedEmployee(null)`

**Duplicate Handling**: Server catches Prisma unique constraint

**Mobile Usability**: 
- ❌ Dialog too wide (`max-w-4xl`)
- ❌ Tabs overflow
- ❌ Labels too small (10px)
- ❌ No client validation feedback

**Accessibility**:
- Labels present
- Required not marked visually
- No `aria-describedby` for errors
- Tab navigation works

**Status**: NEEDS FIX

---

### FORM-003: Leave Apply (`/leaves/apply`)

**Fields**:
- Leave Type (select: ANNUAL/SICK/CASUAL/EMERGENCY/MATERNITY/PATERNITY/HAJJ/BEREAVEMENT/STUDY/UNPAID)
- Start Date (date, required)
- End Date (date, required)
- Reason (textarea, required)
- Half Day (checkbox) - NOT IMPLEMENTED
- Attachment (file, optional) - NOT IMPLEMENTED

**Validation**:
- Server: Balance check, date overlap, future dates
- Client: None

**Error Handling**: Toast

**Loading State**: Button loading

**Mobile**: Good - native date pickers

**Status**: PASS (with missing half-day/attachment)

---

### FORM-004: Loan Apply (`/payroll/loans/apply`)

**Fields**:
- Loan Type (select from LoanType)
- Amount (number, required)
- Tenure (number, months, required)
- Purpose (textarea, required)
- Guarantor (text, optional)
- Documents (file, optional) - NOT IMPLEMENTED

**Validation**:
- Server: Amount limits, tenure limits, eligibility
- Client: None

**Error Handling**: Toast

**Status**: PASS

---

### FORM-005: Letter Generate (`/letters/offer`, `/letters/appointment`, `/letters/relieving`)

**Fields** (varies by template):
- Employee (select, required)
- Template (select, required)
- Dynamic fields from template (salary, joining date, etc.)
- Custom fields (text/date/number)

**Validation**:
- Server: Template required fields
- Client: None

**Preview**: Live A4 iframe

**Error Handling**: Toast + preview error

**Status**: PASS

---

### FORM-006: Shift Create/Edit (`/attendance/shifts`)

**Fields**:
- Name (text, required)
- Start Time (time, required)
- End Time (time, required)
- Grace Period (number, minutes)
- Late Threshold (number, minutes)
- Overtime After (number, minutes)
- Working Days (multi-select)
- Color (color picker)
- Active (boolean)

**Validation**:
- Server: Time logic, overlap check
- Client: None

**Status**: PASS

---

### FORM-007: Service Request (`/staff-services`)

**Fields**:
- Category (select from ServiceCategory)
- Title (text, required)
- Description (textarea, required)
- Priority (select: LOW/MEDIUM/HIGH/URGENT)
- Attachments (file, multiple, optional) - NOT IMPLEMENTED

**Validation**:
- Server: Category exists, required fields
- Client: None

**Status**: PASS

---

### FORM-008: Role Request (`/dashboard/request-access`)

**Fields**:
- Requested Role (select: MANAGER/HR/PAYROLL_ADMIN/ATTENDANCE_ADMIN/CUSTOM)
- Justification (textarea, required)
- Supporting Document (file, optional) - NOT IMPLEMENTED

**Validation**:
- Server: Role valid, not current role
- Client: None

**Status**: PASS

---

### FORM-009: Company Settings (`/settings`)

**Fields**:
- Company Name (text)
- Address (textarea)
- Phone (tel)
- Email (email)
- Website (url)
- Logo (file) - NOT IMPLEMENTED
- Letterhead (file) - NOT IMPLEMENTED
- HR Signature (file) - NOT IMPLEMENTED
- Stamp (file) - NOT IMPLEMENTED
- Timezone (select)
- Currency (select)
- Weekend Days (multi-select)

**Validation**:
- Server: Zod schema
- Client: None

**Status**: PASS

---

### FORM-010: Bulk Employee Upload (`/employees` - CSV)

**File Requirements**:
- Format: CSV only
- Max Size: 5MB
- Encoding: UTF-8

**Columns Expected**: 30+ columns matching employee fields

**Validation**:
- Client: Extension check (.csv), size check (5MB)
- Server: CSV parsing, row validation, Prisma create

**Error Handling**: 
- Toast for success
- Warning for partial failures (first 3 errors shown)
- Error details for failed rows

**Loading State**: "Uploading master file..." toast

**Cancel**: Not applicable (file input)

**Mobile**: File input works

**Status**: PARTIAL (no template download, no preview)

---

## Common Form Issues

| Issue | Forms Affected | Severity |
|-------|----------------|----------|
| **FORM-001** | No client-side validation | All forms | HIGH |
| **FORM-002** | No inline field errors | All forms | HIGH |
| **FORM-003** | Labels too small (10px) | Employee, Settings | MEDIUM |
| **FORM-004** | Required fields not marked | All forms | MEDIUM |
| **FORM-005** | No character counters | Textareas | LOW |
| **FORM-006** | No autosave/draft | Long forms (Employee) | MEDIUM |
| **FORM-007** | No unsaved changes warning | Employee, Letter | MEDIUM |
| **FORM-008** | Date picker not native on mobile | All date fields | LOW |
| **FORM-009** | File upload no preview | Bulk upload, Service Request | MEDIUM |
| **FORM-010** | Select search/filter missing | Large selects (Employee, Category) | MEDIUM |
| **FORM-011** | No keyboard shortcuts | All forms | LOW |
| **FORM-012** | Paste validation missing | All fields | LOW |

---

## Validation Library

**Current**: Zod (server only in actions)
**Client**: None (HTML5 only)

**Recommendation**: Add React Hook Form + Zod resolver for client validation

```typescript
// lib/validations/employee.ts
export const employeeSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email"),
  rollNumber: z.string().min(1, "Roll number required"),
  // ... all fields
})

// In component:
const form = useForm<EmployeeForm>({
  resolver: zodResolver(employeeSchema),
  defaultValues: initialData
})
```

---

## Form UX Patterns

| Pattern | Implementation | Status |
|---------|----------------|--------|
| Field Groups | Fieldset + Legend | PARTIAL |
| Error Summary | Top of form | MISSING |
| Inline Errors | Below field | MISSING |
| Success Message | Toast only | PARTIAL |
| Progress Indicator | Multi-step forms | MISSING |
| Auto-focus First Error | On submit | MISSING |
| Enter to Submit | Works | PASS |
| Escape to Close | Dialogs | PASS |
| Dirty Tracking | **NONE** | MISSING |

---

## Mobile Form Specifics

| Form | Mobile Issues | Fix |
|------|---------------|-----|
| Employee | Dialog width, tabs, labels | Full-screen drawer, accordion, 14px labels |
| Leave Apply | Good | - |
| Loan Apply | Good | - |
| Letter Generate | Preview small | Full-screen preview |
| Bulk Upload | File input OK | Add template download |

---

## Recommendations

### Immediate (Week 1)
1. Add client-side validation with React Hook Form + Zod
2. Implement inline error display
3. Fix Employee form mobile (dialog, tabs, labels)
4. Mark required fields visually (*)

### Short-term (Week 2)
5. Add unsaved changes warning
6. Implement autosave for Employee form
7. Add character counters for textareas
8. Native date pickers on mobile

### Medium-term (Week 3-4)
8. Form progress for multi-tab Employee form
9. Field-level help tooltips
10. Keyboard shortcuts (Cmd+S save, Escape cancel)
11. File upload preview
12. Select search for large dropdowns