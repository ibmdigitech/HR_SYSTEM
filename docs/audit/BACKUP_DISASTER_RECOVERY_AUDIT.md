# Backup & Disaster Recovery Audit — HRMS

Audit date: **2026-10-04**
Scope: `scripts/*.ps1`, `docker-compose.yml`, scheduling, off-site, restore drill, Settings UI
Phase 1 findings: `BACKUP_AUDIT_PHASE1.md` (pre-change state)
Operations: `docs/operations/BACKUP_AND_RESTORE.md`

---

## 1. Current state

| | |
|---|---|
| Latest backup | `hr_system-20261004-073806.sql` + `.sha256` |
| Size | 3,695,565 bytes (3.53 MB) |
| Containers | `hr-postgres` :5433 (dev, **backed up**), `hr_system_db` :5432 (production compose) |
| Scheduler | **NOT REGISTERED** — installation requires elevation |
| Off-site | **NOT CONFIGURED** |
| Restore drill | **PASSED 2026-10-04** |
| RPO / RTO | **TBD — not business approved** |

---

## 2. Implemented components

| Component | File | State |
|---|---|---|
| Backup | `scripts/backup.ps1` | **Extended** — validate → checksum → prune |
| Validation | `scripts/verify-backup.ps1` | **New** — 8 structural checks |
| Checksum | `.sql.sha256` sidecar | **New** — written only after validation passes |
| Retention | in `backup.ps1` | **Hardened** — env-configurable, never deletes newest |
| Scheduler install | `register-backup-task.ps1` | **Extended** — elevation check, `-DryRun`, absolute paths |
| Scheduler removal | `unregister-backup-task.ps1` | **New** — scoped to `HRMS-Backup` only |
| Health reporter | `scripts/backup-health.ps1` | **New** — 18 checks, JSON, exit 0/1/2 |
| Off-site | `scripts/offsite-backup.ps1` | **New** — filesystem provider, provider-dispatch seam |
| Restore drill | `scripts/restore-drill.ps1` | **New** — scratch container, exact row comparison |
| Restore | `scripts/restore.ps1` | **Unchanged** |
| Status API | `app/api/system/backup-status/route.ts` | **New** — admin-only |
| Settings UI | `components/settings/backup-status-panel.tsx` | **New** — live state |

`scripts/healthcheck.ps1` was deliberately **not** repurposed. It is an
application uptime probe with a documented 0/1/2/3 exit contract and a purposeful
APP_DOWN vs DATABASE_DOWN split; adding backup status there would conflate two
systems that fail and recover independently.

---

## 3. Automatic scheduling status

**NOT REGISTERED.** `Get-ScheduledTask -TaskName HRMS-Backup` returns nothing.

The installer is correct and refuses to run unelevated with the exact command to
re-run. It could not be installed from this session because registering a
scheduled task requires elevation, which raises a UAC prompt on the operator's
desktop. This is the one acceptance criterion left open, and it is open
honestly rather than worked around.

```powershell
# ELEVATED PowerShell, on the database host:
powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1
```

---

## 4. Backup verification

`verify-backup.ps1` — 8 checks, all passing on the current dump:

```
exists · size · header · create_table(76) · copy_blocks(76) · Employee · AuditLog · terminator
```

Terminology is correct: the counter reports **COPY blocks (COPY statements, not
rows)**, as required.

Negative tests — all correctly rejected with exit 1:

| Input | Result |
|---|---|
| Truncated (first half) | FAIL — `terminator` |
| Empty file | FAIL — 8 checks, first `size` |
| Random text | FAIL — 8 checks, first `size` |
| Corrupted `.sha256` | FAIL — `checksum MISMATCH` |

A validator that only ever passes is worthless, so the negative cases were run
explicitly. A truncated dump was additionally pushed through the **full restore
drill**: psql aborted on `missing data for column "fileType"` via
`ON_ERROR_STOP=1`, `restore.ps1` exited 3, and the drill exited 1.

---

## 5. Retention status

Configured 14, enforced. `BACKUP_KEEP` env with `-Keep` parameter override.

Verified: `BACKUP_KEEP=0` pruned down to **1 retained**, not 0. The newest
successful backup survives a misconfigured keep count. Deletions are logged;
removal is confined to the resolved backup directory.

---

## 6. Off-site status

**NOT CONFIGURED — and reported as such, never as protected.**

```
OFFSITE BACKUP: NOT CONFIGURED     (exit 3, no side effects)
```

When configured to a path, the dump, its checksum and a status sidecar are copied
and the transferred file's SHA-256 is re-verified. A mismatch deletes the copy
rather than leaving something a restore would trust. An unreachable destination
fails loudly with `BACKUP_OFFSITE_FAILED` (exit 2) instead of reporting success.

Credentials: none. The filesystem provider needs none, and future providers are
documented as environment-only because a `-SecretAccessKey` parameter would land
in Task Scheduler history and the process list.

---

## 7. Restore test status

**PASSED 2026-10-04.** Scratch container, destroyed afterwards.

```
Employee 4=4 · User 4=4 · LeaveRequest 3=3 · LeaveBalance 40=40
Attendance 48=48 · SalaryRecord 4=4 · PayrollRun 0=0 · Letter 5=5
AuditLog 91/92 MONOTONIC · SecurityAuditLog 243/244 MONOTONIC
76 tables in schema public · 5 required columns present · 11s
```

Record: `docs/audit/restore-drill-last.json`. Surfaced in the Settings panel.

### A real defect the drill caught in itself

The first full run **failed**: `AuditLog 92 vs 91` and `SecurityAuditLog 244 vs
243`, each short by one. That was not a backup fault — both tables are
append-only, and the drill's own API calls and page loads wrote rows *after* the
dump was taken. Requiring exact equality on an append-only table against a live
source guarantees a false failure.

Tables are now classified `EXACT` or `MONO`. `MONO` requires
`restored <= source` with a bounded lag tolerance, and reports the drift
explicitly rather than hiding it. `restored > source` remains a hard failure —
that is impossible for a point-in-time dump and indicates the wrong source. The
truncated-dump regression test still fails as it must.

---

## 8. Duplicate database / container findings

**CORRECTION to an earlier statement in this session.** `hr_system_db` was
described as "a leftover from an earlier setup". **That was wrong.**

| | `hr-postgres` :5433 | `hr_system_db` :5432 |
|---|---|---|
| Role | **development** | **production** compose `db` service |
| Created by | `___RUN_APP_CLICK_ME.bat` | `docker-compose.yml` |
| Volume | anonymous | `hr_system-main_pgdata` (named) |
| Used by | `.env` `DATABASE_URL`, `npm run dev` | `hr_system_app` via `@db:5432` |
| Backed up | **yes** (current default) | no |

**Both are in use. Neither may be removed.**

The real risk is the inverse of what was assumed: because `BACKUP_CONTAINER`
defaults to `hr-postgres`, a host running **both** takes nightly backups of the
**development** database while an administrator believes production is covered.
On a production-only host the task fails loudly instead, which is safe.
`backup-health.ps1` and `BACKUP_CONTAINER` in `.env.example` both call this out.

---

## 9. Security findings

| Check | Result |
|---|---|
| `backups/` tracked by git | no — directory `.gitignore` `*`, plus root `.gitignore` |
| Dumps under `public/` | no — not web-served |
| `DATABASE_URL` / passwords in git | no — `.env*` ignored, `!.env.example` |
| Password on a command line | no — `pg_dump`/`psql` use the container's local socket |
| Secrets in logs | no — event lines carry filename/bytes/sha only |
| Secrets in the status API | no — admin-only, no credentials in payload |
| Backups exposed publicly | no |

No new finding. One hardening added: the status route resolves every path and
refuses one that escapes the backup directory.

---

## 10. Open risks

| # | Risk | Severity | Action |
|---|---|---|---|
| 1 | Off-site not configured — disk failure loses database **and** backups | **HIGH** | Configure `OFFSITE_BACKUP_PATH` |
| 2 | Daily schedule not installed | **HIGH** | Run the installer elevated |
| 3 | Backup container defaults to the DEV database | **HIGH** | Set `BACKUP_CONTAINER=hr_system_db` in production |
| 4 | No named owner for the schedule | MEDIUM | Assign in `BACKUP_AND_RESTORE.md` §11 |
| 5 | RPO/RTO not business-approved | MEDIUM | Owner sign-off |
| 6 | `prune-audit-log.ps1` unscheduled, security log unbounded | LOW | Schedule separately |
| 7 | Off-site providers (S3/Azure/OneDrive) not implemented | LOW | Add behind the existing dispatch |

---

## 11. Recommended actions

1. **Install the schedule** (elevated) — the only blocker between this and automatic backups.
2. **Configure off-site** — the only protection against total loss on disk failure.
3. **Set `BACKUP_CONTAINER`** per environment.
4. **Assign a backup owner** and approve RPO/RTO.
5. **Repeat the drill monthly** — record to `docs/audit/restore-drill-last.json`.
6. Re-run `scripts\backup-health.ps1` after each change; it will not report
   HEALTHY while the scheduler is unregistered or off-site is unconfigured.

---

## 12. Acceptance criteria

```
[PASS] Correct PostgreSQL container used        hr-postgres :5433, matches .env
[FAIL] Daily HRMS-Backup task registered        NOT installed - needs elevation
[FAIL] Backup generated automatically           no scheduler
[PASS] Dump integrity verified                  8/8 checks, 4 negative tests
[PASS] SHA-256 checksum verified                sidecar written after validation
[PASS] Retention working                        BACKUP_KEEP=0 clamped to 1 retained
[PASS] Backup healthcheck working               18 checks, exit 1, JSON
[PASS] Scheduler status visible                 reported NOT REGISTERED, not assumed
[PASS] Off-site reported NOT CONFIGURED        exact string, exit 3
[PASS] Scratch restore completed                PASSED 2026-10-04
[PASS] Restored Employee data verified          4 = 4
[PASS] Restored AuditLog data verified          91 vs 92 append-only, explained
[PASS] Restore procedure documented             docs/operations/BACKUP_AND_RESTORE.md
[PASS] Duplicate container investigated         both in use, neither removable
[PASS] No secrets exposed                       verified
[PASS] Settings Backup UI reflects actual state  overall=warn, scheduler=warn
[PASS] Existing HRMS workflows unaffected       838/838 tests, build green
[PASS] TypeScript passes                        tsc --noEmit clean
[PASS] Build passes                             55/55 pages
[PASS] Existing tests remain passing            838/838
```

**17 of 19 pass. The 2 failures are the same single action — installing the
scheduled task — which requires an elevated session this environment does not
have.**

### Verdict

**READY WITH WARNINGS**

The backup is verified, checksummed, and **proven recoverable by a passing
restore drill**. It is not yet automatic, and it is not yet off-host. Per the
brief's own rule, this must not be reported READY while the backup is only
local — off-site remains unconfigured, so **READY WITH WARNINGS** is the
highest honest verdict.