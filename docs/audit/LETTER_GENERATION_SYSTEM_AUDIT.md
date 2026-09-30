# Letter Generation System Audit

**Scope:** every code path that produces a `Letter`, a `LetterRecord` or a letter PDF.
**Date:** 2026-09-29 · **Type:** READ-ONLY
**Method:** static trace + read-only DB queries + `npx vitest run tests/letter-variables.test.ts` + `npx tsc --noEmit`.

Related: [TEMPLATE audit](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [DATA MODEL audit](./LETTER_DATA_MODEL_AUDIT.md) · [DUPLICATION audit](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md) · [UX/NAV audit](./LETTER_UX_NAVIGATION_AUDIT.md) · [SUMMARY](./LETTER_AUDIT_SUMMARY.md)

---

## 1. Headline — there is no single generation path

Four independent implementations exist. **Only one of them is reachable from a link in the UI, and only one of them uses the placeholder engine.**

| # | Path | Entry | Reachable? | Uses `lib/letters/variables.ts`? | Persists to |
|---|---|---|---|---|---|
| G1 | `app/api/letters/route.ts` `POST` | "Generate Official Document" button | **Yes** | **Yes** | `Letter` |
| G2 | `app/letters/{appointment,offer,relieving}/page-client.tsx` | direct URL only | **No link exists** | **No** — own jsPDF, hardcoded prose | `LetterRecord` |
| G3 | `lib/workflow/letters.ts` `createLetter` | — | **No importers at all** | n/a (no body) | `LetterRecord` |
| G4 | `lib/workflow/offer-letter.ts` `issueOfferLetter` | "Issue offer letter" button | **Yes** | **No** — body built inline | `Letter` |

### 1.1 Correcting the brief

The brief describes three paths and states that `app/lib/actions/letters.ts` "contains its OWN substitution at ~line 339/346", that it is "a second, competing implementation", and that it "appears to be the path that produced the one pre-existing Letter row dated 2026-09-26".

**All three claims are false, and the correction changes the shape of the problem:**

1. **`app/lib/actions/letters.ts` is 82 lines.** There is no line 339 or 346. It contains **no substitution at all** — no `renderTemplate`, no variable map, no `{{` handling. It is three thin CRUD helpers over `LetterRecord` (`:23` create, `:47` findMany, `:63` findMany).
2. **It is not a competing *generation* implementation.** It has no body to generate. It is the persistence half of G2; the *rendering* half is the hardcoded jsPDF block in each one-off `page-client.tsx`.
3. **It did not produce the 2026-09-26 letter.** It writes to `prisma.letterRecord` (`:23`); `LetterRecord` has **0 rows**. The 2026-09-26 row is in `Letter` (`LTR-UAE-2026-001`), written by G1.

**The real second placeholder engine is in `app/letters/*/page-client.tsx` and `lib/workflow/offer-letter.ts` — and both are in *different files* from where the brief looked.** Each builds its document text with string concatenation and template literals; neither imports `lib/letters/variables.ts`. `lib/letters/variables.ts` has exactly one importer: `app/api/letters/route.ts`.

---

## 2. G1 — `POST /api/letters` (the only live, engine-backed path)

`app/api/letters/route.ts:39-165`

| Step | Line | Behaviour | Assessment |
|---|---|---|---|
| Guard | `:43-46` | `authorizePermission(PERMISSIONS.LETTER_GENERATE)` | Correct — centralized resolver |
| Self-scope | `:57-66` | Falls back to `actor.employeeId` | Correct |
| Cross-employee | `:67-85` | Requires `LETTER_TEMPLATE_MANAGE` | **Dead branch — see §2.1** |
| Template fetch | `:89` | `findUnique({ where: { id: templateId } })` | **No `isActive` check** |
| Reference number | `:104-105` | `count()+1` | **P1 — see data-model audit §4** |
| Substitution | `:114-120` | `buildLetterVariables` + `renderTemplate` | Correct |
| Unresolved report | `:126-134` | `console.warn` | Server-log only |
| Create | `:136-147` | `prisma.letter.create` — **not in a transaction** | Reference race |
| Status | `:145` | `GENERATED` for ADMIN/HR/SUPER_ADMIN, else `PENDING` | **Unsatisfiable — see §2.2** |
| Audit | `:149-158` | `logSecurityEvent` with `SECURITY_ACTION.ACCESS_DENIED` and `outcome: 'SUCCESS'` | **Wrong event type — see §2.3** |

### 2.1 The IDOR guard is unreachable

`app/api/letters/route.ts:69-70` justifies the cross-employee check with:

> `letter.generate` is granted to STAFF, so it cannot be used as the discriminator

**This is factually wrong.** `lib/auth/permissions.ts:162-176` (`STAFF_GRANTS`) contains `LETTER_VIEW` (`:170`) and **not** `LETTER_GENERATE`. `LETTER_GENERATE` appears only in `HR_GRANTS` (`:222`), inherited by `ADMIN` (`:245-248`) and `SUPER_ADMIN` (`:271-275`).

Therefore: every role that passes the `LETTER_GENERATE` gate at `:43` also holds `LETTER_TEMPLATE_MANAGE` (both are in `HR_GRANTS`). The `else if (targetEmployeeId !== actor.employeeId)` branch at `:67` is entered only by roles that have `LETTER_TEMPLATE_MANAGE`, so `hasPermission(actor.role, PERMISSIONS.LETTER_TEMPLATE_MANAGE)` at `:71` is always `true` and the `403` at `:83` **can never fire**.

**Net effect: any HR/ADMIN user can generate a certificate for any employee, by id, with a valid reference number.** That is almost certainly intended for HR. The problem is that the code claims a control it does not have, and the comment names a role grant that does not exist — so the next reader trusts a guard that isn't there. This should be either removed or reimplemented against a real discriminator.

### 2.2 The `PENDING` status is unreachable

`app/api/letters/route.ts:145`:

```ts
status: ['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actor.role) ? 'GENERATED' : 'PENDING',
```

Every role that reaches line 145 has `LETTER_GENERATE`, i.e. is ADMIN, HR or SUPER_ADMIN. The `: 'PENDING'` branch is dead.

Consequences:
- `LettersPageClient.tsx:143-146` has a success toast for `'PENDING'` ("Letter submitted and pending approval") that can never fire.
- `LettersPageClient.tsx:164` has a "Pending HR" badge for `'PENDING'` that can never render.
- `LettersPageClient.tsx:333` labels the button `'Submit Letter Request'` for non-admins — but non-admins cannot reach `POST` at all (`LETTER_GENERATE` is HR+). **STAFF and MANAGER click "Submit Letter Request" and receive a 403.** The `PENDING` half of the two-tier approval design (`LetterRequest` → MANAGER_APPROVED → HR_APPROVED) is entirely absent, and the code that would have implemented it is unreachable.

DB confirms: all 4 `Letter` rows are `GENERATED`.

### 2.3 Successful operations are logged as access denials

`app/api/letters/route.ts:149-158` emits `SECURITY_ACTION.ACCESS_DENIED` with `outcome: 'SUCCESS'`. `lib/workflow/letters.ts:136-143` and `lib/workflow/offer-letter.ts:154-161` do the same. Three of the four letter code paths report successful business operations under a "denied" action label.

Consequence: any security review, SIEM rule or dashboard counting `ACCESS_DENIED` events is counting successful letter generation. Real denials (`route.ts:73-82`) are indistinguishable in the log stream from successes.

---

## 3. G2 — the three one-off pages (unreachable, self-contained)

`app/letters/appointment|offer|relieving/page.tsx` + `page-client.tsx`

**Reachability: proven by grepping the UI, not the action.** Repo-wide search for `letters/appointment`, `letters/offer`, `letters/relieving` in every `.tsx` returns **only** `auth.config.ts:41-43` (edge gate) and each page's own back-link to `/letters`. There is **no** `Link href`, no `<a href>`, no sidebar entry, no search result. The only navigation reference anywhere in `components/` is `Sidebar.tsx:48` → `/letters`.

**These pages are the only writers of `LetterRecord` that are mounted. They have never been used — `LetterRecord` has 0 rows.**

### 3.1 Each one is a complete, independent letter system

`app/letters/appointment/page-client.tsx` (representative; offer and relieving are structurally identical):

| Concern | Central flow (G1) | This page |
|---|---|---|
| Body text | `LetterTemplate.content_en` | Hardcoded template literal, `:99-113` |
| Substitution | `lib/letters/variables.ts` | None — values interpolated directly |
| PDF | `app/lib/utils/letter-generator.ts` | Own `new jsPDF()`, `:59` |
| Letterhead | `"Al Barakah Group"` / Abu Dhabi (hardcoded, `variables.ts:126`, `letter-generator.ts:30-40`) | `getCompanySettings()` → **`"IBMDigiTech LLC"` / Dubai** (`company-settings.ts:18-19`) |
| Colours | indigo (`#4f46e5`) | emerald (`#10b981`, `:62`) |
| Signature | `/assets/signature.png` + stamp | `companySettings.signature` base64, `:121-127` |
| Record | `Letter` with `referenceNumber` | `LetterRecord` with `type` + free-text `details`, `:140-145` |
| Approval | none (unreachable `PENDING`) | none |
| Audit | `logSecurityEvent` | **none** |
| Permission | `authorizePermission(LETTER_GENERATE)` at route level | `requirePagePermission(LETTER_GENERATE)` at page level only |

**The two-companies defect is live.** Verified in the database:

```sql
SELECT module, key, value FROM "ServiceConfig" WHERE module = 'COMPANY';
-- 0 rows
```

`getCompanySettings()` (`app/lib/actions/company-settings.ts:18-25`) falls back to `"IBMDigiTech LLC"`, `"Dubai, UAE"`, `"hr@ibmdigitech.com"`. The central flow hardcodes `"Al Barakah Group"`, `"Industrial City, Abu Dhabi, UAE"`, `"info@albarakah.ae"`. **Neither reads the other's source. The same system emits employment certificates on two different companies' letterheads depending on which URL the operator used.**

### 3.2 The success message is unconditional

`app/letters/appointment/page-client.tsx:145`:

```ts
await saveLetterRecord(fd);          // return value discarded
setLoading(false); setSaved(true);   // shown regardless
```

`saveLetterRecord` returns `{ success: false, message }` on any failure (`actions/letters.ts:36`) and on missing auth (`:10`). None of those are read. The button then renders **"Saved & Downloaded!"** (`:231`) and the checkmark (`:230`). Identical code at `offer/page-client.tsx:141` and `relieving/page-client.tsx:146`.

**Verified against data: `LetterRecord` has 0 rows.** Whatever happens on these pages, the record is not being kept.

---

## 4. G3 — `lib/workflow/letters.ts` is dead code

`lib/workflow/letters.ts` (379 lines) contains the most complete letter workflow in the repository:

- `createLetter` (`:69`) — version chains via `documentKey`, approval routing, optimistic-concurrency guard
- `advanceLetter` (`:172`) — `assertTransition` against `LETTER_TRANSITIONS`, `updateMany` with a status precondition (`:200-215`), audit row, in-app notification
- `bulkGenerateLetters` (`:290`) — per-employee outcome tracking, not-found reconciliation
- `getLetterHistory` (`:262`) — full version chain, gated on `LETTER_VIEW`

**Repo-wide search for importers of `@/lib/workflow/letters`:**

| Search | Result |
|---|---|
| `workflow/letters` in `app/**`, `lib/**`, `components/**` | **0** |
| `createLetter`, `advanceLetter`, `bulkGenerateLetters` | 0 importers outside the file itself |
| `getLetterHistory` (this one) | 0 importers |
| `DEFAULT_APPROVAL_REQUIRED` (`:379`) | **`tests/workflow-p1-modules.test.ts:18` — the only importer in the repository** |

**It is unreachable from every page, route, action and component.** The only thing that imports it is a unit test, and the only thing that test imports is its constant default.

This inverts the finding in `docs/audit/WORKFLOW_AUDIT.md:251-253` (FLOW-018/019/020: *"No approval workflow for offer/appointment letters / No version control / No bulk generation"*). That audit was **correct about the product and has since been overtaken by the code**: approval, versioning and bulk generation were all implemented, into a module that is not mounted. The features are still missing from the product; the report is stale, not wrong.

`app/lib/actions/letters.ts:40 getLetterHistory` is a second, different function of the same name with the same zero callers.

---

## 5. G4 — the offer letter bypasses the template entirely

`lib/workflow/offer-letter.ts`, reached from `OfferActions.tsx:75` → `app/lib/actions/recruitment.ts:254-258`.

| Step | Line | Behaviour |
|---|---|---|
| Guard | `:42` | `requirePermission(PERMISSIONS.RECRUITMENT_OFFER)` |
| Offer lookup | `:44-71` | Full offer + candidate + requisition |
| Idempotency | `:76-84` | Application-level check of `letterRecordId` + `status === APPROVED` |
| **Template resolution** | `:21-34` | `findFirst({ where: { type: "OFFER" } })` → **no match** → falls back to `findFirst({ orderBy: { createdAt: 'asc' } })` |
| **Body** | `:99-118` | **Hardcoded English prose built inline as a string array** |
| Create | `:121-152` | `tx.letter.create` with the resolved `templateId` and the inline body |
| Link | `:137-140` | `offerLetter.update({ letterRecordId, fileUrl: \`/letters/${created.id}\` })` |

**The header comment at `:4-7` claims this module reuses the existing letters engine rather than creating a second one. It does the opposite.** The `LetterTemplate` it resolves at `:86` is used **only** to satisfy the non-nullable `templateId` FK. Its `content_en` is discarded entirely. The offer letter body is a hardcoded string array at `:99-118`, with no placeholders, no `lib/letters/variables.ts`, and no way for HR to change a word of it.

**The fallback is currently silent and wrong.** `type: "OFFER"` matches nothing (the three live templates are `EMPLOYMENT`, `PAYROLL`, `NOC`), so `resolveOfferTemplate()` returns the oldest template — currently the *Employment Certificate*. An issued offer letter is therefore recorded as being based on the Employment Certificate template. `OfferLetter.fileUrl` is set to `/letters/${letterId}` (`:139`) — a route that does not exist. There is no `app/letters/[id]` page (glob of dynamic segments under `app/letters/` returns nothing).

**Nothing can view the result.** `lib/recruitment/offer-queries.ts:137-138` selects the joined `letterRecord` with `content_en` and `content_ar`, and `app/recruitment/offers/LetterPreview.tsx` is a finished 124-line component whose entire purpose is to render exactly that object. **Repo-wide search for `LetterPreview` returns only its own definition — it is imported by nothing.** The offer detail page fetches the letter body and discards it. `OfferActions.tsx:132-136` renders the static sentence *"Offer letter issued through the letters module."* and `OfferCard.tsx:96-99` renders a "Letter issued" badge. **An issued offer letter cannot be viewed, printed or downloaded anywhere in the product.**

---

## 6. The PDF engine

`app/lib/utils/letter-generator.ts` (124 lines) — the only PDF renderer used by the mounted paths.

| Property | Verdict | Evidence |
|---|---|---|
| Single engine for employee letters and offers | **Yes, in name** | Called from `LettersPageClient.tsx:417` and the dead `LetterPreview.tsx:60` |
| Arabic content rendered | **NO** | `content_ar` is destructured at `:15` and **never referenced again in the function**. The PDF is English-only |
| Persisted anywhere | **NO** | `doc.save(...)` at `:123` writes to the browser's downloads folder. `pdfUrl` is **never written anywhere in application code** (repo-wide grep: 0 matches) and is `NULL` on all 4 DB rows |
| Bilingual claim on `/letters` | **Misleading** | `LettersPageClient.tsx:186-189` advertises a "Bilingual Letter Engine"; the viewer modal does render `content_ar` (`:457-462`) but the PDF does not |
| Signed / stamped PDF | Cosmetic | `:78-98` fetches `/assets/signature.png` and `/assets/stamp.png` over HTTP from the browser and embeds them. If either 404s, `catch` at `:96` logs and the PDF is issued **unsigned** with no user-visible warning |
| RTL support | **None** | No `dir`, no Arabic-capable font. `doc.setFont("helvetica", …)` only |
| Content type safety | PASS | Content reaches jsPDF as `doc.text()` — no HTML parsing, so no script injection. React escapes the on-screen render (`LettersPageClient.tsx:456`) |
| A4 layout | Degrades | `doc.text(splitEn, 20, 100)` at `:72` with no pagination check; a long letter overflows the 297 mm page. Only English is rendered so this is latent |

### 6.1 `pdfUrl` is a dead column

`prisma/schema.prisma:1168` declares `pdfUrl String?`. Repo-wide grep for `pdfUrl` in `.ts`/`.tsx`: **0 matches**. Confirmed NULL on all 4 rows. There is no letter-artifact store, and `Attachment` has no `letterId` (see the data-model audit §2.9). **A generated letter exists only as a database row and as a file in the operator's Downloads folder.** When HR issues a salary certificate to an employee and closes the tab, no artifact of it exists in the system.

### 6.2 Can template content inject raw HTML or script?

**No. Verified, and worth stating explicitly because it was asked.**

Three independent reasons, any one of which is sufficient:
1. The on-screen render is React JSX — `LettersPageClient.tsx:456` `{viewingLetter.content_en}` inside a `<div>`. React escapes all interpolated strings; a `<script>` in a template renders as visible text.
2. The PDF path passes content to `doc.text()` (`letter-generator.ts:71-72`). jsPDF does not parse HTML.
3. The API returns `content_en` as JSON (`NextResponse.json(letter)`) and the client stores it in a string-typed field.

The residual risk is **not** script execution, it is **content integrity** — see the template audit §6 on `customFields` overriding built-in variables. Templates are authored by HR/ADMIN via a `LETTER_TEMPLATE_MANAGE` page gate, so template authoring is inside the trust boundary. But `customFields` arrives from an HTTP request body and is interpolated with no restriction, and that is not a script-injection risk — it is a "signed document says something the system of record does not" risk.

---

## 7. A second seed source with a different template vocabulary

`app/api/seed/route.ts:173-211` upserts three `LetterTemplate` rows:

| Seed row | `type` | Placeholder syntax | Upsert key |
|---|---|---|---|
| Salary Certificate | `SALARY_CERTIFICATE` | **dotted** `{{employee.name}}`, `{{salary.total}}` | `id = "salary_certificate"` |
| No Objection Certificate | `NOC` | **dotted** `{{employee.name}}`, `{{employee.emiratesId}}`, **`{{request.purpose}}`** | `id = "no_objection_certificate"` |
| Offer Letter | **`OFFER`** | **dotted** `{{employee.designation}}`, `{{employee.joiningDate}}`, `{{salary.total}}` | `id = "offer_letter"` |

Compare with the three templates actually in the database, which have cuid ids, `types` `EMPLOYMENT`/`PAYROLL`/`NOC`, and **snake_case** placeholders. They were created by the "Seed Defaults" button in the template builder (`app/dashboard/settings/templates/page-client.tsx:119-145`), not by this route.

**Running `/api/seed` would create three additional templates** with a different id scheme, a different `type` vocabulary and different content — and would make two dormant code paths suddenly live:

- `type: "OFFER"` would begin matching at `offer-letter.ts:22`, changing offer-letter behaviour.
- `{{request.purpose}}` would begin resolving, making the "Purpose / Details" field on `/letters` (`LettersPageClient.tsx:130`) functional for the first time.

The substitution itself would still work — the engine now resolves both syntaxes, which is precisely why that fix was the right one. **The duplicate-vocabulary problem is what the dual-syntax support papers over rather than solves.**

The seed route is otherwise well-guarded and is not the concern here: production is a hard stop before any DB access (`:46-56`, `:107-116`), it requires `SUPER_ADMIN` (`:73-84`), and it requires an explicit confirmation parameter against prefetch and stray-GET writes (`:86-89`).

---

## 8. Findings register

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| GEN-01 | **P0** | Four independent generation implementations; one is reachable, one is reachable-but-bypasses-templates, two are unreachable. | §1 |
| GEN-02 | **P0** | `lib/workflow/letters.ts` (379 lines: approval, versioning, bulk, concurrency) is dead — its only importer is a unit test. | §4 |
| GEN-03 | **P0** | Two live letterheads: "Al Barakah Group"/Abu Dhabi vs "IBMDigiTech LLC"/Dubai. `ServiceConfig` COMPANY has 0 rows. | §3.1 |
| GEN-04 | **P1** | An issued offer letter cannot be viewed, printed or downloaded anywhere. `LetterPreview.tsx` is imported by nothing. | §5 |
| GEN-05 | **P1** | `offer-letter.ts` builds the body inline and discards the template it resolved; the module header claims the opposite. | §5 |
| GEN-06 | **P1** | The cross-employee IDOR guard in `POST /api/letters` is unreachable; its justifying comment cites a role grant that does not exist. | §2.1 |
| GEN-07 | **P1** | The `PENDING` status branch is unreachable; the "Submit Letter Request" UI a STAFF sees 403s. | §2.2 |
| GEN-08 | **P1** | The PDF engine never renders `content_ar`; a "Bilingual Letter Engine" produces English-only PDFs. | §6 |
| GEN-09 | **P1** | No letter artifact is persisted. `pdfUrl` is written nowhere and is NULL on all rows. | §6.1 |
| GEN-10 | **P1** | Successful letter operations are logged as `ACCESS_DENIED`. | §2.3 |
| GEN-11 | **P2** | `saveLetterRecord`'s result is discarded; the UI always reports success. `LetterRecord` has 0 rows. | §3.2 |
| GEN-12 | **P2** | `POST /api/letters` does not check `template.isActive`. | §2 |
| GEN-13 | **P2** | `OfferLetter.fileUrl` is set to `/letters/${id}`, a route that does not exist. | §5 |
| GEN-14 | **P2** | A second seed source writes a conflicting template set with a different `type` vocabulary. | §7 |
| GEN-15 | **P2** | PDF is issued unsigned with no user warning if the signature/stamp assets 404. | §6 |
| GEN-16 | **P3** | Long English letters overflow a single A4 page with no pagination. | §6 |
| GEN-17 | **P3** | `getLetterHistory` (`actions/letters.ts:40`) and `getLetterTemplateById` are dead exports. | §4 |

## 9. What I could not verify

- **No PDF was rendered.** The "Arabic is dropped" finding is proven by reading the whole 124-line function and confirming `content_ar` has exactly one occurrence; I did not produce a PDF to inspect visually.
- **No end-to-end run of G1.** I did not authenticate and call `POST /api/letters`. The substitution results quoted in the template audit come from letters that already existed in the database when I started.
- **The three letters created at 2026-09-29 15:18:50 were not created by me** and I cannot attribute them to a specific client or user.
- **I did not exercise `/api/seed`**, so the duplicate-template outcome in §7 is derived from reading the upsert key derivation (`:204`) and the live template ids, not observed.
- **Which of the four `Letter` rows are legitimate test artefacts versus real issued documents** cannot be determined from the database; there is no audit trail on the `Letter` model itself (no `createdBy`).
