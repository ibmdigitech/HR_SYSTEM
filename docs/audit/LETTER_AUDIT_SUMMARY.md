# Letter System — Audit Summary

**Date:** 2026-09-29 · **Type:** READ-ONLY · **Codebase:** `HR_SYSTEM-git-check` @ repository root
**Method:** static trace with `file:line` on every claim · read-only SQL against `postgresql://hr_app@localhost:5433/hr_system` (`information_schema`, `pg_indexes`, `pg_constraint`, row counts) · `npx tsc --noEmit` (clean) · `npx vitest run tests/letter-variables.test.ts` (**30/30 passed**).
**Nothing was fixed.** No application code, no schema, no data, no configuration was modified.

> **On the 15 questions.** The literal text of brief §24 was not included in the assignment. The 15 questions below are reconstructed from the brief's own stated points (a)–(f) and from the "report back" list, then answered. Where the brief's framing turned out to be wrong, the correction is stated explicitly in the answer.

**Detailed documents:** [TEMPLATE](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [DATA MODEL](./LETTER_DATA_MODEL_AUDIT.md) · [DUPLICATION](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md) · [WORKFLOW MATRIX](./LETTER_WORKFLOW_MATRIX.md) · [INTEGRATION](./LETTER_SYSTEM_INTEGRATION_AUDIT.md) · [SECURITY](./LETTER_SECURITY_AUDIT.md) · [UX/NAV](./LETTER_UX_NAVIGATION_AUDIT.md) · [RECOMMENDATIONS](./LETTER_SYSTEM_RECOMMENDATIONS.md)

---

## Executive summary

1. **There is not one letter system. There are three letter data models and five implementations**, and they never interoperate: `Letter`/`LetterTemplate` (live), `LetterRecord` (mounted writers, zero rows), `LetterRequest`/`LetterApproval` (zero code, zero rows), plus the archived `hr-system/` application.
2. **The single most important finding: `lib/workflow/letters.ts` — 379 lines containing the system's only approval state machine, versioning, bulk generation and audit trail — is imported by nothing except a unit test.** The features `WORKFLOW_AUDIT.md:251-253` reported as missing were built, into a module that is not mounted.
3. **The three "duplicated letter workflows" are unreachable code, not a shipped feature.** `/letters/appointment`, `/letters/offer` and `/letters/relieving` have **no inbound link anywhere in the application** — verified by grepping components, route files and entry points, not actions. `LetterRecord`, which they exclusively write, has **0 rows**.
4. **The placeholder fix is correct and complete.** All ten shipped placeholders now resolve, confirmed against three letters stored in the database at 15:18:50 today. `renderTemplate` is literal-keyed, null dates are guarded, and the regex-wildcard vulnerability is fixed. 30/30 tests green.
5. **But the fix is structurally unprotected.** `lib/letters/variables.ts` has exactly **one importer**. Three other code paths build letter bodies independently, so the drift that caused the original bug can recur undetectably.
6. **The system issues visibly defective documents.** A Travel NOC reading *"holding Passport No. —"* was generated and reported as a success. Absent values render as an em-dash with no signal, because the key *resolves* — so the new unresolved-placeholder detector does not fire.
7. **Every authenticated user can read every letter, including every employee's full salary breakdown.** `GET /api/letters` has no employee scoping and no capability check. `PRODUCTION_READINESS_CHECKLIST.md:279` records this IDOR as "already true" — **it is not.**
8. **Letters are invisible to the approval queue.** `/dashboard/approvals` queries three models and no letter model. Confirmed at `page.tsx:58,68,78`. Mounting the dead workflow *without* adding the queue would create an approval process no approver can see.
9. **Two different companies' letterheads are live in one product.** `ServiceConfig` module `COMPANY` has **0 rows**, so `getCompanySettings()` returns hardcoded "IBMDigiTech LLC / Dubai" while the central flow hardcodes "Al Barakah Group / Abu Dhabi".
10. **An issued offer letter cannot be viewed, printed or downloaded anywhere.** `LetterPreview.tsx` is a finished 124-line renderer whose input matches the query at `offer-queries.ts:137` exactly — and it is imported by nothing.

**30 of 72 letter workflows are proven MISSING. 15 are BROKEN. 15 are PARTIAL. 11 are PASS.** 18 concerns are DUPLICATED.

---

# The 15 questions

---

## Q1 — Is this one letter system or two?

**Neither. It is three data models in one application, and five implementations.**

| Model | Rows | Written by | Read by |
|---|---|---|---|
| `Letter` + `LetterTemplate` | **4** + 3 | `POST /api/letters` (`route.ts:136`), `lib/workflow/offer-letter.ts:122` | `GET /api/letters` (`route.ts:21`) |
| `LetterRecord` | **0** | `app/lib/actions/letters.ts:23` (unreachable pages), `lib/workflow/letters.ts:97` (dead) | `app/api/search/route.ts:1034` |
| `LetterRequest` + `LetterApproval` | **0 + 0** | **nothing** | **nothing** |

```sql
SELECT 'Letter', count(*) FROM "Letter"          UNION ALL
SELECT 'LetterTemplate', count(*) FROM "LetterTemplate" UNION ALL
SELECT 'LetterRecord', count(*) FROM "LetterRecord"    UNION ALL
SELECT 'LetterRequest', count(*) FROM "LetterRequest"  UNION ALL
SELECT 'LetterApproval', count(*) FROM "LetterApproval"
```

A letter is represented by one row in one family, chosen by which screen the operator used. **No letter ever passes between families.** The 18-row duplication table is in [LETTER_TEMPLATE_DUPLICATION_AUDIT.md §1](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md).

---

## Q2 — Are the three paths genuinely duplicated? Is one dead? Which is reachable from the UI?

**All three are duplicated; one is entirely dead; two are reachable but via different routes; and there are two more the brief did not list.**

| Path | Reachable from the UI? | Uses the placeholder engine? |
|---|---|---|
| `app/api/letters/route.ts` `POST` | **YES** — `LettersPageClient.tsx:122`, button at `:327` | **YES** |
| `app/lib/actions/letters.ts` | **NO** — called only by the three unlinked pages | n/a (no rendering) |
| `lib/workflow/letters.ts` | **NO** — imported by **nothing** but `tests/workflow-p1-modules.test.ts:18` | n/a |
| `lib/workflow/offer-letter.ts` *(not in the brief)* | **YES** — `OfferActions.tsx:75` | **NO** — body built inline at `:99-118` |
| `hr-system/**` *(not in the brief)* | n/a — excluded by `tsconfig.json:33` | NO — predates the fix |

**Reachability method:** grepped for `letters/appointment`, `letters/offer`, `letters/relieving` in every `.tsx`. Six matches: three edge rules in `auth.config.ts:41-43` and three *outbound* back-links to `/letters`. **Zero inbound links.** The only `/letters` navigation entry in `components/` is `Sidebar.tsx:48`.

---

## Q3 — Does `app/lib/actions/letters.ts` use the same engine, or does it still have a second private substitution?

**It has no substitution at all. The file is 82 lines.**

```ts
// app/lib/actions/letters.ts
export async function saveLetterRecord(formData: FormData)   // :7   → prisma.letterRecord.create (:23)
export async function getLetterHistory()                    // :40  → prisma.letterRecord.findMany (:47)
export async function getEmployeesForLetter()               // :58  → prisma.employee.findMany (:63)
```

No `renderTemplate`, no variable map, no `{{` handling, nothing at line 339 or 346. **The brief's line reference does not exist.**

**The real second engine is in two other places:**
- `app/letters/{appointment,offer,relieving}/page-client.tsx` — inline jsPDF with hardcoded prose (`appointment:99-113`), zero placeholders.
- `lib/workflow/offer-letter.ts:99-118` — a hardcoded English string array, zero placeholders.

**`lib/letters/variables.ts` has exactly one importer: `app/api/letters/route.ts:7-11`.** This *is* the section-17 duplication finding, and yes — the two paths will drift again, because nothing enforces that a new renderer uses the engine. There is no lint rule, no shared entry point, and no test that fails when a second substitution site appears.

---

## Q4 — Is the placeholder fix correct and complete, and is preview the same code path as the final render?

**The fix: correct and complete. Verified against stored data.**

`LTR-UAE-2026-003`, in the database, created today:
```
{{employee_name}}   → Admin User
{{employee_id}}     → ADM-001
{{designation}}     → System Administrator
{{department}}      → IT
{{joining_date}}    → 25 Sept 2026
{{company_name}}    → Al Barakah Group
```
Every placeholder in all three shipped templates resolves. `npx vitest run tests/letter-variables.test.ts` → **30 passed**. `npx tsc --noEmit` → clean.

**One correction to the fix's own documentation.** `lib/letters/variables.ts:8-11` states the old map and the old templates had *"ZERO overlap"* and that all three templates *"rendered their placeholders literally."* The database shows this was **partially** true. `LTR-UAE-2026-001` (2026-09-26, pre-fix):
```
{{employee_name}} → Admin User          {{employee_id}}   → {{employee_id}}     (literal)
{{company_name}}  → Al Barakah Group     {{designation}}  → {{designation}}     (literal)
                                           {{department}}   → {{department}}      (literal)
                                           {{joining_date}} → .{{joining_date}}. (literal)
```
Two of six resolved. The silent-success character of the bug stands; the "zero overlap" wording overstates it.

**Preview vs final: NO, they are different code paths.**

| Surface | Renders | Substitution |
|---|---|---|
| "Template Live Preview" (`LettersPageClient.tsx:301-314`) | **raw `LetterTemplate.content_en`** | **none** |
| Viewer modal (`:456`) | `Letter.content_en` | yes |
| PDF (`letter-generator.ts:71`) | `Letter.content_en` | yes |

The user sees `{{employee_name}}`; the document says `Admin User`. **This is the blind spot that let the original bug ship** — an operator cannot distinguish a working placeholder from a typo'd one, and the only feedback is a server `console.warn` (`route.ts:126-134`).

---

## Q5 — Can template content inject raw HTML or script?

**No. Verified, and stated explicitly because it was asked.**

1. The on-screen render is React JSX — `LettersPageClient.tsx:456`. React escapes interpolated strings. No `dangerouslySetInnerHTML` anywhere in the letter render path.
2. The PDF path passes content to `doc.text()` (`letter-generator.ts:71-72`). jsPDF does not parse HTML.
3. Transport is JSON; the client stores it in a `string`-typed field.

**The residual risk is content integrity, not script execution.** `withAliases` writes caller-supplied `customFields` **last and unconditionally** (`variables.ts:203-208`), so `POST /api/letters` with `{"employee_name":"Someone Else","gross_salary":"900000"}` produces a valid, reference-numbered certificate containing values that never existed in the system of record — baked into `Letter.content_en`, with no provenance recorded. Bounded to HR/ADMIN; an auditability defect, not a privilege escalation.

---

## Q6 — Is the reference number scheme safe?

**No.** `app/api/letters/route.ts:104-105`:

```ts
const count = await prisma.letter.count();
const refNumber = `LTR-UAE-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
```

`count()+1` against a `@unique` column (`schema.prisma:1159`; `Letter_referenceNumber_key` in `pg_indexes`). **There is no `prisma.$transaction` anywhere in this route.**

| Failure | Result |
|---|---|
| Delete `LTR-UAE-2026-004` | `count()`=3 → next letter computes `…-004` → `P2002` → HTTP **500 "Failed to generate letter"** |
| Two concurrent POSTs | both compute `…-005`, one 500s |
| Year rollover | the suffix is a global count, not per-year |

**Live state:** `max_seq = 4`, `total = 4`. They agree **only because nothing has ever been deleted.**

A second scheme writes the same column: `lib/workflow/offer-letter.ts:128` — `OFFER-${requisitionCode}-V${version}`. Different prefix, no collision today, no coordination.

---

## Q7 — Is the brief's Prisma model list correct?

**Yes, in every particular — and there are additions.**

| Model | Brief's list | Verdict |
|---|---|---|
| `LetterTemplate` | `id, name, type, content_en, content_ar, isActive, createdAt, updatedAt`; no version/letterhead/HTML/company-scope/creator; `isActive` is a Boolean | **Correct in full** (`schema.prisma:1134-1145`) |
| `Letter` | `id, employeeId?, candidateId?, templateId`, `referenceNumber @unique`, `status`, `content_en`, `content_ar`; `employeeId` nullable for pre-hire offers | **Correct** — but the brief **omits `letterRequestId String? @unique`** (`:1160-1161`, the only structural link to `LetterRequest`), and `jobRequisitionId`, `pdfUrl`, `comments`, `approvedBy`, `approvedAt` |
| `LetterRequest` | `id, employeeId` (required), `templateId`, `reason`, `status`, `approvals[]`, `generatedLetter`, timestamps | **Correct in full** (`:1109-1121`) |
| `LetterApproval` | `letterRequestId, approverId?, level (MANAGER\|HR), action (APPROVED\|REJECTED), comments, createdAt` | **Correct** (`:1123-1132`) — but `level` and `action` are unconstrained `String` with comment-only enumerations |

**Also checked:** `LetterRecord` (`:1079-1107`, 0 rows) · `DocumentExpiryReminder` (`:410-424`, 0 rows) · `DocumentRenewal` (`:428-444`, 0 rows) · `Attachment` (`:1044-1061`, 0 rows — **no `letterId`**) · `OfferLetter` (`:1432-1471`, 0 rows).

**`LetterTemplate.type` is the column the brief missed as a risk.** It is unconstrained `String` (`:1137`). Live values: `EMPLOYMENT`, `PAYROLL`, `NOC`. `offer-letter.ts:22` looks for `"OFFER"` — **no match** — and silently falls back to the oldest template (`:29-32`), recording an offer letter as based on the Employment Certificate.

---

## Q8 — Is there a `TemplateVersion` model, and what is the consequence?

**No. Proven absent, not unfound.** Repo-wide search for `TemplateVersion` and for any `version` column on `LetterTemplate`: **0 matches**.

`updateLetterTemplate` overwrites `content_en` in place (`letter-templates.ts:60-65`) with no optimistic-concurrency guard, and `deleteLetterTemplate` is a hard `delete` (`:76-78`).

**What survives:** `Letter.content_en` is a *rendered snapshot*, so an issued letter still shows the text it was issued with.
**What is lost:** the template. After an edit there is no way to answer *"what did the approved Employment Certificate say on 26 September?"*, and two HR users editing the same template silently overwrite each other.

**Related, and better than it looks:** the delete *is* protected by the database — `pg_constraint` shows `Letter_templateId_fkey ... ON DELETE RESTRICT`. Deleting a used template is correctly refused. But `page-client.tsx:114` discards the error, so the operator sees only *"Failed to delete."*

**The in-repo pattern to copy:** `DocumentExpiryReminder` has `@@unique([employeeId, documentType, thresholdDays, expiryDate])` (`schema.prisma:422`) with the design note at `:408-409`. That is exactly the constraint `LetterRecord`'s versioning lacks.

---

## Q9 — Do the one-off letter pages reuse the central flow?

**No. Each is a complete, independent letter system.** Representative — `appointment/page-client.tsx`, with `offer` and `relieving` structurally identical:

| Concern | Central flow | One-off page |
|---|---|---|
| Body | `LetterTemplate.content_en` | hardcoded literal, `:99-113` |
| Substitution | `lib/letters/variables.ts` | **none** |
| PDF | `letter-generator.ts:13` | own `new jsPDF()`, `:59` |
| Letterhead | "Al Barakah Group" / Abu Dhabi | **`"IBMDigiTech LLC"` / Dubai** |
| Record | `Letter` + `referenceNumber` | `LetterRecord` + free-text `details`, `:140-145` |
| Permission | route-level | page-level only |
| Audit | `logSecurityEvent` | **none** |

**Two consequences:**

1. **The two-companies defect is live.** `SELECT module,key,value FROM "ServiceConfig" WHERE module='COMPANY'` → **0 rows**, so `getCompanySettings()` (`company-settings.ts:18-25`) always returns the hardcoded `"IBMDigiTech LLC"` defaults. The central flow hardcodes a *different* company. Neither reads the other.
2. **Success is reported unconditionally.** `:145` — `await saveLetterRecord(fd)` with the result discarded; `:231` then renders *"Saved & Downloaded!"*. **Verified against data: `LetterRecord` has 0 rows.**

**`app/recruitment/offers/CreateOfferForm.tsx` and `app/recruitment/CompleteJoining.tsx` do not produce letters at all** — repo-wide grep for `letter|pdf|template` in both files: **0 matches.** The brief's assumption on this point is incorrect. The genuine offer-letter flow is `OfferActions.tsx:75`.

---

## Q10 — Are letter approvals represented in `/dashboard/approvals`?

**No. Confirmed at the mount level with `file:line`.**

`app/dashboard/approvals/page.tsx`:

| Line | Query |
|---|---|
| `:58` | `prisma.leaveRequest.findMany` |
| `:68` | `prisma.serviceRequest.findMany` |
| `:78` | `prisma.visaRequest.findMany` |
| `:85` | `const totalPending = pendingLeaves.length + pendingStaffRequests.length + pendingVisaRequests.length;` |

Three `TabsTrigger`s at `:166,173,181`. **No `LetterRequest`, no `LetterApproval`, no `LetterRecord`, and no `POST /api/letters/[id]/approve` consumer** — that route has zero callers repo-wide.

This confirms `APPROVAL_CONNECTIVITY_AUDIT.md:102` (`"Letters | LetterApproval | no | no"`), which remains accurate.

**The forward-looking risk:** `lib/workflow/letters.ts` *does* implement a complete approval workflow with a 6-state machine, audit rows and notifications. **Mounting it without first adding a letters tab would create an approval process no approver can see** — worse than none, because it would be reported as existing.

---

## Q11 — What does the live database actually contain?

**Four `Letter` rows, not one.** (The brief said one.)

```
 referenceNumber  | status    | createdAt           | pdfUrl
------------------+-----------+---------------------+--------
 LTR-UAE-2026-004  | GENERATED | 2026-09-29 15:18:50 | (null)
 LTR-UAE-2026-003  | GENERATED | 2026-09-29 15:18:50 | (null)
 LTR-UAE-2026-002  | GENERATED | 2026-09-29 15:18:50 | (null)
 LTR-UAE-2026-001  | GENERATED | 2026-09-26 06:11:47 | (null)
```

**Correcting the brief on `app/lib/actions/letters.ts`:** it did *not* produce the 2026-09-26 row. It writes `prisma.letterRecord` (`:23`), and `LetterRecord` has **0 rows**. The 2026-09-26 row is in `Letter`, written by `POST /api/letters` (`:136`).

Rows 002–004 were created at 15:18:50 today, roughly nine minutes before this audit began, by someone else. Their content confirms the placeholder fix is live in the database.

**Integrity checks — all clean:**

```sql
-- 0 orphans on Letter.employeeId, Letter.templateId, LetterRecord.employeeId
-- 0 rows with candidateId populated; 0 rows with employeeId NULL
-- 0 rows with letterRequestId populated  → families A and C never connect
-- 0 OfferLetter rows; 0 Attachment rows
```

**What the data proves that code reading alone did not:** the substitution fix is genuinely live; `pdfUrl` is NULL everywhere, so **no letter artifact is stored anywhere**; and the two letterhead identities are both real because the `COMPANY` config is empty.

---

## Q12 — Where does this audit contradict the existing documentation?

| Prior claim | Source | Verdict |
|---|---|---|
| "No `model Resignation` … only … a relieving-letter template default" | `PRODUCTION_READINESS_CHECKLIST.md:148` | **Confirmed** |
| "Every occurrence of 'termination' is a permission name, a relieving-letter template default, or a status badge" | `:156` | **Confirmed** |
| "`api/letters/[id]/approve`" is one of five dynamic segments | `:172` | **Confirmed** — but it has **zero callers**; the audit did not note that |
| IDOR: "Employee A cannot read employee B's payroll, letters, documents — already true" | `:279` | **CONTRADICTED.** `GET /api/letters` has no scoping. Not true for letters. |
| `LetterRecord` "search route queries fields on it" | brief (d) | **Confirmed** — `search/route.ts:1034-1043` selects `type, recipientName, status, documentKey, rejectedReason` |
| "Letter Generation — PASS" | `WORKFLOW_AUDIT.md:20` | **Overstated.** It generates; it has no approval, no versioning, no notification, no stored artifact. |
| FLOW-005: "Generate → `generateLetter` server action … INSERT LetterRecord … INSERT Letter (if new template)" | `WORKFLOW_AUDIT.md:223-230` | **FALSE.** No `generateLetter` export exists. The real paths write one model each, never both. |
| FLOW-018/019/020: "no approval / no version control / no bulk generation" | `:251-253,481-483` | **Stale, and inverted.** All three were implemented — into `lib/workflow/letters.ts`, which is unmounted. Right about the product, overtaken by the code. |
| `letters.generate` / `letters.approve` granted to 4 roles incl. FINANCE; `letters.view` has team/own scoping | `RBAC_AUDIT.md:70-73` | **FALSE.** `LETTER_GENERATE` is HR/ADMIN/SUPER_ADMIN only (`permissions.ts:222`). FINANCE has no letter capability. No scoping exists. |
| `/api/letters` — "None" (no RBAC) | `RBAC_AUDIT.md:233` | **Half remediated.** `POST` is guarded (`route.ts:43`); `GET` still is not. |
| "Letters \| `LetterApproval` \| no \| no" | `APPROVAL_CONNECTIVITY_AUDIT.md:102` | **Confirmed** |
| `hr-system/` is not the application | `PRODUCTION_READINESS_CHECKLIST.md` 1.7 | **Confirmed** — and the archive contains a full pre-fix letter subsystem plus a tracked secret. |

---

## Q13 — Which findings are the most severe, and why?

**P0 — the system issues documents that are wrong, or cannot be trusted**

1. **`lib/workflow/letters.ts` (379 lines) is dead code** — the only approval state machine, versioning, bulk generation and audit trail in the system, imported by nothing but a test. Every letter is issued with no approval and no audit.
2. **A Travel NOC was issued reading "holding Passport No. —"** and reported success. `variables.ts:98-101`; DB row `LTR-UAE-2026-004`. The unresolved-placeholder detector does not fire because the *key* resolves.
3. **`lib/letters/variables.ts` has one importer.** The fix is correct and structurally unprotected.

**P1 — the system leaks data, loses evidence, or documents a control that does not exist**

4. **`GET /api/letters` returns every letter to every authenticated user**, including full salary breakdowns — no scoping, no `LETTER_VIEW` (`route.ts:13-37`).
5. **The IDOR guard in `POST /api/letters` is unreachable**, and its justifying comment claims `LETTER_GENERATE` is granted to STAFF (`route.ts:69-70` vs `permissions.ts:162-176`). A control that is documented and does not exist.
6. **Successful operations are logged as `ACCESS_DENIED`** (4 sites).
7. **No letter artifact is stored** — `pdfUrl` written nowhere, NULL on all rows, `Attachment` has no `letterId`.
8. **Arabic is never rendered in the PDF** — `content_ar` destructured at `letter-generator.ts:15`, never used again.

---

## Q14 — Where is the "silent success" pattern, in general?

**Six distinct places where a failure is invisible to the user.** This is the through-line of the whole subsystem:

| # | Silent failure | Evidence |
|---|---|---|
| 1 | Unresolved placeholders → `console.warn` only | `route.ts:126-134` |
| 2 | Missing values → `—` on a signed document | `variables.ts:98-101`; DB row 004 |
| 3 | Reference-number collision → HTTP 500, not "that number is taken" | `route.ts:161-164` |
| 4 | `saveLetterRecord` failure → *"Saved & Downloaded!"* | `appointment:145,231` |
| 5 | Delete failure → *"Failed to delete"*, reason discarded | `page-client.tsx:113-114` |
| 6 | "Purpose / Details" → accepted, stored, never rendered | `LettersPageClient.tsx:130` vs DB `content_en` |

The 2026-09-26 letter demonstrates #1 historically: it was created, numbered and reported successful with four of six placeholders still literal in the body.

---

## Q15 — What should be done, in what order?

Full analysis with Problem / Evidence / Impact / Solution / Files / Models / Migration risk / Dependencies / Priority for each item is in **[LETTER_SYSTEM_RECOMMENDATIONS.md](./LETTER_SYSTEM_RECOMMENDATIONS.md)**. Nothing there has been implemented.

**The sequence:**

| Phase | Content | Gate |
|---|---|---|
| **0 — Decide** (1 day) | Which model survives; single-HR approval or two-level; server-render or not; is Arabic required; **is `hr-system/` deployed anywhere** | — |
| **1 — Stop the bleeding** (1 sprint, no migration) | Scope `GET /api/letters` · constrain `customFields` · fix the audit event type · delete the dead `[id]/approve` · fix the wrong template capability · guard the null `employee` · transaction-wrap the reference number · warn-on-missing-value · **delete `hr-system/`** | none — **start here** |
| **2 — Consolidate** (2 sprints) | One `generateLetter()` · port the offer body into a template · delete the three one-off pages · delete `lib/workflow/letters.ts` after porting its versioning · mount `LetterPreview` | Phase 0 + 1 |
| **3 — Schema** (1 sprint) | `documentKey`/`version`/`supersededById` onto `Letter` · adopt `LETTER_STATUS` · drop the three retired models (all 0 rows — no backfill) · enforce `LetterTemplate.type` | Phase 2 |
| **4 — Approval** (1 sprint) | A "Letters" tab on the existing `/dashboard/approvals` page | **Phase 3 — mounting a state machine before the queue creates an invisible approval process** |
| **5 — Document** (2 sprints) | Persist the artifact · Arabic in the PDF · real email · honest QR | Phase 4 |
| **6 — Quality** (ongoing) | Editor preview · full variable list · `isActive` · mobile view | — |

**The merge must be additive, not subtractive.** `LetterRecord` must be kept as the *donor* of the only versioning design and the only letter state machine in the repo, and `Letter` as the *host* — because `Letter` is the only model with a template engine, a UI, a PDF path, a search domain and any data. The same is true of `lib/workflow/letters.ts`: it is dead, but it is good code, and it should be ported rather than deleted.

---

## What I could not verify

Recorded in full, because an honest UNVERIFIED is worth more than a confident guess.

1. **No end-to-end run.** I did not authenticate, click through `/letters`, or call `POST /api/letters`. All substitution evidence comes from letters already in the database. The 30 tests and `tsc` are unit/static checks.
2. **Who created the three 2026-09-29 letters.** They appeared at 15:18:50, ~9 minutes before this audit began, and were not created by me. `Letter` has no `createdBy` column, so this is not answerable from data.
3. **No PDF was rendered.** That `content_ar` is dropped is proven by reading the whole 124-line function and confirming it has one occurrence; I did not produce a PDF to inspect.
4. **RBAC conclusions are from source, not from live sessions.** `permissions.ts` grant lists and `resolvePermissions`; I did not log in as each role.
5. **The `hr-system/` tree was not fully diffed.** I hashed `api/letters/route.ts` and enumerated its 12 letter files. The other ~77 archived files are unexamined. I did not run `deploy.sh`.
6. **The archived tree was not security-audited** beyond noting its unguarded letters API and the tracked `csrf_hash.txt`.
7. **Concurrency behaviour was not exercised.** The reference-number and `LetterRecord` versioning races are derived from code structure; I did not fire concurrent requests or inserts.
8. **I could not determine the intended design.** No ADR, ticket or comment states whether `Letter` or `LetterRecord` was meant to win, or whether `LetterRequest`/`LetterApproval` are planned or abandoned. The recommendations assume the live model wins, and say so.
9. **I did not read the prior audits' sequencing plans in detail** (`IMPLEMENTATION_PLAN.md`, `P0_REMEDIATION_PLAN.md`). My phase sequence is built from the letter findings alone and may conflict with work already in flight.
10. **Search-route and recruitment findings may be stale.** `app/api/search/route.ts`, `components/layout/CommandSearch.tsx` and `app/recruitment/**` are under concurrent edit by other agents. Findings about them describe the state as read on 2026-09-29.
11. **"Silent success" #2 could be a data problem rather than a content problem.** `passportNumber` is empty for all three seeded employees. I did not determine whether real employees would have it populated.
12. **Browser rendering, accessibility and responsive behaviour were not tested.** No browser was used; layout and a11y observations are from markup only.
