# SaaS Production Readiness Review

**Review date:** 2026-10-02  
**Scope:** Current Next.js application routes, data model, authorization, workflows, operations, and automated checks.  
**Status:** Not production-ready for a multi-tenant SaaS launch.

**Release direction recorded 2026-10-02:** internal, single-company production. Multi-tenant isolation is out of scope for this release. The production hosting target is still undecided, so no deployment has been performed.

This is a source and build review. It does not replace browser-based visual acceptance testing, penetration testing, or a review of the final production hosting configuration.

## Checks completed

| Check | Result |
|---|---|
| Application route inventory | 74 page/API/action entry points found; production build enumerated 65 App Router routes |
| TypeScript | Pass (`npm run typecheck`) |
| Automated tests | Pass (37 test files, 834 tests) |
| Production build | Pass (`npm run build`) |
| ESLint | Fail: 136 errors and 162 warnings after excluding generated and archived trees (`npm run lint`, 2026-10-02) |
| Tenant isolation | Fail: no tenant/organization ownership fields or tenant model found in `prisma/schema.prisma` |

The tenant-isolation result remains a SaaS blocker, but is not a blocker for the selected single-company release. Older reports contain stale findings and counts; use this review as the current release summary and re-verify individual findings against the current source before treating them as open.

## Internal release status

The current repository has a Docker Compose stack and a Vercel configuration, but the user has not selected the production host. Production deployment remains blocked until the target and its secrets, database, backup destination, and rollback procedure are identified.

Confirmed code/configuration work in this refresh:

- Employee archive confirmation now describes retention and restoration instead of saying the record will be deleted.
- Exit cases now have a detail workflow for notice, interview, clearance, manually prepared settlement, approval, payment reference, and final closure. Finalization closes the linked offboarding in the same transaction that ends employment and revokes the HRMS login; HR history is retained. UAE notice/gratuity calculations remain explicit human inputs pending approved company policy.
- ESLint now excludes `node_modules`, archived source, and generated/migration paths from the repository-wide scan. The refreshed lint result still fails with 136 errors and 162 warnings; errors must be resolved before making lint a passing release gate.
- GitHub Actions used the invalid `node-size` input. It now uses `node-version` and includes typecheck and automated-test steps. The workflow still runs lint, which currently fails.

Remaining production sign-off items that require the chosen host or operator access:

- Rotate production credentials and configure `AUTH_SECRET` through the host's secret store.
- Confirm durable PostgreSQL storage, encrypted off-host backups, a successful restore drill, and monitored scheduled backups.
- Configure TLS termination, uptime/error monitoring, and operational ownership.
- Complete role-based browser QA and review every API/action authorization path.
- Complete the user invite/suspend/session-revocation workflow or formally limit who can administer accounts.

## Release blockers

### SaaS-only P0 — No tenant boundary in business data

The Prisma schema has no tenant, organization, or workspace model, and business records are not scoped by a tenant identifier. Application queries such as the dashboard's employee, attendance, payroll, and audit queries operate globally. Adding tenant screens alone would not isolate customer data.

Before onboarding multiple companies, define the organization and membership model, resolve the active tenant from a trusted authenticated context, scope every read/write and background job, revise uniqueness constraints, migrate existing records into a default tenant, and prove cross-tenant denial with integration tests. Include uploaded files, exports, audit records, and backups in the isolation design.

### P0 — Production operations need a deployment-specific sign-off

The operations runbook describes an anonymous Docker volume for the local `hr-postgres` container and a manual Windows Task Scheduler installation for nightly backups. The backup script is not evidence that scheduled backups are installed or that restores work in the target production environment. Confirm durable storage, off-host encrypted copies, retention, restore drills, monitoring, and secret rotation on the chosen host before release.

## High-priority implementation gaps

1. **Authorization needs a complete route/action matrix.** Existing route guards are inconsistent: some pages call shared permission guards, while others contain their own session and role checks. Review every server action and API handler for authentication, permission checks, ownership checks, and tenant scope. A successful production build does not establish those properties.
2. **User access administration is incomplete.** Role request and approval screens exist, but a complete user directory and lifecycle workflow (invite, suspend, revoke sessions, assign company membership, and audit changes) was not found. Settings also contains a “Change Credentials” control that needs confirmation as a functional action.
3. **Backup visibility is operational rather than self-service.** A backup instruction exists in the settings drawer, and a host script registers a scheduled task. The task must be installed and monitored by the operator; the app does not establish whether the scheduler ran or whether a restorable backup exists.
4. **Visual review remains outstanding.** Routes compile, but this audit did not capture each screen at desktop and mobile widths or exercise all role-specific workflows in a browser. Complete a browser QA pass for navigation, empty/error/loading states, forms, dialogs, tables, and keyboard access before launch.

## Recommended release sequence

1. Decide the tenant model and hosting/storage architecture.
2. Implement tenant ownership, membership, scoped queries/actions, and migration of the existing single-company data.
3. Add cross-tenant authorization tests for pages, APIs, server actions, jobs, file downloads, and exports.
4. Finish user invitation/access lifecycle and confirm the intended access-request workflow.
5. Configure production secrets, durable database storage, encrypted off-host backup, restore testing, monitoring, and operational ownership.
6. Complete role-based desktop/mobile browser QA and resolve every broken or confusing workflow.
7. Re-run typecheck, tests, lint, production build, and the security review against the release commit and deployment configuration.

