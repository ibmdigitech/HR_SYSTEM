<#
.SYNOPSIS
    Removes a scheduled task created by scripts/register-backup-task.ps1.

.DESCRIPTION
    Deletes exactly one task, named by -TaskName (default HRMS-Backup).

    This script never enumerates the task scheduler and never touches a task it
    was not asked about. Get-ScheduledTask is always called with an explicit
    -TaskName, so the set of tasks it can possibly see is a single name, and the
    task it is about to remove is re-checked by name before removal. There is no
    "clean up old backup tasks" loop here, and there must not be one: a loop over
    Get-ScheduledTask would put every task on the host, including unrelated
    system and third-party tasks, one careless -Force away from being deleted.

    If the task does not exist the script stops with exit 1 and changes nothing,
    so a typo in -TaskName cannot be mistaken for a successful removal. -Force
    overrides that refusal for scripted teardown, where "already gone" is the
    desired end state.

    Elevation is required: removing a task from the Task Scheduler store needs
    an elevated token, and the failure without one is an opaque access-denied.

.PARAMETER TaskName
    The single task to remove. Defaults to HRMS-Backup.
.PARAMETER Force
    Do not fail when the task does not exist.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\unregister-backup-task.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\unregister-backup-task.ps1 -TaskName HRMS-Backup-Old -Force

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.
#>

[CmdletBinding()]
param(
    [string] $TaskName = 'HRMS-Backup',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

$logModule = Join-Path $PSScriptRoot 'backup-log.ps1'
if (-not (Test-Path -LiteralPath $logModule -PathType Leaf)) {
    Write-Error "unregister-backup-task.ps1: missing required helper '$logModule'."
    exit 1
}
. $logModule

function Write-Fail {
    param([string] $Message, [string] $Reason = 'error')

    Write-BackupLog -Level ERROR -Event TASK_UNREGISTER_FAILED -Fields @{
        task    = $TaskName
        reason  = $Reason
        detail  = $Message
        forced  = [string] $Force.IsPresent
    }

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { Write-Error "unregister-backup-task.ps1: $Message" }
    finally { $ErrorActionPreference = $previous }

    exit 1
}

# --- Look up exactly one task ------------------------------------------------
# Read-only and scoped to one name, so it works without elevation. The lookup
# deliberately comes BEFORE the elevation check: if the task does not exist
# there is nothing to remove, and "you are not elevated" would be a misleading
# answer to "I typed the name wrong". Name resolution before privilege is also
# what makes both absence branches reachable without an Administrator session.
#
# Note the -TaskName argument: this is the line that keeps the blast radius at
# one task. Do not "simplify" it into a bare Get-ScheduledTask.
if ([string]::IsNullOrWhiteSpace($TaskName)) {
    Write-Fail '-TaskName must not be empty. This script removes exactly one task by name and will not guess which.' 'empty_task_name'
}

$existing = $null
try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
catch {
    Write-Fail "could not read task '$TaskName': $($_.Exception.Message)" 'query_failed'
}

$matches = @($existing | Where-Object { $null -ne $_ })

if ($matches.Count -eq 0) {
    if ($Force) {
        Write-Host "[unregister] task '$TaskName' does not exist. -Force was given, so this is treated as already done. Nothing was changed."
        Write-BackupLog -Level INFO -Event TASK_UNREGISTERED -Fields @{
            task    = $TaskName
            status  = 'ALREADY_ABSENT'
            forced  = [string] $Force.IsPresent
        }
        exit 0
    }
    Write-Fail "task '$TaskName' does not exist, so nothing was removed. Re-run with -Force if 'already absent' is the outcome you want." 'task_not_found'
}

# --- Elevation ---------------------------------------------------------------
# Checked here rather than being discovered as "access denied" inside
# Unregister-ScheduledTask, where the message names neither the cause nor the fix.
$isElevated = $false
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
catch {
    $isElevated = $false
}

if (-not $isElevated) {
    Write-Fail "task '$TaskName' exists, but this PowerShell session is not elevated. Removing a scheduled task needs an Administrator PowerShell." 'not_elevated'
}

# Belt and braces: only unregister a task whose own name matches, so a broader
# query result than expected cannot become a wildcard deletion.
foreach ($task in $matches) {
    if ([string]$task.TaskName -ine $TaskName) {
        Write-Fail "refusing to remove task '$($task.TaskName)': it does not match -TaskName '$TaskName'." 'name_mismatch'
    }
}

$stateBefore = ($matches | Select-Object -First 1).State

try {
    foreach ($task in $matches) {
        Unregister-ScheduledTask -TaskName $task.TaskName -Confirm:$false
    }
}
catch {
    Write-Fail "Unregister-ScheduledTask failed: $($_.Exception.Message)" 'unregister_failed'
}

Write-Host "[unregister] removed task '$TaskName' (was $stateBefore)."
Write-BackupLog -Level INFO -Event TASK_UNREGISTERED -Fields @{
    task     = $TaskName
    status   = 'REMOVED'
    previous = [string] $stateBefore
    elevated = $isElevated
}

exit 0
