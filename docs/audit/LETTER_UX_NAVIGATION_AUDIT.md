# Letter System — UX & Navigation Audit

**Scope:** every letter surface a user can actually reach, and what happens when they get there.
**Date:** 2026-09-29 · **Type:** READ-ONLY

**Method note.** Reachability was established by grepping the **component, route file and UI entry point** — never by grepping the action a page calls. This matters here: `saveLetterRecord` *looks* live (it is a mounted, exported, working server action) and would lead a careless audit to conclude the one-off letter pages are a functioning feature.

Related: [TEMPLATE](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [WORKFLOW MATRIX](./LETTER_WORKFLOW_MATRIX.md) · [INTEGRATION](./LETTER_SYSTEM_INTEGRATION_AUDIT.md) · [SUMMARY](./LETTER_AUDIT_SUMMARY.md)

---

## 1. The navigation map — what a user can reach

| Route | Linked from | Reachable? | Gate |
|---|---|---|---|
| `/letters` | `components/layout/Sidebar.tsx:48` (`LETTER_VIEW`) | **YES** | `app/letters/page.tsx:12` — `auth()` only |
| `/dashboard/settings/templates` | `app/settings/page.tsx:193` (raw `<a>`) | **YES** | `LETTER_TEMPLATE_MANAGE` |
| `/letters/appointment` | **NOTHING** | **NO** | `LETTER_GENERATE` + edge |
| `/letters/offer` | **NOTHING** | **NO** | `LETTER_GENERATE` + edge |
| `/letters/relieving` | **NOTHING** | **NO** | `LETTER_GENERATE` + edge |
| `/api/letters/[id]/approve` | **NOTHING** | route exists, no UI | hardcoded `["ADMIN","HR"]` |
| `/letters/[id]` (offer letter) | linked from `OfferLetter.fileUrl` | **NO — route does not exist** | — |

### 1.1 How the three one-off pages were proven unreachable

Repo-wide search for `letters/appointment`, `letters/offer`, `letters/relieving` across every `.tsx` returns **six** matches, none of which is an inbound link:

```
auth.config.ts:41   { prefix: '/letters/offer',        roles: [...] }   ← edge gate
auth.config.ts:42   { prefix: '/letters/appointment',  roles: [...] }   ← edge gate
auth.config.ts:43   { prefix: '/letters/relieving',    roles: [...] }   ← edge gate
app/letters/offer/page-client.tsx:151         <Link href="/letters">  ← OUTBOUND back-link
app/letters/appointment/page-client.tsx:155  <Link href="/letters">  ← OUTBOUND back-link
app/letters/relieving/page-client.tsx:155    <Link href="/letters">  ← OUTBOUND back-link
```

The only navigation reference to `/letters` anywhere in `components/` is `Sidebar.tsx:48`. There is no submenu, no card on `/letters` linking to them, no search result, and no redirect.

**Corroborating data:** `LetterRecord` — the only table these pages write — has **0 rows**. Whatever else is true, no letter has ever been recorded through them.

**They are three complete, self-contained letter generators that a user can only reach by typing or bookmarking the URL.** They are not a feature. They are the residue of one.

---

## 2. `/letters` — the one real letter surface

`app/letters/page.tsx` (21 lines) → `app/letters/LettersPageClient.tsx` (510 lines).

### 2.1 What works

| Element | Assessment |
|---|---|
| Template gallery (`:230-250`) | Clear. Card, name, type, "Ready for Preview" affordance |
| Document Archive (`:342-382`) | Lists issued letters with reference number, status badge, subject, date. Clickable to the viewer (`:356`) |
| Status badges (`:161-168`) | Colour-coded, readable |
| PDF download (`:414-421`) | Works |
| Empty states (`:216-228`, `:348-352`) | Both present and informative |
| Loading state (`:170-177`) | Present — the page has a `loading.tsx` as well |

### 2.2 Defects the user will hit

| # | Defect | Evidence | Impact |
|---|---|---|---|
| UX-01 | **"Submit Letter Request" 403s for everyone who is offered it** | `:333` — `isAdmin` is `ADMIN \|\| HR` (`:75`), so MANAGER, FINANCE and STAFF all see "Submit Letter Request". `POST /api/letters:43` requires `LETTER_GENERATE` = HR/ADMIN/SUPER_ADMIN. The button label at `:142-146` even has a `'PENDING'` branch that can never fire | A user fills the form, clicks, and gets *"You do not have permission"* from a server action. `toast.error(payload?.error)` at `:138` does surface the message — so it fails *visibly*, which is the only mercy |
| UX-02 | **"Purpose / Details" silently does nothing** | `:288-294` collects it; `:130` sends it as `customFields: { 'request.purpose': … }`; **no shipped template contains `{{request.purpose}}`** (verified against all three `content_en` values in the DB) | A bank-loan NOC is requested with a purpose; the NOC is issued with no purpose on it |
| UX-03 | **"Template Live Preview" shows the raw template** | `:299-314` renders `selectedTemplate.content_en` unmodified, under the heading "Template Live Preview" | The user cannot tell a working placeholder from a typo'd one. This is the exact blind spot that let the placeholder bug ship |
| UX-04 | **"Send via Email" has no handler** | `:501-503` — a `<Button>` with **no `onClick`** | The primary delivery action for an employee-facing document is inert. It looks clickable |
| UX-05 | **"Request Archive" button does nothing** | `:201-207` — `onClick={() => setSelectedTemplate(null)}`. It is labelled "Request Archive" but it only deselects the template panel | Dead control with a misleading label |
| UX-06 | **Letterhead is hardcoded in three places and is fictional** | `:437-443` — "Al Barakah / Group of Companies / Industrial City, Abu Dhabi, UAE / T: +971 2 XXX XXXX / Trade License: TL-100234". Meanwhile `getCompanySettings()` returns **"IBMDigiTech LLC / Dubai"** (unconfigured `ServiceConfig`) | The document an employee hands to a bank carries placeholder contact details |
| UX-07 | **The archive crashes on a candidate letter** | `:369` — `letter.employee.firstName[0]`. `schema.prisma:1152` makes `Letter.employeeId` nullable; the `Letter` interface at `:49` types `employee` as non-nullable. `GET /api/letters` (`:23-30`) includes only `employee` | As soon as `issueOfferLetter` runs, `/letters` throws on the archive list. Currently latent: 0 `Letter` rows have a null `employeeId` |
| UX-08 | **Archive is unfiltered and unpaginated** | `:355-377` renders every letter the API returns; the API returns every letter in the company | An HR user with 500 letters gets a 500-row scroll with no search, filter or page |
| UX-09 | **"Print Document" prints the modal, not an A4 page** | `:422` — `window.print()` | The printed output includes the modal chrome and the surrounding app shell |
| UX-10 | **The viewer promises a QR code and a verification ID that do not exist** | `:483` — `ID: {id.slice(0,8)} - VERIFIED`; `:489-493` — a `<Badge>` that says "QR Code"; `:501-503` — "Send via Email" | Three affordances of authenticity, none functional. This is the pattern that erodes trust in a document an employee is supposed to rely on |
| UX-11 | **No `isActive` indicator anywhere** | The template gallery (`:231-249`) shows all templates from `GET /api/templates`, which *does* filter `isActive: true` — so inactive templates silently disappear with no explanation | An operator concludes a template was deleted |
| UX-12 | **Arabic tab is present but empty** | `:311` — `selectedTemplate.content_ar \|\| "No Arabic translation available…"`. Only 1 of 3 templates has any `content_ar` at all, and that one is an empty string | The "Bilingual Letter Engine" badge (`:186-189`) is accurate for the screen and false for the PDF |
| UX-13 | **No mobile card view** | `:230-250` uses `grid-cols-1 md:grid-cols-2`; `:355-377` is a flex row per letter with no `flex-col` fallback | Corroborates `PRODUCTION_READINESS_CHECKLIST.md:166` (item 8.2) |

### 2.3 What the template editor gets wrong

`app/dashboard/settings/templates/page-client.tsx`

| # | Defect | Evidence |
|---|---|---|
| UX-14 | **The available-variable hint lists 4 of 20** | `:246` — `{{company_name}}, {{employee_name}}, {{designation}}, {{basic_salary}}, etc.` vs the 20 names at `variables.ts:161-179` |
| UX-15 | **No preview at all** | The editor (`:220-266`) is two textareas and two inputs. Nothing renders the result |
| UX-16 | **"Seed Defaults" duplicates the shipped templates on every click** | `:119-145` — the button is shown only when `templates.length === 0` (`:155`), but `handleSeed` calls `createLetterTemplate` unconditionally. If run twice, it creates six templates with no de-duplication |
| UX-17 | **Delete failure reason is discarded** | `:113-114` — `res.error` is captured and then not shown. The user sees "Failed to delete" when the real cause is "3 letters already use this template" |
| UX-18 | **No `isActive` control** | `LetterTemplateData.isActive` exists (`letter-templates.ts:11`) and is never surfaced. Templates can only be deleted, never retired |
| UX-19 | **Link from `/settings` is a raw `<a>`** | `app/settings/page.tsx:193` — full page reload, no client navigation, no loading state |

---

## 3. `/letters/appointment|offer|relieving` — unreachable, and inconsistent besides

Even for a user who knows the URL:

| # | Defect | Evidence |
|---|---|---|
| UX-20 | **Success is reported unconditionally** | `appointment/page-client.tsx:145` — `await saveLetterRecord(fd)` with the result discarded; `:231` then renders "Saved & Downloaded!". Identical at `offer:141` and `relieving:146` |
| UX-21 | **The preview is a fake** | `:236-260` renders a grey skeleton of rectangles with a percentage-derived width (`:249-251`) — a decorative placeholder, not a preview |
| UX-22 | **Different company, different city, different accent colour** | `:27-36` — `"IBMDigiTech LLC"`, `"Dubai, UAE"`, emerald. The central flow is "Al Barakah Group", Abu Dhabi, indigo |
| UX-23 | **No reference number, no status, no approval** | `saveLetterRecord` writes `type` + free-text `details` (`actions/letters.ts:23-30`). Nothing in this flow is traceable or approvable |
| UX-24 | **Offer page issues an "offer letter" to an existing employee** | `offer/page-client.tsx:39` — the dropdown is populated by `getEmployeesForLetter()` (`actions/letters.ts:63-77`, `isActive: true`). An offer letter is for a candidate, not an employee. The genuine offer flow is `OfferActions.tsx:75`, on the `Letter` model |
| UX-25 | **Relieving letter is not connected to any exit case** | `relieving/page-client.tsx:211-216` — a reason dropdown; `:145` — `details: "Last Working Day: …, Reason: …"`. `lib/workflow/offboarding.ts` is never invoked |

---

## 4. Offer letters — issued but invisible

`app/recruitment/offers/OfferActions.tsx:132-136` renders, once a letter exists:

> **Offer letter issued through the letters module.**

That is the entire UI. There is no link, no preview, no download.

| # | Defect | Evidence |
|---|---|---|
| UX-26 | **The component built to show it is unmounted** | `app/recruitment/offers/LetterPreview.tsx` — 124 lines, imports `generateLetterPDF` (`:7`), takes exactly the object `lib/recruitment/offer-queries.ts:137-138` selects. **Imported by nothing.** The data is fetched and thrown away |
| UX-27 | **"No letter yet" / "Letter issued" is the only affordance** | `OfferCard.tsx:96-103` |
| UX-28 | **The stored link 404s** | `offer-letter.ts:139` sets `fileUrl: /letters/${id}`. There is no `app/letters/[id]` route |

**The user journey is: approve an offer → click "Issue offer letter" → see a green success toast → have no way to see, print, send or download the document that was just created.**

---

## 5. What the user can never find

| Thing | Status |
|---|---|
| A letter's version history | No UI. `getLetterHistory` exists twice, both with zero callers |
| A letter awaiting approval | No queue, no tab, no notification |
| A letter's audit trail | No UI; the live path writes no `AuditLog` row |
| Which template a letter came from | The archive shows `letter.template.name` (`:360`) but not a link to it |
| Bulk generation | No UI; the implementation is unmounted |
| Their own letters | No employee-facing list anywhere in the application |
| Any notification that a letter exists | `POST /api/letters` sends none |
| Letter search | `search/route.ts:1034` searches `LetterRecord` (0 rows), never `Letter` (4 rows) |

---

## 6. Where the search integration fails

`app/api/search/route.ts` is, in its letter parts, the best-implemented thing in this subsystem — and it still returns nothing:

| Domain | Query | Rows | User sees |
|---|---|---|---|
| `searchLetterRecords` (`:1028-1063`) | `prisma.letterRecord.findMany` | **0** | Nothing. Ever. |
| `searchLetterTemplates` (`:1065-1089`) | `prisma.letterTemplate.findMany` | 3 | Templates — correctly gated on `LETTER_TEMPLATE_MANAGE` (`:1066`) |
| *(absent)* | `prisma.letter.findMany` | **4** | — nothing searches these |

**A user who searches for "NOC" sees the NOC *template* but not the NOC they issued last week.**

The scoping in `searchLetterRecords` (`:1036` `scopeEmployeeWhere`, and the deliberate omission of `details` at `:1032-1033`, because "a generated letter's body text routinely states a salary") is exactly right — and it is applied to a table that will never have a row.

*Note: `app/api/search/route.ts` is being edited concurrently by another agent. This section describes the state as read on 2026-09-29 and may have changed.*

---

## 7. Findings register

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| UX-01 | **P0** | Three unlinked, fully-functional-looking letter pages are the only writers of `LetterRecord`, which has 0 rows. The "duplicated letter workflows" the brief refers to are **unreachable code**, not a shipped feature. | §1.1 |
| UX-02 | **P1** | "Send via Email" — the primary delivery mechanism for an employee-facing document — has no `onClick`. | `:501-503` |
| UX-03 | **P1** | "Template Live Preview" shows the raw template; the placeholder-blind-spot that shipped the substitution bug is still in the product. | `:299-314` |
| UX-04 | **P1** | An issued offer letter cannot be viewed, printed or downloaded. `LetterPreview.tsx` is unmounted. | §4 |
| UX-05 | **P1** | "Purpose / Details" is a no-op against every shipped template. | `:130` vs DB |
| UX-06 | **P1** | "Submit Letter Request" is offered to roles that receive a 403. | `:333` vs `route.ts:43` |
| UX-07 | **P1** | Hardcoded fictional letterhead ("TL-100234", "XXX XXXX") contradicts the configured company identity. | `:437-443` |
| UX-08 | **P2** | The archive crashes on any letter with a null `employeeId` — i.e. the moment offer letters exist. | `:369` |
| UX-09 | **P2** | Three affordances of authenticity — a "QR Code" badge, a "VERIFIED" ID, "Send via Email" — none of which functions. | `:483,489-503` |
| UX-10 | **P2** | "Request Archive" button is labelled for an action it does not perform. | `:201-207` |
| UX-11 | **P2** | "Saved & Downloaded!" is shown regardless of whether the save succeeded. | `appointment:145,231` |
| UX-12 | **P2** | "Seed Defaults" has no de-duplication and is only hidden when the list is empty. | `:119-145,155` |
| UX-13 | **P2** | Delete failure reason discarded. | `:113-114` |
| UX-14 | **P3** | Variable hint lists 4 of 20. | `:246` |
| UX-15 | **P3** | No preview in the template editor at all. | `:220-266` |
| UX-16 | **P3** | No `isActive` control; retiring a template means deleting it. | §2.3 |
| UX-17 | **P3** | Global search returns no letters. | §6 |
| UX-18 | **P3** | No mobile card view for the archive. Corroborates `PRODUCTION_READINESS_CHECKLIST.md:166`. | `:355-377` |
| UX-19 | **P3** | "Print Document" prints the app shell, not an A4 page. | `:422` |
| UX-20 | **P3** | `/settings` → templates uses a raw `<a>`. | `app/settings/page.tsx:193` |
| UX-21 | **P3** | The one-off "Document Preview" is a decorative skeleton, not a preview. | `appointment:236-260` |

## 8. What I could not verify

- **I did not click through the UI.** Every reachability claim is from grepping components, route files and entry points, plus the DB row count of 0 for `LetterRecord` as corroboration.
- **I could not determine whether anyone has ever bookmarked the three one-off URLs.** Zero `LetterRecord` rows is strong evidence the flow has not completed, but a user could have reached a page and left without generating.
- **Screen-reader and keyboard behaviour was not tested.** The "Expand letter" control in `LetterPreview.tsx:81-83` is a `Download` icon with `aria-label="Expand letter"` on a component that is unmounted; no other letter control was evaluated for accessibility beyond reading the markup.
- **Visual appearance was not assessed** — no browser was used. Layout defects are inferred from class names only.
- **`app/recruitment/**` and `app/api/search/route.ts` are under concurrent edit by other agents.** Findings in §4 and §6 describe the state as read and may be stale by the time you read them.
