# ⛔ ARCHIVED — this is not the application

**Do not deploy, run, or develop against this directory.**

This is a frozen snapshot of an earlier version of the HR system, kept only for
reference. **The application is the repository root, one level up.**

## Why this matters

A mount-level audit of the repository (see
`docs/audit/PRODUCTION_READINESS_CHECKLIST.md`, item 1.7) established:

| Fact | Evidence |
|---|---|
| This tree is **never typechecked** | `tsconfig.json:33` — `"exclude": ["node_modules", "hr-system"]` |
| It has its own **working deploy script** | `deploy.sh` — `npm install` → `prisma generate` → `prisma db push` → `build` → `pm2` |
| It targets a **different database** | `prisma/schema.prisma:7` — `provider = "sqlite"`, versus PostgreSQL in the root app |
| It ships **committed secrets** | `csrf_hash.txt` is tracked in git, and is not gitignored |
| Its `auth.ts` is a **stale copy** | 3,456 bytes vs 13,073 at the root, with **zero** login rate limiting |

The practical risk: running `deploy.sh` from here succeeds. It reports
"Deployment complete", it does not error, and it ships a build that predates
every P0 security remediation made since — no rate limiting, no centralized
RBAC, no session invalidation on role change — while `prisma db push` writes the
wrong schema to the wrong datastore.

`deploy.sh` now **refuses to run** unless you explicitly opt in:

```bash
HRMS_ALLOW_LEGACY_DEPLOY=1 ./deploy.sh
```

That override exists so the decision stays a human one, not an accident.

## What was fixed here and is NOT here

Everything committed at the repository root since the split — the P0 security
remediation, the staged employee-entry constraints, the recruitment and offer
state machines, the centralized permission resolver, rate limiting, the
approval queue fixes, the health check and global search — exists **only in the
root application**. None of it is in this snapshot.

## Recommendation

Delete this directory, or move it outside the repository. As long as two
deployable applications exist, "which app am I deploying?" has a dangerous
answer, and no amount of documentation fully prevents someone from picking
wrong under time pressure.
