<#
.SYNOPSIS
    Reports the ACTUAL current state of the HR database backup system.

.DESCRIPTION
    A read-only reporter. It never takes a backup, never writes to backups\ and
    never registers a task. It answers one question honestly: "if the database
    died right now, what would we have, and how old is it?"

    WHY THIS IS A SEPARATE SCRIPT AND NOT AN EXTENSION OF healthcheck.ps1
    --------------------------------------------------------------------
    scripts/healthcheck.ps1 is an APPLICATION UPTIME probe against /api/health.
    It has a documented exit code contract (0 healthy, 1 unhealthy, 2 usage
    error, 3 indeterminate) and a deliberate APP_DOWN vs DATABASE_DOWN split,
    because restarting the app does nothing for a database outage. Extending it
    with backup status would break that contract and would conflate "the site
    is serving" with "our backups are good". Those are independent systems that
    fail independently and are recovered from independently, so they are
    reported independently. healthcheck.ps1 is not modified by this script.

    WHAT "HEALTHY" MEANS HERE
    -------------------------
    This script never claims health it has not verified. Anything it could not
    confirm is UNKNOWN, never PASS, and an UNKNOWN is never silently folded
    into a healthy verdict. In particular verify-backup.ps1 and the .sha256
    sidecars are produced by other tooling; while that tooling is absent this
    script reports UNKNOWN for integrity rather than inventing a result.

    EXIT CODES (machine readable)
    -----------------------------
      0  HEALTHY        every check passed
      1  WARNING        no hard failure, but at least one check warned
                         (includes NOT_CONFIGURED: off-site is simply absent)
      2  FAILED         at least one check failed

    SUMMARY LINE
    ------------
    The last line of output is designed to be matched by a monitoring keyword
    rule, in the same spirit as the HEALTHCHECK line in healthcheck.ps1:

        BACKUP_HEALTH result=WARNING state=WARNING checks=18 failed=0 warned=2 unknown=2

        result=  worst severity of any individual check
                 HEALTHY | WARNING | FAILED
        state=   the actionable state token for an alert rule
                 HEALTHY       everything checks out, including off-site
                 WARNING       something needs attention but nothing is broken
                 FAILED        at least one check failed
                 NOT_CONFIGURED no failure anywhere, but no off-host copy
                                exists either, so every dump is on the same
                                disk as the database it protects

        state precedence is FAILED > NOT_CONFIGURED > WARNING > HEALTHY.
        NOT_CONFIGURED outranks WARNING only when no NON-off-site check warned,
        so a missing off-site destination is never buried under routine noise
        and a genuine problem never hides behind it.

    ENVIRONMENT VARIABLES (all optional, parameter wins over environment)
    ---------------------------------------------------------------------
      BACKUP_CONTAINER       container the backup targets   default hr-postgres
      BACKUP_PROD_CONTAINER  production compose database    default hr_system_db
      BACKUP_DEV_CONTAINER   development database           default hr-postgres
      BACKUP_DB_NAME         database name                  default hr_system
      BACKUP_MAX_AGE_HOURS   staleness threshold            default 26
      BACKUP_MIN_BYTES       minimum dump size floor        default 1024
      BACKUP_TASK_NAME       scheduled task name            default HRMS-Backup
      OFFSITE_BACKUP_PATH    off-host destination, read only, for reporting
      OFFSITE_BACKUP_ENABLED whether off-site is switched on, for reporting

    WHY 26 HOURS AND NOT 24
    -----------------------
    One daily run plus slack. A backup that is 25 hours old is normal for a job
    that runs at 02:00. Exceeding the threshold is a WARNING and not a failure
    because a missed night is recoverable by hand; only a failure to ever
    produce a dump is unrecoverable.

    JSON OUTPUT (-Json)
    -------------------
    With -Json this script prints ONE JSON object and nothing else, so it can
    be piped straight into ConvertFrom-Json. The Settings UI is intended to
    consume exactly this shape rather than re-implementing these checks.

    {
      "schemaVersion": 1,
      "generatedAt": "<ISO 8601 UTC>",
      "result":  "HEALTHY" | "WARNING" | "FAILED",
      "state":   "HEALTHY" | "WARNING" | "FAILED" | "NOT_CONFIGURED",
      "exitCode": 0 | 1 | 2,
      "counts": {
        "checks": <int>, "passed": <int>, "warned": <int>,
        "failed": <int>, "unknown": <int>
      },
      "database": {
        "container": "<resolved BACKUP_CONTAINER>",
        "exists": <bool>,
        "running": <bool>,
        "isDevelopmentContainer": <bool>,
        "productionContainer": "<BACKUP_PROD_CONTAINER>",
        "productionContainerPresent": <bool>,
        "databaseUrlPort": <int|null>,
        "reachable": <bool>
      },
      "backup": {
        "path": "<full path>|null",
        "fileName": "<name>|null",
        "sizeBytes": <int>,
        "ageHours": <double>,
        "maxAgeHours": <int>,
        "minBytes": <int>,
        "checksumSidecar": "<full path>|null",
        "integrity": "PASS" | "FAIL" | "UNKNOWN",
        "checksumVerified": "PASS" | "FAIL" | "UNKNOWN"
      },
      "scheduler": {
        "taskName": "<BACKUP_TASK_NAME>",
        "exists": <bool>,
        "enabled": <bool>|null,
        "lastRunTime": "<ISO 8601>|null",
        "lastTaskResult": <int|null>,
        "lastResultState": "SUCCESS" | "NEVER_RUN" | "FAILURE" |
                           "NOT_REGISTERED" | "UNKNOWN",
        "nextRunTime": "<ISO 8601>|null"
      },
      "offsite": {
        "status": "CONFIGURED" | "NOT_CONFIGURED" | "DISABLED",
        "provider": "<OFFSITE_BACKUP_PROVIDER or filesystem>",
        "path": "<path>|null",
        "lastUploadTime": "<ISO 8601>|null",
        "lastFileName": "<name>|null",
        "lastChecksum": "<sha256>|null",
        "uploadAgeHours": <double>|null
      },
      "checks": [
        {
          "id": "<stable identifier, safe to key an alert off>",
          "group": "DATABASE" | "BACKUP" | "SCHEDULER" | "OFFSITE",
          "status": "PASS" | "WARN" | "FAIL" | "UNKNOWN",
          "detail": "<human readable, ASCII only>"
        }
      ]
    }

    Check ids, in output order (18 total):

      DATABASE   docker.available
                 container.exists
                 container.running
                 container.host_match       <- audit finding 1
                 database.reachable
      BACKUP     backup.exists
                 backup.age
                 backup.size
                 backup.integrity
                 backup.sidecar
                 backup.sidecar_verified
      SCHEDULER  scheduler.registered
                 scheduler.enabled
                 scheduler.last_run
                 scheduler.last_result
      OFFSITE    offsite.configured
                 offsite.last_upload
                 offsite.upload_age

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\backup-health.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\backup-health.ps1 -Json

.EXAMPLE
    $env:BACKUP_CONTAINER = 'hr_system_db'
    powershell -ExecutionPolicy Bypass -File .\scripts\backup-health.ps1
#>

[CmdletBinding()]
param(
    # Resolved in the body, not here: under Windows PowerShell 5.1 $PSScriptRoot
    # is empty inside a param() default.
    [string] $BackupDir = '',

    # Blank means "take it from BACKUP_CONTAINER, else hr-postgres".
    [string] $Container = '',

    [string] $DbName = '',

    [string] $DbUser = 'postgres',

    [string] $TaskName = '',

    [string] $ProductionContainer = '',

    [string] $DevContainer = '',

    # -1 is a sentinel for "not supplied on the command line", which is what
    # lets BACKUP_MAX_AGE_HOURS decide. A literal 0 must stay meaningful.
    [int] $MaxAgeHours = -1,

    [long] $MinBytes = -1,

    [switch] $Json
)

$ErrorActionPreference = 'Stop'

$STATUS_PASS = 'PASS'
$STATUS_WARN = 'WARN'
$STATUS_FAIL = 'FAIL'
$STATUS_UNKNOWN = 'UNKNOWN'

$STATE_HEALTHY = 'HEALTHY'
$STATE_WARNING = 'WARNING'
$STATE_FAILED = 'FAILED'
$STATE_NOT_CONFIGURED = 'NOT_CONFIGURED'

$script:Checks = New-Object System.Collections.ArrayList

function Add-Check {
    param(
        [Parameter(Mandatory = $true)] [string] $Id,
        [Parameter(Mandatory = $true)] [string] $Group,
        [Parameter(Mandatory = $true)] [string] $Status,
        [Parameter(Mandatory = $true)] [string] $Detail,
        [switch] $OffSite
    )
    $null = $script:Checks.Add([pscustomobject]@{
        Id      = $Id
        Group   = $Group
        Status  = $Status
        Detail  = $Detail
        OffSite = [bool]$OffSite
    })
}

# Settings precedence: explicit parameter, then environment, then default.
function Get-Setting {
    param([string] $ParameterValue, [string] $EnvName, [string] $Default)
    if (-not [string]::IsNullOrWhiteSpace($ParameterValue)) { return $ParameterValue }
    $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) { return $fromEnv.Trim() }
    return $Default
}

function Get-IntSetting {
    param([long] $ParameterValue, [string] $EnvName, [int] $Default, [string] $Label)
    if ($ParameterValue -ge 0) { return [int] $ParameterValue }
    $raw = [Environment]::GetEnvironmentVariable($EnvName)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $parsed = 0
    if ([int]::TryParse($raw.Trim(), [ref] $parsed)) { return $parsed }
    return $Default
}

# Truthy parsing shared with offsite-backup.ps1's convention. An unrecognised
# value is treated as false and reported, never optimistically as true.
function Get-IsEnabled {
    param([string] $Value)
    if ($null -eq $Value) { return $false }
    switch ($Value.Trim().ToLowerInvariant()) {
        '1'     { return $true }
        'true'  { return $true }
        'yes'   { return $true }
        'on'    { return $true }
        default { return $false }
    }
}

function Format-Iso {
    param($Value)
    if ($null -eq $Value) { return $null }
    try { return $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
    catch { return $null }
}

# Runs a native command with the output captured and the exit code preserved.
# $ErrorActionPreference is relaxed for the call because in Windows PowerShell
# 5.1 a native command's stderr, once redirected into the success stream,
# becomes an ErrorRecord that 'Stop' would turn into an exception.
function Invoke-Native {
    param([string] $FilePath, [string[]] $Arguments)

    $result = @{ ExitCode = -1; Output = ''; Failed = $false }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $FilePath @Arguments 2>&1
        $result.ExitCode = $LASTEXITCODE
        $result.Output = (($output | ForEach-Object { [string] $_ }) -join ' ').Trim()
    } catch {
        $result.Failed = $true
        $result.ExitCode = -1
        $result.Output = $_.Exception.Message
    } finally {
        $ErrorActionPreference = $previous
    }
    return $result
}

# --- Resolve settings --------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
    $BackupDir = Join-Path $PSScriptRoot '..\backups'
}
$backupRoot = [System.IO.Path]::GetFullPath($BackupDir)

$Container           = Get-Setting -ParameterValue $Container           -EnvName 'BACKUP_CONTAINER'      -Default 'hr-postgres'
$DbName              = Get-Setting -ParameterValue $DbName              -EnvName 'BACKUP_DB_NAME'       -Default 'hr_system'
$TaskName            = Get-Setting -ParameterValue $TaskName            -EnvName 'BACKUP_TASK_NAME'     -Default 'HRMS-Backup'
$ProductionContainer = Get-Setting -ParameterValue $ProductionContainer -EnvName 'BACKUP_PROD_CONTAINER' -Default 'hr_system_db'
$DevContainer        = Get-Setting -ParameterValue $DevContainer        -EnvName 'BACKUP_DEV_CONTAINER'  -Default 'hr-postgres'
$MaxAgeHours         = Get-IntSetting -ParameterValue $MaxAgeHours -EnvName 'BACKUP_MAX_AGE_HOURS' -Default 26 -Label 'MaxAgeHours'
$MinBytes            = Get-IntSetting -ParameterValue $MinBytes    -EnvName 'BACKUP_MIN_BYTES'     -Default 1024 -Label 'MinBytes'

if ($MaxAgeHours -lt 1) {
    Write-Error "backup-health.ps1: BACKUP_MAX_AGE_HOURS must be at least 1, got $MaxAgeHours"
    exit 2
}
if ($MinBytes -lt 1) {
    Write-Error "backup-health.ps1: BACKUP_MIN_BYTES must be at least 1, got $MinBytes"
    exit 2
}

$database = [ordered]@{
    container                   = $Container
    exists                      = $false
    running                     = $false
    isDevelopmentContainer      = ($Container -eq $DevContainer)
    productionContainer         = $ProductionContainer
    productionContainerPresent  = $false
    databaseUrlPort             = $null
    reachable                   = $false
}
$backup = [ordered]@{
    path              = $null
    fileName          = $null
    sizeBytes         = 0
    ageHours          = $null
    maxAgeHours       = $MaxAgeHours
    minBytes          = $MinBytes
    checksumSidecar   = $null
    integrity         = $STATUS_UNKNOWN
    checksumVerified  = $STATUS_UNKNOWN
}
$scheduler = [ordered]@{
    taskName         = $TaskName
    exists           = $false
    enabled          = $null
    lastRunTime      = $null
    lastTaskResult   = $null
    lastResultState  = 'UNKNOWN'
    nextRunTime      = $null
}
$offsite = [ordered]@{
    status          = $STATE_NOT_CONFIGURED
    provider        = 'filesystem'
    path            = $null
    lastUploadTime  = $null
    lastFileName    = $null
    lastChecksum    = $null
    uploadAgeHours  = $null
}

if (-not $Json) {
    Write-Host "backup-health.ps1: backupdir=$backupRoot container=$Container db=$DbName task=$TaskName max_age=${MaxAgeHours}h min_bytes=$MinBytes"
}

# =============================================================================
# DATABASE
# =============================================================================
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $dockerCommand) {
    Add-Check -Id 'docker.available' -Group 'DATABASE' -Status $STATUS_FAIL `
        -Detail 'docker CLI is not on PATH; the backup cannot run on this host.'
} else {
    Add-Check -Id 'docker.available' -Group 'DATABASE' -Status $STATUS_PASS `
        -Detail ("found at " + $dockerCommand.Source)
}

# Does the container we would back up exist, and is it running?
$containerExists = $false
$containerRunning = $false
if ($null -ne $dockerCommand) {
    $inspect = Invoke-Native -FilePath 'docker' -Arguments @('inspect', '-f', '{{.State.Running}}', $Container)
    if (-not $inspect.Failed -and $inspect.ExitCode -eq 0) {
        $containerExists = $true
        $containerRunning = ($inspect.Output.Trim().ToLowerInvariant() -eq 'true')
    }
}
$database.exists = $containerExists
$database.running = $containerRunning

if ($null -eq $dockerCommand) {
    Add-Check -Id 'container.exists' -Group 'DATABASE' -Status $STATUS_FAIL `
        -Detail "cannot check: docker CLI is unavailable."
} elseif ($containerExists) {
    Add-Check -Id 'container.exists' -Group 'DATABASE' -Status $STATUS_PASS `
        -Detail "container '$Container' exists."
} elseif (-not [string]::IsNullOrWhiteSpace($ProductionContainer) -and
          $Container -eq $DevContainer) {
    # Finding 1 of docs/audit/BACKUP_AUDIT_PHASE1.md, stated as an instruction
    # rather than a warning: this is the exact host on which the wrong-database
    # trap becomes a hard error, so point at the one-key fix.
    Add-Check -Id 'container.exists' -Group 'DATABASE' -Status $STATUS_FAIL `
        -Detail ("container '$Container' does not exist on this host, but the production compose database '$ProductionContainer' is the one defined by docker-compose.yml. Set BACKUP_CONTAINER=$ProductionContainer.")
} else {
    Add-Check -Id 'container.exists' -Group 'DATABASE' -Status $STATUS_FAIL `
        -Detail ("container '$Container' was not found. Create it, or set BACKUP_CONTAINER to the container that holds $DbName.")
}

if (-not $containerExists) {
    Add-Check -Id 'container.running' -Group 'DATABASE' -Status $STATUS_UNKNOWN `
        -Detail "container '$Container' does not exist, so its state cannot be read."
} elseif ($containerRunning) {
    Add-Check -Id 'container.running' -Group 'DATABASE' -Status $STATUS_PASS `
        -Detail "container '$Container' is running."
} else {
    Add-Check -Id 'container.running' -Group 'DATABASE' -Status $STATUS_FAIL `
        -Detail ("container '$Container' exists but is not running. Start it: docker start $Container")
}

# Is the production compose database also present on this host?
if ($null -ne $dockerCommand -and -not [string]::IsNullOrWhiteSpace($ProductionContainer) -and
    $ProductionContainer -ne $Container) {
    $prodInspect = Invoke-Native -FilePath 'docker' -Arguments @('inspect', '-f', '{{.State.Running}}', $ProductionContainer)
    $database.productionContainerPresent = (-not $prodInspect.Failed -and $prodInspect.ExitCode -eq 0)
}

# Read the port out of .env so the verdict can say WHICH database is being
# protected. Read-only; .env is never written and never echoed, and the file
# legitimately contains secrets so nothing from it is printed.
$envPath = Join-Path $PSScriptRoot '..\.env'
if (Test-Path -LiteralPath $envPath -PathType Leaf) {
    try {
        $databaseUrlLine = Get-Content -LiteralPath $envPath -ErrorAction Stop |
            Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
            Select-Object -First 1
        if ($null -ne $databaseUrlLine) {
            $portMatch = [regex]::Match($databaseUrlLine, '@[^:/?#\s]+:(\d{2,5})')
            if ($portMatch.Success) {
                $database.databaseUrlPort = [int] $portMatch.Groups[1].Value
            }
        }
    } catch {
        # .env is unreadable or absent. The port is a reporting nicety, never a
        # check outcome, so this is swallowed on purpose.
    }
}

$isDev = ($Container -eq $DevContainer)
$portNote = ''
if ($null -ne $database.databaseUrlPort) {
    $portNote = " .env DATABASE_URL uses port $($database.databaseUrlPort)."
}

if ($isDev -and $database.productionContainerPresent) {
    # THE MOST IMPORTANT CHECK IN THIS SCRIPT. See finding 1 of
    # docs/audit/BACKUP_AUDIT_PHASE1.md. On a host running both databases this
    # does not fail today, because the dev dump succeeds. It fails SILENTLY:
    # an administrator installs HRMS-Backup, sees a green result every
    # morning, and never realises the dumps are of the development database.
    $portHint = ''
    if ($database.databaseUrlPort -eq 5432) {
        $portHint = " .env DATABASE_URL is on port 5432, which is the PRODUCTION port, so the container in use is probably '$ProductionContainer'."
    }
    Add-Check -Id 'container.host_match' -Group 'DATABASE' -Status $STATUS_WARN `
        -Detail ("WRONG DATABASE RISK: BACKUP_CONTAINER resolves to '$Container', the DEVELOPMENT database, while the production compose database '$ProductionContainer' is also present on this host. A scheduled task would succeed every night while silently backing up the development database. Set BACKUP_CONTAINER=$ProductionContainer if production is what must be protected." + $portNote + $portHint)
} elseif ($isDev) {
    Add-Check -Id 'container.host_match' -Group 'DATABASE' -Status $STATUS_PASS `
        -Detail ("'$Container' is the development database and no production compose database is present on this host, so the target is unambiguous." + $portNote)
} else {
    Add-Check -Id 'container.host_match' -Group 'DATABASE' -Status $STATUS_PASS `
        -Detail ("'$Container' is not the development database ('$DevContainer'); assuming it is the intended target." + $portNote)
}

# Is the database actually reachable? A container that is up but not serving
# still produces no dump.
if ($null -ne $dockerCommand -and $containerRunning) {
    $psql = Invoke-Native -FilePath 'docker' -Arguments @(
        'exec', $Container, 'psql', '-U', $DbUser, '-d', $DbName, '-tAc', 'SELECT 1'
    )
    $database.reachable = (-not $psql.Failed -and $psql.ExitCode -eq 0)
    if ($database.reachable) {
        Add-Check -Id 'database.reachable' -Group 'DATABASE' -Status $STATUS_PASS `
            -Detail "database '$DbName' answered SELECT 1 inside '$Container'."
    } else {
        Add-Check -Id 'database.reachable' -Group 'DATABASE' -Status $STATUS_FAIL `
            -Detail ("cannot query database '$DbName' as role '$DbUser' inside '$Container'. A running container with an unreachable database still produces no backup.")
    }
} elseif ($null -eq $dockerCommand) {
    Add-Check -Id 'database.reachable' -Group 'DATABASE' -Status $STATUS_UNKNOWN `
        -Detail 'docker CLI is unavailable, so reachability cannot be tested.'
} else {
    Add-Check -Id 'database.reachable' -Group 'DATABASE' -Status $STATUS_UNKNOWN `
        -Detail "container '$Container' is not running, so reachability cannot be tested."
}

# =============================================================================
# BACKUP
# =============================================================================
$latestDump = $null
if (Test-Path -LiteralPath $backupRoot -PathType Container) {
    # Newest by write time, because age is what the verdict is about. Name
    # order is the tiebreaker: backup.ps1 stamps to the second, so the name
    # sorts chronologically and the choice stays deterministic.
    $candidate = Get-ChildItem -LiteralPath $backupRoot -Filter "$DbName-*.sql" -File -ErrorAction SilentlyContinue |
        Sort-Object -Property @{ Expression = 'LastWriteTimeUtc'; Descending = $true }, @{ Expression = 'Name'; Descending = $true } |
        Select-Object -First 1
    if ($null -ne $candidate) { $latestDump = $candidate }
}

if ($null -eq $latestDump) {
    Add-Check -Id 'backup.exists' -Group 'BACKUP' -Status $STATUS_FAIL `
        -Detail ("no $DbName-*.sql dump exists in $backupRoot. There is nothing to restore.")
    Add-Check -Id 'backup.age' -Group 'BACKUP' -Status $STATUS_FAIL `
        -Detail 'no dump exists, so there is no age to report.'
    Add-Check -Id 'backup.size' -Group 'BACKUP' -Status $STATUS_FAIL `
        -Detail 'no dump exists, so there is no size to report.'
} else {
    $ageHours = [math]::Round(((Get-Date) - $latestDump.LastWriteTime).TotalHours, 2)
    $backup.path = $latestDump.FullName
    $backup.fileName = $latestDump.Name
    $backup.sizeBytes = [int64] $latestDump.Length
    $backup.ageHours = $ageHours

    Add-Check -Id 'backup.exists' -Group 'BACKUP' -Status $STATUS_PASS `
        -Detail ("newest dump: $($latestDump.Name)")

    if ($ageHours -le $MaxAgeHours) {
        Add-Check -Id 'backup.age' -Group 'BACKUP' -Status $STATUS_PASS `
            -Detail ("$ageHours h old, threshold ${MaxAgeHours}h.")
    } else {
        # A warning, not a failure. A missed night is recoverable by running
        # backup.ps1 by hand; the next scheduled run repairs the record.
        $behind = [math]::Floor($ageHours / 24)
        Add-Check -Id 'backup.age' -Group 'BACKUP' -Status $STATUS_WARN `
            -Detail ("STALE: $ageHours h old, over the ${MaxAgeHours}h threshold (about $behind day(s) behind). Run scripts\backup.ps1 now, and check the HRMS-Backup task.")
    }

    if ($latestDump.Length -ge $MinBytes) {
        Add-Check -Id 'backup.size' -Group 'BACKUP' -Status $STATUS_PASS `
            -Detail ("{0:N0} bytes, floor {1:N0} bytes." -f $latestDump.Length, $MinBytes)
    } else {
        Add-Check -Id 'backup.size' -Group 'BACKUP' -Status $STATUS_FAIL `
            -Detail ("{0:N0} bytes is below the {1:N0} byte floor. A dump this small is a truncated or empty extract, not a backup." -f $latestDump.Length, $MinBytes)
    }
}

# --- Delegated integrity and checksum verification --------------------------
# verify-backup.ps1 and the .sha256 sidecars are owned by other tooling. This
# script delegates to them and reports UNKNOWN when they are absent, rather
# than guessing. Guessing would be the one genuinely dishonest thing a
# health reporter can do.
$verifyScript = Join-Path $PSScriptRoot 'verify-backup.ps1'
$verifyExists = (Test-Path -LiteralPath $verifyScript -PathType Leaf)

if (-not $verifyExists) {
    Add-Check -Id 'backup.integrity' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
        -Detail 'scripts\verify-backup.ps1 is not present, so dump integrity is UNVERIFIED. Absence is reported, never passed.'
    Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
        -Detail 'scripts\verify-backup.ps1 is not present, so no checksum verification was attempted.'
} else {
    # The verify script's exact parameter name is not known to this script, so
    # the plausible ones are read out of its own param block. Guessing wrong
    # would produce a false FAIL, which is worse than an UNKNOWN.
    $verifyText = ''
    try { $verifyText = Get-Content -LiteralPath $verifyScript -Raw -ErrorAction Stop } catch { $verifyText = '' }
    $verifyTargetParam = ''
    foreach ($candidate in @('Path', 'BackupPath', 'BackupFile', 'DumpPath', 'File')) {
        if ($verifyText -match ('\$(?:' + $candidate + ')\b')) { $verifyTargetParam = $candidate; break }
    }
    if ([string]::IsNullOrWhiteSpace($verifyTargetParam)) { $verifyTargetParam = 'Path' }

    $verifyResult = $null
    $bindingError = $false
    if ($null -ne $latestDump) {
        $verifyArgs = @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $verifyScript,
            ('-' + $verifyTargetParam), $latestDump.FullName
        )
        $verifyResult = Invoke-Native -FilePath 'powershell.exe' -Arguments $verifyArgs
        # A parameter-name mismatch is an integration fault in this reporter,
        # not a corrupt dump. Detect it and downgrade instead of crying FAIL.
        if ($verifyResult.Output -match 'A parameter cannot be found that matches parameter name' -or
            $verifyResult.Output -match 'Missing an argument for parameter') {
            $bindingError = $true
        }
    }

    if ($null -eq $latestDump) {
        Add-Check -Id 'backup.integrity' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
            -Detail 'no dump exists to verify.'
        Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
            -Detail 'no dump exists to verify.'
    } elseif ($bindingError) {
        Add-Check -Id 'backup.integrity' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
            -Detail ("scripts\verify-backup.ps1 did not accept -$verifyTargetParam, so integrity could not be confirmed. Read its param block and add the right name here.")
        Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
            -Detail 'not attempted, because the verify script could not be invoked.'
    } elseif ($verifyResult.ExitCode -eq 0) {
        $backup.integrity = $STATUS_PASS
        Add-Check -Id 'backup.integrity' -Group 'BACKUP' -Status $STATUS_PASS `
            -Detail "scripts\verify-backup.ps1 exited 0 for $($latestDump.Name)."
    } else {
        $backup.integrity = $STATUS_FAIL
        $tail = $verifyResult.Output
        if ($null -ne $tail -and $tail.Length -gt 300) { $tail = $tail.Substring($tail.Length - 300) }
        Add-Check -Id 'backup.integrity' -Group 'BACKUP' -Status $STATUS_FAIL `
            -Detail ("scripts\verify-backup.ps1 exited $($verifyResult.ExitCode): $tail")
    }
}

# The .sha256 sidecar. Existence is this script's own check; verification is
# delegated to verify-backup.ps1 only if that script claims to support it.
$sidecarPath = $null
if ($null -ne $latestDump) {
    $possibleSidecar = ($latestDump.FullName + '.sha256')
    if (Test-Path -LiteralPath $possibleSidecar -PathType Leaf) {
        $sidecarPath = $possibleSidecar
    }
}
$backup.checksumSidecar = $sidecarPath

if ($null -eq $latestDump) {
    Add-Check -Id 'backup.sidecar' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
        -Detail 'no dump exists, so there is no sidecar to look for.'
} elseif ($null -ne $sidecarPath) {
    Add-Check -Id 'backup.sidecar' -Group 'BACKUP' -Status $STATUS_PASS `
        -Detail ("sidecar present: " + (Split-Path -Leaf $sidecarPath))
} else {
    Add-Check -Id 'backup.sidecar' -Group 'BACKUP' -Status $STATUS_WARN `
        -Detail ("no .sha256 sidecar next to $($latestDump.Name). The dump exists but nothing can prove later that it was not corrupted in transit or on disk.")
}

if (-not $verifyExists) {
    # Already reported as UNKNOWN above; do not double-report.
} elseif ($null -eq $sidecarPath) {
    # Not a failure: a checksum check with nothing to compare against is
    # meaningless, and the missing sidecar is already a WARN above.
    $backup.checksumVerified = $STATUS_UNKNOWN
    Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
        -Detail 'no .sha256 sidecar exists, so there is nothing to verify. The dump can only be proven intact once the sidecar tooling has written one.'
} elseif ($verifyText -match '\$Checksum\b') {
    # verify-backup.ps1 exposes -Checksum, which recomputes SHA-256 and compares
    # it against the sidecar. Ask for it rather than duplicating the hash here,
    # so there is one authority on what "this dump is intact" means.
    $checksumArgs = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $verifyScript,
        ('-' + $verifyTargetParam), $latestDump.FullName, '-Checksum'
    )
    $checksumResult = Invoke-Native -FilePath 'powershell.exe' -Arguments $checksumArgs
    if ($checksumResult.Output -match 'A parameter cannot be found that matches parameter name' -or
        $checksumResult.Output -match 'Missing an argument for parameter') {
        $backup.checksumVerified = $STATUS_UNKNOWN
        Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
            -Detail 'verify-backup.ps1 rejected the -Checksum argument, so the sidecar was not checked. Read its param block and correct the argument here.'
    } elseif ($checksumResult.ExitCode -eq 0) {
        $backup.checksumVerified = $STATUS_PASS
        Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_PASS `
            -Detail 'verify-backup.ps1 -Checksum confirmed the recorded SHA-256 matches the dump.'
    } else {
        $backup.checksumVerified = $STATUS_FAIL
        $tail = $checksumResult.Output
        if ($null -ne $tail -and $tail.Length -gt 300) { $tail = $tail.Substring($tail.Length - 300) }
        Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_FAIL `
            -Detail ("SHA-256 verification failed (exit $($checksumResult.ExitCode)): $tail")
    }
} else {
    $backup.checksumVerified = $STATUS_UNKNOWN
    Add-Check -Id 'backup.sidecar_verified' -Group 'BACKUP' -Status $STATUS_UNKNOWN `
        -Detail 'verify-backup.ps1 exposes no -Checksum switch, so the recorded SHA-256 was not independently verified.'
}

# =============================================================================
# SCHEDULER
# =============================================================================
# Every access is wrapped. A non-Windows host, a missing ScheduledTasks module
# or a denied ACL must produce UNKNOWN, never an exception that hides the rest
# of the report.
$getScheduledTask = Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue
$taskLookupFailure = ''

if ($null -eq $getScheduledTask) {
    Add-Check -Id 'scheduler.registered' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
        -Detail 'Get-ScheduledTask is unavailable (not Windows, or the ScheduledTasks module is missing). Scheduler state cannot be read.'
    Add-Check -Id 'scheduler.enabled' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
        -Detail 'scheduler state cannot be read on this host.'
    Add-Check -Id 'scheduler.last_run' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
        -Detail 'scheduler state cannot be read on this host.'
    Add-Check -Id 'scheduler.last_result' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
        -Detail 'scheduler state cannot be read on this host.'
    $scheduler.lastResultState = 'UNKNOWN'
} else {
    $task = $null
    try {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    } catch {
        $message = ''
        try { $message = [string] $_.Exception.Message } catch { $message = '' }
        if ($message -match 'No MSFT_ScheduledTask objects found' -or
            $message -match 'was not found' -or
            $message -match 'Cannot find') {
            $taskLookupFailure = 'NOT_REGISTERED'
        } else {
            $taskLookupFailure = 'UNKNOWN'
            $scheduler.lastResultState = 'UNKNOWN'
            Add-Check -Id 'scheduler.registered' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
                -Detail ("could not query task '$TaskName': $message")
            Add-Check -Id 'scheduler.enabled' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
                -Detail 'task state could not be read.'
            Add-Check -Id 'scheduler.last_run' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
                -Detail 'task run history could not be read.'
            Add-Check -Id 'scheduler.last_result' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
                -Detail 'task result could not be read.'
        }
    }

    # Get-ScheduledTask can succeed and still return nothing. Normalise that to
    # the same NOT REGISTERED verdict so the scheduler group always reports its
    # four checks and the check count is stable.
    if ([string]::IsNullOrEmpty($taskLookupFailure) -and $null -eq $task) {
        $taskLookupFailure = 'NOT_REGISTERED'
    }

    if ('NOT_REGISTERED' -eq $taskLookupFailure) {
        $scheduler.exists = $false
        $scheduler.lastResultState = 'NOT_REGISTERED'
        # Honest and currently true on this host. This is the whole point of
        # the script: an unregistered task means no automatic backups at all.
        Add-Check -Id 'scheduler.registered' -Group 'SCHEDULER' -Status $STATUS_WARN `
            -Detail ("NOT REGISTERED: scheduled task '$TaskName' does not exist on this host, so backups are never taken automatically. Run scripts\register-backup-task.ps1 once in an elevated PowerShell window.")
        Add-Check -Id 'scheduler.enabled' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
            -Detail 'the task does not exist, so it has no enabled state.'
        Add-Check -Id 'scheduler.last_run' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
            -Detail 'the task has never run, because it is not registered.'
        Add-Check -Id 'scheduler.last_result' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
            -Detail 'no task result exists, because the task is not registered.'
    } elseif ($null -ne $task) {
        $scheduler.exists = $true
        Add-Check -Id 'scheduler.registered' -Group 'SCHEDULER' -Status $STATUS_PASS `
            -Detail ("task '$TaskName' is registered. State: " + $task.State)

        $isDisabled = ($task.State -eq 'Disabled')
        $scheduler.enabled = (-not $isDisabled)
        if ($isDisabled) {
            # A disabled task is a hard failure, unlike an unregistered one:
            # someone deliberately turned automated backups off and nothing
            # will report that on its own.
            Add-Check -Id 'scheduler.enabled' -Group 'SCHEDULER' -Status $STATUS_FAIL `
                -Detail ("task '$TaskName' is DISABLED. It will never run, so no automatic backup will ever be taken.")
        } else {
            Add-Check -Id 'scheduler.enabled' -Group 'SCHEDULER' -Status $STATUS_PASS `
                -Detail ("task '$TaskName' is enabled.")
        }

        $taskInfo = $null
        try {
            $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
        } catch {
            Add-Check -Id 'scheduler.last_run' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
                -Detail ("Get-ScheduledTaskInfo failed: " + [string] $_.Exception.Message)
            Add-Check -Id 'scheduler.last_result' -Group 'SCHEDULER' -Status $STATUS_UNKNOWN `
                -Detail 'task info is unreadable, so LastTaskResult is unknown.'
        }

        if ($null -ne $taskInfo) {
            $lastRun = $taskInfo.LastRunTime
            $nextRun = $taskInfo.NextRunTime
            $lastResult = $taskInfo.LastTaskResult
            $scheduler.lastRunTime = Format-Iso $lastRun
            $scheduler.nextRunTime = Format-Iso $nextRun
            if ($null -ne $lastResult) { $scheduler.lastTaskResult = [int64] $lastResult }

            $neverRun = ($lastRun -eq [datetime]::MinValue) -or ($null -eq $lastRun)
            if ($neverRun) {
                Add-Check -Id 'scheduler.last_run' -Group 'SCHEDULER' -Status $STATUS_WARN `
                -Detail ("has never run. LastRunTime is unset; NextRunTime is " + (Format-Iso $nextRun))
            } else {
                Add-Check -Id 'scheduler.last_run' -Group 'SCHEDULER' -Status $STATUS_PASS `
                    -Detail ("LastRunTime " + (Format-Iso $lastRun) + ", NextRunTime " + (Format-Iso $nextRun))
            }

            # SCHED_S_TASK_HAS_NOT_RUN is 267009 (0x41303). It is not a failure;
            # it means the task has never executed. Every other non-zero value is
            # a real failed run and is treated as a failure.
            $resultCode = [int64] 0
            if ($null -ne $lastResult) { $resultCode = [int64] $lastResult }

            if ($resultCode -eq 0) {
                $scheduler.lastResultState = 'SUCCESS'
                Add-Check -Id 'scheduler.last_result' -Group 'SCHEDULER' -Status $STATUS_PASS `
                    -Detail "LastTaskResult 0 (success)."
            } elseif ($resultCode -eq 267009) {
                $scheduler.lastResultState = 'NEVER_RUN'
                Add-Check -Id 'scheduler.last_result' -Group 'SCHEDULER' -Status $STATUS_WARN `
                    -Detail "LastTaskResult 267009 (0x41303): the task has not run yet."
            } else {
                $scheduler.lastResultState = 'FAILURE'
                Add-Check -Id 'scheduler.last_result' -Group 'SCHEDULER' -Status $STATUS_FAIL `
                    -Detail "LastTaskResult ${resultCode}: the last scheduled run FAILED. Nothing reads this value, which is exactly why it exists here."
            }
        }
    }
}

# =============================================================================
# OFF-SITE
# =============================================================================
# Read-only. This script never uploads anything and never writes to the
# destination; scripts\offsite-backup.ps1 does that.
$offsiteEnvPath = [Environment]::GetEnvironmentVariable('OFFSITE_BACKUP_PATH')
$offsiteEnvProvider = [Environment]::GetEnvironmentVariable('OFFSITE_BACKUP_PROVIDER')
$offsiteEnvEnabled = [Environment]::GetEnvironmentVariable('OFFSITE_BACKUP_ENABLED')

if (-not [string]::IsNullOrWhiteSpace($offsiteEnvProvider)) {
    $offsite.provider = $offsiteEnvProvider.Trim().ToLowerInvariant()
}
if ([string]::IsNullOrWhiteSpace($offsiteEnvPath)) {
    $offsite.status = $STATE_NOT_CONFIGURED
    Add-Check -Id 'offsite.configured' -Group 'OFFSITE' -Status $STATUS_WARN -OffSite `
        -Detail 'NO OFF-HOST COPY. OFFSITE_BACKUP_PATH is unset, so every dump exists only on the same disk as the database it protects. A disk failure loses both.'
} else {
    $offsitePath = $offsiteEnvPath.Trim()
    $offsite.path = $offsitePath
    if (Get-IsEnabled $offsiteEnvEnabled) {
        $offsite.status = 'CONFIGURED'
        Add-Check -Id 'offsite.configured' -Group 'OFFSITE' -Status $STATUS_PASS -OffSite `
            -Detail ("off-site is enabled. provider=" + $offsite.provider + " path=" + $offsitePath)
    } else {
        $offsite.status = 'DISABLED'
        $flag = ''
        if (-not [string]::IsNullOrWhiteSpace($offsiteEnvEnabled)) { $flag = " OFFSITE_BACKUP_ENABLED='$offsiteEnvEnabled' is not a truthy value." }
        Add-Check -Id 'offsite.configured' -Group 'OFFSITE' -Status $STATUS_WARN -OffSite `
            -Detail ("off-site is configured but DISABLED, so nothing is being uploaded." + $flag + " Set OFFSITE_BACKUP_ENABLED=1.")
    }
}

$offsiteStatus = $null
if ($null -ne $offsite.path -and (Test-Path -LiteralPath $offsite.path -PathType Container)) {
    $statusFile = Join-Path $offsite.path '.offsite-status.json'
    if (Test-Path -LiteralPath $statusFile -PathType Leaf) {
        try {
            $offsiteStatus = (Get-Content -LiteralPath $statusFile -Raw -ErrorAction Stop) | ConvertFrom-Json
            if ($null -eq $offsiteStatus) {
                Add-Check -Id 'offsite.last_upload' -Group 'OFFSITE' -Status $STATUS_UNKNOWN -OffSite `
                    -Detail 'the off-site status sidecar .offsite-status.json is empty, so no upload is recorded.'
            }
        } catch {
            $offsiteStatus = $null
            Add-Check -Id 'offsite.last_upload' -Group 'OFFSITE' -Status $STATUS_FAIL -OffSite `
                -Detail 'the off-site status sidecar .offsite-status.json exists but is not valid JSON, so the off-site state is unreadable.'
        }
    }
}

if ($null -ne $offsiteStatus) {
    $uploadTime = $null
    if ($offsiteStatus.PSObject.Properties.Name -contains 'lastUploadTime' -and
        -not [string]::IsNullOrWhiteSpace([string] $offsiteStatus.lastUploadTime)) {
        # ParseExact with AssumeUniversal, not [datetime]::Parse: a bare Parse is
        # culture- and Kind-dependent for a trailing 'Z', and a mis-Kind timestamp
        # silently poisons every age comparison below.
        try {
            $uploadTime = [datetime]::ParseExact(
                ([string] $offsiteStatus.lastUploadTime),
                'yyyy-MM-ddTHH:mm:ssZ',
                [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
            )
        } catch { $uploadTime = $null }
    }
    $uploadName = ''
    if ($offsiteStatus.PSObject.Properties.Name -contains 'fileName') { $uploadName = [string] $offsiteStatus.fileName }
    $uploadSum = ''
    if ($offsiteStatus.PSObject.Properties.Name -contains 'sha256') { $uploadSum = [string] $offsiteStatus.sha256 }

    $offsite.lastUploadTime = Format-Iso $uploadTime
    $offsite.lastFileName = $uploadName
    $offsite.lastChecksum = $uploadSum

    $sumText = ''
    if (-not [string]::IsNullOrWhiteSpace($uploadSum)) {
        if ($uploadSum.Length -gt 16) { $sumText = ' sha256=' + $uploadSum.Substring(0, 16) + '...' } else { $sumText = ' sha256=' + $uploadSum }
    }
    Add-Check -Id 'offsite.last_upload' -Group 'OFFSITE' -Status $STATUS_PASS -OffSite `
        -Detail ("last successful upload: " + (Format-Iso $uploadTime) + " file=" + $uploadName + $sumText)

    if ($null -ne $uploadTime) {
        # Both operands must be UTC. PowerShell subtracts raw ticks and ignores
        # DateTime.Kind, so subtracting a local "now" from a UTC timestamp yields
        # a phantom delta equal to the host's UTC offset.
        $uploadAge = [math]::Round(((Get-Date).ToUniversalTime() - $uploadTime).TotalHours, 2)
        $offsite.uploadAgeHours = $uploadAge
        if ($uploadAge -le $MaxAgeHours) {
            Add-Check -Id 'offsite.upload_age' -Group 'OFFSITE' -Status $STATUS_PASS -OffSite `
                -Detail ("$uploadAge h since the last successful off-site upload, threshold ${MaxAgeHours}h.")
        } else {
            Add-Check -Id 'offsite.upload_age' -Group 'OFFSITE' -Status $STATUS_WARN -OffSite `
                -Detail ("STALE OFF-SITE COPY: $uploadAge h since the last successful upload, over the ${MaxAgeHours}h threshold. The off-host copy is older than it should be.")
        }
    } else {
        Add-Check -Id 'offsite.upload_age' -Group 'OFFSITE' -Status $STATUS_UNKNOWN -OffSite `
            -Detail 'the sidecar records no usable upload time, so its age cannot be reported.'
    }
} else {
    if ($STATE_NOT_CONFIGURED -ne $offsite.status -and 'DISABLED' -ne $offsite.status) {
        Add-Check -Id 'offsite.last_upload' -Group 'OFFSITE' -Status $STATUS_WARN -OffSite `
            -Detail 'no .offsite-status.json in the destination, so no upload has ever been recorded.'
    } else {
        Add-Check -Id 'offsite.last_upload' -Group 'OFFSITE' -Status $STATUS_UNKNOWN -OffSite `
            -Detail 'off-site is not usable, so there is no upload to report.'
    }
    Add-Check -Id 'offsite.upload_age' -Group 'OFFSITE' -Status $STATUS_UNKNOWN -OffSite `
        -Detail 'no successful upload is recorded, so its age cannot be reported.'
}

# =============================================================================
# VERDICT
# =============================================================================
$checkArray = @($script:Checks)
$passedCount = @($checkArray | Where-Object { $_.Status -eq $STATUS_PASS }).Count
$warnedCount = @($checkArray | Where-Object { $_.Status -eq $STATUS_WARN }).Count
$failedCount = @($checkArray | Where-Object { $_.Status -eq $STATUS_FAIL }).Count
$unknownCount = @($checkArray | Where-Object { $_.Status -eq $STATUS_UNKNOWN }).Count
$totalCount = $checkArray.Count

if ($failedCount -gt 0) {
    $result = $STATE_FAILED
    $exitCode = 2
} elseif ($warnedCount -gt 0) {
    $result = $STATE_WARNING
    $exitCode = 1
} else {
    $result = $STATE_HEALTHY
    $exitCode = 0
}

# NOT_CONFIGURED outranks WARNING, but only when nothing outside the off-site
# group complained. That keeps a missing off-host copy from being buried under
# routine noise, and stops it from masking a genuine fault elsewhere.
$offsiteConfigured = ($checkArray | Where-Object { $_.Id -eq 'offsite.configured' } | Select-Object -First 1)
$offsiteIsGood = ($null -ne $offsiteConfigured -and $offsiteConfigured.Status -eq $STATUS_PASS)
$nonOffSiteProblems = @($checkArray | Where-Object {
    (-not $_.OffSite) -and ($_.Status -eq $STATUS_FAIL -or $_.Status -eq $STATUS_WARN)
}).Count

if ($failedCount -gt 0) {
    $state = $STATE_FAILED
} elseif (-not $offsiteIsGood -and $nonOffSiteProblems -eq 0) {
    $state = $STATE_NOT_CONFIGURED
} elseif ($warnedCount -gt 0) {
    $state = $STATE_WARNING
} else {
    $state = $STATE_HEALTHY
}

if ($Json) {
    $payload = [ordered]@{
        schemaVersion = 1
        generatedAt   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        result        = $result
        state         = $state
        exitCode      = $exitCode
        counts        = [ordered]@{
            checks  = $totalCount
            passed  = $passedCount
            warned  = $warnedCount
            failed  = $failedCount
            unknown = $unknownCount
        }
        database     = $database
        backup       = $backup
        scheduler    = $scheduler
        offsite      = $offsite
        checks       = @($checkArray | ForEach-Object {
            [ordered]@{
                id     = $_.Id
                group  = $_.Group
                status = $_.Status
                detail = $_.Detail
            }
        })
    }
    # -Depth 8 because Windows PowerShell 5.1 defaults to 2 and silently
    # stringifies anything deeper than that.
    $jsonText = $payload | ConvertTo-Json -Depth 8
    # Write-Output rather than Write-Host: in -Json mode stdout must contain
    # the object and nothing else, so it can be piped into ConvertFrom-Json.
    Write-Output $jsonText
    exit $exitCode
}

Write-Host ''
foreach ($groupName in @('DATABASE', 'BACKUP', 'SCHEDULER', 'OFFSITE')) {
    Write-Host ("--- {0} ---" -f $groupName)
    foreach ($check in ($checkArray | Where-Object { $_.Group -eq $groupName })) {
        Write-Host ('{0,-5} {1,-24} {2}' -f $check.Status, $check.Id, $check.Detail)
    }
}

Write-Host ''
Write-Host ('BACKUP_HEALTH result={0} state={1} checks={2} failed={3} warned={4} unknown={5}' -f `
    $result, $state, $totalCount, $failedCount, $warnedCount, $unknownCount)

if ($failedCount -gt 0) {
    Write-Host 'backup-health.ps1: FAILED - at least one check did not pass. The details above name the cause; fix that, do not treat the newest dump as safe.'
} elseif ($STATE_NOT_CONFIGURED -eq $state) {
    Write-Host 'backup-health.ps1: NOT CONFIGURED - nothing is broken, but there is no off-host copy. Every dump is on the same disk as the database.'
} elseif ($warnedCount -gt 0) {
    Write-Host 'backup-health.ps1: WARNING - no hard failure, but the warnings above are real and unrepaired.'
} else {
    Write-Host 'backup-health.ps1: HEALTHY - every check passed, including the ones this script could have skipped.'
}

exit $exitCode