# Letter System — Duplication Audit (Section 17)

**Scope:** every function that appears in more than one letter implementation, with **both** implementations named per the brief's requirement.
**Date:** 2026-09-29 · **Type:** READ-ONLY

Related: [TEMPLATE audit](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION audit](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [WORKFLOW MATRIX](./LETTER_WORKFLOW_MATRIX.md) · [RECOMMENDATIONS](./LETTER_SYSTEM_RECOMMENDATIONS.md) · [SUMMARY](./LETTER_AUDIT_SUMMARY.md)

---

## 1. The duplication table (Section 17)

Each row names the function and **both** competing implementations. "Mounted" = reachable from a link in the UI; verified by grepping the **component / route file / entry point**, not the action it calls.

| # | Function / concern | Implementation A | Implementation B | Implementation C | Mounted? | Marker |
|---|---|---|---|---|---|---|
| **D-01** | **Persist a generated letter** | `app/api/letters/route.ts:136` — `prisma.letter.create` | `app/lib/actions/letters.ts:23` — `prisma.letterRecord.create` | `lib/workflow/letters.ts:97` — `tx.letterRecord.create` | A only | **DUPLICATED** |
| **D-02** | **Read a letter list / archive** | `app/api/letters/route.ts:21` — `letter.findMany` | `app/lib/actions/letters.ts:47` — `letterRecord.findMany` | `lib/workflow/letters.ts:264` — `letterRecord.findMany` by `documentKey` | A only | **DUPLICATED** |
| **D-03** | **Version / correct a letter** | *(none)* | *(none — hard overwrite, `actions/letter-templates.ts:60`)* | `lib/workflow/letters.ts:80-119` `documentKey` + `version` + `supersededById` | **C only (dead)** | **MISSING in product** |
| **D-04** | **Substitute placeholders into a letter body** | `lib/letters/variables.ts:120,221` — `buildLetterVariables` / `renderTemplate` | `app/letters/{appointment,offer,relieving}/page-client.tsx:99-113` — inline string concatenation, own `jsPDF` | `lib/workflow/offer-letter.ts:99-118` — inline hardcoded string array | A only uses the engine | **DUPLICATED ×3** |
| **D-05** | **Render a letter PDF** | `app/lib/utils/letter-generator.ts:13` `generateLetterPDF` | `app/letters/{appointment,offer,relieving}/page-client.tsx:59,60,61` — `new jsPDF()` inlined per page | — | A + dead `LetterPreview` | **DUPLICATED ×4** |
| **D-06** | **Letterhead / company branding** | `lib/letters/variables.ts:126-127` — `"Al Barakah Group"`, `"CEO / HR Manager"` hardcoded | `app/lib/utils/letter-generator.ts:30-46` — `"AL BARAKAH"`, Abu Dhabi, hardcoded | `app/letters/*/page-client.tsx:27-36` → `getCompanySettings()` → `"IBMDigiTech LLC"`, Dubai | both A and B live | **DUPLICATED — contradictory** |
| **D-07** | **Resolve which employees a letter may target** | `app/api/letters/route.ts:88-94` — `employee.findUnique` | `app/lib/actions/letters.ts:63-77` `getEmployeesForLetter` — `employee.findMany`, `isActive: true`, + `salaryStructure.ctc` | — | both | **DUPLICATED** |
| **D-08** | **Create / edit a letter template** | `app/lib/actions/letter-templates.ts:37,56` — server actions | `app/api/templates/route.ts:31` — `POST` REST | — | A only; B has **zero callers** | **DUPLICATED (B dead)** |
| **D-09** | **List letter templates** | `app/lib/actions/letter-templates.ts:16` — `findMany({orderBy: name})`, **no `isActive` filter** | `app/api/templates/route.ts:12` — `findMany({where:{isActive:true}})` | — | both | **DUPLICATED — disagree** |
| **D-10** | **Authorise letter generation** | `app/api/letters/route.ts:43` `authorizePermission(LETTER_GENERATE)` | `lib/workflow/letters.ts:71` `requirePermission(LETTER_GENERATE)` | `app/letters/*/page.tsx:8` `requirePagePermission(LETTER_GENERATE)` | all three | **DUPLICATED — 3 mechanisms** |
| **D-11** | **Approve a letter** | `app/api/letters/[id]/approve/route.ts:16` — `letter.update` to `GENERATED`, no state check, no audit | `lib/workflow/letters.ts:172` `advanceLetter` — `assertTransition` + `updateMany` precondition + `AuditLog` + notification | *(planned: `LetterApproval`, zero code)* | A only; B **dead** | **DUPLICATED — A is a stub** |
| **D-12** | **Letter history for one document** | `app/lib/actions/letters.ts:40` `getLetterHistory()` — no args, last 50, all users | `lib/workflow/letters.ts:262` `getLetterHistory(documentKey)` — version chain, `LETTER_VIEW` gated | — | **both have zero callers** | **DUPLICATED (both dead)** |
| **D-13** | **Generate a reference number** | `app/api/letters/route.ts:104-105` — `LTR-UAE-${year}-${count()+1}` | `lib/workflow/offer-letter.ts:97,128` — `OFFER-${requisitionCode}-V${version}` | — | both | **DUPLICATED — one namespace, two schemes** |
| **D-14** | **Seed letter templates** | `app/dashboard/settings/templates/page-client.tsx:120-136` "Seed Defaults" — snake_case, `types` EMPLOYMENT/PAYROLL/NOC | `app/api/seed/route.ts:174-198` — **dotted**, `types` SALARY_CERTIFICATE/NOC/OFFER, explicit ids | `hr-system/scripts/seed-letters.{js,mjs}` | A only | **DUPLICATED ×3 — divergent** |
| **D-15** | **Search letters** | `app/api/search/route.ts:1034` — searches **`LetterRecord`** | `app/api/search/route.ts:1068` — searches **`LetterTemplate`** | *(no domain searches `Letter`)* | yes | **MISSING — searches the empty table** |
| **D-16** | **Link a letter to an offer** | `lib/workflow/offer-letter.ts:139` — `offerLetter.update({letterRecordId, fileUrl})` | `prisma/schema.prisma:1462-1463` — FK `OfferLetter.letterRecord → Letter.id` (application-checked only) | — | A only | **PARTIAL** |
| **D-17** | **Letter "archive" UI** | `app/letters/LettersPageClient.tsx:342-382` — Document Archive from `Letter` | *(nothing renders `LetterRecord`)* | `app/recruitment/offers/LetterPreview.tsx` — renders `Letter`, **imported by nothing** | A only | **DUPLICATED (B, C dead)** |
| **D-18** | **Full letter application tree** | `app/letters/**` (10 files) | `hr-system/app/letters/**` (9 files) + `hr-system/app/dashboard/letters/` | — | root only; archive excluded by `tsconfig.json:33` | **DUPLICATED — archived tree** |

**18 duplicated concerns. 8 involve two live, contradictory implementations; 6 involve a live implementation and a dead one; 1 is a second seed; 1 is an archived application.**

---

## 2. The four PDF renderers, side by side

| | `letter-generator.ts` | `appointment/page-client.tsx` | `offer/page-client.tsx` | `relieving/page-client.tsx` |
|---|---|---|---|---|
| Library | `jspdf` | `jspdf` | `jspdf` | `jspdf` |
| Page setup | `new jsPDF('p','mm','a4')` `:14` | `new jsPDF()` `:59` | `new jsPDF()` `:60` | `new jsPDF()` `:61` |
| Accent colour | indigo `#4f46e5` `:51` | emerald `#10b981` `:62` | (own) | (own) |
| Company name | `"AL BARAKAH"` hardcoded `:30` | `getCompanySettings()` `:66` | `getCompanySettings()` | `getCompanySettings()` |
| Address | Abu Dhabi, hardcoded `:38` | `getCompanySettings()` `:68` | `getCompanySettings()` | `getCompanySettings()` |
| Signature | `/assets/signature.png` `:80` | `companySettings.signature` base64 `:123` | same pattern | same pattern |
| Stamp | `/assets/stamp.png` `:85` | none | none | none |
| Arabic | **never rendered** | none | none | none |
| Body source | `Letter.content_en` `:71` | hardcoded literal `:99-113` | hardcoded literal | hardcoded literal |
| Writes to DB | **nothing** | `LetterRecord` `:145` | `LetterRecord` `:141` | `LetterRecord` `:146` |
| Reference number | `letter.referenceNumber` `:63` | none | none | none |
| Audit log | none | none | none | none |
| Reachable | yes | **no link** | **no link** | **no link** |

**Verdict: four separate PDF engines for one product.** The brief's instruction in `lib/workflow/offer-letter.ts:4-5` — *"Do NOT create a second PDF engine"* — has been violated three times.

---

## 3. The two placeholder engines, side by side

The brief directed me to determine whether `app/lib/actions/letters.ts` has a second substitution engine. **It does not** — it is 82 lines with no substitution. The second engine is elsewhere, and there are in fact **two** competing substitution mechanisms plus **two** competing body-construction mechanisms:

| Mechanism | Location | Syntax | Resolves `{{employee_name}}`? | Resolves `{{employee.name}}`? | Placeholders left visible? |
|---|---|---|---|---|---|
| **E1 — `lib/letters/variables.ts`** | imported by `app/api/letters/route.ts:7-11` **only** | shared `PLACEHOLDER` regex `:37` | **Yes** (explicit, `:161-179`) | **Yes** (canonical, `:137-156`) | Yes, deliberately `:224` |
| **E2 — `app/letters/*/page-client.tsx`** | 3 files, inline | none — direct JS interpolation | n/a | n/a | n/a (values are always present) |
| **E3 — `lib/workflow/offer-letter.ts:99-118`** | 1 file, inline | none — `offer.offeredSalary`, `offer.designation` read directly from the offer row | n/a | n/a | n/a |
| **E4 — `hr-system/app/api/letters/route.ts:87`** | archived tree | its own `replaceVars()` | depends on its own map | — | — |

**`lib/letters/variables.ts` has exactly one importer in the entire repository.** Any refactor, any new generation path, and any of the three one-off pages is free to invent its own substitution — which is exactly what happened.

**This is the P0-adjacent correctness risk the brief anticipated, and it is real.** The two paths *will* drift again, because nothing enforces that a new letter path uses the engine: there is no lint rule, no shared `generateLetter()` entry point, and no test that fails when a second renderer appears. The fix that was made today is correct but is not structurally protected.

---

## 4. The archived `hr-system/` tree — a fifth implementation

`hr-system/ARCHIVED.md` declares itself "⛔ ARCHIVED — this is not the application" and states the application is the repository root. Evidence that this is accurate and that the tree is not built:

| Claim | Evidence |
|---|---|
| Never typechecked | `tsconfig.json:33` — `"exclude": ["node_modules", "hr-system"]` |
| Targets a different datastore | `hr-system/prisma/schema.prisma` — SQLite, vs PostgreSQL at root |
| Ships a working deploy script | `hr-system/deploy.sh`, now gated behind `HRMS_ALLOW_LEGACY_DEPLOY=1` |
| 89 `.ts`/`.tsx`/`.prisma` files | `Get-ChildItem -Recurse` |
| 12 letter-related files | `hr-system/app/api/letters/route.ts`, `[id]/approve/route.ts`, `app/dashboard/letters/page.tsx`, `app/letters/{page.tsx,LettersPageClient.tsx,appointment,offer,relieving}`, `app/lib/actions/letters.ts`, `app/lib/utils/letter-generator.ts`, `prisma/migrations/20260503195857_add_letter_system/migration.sql`, `scripts/seed-letters.js`, `scripts/seed-letters.mjs` |
| `hr-system/app/dashboard/letters/page.tsx` | **exists in the archive and has no root counterpart** — a fifth letters UI |
| The archive's `api/letters/route.ts` is a **different file** | SHA-256 differs (`0A899F40…` vs `7530EACD…`) |
| The archive lacks both remediations | Its `route.ts` has no `authorizePermission` guard (its `replaceVars()` is called at `:87`) and predates the `lib/letters/variables.ts` extraction entirely |
| The archive holds a **committed secret** | `hr-system/csrf_hash.txt`, tracked in git, not gitignored — per `ARCHIVED.md:18` |

**Recommendation: this directory should not exist.** It is not read-only documentation; it is a second deployable application containing a full letter subsystem, a divergent database, and a tracked secret. `docs/audit/PRODUCTION_READINESS_CHECKLIST.md` item 1.7 (cited in `ARCHIVED.md:10-11`) already covers the mount-level risk. I concur and add the letter-specific detail: the archive's letter code is the **pre-fix, pre-authz** version, so anyone who reads it as reference will re-introduce exactly the two bugs that were fixed today.

---

## 5. What the brief got wrong, and the corrected framing

| Brief claim | Verdict | Correction |
|---|---|---|
| "Three letter implementation paths" | **Undercount** | **Five**: `api/letters`, `letters/*/page-client`, `lib/workflow/letters.ts`, `lib/workflow/offer-letter.ts`, and the archived `hr-system/**`. |
| "`app/lib/actions/letters.ts` … contains its OWN substitution at ~line 339/346" | **FALSE** | The file is 82 lines. It has no substitution. It is a `LetterRecord` CRUD helper. |
| "…is a second, competing implementation" | **Misleading** | It has no rendering logic at all. The competing *implementation* is the jsPDF block in the three `page-client.tsx` files that call it. |
| "…appears to be the path that produced the one pre-existing Letter row dated 2026-09-26" | **FALSE** | It writes `LetterRecord`, which has **0 rows**. There are **4** `Letter` rows, not 1; the 2026-09-26 one is `LTR-UAE-2026-001`, written by `POST /api/letters`. |
| "the one pre-existing Letter row" | **FALSE** | 4 rows; 3 were created at 2026-09-29 15:18:50, ~9 minutes before this audit began, by someone else. |

**The corrected answer to "one system or two?" is _not_ "two".** It is **three letter data models in one application**, split along lines that have nothing to do with each other:

- **`Letter` + `LetterTemplate`** — documented, templated, PDF-rendered, has a placeholder engine. *Live.*
- **`LetterRecord`** — undocumented, untemplated, has the full approval state machine, versioning, bulk generation and audit. *Written by code no UI links to; 0 rows.*
- **`LetterRequest` + `LetterApproval`** — a two-level approval chain. *Zero code, zero rows.*

The `Letter` family is the product. The `LetterRecord` family is the better-engineered code and it is unreachable. The `LetterRequest` family is a schema with no implementation. **The refactor is a consolidation decision, not a bug fix** — and the duplication audit should be read as the input to that decision, not as a list of defects to patch.

---

## 6. Findings register

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| DUP-01 | **P0** | Five letter implementations across the repository, including a whole archived application. | §1 D-18, §4 |
| DUP-02 | **P0** | `lib/letters/variables.ts` has one importer. Nothing prevents a fifth renderer from being added. | §3 |
| DUP-03 | **P0** | Two live letterheads producing documents for two different companies. | D-06, §2 |
| DUP-04 | **P0** | Four separate PDF engines; the codebase's own "do not create a second" instruction violated 3×. | §2 |
| DUP-05 | **P1** | `GET /api/templates` and `getLetterTemplates` disagree on whether `isActive` filters. | D-09 |
| DUP-06 | **P1** | Two template writers, two template readers, two seed sources with divergent content and `type` vocabularies. | D-08, D-14 |
| DUP-07 | **P1** | Two reference-number schemes share one `@unique` column with no coordination. | D-13 |
| DUP-08 | **P1** | Three separate authorisation mechanisms for the same capability. | D-10 |
| DUP-09 | **P2** | Two functions named `getLetterHistory` with different signatures, different gates — both dead. | D-12 |
| DUP-10 | **P2** | Global search indexes `LetterRecord` (empty) and never `Letter` (4 rows). | D-15 |
| DUP-11 | **P2** | `hr-system/` contains a tracked secret (`csrf_hash.txt`) and a live `deploy.sh`. | §4 |
| DUP-12 | **P3** | `POST /api/templates` is a second, dead write path for templates. | D-08 |

## 7. What I could not verify

- **I did not diff `hr-system/app/**` against `app/**` file by file.** I compared hashes for `api/letters/route.ts` and enumerated the 12 letter files. The other ~77 archived files may diverge more or less.
- **I did not run `deploy.sh`** (and would not without explicit authorisation). Its behaviour is read from `hr-system/ARCHIVED.md:16,27-31` and the script's own gating, not observed.
- **I cannot determine which implementation the original author intended to keep.** The schema comments (`:1088-1091`, `:1116`, `:1461`) and the module headers all read as deliberate design notes, which argues the `LetterRecord` family was the intended future and `Letter` the shipped one — but no ADR, ticket or comment in the repository states this.
- **Whether the three `Letter` rows dated 2026-09-29 15:18:50 were produced by an automated verification script or by a person** is not recorded. The `Letter` model has no `createdBy`, so this is not answerable from data.
