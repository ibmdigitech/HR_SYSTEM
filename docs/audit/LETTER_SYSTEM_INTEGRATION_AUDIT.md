# Letter System — Integration Audit

**Scope:** how the letter subsystem connects to the rest of the HRMS — recruitment, approvals, notifications, audit, search, RBAC, company settings, documents.
**Date:** 2026-09-29 · **Type:** READ-ONLY

Related: [TEMPLATE](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [DATA MODEL](./LETTER_DATA_MODEL_AUDIT.md) · [DUPLICATION](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md) · [WORKFLOW MATRIX](./LETTER_WORKFLOW_MATRIX.md) · [SUMMARY](./LETTER_AUDIT_SUMMARY.md)

---

## 1. Integration map

```
                    ┌──────────────────────────────────────────┐
   Sidebar.tsx:48   │  /letters  (LettersPageClient)            │
   LETTER_VIEW  ───▶│    ├─ GET  /api/templates   ─┐            │
                    │    ├─ GET  /api/letters     │            │
                    │    └─ POST /api/letters  ────┼──▶ lib/     │
                    │             │                │   letters/  │
                    │             │                │   variables │
                    │             ▼                │      .ts    │
                    │        ┌────────┐            │            │
                    │        │ Letter │◀───────────┘            │
                    │        └────────┘                         │
                    └──────────────────────────────────────────┘
                              │                    │
              ┌───────────────┘                    └──────────────┐
              ▼                                                ▼
   ┌──────────────────────┐                        ┌────────────────────────┐
   │ RECRUITMENT          │                        │ /letters/appointment  │
   │ OfferActions:75      │                        │  /letters/offer       │  ← NO LINK
   │  → actions/          │                        │  /letters/relieving   │
   │    recruitment:254   │                        │    own jsPDF ×3        │
   │  → workflow/         │                        │    → actions/letters   │
   │    offer-letter:36   │                        │      → LetterRecord   │
   │  → tx.letter.create  │                        └────────────────────────┘
   │  (body built inline) │
   │  → LetterPreview ✗   │   DEAD CODE (no importers)
   └──────────────────────┘   ┌──────────────────────────────────────────┐
                              │ lib/workflow/letters.ts (379 lines)      │
   ┌──────────────────────┐   │  createLetter / advanceLetter /         │
   │ /dashboard/approvals │   │  bulkGenerateLetters / getLetterHistory  │
   │  leaveRequest:58     │   │  → prisma.letterRecord                  │
   │  serviceRequest:68   │   └──────────────────────────────────────────┘
   │  visaRequest:78      │
   │  ✗ no letter query   │        ┌──────────────────────────────────┐
   └──────────────────────┘        │ /api/search/route.ts              │
                                   │  :1034 → LetterRecord (0 rows)   │
   ┌──────────────────────┐        │  :1068 → LetterTemplate           │
   │ DashboardLetter ✗    │        │  ✗ no Letter domain (4 rows)     │
   └──────────────────────┘        └──────────────────────────────────┘
```

---

## 2. Integration status by module

| # | Module | Marker | Direction | Evidence |
|---|---|---|---|---|
| I-01 | Sidebar navigation | **PASS** | Sidebar → `/letters` | `components/layout/Sidebar.tsx:48`, `permission: PERMISSIONS.LETTER_VIEW` |
| I-02 | Settings navigation | **PARTIAL** | `/settings` → `/dashboard/settings/templates` | `app/settings/page.tsx:193` — raw `<a href>`, not `<Link>` |
| I-03 | Global search → letters | **BROKEN** | search → letters | `search/route.ts:1034` queries `LetterRecord` (**0 rows**). No domain queries `Letter` (**4 rows**) |
| I-04 | Global search → templates | **PASS** | search → templates | `search/route.ts:1068`; correctly gated, never selects template body |
| I-05 | Approvals queue → letters | **MISSING** | letters → approvals | `app/dashboard/approvals/page.tsx:58,68,78` — three models, no letters. `totalPending:85` omits them |
| I-06 | Approvals queue → `LetterRecord` approvals | **MISSING** | `LetterRecord.status='PENDING_APPROVAL'` → queue | No query anywhere. 0 rows |
| I-07 | Approvals queue → `LetterRequest` | **MISSING** | letters → approvals | No code reads `LetterRequest`. 0 rows. Confirms `APPROVAL_CONNECTIVITY_AUDIT.md:102` |
| I-08 | Dashboard → letters | **MISSING** | letters → dashboard | `auth.config.ts:40` gates `/dashboard/letters`, which **does not exist**. No dashboard widget queries any letter table |
| I-09 | Recruitment offers → letters | **PASS (write)** | recruitment → letters | `OfferActions.tsx:75` → `actions/recruitment.ts:254` → `offer-letter.ts:36` |
| I-10 | Recruitment offers → letter **view** | **MISSING** | letters → recruitment | `LetterPreview.tsx` imported by nothing; `offer-queries.ts:137` fetches the content and discards it |
| I-11 | `OfferLetter` ↔ `Letter` FK | **PARTIAL** | schema link only | `schema.prisma:1462-1463`; enforced in application code at `offer-letter.ts:76`, not by the DB |
| I-12 | Exit / offboarding → relieving letter | **MISSING** | letters → exit | `lib/workflow/offboarding.ts` does not create a letter. `/letters/relieving` is a standalone form with no link to any exit case, and `lastDayFormatted` is typed by hand into free-text `details` |
| I-13 | Onboarding → appointment letter | **MISSING** | letters → onboarding | `lib/workflow/onboarding.ts` / `joining.ts` do not create a letter. `/letters/appointment` is standalone |
| I-14 | Company settings → letterhead | **PARTIAL** | settings → letters | `getCompanySettings()` is read by the three one-off pages only. The central flow hardcodes `"Al Barakah Group"` (`variables.ts:126`). **`ServiceConfig` module `COMPANY` has 0 rows**, so every caller gets `"IBMDigiTech LLC"` |
| I-15 | RBAC resolver → letters | **PASS** | RBAC → letters | `authorizePermission` / `requirePagePermission` used on the live path; the bypasses are itemised in the security audit |
| I-16 | Audit log → letters | **PARTIAL** | letters → audit | Dead path writes `AuditLog` correctly (`workflow/letters.ts:121,217`). Live path writes only `logSecurityEvent` (`route.ts:149`), mislabelled as `ACCESS_DENIED` |
| I-17 | In-app notifications → letters | **MISSING in product** | letters → notifications | `notifyInApp` is called at `workflow/letters.ts:146,239` and `offer-letter.ts` (imported but the call site is unreachable in the dead module). The live `POST /api/letters` sends **no notification** to anyone |
| I-18 | Employee self-service → own letters | **MISSING** | letters → employee | `GET /api/letters?employeeId=` is unscoped by default. No employee-facing list. A letter exists in the employee's hands only as a file HR downloaded |
| I-19 | Documents (`Attachment`) → letters | **MISSING** | — | `Attachment` has no `letterId`. 0 rows |
| I-20 | Seed / bootstrap → templates | **DUPLICATED** | — | `templates/page-client.tsx:119` (snake_case) vs `api/seed/route.ts:173` (dotted, different ids, different `type` vocabulary) |

---

## 3. The four integration defects worth naming

### 3.1 Search indexes the empty table

`app/api/search/route.ts:1028-1063` builds a `LetterRecord` domain with careful scoping (`scopeEmployeeWhere` at `:1036`, `details` deliberately never selected at `:1032-1033`). The reasoning is sound and the implementation is good.

**It searches a table with 0 rows.** The 4 letters that actually exist are in `Letter`, and no search domain queries `Letter`. The search feature for letters is fully built, correctly authorised, and returns nothing — forever, unless someone starts using the three unlinked one-off pages.

The same route's *template* domain (`:1068`) works and returns results. So a user searching "NOC" sees a template but not the NOC they issued last week.

### 3.2 The approval queue has no letter tab

`app/dashboard/approvals/page.tsx` fetches `leaveRequest` (`:58`), `serviceRequest` (`:68`) and `visaRequest` (`:78`), renders three `TabsTrigger`s (`:166,173,181`), and computes `totalPending` from exactly those three (`:85`).

There is no fourth query, no fourth tab, and no letter count in the stat row. `APPROVAL_CONNECTIVITY_AUDIT.md:102` recorded this as `"Letters | LetterApproval | no | no"`; **re-verified at the mount level and confirmed.** The prior report is accurate and still current.

Consequence: if the `LetterRecord` approval workflow were mounted as-is (`workflow/letters.ts:69,172`), letters awaiting approval would be **invisible to every approver in the system** — there is no queue, no notification path for approvers (`notifyInApp` at `:146` notifies the *employee*, not the approver), and no dashboard entry. **Mounting the dead code without adding the queue would not add an approval workflow; it would add an invisible one.**

### 3.3 The lifecycle hooks are absent

| Lifecycle event | Letter that should exist | Currently |
|---|---|---|
| Offer approved | Offer letter | **Automated** — `offer-letter.ts:36` (the one working integration) |
| Offer accepted → joining | Appointment letter | **Manual**, via an unlinked URL |
| Resignation / termination | Relieving letter + service certificate | **Manual**, via an unlinked URL, with no link to the exit case |
| Salary change | Revised salary certificate | **Nothing.** No versioning is reachable (V-01) |

`lib/workflow/offboarding.ts`, `lib/workflow/onboarding.ts` and `lib/workflow/joining.ts` contain no letter references (repo-wide grep). Every letter in this HRMS except the offer letter is produced by a human navigating to a URL that nothing links to, filling in a form that is disconnected from the record it describes, and clicking a button that reports success unconditionally.

### 3.4 The employee never receives anything

The generated letter is written to the database and, if the operator clicks Download, to the operator's Downloads folder. Then:

- "Send via Email" — `LettersPageClient.tsx:501-503` — **a `Button` with no `onClick`**. A dead control that looks functional.
- `POST /api/letters` sends **no notification** to the employee and **no notification to an approver**.
- The dead workflow module *would* notify the employee (`workflow/letters.ts:146-155`), but it is unreachable.
- There is no employee-facing letter list anywhere in the application.

---

## 4. Cross-module contract violations

| # | Contract | Violation | Evidence |
|---|---|---|---|
| X-01 | `LetterTemplate.type` is a shared vocabulary | It is unconstrained free text, matched by equality in two unrelated modules | `schema.prisma:1137`; `offer-letter.ts:22`; `workflow/letters.ts:30` |
| X-02 | Letters are issued from a template | The offer path issues a letter from an inline string, recording a template it never used | `offer-letter.ts:99-118` vs `:86` |
| X-03 | Security events describe what happened | Successful generation is logged as `ACCESS_DENIED` | `route.ts:150`; `workflow/letters.ts:137,230`; `offer-letter.ts:155` |
| X-04 | `OfferLetter.fileUrl` points somewhere | It is set to `/letters/${id}`, which is not a route | `offer-letter.ts:139`; glob of dynamic segments under `app/letters/` → none |
| X-05 | `Letter.pdfUrl` points somewhere | It is written nowhere and is NULL on every row | 0 repo-wide writes; DB |
| X-06 | Company identity is a single source | Two hardcoded identities; neither reads the other | `variables.ts:126` vs `company-settings.ts:18`; `ServiceConfig` 0 rows |
| X-07 | Disabled templates are not usable | `isActive` is never written and never checked on the generation path | `letter-templates.ts:11`; `route.ts:89` |
| X-08 | Edge rules describe real routes | `/dashboard/letters` is gated but does not exist; `/dashboard/settings/templates` is not gated at the edge | `auth.config.ts:40`; no `app/dashboard/letters` |

---

## 5. Findings register

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| INT-01 | **P0** | Letters are absent from the central approval queue; mounting the dead workflow would create an invisible approval path. | §3.2 |
| INT-02 | **P1** | Global search indexes `LetterRecord` (0 rows) and never `Letter` (4 rows). | §3.1 |
| INT-03 | **P1** | No lifecycle hook produces a relieving, appointment or service letter. | §3.3 |
| INT-04 | **P1** | The employee is never notified and has no letter list. "Send via Email" is a button with no handler. | §3.4 |
| INT-05 | **P1** | Two hardcoded company identities; `ServiceConfig` COMPANY is unconfigured. | I-14 |
| INT-06 | **P1** | An issued offer letter is not viewable anywhere; the component that renders it is unmounted. | I-10 |
| INT-07 | **P2** | `auth.config.ts:40` gates a non-existent route; the templates page has no edge rule. | X-08 |
| INT-08 | **P2** | `pdfUrl` and `OfferLetter.fileUrl` both point at nothing. | X-04, X-05 |
| INT-09 | **P2** | Two template seed sources with divergent content, ids and `type` vocabulary. | I-20 |
| INT-10 | **P2** | Successful letter operations are logged under a denial event type. | X-03 |
| INT-11 | **P3** | `/settings` → templates uses a raw `<a>` instead of `<Link>`. | I-02 |
| INT-12 | **P3** | No dashboard surface for letters of any kind. | I-08 |

## 6. What I could not verify

- **I did not exercise the search route or the approvals page at runtime.** Both conclusions are from reading the queries and the JSX, plus the DB row counts that make the search finding conclusive (0 vs 4).
- **I did not verify whether `lib/workflow/offboarding.ts`, `onboarding.ts` or `joining.ts` *intend* to create letters.** The grep proves they do not; the absence of any comment or TODO saying they should is a weaker signal than a positive one.
- **I did not test whether the "Send via Email" button was ever wired.** It has no `onClick` in the current source; whether it previously had one is not in the repository.
- **`lib/workflow/notifications.ts` `notifyInApp` semantics were not audited** — I only confirmed which letter call sites invoke it and which are unreachable.
