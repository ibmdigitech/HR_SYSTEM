<#
.SYNOPSIS
    Off-host backup transfer for the HR database.

.DESCRIPTION
    Copies the newest verified dump, plus its .sha256 sidecar, to a destination
    on another host or another disk, verifies the copy after transfer, and
    records the result so backup-health.ps1 can report off-site status without
    scanning a remote share.

    THIS IS A TRANSFER STEP, NOT A BACKUP MECHANISM
    ----------------------------------------------
    It creates nothing. It moves what scripts\backup.ps1 already produced. If it
    is not configured it does nothing and says so, so the nightly backup run is
    unaffected by its absence. There is exactly one backup mechanism in this
    repo; this file is a courier for it.

    THE ONE THING THIS SCRIPT MUST NEVER DO
    ----------------------------------------
    When it is not configured it must print no line that could be read as "the
    backups are protected", because an operator scanning a nightly log will see
    a green line and stop thinking. It prints exactly one line in that case:

        OFFSITE BACKUP: NOT CONFIGURED

    and exits 3. To enable it, set OFFSITE_BACKUP_PATH to the destination
    directory and OFFSITE_BACKUP_ENABLED to 1.

    PROVIDERS
    ---------
    OFFSITE_BACKUP_PROVIDER selects the implementation. Only 'filesystem' (alias
    'local') exists today, because that is the only destination this project can
    actually support and test: a different disk, or a UNC network share such as
    \\fileserver\backups$\hr-system. Anything the compose file does not define
    cannot be tested here, and untested backup code is worse than none.

    FUTURE PROVIDERS: add one function per provider, each with this signature,

        function Send-ViaS3 { param($Source, $DestinationRoot, $Metadata) ... }

    and one case in Invoke-OffsiteProvider. Nothing else changes. The dispatch,
    the checksum verification, the status sidecar and the exit codes are all
    provider-agnostic, so a new provider cannot quietly skip verification.

    CREDENTIALS
    -----------
    The filesystem provider needs none: it is a file copy, and Windows
    authentication is handled by the share itself.

    For a future provider, credentials are read from ENVIRONMENT VARIABLES
    ONLY, for example OFFSITE_S3_ACCESS_KEY_ID and OFFSITE_S3_SECRET_ACCESS_KEY.
    They are never accepted as a parameter. A parameter value is visible in Task
    Scheduler's history and in the process list to every user on the host, so a
    -SecretAccessKey parameter would leak the secret into two places it cannot
    be removed from. Environment variables are also wrong for a literal secret;
    the long-term answer is a managed identity or a workload identity, and the
    environment is the interim step that keeps the secret out of git, out of the
    command line and out of this file. Never write a real key into .env, into
    .env.example, into this script or into any log line.

    LOG LINES (for a monitoring keyword rule)
    ------------------------------------------
        BACKUP_OFFSITE_UPLOADED   transfer completed and the copy's checksum
                                  matched the source
        BACKUP_OFFSITE_FAILED     transfer or verification failed; nothing is
                                  being protected off-host as a result
        OFFSITE BACKUP: NOT CONFIGURED
                                  not configured; no claim of protection

    EXIT CODES
    -----------
      0  uploaded and verified
      1  warning, e.g. configured but disabled, or uploaded an unverified dump
      2  failure; BACKUP_OFFSITE_FAILED was logged
      3  not configured, or configured but disabled; nothing was attempted

    Codes 0/1/2 are the project's standard. 3 is a distinct code because
    "off-site was never turned on" is neither healthy nor a fault of this run:
    callers chaining it after backup.ps1 must be able to ignore it without also
    swallowing a real failure.

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\offsite-backup.ps1

.EXAMPLE
    $env:OFFSITE_BACKUP_ENABLED = '1'
    $env:OFFSITE_BACKUP_PATH = '\\fileserver\backups$\hr-system'
    $env:OFFSITE_BACKUP_PROVIDER = 'filesystem'
    powershell -ExecutionPolicy Bypass -File .\scripts\offsite-backup.ps1

.EXAMPLE
    # Test against a scratch directory on this host
    $env:OFFSITE_BACKUP_ENABLED = '1'
    $env:OFFSITE_BACKUP_PATH = "$env:TEMP\hrms-offsite-test"
    powershell -ExecutionPolicy Bypass -File .\scripts\offsite-backup.ps1 -BackupDir .\backups
#>

[CmdletBinding()]
param(
    # Resolved in the body, not here: under Windows PowerShell 5.1 $PSScriptRoot
    # is empty inside a param() default.
    [string] $BackupDir = '',

    # Override for OFFSITE_BACKUP_PATH. A path is not a secret, so a parameter
    # is acceptable here; a credential would never be.
    [string] $Destination = '',

    # 'filesystem' (alias 'local'). See .DESCRIPTION for the extension point.
    [string] $Provider = '',

    # OFFSITE_BACKUP_ENABLED=0 forces this off even when a destination is set,
    # which is how a destination can be staged and tested before it is trusted.
    [switch] $Disabled
)

$ErrorActionPreference = 'Stop'

$EXIT_OK = 0
$EXIT_WARNING = 1
$EXIT_FAILURE = 2
$EXIT_NOT_CONFIGURED = 3

$STATUS_SIDECAR = '.offsite-status.json'

function Write-Line {
    param([string] $Message)
    Write-Host $Message
}

function Write-Failed {
    param([string] $Message)
    Write-Line ("BACKUP_OFFSITE_FAILED " + $Message)
}

function Get-Setting {
    param([string] $ParameterValue, [string] $EnvName, [string] $Default)
    if (-not [string]::IsNullOrWhiteSpace($ParameterValue)) { return $ParameterValue }
    $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) { return $fromEnv.Trim() }
    return $Default
}

function Get-IsEnabled {
    param([string] $Value)
    if ($null -eq $Value) { return $false }
    switch ($Value.Trim().ToLowerInvariant()) {
        '1'    { return $true }
        'true' { return $true }
        'yes'  { return $true }
        'on'   { return $true }
        default { return $false }
    }
}

function Get-IntSetting {
    param([string] $EnvName, [int] $Default)
    $raw = [Environment]::GetEnvironmentVariable($EnvName)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $parsed = 0
    if ([int]::TryParse($raw.Trim(), [ref] $parsed)) { return $parsed }
    return $Default
}

function Get-HashHex {
    param([string] $Path)
    $h = Get-FileHash -LiteralPath $Path -Algorithm SHA256
    return $h.Hash.ToLowerInvariant()
}

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

# --- Configuration -----------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
    $BackupDir = Join-Path $PSScriptRoot '..\backups'
}
$backupRoot = [System.IO.Path]::GetFullPath($BackupDir)
$DbName = Get-Setting -ParameterValue '' -EnvName 'BACKUP_DB_NAME' -Default 'hr_system'

$destinationRaw = Get-Setting -ParameterValue $Destination -EnvName 'OFFSITE_BACKUP_PATH' -Default ''
$provider = (Get-Setting -ParameterValue $Provider -EnvName 'OFFSITE_BACKUP_PROVIDER' -Default 'filesystem').ToLowerInvariant()
$enabledRaw = [Environment]::GetEnvironmentVariable('OFFSITE_BACKUP_ENABLED')

# Not configured. This is the acceptance-critical path: one line, no hint of
# protection, a distinct exit code, and absolutely no side effect, so chaining
# this after backup.ps1 is always safe.
if ([string]::IsNullOrWhiteSpace($destinationRaw)) {
    Write-Line 'OFFSITE BACKUP: NOT CONFIGURED'
    exit $EXIT_NOT_CONFIGURED
}

if ($Disabled -or -not (Get-IsEnabled $enabledRaw)) {
    # Configured but switched off is a different, honest state: an operator has
    # set a destination but not turned the transfer on. It still implies no
    # protection, so it does not claim any.
    Write-Line 'OFFSITE BACKUP: DISABLED'
    Write-Line ("OFFSITE_BACKUP_ENABLED is not truthy. Destination was ignored: " + $destinationRaw.Trim())
    exit $EXIT_NOT_CONFIGURED
}

$destinationRoot = $destinationRaw.Trim()

# --- Provider dispatch -------------------------------------------------------
# Every provider takes the same arguments and must return
# @{ FilePath; FileName; Sha256; Detail }. Verification, the status sidecar and
# the exit codes live above and below this dispatch, so a new provider cannot
# opt out of them.

function Send-ViaFilesystem {
    param([string] $Source, [string] $DestinationRoot, [hashtable] $Metadata)

    $result = @{ FilePath = $null; FileName = $null; Sha256 = ''; Detail = '' }

    if (-not (Test-Path -LiteralPath $DestinationRoot -PathType Container)) {
        try {
            New-Item -ItemType Directory -Path $DestinationRoot -Force -ErrorAction Stop | Out-Null
        } catch {
            $result.Detail = ("cannot create the destination directory '" + $DestinationRoot + "': " + $_.Exception.Message)
            return $result
        }
    }

    $fileName = (Split-Path -Leaf $Source)
    $target = Join-Path $DestinationRoot $fileName

    try {
        Copy-Item -LiteralPath $Source -Destination $target -Force -ErrorAction Stop
    } catch {
        $result.Detail = ("copy of '" + $fileName + "' to '" + $DestinationRoot + "' failed: " + $_.Exception.Message)
        return $result
    }

    $result.FilePath = $target
    $result.FileName = $fileName
    return $result
}

function Invoke-OffsiteProvider {
    param([string] $ProviderName, [string] $Source, [string] $DestinationRoot, [hashtable] $Metadata)

    switch ($ProviderName) {
        'filesystem' { return Send-ViaFilesystem -Source $Source -DestinationRoot $DestinationRoot -Metadata $Metadata }
        'local'      { return Send-ViaFilesystem -Source $Source -DestinationRoot $DestinationRoot -Metadata $Metadata }
        # 's3'         { return Send-ViaS3       -Source $Source -DestinationRoot $DestinationRoot -Metadata $Metadata }
        # 'azureblob'  { return Send-ViaAzureBlob -Source $Source -DestinationRoot $DestinationRoot -Metadata $Metadata }
        # 'onedrive'   { return Send-ViaOneDrive  -Source $Source -DestinationRoot $DestinationRoot -Metadata $Metadata }
        default {
            return @{
                FilePath = $null
                FileName = $null
                Sha256   = ''
                Detail   = ("unsupported OFFSITE_BACKUP_PROVIDER '" + $ProviderName + "'. Supported today: filesystem (alias local).")
            }
        }
    }
}

# --- Source selection --------------------------------------------------------
Write-Line ("offsite-backup.ps1: provider=$provider source=$backupRoot destination=$destinationRoot")

if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    Write-Failed ("the backup directory '" + $backupRoot + "' does not exist, so there is nothing to transfer. Run scripts\backup.ps1 first.")
    exit $EXIT_FAILURE
}

$sourceDump = Get-ChildItem -LiteralPath $backupRoot -Filter "$DbName-*.sql" -File -ErrorAction SilentlyContinue |
    Sort-Object -Property @{ Expression = 'LastWriteTimeUtc'; Descending = $true }, @{ Expression = 'Name'; Descending = $true } |
    Select-Object -First 1

if ($null -eq $sourceDump) {
    Write-Failed ("no $DbName-*.sql dump in " + $backupRoot + ". Nothing was transferred.")
    exit $EXIT_FAILURE
}

# Verify before copying. The off-host copy is the disaster-recovery copy, so
# propagating a corrupt dump there is worse than having no off-host copy at
# all: it is a copy that looks protected. verify-backup.ps1 is owned by other
# tooling; when it is absent the transfer proceeds on the recorded checksum,
# and says so, because failing the nightly backup over a missing verifier would
# be worse still.
$verifyScript = Join-Path $PSScriptRoot 'verify-backup.ps1'
$verifiedUpstream = $false
if (Test-Path -LiteralPath $verifyScript -PathType Leaf) {
    $verifyText = ''
    try { $verifyText = Get-Content -LiteralPath $verifyScript -Raw -ErrorAction Stop } catch { $verifyText = '' }
    $verifyParam = ''
    foreach ($candidate in @('Path', 'BackupPath', 'BackupFile', 'DumpPath', 'File')) {
        if ($verifyText -match ('\$(?:' + $candidate + ')\b')) { $verifyParam = $candidate; break }
    }
    if ([string]::IsNullOrWhiteSpace($verifyParam)) { $verifyParam = 'Path' }

    $verifyRun = Invoke-Native -FilePath 'powershell.exe' -Arguments @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $verifyScript,
        ('-' + $verifyParam), $sourceDump.FullName
    )
    if ($verifyRun.Output -match 'A parameter cannot be found that matches parameter name' -or
        $verifyRun.Output -match 'Missing an argument for parameter') {
        Write-Line ("offsite-backup.ps1: WARNING verify-backup.ps1 does not accept -" + $verifyParam + ", so the source dump could not be verified before transfer.")
    } elseif ($verifyRun.ExitCode -eq 0) {
        $verifiedUpstream = $true
        Write-Line ("offsite-backup.ps1: source verified by verify-backup.ps1 (" + $sourceDump.Name + ")")
    } else {
        Write-Failed ("verify-backup.ps1 rejected the newest dump (" + $sourceDump.Name + ", exit " + $verifyRun.ExitCode + "). Nothing was transferred, because a corrupt off-host copy is worse than no off-host copy. Output: " + $verifyRun.Output)
        exit $EXIT_FAILURE
    }
} else {
    Write-Line 'offsite-backup.ps1: WARNING scripts\verify-backup.ps1 is not present, so the source dump was NOT verified before transfer. Integrity is re-checked against the recorded checksum after the copy.'
}

$sourceHash = ''
try {
    $sourceHash = Get-HashHex -Path $sourceDump.FullName
} catch {
    Write-Failed ('cannot read the source dump to hash it: ' + $_.Exception.Message)
    exit $EXIT_FAILURE
}

# The sidecar, when one exists, must agree with the dump. A disagreement means
# the local dump is already corrupt, so this is a failure rather than a warning.
$sidecarSource = ($sourceDump.FullName + '.sha256')
$sidecarTarget = $null
if (Test-Path -LiteralPath $sidecarSource -PathType Leaf) {
    $sidecarTarget = (Split-Path -Leaf $sidecarSource)
    $sidecarText = ''
    try { $sidecarText = (Get-Content -LiteralPath $sidecarSource -Raw -ErrorAction Stop) } catch { $sidecarText = '' }
    $recorded = ''
    if ($sidecarText -match '([0-9a-fA-F]{64})') { $recorded = $matches[1].ToLowerInvariant() }
    if ([string]::IsNullOrWhiteSpace($recorded)) {
        Write-Failed ('the .sha256 sidecar ' + $sidecarTarget + ' contains no 64 character hex digest. Nothing was transferred.')
        exit $EXIT_FAILURE
    }
    if ($recorded -ne $sourceHash) {
        Write-Failed ('the local dump does not match its own .sha256 sidecar. sidecar=' + $recorded.Substring(0, 16) + '... actual=' + $sourceHash.Substring(0, 16) + '... Nothing was transferred.')
        exit $EXIT_FAILURE
    }
} else {
    Write-Line ('offsite-backup.ps1: WARNING no .sha256 sidecar for ' + $sourceDump.Name + '; only the dump itself will be transferred.')
}

$metadata = @{
    Provider      = $provider
    DbName        = $DbName
    Container     = [Environment]::GetEnvironmentVariable('BACKUP_CONTAINER')
    SourcePath    = $sourceDump.FullName
    SourceSize    = [int64] $sourceDump.Length
    Verified      = $verifiedUpstream
}

# --- Transfer ----------------------------------------------------------------
$transfer = Invoke-OffsiteProvider -ProviderName $provider -Source $sourceDump.FullName -DestinationRoot $destinationRoot -Metadata $metadata

if ([string]::IsNullOrWhiteSpace($transfer.FilePath)) {
    Write-Failed $transfer.Detail
    exit $EXIT_FAILURE
}

Write-Line ("offsite-backup.ps1: copied " + $sourceDump.Name + " (" + $sourceDump.Length + " bytes)")

# --- Sidecar transfer --------------------------------------------------------
if ($null -ne $sidecarTarget) {
    $sidecarDestination = Join-Path $destinationRoot $sidecarTarget
    try {
        Copy-Item -LiteralPath $sidecarSource -Destination $sidecarDestination -Force -ErrorAction Stop
        Write-Line ("offsite-backup.ps1: copied " + $sidecarTarget)
    } catch {
        Write-Failed ('the dump was copied but its .sha256 sidecar could not be: ' + $_.Exception.Message)
        exit $EXIT_FAILURE
    }
}

# --- Post-transfer verification ----------------------------------------------
# Never trust a transfer that has not been re-read. A copy that succeeds and
# lands truncated is the failure mode this check exists for, and it is silent.
$destinationHash = ''
try {
    $destinationHash = Get-HashHex -Path $transfer.FilePath
} catch {
    Write-Failed ('the transferred file could not be read back for verification: ' + $_.Exception.Message)
    exit $EXIT_FAILURE
}

if ($destinationHash -ne $sourceHash) {
    try {
        Remove-Item -LiteralPath $transfer.FilePath -Force -ErrorAction Stop
        Write-Failed ('post-transfer checksum mismatch: source sha256=' + $sourceHash + ' destination sha256=' + $destinationHash + '. The corrupt copy was deleted rather than left where a restore could find it and trust it.')
    } catch {
        Write-Failed ('post-transfer checksum mismatch: source sha256=' + $sourceHash + ' destination sha256=' + $destinationHash + '. The corrupt copy at ' + $transfer.FilePath + ' could NOT be deleted, so remove it by hand.')
    }
    exit $EXIT_FAILURE
}

Write-Line ("offsite-backup.ps1: checksum verified after transfer sha256=" + $destinationHash)

# --- Status sidecar ----------------------------------------------------------
# Written only after verification passed, so its presence always means "a
# complete, checksum-verified copy exists at this destination". That is what
# lets backup-health.ps1 report the last successful upload without walking a
# network share.
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$statusPayload = [ordered]@{
    schemaVersion    = 1
    status           = 'OK'
    provider         = $provider
    fileName         = $transfer.FileName
    sha256           = $destinationHash
    sizeBytes        = [int64] (Get-Item -LiteralPath $transfer.FilePath).Length
    sourcePath       = $sourceDump.FullName
    sourceVerified   = $verifiedUpstream
    sidecarCopied    = ($null -ne $sidecarTarget)
    lastUploadTime   = $now
    uploadedBy       = 'offsite-backup.ps1'
}
$statusPath = Join-Path $destinationRoot $STATUS_SIDECAR
try {
    # UTF8 without a BOM: this file is read by ConvertFrom-Json and by humans,
    # and its content is pure ASCII, so a BOM is pure noise. This is a data
    # file, not PowerShell source.
    $json = $statusPayload | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($statusPath, $json, (New-Object System.Text.UTF8Encoding($false)))
} catch {
    # The data is already transferred and verified at this point. Failing the
    # whole run over the receipt would be a false alarm, so warn and still
    # report success: backup-health.ps1 will fall back to reporting no recorded
    # upload, which is the conservative direction.
    Write-Line ('offsite-backup.ps1: WARNING the transfer succeeded but the status sidecar could not be written: ' + $_.Exception.Message)
}

Write-Line ("BACKUP_OFFSITE_UPLOADED provider=" + $provider + " destination=" + $destinationRoot + " file=" + $transfer.FileName + " sha256=" + $destinationHash)
Write-Line ("offsite-backup.ps1: complete. status recorded in " + $statusPath)

if (-not $verifiedUpstream) {
    Write-Line 'offsite-backup.ps1: WARNING the source dump was not verified by scripts\verify-backup.ps1 (it is not installed); only the post-transfer checksum match is guaranteed.'
    exit $EXIT_WARNING
}

exit $EXIT_OK