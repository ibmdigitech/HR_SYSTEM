# Letter Template System Audit

**Scope:** `LetterTemplate` authoring, storage, rendering and the placeholder engine.
**Date:** 2026-09-29 · **Type:** READ-ONLY · **Codebase:** `HR_SYSTEM-git-check` @ repo root
**Method:** static trace + `information_schema`/`pg_catalog` read-only queries against `postgresql://hr_app@localhost:5433/hr_system` + `npx tsc --noEmit` + `npx vitest run tests/letter-variables.test.ts`.

**Nothing was fixed.** No application code, no schema, no data was modified.

Related documents:
- [LETTER_GENERATION_SYSTEM_AUDIT.md](./LETTER_GENERATION_SYSTEM_AUDIT.md) — the generation path and the PDF engine
- [LETTER_TEMPLATE_DUPLICATION_AUDIT.md](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md) — section 17 duplication table
- [LETTER_DATA_MODEL_AUDIT.md](./LETTER_DATA_MODEL_AUDIT.md) — schema verification
- [LETTER_SECURITY_AUDIT.md](./LETTER_SECURITY_AUDIT.md) — authz / data exposure
- [LETTER_UX_NAVIGATION_AUDIT.md](./LETTER_UX_NAVIGATION_AUDIT.md) — reachability of every letter surface
- [LETTER_SYSTEM_INTEGRATION_AUDIT.md](./LETTER_SYSTEM_INTEGRATION_AUDIT.md) — cross-module wiring
- [LETTER_WORKFLOW_MATRIX.md](./LETTER_WORKFLOW_MATRIX.md) — PASS / PARTIAL / BROKEN / MISSING / DUPLICATED
- [LETTER_SYSTEM_RECOMMENDATIONS.md](./LETTER_SYSTEM_RECOMMENDATIONS.md) — P0–P3
- [LETTER_AUDIT_SUMMARY.md](./LETTER_AUDIT_SUMMARY.md) — the 15 questions

---

## 1. What was audited

The template *authoring* path (`/dashboard/settings/templates`), the template *storage* (`LetterTemplate` model), the template *consumption* path (`GET /api/templates` → `/letters` → `POST /api/letters`), and the variable-resolution engine (`lib/letters/variables.ts`).

Explicitly **out of scope** here and covered elsewhere: the three one-off PDF pages (`/letters/appointment|offer|relieving`) — see the UX/navigation and duplication audits; the `LetterRecord` workflow engine — see the generation audit.

---

## 2. Complete inventory — templates

| # | Path | Kind | Gate | Mounted? |
|---|---|---|---|---|
| T1 | `app/dashboard/settings/templates/page.tsx:9` | page | `requirePagePermission(PERMISSIONS.LETTER_TEMPLATE_MANAGE)` | Yes — linked from `app/settings/page.tsx:193` |
| T2 | `app/dashboard/settings/templates/page-client.tsx` | client component | — | Yes, `page.tsx:10` |
| T3 | `app/lib/actions/letter-templates.ts:14` `getLetterTemplates` | server action | **none** | Yes, `page-client.tsx:9,35` |
| T4 | `app/lib/actions/letter-templates.ts:25` `getLetterTemplateById` | server action | **none** | **Zero callers** |
| T5 | `app/lib/actions/letter-templates.ts:37` `createLetterTemplate` | server action | `requireAnyPermission([PERMISSIONS.ATTENDANCE_SHIFT_MANAGE])` | Yes, `page-client.tsx:90,140` |
| T6 | `app/lib/actions/letter-templates.ts:56` `updateLetterTemplate` | server action | same wrong gate | Yes, `page-client.tsx:82` |
| T7 | `app/lib/actions/letter-templates.ts:72` `deleteLetterTemplate` | server action | same wrong gate | Yes, `page-client.tsx:106` |
| T8 | `app/api/templates/route.ts:5` `GET` | REST | `auth()` only — no capability check | Yes, `app/letters/LettersPageClient.tsx:85` |
| T9 | `app/api/templates/route.ts:23` `POST` | REST | `role !== 'ADMIN'` string compare | **Zero callers** |
| T10 | `lib/letters/variables.ts` | engine | n/a | Yes, `app/api/letters/route.ts:7-11` — **and nowhere else** |
| T11 | `app/api/search/route.ts:1065` `searchLetterTemplates` | search domain | mirrors `LETTER_TEMPLATE_MANAGE` | Yes |
| T12 | `hr-system/**` (12 letter files) | archived duplicate tree | n/a — excluded from `tsconfig.json:33` | **Not built** |

---

## 3. The `LetterTemplate` model — verified field by field

Read from `prisma/schema.prisma:1134-1145`:

```prisma
model LetterTemplate {
  id         String   @id @default(cuid())
  name       String
  type       String
  content_en String
  content_ar String?
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  letters    Letter[]
  requests   LetterRequest[]
}
```

Confirmed absences (each proven by reading the full model block plus a repository-wide search, not by inference):

| Claim | Verdict | Evidence |
|---|---|---|
| No `version` field | **CONFIRMED** | Block ends at line 1145; `updateLetterTemplate` (`letter-templates.ts:60-65`) writes `content_en` in place |
| No letterhead / branding | **CONFIRMED** | Brand text is hardcoded in `lib/letters/variables.ts:126-127` and duplicated in `letter-generator.ts:30-46` |
| No HTML/JSON body | **CONFIRMED** | Only two `String` columns |
| No company/branch scoping | **CONFIRMED** | No `companyId`; DB has one company context anyway |
| No creator/author | **CONFIRMED** | No `createdBy`; `createdAt` only |
| `isActive` is a Boolean, not a state machine | **CONFIRMED** | Line 1140 |
| `type` is unconstrained `String` | **CONFIRMED** | Line 1137. UI offers 7 values (`page-client.tsx:231-237`); the action accepts any string (`letter-templates.ts:44`) |
| No index on `type` or `isActive` | **CONFIRMED** | `pg_indexes` for `LetterTemplate` returns only `LetterTemplate_pkey` |

### 3.1 `type` is a free-text field with no referential integrity

The three live rows carry `type` values `EMPLOYMENT`, `PAYROLL`, `NOC`. Nothing in the database constrains the set. This matters because **two other modules match on `type` by string equality**:

- `lib/workflow/offer-letter.ts:22-27` — `prisma.letterTemplate.findFirst({ where: { type: "OFFER" } })`. No row matches (verified: DB has no `OFFER` template), so it silently falls through to `offer-letter.ts:29-32` and issues a *recruitment offer letter rendered with the first template by `createdAt` asc* — currently the Employment Certificate.
- `lib/workflow/letters.ts:30` — `DEFAULT_APPROVAL_REQUIRED = ["OFFER","APPOINTMENT","RELIEVING","NOC","SALARY_CERTIFICATE"]`. Only `NOC` matches a live template type. `EMPLOYMENT` and `PAYROLL` would **not** require approval even if that engine were mounted.

**This is the single most consequential data-model gap in the template layer:** a letter's approval requirement is decided by matching a free-text column against two independent hardcoded lists, with no constraint and no shared vocabulary.

### 3.2 Live template data

```sql
SELECT id, name, type, "isActive", length("content_en"), length("content_ar") FROM "LetterTemplate";
```

| id | name | type | isActive | len_en | len_ar |
|---|---|---|---|---|---|
| `cmuhzr1ko000yva04lkwnpcmv` | Standard Employment Certificate | EMPLOYMENT | t | 396 | NULL |
| `cmuhzr1mg000zva04r5i4sm64` | Salary Certificate | PAYROLL | t | 366 | `''` (empty string) |
| `cmuhzr1nr0010va0433jo7ix2` | Travel NOC | NOC | t | 241 | NULL |

`Salary Certificate` has `content_ar = ''` (empty string, not NULL). `app/api/letters/route.ts:120` tests `template.content_ar ? … : null`, and `''` is falsy, so the field is written as `NULL`. Behaviour is correct, but the editor (`page-client.tsx:52`) round-trips `''` to an empty textarea, so an HR user cannot tell "no Arabic translation" from "Arabic translation deliberately blank".

---

## 4. The placeholder engine — verification of the fix

### 4.1 The prior defect is real, and I confirmed it from stored data

`lib/letters/variables.ts:1-34` documents that the API's variable map was keyed `employee.name` while every stored template wrote `{{employee_name}}`. **Independent proof from the database**, letter `LTR-UAE-2026-001` (created 2026-09-26, before the fix):

```
This is to certify that Admin User (Employee ID: {{employee_id}}) is currently employed
with Al Barakah Group in the capacity of {{designation}} within the {{department}} department,
effective from .{{joining_date}}.
```

`{{employee_name}}` and `{{company_name}}` resolved; `{{employee_id}}`, `{{designation}}`, `{{department}}`, `{{joining_date}}` did **not**. So the old map was partially snake_case, not the "ZERO overlap" the header comment claims. **Correcting the brief:** the failure was partial, not total — two of six placeholders fired. The silent-success character of the bug stands.

### 4.2 The current fix is correct and complete

Verified by execution against the live database.

`LTR-UAE-2026-002` (Travel NOC) and `LTR-UAE-2026-003` (Employment Certificate), both created 2026-09-29 15:18:50:

```
{{company_name}}      → Al Barakah Group
{{employee_name}}     → Admin User
{{passport_number}}   → —                      (em-dash fallback; see 4.4)
{{basic_salary}}      → 2500
{{allowances}}        → 2000
{{gross_salary}}      → 5000
{{employee_id}}       → ADM-001
{{designation}}       → System Administrator
{{department}}        → IT
{{joining_date}}      → 25 Sept 2026
```

Every placeholder in all three shipped templates now resolves. `npx vitest run tests/letter-variables.test.ts` → **30 passed**. `npx tsc --noEmit` → **clean**.

### 4.3 Mechanic review

| Property | Verdict | Evidence |
|---|---|---|
| Both syntaxes resolve | PASS | `buildLetterVariables` merges dotted keys (`variables.ts:137-156`) and template names (`:161-179`), then `withAliases` (`:190-211`) derives snake_case from every dotted key |
| New dotted keys cannot be added without an alias | PASS | Alias derivation is mechanical, `:196-201` |
| Explicit keys are not clobbered by aliases | PASS | `if (out[alias] === undefined)` guard, `:200` |
| Unknown placeholders stay visible | PASS | `renderTemplate` returns `match` when `variables[key] === undefined`, `:222-225` |
| Regex injection fixed | PASS | Literal key matching via a single `PLACEHOLDER` regex with a capture group (`:37`, `:222`). The previous `new RegExp(\`{{${key}}}\`)` would have treated `.` as a wildcard; the module documents this at `:213-220` |
| Whitespace tolerance | PASS | `/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g` |
| Null dates do not print 1970 | PASS | `formatDate` guards, `:87-96`; documented `:83-86` |
| Unresolved placeholders are surfaced | **PARTIAL** | `unresolvedPlaceholders` is computed and `console.warn`ed at `app/api/letters/route.ts:126-134` — **server console only**. No UI, no `Letter` column, no `AuditLog` entry, no HTTP signal. The original bug was invisible; the new detector is also invisible to the operator |
| Preview and final render use the same code | **NO — see §5** | |
| `customFields` cannot be distinguished from real data | **NO — see §6** | |

### 4.4 Silent `—` on a signed legal document

`or()` (`variables.ts:98-101`) renders any absent value as `—`. Because the *key* resolves, `unresolvedPlaceholders` does not fire. The generated Travel NOC reads:

> Al Barakah Group has no objection to our employee Admin User, holding Passport No. **—**, travelling…

`passportNumber` is empty for all three seeded employees (verified). The engine is behaving correctly; the **content** is defective, and there is no signal. A bank, embassy or airline will reject this document, and the generator reported success. A `missingValue` report alongside `unresolvedPlaceholders` would close this.

### 4.5 The editor's variable hint is incomplete and can seed new bugs

`page-client.tsx:246` advertises exactly four variables:

```
Available: {{company_name}}, {{employee_name}}, {{designation}}, {{basic_salary}}, etc.
```

The engine actually defines 20 snake_case names (`variables.ts:161-179`) plus 18 dotted keys. Omitted from the hint: `employee_id`, `department`, `joining_date`, `passport_number`, `emirates_id`, `nationality`, `gross_salary`, `allowances`, `company_signatory`, `reference_number`, `date_today`. A template author has no way to discover them and no way to validate them, and — per 4.3 — a typo produces only a server-side log line.

---

## 5. Preview vs. final render — they are different code paths

| Surface | What it renders | Substitution applied? | Code |
|---|---|---|---|
| "Template Live Preview" on `/letters` | **Raw `LetterTemplate.content_en`** | **No** | `LettersPageClient.tsx:309` — `{selectedTemplate.content_en}` |
| "Template Live Preview" (Arabic tab) | Raw `content_ar` | No | `:312` |
| Final letter in the viewer modal | `Letter.content_en` (post-substitution snapshot) | Yes | `:456` |
| PDF download | `Letter.content_en` | Yes | `letter-generator.ts:71-72` |

The preview shows `{{employee_name}}`; the document shows `Admin User`. This is the **direct cause of the class of bug that was just fixed**: an operator previewing a template sees only placeholders, has no way to tell a working placeholder from a typo'd one, and the first time they learn the difference is when an employee receives a broken certificate.

The label "Template Live Preview" (`page-client.tsx:301`) overstates what it does — it is a raw content view, not a live preview.

---

## 6. `customFields` can overwrite built-in variables, irreversibly

`app/api/letters/route.ts:114-117` accepts `customFields` from the request body and passes them to `buildLetterVariables`, which ends in `withAliases` (`variables.ts:203-208`):

```ts
if (customFields) {
    for (const [key, value] of Object.entries(customFields)) {
        if (value === null || value === undefined) continue;
        out[key] = String(value);
    }
}
```

Caller-supplied keys are written **last and unconditionally**. A request containing `{"employee_name":"Anything At All"}` produces a certificate reading *"This is to certify that Anything At All…"*, with a valid reference number, attributed to a real employee. The override is baked into `Letter.content_en`; nothing records which values were overridden, and there is no `Letter` column for it.

This is bounded by `authorizePermission(PERMISSIONS.LETTER_GENERATE)` (HR / ADMIN / SUPER_ADMIN only — see the security audit), so it is not a privilege escalation. It is a **document-integrity** defect: a signed, reference-numbered, PDF-capable legal document can contain values that never existed in the system of record, and the substitution is unrecoverable after the fact.

**Related dead control:** the "Purpose / Details" input on `/letters` (`LettersPageClient.tsx:288-294`) sends `customFields: { 'request.purpose': purpose }` (`:130`). **No shipped template contains `{{request.purpose}}`** (verified against all three `content_en` values in the database). The field is a no-op that appears to work.

---

## 7. Template versioning — MISSING, proven

| Test | Result |
|---|---|
| `model TemplateVersion` in `prisma/schema.prisma` | **0 matches** (repo-wide) |
| Any `version` column on `LetterTemplate` | **0** |
| `updateLetterTemplate` behaviour | In-place overwrite, `letter-templates.ts:60-65` |
| Any archive/tombstone on delete | `deleteLetterTemplate` is a hard `prisma.letterTemplate.delete`, `:76-78` |

**Consequence.** `Letter.content_en` is a *rendered snapshot*, so a letter that was issued still shows the text it was issued with. That part is fine. What is lost is the **template**: after an edit, there is no way to answer *"what did the approved Employment Certificate template say on 26 September?"* Combined with `updateLetterTemplate` having no optimistic-concurrency guard, two HR users editing the same template silently overwrite each other with no conflict detection and no record.

**Related — the hard delete is protected, but badly reported.** `pg_constraint` shows `Letter_templateId_fkey ... ON DELETE RESTRICT`. Deleting a template that has issued letters *is* correctly refused by the database. `deleteLetterTemplate` catches the error and returns `{ success: false, error }`, and `page-client.tsx:114` discards `res.error` and shows a generic `"Failed to delete"`. The operator is never told *why*.

---

## 8. RBAC on the template layer

| Surface | Gate | Assessment |
|---|---|---|
| `page.tsx:9` | `LETTER_TEMPLATE_MANAGE` (HR, ADMIN, SUPER_ADMIN) | Correct |
| `createLetterTemplate` / `updateLetterTemplate` / `deleteLetterTemplate` | `ATTENDANCE_SHIFT_MANAGE` | **Wrong capability — see below** |
| `getLetterTemplates` (`letter-templates.ts:14`) | **none** | Any authenticated user can invoke the action and read every template body |
| `getLetterTemplateById` (`:25`) | **none** | Same, and zero callers |
| `GET /api/templates` (`route.ts:5-9`) | **auth() only** | Any authenticated user reads all active templates |
| `POST /api/templates` (`route.ts:25`) | `role !== 'ADMIN'` | Bypasses the central resolver; excludes `SUPER_ADMIN` |

**The wrong-capability finding is latent, not exploitable today — and this matters.** `ATTENDANCE_SHIFT_MANAGE` is granted at `permissions.ts:218` (HR) and inherited by ADMIN (245-248) and SUPER_ADMIN (271-275). `LETTER_TEMPLATE_MANAGE` is granted at `permissions.ts:224` (HR) and `:267` (ADMIN), inherited by SUPER_ADMIN. **The two resolve to the identical role set.** So the bug causes no privilege difference *at present*. It is a correctness defect that becomes a real privilege-escalation bug the moment either grant list is edited independently — and it makes the code lie about what the control is.

**The read-side gates are the actual gap.** `getLetterTemplates` and `GET /api/templates` have no capability check at all. The page is gated, but a server action is an ordinary HTTPS endpoint that any authenticated client can call directly. This is the same class of defect as `RBAC_AUDIT.md:233` recorded for `/api/letters` — which is now only *half* fixed (`POST` guarded, `GET` still not).

---

## 9. Data exposure

`GET /api/letters` (`app/api/letters/route.ts:13-37`) checks only `session`. It returns **every `Letter` row to every authenticated user**, including `content_en`, which for the Salary Certificate template contains `Basic Salary`, `Allowances` and `Gross Salary` in AED. There is no `LETTER_VIEW` check, no `employeeId` scoping, and no index on `Letter.employeeId` for the one filter that exists.

`app/api/search/route.ts:1028-1049` gets this right — `searchLetterRecords` deliberately forces self-scope for STAFF and never selects `details`, with the reasoning written out at `:1029-1033`. The same discipline has not been applied to the letters API. `PRODUCTION_READINESS_CHECKLIST.md:279` lists this exact IDOR as "Already true; needs a test" — **it is not true for the letters API.**

---

## 10. Findings register

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| TPL-01 | **P0** | Three different letter renderers exist; the central flow is the only one that uses the placeholder engine. The other two hardcode prose. | [duplication audit](./LETTER_TEMPLATE_DUPLICATION_AUDIT.md) |
| TPL-02 | **P0** | `LetterTemplate.type` is unconstrained free text; two modules match it against hardcoded lists with no shared vocabulary. `offer-letter.ts:22` finds no `OFFER` template and falls back to the wrong document. | `schema.prisma:1137`, `offer-letter.ts:22-32`, `workflow/letters.ts:30` |
| TPL-03 | **P1** | `customFields` overwrite built-in variables unconditionally and are baked into the document irrecoverably. | `variables.ts:203-208`, `route.ts:114-117` |
| TPL-04 | **P1** | Template preview shows the raw template; the final render shows the substituted letter. Two different things, one label. | `LettersPageClient.tsx:301-314` vs `:456` |
| TPL-05 | **P1** | Unresolved and missing values are reported only to `console.warn`. No UI, no audit record, no HTTP signal. | `route.ts:126-134` |
| TPL-06 | **P1** | Absent values render as `—` on legal documents with no signal. A Travel NOC was issued with "Passport No. —". | `variables.ts:98-101`; DB row `LTR-UAE-2026-004` |
| TPL-07 | **P1** | `GET /api/letters` and `GET /api/templates` have no capability check and no scoping; salary figures are readable by any authenticated user. | `api/letters/route.ts:13-16`, `api/templates/route.ts:5-9` |
| TPL-08 | **P2** | No `TemplateVersion`. Template history is unrecoverable; concurrent edits silently overwrite. | §7 |
| TPL-09 | **P2** | Template writes gated on `ATTENDANCE_SHIFT_MANAGE` — wrong capability, currently ACL-equivalent, latent escalation. | `letter-templates.ts:38,57,73` |
| TPL-10 | **P2** | The editor's variable hint lists 4 of 20 available variables. | `page-client.tsx:246` vs `variables.ts:161-179` |
| TPL-11 | **P2** | `POST /api/templates` uses a raw `role !== 'ADMIN'` string compare and excludes `SUPER_ADMIN`. | `api/templates/route.ts:25` |
| TPL-12 | **P3** | No index on `LetterTemplate.type` or `.isActive`. | `pg_indexes` |
| TPL-13 | **P3** | The "Purpose / Details" field is a no-op; no template uses `{{request.purpose}}`. | `LettersPageClient.tsx:130` vs DB `content_en` |
| TPL-14 | **P3** | `getLetterTemplateById` is a dead, ungated export. | zero callers repo-wide |
| TPL-15 | **P3** | Delete failure reason is discarded; operator sees a generic message. | `page-client.tsx:113-114` |

---

## 11. Verified by execution

```
$ npx tsc --noEmit
(clean, no output)

$ npx vitest run tests/letter-variables.test.ts
 ✓ tests/letter-variables.test.ts (30 tests) 11ms
 Test Files  1 passed (1)   Tests  30 passed (30)
```

## 12. What I could not verify

- **No end-to-end render was performed.** I did not log in and click through `/letters`; the evidence above is static trace plus stored output from letters that already exist in the database. The three letters dated 2026-09-29 15:18:50 were created by someone else shortly before this audit; I did not create them and cannot confirm which client produced them.
- **jspdf output was not visually inspected.** That `content_ar` is destructured at `letter-generator.ts:15` and never used is proven by reading the whole 124-line function, but I did not render a PDF.
- **Multi-role behaviour was not exercised at runtime.** The RBAC conclusions in §8 are derived from `permissions.ts` grant lists and `resolvePermissions`, not from live session tests.
- **Whether the empty-string `content_ar` on Salary Certificate was deliberate or a seed artefact** is not recorded anywhere in the repo.
