# USER PROVISIONING AUDIT

**Date**: 2026-09-28 · Read-only. No code, data or schema changed.

## When a User is created

Traced every call site of `prisma.user.create` and `tx.user.create`:

| Trigger | Creates User? | Password | Evidence |
|---|---|---|---|
| Seed (`scripts/seed-standalone.js`) | Yes — **first run only** | `bcrypt("password123")` on create; `update: {}` on existing, so **never resets** | guarded by `if (!existingUser)` |
| Employee entry form (`upsertEmployee`) | Yes — **inside the transaction** | `null` | `app/lib/actions/employees.ts` |
| Joining (`completeJoining`) | Yes — **inside the transaction** | `null` | `lib/workflow/joining.ts` |
| Bulk CSV upload | Yes — **inside the transaction** | `null` | `app/lib/actions/bulk-upload.ts` |
| Candidate applied | **No** | — | `applyToJob` creates only `Candidate` |
| Candidate selected | **No** | — | `markHired` sets `Application.status` only |
| Offer accepted | **No** | — | `transitionOffer` touches `OfferLetter` only |
| Visa completed | **No** | — | nothing writes `User` |
| Admin action | **No dedicated action exists** | — | — |

**Conclusion**: a User is created at exactly two meaningful points — **employee
entry** and **joining**. Never at selection, never at offer acceptance, never at
visa completion. That is correct: the brief requires login only once the person
is genuinely part of the workforce.

## Who creates it

`upsertEmployee`, `completeJoining` and `uploadMasterFile` each call
`requirePermission(PERMISSIONS.EMPLOYEES_CREATE)` or
`PERMISSIONS.RECRUITMENT_CONVERT` before touching `User`. Verified by reading
each function.

| Action | Permission required | Granted to |
|---|---|---|
| `upsertEmployee` | `employees.create` | ADMIN, HR |
| `completeJoining` | `recruitment.convert` | ADMIN, HR |
| `uploadMasterFile` | `employees.create` | ADMIN, HR |
| `reissueActivationLink` | `employees.edit` | ADMIN, HR |
| `approveRoleRequest` | `access.approve` | ADMIN |

**No route or action creates a User as ADMIN-only.** HR can create accounts.

## How the password is created

**No application path ever assigns a usable default password.** Verified across
every `user.create` call site:

- Entry/joining/bulk all write `password: null`
- `null` cannot match `bcrypt.compare`, so the account is unusable by design
- The **only** place `password123` is set is the seed, on first creation only

Login flow, `auth.ts` → `authorize()`:

1. Rate-limit check (5 / 15 min, dual key)
2. `bcrypt.compare` against `user.password`
3. If `null` → refused, and `mustChangePassword` is surfaced
4. If matched but `mustChangePassword` → **refused**
5. Only a fully activated account returns a session

**Regression-locked** by `tests/sec-027-regression.test.ts` (7 assertions),
including a static check that the seed's `update` branch contains no password
write.

## First login

```
HR creates employee
  └─ User created, password null
  └─ issueActivationToken() → PasswordResetToken (SHA-256 hash, TTL 48h)
  └─ the ONE-TIME link is returned to HR
Employee opens /activate/<token>
  └─ token validated: exists, unused, unexpired
  └─ password checked against the 12-char policy
  └─ transaction: consume token, set bcrypt hash, clear mustChangePassword
  └─ then ordinary sign-in works
```

Implementation: `lib/workflow/credentials.ts`. The token is **hashed at rest**;
the plaintext exists only in the response, once.

Confirmed working end to end during P1 — an activation was completed and the
new password authenticated while the old one stopped working.

## Login activation vs suspension

`UserSecurityFlag` carries the account-level controls:

| Field | Purpose |
|---|---|
| `mustChangePassword` | Blocks sign-in until a password is set |
| `accountDisabled` | Full login suspension |
| `disabledReason`, `disabledAt` | Why and when |
| `passwordChangedAt` | Last change |
| `failedLoginAttempts`, `lockedUntil` | Account lockout (fields exist; **no action increments them** — the rate limiter is in-memory instead) |

`revokeAccess(userId)` sets `accountDisabled`, nulls `password`, consumes any
outstanding tokens and writes `ACCESS_REVOKED`. **It is not wired to any
workflow** — it is only called by `completeJoining`'s sibling path in
`offboarding.ts` when a request is completed, and that path has no UI.

## Role assignment

| Route | Enforced by | Note |
|---|---|---|
| Entry / joining | hardcoded `role: "STAFF"` | no role choice at creation |
| `/dashboard/request-access` | `validateRoleChange` + `assignableRoles` | self-escalation refused; last SUPER_ADMIN protected |
| `/dashboard/approvals/roles` | `requirePermission(access.approve)` | — |

**Employee Entry cannot change a role.** It always writes `"STAFF"`, and the
`id` it accepts is the Employee's own, so there is no path to target another
user.

## Permission assignment

There is **no `Permission` or `RolePermission` model**. The entire system
resolves permissions from a static table:

```
User.role (String)  →  lib/auth/permissions.ts ROLE_PERMISSIONS  →  resolved set
```

`resolvePermissions(role, overrides)` supports ALLOW/DENY overrides, and
`PermissionOverrides` accepts them — **but no model persists them and no code
passes them.** The override parameter is currently dead capability.

Implication: there is **no per-user permission grant**. Every user with the same
role has identical authority, and a role change is the only lever.

## Scope assignment

Scope is **derived, never stored**:

```
User → Employee → department / managerId
```

`lib/auth/scope.ts` maps a role to a boundary:
`SUPER_ADMIN/ADMIN/HR/FINANCE → ALL`, `MANAGER → DEPARTMENT`, `STAFF → SELF`.

`Employee.department` is a free-text `String`, not a relation to a Department
table — **there is no Department, Branch or Organisation model**. So
department-based scoping matches on a string, and "Company" or "Branch" scope
**cannot be expressed at all**.

## Answers to the identity questions

| # | Question | Verified answer |
|---|---|---|
| A | Candidate without Employee? | **Yes** — `Candidate` has no `employeeId`; probe ACCEPTED |
| B | Employee without User? | **No** — `userId` is NOT NULL; probe REJECTED |
| C | User without Employee? | **Yes** — `User.employee` optional; probe ACCEPTED |
| D | User ↔ Employee 1:1? | **Yes** — `Employee.userId @unique`, `User.employee Employee?` |
| E | Login identity? | `User` (email unique, bcrypt password) |
| F | Business identity? | `Employee` (employeeCode, rollNumber, department) |
| G | Authorization stored? | `User.role String` only |
| H | Permissions calculated? | `lib/auth/permissions.ts` `resolvePermissions()` |
| I | Org scope calculated? | `lib/auth/scope.ts` from `Employee.department` |
| J | Entry can change role? | **No** — always writes `"STAFF"` |
| K | Entry can activate login? | **No** — `password: null`; activation is a separate token flow |

## Defects

| ID | Defect | Severity |
|---|---|---|
| `UP-01` | No `Permission`/`RolePermission` model; per-user grants are impossible | HIGH |
| `UP-02` | `PermissionOverrides` is accepted by the resolver but nothing persists it — dead capability that implies a feature that does not exist | MEDIUM |
| `UP-03` | No Department/Branch/Organisation model; "company" scope is inexpressible | HIGH |
| `UP-04` | `failedLoginAttempts`/`lockedUntil` exist but nothing writes them; only the in-memory limiter is active | MEDIUM |
| `UP-05` | `revokeAccess()` is unreachable from any UI | HIGH |
| `UP-06` | Activation link is displayed once in a transient dialog; HR has no way to re-find it except reissue | MEDIUM |
| `UP-07` | Seeded accounts still use `password123`; no forced-change flag is set on them | MEDIUM |
| `UP-08` | `User.role` is a plain `String` — an invalid role can be written and silently degrades to STAFF | HIGH |
