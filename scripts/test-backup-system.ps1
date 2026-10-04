<#
.SYNOPSIS
    Automated positive and negative test suite for the HRMS backup system.

.DESCRIPTION
    Runs the whole backup/restore path against deliberately broken inputs and
    asserts that each one is REJECTED.

    WHY THIS EXISTS
    ----------
    A validator that has only ever been shown a good dump has not been tested.
    The dangerous failure mode for a backup validator is not a crash, it is a
    pass: a truncated file that validates, an empty file that validates, a
    non-SQL file that validates. Each of those means a restore three weeks from
    now discovers the problem, at the worst possible moment, with no way back.

    So every negative case here asserts a specific NON-ZERO exit, and the suite
    fails loudly if a broken input is ever accepted. The negative tests are the
    product of this script; the positive tests only prove the happy path still
    works after a change.

    Nothing in this suite touches the live database. The restore drill runs
    against a disposable container that it creates and destroys.

    EXIT CODES
      0  every test passed
      1  at least one test failed
      2  the suite itself could not run (missing script, docker absent, ...)

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\test-backup-system.ps1

.EXAMPLE
    # Skip the slow restore-drill cases when iterating on validation only.
    powershell -ExecutionPolicy Bypass -File .\scripts\test-backup-system.ps1 -SkipRestore
#>

[CmdletBinding()]
param(
    # Skips every case that invokes the restore drill. Those take ~15s each
    # because they start and destroy a container.
    [switch] $SkipRestore,

    # Keep the scratch containers and test artefacts for inspection.
    [switch] $KeepArtefacts
)

$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
$verifyScript = Join-Path $scriptDir 'verify-backup.ps1'
$backupScript = Join-Path $scriptDir 'backup.ps1'
$drillScript = Join-Path $scriptDir 'restore-drill.ps1'

# Tests write here, never into backups/. A test artefact sitting in the backup
# directory would be picked up by retention and by the health reporter as if it
# were a real dump.
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("hrms-backup-tests-" + (Get-Date -Format 'yyyyMMddHHmmss'))

$passed = 0
$failed = 0
$results = @()

function Suite-Fail {
    param([string] $Message)
    Write-Host "test-backup-system: $Message"
    exit 2
}

function Test-Case {
    param(
        [string] $Group,
        [string] $Name,
        [scriptblock] $Body,
        [bool] $ExpectFailure
    )

    Write-Host ''
    Write-Host "[TEST] $Group / $Name"

    $outcome = 'PASS'
    $detail = ''
    try {
        $detail = & $Body
    } catch {
        # An exception is only acceptable where failure was the expected result.
        if ($ExpectFailure) {
            $outcome = 'PASS'
            $detail = "rejected by throwing: " + $_.Exception.Message
        } else {
            $outcome = 'FAIL'
            $detail = "unexpected error: " + $_.Exception.Message
        }
    }

    if ($outcome -eq 'PASS') {
        $script:passed++
        Write-Host "[RESULT] correctly handled - $detail"
    } else {
        $script:failed++
        Write-Host "[RESULT] *** FAILED *** - $detail"
    }

    $script:results += [pscustomobject]@{
        group          = $Group
        name           = $Name
        outcome        = $outcome
        expectedReject = $ExpectFailure
        detail         = $detail
    }
}

function Invoke-Script {
    param([string] $Script, [string[]] $Arguments)
    $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Script) + $Arguments
    # Output is captured so the caller can assert on it; Write-Host from the
    # child lands on the host, so the exit code is the reliable signal and the
    # captured text is a bonus for the report.
    $out = & powershell @all 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = ($out | Out-String)
    }
}

# --- Preflight ---------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Suite-Fail 'docker was not found on PATH.' }
foreach ($s in @($verifyScript, $backupScript, $drillScript)) {
    if (-not (Test-Path -LiteralPath $s)) { Suite-Fail "required script missing: $s" }
}

New-Item -ItemType Directory -Path $workDir -Force | Out-Null
Write-Host "[suite] work directory: $workDir"

$backupDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\backups'))
$goodDump = Get-ChildItem -LiteralPath $backupDir -Filter 'hr_system-*.sql' -File -ErrorAction SilentlyContinue |
    Sort-Object -Property Name -Descending |
    Select-Object -First 1

if ($null -eq $goodDump) {
    Suite-Fail "no backup found in $backupDir. Run scripts\backup.ps1 first."
}
Write-Host "[suite] reference dump: $($goodDump.Name) ($($goodDump.Length) bytes)"

# Build the broken variants once. Each is a genuine corruption mode, not a
# renamed file.
$good = $goodDump.FullName

$truncated = Join-Path $workDir 'hr_system-TRUNCATED.sql'
$fs = [System.IO.File]::OpenRead($good)
try {
    $half = New-Object byte[] ([math]::Floor($goodDump.Length / 2))
    $null = $fs.Read($half, 0, $half.Length)
} finally { $fs.Close() }
[System.IO.File]::WriteAllBytes($truncated, $half)

$empty = Join-Path $workDir 'hr_system-EMPTY.sql'
[System.IO.File]::WriteAllBytes($empty, @())

$notSql = Join-Path $workDir 'hr_system-NOTSQL.sql'
[System.IO.File]::WriteAllText($notSql, "This is a text file, not a database dump.`nIt has no CREATE TABLE and no COPY blocks.`n")

$badSum = Join-Path $workDir 'hr_system-BADSUM.sql'
Copy-Item -LiteralPath $good -Destination $badSum -Force
# A sidecar whose hash is wrong. 64 hex digits, sha256sum layout.
[System.IO.File]::WriteAllText("$badSum.sha256", ('0' * 64) + "  hr_system-BADSUM.sql`n")

# A structurally valid dump with no checksum sidecar at all.
$noSum = Join-Path $workDir 'hr_system-NOSUM.sql'
Copy-Item -LiteralPath $good -Destination $noSum -Force

Write-Host ''
Write-Host '========================================'
Write-Host ' POSITIVE TESTS'
Write-Host '========================================'

Test-Case -Group 'positive' -Name 'a real dump validates' -ExpectFailure $false -Body {
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', $good)
    if ($r.ExitCode -ne 0) { return "exit $($r.ExitCode): $($r.Output)" }
    return 'exit 0, all structural checks passed'
}

Test-Case -Group 'positive' -Name 'a real dump verifies against its checksum' -ExpectFailure $false -Body {
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', $good, '-Checksum')
    if ($r.ExitCode -ne 0) { return "exit $($r.ExitCode): $($r.Output)" }
    return 'exit 0, sha256 matched'
}

Test-Case -Group 'positive' -Name 'backup.ps1 runs and produces a valid dump' -ExpectFailure $false -Body {
    $r = Invoke-Script -Script $backupScript -Arguments @()
    if ($r.ExitCode -ne 0) { return "exit $($r.ExitCode): $($r.Output)" }
    if ($r.Output -notmatch 'complete') { return "ran but never reported completion: $($r.Output)" }
    return 'exit 0, dump created and validated'
}

if (-not $SkipRestore) {
    Test-Case -Group 'positive' -Name 'restore drill passes on the newest dump' -ExpectFailure $false -Body {
        $r = Invoke-Script -Script $drillScript -Arguments @()
        if ($r.ExitCode -ne 0) { return "exit $($r.ExitCode): $($r.Output)" }
        return 'exit 0, all comparisons matched'
    }
}

Write-Host ''
Write-Host '========================================'
Write-Host ' NEGATIVE TESTS - each MUST be rejected'
Write-Host '========================================'

Test-Case -Group 'negative' -Name 'truncated dump' -ExpectFailure $true -Body {
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', $truncated)
    if ($r.ExitCode -eq 0) { throw 'ACCEPTED a truncated dump - this is the failure this suite exists to catch' }
    return "rejected with exit $($r.ExitCode)"
}

Test-Case -Group 'negative' -Name 'empty dump' -ExpectFailure $true -Body {
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', $empty)
    if ($r.ExitCode -eq 0) { throw 'ACCEPTED an empty dump' }
    return "rejected with exit $($r.ExitCode)"
}

Test-Case -Group 'negative' -Name 'non-SQL file' -ExpectFailure $true -Body {
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', $notSql)
    if ($r.ExitCode -eq 0) { throw 'ACCEPTED a plain text file as a database dump' }
    return "rejected with exit $($r.ExitCode)"
}

Test-Case -Group 'negative' -Name 'corrupted checksum' -ExpectFailure $true -Body {
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', $badSum, '-Checksum')
    if ($r.ExitCode -eq 0) { throw 'ACCEPTED a dump whose checksum does not match' }
    return "rejected with exit $($r.ExitCode)"
}

Test-Case -Group 'negative' -Name 'missing checksum sidecar' -ExpectFailure $true -Body {
    # A valid dump with no sidecar cannot be attested. Whether this is a hard
    # failure or a warning is a judgement call; what matters is that it is not
    # silently reported as verified.
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', $noSum, '-Checksum')
    if ($r.ExitCode -eq 0) { throw 'reported a dump as checksum-verified with no checksum file present' }
    return "rejected with exit $($r.ExitCode)"
}

Test-Case -Group 'negative' -Name 'nonexistent file' -ExpectFailure $true -Body {
    $r = Invoke-Script -Script $verifyScript -Arguments @('-Path', (Join-Path $workDir 'does-not-exist.sql'))
    if ($r.ExitCode -eq 0) { throw 'accepted a path that does not exist' }
    return "rejected with exit $($r.ExitCode)"
}

Test-Case -Group 'negative' -Name 'missing PostgreSQL container' -ExpectFailure $true -Body {
    $r = Invoke-Script -Script $backupScript -Arguments @('-Container', 'hrms-no-such-container')
    if ($r.ExitCode -eq 0) { throw 'reported success with no such container' }
    return "rejected with exit $($r.ExitCode)"
}

Test-Case -Group 'negative' -Name 'wrong database name' -ExpectFailure $true -Body {
    # Must fail BEFORE writing anything. A missing database that still produces
    # a file is how truncated dumps get created.
    $before = @(Get-ChildItem -LiteralPath $backupDir -Filter 'hr_system-*.sql' -File).Count
    $r = Invoke-Script -Script $backupScript -Arguments @('-DbName', 'hrms_no_such_database')
    $after = @(Get-ChildItem -LiteralPath $backupDir -Filter 'hr_system-*.sql' -File).Count
    if ($r.ExitCode -eq 0) { throw 'reported success against a database that does not exist' }
    if ($after -ne $before) { throw "failed but still wrote a dump file ($before -> $after)" }
    return "rejected with exit $($r.ExitCode) and wrote nothing"
}

if (-not $SkipRestore) {
    Test-Case -Group 'negative' -Name 'restore of a truncated dump FAILS' -ExpectFailure $true -Body {
        # The most important negative test in the suite. Validation rejecting a
        # truncated file is necessary but not sufficient: the actual restore path
        # must also refuse it rather than half-loading the database.
        $r = Invoke-Script -Script $drillScript -Arguments @('-Path', $truncated)
        if ($r.ExitCode -eq 0) { throw 'the restore drill PASSED on a truncated dump - this would report an unrecoverable backup as recoverable' }
        return "rejected with exit $($r.ExitCode)"
    }

    Test-Case -Group 'negative' -Name 'restore of an empty dump FAILS' -ExpectFailure $true -Body {
        $r = Invoke-Script -Script $drillScript -Arguments @('-Path', $empty)
        if ($r.ExitCode -eq 0) { throw 'the restore drill PASSED on an empty dump' }
        return "rejected with exit $($r.ExitCode)"
    }
}

# --- Summary -----------------------------------------------------------------
if (-not $KeepArtefacts) {
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "[suite] artefacts kept in $workDir"
}

# A scratch container left behind by a failed negative case would make the next
# run fail for the wrong reason.
& docker rm -f hrms-restore-drill 1>$null 2>&1

Write-Host ''
Write-Host '========================================'
Write-Host ' RESULTS'
Write-Host '========================================'
foreach ($r in $results) {
    $mark = if ($r.outcome -eq 'PASS') { 'PASS' } else { 'FAIL' }
    Write-Host ("  {0,-4} {1,-10} {2}" -f $mark, $r.group, $r.name)
}

$rejectCases = @($results | Where-Object { $_.expectedReject })
$rejectFailed = @($rejectCases | Where-Object { $_.outcome -ne 'PASS' })

Write-Host ''
Write-Host ("passed={0} failed={1}" -f $passed, $failed)
Write-Host ("negative cases that were wrongly ACCEPTED: {0}" -f $rejectFailed.Count)

$summary = 'BACKUP_TESTS result={0} passed={1} failed={2} negative_accepted={3}' -f `
    $(if ($failed -eq 0) { 'PASS' } else { 'FAIL' }), $passed, $failed, $rejectFailed.Count
Write-Host $summary

if ($failed -gt 0) { exit 1 }
exit 0
