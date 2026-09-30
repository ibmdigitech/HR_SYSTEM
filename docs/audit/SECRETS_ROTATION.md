# Secrets Rotation Runbook

**Scope:** `AUTH_SECRET`, the database credentials, and the seeded development/test
accounts. Refer to every secret by **variable name** in this document. The values
are deliberately absent, and they must stay absent from any ticket, chat, commit
message or screenshot.

**Audience:** whoever first deploys this system somewhere other than one developer's
laptop. If the system is only ever run on that laptop, rotation is still worth doing
— the current secret is already public (see below) — but the maintenance window
matters only once other people use it.

---

## 0. Read this first: the current `AUTH_SECRET` is in git

Two committed files reproduce the **live** value of `AUTH_SECRET` verbatim:

| File | Line |
|------|------|
| `docs/audit/ERROR_AUDIT.md` | 31 |
| `docs/audit/MASTER_AUDIT_REPORT.md` | 93 |

They were written as evidence for an earlier fix. The consequence is the important
part: **the session secret currently in use is public to anyone with repository
access**, so replacing the `Get-Random` value with a CSPRNG value changes nothing
about its exposure. The value must be considered compromised and rotated, and the
two lines redacted. Rotating alone is not optional just because the new generator is
better.

Redact them by replacing the value with the variable name:

```
**Fix Applied**: Generated secure AUTH_SECRET (see `.env`; value not recorded here)
```

Redaction in a later commit does **not** remove the value from history — it stays in
every clone that fetched the old commits. Treat the history copy as part of the
exposure. If the repository has ever been pushed anywhere other than a trusted
private host, rotate first and rewrite history second (or, more practically, accept
that the history retains a dead secret and make sure the *live* secret differs from
it, which rotation guarantees).

---

## 1. Inventory

| Variable | Where it lives | What it unlocks | Notes |
|----------|----------------|-----------------|-------|
| `AUTH_SECRET` | `.env` → `auth.ts:35` | Signs/encrypts every session cookie (Auth.js JWE, `session.strategy = 'jwt'`) | Single value, no key ring, no version field. Rotating it is instantaneous and total: there is no overlap window. |
| `DATABASE_URL` | `.env` | Application's PostgreSQL login | Runtime credential. |
| `DIRECT_URL` | `.env` | Prisma migration/introspection login | Usually the same login; see `DB-024` — a privileged credential used on every `db push`. |
| `POSTGRES_PASSWORD` | `___RUN_APP_CLICK_ME.bat:170` and `:200` | Creates the local `hr-postgres` container | Hardcoded in the launcher, so a rotation is incomplete until the launcher matches. |
| `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET` | `.env` | The federated login providers | Empty by default; rotate at the IdP, then update `.env`. |
| Test account passwords | Database, `scripts/seed-standalone.js` | The three seeded accounts | See §4.3. |

Related but separate: `csrf_hash.txt` (root and `hr-system/`) is a **tracked**
artifact (`SEC-026`). If it is a live token, rotate it and remove it from tracking.

---

## 2. Order of operations

The order is not arbitrary. It is cheapest-first and least-disruptive-first, with the
session-invalidating step last so that it is not buried in the middle of a change
whose failure modes are still being discovered.

| # | Rotate | Why here |
|---|--------|----------|
| 0 | **Take a backup** | Everything after this point assumes you can get back. |
| 1 | **Development/test account passwords** | No session invalidation, no downtime, and it removes the credentials that were exposed in a session transcript. If you stop after one thing, do this. |
| 2 | **OAuth client secrets** (if configured) | Independent of this app; only bites users signing in with Google/Microsoft. |
| 3 | **Database credentials** | Requires a coordinated stop: changing the password without changing `DATABASE_URL`/`DIRECT_URL` in the same step takes the app down. |
| 4 | **`AUTH_SECRET` — last** | Logs out every user, everywhere, at once. Do it when the room is quiet, and after the database work has proven itself. |
| 5 | **Redact the two audit lines; rotate `csrf_hash.txt`** | Housekeeping. It is safe to do at any time, but do it so the redaction is in the same change as the rotation that supersedes the value. |

### Why `AUTH_SECRET` goes last

Rotating `AUTH_SECRET` logs out every user. If you do it first, you spend the rest of
the window with logged-out users *and* a half-finished credential migration; every
failed sign-in during a database change looks like a session problem, which makes the
incident harder to diagnose. Doing it last means the disruption is a single, clean,
well-announced event with a known cause.

---

## 3. What breaks during the window

**Rotating `AUTH_SECRET` — the important one.**

`auth.ts` sets `session.strategy = 'jwt'`, so the session is a JWE **encrypted** with
a key derived from `AUTH_SECRET` (`auth.ts:35`). There is no server-side session
table, so:

- **Every** existing session cookie becomes undecryptable. The new key cannot read
  old ciphertext and the old key is gone, so no fallback is possible.
- Every user on every device is signed out at the next request. The symptom is
  `JWTSessionError: no matching decryption secret` if the mismatch is partial (two
  instances with different secrets), and an immediate redirect to `/login` if it is
  clean.
- There is no grace period and no dual-key support. A "soft" rotation — accepting old
  and new secrets simultaneously — is not possible without an Auth.js key-ring
  change. Plan for a hard cutover.
- Anything holding a session outside a browser breaks too: API clients, mobile or
  desktop wrappers, and any test suite that signs in and keeps the cookie.
- The login page itself keeps working; only existing sessions die. Nobody loses
  data, only their login.

**Rotating the database credentials.**

- The application loses its connection the moment the password changes. Keep the
  old credentials available until the app is redeployed with the new ones, or you
  have a hard outage rather than a rolling change.
- `DATABASE_URL` and `DIRECT_URL` must change in the same edit, or `prisma generate`
  / `db push` will fail with an authentication error that looks like a schema
  problem.
- The local container is created by the launcher with a hardcoded password
  (`___RUN_APP_CLICK_ME.bat:170`). If the container is recreated by that line, it
  comes back with the old password and the rotation silently reverts. The launcher
  and `.env` must both be updated, or the container must be reused rather than
  recreated.
- `pg_hba.conf` in the container trusts loopback (`DB-001`). That is a separate
  problem from the password, but it means the password is the *only* thing standing
  between a local process and the database. Rotate it properly; do not rely on the
  trust rule.

**Rotating the test account passwords.**

- Nothing breaks. The forced-change-on-first-login flow means the new value is
  consumed at the next sign-in.
- One real risk: the seed must not revert them. `scripts/seed-standalone.js`
  deliberately does **not** reset the password of an existing account, so re-running
  the seed is safe. If you change the password through a script that *does* write
  `password` on an update, you will silently undo the rotation — check before you
  run it.

---

## 4. Procedures

Values below are written as `<...>` placeholders. Generate them with a CSPRNG and do
not type a memorable value.

### 4.0 Backup first

```bash
docker exec hr-postgres pg_dump -U postgres -Fc hr_system > hr_system_<date>.dump
```

Store it outside the repository. If the container is recreated for any reason during
this runbook, this is the only copy.

### 4.1 `AUTH_SECRET`

Generate a new value. Hex is deliberate — see §5.

```bash
# any one of these; all produce 32 bytes = 256 bits
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

On Windows, if you have the launcher, you do not need a command: it replaces a
placeholder `AUTH_SECRET` in `.env` with a CSPRNG value on the next run and refuses
to start if the result is not usable.

Update the new value in every environment that must share sessions — `.env`,
the deployment platform's environment variables, and any running instance. A partial
rotation is worse than none: two instances with different secrets produce
`no matching decryption secret` on every request that lands on the instance holding
the other secret.

Then, for each operator: clear the site data for the host, or simply sign in again.

**Verify:** sign in works; a page reload does not throw `JWTSessionError`; the server
log shows no repeated `JWTSessionError` after the cutover.

### 4.2 Database credentials

```bash
# 1. inside the container
docker exec -it hr-postgres psql -U postgres -c "ALTER ROLE postgres WITH PASSWORD '<new-password>';"

# 2. in .env - both URLs, in the same edit
#    DATABASE_URL="postgresql://USER:<new-password>@localhost:5433/hr_system"
#    DIRECT_URL="postgresql://USER:<new-password>@localhost:5433/hr_system"

# 3. in the launcher's docker run line, so a recreated container matches
#    ___RUN_APP_CLICK_ME.bat:170 (and the copy of the command in the
#    error message at :200)

# 4. redeploy / restart, then:
npx prisma db push --accept-data-loss=false
```

**Verify:** `npx prisma generate` succeeds (proves the URL parses and authenticates),
the app's dashboard loads, and `SELECT 1` works through the new password.

If you also want to remove the hardcoded launcher password entirely, the honest fix
is to stop passing the secret on the command line: `POSTGRES_PASSWORD` on a `docker
run` command line is visible to every process listing on the host. Use a Docker secret
or an env file (`docker run --env-file`) instead. That is a launcher change and is
out of scope for this runbook.

### 4.3 Development/test accounts

The three accounts the seed creates are, by role:

| Role | Account |
|------|---------|
| `ADMIN` | `admin@company.com` |
| `MANAGER` | `manager@company.com` |
| `STAFF` | `staff@company.com` |

Their passwords were exposed in a session transcript and **must** be rotated before
this system is used in any shared environment. A transcript is not a private
channel: treat every value that ever appeared in one as public.

Rotate each one to a unique, generated value, and hand it to the owner out of band.
Do not use one shared value for all three — sharing a password between an admin, a
manager and a staff account removes the point of having roles at all.

```bash
node -e "const{bcrypt}=require('bcryptjs');const c=require('crypto');
const h=bcrypt.hashSync(c.randomBytes(24).toString('hex'),10);
console.log(h)"
```

then write the resulting hash for each account with Prisma Studio or a short script
that updates only the `password` column. Verify that a fresh hash is what is stored,
and that re-running the seed does not revert it.

**Verify:** the old password no longer authenticates any of the three accounts; each
new password does; and role separation still holds (staff cannot reach admin pages).

---

## 5. Why the launcher writes hex

`___RUN_APP_CLICK_ME.bat` generates `AUTH_SECRET` with
`[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes(32)` — a real
CSPRNG, 32 bytes, 256 bits — and prints it as **64 hex characters** rather than
base64.

The reason is the medium, not the encoding's strength. A `.bat` file is parsed by
`cmd.exe` first and then handed to PowerShell, and base64 output can contain `+`,
`/` and `=`. A secret written in base64 has to survive both parsers, and a single
missed escape either corrupts the secret or breaks the batch file — silently, in a
way that surfaces much later as a session error. Hex uses only `[0-9A-F]`, which is
inert in cmd, in PowerShell, in dotenv, and in a cookie value, and 64 hex characters
is a lossless encoding of the same 32 bytes, so nothing is given up.

`Get-Random` was the previous approach and is **not** a CSPRNG: it is a
pseudo-random generator seeded predictably, so its output is guessable. It was
tracked as `SEC-025` and is now closed for local runs.

---

## 6. Untracking the generated Prisma client

`.gitignore` now ignores `**/prisma/generated/` at any depth, so `npx prisma generate`
stops producing new untracked noise. That is not enough on its own: **a
`.gitignore` entry has no effect on a file that is already tracked.** The root
`prisma/generated/` is still in the index, so it will keep showing as modified after
every generate until it is removed from tracking.

A human must run this — it rewrites the index, which is outside the scope of the
automation that produced this document, and it is worth a human reading the diff first:

```bash
# 1. see exactly what would stop being tracked (27 files, all generated output)
git ls-files prisma/generated

# 2. remove them from the index only; --cached leaves the files on disk
git rm -r --cached prisma/generated

# 3. confirm the rules now take effect
git check-ignore -v prisma/generated/client/index.js

# 4. commit .gitignore together with the removal, as one commit:
#    "chore: untrack generated Prisma client"
git add .gitignore
git commit
```

`-r` is required (it is a directory), and `--cached` is the part that matters: without
it the generated client is deleted from your working copy and every subsequent
`prisma generate` has to rebuild it. This is safe to run twice.

Nothing else needs to change. `prisma/schema.prisma` declares
`output = "./generated/client"`, and the launcher runs `npx prisma generate` before
anything that needs the client, so a fresh clone works. CI already does the same:
`.github/workflows/build-test.yml` has a "Generate Prisma Client" step running
`npx prisma generate` between `npm ci` and `npm run build`, so the build does not
depend on the client being committed. The legacy `hr-system/` tree was already
untracked by commit `97ea9e2`; this is the same treatment for the root half.
`prisma/schema.prisma`, `prisma/seed.js`, `prisma/migrations/**` and
`prisma/dev.db` are source or data and stay tracked.

---

## 7. Policy

- **Never** commit a real value of any variable in this inventory. `.env` is ignored
  (`.gitignore`: `.env*`, re-including only `.env.example`); keep it that way.
- Any secret that appears in a log, a transcript, a document or a commit message is
  compromised. Rotate it; do not just delete the line.
- Rotate `AUTH_SECRET` and the database credentials on a schedule (quarterly is
  reasonable) and immediately after any suspected exposure.
- Production secrets belong in the platform's secret manager, not in a `.env` file on
  a developer's disk. The launcher is a local development tool and will happily
  generate a local secret; it is not a production secret-distribution mechanism.
- Keep secrets **out of the repository documents**. This file is a rotation runbook,
  not a secret store; if you find yourself writing a value here, you are documenting
  a leak.
