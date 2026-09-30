# OPERATIONS RUNBOOK

**Scope:** health checking, backup, restore, credential rotation.
**Owner:** whoever holds the Docker host. **Applies to:** the HR Postgres database.

Every command below was run against this environment. Where a command cannot be
run safely on demand (a restore), the exact procedure is given instead.

---

## 0. What is actually running

Two separate stacks exist. Confusing them is the most common operational mistake
on this host.

| | `hr-postgres` | `hr_system_db` (compose) |
|---|---|---|
| Created by | `___RUN_APP_CLICK_ME.bat` (`docker run`) | `docker-compose.yml` |
| Image | `postgres:16` | `postgres:15-alpine` |
| Host port | **5433** | **5432** |
| Used by | `npm run dev` (`.env` `DATABASE_URL`) | `docker compose up` (containerised app, port 3000) |
| Data volume | **anonymous** — see §2.1 | named `hr_system-main_pgdata` |

`scripts\backup.ps1` and `scripts\restore.ps1` default to `hr-postgres`
(`-Container` / `-DbUser` / `-DbName` override this).

```powershell
docker ps --format "{{.Names}}`t{{.Image}}`t{{.Status}}"
docker volume ls
```

---

## 1. Health check

### 1.1 The endpoint

`GET /api/health` — `app/api/health/route.ts`

| Condition | Status | Body |
|---|---|---|
| Database reachable | `200` | `{"status":"ok","database":"up","timestamp":"2026-09-28T19:57:14.320Z"}` |
| Database unreachable, or `DATABASE_URL` unset | `503` | `{"status":"degraded","database":"down","timestamp":"..."}` |

No auth, no business data, no credentials in the body. Measured cost of the
probe: **0.9 ms** (20 sequential `SELECT 1` in 19 ms), so a poll every few
seconds is safe. `Cache-Control: no-store` prevents any proxy from serving a
stale verdict. Driver errors are logged server-side with the connection string
and `password=` values scrubbed; the response body never contains them.

### 1.2 Run it

```powershell
curl.exe -i http://localhost:3000/api/health
```

### 1.3 RESOLVED — the endpoint is reachable without a session

This section previously read "BLOCKER — currently unreachable". That is **fixed**,
and the fix was not where this runbook originally said it would be.

`proxy.ts` matches every `/api/**` path, but the gate that actually answers is
NextAuth's `authorized()` callback in **`auth.config.ts`**, which short-circuits
with a `Response` *before* `proxy.ts`'s own callback runs. Editing
`isPublicPath()` in `proxy.ts` alone changes nothing — the request never reaches
it. The applied fix:

- `auth.config.ts` returns `true` for `/api/health` ahead of its public-route branch.
- `proxy.ts` carries a matching `NEVER_REDIRECT_PATHS` entry, so a signed-in
  operator opening the URL in a browser receives JSON rather than a redirect to
  `/dashboard` — the check would otherwise look broken precisely when someone is
  diagnosing why it is down.

Verified anonymously, with no cookie:

```
$ curl.exe -i http://localhost:3000/api/health
HTTP/1.1 200 OK
{"status":"ok","database":"up","timestamp":"..."}
```

Re-run §1.2 yourself to confirm. Then confirm the failure path by stopping the
database:

```powershell
docker stop hr-postgres
curl.exe -i http://localhost:3000/api/health     # expect 503 + {"database":"down"}
docker start hr-postgres
```

The destructive path has been verified against a stub returning the real 503
body; the `docker stop` variant above is equivalent but has not been run.

### 1.4 Wiring it to a monitor

Once §1.3 is confirmed on your own environment, point the uptime monitor at
`/api/health` and treat **non-200 as down**. Use the endpoint as a **readiness**
probe.

Do **not** use it as a Kubernetes **liveness** probe: `503` means the app is
fine and the database is not, and restarting the pod would not help.

---

## 2. Data persistence

### 2.1 The current risk

`hr-postgres` was created with a bare `docker run` and no `-v` flag. The
`postgres` image declares `VOLUME /var/lib/postgresql/data`, so Docker silently
created an **anonymous** volume:

```
c1a9b17b558be6c4305775e14459257e7e4f1d313e4d0d51a985661703979472  (66 MB, PG 16)
```

It survives `docker rm` today, which is why the risk has not yet materialised.
It is still fragile, and it is destroyed by any of:

```powershell
docker rm -v hr-postgres          # -v removes anonymous volumes
docker system prune --volumes
docker volume prune
```

An anonymous volume cannot be reattached by name and is not identifiable in
`docker volume ls` output — recovery from it is guesswork. Fix it with §2.2,
and take a backup first, which is the entire point of §3.

### 2.2 Move `hr-postgres` onto a durable named volume

This destroys and recreates the container. **The data survives because it is
restored from a dump, so the backup step is not optional.**

```powershell
# 1. Back up FIRST. If this fails, stop here.
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1

# 2. Stop the container (do not remove it yet).
docker stop hr-postgres

# 3. Create the named volume.
docker volume create hr-postgres_pgdata

# 4. Recreate the container against it. These values MUST match the old
#    container exactly, or the restore will fail to authenticate.
docker rm hr-postgres
docker run -d --name hr-postgres `
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hr_system `
  -p 5433:5432 `
  -v hr-postgres_pgdata:/var/lib/postgresql/data `
  postgres:16

# 5. Restore into the empty cluster.
powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1 -Force

# 6. VERIFY per section 3.3 before doing anything else.
```

Recover the old values first if you are unsure — they are visible here:

```powershell
docker inspect hr-postgres --format '{{json .Config.Env}}'
```

### 2.3 The compose stack

`docker-compose.yml` declares the named volume `pgdata`, which resolves to
**`hr_system-main_pgdata`**. That volume already exists and already holds the
live data of the compose stack.

> **`name: hr_system-main` at the top of the compose file is load-bearing.**
> Compose derives the project name from the directory name, and this repo is
> checked out as `HR_SYSTEM-git-check`. Without that line the project becomes
> `hr_system-git-check`, compose looks for `hr_system-git-check_pgdata`, finds
> none, creates an empty one, and starts the app against a database with no
> employees in it. Do not remove or rename it.

```powershell
# Validate the file before acting on it. Fails loudly if secrets are unset.
docker compose config
docker compose up -d
docker compose ps
```

`POSTGRES_PASSWORD` and `AUTH_SECRET` are required and are **not** committed.
Set them in `.env` first (section 5.2). Note that `POSTGRES_PASSWORD` is only
read when Postgres initialises an **empty** data directory — changing it later
does not change the existing role's password. See section 5.3.

---

## 3. Backup and restore

### 3.1 Take a backup

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
```

```
[backup] container=hr-postgres database=hr_system
[backup] dumping...
[backup] wrote hr_system-20260928-235355.sql (181.8 KB)
[backup] complete. 0 file(s) pruned; 1 retained.
```

- `pg_dump` runs **inside** the container, so no host-side client install is
  needed and the version always matches the server.
- Written to `backups\<db>-<yyyyMMdd-HHmmss>.sql`, plain text.
- **Refuses to overwrite** an existing file of the same name.
- **Deletes the output** if `pg_dump` fails or writes 0 bytes, so a broken dump
  is never mistaken for a good one.
- **Prunes to the newest 14**, and only *after* a verified-good dump exists.
- Exit code `0` on success, `1` with a message on failure.
- `backups\.gitignore` is written on first run to keep HR data out of git.

| Parameter | Default | Purpose |
|---|---|---|
| `-Container` | `hr-postgres` | container to dump from |
| `-DbUser` / `-DbName` | `postgres` / `hr_system` | role and database |
| `-BackupDir` | `.\backups` | output directory |
| `-Keep` | `14` | dumps retained |

### 3.2 Restore

```powershell
# Most recent dump, with confirmation
powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1

# A specific dump, unattended
powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1 `
  -Path .\backups\hr_system-20260928-020000.sql -Force
```

The confirmation prompt requires typing `RESTORE` exactly. What it does, in
order:

1. **Safety backup of the current database** — taken before anything is
   destroyed. If this fails, the restore aborts. A wrong `-Path` is therefore
   always recoverable. (`-SkipSafetyBackup` opts out; only for restoring into a
   deliberately empty database.)
2. `docker cp` the dump into the container, then
   `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`
3. `psql -v ON_ERROR_STOP=1 -f <dump>` — without `ON_ERROR_STOP` psql reports
   errors but still exits `0`, and a half-restored database would be reported
   as a success.
4. Deletes the staged copy from the container's `/tmp` either way.
5. Sanity check: fails if schema `public` ends up with zero tables.

### 3.3 VERIFY — prove the restore actually worked

**A restore that is not verified is not a restore.** Run all four checks and
confirm the row counts match what the dump was taken with.

```powershell
# a. The dump is real SQL, not a stub. Expect 62 CREATE TABLE and 62 COPY lines.
$f = (Get-ChildItem .\backups\hr_system-*.sql | Sort-Object Name -Descending | Select-Object -First 1).FullName
(Select-String -Path $f -Pattern '^CREATE TABLE').Count
(Select-String -Path $f -Pattern '^COPY ').Count

# b. The database answers and has its tables back.
docker exec hr-postgres psql -U postgres -d hr_system -c "\dt public.*" 
docker exec hr-postgres psql -U postgres -d hr_system -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# c. Business data is actually present, not just an empty schema.
#    The tables are capitalised and therefore case-sensitive, so they need
#    double quotes. In PowerShell 5.1 the working form is a SINGLE-quoted
#    string containing \" escapes. A double-quoted PowerShell string loses the
#    inner quotes to the C runtime and the query fails with
#    'relation "employee" does not exist'.
docker exec hr-postgres psql -U postgres -d hr_system -tAc 'SELECT count(*) FROM \"User\";'
docker exec hr-postgres psql -U postgres -d hr_system -tAc 'SELECT count(*) FROM \"Employee\";'

# d. The application is healthy against it.
curl.exe -i http://localhost:3000/api/health     # expect 200 (see 1.3)
```

Then **log in through the UI** and open `/employees`, `/payroll` and `/letters`.
A restore can pass every SQL check and still leave a row that the application
cannot render.

**Do this once on a throwaway database before you need it.** A backup that has
never been restored is an assumption, not a control.

### 3.4 Schedule it (daily, unattended)

Run daily at 02:00, keeping 14 days.

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\HR_SYSTEM-git-check\scripts\backup.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00am
Register-ScheduledTask -TaskName 'HRMS-Backup' -Action $action -Trigger $trigger `
  -Description 'Nightly pg_dump of hr_system into .\backups'
```

Confirm it fired: `Get-ScheduledTaskInfo -TaskName 'HRMS-Backup'`, then check
that `backups\` gained a file with last night's timestamp.

**Off-host copies are still required.** Dumps on the same disk as the database
do not survive losing the host. `backups\` is on the Docker host's disk; copy it
somewhere else on a schedule you also monitor.

---

## 4. On-call: the database is down

```powershell
docker ps -a --filter "name=hr-postgres"        # is it running?
docker start hr-postgres
docker logs --tail 50 hr-postgres
curl.exe -i http://localhost:3000/api/health    # 503 means the app cannot reach it
```

If the health endpoint returns `503` but the container is up, the detail is in
the application log, not in the response body — by design, the body never
carries driver errors or connection strings.

---

## 5. Rotate credentials

### 5.1 Rotate `AUTH_SECRET` (Gate 3.3 — current value is not from a CSPRNG)

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the output in `AUTH_SECRET` in `.env`, then restart the app:

```powershell
docker compose up -d --force-recreate app     # compose stack
# or, for the dev stack
# restart the running `npm run dev`
```

> **This signs out every user.** Sessions are encrypted with this value, so
> every session is invalidated. Rotate in a maintenance window.

### 5.2 First-time setup for the compose stack

`docker-compose.yml` refuses to start without these two:

```powershell
# Append a strong, URL-safe POSTGRES_PASSWORD and ensure AUTH_SECRET is set.
Add-Content .env "`nPOSTGRES_PASSWORD=$([guid]::NewGuid().ToString('N'))"
```

Use a hex value: the password is interpolated into `DATABASE_URL`, and `@ : / ? #`
in it would produce a malformed connection string. `.env` is git-ignored.

### 5.3 Rotate the database password

Changing `POSTGRES_PASSWORD` in `.env` does **not** change the password of an
existing database — the official image only applies it when initialising an empty
data directory. Change the role itself:

```powershell
docker exec -it hr-postgres psql -U postgres -d hr_system
```

```sql
ALTER USER hr_app WITH PASSWORD 'new-strong-password';
\q
```

Then update `DATABASE_URL` in `.env` to match and restart the application.
Confirm with the health check (§1.2).

### 5.4 Rotate application user passwords

Force a reset rather than setting one directly, so the user is prompted to
choose it:

```powershell
# Flag every account whose credentials must be replaced. Dry run first:
node .\scripts\force-password-rotation.cjs

# Then actually write the flags; users are forced to change at next sign-in.
node .\scripts\force-password-rotation.cjs --apply
```

The script refuses to write without `--apply`, so always run the dry run and
read the account list before applying.

To set one specific password instead:

```powershell
node .\scripts\set-dev-password.cjs <email> <password>
```

Never leave a shared default in place. `password123` must authenticate zero
accounts; if it does, treat it as an incident, not a cleanup task.

---

## 6. Known gaps in this runbook

| Gap | Impact | Fix |
|---|---|---|
| ~~`proxy.ts` gates `/api/health`~~ | — | **RESOLVED (1.3)** — fixed in `auth.config.ts`, verified 200 anonymous |
| `hr-postgres` on an anonymous volume (2.1) | lost on `docker rm -v` / `volume prune` | run 2.2 |
| No off-host backup copy (3.4) | host loss = total data loss | copy `backups\` off-host |
| No alerting on backup failure | a silent backup outage is an outage | watch the exit code |
| `.gitignore` not updated for `backups/` | mitigated at runtime by `backups\.gitignore` | still add `/backups/` to the repo `.gitignore` |
