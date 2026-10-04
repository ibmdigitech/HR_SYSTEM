# BACKUP AUDIT — HRMS PostgreSQL

Audit date: 2026-10-04
Auditor: automated session audit
Scope: `scripts/*.ps1`, `docker-compose.yml`, `.env`, `.gitignore`, Settings UI, scheduling

Nothing was modified to produce this document. Every line below is backed by a
file read or a live command against the running host.

---

## BACKUP AUDIT

```
Backup script:        PRESENT and correct. scripts/backup.ps1, 198 lines.
                      Runs pg_dump INSIDE the container (deliberate: guarantees
                      the dump tool's major version matches the server, and needs
                      nothing installed on the host). Captures pg_dump's exit
                      code via Start-Process rather than a PowerShell pipeline.
                      Removes the dump on non-zero exit and on empty output, so a
                      truncated file can never be mistaken for a good backup.
                      Retention runs only AFTER a verified dump exists.

Restore script:       PRESENT and correct. scripts/restore.ps1, 193 lines.
                      Mandatory typed confirmation unless -Force. Takes a safety
                      backup before the first destructive statement. Drops and
                      recreates schema public for determinism. Uses
                      ON_ERROR_STOP=1 so a half-restore cannot exit 0.
                      Stages the dump via docker cp rather than a pipe, so a
                      multi-MB SQL file is not re-encoded (Arabic templates).
                      Post-restore check rejects a zero-table schema.

Healthcheck:          PRESENT but NOT a backup check.
                      scripts/healthcheck.ps1 is an APPLICATION uptime probe
                      against /api/health. 358 lines. It distinguishes APP_DOWN
                      from DATABASE_DOWN on purpose, and documents exit codes
                      0/1/2/3 for that contract.
                      It performs NO backup, scheduler or checksum check.

Retention:            PRESENT inside backup.ps1 (-Keep, default 14).
                      Sorts by filename descending (timestamp sorts lexically),
                      prunes beyond -Keep. Runs only after a good dump.
                      Not configurable outside the script parameter; no
                      environment override; no log file, only stdout.

Scheduler:            MECHANISM PRESENT, NOT INSTALLED.
                      scripts/register-backup-task.ps1 installs task 'HRMS-Backup'
                      daily at 02:00 with -Force, so re-registration is safe and
                      cannot duplicate.
                      ON THIS HOST THE TASK IS NOT REGISTERED. Confirmed by
                      Get-ScheduledTask. The last 4 dumps are all dated by hand
                      (28/29/30 Sep) and the newest before today was 4 days old.

Backup UI:            PRESENT but STATIC. components/settings/SettingsDrawer.tsx
                      lines 428-433 render a heading, a paragraph and a
                      PowerShell snippet telling the admin to run the installer
                      once. It reports NO state: not last backup, not age, not
                      whether the task exists, not checksum, not off-site.

Off-host storage:     ABSENT. No reference to S3, Azure Blob, OneDrive or any
                      remote destination anywhere in the repo. No OFFSITE_* key in
                      .env.example. Backups exist only on the same disk as the
                      database.

Restore verification: NEVER PERFORMED. scripts/restore.ps1 exists and has never
                      been run. It ends by printing "VERIFY before declaring
                      success" and pointing at docs/audit/OPS_RUNBOOK.md.
                      No scratch-restore drill has ever been recorded.

Monitoring:           NONE for backups. healthcheck.ps1 watches the app only.
                      No backup-age alert, no failed-run alert. Task Scheduler's
                      own LastTaskResult is the only failure signal and nobody
                      reads it.
```

---

## ADDITIONAL FINDINGS

### 1. The backup targets the DEV database (correct here, wrong on a prod host)

`.env` `DATABASE_URL` -> `localhost:5433` -> container `hr-postgres`.
`backup.ps1` default `-Container 'hr-postgres'`. Consistent.

BUT `docker-compose.yml` defines the production stack as `db` /
`container_name: hr_system_db` on host 5432, with `hr_system_app` connecting to
`@db:5432`. On a production host `hr-postgres` does not exist, so the scheduled
task would fail loudly with "container not found" — safe. On a host running BOTH
(as this one) a scheduled task silently backs up the **development** database
while an administrator believes production is covered.

This is the single most important finding in this audit.

### 2. Correction to an earlier statement in this session

I previously described `hr_system_db` as "a leftover from an earlier setup". That
was wrong. It is the production compose database, backed by the named volume
`hr_system-main_pgdata`, and `hr_system_app` depends on it. It must not be
removed. Both containers are in use, for different environments.

### 3. Security posture — correct as it stands

- `backups/` is NOT under `public/`, so dumps are not web-served.
- `backups/.gitignore` contains `*`; `git ls-files backups` returns empty.
- Repo `.gitignore` has `.env*` with `!.env.example`.
- No password is placed on any command line: `pg_dump`/`psql` authenticate over
  the container's local unix socket as the postgres superuser.

Gap: the repo `.gitignore` does not list `backups/`. It is protected only by the
directory's own `.gitignore`, which works but is invisible to anyone reading the
root file.

### 4. `prune-audit-log.ps1` is also unscheduled

It implements SecurityAuditLog retention per PRODUCTION_READINESS_CHECKLIST 9.6
and requires `-Execute` to actually delete. Not registered as a task either, so
the append-only security log grows without bound. Out of scope for the backup
objective; recorded here because it is the same "implemented, zero callers"
pattern.

---

## WHAT IS ALREADY GOOD AND MUST NOT BE REPLACED

The brief says do not replace the working system. Agreed, and the existing
scripts are better than the brief assumes in four specific ways:

1. `pg_dump` inside the container — version-matched, no host prerequisite.
2. `Start-Process` for the dump — the only way to get pg_dump's real exit code.
3. Typed `RESTORE` confirmation plus a pre-restore safety backup.
4. `ON_ERROR_STOP=1` — without it psql reports errors and still exits 0, which
   is how a half-restored database gets declared healthy.

The work is to add validation, checksums, status reporting, off-site support and
a restore drill around this core — not to touch it.

---

## ACCEPTANCE CRITERIA — CURRENT STATUS

```
[PASS] Correct PostgreSQL container used          (dev; see finding 1 for prod)
[FAIL] Daily HRMS-Backup task registered          not installed
[FAIL] Backup generated automatically             no scheduler
[FAIL] Dump integrity verified                    no validation step exists
[FAIL] SHA-256 checksum verified                  no checksums exist
[PASS] Retention working                          -Keep 14, prunes after success
[FAIL] Backup healthcheck working                 none
[FAIL] Scheduler status visible                   none
[FAIL] Off-site configured OR reported            absent entirely
[FAIL] Scratch restore completed                  never run
[FAIL] Restored Employee data verified            never run
[FAIL] Restored AuditLog data verified            never run
[FAIL] Restore procedure documented               points at OPS_RUNBOOK.md only
[PASS] Duplicate container investigated           this document, finding 2
[PASS] No secrets exposed                         verified
[FAIL] Settings Backup UI reflects actual state   static text
[PASS] Existing HRMS workflows unaffected         no app code touched yet
```

Overall at audit time: **NOT READY**.
