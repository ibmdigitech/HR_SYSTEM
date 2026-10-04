# Infrastructure Audit — Company Benefits / Allowances

Audit date: **2026-10-04**
Scope: Requests Flow, Staff Services, Approvals, Documents, Notifications, Audit, RBAC, Company/Location scope, Finance
Method: static inspection of the repository. No files modified.

---

## VERDICT

| Category | Share | Note |
|---|---|---|
| Reachable by **extending** what exists | **~55–60%** | request lifecycle, state machine, approvals, permissions, notifications, audit, RBAC, documents |
| Thin **new UI / CRUD** on top of that | **~20–25%** | service admin, one approval tab, the request form, money formatting |
| **Genuinely new domain build** | **~20%** | money disbursement, budget/accrual ledger, multi-company scope |

The infrastructure is better than average. There is a real generic state machine
with actor lists and guards, a correct compare-and-swap concurrency idiom, an
authenticated file route that 404s rather than 403s to prevent enumeration, and a
redaction layer. That is why the extension estimate is as high as it is.

---

## REUSE — do not duplicate

| Brief requirement | Existing thing to extend |
|---|---|
| Employee raises a claim | **`ServiceCategory` + `ServiceRequest`** (`schema.prisma:1112`, `:1127`). `requiresAmount` / `requiresDates` are **already enforced server-side** (`service-requests.ts:154-204`) |
| Claim lifecycle | **`SERVICE_REQUEST_TRANSITIONS`** (`state-machine.ts:391`). Register a new `<X>_TRANSITIONS` beside the other nine; do not write a new engine |
| Approval routing | `handleRequestAction` CAS + `ServiceApproval` row (`service-requests.ts:382-402`) |
| Notifications | `notifyInApp` (`notifications.ts:139`) + the approver fan-out in `change-requests.ts:37-70` |
| Audit | in-transaction `AuditLog` write (`service-requests.ts:404-413`) |
| Permissions | add `benefit.*` to `PERMISSIONS` + the existing grant arrays |
| Manager scoping | `lib/auth/scope.ts` — `scopeEmployeeWhere`, `canActOnEmployeeRecord` |
| Documents | **`TravelDocument`** (`schema.prisma:2065`) + `app/api/travel/documents/[id]/file/route.ts` |
| Money paid out | `LoanDisbursement` (`schema.prisma:1034`) — the only disbursement precedent |

**There are already three entry points** into `lib/workflow/service-requests.ts`
(`app/lib/actions/staff-requests.ts` and `app/lib/actions/requests.ts` are thin
wrappers over it). Its header at `staff-requests.ts:14-19` records that a
duplicate `submitStaffRequest` with a different signature previously caused a
production bug. **Add a fourth wrapper, not a fourth implementation.**

---

## GENUINELY NEW BUILD

1. **Administrator service creation.** No `ServiceCategory` CRUD exists anywhere.
   `app/dashboard/admin/services/page.tsx` edits `ServiceConfig` key/value rows and
   never sees `ServiceCategory`. `grep 'serviceCategory\.(create|upsert|update|delete)'`
   → one hit, a `findUnique`. This is a hard brief requirement and it is net-new.
2. **Any money-disbursement path.** `ServiceRequest` stops at `FINANCE_APPROVED`
   with no payment step. `ReimbursementRequest` and `SalaryAdvanceRequest` exist
   with full fields and relations — and have **zero call sites**. `Overtime` is
   likewise orphaned: `calculatePayrollRun` never reads it, so `overtimePay` is
   always 0 from the run path. **There is nothing to extend.**
3. **Budget enforcement / accrual.** Nothing in the schema tracks a budget for any
   purpose.
4. **Multi-company / branch scope.** See below — there is nothing at all.
5. **A money formatter.** ~25 inline call sites, four rounding conventions
   (`.toLocaleString()`, `.toFixed(2)`, `Math.round()`, `en-GB` with 2dp), two
   locales. The same number renders differently depending on the panel.
6. **A per-entity timeline.** `AuditLog` has no `entityType`/`entityId`, so it
   cannot answer "history of *this* claim".

---

## LANDMINES — read before writing code

### 1. Money is `Float`, everywhere

`grep 'Decimal' prisma/schema.prisma` returns **4 lines**, all added recently by
the travel-budget work. Everything else is IEEE-754: `ServiceRequest.amount`,
`SalaryRecord.netSalary`, `FinalSettlement.finalAmount`, `LoanType.maxAmount`,
`SalaryStructure.ctc`. There is **no rounding policy anywhere**;
`netSalary` is computed as a raw JS float (`payroll.ts:169`).

A financial feature that must not mis-pay someone **cannot** be built on that.
The schema's own new comment (`:620-624`) says it outright. Mixing a `Decimal`
budget against a `Float` amount will surface rounding.

### 2. The Staff Services approval queue was unscoped — FIXED IN THIS SESSION

`approvals/page.tsx:126` read `where: { status: "PENDING" }` with no filter, so any
role holding `service.approve` — **MANAGER included** — saw every pending staff
request in the company. The leave queue beside it already scoped correctly, which
is what made the omission easy to miss.

Now routed through `scopeEmployeeWhere`, the centralised primitive, and it **fails
closed** if the subject cannot be resolved.

> Remaining inconsistency, deliberately not papered over: `scope.ts` scopes a
> MANAGER to a **whole department**, while `leave-queue.ts` scopes to **direct
> reports**. Both are stricter or looser than each other in different places. I
> used the centralised primitive rather than adding a third rule, but reconciling
> the two is real work and is not done.

### 3. Department scope is a string compare on a nullable free-text column

`Employee.department String?` (`schema.prisma:546`) — the only scope field that
exists. `"Finance"` ≠ `"finance"` ≠ `"FINANCE"` ≠ `"Finance "`. A MANAGER with a
differently-cased department **silently sees an empty queue with no error**.

### 4. There is no Company, Branch, Location or Tenant model

`grep 'companyId|locationId|branchId|tenantId|orgId'` across the whole repository:
**9 hits, zero in any model.** All are OAuth `tenantId` config or prose. The
schema is **single-tenant by construction**, and `Employee.email`, `.rollNumber`,
`.employeeCode` are all globally `@unique`.

Brief §41 (multi-company security) therefore has **nothing to extend** — it is
from-scratch, and it is the prerequisite for §6 (per-location policy).

### 5. `public/uploads` does not exist and no code writes to it

`service-requests.ts:244`, `leave.ts:145` and `visa.ts:61` all write
`fileUrl: "/uploads/..."`. **Every attachment on every staff-service, leave and
visa request is a dangling reference.** It does not fail today only because
nothing ever dereferences those values. Any new upload path must use the
`TravelDocument` data-URL + authenticated-route pattern instead.

Related: `Attachment` has **four nullable FKs and no constraint that exactly one
is set**, so an orphan row is representable.

### 6. `ACCESS_DENIED` is logged on SUCCESSFUL operations

`service-requests.ts:264` and `:432` log `SECURITY_ACTION.ACCESS_DENIED` with
`outcome: "SUCCESS"` after a *successful* submit and approve. So does
`app/api/configs/route.ts:131` and `app/api/service-config/route.ts:88,126,157`.
**Any dashboard filtering `action = ACCESS_DENIED` is counting successes.**
Do not propagate this into the benefits audit trail.

### 7. `ServiceRequest.status` is an unvalidated free string

The status vocabulary (`PENDING, MANAGER_APPROVED, …`) exists only as a comment at
`schema.prisma:1137`. There are **no Prisma enums anywhere in the schema**. Worse:
the caller-facing verb `"APPROVED"` does **not** map to a status called `APPROVED`
— it maps to `MANAGER_APPROVED` (`service-requests.ts:347`), and the map header
records that earlier code wrote a non-existent `"APPROVED"` status and corrupted
the queue. Passing the verb through verbatim reintroduces that bug.

### 8. A page render performs a write

`app/requests/page.tsx:7-27` calls `ensureServiceTypes()` on **every request**,
including a `createMany` guarded by `if (count === 0)`. It races with
`scripts/seed-standalone.js:167-205`, which seeds a **different, overlapping** set
of categories. Whichever runs first wins; the other's rows never appear.

### 9. Currency is implicitly AED, and the settings UI implies otherwise

Exactly one `currency` column exists in the whole schema (`Asset.currency`).
`SettingsDrawer.tsx:108-118` renders a Currency `<Select>` with AED/USD/EUR — and
**it is decorative**: no form action, no submit handler, every control
uncontrolled. It is a false promise to users. The "AED is implicit" decision is
deliberate and documented (`schema.prisma:1953-1955`); honour it.

---

## THREE DEAD MODELS THAT DO NOT REDUCE THE BUILD

`ReimbursementRequest` (`:1174`), `SalaryAdvanceRequest` (`:1187`), and orphaned
`Overtime` all exist with complete fields **and relations**
(`Employee.reimbursements`, `Employee.salaryAdvances`). Grep confirms **zero call
sites**. They look like they halve the work. They do not — they are unreachable
and always have been.

---

## RECOMMENDED SEQUENCE

Ordered by dependency. Each phase ships value alone.

**Phase 0 — blockers that are not benefits work**
- Fix the production migration story (`P3019`: migration lock is `sqlite`, no
  `_prisma_migrations` in either database). Until then no schema change can be
  deployed safely. See `DEPLOYMENT_INFRASTRUCTURE_AUDIT.md`.
- Introduce a `Decimal` convention and a single `formatMoney()` helper before any
  financial feature.

**Phase 1 — service administration**
`ServiceCategory` CRUD + permission + UI, replacing the two competing hardcoded
arrays. This is what makes services configurable per brief §3/§53, and it is a
prerequisite for everything else.

**Phase 2 — claim workflow on the existing spine**
Extend `ServiceRequest` with `eligibleAmount` / `approvedAmount` as `Decimal`,
plus `BenefitService`/`BenefitPolicy` (versioned) and
`BenefitDocumentRequirement`. Reuse `SERVICE_REQUEST_TRANSITIONS`, `ServiceApproval`,
`notifyInApp`, `AuditLog`. Add document verification on the `TravelDocument` shape.

**Phase 3 — payment**
The only part with no precedent. `BenefitPaymentTransaction` for partial payments,
idempotency on completion, and a decision on whether it feeds `SalaryRecord`.

**Phase 4 — budget**
Ledger + reservation, transactional with approval. Depends on Phase 3's money
model being `Decimal`.

**Phase 5 — multi-company / branch**
`Company` → `Location` → `Department` → `Employee`, and a real scope layer
replacing the free-text department compare. Large, and it unblocks §6 and §41.

---

## ANSWERS TO THE BRIEF'S HARDEST QUESTIONS

**"Do not create a second Requests Flow"** — extend `ServiceRequest` and
`lib/workflow/service-requests.ts`. Add a wrapper, never an implementation.

**"Do not create a second approval system"** — the six existing approval tabs are
**six hand-written copies with no shared abstraction**. There is no `ApprovalQueue`
component and no registry. So "extend, don't duplicate" is currently impossible
without first extracting a shared queue. That extraction is the prerequisite, and
it is where the §2 scoping bug should be fixed once rather than in a 7th copy.

**"Never allow approval before document verification"** — `OnboardingChecklistItem`
is the only verification store and covers ten fixed onboarding categories. A
benefits document type has **no checklist counterpart and therefore cannot be
gated at all** (`change-requests.ts:127` maps `ADDRESS_PROOF: null` for exactly
this reason). Verification state must live on the document itself, as
`TravelDocument` does.