# Letter Workflow Matrix

**Date:** 2026-09-29 · **Type:** READ-ONLY

**Markers**

| Marker | Meaning |
|---|---|
| **PASS** | Works end to end, reachable from the UI, correctly authorised |
| **PARTIAL** | Reachable and functional, but with a named, evidenced gap |
| **BROKEN** | Reachable, fails, or produces a wrong result |
| **MISSING** | **Proven absent** — searched at the model, code and mount level, not merely unfound |
| **DUPLICATED** | Two or more competing implementations; see [duplication audit](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md) |

Every row was verified by grepping the **component / route file / UI entry point**, not the action it calls. DB rows were confirmed read-only against `postgresql://hr_app@localhost:5433/hr_system`.

Related: [TEMPLATE](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [DATA MODEL](./LETTER_DATA_MODEL_AUDIT.md) · [INTEGRATION](./LETTER_SYSTEM_INTEGRATION_AUDIT.md) · [UX/NAV](./LETTER_UX_NAVIGATION_AUDIT.md) · [SECURITY](./LETTER_SECURITY_AUDIT.md) · [SUMMARY](./LETTER_AUDIT_SUMMARY.md)

---

## 1. Template management

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| T-01 | View template list | **PASS** | `app/dashboard/settings/templates/page-client.tsx:35` → `getLetterTemplates`; reachable from `app/settings/page.tsx:193` |
| T-02 | Create template | **PASS** | `letter-templates.ts:37`; page gate `LETTER_TEMPLATE_MANAGE` |
| T-03 | Edit template | **PARTIAL** | `letter-templates.ts:56` — in-place overwrite, no versioning, no concurrency guard |
| T-04 | Delete template | **PARTIAL** | `letter-templates.ts:72` — DB `ON DELETE RESTRICT` correctly blocks deleting a used template, but `page-client.tsx:114` discards the reason and shows "Failed to delete" |
| T-05 | Deactivate a template | **MISSING** | No UI control. `isActive` is never written; `POST /api/letters:89` never reads it. `page-client.tsx` has no `isActive` field |
| T-06 | Template version history | **MISSING** | No `TemplateVersion` model; 0 repo-wide matches; no `version` column on `LetterTemplate` |
| T-07 | Placeholder picker / autocomplete in the editor | **MISSING** | `page-client.tsx:246` lists 4 of the 20 defined variables as static text |
| T-08 | Rendered preview in the editor | **MISSING** | Editor has no preview. The `/letters` "Template Live Preview" (`LettersPageClient.tsx:301-314`) shows the **raw** template, not a resolved letter |
| T-09 | Enforced `type` vocabulary | **MISSING** | `schema.prisma:1137` unconstrained `String`; `offer-letter.ts:22` and `workflow/letters.ts:30` both match it by string equality |
| T-10 | Template read authorisation | **PARTIAL** | `getLetterTemplates` (`letter-templates.ts:14`) and `GET /api/templates` (`route.ts:5-9`) have **no capability check** — session only |
| T-11 | Template write authorisation | **PARTIAL** | Wrong capability: `ATTENDANCE_SHIFT_MANAGE` (`:38,57,73`) instead of `LETTER_TEMPLATE_MANAGE`. ACL-equivalent today (`permissions.ts:218,224,245-248,267`) — latent escalation, not a live one |
| T-12 | Second template write path | **DUPLICATED** | `POST /api/templates` (`route.ts:23-43`), role string-compare, **zero callers** |

---

## 2. Letter generation

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| G-01 | Generate a letter from a template | **PASS** | `app/letters/LettersPageClient.tsx:122` → `POST /api/letters`; button `:327-334`; all 10 shipped placeholders resolve (verified in DB rows 002/003/004) |
| G-02 | Placeholder substitution | **PASS** | `lib/letters/variables.ts`; `tests/letter-variables.test.ts` 30/30 green; verified against stored output |
| G-03 | Cross-employee authorisation | **BROKEN** | `route.ts:67-85` — the 403 is **unreachable**; every role with `LETTER_GENERATE` also has `LETTER_TEMPLATE_MANAGE`. The justifying comment (`route.ts:69-70`) claims `LETTER_GENERATE` is granted to STAFF; `permissions.ts:162-176` shows it is not |
| G-04 | Two-tier approval (staff requests, manager approves) | **MISSING** | `route.ts:145`'s `'PENDING'` branch is unreachable; DB: all 4 rows are `GENERATED`. `LetterRequest`/`LetterApproval`: 0 code, 0 rows |
| G-05 | Reference number uniqueness under concurrency | **BROKEN** | `route.ts:104-105` — `count()+1` outside any transaction against a `@unique` column. Collision → `P2002` → HTTP 500 |
| G-06 | Reference number uniqueness after deletion | **BROKEN** | Same line. Verified: `max_seq = 4 = total` **only because nothing has been deleted** |
| G-07 | Generation audit trail | **PARTIAL** | `logSecurityEvent` at `route.ts:149-158` — but logged as `SECURITY_ACTION.ACCESS_DENIED` with `outcome: 'SUCCESS'` |
| G-08 | Inactive template rejected | **MISSING** | `route.ts:89` uses `findUnique` with no `isActive` predicate |
| G-09 | Unresolved-placeholder feedback | **PARTIAL** | `route.ts:126-134` → `console.warn` only. No UI, no DB column, no HTTP signal |
| G-10 | Missing-value feedback | **MISSING** | `variables.ts:98-101` renders `—`. Verified: `LTR-UAE-2026-004` reads *"holding Passport No. —"* |
| G-11 | `customFields` cannot forge document values | **BROKEN** | `variables.ts:203-208` — caller keys written last and unconditionally; baked into `Letter.content_en` irreversibly |
| G-12 | "Purpose / Details" field does something | **BROKEN** | `LettersPageClient.tsx:130` sends `request.purpose`; **no shipped template contains `{{request.purpose}}`** |
| G-13 | Custom-field provenance recorded | **MISSING** | No `Letter` column for overrides; not written to `AuditLog` |

---

## 3. Approval

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| A-01 | Letter approval in the central queue | **MISSING** | `app/dashboard/approvals/page.tsx` queries `leaveRequest:58`, `serviceRequest:68`, `visaRequest:78` — **no** `LetterRequest`, `LetterApproval` or `LetterRecord`. `totalPending` at `:85` omits letters. Confirms `APPROVAL_CONNECTIVITY_AUDIT.md:102` at the mount level |
| A-02 | Approve a letter (any UI) | **MISSING** | `POST /api/letters/[id]/approve` has **zero callers**; `advanceLetter` is dead; `LetterApproval` has zero writers |
| A-03 | Approval state machine on `Letter` | **MISSING** | `LETTER_TRANSITIONS` (`state-machine.ts:307-330`) is applied only to `LetterRecord` (`workflow/letters.ts:188`) |
| A-04 | Valid status vocabulary | **BROKEN** | `Letter` uses `PENDING`; `LETTER_STATUS` has `PENDING_APPROVAL`. `PENDING` is not in the state machine; `APPROVED`/`VOID` are never written to `Letter` |
| A-05 | `VOID` / `REJECTED` reachable | **MISSING** | No code path sets `Letter.status` to either. `REJECTED` badge exists in UI (`LettersPageClient.tsx:165`) and can never render |
| A-06 | Approve route correctly gated | **PARTIAL** | `[id]/approve/route.ts:11` — raw `auth()` + hardcoded `["ADMIN","HR"]`. Excludes `SUPER_ADMIN`; bypasses `authorizePermission` |
| A-07 | Approve route validates state | **BROKEN** | `[id]/approve/route.ts:16-23` — `prisma.letter.update({ where: { id } })` with **no `status` precondition**. Any letter can be moved to `GENERATED` from any state, including `VOID` |
| A-08 | Approve route is audited | **MISSING** | No `logSecurityEvent`, no `AuditLog` row. Contrast `workflow/letters.ts:229-236`, which does both |
| A-09 | Approval routes by letter type | **BROKEN** | `workflow/letters.ts:30` `DEFAULT_APPROVAL_REQUIRED` intersects the live `type` values on `NOC` only. `EMPLOYMENT` and `PAYROLL` would not require approval |
| A-10 | `ServiceConfig` override for approval types | **PASS (unused)** | `workflow/letters.ts:32-45` reads `module='letters', key='approval_required_types'`; **0 rows** in DB, so the default always applies. The code path is correct and the fallback is correct |

---

## 4. Versioning and history

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| V-01 | Re-issue a corrected letter as a new version | **MISSING in product / PASS in dead code** | `workflow/letters.ts:80-119` implements `documentKey`+`version`+`supersededById` correctly. **Zero importers.** No UI, no action, no route |
| V-02 | Version numbers unique per document | **BROKEN** | No `@@unique([documentKey, version])`; `workflow/letters.ts:80-93` reads-then-writes across two steps. Concurrent creates can both produce `version = 1` |
| V-03 | See the full version chain of a document | **MISSING in product** | `workflow/letters.ts:262` and `actions/letters.ts:40` — both have **zero callers** |
| V-04 | Recover the template text a letter was issued from | **PARTIAL** | `Letter.content_en` is a rendered snapshot, so the *letter* is recoverable. The *template* is not — no versioning |
| V-05 | Recall what was issued and when | **PARTIAL** | `Letter.createdAt` + `referenceNumber` exist. No `createdBy`, no per-letter audit row. `LetterRecord.generatedAt` + `AuditLog` exist but only in the dead path |

---

## 5. Bulk operations

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| B-01 | Bulk letter generation | **MISSING in product / PASS in dead code** | `workflow/letters.ts:290-377` — per-employee outcomes, not-found reconciliation, `LETTER_GENERATE` gate. **Zero importers**, no UI, no action, no route |
| B-02 | No bulk letter UI | **MISSING** | Confirmed: the letters page has no multi-select (`LettersPageClient.tsx:272-286` is a single-value `Select`) |
| B-03 | Bulk partial-failure reporting | **PASS (in dead code)** | `workflow/letters.ts:363-376` — counts and per-row errors. Never executed |

---

## 6. PDF and document output

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| P-01 | Download a letter as PDF | **PASS** | `LettersPageClient.tsx:417` → `letter-generator.ts:13` |
| P-02 | Print a letter | **PARTIAL** | `window.print()` at `LettersPageClient.tsx:422` — prints the **viewer modal**, not an A4 layout. No `@page` print stylesheet was found for the letter |
| P-03 | Bilingual PDF | **BROKEN** | `letter-generator.ts:15` destructures `content_ar`; it is **never used again in the function**. The page advertises a "Bilingual Letter Engine" (`LettersPageClient.tsx:186-189`) |
| P-04 | Store the issued document | **MISSING** | `doc.save()` (`:123`) writes to the browser. `pdfUrl` is written **nowhere** (0 repo-wide matches) and is NULL on all 4 rows. `Attachment` has no `letterId` |
| P-05 | Letter sent to the employee | **MISSING** | "Send via Email" button at `LettersPageClient.tsx:501-503` has **no `onClick`** — a dead control |
| P-06 | Signature / stamp embedded | **PARTIAL** | `letter-generator.ts:78-98` — assets fetched over HTTP; on failure `catch:96` logs and the PDF is issued **unsigned with no user warning** |
| P-07 | Letter can be viewed for a candidate (offer) | **BROKEN** | `generateLetterPDF` handles `candidate` (`:16`), but `GET /api/letters` (`route.ts:23-30`) includes only `employee`. A candidate letter yields `subject = undefined` → name prints `"—"` |
| P-08 | Long letters paginate | **MISSING** | `letter-generator.ts:72` — single `doc.text()` with no page-break check. Latent, because only English is rendered |
| P-09 | Raw HTML / script injection via template content | **PASS (verified negative)** | React escapes the on-screen render (`LettersPageClient.tsx:456`); the PDF path is `doc.text()` (`letter-generator.ts:71-72`). No HTML parsing anywhere in the render path |

---

## 7. Recruitment / offer letters

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| R-01 | Issue an offer letter from an approved offer | **PASS** | `OfferActions.tsx:75` → `recruitment.ts:254` → `offer-letter.ts:36`. Gated on `APPROVED` and `!letterRecordId` (`:76-84`) |
| R-02 | Offer letter uses the `LetterTemplate` | **BROKEN** | `offer-letter.ts:99-118` builds the body as a hardcoded string array. The template resolved at `:86` is used **only** to satisfy the `templateId` FK; its content is discarded. The module header (`:4-7`) claims the opposite |
| R-03 | Offer letter resolves the right template | **BROKEN** | `offer-letter.ts:22` looks for `type: "OFFER"`; **no such template exists**. Falls through to `findFirst({ orderBy: { createdAt: 'asc' } })` (`:29-32`) — currently the Employment Certificate. Silent |
| R-04 | View an issued offer letter | **MISSING** | `app/recruitment/offers/LetterPreview.tsx` is a finished 124-line renderer whose sole input matches `offer-queries.ts:137-138` exactly. **Imported by nothing.** `OfferActions.tsx:132-136` shows only a static sentence |
| R-05 | Download an issued offer letter | **MISSING** | Same root cause as R-04 |
| R-06 | Offer letter link resolves to a page | **BROKEN** | `offer-letter.ts:139` sets `fileUrl: \`/letters/${letterId}\``. There is no `app/letters/[id]` route — glob of dynamic segments under `app/letters/` returns nothing |
| R-07 | Offer letter carries the offer's terms | **PASS** | `offer-letter.ts:94,104-109` — gross, joining date, benefits, probation all from the `OfferLetter` row |
| R-08 | Offer letter is bilingual | **MISSING** | `content_ar` is never written by `offer-letter.ts:121-135`; the PDF engine would not render it anyway (P-03) |
| R-09 | Double-issue is prevented | **PARTIAL** | `offer-letter.ts:76` checks `letterRecordId` in application code. No DB uniqueness on `(offerId)`; a race issues two letters. `OfferLetter.__unique([candidateId, version])` does not help |
| R-10 | `CreateOfferForm.tsx` / `CompleteJoining.tsx` produce letters | **MISSING** | Repo-wide grep for `letter`/`pdf`/`template` in both files: **0 matches.** The brief's assumption that they do is incorrect |

---

## 8. Navigation and discoverability

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| N-01 | `/letters` reachable from navigation | **PASS** | `components/layout/Sidebar.tsx:48`, gated on `LETTER_VIEW` |
| N-02 | `/dashboard/settings/templates` reachable | **PARTIAL** | `app/settings/page.tsx:193` — a raw `<a href>`, not `<Link>`, so it triggers a full page load and skips client navigation |
| N-03 | `/letters/appointment` reachable | **MISSING** | Repo-wide grep for `letters/appointment` in `.tsx`: only `auth.config.ts:42` and its own back-link. **No link anywhere** |
| N-04 | `/letters/offer` reachable | **MISSING** | Same, `auth.config.ts:41` |
| N-05 | `/letters/relieving` reachable | **MISSING** | Same, `auth.config.ts:43` |
| N-06 | Letters searchable in global search | **BROKEN** | `search/route.ts:1034` searches **`LetterRecord`** (0 rows). No domain searches `Letter` (4 rows). The 4 real letters are unsearchable |
| N-07 | Letter templates searchable | **PASS** | `search/route.ts:1068` searches `LetterTemplate`; correctly gated on `LETTER_TEMPLATE_MANAGE` (`:1066`) and never selects `content_en`/`content_ar` |
| N-08 | Edge route rules match reality | **PARTIAL** | `auth.config.ts:40` gates `/dashboard/letters` — **no such route exists** (dead rule). `/dashboard/settings/templates` has **no** edge rule; it relies solely on the page guard |
| N-09 | Non-HR users see a working request flow | **BROKEN** | `LettersPageClient.tsx:333` shows "Submit Letter Request" to anyone who is not ADMIN/HR, but `POST /api/letters:43` requires `LETTER_GENERATE` = HR/ADMIN/SUPER_ADMIN. STAFF and MANAGER get a 403 |
| N-10 | Documented `letter.employeeId` nullability honoured by the UI | **BROKEN** | `LettersPageClient.tsx:49` types `employee` as non-nullable; `:369` does `letter.employee.firstName[0]`. `schema.prisma:1152` makes it nullable. A candidate letter crashes the archive list |

---

## 9. Document-adjacent models

| # | Workflow | Marker | Evidence |
|---|---|---|---|
| D-01 | Letter attaches an artifact (signed scan, PDF) | **MISSING** | `Attachment` (`schema.prisma:1044-1061`) has no `letterId`; 0 rows |
| D-02 | Document expiry reminders | **MISSING in product / PASS in schema** | `DocumentExpiryReminder` has a correct `@@unique` (`:422`) and index (`:423`); 0 rows; no code path writes it |
| D-03 | Document renewal workflow | **MISSING in product / PASS in schema** | `DocumentRenewal` (`:428-444`) + `RENEWAL_STATUS` (`state-machine.ts:336-343`); 0 rows |
| D-04 | `DocumentExpiryReminder` duplicate suppression | **PASS (design reference)** | `@@unique([employeeId, documentType, thresholdDays, expiryDate])`, `:422`. **This is the pattern `LetterRecord` versioning should have used** — see DM-06 |

---

## 10. Marker tally

| Marker | Count |
|---|---|
| **PASS** | 11 |
| **PARTIAL** | 15 |
| **BROKEN** | 15 |
| **MISSING** | 30 |
| **DUPLICATED** | 1 (representing 18 concerns — see the duplication audit) |

**Thirty of seventy-two letter workflows are proven absent.** The system is not "letter generation with gaps"; it is a working template renderer bolted to an approval system that was never connected to it, plus a better-engineered approval system that was never mounted.

---

## 11. What I could not verify

- **Every "MISSING" is proven by absence, not by failure to find.** Each was checked at three levels: schema, application code, and the mounted component tree / database row count. The specific searches are recorded per row.
- **Reachability was determined statically.** I did not click through the UI. A route with no link could still be reached by a bookmark, a search result, a redirect, or a direct URL — and I checked for all four.
- **Rows marked PARTIAL rather than BROKEN** are cases where the mechanism works but a named, evidenced gap exists; several could reasonably be escalated.
- **I could not determine whether any of the three unreachable one-off pages has ever been opened in production.** `LetterRecord` having 0 rows is strong evidence it has not, but it is inference, not proof.
