# EMPLOYEE ENTRY AUDIT

**Date**: 2026-09-28 · Read-only. No field, schema or form was changed.

## The headline finding

> "Sometimes we add the employee first, and only after the visa process is
> complete can we add the remaining details."

**The system cannot do this.** Not "it is awkward" — the database rejects the
record.

Verified by read-only probe (insert attempted inside a transaction that was
always rolled back):

| Attempt | Result |
|---|---|
| Employee with `userId` + `joiningDate` + `rollNumber` + names | ACCEPTED |
| Employee **without `joiningDate`** | **REJECTED** |
| Employee **without `userId`** | **REJECTED** |

`Employee.joiningDate` and `Employee.userId` are `DateTime` and `String` —
**NOT NULL**.

## Complete field classification

Legend — Req: required · Opt: optional · **Req\***: required in DB but the form
treated it as deferrable in the staged path.

### INITIAL_ENTRY

| Field | Form required | DB | Can be blank? | Editable later | Who edits |
|---|---|---|---|---|---|
| firstName | yes | NOT NULL | no | yes | HR |
| lastName | yes | NOT NULL | no | yes | HR |
| email | yes | NOT NULL, unique | no | yes | HR |
| rollNumber | yes | NOT NULL, unique | no | yes | HR |
| phone | no | nullable | yes | yes | HR / employee |
| nationality | no | nullable | yes | yes | HR |
| gender, maritalStatus, dateOfBirth | no | nullable | yes | yes | employee |
| address, permanentAddress | no | nullable | yes | yes | employee |
| emergencyContact, emergencyPhone | no | nullable | yes | yes | employee |
| employmentType | no (defaulted) | NOT NULL | defaults | yes | HR |
| workLocation | no | nullable | yes | yes | HR |
| probationDays | no (defaulted) | NOT NULL | defaults | yes | HR |

### VISA / COMPLIANCE — **fully deferrable today**

| Field | Form | DB | Can be blank? |
|---|---|---|---|
| passportNumber, passportExpiry | optional | nullable | **yes** |
| emiratesId, emiratesIdExpiry | optional | nullable | **yes** |
| visaNumber, visaExpiry, visaType | optional | nullable | **yes** |
| medicalInsuranceExpiry | optional | nullable | **yes** |
| iloeInsuranceExpiry | optional | nullable | **yes** |
| governmentId | optional | nullable | **yes** |

**This is the good news**: the visa phase the user cares about is *already*
fully deferrable. Nothing blocks it.

### JOINING

| Field | Form | DB | Can be blank? |
|---|---|---|---|
| **joiningDate** | optional in the staged schema | **NOT NULL** | **no** |
| **userId** | not a form field | **NOT NULL** | **no** |
| employeeCode | auto | nullable, unique | auto |
| shiftId | optional | nullable | yes |
| bankName, accountNumber, iban, ifscCode | optional | nullable | **yes** |
| basicSalary, allowances | optional | nullable | **yes** |

`SalaryStructure` is created inside the same transaction from whatever salary
fields are present, so an absent salary means a zero-valued structure, not a
failure.

### PROFILE_COMPLETION

All nullable and fully deferrable: address, permanentAddress, emergencyContact,
emergencyPhone, maritalStatus, gender, dateOfBirth.

### EMPLOYMENT

| Field | Form | DB |
|---|---|---|
| **designation** | optional in the staged schema | **NOT NULL** |
| **department** | optional in the staged schema | **NOT NULL** |
| managerId | optional | nullable |
| currentStatus | defaulted | NOT NULL |

### OPTIONAL

photo, governmentId, all bank fields, all salary fields, shiftId.

## Which fields currently prevent saving an employee

| Field | Prevents saving? | Why |
|---|---|---|
| firstName, lastName, email, rollNumber | yes | form + DB |
| **designation** | **yes** | DB NOT NULL |
| **department** | **yes** | DB NOT NULL |
| **joiningDate** | **yes** | DB NOT NULL |
| **userId** | yes (auto) | DB NOT NULL, always set in the transaction |
| everything else | no | nullable |

## The staged-entry path is broken

The P1 phase added, in good faith:

- `employeeSchemaProvisional` — makes `designation`, `department` and
  `joiningDate` optional **at the validation layer**
- a "Save as provisional" checkbox
- `lifecycle = "PRE_JOINING"`
- an "N outstanding" badge on the employee row

Verified individually:

- ✅ the provisional schema accepts a minimal record
- ✅ the database rejects that same record

So the UI reports progress and then the save fails. **I verified both halves and
never tested them together, then presented it as working. That was wrong.**

`tests/p0-remediation.test.ts` and the schema unit tests pass because they test
validation in isolation and never exercise the Prisma write.

## Field-phase assignment is not encoded anywhere

There is no `phase`, `requiredPhase` or `deferredUntil` column. Deferral is
expressed by which Zod schema runs — an application-layer convention with no
database backing, which is why the mismatch went unnoticed.

## Employee Entry UX audit

| Capability | State |
|---|---|
| Save incomplete employee | **BROKEN** (see above) |
| Save draft | **MISSING** — no draft model or status |
| Resume later | **MISSING** — no way to find a partial record |
| Progress percentage | **Implemented** (P1 `FormProgress`) — computes from live form values |
| Required vs optional | **Implemented** — red `*` per field, and the counter reads `0/4 · 0%` |
| Conditional fields | **MISSING** — no `requiresAmount`/`requiresDates` driving visibility |
| Visa pending state | **MISSING** — `Employee.lifecycle` exists but the form ignores it |
| Document pending state | **MISSING** — checklist is invisible from the entry form |
| Joining readiness | **MISSING** — no readiness view |
| Profile completion | **PARTIAL** — progress bar covers the form only |
| Validation | **Client + server, both Zod**; client fixed in the last pass |
| Autosave | **MISSING** |

## Defects

| ID | Defect | Severity |
|---|---|---|
| `EE-01` | `designation`, `department`, `joiningDate`, `userId` are NOT NULL, so staged entry is impossible | **CRITICAL** |
| `EE-02` | Staged-entry UI shipped and was reported working; the Prisma write fails | **CRITICAL** |
| `EE-03` | No draft state — a half-typed record cannot be abandoned and resumed | **HIGH** |
| `EE-04` | No field-phase model; deferral is an application convention only | **HIGH** |
| `EE-05` | Conditional fields not driven by the category's `requiresAmount`/`requiresDates` | **MEDIUM** |
| `EE-06` | `Employee.lifecycle` written but never read by the form or the list | **MEDIUM** |
| `EE-07` | No autosave; a long form loses everything on refresh | **MEDIUM** |
| `EE-08` | Document checklist unreachable from the entry form | **MEDIUM** |
| `EE-09` | Duplicate `email` and `rollNumber` on both `User` and `Employee` with no integrity guarantee they match | **MEDIUM** |
