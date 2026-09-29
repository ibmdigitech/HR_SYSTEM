<#
.SYNOPSIS
    Timestamped logical backup of the HR Postgres database.

.DESCRIPTION
    Runs pg_dump *inside* the database container and writes a plain-text .sql
    file into ./backups.

    Why pg_dump runs inside the container rather than on the host:
      - The postgres image always ships a pg_dump whose major version matches
        the server. A host-installed pg_dump of a different major version
        refuses to run, and installing one is a prerequisite people forget.
      - Nothing has to be installed on the operator's machine to take a backup,
        which is what makes this safe to run from Task Scheduler at 02:00.

    Why the output is plain text (.sql) and not -Fc custom format:
      The dump is meant to be readable with any psql, greppable, and
      restorable with a single `psql -f`. restore.ps1 drops and recreates the
      public schema before loading, so re-restoring over an existing database
      is deterministic rather than dependent on --clean ordering.

    Exit codes: 0 success, 1 failure (with a message on stderr).

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1 -Keep 30
#>

[CmdletBinding()]
param(
    # Container holding the database. `hr-postgres` is the container created by
    # ___RUN_APP_CLICK_ME.bat and used by `npm run dev`.
    [string] $Container = 'hr-postgres',

    # Superuser. Inside the container psql/pg_dump authenticate over the local
    # unix socket, which the official image trusts, so no password is needed
    # and none is ever placed on a command line.
    [string] $DbUser = 'postgres',

    [string] $DbName = 'hr_system',

    # Resolved in the body, not here: under Windows PowerShell 5.1 $PSScriptRoot
    # is empty inside a param() default, so `Join-Path $PSScriptRoot ...` throws
    # "cannot bind argument to parameter 'Path' because it is an empty string"
    # before the script runs a single line.
    [string] $BackupDir = '',

    # How many dated dumps to keep. Older ones are deleted after a successful
    # backup, never before.
    [int] $Keep = 14
)

$ErrorActionPreference = 'Stop'

function Write-Fail {
    param([string] $Message)
    Write-Error "backup.ps1: $Message"
    exit 1
}

Write-Host "[backup] container=$Container database=$DbName"

# --- Preflight --------------------------------------------------------------
# Every one of these has a real failure mode behind it. A backup that fails
# halfway through is worse than no backup, because it looks like one exists.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail 'docker was not found on PATH.'
}

$state = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "container '$Container' was not found. Create it first, or pass -Container."
}
if ($state -ne 'true') {
    Write-Fail "container '$Container' exists but is not running. Start it: docker start $Container"
}

# Confirm the database is reachable and that the role exists, so the failure
# happens here with a clear message rather than as a truncated .sql file.
docker exec $Container psql -U $DbUser -d $DbName -tAc 'SELECT 1' 1>$null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "cannot connect to database '$DbName' as role '$DbUser' inside '$Container'."
}

# --- Destination ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
    $BackupDir = Join-Path $PSScriptRoot '..\backups'
}

$backupRoot = [System.IO.Path]::GetFullPath($BackupDir)
if (-not (Test-Path -LiteralPath $backupRoot)) {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Write-Host "[backup] created $backupRoot"
}

# Refuse to overwrite. This file is named to the second; a collision means a
# run is already in flight, and silently replacing it would destroy the only
# good copy of a backup.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$fileName = '{0}-{1}.sql' -f $DbName, $stamp
$target = Join-Path $backupRoot $fileName

if (Test-Path -LiteralPath $target) {
    Write-Fail "refusing to overwrite an existing backup: $target"
}

# Keep HR data out of version control even though backups/ cannot be listed in
# the repository .gitignore from here. A dump is a full extract of every
# employee's record and must never be committable.
$guard = Join-Path $backupRoot '.gitignore'
if (-not (Test-Path -LiteralPath $guard)) {
    Set-Content -LiteralPath $guard -Value "# Dumps contain the full employee record. Never commit.`n*" -Encoding UTF8
}

# --- Dump -------------------------------------------------------------------
# Start-Process rather than `docker exec ... > file`:
#   - it captures pg_dump's exit code, which a PowerShell pipeline does not;
#   - stdout is redirected byte-for-byte, so the SQL is not re-encoded;
#   - stderr is captured separately for the error message.
# No argument contains a space, so the array is passed through intact.
$dumpArgs = @(
    'exec', $Container,
    'pg_dump',
    '-U', $DbUser,
    '-d', $DbName,
    '--format=plain',
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists'
)

$errFile = Join-Path ([System.IO.Path]::GetTempPath()) ("pgdump-{0}.err" -f $stamp)

Write-Host "[backup] dumping..."
$proc = Start-Process -FilePath 'docker' -ArgumentList $dumpArgs `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $target -RedirectStandardError $errFile

$errText = ''
if (Test-Path -LiteralPath $errFile) {
    $errText = (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)
    Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
}

if ($null -ne $proc -and $proc.ExitCode -ne 0) {
    # A truncated dump is not a backup. Remove it so it can never be mistaken
    # for a good one during a restore.
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Force
    }
    Write-Fail "pg_dump exited with code $($proc.ExitCode). $errText"
}

# An empty file means the dump silently produced nothing. pg_dump can exit 0 in
# some failure modes, so the size is checked rather than trusted.
if (-not (Test-Path -LiteralPath $target)) {
    Write-Fail "pg_dump exited with code 0 but wrote no file. $errText"
}

$size = (Get-Item -LiteralPath $target).Length
if ($size -lt 1) {
    Remove-Item -LiteralPath $target -Force
    Write-Fail 'pg_dump produced an empty file. The dump is not trustworthy.'
}

Write-Host "[backup] wrote $fileName ($([math]::Round($size / 1KB, 1)) KB)"

# --- Prune ------------------------------------------------------------------
# Only after a verified-good dump exists, so retention can never destroy the
# last usable backup.
if ($Keep -lt 1) {
    Write-Fail '-Keep must be at least 1.'
}

$all = @(Get-ChildItem -LiteralPath $backupRoot -Filter "$DbName-*.sql" -File |
    Sort-Object -Property Name -Descending)

$pruned = 0
if ($all.Count -gt $Keep) {
    foreach ($old in ($all | Select-Object -Skip $Keep)) {
        Remove-Item -LiteralPath $old.FullName -Force
        $pruned++
        Write-Host "[backup] pruned $($old.Name)"
    }
}

Write-Host "[backup] complete. $pruned file(s) pruned; $($all.Count - $pruned) retained."
exit 0
