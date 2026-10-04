# Production Deployment & Database Operations — Infrastructure Audit

Audit date: **2026-10-04**
Scope: migrations, environments, CI/CD, Docker, health checks, backup integration, seed safety
Method: live inspection of the repository and both running databases. Nothing was modified.

---

## HEADLINE FINDING

**`prisma migrate deploy` cannot run against this project at all, and production
schema changes are currently applied by `prisma db push` — direct DDL against the
live database with no migration record, no review, and no rollback.**

This is not a theoretical risk. It is the current state, verified below.

---

## 1. Migration system — CRITICAL FAIL

### 1.1 The migration history is for the wrong database engine

```
$ npx prisma migrate status
Error: P3019
The datasource provider `postgresql` specified in your schema does not match the
one specified in your migration_lock.toml, `sqlite`.
```

`prisma/migrations/migration_lock.toml` contains:

```toml
provider = "sqlite"
```

`schema.prisma` declares `provider = "postgresql"`. Prisma refuses to proceed.

### 1.2 The migration files are SQLite, not PostgreSQL

```
prisma/migrations/  -> 11 folders, 10 .sql files
files containing SQLite-only syntax (AUTOINCREMENT / PRAGMA / backtick COLLATE): 3
```

The project was developed against SQLite and later moved to PostgreSQL. The
migration folder was never re-baselined, so it describes a schema history for a
database engine the production system does not use.

### 1.3 Neither database has any migration history

```
_prisma_migrations table in hr-postgres   (dev,  :5433) : ABSENT
_prisma_migrations table in hr_system_db  (prod, :5432) : ABSENT
```

Both databases were built with `prisma db push`, which applies schema changes as
DDL and records nothing.

### 1.4 What this means in practice

| Action | Result today |
|---|---|
| `prisma migrate deploy` (production) | **Fails immediately** with P3019 |
| `prisma migrate status` | Fails with P3019 |
| `prisma db push` (production) | **Works** — and is the only thing that works |
| Editing a column, then `db push` | Applies DDL straight to production. No migration file, no record, no `down`, no diff, no review gate. A destructive edit is indistinguishable from an additive one until it has already run. |

`db:push` is also exposed as a package script (`npm run db:push`), one command
away in any shell pointed at production.

**This is the single largest deployment risk in the project.** The brief's
absolute rules 2, 3 and 4 (`migrate dev`, `migrate reset`, `db push` in
production) are all currently reachable, and rule 4 is the *only* mechanism that
works.

---

## 2. Environments

| Environment | Database | Container | Identified by |
|---|---|---|---|
| Development | `hr_system` | `hr-postgres` :5433 | `.env` `DATABASE_URL` |
| **Staging** | **none** | **none** | **does not exist** |
| Production | `hr_system` | `hr_system_db` :5432 | `docker-compose.yml` `db` service, volume `hr_system-main_pgdata` |

- No staging environment exists. The brief's dev → staging → production pipeline
  has no middle stage, so nothing is rehearsed before production.
- Production is correctly identified and correctly separated by container, port
  and named volume.
- The backup system already has `BACKUP_ENV` / `BACKUP_CONTAINER` targeting with
  a production fail-safe (`scripts/backup.ps1`), so **backups** know the
  difference. The **migration** path does not, because it does not exist.

---

## 3. CI/CD

`.github/workflows/build-test.yml` — one workflow, `build-test`.

**What it does:** checkout → Node 20 → `npm ci` → `prisma generate` → typecheck →
test → lint → build, on push/PR to `main`/`master`.

**What it does not do:** deploy, migrate, publish, or touch any environment. No
`deploy:`, no `environment:`, no `secrets:`, no registry.

**Critical gap — migrations are never exercised in CI:**

```yaml
- name: Generate Prisma Client
  run: npx prisma generate
  env:
    DATABASE_URL: "file:./dev.db"     # SQLite file, not PostgreSQL
```

CI points at a **SQLite file**, not a PostgreSQL instance, and never runs
`migrate deploy`. A migration can therefore merge green and still fail against
PostgreSQL. Given finding 1, no migration in this repository has ever been
verified against the production engine by anything.

There is no staging deploy, no production approval gate, and no deployment
record.

---

## 4. Docker

```
Dockerfile           tracked
docker-compose.yml   tracked   ->  db (hr_system_db, postgres:15-alpine, volume hr_system-main_pgdata)
                                ->  app (hr_system_app, DATABASE_URL ...@db:5432)
```

Both are version-controlled. The production stack is coherent: a named volume,
a dedicated `db` service, and the app depending on it.

Note the production database is **postgres:15-alpine** with user `hr_admin`,
while development is **postgres:16** with user `postgres`. A migration must
therefore be valid on both PostgreSQL 15 and 16.

There is no separate staging compose file and no Dockerfile variant per
environment.

---

## 5. Deployment commands

`package.json` contains **none** of the commands the brief specifies:

```
Present : db:push, db:studio, seed, check:db
Absent  : db:migrate:dev, db:migrate:deploy, db:migrate:status,
          deploy:preflight, deploy:staging, deploy:production, deploy:rollback,
          health:check, production:check
```

`db:push` being present and `migrate:deploy` being absent is the finding from
section 1 expressed as a one-line summary: **the unsafe command is wired up and
the safe one is not.**

There is also no deployment lock, so nothing prevents two concurrent runs from
applying schema changes against production simultaneously.

---

## 6. Health & readiness

| Endpoint | Status |
|---|---|
| `/api/health` | **exists** (`app/api/health/route.ts`) — used by `scripts/healthcheck.ps1`, which distinguishes APP_DOWN from DATABASE_DOWN |
| `/api/ready` | absent |

Health checking is the strongest part of the current setup. Readiness, which
would additionally fail on an incomplete migration state, does not exist — and
could not be implemented meaningfully until migrations do.

---

## 7. Backup integration (already delivered)

| Capability | State |
|---|---|
| Backup with validation + SHA-256 | working, negative-tested |
| Production targeting (`BACKUP_ENV` / `BACKUP_CONTAINER`) | working, fails safe on mismatch |
| Restore drill (scratch container, EXACT/MONO) | working, 13 integrity + 12 smoke checks |
| Scheduled task | **not registered** — needs an elevated terminal |
| Off-site copy | **NOT CONFIGURED** |

This is the part of the deployment story that is genuinely production-shaped. The
migration path is the part that is not, and it is the part that risks data.

**Gap:** the backup system is not yet wired as a mandatory pre-migration step.
Nothing enforces "backup before schema change" today.

---

## 8. Seed safety

`npm run seed` → `node scripts/seed-standalone.js`.

Not production-gated. `scripts/seed-standalone.js` and the standalone seeder were
reviewed earlier in this engagement for idempotency, but there is no
`APP_ENV=production` refusal, so running the seed against production is a
matter of operator discipline rather than a safeguard.

---

## 9. Documentation state

| Document | Exists | Covers |
|---|---|---|
| `docs/operations/BACKUP_AND_RESTORE.md` | yes | backup, restore, DR — thorough |
| `docs/audit/BACKUP_DISASTER_RECOVERY_AUDIT.md` | yes | backup readiness |
| `docs/deployment/*` | **none** | — |

There is no deployment runbook, no migration guide, no rollback decision tree and
no staging guide. An engineer today has no documented answer to "I need to add a
column — what do I run?"

---

## 10. Acceptance matrix

```
Environment separation (dev/prod)     PARTIAL  prod is correctly separated; staging absent
Staging environment                   FAIL     does not exist
Prisma migrations usable              FAIL     P3019 - lock is sqlite, schema is postgresql
Migration history in database         FAIL     no _prisma_migrations in dev or prod
Production schema mechanism safe      FAIL     db push only; unreviewed DDL
CI runs migrations                    FAIL     CI uses SQLite, never migrates
CI/CD deploy capability               FAIL     build-only
Deployment commands                   FAIL     none present
Deployment lock                       FAIL     absent
Health endpoint                       PASS
Readiness endpoint                    FAIL
Production backup before migration    FAIL     not enforced
Backup validation                     PASS
Restore drill                         PASS
EXACT/MONO verification               PASS
Rollback procedure                    FAIL     no application rollback, no decision tree
Deployment history                    FAIL     absent
Seed safety in production             FAIL     no environment guard
Documentation                         PARTIAL  backup only; no deployment docs
```

**7 PASS · 4 PARTIAL · 12 FAIL**

---

## 11. Recommended sequence

Ordered by dependency and risk. Each step is independently shippable.

1. **Re-baseline migrations for PostgreSQL and adopt `migrate deploy` as the only
   production path.** Everything else depends on this. Do it as its own change,
   with a backup, on a COPY of production first.
2. **Disable `db:push` against production** — an explicit refusal in the script
   rather than removing it, so developers get a message instead of a missing
   command.
3. **Provisional migration safety scanner** — flag DROP/TRUNCATE/NOT NULL without
   default in pending migrations, block by default, allow explicit override with a
   recorded reason.
4. **Staging environment** — a real PostgreSQL instance, seeded from a production
   *structure* dump, not a fresh empty database. This is the single biggest
   quality gain, because it is what would have caught finding 1.
5. **CI pointed at PostgreSQL**, running `migrate deploy` against an ephemeral
   service container.
6. **Preflight + production deploy commands**, wired to backup-before-migrate.
7. **Deployment lock and deployment history.**
8. **Readiness endpoint**, failing on incomplete migration state.
9. **Application rollback + the decision tree.**
10. **Seed production guards.**
11. **Deployment documentation.**

RPO/RTO remain business decisions and are not in scope for this audit.

---

## 12. Direct answer to "how do I edit a section safely after deployment?"

Today, honestly:

> There is no safe procedure. Editing `schema.prisma` and running
> `npx prisma db push` against production applies DDL directly to the live
> database. It works, it is what the project has always done, and it leaves no
> record. `prisma migrate deploy` — the command that *would* be safe — cannot run,
> because the migration folder is locked to SQLite.

Until step 1 of the recommended sequence is done, the honest mitigation is:
take a verified backup first (`scripts/backup.ps1` with
`BACKUP_ENV=production`), make the change on a **copy** of the production
database, and only then apply it. The backup system is solid; the migration path
is the gap.
