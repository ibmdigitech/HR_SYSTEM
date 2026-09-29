<#
.SYNOPSIS
    Retention pruning for the SecurityAuditLog table (PRODUCTION_READINESS_CHECKLIST 9.6).

.DESCRIPTION
    SecurityAuditLog is append-only and grows without bound. Every denied
    request, every failed sign-in and every seed attempt is a row, forever. On a
    system with a public login form that is a steady write rate against a table
    nobody ever prunes, so "fix the growth" is this script's only job.

    DEFAULTS TO A DRY RUN.
    Without -Execute this script deletes NOTHING. It reports the row count that
    a real run would remove, plus the oldest and newest timestamps on both sides
    of the cutoff, so the number can be sanity-checked against expectations
    BEFORE anyone destroys an append-only security log. A retention job that
    quietly deletes on its first run is a job nobody trusts with a second one.

    The three safety properties, in order of importance:
      1. Dry run unless asked.
      2. The table and column names are verified against the LIVE schema via
         information_schema before any DELETE is constructed. A typo, or a
         schema that another migration has since renamed, stops the run instead
         of deleting the wrong thing.
      3. A run that would remove more than 95% of the table refuses without
         -AllowMassDelete. Short windows and far-future mistakes are the normal
         ways a retention script takes out a whole security log.

    THE BOUNDARY IS EXCLUSIVE.
    A row is removed when    createdAt < cutoff     (strictly less than).
    A row whose createdAt is exactly the cutoff is KEPT. The script uses the
    same `<` as lib/observability/retention.ts, which is where the rule is
    stated and unit-tested, so the dry-run count and the real-run count cannot
    disagree. See that module for why `<` and not `<=`.

    THE CUTOFF IS COMPUTED BY THE DATABASE, ONCE.
    Asking the server for the cutoff rather than formatting a local date avoids
    the whole class of bugs where the operator's clock, the container's clock
    and the database's clock disagree about what "365 days ago" is. The same
    returned string is used for the count and for the DELETE, so the two can
    never be computed against different `now` values.

    Exit codes: 0 success (including a dry run), 1 failure or refusal.

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.

    QUOTED SQL IDENTIFIERS - READ BEFORE EDITING ANY SQL IN HERE
    The tables in this schema are capitalised ("SecurityAuditLog"), so they are
    case-sensitive and must be double-quoted in SQL. Under Windows PowerShell
    5.1 the only form that survives the trip to psql is a SINGLE-quoted
    PowerShell string containing backslash-escaped quotes:

        docker exec hr-postgres psql -U postgres -d hr_system -tAc 'SELECT count(*) FROM \"SecurityAuditLog\";'

    A DOUBLE-quoted PowerShell string does not work. The C runtime's argv
    parser consumes the inner quotes before the argument reaches docker, and
    psql then sees `FROM " SecurityAuditLog\";` and fails with
    "unterminated quoted identifier". Verified on this host. The backtick form
    (`` `" ``) fails the same way, with the quotes stripped entirely so the
    unquoted identifier is folded to lower case and fails with
    'relation "securityauditlog" does not exist'.

    Every SQL string in this file is therefore single-quoted and uses \" for
    the SQL double quote, and identifiers are built only by Quote-Identifier
    after a strict character check. Do not "tidy" that into double quotes.

.EXAMPLE
    # Dry run. Deletes nothing. Reports what would go.
    powershell -ExecutionPolicy Bypass -File .\scripts\prune-audit-log.ps1

.EXAMPLE
    # Dry run against a 90-day window, on the compose stack.
    powershell -ExecutionPolicy Bypass -File .\scripts\prune-audit-log.ps1 -RetentionDays 90

.EXAMPLE
    # Actually delete. Unattended (Task Scheduler).
    powershell -ExecutionPolicy Bypass -File .\scripts\prune-audit-log.ps1 -RetentionDays 400 -Execute
#>

[CmdletBinding()]
param(
    # Container holding the database. Same default as backup.ps1 / restore.ps1:
    # `hr-postgres` is the container created by ___RUN_APP_CLICK_ME.bat and
    # used by `npm run dev` (DATABASE_URL on port 5433).
    [string] $Container = 'hr-postgres',

    # Superuser, over the container's local unix socket. No password is needed
    # and none is ever placed on a command line.
    [string] $DbUser = 'postgres',

    [string] $DbName = 'hr_system',

    # Target table and its timestamp column. Both are verified against the live
    # schema before any DELETE is built. Overridable for the compose stack
    # (-Container hr_system_db -DbUser hr_app).
    [string] $Table = 'SecurityAuditLog',
    [string] $TimestampColumn = 'createdAt',

    # Rows older than this are removed. Must match DEFAULT_RETENTION_DAYS in
    # lib/observability/retention.ts.
    [int] $RetentionDays = 365,

    # THE DESTRUCTIVE SWITCH. Absent means dry run.
    [switch] $Execute,

    # Required when a run would remove more than 95% of the table.
    [switch] $AllowMassDelete
)

$ErrorActionPreference = 'Stop'

# Fraction of the table a single run may remove without the explicit override.
$MassDeleteLimit = 0.95

function Write-Fail {
    param([string] $Message)
    Write-Host "[prune-audit] FAILED: $Message"
    exit 1
}

function Write-Step {
    param([string] $Message)
    Write-Host "[prune-audit] $Message"
}

# --- Identifier quoting ------------------------------------------------------
# Returns the name wrapped for psql, in the ONLY form that survives PowerShell
# 5.1 -> docker -> psql. See the .NOTES block: a plain "name" does not work.
function Quote-Identifier {
    param([string] $Name)

    # A strict allow-list is the guard against SQL injection through a
    # parameter, and it is also what makes the backslash wrapping safe: no
    # quote, backslash or space can be present in the output.
    if ($Name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        Write-Fail ("identifier '{0}' is not a plain unquoted SQL name (letters, digits, underscore). Refusing to build SQL from it." -f $Name)
    }
    return '\"' + $Name + '\"'
}

# Wraps a value as a SQL string literal. Used only for values this script
# generated itself and then re-validated, never for user input.
function Quote-Literal {
    param([string] $Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

# --- psql --------------------------------------------------------------------
# Runs one statement in tuple-only, unaligned mode and returns its stdout.
# Throws with psql's own message on a non-zero exit, so a failed query can
# never be mistaken for an empty result.
function Invoke-Psql {
    param([string] $Sql)

    # ON_ERROR_STOP=1: without it psql reports the error and still exits 0, and
    # a failed DELETE would be reported as a successful one.
    # Named $psqlArgs, not $args: $args is a PowerShell automatic variable and
    # writing to it inside a function is a trap that behaves differently
    # depending on how the function is called.
    $psqlArgs = @('exec', $Container, 'psql', '-U', $DbUser, '-d', $DbName, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', $Sql)

    # A native command writing to stderr while $ErrorActionPreference is 'Stop'
    # can raise before $LASTEXITCODE is ever read, so stderr capture happens
    # with the preference relaxed.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
$breakdownSkipped = $false
try {
        $raw = & docker @psqlArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }

    $text = (@($raw) | ForEach-Object { [string]$_ }) -join "`n"
    if ($code -ne 0) {
        throw ("psql exited {0}`n  statement: {1}`n  output: {2}" -f $code, $Sql, $text.Trim())
    }
    return $text.Trim()
}

# Returns the first line only. psql -tA is one row per line, and every query
# here is a scalar, so a second line would mean something went wrong upstream.
function Invoke-Scalar {
    param([string] $Sql)
    $text = Invoke-Psql -Sql $Sql
    $lines = @($text -split "`r?`n" | Where-Object { $_ -ne '' })
    if ($lines.Count -eq 0) { return '' }
    return $lines[0].Trim()
}

Write-Step ("container={0} database={1} table={2} retention={3} days mode={4}" -f `
    $Container, $DbName, $Table, $RetentionDays, $(if ($Execute) { 'EXECUTE' } else { 'DRY RUN' }))

# --- Preflight ---------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail 'docker was not found on PATH.'
}

$state = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Fail ("container '{0}' was not found. Create it first, or pass -Container." -f $Container)
}
if ($state -ne 'true') {
    Write-Fail ("container '{0}' exists but is not running. Start it: docker start {1}" -f $Container, $Container)
}

# Validated before any SQL string is assembled, so nothing malformed can reach
# the database at all.
$qTable = Quote-Identifier -Name $Table
$qColumn = Quote-Identifier -Name $TimestampColumn

# Confirm the connection before doing anything else, so a wrong -DbUser fails
# with a clear message rather than as an empty table count.
Invoke-Scalar -Sql 'SELECT 1' | Out-Null

# --- Verify the live schema --------------------------------------------------
# A DELETE built from a remembered column name is how a retention script
# deletes the wrong table after a migration. information_schema is the schema.
$tableCount = Invoke-Scalar -Sql (
    'SELECT count(*) FROM information_schema.tables ' +
    'WHERE table_schema = ''public'' AND table_name = ' + (Quote-Literal $Table) + ';'
)
if ($tableCount -ne '1') {
    Write-Fail ("table [{0}] does not exist in schema public of database '{1}'. Nothing was deleted." -f $Table, $DbName)
}
Write-Step ("verified: table [{0}] exists" -f $Table)

$columnSql = (
    'SELECT data_type FROM information_schema.columns ' +
    'WHERE table_schema = ''public'' AND table_name = ' + (Quote-Literal $Table) +
    ' AND column_name = ' + (Quote-Literal $TimestampColumn) + ';'
)
$columnType = Invoke-Scalar -Sql $columnSql
if ([string]::IsNullOrWhiteSpace($columnType)) {
    Write-Fail ("column [{0}.{1}] does not exist. The schema has changed since this script was written; nothing was deleted." -f $Table, $TimestampColumn)
}
if ($columnType -notmatch 'timestamp|date') {
    Write-Fail ("column [{0}.{1}] is of type '{2}', not a timestamp. Refusing to prune on a non-temporal column." -f $Table, $TimestampColumn, $columnType)
}
Write-Step ("verified: column [{0}.{1}] exists and is {2}" -f $Table, $TimestampColumn, $columnType)

# --- Retention window --------------------------------------------------------
if ($RetentionDays -lt 1) {
    Write-Fail ('-RetentionDays must be at least 1. A zero or negative window would delete the entire security log.')
}

# Computed by the server, once, truncated to whole seconds. `now() AT TIME ZONE
# 'UTC'` converts to a timestamp without time zone, which is the type
# "createdAt" actually has, so the comparison is not silently shifted by the
# server's TimeZone setting.
$cutoff = Invoke-Scalar -Sql (
    'SELECT (date_trunc(''second'', now() AT TIME ZONE ''UTC'') - make_interval(days => ' +
    [string]$RetentionDays + '))::text;'
)
$dbNow = Invoke-Scalar -Sql 'SELECT date_trunc(''second'', now() AT TIME ZONE ''UTC'')::text;'

# The value came from our own query, but it is about to be interpolated into a
# DELETE, so it is checked rather than trusted. Anything unexpected stops the run.
if ($cutoff -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$') {
    Write-Fail ("could not read a usable cutoff from the database (got '{0}'). Nothing was deleted." -f $cutoff)
}

# A cutoff in the future deletes nothing now and EVERYTHING at the next run.
# The arithmetic above cannot produce one, but the guard costs nothing and this
# is the check that makes the script safe to change.
$parsedCutoff = [datetime]::ParseExact($cutoff, 'yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture)
$parsedNow = [datetime]::ParseExact($dbNow, 'yyyy-MM-dd HH:mm:ss', [cultureinfo]::InvariantCulture)
if ($parsedCutoff -ge $parsedNow) {
    Write-Fail ("computed cutoff {0} is not in the past (database time is {1}). Refusing to run." -f $cutoff, $dbNow)
}

$cutoffLiteral = Quote-Literal $cutoff
$expiredPredicate = $qColumn + ' < ' + $cutoffLiteral

Write-Step ("cutoff {0} (database UTC time {1}); rows with {2} strictly less than the cutoff are in scope" -f $cutoff, $dbNow, $TimestampColumn)

# --- Measure -----------------------------------------------------------------
# Every count is a SELECT. Nothing is written, in either mode.
$total = [int](Invoke-Scalar -Sql ('SELECT count(*) FROM ' + $qTable + ';'))
$oldest = Invoke-Scalar -Sql ('SELECT coalesce(min(' + $qColumn + ')::text, ''(empty)'') FROM ' + $qTable + ';')
$newest = Invoke-Scalar -Sql ('SELECT coalesce(max(' + $qColumn + ')::text, ''(empty)'') FROM ' + $qTable + ';')
$expired = [int](Invoke-Scalar -Sql ('SELECT count(*) FROM ' + $qTable + ' WHERE ' + $expiredPredicate + ';'))
$expiredOldest = Invoke-Scalar -Sql ('SELECT coalesce(min(' + $qColumn + ')::text, ''(none)'') FROM ' + $qTable + ' WHERE ' + $expiredPredicate + ';')
$expiredNewest = Invoke-Scalar -Sql ('SELECT coalesce(max(' + $qColumn + ')::text, ''(none)'') FROM ' + $qTable + ' WHERE ' + $expiredPredicate + ';')

Write-Step ''
Write-Step '--- SecurityAuditLog retention report ---'
Write-Step ("  window            : {0} day(s), cutoff {1} (exclusive)" -f $RetentionDays, $cutoff)
Write-Step ("  rows in table     : {0}" -f $total)
Write-Step ("  oldest row        : {0}" -f $oldest)
Write-Step ("  newest row        : {0}" -f $newest)
Write-Step ("  rows in scope     : {0}" -f $expired)
Write-Step ("  scope oldest      : {0}" -f $expiredOldest)
Write-Step ("  scope newest      : {0}" -f $expiredNewest)
Write-Step ("  rows retained     : {0}" -f ($total - $expired))

if ($total -gt 0) {
    Write-Step ("  share of table    : {0}%" -f [math]::Round(($expired / $total) * 100, 1))
}

# What is about to be lost, by event type. A retention window is only
# defensible if the operator has looked at what it is about to remove.
# Best-effort by design: the breakdown is a convenience, and -Table is
# overridable, so a table without action/outcome columns must not abort a run
# whose actual purpose (measuring and pruning by date) it does not serve.
try {
    $breakdown = Invoke-Psql -Sql (
        'SELECT action || '' | '' || outcome || '' | '' || count(*)::text FROM ' + $qTable +
        ' WHERE ' + $expiredPredicate + ' GROUP BY action, outcome ORDER BY count(*) DESC;'
    )
} catch {
    $breakdown = ''
    Write-Step '  breakdown         : skipped (this table has no action/outcome columns)'
    $breakdownSkipped = $true
}

if ([string]::IsNullOrWhiteSpace($breakdown)) {
    if (-not $breakdownSkipped) { Write-Step '  breakdown         : (nothing in scope)' }
} else {
    Write-Step '  breakdown (action | outcome | count):'
    foreach ($line in ($breakdown -split "`r?`n")) {
        if ($line -ne '') { Write-Host ("    {0}" -f $line) }
    }
}

# --- Dry run stops here ------------------------------------------------------
if (-not $Execute) {
    Write-Step ''
    if ($expired -eq 0) {
        Write-Step 'DRY RUN: nothing is old enough to prune. No rows deleted.'
    } else {
        Write-Step ("DRY RUN: {0} row(s) WOULD be deleted. No rows were deleted." -f $expired)
        Write-Step 'DRY RUN: re-run with -Execute to actually remove them, for example:'
        Write-Step ("DRY RUN:   powershell -ExecutionPolicy Bypass -File .\scripts\prune-audit-log.ps1 -RetentionDays {0} -Execute" -f $RetentionDays)
    }
    exit 0
}

# --- Destructive path --------------------------------------------------------
Write-Step ''

if ($expired -eq 0) {
    Write-Step 'nothing in scope. No rows deleted.'
    exit 0
}

# Mass-delete guard. Applies only to a destructive run; a dry run is never
# blocked, because counting rows destroys nothing.
$share = $expired / $total
if ($share -gt $MassDeleteLimit -and -not $AllowMassDelete) {
    Write-Fail ("refusing to delete {0} of {1} rows ({2}%, limit {3}%). Confirm the window is what you intended, then re-run with -AllowMassDelete. Nothing was deleted." -f `
            $expired, $total, [math]::Round($share * 100, 1), [math]::Round($MassDeleteLimit * 100, 0))
}

Write-Step ("deleting {0} row(s) with {1} < {2} ..." -f $expired, $TimestampColumn, $cutoff)

# A single CTE. One statement, so it is atomic without an explicit
# transaction, and it returns the number of rows actually removed rather than
# the number the pre-run count predicted. The returned count is the answer.
# ON_ERROR_STOP=1 (set in Invoke-Psql) means a failure here throws instead of
# exiting 0.
$deleted = 0
try {
    $deletedText = Invoke-Scalar -Sql (
        'WITH deleted AS (DELETE FROM ' + $qTable + ' WHERE ' + $expiredPredicate + ' RETURNING 1) SELECT count(*)::text FROM deleted;'
    )
    $deleted = [int]$deletedText
} catch {
    Write-Fail ("the DELETE failed and the transaction was rolled back by Postgres: {0}" -f $_.Exception.Message)
}

# Post-condition. A DELETE that reports a count but leaves the rows is not a
# success, and neither is a count that silently differs from the plan by more
# than the rows written since the pre-run SELECT.
$remaining = [int](Invoke-Scalar -Sql ('SELECT count(*) FROM ' + $qTable + ';'))
$expectedRemaining = $total - $expired
$drift = [math]::Abs($remaining - $expectedRemaining)

Write-Step ("deleted {0} row(s); {1} row(s) remain" -f $deleted, $remaining)

if ($deleted -ne $expired) {
    Write-Fail ("deleted {0} row(s) but the pre-run count said {1}. The table changed underneath the run (a new row older than the cutoff, or a concurrent writer). Rows are deleted, but verify before continuing." -f $deleted, $expired)
}
if ($drift -gt 10) {
    Write-Fail ("post-run count is {0} rows, expected about {1}. Concurrent writes are active; verify the remaining range before continuing." -f $remaining, $expectedRemaining)
}

Write-Step ("complete. removed {0} row(s) older than {1}; {2} row(s) retained. The removed range was {3} to {4}." -f `
        $deleted, $cutoff, $remaining, $expiredOldest, $expiredNewest)
exit 0
