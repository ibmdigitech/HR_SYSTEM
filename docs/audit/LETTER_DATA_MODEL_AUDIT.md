# Letter Data Model Audit

**Scope:** `prisma/schema.prisma` letter- and document-adjacent models, verified field by field against the live database.
**Date:** 2026-09-29 · **Type:** READ-ONLY
**Method:** read `prisma/schema.prisma`; queried `information_schema`, `pg_indexes` and `pg_constraint` on `postgresql://hr_app@localhost:5433/hr_system`; counted rows. No migrations, no `db push`, no writes.

Related: [TEMPLATE audit](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION audit](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [INTEGRATION audit](./LETTER_SYSTEM_INTEGRATION_AUDIT.md) · [WORKFLOW MATRIX](./LETTER_WORKFLOW_MATRIX.md) · [SUMMARY](./LETTER_AUDIT_SUMMARY.md)

---

## 1. Headline

**There are two unrelated letter data models and a third approval model that is entirely orphaned.**

| Family | Models | Rows in DB | Written by | Read by |
|---|---|---|---|---|
| **A — "documented" letter** | `Letter`, `LetterTemplate` | `Letter` 4, `LetterTemplate` 3 | `POST /api/letters`, `lib/workflow/offer-letter.ts` | `GET /api/letters` |
| **B — "recorded" letter** | `LetterRecord` | **0** | `app/lib/actions/letters.ts` (unreachable pages), `lib/workflow/letters.ts` (dead code) | `app/api/search/route.ts:1034` |
| **C — "requested" letter** | `LetterRequest`, `LetterApproval` | **0 / 0** | **nothing** | **nothing** |

Family A has a template engine and a PDF. Family B has a full approval state machine, versioning, bulk generation and an audit trail. Family C has a two-level approval chain. **No letter ever passes between A, B and C.** A single letter is represented by exactly one row in exactly one family, and which family depends on which screen HR happened to use.

---

## 2. Model-by-model verification

### 2.1 `LetterTemplate` — `prisma/schema.prisma:1134-1145`

Verified field list: `id, name, type, content_en, content_ar?, isActive:Boolean, createdAt, updatedAt` + relations `letters[]`, `requests[]`.

The brief's list is **correct in full**. Confirmed absent by reading the complete block: no `version`, no letterhead, no HTML/JSON body, no company/branch scope, no `createdBy`. `isActive` is a plain `Boolean` (`:1140`), not a DRAFT/ACTIVE/ARCHIVED machine.

**No `TemplateVersion` model exists.** Repo-wide search returns 0 matches. See the template audit §7 for the consequence.

`type` (`:1137`) is an unconstrained `String`. Three live values exist: `EMPLOYMENT`, `PAYROLL`, `NOC`. Two other modules match against it by string equality (`offer-letter.ts:22` looks for `"OFFER"` — no match; `workflow/letters.ts:30` lists five approval-required types — only `NOC` intersects). **This is the most dangerous single column in the letter subsystem.**

### 2.2 `Letter` — `prisma/schema.prisma:1147-1177`

Verified field list:

```
id, employeeId?, employee?, candidateId?, candidate?, templateId (required FK),
template, referenceNumber @unique, letterRequestId? @unique, letterRequest?,
issuedForOffer[] (OfferLetter[]), status (default "DRAFT"), content_en,
content_ar?, pdfUrl?, comments?, approvedBy?, approvedAt?, jobRequisition?,
jobRequisitionId?, createdAt, updatedAt
```

Corrections to the brief:

- **The brief omits `letterRequestId`** — a nullable `@unique` FK to `LetterRequest`, `schema.prisma:1160-1161`. This is the *only* structural link between family A and family C, and nothing writes it.
- **The brief omits `jobRequisitionId`** and `pdfUrl`, `comments`, `approvedBy`, `approvedAt`.
- `employeeId` **is** nullable, and correctly so: `schema.prisma:1149-1151` documents that an offer letter is issued pre-hire, to a `Candidate`.

**DB-verified constraints:**

```
Letter_pkey              PRIMARY KEY (id)
Letter_referenceNumber_key  UNIQUE ("referenceNumber")
Letter_letterRequestId_key  UNIQUE ("letterRequestId")
Letter_templateId_fkey   FK ("templateId") → LetterTemplate(id) ON DELETE RESTRICT
Letter_employeeId_fkey   FK ("employeeId") → Employee(id)       ON DELETE SET NULL
Letter_candidateId_fkey  FK ("candidateId") → Candidate(id)     ON DELETE SET NULL
Letter_letterRequestId_fkey FK → LetterRequest(id)              ON DELETE SET NULL
Letter_jobRequisitionId_fkey FK → JobRequisition(id)            ON DELETE SET NULL
```

`ON DELETE SET NULL` on `employeeId` and `candidateId` means **deleting an employee silently detaches their letters and leaves the content in the table with no subject.** Every one of the 4 `Letter` rows is a signed employment or salary document. There is no FK to `Employee` with `RESTRICT` holding the record. (The repo's stated policy in `schema.prisma:1478-1484` is that exit records must block employee deletion — letters are the one evidence class that does not.)

**Indexes on `Letter`: none beyond the three unique/pkey indexes.** `pg_indexes WHERE tablename='Letter'` returns exactly `Letter_pkey`, `Letter_referenceNumber_key`, `Letter_letterRequestId_key`. There is no index on `employeeId`, `templateId`, `status` or `createdAt`. `GET /api/letters` (`app/api/letters/route.ts:21-32`) filters on `employeeId` and orders by `createdAt desc` — both unindexed.

### 2.3 `LetterRecord` — `prisma/schema.prisma:1079-1107`

Verified field list: `id, employeeId?, employee?, type, recipientName, details?, generatedAt`, plus the P1.5 block `documentKey:String @default(""), version:Int @default(1), status:String @default("GENERATED"), requiresApproval:Boolean, requestedById?, approvedById?, approvedAt?, rejectedReason?, voidedAt?, voidReason?, supersededById?`.

Indexes: `@@index([documentKey, version])`, `@@index([employeeId, type])`, `@@index([status])` — all present in `pg_indexes` (`:1104-1106`). **This is the only letter model with sensible index coverage.**

`documentKey` is `String @default("")` with **no unique constraint on `(documentKey, version)`.** `lib/workflow/letters.ts:80-93` computes the next version by `findFirst({ where: { documentKey }, orderBy: { version: 'desc' } })` and then writes it in a separate transaction step. Two concurrent `createLetter` calls with the same `documentKey` can both read `version = 1` and both insert `version = 1` — the versioning guarantee the module's own header comment claims ("The full chain is traceable") is not enforced by the database.

`employeeId` FK: `Employee?` with default `RESTRICT` (no `onDelete` clause at `:1082`).

**Row count: 0.** Orphan check (`LEFT JOIN Employee`): 0.

### 2.4 `LetterRequest` — `prisma/schema.prisma:1109-1121`

Verified field list: `id, employeeId (required FK), employee, templateId, template, reason?, status @default("PENDING"), approvals[], generatedLetter Letter?, createdAt, updatedAt`.

Brief's list is **correct in full**. `employeeId` is indeed required, `generatedLetter` is the 1-1 back-reference via `Letter.letterRequestId @unique`.

### 2.5 `LetterApproval` — `prisma/schema.prisma:1123-1132`

Verified field list: `id, letterRequestId (FK, Cascade), approverId?, level:String, action:String, comments?, createdAt`.

Brief's list correct. Note `level` and `action` are unconstrained `String` with only comment-level enumerations (`// MANAGER, HR` / `// APPROVED, REJECTED`) — **no `enum`, no check constraint**.

### 2.6 `LetterRequest` / `LetterApproval` are proven orphaned

Not "unfound" — **proven absent** from application code:

| Search | Scope | Result |
|---|---|---|
| `letterRequest` / `LetterApproval` | every `.ts`/`.tsx` in `app/`, `lib/`, `components/`, `tests/` | **0 matches** outside `prisma/schema.prisma` |
| `prisma.letterRequest` | repo-wide | 0 |
| `prisma.letterApproval` | repo-wide | 0 |
| DB rows | `LetterRequest`, `LetterApproval` | **0, 0** |
| DB indexes | both | pkey only |

There is no two-level manager→HR approval chain in this system, in code or in data. The `status` comment at `:1116` enumerating `PENDING, MANAGER_APPROVED, HR_APPROVED, COMPLETED, REJECTED` describes a workflow that was never built.

### 2.7 `DocumentExpiryReminder` — `prisma/schema.prisma:410-424`

`id, employeeId (FK), employee, documentType, documentId?, thresholdDays, expiryDate, recipientRole @default("EMPLOYEE"), sentAt, deliveryId?`.

`@@unique([employeeId, documentType, thresholdDays, expiryDate])` (`:422`) and `@@index([expiryDate])` (`:423`) — both present in `pg_indexes`. This is the **only letter/document model in the schema with a correct duplicate-suppression constraint**, and the design note at `:408-409` explains why. Worth citing as the house pattern.

**Not letter-related** despite the name: it tracks *employee documents* (VISA, PASSPORT, EMIRATES_ID, …) expiring, not letters. 0 rows. Its `@@unique` is the exact constraint `LetterRecord` is missing.

### 2.8 `DocumentRenewal` — `prisma/schema.prisma:428-444`

`id, employeeId (FK), documentType, currentExpiry, status @default("REQUESTED"), newExpiry?, notes?, reviewedBy?, reviewedAt?, createdBy?, createdAt, updatedAt`. `@@index([employeeId, status])` present. 0 rows. State machine exists at `lib/workflow/state-machine.ts:336-343` (`RENEWAL_STATUS`). Adjacent to, not part of, the letter system.

### 2.9 `Attachment` — `prisma/schema.prisma:1044-1061`

`id, serviceRequestId?, serviceRequest?, reimbursementId?, reimbursementRequest?, visaRequestId?, visaRequest?, employeeId?, employee?, fileName, fileUrl, fileType, category, docNumber?, docExpiry?, createdAt`.

**There is no `letterId` and no `templateId`.** A generated `Letter` cannot have a PDF, a signed scan or any attachment attached to it. `Letter.pdfUrl` (`:1168`) is a bare nullable string, and it is `NULL` for all 4 live rows. **Confirmed: no letter artifact is stored anywhere in the system.** See the generation audit.

`Attachment.employeeId` FK is `ON DELETE Cascade` (`:1053`) — deleting an employee destroys their document attachments. Opposite of the letter policy noted in §2.2.

### 2.10 `OfferLetter` — `prisma/schema.prisma:1432-1471`

The recruitment-side model. Letter-relevant fields: `letterRecordId String?` (`:1462`) and `letterRecord Letter?` (`:1463`), with the reverse side `Letter.issuedForOffer OfferLetter[]` (`:1164`).

**The FK is declared but never used as a guard.** `lib/workflow/offer-letter.ts:76-78` checks `if (offer.letterRecordId)` in application code to prevent double-issuing, and the comment at `schema.prisma:1461` says *"Reuse of the existing Letters engine, not a second PDF pipeline"*. In fact `lib/workflow/offer-letter.ts:99-118` **builds the entire letter body inline as a hardcoded English string array** and writes it to `Letter.content_en` — the `LetterTemplate` it resolved at `:86` is used only to satisfy the required `templateId` FK. The template's content is discarded. **The "reuse" is a label, not a mechanism.**

---

## 3. Row counts (read-only, 2026-09-29)

```sql
SELECT 'Letter', count(*) FROM "Letter"                UNION ALL
SELECT 'LetterTemplate', count(*) FROM "LetterTemplate"  UNION ALL
SELECT 'LetterRecord', count(*) FROM "LetterRecord"      UNION ALL
SELECT 'LetterRequest', count(*) FROM "LetterRequest"    UNION ALL
SELECT 'LetterApproval', count(*) FROM "LetterApproval"  UNION ALL
SELECT 'OfferLetter', count(*) FROM "OfferLetter"        UNION ALL
SELECT 'DocumentExpiryReminder', count(*) FROM "DocumentExpiryReminder"
UNION ALL SELECT 'DocumentRenewal', count(*) FROM "DocumentRenewal"
UNION ALL SELECT 'Attachment', count(*) FROM "Attachment"
UNION ALL SELECT 'Employee', count(*) FROM "Employee"
UNION ALL SELECT 'Candidate', count(*) FROM "Candidate";
```

| Table | Rows |
|---|---|
| `Letter` | **4** |
| `LetterTemplate` | 3 |
| `LetterRecord` | **0** |
| `LetterRequest` | **0** |
| `LetterApproval` | **0** |
| `OfferLetter` | 0 |
| `DocumentExpiryReminder` | 0 |
| `DocumentRenewal` | 0 |
| `Attachment` | **0** |
| `Employee` | 3 |
| `Candidate` | 1 |

### 3.1 The brief's "one pre-existing Letter row" is wrong — there are four

```
 id             | employeeId | candidateId | templateId  | referenceNumber  | status   | createdAt           | pdfUrl
----------------+------------+------------+-------------+------------------+----------+---------------------+--------
 cmumtn9x7…     | cmuh5t4ui… |            | cmuhzr1nr…  | LTR-UAE-2026-004 | GENERATED| 2026-09-29 15:18:50 | (null)
 cmumtn9vf…     | cmuh5t4ui… |            | cmuhzr1ko…  | LTR-UAE-2026-003 | GENERATED| 2026-09-29 15:18:50 | (null)
 cmumtn9td…     | cmuh5t4ui… |            | cmuhzr1mg…  | LTR-UAE-2026-002 | GENERATED| 2026-09-29 15:18:50 | (null)
 cmuhzs72…      | cmuh5t4ui… |            | cmuhzr1ko…  | LTR-UAE-2026-001 | GENERATED| 2026-09-26 06:11:47 | (null)
```

**Correcting the brief:** the claim that `app/lib/actions/letters.ts` produced the 2026-09-26 row is **false on two independent counts**:

1. `app/lib/actions/letters.ts:23` writes to `prisma.letterRecord`, **not** `prisma.letter`. `LetterRecord` has **0 rows**. That action has never successfully written anything.
2. The 2026-09-26 row is in `Letter`, written by `POST /api/letters` (`app/api/letters/route.ts:136-147`).

Three of the four rows were created at `15:18:50` on 2026-09-29 — about nine minutes before this audit began. They were not created by me. The reference numbers 002/003/004 correspond exactly to the `count()+1` sequence, which is consistent with a sequential verification run against all three templates, and their content shows the placeholder fix is live in the database.

**All four rows have `pdfUrl = NULL` and all four target the same employee.** `LetterRecord`, `LetterRequest`, `LetterApproval` and `Attachment` are empty.

### 3.2 Integrity checks

| Check | Query | Result |
|---|---|---|
| Orphaned `Letter.employeeId` | `LEFT JOIN "Employee"` | **0** |
| Orphaned `Letter.templateId` | `LEFT JOIN "LetterTemplate"` | **0** |
| Orphaned `LetterRecord.employeeId` | `LEFT JOIN "Employee"` | **0** |
| `Letter.candidateId` populated | `count(*) FILTER (WHERE "candidateId" IS NOT NULL)` | **0** |
| `Letter.employeeId IS NULL` | `count(*) FILTER (WHERE "employeeId" IS NULL)` | **0** |
| `Letter.letterRequestId` populated | — | **0** (no row joins family A to C) |
| `OfferLetter.letterRecordId` populated | — | **0 offers exist** |
| `ServiceConfig` rows for module `letters` | `WHERE module ILIKE '%letter%'` | **0** — `workflow/letters.ts:32-45` always uses `DEFAULT_APPROVAL_REQUIRED` |
| `ServiceConfig` rows for module `COMPANY` | `WHERE module='COMPANY'` | **0** — every `getCompanySettings()` call returns the hardcoded `"IBMDigiTech LLC"` defaults (`app/lib/actions/company-settings.ts:18-25`) |

The last row is the mechanism behind the two-companies defect documented in the UX audit.

---

## 4. Reference number — data-integrity defect, confirmed

`app/api/letters/route.ts:104-105`:

```ts
const count = await prisma.letter.count();
const refNumber = `LTR-UAE-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
```

Against a `@unique` column (`schema.prisma:1159`; `Letter_referenceNumber_key` in `pg_indexes`).

**Live state:** `max_seq = 4`, `total = 4`. The two agree **only because nothing has ever been deleted.**

| Failure mode | Mechanism |
|---|---|
| **Deletion** | Delete `LTR-UAE-2026-004`; `count()` returns 3; the next letter computes `LTR-UAE-2026-004` again → `P2002` unique violation → `catch` at `:161-164` → HTTP 500 *"Failed to generate letter"*. The user sees a server error, not "that reference number is taken". |
| **Concurrency** | Two simultaneous POSTs both read `count() = 4`, both compute `…-005`. One wins; the other 500s. `count()` is outside the transaction (`:104` precedes `create` at `:136` — there is no `prisma.$transaction` anywhere in this route). |
| **Year rollover** | The year is in the prefix, so `count()` is a global count. On 1 January the counter does not reset; `LTR-UAE-2027-068` is issued after 67 letters in 2026. Cosmetic, but it means the suffix is not a per-year sequence. |
| **Cross-path collision** | `lib/workflow/offer-letter.ts:128` writes `OFFER-${requisitionCode}-V${version}` into the *same* unique column. Different prefix, so no collision today — but two generation paths share one namespace with no coordination. |

There is no sequence, no retry, and no second attempt. **Every collision is a hard 500 to the HR user, and the reference number is not reserved before use.**

---

## 5. The two status vocabularies do not overlap

| Vocabulary | Defined at | Values |
|---|---|---|
| `Letter.status` | `schema.prisma:1165` (default `DRAFT`) | `DRAFT`, `PENDING`, `GENERATED`, `REJECTED` |
| `LETTER_STATUS` | `lib/workflow/state-machine.ts:296-303` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `GENERATED`, `VOID` |

**`PENDING` is not in `LETTER_STATUS`. `APPROVED` and `VOID` are not produced by anything that writes `Letter`.**

Writers of `Letter.status`:
- `app/api/letters/route.ts:145` — `'GENERATED'` for ADMIN/HR/SUPER_ADMIN, `'PENDING'` otherwise
- `app/api/letters/[id]/approve/route.ts:19` — `'GENERATED'`
- `lib/workflow/offer-letter.ts:130` — `'GENERATED'`

DB confirms all 4 rows are `GENERATED`. `LettersPageClient.tsx:161-168` has a badge switch covering `GENERATED`/`PENDING`/`REJECTED`.

`LETTER_TRANSITIONS` (`state-machine.ts:307-330`) is a well-built 6-state machine with per-actor transition rules — and it is **only ever applied to `LetterRecord.status`** (`lib/workflow/letters.ts:188`). **No state machine governs `Letter`.** A letter can be moved to `GENERATED` from any prior state with no validation, because the route that does it (`[id]/approve`) has no `where` status guard at all.

There is also **no enum, check constraint or index** on `Letter.status` or `LetterRecord.status`. Both are free text.

---

## 6. `isActive` is not enforced on the write path

`LetterTemplate.isActive` is filtered on read by `GET /api/templates` (`app/api/templates/route.ts:13`) and by `getLetterTemplates`… **no** — `app/lib/actions/letter-templates.ts:16-18` does `findMany({ orderBy: { name: 'asc' } })` with **no `isActive` filter**.

Consequence: the template management list shows inactive templates (correct — you need to re-activate one), but the two readers of templates now disagree about what an active template is, and only one of them is on the generation path. `POST /api/letters` (`route.ts:89`) fetches the template with `findUnique({ where: { id: templateId } })` and **never checks `isActive`** — a deactivated template can still be used to generate a letter, as long as the caller knows its id. There is no index on `isActive` and no UI to deactivate a template anyway (`page-client.tsx` has no `isActive` control; `LetterTemplateData.isActive` is declared at `letter-templates.ts:11` but never surfaced).

**`isActive` is, in practice, write-only. No UI writes it and no generation path reads it.**

---

## 7. Missing models, proven absent

| Model | Proof of absence |
|---|---|
| `TemplateVersion` | Repo-wide search: 0 matches for the identifier; no `version` column on `LetterTemplate` |
| `LetterArtifact` / letter file storage | No `letterId` on `Attachment`; `Letter.pdfUrl` is NULL on all 4 rows; no `Attachment` rows exist |
| `Company` / `Branch` | No such model. `Employee` has no company or branch FK. Company identity is a `ServiceConfig` key-value that is **currently unconfigured** |
| `LetterCategory` (enforced) | `LetterTemplate.type` is a bare `String`; no lookup model |
| Any `enum` in the letter section | `level`, `action`, `status`, `type` are all `String` with comment-only enumerations |

---

## 8. Findings register

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| DM-01 | **P0** | Two disjoint letter models (`Letter`/`LetterTemplate` and `LetterRecord`) plus two fully orphaned approval models. A letter belongs to whichever one the screen used; they never interoperate. | §1, §2.6, §3 |
| DM-02 | **P1** | `Letter.employeeId` is `ON DELETE SET NULL`. Deleting an employee detaches their signed letters rather than refusing the delete. `Attachment.employeeId` is `ON DELETE Cascade` — destroying document evidence outright. | `pg_constraint`; `schema.prisma:1053,1153` |
| DM-03 | **P1** | Reference numbers use `count()+1` against a `@unique` column with no transaction, no retry and no reservation. Collisions become 500s. | `route.ts:104-105`; §4 |
| DM-04 | **P1** | Two incompatible `status` vocabularies; no state machine governs `Letter`. | §5 |
| DM-05 | **P1** | `LetterTemplate.type` is unconstrained free text matched by equality in two other modules. | §2.1 |
| DM-06 | **P1** | `LetterRecord` versioning has no `@@unique([documentKey, version])`; concurrent creates can produce duplicate versions, defeating the module's own documented guarantee. | `schema.prisma:1092-1093`; `workflow/letters.ts:80-93` |
| DM-07 | **P2** | No index on `Letter.employeeId` / `.status` / `.createdAt`; the only filtered+ordered letter query is unindexed. | `pg_indexes` |
| DM-08 | **P2** | `LetterTemplate.isActive` is enforced on neither the write path nor the management read. | §6 |
| DM-09 | **P2** | `Attachment` cannot reference a `Letter`; `Letter.pdfUrl` is NULL on every row. No letter artifact is stored anywhere. | `schema.prisma:1044-1061`; DB |
| DM-10 | **P2** | `OfferLetter.letterRecordId` is checked in application code only; the link is documented as "reuse of the letters engine" but `offer-letter.ts:99-118` bypasses the template entirely. | `offer-letter.ts:76-118` |
| DM-11 | **P3** | `level`, `action`, `status`, `type` are unconstrained strings with comment-only enumerations. | §2.4, §2.5, §5 |
| DM-12 | **P3** | Reference-number suffix is a global count, not a per-year sequence. | §4 |

## 9. What I could not verify

- **No migration was run or inspected against a shadow database.** Schema conclusions are read from `schema.prisma` and confirmed against live `pg_constraint`/`pg_indexes`, which proves the *deployed* state matches the file for these models — but I did not verify that any pending migration is consistent with it.
- **Whether `LetterRequest`/`LetterApproval` are a deliberate future-state or abandoned scaffolding** is not recorded anywhere. The schema comments suggest deliberate design (`:1088-1091`, `:1116`), which argues for planned-but-unbuilt rather than abandoned. I cannot resolve this from the repository.
- **Delete-behaviour on `Letter` was not exercised.** The `ON DELETE SET NULL` consequence is read from `pg_constraint`; I did not delete an employee.
- **The `hr-system/prisma/schema.prisma` SQLite schema was not diffed line-by-line** against the root schema. `hr-system/ARCHIVED.md:17` records that it targets a different datastore; that is sufficient to exclude it, but the schemas may differ in more than the provider.
