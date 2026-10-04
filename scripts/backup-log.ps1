<#
.SYNOPSIS
    Shared, machine-greppable log writer for the HRMS backup scripts.

.DESCRIPTION
    One line per event, in a fixed order, so that a monitoring script can split
    on spaces and read fields by name instead of parsing prose:

      <UTC ISO-8601>Z level=<LEVEL> event=<EVENT> key=value key=value

    For example:

      2026-10-04T02:00:03Z level=INFO event=BACKUP_COMPLETED file=hr_system-20261004-020003.sql bytes=3695300 elapsed_s=4

    The four lifecycle event names that the backup pipeline must emit exactly are
      BACKUP_STARTED
      BACKUP_COMPLETED
      BACKUP_FAILED
      BACKUP_VERIFIED
    Two administrative event names are also emitted, for operations that are not
    themselves a backup: RETENTION_PRUNED, RETENTION_CLAMPED, RETENTION_GUARD,
    TASK_REGISTERED, TASK_REGISTER_FAILED, TASK_REGISTER_DRYRUN,
    TASK_UNREGISTERED and TASK_UNREGISTER_FAILED. They are additive: a consumer
    that greps for the four backup names is unaffected by them.

    Destination: logs/backup.log relative to the repository root, overridable
    with the BACKUP_LOG_FILE environment variable. The directory is created on
    demand and the whole directory is git-ignored, because log lines name dump
    files and must not become committed history.

    Logging is deliberately best-effort. A backup must not fail because a log
    file could not be written, so every write is wrapped and failures degrade to
    a stderr warning rather than a terminating error.

    USAGE (dot-source; this file defines functions and does nothing on its own):

      . (Join-Path $PSScriptRoot 'backup-log.ps1')
      Write-BackupLog -Level INFO -Event BACKUP_STARTED -Fields @{ container = 'hr-postgres' }

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.
#>

# Resolved once at dot-source time. $PSScriptRoot inside a dot-sourced file is
# the directory of that file, so this is always <repo>\scripts and never the
# caller's working directory.
$script:BackupLogRepoRoot = Split-Path -Parent $PSScriptRoot

function Get-BackupLogPath {
<#
.SYNOPSIS
    Absolute path of the shared backup log file.
.DESCRIPTION
    BACKUP_LOG_FILE wins if it is set; otherwise logs/backup.log under the
    repository root. Always returns a full path so callers never depend on the
    current working directory.
#>
    [CmdletBinding()]
    param()

    $configured = [Environment]::GetEnvironmentVariable('BACKUP_LOG_FILE')
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        return [System.IO.Path]::GetFullPath($configured)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $script:BackupLogRepoRoot 'logs\backup.log'))
}

function Format-BackupLogValue {
<#
.SYNOPSIS
    Reduce a value to a single whitespace-free token.
.DESCRIPTION
    A log line is split on spaces by consumers, so a value containing a space,
    a quote or an equals sign would silently shift every following field onto
    the wrong key. Collapsing whitespace and dropping quotes and equals signs
    keeps the field positions valid even when a value is a path or an error
    message.
#>
    [CmdletBinding()]
    param([object] $Value)

    if ($null -eq $Value) { return '-' }
    $text = [string] $Value
    $text = $text -replace '\s+', '_'
    $text = $text -replace '["''=]', '_'
    if ([string]::IsNullOrEmpty($text)) { return '-' }
    return $text
}

function Write-BackupLog {
<#
.SYNOPSIS
    Append one timestamped, greppable line to logs/backup.log.
.DESCRIPTION
    Never throws and never writes a secret: only the field names and values the
    caller passes are recorded, so callers must not pass credentials. No script
    in this repository puts a password on a command line, and nothing here logs
    one.
.PARAMETER Level
    DEBUG, INFO, WARN or ERROR.
.PARAMETER Event
    Event name, for example BACKUP_COMPLETED.
.PARAMETER Fields
    Ordered dictionary of extra key=value pairs. Keys are emitted in insertion
    order. A key is prefixed with any underscore already in the name, so use
    plain names such as 'file', 'bytes', 'elapsed_s'.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('DEBUG', 'INFO', 'WARN', 'ERROR')]
        [string] $Level,

        [Parameter(Mandatory = $true)]
        [string] $Event,

        [hashtable] $Fields = @{}
    )

    try {
        $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

        $parts = New-Object System.Collections.Generic.List[string]
        [void] $parts.Add($stamp)
        [void] $parts.Add("level=$Level")
        [void] $parts.Add("event=$Event")

        foreach ($key in $Fields.Keys) {
            $safeKey = ($key -replace '\s+', '_')
            $safeKey = ($safeKey -replace '["''=]', '_')
            if ([string]::IsNullOrEmpty($safeKey)) { continue }
            [void] $parts.Add(("{0}={1}" -f $safeKey, (Format-BackupLogValue $Fields[$key])))
        }

        $line = ($parts -join ' ') + [Environment]::NewLine

        $logPath = Get-BackupLogPath
        $logDir = Split-Path -Parent $logPath
        if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
            New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        }

        # AppendAllText with Encoding.ASCII appends no preamble, so the file
        # never acquires a BOM and never grows one mid-write.
        [System.IO.File]::AppendAllText($logPath, $line, [System.Text.Encoding]::ASCII)
    }
    catch {
        # Best effort by design: never let logging take down a backup.
        Write-Warning ("backup-log: could not write log line for event '$Event': " + $_.Exception.Message)
    }
}
