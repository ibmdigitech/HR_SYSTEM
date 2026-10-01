# HRMS Multi-Tenant SaaS Implementation Plan

## Objective

Evolve the current single-company HRMS into a secure, production-operated, multi-tenant SaaS product. Each customer organization must have a separate workforce, configuration, users, workflows, documents, payroll, and audit history. A user must never read or change another tenant's records by changing a URL, API payload, file ID, or background-job input.

This document is the implementation roadmap. It does not mean the work is complete. The current application is **not ready to onboard multiple customer companies**.

## Current state and known blockers

- The Prisma schema has no `Tenant`/`Organization` model or organization ownership fields on business records.
- Queries such as dashboard workforce, attendance, payroll, performance, and audit queries run across the current database without a customer boundary.
- `User.role` is global. There is no organization membership model to support company-scoped roles.
- `lib/auth/scope.ts` currently models self/department/global access, not tenant isolation.
- The role request/approval feature is partial; there is no complete tenant user invite, suspension, membership, or session-revocation workflow.
- Backup/restore scripts exist, but the nightly Windows task was not installed on the checked host. Off-host copies and a restore drill are not confirmed.
- The database is PostgreSQL, while `prisma/migrations/migration_lock.toml` says SQLite. `prisma migrate status` fails with provider mismatch, and the current PostgreSQL database has no `_prisma_migrations` baseline. Migration history must be repaired before relying on migrations for production deployments.
- ESLint currently scans archived/generated content and reports a large, noisy failure count. The lint scope must be corrected before it can be a useful release gate.
- Employee directory desktop/mobile parity, photo handling, performance questions, and resignation request work have been addressed in code, but still need release-browser QA and production schema/deployment checks.

## Architecture decisions to make before coding

Record these decisions in an ADR before the tenant migration begins:

1. **Tenant resolution:** use one verified organization context per request, selected from a membership-backed active organization. A slug/subdomain may identify the requested organization but never grants access by itself.
2. **Database isolation:** begin with one PostgreSQL database and shared tables with a non-null `tenantId` on tenant-owned entities. Add PostgreSQL row-level security as defense in depth only after connection-pool/session-context behavior is verified. Do not rely on application filters alone without cross-tenant tests.
3. **Identity:** one login account may have memberships in multiple organizations. Store application roles on the organization membership, not as the user's global HR role. Keep any platform-operator role separate from customer-admin roles.
4. **Existing customer:** migrate all current HRMS data into one explicitly named default organization and preserve existing IDs/history wherever possible.
5. **Hosting and data residency:** select production cloud/region, database, object storage, email, monitoring, payment provider, and recovery objectives before billing or launch work.
6. **Commercial model:** define plans, trial, seats/employee limits, payroll/features entitlements, billing cycle, tax handling, cancellation, and read-only/grace behavior for failed payments.

## Delivery phases

### Phase 0 — Baseline, product decisions, and migration repair

**Deliverables**

- Complete route, server-action, API, scheduled-job, file, and data-model inventory.
- Classify every model as platform-global, tenant-owned, or child-owned through a tenant-owned parent.
- Write the architecture decisions above, a threat model, and the tenant-to-feature ownership matrix.
- Establish supported local/CI/staging/production environment configurations without exposing secrets.
- Repair Prisma migration history for PostgreSQL: choose and document a safe baseline strategy, make `migration_lock.toml` match the provider, create a baseline for the already-provisioned database, and prove a new empty database can migrate from zero. Do not mark migrations applied without comparing the live schema to the migration result.
- Exclude archive folders, generated Prisma clients, `.next`, build outputs, and dependencies from lint/typecheck scopes. Capture a clean baseline.

**Gate**

- `prisma migrate deploy` works on a fresh PostgreSQL database and on a database upgraded from the existing single-company schema.
- A schema diff is reviewed and backed up before any production migration.
- Product has approved the default organization, membership, billing, and hosting choices.

### Phase 1 — Tenant and membership foundation

**Data model**

- Add `Organization` (tenant) with stable ID, unique slug, display/legal names, status, locale/timezone/currency, timestamps, and retention/deletion state.
- Add `OrganizationMembership` with `organizationId`, `userId`, tenant role, membership status, invitation/activation timestamps, and unique `(organizationId, userId)`.
- Add tenant-owned invitations with hashed, expiring, single-use tokens and auditable inviter/acceptance metadata.
- Keep a separate, tightly limited platform support identity/role; do not make platform support a normal tenant role.
- Replace global tenant role assumptions in `User.role` through a compatibility migration. Preserve login identity and provide an explicit active-organization context for sessions.

**Tenant context**

- Resolve the active organization server-side from a valid session membership on every request.
- Require membership to be active and tenant status to permit the requested operation.
- Never trust a client-supplied `tenantId` as authorization. Validate route slug, selected organization, and membership together.
- Define `requireTenantUser`, `requireTenantPermission`, and tenant-scoped query helpers. Include tenant context in audit events and observability logs without logging secrets or sensitive HR data.

**Gate**

- Unit tests prove unknown, suspended, removed, and cross-organization memberships cannot resolve a tenant context.
- Users in two organizations receive the correct independent role and active-tenant context.

### Phase 2 — Tenant ownership across the data model

Add tenant ownership to every independently queried or addressed business entity, including at minimum:

- employees, users/memberships, departments, locations, shifts, leave policies/requests/balances, attendance and device configuration;
- payroll periods, salary structures, salary records, loans, overtime, settlements, and financial exports;
- recruitment requisitions, candidates, interviews, offers, generated letters and templates;
- performance cycles, reviews, goals, questions and answers;
- company settings/documents, service requests, approvals, notifications, audit/security records, and exit/offboarding cases/checklists.

For child tables, either store `tenantId` directly or prove ownership by a tenant-scoped parent relation and enforce the relation with composite foreign keys/unique constraints where practical. Add tenant-aware indexes and tenant-scoped uniqueness (for example, employee code unique within an organization instead of globally). Remove global uniqueness only where product rules allow it.

**Data migration sequence**

1. Create the default organization.
2. Add nullable tenant columns and backfill every existing row to the default organization.
3. Validate there are no orphaned or unassigned tenant-owned rows.
4. Add foreign keys, indexes, and tenant-scoped unique constraints.
5. Make required tenant columns non-null.
6. Map each existing user to a membership and preserve the current effective role for the default organization.
7. Reconcile uploaded files and stored attachments to tenant-owned storage keys.

Each migration must have a backup, tested rollback/recovery procedure, row-count reconciliation, and an explicit stop condition if validation fails.

### Phase 3 — Enforce isolation through every access path

- Add tenant context to all Prisma reads, creates, updates, deletes, upserts, aggregates, exports, and bulk operations.
- Require both record ID and tenant ownership on mutations (`where: { id, tenantId }` or an equivalent ownership-checked parent lookup). Never authorize by ID alone.
- Update every server action and API route, including search, health/diagnostic exceptions, seed/import/export endpoints, and file downloads. Public health endpoints must return only operational status.
- Scope joins and nested writes; a tenant-owned parent must not accept a child ID from another tenant.
- Scope scheduled jobs and retry queues with a tenant identifier captured from trusted database state.
- Scope notification delivery, audit views, search indexes, caches, generated PDFs, file storage keys, and signed download URLs.
- Add database RLS only as a second boundary if request/transaction context can be set and cleared safely for pooled connections. Test that no tenant setting leaks between reused connections.
- Add safe platform-operator workflows with explicit break-glass reason, short-lived access, tenant selection, and immutable audit events.

**P0 release gate**

- Automated adversarial tests attempt cross-tenant read, update, delete, aggregate, file download, and export using valid IDs from another tenant.
- The same tests cover direct server actions, API routes, pages, nested relations, background jobs, and cached results.
- No feature is marked tenant-ready based only on UI hiding or client filters.

### Phase 4 — Tenant onboarding and access management

- Build organization creation and setup wizard: company identity, timezone/currency/locale, workweek, leave rules, payroll settings, and first administrator.
- Build owner/admin invitations, resend/revoke/expiry flows, membership activation, role change, suspension, removal, and session revocation.
- Add organization switcher for users with multiple memberships and make the active organization visible in the shell.
- Move role requests, approval, and assignment to membership-level roles; repair the current self-service route guard so an employee can request access while only authorized approvers can grant it.
- Keep least-privilege permission checks on the server and provide tenant-scoped audit history for all access changes.
- Add account recovery, MFA policy, session expiry, rate limits, and tenant-specific SSO only after core identity flows are tested.

**Gate**

- An owner can onboard a tenant without developer/database access.
- An invited user cannot enter until token validation and membership activation succeed.
- Role change and suspension take effect on the next request and revoke old sessions as required.

### Phase 5 — Tenant configuration, files, and business workflows

- Make company settings, policies, templates, branding, approval routes, departments, and attendance devices tenant-specific.
- Confirm all HR workflows work within one tenant and cannot transition records from another: onboarding, leave, payroll, recruitment, performance, letters, visa/compliance, requests, resignation, termination, clearance, and final settlement.
- Move private document bytes to managed object storage with encryption, tenant-prefixed object keys, short-lived signed URLs, malware scanning, content/size validation, retention, and deletion lifecycle. Do not expose private HR files from a public uploads directory.
- Include tenant identity in PDF/CSV export authorization and avoid cross-tenant data in filenames, templates, caches, and logs.
- Create plan feature flags/entitlements in a server-owned service; do not scatter plan-name checks through the UI.
- Design tenant deletion/export workflow with legal retention and audit requirements before enabling self-service deletion.

### Phase 6 — Billing and SaaS lifecycle

- Integrate a selected payment provider through verified signed webhooks; make webhook handling idempotent and replay-safe.
- Add subscription, plan, billing customer, invoice/payment state, trial, cancellation, and entitlement records without putting card data in this app.
- Enforce seats, employee limits, and feature entitlements on the server, with clear admin-visible usage and upgrade paths.
- Define behavior for delinquency, failed payment, cancellation, plan downgrades, tax changes, refunds, and customer data export.
- Add billing audit records and reconcile provider state periodically rather than trusting only webhook delivery.

### Phase 7 — Production operations, backup, and security

- Select production database and managed object storage with durable volumes, encryption at rest/in transit, network controls, connection pooling, and separate credentials per environment.
- Configure automated encrypted off-host PostgreSQL backups, object versioning/backup, retention, alerting, and a documented owner. Local copies alone do not satisfy disaster recovery.
- Define and publish RPO/RTO targets; perform restore drills into an isolated environment and verify row counts, files, auth, and tenant boundaries.
- Install and monitor backup scheduling in the actual production environment. The current Windows Task Scheduler script is a local-host helper and is not production confirmation.
- Set secrets from a secrets manager, rotate existing credentials, enforce secure cookies/TLS, validate CSP, rate limits, CSRF/origin controls, and outbound mail safety.
- Add uptime/readiness monitoring, database saturation/connection alerts, error reporting with PII scrubbing, structured tenant-aware logs, audit retention, and incident response/on-call ownership.
- Add data retention, export, deletion, privacy policy, terms, and security incident procedures appropriate to launch markets.

### Phase 8 — Quality, accessibility, and launch

- Build CI gates: format/lint on application source, TypeScript, unit tests, integration tests against PostgreSQL, migration checks, production build, dependency/security scan, and secret scan.
- Add tenant isolation tests as required checks for every new data-access feature.
- Browser QA all 65 current App Router routes (then-current inventory) on desktop and mobile with staff, manager, HR, finance, admin, and platform support accounts. Verify role-specific navigation, permissions, empty/error/loading states, keyboard use, and accessibility.
- Re-run employee directory/photo parity and resignation letter upload/download checks after tenant scoping and object-storage migration.
- Load-test onboarding, employee search, dashboard aggregates, payroll, exports, and tenant-switch behavior using realistic tenant sizes; test noisy-neighbor controls.
- Pilot with one internal tenant and a small group of isolated customer tenants before general availability. Define rollback and data-restore decision points.

## Suggested implementation order and deliverables

| Milestone | Main deliverable | Exit gate |
|---|---|---|
| M0 | Architecture decisions, threat model, PostgreSQL migration baseline | Fresh and upgraded database migrations pass |
| M1 | Tenant + membership + active-tenant context | Membership and session tests pass |
| M2 | Tenant ownership and safe data backfill | All existing rows belong to the default tenant |
| M3 | Tenant-scoped data access and API/action enforcement | Cross-tenant adversarial suite passes |
| M4 | Tenant onboarding, invitations, user/role administration | Owner can onboard/manage members end to end |
| M5 | Tenant-specific configuration and private file storage | Core HR workflows pass per tenant |
| M6 | Billing, plans, entitlements, SaaS lifecycle | Webhook and entitlement tests pass |
| M7 | Production backup, restore, monitoring, security operations | Restore drill meets approved RPO/RTO |
| M8 | Browser QA, pilot, launch approval | All launch gates are signed off |

## Definition of production-ready multi-tenant SaaS

Do not launch multiple customer organizations until all are true:

- Every customer-owned row and file is tied to a tenant and every request is authorized against the active membership.
- Cross-tenant access tests fail safely across all code paths, including background jobs and exports.
- PostgreSQL migrations are reproducible from an empty database and from the current single-company production baseline.
- Existing data is mapped to a default organization and reconciled without loss.
- Tenant onboarding, role administration, user suspension, export, and support audit flows work without direct database edits.
- Production backups are encrypted and off-host; a restore drill has succeeded and meets the approved RPO/RTO.
- Billing entitlements are server-enforced and payment webhooks are verified and idempotent.
- Build, typecheck, lint, automated tests, browser QA, security review, and operational sign-off pass on the release commit.
- Privacy, retention, security incident, support, and deployment ownership are documented.

## Existing employee-module work carried forward

The earlier implementation plan's employee-module objectives remain required regression checks during Phase 8:

- Desktop and mobile employee views must use the same employee records, filters, profile links, and actions.
- Employee photos must share null-safe normalization and fallback behavior across the directory and profile page.
- The employee detail page must remain null-safe and consistent with the directory.
- Responsive navigation, page hero, and table layouts must avoid clipping at mobile and desktop breakpoints.
- Letter lists must safely handle absent employee relations.

## Working rules

- Implement one migration slice at a time; keep it small, reviewed, and reversible.
- Do not deploy schema changes with ad-hoc production `db push` after the PostgreSQL migration baseline is established.
- Never merge a feature that accepts tenant IDs from the browser without resolving and validating membership server-side.
- Preserve historical HR, payroll, exit, and audit records; tenant offboarding must follow retention policy rather than cascade-delete evidence.
- Update this plan and the architecture decision records as decisions change; report completed milestones with commit, migration, test, and deployment evidence.
