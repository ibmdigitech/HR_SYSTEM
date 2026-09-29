<#
.SYNOPSIS
    Restores a .sql dump produced by backup.ps1 into the HR database.

.DESCRIPTION
    Takes a safety backup of the CURRENT database before touching anything, so a
    restore from the wrong file is itself recoverable.

    Restore strategy: drop the schema, then load.
      The dump is written with --clean --if-exists, but a plain SQL restore into
      a schema that already holds tables is order-dependent and fails on objects
      created after the dump was taken. Dropping and recreating `public` first
      makes the restore deterministic: the result is exactly the state at dump
      time, with nothing extra and nothing missing.

      ON_ERROR_STOP=1 makes psql abort on the first failing statement instead of
      ploughing on. Without it psql prints errors but still exits 0, and a
      half-restored database is reported as a successful restore.

    The dump is copied into the container with `docker cp` and loaded from disk
    inside it, rather than piped through stdin. A PowerShell pipeline would
      re-encode the file, and an encoding change across a multi-megabyte SQL dump
      corrupts non-ASCII names; the Arabic letter templates are the likely
      casualty.

    Exit codes: 0 success, 1 failure.

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a BOM-less
    file using the system ANSI code page, so a UTF-8 em dash inside a string
    literal is decoded as CP1252 bytes and yields a stray double quote, which
    terminates the string and produces an unparseable script. ASCII here is a
    correctness constraint, not a style choice.

.EXAMPLE
    # Restore the most recent dump, with confirmation
    powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1

.EXAMPLE
    # Restore a specific dump unattended (Task Scheduler)
    powershell -ExecutionPolicy Bypass -File .\scripts\restore.ps1 `
        -Path .\backups\hr_system-20260928-020000.sql -Force
#>

[CmdletBinding()]
param(
    # Dump to restore. Defaults to the most recent one in -BackupDir.
    [Parameter(Position = 0)]
    [string] $Path,

    [string] $Container = 'hr-postgres',
    [string] $DbUser = 'postgres',
    [string] $DbName = 'hr_system',

    # Resolved in the body, not here: under Windows PowerShell 5.1 $PSScriptRoot
    # is empty inside a param() default, so `Join-Path $PSScriptRoot ...` throws
    # before the script runs a single line.
    [string] $BackupDir = '',

    # Skip the interactive confirmation. Required for unattended runs.
    [switch] $Force,

    # Skip the automatic pre-restore backup. Only for a restore onto a
    # deliberately empty database.
    [switch] $SkipSafetyBackup
)

$ErrorActionPreference = 'Stop'

function Write-Fail {
    param([string] $Message)
    Write-Error "restore.ps1: $Message"
    exit 1
}

# --- Resolve the dump -------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
    $BackupDir = Join-Path $PSScriptRoot '..\backups'
}

$backupRoot = [System.IO.Path]::GetFullPath($BackupDir)

if ([string]::IsNullOrWhiteSpace($Path)) {
    if (-not (Test-Path -LiteralPath $backupRoot)) {
        Write-Fail "no dump given and no backup directory at $backupRoot."
    }
    $latest = Get-ChildItem -LiteralPath $backupRoot -Filter "$DbName-*.sql" -File |
        Sort-Object -Property Name -Descending |
        Select-Object -First 1
    if ($null -eq $latest) {
        Write-Fail "no dumps found in $backupRoot. Run scripts\backup.ps1 first."
    }
    $dumpFile = $latest.FullName
}
else {
    $dumpFile = [System.IO.Path]::GetFullPath($Path)
}

if (-not (Test-Path -LiteralPath $dumpFile)) {
    Write-Fail "dump not found: $dumpFile"
}
if ((Get-Item -LiteralPath $dumpFile).Length -lt 1) {
    Write-Fail "dump is empty: $dumpFile"
}

# --- Preflight --------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail 'docker was not found on PATH.'
}

$state = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "container '$Container' was not found. Pass -Container, or start the stack."
}
if ($state -ne 'true') {
    Write-Fail "container '$Container' exists but is not running. Start it: docker start $Container"
}

Write-Host "[restore] dump   : $dumpFile"
Write-Host "[restore] target : $Container / $DbName"

# --- Confirmation -----------------------------------------------------------
# A restore is destructive and irreversible, and the wrong -Path is the single
# most likely way to lose good data. Confirmation is mandatory unless -Force.
if (-not $Force) {
    $answer = Read-Host ("REPLACE ALL DATA in '{0}' with the contents of '{1}'? Type 'RESTORE' to continue" -f $DbName, (Split-Path $dumpFile -Leaf))
    if ($answer -cne 'RESTORE') {
        Write-Host '[restore] aborted. Nothing was changed.'
        exit 0
    }
}

# --- Safety backup ----------------------------------------------------------
# Taken before the first destructive statement, not after. This is the only
# thing standing between a mistyped -Path and an unrecoverable database.
if (-not $SkipSafetyBackup) {
    $safety = Join-Path $PSScriptRoot 'backup.ps1'
    Write-Host '[restore] taking a safety backup of the current database first...'
    & $safety -Container $Container -DbUser $DbUser -DbName $DbName -BackupDir $backupRoot
    if ($LASTEXITCODE -ne 0) {
        Write-Fail 'the safety backup failed. Aborting rather than destroying data with no way back.'
    }
}

# --- Stage the dump inside the container ------------------------------------
$remoteFile = "/tmp/restore-{0}.sql" -f (Get-Date -Format 'yyyyMMdd-HHmmss')

Write-Host "[restore] copying dump into $Container..."
& docker cp $dumpFile "${Container}:$remoteFile"
if ($LASTEXITCODE -ne 0) {
    Write-Fail "could not copy the dump into '$Container'."
}

# --- Drop and recreate the schema -------------------------------------------
# 'ON_ERROR_STOP=1' is a psql variable passed as two separate arguments; the
# -cON_ERROR_STOP=1 single-token form is not understood by psql.
Write-Host '[restore] resetting schema public...'
& docker exec $Container psql -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
if ($LASTEXITCODE -ne 0) {
    & docker exec $Container rm -f $remoteFile 2>$null
    Write-Fail 'could not reset the public schema. Aborting before any data was loaded.'
}

# --- Load -------------------------------------------------------------------
Write-Host '[restore] loading dump (this can take a while)...'
& docker exec $Container psql -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f $remoteFile
$loadExit = $LASTEXITCODE

# The staged copy holds the entire employee record inside the container /tmp.
# It is removed whether the load succeeded or failed.
& docker exec $Container rm -f $remoteFile 2>$null

if ($loadExit -ne 0) {
    Write-Fail "psql exited with code $loadExit while loading. The database is in an unknown state; restore the safety backup taken above."
}

# --- Post-restore sanity check ----------------------------------------------
# Not a substitute for the full verification in OPS_RUNBOOK.md, but it fails
# fast on the two ways a restore silently produces an empty database: the dump
# loaded into the wrong schema, or it contained no tables at all.
$tableCount = & docker exec $Container psql -U $DbUser -d $DbName -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
if ($LASTEXITCODE -ne 0) {
    Write-Fail 'the dump loaded but the database could not be queried afterwards.'
}

$tableCount = ([string]($tableCount | Select-Object -First 1)).Trim()
if ($tableCount -eq '0') {
    Write-Fail 'the restore completed but the public schema contains no tables. This dump is empty or wrong.'
}

Write-Host "[restore] complete. $tableCount table(s) present in schema public."
Write-Host '[restore] VERIFY before declaring success: see docs/audit/OPS_RUNBOOK.md'
exit 0
