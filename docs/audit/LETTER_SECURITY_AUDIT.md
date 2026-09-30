# Letter System — Security Audit

**Scope:** authorisation, authorisation consistency, data exposure, audit, and injection across every letter surface.
**Date:** 2026-09-29 · **Type:** READ-ONLY

Related: [TEMPLATE](./LETTER_TEMPLATE_SYSTEM_AUDIT.md) · [GENERATION](./LETTER_GENERATION_SYSTEM_AUDIT.md) · [DATA MODEL](./LETTER_DATA_MODEL_AUDIT.md) · [INTEGRATION](./LETTER_SYSTEM_INTEGRATION_AUDIT.md) · [SUMMARY](./LETTER_AUDIT_SUMMARY.md)

---

## 1. Role grants — verified from source

`lib/auth/permissions.ts` defines four letter capabilities (`:77-80`):

```
LETTER_VIEW            = "letter.view"                :77
LETTER_GENERATE        = "letter.generate"            :78
LETTER_APPROVE         = "letter.approve"             :79
LETTER_TEMPLATE_MANAGE = "letter.template.manage"     :80
```

| Capability | STAFF | MANAGER | FINANCE | HR | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|---|---|
| `letter.view` | ✅ `:170` | ✅ `:185` | ❌ | ✅ (via STAFF) | ✅ | ✅ |
| `letter.generate` | ❌ | ❌ | ❌ | ✅ `:222` | ✅ | ✅ |
| `letter.approve` | ❌ | ❌ | ❌ | ✅ `:223` | ✅ | ✅ |
| `letter.template.manage` | ❌ | ❌ | ❌ | ✅ `:224` | ✅ `:267` | ✅ |

`resolvePermissions` is a **static role map** — `authorizePermission` (`lib/auth/guards.ts:222-228`) calls it with no `PermissionOverrides` argument, so there is no dynamic-grant escape hatch.

> **This corrects `docs/audit/RBAC_AUDIT.md:70-73`**, which shows `letters.generate` / `letters.approve` / `letters.templates` as granted to four roles including FINANCE, and a "team"/"own" scoping column for `letters.view`. Neither is true in the current source. `LETTER_GENERATE` is HR and above only; FINANCE has no letter capability at all. `RBAC_AUDIT.md:233`'s `/api/letters` → "None" entry is now only half true: `POST` is guarded, `GET` is not.

---

## 2. Authorisation by surface

| Surface | Gate | Verdict |
|---|---|---|
| `app/letters/page.tsx:12` | `if (!session) redirect` | **WEAK** — any authenticated user. Matches `LETTER_VIEW` (all roles) so not exploitable, but it is a session check, not a capability check, and it diverges from every other gated page |
| `app/dashboard/settings/templates/page.tsx:9` | `requirePagePermission(LETTER_TEMPLATE_MANAGE)` | **PASS** |
| `app/letters/{appointment,offer,relieving}/page.tsx:8` | `requirePagePermission(LETTER_GENERATE)` | **PASS on the page** — but see §4 |
| `app/api/letters` `GET` (`:13-16`) | `if (!session)` only | **BROKEN** — §3.1 |
| `app/api/letters` `POST` (`:43`) | `authorizePermission(LETTER_GENERATE)` | **PASS on the gate**, but the IDOR branch beneath it is unreachable — §4.1 |
| `app/api/letters/[id]/approve` (`:11`) | raw `auth()` + `["ADMIN","HR"]` | **PARTIAL** — §3.2 |
| `app/api/templates` `GET` (`:6-9`) | `if (!session)` only | **PARTIAL** — §3.3 |
| `app/api/templates` `POST` (`:25`) | `(session.user as {role}).role !== 'ADMIN'` | **BROKEN** — §3.3 |
| `getLetterTemplates` (`letter-templates.ts:14`) | **none** | **BROKEN** — §3.3 |
| `getLetterTemplateById` (`:25`) | **none** | **BROKEN** (and zero callers) |
| `create/update/deleteLetterTemplate` (`:38,57,73`) | `ATTENDANCE_SHIFT_MANAGE` | **WRONG CAPABILITY** — §3.4 |
| `saveLetterRecord` (`actions/letters.ts:7-11`) | `session?.user?.email` only | **PARTIAL** — §4.2 |
| `getEmployeesForLetter` (`:59-60`) | `session?.user?.email` only | **PARTIAL** — §4.2 |
| `lib/workflow/letters.ts:71,179,263,305` | `requirePermission(...)` | **PASS (dead code)** — correctly gated, correctly unreachable |
| `lib/workflow/offer-letter.ts:42` | `requirePermission(RECRUITMENT_OFFER)` | **PASS** |
| `issueOfferLetterAction` (`recruitment.ts:254`) | delegates | **PASS** |
| `app/api/search/route.ts:1028-1089` | `scopeEmployeeWhere` / mirrors template gate | **PASS — the best-gated letter surface in the codebase** |
| `auth.config.ts:41-43` | edge role gate on the three one-off pages | **PASS**, and the only thing standing between them and any authenticated user |

### 2.1 Authorisation-mechanism fragmentation

Four different mechanisms guard the same capability: `authorizePermission` (route), `requirePermission` (library), `requirePagePermission` (page), and a raw `auth()` + string-compare (`api/templates:25`, `[id]/approve:11`). The first three resolve through the central `ROLE_PERMISSIONS` map; the fourth does not and has already produced one wrong answer (SUPER_ADMIN excluded from `/api/templates` POST and from letter approval).

---

## 3. Data exposure

### 3.1 `GET /api/letters` returns every letter to every authenticated user — **P1**

`app/api/letters/route.ts:13-37`:

```ts
const session = await auth();
if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
// …
const letters = await prisma.letter.findMany({
    where: employeeId ? { employeeId } : {},
    include: { employee: {...}, template: {...} },
    orderBy: { createdAt: 'desc' }
});
return NextResponse.json(letters);
```

| Missing control | Consequence |
|---|---|
| No `LETTER_VIEW` check | Any authenticated account reads all letters. In practice every role has `LETTER_VIEW`, so the impact is limited to *who*, not *whether* |
| **No employee scoping** | **The real problem.** A STAFF user calling `GET /api/letters` with no parameter receives **every letter issued to every employee in the company** |
| No `customFields`/`details` redaction | Salary Certificate bodies contain `Basic Salary`, `Allowances`, `Gross Salary` in AED — **the complete compensation breakdown of every employee**, to every authenticated user |
| No pagination | Unbounded `findMany` |
| No index on `employeeId` or `createdAt` | The one filter and the sort are unindexed (`pg_indexes`) |

`PRODUCTION_READINESS_CHECKLIST.md:279` lists this IDOR as *"Already true; needs a test"*. **For the letters API it is not true.**

The contrast is instructive: `app/api/search/route.ts:1029-1033` documents, in a comment, that a STAFF member "reaches only their own letters even though LETTER_VIEW alone would match every row" — and enforces it with `scopeEmployeeWhere`. The same discipline was applied to search and not to the API that returns the same data.

**Recommended shape (not implemented):** `where: scopeEmployeeWhere(subject, { employeeId })`, plus `LETTER_VIEW`, plus `take`/`cursor`.

### 3.2 `POST /api/letters/[id]/approve` — **P2**

`app/api/letters/[id]/approve/route.ts`:

| Issue | Line | Detail |
|---|---|---|
| Bypasses the central resolver | `:11` | `!["ADMIN","HR"].includes(role)` instead of `authorizePermission(LETTER_APPROVE)` |
| **Excludes `SUPER_ADMIN`** | `:11` | A super administrator cannot approve a letter. `LETTER_APPROVE` *is* in `SUPER_ADMIN_GRANTS` (`permissions.ts:272-275`) |
| **No state validation** | `:16-23` | `prisma.letter.update({ where: { id }, data: { status: 'GENERATED' } })` with no `status` precondition. Any letter moves to `GENERATED` from any state, including `VOID`. Last-write-wins under concurrency |
| **No audit** | — | No `logSecurityEvent`, no `AuditLog` row. Contrast the dead `workflow/letters.ts:229-236` which does both |
| **Zero callers** | — | Repo-wide search: no client fetches this URL. It is an unauthenticated-in-practice surface with no user, which is the only reason its defects are not exploitable today |

**It is a live, guarded, state-blind mutation endpoint with no consumer.** It should be deleted or completed, not left between the two.

### 3.3 Template read paths have no capability check — **P2**

| Surface | Gate |
|---|---|
| `getLetterTemplates` (`letter-templates.ts:14-23`) | none |
| `getLetterTemplateById` (`:25-35`) | none |
| `GET /api/templates` (`api/templates/route.ts:6-9`) | `if (!session)` |
| `POST /api/templates` (`:25`) | `role !== 'ADMIN'` string compare |

Server actions are ordinary HTTPS endpoints. A page-level `requirePagePermission` does not protect the action it renders — the action is what the browser actually invokes. Any authenticated STAFF user can call `getLetterTemplates()` directly and read every template body.

Template bodies are not salary data, so this is information disclosure rather than a data breach, and no `LETTER_VIEW` role is excluded from reading templates through `/api/templates` anyway. **The finding is the inconsistency**: the same data has one gated reader (page) and three ungated readers (actions, API GET).

`POST /api/templates` additionally **excludes `SUPER_ADMIN`** and never logs. It has zero callers.

### 3.4 Wrong capability on template writes — **P2, latent**

`letter-templates.ts:38, 57, 73` guard with `PERMISSIONS.ATTENDANCE_SHIFT_MANAGE` instead of `LETTER_TEMPLATE_MANAGE`.

**This is not exploitable today.** `ATTENDANCE_SHIFT_MANAGE` is granted at `permissions.ts:218` (HR) and inherited by ADMIN (`:245-248`) and SUPER_ADMIN (`:271-275`). `LETTER_TEMPLATE_MANAGE` is granted at `:224` (HR) and `:267` (ADMIN), inherited by SUPER_ADMIN. **The resolved role sets are identical: {HR, ADMIN, SUPER_ADMIN}.**

It is a correctness defect, not a live vulnerability, and I am labelling it as such rather than inflating it. It becomes exploitable the moment either grant list is edited independently — and it means the code does not document what it actually enforces.

### 3.5 `OfferLetter.fileUrl` is a dead link, not an exposure

`offer-letter.ts:139` sets `fileUrl: \`/letters/${created.id}\``. There is no `app/letters/[id]` route. This is a broken link, not a data leak — worth recording because it looks like a retrieval path in the database and an operator would reasonably follow it.

---

## 4. Audit and logging

### 4.1 Successful generation is logged as an access denial — **P1**

Three of the four letter implementations do this:

| Site | Action | Outcome |
|---|---|---|
| `app/api/letters/route.ts:149-158` | `SECURITY_ACTION.ACCESS_DENIED` | `'SUCCESS'` |
| `lib/workflow/letters.ts:136-143` | `SECURITY_ACTION.ACCESS_DENIED` | `'SUCCESS'` |
| `lib/workflow/letters.ts:229-236` | `SECURITY_ACTION.ACCESS_DENIED` | `'SUCCESS'` |
| `lib/workflow/offer-letter.ts:154-161` | `SECURITY_ACTION.ACCESS_DENIED` | `'SUCCESS'` |
| `app/api/letters/route.ts:73-82` (a **real** denial) | `SECURITY_ACTION.ACCESS_DENIED` | `'DENIED'` |

Real denials and successful operations are **indistinguishable by action type** in the security log. Any SIEM rule, dashboard or alert keyed on `ACCESS_DENIED` counts successful letter generation as an attack. It also means a genuine `ACCESS_DENIED` alert is drowned in noise from normal use.

`AuditLog` rows (`workflow/letters.ts:121,217`) exist — but only in the dead module. The live path writes **no `AuditLog` row at all**, and the `Letter` model has no `createdBy` column, so a letter cannot be attributed to a person after the fact except through `logSecurityEvent`, which is filed under the wrong action.

### 4.2 The unreachable pages

`saveLetterRecord` (`app/lib/actions/letters.ts:7-11`) and `getEmployeesForLetter` (`:59-60`) gate on `session?.user?.email` — **any authenticated user**. The pages that render them require `LETTER_GENERATE` (`page.tsx:8`), and `auth.config.ts:41-43` adds an edge gate, so in normal use only HR and above reach them.

But the actions themselves are directly invokable by any authenticated client. A STAFF user could call `saveLetterRecord` with an arbitrary `employeeId`, `type` and `recipientName` and write a `LetterRecord` for any employee. `LetterRecord` is empty, so nothing has been written this way — but the control does not exist at the layer that matters.

**Lower severity than §3.1** because the written data is a short free-text record, not a rendered document. Recorded for completeness.

### 4.3 No rate limiting on the generation endpoint

`proxy.ts` handles authentication only; no `middleware.ts` exists; `applyRateLimit` is not used in any `app/api/**/route.ts`. `POST /api/letters` is limited to HR/ADMIN by `LETTER_GENERATE`, so this is a hardening note rather than a finding. It is listed because the endpoint also performs an **unguarded read-modify-write on a unique column** (`count()+1`, `route.ts:104-105`), and a burst of concurrent requests from one HR user is enough to trigger the collision.

---

## 5. Injection

### 5.1 Raw HTML / script via template content — **verified NOT exploitable**

Asked explicitly. Three independent reasons, any one sufficient:

1. **Screen render is React JSX.** `LettersPageClient.tsx:456` — `{viewingLetter.content_en}` inside a `<div>`. React escapes interpolated strings; `<script>` in a template renders as visible text. Same at `:311` and `:460` for the Arabic tab.
2. **PDF path is text-only.** `letter-generator.ts:71-72` — `doc.splitTextToSize(content_en, 170)` then `doc.text(...)`. jsPDF does not parse HTML.
3. **Transport is JSON.** `NextResponse.json(letter)`; the client stores it in a `string`-typed field.

**No `dangerouslySetInnerHTML` anywhere in the letter render path.** No sanitiser exists, and none is needed.

**Boundary note:** template *bodies* are authored by HR/ADMIN through a `LETTER_TEMPLATE_MANAGE` page gate, so authoring is inside the trust boundary. Template *content* is therefore not an injection vector — it is a **content-integrity** vector, and that is a real finding:

### 5.2 `customFields` can forge document content — **P1**

`app/api/letters/route.ts:114-117` → `variables.ts:203-208`:

```ts
if (customFields) {
    for (const [key, value] of Object.entries(customFields)) {
        if (value === null || value === undefined) continue;
        out[key] = String(value);
    }
}
```

Caller-supplied keys are written **last and unconditionally** — a request body of `{"employee_name":"Someone Else","gross_salary":"900000"}` produces a salary certificate with a valid reference number, attributed to a real employee, containing values that never existed in the system of record. The forged values are baked into `Letter.content_en`; there is no column recording overrides and no `AuditLog` entry.

**Not a privilege escalation** — `LETTER_GENERATE` is HR and above, and HR legitimately issues these documents. **It is a document-integrity and auditability defect:** the system cannot distinguish, after the fact, a letter whose numbers came from `salaryStructure` from one whose numbers came from a request body.

The same code path is what makes the *"Purpose / Details"* field on `/letters` a no-op today: it sends `{'request.purpose': purpose}` (`LettersPageClient.tsx:130`) and no shipped template uses `{{request.purpose}}`, so the value is accepted, stored in the variable map, and never rendered. The field looks like it works.

### 5.3 Arabic content is not sanitised but also not rendered

`content_ar` reaches the same `renderTemplate` and the same React JSX, so it is equally safe — and equally invisible in the PDF (§5 of the generation audit).

---

## 6. Privacy — compensation data at rest and in transit

| Exposure | Location | Assessment |
|---|---|---|
| `Letter.content_en` contains full salary breakdowns | `Letter` rows for the Salary Certificate template | `GET /api/letters` returns these to every authenticated user (§3.1) |
| **No letter artifact is stored** | `pdfUrl` NULL on all 4 rows; written nowhere | A salary certificate exists only as a DB row and, if downloaded, a file in one operator's Downloads folder. **The compensating control for §3.1 is data minimisation by accident, not by design** |
| `LetterRecord.details` free text | `actions/letters.ts:16` | The search route deliberately never selects it (`search/route.ts:1032-1033`) — correct, and the only place in the codebase that reasoned about it |
| `app/api/search` correctly scoped | `:1028-1049` | The reference implementation for how letter data should be exposed |

---

## 7. Findings register

| ID | Severity | Finding | Exploitability | Evidence |
|---|---|---|---|---|
| SEC-01 | **P1** | `GET /api/letters` has no employee scoping — every authenticated user reads every letter, including full salary breakdowns. | Exploitable today by any authenticated STAFF user | `route.ts:13-37` |
| SEC-02 | **P1** | Successful letter generation is logged as `ACCESS_DENIED`, making real denials indistinguishable. | Not exploitable; degrades detection | 4 sites, §4.1 |
| SEC-03 | **P1** | `customFields` overwrite built-in document values irreversibly with no provenance recorded. | HR/ADMIN only — integrity, not privilege | `variables.ts:203-208` |
| SEC-04 | **P2** | `POST /api/letters/[id]/approve` bypasses the central resolver, excludes `SUPER_ADMIN`, has no state precondition and no audit. | No caller exists; surface is dormant | `[id]/approve/route.ts:11-23` |
| SEC-05 | **P2** | `getLetterTemplates` and `GET /api/templates` have no capability check. | Exploitable by any authenticated user; low impact | §3.3 |
| SEC-06 | **P2** | Template writes guarded by `ATTENDANCE_SHIFT_MANAGE` — wrong capability. | **Not exploitable today**; ACL-equivalent | `letter-templates.ts:38,57,73` |
| SEC-07 | **P2** | `POST /api/templates` uses a string role compare, excludes `SUPER_ADMIN`, logs nothing. | No caller exists | `api/templates/route.ts:25` |
| SEC-08 | **P2** | `saveLetterRecord` / `getEmployeesForLetter` gate on session only; the page gate does not protect the action. | Invocable by any authenticated user; `LetterRecord` empty so unwitnessed | `actions/letters.ts:9,60` |
| SEC-09 | **P3** | The unreachable IDOR branch in `POST /api/letters` cannot fire; its comment cites a role grant that does not exist. | No control exists where one is documented | `route.ts:67-85` |
| SEC-10 | **P3** | No rate limiting on `POST /api/letters`. | HR/ADMIN only | `proxy.ts` |
| SEC-11 | **P3** | `OfferLetter.fileUrl` points to a non-existent route. | Broken link | `offer-letter.ts:139` |

---

## 8. Confirmed as **not** a finding

Recorded so a later reader does not re-open them:

| Checked | Result |
|---|---|
| Script/HTML injection through template content | **Not possible** — React escapes the render; jsPDF takes plain text. §5.1 |
| `dangerouslySetInnerHTML` in the letter path | **0 occurrences** |
| Privilege escalation via the wrong template capability | **Not possible today** — the two grants resolve to the same role set. §3.4 |
| Cross-company data access | **Not possible** — there is no company/branch model; `ServiceConfig` COMPANY is unconfigured, so there is one (unconfigured) context |
| Unauthorised letter generation by STAFF | **Not possible** — `LETTER_GENERATE` is not in `STAFF_GRANTS`; STAFF receives 403 |
| SQL injection | **Not applicable** — Prisma parameterises; no raw SQL in the letter code |
| CSRF on server actions | Covered by the framework; the REST routes are JSON `POST`s with `Content-Type: application/json` and a session cookie |

---

## 9. What I could not verify

- **No request was made against any endpoint.** Every conclusion is from source + the live DB. In particular I did not log in as a STAFF user and call `GET /api/letters`; SEC-01 is derived from the absence of any `where` clause on the caller's identity and from the schema's nullable `employeeId`, both of which are unambiguous.
- **I did not inspect the `SecurityLog` / `AuditLog` table contents**, so I cannot say how many `ACCESS_DENIED` entries with `outcome: 'SUCCESS'` exist in practice.
- **The archived `hr-system/` tree was not security-audited** beyond noting that its `api/letters/route.ts` has no authorisation guard at all and that `csrf_hash.txt` is tracked in git (`hr-system/ARCHIVED.md:18`). A full audit of that tree is out of scope and it should be deleted rather than fixed.
- **Rate-limit posture was assessed only for the letter routes.** The absence of `middleware.ts` and the absence of `applyRateLimit` in `app/api/**/route.ts` are both confirmed; the login rate limiter mentioned in `ARCHIVED.md:23` as a root-app remediation is elsewhere and was not evaluated.
- **`hasPermission` was not audited for correctness** — I confirmed `authorizePermission`/`requirePermission` resolve through `resolvePermissions(user.role)` with no dynamic override, and read the grant lists, but did not test the resolver against all role/permission combinations.
