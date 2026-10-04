# Backup and Restore — Operations

**System:** ANTIGRAVITY HRMS
**PostgreSQL source (dev):** container `hr-postgres`, host port **5433**, database `hr_system`
**PostgreSQL source (production compose):** container `hr_system_db`, host port **5432**, volume `hr_system-main_pgdata`
**Document owner:** unassigned — see "Responsible administrator" below
**Last successful restore drill:** **2026-10-04** (`docs/audit/restore-drill-last.json`)
**Next restore drill due:** **2026-11-04** (monthly; see the schedule below)

---

## 1. Recovery objectives — NOT YET APPROVED

These are deliberately blank. They are business decisions, not engineering ones,
and this document does not invent them.

```
RPO (maximum acceptable data loss):
    TBD / business approved value

RTO (maximum acceptable recovery time):
    TBD / business approved value
```

Until an owner signs these off, the schedule below is what the system actually
provides. Measure the real numbers against the approved targets before assuming
the current cadence is sufficient.

| Cadence | Implied RPO | Implied RTO on a dev host |
|---|---|---|
| Daily 02:00 | up to 24h | minutes (dump is 3.5 MB) |

---

## 2. Backup architecture

```
                    ┌─ BACKUP_CONTAINER ─┐
   hr-postgres  ────┤  pg_dump (in-container) ├──►  backups/hr_system-<ts>.sql
   :5433/hr_system  └──────────────────────┘                    │
                                                               ├─► .sql.sha256
   hr_system_db  ──► set BACKUP_CONTAINER to target this        │
   :5432 (prod)       container for production coverage         └─► OFFSITE (see §5)
```

`pg_dump` runs **inside** the container on purpose. The official postgres image
always ships a `pg_dump` whose major version matches the server; a host-installed
`pg_dump` of a different major version refuses to run, and installing one is a
prerequisite people forget. It also means nothing needs to be installed on the
operator's machine, which is what makes the 02:00 scheduled run safe.

> **CRITICAL — which container gets backed up.**
> `BACKUP_CONTAINER` defaults to `hr-postgres`, the **development** database on
> port 5433. `docker-compose.yml` defines a separate **production** database,
> `hr_system_db`, on port 5432, with named volume `hr_system-main_pgdata`.
>
> On a production host `hr-postgres` does not exist, so a scheduled backup fails
> loudly with "container not found" — which is safe. On a host running **both**,
> as the development machine does, a scheduled task silently backs up the
> **development** database while an administrator believes production is
> covered. Set `BACKUP_CONTAINER=hr_system_db` on any production host.

---

## 3. Daily schedule

```
Task name    : HRMS-Backup
Frequency    : Daily
Time         : 02:00 local
Command      : powershell -NoProfile -ExecutionPolicy Bypass
               -File <abs path>\scripts\backup.ps1 -Keep <n>
Exit code    : 0 success, 1 failure
```

Install:

```powershell
# Requires an ELEVATED PowerShell. Run once per host.
powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1

# Preview without registering:
powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -DryRun

# Remove (touches ONLY the task named HRMS-Backup):
powershell -ExecutionPolicy Bypass -File .\scripts\unregister-backup-task.ps1
```

Re-running the installer is safe: it uses `Register-ScheduledTask -Force`, so it
updates the existing task rather than creating a duplicate, and it reports which
of create / update / unchanged it performed.

---

## 4. Backup location, retention and integrity

**Local location:** `backups/` in the repository root. Contains a `.gitignore`
with `*`, and `backups/` is also listed in the repository `.gitignore`. Dumps are
**not** under `public/`, so they are not served by Next.js.

**Retention:** 14 dumps by default. Configurable via `BACKUP_KEEP` (env) or
`-Keep` (parameter; the parameter wins). Retention runs **only after** a verified
dump exists, so it can never destroy the last usable backup, and the newest
successful backup is never deleted even if the keep count is misconfigured to 0.

**Integrity:** every dump gets a `.sql.sha256` sidecar written **after** the dump
passes validation. A checksum over a dump that failed validation would make an
invalid file look attested, so the order is enforced.

Verify on demand:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup.ps1 `
    -Path .\backups\hr_system-20261004-020000.sql
```

---

## 5. Off-site backup

**Current state: NOT CONFIGURED.**

Backups exist only on the same disk as the database. A disk failure, a ransomware
event, or a lost host destroys the database **and** its backups together. This is
the single largest gap in the current arrangement.

```powershell
$env:OFFSITE_BACKUP_ENABLED = 'true'
$env:OFFSITE_BACKUP_PATH    = '\\fileserver\hrms-backups'   # or a local test path
powershell -ExecutionPolicy Bypass -File .\scripts\offsite-backup.ps1
```

Until a destination is configured, `offsite-backup.ps1` prints
`OFFSITE BACKUP: NOT CONFIGURED` and exits non-zero. It never reports protection
it does not have.

**Recommended production destinations** (not implemented — the abstraction is
provider-based so each is a new function behind the same dispatch):

- S3-compatible object storage (AWS S3, MinIO, Cloudflare R2)
- Azure Blob Storage
- OneDrive / SharePoint

Credentials are read from the environment only, never from Git and never from a
command-line parameter — a parameter would land in Task Scheduler history and in
the process list.

**Interim manual control, until off-site is configured:** copy `backups\` to
removable or network storage on a different physical machine.

---

## 6. Health status

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-health.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\backup-health.ps1 -Json
```

Exit codes: **0** healthy, **1** warning, **2** failure.

It verifies the database, the newest dump's existence / age / size / integrity /
checksum, the scheduled task's presence / enabled state / last result / next run,
and off-site status. States are `HEALTHY`, `WARNING`, `FAILED`, `NOT_CONFIGURED`.

`scripts/healthcheck.ps1` is a **separate** tool. It monitors application uptime
against `/api/health` and deliberately distinguishes APP_DOWN from DATABASE_DOWN.
It performs no backup checking and its exit-code contract (0/1/2/3) is unchanged.

---

## 7. Restore procedure — PRODUCTION

> Destructive and irreversible. Every step here replaces all data.

```powershell
# 1. STOP the application so nothing writes during the restore.
#    docker compose stop app        (production)
#    (dev: stop `npm run dev`)

# 2. Confirm what you are about to load.
Get-ChildItem .\backups\hr_system-*.sql | Sort-Object Name -Descending | Select-Object -First 3

# 3. Verify the dump BEFORE restoring into it.
powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup.ps1 -Path <dump>

# 4. Restore. Omit -Force to be asked to type RESTORE.
powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1 -Path <dump>
```

`restore.ps1` takes a safety backup of the current database **before** the first
destructive statement, drops and recreates schema `public`, and loads with
`ON_ERROR_STOP=1` so a failure aborts rather than leaving a half-restored
database that still exits 0.

```powershell
# 5. Verify the restored data before declaring success.
powershell -ExecutionPolicy Bypass -File .\scripts\restore-drill.ps1 -Path <dump>
```

If a restore fails partway, restore the safety backup that `restore.ps1` wrote
into `backups/` before the attempt.

---

## 8. Scratch restore drill (safe — never touches production)

This is the rehearsal. It restores into a disposable container and destroys it,
so it can be run at any time against any dump.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore-drill.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\restore-drill.ps1 -Json
powershell -ExecutionPolicy Bypass -File .\scripts\restore-drill.ps1 -KeepScratch
```

It compares row counts for ten load-bearing tables between the source and the
restored scratch database, then checks that required schema columns exist. **Row
counts must match exactly** — a restore that silently drops rows still looks
alive and is quietly wrong.

Last run: **2026-10-04, PASSED**, 10/10 tables matched, 76 tables in schema
public, all required columns present, 10 seconds.

---

## 9. Disaster recovery procedure

1. **Establish scope.** Is the database gone, the host gone, or the data corrupt?
2. **Preserve the current state.** Copy `backups\` and the container's data
   volume somewhere safe before touching either.
3. **Start a database.** `docker compose up -d db`, or
   `docker run -d --name hr-postgres -e POSTGRES_PASSWORD=... -p 5433:5432 postgres:16`.
4. **Restore** using §7 against the new instance.
5. **Verify** with `restore-drill.ps1`, then application-level checks.
6. **Repoint the application.** Update `DATABASE_URL` if the host or port changed.
7. **Re-seed only what is genuinely missing.** Do not re-run the seeder against a
   restored database; it may duplicate records.
8. **Record the incident** — date, cause, RPO achieved vs target, RTO achieved vs
   target, and what needs fixing.

---

## 10. Rollback and recovery warnings

- **A restore is not undoable.** The only way back is the safety backup.
- **`restore.ps1` drops the entire `public` schema.** Anything created after the
  dump was taken is gone.
- **Do not** run `prisma migrate reset`, `prisma db push --force-reset`, or the
  seeder against a restored production database.
- **Do not** restore a dump taken from the development container into production.
  See §2.
- **A green `backup.ps1` does not mean the backup is good.** Validation and a
  checksum now run automatically, but recoverability is only proven by a
  successful drill (§8). An unverified backup is a hope, not a backup.
- **Retention deletes.** Once a dump is outside the keep window and pruned, it is
  gone. Copy anything you need off-host first.

---

## 11. Responsible administrator

```
Role:                            UNASSIGNED
Name:                             UNASSIGNED
Contact:                          UNASSIGNED
Backup schedule owner:            UNASSIGNED
Restore-drill owner (monthly):    UNASSIGNED
```

**This is an open risk.** An unassigned backup has no owner to notice when it
silently stops running. Assign these before relying on the schedule.

---

## 12. Restore drill schedule

```
Frequency : monthly
Last run  : 2026-10-04  PASSED
Next due  : 2026-11-04
Owner     : UNASSIGNED
Record    : docs/audit/restore-drill-last.json
```

The drill is deliberately not run by the scheduled task. It is expensive, needs a
second container, and a failure should page a human rather than be retried
silently at 02:00.

---

## 13. Open risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Off-site backup not configured — disk failure loses database and backups | **HIGH** | Configure §5 |
| 2 | Daily schedule was not installed on the audit host | **HIGH** | Install §3 |
| 3 | No restore drill had ever been run before 2026-10-04 | **HIGH** | Closed — §12 |
| 4 | RPO/RTO not approved by the business | MEDIUM | Owner sign-off, §1 |
| 5 | Backup container defaults to the DEV database | MEDIUM | Set `BACKUP_CONTAINER`, §2 |
| 6 | No owner for the backup schedule | MEDIUM | §11 |
| 7 | `prune-audit-log.ps1` is also unscheduled, so the security log grows unbounded | LOW | Schedule separately |

---

## 14. Script reference

| Script | Purpose |
|---|---|
| `backup.ps1` | Take a timestamped dump, validate it, checksum it, prune |
| `verify-backup.ps1` | Validate a dump's structure and optionally its checksum |
| `restore.ps1` | Restore a dump into a database (destructive) |
| `restore-drill.ps1` | Prove a dump is recoverable, in a disposable container |
| `register-backup-task.ps1` | Install / update the `HRMS-Backup` scheduled task |
| `unregister-backup-task.ps1` | Remove **only** that task |
| `backup-health.ps1` | Report actual backup / scheduler / off-site status |
| `offsite-backup.ps1` | Copy the newest verified dump off-host |
| `prune-audit-log.ps1` | SecurityAuditLog retention (separate concern) |
| `healthcheck.ps1` | Application uptime probe (NOT a backup check) |
