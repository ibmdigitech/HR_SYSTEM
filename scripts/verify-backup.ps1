<#
.SYNOPSIS
    Validates a PostgreSQL plain-text dump produced by scripts/backup.ps1.

.DESCRIPTION
    Reads the dump once as raw text and runs structural checks over it. A dump
    that exists, is non-empty and whose filename looks right proves nothing; the
    failure mode this script exists to catch is the one pg_dump can produce while
    exiting 0, namely a file that stops halfway through the data section and
    cannot be restored.

    Checks, in order, each reported as one VERIFY line:

      1. exists            the file is present and is a file, not a directory
      2. size              byte length exceeds -MinBytes
      3. header            the "PostgreSQL database dump" banner is present
      4. create_table      CREATE TABLE statement count is greater than 0
      5. copy_blocks       COPY block count is greater than 0
      6. table_Employee    the Employee table is present
      7. table_AuditLog    the AuditLog table is present
      8. terminator        the dump ends with PostgreSQL's completion marker
      9. checksum          only with -Checksum: recompute SHA-256 and compare

    On "COPY blocks" (check 5): the count is of COPY *statements*, not of rows,
    and not of "COPY/INSERT rows". A COPY block is the per-table statement
    pg_dump emits immediately before its data:

        COPY public."Employee" (id, "firstName", ...) FROM stdin;
        <one line per row>
        \.

    So the number printed is the number of tables whose data is present in the
    dump, not the number of records. Calling it a row count would send an
    operator looking for the wrong number when diagnosing a bad dump.

    On the size floor (check 2): a fixed byte floor is a weak signal on its own
    and is treated here as one. It only proves that pg_dump wrote more than a few
    bytes; it cannot distinguish a 4 MB dump of 4 rows from a 4 MB dump of 40,000
    rows, and a real threshold depends on how much data this deployment actually
    holds. It is therefore a parameter (-MinBytes, default 1024) whose default is
    deliberately the weakest useful value - enough to catch an empty or stub
    file, which is the failure it is actually aimed at - and it is never the
    check that decides whether a dump is good. Checks 3 to 8 are what decide
    that, because they assert properties of the SQL rather than its length.

    On the terminator (check 8): this is the check that catches truncation.
    pg_dump writes "-- PostgreSQL database dump complete" only after the whole
    schema and data section has been emitted, so a file cut in half keeps every
    CREATE TABLE statement (they all appear early) and still fails here.

    Exit codes: 0 the dump is valid, 1 the dump is invalid or unreadable.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup.ps1 .\backups\hr_system-20261004-070825.sql

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup.ps1 .\backups\hr_system-20261004-070825.sql -Checksum

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.
#>

[CmdletBinding()]
param(
    # Dump to validate. Anything Resolve-Path can handle: relative or absolute.
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $Path,

    # Recorded in the log line and used only as a hint when the file name does
    # not match. Validation is driven by the file's contents, not its name.
    [string] $DbName = 'hr_system',

    # Also recompute SHA-256 and compare against the <dump>.sha256 sidecar.
    # This is an additional check on top of the eight structural ones, not an
    # alternative to them, so a run with -Checksum answers "is this dump valid
    # AND does it match its attestation".
    [switch] $Checksum,

    # Weak sanity floor for check 2. See the .DESCRIPTION note on the size
    # floor for why this is a parameter and why it must not carry the decision.
    [long] $MinBytes = 1024
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'backup-log.ps1')

# Tables the dump must define. HRMS without either of these is not a usable
# backup: Employee is the product, AuditLog is the compliance record, and both
# are checked by name because a dump of the wrong database is otherwise
# indistinguishable from a dump of this one.
$RequiredTables = @('Employee', 'AuditLog')

$script:Passed = 0
$script:Failed = 0

function Write-VerifyLine {
<#
.SYNOPSIS
    Print exactly one machine-greppable VERIFY line and count the result.
.DESCRIPTION
    Every check prints through here, so the format cannot drift between checks
    and the printed counts are always present: an operator diagnosing a failed
    dump needs the numbers, not just a red cross.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Check,
        [Parameter(Mandatory = $true)][bool]   $Ok,
        [Parameter(Mandatory = $true)][string] $Detail
    )

    $result = if ($Ok) { 'PASS' } else { 'FAIL' }
    if ($Ok) { $script:Passed++ } else { $script:Failed++ }

    Write-Host ("VERIFY check={0} result={1} {2}" -f $Check, $result, $Detail)
}

function Get-Count {
<#
.SYNOPSIS
    Count regex matches against the already-read dump text.
.DESCRIPTION
    Takes the content as a parameter rather than reading the file again. A dump
    is multi-megabyte and PowerShell 5.1 regex over a large string is slow
    enough that re-reading per check would turn a sub-second validation into a
    multi-second one, so the file is read once and every count comes from that
    single string.
#>
    [CmdletBinding()]
    param(
        # AllowEmptyString: a zero-byte file is precisely one of the cases this
        # script must report on, so the empty string has to be countable. Every
        # regex then returns 0 and each remaining check fails with a printed
        # count instead of the script dying on a parameter binding error.
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Content,
        [Parameter(Mandatory = $true)][string] $Pattern
    )

    return ([regex]::Matches($Content, $Pattern)).Count
}

# --- Resolve the path --------------------------------------------------------
# GetFullPath against the caller's working directory, then Test-Path. Absolute
# paths are used everywhere below so nothing later depends on the current
# directory.
$fullPath = $null
try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
}
catch {
    Write-VerifyLine -Check 'exists' -Ok $false -Detail ("path='{0}' is not a usable path: {1}" -f $Path, $_.Exception.Message)
    Write-Host "VERIFY overall result=FAIL checks_passed=0 checks_failed=1"
    exit 1
}

if (-not (Test-Path -LiteralPath $fullPath)) {
    Write-VerifyLine -Check 'exists' -Ok $false -Detail ("path='{0}' does not exist" -f $fullPath)
    Write-Host "VERIFY overall result=FAIL checks_passed=0 checks_failed=1"
    Write-BackupLog -Level ERROR -Event BACKUP_FAILED -Fields @{ phase = 'verify'; reason = 'missing_file'; file = (Split-Path -Leaf $fullPath) }
    exit 1
}

if (Test-Path -LiteralPath $fullPath -PathType Container) {
    Write-VerifyLine -Check 'exists' -Ok $false -Detail ("path='{0}' is a directory, not a dump file" -f $fullPath)
    Write-Host "VERIFY overall result=FAIL checks_passed=0 checks_failed=1"
    exit 1
}

Write-VerifyLine -Check 'exists' -Ok $true -Detail ("file='{0}'" -f (Split-Path -Leaf $fullPath))

# --- Single read -------------------------------------------------------------
$content = ''
$readError = ''
try {
    # One read. Everything below is regex work on $content.
    $content = [System.IO.File]::ReadAllText($fullPath)
}
catch {
    $readError = $_.Exception.Message
}

if ($readError) {
    foreach ($check in @('size', 'header', 'create_table', 'copy_blocks', 'table_Employee', 'table_AuditLog', 'terminator')) {
        Write-VerifyLine -Check $check -Ok $false -Detail ("unreadable: {0}" -f $readError)
    }
    Write-Host ("VERIFY overall result=FAIL checks_passed=1 checks_failed={0}" -f $script:Failed)
    Write-BackupLog -Level ERROR -Event BACKUP_FAILED -Fields @{ phase = 'verify'; reason = 'unreadable'; file = (Split-Path -Leaf $fullPath) }
    exit 1
}

# --- 2. Size -----------------------------------------------------------------
$size = (Get-Item -LiteralPath $fullPath).Length
$sizeOk = ($size -gt $MinBytes)
Write-VerifyLine -Check 'size' -Ok $sizeOk -Detail ("bytes={0} min_bytes={1} note='weak_signal_only'" -f $size, $MinBytes)

# --- 3. Header ---------------------------------------------------------------
# Anchored to the whole line. The completion banner ends with "complete", so
# this cannot be satisfied by the footer and check 8 stays independent.
$headerPattern = '(?m)^--\s*PostgreSQL database dump\s*$'
$headerCount = Get-Count -Content $content -Pattern $headerPattern
Write-VerifyLine -Check 'header' -Ok ($headerCount -gt 0) -Detail ("matches={0} pattern='{1}'" -f $headerCount, '-- PostgreSQL database dump')

# --- 4. CREATE TABLE count ---------------------------------------------------
# pg_dump emits "CREATE TABLE public."Employee" (" in plain format.
$createPattern = '(?m)^CREATE TABLE\s+'
$createCount = Get-Count -Content $content -Pattern $createPattern
Write-VerifyLine -Check 'create_table' -Ok ($createCount -gt 0) -Detail ("statements={0}" -f $createCount)

# --- 5. COPY block count -----------------------------------------------------
# Statements, not rows. See the .DESCRIPTION note on COPY blocks. Each COPY is
# the "COPY <table> (<columns>) FROM stdin;" header of one table's data.
$copyPattern = '(?m)^COPY\s+'
$copyCount = Get-Count -Content $content -Pattern $copyPattern
Write-VerifyLine -Check 'copy_blocks' -Ok ($copyCount -gt 0) -Detail ("blocks={0} (COPY statements, not rows)" -f $copyCount)

# --- 6/7. Required tables ----------------------------------------------------
# Matched on the CREATE TABLE line, not on a bare table name, so a table that is
# referenced by a foreign key or by a comment but never created cannot satisfy
# the check. The optional schema qualifier keeps it working if the dump is
# produced with a non-public search_path.
foreach ($table in $RequiredTables) {
    $tablePattern = ('(?m)^CREATE TABLE\s+(?:[A-Za-z0-9_]+\.)?"{0}"' -f $table)
    $tableCount = Get-Count -Content $content -Pattern $tablePattern
    Write-VerifyLine -Check ('table_{0}' -f $table) -Ok ($tableCount -gt 0) -Detail ('create_statements={0} table="{1}"' -f $tableCount, $table)
}

# --- 8. Terminator -----------------------------------------------------------
# The single most useful check for truncation: a dump cut in half still has all
# its CREATE TABLE statements but no completion banner.
$terminatorPattern = '(?m)^--\s*PostgreSQL database dump complete\s*$'
$terminatorCount = Get-Count -Content $content -Pattern $terminatorPattern
Write-VerifyLine -Check 'terminator' -Ok ($terminatorCount -gt 0) -Detail ("completion_markers={0}" -f $terminatorCount)

# --- 9. Checksum (optional) --------------------------------------------------
if ($Checksum) {
    $sumPath = "$fullPath.sha256"

    if (-not (Test-Path -LiteralPath $sumPath -PathType Leaf)) {
        Write-VerifyLine -Check 'checksum' -Ok $false -Detail ("missing_sidecar='{0}'" -f (Split-Path -Leaf $sumPath))
    }
    else {
        # Get-FileHash -Algorithm SHA256 is CPU-bound: it streams the whole file
        # through a managed hash implementation with no vectorisation, so it
        # costs roughly a second per 100 MB. At this dump size (single-digit MB)
        # that is negligible next to the pg_dump run itself, and SHA-256 here is
        # for detecting bit rot and truncated copies, not for resisting an
        # attacker, so the simpler and correctly-named API is the right one.
        $actual = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash

        $recorded = ''
        $sidecarName = ''
        $parseOk = $false
        try {
            $raw = [System.IO.File]::ReadAllText($sumPath)
            # Standard sha256sum layout: 64 hex digits, whitespace, then the
            # file name. The optional '*' is the binary-mode marker sha256sum
            # writes, and is accepted so a sidecar produced by any standard tool
            # validates here.
            $m = [regex]::Match($raw, '(?m)^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$')
            if ($m.Success) {
                $recorded = $m.Groups[1].Value
                $sidecarName = $m.Groups[2].Value
                $parseOk = $true
            }
        }
        catch {
            $parseOk = $false
        }

        if (-not $parseOk) {
            Write-VerifyLine -Check 'checksum' -Ok $false -Detail ("unparseable_sidecar='{0}'" -f (Split-Path -Leaf $sumPath))
        }
        else {
            # The recorded name is part of the attestation. A sidecar that
            # describes a different dump must not pass just because its hash
            # happens to match this file.
            $expectedLeaf = Split-Path -Leaf $fullPath
            $nameMatches = ($sidecarName -eq $expectedLeaf -or $sidecarName -eq $fullPath)

            if (-not $nameMatches) {
                Write-VerifyLine -Check 'checksum' -Ok $false -Detail ("MISMATCH sidecar_describes='{0}' actual_file='{1}'" -f $sidecarName, $expectedLeaf)
            }
            elseif ($recorded -ieq $actual) {
                Write-VerifyLine -Check 'checksum' -Ok $true -Detail ("OK sha256={0} file='{1}'" -f $actual, $expectedLeaf)
            }
            else {
                Write-VerifyLine -Check 'checksum' -Ok $false -Detail ("MISMATCH recorded={0} actual={1} file='{2}'" -f $recorded, $actual, $expectedLeaf)
            }
        }
    }
}

# --- Summary -----------------------------------------------------------------
$overallOk = ($script:Failed -eq 0)
$overall = if ($overallOk) { 'PASS' } else { 'FAIL' }
Write-Host ("VERIFY overall result={0} checks_passed={1} checks_failed={2} bytes={3} file='{4}'" -f `
    $overall, $script:Passed, $script:Failed, $size, (Split-Path -Leaf $fullPath))

$fields = @{
    file       = (Split-Path -Leaf $fullPath)
    path       = $fullPath
    bytes      = $size
    create_tbl = $createCount
    copy_blks  = $copyCount
    db         = $DbName
}

if ($overallOk) {
    Write-BackupLog -Level INFO -Event BACKUP_VERIFIED -Fields $fields
    exit 0
}

$failureFields = $fields.Clone()
$failureFields['phase']   = 'verify'
$failureFields['reason']  = 'checks_failed'
$failureFields['failed']  = $script:Failed
Write-BackupLog -Level ERROR -Event BACKUP_FAILED -Fields $failureFields
exit 1
