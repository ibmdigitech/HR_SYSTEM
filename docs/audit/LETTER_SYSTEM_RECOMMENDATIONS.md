# Letter System — Recommendations

**Date:** 2026-09-29 · **Type:** RECOMMENDATION ONLY

> **Nothing in this document has been implemented.** No application code, no schema, no data, no configuration was changed during this audit. Every item below is a proposal for a human to accept, reject or reprioritise.

**Evidence base:** [TEMPLATE](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [DATA MODEL](./LETTER_DATA_MODEL_AUDIT.md) · [DUPLICATION](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md) · [WORKFLOW MATRIX](./LETTER_WORKFLOW_MATRIX.md) · [INTEGRATION](./LETTER_SYSTEM_INTEGRATION_AUDIT.md) · [SECURITY](./LETTER_SECURITY_AUDIT.md) · [UX/NAV](./LETTER_UX_NAVIGATION_AUDIT.md)

**Priority definitions**

| | Meaning |
|---|---|
| **P0** | The system issues documents that are wrong, or cannot be trusted. Fix before the next letter is generated. |
| **P1** | The system leaks data, loses evidence, or has a control that does not exist. Fix this sprint. |
| **P2** | Structural debt that will cause the next incident. Fix this quarter. |
| **P3** | Quality and consistency. Fix opportunistically. |

---

# P0

---

## R-01 — Decide which letter model survives, then delete the other three implementations

| | |
|---|---|
| **Problem** | Five letter implementations exist. Three are reachable or half-reachable; two are dead. A letter is written to whichever model the screen used, and the two models never interoperate. |
| **Evidence** | `LETTER_TEMPLATE_DUPLICATION_AUDIT.md` §1 (18 duplicated concerns), §2 (4 PDF engines), §3 (2 substitution engines), §4 (archived tree). `LETTER_WORKFLOW_MATRIX.md` §10: **30 of 72 letter workflows are MISSING**. |
| **Impact** | Every letter HR issues is a one-off. There is no way to answer "what did we send this person, when, and under which approval?" across the whole system. New features keep being written against whichever model the author found first. |
| **Recommendation** | **Keep `Letter` + `LetterTemplate`. Retire `LetterRecord`, `LetterRequest` and `LetterApproval`.** Migrate the two things `Letter` genuinely lacks — versioning and approval — onto `Letter`, from `LetterRecord`'s design. Delete `hr-system/` outright. |
| **Why `Letter` wins** | It is the only model with a template engine, a PDF path, a UI, a search domain and 4 rows of production data. `LetterRecord` has **0 rows** — the richer engine is unwitnessed, and the cheaper model is the one in use. |
| **Why this is cheap *right now*** | `LetterRecord` = 0 rows, `LetterRequest` = 0 rows, `LetterApproval` = 0 rows. The migration is a schema change with no data backfill. **This window closes the moment anyone uses `/letters/appointment` by URL.** |
| **Files** | `app/api/letters/route.ts`, `app/lib/actions/letters.ts`, `lib/workflow/letters.ts`, `app/letters/{appointment,offer,relieving}/**`, `hr-system/**` |
| **Models** | Retire `LetterRecord`, `LetterRequest`, `LetterApproval`; keep `Letter`, `LetterTemplate` |
| **Migration risk** | **Low today, rising.** `LetterRecord` is empty and has no inbound FKs. `Letter` has `OfferLetter.letterRecordId` and `Letter.letterRequestId` to drop, plus 4 rows to preserve. |
| **Dependencies** | None. This is a prerequisite for R-02, R-05, R-06, R-09. |
| **Priority** | **P0** |

---

## R-02 — Extract one `generateLetter()` and make every path go through it

| | |
|---|---|
| **Problem** | `lib/letters/variables.ts` has **exactly one importer**. Three other implementations build letter bodies independently: two inline jsPDF blocks and one hardcoded string array. The placeholder fix that was made today is correct but **structurally unprotected** — nothing stops a fifth renderer. |
| **Evidence** | `LETTER_GENERATION_SYSTEM_AUDIT.md` §1, §3, §5. `LETTER_TEMPLATE_DUPLICATION_AUDIT.md` §3. The header of `lib/workflow/offer-letter.ts:4-5` says *"Do NOT create a second PDF engine"*; there are four. |
| **Impact** | The exact bug that was fixed today — templates rendering their placeholders literally while the API reported success — can recur in any of the other three paths, undetectably. |
| **Recommendation** | One module, one entry point. `generateLetter({ templateId, employeeId \| candidateId, customFields, actor })` performs fetch → resolve → substitute → assert-no-unresolved → allocate reference → persist → audit. Every caller uses it. Delete the inline bodies. Add a test that fails if a second substitution site appears. |
| **Files** | New `lib/letters/service.ts`; delete the jsPDF blocks in `app/letters/*/page-client.tsx` and the string array in `lib/workflow/offer-letter.ts:99-118`; keep `lib/letters/variables.ts` as the engine behind the service |
| **Models** | None |
| **Migration risk** | **Low.** Pure refactor. Requires R-01 to have landed so there is one model to write to. |
| **Dependencies** | R-01 |
| **Priority** | **P0** |

---

## R-03 — Stop emitting documents with `—` and unrendered placeholders

| | |
|---|---|
| **Problem** | A Travel NOC was issued reading *"holding Passport No. —"*. `or()` renders absent values as an em-dash (`variables.ts:98-101`); because the key resolves, `unresolvedPlaceholders` does not fire, and the only signal is a `console.warn` (`:126-134`). |
| **Evidence** | DB row `LTR-UAE-2026-004`. `LETTER_TEMPLATE_SYSTEM_AUDIT.md` §4.4, §4.3. |
| **Impact** | Employees hand documents to banks, embassies and airlines that are visibly defective. The generator reported success. **This is a correctness failure in the primary output of the system.** |
| **Recommendation** | `buildLetterVariables` returns, alongside the map, a list of keys whose value was the `MISSING` fallback. `generateLetter` **refuses to issue** when a *required* placeholder resolved to `MISSING`, and returns the key names. A `strict`/`warn` mode so bulk generation can collect failures rather than abort. Persist the report so it is auditable rather than console-only. |
| **Files** | `lib/letters/variables.ts`, `app/api/letters/route.ts:114-134` |
| **Models** | Optionally a `Letter.warnings String?` column |
| **Migration risk** | **Low, with a caveat.** This will start failing existing templates — which is the point. The three shipped templates will report `passport_number` as missing for every employee until passport data is populated. **That is a correct failure, not a regression.** Stage it: warn-only for one release, then enforce. |
| **Dependencies** | R-02 (so the check lives in one place) |
| **Priority** | **P0** |

---

# P1

---

## R-04 — Scope `GET /api/letters` to the caller

| | |
|---|---|
| **Problem** | `GET /api/letters` checks only that a session exists. With no `employeeId` parameter it returns **every letter in the company to every authenticated user** — including the Salary Certificate body, which contains basic, allowances and gross salary for that employee. |
| **Evidence** | `app/api/letters/route.ts:13-37`. `LETTER_SECURITY_AUDIT.md` §3.1. `PRODUCTION_READINESS_CHECKLIST.md:279` records this IDOR as *"Already true"* — **it is not true for this endpoint.** |
| **Impact** | Any STAFF user can read every employee's compensation. |
| **Recommendation** | `where: scopeEmployeeWhere(subject, { employeeId })` + `LETTER_VIEW` + `take`/`cursor`. `app/api/search/route.ts:1029-1049` already does exactly this, with the reasoning written down — copy that shape. |
| **Files** | `app/api/letters/route.ts:13-37` |
| **Models** | Add `@@index([employeeId])` and `@@index([createdAt])` — neither exists (`pg_indexes`) |
| **Migration risk** | **None** — additive index; the where-clause is a code change. |
| **Dependencies** | None |
| **Priority** | **P1** |

---

## R-05 — Make the approval workflow real, or delete it

| | |
|---|---|
| **Problem** | `LetterRequest` and `LetterApproval` are a two-level approval chain with **zero code and zero rows**. `LETTER_STATUS` / `LETTER_TRANSITIONS` (`state-machine.ts:296-330`) is a well-built 6-state machine applied only to `LetterRecord`, which is unmounted. `Letter` has **no** state machine and uses an incompatible status vocabulary (`PENDING` is not in `LETTER_STATUS`). |
| **Evidence** | `LETTER_DATA_MODEL_AUDIT.md` §2.6, §5. `LETTER_WORKFLOW_MATRIX.md` §3. `LETTER_SECURITY_AUDIT.md` §3.2. |
| **Impact** | Every letter is issued with no approval. The `PENDING` branch in `POST /api/letters:145` is unreachable, and `/dashboard/approvals` has no letter tab. |
| **Recommendation — decide, do not defer.** This is a business decision, not a technical one:<br>**Option A (recommended):** adopt `LETTER_STATUS` + `LETTER_TRANSITIONS` for `Letter.status`, add the letters tab to `/dashboard/approvals`, and delete `LetterRequest`/`LetterApproval`.<br>**Option B:** implement the two-level chain on `LetterRequest`. Higher cost; buys manager-then-HR sign-off that nothing currently requests.<br>**Whichever is chosen, delete `POST /api/letters/[id]/approve` first** — it has zero callers, no state precondition, no audit, and excludes `SUPER_ADMIN`. A half-built mutation endpoint with no consumer is worse than no endpoint. |
| **Files** | `app/dashboard/approvals/page.tsx`, `lib/workflow/state-machine.ts`, `app/api/letters/route.ts:145`, `app/api/letters/[id]/approve/route.ts` (delete), `app/lib/utils/letter-generator.ts:161-168` (the dead `'PENDING'` badge) |
| **Models** | `Letter.status` → the `LETTER_STATUS` vocabulary; retire `LetterRequest`, `LetterApproval` |
| **Migration risk** | **Medium.** Existing rows are all `GENERATED`, which is valid in both vocabularies — so the 4 live rows migrate without change. **Prerequisite: R-01**, or there is no single model to attach the machine to. |
| **Dependencies** | **R-01 is mandatory.** And note: mounting `lib/workflow/letters.ts` *without* the approvals tab would create an approval workflow **no approver can see** (`LETTER_SYSTEM_INTEGRATION_AUDIT.md` §3.2). Do not mount it in isolation. |
| **Priority** | **P1** |

---

## R-06 — Constrain `customFields` and record what was overridden

| | |
|---|---|
| **Problem** | `withAliases` writes caller-supplied keys **last and unconditionally**, so a request body can override `employee_name`, `gross_salary` or any built-in. The forged values are baked into `Letter.content_en` with no provenance. |
| **Evidence** | `lib/letters/variables.ts:203-208`; `app/api/letters/route.ts:114-117`. `LETTER_SECURITY_AUDIT.md` §5.2. |
| **Impact** | A reference-numbered legal document can contain values that never existed in the system of record, and the system cannot tell afterwards. Not a privilege escalation — HR/ADMIN only. An **auditability** failure. |
| **Recommendation** | Namespace custom fields (`custom.*`) so they cannot shadow built-ins. Validate against a declared allowlist per template type. Persist the resolved variable map on the `Letter` row (or an `AuditLog` entry) so a reader can see which values came from the employee record and which from the request. |
| **Files** | `lib/letters/variables.ts:190-211`, `app/api/letters/route.ts:114-117` |
| **Models** | Optional `Letter.variables Json?` |
| **Migration risk** | **Low.** Behaviour change only for callers using un-namespaced custom keys — one caller, `LettersPageClient.tsx:130`, and its key (`request.purpose`) is currently a **no-op against every shipped template**, so nothing observable breaks. |
| **Dependencies** | R-02 |
| **Priority** | **P1** |

---

## R-07 — Persist the issued document, or stop implying that you do

| | |
|---|---|
| **Problem** | `doc.save()` writes to the browser. `Letter.pdfUrl` is **written nowhere** (0 repo-wide matches) and is NULL on all 4 rows. `Attachment` has no `letterId`. The UI shows a "QR Code" badge, a "VERIFIED" ID and a "Send via Email" button — none of which works. |
| **Evidence** | `app/lib/utils/letter-generator.ts:123`; `prisma/schema.prisma:1168`; `LETTER_GENERATION_SYSTEM_AUDIT.md` §6.1; `LETTER_UX_NAVIGATION_AUDIT.md` §2.2 (UX-09). |
| **Impact** | A salary certificate exists as a database row and, if downloaded, one operator's Downloads folder. There is no retrievable artifact. |
| **Recommendation (pick one — do not leave it as-is)**<br>**A.** Render server-side, store the artifact, set `pdfUrl`, attach via `Attachment.letterId`. **This is a genuine architecture change**: it moves jsPDF from the browser to the server, needs a Node-compatible build plus a font that can render Arabic (see R-08), and needs a storage target. It is the only option that makes the QR/verification affordances honest.<br>**B.** Remove `pdfUrl`, remove the QR badge and the "VERIFIED" text, remove "Send via Email", and implement actual email delivery of the generated file.<br>**Option B is a fraction of the work and removes three false promises. Option A is required before the system can honestly claim to issue verifiable documents.** |
| **Files** | `app/lib/utils/letter-generator.ts`, `app/letters/LettersPageClient.tsx:483,489-503`, `prisma/schema.prisma:1044-1061,1168` |
| **Models** | `Attachment.letterId String?` + FK; keep or drop `Letter.pdfUrl` |
| **Migration risk** | **Medium** under A (new dependency, new storage, RTL font). **Low** under B. |
| **Dependencies** | R-01, R-02 |
| **Priority** | **P1** |

---

## R-08 — Render Arabic, or stop calling it bilingual

| | |
|---|---|
| **Problem** | `content_ar` is destructured at `letter-generator.ts:15` and **never used again in the function**. The page advertises a "Bilingual Letter Engine" (`LettersPageClient.tsx:186-189`) and the on-screen viewer does render Arabic (`:457-462`). The PDF does not. |
| **Evidence** | `LETTER_GENERATION_SYSTEM_AUDIT.md` §6. `LETTER_WORKFLOW_MATRIX.md` P-03. |
| **Impact** | An HR user composes an Arabic template, sees it render correctly on screen, downloads the PDF, and hands the employee an English-only document. |
| **Recommendation** | If Arabic output is required (it is, for UAE employment certificates): embed an Arabic-capable font, set `doc.setR2L(true)` / correct bidi handling, render `content_ar` on a second column or a second page, and add a test that asserts a non-empty `content_ar` appears in the output. If it is not required: remove the "Bilingual" badge and the Arabic tab. |
| **Files** | `app/lib/utils/letter-generator.ts:15,66-72`; `app/letters/LettersPageClient.tsx:186-189,303-314` |
| **Models** | None |
| **Migration risk** | **Medium.** Font embedding and bidi in jsPDF are non-trivial; `doc.setFont("helvetica", …)` (`:58`, `:100`) is not an Arabic font. |
| **Dependencies** | R-07 (A only) |
| **Priority** | **P1** |

---

## R-09 — Link or delete the three one-off pages, and delete `hr-system/`

| | |
|---|---|
| **Problem** | `/letters/appointment`, `/letters/offer` and `/letters/relieving` are complete, self-contained letter systems — own jsPDF, own letterhead, own accent colour — that **nothing links to**. They are the only mounted writers of `LetterRecord`, which has 0 rows. Separately, `hr-system/` is a second, deployable copy of the application containing a full pre-fix letter subsystem and a tracked secret. |
| **Evidence** | `LETTER_UX_NAVIGATION_AUDIT.md` §1.1 (six grep matches, none an inbound link), §3. `hr-system/ARCHIVED.md`; `tsconfig.json:33`. |
| **Impact** | `LetterRecord` (0 rows), `LetterRequest` (0 rows), `LetterApproval` (0 rows), `Attachment` (0 rows) — an entire parallel schema is maintained, indexed and searched by `app/api/search/route.ts:1034`, and has never produced a row. |
| **Recommendation** | Delete `app/letters/{appointment,offer,relieving}/`, `app/lib/actions/letters.ts`, and `hr-system/` in its entirety. If any of the three letter bodies is worth keeping, port it into `LetterTemplate` content first. Do not "fix" the one-off pages — they are the duplication. |
| **Files** | `app/letters/appointment/**`, `app/letters/offer/**`, `app/letters/relieving/**`, `app/lib/actions/letters.ts`, `hr-system/**` (89 files) |
| **Models** | `LetterRecord` |
| **Migration risk** | **None** — all 0 rows. The only risk is deleting something someone values; that is why the port-first clause is there. |
| **Dependencies** | Should follow R-01 and R-02. Independent of R-05. |
| **Priority** | **P1** — elevated to **P0** if `hr-system/` is a real deployment target in your environment. |

---

# P2

---

## R-10 — Allocate reference numbers with a sequence, not `count()+1`

| | |
|---|---|
| **Problem** | `count() + 1` is computed outside any transaction and written into a `@unique` column. It collides after any deletion and under concurrency; every collision is an HTTP 500 to the HR user. |
| **Evidence** | `app/api/letters/route.ts:104-105`; DB: `max_seq = 4 = total`, which agrees **only because nothing has ever been deleted**. `LETTER_DATA_MODEL_AUDIT.md` §4. |
| **Impact** | A deleted letter permanently blocks the next number until someone intervenes by hand. Two HR users clicking at once produce a 500. |
| **Recommendation** | A Postgres sequence, or `COUNT(*)` inside the same transaction with a retry on `P2002`, or a per-year counter table. Whichever, wrap the count-and-insert in `prisma.$transaction` — there is currently **no transaction anywhere in the route**. |
| **Files** | `app/api/letters/route.ts:104-147` |
| **Models** | Migration adding a sequence, or a `LetterCounter` table |
| **Migration risk** | **Low.** The 4 existing numbers are contiguous (`001`–`004`), so a sequence can start at 5 safely. |
| **Dependencies** | R-01 |
| **Priority** | **P2** |

---

## R-11 — Constrain `LetterTemplate.type`, or stop matching on it

| | |
|---|---|
| **Problem** | `type` is an unconstrained `String`. `offer-letter.ts:22` looks for `"OFFER"` — **no such template exists**, so it silently falls back to the oldest template by `createdAt` and records the offer letter as being based on the Employment Certificate. `workflow/letters.ts:30` lists five approval-required types that intersect the live values on `NOC` alone. |
| **Evidence** | `prisma/schema.prisma:1137`; `lib/workflow/offer-letter.ts:21-34`; live `type` values `EMPLOYMENT`/`PAYROLL`/`NOC`; `LETTER_DATA_MODEL_AUDIT.md` §2.1. |
| **Impact** | An offer letter is issued from the wrong template and the system does not say so. Salary certificates would not require approval even after R-05. |
| **Recommendation** | Either a Prisma `enum LetterType` with a single shared vocabulary, or a `LetterCategory` lookup table, or a constant in `lib/letters/types.ts` that all three modules import. Also: make `resolveOfferTemplate()` **fail loudly** when no `OFFER` template exists instead of falling back. |
| **Files** | `prisma/schema.prisma:1137`, `lib/workflow/offer-letter.ts:21-34`, `lib/workflow/letters.ts:30`, `app/dashboard/settings/templates/page-client.tsx:231-237` |
| **Models** | `LetterTemplate.type` |
| **Migration risk** | **Medium.** Three live rows use values not in `DEFAULT_APPROVAL_REQUIRED`. A `LetterCategory` table with a backfill is lower-risk than an enum. |
| **Dependencies** | R-01 |
| **Priority** | **P2** |

---

## R-12 — Fix the audit trail, and the security event type

| | |
|---|---|
| **Problem** | Three of the four implementations log **successful** operations as `SECURITY_ACTION.ACCESS_DENIED` with `outcome: 'SUCCESS'` (`route.ts:150`, `workflow/letters.ts:137,230`, `offer-letter.ts:155`). The live path writes **no `AuditLog` row at all**, and `Letter` has no `createdBy`. |
| **Evidence** | `LETTER_SECURITY_AUDIT.md` §4.1. |
| **Impact** | Real denials and routine successes are indistinguishable by event type. A letter cannot be attributed to a person after the fact. |
| **Recommendation** | Add `LETTER_GENERATED` / `LETTER_ISSUED` to `SECURITY_ACTION`; write an `AuditLog` row on every generation and every approval, carrying the reference number and the template id; add `createdBy` to `Letter`. Adopt the pattern already used in `workflow/letters.ts:121-131`, which is correct. |
| **Files** | `lib/auth/audit.ts`, `app/api/letters/route.ts:149-158`, `lib/workflow/offer-letter.ts:154-161` |
| **Models** | `Letter.createdBy String?` |
| **Migration risk** | **None** — additive. |
| **Dependencies** | R-02 |
| **Priority** | **P2** |

---

## R-13 — Make the placeholder engine the only one, structurally

| | |
|---|---|
| **Problem** | `lib/letters/variables.ts` has one importer. Nothing prevents a fifth renderer. The editor advertises 4 of the 20 available variables (`:246`), the "Live Preview" shows the raw template rather than a resolved letter, and unresolved values are reported only to `console.warn`. |
| **Evidence** | `LETTER_TEMPLATE_SYSTEM_AUDIT.md` §4.3, §4.5, §5. |
| **Impact** | The exact class of bug that was fixed today can recur silently. |
| **Recommendation** | Four concrete steps: **(a)** a lint/test rule asserting `renderTemplate` is the only substitution site; **(b)** a real preview in the editor that resolves against a named employee and flags every unresolved and missing value inline; **(c)** expose the full variable list from `buildLetterVariables` as a single exported constant so the hint can never drift; **(d)** move the unresolved report from `console.warn` to a persisted, visible place. |
| **Files** | `lib/letters/variables.ts`, `app/dashboard/settings/templates/page-client.tsx:246`, `app/letters/LettersPageClient.tsx:299-314` |
| **Models** | None |
| **Migration risk** | **None.** |
| **Dependencies** | R-02, R-03 |
| **Priority** | **P2** |

---

## R-14 — Mount the offer-letter preview

| | |
|---|---|
| **Problem** | An offer letter is issued and cannot be seen. `app/recruitment/offers/LetterPreview.tsx` is a finished 124-line renderer whose input matches `lib/recruitment/offer-queries.ts:137-138` exactly. **It is imported by nothing.** `OfferLetter.fileUrl` is set to `/letters/${id}`, a route that does not exist. |
| **Evidence** | `LETTER_GENERATION_SYSTEM_AUDIT.md` §5. `LETTER_UX_NAVIGATION_AUDIT.md` §4. |
| **Impact** | The user journey is: approve an offer → click "Issue offer letter" → see a success toast → have no way to view, print, send or download the document that was created. |
| **Recommendation** | Import `LetterPreview` in the offer detail view and pass the `letterRecord` already selected at `offer-queries.ts:137`. Clear or repoint `fileUrl` to that view. |
| **Files** | `app/recruitment/offers/LetterPreview.tsx`, the offer detail page, `lib/workflow/offer-letter.ts:139` |
| **Models** | None |
| **Migration risk** | **None.** A few lines. `OfferLetter` has 0 rows, so there is nothing to regress. |
| **Dependencies** | Should follow R-09 (which deletes the one-off offer page) |
| **Priority** | **P2** — cheap and user-visible, so it deserves to be done early in the sequence. |

---

# P3

---

## R-15 — Small correctness and consistency items

| Item | Evidence | Note |
|---|---|---|
| Fix the wrong capability on template writes (`ATTENDANCE_SHIFT_MANAGE` → `LETTER_TEMPLATE_MANAGE`) | `letter-templates.ts:38,57,73` | **ACL-equivalent today** — a latent bug, not a live one. Fix before either grant list is edited. |
| Add `LETTER_VIEW` to `getLetterTemplates` and `GET /api/templates` | §3.3 of the security audit | Server actions are endpoints; the page gate does not protect them. |
| Delete `POST /api/templates` and `getLetterTemplateById` | zero callers | Two dead write/read paths with weaker gates than the ones that are used. |
| Guard `letter.employee.firstName` against a null `employee` | `LettersPageClient.tsx:369` | Crashes the archive the moment an offer letter exists. |
| Populate or drop `serviceConfig` `COMPANY`, and have **one** source of letterhead | `ServiceConfig` COMPANY: **0 rows** | Today: "Al Barakah Group"/Abu Dhabi on one screen, "IBMDigiTech LLC"/Dubai on the others. |
| Wire up or remove "Send via Email" and relabel "Request Archive" | `:501-503`, `:201-207` | A dead delivery button on an employee-facing document. |
| Add `@@unique([documentKey, version])` if `LetterRecord` survives | `schema.prisma:1092-1093` | **Only relevant if R-01 rejects Option A.** Otherwise deleted with the model. |
| Add a mobile card view to the archive | `:355-377` | Corroborates `PRODUCTION_READINESS_CHECKLIST.md:166` item 8.2. |
| Fix the `/settings` → templates link to use `<Link>` | `app/settings/page.tsx:193` | |
| Reconcile the two template seed sources | `templates/page-client.tsx:119` vs `api/seed/route.ts:173` | Dotted vs snake_case, different ids, different `type` vocabulary. If R-11 lands, this collapses. |
| Point global search at `Letter` | `search/route.ts:1034` searches the 0-row `LetterRecord` | Or delete the domain once `LetterRecord` is gone. |
| Remove the dead `/dashboard/letters` edge rule; add one for `/dashboard/settings/templates` | `auth.config.ts:40` | The rule gates a route that does not exist. |
| Add `@@index([employeeId])`, `@@index([createdAt])` on `Letter`; `@@index([type])`, `@@index([isActive])` on `LetterTemplate` | `pg_indexes` | Neither table has a non-unique index. |

---

# Section 20 — Target architecture: reviewed, and **not endorsed as proposed**

The brief's target architecture is a unified letter module: one model, one service, one template engine, one PDF renderer, one approval path. **The shape is right. The proposed form does not fit this codebase, and I am not going to rubber-stamp it.** Four specific objections, each grounded in what is actually here:

### Objection 1 — "One model" is a merge, not a deletion

The intuitive plan is: keep `Letter`, delete `LetterRecord`. **But `LetterRecord` contains three things `Letter` does not have, and they are the parts that are actually good:**

| From `LetterRecord` | Value | Line |
|---|---|---|
| `documentKey` + `version` + `supersededById` | Immutable version chains — "a corrected letter creates a NEW row; rows are never overwritten" | `:1092-1102`, `workflow/letters.ts:79-119` |
| `LETTER_STATUS` / `LETTER_TRANSITIONS` with per-actor transition rules | A 6-state machine with role-gated edges | `state-machine.ts:296-330` |
| `AuditLog` writes + `notifyInApp` on every transition | The only letter audit trail that exists | `workflow/letters.ts:121,146,217,239` |

Deleting `LetterRecord` **and its schema fields** would delete the only versioning design and the only state machine in the letter system. They must be **ported onto `Letter` first**. The order matters: R-05 is not optional work, it is the migration.

Conversely `Letter` holds what `LetterRecord` lacks: `referenceNumber @unique`, `templateId`, the rendered `content_en`/`content_ar` snapshot, the `pdfUrl` slot, and the `OfferLetter` link. That is why `Letter` is the base and not the other way round.

### Objection 2 — "One service" is not a refactor here, because rendering is client-side

`generateLetterPDF` runs **in the browser** (`doc.save()` at `:123`, assets fetched over HTTP at `:80,85` from the page origin). Any target architecture with a server-side `generateLetter()` that owns rendering therefore requires:

1. A Node-compatible jsPDF build and a server-side render step.
2. An Arabic-capable font and bidi handling (R-08) — `helvetica` cannot render Arabic at all.
3. A storage target for the artifact (R-07), because server-side rendering produces a file that must go somewhere.
4. Removal of the browser-side call at `LettersPageClient.tsx:417`.

**None of that exists today.** A target architecture that assumes server-side PDF is a *migration*, not a refactor, and should be costed as one. If the goal is consolidation rather than server-side rendering, the achievable target keeps jsPDF in the browser and consolidates only the four `new jsPDF()` call sites behind one shared layout module.

### Objection 3 — "One approval path" cannot be a pure code change

The `LetterRequest` → `LetterApproval` chain has **zero implementation and zero rows**, so there is nothing to consolidate *from*. And the approval path that does exist (`workflow/letters.ts`) is dead. So the target architecture cannot "unify" the approval paths — **it has to build one.** And the queue is not optional: mounting the state machine without a tab in `/dashboard/approvals` produces an approval workflow no approver can see, which is worse than none because it looks like a control.

The realistic shape: adopt `LETTER_STATUS`/`LETTER_TRANSITIONS` for `Letter.status`, add one tab to the existing `/dashboard/approvals` page (which already has the tab pattern at `:166,173,181`), and delete `LetterRequest`/`LetterApproval`. **That is additive to an existing page, not a new service.**

### Objection 4 — The `isActive` and `documentKey` decisions are not optional in a "unified" model

If `Letter` becomes the one model, three decisions must be made explicitly rather than inherited:

- **`LetterTemplate.isActive` is write-only today** (no UI control, no generation-path check). In a unified model it needs to become a real `ACTIVE`/`RETIRED` state with a check at generation time — or it should be deleted, because a column that is never written and never read is worse than no column.
- **Reference numbering must move onto the model** (R-10), because today it is a `count()` in a route that will no longer exist.
- **Employee delete semantics must be decided.** `Letter.employeeId` is `ON DELETE SET NULL` (verified in `pg_constraint`) — deleting an employee silently detaches their signed letters. The repo's stated policy (`schema.prisma:1478-1484`) is that exit records must *block* deletion. Letters should follow the same policy, or the divergence should be deliberate and documented.

### What actually fits this codebase

```
lib/letters/
  types.ts        shared LetterType vocabulary          (R-11)
  variables.ts    the engine — one importer, enforced   (R-13)
  service.ts      generateLetter() — the only entry    (R-02)
  pdf.ts          the only jsPDF call site              (R-02/R-07)

  Letter          one model: + documentKey, version, supersededById,
                  status (LETTER_STATUS), createdBy      (R-01, R-05, R-12)
  LetterTemplate  + enforced type, retire isActive     (R-11)

  /letters                — list, generate, preview, download
  /dashboard/settings/templates — author, preview against a real employee
  /dashboard/approvals     — + one "Letters" tab        (R-05)

  deleted:  app/letters/{appointment,offer,relieving}/
            app/lib/actions/letters.ts
            lib/workflow/letters.ts  (after porting §R-05 fields)
            lib/workflow/offer-letter.ts (after porting its body to a template)
            hr-system/
            models: LetterRecord, LetterRequest, LetterApproval
```

**The one thing I would refuse to compromise on:** whatever the target shape, `lib/letters/variables.ts` must end up with exactly one importer and a test that fails when that changes. The substitution bug that was fixed today was a *drift* bug, and drift is only prevented by structure, not by vigilance.

---

# Section 25 — Phased implementation sequence

**Recommendation only. None of this has been implemented.**

### Phase 0 — Decide (1 day, no code)

A human decides, in writing:

| Decision | Options | Default recommendation |
|---|---|---|
| Which model survives? | `Letter` vs `LetterRecord` | **`Letter`** — it has the data, the UI and the engine |
| Is there a manager-then-HR approval chain? | Build it / single HR approval | **Single HR approval**; delete `LetterRequest` + `LetterApproval` |
| Is the PDF server-rendered and stored? | Yes / No | **Decide explicitly.** Either is fine; leaving it undecided is not |
| Is Arabic required in the PDF? | Yes / No | **Yes** for UAE employment certificates |
| Is `hr-system/` deployed anywhere? | Yes / No | If yes, **stop and remediate before anything else** |

**Everything below is blocked on Phase 0.** Guessing at these is how the current duplication arose.

### Phase 1 — Stop the bleeding (1 sprint, no schema migration)

*Nothing here depends on Phase 0. All of it is safe to do immediately.*

| # | Action | Ref |
|---|---|---|
| 1.1 | Scope `GET /api/letters` to the caller + add `LETTER_VIEW` | R-04 |
| 1.2 | Constrain `customFields` to a namespaced, allowlisted set | R-06 |
| 1.3 | Fix `SECURITY_ACTION` on the four success paths; write an `AuditLog` row on generation | R-12 |
| 1.4 | Delete `app/api/letters/[id]/approve` (zero callers, state-blind, excludes SUPER_ADMIN) | R-05 |
| 1.5 | Delete `POST /api/templates` and `getLetterTemplateById` (dead, weaker gates) | R-15 |
| 1.6 | Fix the wrong capability on template writes | R-15 |
| 1.7 | Guard `letter.employee` against null in the archive | R-15 |
| 1.8 | Wrap the reference-number allocation in a transaction with a `P2002` retry | R-10 (partial) |
| 1.9 | Refuse to issue a letter whose required placeholder resolved to `MISSING` — **warn-only for the first release** | R-03 |
| 1.10 | Delete `hr-system/` | R-09 |

*Checkpoint: no letter can leak another employee's salary; no successful operation is logged as a denial; a broken document cannot be issued silently.*

### Phase 2 — Consolidate (2 sprints, needs Phase 0 + 1)

| # | Action | Ref |
|---|---|---|
| 2.1 | Extract `lib/letters/service.ts` with a single `generateLetter()`; route `POST /api/letters` and `issueOfferLetter` through it | R-02 |
| 2.2 | Port the offer-letter body from `offer-letter.ts:99-118` into an `OFFER` `LetterTemplate`; delete the inline string | R-02, R-11 |
| 2.3 | Make `resolveOfferTemplate()` **fail loudly** instead of falling back to the wrong template | R-11 |
| 2.4 | Delete `app/letters/{appointment,offer,relieving}/` and `app/lib/actions/letters.ts` | R-09 |
| 2.5 | Delete `lib/workflow/letters.ts` **after** porting `documentKey`/`version`/`supersededById` and the audit pattern | R-01 |
| 2.6 | Mount `LetterPreview` in the offer detail view; repoint `OfferLetter.fileUrl` | R-14 |
| 2.7 | Add a test that fails if a second substitution or `new jsPDF()` site appears | R-13 |

*Checkpoint: exactly one way to produce a letter, one substitution engine, one PDF layout module, and a test that keeps it that way.*

### Phase 3 — Schema consolidation (1 sprint + migration)

| # | Action | Ref |
|---|---|---|
| 3.1 | Add `documentKey`, `version`, `supersededById`, `createdBy` to `Letter`; add `@@unique([documentKey, version])` | R-01 |
| 3.2 | Move `Letter.status` to the `LETTER_STATUS` vocabulary; adopt `LETTER_TRANSITIONS` | R-05 |
| 3.3 | **Decision:** switch `Letter.employeeId` to `ON DELETE RESTRICT`, or document the divergence | R-05 |
| 3.4 | Enforce `LetterTemplate.type`; add `@@index([employeeId])`, `@@index([createdAt])` on `Letter` | R-10, R-11 |
| 3.5 | Drop `LetterRecord`, `LetterRequest`, `LetterApproval` (all 0 rows — no backfill) | R-01 |
| 3.6 | Move the letters search domain from `LetterRecord` to `Letter` | R-15 |
| 3.7 | Either give `isActive` a real meaning or drop it | R-11 |

*Checkpoint: one letter model, one status vocabulary, one version chain, enforced in the database.*

### Phase 4 — Make approval real (1 sprint)

| # | Action | Ref |
|---|---|---|
| 4.1 | Add a "Letters" tab to `/dashboard/approvals`, reusing the existing `TabsTrigger` pattern at `:166,173,181` | R-05 |
| 4.2 | Approve/reject through `assertTransition` with an `updateMany` status precondition — **not** the deleted `[id]/approve` shape | R-05 |
| 4.3 | Route approval-required types through the shared `LetterType` vocabulary | R-11 |
| 4.4 | Notify the **approver**, not only the employee (`notifyInApp` at `:146` notifies the wrong party) | R-05 |

> **Do not start Phase 4 before Phase 3.** Mounting a state machine without a queue produces an approval workflow that no approver can see — which reads as "we have approvals" in a status report and is false.

### Phase 5 — Make the document trustworthy (2 sprints)

| # | Action | Ref |
|---|---|---|
| 5.1 | Decide server-render-and-store vs. client-render-and-download; implement the chosen one | R-07 |
| 5.2 | Add `Attachment.letterId`; persist the artifact; set `pdfUrl` | R-07 |
| 5.3 | Arabic-capable font, bidi, `content_ar` in the PDF, with a test | R-08 |
| 5.4 | Real email delivery — or remove the button | R-07 |
| 5.5 | Make the QR / verification affordance real, or remove it | R-07 |
| 5.6 | Populate `ServiceConfig` `COMPANY`; one source of letterhead | R-15 |

### Phase 6 — Quality (ongoing)

| # | Action | Ref |
|---|---|---|
| 6.1 | Real preview in the template editor, resolving against a named employee and flagging unresolved/missing values inline | R-13 |
| 6.2 | Export the variable list from `buildLetterVariables` so the hint cannot drift | R-13 |
| 6.3 | `isActive` control; de-duplicate "Seed Defaults"; surface the delete error | R-15 |
| 6.4 | Reconcile or delete the second template seed source | R-15 |
| 6.5 | Mobile card view for the archive | R-15 |
| 6.6 | A4 `@page` print stylesheet | R-15 |

---

## Critical path

```
Phase 0 (decide)
   │
   ├─► Phase 1 (safe, parallel, no schema)   ──────────────┐
   │                                                      │
   └─► Phase 2 (consolidate code)  ◄──────────────────────┘
             │
             └─► Phase 3 (schema)  ──►  Phase 4 (approval queue)
                                          │
                                          └─► Phase 5 (document)  ──► Phase 6 (quality)
```

**Phase 1 can start today.** It has no dependencies, no migrations, and it closes the data-exposure and audit-trail findings. **Phase 0 cannot be skipped** — the current state is the result of four separate implementations each built by someone who did not know the others existed, and a fifth consolidation attempt without a written decision will produce a sixth.

---

## Effort summary

| Phase | Estimate | Risk |
|---|---|---|
| 0 — Decide | 1 day | None; the risk is skipping it |
| 1 — Stop the bleeding | 1 sprint | Low |
| 2 — Consolidate | 2 sprints | Medium — 3 live screens change |
| 3 — Schema | 1 sprint + migration | Medium — 4 rows, 0 rows to backfill |
| 4 — Approval queue | 1 sprint | Low — additive to an existing page |
| 5 — Document | 2 sprints | **High** — new render target, font, storage |
| 6 — Quality | ongoing | Low |

---

## What I could not verify

- **No recommendation here was tested.** Nothing was implemented, prototyped, or benchmarked. Effort estimates are from reading the code, not from doing the work.
- **Phase 5 cost is the least reliable estimate.** Server-side PDF with Arabic requires a font, a bidi strategy and a storage target, none of which exists. It could be half a sprint or three.
- **I did not verify the deployment topology.** R-09's `hr-system/` deletion and the Phase 0 question of whether it is deployed require knowledge of the actual environments, which I do not have. `hr-system/ARCHIVED.md` says it should not be deployed; I have no way to check whether it is.
- **Storage and retention requirements for issued documents are unknown.** R-07 assumes they should be retained indefinitely, which is a legal and privacy decision, not a technical one.
- **I did not consult the existing `docs/audit/IMPLEMENTATION_PLAN.md` or `P0_REMEDIATION_PLAN.md` sequencing** in detail. This sequence is built from the letter findings alone and may conflict with plans already in flight; whoever sequences this should reconcile the two.
- **I did not measure whether the 4 existing `Letter` rows are real issued documents or test artefacts.** If they are test artefacts, Phase 3's migration is even cheaper than stated. If any is a real document, the `ON DELETE RESTRICT` decision in 3.3 becomes urgent rather than merely important.
