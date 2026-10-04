<#
.SYNOPSIS
    Timestamped logical backup of the HR Postgres database, for an explicitly
    named environment (development or production).

.DESCRIPTION
    Runs pg_dump *inside* the database container and writes a plain-text .sql
    file into ./backups, then validates it, then attests it with a SHA-256
    checksum, then applies retention.

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

    Order of operations, and why it is that order:
      1. banner        (what environment, container, database, destination)
      2. fail-safe     (production may only ever dump hr_system_db)
      3. preflight     (docker present; container exists and is running; the
                        database exists in pg_database; it answers SELECT 1)
      4. destination   (not inside PGDATA, exists or creatable, writable,
                        enough free space, git-ignored)
      5. dump          (pg_dump inside the container, exit code captured)
      6. validate      (verify-backup.ps1; on failure the dump is deleted)
      7. checksum      (<dump>.sha256 written only after step 6 passed)
      8. prune         (retention, only after a valid dump and its checksum)
    The checksum is deliberately written AFTER validation, never before. A
    checksum over a dump that failed validation is worse than no checksum at
    all, because it makes an invalid file look attested: an operator who sees
    <dump>.sql and <dump>.sql.sha256 agreeing concludes the file is good, and
    the sha256 only proves the file has not changed since it was written.

    ENVIRONMENT TARGETING
    ---------------------
    BACKUP_ENV selects which database this host is protecting. It is an
    explicit declaration, never a guess:

      BACKUP_ENV=development  canonical container 'hr-postgres'  (port 5433,
                              the database created by the local dev launcher
                              and used by DATABASE_URL / npm run dev)
      BACKUP_ENV=production   canonical container 'hr_system_db'  (port 5432,
                              the `db` service of docker-compose.yml, volume
                              hr_system-main_pgdata)

    Both databases are in real use. hr-postgres is NOT a leftover, and
    hr_system_db is NOT a development artifact. A host may run both, which is
    exactly the host on which guessing goes wrong: with no environment
    declared, a nightly task backs up DEVELOPMENT while an administrator
    believes PRODUCTION is covered, and every run is green.

    The canonical database user is also environment-specific, because the two
    containers were created differently:

      development  POSTGRES_USER postgres   (the dev launcher)
      production   POSTGRES_USER hr_admin   (docker-compose.yml)

    THE FAIL-SAFE
    -------------
    If BACKUP_ENV=production and the resolved container is anything other than
    hr_system_db, this script exits non-zero BEFORE dumping anything, and the
    message names both the resolved container and the required one. That
    combination is never legitimate and is never worked around: a successful
    dev dump is not a production backup, and reporting success there is the
    one outcome worse than failing.

    Container resolution order, highest priority first. This is the same shape
    as BACKUP_KEEP, so one rule covers every setting in this script:
      1. an explicit parameter on the command line    -Container hr_system_db
      2. the environment variable                    BACKUP_CONTAINER=hr_system_db
      3. the canonical default for the environment    BACKUP_ENV=production
                                                        implies hr_system_db
    An explicitly supplied parameter always wins, which is what makes
    -Container usable as a one-off override. An unset, empty or unparsable
    environment variable falls through to the next level and says so on stdout
    rather than silently doing something unexpected.

    BACKUP_ENV itself resolves the same way: -Environment beats BACKUP_ENV
    beats the baked-in default of 'development'. The default is LOUD, because
    the unsafe case is an operator who never set anything and assumed
    production was covered.

      BACKUP_ENV         development | production   (default development)
      BACKUP_CONTAINER   overrides the canonical container for the environment
      BACKUP_DB_USER     role the dump runs as        (default per environment)
      BACKUP_DB_NAME     database name                (default hr_system)
      BACKUP_KEEP        number of dated dumps to keep (default 14)
      BACKUP_DIR         destination directory        (default ./backups)
      BACKUP_LOG_FILE    log destination              (default logs/backup.log)

    DESTINATION SAFETY
    ------------------
    The destination is validated before a single byte of dump is written:
      - it is not inside the live PostgreSQL data directory of the target
        container (a dump in PGDATA is destroyed by the next container restart
        and is counted in the container's own volume)
      - it exists, or can be created
      - it is actually writable, tested rather than assumed
      - it has room for a dump: free space is compared against twice the size
        of the newest existing dump, with a floor, and a short disk is an
        error rather than a truncated file discovered later
      - it carries a .gitignore containing '*', created if missing
    Nothing this script creates ever contains a credential.

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

.EXAMPLE
    $env:BACKUP_ENV = 'production'
    powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
#>

[CmdletBinding()]
param(
    # Environment to protect: 'development' or 'production'. Resolved as
    # -Environment, then BACKUP_ENV, then 'development'. Empty here means "not
    # supplied", so the environment default can be used instead of baking
    # 'development' into the parameter.
    [string] $Environment = '',

    # Container holding the database. Override with BACKUP_CONTAINER. The
    # default is whatever BACKUP_ENV implies, so this parameter carries no
    # opinion of its own.
    [string] $Container = '',

    # Role the dump runs as. Default per environment: postgres for development
    # (the dev launcher), hr_admin for production (docker-compose.yml).
    # Override with BACKUP_DB_USER. No password is ever used or passed: inside
    # the container psql and pg_dump authenticate over the local unix socket,
    # which the official image trusts.
    [string] $DbUser = '',

    [string] $DbName = '',

    # Resolved in the body, not here: under Windows PowerShell 5.1 $PSScriptRoot
    # is empty inside a param() default, so `Join-Path $PSScriptRoot ...` throws
    # "cannot bind argument to parameter 'Path' because it is an empty string"
    # before the script runs a single line.
    [string] $BackupDir = '',

    # How many dated dumps to keep. Older ones are deleted after a successful,
    # validated, checksummed backup, never before. 0 or negative is clamped to
    # 1 rather than rejected or obeyed: see the prune guard below.
    [int] $Keep = 14,

    # Weak sanity floor passed to verify-backup.ps1. Not a decision input, only
    # a floor that catches an empty or stub file.
    [long] $MinBytes = 1024,

    # Destination free-space floor, in bytes. The requirement is the larger of
    # this and twice the newest existing dump. A destination with less room than
    # that fails before the dump starts rather than producing a short file.
    [long] $MinFreeBytes = 67108864,

    # Run every validation and exit 0 without dumping. Used to prove the
    # preflight branches (for example a stopped container) on a host where
    # stopping a real database is not an option.
    [switch] $PreflightOnly
)

$ErrorActionPreference = 'Stop'

# Shared, machine-greppable log writer. Dot-sourced from $PSScriptRoot rather
# than from the working directory, so it resolves the same way when Task
# Scheduler starts this script with an empty working directory.
$logModule = Join-Path $PSScriptRoot 'backup-log.ps1'
if (-not (Test-Path -LiteralPath $logModule -PathType Leaf)) {
    Write-Error "backup.ps1: missing required helper '$logModule'."
    exit 1
}
. $logModule

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

# The canonical environment table. This is configuration, not detection: nothing
# here probes the host to decide which environment it is on. An operator
# declares it, and the script holds that declaration to the correct container.
$script:BackupEnvironmentNames = @('development', 'production')
$script:BackupContainerByEnv   = @{ 'development' = 'hr-postgres'; 'production' = 'hr_system_db' }
$script:BackupDbUserByEnv      = @{ 'development' = 'postgres';    'production' = 'hr_admin' }
$script:BackupDbNameByEnv      = @{ 'development' = 'hr_system';   'production' = 'hr_system' }

$script:EffectiveContainer = ''
$script:EffectiveDbName    = ''
$script:Environment        = ''

function Write-Fail {
    param([string] $Message, [string] $Reason = 'error')

    # Logged before the error is raised. Under $ErrorActionPreference='Stop'
    # Write-Error throws, so anything after it would never run.
    Write-BackupLog -Level ERROR -Event BACKUP_FAILED -Fields @{
        phase      = 'backup'
        reason     = $Reason
        detail     = $Message
        env        = $script:Environment
        container  = $script:EffectiveContainer
        db         = $script:EffectiveDbName
        elapsed_s  = [int] $stopwatch.Elapsed.TotalSeconds
    }

    # Write-Error under 'Stop' is terminating, which would skip the explicit
    # exit below and leave the exit code to the host's error handling. Drop to
    # 'Continue' for this single call so both the log line and exit 1 are
    # guaranteed to happen.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { Write-Error "backup.ps1: $Message" }
    finally { $ErrorActionPreference = $previous }

    exit 1
}

function Resolve-BackupSetting {
<#
.SYNOPSIS
    Apply the parameter / environment / default precedence for one setting.
.DESCRIPTION
    Returns a PSCustomObject with the effective Value and a Source label. A
    non-integer environment value is ignored rather than coerced, because
    silently turning BACKUP_KEEP='fourteen' into 0 or 14 is how a retention
    policy gets deleted by accident.
#>
    [CmdletBinding()]
    param(
        [string] $Name,
        [string] $EnvName,
        [string] $CurrentValue,
        [bool] $IsInteger = $false,
        [bool] $ExplicitlyBound = $false
    )

    if ($ExplicitlyBound) {
        return [pscustomobject]@{ Value = $CurrentValue; Source = ('-' + $Name) }
    }

    $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
    if ([string]::IsNullOrWhiteSpace($fromEnv)) {
        return [pscustomobject]@{ Value = $CurrentValue; Source = 'default' }
    }

    if (-not $IsInteger) {
        return [pscustomobject]@{ Value = $fromEnv.Trim(); Source = $EnvName }
    }

    $parsed = 0
    if ([int]::TryParse($fromEnv.Trim(), [ref] $parsed)) {
        return [pscustomobject]@{ Value = $parsed; Source = $EnvName }
    }

    return [pscustomobject]@{
        Value  = $CurrentValue
        Source = ('default (ignored {0}=''{1}'': not an integer)' -f $EnvName, $fromEnv.Trim())
    }
}

function Invoke-DockerCapture {
<#
.SYNOPSIS
    Run docker, capture stdout+stderr as text, and preserve the exit code.
.DESCRIPTION
    $ErrorActionPreference is relaxed for the call: in Windows PowerShell 5.1 a
    native command's stderr, once redirected into the success stream, becomes
    an ErrorRecord that 'Stop' would turn into an exception. That would turn
    "pg_dump said no" into "this script has a bug".
#>
    [CmdletBinding()]
    param([string[]] $Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & docker @Arguments 2>&1
        $code = $LASTEXITCODE
        # A native command's stderr arrives as an ErrorRecord, and the stream
        # always ends with an empty one that would otherwise stringifies to the
        # type name and land in the middle of an error message.
        $lines = @(
            $output | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) { [string] $_.Exception.Message }
                else { [string] $_ }
            } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        $text = (($lines -join "`n").Trim())
        return [pscustomobject]@{ ExitCode = $code; Output = $text; Failed = $false }
    }
    catch {
        return [pscustomobject]@{ ExitCode = -1; Output = $_.Exception.Message; Failed = $true }
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function ConvertTo-ComparablePath {
<#
.SYNOPSIS
    Reduce a path to a form two paths can be honestly compared as.
.DESCRIPTION
    GetFullPath resolves . and .., separators are unified to backslash because
    container mount sources arrive as Linux paths even when the host is
    Windows, and the trailing separator is dropped so "C:\backups" and
    "C:\backups\" compare equal. Comparison is then a plain case-insensitive
    ordinal compare, which is what GetFullPath already guarantees on Windows.
#>
    [CmdletBinding()]
    param([string] $Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }

    $full = ''
    try { $full = [System.IO.Path]::GetFullPath($Path) }
    catch { return '' }

    if ([string]::IsNullOrWhiteSpace($full)) { return '' }

    $full = $full.Replace('/', '\')
    while ($full.Length -gt 3 -and $full.EndsWith('\')) {
        $full = $full.Substring(0, $full.Length - 1)
    }
    return $full.ToLowerInvariant()
}

function Test-PathIsInside {
<#
.SYNOPSIS
    True when $Path is $Parent or lies beneath it.
.DESCRIPTION
    Parent-directory equality is not enough here, because a mount point is an
    ancestor chain and "C:\hr\backups-evil" must not be accepted as "inside
    C:\hr\backups". The comparison is done against the parent plus a separator,
    which makes that whole class of near-miss impossible.
#>
    [CmdletBinding()]
    param(
        [string] $Path,
        [string] $Parent
    )

    $child = ConvertTo-ComparablePath $Path
    $root = ConvertTo-ComparablePath $Parent

    if ([string]::IsNullOrEmpty($child)) { return $false }
    if ([string]::IsNullOrEmpty($root)) { return $false }
    if ($child -eq $root) { return $true }

    $prefix = $root
    if (-not $prefix.EndsWith('\')) { $prefix = $prefix + '\' }
    return $child.StartsWith($prefix)
}

function Get-ContainerDataMounts {
<#
.SYNOPSIS
    The target container's mounts and its PGDATA path.
.DESCRIPTION
    Returns an object with a Mounts array (Source / Destination / Type) and the
    container's PGDATA. Every docker call is guarded: a container that cannot be
    inspected yields MountsUnreadable, and the caller reports that rather than
    claiming the destination is safe when it never checked.
#>
    [CmdletBinding()]
    param([string] $ContainerName)

    $result = [pscustomobject]@{
        Mounts             = @()
        PGDATA             = ''
        MountsUnreadable   = $false
        MountsReadError    = ''
        PGDATAUnreadable   = $false
    }

    $inspect = Invoke-DockerCapture -Arguments @('inspect', '-f', '{{json .Mounts}}', $ContainerName)
    if ($inspect.Failed -or $inspect.ExitCode -ne 0) {
        $result.MountsUnreadable = $true
        $result.MountsReadError = $inspect.Output
    }
    else {
        $text = $inspect.Output.Trim()
        if ([string]::IsNullOrWhiteSpace($text) -or $text -eq 'null') {
            $result.Mounts = @()
        }
        else {
            try {
                $parsed = ConvertFrom-Json -InputObject $text
                if ($null -ne $parsed) { $result.Mounts = @($parsed) }
            }
            catch {
                $result.MountsUnreadable = $true
                $result.MountsReadError = $_.Exception.Message
            }
        }
    }

    $pgdata = Invoke-DockerCapture -Arguments @('exec', $ContainerName, 'printenv', 'PGDATA')
    if (-not $pgdata.Failed -and $pgdata.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($pgdata.Output)) {
        $result.PGDATA = $pgdata.Output.Trim()
    }
    else {
        $result.PGDATAUnreadable = $true
    }

    return $result
}

function Get-DestinationRefusalReason {
<#
.SYNOPSIS
    Refuse a destination that resolves inside the live PostgreSQL data directory.
.DESCRIPTION
    Returns $null when the destination is acceptable, or a message when it must
    be refused. Two separate truths are checked, because either one alone is
    enough to destroy backups:

      1. the destination equals, or lies beneath, a mount SOURCE of the target
         container, which is where the data directory actually lives on the
         host;
      2. the destination equals, or lies beneath, the container's PGDATA path
         (its default, if PGDATA could not be read).

    A dump written into PGDATA is deleted or replaced by the next container
    restart and is counted in the container's own volume, so retention,
    off-host staging and "did the backup run" checks all believe it is safe
    while it is not. Failing closed here costs one clear error; failing open
    costs the entire backup history.

    The comparison is textual because that is all a mount source is: a path.
    Docker Desktop keeps named volumes inside a Linux VM, so on this class of
    host the host-visible source and the backup directory are in different
    filesystems and the check simply finds no overlap, which is the truthful
    answer. Where they do overlap the refusal fires.
#>
    [CmdletBinding()]
    param(
        [string] $BackupRoot,
        [object] $MountInfo
    )

    if ($null -eq $MountInfo) { return $null }

    if ($MountInfo.MountsUnreadable) {
        return ('could not read the mount points of the target container, so it cannot be proven that {0} is outside the database data directory. docker inspect failed: {1}. Re-run with docker available, or point BACKUP_DIR at a directory that is not a database volume.' -f $BackupRoot, $MountInfo.MountsReadError)
    }

    $dataRoots = New-Object System.Collections.ArrayList

    foreach ($mount in @($MountInfo.Mounts)) {
        if ($null -eq $mount) { continue }
        $source = ''
        if ($mount.PSObject.Properties.Name -contains 'Source') { $source = [string] $mount.Source }
        if ([string]::IsNullOrWhiteSpace($source)) { continue }
        if ([string]::IsNullOrWhiteSpace((ConvertTo-ComparablePath $source))) { continue }
        [void] $dataRoots.Add($source)
    }

    if (-not [string]::IsNullOrWhiteSpace($MountInfo.PGDATA) -and
        -not [string]::IsNullOrWhiteSpace((ConvertTo-ComparablePath $MountInfo.PGDATA))) {
        [void] $dataRoots.Add($MountInfo.PGDATA)
    }

    foreach ($root in $dataRoots) {
        if (Test-PathIsInside -Path $BackupRoot -Parent $root) {
            return ('refusing to write dumps into {0}: it resolves INSIDE the live PostgreSQL data directory ({1}) of the target container. A dump stored in PGDATA is destroyed by the next container restart and is counted inside the container own volume, so it looks like a healthy backup and is not one. Set BACKUP_DIR to a directory outside the database data directory.' -f $BackupRoot, $root)
        }
    }

    return $null
}

function Test-PathIsInsideBackupRoot {
<#
.SYNOPSIS
    Assert a candidate path's parent directory is exactly the backup directory.
.DESCRIPTION
    Retention deletes files by name, and a name is never enough to be sure what
    is being removed: a filter that went wrong, or a symlink/junction pointing
    somewhere else, would delete a real database file. This compares the
    resolved parent directory of the candidate against the resolved backup
    directory and refuses anything else.

    Parent-directory equality, not a string prefix test, on purpose: a prefix
    test would accept C:\hr\backups-evil when the backup directory is
    C:\hr\backups, because the first is a string prefix of nothing and the
    comparison would have to be done on the path with a separator appended.
    Comparing the exact parent removes that class of mistake entirely.
#>
    [CmdletBinding()]
    param(
        [string] $FullPath,
        [string] $BackupRoot
    )

    $resolvedRoot = ([System.IO.Path]::GetFullPath($BackupRoot)).TrimEnd('\', '/')
    $candidateDir = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($FullPath))
    if ([string]::IsNullOrEmpty($candidateDir)) { return $false }
    return ($candidateDir.TrimEnd('\', '/') -ieq $resolvedRoot)
}

function Quote-NativeArgument {
<#
.SYNOPSIS
    Quote one argument for Start-Process -ArgumentList if it contains a space.
.DESCRIPTION
    Start-Process joins an argument array with spaces and does no quoting of its
    own, so a repository path containing a space would arrive at the child
    process as two arguments. A double quote is not legal in a Windows path, so
    any that appears is replaced rather than escaped.
#>
    [CmdletBinding()]
    param([string] $Value)

    if ($Value -notmatch '\s') { return $Value }
    return '"' + ($Value -replace '"', "'") + '"'
}

function Get-DefaultedParameterValue {
<#
.SYNOPSIS
    Choose which value a setting resolves from, before the environment is read.
.DESCRIPTION
    The canonical value for an environment is the DEFAULT, not a fallback for a
    missing parameter. A parameter that the caller supplied always wins, so it
    must be handed to Resolve-BackupSetting as the current value; only when the
    caller supplied nothing may the environment's canonical value stand in.

    Getting this wrong is silent and severe: passing -DbName some_other_db while
    the default is used instead dumps the wrong database under a name that looks
    correct. That is why the two values are separated here rather than collapsed
    into one argument.
#>
    [CmdletBinding()]
    param(
        [string] $ParameterValue,
        [string] $DefaultValue,
        [bool] $ExplicitlyBound
    )

    if ($ExplicitlyBound) { return $ParameterValue }
    return $DefaultValue
}

# --- Resolve the environment -------------------------------------------------
# First, because every other default in this script depends on it. An unrecognised
# value is a hard error rather than a silent fallback: a typo in BACKUP_ENV must
# not quietly select the development database.
$envSetting = Resolve-BackupSetting -Name 'Environment' -EnvName 'BACKUP_ENV' `
    -CurrentValue $Environment -ExplicitlyBound $PSBoundParameters.ContainsKey('Environment')

$BackupEnvironment = ([string] $envSetting.Value).Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($BackupEnvironment)) {
    $BackupEnvironment = 'development'
    $envSetting = [pscustomobject]@{ Value = 'development'; Source = 'default (development)' }
}

if ($script:BackupEnvironmentNames -notcontains $BackupEnvironment) {
    Write-Fail ('BACKUP_ENV must be one of: development, production. Received: ''{0}''. No database was dumped. Declare which database this host protects rather than letting an unrecognised value pick one.' -f $BackupEnvironment) 'bad_environment'
}

$script:Environment = $BackupEnvironment
$canonicalContainer = $script:BackupContainerByEnv[$BackupEnvironment]
$canonicalDbUser = $script:BackupDbUserByEnv[$BackupEnvironment]
$canonicalDbName = $script:BackupDbNameByEnv[$BackupEnvironment]

# --- Resolve every other setting ---------------------------------------------
# The canonical value for the declared environment is the default, so the
# precedence chain is identical for every setting: parameter, then environment
# variable, then the environment's canonical value.
$containerBound = $PSBoundParameters.ContainsKey('Container')
$dbUserBound = $PSBoundParameters.ContainsKey('DbUser')
$dbNameBound = $PSBoundParameters.ContainsKey('DbName')

$containerSetting = Resolve-BackupSetting -Name 'Container' -EnvName 'BACKUP_CONTAINER' `
    -CurrentValue (Get-DefaultedParameterValue -ParameterValue $Container -DefaultValue $canonicalContainer -ExplicitlyBound $containerBound) `
    -ExplicitlyBound $containerBound
$dbUserSetting = Resolve-BackupSetting -Name 'DbUser' -EnvName 'BACKUP_DB_USER' `
    -CurrentValue (Get-DefaultedParameterValue -ParameterValue $DbUser -DefaultValue $canonicalDbUser -ExplicitlyBound $dbUserBound) `
    -ExplicitlyBound $dbUserBound
$dbSetting = Resolve-BackupSetting -Name 'DbName' -EnvName 'BACKUP_DB_NAME' `
    -CurrentValue (Get-DefaultedParameterValue -ParameterValue $DbName -DefaultValue $canonicalDbName -ExplicitlyBound $dbNameBound) `
    -ExplicitlyBound $dbNameBound
$keepSetting      = Resolve-BackupSetting -Name 'Keep' -EnvName 'BACKUP_KEEP' -IsInteger $true `
    -CurrentValue ([string] $Keep) -ExplicitlyBound $PSBoundParameters.ContainsKey('Keep')
$dirSetting       = Resolve-BackupSetting -Name 'BackupDir' -EnvName 'BACKUP_DIR' `
    -CurrentValue $BackupDir -ExplicitlyBound $PSBoundParameters.ContainsKey('BackupDir')

$Container = $containerSetting.Value
$DbUser = $dbUserSetting.Value
$DbName = $dbSetting.Value
$Keep = [int] $keepSetting.Value
$BackupDir = $dirSetting.Value
$script:EffectiveContainer = $Container
$script:EffectiveDbName = $DbName

# An explicitly supplied but empty value is a mistake worth naming. Without this
# it falls through to docker as an empty argument, and the resulting message
# describes a container or database that does not exist rather than the empty
# string the operator actually typed.
foreach ($boundSetting in @(
    @{ Label = 'Container'; Value = $Container; From = $containerSetting.Source },
    @{ Label = 'DbUser'; Value = $DbUser; From = $dbUserSetting.Source },
    @{ Label = 'DbName'; Value = $DbName; From = $dbSetting.Source }
)) {
    if ([string]::IsNullOrWhiteSpace([string] $boundSetting.Value)) {
        Write-Fail ('{0} resolved to an empty value (from: {1}). An empty container, database or role name is never valid, so this is refused rather than passed to docker as an empty argument.' -f $boundSetting.Label, $boundSetting.From) 'empty_setting'
    }
}

# The destination is resolved here rather than further down, because the
# environment banner must state where the dump would go before anything runs.
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
    $BackupDir = Join-Path $PSScriptRoot '..\backups'
}
$backupRoot = ''
try {
    $backupRoot = [System.IO.Path]::GetFullPath($BackupDir)
}
catch {
    Write-Fail ('BACKUP_DIR is not a usable path: ''{0}'' ({1})' -f $BackupDir, $_.Exception.Message) 'bad_backup_dir'
}

# The run stamp, fixed here because both the destination write probe and the
# dump filename below need it, and the destination checks run first.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

# --- Environment banner ------------------------------------------------------
# First thing on stdout, before any work, so a log tail always answers "which
# database did this run touch".
Write-Host ("[BACKUP] Environment: {0}" -f $BackupEnvironment)
Write-Host ("[BACKUP] Target container: {0}" -f $Container)
Write-Host ("[BACKUP] Database: {0}" -f $DbName)
Write-Host ("[BACKUP] Destination: {0}" -f $backupRoot)
Write-Host ("[BACKUP] Dump user: {0}" -f $DbUser)

if ($envSetting.Source -eq 'default (development)') {
    # The default must be loud. The dangerous situation is not "somebody set the
    # wrong value", it is "somebody set no value and assumed production was
    # covered".
    Write-Host ("[BACKUP] WARNING: BACKUP_ENV is not set, so this run defaults to environment '{0}' and container '{1}', the DEVELOPMENT database. On a production host set BACKUP_ENV=production." -f $BackupEnvironment, $canonicalContainer)
}

Write-Host ("[backup] resolution: environment source={0} container source={1} db_user source={2} db source={3}" -f `
    $envSetting.Source, $containerSetting.Source, $dbUserSetting.Source, $dbSetting.Source)
Write-Host ("[backup] retention keep=$Keep (source: {0})" -f $keepSetting.Source)
if ($dirSetting.Source -ne 'default') {
    Write-Host ("[backup] destination directory (source: {0}): {1}" -f $dirSetting.Source, $backupRoot)
}

Write-BackupLog -Level INFO -Event BACKUP_STARTED -Fields @{
    env        = $BackupEnvironment
    env_from   = $envSetting.Source
    container  = $Container
    container_from = $containerSetting.Source
    db         = $DbName
    db_user    = $DbUser
    keep       = $Keep
    keep_from  = $keepSetting.Source
    dir        = $backupRoot
    dir_from   = $dirSetting.Source
}

# --- Fail-safe: production may only ever dump the production container ------
# Before docker is even consulted, and long before a byte is dumped. This is the
# guard against a nightly task that succeeds every night against the wrong
# database while an administrator believes production is covered.
$requiredProductionContainer = $script:BackupContainerByEnv['production']

if ($BackupEnvironment -eq 'production' -and $Container -ine $requiredProductionContainer) {
    Write-Fail ('refusing to dump: BACKUP_ENV=production requires container ''{0}'' (the docker-compose.yml production db service), but the resolved container is ''{1}'' (resolved from: {2}). A dump of ''{1}'' is a development database backup, not a production backup, and reporting success here is the exact failure this check exists to prevent. Nothing was dumped and no file was created. Fix it in one of these ways: set BACKUP_CONTAINER={0}; or remove BACKUP_CONTAINER and the -Container parameter so BACKUP_ENV=production selects it; or set BACKUP_ENV=development if development is genuinely what this host should protect.' -f $requiredProductionContainer, $Container, $containerSetting.Source) 'production_container_mismatch'
}

# --- Preflight --------------------------------------------------------------
# Every one of these has a real failure mode behind it. A backup that fails
# halfway through is worse than no backup, because it looks like one exists.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail 'docker was not found on PATH.' 'docker_missing'
}

if ($DbName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    Write-Fail ('database name ''{0}'' is not a plain PostgreSQL identifier, so it cannot be checked safely. Use letters, digits and underscores only.' -f $DbName) 'bad_db_name'
}

# Existence and running state are two distinct questions with two distinct
# answers, and they are reported separately on purpose: "you pointed production at
# the development container" and "that container is stopped" need different fixes.
$inspect = Invoke-DockerCapture -Arguments @('inspect', '-f', '{{.State.Running}}', $Container)
if ($inspect.Failed -or $inspect.ExitCode -ne 0) {
    Write-Fail ('container ''{0}'' was not found on this host. This is a different fault from the wrong-container fail-safe above: the name resolved is ''{0}'', and no such container exists. Create it first, or set BACKUP_CONTAINER to the container that holds ''{1}''.' -f $Container, $DbName) 'container_not_found'
}
if ($inspect.Output.Trim().ToLowerInvariant() -ne 'true') {
    Write-Fail ('container ''{0}'' exists but is not running, so it cannot be dumped. Start it: docker start {0}' -f $Container) 'container_not_running'
}

# Does the database actually exist? pg_dump against a missing database exits
# non-zero with a short message, and the redirection target file is left behind
# as a near-empty artefact that looks like a backup. Ask pg_database first.
$dbListQuery = 'SELECT datname FROM pg_database'
$dbList = Invoke-DockerCapture -Arguments @('exec', $Container, 'psql', '-U', $DbUser, '-d', 'postgres', '-tAc', $dbListQuery)
if ($dbList.Failed -or $dbList.ExitCode -ne 0) {
    Write-Fail ('could not read pg_database inside container ''{0}'' as role ''{1}'', so it cannot be proven that database ''{2}'' exists: {3}' -f $Container, $DbUser, $DbName, $dbList.Output) 'database_list_unreadable'
}

$existingDatabases = @(
    ($dbList.Output -split "`r?`n") |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Sort-Object -Unique
)

if ($existingDatabases -notcontains $DbName) {
    $known = 'none'
    if ($existingDatabases.Count -gt 0) { $known = ($existingDatabases -join ', ') }
    Write-Fail ('database ''{0}'' does not exist inside container ''{1}''. Databases present: {2}. No dump file was created. Check BACKUP_DB_NAME, and check that the container you are pointing at is the one that holds this database.' -f $DbName, $Container, $known) 'database_not_found'
}

# Confirm the database is reachable and that the role exists, so the failure
# happens here with a clear message rather than as a truncated .sql file.
$dbPing = Invoke-DockerCapture -Arguments @('exec', $Container, 'psql', '-U', $DbUser, '-d', $DbName, '-tAc', 'SELECT 1')
if ($dbPing.Failed -or $dbPing.ExitCode -ne 0) {
    Write-Fail ('cannot connect to database ''{0}'' as role ''{1}'' inside ''{2}''. {3}' -f $DbName, $DbUser, $Container, $dbPing.Output) 'db_unreachable'
}

# --- Destination safety ------------------------------------------------------
# All of it before the dump starts. A destination fault discovered halfway
# through a dump is a truncated dump with a real name.

# (1) Never inside the live PostgreSQL data directory. Checked BEFORE the
# directory is created, so a refusal never leaves a stray directory behind
# either.
$mountInfo = Get-ContainerDataMounts -ContainerName $Container
$insideDataDir = Get-DestinationRefusalReason -BackupRoot $backupRoot -MountInfo $mountInfo
if ($null -ne $insideDataDir) {
    Write-Fail $insideDataDir 'destination_inside_pgdata'
}
Write-Host '[backup] destination check: outside the container PostgreSQL data directory'

# (2) Exists, or can be created.
if (-not (Test-Path -LiteralPath $backupRoot)) {
    try {
        New-Item -ItemType Directory -Path $backupRoot -Force -ErrorAction Stop | Out-Null
    }
    catch {
        Write-Fail ('destination directory could not be created: {0} ({1})' -f $backupRoot, $_.Exception.Message) 'destination_not_creatable'
    }
    Write-Host ("[backup] created $backupRoot")
}
if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    Write-Fail ('destination {0} exists but is not a directory, so no dump can be written there.' -f $backupRoot) 'destination_not_a_directory'
}

# (3) Actually writable. Tested, not assumed: a directory on a read-only share,
# or one owned by another account, looks perfectly usable from a listing and
# fails only once pg_dump has already written half a file.
$probePath = Join-Path $backupRoot ('.backup-write-probe-{0}-{1}.tmp' -f $stamp, $PID)
$probeBytes = [byte[]] (0..255)
try {
    [System.IO.File]::WriteAllBytes($probePath, $probeBytes)
    $probeReadBack = [System.IO.File]::ReadAllBytes($probePath)
    if ($probeReadBack.Length -ne $probeBytes.Length) {
        Write-Fail ('destination {0} accepted a write but read back {1} of {2} bytes, so it is not reliably writable.' -f $backupRoot, $probeReadBack.Length, $probeBytes.Length) 'destination_not_writable'
    }
}
catch {
    Write-Fail ('destination directory is not writable: {0} ({1})' -f $backupRoot, $_.Exception.Message) 'destination_not_writable'
}
finally {
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
}
Write-Host '[backup] destination check: writable (write/read/delete probe passed)'

# (4) Room for the dump. Compared against twice the newest existing dump, so a
# destination that cannot hold the next dump fails here rather than truncating.
$newestExisting = $null
try {
    $newestExisting = Get-ChildItem -LiteralPath $backupRoot -Filter "$DbName-*.sql" -File -ErrorAction SilentlyContinue |
        Sort-Object -Property @{ Expression = 'LastWriteTimeUtc'; Descending = $true }, @{ Expression = 'Name'; Descending = $true } |
        Select-Object -First 1
}
catch {
    $newestExisting = $null
}

$spaceEstimate = 0
if ($null -ne $newestExisting) { $spaceEstimate = [int64] $newestExisting.Length * 2 }
$spaceRequired = [int64] $MinFreeBytes
if ($spaceEstimate -gt $spaceRequired) { $spaceRequired = $spaceEstimate }

$freeBytes = [int64] -1
$spaceError = ''
try {
    $driveRoot = [System.IO.Path]::GetPathRoot($backupRoot)
    if (-not [string]::IsNullOrWhiteSpace($driveRoot)) {
        $driveInfo = New-Object System.IO.DriveInfo($driveRoot)
        $freeBytes = [int64] $driveInfo.AvailableFreeSpace
    }
}
catch {
    $spaceError = $_.Exception.Message
}

if ($freeBytes -lt 0) {
    # Unknowable, not known-good. It is reported loudly and logged, but it is
    # not turned into a hard failure: a UNC destination legitimately has no
    # DriveInfo, and refusing every network backup directory would be wrong.
    $spaceWarn = ("[backup] WARNING: free space on the destination could not be determined ({0}), so the room-for-the-dump check was skipped rather than passed." -f $spaceError)
    Write-Host $spaceWarn
    Write-BackupLog -Level WARN -Event BACKUP_DEST_SPACE_UNKNOWN -Fields @{
        dir        = $backupRoot
        note       = 'free_space_unknown'
        detail     = $spaceError
        elapsed_s  = [int] $stopwatch.Elapsed.TotalSeconds
    }
}
elseif ($freeBytes -lt $spaceRequired) {
    Write-Fail ('destination {0} has {1} MB free but a dump needs about {2} MB (twice the newest existing dump, floor {3} MB). No dump was started, so nothing was truncated. Free space, prune with -Keep, or point BACKUP_DIR at a larger volume.' -f $backupRoot, [int] ($freeBytes / 1MB), [int] ($spaceRequired / 1MB), [int] ($MinFreeBytes / 1MB)) 'destination_out_of_space'
}
else {
    Write-Host ("[backup] destination check: {0} MB free, about {1} MB required" -f [int] ($freeBytes / 1MB), [int] ($spaceRequired / 1MB))
}

# (5) Keep HR data out of version control even though backups/ cannot be listed in
# the repository .gitignore from here. A dump is a full extract of every
# employee's record and must never be committable. The repository .gitignore
# also lists backups/; this file is the second, local line of defence. Written
# with WriteAllText rather than Set-Content so no byte order mark is introduced,
# and it contains no credential of any kind.
$guard = Join-Path $backupRoot '.gitignore'
if (-not (Test-Path -LiteralPath $guard)) {
    $guardLine = "# Dumps contain the full employee record. Never commit.`n*`n"
    [System.IO.File]::WriteAllText($guard, $guardLine, [System.Text.Encoding]::ASCII)
    Write-Host "[backup] wrote $guard"
}
else {
    $guardText = ''
    try { $guardText = [System.IO.File]::ReadAllText($guard) } catch { $guardText = '' }
    if ($guardText -notmatch '(?m)^\s*\*\s*$') {
        Write-Fail ('destination {0} has a .gitignore but it does not contain ''*'', so dumps here could be committed. Restore the standard backups/.gitignore or point BACKUP_DIR somewhere else.' -f $backupRoot) 'destination_not_gitignored'
    }
}

# Refuse to overwrite. This file is named to the second; a collision means a
# run is already in flight, and silently replacing it would destroy the only
# good copy of a backup.
$fileName = '{0}-{1}.sql' -f $DbName, $stamp
$target = Join-Path $backupRoot $fileName

if (Test-Path -LiteralPath $target) {
    Write-Fail "refusing to overwrite an existing backup: $target" 'name_collision'
}

if ($PreflightOnly) {
    Write-Host '[BACKUP] Preflight only: every check above passed. No dump was taken and no dump file was created.'
    Write-Host ("[BACKUP] Preflight OK: environment={0} container={1} database={2} destination={3}" -f $BackupEnvironment, $Container, $DbName, $backupRoot)
    Write-BackupLog -Level INFO -Event BACKUP_PREFLIGHT_OK -Fields @{
        env        = $BackupEnvironment
        container  = $Container
        db         = $DbName
        db_user    = $DbUser
        dir        = $backupRoot
        elapsed_s  = [int] $stopwatch.Elapsed.TotalSeconds
    }
    exit 0
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
    Write-Fail "pg_dump exited with code $($proc.ExitCode). $errText" 'pg_dump_failed'
}

# An empty file means the dump silently produced nothing. pg_dump can exit 0 in
# some failure modes, so the size is checked rather than trusted.
if (-not (Test-Path -LiteralPath $target)) {
    Write-Fail "pg_dump exited with code 0 but wrote no file. $errText" 'no_output'
}

$size = (Get-Item -LiteralPath $target).Length
if ($size -lt 1) {
    Remove-Item -LiteralPath $target -Force
    Write-Fail 'pg_dump produced an empty file. The dump is not trustworthy.' 'empty_output'
}

Write-Host "[backup] wrote $fileName ($([math]::Round($size / 1KB, 1)) KB)"
Write-Host ("[BACKUP] Dump created: {0} ({1} KB)" -f $fileName, [math]::Round($size / 1KB, 1))

# --- Validate ---------------------------------------------------------------
# Structural validation happens before anything attests to this file. If it
# fails, the dump and any checksum are removed and this script exits non-zero:
# leaving a failed dump behind is how an incomplete file later gets restored
# into a production database.
$verifyScript = Join-Path $PSScriptRoot 'verify-backup.ps1'
if (-not (Test-Path -LiteralPath $verifyScript -PathType Leaf)) {
    Write-Fail "validator not found: $verifyScript" 'validator_missing'
}

# Absolute path to the shell, so this works when Task Scheduler starts the task
# with a minimal PATH.
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $psExe -PathType Leaf)) { $psExe = 'powershell' }

$verifyArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $verifyScript,
    '-Path', $target,
    '-DbName', $DbName,
    '-MinBytes', [string] $MinBytes
) | ForEach-Object { Quote-NativeArgument $_ }

$verifyOut = Join-Path ([System.IO.Path]::GetTempPath()) ("verify-{0}.out" -f $stamp)
$verifyErr = Join-Path ([System.IO.Path]::GetTempPath()) ("verify-{0}.err" -f $stamp)

Write-Host "[backup] validating..."
$vProc = Start-Process -FilePath $psExe -ArgumentList $verifyArgs `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $verifyOut -RedirectStandardError $verifyErr

if (Test-Path -LiteralPath $verifyOut) {
    Get-Content -LiteralPath $verifyOut | ForEach-Object { Write-Host $_ }
    Remove-Item -LiteralPath $verifyOut -Force -ErrorAction SilentlyContinue
}
$vErrText = ''
if (Test-Path -LiteralPath $verifyErr) {
    $vErrText = (Get-Content -LiteralPath $verifyErr -Raw -ErrorAction SilentlyContinue)
    Remove-Item -LiteralPath $verifyErr -Force -ErrorAction SilentlyContinue
}

if ($null -ne $vProc -and $vProc.ExitCode -ne 0) {
    # Remove the dump and any checksum sidecar. Nothing that describes an
    # invalid dump may be left on disk.
    $invalidDetail = 'validation failed'
    if ($vErrText) { $invalidDetail = $invalidDetail + ': ' + $vErrText.Trim() }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    if (Test-Path -LiteralPath "$target.sha256") { Remove-Item -LiteralPath "$target.sha256" -Force }
    Write-Fail "dump validation failed, removing the dump. $invalidDetail" 'validation_failed'
}

Write-Host "[backup] validation passed"
Write-Host '[BACKUP] Dump validation passed'

# --- Checksum ---------------------------------------------------------------
# Only now, after validation passed. Get-FileHash -Algorithm SHA256 streams the
# file through a managed hash implementation with no vectorisation, so it is
# CPU-bound at roughly a second per 100 MB; at this dump size (single-digit MB)
# that is negligible next to the pg_dump run, and SHA-256 here is for detecting
# bit rot and truncated copies rather than for resisting an attacker, so the
# correctly-named built-in API is the right trade.
$sumPath = "$target.sha256"
$sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()

# Standard sha256sum layout: 64 hex digits, two spaces, then the file NAME and
# not the full path, so that `sha256sum -c` works when run from inside the
# backup directory. The trailing newline is what sha256sum writes too.
$sumLine = $sha256 + '  ' + $fileName + "`n"
[System.IO.File]::WriteAllText($sumPath, $sumLine, [System.Text.Encoding]::ASCII)

# Read the sidecar back and compare it to what was computed. A truncated or
# partially flushed write must not leave a checksum file that looks complete.
$sumReadBack = ''
try { $sumReadBack = [System.IO.File]::ReadAllText($sumPath) } catch { $sumReadBack = '' }
if ($sumReadBack -ne $sumLine) {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    if (Test-Path -LiteralPath $sumPath) { Remove-Item -LiteralPath $sumPath -Force }
    Write-Fail 'could not write the checksum sidecar reliably; dump and checksum removed.' 'checksum_write_failed'
}

Write-Host "[backup] wrote $fileName.sha256 (sha256 $($sha256.Substring(0, 16))...)"
Write-Host ("[BACKUP] Checksum created: {0}.sha256 (sha256 {1}...)" -f $fileName, $sha256.Substring(0, 16))

# --- Prune ------------------------------------------------------------------
# Only after a verified-good dump exists AND after its checksum is written, so
# retention can never destroy the last usable backup, and so no checksum is left
# describing a dump that has been removed.
if ($Keep -lt 1) {
    # Guard, deliberately not an error. -Keep 0 or BACKUP_KEEP=0 must not be able
    # to delete every backup and leave the operator with nothing to restore: an
    # off-by-one in a wrapper script, a shell that exports an unset variable as
    # "0", or a mistyped .env line all land here. Clamping to 1 means "keep only
    # the newest", which is what "keep nothing older" was meant to say, and the
    # newest dump has just been validated a few lines above, so the clamp
    # cannot destroy the only known-good copy.
    $requestedKeep = $Keep
    $Keep = 1
    $warn = "[backup] WARNING: retention count $requestedKeep is below 1; clamping to 1. The newest backup is never deleted."
    Write-Host $warn
    Write-BackupLog -Level WARN -Event RETENTION_CLAMPED -Fields @{
        file       = $fileName
        note       = 'keep_clamped_to_1'
        keep_want  = $requestedKeep
        keep_used  = 1
        elapsed_s  = [int] $stopwatch.Elapsed.TotalSeconds
    }
}

$all = @(Get-ChildItem -LiteralPath $backupRoot -Filter "$DbName-*.sql" -File |
    Sort-Object -Property Name -Descending)

$pruned = 0

# Sort-Object -Descending on the filename sorts lexically, and the filename
# carries a yyyyMMdd-HHmmss stamp, so index 0 is always the newest dump. The
# loop below starts at index $Keep AND skips index 0 explicitly: the skip is
# unreachable while $Keep >= 1, and it is here so that no future edit to the
# clamp above can turn an off-by-one into "delete every backup".
for ($i = $Keep; $i -lt $all.Count; $i++) {
    if ($i -eq 0) {
        Write-BackupLog -Level WARN -Event RETENTION_GUARD -Fields @{
            file      = $all[$i].Name
            note      = 'refused_to_delete_newest'
            keep      = $Keep
            elapsed_s = [int] $stopwatch.Elapsed.TotalSeconds
        }
        continue
    }

    $old = $all[$i]

    if (-not (Test-PathIsInsideBackupRoot -FullPath $old.FullName -BackupRoot $backupRoot)) {
        Write-Host "[backup] REFUSING to delete $($old.FullName): it is not directly inside $backupRoot"
        Write-BackupLog -Level ERROR -Event BACKUP_FAILED -Fields @{
            phase      = 'prune'
            reason     = 'outside_backup_dir'
            file       = $old.Name
            detail     = $old.FullName
            elapsed_s  = [int] $stopwatch.Elapsed.TotalSeconds
        }
        continue
    }

    Remove-Item -LiteralPath $old.FullName -Force
    $pruned++
    Write-Host "[backup] pruned $($old.Name)"
    Write-BackupLog -Level INFO -Event RETENTION_PRUNED -Fields @{
        kind      = 'dump'
        file      = $old.Name
        bytes     = $old.Length
        keep      = $Keep
        reason    = 'retention'
        elapsed_s = [int] $stopwatch.Elapsed.TotalSeconds
    }

    # The sidecar must go with the dump it describes, in the same pass.
    $oldSum = "$($old.FullName).sha256"
    if (Test-Path -LiteralPath $oldSum -PathType Leaf) {
        Remove-Item -LiteralPath $oldSum -Force
        Write-BackupLog -Level INFO -Event RETENTION_PRUNED -Fields @{
            kind      = 'checksum'
            file      = (Split-Path -Leaf $oldSum)
            reason    = 'dump_pruned'
            elapsed_s = [int] $stopwatch.Elapsed.TotalSeconds
        }
    }
}

# Orphaned checksums. If a prune was interrupted, or a dump was removed by hand
# or by a failed run, a <dump>.sql.sha256 can outlive its <dump>.sql. That is
# worse than useless: the sidecar is an attestation, and an attestation for a
# file that no longer exists reads to an operator as "this backup is intact".
$orphans = @(Get-ChildItem -LiteralPath $backupRoot -Filter '*.sha256' -File)
foreach ($sum in $orphans) {
    $sumPathCandidate = $sum.FullName
    $dumpPathCandidate = $sumPathCandidate.Substring(0, $sumPathCandidate.Length - '.sha256'.Length)

    if (Test-Path -LiteralPath $dumpPathCandidate -PathType Leaf) { continue }

    if (-not (Test-PathIsInsideBackupRoot -FullPath $sumPathCandidate -BackupRoot $backupRoot)) {
        Write-BackupLog -Level ERROR -Event BACKUP_FAILED -Fields @{
            phase      = 'prune'
            reason     = 'outside_backup_dir'
            file       = $sum.Name
            detail     = $sum.FullName
            elapsed_s = [int] $stopwatch.Elapsed.TotalSeconds
        }
        continue
    }

    Remove-Item -LiteralPath $sumPathCandidate -Force
    Write-Host "[backup] pruned orphaned checksum $($sum.Name)"
    Write-BackupLog -Level INFO -Event RETENTION_PRUNED -Fields @{
        kind      = 'checksum'
        file      = $sum.Name
        reason    = 'orphaned_checksum'
        elapsed_s = [int] $stopwatch.Elapsed.TotalSeconds
    }
}

$retained = $all.Count - $pruned
Write-Host "[backup] complete. $pruned file(s) pruned; $retained retained."
Write-Host ("[BACKUP] Backup completed successfully: {0} file(s) pruned, {1} retained in {2}" -f $pruned, $retained, $backupRoot)
Write-BackupLog -Level INFO -Event BACKUP_COMPLETED -Fields @{
    file       = $fileName
    env        = $BackupEnvironment
    container  = $Container
    db         = $DbName
    db_user    = $DbUser
    bytes      = $size
    sha256     = $sha256
    keep       = $Keep
    keep_from  = $keepSetting.Source
    pruned     = $pruned
    retained   = $retained
    elapsed_s  = [int] $stopwatch.Elapsed.TotalSeconds
}
exit 0
