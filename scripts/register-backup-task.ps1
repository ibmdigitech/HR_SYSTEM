<#
.SYNOPSIS
    Installs or updates the nightly HR database backup task in Windows Task Scheduler.

.DESCRIPTION
    Registers one scheduled task that runs scripts/backup.ps1 every day at 02:00.

    Duplicate safety is provided by Register-ScheduledTask -Force and by
    everything this script does NOT do: there is no second task name, no
    wrapper batch file, no "HRMS-Backup-old" alias and no manual unregister
    step. -Force updates the existing definition in place, so running this
    script twice leaves exactly one task, not two. That is the whole
    anti-duplication mechanism, and this script deliberately adds no second
    mechanism on top of it, because two mechanisms to keep in agreement is one
    too many.

    The script still reports what it is about to do, explicitly, before it does
    it:

      CREATED  no task with this name existed; a new task was registered
      UPDATED  a task with this name existed with a different definition and
               was re-registered to match this script's parameters
      UNCHANGED a task with this name already exists and its action, trigger
               and retention already match, so it is left completely alone and
               no registration call is made
      DRYRUN   -DryRun was given: nothing was read for modification and nothing
               was registered

    ELEVATION: THIS SCRIPT NEVER ELEVATES ITSELF
    ----------------------------------------------
    There is no Start-Process -Verb RunAs, no UAC prompt, no self-relaunch, and
    none may be added. A script that silently throws a UAC dialog at somebody
    who is running a scheduled-task installer from a script, a service or a
    remote session is a script that can hang, be blocked by policy, or be
    clicked through by an operator who did not read what it was asking for.

    So the rule is: detect, stop, and hand the operator the exact command. The
    unelevated path prints the precise powershell invocation, with absolute
    paths, that would install the task, plus the command that verifies the
    result afterwards. The operator pastes it into a terminal they opened as
    Administrator themselves, which keeps the decision, the consent dialog and
    the audit trail in their hands.

    Every message below is written so that a reader can tell whether anything
    actually happened. "Scheduling is installed" is never printed unless
    Register-ScheduledTask returned, and the unelevated path never prints a
    success line at all.

    Elevation is detected with WindowsPrincipal / WindowsBuiltInRole
    Administrator, which is the same check Task Scheduler itself uses to decide
    who may write to its store.

    Paths are resolved from $PSScriptRoot to absolute paths, never from the
    caller's working directory, because the registered action runs long after
    this script exits and from a different directory. The target script is
    verified to exist before anything is registered, so a task that runs a
    missing file cannot be created.

    Retention: -Keep is no longer baked into the registered action by default.
    An explicit -Keep is still appended when supplied, but with no -Keep the
    scheduled run leaves the choice to backup.ps1 itself, which resolves it as
    parameter > BACKUP_KEEP > its own default. Baking -Keep 14 into the action
    would silently override BACKUP_KEEP on the production host every night.

    ENVIRONMENT TARGETING IS NOT BAKED IN, EITHER
    ---------------------------------------------
    The registered action carries no -Container and no -Environment, so
    BACKUP_ENV and BACKUP_CONTAINER decide at run time exactly as they do for a
    manual run. Baking either one in here would pin the nightly job to one
    database regardless of what the host is later configured to protect.

.PARAMETER TaskName
    Task to create or update. Defaults to HRMS-Backup.
.PARAMETER BackupScript
    Script the task runs. Defaults to backup.ps1 next to this file. Resolved to
    an absolute path.
.PARAMETER Time
    Daily run time, 24-hour HH:mm. Defaults to 02:00.
.PARAMETER Keep
    Retention count baked into the registered command line. Omit to let
    backup.ps1 resolve BACKUP_KEEP at run time.
.PARAMETER DryRun
    Print exactly what would be registered and exit 0 without touching Task
    Scheduler. Elevation is not required for a dry run.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -DryRun

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

    # Left empty on purpose. Under Windows PowerShell 5.1 $PSScriptRoot is empty
    # inside a param() default, so a `Join-Path $PSScriptRoot ...` default would
    # throw before the script ran. Resolved in the body instead.
    [string] $BackupScript = '',

    [string] $Time = '02:00',

    # No default: omitting this leaves retention to backup.ps1 at run time.
    [int] $Keep = 0,

    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$logModule = Join-Path $PSScriptRoot 'backup-log.ps1'
if (-not (Test-Path -LiteralPath $logModule -PathType Leaf)) {
    Write-Error "register-backup-task.ps1: missing required helper '$logModule'."
    exit 1
}
. $logModule

function Write-Fail {
    param([string] $Message, [string] $Reason = 'error')

    Write-BackupLog -Level ERROR -Event TASK_REGISTER_FAILED -Fields @{
        task     = $TaskName
        reason   = $Reason
        detail   = $Message
        dry_run  = [string] $DryRun.IsPresent
    }

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { Write-Error "register-backup-task.ps1: $Message" }
    finally { $ErrorActionPreference = $previous }

    exit 1
}

# --- Resolve paths -----------------------------------------------------------
# Everything below works from absolute paths. Nothing may depend on the
# caller's current directory: the registered action will run from Task
# Scheduler's own working directory, which is not this one.
if ([string]::IsNullOrWhiteSpace($BackupScript)) {
    $BackupScript = Join-Path $PSScriptRoot 'backup.ps1'
}

$resolvedScript = [System.IO.Path]::GetFullPath($BackupScript)

# Absolute path to the shell used in both the printed command and the
# registered action. Task Scheduler frequently starts a task with a minimal
# PATH, so 'powershell.exe' alone is not guaranteed to resolve.
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $psExe -PathType Leaf)) { $psExe = 'powershell' }

# Verified before registering: a task pointing at a file that does not exist
# fails silently every night at 02:00 and is discovered only when somebody
# notices the backups stopped.
if (-not (Test-Path -LiteralPath $resolvedScript -PathType Leaf)) {
    Write-Fail "backup script not found: $resolvedScript" 'backup_script_missing'
}

try {
    $runAt = [datetime]::ParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
}
catch {
    Write-Fail "Time must use 24-hour HH:mm format, for example 02:00. Received: $Time" 'bad_time'
}

if ($Keep -lt 0) {
    Write-Fail '-Keep must be 0 (unset, use BACKUP_KEEP) or greater.' 'bad_keep'
}

# The one command line, built once and used for three things: the dry-run
# display, the registered action, and the copy-paste instruction printed when
# the token is not elevated. Building it once is what guarantees the command the
# operator is told to paste is the command that would actually install the task.
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$resolvedScript`""
if ($Keep -ge 1) {
    $arguments += " -Keep $Keep"
}

$installCommand = '& "{0}" {1}' -f $psExe, $arguments
$verifyCommand = '& "{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -TaskName "{2}"' -f `
    $psExe, (Join-Path $PSScriptRoot 'verify-backup-task.ps1'), $TaskName

# --- Elevation ---------------------------------------------------------------
# Checked here rather than being discovered as "access denied" inside
# Register-ScheduledTask, where the message names neither the cause nor the fix.
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
    if ($DryRun) {
        # A dry run changes nothing, so it is allowed without elevation. Say so,
        # because the operator still has to elevate to actually install.
        Write-Host '[register] note: this token is not elevated, which is fine for -DryRun. Installing for real needs an elevated PowerShell.'
    }
    else {
        # No self-elevation. This script does not call Start-Process -Verb RunAs
        # and never will: see the ELEVATION section of the header. What it does
        # is stop, say plainly that nothing was registered, and print the exact
        # command so the operator can run it themselves with the consent they are
        # meant to give.
        Write-Host ''
        Write-Host '[register] NOT REGISTERED. Nothing was installed and nothing was changed.'
        Write-Host '[register] Reason: this PowerShell session is not elevated. Writing to the Task Scheduler'
        Write-Host '[register] store requires an Administrator token; this one is a standard token.'
        Write-Host '[register] This script will not raise a UAC prompt on its own, by design: you decide when'
        Write-Host '[register] and how to elevate.'
        Write-Host ''
        Write-Host '[register] 1. Open PowerShell as Administrator (right-click, Run as administrator).'
        Write-Host '[register] 2. Run this exact command:'
        Write-Host ''
        Write-Host ('[register]    {0}' -f $installCommand)
        Write-Host ''
        Write-Host '[register] 3. Then verify it with:'
        Write-Host ''
        Write-Host ('[register]    {0}' -f $verifyCommand)
        Write-Host ''
        Write-Host '[register] Until that command has been run, backups are taken only when somebody runs'
        Write-Host '[register] backup.ps1 by hand. Nothing is scheduled at this point.'
        Write-BackupLog -Level WARN -Event TASK_REGISTER_REFUSED -Fields @{
            task      = $TaskName
            script    = $resolvedScript
            time      = $runAt.ToString('HH:mm')
            keep      = $Keep
            elevated  = $isElevated
            note      = 'not_elevated_no_self_elevation'
        }
        exit 1
    }
}

# --- Dry run -----------------------------------------------------------------
if ($DryRun) {
    Write-Host "[register] DRYRUN: nothing was registered, nothing was changed."
    Write-Host "[register] task name        : $TaskName"
    Write-Host "[register] action executable: powershell.exe"
    Write-Host "[register] action arguments: $arguments"
    Write-Host "[register] trigger          : daily at $($runAt.ToString('HH:mm'))"
    Write-Host "[register] retention        : $(if ($Keep -ge 1) { "-Keep $Keep (baked into the action)" } else { 'left to BACKUP_KEEP at run time' })"
    Write-Host "[register] environment      : resolved at run time from BACKUP_ENV / BACKUP_CONTAINER, not baked in"
    Write-Host "[register] verified script  : $resolvedScript ($((Get-Item -LiteralPath $resolvedScript).Length) bytes)"
    Write-Host "[register] to install for real, re-run without -DryRun from an Administrator PowerShell."
    Write-Host "[register] the exact command that installs it:"
    Write-Host ('[register]    {0}' -f $installCommand)
    Write-Host '[register] then verify with:'
    Write-Host ('[register]    {0}' -f $verifyCommand)
    Write-BackupLog -Level INFO -Event TASK_REGISTER_DRYRUN -Fields @{
        task      = $TaskName
        script    = $resolvedScript
        time      = $runAt.ToString('HH:mm')
        keep      = $Keep
        elevated  = $isElevated
    }
    exit 0
}

# --- Detect what already exists ----------------------------------------------
# Read-only, and scoped to exactly one task name. Nothing here enumerates other
# tasks: this script has no reason to know they exist, and enumerating them
# would put unrelated tasks in reach of a mistake.
$existing = $null
try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
catch {
    # Access denied when querying another user's task folder, or the Scheduled
    # Tasks module is unavailable. Not fatal: fall through and let
    # Register-ScheduledTask decide.
    $existing = $null
}

$intendedAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $runAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$status = 'CREATED'

if ($null -ne $existing -and @($existing).Count -gt 0) {
    $currentAction = @($existing)[0].Actions | Select-Object -First 1
    $currentArgument = ''
    if ($null -ne $currentAction) { $currentArgument = [string] $currentAction.Arguments }
    $currentExecute = ''
    if ($null -ne $currentAction) { $currentExecute = [string] $currentAction.Execute }

    $sameAction = ($currentExecute -ieq 'powershell.exe') -and ($currentArgument -eq $arguments)
    $sameTrigger = (@($existing)[0].Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger' }).Count -gt 0
    if ($sameAction -and $sameTrigger -and (@($existing)[0].State -ne 'Disabled')) {
        # Already exactly what this script would install. Report it and leave it
        # completely alone rather than re-registering an identical definition.
        $status = 'UNCHANGED'
    }
    else {
        $status = 'UPDATED'
    }
}

# --- Register ----------------------------------------------------------------
try {
    if ($status -eq 'UNCHANGED') {
        Write-Host "[register] UNCHANGED: task '$TaskName' already exists and its action, trigger and state already match. Left alone, nothing registered."
    }
    else {
        Register-ScheduledTask -TaskName $TaskName -Action $intendedAction -Trigger $trigger -Settings $settings `
            -Description 'Nightly PostgreSQL logical backup for HRMS' -Force | Out-Null
        Write-Host "[register] $status`: task '$TaskName' now runs $($runAt.ToString('HH:mm')) daily. Run Get-ScheduledTaskInfo -TaskName '$TaskName' to inspect its last result."
    }
}
catch {
    Write-Fail "Register-ScheduledTask failed: $($_.Exception.Message)" 'register_failed'
}

Write-BackupLog -Level INFO -Event TASK_REGISTERED -Fields @{
    task      = $TaskName
    status    = $status
    script    = $resolvedScript
    time      = $runAt.ToString('HH:mm')
    keep      = $Keep
    elevated  = $isElevated
}

# Printed only after Register-ScheduledTask returned without throwing, so this
# line can never claim a schedule that does not exist.
Write-Host "[register] verify the result with:"
Write-Host ('[register]    {0}' -f $verifyCommand)

exit 0
