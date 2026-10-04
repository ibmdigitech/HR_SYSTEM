<#
.SYNOPSIS
    Disposable restore drill for the HR database backup.

.DESCRIPTION
    Proves a dump is actually recoverable by restoring it into a THROWAWAY
    database and comparing row counts against the source. Never touches the
    live application database.

    Why a scratch POSTGRES container rather than a second database on the live
    one:
      - Restoring into a database on the live server is still a write to the
        production instance. A drill that can corrupt production is not a drill.
      - `restore.ps1` drops and recreates schema `public`. On a shared server
        that is a loaded gun pointed at whatever it is pointed at.
      - A separate container is destroyed by `docker rm -f`, which cannot leave
        a half-restored schema behind.

    The drill is deliberately NOT run by backup.ps1 or the scheduled task. It is
    expensive, it needs a second container, and a failed drill must page a human
    rather than be retried silently at 02:00.

    WHAT IS PROVEN, IN LAYERS

      1. ROW COUNTS (EXACT / MONO). The original check. Proves the data arrived.
      2. MONO DRIFT TRANSPARENCY. An append-only table that is short by N rows is
         reported as such, with the evidence that separates "rows written after
         the dump" from corruption.
      3. DATABASE INTEGRITY (Phase 8). Named PASS/FAIL checks for tables,
         columns, primary keys, foreign keys, the indexes the application
         depends on, an administrable user, and restore completeness. Row counts
         cannot tell any of these: a database can hold every row correctly and
         still be unusable because its primary keys did not come across.
      4. APPLICATION SMOKE (Phase 9). For each product domain, the query the
         application actually makes is run against the RESTORED database. A
         domain with no rows reports SKIP with a stated reason; SKIP is never
         reported as PASS, because "the schema is right and there is no data" and
         "the query the app would run fails" must not look identical.

    TARGETING A DIFFERENT DATABASE

    The source container and database resolve in the same order backup.ps1 uses:
    an explicit parameter, then BACKUP_CONTAINER / BACKUP_DB_NAME /
    BACKUP_DB_USER, then the development default. A host that exports
    BACKUP_CONTAINER=hr_system_db therefore drills PRODUCTION with no script
    edit, which matters because the default is the development database and a
    production database that is never drilled is a production database nobody
    has proven recoverable.

    The scratch container is unaffected by that resolution and is still refused
    if it collides with the source. The drill only ever WRITES to the scratch
    container; the source is opened read-only for counts.

    EXIT CODES
      0  drill passed - restored, verified structurally, and usable
      1  drill failed - see the FAIL lines
      2  configuration or environment error (docker missing, no dump, etc.)

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\restore-drill.ps1

.EXAMPLE
    # Drill a specific dump, and keep the scratch container for inspection.
    powershell -ExecutionPolicy Bypass -File .\scripts\restore-drill.ps1 `
        -Path .\backups\hr_system-20261004-020000.sql -KeepScratch

.EXAMPLE
    # Drill the PRODUCTION compose database instead of the development one.
    powershell -ExecutionPolicy Bypass -File .\scripts\restore-drill.ps1 `
        -Container hr_system_db -DbName hr_system
#>

[CmdletBinding()]
param(
    # Dump to drill. Defaults to the newest dump in -BackupDir.
    [string] $Path,

    # Source container and database. Both are overridable so the drill can be
    # pointed at the production compose database (hr_system_db) instead of the
    # development one (hr-postgres). When NOT passed they fall back to
    # BACKUP_CONTAINER / BACKUP_DB_NAME / BACKUP_DB_USER, exactly as backup.ps1
    # resolves them, so one environment variable moves the drill target.
    # READ ONLY. Nothing below ever writes to this container.
    [string] $Container = 'hr-postgres',
    [string] $DbUser = 'postgres',
    [string] $DbName = 'hr_system',

    [string] $BackupDir = '',

    # Name for the disposable container. Deliberately distinct from anything the
    # app or compose uses so a stray `docker rm` cannot hit a real database.
    [string] $ScratchContainer = 'hrms-restore-drill',

    # Identity of the RESTORED database inside the scratch container. These are
    # the only credentials the drill ever creates, and the only database it ever
    # writes to. Kept as parameters so a scratch image that ignores
    # POSTGRES_DB/POSTGRES_USER can still be drilled rather than failing at the
    # first count.
    [string] $ScratchDbUser = 'postgres',
    [string] $ScratchDbName = 'drill',

    # PostgreSQL image for the scratch server. Must be the SAME major version as
    # the source, or the restore fails on syntax the target does not accept - and
    # a drill that fails for that reason teaches nothing about recoverability.
    [string] $ScratchImage = '',

    # How many tables the restored schema may be short of the source before the
    # restore is called incomplete. A point-in-time dump can only ever contain
    # what existed when it was taken, so the shortfall should be zero or nearly
    # zero; the slack covers migrations applied between the dump and the drill.
    # Small on purpose: this is the check that catches a partially applied dump
    # which psql somehow reported as successful.
    [int] $MaxTableShortfall = 3,

    # Keep the scratch container after the drill instead of destroying it.
    [switch] $KeepScratch,

    # Emit row counts as JSON for the audit record.
    [switch] $Json
)

$ErrorActionPreference = 'Stop'

function Write-Fail {
    param([string] $Message)
    Write-Host "restore-drill: $Message"
    exit 2
}

# Set by -Json. When the caller wants machine-readable output, stdout must carry
# JSON and nothing else, so progress goes to stderr. Mixing them makes
# `restore-drill.ps1 -Json | ConvertFrom-Json` fail on the first progress line,
# which is the only reason anyone asked for -Json in the first place.
$script:JsonMode = $Json.IsPresent

function Write-DrillLine {
    param([string] $Message)
    if ($script:JsonMode) {
        [Console]::Error.WriteLine($Message)
    }
    else {
        Write-Host $Message
    }
}

function Info {
    param([string] $Message)
    Write-DrillLine "[drill] $Message"
}

<#
.SYNOPSIS
    Counts rows in one table, returning -1 when the table does not exist.

.DESCRIPTION
    Two Windows PowerShell 5.1 traps are handled here, and both of them look
    like the restore failed when the database is actually fine.

    1. DOUBLE QUOTES IN A NATIVE ARGUMENT.
       Prisma creates PascalCase tables ("Employee", "AuditLog"), so the SQL
       MUST quote the identifier. PowerShell hands arguments to a native
       executable by re-quoting them, and an embedded `"` is stripped, so
       `public."Employee"` reaches psql as `public.Employee` - which PostgreSQL
       folds to lowercase and reports as a missing relation. Verified on this
       host: the unescaped form exits 1 with
       `relation "public.employee" does not exist` while the escaped form exits 0
       and returns the real count. The backslash is therefore load-bearing.

    2. STDERR UNDER ErrorActionPreference = Stop.
       psql reports a missing relation on stderr. With Stop, PowerShell promotes
       that to a terminating error before $LASTEXITCODE can be inspected, so a
       routine "table is absent" probe aborts the whole drill. The preference is
       relaxed around the call and the exit code is read directly instead.
#>
function Get-RowCount {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Table)

    $sql = 'SELECT count(*) FROM public.\"' + $Table + '\";'

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & docker exec $ContainerName psql -U $User -d $Database -tAc $sql 2>$null
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($code -ne 0) { return -1 }
    return [int64](([string]($out | Select-Object -First 1)).Trim())
}

<#
.SYNOPSIS
    True when a column exists in a table. Same escaping and stderr rules.
#>
function Test-ColumnExists {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Table, [string] $Column)

    $sql = 'SELECT count(*) FROM information_schema.columns WHERE table_schema=''public'' AND table_name=''' + $Table + ''' AND column_name=''' + $Column + ''';'

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & docker exec $ContainerName psql -U $User -d $Database -tAc $sql 2>$null
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($code -ne 0) { return $false }
    return ([int64](([string]($out | Select-Object -First 1)).Trim()) -eq 1)
}

<#
.SYNOPSIS
    Runs one read-only SQL statement against a container's database.

.DESCRIPTION
    Returns the output lines, or $null when psql failed. Same two Windows
    PowerShell 5.1 traps as Get-RowCount apply here and both are handled once,
    in this function, so no caller has to remember them:

      1. An embedded `"` in a native argument is stripped, so EVERY quoted
         identifier in the SQL handed to psql must be written `\"`. Prisma
         creates PascalCase tables and camelCase columns, so a query that says
         `public."User"` without the backslash reaches PostgreSQL as
         `public.User`, which folds to lowercase and fails with
         `relation "public.user" does not exist`.
      2. psql reports errors on stderr, and with ErrorActionPreference = Stop
         PowerShell promotes that to a terminating error before $LASTEXITCODE can
         be read, which would abort the whole drill on a routine "is this here?"
         probe.

    $null rather than an exception for a failure, deliberately. This function is
    used to ASK questions about the restored schema, and a question that cannot
    be answered is not a reason to abandon the drill with a scratch container
    still running; the caller turns $null into a FAIL with a stated reason and
    the tear-down still happens.
#>
function Invoke-DbQuery {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Sql)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & docker exec $ContainerName psql -U $User -d $Database -tA -c $Sql 2>$null
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($code -ne 0) { return $null }

    # Normalised to an array of lines, then returned with a leading comma.
    # The comma is load-bearing. A PowerShell function unrolls an array on return,
    # so a one-line result would arrive at the caller as a bare STRING - and
    # `"76"[0]` is the character '7', not the string "76". Indexing the result
    # then silently yields the first character of every value read through here,
    # which is how a 76-table schema gets reported as 7 tables and how
    # `Notification.employeeId` (is_nullable = 'NO') gets reported as NULLABLE.
    $rows = @($out | ForEach-Object { [string] $_ })
    return ,$rows
}

<#
.SYNOPSIS
    First output line of a query as one trimmed string, or $null if it failed.
#>
function Get-DbScalar {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Sql)

    $rows = Invoke-DbQuery -ContainerName $ContainerName -User $User -Database $Database -Sql $Sql
    if ($null -eq $rows) { return $null }

    $first = @($rows)[0]
    if ($null -eq $first) { return $null }
    return ([string] $first).Trim()
}

<#
.SYNOPSIS
    Runs a statement that must either succeed or fail, and reports the outcome.

.DESCRIPTION
    For probes where the exit code IS the answer, not the output - the append-only
    write probe in Phase 9, which deliberately fails on any SQL error rather than
    printing one and continuing. `-v ON_ERROR_STOP=1` is what makes psql abandon
    the statement instead of reporting an error and still exiting 0.
#>
function Invoke-DbStatement {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Sql)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker exec $ContainerName psql -U $User -d $Database -q -tA -v ON_ERROR_STOP=1 -c $Sql 1>$null 2>$null
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }

    return $code
}

<#
.SYNOPSIS
    True when a table exists in the public schema of the target database.
#>
function Test-TableExists {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Table)

    $sql = 'SELECT count(*) FROM information_schema.tables WHERE table_schema=''public'' AND table_name=''' + $Table + ''';'
    $out = Get-DbScalar -ContainerName $ContainerName -User $User -Database $Database -Sql $sql
    if ($null -eq $out) { return $false }
    return ([int64]$out -ge 1)
}

<#
.SYNOPSIS
    The declared SQL type of one column, or '' when the column is absent.
.DESCRIPTION
    information_schema.columns is used rather than the pg catalog because it is
    the same source Prisma's introspection reads, so a column whose type
    disagrees with the schema is reported here exactly as Prisma would see it.
#>
function Get-ColumnType {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Table, [string] $Column)

    $sql = 'SELECT data_type FROM information_schema.columns WHERE table_schema=''public'' AND table_name=''' + $Table + ''' AND column_name=''' + $Column + ''';'
    $out = Get-DbScalar -ContainerName $ContainerName -User $User -Database $Database -Sql $sql
    if ($null -eq $out) { return '' }
    return $out
}

<#
.SYNOPSIS
    'YES' / 'NO' / '' - whether a column accepts NULL, or '' when it is absent.
#>
function Get-ColumnNullable {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Table, [string] $Column)

    $sql = 'SELECT is_nullable FROM information_schema.columns WHERE table_schema=''public'' AND table_name=''' + $Table + ''' AND column_name=''' + $Column + ''';'
    $out = Get-DbScalar -ContainerName $ContainerName -User $User -Database $Database -Sql $sql
    if ($null -eq $out) { return '' }
    return $out
}

<#
.SYNOPSIS
    The subset of "Table.column" pairs that exist in the target schema.

.DESCRIPTION
    One query per chunk of pairs rather than one per column. The required-column
    set is around 250 entries; as individual lookups that is 250 docker exec
    round trips, which is slow enough that operators start skipping the drill.
    The EXISTS-over-VALUES form answers all of them at once and needs no
    identifier quoting at all, because the pairs travel as string literals and
    are split with split_part().

    Returns $null when a chunk could not be read at all, which is different from
    "the columns are missing" and is reported as such rather than being folded
    into a misleading count.
#>
function Get-ExistingColumnPairs {
    param(
        [string] $ContainerName,
        [string] $User,
        [string] $Database,
        [string[]] $Pairs
    )

    if ($null -eq $Pairs -or $Pairs.Count -eq 0) {
        return [pscustomobject]@{ found = @(); failed = $false }
    }

    $found = New-Object System.Collections.ArrayList
    $failed = $false
    $chunkSize = 50

    $offset = 0
    while ($offset -lt $Pairs.Count) {
        $last = [Math]::Min($offset + $chunkSize, $Pairs.Count) - 1
        $slice = @()
        for ($i = $offset; $i -le $last; $i++) { $slice += $Pairs[$i] }
        $offset = $last + 1

        $values = ($slice | ForEach-Object { "('" + $_ + "')" }) -join ','
        $sql = 'SELECT v.p FROM (VALUES ' + $values + ') AS v(p) WHERE EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema=''public'' AND ic.table_name = split_part(v.p,''.'',1) AND ic.column_name = split_part(v.p,''.'',2));'
        $rows = Invoke-DbQuery -ContainerName $ContainerName -User $User -Database $Database -Sql $sql
        if ($null -eq $rows) {
            $failed = $true
            continue
        }
        foreach ($r in $rows) {
            if (-not [string]::IsNullOrWhiteSpace($r)) { [void] $found.Add($r.Trim()) }
        }
    }

    return [pscustomobject]@{ found = @($found.ToArray()); failed = $failed }
}

<#
.SYNOPSIS
    Every PRIMARY KEY and FOREIGN KEY constraint in the public schema.
.DESCRIPTION
    `parent` is the referenced table for a foreign key and '' for a primary key.
    Joined through pg_class/pg_namespace rather than by string-comparing the
    constraint name so that no identifier ever has to be double quoted inside
    the SQL - which matters, because an unescaped `"` is stripped by Windows
    PowerShell before psql ever sees it.
#>
function Get-ConstraintCatalog {
    param([string] $ContainerName, [string] $User, [string] $Database)

    $sql = 'SELECT c.contype::text||''|''||t.relname||''|''||c.conname||''|''||coalesce(p.relname,'''') FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace LEFT JOIN pg_class p ON p.oid = c.confrelid WHERE n.nspname=''public'' AND c.contype IN (''p'',''f'');'
    $rows = Invoke-DbQuery -ContainerName $ContainerName -User $User -Database $Database -Sql $sql

    $catalog = New-Object System.Collections.ArrayList
    if ($null -eq $rows) {
        return [pscustomobject]@{ constraints = @(); failed = $true }
    }

    foreach ($r in $rows) {
        if ([string]::IsNullOrWhiteSpace($r)) { continue }
        $parts = ([string] $r).Split('|')
        if ($parts.Count -lt 3) { continue }
        $parent = ''
        if ($parts.Count -ge 4) { $parent = $parts[3] }
        [void] $catalog.Add([pscustomobject]@{
            type   = $parts[0]
            table  = $parts[1]
            name   = $parts[2]
            parent = $parent
        })
    }

    return [pscustomobject]@{ constraints = @($catalog.ToArray()); failed = $false }
}

<#
.SYNOPSIS
    Every index in the public schema, with its column names sorted.

.DESCRIPTION
    Sorted so an index can be matched on the SET of columns it covers rather than
    on its name. Prisma derives index names mechanically, so a name match alone
    would fail to notice that the underlying column list changed - and the whole
    reason to check indexes is that a wrong column list is a silent performance
    cliff, not an error.
#>
function Get-IndexCatalog {
    param([string] $ContainerName, [string] $User, [string] $Database)

    $sql = 'SELECT t.relname||''|''||i.relname||''|''||coalesce((SELECT string_agg(a.attname::text, '','' ORDER BY a.attname) FROM unnest(x.indkey) k(attnum) JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum),'''') FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname=''public'';'
    $rows = Invoke-DbQuery -ContainerName $ContainerName -User $User -Database $Database -Sql $sql

    $catalog = New-Object System.Collections.ArrayList
    if ($null -eq $rows) {
        return [pscustomobject]@{ indexes = @(); failed = $true }
    }

    foreach ($r in $rows) {
        if ([string]::IsNullOrWhiteSpace($r)) { continue }
        $parts = ([string] $r).Split('|')
        if ($parts.Count -lt 3) { continue }
        [void] $catalog.Add([pscustomobject]@{
            table = $parts[0]
            name  = $parts[1]
            cols  = $parts[2]
        })
    }

    return [pscustomobject]@{ indexes = @($catalog.ToArray()); failed = $false }
}

<#
.SYNOPSIS
    Highest id and highest createdAt in a table, or $null if it cannot be read.

.DESCRIPTION
    Read from the source as well as from the restore, because comparing MAX(id)
    against MAX(id) is what separates an append-only table that is short by
    N rows from one that is corrupt. Rows appended after the dump have ids and
    timestamps the dump cannot contain, so a restored max that is greater than
    the source max is not an append - it is something else, and saying which is
    the whole point of reporting drift instead of tolerating it.
#>
function Get-TableMaxMarker {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Table)

    $sql = 'SELECT coalesce(max(id)::text,'''')||''|''||coalesce(to_char(max(\"createdAt\"),''YYYY-MM-DD HH24:MI:SS''),'''') FROM public.\"' + $Table + '\";'
    $out = Get-DbScalar -ContainerName $ContainerName -User $User -Database $Database -Sql $sql
    if ($null -eq $out) { return $null }

    $parts = $out.Split('|')
    $maxId = ''
    $maxCreatedAt = ''
    if ($parts.Count -ge 1) { $maxId = $parts[0] }
    if ($parts.Count -ge 2) { $maxCreatedAt = $parts[1] }
    return [pscustomobject]@{ MaxId = $maxId; MaxCreatedAt = $maxCreatedAt }
}

<#
.SYNOPSIS
    Counts user-defined triggers on a table that could interfere with writing.
.DESCRIPTION
    UPDATE or DELETE triggers only. A BEFORE INSERT trigger is a normal part of
    some schemas and says nothing about whether an append-only log is intact.
#>
function Get-BlockingTriggerCount {
    param([string] $ContainerName, [string] $User, [string] $Database, [string] $Table)

    $sql = 'SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname=''public'' AND c.relname=''' + $Table + ''' AND NOT t.tgisinternal AND (t.tgtype & 20) > 0;'
    $out = Get-DbScalar -ContainerName $ContainerName -User $User -Database $Database -Sql $sql
    if ($null -eq $out) { return -1 }
    return [int64]$out
}

<#
.SYNOPSIS
    Resolves a setting: explicit parameter, then environment, then default.
.DESCRIPTION
    The same precedence backup.ps1 uses, deliberately. Duplicating a different
    precedence here would mean a host that already exports BACKUP_CONTAINER for
    the backup task silently drilled a different database than the one it backs
    up - which is precisely the class of mistake
    BACKUP_DISASTER_RECOVERY_AUDIT.md section 8 was written about.
#>
function Resolve-DrillSetting {
    param(
        [string] $Name,
        [string] $EnvName,
        [string] $CurrentValue,
        [bool] $ExplicitlyBound
    )

    if ($ExplicitlyBound) {
        return [pscustomobject]@{ Value = $CurrentValue; Source = ('-' + $Name) }
    }

    $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
    if ([string]::IsNullOrWhiteSpace($fromEnv)) {
        return [pscustomobject]@{ Value = $CurrentValue; Source = 'default' }
    }

    return [pscustomobject]@{ Value = $fromEnv.Trim(); Source = $EnvName }
}

# Named check results, accumulated for the -Json payload. Script scope so the
# recording helpers below can append to them.
$script:integrityChecks = @()
$script:smokeChecks = @()

<#
.SYNOPSIS
    Records and prints one Phase 8 database-integrity check.
#>
function Add-IntegrityCheck {
    param([string] $Name, [bool] $Ok, [string] $Detail)

    $status = 'FAIL'
    if ($Ok) { $status = 'PASS' }

    $script:integrityChecks += [pscustomobject]@{
        name   = $Name
        status = $status
        detail = $Detail
        ok     = $Ok
    }
    Write-DrillLine ("[drill]   [INTEGRITY] {0,-32} {1,-4} {2}" -f $Name, $status, $Detail)
}

<#
.SYNOPSIS
    Records and prints one Phase 9 application smoke check.

.DESCRIPTION
    Three outcomes, not two. PASS means the query the application makes against
    this domain actually ran. FAIL means it would not. SKIP means the schema is
    correct and the domain genuinely holds no rows yet - and SKIP is a distinct
    status with its own counter and its own JSON array precisely so that it can
    never be read as PASS. A SKIP without a stated reason throws, because an
    unexplained SKIP is a defect in the drill rather than in the database.
#>
function Add-SmokeCheck {
    param([string] $Domain, [string] $Status, [string] $Detail)

    if ($Status -ne 'PASS' -and $Status -ne 'FAIL' -and $Status -ne 'SKIP') {
        throw ("Add-SmokeCheck: status must be PASS, FAIL or SKIP; got '" + $Status + "' for '" + $Domain + "'.")
    }
    if ($Status -eq 'SKIP' -and [string]::IsNullOrWhiteSpace($Detail)) {
        throw ("Add-SmokeCheck: SKIP for '" + $Domain + "' must state the reason it cannot be exercised.")
    }

    $script:smokeChecks += [pscustomobject]@{
        domain = $Domain
        status = $Status
        detail = $Detail
        ok     = ($Status -eq 'PASS')
    }
    Write-DrillLine ("[drill]   [SMOKE]      {0,-22} {1,-4} {2}" -f $Domain, $Status, $Detail)
}

# Tables whose row counts are compared. Chosen because each is load-bearing for
# the product: without employees there is no HR system, without users nobody can
# log in, without audit records there is no compliance evidence, and the rest are
# the operational core.
#
# The names are the real Prisma table names, verified against pg_tables. A wrong
# name here would report BOTH_ABSENT and be quietly tolerated, which is worse
# than useless: the drill would claim to have verified attendance while never
# having looked at it. `Attendance` is the table, not "AttendanceRecord".
#
# `Mode` matters and is the reason this drill was wrong on its first run.
#
#   EXACT  - the source row cannot legitimately change between the dump being
#            taken and the drill reading the source. A mismatch is a real defect.
#   MONO   - append-only. Rows written AFTER the dump cannot be in it, so the
#            live source will always be >= the restored count. Comparing these
#            for equality guarantees a false failure: on the first run
#            AuditLog read 92 live vs 91 restored and SecurityAuditLog 244 vs
#            243, each short by exactly the rows the drill's own API calls and
#            page loads had written since the dump. The rule for MONO is
#            therefore "restored <= source, and restored is not absurdly behind",
#            which still catches the failure that matters: restored > source is
#            impossible for a point-in-time dump and indicates corruption or the
#            wrong source.
$CHECK_TABLES = @(
    @{ table = 'Employee';         mode = 'EXACT' },
    @{ table = 'User';             mode = 'EXACT' },
    @{ table = 'AuditLog';         mode = 'MONO' },
    @{ table = 'SecurityAuditLog'; mode = 'MONO' },
    @{ table = 'LeaveRequest';     mode = 'EXACT' },
    @{ table = 'LeaveBalance';     mode = 'EXACT' },
    @{ table = 'Attendance';       mode = 'EXACT' },
    @{ table = 'SalaryRecord';     mode = 'EXACT' },
    @{ table = 'PayrollRun';       mode = 'EXACT' },
    @{ table = 'Letter';           mode = 'EXACT' }
)

# How far an append-only table may lag before it is called a failure rather than
# expected drift. Generous on purpose: this catches "the log did not restore",
# not "someone was working during the drill".
$MONO_MAX_LAG = 5000

# The role vocabulary, copied from lib/auth/roles.ts (ROLES / KNOWN_ROLES).
# `User.role` is a plain String column in Prisma, so nothing in the DATABASE stops
# an arbitrary value being written; the application guards it in code. That makes
# a role value outside this list a real defect rather than a cosmetic one - the
# account silently holds no capability and nobody can tell why - and it is
# exactly the kind of value a restored dump can pick up.
$KNOWN_ROLES = @('SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'STAFF')

# SQL numeric families the application can SUM. A monetary or count column stored
# as text is not a cosmetic difference: Prisma returns a string, the sum is
# lexicographic, and payroll quietly reports the wrong number.
$NUMERIC_COLUMN_TYPES = @(
    'smallint', 'integer', 'bigint', 'real',
    'double precision', 'decimal', 'numeric', 'money'
)

# --- Effective settings ------------------------------------------------------
# Explicit parameter, then environment, then default - the same precedence
# backup.ps1 uses. This is what lets the drill be aimed at the production compose
# database (hr_system_db) instead of the development one (hr-postgres) by setting
# BACKUP_CONTAINER, with no edit to this file.
$containerSetting = Resolve-DrillSetting -Name 'Container' -EnvName 'BACKUP_CONTAINER' `
    -CurrentValue $Container -ExplicitlyBound $PSBoundParameters.ContainsKey('Container')
$dbSetting        = Resolve-DrillSetting -Name 'DbName' -EnvName 'BACKUP_DB_NAME' `
    -CurrentValue $DbName -ExplicitlyBound $PSBoundParameters.ContainsKey('DbName')
$userSetting      = Resolve-DrillSetting -Name 'DbUser' -EnvName 'BACKUP_DB_USER' `
    -CurrentValue $DbUser -ExplicitlyBound $PSBoundParameters.ContainsKey('DbUser')
$dirSetting       = Resolve-DrillSetting -Name 'BackupDir' -EnvName 'BACKUP_DIR' `
    -CurrentValue $BackupDir -ExplicitlyBound $PSBoundParameters.ContainsKey('BackupDir')

$Container    = $containerSetting.Value
$DbName       = $dbSetting.Value
$DbUser       = $userSetting.Value
$BackupDir    = $dirSetting.Value
$containerSrc = $containerSetting.Source
$dbNameSrc    = $dbSetting.Source

$startedAt = Get-Date

# --- Resolve the dump --------------------------------------------------------
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
$dumpSize = (Get-Item -LiteralPath $dumpFile).Length
if ($dumpSize -lt 1) {
    Write-Fail "dump is empty: $dumpFile"
}

Info "dump        : $dumpFile ($([math]::Round($dumpSize / 1KB, 1)) KB)"
Info "source      : $Container / $DbName (container: $containerSrc, database: $dbNameSrc)"
Info "scratch     : $ScratchContainer / $ScratchDbName"
Info 'safety      : the source is opened read-only; every write goes to the scratch container'

# --- Preflight ---------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail 'docker was not found on PATH.'
}

$state = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "source container '$Container' was not found."
}
if ($state -ne 'true') {
    Write-Fail "source container '$Container' is not running."
}

# Refuse to run if the scratch name collides with something real. The whole value
# of a scratch container is that destroying it is safe, and that is only true if
# nobody else has claimed the name. Case-insensitive because Docker treats
# `HRMS-Restore-Drill` and `hrms-restore-drill` as different containers but an
# operator does not, and the drill destroys whatever name it is given.
if ([string]::IsNullOrWhiteSpace($ScratchContainer)) {
    Write-Fail '-ScratchContainer must not be empty.'
}
if ($ScratchContainer -ieq $Container) {
    Write-Fail "-ScratchContainer must not equal the source container '$Container'."
}
if ([string]::IsNullOrWhiteSpace($ScratchDbName) -or [string]::IsNullOrWhiteSpace($ScratchDbUser)) {
    Write-Fail '-ScratchDbName and -ScratchDbUser must not be empty.'
}

# Determine the source image so the scratch server matches its major version.
if ([string]::IsNullOrWhiteSpace($ScratchImage)) {
    $srcImage = (docker inspect -f '{{.Config.Image}}' $Container 2>$null)
    if ([string]::IsNullOrWhiteSpace($srcImage)) {
        Write-Fail "could not read the image of '$Container'; pass -ScratchImage explicitly."
    }
    $ScratchImage = $srcImage
    Info "scratch image: $ScratchImage (inherited from the source container)"
}

# A scratch container left over from a previous crashed drill would make
# `docker run` fail on the name. Clear it, but only that exact name.
$existing = docker ps -a --filter "name=^/$ScratchContainer$" --format '{{.Names}}' 2>$null
if ($existing -contains $ScratchContainer) {
    Info "removing leftover scratch container '$ScratchContainer' from a previous drill"
    docker rm -f $ScratchContainer 1>$null 2>&1
}

# --- Source counts -----------------------------------------------------------
# Taken BEFORE the restore so the comparison is against the live database as it
# is now, not as the dump happened to be.
Info 'reading source row counts...'

# A wrong -Container/-DbName/-DbUser - the mistake that becomes possible now the
# target is overridable - would make every probe below return "table absent", and
# the comparison treats "absent in both" as tolerable. The drill would then report
# a clean pass having verified nothing at all, which is the worst possible
# failure mode for a check whose whole purpose is to prove a backup works. So the
# source must demonstrably contain the application's schema before anything else
# happens.
$sourceTableCount = -1
$sourceTableSql = 'SELECT count(*) FROM information_schema.tables WHERE table_schema=''public'';'
$sourceTableRows = Get-DbScalar -ContainerName $Container -User $DbUser -Database $DbName -Sql $sourceTableSql
if ($null -eq $sourceTableRows) {
    # Distinct from "empty", and the distinction matters: an operator told the
    # database is empty goes looking for lost tables, when the real fault is a
    # wrong container, database or role. hr_system_db, for instance, has no
    # `postgres` role at all, so `-DbUser postgres` fails at the connection.
    Write-Fail ("could not read schema public in database '$DbName' on container '$Container' as role '$DbUser'. Check all three. The drill refuses to continue because every comparison would report ABSENT and it would pass having verified nothing.")
}
$sourceTableCount = [int64]$sourceTableRows
if ($sourceTableCount -lt 1) {
    Write-Fail ("the source database '$DbName' in '$Container' has NO tables in schema public. There is nothing there to back up or to compare against, so the drill refuses to run rather than reporting every table as absent from both sides.")
}
Info ("  source schema public holds {0} table(s)" -f $sourceTableCount)

# The Prisma migration ledger, when the source project uses one. Not required:
# this database was created with `db push`, so it legitimately has none, and
# asserting it would fail the drill for a project decision rather than a fault.
$sourceHasPrismaMigrations = Test-TableExists -ContainerName $Container -User $DbUser -Database $DbName -Table '_prisma_migrations'

# Source-side structure, so the restored copy can be judged against something
# other than a hardcoded expectation.
$sourceConstraints = Get-ConstraintCatalog -ContainerName $Container -User $DbUser -Database $DbName
$sourceFkCount = @($sourceConstraints.constraints | Where-Object { $_.type -eq 'f' }).Count
$sourcePkCount = @($sourceConstraints.constraints | Where-Object { $_.type -eq 'p' }).Count

$sourceCounts = @{}
foreach ($spec in $CHECK_TABLES) {
    $t = $spec.table
    $sourceCounts[$t] = Get-RowCount -ContainerName $Container -User $DbUser -Database $DbName -Table $t
    if ($sourceCounts[$t] -eq -1) {
        Info ("  {0,-20} ABSENT from source" -f $t)
    }
    else {
        Info ("  {0,-20} {1}" -f $t, $sourceCounts[$t])
    }
}

# Highest id / createdAt per table, read BEFORE the restore. Used only for the
# MONO tables, to tell post-backup appends apart from corruption.
$sourceMarkers = @{}
foreach ($spec in $CHECK_TABLES) {
    if ($spec.mode -ne 'MONO') { continue }
    $sourceMarkers[$spec.table] = Get-TableMaxMarker -ContainerName $Container -User $DbUser -Database $DbName -Table $spec.table
    if ($null -ne $sourceMarkers[$spec.table]) {
        Info ("  {0,-20} source max id={1} max createdAt={2}" -f $spec.table, `
            $sourceMarkers[$spec.table].MaxId, $sourceMarkers[$spec.table].MaxCreatedAt)
    }
}

# --- Start the scratch server ------------------------------------------------
Info 'starting the scratch PostgreSQL container...'
& docker run -d --name $ScratchContainer -e POSTGRES_PASSWORD=drill -e "POSTGRES_DB=$ScratchDbName" -e "POSTGRES_USER=$ScratchDbUser" $ScratchImage 1>$null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "could not start the scratch container from image '$ScratchImage'."
}

# The server needs a moment before it accepts connections. Polling is used rather
# than a fixed sleep so a slow host does not fail the drill for the wrong reason.
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    & docker exec $ScratchContainer pg_isready -U $ScratchDbUser -d $ScratchDbName 1>$null 2>&1
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    docker rm -f $ScratchContainer 1>$null 2>&1
    Write-Fail 'the scratch container never became ready within 30 seconds.'
}
Info 'scratch server is accepting connections'

# --- Restore -----------------------------------------------------------------
# `restore.ps1` is reused rather than reimplemented, so the drill exercises the
# SAME code path an operator would use in a real disaster. It is pointed at the
# scratch container and told to skip the safety backup, because there is nothing
# on the scratch server worth preserving and the safety call would otherwise dump
# the empty scratch database into the real backup folder.
$restore = Join-Path $PSScriptRoot 'restore.ps1'
if (-not (Test-Path -LiteralPath $restore)) {
    docker rm -f $ScratchContainer 1>$null 2>&1
    Write-Fail "restore.ps1 not found at $restore. The drill must exercise the real restore path."
}

Info 'restoring the dump into the scratch database...'
# restore.ps1 reports progress with Write-Host. On Windows PowerShell 5.1
# Write-Host writes to the HOST, not to stdout, so it survives `2>&1` and lands
# in front of the JSON on stdout - which is why `-Json | ConvertFrom-Json` failed
# even after the drill's own output was moved to stderr. Write-Host output cannot
# be captured through a PowerShell redirection at all, so in JSON mode it is
# discarded rather than redirected. The trade is deliberate: an operator parsing
# the JSON gets parseable JSON, and an operator watching a drill gets the full
# narrative by omitting -Json. The drill's own verdict and every comparison are
# in the JSON regardless.
#
# restore.ps1 reports a failed load with Write-Error, and this script runs with
# ErrorActionPreference = Stop. Invoked plainly, that is a TERMINATING error that
# propagates straight out of the call below: the drill never reaches its own
# `restoreExit -ne 0` branch, so it never prints the verdict AND never destroys
# the scratch container. A failed drill that leaks a running container is a
# second problem nobody was looking for, so the call is wrapped and the failure
# is turned into a non-zero exit code for the existing branch to handle. This
# changes nothing about the verdict - it can only ever fail here, not pass.
$restoreExit = 0
$restoreErrorText = ''
try {
    if ($script:JsonMode) {
        & $restore -Path $dumpFile -Container $ScratchContainer -DbUser $ScratchDbUser -DbName $ScratchDbName -Force -SkipSafetyBackup *>&1 | Out-Null
    }
    else {
        & $restore -Path $dumpFile -Container $ScratchContainer -DbUser $ScratchDbUser -DbName $ScratchDbName -Force -SkipSafetyBackup
    }
    $restoreExit = $LASTEXITCODE
}
catch {
    $restoreExit = 1
    $restoreErrorText = [string] $_.Exception.Message
}

if ($restoreExit -ne 0) {
    Info "restore FAILED with exit code $restoreExit"
    if (-not [string]::IsNullOrWhiteSpace($restoreErrorText)) {
        Info "restore error: $restoreErrorText"
    }
    Info 'the restored database is unusable, so no integrity or smoke check was attempted against it'
    if (-not $KeepScratch) { docker rm -f $ScratchContainer 1>$null 2>&1; Info 'scratch container destroyed' }
    else { Info "scratch container kept: $ScratchContainer" }
    Write-DrillLine ("RESTORE_DRILL result=FAILED dump={0} reason=restore_failed exit={1} duration_s={2}" -f `
        (Split-Path $dumpFile -Leaf), $restoreExit, [int]((Get-Date) - $startedAt).TotalSeconds)
    exit 1
}

# --- Compare -----------------------------------------------------------------
# Row counts must MATCH EXACTLY, not merely be "close". A restore that silently
# drops rows still produces a database that looks alive and is quietly wrong, so
# any difference is a failed drill.
Info 'comparing restored row counts against the source...'
$results = @()
$mismatches = 0
$absentBoth = 0

foreach ($spec in $CHECK_TABLES) {
    $t = $spec.table
    $mode = $spec.mode
    $restored = Get-RowCount -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table $t
    $source = $sourceCounts[$t]

    $status = 'MATCH'
    $note = ''
    $drift = 0
    $driftExplanation = ''
    $restoredMarker = $null

    if ($source -eq -1 -and $restored -eq -1) {
        $status = 'BOTH_ABSENT'
        $absentBoth++
    }
    elseif ($mode -eq 'MONO') {
        # Append-only table. Rows written after the dump is missing from the
        # restore by definition, so the live source is expected to be higher.
        $lag = $source - $restored
        $drift = $restored - $source
        $restoredMarker = Get-TableMaxMarker -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table $t
        $sourceMarker = $sourceMarkers[$t]

        $srcMax = ''
        $resMax = ''
        $srcCreated = ''
        $resCreated = ''
        if ($null -ne $sourceMarker) {
            $srcMax = $sourceMarker.MaxId
            $srcCreated = $sourceMarker.MaxCreatedAt
        }
        if ($null -ne $restoredMarker) {
            $resMax = $restoredMarker.MaxId
            $resCreated = $restoredMarker.MaxCreatedAt
        }

        if ($restored -gt $source) {
            # Impossible for a point-in-time dump. Means the restore is not from
            # this source, or the dump is corrupt.
            $status = 'MISMATCH'
            $note = 'restored EXCEEDS source, which a point-in-time dump cannot do'
            $driftExplanation = 'RESTORED_EXCEEDS_SOURCE'
            $mismatches++
        }
        elseif ($lag -gt $MONO_MAX_LAG) {
            $status = 'MISMATCH'
            $note = "append-only table is $lag rows behind, beyond the $MONO_MAX_LAG tolerance"
            $driftExplanation = 'BEYOND_LAG_TOLERANCE'
            $mismatches++
        }
        elseif ($lag -eq 0) {
            $status = 'MONOTONIC'
            $note = 'append-only; restored count equals the live count'
            $driftExplanation = 'EXACT_AT_DUMP'
        }
        elseif ([string]::IsNullOrWhiteSpace($srcMax) -or [string]::IsNullOrWhiteSpace($resMax)) {
            # No comparable marker (an empty table on one side, or a table with no
            # id/createdAt). Report the arithmetic, do not claim an explanation.
            $status = 'MONOTONIC'
            $note = "append-only; $lag row(s) short; no comparable id/createdAt marker, so the cause is unconfirmed"
            $driftExplanation = 'CAUSE_UNCONFIRMED'
        }
        elseif ([string]::CompareOrdinal($resMax, $srcMax) -le 0) {
            # The evidence supports the benign explanation: every row the dump
            # holds is also in the live table, and the live table has grown at its
            # tail since. That is what an append-only log does on a working
            # system, and it is stated rather than assumed.
            $status = 'MONOTONIC'
            $note = "append-only; $lag row(s) short. Restored max id ($resMax) does not exceed source max id ($srcMax), so the missing rows are appended-since-backup rather than lost."
            $driftExplanation = 'ROWS_ADDED_AFTER_BACKUP'
        }
        else {
            # Fewer rows in the restore, yet the restore holds a row NEWER than
            # anything in the live source. Post-backup appends cannot produce
            # that - an append would be in the source too. Reporting this as
            # ordinary drift would be exactly the "hide the drift" failure the
            # brief forbids, so it fails the drill.
            $status = 'MISMATCH'
            $note = "append-only; $lag row(s) short AND restored max id ($resMax) exceeds source max id ($srcMax). Post-backup appends cannot produce that."
            $driftExplanation = 'DRIFT_UNEXPLAINED'
            $mismatches++
        }

        # One explicit, greppable line per append-only table. The numbers are
        # labelled so the line can be read without the surrounding narrative:
        # expected_at_backup is what the dump holds, current_source is the live
        # database now.
        Info ("  {0,-20} expected_at_backup={1} current_source={2} restored={1}  MONO  {3}  drift={4} live row(s)  explanation={5}  restored_max={6} source_max={7}" -f `
                $t, $restored, $source, $status, $drift, $driftExplanation, $resCreated, $srcCreated)
        $results += [pscustomobject]@{
            table               = $t
            mode                = $mode
            source              = $source
            restored            = $restored
            status              = $status
            note                = $note
            drift               = $drift
            driftExplanation    = $driftExplanation
            restoredMaxId       = $resMax
            sourceMaxId         = $srcMax
            restoredMaxCreatedAt = $resCreated
            sourceMaxCreatedAt  = $srcCreated
        }
        continue
    }
    elseif ($source -ne $restored) {
        $status = 'MISMATCH'
        $note = "delta $($restored - $source)"
        $mismatches++
    }

    $results += [pscustomobject]@{
        table                = $t
        mode                 = $mode
        source               = $source
        restored             = $restored
        status               = $status
        note                 = $note
        drift                = 0
        driftExplanation     = 'EXACT'
        restoredMaxId        = ''
        sourceMaxId          = ''
        restoredMaxCreatedAt = ''
        sourceMaxCreatedAt   = ''
    }

    Info ("  {0,-20} source={1,-8} restored={2,-8} {3} {4}" -f $t, $source, $restored, $status, $note)
}

$elapsed = [int]((Get-Date) - $startedAt).TotalSeconds

# --- Application-level sanity ------------------------------------------------
# Row counts prove the DATA arrived. These prove the dump produced a database the
# application could actually boot against: the schema Prisma expects exists, and
# the columns the app selects are present.
$appChecks = @()
Info 'verifying application-level schema...'

$tableTotal = & docker exec $ScratchContainer psql -U $ScratchDbUser -d $ScratchDbName -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>$null
$tableTotal = [int64](([string]($tableTotal | Select-Object -First 1)).Trim())
$appChecks += [pscustomobject]@{ name = 'public schema table count'; value = $tableTotal; ok = ($tableTotal -gt 0) }
Info ("  tables in public schema: {0}" -f $tableTotal)

# The columns added during this development cycle. Their absence means the dump
# predates them and the restored database would break the running application
# even though every row count matched.
$requiredColumns = @(
    @{ table = 'Employee'; column = 'labourCardNumber' },
    @{ table = 'Employee'; column = 'labourCardExpiry' },
    @{ table = 'Employee'; column = 'residencePermitNumber' },
    @{ table = 'Employee'; column = 'residencePermitExpiry' },
    @{ table = 'Employee'; column = 'airTicketEntitlementPerYear' }
)
foreach ($rc in $requiredColumns) {
    $present = Test-ColumnExists -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table $rc.table -Column $rc.column
    $appChecks += [pscustomobject]@{ name = "$($rc.table).$($rc.column)"; value = $present; ok = $present }
    Info ("  {0,-40} {1}" -f "$($rc.table).$($rc.column)", $(if ($present) { 'present' } else { 'MISSING' }))
}

$appFailures = @($appChecks | Where-Object { -not $_.ok })

# ============================================================================
# PHASE 8 - DATABASE INTEGRITY
# ============================================================================
# Row counts prove DATA arrived. They say nothing about whether the database is
# structurally intact or administrable, and a dump that restores every row into
# tables with no primary keys, no foreign keys and no indexes still looks perfect
# to a row-count comparison while being unusable and unsafe. Each check below is
# named so the readiness report can cite one line rather than a single aggregate
# verdict.
#
# Every statement here runs against $ScratchContainer. The source is touched only
# by the final `live-source-unmodified` check, which re-reads counts to prove the
# drill itself wrote nothing.
Info 'running Phase 8 database integrity checks against the restored database...'
Add-IntegrityCheck -Name 'restore-exit-code' -Ok ($restoreExit -eq 0) `
    -Detail ("psql/restore.ps1 exit={0}; ON_ERROR_STOP=1 aborts on the first failed statement" -f $restoreExit)

# --- 8.1 required tables ------------------------------------------------------
# The ten compared tables, plus the Prisma migration ledger when the source
# project has one. A table that is absent from the SOURCE is not required of this
# dump, so it is not required of the restore either; requiring it would fail the
# drill for a schema decision rather than a fault.
$requiredTables = New-Object System.Collections.ArrayList
foreach ($spec in $CHECK_TABLES) {
    if ($sourceCounts[$spec.table] -ne -1) { [void] $requiredTables.Add($spec.table) }
}
if ($sourceHasPrismaMigrations) { [void] $requiredTables.Add('_prisma_migrations') }

$missingTables = New-Object System.Collections.ArrayList
$presentTables = 0
foreach ($t in $requiredTables) {
    if (Test-TableExists -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table $t) {
        $presentTables++
    }
    else {
        [void] $missingTables.Add($t)
        Info ("  {0,-40} MISSING from the restored schema" -f $t)
    }
}
$prismaNote = ''
if (-not $sourceHasPrismaMigrations) {
    $prismaNote = '; _prisma_migrations absent in source (project uses db push), so not required'
}
Add-IntegrityCheck -Name 'required-tables' -Ok ($missingTables.Count -eq 0) `
    -Detail ("{0}/{1} present{2}" -f $presentTables, $requiredTables.Count, $prismaNote)

# --- 8.2 required columns -----------------------------------------------------
# Covering every domain the product has, not just the five columns this drill
# started with. The five are still checked individually above and appear in this
# set too, so nothing previously verified stops being verified - they are simply
# now reported inside a set that cannot pass on five columns alone.
$REQUIRED_COLUMN_PAIRS = @(
    # --- Authentication and identity
    'User.id', 'User.name', 'User.email', 'User.password', 'User.role', 'User.emailVerified',
    'User.createdAt', 'User.updatedAt', 'Account.id', 'Account.userId', 'Account.provider',
    'PasswordResetToken.id', 'PasswordResetToken.userId', 'PasswordResetToken.tokenHash',
    'PasswordResetToken.purpose', 'PasswordResetToken.expiresAt', 'PasswordResetToken.usedAt',
    'UserSecurityFlag.userId', 'UserSecurityFlag.mustChangePassword',
    'UserSecurityFlag.accountDisabled', 'UserSecurityFlag.lockedUntil',
    'RoleRequest.id', 'RoleRequest.userId', 'RoleRequest.requestedRole', 'RoleRequest.status',

    # --- Employee master record. Every column PROFILE_SELECT and RESTRICTED_SELECT
    #     name in app/employees/[id]/employee-select.ts is here: a missing one makes
    #     Prisma fail the detail query, not merely render less.
    'Employee.id', 'Employee.userId', 'Employee.employeeCode', 'Employee.firstName',
    'Employee.lastName', 'Employee.email', 'Employee.rollNumber', 'Employee.photo',
    'Employee.phone', 'Employee.gender', 'Employee.bloodGroup', 'Employee.dateOfBirth',
    'Employee.nationality', 'Employee.maritalStatus', 'Employee.designation',
    'Employee.department', 'Employee.joiningDate', 'Employee.employmentType',
    'Employee.workLocation', 'Employee.probationDays', 'Employee.currentStatus',
    'Employee.isActive', 'Employee.address', 'Employee.permanentAddress',
    'Employee.emergencyContact', 'Employee.emergencyPhone', 'Employee.governmentId',
    'Employee.bankName', 'Employee.accountNumber', 'Employee.iban', 'Employee.ifscCode',
    'Employee.basicSalary', 'Employee.housingAllowance', 'Employee.transportAllowance',
    'Employee.otherAllowance', 'Employee.passportNumber', 'Employee.passportExpiry',
    'Employee.emiratesId', 'Employee.emiratesIdExpiry', 'Employee.visaNumber',
    'Employee.visaExpiry', 'Employee.visaType', 'Employee.visaIssueDate',
    'Employee.medicalInsuranceExpiry', 'Employee.iloeInsuranceExpiry',
    'Employee.labourCardNumber', 'Employee.labourCardExpiry',
    'Employee.residencePermitNumber', 'Employee.residencePermitExpiry',
    'Employee.airTicketEntitlementPerYear', 'Employee.airTicketTravelClass',
    'Employee.airTicketAnchorDate', 'Employee.shiftId', 'Employee.managerId',
    'Employee.lifecycle', 'Employee.deletedAt', 'Employee.sourceRequisitionId',
    'Employee.sourceCandidateId', 'Employee.createdAt', 'Employee.updatedAt',

    # --- Attendance
    'Attendance.id', 'Attendance.employeeId', 'Attendance.date', 'Attendance.checkIn',
    'Attendance.checkOut', 'Attendance.status', 'Attendance.lateMinutes',
    'Attendance.overtimeMinutes', 'Attendance.shiftId', 'Attendance.createdAt',
    'BiometricLog.id', 'BiometricLog.attendanceId', 'BiometricLog.deviceId',
    'BiometricLog.employeeId', 'BiometricLog.timestamp', 'BiometricLog.type',
    'Shift.id', 'Shift.name', 'Shift.startTime', 'Shift.endTime',

    # --- Leave
    'LeaveRequest.id', 'LeaveRequest.employeeId', 'LeaveRequest.type',
    'LeaveRequest.startDate', 'LeaveRequest.endDate', 'LeaveRequest.reason',
    'LeaveRequest.managerStatus', 'LeaveRequest.managerId', 'LeaveRequest.hrStatus',
    'LeaveRequest.hrId', 'LeaveRequest.status', 'LeaveRequest.dayPart',
    'LeaveRequest.deductedDays', 'LeaveRequest.balanceId', 'LeaveRequest.decidedAt',
    'LeaveRequest.decisionNote', 'LeaveBalance.id', 'LeaveBalance.employeeId',
    'LeaveBalance.leaveType', 'LeaveBalance.totalDays', 'LeaveBalance.usedDays',
    'LeaveBalance.year', 'LeaveAccrualPolicy.id', 'LeaveAccrualPolicy.leaveType',
    'LeaveAccrualPolicy.annualEntitlement', 'LeaveAccrualRun.id',
    'LeaveAccrualRun.employeeId', 'LeaveAccrualRun.daysCredited',

    # --- Payroll
    'SalaryStructure.id', 'SalaryStructure.employeeId', 'SalaryStructure.ctc',
    'SalaryStructure.basic', 'SalaryStructure.housingAllowance',
    'SalaryStructure.transportAllowance', 'SalaryStructure.iban', 'SalaryStructure.bankName',
    'SalaryRecord.id', 'SalaryRecord.employeeId', 'SalaryRecord.month', 'SalaryRecord.year',
    'SalaryRecord.basic', 'SalaryRecord.housingAllowance',
    'SalaryRecord.transportAllowance', 'SalaryRecord.medicalAllowance',
    'SalaryRecord.foodAllowance', 'SalaryRecord.travelAllowance',
    'SalaryRecord.commission', 'SalaryRecord.otherAllowances', 'SalaryRecord.latePenalty',
    'SalaryRecord.penalty', 'SalaryRecord.leaveDeduction', 'SalaryRecord.loanDeduction',
    'SalaryRecord.advanceSalary', 'SalaryRecord.otherDeductions',
    'SalaryRecord.overtimePay', 'SalaryRecord.bonus', 'SalaryRecord.netSalary',
    'SalaryRecord.status', 'SalaryRecord.paymentMethod', 'SalaryRecord.paidAt',
    'PayrollRun.id', 'PayrollRun.month', 'PayrollRun.year', 'PayrollRun.status',
    'PayrollRun.employeeCount', 'PayrollRun.totalNet', 'PayrollRun.totalDeductions',
    'PayrollRun.lockedAt', 'PayrollRun.approvedAt', 'PayrollRun.paidAt',
    'Overtime.id', 'Overtime.employeeId', 'Overtime.date', 'Overtime.hours',
    'Overtime.ratePerHour', 'Overtime.totalPay', 'Overtime.status',

    # --- Approvals, onboarding and offboarding
    'EmployeeChangeRequest.id', 'EmployeeChangeRequest.employeeId',
    'EmployeeChangeRequest.status', 'EmployeeChangeRequest.requestedBy',
    'EmployeeChangeRequest.approvedBy', 'EmployeeChangeRequest.approvedAt',
    'EmployeeChangeRequest.rejectionReason', 'EmployeeChangeRequest.changes',
    'ChangeRequestDocument.id', 'ChangeRequestDocument.requestId',
    'ChangeRequestDocument.documentType', 'ChangeRequestDocument.documentUrl',
    'OnboardingChecklistItem.id', 'OnboardingChecklistItem.employeeId',
    'OnboardingChecklistItem.category', 'OnboardingChecklistItem.label',
    'OnboardingChecklistItem.status', 'OffboardingRequest.id',
    'OffboardingRequest.employeeId', 'OffboardingRequest.status',
    'OffboardingRequest.lastWorkingDay', 'OffboardingRequest.noticePeriodEnd',
    'OffboardingChecklistItem.id', 'OffboardingChecklistItem.offboardingId',
    'OffboardingChecklistItem.status', 'FinalSettlement.id',
    'FinalSettlement.offboardingId', 'FinalSettlement.finalAmount',

    # --- Exit lifecycle
    'ExitCase.id', 'ExitCase.employeeId', 'ExitCase.type', 'ExitCase.status',
    'ExitCase.reason', 'ExitCase.requestedAt', 'ExitCase.effectiveDate',
    'ExitCase.lastWorkingDate', 'ExitCase.noticePeriodDays', 'ExitCase.initiatedById',
    'ExitCase.decidedById', 'ExitCase.decidedAt', 'ExitInterview.id',
    'ExitInterview.exitCaseId', 'ExitInterview.conductedById', 'ExitInterview.conductedAt',
    'ExitInterview.rating', 'ExitInterview.wouldRejoin', 'RehireRecord.id',
    'RehireRecord.employeeId', 'RehireRecord.exitCaseId', 'RehireRecord.eligible',
    'RehireRecord.assessedAt', 'RehireRecord.assessedById',

    # --- Visa and compliance
    'DocumentExpiryReminder.id', 'DocumentExpiryReminder.employeeId',
    'DocumentExpiryReminder.documentType', 'DocumentExpiryReminder.thresholdDays',
    'DocumentExpiryReminder.expiryDate', 'DocumentExpiryReminder.recipientRole',
    'DocumentExpiryReminder.sentAt', 'DocumentRenewal.id', 'DocumentRenewal.employeeId',
    'DocumentRenewal.documentType', 'DocumentRenewal.currentExpiry',
    'DocumentRenewal.status', 'DocumentRenewal.newExpiry', 'DocumentRenewal.reviewedBy',
    'DocumentRenewal.reviewedAt', 'VisaRequest.id', 'VisaRequest.employeeId',
    'VisaRequest.visaType', 'VisaRequest.status', 'BusinessTravelRequest.id',
    'BusinessTravelRequest.employeeId', 'BusinessTravelRequest.departureDate',
    'BusinessTravelRequest.status', 'AirTicketEntitlement.id',
    'AirTicketEntitlement.employeeId', 'AirTicketEntitlement.windowKey',
    'AirTicketEntitlement.entitledTickets', 'AirTicketEntitlement.usedTickets',

    # --- Letters
    'Letter.id', 'Letter.employeeId', 'Letter.candidateId', 'Letter.templateId',
    'Letter.referenceNumber', 'Letter.content_en', 'Letter.content_ar',
    'Letter.pdfUrl', 'Letter.status', 'Letter.approvedBy', 'Letter.approvedAt',
    'LetterTemplate.id', 'LetterTemplate.name', 'LetterTemplate.type',
    'LetterTemplate.content_en', 'LetterTemplate.content_ar', 'LetterTemplate.isActive',
    'LetterRequest.id', 'LetterRequest.employeeId', 'LetterRequest.templateId',
    'LetterRequest.status', 'LetterApproval.id', 'LetterApproval.letterRequestId',
    'LetterApproval.approverId', 'LetterApproval.level', 'LetterApproval.action',
    'LetterApproval.comments', 'LetterRecord.id', 'LetterRecord.employeeId',
    'LetterRecord.type', 'LetterRecord.recipientName', 'LetterRecord.documentKey',
    'LetterRecord.version', 'LetterRecord.status',

    # --- Service requests and assets
    'ServiceCategory.id', 'ServiceCategory.name', 'ServiceCategory.type',
    'ServiceRequest.id', 'ServiceRequest.employeeId', 'ServiceRequest.categoryId',
    'ServiceRequest.details', 'ServiceRequest.status', 'Attachment.id',
    'Attachment.fileName', 'Attachment.fileUrl', 'Attachment.fileType',
    'Attachment.category', 'Asset.id', 'Asset.assetTag', 'Asset.name', 'Asset.status',
    'AssetAssignment.id', 'AssetAssignment.assetId', 'AssetAssignment.employeeId',
    'AssetAssignment.assignedAt', 'AssetAssignment.returnedAt',

    # --- Audit trail and notifications
    'AuditLog.id', 'AuditLog.employeeId', 'AuditLog.action', 'AuditLog.details',
    'AuditLog.changedBy', 'AuditLog.createdAt', 'SecurityAuditLog.id',
    'SecurityAuditLog.action', 'SecurityAuditLog.actorEmail', 'SecurityAuditLog.actorRole',
    'SecurityAuditLog.target', 'SecurityAuditLog.outcome', 'SecurityAuditLog.detail',
    'SecurityAuditLog.requestPath', 'SecurityAuditLog.requestMethod',
    'SecurityAuditLog.ipAddress', 'SecurityAuditLog.createdAt',
    'Notification.id', 'Notification.employeeId', 'Notification.title',
    'Notification.message', 'Notification.type', 'Notification.isRead',
    'Notification.link', 'Notification.createdAt', 'NotificationDelivery.id',
    'NotificationDelivery.notificationId', 'NotificationDelivery.status',
    'NotificationDelivery.attempts',

    # --- System configuration
    'ServiceConfig.id', 'ServiceConfig.module', 'ServiceConfig.key',
    'ServiceConfig.type', 'ServiceConfig.value', 'ServiceConfig.isActive'
)

$columnProbe = Get-ExistingColumnPairs -ContainerName $ScratchContainer -User $ScratchDbUser `
    -Database $ScratchDbName -Pairs $REQUIRED_COLUMN_PAIRS
$missingColumns = @($REQUIRED_COLUMN_PAIRS | Where-Object { $columnProbe.found -notcontains $_ })
foreach ($m in $missingColumns) {
    Info ("  {0,-40} MISSING from the restored schema" -f $m)
}
if ($columnProbe.failed) {
    Add-IntegrityCheck -Name 'required-columns' -Ok $false `
        -Detail 'a column existence query could not be read; the restored schema is UNKNOWN and is not being reported as verified'
}
else {
    Add-IntegrityCheck -Name 'required-columns' -Ok ($missingColumns.Count -eq 0) `
        -Detail ("{0}/{1} present across {2} tables" -f `
            ($REQUIRED_COLUMN_PAIRS.Count - $missingColumns.Count), $REQUIRED_COLUMN_PAIRS.Count, `
            (@($REQUIRED_COLUMN_PAIRS | ForEach-Object { $_.Split('.')[0] } | Sort-Object -Unique)).Count)
}

# --- 8.3 primary keys ---------------------------------------------------------
# Read once and reused for the key and index checks below; one catalog query
# rather than one per table.
$restoredConstraintResult = Get-ConstraintCatalog -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName
$restoredConstraints = $restoredConstraintResult.constraints
$restoredPkNames = @($restoredConstraints | Where-Object { $_.type -eq 'p' } | ForEach-Object { $_.table })
$restoredFk = @($restoredConstraints | Where-Object { $_.type -eq 'f' })

$CORE_PK_TABLES = @(
    'Employee', 'User', 'Attendance', 'LeaveRequest', 'LeaveBalance', 'SalaryRecord',
    'SalaryStructure', 'PayrollRun', 'Letter', 'LetterTemplate', 'LetterRecord',
    'AuditLog', 'SecurityAuditLog', 'Notification', 'DocumentExpiryReminder',
    'DocumentRenewal', 'EmployeeChangeRequest', 'ExitCase', 'LetterApproval',
    'Candidate', 'Application', 'Asset', 'ServiceRequest', 'OnboardingChecklistItem',
    'PasswordResetToken', 'UserSecurityFlag', 'Overtime'
)

if ($restoredConstraintResult.failed) {
    Add-IntegrityCheck -Name 'primary-keys' -Ok $false `
        -Detail 'pg_constraint could not be read from the restored database'
}
else {
    $missingPk = @($CORE_PK_TABLES | Where-Object { $restoredPkNames -notcontains $_ })
    foreach ($m in $missingPk) {
        Info ("  {0,-40} has NO primary key" -f $m)
    }
    Add-IntegrityCheck -Name 'primary-keys' -Ok ($missingPk.Count -eq 0) `
        -Detail ("{0}/{1} core tables have a PRIMARY KEY constraint; {2} primary key(s) in the restored schema" -f `
            ($CORE_PK_TABLES.Count - $missingPk.Count), $CORE_PK_TABLES.Count, $restoredPkNames.Count)
}

# --- 8.4 foreign keys ---------------------------------------------------------
# Two assertions, because they catch different faults. The total catches a dump
# that lost constraints wholesale; the named relationships catch a dump that lost
# one specific foreign key, which is invisible in a row count and silently
# removes the guarantee the application relies on.
$REQUIRED_FK = @(
    @{ child = 'SalaryRecord';    parent = 'Employee' },
    @{ child = 'LeaveRequest';    parent = 'Employee' },
    @{ child = 'AuditLog';        parent = 'Employee' },
    @{ child = 'LeaveBalance';    parent = 'Employee' },
    @{ child = 'Attendance';      parent = 'Employee' },
    @{ child = 'Notification';    parent = 'Employee' },
    @{ child = 'EmployeeChangeRequest'; parent = 'Employee' },
    @{ child = 'ExitCase';        parent = 'Employee' },
    @{ child = 'DocumentExpiryReminder'; parent = 'Employee' },
    @{ child = 'DocumentRenewal'; parent = 'Employee' },
    @{ child = 'AssetAssignment'; parent = 'Employee' },
    @{ child = 'Employee';        parent = 'User' },
    @{ child = 'Letter';          parent = 'LetterTemplate' },
    @{ child = 'LetterApproval';  parent = 'LetterRequest' }
)

if ($restoredConstraintResult.failed) {
    Add-IntegrityCheck -Name 'foreign-keys' -Ok $false -Detail 'pg_constraint could not be read from the restored database'
    Add-IntegrityCheck -Name 'foreign-key-relations' -Ok $false -Detail 'pg_constraint could not be read from the restored database'
}
else {
    # Floor derived from the source rather than hardcoded, so the assertion tracks
    # the schema instead of the day it was written. Ten percent of slack covers a
    # migration or two applied between the dump and the drill.
    $fkFloor = [int][Math]::Max(10, [Math]::Floor($sourceFkCount * 0.9))
    Add-IntegrityCheck -Name 'foreign-keys' -Ok ($restoredFk.Count -ge $fkFloor) `
        -Detail ("restored={0} foreign key(s), source={1}, minimum required={2}" -f $restoredFk.Count, $sourceFkCount, $fkFloor)

    $missingFk = @()
    foreach ($rel in $REQUIRED_FK) {
        $found = @($restoredFk | Where-Object { $_.table -eq $rel.child -and $_.parent -eq $rel.parent })
        if ($found.Count -eq 0) {
            $missingFk += ($rel.child + '.' + $rel.parent)
            Info ("  {0,-40} FOREIGN KEY MISSING" -f ($rel.child + ' -> ' + $rel.parent))
        }
    }
    Add-IntegrityCheck -Name 'foreign-key-relations' -Ok ($missingFk.Count -eq 0) `
        -Detail ("{0}/{1} load-bearing relationships survived: SalaryRecord/LeaveRequest/AuditLog/Notification/ExitCase -> Employee, Employee -> User, Letter -> LetterTemplate" -f `
            ($REQUIRED_FK.Count - $missingFk.Count), $REQUIRED_FK.Count)
}

# --- 8.5 required indexes -----------------------------------------------------
# Asserted by name OR by column set, because a Prisma index name is generated
# mechanically: matching the name alone would not notice that the columns under
# it had changed. The absence of one of these is not an error - nothing breaks -
# it is a silent performance cliff on the exact queries the product runs most
# (per-employee audit trail, newest audit rows, notification feed), which is why
# it belongs in a readiness drill rather than in a list of nice-to-haves.
$indexResult = Get-IndexCatalog -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName
$restoredIndexes = $indexResult.indexes

$REQUIRED_INDEXES = @(
    @{ table = 'AuditLog';         name = 'AuditLog_employeeId_createdAt_idx'; cols = 'createdAt,employeeId' },
    @{ table = 'SecurityAuditLog'; name = 'SecurityAuditLog_createdAt_idx';   cols = 'createdAt' },
    @{ table = 'Notification';     name = 'Notification_employeeId_createdAt_idx'; cols = 'createdAt,employeeId' },
    @{ table = 'Attendance';       name = 'Attendance_employeeId_date_idx';   cols = 'date,employeeId' },
    @{ table = 'Attendance';       name = 'Attendance_date_idx';              cols = 'date' },
    @{ table = 'LeaveBalance';     name = 'LeaveBalance_employeeId_year_idx'; cols = 'employeeId,year' },
    @{ table = 'SalaryRecord';     name = 'SalaryRecord_employeeId_year_month_idx'; cols = 'employeeId,month,year' },
    @{ table = 'Employee';         name = 'Employee_deletedAt_idx';          cols = 'deletedAt' }
)

if ($indexResult.failed) {
    Add-IntegrityCheck -Name 'required-indexes' -Ok $false `
        -Detail 'pg_indexes could not be read from the restored database'
}
else {
    $missingIdx = @()
    foreach ($want in $REQUIRED_INDEXES) {
        $hit = @($restoredIndexes | Where-Object {
            $_.table -eq $want.table -and ($_.name -eq $want.name -or $_.cols -eq $want.cols)
        })
        if ($hit.Count -eq 0) {
            $missingIdx += ($want.table + ':' + $want.cols)
            Info ("  {0,-40} INDEX MISSING (expected {1} covering {2})" -f $want.table, $want.name, $want.cols)
        }
    }
    Add-IntegrityCheck -Name 'required-indexes' -Ok ($missingIdx.Count -eq 0) `
        -Detail ("{0}/{1} declared indexes present ({2} indexes total in the restored schema)" -f `
            ($REQUIRED_INDEXES.Count - $missingIdx.Count), $REQUIRED_INDEXES.Count, $restoredIndexes.Count)
}

# --- 8.6 row counts are sensible ----------------------------------------------
# Restated as a named check so the integrity section is complete on its own. The
# work is the EXACT/MONO comparison above; this does not repeat it, it asserts the
# result so it appears in the integrity summary and in the JSON with a name
# rather than only as a number in `mismatches`.
Add-IntegrityCheck -Name 'row-counts-sensible' -Ok ($mismatches -eq 0) `
    -Detail ("{0} table(s) compared, {1} mismatch(es), {2} absent from both sides" -f `
        $CHECK_TABLES.Count, $mismatches, $absentBoth)

# --- 8.7 an administrable database --------------------------------------------
# A restore with no administrative account is not a recovery: nobody can log in
# to fix anything, promote a role, or read the data. This is the check that turns
# "the dump restored" into "the dump restored to something operable".
$adminSql = 'SELECT (SELECT count(*) FROM public.\"User\")::text || ''|'' || (SELECT count(*) FROM public.\"User\" WHERE role IN (''ADMIN'',''SUPER_ADMIN''))::text || ''|'' || (SELECT count(*) FROM public.\"User\" WHERE password IS NOT NULL AND password <> '''')::text || ''|'' || coalesce((SELECT string_agg(role, '','' ORDER BY role) FROM (SELECT DISTINCT role FROM public.\"User\") r),'''');'
$adminLine = Get-DbScalar -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Sql $adminSql
$adminOk = $false
$adminDetail = 'the User table could not be read from the restored database'
if ($null -ne $adminLine) {
    $parts = $adminLine.Split('|')
    $totalUsers = 0
    $adminUsers = 0
    $pwhUsers = 0
    if ($parts.Count -ge 1) { [int64]::TryParse($parts[0], [ref] $totalUsers) | Out-Null }
    if ($parts.Count -ge 2) { [int64]::TryParse($parts[1], [ref] $adminUsers) | Out-Null }
    if ($parts.Count -ge 3) { [int64]::TryParse($parts[2], [ref] $pwhUsers) | Out-Null }
    $rolesPresent = ''
    if ($parts.Count -ge 4) { $rolesPresent = $parts[3] }
    $adminOk = ($totalUsers -gt 0 -and $adminUsers -ge 1)
    $adminDetail = ("{0} user(s), {1} with a password hash, roles present: {2}; ADMIN/SUPER_ADMIN accounts: {3}" -f `
        $totalUsers, $pwhUsers, ($(if ([string]::IsNullOrWhiteSpace($rolesPresent)) { 'none' } else { $rolesPresent })), $adminUsers)
    $script:restoredRoleList = $rolesPresent
    $script:restoredUserCount = $totalUsers
    $script:restoredAdminCount = $adminUsers
    $script:restoredPasswordCount = $pwhUsers
}
else {
    $script:restoredRoleList = ''
    $script:restoredUserCount = -1
    $script:restoredAdminCount = -1
    $script:restoredPasswordCount = -1
}
Add-IntegrityCheck -Name 'admin-user-present' -Ok $adminOk -Detail $adminDetail

# --- 8.8 role vocabulary ------------------------------------------------------
# `User.role` is a plain String, so the database will happily hold any value.
# An unrecognised role is not cosmetic: lib/auth/guards.ts grants capability by
# comparing against a fixed vocabulary, so an account holding one holds nothing
# and cannot be diagnosed from the UI. Asserted in the direction that can
# actually detect a fault - every role PRESENT must be a known role - rather than
# requiring all six to be populated. A four-person development database is not
# required to employ an HR and a Finance user; requiring it would fail the drill
# for a staffing fact and train operators to ignore the check. Roles absent from
# the known list are reported so the gap is visible.
$unknownRoles = @()
foreach ($r in ($script:restoredRoleList -split ',')) {
    $trimmed = $r.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
    if ($KNOWN_ROLES -notcontains $trimmed) { $unknownRoles += $trimmed }
}
$absentKnown = @($KNOWN_ROLES | Where-Object { ($script:restoredRoleList -split ',') -notcontains $_ })
$rolesOk = ($unknownRoles.Count -eq 0 -and $script:restoredUserCount -gt 0)
Add-IntegrityCheck -Name 'user-roles-known' -Ok $rolesOk `
    -Detail ("roles present: {0}; unrecognised: {1}; known roles not used by this database: {2}" -f `
        ($(if ([string]::IsNullOrWhiteSpace($script:restoredRoleList)) { 'none' } else { $script:restoredRoleList })), `
        ($(if ($unknownRoles.Count -eq 0) { 'none' } else { $unknownRoles -join ',' })), `
        ($(if ($absentKnown.Count -eq 0) { 'none' } else { $absentKnown -join ',' })))

# --- 8.9 no silent partial restore --------------------------------------------
# ON_ERROR_STOP=1 already turns a failed statement into a non-zero exit, and the
# drill fails on that. This is the second line of defence: a dump can be cut
# short in a way that leaves psql with nothing left to fail on - a clean EOF
# after the last complete statement - and every table that did load will have the
# right row count. Comparing the restored schema against the source schema
# catches that, because a truncated dump restores fewer tables and fewer keys.
$tableShortfall = $sourceTableCount - $tableTotal
$completeOk = ($tableTotal -gt 0 -and $tableShortfall -le $MaxTableShortfall)
Add-IntegrityCheck -Name 'restore-completeness' -Ok $completeOk `
    -Detail ("restored schema has {0} table(s), source has {1}, tolerated shortfall {2}" -f `
        $tableTotal, $sourceTableCount, $MaxTableShortfall)

$pkShortfall = $sourcePkCount - $restoredPkNames.Count
$fkShortfall = $sourceFkCount - $restoredFk.Count
$keyCountsOk = ($restoredPkNames.Count -gt 0 -and $pkShortfall -le $MaxTableShortfall -and $fkShortfall -le $MaxTableShortfall)
Add-IntegrityCheck -Name 'constraint-counts-plausible' -Ok $keyCountsOk `
    -Detail ("primary keys restored={0} source={1}; foreign keys restored={2} source={3}; tolerated shortfall {4}" -f `
        $restoredPkNames.Count, $sourcePkCount, $restoredFk.Count, $sourceFkCount, $MaxTableShortfall)

# --- 8.10 the drill itself wrote nothing to the live database ------------------
# Re-read the source and compare. This is the assertion behind the promise the
# drill makes in its own output. EXACT tables must be unchanged. MONO tables are
# append-only, so they may only have GROWN - anything else means the drill, or
# something it invoked, wrote to the live database.
$liveDrift = @()
foreach ($spec in $CHECK_TABLES) {
    $t = $spec.table
    $after = Get-RowCount -ContainerName $Container -User $DbUser -Database $DbName -Table $t
    if ($after -eq -1) { continue }
    if ($spec.mode -eq 'MONO') {
        if ($after -lt $sourceCounts[$t]) { $liveDrift += ("{0}: fell from {1} to {2}" -f $t, $sourceCounts[$t], $after) }
    }
    elseif ($after -ne $sourceCounts[$t]) {
        $liveDrift += ("{0}: changed from {1} to {2}" -f $t, $sourceCounts[$t], $after)
    }
}
Add-IntegrityCheck -Name 'live-source-unmodified' -Ok ($liveDrift.Count -eq 0) `
    -Detail ("re-read after the restore: {0} ({1} table(s) changed; the drill only ever writes to the scratch container)" -f `
        $(if ($liveDrift.Count -eq 0) { 'unchanged' } else { $liveDrift -join '; ' }), $liveDrift.Count)

# ============================================================================
# PHASE 9 - APPLICATION-LEVEL RESTORE SMOKE TEST
# ============================================================================
# Integrity proves the database is well formed. This proves it is USABLE: for each
# product domain, the query the application actually issues is run against the
# restored copy and must succeed. A count where a value is required, a
# data_type where the column must exist, and an explicit join where the
# application joins.
#
# PASS means the query ran. FAIL means it would not. SKIP means the schema is
# correct and the domain holds no rows yet - reported as SKIP, never as PASS,
# because "correct schema, nothing to show" and "the app's query breaks" are
# different answers and collapsing them would let a domain with zero rows certify
# a broken restore.
Info 'running Phase 9 application restore smoke test against the restored database...'

$smoke = {
    param([string] $Domain, [string] $Sql)
    $line = Get-DbScalar -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Sql $Sql
    if ($null -eq $line) {
        Add-SmokeCheck -Domain $Domain -Status 'FAIL' `
            -Detail 'the query the application runs against this domain failed on the restored database (psql returned an error)'
        return $null
    }
    return $line
}

# --- Authentication -----------------------------------------------------------
$authSql = 'SELECT (SELECT count(*) FROM public.\"User\")::text || ''|'' || (SELECT count(*) FROM public.\"User\" WHERE role IS NOT NULL AND role <> '''')::text || ''|'' || (SELECT count(*) FROM public.\"User\" WHERE password IS NOT NULL AND password <> '''')::text || ''|'' || (SELECT count(DISTINCT \"userId\") FROM public.\"Account\")::text;'
$authLine = & $smoke 'auth' $authSql
if ($null -ne $authLine) {
    $a = $authLine.Split('|')
    $users = [int64] $a[0]
    $withRole = [int64] $a[1]
    $withPassword = [int64] $a[2]
    $oauth = [int64] $a[3]

    $missingAuthCols = @()
    $wrongAuthTypes = @()
    foreach ($pair in @('User.password', 'User.role', 'User.email', 'User.emailVerified')) {
        $bits = $pair.Split('.')
        $t = Get-ColumnType -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table $bits[0] -Column $bits[1]
        if ([string]::IsNullOrWhiteSpace($t)) { $missingAuthCols += $pair }
        elseif ($pair -eq 'User.password' -and @('text', 'character varying') -notcontains $t) { $wrongAuthTypes += ("User.password is " + $t) }
        elseif ($pair -eq 'User.emailVerified' -and $t -notlike 'timestamp*' -and $t -notlike 'date*') { $wrongAuthTypes += ("User.emailVerified is " + $t) }
    }

    $usable = $withPassword + $oauth
    $authOk = ($users -gt 0 -and $withRole -eq $users -and $usable -ge 1 -and $missingAuthCols.Count -eq 0 -and $wrongAuthTypes.Count -eq 0)
    $authDetail = ("{0} user(s); {1} carry a usable credential (password hash or OAuth link); password/activation columns present and correctly typed" -f $users, $usable)
    if ($missingAuthCols.Count -gt 0) { $authDetail += '; MISSING columns: ' + ($missingAuthCols -join ', ') }
    if ($wrongAuthTypes.Count -gt 0) { $authDetail += '; wrong types: ' + ($wrongAuthTypes -join ', ') }
    if ($usable -lt 1) { $authDetail += '; NOBODY can authenticate against this restored database' }

    if ($users -eq 0) {
        Add-SmokeCheck -Domain 'auth' -Status 'SKIP' `
            -Detail ('schema is complete but the User table is empty, so no sign-in can be exercised: ' + $authDetail)
    }
    elseif ($authOk) {
        Add-SmokeCheck -Domain 'auth' -Status 'PASS' -Detail $authDetail
    }
    else {
        Add-SmokeCheck -Domain 'auth' -Status 'FAIL' -Detail $authDetail
    }
}

# --- Employees ----------------------------------------------------------------
$empSql = 'SELECT (SELECT count(*) FROM public.\"Employee\")::text || ''|'' || (SELECT count(*) FROM public.\"Employee\" WHERE \"firstName\" IS NOT NULL AND \"lastName\" IS NOT NULL AND email IS NOT NULL AND \"rollNumber\" IS NOT NULL)::text;'
$empLine = & $smoke 'employees' $empSql
if ($null -ne $empLine) {
    $e = $empLine.Split('|')
    $empTotal = [int64] $e[0]
    $empIdentified = [int64] $e[1]
    if ($empTotal -eq 0) {
        Add-SmokeCheck -Domain 'employees' -Status 'SKIP' `
            -Detail 'schema is complete but Employee holds no rows, so the directory query cannot be exercised'
    }
    elseif ($empIdentified -lt 1) {
        Add-SmokeCheck -Domain 'employees' -Status 'FAIL' `
            -Detail ("{0} employee row(s) but none has firstName, lastName, email and rollNumber all populated; the directory renders blanks and the employee code cannot be assigned" -f $empTotal)
    }
    else {
        Add-SmokeCheck -Domain 'employees' -Status 'PASS' `
            -Detail ("{0} employee(s); {1} with complete identity columns" -f $empTotal, $empIdentified)
    }
}

# --- Employee profile ---------------------------------------------------------
# Every column named by PROFILE_SELECT or RESTRICTED_SELECT in
# app/employees/[id]/employee-select.ts. Prisma fails the whole query on an
# unknown field, so one missing column takes the employee detail page down rather
# than degrading it - which is why this is checked as a set rather than sampled.
$profileMissing = @()
foreach ($pair in $REQUIRED_COLUMN_PAIRS) {
    if (-not $pair.StartsWith('Employee.')) { continue }
    if ($columnProbe.found -notcontains $pair) { $profileMissing += $pair }
}
$profileTotal = @($REQUIRED_COLUMN_PAIRS | Where-Object { $_.StartsWith('Employee.') }).Count
if ($profileMissing.Count -gt 0) {
    Add-SmokeCheck -Domain 'employee-profile' -Status 'FAIL' `
        -Detail ("{0}/{1} profile columns present; missing: {2}" -f ($profileTotal - $profileMissing.Count), $profileTotal, ($profileMissing -join ', '))
}
elseif ($sourceCounts['Employee'] -eq 0) {
    Add-SmokeCheck -Domain 'employee-profile' -Status 'SKIP' `
        -Detail ("all {0} profile columns present, but Employee holds no rows so the detail query cannot be executed" -f $profileTotal)
}
else {
    Add-SmokeCheck -Domain 'employee-profile' -Status 'PASS' `
        -Detail ("all {0} columns named by PROFILE_SELECT and RESTRICTED_SELECT are present" -f $profileTotal)
}

# --- Attendance ---------------------------------------------------------------
$attSql = 'SELECT (SELECT count(*) FROM public.\"Attendance\")::text || ''|'' || (SELECT count(*) FROM public.\"Attendance\" WHERE \"date\" IS NULL OR status IS NULL)::text || ''|'' || coalesce((SELECT to_char(min(\"date\"),''YYYY-MM-DD'') FROM public.\"Attendance\"),'''') || ''|'' || coalesce((SELECT to_char(max(\"date\"),''YYYY-MM-DD'') FROM public.\"Attendance\"),'''');'
$attLine = & $smoke 'attendance' $attSql
if ($null -ne $attLine) {
    $at = $attLine.Split('|')
    $attTotal = [int64] $at[0]
    $attBroken = [int64] $at[1]
    if ($attTotal -eq 0) {
        Add-SmokeCheck -Domain 'attendance' -Status 'SKIP' `
            -Detail 'Attendance exists and its date/status columns are queryable, but it holds no rows'
    }
    elseif ($attBroken -gt 0) {
        Add-SmokeCheck -Domain 'attendance' -Status 'FAIL' `
            -Detail ("{0} attendance row(s), {1} of them with a null date or status; the register would render unattributable punches" -f $attTotal, $attBroken)
    }
    else {
        Add-SmokeCheck -Domain 'attendance' -Status 'PASS' `
            -Detail ("{0} row(s) from {1} to {2}; every row has a date and a status" -f $attTotal, $at[2], $at[3])
    }
}

# --- Leave --------------------------------------------------------------------
# The join is the point of this check. LeaveRequest and LeaveBalance can both
# hold rows while the employeeId they point at has not restored, and the
# application would then show balances for nobody. Counting rows on each table
# separately cannot see that; joining can.
$leaveSql = 'SELECT (SELECT count(*) FROM public.\"LeaveRequest\")::text || ''|'' || (SELECT count(*) FROM public.\"LeaveBalance\")::text || ''|'' || (SELECT count(*) FROM public.\"LeaveRequest\" r JOIN public.\"Employee\" e ON e.id = r.\"employeeId\")::text || ''|'' || (SELECT count(*) FROM public.\"LeaveBalance\" b JOIN public.\"Employee\" e ON e.id = b.\"employeeId\")::text;'
$leaveLine = & $smoke 'leaves' $leaveSql
if ($null -ne $leaveLine) {
    $lv = $leaveLine.Split('|')
    $lrTotal = [int64] $lv[0]
    $lbTotal = [int64] $lv[1]
    $lrJoined = [int64] $lv[2]
    $lbJoined = [int64] $lv[3]
    $leaveProblems = @()
    if ($lrTotal -gt 0 -and $lrJoined -lt $lrTotal) { $leaveProblems += ("$($lrTotal - $lrJoined) leave request(s) point at an employee that is not in the restored database") }
    if ($lbTotal -gt 0 -and $lbJoined -lt $lbTotal) { $leaveProblems += ("$($lbTotal - $lbJoined) leave balance(s) point at an employee that is not in the restored database") }

    if ($leaveProblems.Count -gt 0) {
        Add-SmokeCheck -Domain 'leaves' -Status 'FAIL' -Detail ($leaveProblems -join '; ')
    }
    elseif ($lrTotal -eq 0 -and $lbTotal -eq 0) {
        Add-SmokeCheck -Domain 'leaves' -Status 'SKIP' `
            -Detail 'LeaveRequest and LeaveBalance exist and join to Employee, but neither holds any rows'
    }
    else {
        Add-SmokeCheck -Domain 'leaves' -Status 'PASS' `
            -Detail ("LeaveRequest {0} row(s) ({1} joined to Employee), LeaveBalance {2} row(s) ({3} joined to Employee)" -f `
                $lrTotal, $lrJoined, $lbTotal, $lbJoined)
    }
}

# --- Approvals ----------------------------------------------------------------
$apprSql = 'SELECT (SELECT count(*) FROM public.\"EmployeeChangeRequest\")::text || ''|'' || (SELECT count(*) FROM public.\"ExitCase\")::text || ''|'' || (SELECT count(*) FROM public.\"LetterApproval\")::text;'
$apprLine = & $smoke 'approvals' $apprSql
if ($null -ne $apprLine) {
    $ap = $apprLine.Split('|')
    $ecr = [int64] $ap[0]
    $exc = [int64] $ap[1]
    $lap = [int64] $ap[2]
    if (($ecr + $exc + $lap) -eq 0) {
        Add-SmokeCheck -Domain 'approvals' -Status 'SKIP' `
            -Detail 'EmployeeChangeRequest, ExitCase and LetterApproval all exist and are queryable, but no approval has been raised yet'
    }
    else {
        Add-SmokeCheck -Domain 'approvals' -Status 'PASS' `
            -Detail ("EmployeeChangeRequest={0}, ExitCase={1}, LetterApproval={2}; all three approval models restored and queryable" -f $ecr, $exc, $lap)
    }
}

# --- Payroll ------------------------------------------------------------------
# The numeric-type assertion is the one worth having here. SalaryRecord columns
# declared Float arrive as `double precision`; if a dump or a hand-applied
# migration left one as text, every row count in this drill would still match and
# payroll would silently sum lexicographically. Nothing else in the drill can see
# that, and it is a real defect rather than a style question.
$payrollNumeric = @('basic', 'netSalary', 'housingAllowance', 'latePenalty', 'penalty',
    'leaveDeduction', 'loanDeduction', 'advanceSalary', 'otherDeductions',
    'overtimePay', 'bonus', 'commission')
$payrollMissing = @()
$payrollNotNumeric = @()
foreach ($col in $payrollNumeric) {
    $t = Get-ColumnType -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table 'SalaryRecord' -Column $col
    if ([string]::IsNullOrWhiteSpace($t)) { $payrollMissing += $col }
    elseif ($NUMERIC_COLUMN_TYPES -notcontains $t) { $payrollNotNumeric += ("SalaryRecord." + $col + ' is ' + $t) }
}
$paySql = 'SELECT (SELECT count(*) FROM public.\"SalaryRecord\")::text || ''|'' || coalesce((SELECT sum(\"netSalary\")::text FROM public.\"SalaryRecord\"),''0'');'
$payLine = & $smoke 'payroll' $paySql
if ($null -ne $payLine) {
    $py = $payLine.Split('|')
    $payTotal = [int64] $py[0]
    $payNet = $py[1]
    $payProblems = @()
    if ($payrollMissing.Count -gt 0) { $payProblems += ('missing columns: ' + ($payrollMissing -join ', ')) }
    if ($payrollNotNumeric.Count -gt 0) { $payProblems += ('not summable: ' + ($payrollNotNumeric -join ', ')) }

    if ($payProblems.Count -gt 0) {
        Add-SmokeCheck -Domain 'payroll' -Status 'FAIL' -Detail ($payProblems -join '; ')
    }
    elseif ($payTotal -eq 0) {
        Add-SmokeCheck -Domain 'payroll' -Status 'SKIP' `
            -Detail ('SalaryRecord exists with all deduction and allowance columns numeric, but holds no rows for the period')
    }
    else {
        Add-SmokeCheck -Domain 'payroll' -Status 'PASS' `
            -Detail ("{0} salary record(s); sum(netSalary)={1}; all {2} allowance and deduction columns are numeric" -f $payTotal, $payNet, $payrollNumeric.Count)
    }
}

# --- Visa and compliance ------------------------------------------------------
$visaSql = 'SELECT (SELECT count(*) FROM public.\"DocumentExpiryReminder\")::text || ''|'' || (SELECT count(*) FROM public.\"DocumentRenewal\")::text || ''|'' || (SELECT count(*) FROM public.\"Employee\" WHERE \"visaExpiry\" IS NOT NULL OR \"passportExpiry\" IS NOT NULL OR \"emiratesIdExpiry\" IS NOT NULL OR \"labourCardExpiry\" IS NOT NULL OR \"residencePermitExpiry\" IS NOT NULL)::text;'
$visaLine = & $smoke 'visa-compliance' $visaSql
if ($null -ne $visaLine) {
    $vs = $visaLine.Split('|')
    $rem = [int64] $vs[0]
    $ren = [int64] $vs[1]
    $empWithDocs = [int64] $vs[2]
    $visaMissing = @()
    foreach ($col in @('visaExpiry', 'visaIssueDate', 'passportExpiry', 'emiratesIdExpiry', 'medicalInsuranceExpiry', 'iloeInsuranceExpiry', 'labourCardExpiry', 'residencePermitExpiry')) {
        if ($columnProbe.found -notcontains ('Employee.' + $col)) { $visaMissing += $col }
    }

    if ($visaMissing.Count -gt 0) {
        Add-SmokeCheck -Domain 'visa-compliance' -Status 'FAIL' `
            -Detail ('Employee document-expiry columns missing: ' + ($visaMissing -join ', ') + '; the compliance screen cannot read them')
    }
    elseif (($rem + $ren) -eq 0 -and $empWithDocs -eq 0) {
        Add-SmokeCheck -Domain 'visa-compliance' -Status 'SKIP' `
            -Detail ('Employee document-expiry columns present and DocumentExpiryReminder/DocumentRenewal restored, but no employee holds a document date and no compliance record has been raised')
    }
    else {
        Add-SmokeCheck -Domain 'visa-compliance' -Status 'PASS' `
            -Detail ("{0} employee(s) hold a document date; DocumentExpiryReminder={1}, DocumentRenewal={2}; all document-expiry columns present" -f `
                $empWithDocs, $rem, $ren)
    }
}

# --- Letters ------------------------------------------------------------------
$letterSql = 'SELECT (SELECT count(*) FROM public.\"Letter\")::text || ''|'' || (SELECT count(*) FROM public.\"LetterTemplate\")::text || ''|'' || (SELECT count(*) FROM public.\"Letter\" l JOIN public.\"LetterTemplate\" t ON t.id = l.\"templateId\")::text;'
$letterLine = & $smoke 'letters' $letterSql
if ($null -ne $letterLine) {
    $lt = $letterLine.Split('|')
    $letters = [int64] $lt[0]
    $templates = [int64] $lt[1]
    $lettersJoined = [int64] $lt[2]
    if ($letters -eq 0 -and $templates -eq 0) {
        Add-SmokeCheck -Domain 'letters' -Status 'SKIP' `
            -Detail 'Letter and LetterTemplate exist and the join between them resolves, but no letter has been issued and no template is configured'
    }
    elseif ($letters -gt 0 -and $lettersJoined -lt $letters) {
        Add-SmokeCheck -Domain 'letters' -Status 'FAIL' `
            -Detail ("{0} letter(s) but only {1} resolve to a template; the remaining letters would fail to render their content" -f $letters, $lettersJoined)
    }
    else {
        Add-SmokeCheck -Domain 'letters' -Status 'PASS' `
            -Detail ("Letter={0}, LetterTemplate={1}; all {2} letter(s) join to a template" -f $letters, $templates, $lettersJoined)
    }
}

# --- Notifications ------------------------------------------------------------
# Load-bearing check. Notification.employeeId is NOT NULL in the schema because a
# notification is addressed to an employee: there is no such thing as an
# unattributed one. A restored schema where that column is nullable would not
# error - it would accept rows the application never intended, and a whole class
# of notification would become unaddressable while every count still matched.
$notifNullable = Get-ColumnNullable -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table 'Notification' -Column 'employeeId'
$notifSql = 'SELECT (SELECT count(*) FROM public.\"Notification\")::text || ''|'' || (SELECT count(*) FROM public.\"Notification\" WHERE \"employeeId\" IS NULL)::text;'
$notifLine = & $smoke 'notifications' $notifSql
if ($null -ne $notifLine) {
    $nf = $notifLine.Split('|')
    $notifTotal = [int64] $nf[0]
    $notifOrphan = [int64] $nf[1]

    if ($notifNullable -eq '') {
        Add-SmokeCheck -Domain 'notifications' -Status 'FAIL' -Detail 'Notification.employeeId does not exist in the restored schema'
    }
    elseif ($notifNullable -ne 'NO') {
        Add-SmokeCheck -Domain 'notifications' -Status 'FAIL' `
            -Detail ('Notification.employeeId is NULLABLE in the restored schema (was NOT NULL in the schema definition); a notification could be created with no recipient and would never be delivered')
    }
    elseif ($notifOrphan -gt 0) {
        Add-SmokeCheck -Domain 'notifications' -Status 'FAIL' `
            -Detail ("{0} notification(s) carry a NULL employeeId, which the schema forbids" -f $notifOrphan)
    }
    elseif ($notifTotal -eq 0) {
        Add-SmokeCheck -Domain 'notifications' -Status 'SKIP' `
            -Detail 'Notification exists with employeeId NOT NULL and its feed index, but holds no rows'
    }
    else {
        Add-SmokeCheck -Domain 'notifications' -Status 'PASS' `
            -Detail ("{0} notification(s), employeeId is NOT NULL and the (employeeId, createdAt) index is present" -f $notifTotal)
    }
}

# --- RBAC / permissions -------------------------------------------------------
if ($script:restoredUserCount -le 0) {
    Add-SmokeCheck -Domain 'rbac' -Status 'FAIL' -Detail 'no users restored, so no role can hold any permission'
}
elseif ($unknownRoles.Count -gt 0) {
    Add-SmokeCheck -Domain 'rbac' -Status 'FAIL' `
        -Detail ('these account roles are outside the vocabulary lib/auth/roles.ts defines, so they grant no capability at all: ' + ($unknownRoles -join ', '))
}
elseif ($script:restoredAdminCount -lt 1) {
    Add-SmokeCheck -Domain 'rbac' -Status 'FAIL' `
        -Detail ('no ADMIN or SUPER_ADMIN account exists; the restored database cannot be administered')
}
else {
    Add-SmokeCheck -Domain 'rbac' -Status 'PASS' `
        -Detail ("roles present: {0}; all are in the known vocabulary and an administrative role exists" -f $script:restoredRoleList)
}

# --- Audit logging ------------------------------------------------------------
# Three things, and the third is the interesting one. Both audit tables must be
# present and AuditLog.createdAt must be indexed (the dashboard takes the newest
# rows unfiltered). Then the append-only claim is PROVED rather than assumed: a
# row is inserted inside a transaction that is rolled back, so the write path is
# exercised for real and nothing is left behind. An audit table that cannot accept
# a write is not an intact audit table.
$auditSql = 'SELECT (SELECT count(*) FROM public.\"AuditLog\")::text || ''|'' || (SELECT count(*) FROM public.\"SecurityAuditLog\")::text;'
$auditLine = & $smoke 'audit-logging' $auditSql
if ($null -ne $auditLine) {
    $ad = $auditLine.Split('|')
    $auditRows = [int64] $ad[0]
    $secRows = [int64] $ad[1]
    $auditCreatedAtIndexed = @($restoredIndexes | Where-Object {
        $_.table -eq 'AuditLog' -and $_.cols -like '*createdAt*'
    }).Count -ge 1

    $blockingTriggers = Get-BlockingTriggerCount -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table 'AuditLog'
    $blockingTriggers += Get-BlockingTriggerCount -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Table 'SecurityAuditLog'

    # Probed inside a rolled-back transaction: the INSERT really executes, and
    # the ROLLBACK means not one row survives. Nothing is written outside the
    # disposable container.
    #
    # `id` is supplied explicitly. Prisma's `@default(cuid())` is generated by the
    # CLIENT, so the column carries no database default - a probe that relied on
    # one would fail on a perfectly healthy table and report a defect that does
    # not exist. `employeeId` is deliberately left NULL, which the schema allows,
    # so the probe does not depend on any particular employee row existing.
    $probeSql = 'BEGIN; INSERT INTO public.\"AuditLog\" (id, action, \"changedBy\", \"createdAt\") VALUES (''restore-drill-probe'', ''restore_drill_probe'', ''restore-drill'', now()); ROLLBACK;'
    $probeExit = Invoke-DbStatement -ContainerName $ScratchContainer -User $ScratchDbUser -Database $ScratchDbName -Sql $probeSql

    $auditProblems = @()
    if (-not $auditCreatedAtIndexed) { $auditProblems += 'AuditLog.createdAt is not indexed; the dashboard query takes the newest audit rows unfiltered and would sequential-scan the table' }
    if ($blockingTriggers -gt 0) { $auditProblems += "$blockingTriggers UPDATE/DELETE trigger(s) on the audit tables; an append-only log that something can rewrite is not append-only" }
    if ($probeExit -ne 0) { $auditProblems += "the append probe was REJECTED by the restored AuditLog (psql exit $probeExit); the audit write path the application depends on is broken" }

    if ($auditProblems.Count -gt 0) {
        Add-SmokeCheck -Domain 'audit-logging' -Status 'FAIL' -Detail ($auditProblems -join '; ')
    }
    elseif ($auditRows -eq 0 -and $secRows -eq 0) {
        Add-SmokeCheck -Domain 'audit-logging' -Status 'SKIP' `
            -Detail 'both audit tables restored, AuditLog.createdAt indexed, no UPDATE/DELETE triggers and the append probe accepted, but neither table holds a row to display'
    }
    else {
        Add-SmokeCheck -Domain 'audit-logging' -Status 'PASS' `
            -Detail ("AuditLog={0} row(s), SecurityAuditLog={1} row(s); createdAt indexed, no UPDATE/DELETE triggers, append probe accepted and rolled back" -f $auditRows, $secRows)
    }
}

$integrityFailures = @($script:integrityChecks | Where-Object { -not $_.ok })
$smokeFailures = @($script:smokeChecks | Where-Object { $_.status -eq 'FAIL' })
$smokeSkips = @($script:smokeChecks | Where-Object { $_.status -eq 'SKIP' })

Info ("  Phase 8 integrity: {0} check(s), {1} failed" -f $script:integrityChecks.Count, $integrityFailures.Count)
Info ("  Phase 9 smoke    : {0} domain(s), {1} PASS, {2} FAIL, {3} SKIP (a SKIP is NOT a pass)" -f `
    $script:smokeChecks.Count,
    @($script:smokeChecks | Where-Object { $_.status -eq 'PASS' }).Count,
    $smokeFailures.Count,
    $smokeSkips.Count)

# --- Tear down ---------------------------------------------------------------
if ($KeepScratch) {
    Info "scratch container KEPT for inspection: $ScratchContainer"
}
else {
    docker rm -f $ScratchContainer 1>$null 2>&1
    Info 'scratch container destroyed'
}

# --- Verdict -----------------------------------------------------------------
# Every layer counts. A drill that passes on row counts alone is the version of
# this script that shipped first, and it reported a database with no primary keys
# and no foreign keys as fully recovered.
$passed = ($restoreExit -eq 0 -and
    $mismatches -eq 0 -and
    $appFailures.Count -eq 0 -and
    $integrityFailures.Count -eq 0 -and
    $smokeFailures.Count -eq 0)

if ($Json) {
    # Backward compatible: drill, passed, dump, dumpBytes, source, scratch,
    # durationSec, tables, appChecks, mismatches, bothAbsent, appFailures and
    # completedAt all keep their names and meanings. `tables` keeps its original
    # six fields and gains drift evidence. Everything new is additive.
    [pscustomobject]@{
        drill         = 'restore-drill'
        passed        = $passed
        dump          = $dumpFile
        dumpBytes     = $dumpSize
        source        = "$Container/$DbName"
        scratch       = $ScratchContainer
        durationSec   = $elapsed
        tables        = $results
        appChecks     = $appChecks
        mismatches    = $mismatches
        bothAbsent    = $absentBoth
        appFailures   = @($appFailures | ForEach-Object { $_.name })
        completedAt   = (Get-Date).ToString('s')

        # --- added: how the source was resolved, so a record says WHICH database
        # --- was drilled and whether that came from a parameter or an env var.
        sourceContainer   = $Container
        sourceDatabase    = $DbName
        sourceUser        = $DbUser
        sourceSettingFrom = "container=$containerSrc; database=$dbNameSrc"
        scratchDatabase   = $ScratchDbName

        # --- added: Phase 8
        integrity         = $script:integrityChecks
        integrityFailures = @($integrityFailures | ForEach-Object { $_.name })
        integritySummary  = ([pscustomobject]@{
            total  = $script:integrityChecks.Count
            passed = @($script:integrityChecks | Where-Object { $_.ok }).Count
            failed = $integrityFailures.Count
        })

        # --- added: Phase 9. `smokeSkipped` is kept separate from `smokePassed`
        # --- precisely so a consumer cannot add them together and call the
        # --- result "passed domains".
        smoke             = $script:smokeChecks
        smokeFailures     = @($smokeFailures | ForEach-Object { $_.domain })
        smokeSkipped      = @($smokeSkips | ForEach-Object { $_.domain })
        smokeSummary      = ([pscustomobject]@{
            total   = $script:smokeChecks.Count
            passed  = @($script:smokeChecks | Where-Object { $_.status -eq 'PASS' }).Count
            failed  = $smokeFailures.Count
            skipped = $smokeSkips.Count
        })

        # --- added: restore-completeness evidence
        schemaTables      = ([pscustomobject]@{
            source   = $sourceTableCount
            restored = $tableTotal
            shortfall = $sourceTableCount - $tableTotal
        })
        constraints       = ([pscustomobject]@{
            primaryKeysSource   = $sourcePkCount
            primaryKeysRestored = $restoredPkNames.Count
            foreignKeysSource   = $sourceFkCount
            foreignKeysRestored = $restoredFk.Count
        })
        indexes            = $restoredIndexes.Count
        users              = ([pscustomobject]@{
            total      = $script:restoredUserCount
            admins     = $script:restoredAdminCount
            withHash   = $script:restoredPasswordCount
            roles      = $script:restoredRoleList
        })
    } | ConvertTo-Json -Depth 5
}

# One machine-greppable line for the audit record. On stderr in JSON mode so the
# JSON on stdout stays parseable.
$verdict = if ($passed) { 'PASSED' } else { 'FAILED' }
Write-DrillLine ('RESTORE_DRILL result={0} dump={1} tables={2} mismatches={3} app_failures={4} integrity={5}/{6} smoke_pass={7} smoke_fail={8} smoke_skip={9} duration_s={10}' -f `
    $verdict, (Split-Path $dumpFile -Leaf), $CHECK_TABLES.Count, $mismatches, $appFailures.Count, `
    (@($script:integrityChecks | Where-Object { $_.ok }).Count), $script:integrityChecks.Count, `
    (@($script:smokeChecks | Where-Object { $_.status -eq 'PASS' }).Count), $smokeFailures.Count, `
    $smokeSkips.Count, $elapsed)

if (-not $passed) {
    Write-DrillLine ''
    Write-DrillLine 'restore-drill: THE BACKUP IS NOT PROVEN RECOVERABLE.'
    if ($mismatches -gt 0) {
        Write-DrillLine ("  {0} table(s) did not match between source and restore:" -f $mismatches)
        foreach ($r in ($results | Where-Object { $_.status -eq 'MISMATCH' })) {
            Write-DrillLine ("    {0}: source={1} restored={2} {3}" -f $r.table, $r.source, $r.restored, $r.note)
        }
    }
    if ($appFailures.Count -gt 0) {
        Write-DrillLine ("  {0} required column(s) missing from the restored schema:" -f $appFailures.Count)
        foreach ($f in $appFailures) { Write-DrillLine ("    {0}" -f $f.name) }
    }
    if ($integrityFailures.Count -gt 0) {
        Write-DrillLine ("  {0} integrity check(s) failed:" -f $integrityFailures.Count)
        foreach ($f in $integrityFailures) {
            Write-DrillLine ("    {0}: {1}" -f $f.name, $f.detail)
        }
    }
    if ($smokeFailures.Count -gt 0) {
        Write-DrillLine ("  {0} application domain(s) would not work against the restored database:" -f $smokeFailures.Count)
        foreach ($f in $smokeFailures) {
            Write-DrillLine ("    {0}: {1}" -f $f.domain, $f.detail)
        }
    }
    if ($smokeSkips.Count -gt 0) {
        Write-DrillLine ("  {0} domain(s) could not be exercised at all (SKIP, not PASS):" -f $smokeSkips.Count)
        foreach ($f in $smokeSkips) {
            Write-DrillLine ("    {0}: {1}" -f $f.domain, $f.detail)
        }
    }
    exit 1
}

if ($smokeSkips.Count -gt 0) {
    Write-DrillLine ''
    Write-DrillLine ("NOTE: {0} domain(s) were skipped because they hold no data. They are reported as SKIP, never as PASS." -f $smokeSkips.Count)
    foreach ($f in $smokeSkips) {
        Write-DrillLine ("  {0}: {1}" -f $f.domain, $f.detail)
    }
}

exit 0
