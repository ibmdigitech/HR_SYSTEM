<#
.SYNOPSIS
    Verifies that the HRMS-Backup scheduled task is installed, enabled, aimed at
    the right script, and aimed at the PRODUCTION database.

.DESCRIPTION
    A post-install check for scripts/register-backup-task.ps1. It reads what
    Windows actually has registered and reports each fact separately, because
    "the task is installed" and "the task backs up production" are different
    claims and only the second one matters.

    It is a READ-ONLY reporter. It never registers, changes, enables, disables
    or deletes a task, and it never takes a backup.

    EVERY CHECK IS REPORTED INDIVIDUALLY, with PASS, WARN, FAIL or UNKNOWN, and
    never folded into a single verdict. A script that prints one green line for
    a task that exists but points at the development database is worse than no
    script, because it is believed.

      1. task.exists        the task HRMS-Backup is registered
      2. task.enabled       it is enabled, not Disabled
      3. task.schedule      it is a daily trigger at the expected time (02:00)
      4. task.action        it runs THIS repository's scripts\backup.ps1, by
                            absolute path, and does not pin -Container or
                            -Environment into the action
      5. env.resolved       the environment the task would run in resolves to
                            'production'
      6. container.resolved BACKUP_CONTAINER resolves to 'hr_system_db', so the
                            run satisfies backup.ps1's production fail-safe
      7. task.last_run      last run time and last result (0 = success,
                            267009 = never run, which is a WARN not a FAIL)
      8. task.next_run      next run time

    WHY CHECKS 5 AND 6 ARE NOT ABOUT THE XML
    -----------------------------------------
    backup.ps1 resolves its target at RUN time from BACKUP_ENV and
    BACKUP_CONTAINER, deliberately, so that re-pointing the host at a different
    database does not require re-registering the task. The consequence is that a
    perfectly registered task can still run against the development database
    every night, which is finding 1 of docs/audit/BACKUP_AUDIT_PHASE1.md.

    So these two checks resolve the SAME way backup.ps1 resolves them, and they
    resolve from the PERSISTED User or Machine environment rather than from this
    process. A variable that exists only in the shell that launched this script
    is not visible to a task started by Task Scheduler, and that is reported as
    a failure rather than quietly counted as configured.

    WHAT "LAST RESULT" MEANS
    ------------------------
    Task Scheduler's own signal, and the only one nobody reads:
      0        the last run succeeded
      267009   SCHED_S_TASK_HAS_NOT_RUN: the task has never executed. This is a
               WARN, not a FAIL. A freshly installed task that has not reached
               02:00 yet is working exactly as intended.
      other    a real failed run, and a FAIL. Nothing else in this repository
               would notice.

    NOT REGISTERED IS A FAILURE, NEVER A PASS
    -----------------------------------------
    If the task does not exist, that is reported as FAIL together with the exact
    install command. There is no configuration of this script in which a missing
    task produces a passing verdict.

    EXIT CODES
    ----------
      0  every check PASSed
      1  no FAIL, but at least one WARN
      2  at least one FAIL

    EVERY CALL IS GUARDED. A missing task, a denied ACL, a missing ScheduledTasks
    module or a non-Windows host produces a report with UNKNOWN or FAIL on the
    affected lines. This script never throws its way out of a check, because a
    stack trace is not a verification report.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup-task.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup-task.ps1 -TaskName HRMS-Backup -ExpectedTime 02:00

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.
#>

[CmdletBinding()]
param(
    [string] $TaskName = '',

    # 24-hour HH:mm the daily trigger is expected to start at.
    [string] $ExpectedTime = '02:00',

    # The environment the nightly run must resolve to.
    [string] $ExpectedEnvironment = 'production',

    # The container that environment must resolve to.
    [string] $ExpectedContainer = 'hr_system_db',

    # Absolute or relative path to the backup script the task must run.
    [string] $BackupScript = '',

    # Print one machine-greppable line per check in addition to the table.
    [switch] $AsLines
)

$ErrorActionPreference = 'Stop'

$logModule = Join-Path $PSScriptRoot 'backup-log.ps1'
if (-not (Test-Path -LiteralPath $logModule -PathType Leaf)) {
    Write-Error "verify-backup-task.ps1: missing required helper '$logModule'."
    exit 1
}
. $logModule

$STATUS_PASS = 'PASS'
$STATUS_WARN = 'WARN'
$STATUS_FAIL = 'FAIL'
$STATUS_UNKNOWN = 'UNKNOWN'

$script:Checks = New-Object System.Collections.ArrayList

function Add-Check {
<#
.SYNOPSIS
    Record exactly one verification result.
.DESCRIPTION
    Every check goes through here, so the report always has the same eight lines
    in the same order with the same status vocabulary. A check that could not be
    evaluated reports UNKNOWN and says why; it is never rounded down to PASS.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Id,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'WARN', 'FAIL', 'UNKNOWN')][string] $Status,
        [Parameter(Mandatory = $true)][string] $Detail
    )

    $null = $script:Checks.Add([pscustomobject]@{
        Id     = $Id
        Status = $Status
        Detail = $Detail
    })
}

function Invoke-Schtasks {
<#
.SYNOPSIS
    Run schtasks and capture stdout and stderr as plain text plus the exit code.
.DESCRIPTION
    $ErrorActionPreference is relaxed for the call. In Windows PowerShell 5.1 a
    native command's stderr, once redirected into the success stream, becomes
    an ErrorRecord that 'Stop' turns into a terminating exception, so a missing
    task ("ERROR: The system cannot find the file specified.") would abort the
    report instead of being reported as a finding.
#>
    [CmdletBinding()]
    param([string[]] $Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $exe = Join-Path $env:SystemRoot 'System32\schtasks.exe'
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
            return [pscustomobject]@{ ExitCode = -1; Output = ''; Error = 'schtasks.exe is not present on this host.'; Available = $false }
        }
        $output = & $exe @Arguments 2>&1
        $code = $LASTEXITCODE
        # A native command's stderr arrives as an ErrorRecord, and the stream
        # always ends with an empty one that would otherwise stringifies to the
        # type name and land in the middle of a report line. Keep real text only.
        $lines = @(
            $output | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) { [string] $_.Exception.Message }
                else { [string] $_ }
            } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        $text = ($lines -join "`n")
        return [pscustomobject]@{ ExitCode = $code; Output = $text; Error = ''; Available = $true }
    }
    catch {
        return [pscustomobject]@{ ExitCode = -1; Output = ''; Error = $_.Exception.Message; Available = $true }
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-XmlNodeText {
<#
.SYNOPSIS
    First matching XML node's text, matched by local name only.
.DESCRIPTION
    The Task Scheduler XML lives in the namespace
    http://schemas.microsoft.com/windows/2004/02/mit/task, and XPath needs a
    prefix or a registered namespace to reach it. local-name() sidesteps both
    and keeps working if the schema ever moves, which a hard-coded
    XmlNamespaceManager would not.
#>
    [CmdletBinding()]
    param(
        [xml] $Document,
        [string] $LocalName
    )

    if ($null -eq $Document) { return $null }
    $nodes = $Document.SelectNodes("//*[local-name()='" + $LocalName + "']")
    if ($null -eq $nodes -or $nodes.Count -eq 0) { return $null }
    return $nodes[0].InnerText
}

function Get-LiveScheduledTask {
<#
.SYNOPSIS
    Read a task through the ScheduledTasks module, tolerating either name form.
.DESCRIPTION
    schtasks /TN accepts "\HRMS-Backup" and "HRMS-Backup"; Get-ScheduledTask
    accepts only the second and answers "No MSFT_ScheduledTask objects found"
    for the first, which looks exactly like "the task does not exist". Both forms
    are tried, so a folder-qualified name cannot be misread as absence. Returns
    $null rather than throwing.
#>
    [CmdletBinding()]
    param([string] $Name)

    $candidates = @($Name)
    $leaf = ($Name -replace '^\\', '')
    if ($leaf -and ($leaf -ne $Name)) { $candidates += $leaf }

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        try {
            $found = Get-ScheduledTask -TaskName $candidate -ErrorAction Stop
            if ($null -ne $found -and @($found).Count -gt 0) {
                return @($found)[0]
            }
        }
        catch {
            # Try the next spelling rather than reporting absence here.
        }
    }
    return $null
}

function Get-PersistedEnvironmentValue {
<#
.SYNOPSIS
    Read one variable the way a task started by Task Scheduler would see it.
.DESCRIPTION
    Order is Machine, then User, then this process. Machine and User are the two
    scopes that survive into a scheduled run; the process scope belongs to the
    shell that launched this script and is invisible to Task Scheduler, so a
    value found only there is reported with the scope that supplied it and the
    caller decides whether that counts.
#>
    [CmdletBinding()]
    param([string] $Name)

    $machine = [Environment]::GetEnvironmentVariable($Name, 'Machine')
    if (-not [string]::IsNullOrWhiteSpace($machine)) {
        return [pscustomobject]@{ Value = $machine.Trim(); Scope = 'Machine' }
    }

    $user = [Environment]::GetEnvironmentVariable($Name, 'User')
    if (-not [string]::IsNullOrWhiteSpace($user)) {
        return [pscustomobject]@{ Value = $user.Trim(); Scope = 'User' }
    }

    $process = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($process)) {
        return [pscustomobject]@{ Value = $process.Trim(); Scope = 'Process (this session only)' }
    }

    return [pscustomobject]@{ Value = ''; Scope = 'unset' }
}

# --- Resolve the expected values ---------------------------------------------
if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $taskNameEnv = [Environment]::GetEnvironmentVariable('BACKUP_TASK_NAME')
    if ([string]::IsNullOrWhiteSpace($taskNameEnv)) { $TaskName = 'HRMS-Backup' }
    else { $TaskName = $taskNameEnv.Trim() }
}

if ([string]::IsNullOrWhiteSpace($BackupScript)) {
    $BackupScript = Join-Path $PSScriptRoot 'backup.ps1'
}

$expectedScript = ''
$expectedScriptError = ''
try {
    $expectedScript = [System.IO.Path]::GetFullPath($BackupScript)
}
catch {
    $expectedScriptError = $_.Exception.Message
}

try {
    $expectedRunAt = [datetime]::ParseExact($ExpectedTime, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    $expectedTimeText = $expectedRunAt.ToString('HH:mm')
}
catch {
    Write-Error "verify-backup-task.ps1: -ExpectedTime must be 24-hour HH:mm. Received: $ExpectedTime"
    exit 2
}

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $psExe -PathType Leaf)) { $psExe = 'powershell' }
$installCommand = '& "{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}"' -f `
    $psExe, [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'register-backup-task.ps1'))

Write-Host ("verify-backup-task.ps1: task='{0}' expected_time={1} expected_env={2} expected_container={3}" -f `
    $TaskName, $expectedTimeText, $ExpectedEnvironment, $ExpectedContainer)

# --- Host guards -------------------------------------------------------------
# Checked first so that every failure below can be attributed to a missing task
# rather than to a host that was never capable of having one.
$isWindows = ($env:OS -eq 'Windows_NT')
$schtasksProbe = Invoke-Schtasks -Arguments @('/Query', '/FO', 'CSV', '/NH')

$taskXmlResult = $null
$taskDocument = $null
$taskRegistered = $false

if (-not $isWindows) {
    Add-Check -Id 'task.exists' -Status $STATUS_UNKNOWN -Detail 'not a Windows host, so Windows Task Scheduler cannot be queried at all. Nothing about this host can be verified.'
}
elseif (-not $schtasksProbe.Available) {
    Add-Check -Id 'task.exists' -Status $STATUS_UNKNOWN -Detail ('schtasks.exe is unavailable (' + $schtasksProbe.Error + '), so the scheduler cannot be queried.')
}
else {
    # The XML is the authority. /FO LIST /V is a display format whose field
    # names are localised, so it is used only for values the XML does not carry.
    $taskXmlResult = Invoke-Schtasks -Arguments @('/Query', '/TN', $TaskName, '/XML')

    if ($taskXmlResult.ExitCode -ne 0) {
        $reason = $taskXmlResult.Output.Trim()
        if ([string]::IsNullOrWhiteSpace($reason)) { $reason = $taskXmlResult.Error }
        if ($reason.Length -gt 300) { $reason = $reason.Substring(0, 300) }
        $taskRegistered = $false
        Add-Check -Id 'task.exists' -Status $STATUS_FAIL -Detail ("NOT REGISTERED: schtasks found no task named '{0}', so backups are never taken automatically. Exit code {1}. {2} Install it with: {3}" -f $TaskName, $taskXmlResult.ExitCode, $reason, $installCommand)
    }
    else {
        $parseError = ''
        try { $taskDocument = [xml] $taskXmlResult.Output }
        catch { $parseError = $_.Exception.Message }

        if ($null -eq $taskDocument) {
            $taskRegistered = $false
            Add-Check -Id 'task.exists' -Status $STATUS_UNKNOWN -Detail ("task '{0}' exists (schtasks exited 0) but its XML could not be parsed: {1}. The remaining scheduler checks cannot be evaluated." -f $TaskName, $parseError)
        }
        else {
            $taskRegistered = $true
            $uri = Get-XmlNodeText -Document $taskDocument -LocalName 'URI'
            Add-Check -Id 'task.exists' -Status $STATUS_PASS -Detail ("task '{0}' is registered. XML URI: {1}" -f $TaskName, $(if ($uri) { $uri } else { '(absent)' }))
        }
    }
}

# --- 2. Enabled --------------------------------------------------------------
$enabledStatus = $STATUS_UNKNOWN
$enabledDetail = 'the task is not registered, so it has no enabled state.'

if ($taskRegistered) {
    # Scoped to <Settings>, NOT to a document-wide //Enabled search. A
    # CalendarTrigger carries its own <Enabled> element, so a document-wide
    # search would report a DISABLED trigger's enabled state as the task's, and
    # would report a disabled task as enabled whenever its trigger happened to
    # be switched on. Both are the wrong answer in the dangerous direction.
    $enabledNodes = $taskDocument.SelectNodes("//*[local-name()='Settings']/*[local-name()='Enabled']")
    $xmlEnabled = ''
    if ($null -ne $enabledNodes -and $enabledNodes.Count -gt 0) { $xmlEnabled = $enabledNodes[0].InnerText }
    if (-not [string]::IsNullOrWhiteSpace($xmlEnabled)) {
        if ($xmlEnabled.Trim().ToLowerInvariant() -eq 'true') {
            $enabledStatus = $STATUS_PASS
            $enabledDetail = 'the task XML carries <Settings><Enabled>true</Enabled>.'
        }
        else {
            $enabledStatus = $STATUS_FAIL
            $enabledDetail = ("the task XML carries <Settings><Enabled>{0}</Enabled>. A disabled task never runs, so no automatic backup will ever be taken. Enable it with: Enable-ScheduledTask -TaskName '{1}'" -f $xmlEnabled.Trim(), $TaskName)
        }
    }
    else {
        # No <Enabled> element in the XML. Windows treats an absent value as
        # enabled, but rather than assume that, the live object is consulted.
        $liveState = ''
        $liveTask = Get-LiveScheduledTask -Name $TaskName
        if ($null -ne $liveTask) { $liveState = [string] $liveTask.State }

        if ($liveState -eq 'Disabled') {
            $enabledStatus = $STATUS_FAIL
            $enabledDetail = ("the XML omits <Enabled> and the live task state is Disabled. A disabled task never runs. Enable it with: Enable-ScheduledTask -TaskName '{0}'" -f $TaskName)
        }
        elseif ([string]::IsNullOrWhiteSpace($liveState)) {
            $enabledStatus = $STATUS_UNKNOWN
            $enabledDetail = 'the XML omits <Enabled> and the live task state could not be read, so the enabled state is unconfirmed rather than assumed.'
        }
        else {
            $enabledStatus = $STATUS_PASS
            $enabledDetail = ("the XML omits <Enabled>; the live task state is '{0}', which is not Disabled." -f $liveState)
        }
    }
}

Add-Check -Id 'task.enabled' -Status $enabledStatus -Detail $enabledDetail

# --- 3. Daily at the expected time -------------------------------------------
$scheduleStatus = $STATUS_UNKNOWN
$scheduleDetail = 'the task is not registered, so it has no schedule.'

if ($taskRegistered) {
    $calendarNodes = $taskDocument.SelectNodes("//*[local-name()='CalendarTrigger']")
    $dailyNodes = $taskDocument.SelectNodes("//*[local-name()='ScheduleByDay']")

    if ($null -eq $calendarNodes -or $calendarNodes.Count -eq 0) {
        # Not a failure by itself: a logon or start-up trigger would run more
        # often than daily, never less, so it is not "the schedule we expected"
        # and is reported as a FAIL of the daily requirement.
        $otherTriggers = @()
        foreach ($node in $taskDocument.SelectNodes("//*[local-name()='Triggers']/*")) {
            $otherTriggers += $node.LocalName
        }
        $triggerNames = 'none'
        if ($otherTriggers.Count -gt 0) { $triggerNames = ($otherTriggers -join ', ') }
        $scheduleStatus = $STATUS_FAIL
        $scheduleDetail = ("no <CalendarTrigger> in the task XML, so it is not a daily schedule. Triggers found: {0}. Expected a daily trigger at {1}." -f $triggerNames, $expectedTimeText)
    }
    else {
        $trigger = $calendarNodes[0]

        $interval = ''
        $intervalNodes = $trigger.SelectNodes(".//*[local-name()='DaysInterval']")
        if ($null -ne $intervalNodes -and $intervalNodes.Count -gt 0) {
            $interval = $intervalNodes[0].InnerText.Trim()
        }

        $boundary = ''
        $boundaryNodes = $trigger.SelectNodes(".//*[local-name()='StartBoundary']")
        if ($null -ne $boundaryNodes -and $boundaryNodes.Count -gt 0) {
            $boundary = $boundaryNodes[0].InnerText.Trim()
        }

        $isDaily = ($null -eq $dailyNodes -or $dailyNodes.Count -eq 0) -or ($interval -eq '1')
        $intervalNote = 'ScheduleByDay is absent, which is a daily trigger with the default 1-day interval'
        if ($interval) { $intervalNote = ('DaysInterval=' + $interval) }

        $boundaryParsed = $null
        $boundaryTime = ''
        if ($boundary) {
            try {
                $boundaryParsed = [datetime]::ParseExact(
                    ($boundary -replace 'Z$', ''),
                    "yyyy-MM-ddTHH:mm:ss",
                    [Globalization.CultureInfo]::InvariantCulture
                )
                $boundaryTime = $boundaryParsed.ToString('HH:mm')
            }
            catch {
                # A boundary with a fractional-seconds or offset suffix is still
                # readable; fall back to a general parse before giving up.
                try {
                    $boundaryParsed = [datetime]::Parse($boundary, [Globalization.CultureInfo]::InvariantCulture)
                    $boundaryTime = $boundaryParsed.ToString('HH:mm')
                }
                catch {
                    $boundaryParsed = $null
                    $boundaryTime = ''
                }
            }
        }

        if (-not $isDaily) {
            $scheduleStatus = $STATUS_FAIL
            $scheduleDetail = ('the trigger is not daily: {0}. A daily schedule is required for a nightly backup.' -f $intervalNote)
        }
        elseif ([string]::IsNullOrWhiteSpace($boundaryTime)) {
            $scheduleStatus = $STATUS_UNKNOWN
            $scheduleDetail = ('the trigger is daily ({0}) but its <StartBoundary> is unreadable, so the start time cannot be compared against {1}. StartBoundary={2}' -f $intervalNote, $expectedTimeText, $(if ($boundary) { $boundary } else { '(absent)' }))
        }
        elseif ($boundaryTime -eq $expectedTimeText) {
            $scheduleStatus = $STATUS_PASS
            $scheduleDetail = ('daily at {0}. {1}. StartBoundary={2}' -f $boundaryTime, $intervalNote, $boundary)
        }
        else {
            $scheduleStatus = $STATUS_FAIL
            $scheduleDetail = ('the task runs daily but at {0}, not the expected {1}. StartBoundary={2}. Fix it with: {3} -Time {1}' -f $boundaryTime, $expectedTimeText, $boundary, $installCommand)
        }
    }
}

Add-Check -Id 'task.schedule' -Status $scheduleStatus -Detail $scheduleDetail

# --- 4. Action points at this repository's backup.ps1 -----------------------
$actionStatus = $STATUS_UNKNOWN
$actionDetail = 'the task is not registered, so it has no action.'

if ($taskRegistered) {
    if ([string]::IsNullOrWhiteSpace($expectedScript)) {
        $actionStatus = $STATUS_UNKNOWN
        $actionDetail = ('the expected backup script path is not usable, so the registered action cannot be compared against it: ' + $expectedScriptError)
    }
    else {
        $command = ''
        $commandNodes = $taskDocument.SelectNodes("//*[local-name()='Actions']/*[local-name()='Exec']/*[local-name()='Command']")
        if ($null -ne $commandNodes -and $commandNodes.Count -gt 0) { $command = $commandNodes[0].InnerText.Trim() }

        $taskArguments = ''
        $argumentNodes = $taskDocument.SelectNodes("//*[local-name()='Actions']/*[local-name()='Exec']/*[local-name()='Arguments']")
        if ($null -ne $argumentNodes -and $argumentNodes.Count -gt 0) { $taskArguments = $argumentNodes[0].InnerText.Trim() }

        $scriptMatch = [regex]::Match($taskArguments, '(?i)-File\s+(?:"([^"]+)"|(\S+))')
        $registeredScript = ''
        if ($scriptMatch.Success) {
            if ($scriptMatch.Groups[1].Success) { $registeredScript = $scriptMatch.Groups[1].Value }
            else { $registeredScript = $scriptMatch.Groups[2].Value }
        }

        $registeredScriptFull = ''
        if ($registeredScript) {
            try { $registeredScriptFull = [System.IO.Path]::GetFullPath($registeredScript) }
            catch { $registeredScriptFull = $registeredScript }
        }

        $executableOk = ($command -match '(?i)powershell(\.exe)?$')
        $scriptOk = ($registeredScriptFull -and ($registeredScriptFull -ieq $expectedScript))
        $absoluteOk = ($registeredScript -and [System.IO.Path]::IsPathRooted($registeredScript))

        # -Container or -Environment in the action would pin the nightly target
        # into the task, overriding the host's BACKUP_ENV at run time. That is
        # reported here because it is the same "the action targets the wrong
        # thing" family as a wrong -File, and it is the one that is invisible
        # in a glance at the task's Action column.
        $pinned = @()
        if ($taskArguments -match '(?i)(^|\s)-Container(\s|$)') { $pinned += '-Container' }
        if ($taskArguments -match '(?i)(^|\s)-Environment(\s|$)') { $pinned += '-Environment' }
        $pinNote = ''
        if ($pinned.Count -gt 0) {
            $pinNote = (' WARNING: the action also pins {0}, which overrides the host environment at run time and can point the nightly job at the wrong database.' -f ($pinned -join ' and '))
        }

        if (-not $scriptOk) {
            if ([string]::IsNullOrWhiteSpace($registeredScript)) {
                $actionStatus = $STATUS_FAIL
                $actionDetail = ("the task action does not pass -File <path>. Action arguments: '{0}'. Expected to run {1}. Re-register it with: {2}" -f $taskArguments, $expectedScript, $installCommand)
            }
            else {
                $actionStatus = $STATUS_FAIL
                $actionDetail = ("the task action runs a DIFFERENT script. Registered: {0}. Expected: {1}. A task pointing at another repository's backup.ps1 would succeed every night while protecting nothing here. Re-register it with: {2}{3}" -f $registeredScriptFull, $expectedScript, $installCommand, $pinNote)
            }
        }
        elseif (-not $executableOk) {
            $actionStatus = $STATUS_FAIL
            $actionDetail = ("the task runs the right script but with a non-PowerShell command '{0}'. Re-register it with: {1}{2}" -f $command, $installCommand, $pinNote)
        }
        elseif (-not $absoluteOk) {
            $actionStatus = $STATUS_FAIL
            $actionDetail = ("the task runs {0} by a RELATIVE path. Task Scheduler starts a task with its own working directory, so a relative path can resolve somewhere else entirely. Re-register it with: {1}{2}" -f $registeredScript, $installCommand, $pinNote)
        }
        else {
            $actionStatus = $STATUS_PASS
            $actionDetail = ("runs {0} via '{1}' with arguments: {2}{3}" -f $registeredScriptFull, $command, $taskArguments, $pinNote)
        }
    }
}

Add-Check -Id 'task.action' -Status $actionStatus -Detail $actionDetail

# --- 5. The environment the task would run in -------------------------------
$envResolved = Get-PersistedEnvironmentValue -Name 'BACKUP_ENV'
$effectiveEnvironment = $envResolved.Value.ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($effectiveEnvironment)) { $effectiveEnvironment = 'development' }

if ($effectiveEnvironment -ne $ExpectedEnvironment) {
    if ($envResolved.Scope -like 'Process*') {
        Add-Check -Id 'env.resolved' -Status $STATUS_FAIL -Detail ("BACKUP_ENV='{0}' is set in this session only (scope: {1}). A task started by Task Scheduler does NOT inherit this shell's environment, so the nightly run would fall back to 'development' and back up the development database. Persist it for the user who runs the task, or for the machine, with: setx BACKUP_ENV {0}" -f $envResolved.Value, $envResolved.Scope, $ExpectedEnvironment)
    }
    else {
        Add-Check -Id 'env.resolved' -Status $STATUS_FAIL -Detail ("BACKUP_ENV resolves to '{0}' (scope: {1}); the nightly backup must resolve to '{2}'. A scheduled task that resolves to 'development' backs up the development database while an administrator believes production is covered. Set it with: setx BACKUP_ENV {2}" -f $effectiveEnvironment, $envResolved.Scope, $ExpectedEnvironment)
    }
}
elseif ($envResolved.Scope -like 'Process*') {
    Add-Check -Id 'env.resolved' -Status $STATUS_FAIL -Detail ("BACKUP_ENV='{0}' is correct but exists only in this session (scope: {1}), so the scheduled task will not see it. Persist it with: setx BACKUP_ENV {0}" -f $envResolved.Value, $envResolved.Scope)
}
else {
    Add-Check -Id 'env.resolved' -Status $STATUS_PASS -Detail ("BACKUP_ENV resolves to '{0}' from the {1} environment, which a Task Scheduler run inherits." -f $effectiveEnvironment, $envResolved.Scope)
}

# --- 6. The container the task would resolve to ------------------------------
$containerResolved = Get-PersistedEnvironmentValue -Name 'BACKUP_CONTAINER'

# Exactly backup.ps1's rule: the environment variable wins, and otherwise the
# environment's canonical container is used. If BACKUP_CONTAINER is unset and
# BACKUP_ENV is production, the run resolves to hr_system_db and passes.
$canonicalContainers = @{ 'development' = 'hr-postgres'; 'production' = 'hr_system_db' }
$canonicalForEnv = 'hr-postgres'
if ($canonicalContainers.ContainsKey($effectiveEnvironment)) {
    $canonicalForEnv = $canonicalContainers[$effectiveEnvironment]
}

if ([string]::IsNullOrWhiteSpace($containerResolved.Value)) {
    $resolvedContainer = $canonicalForEnv
    $containerSource = ('BACKUP_ENV=' + $effectiveEnvironment + ' default')
}
else {
    $resolvedContainer = $containerResolved.Value.Trim()
    $containerSource = 'BACKUP_CONTAINER (' + $containerResolved.Scope + ')'
}

if ($resolvedContainer -ine $ExpectedContainer) {
    if ($containerResolved.Scope -like 'Process*') {
        Add-Check -Id 'container.resolved' -Status $STATUS_FAIL -Detail ("BACKUP_CONTAINER='{0}' is set in this session only (scope: {1}), so the scheduled task will not see it. The nightly run would resolve to '{2}', and backup.ps1 would refuse to run as production. Persist it with: setx BACKUP_CONTAINER {3}" -f $containerResolved.Value, $containerResolved.Scope, $canonicalForEnv, $ExpectedContainer)
    }
    else {
        Add-Check -Id 'container.resolved' -Status $STATUS_FAIL -Detail ("the nightly run resolves to container '{0}' (from: {1}), not '{2}'. backup.ps1 exits non-zero for that combination rather than silently backing up the development database. Fix it with: setx BACKUP_CONTAINER {2}" -f $resolvedContainer, $containerSource, $ExpectedContainer)
    }
}
elseif ($containerResolved.Scope -like 'Process*') {
    Add-Check -Id 'container.resolved' -Status $STATUS_FAIL -Detail ("BACKUP_CONTAINER='{0}' is correct but exists only in this session (scope: {1}), so the scheduled task will not see it. Persist it with: setx BACKUP_CONTAINER {0}" -f $containerResolved.Value, $containerResolved.Scope)
}
else {
    Add-Check -Id 'container.resolved' -Status $STATUS_PASS -Detail ("the nightly run resolves to container '{0}' (from: {1}), which is the {2} compose database." -f $resolvedContainer, $containerSource, $ExpectedContainer)
}

# --- 7 and 8. Last run, last result, next run -------------------------------
$lastRunStatus = $STATUS_UNKNOWN
$lastResultStatus = $STATUS_UNKNOWN
$nextRunStatus = $STATUS_UNKNOWN

$lastRunDetail = 'the task is not registered, so it has never run.'
$lastResultDetail = 'no task result exists, because the task is not registered.'
$nextRunDetail = 'no next run exists, because the task is not registered.'

if ($taskRegistered) {
    $lastRunTime = $null
    $nextRunTime = $null
    $lastResult = $null
    $infoError = ''

    # Get-ScheduledTaskInfo is preferred because its fields are typed and its
    # property names are not localised. schtasks /FO LIST /V is the fallback,
    # and it is parsed by label rather than by column position.
    try {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
        if ($null -ne $taskInfo) {
            $lastRunTime = $taskInfo.LastRunTime
            $nextRunTime = $taskInfo.NextRunTime
            $lastResult = $taskInfo.LastTaskResult
        }
    }
    catch {
        $infoError = $_.Exception.Message
        # Same folder-qualified name problem as above: retry the leaf name.
        $leaf = ($TaskName -replace '^\\', '')
        if ($leaf -and ($leaf -ne $TaskName)) {
            try {
                $taskInfo = Get-ScheduledTaskInfo -TaskName $leaf -ErrorAction Stop
                if ($null -ne $taskInfo) {
                    $lastRunTime = $taskInfo.LastRunTime
                    $nextRunTime = $taskInfo.NextRunTime
                    $lastResult = $taskInfo.LastTaskResult
                    $infoError = ''
                }
            }
            catch {
                # Both spellings failed; the schtasks fallback below runs.
            }
        }
    }

    if ($null -eq $lastResult) {
        $listResult = Invoke-Schtasks -Arguments @('/Query', '/TN', $TaskName, '/FO', 'LIST', '/V')
        if ($listResult.ExitCode -eq 0) {
            $lines = ($listResult.Output -split "`r?`n")
            foreach ($line in $lines) {
                $colon = $line.IndexOf(':')
                if ($colon -lt 1) { continue }
                $label = $line.Substring(0, $colon).Trim()
                $value = $line.Substring($colon + 1).Trim()
                if ($label -eq 'Last Run Time') {
                    $parsedRun = $null
                    if ([datetime]::TryParse($value, [ref] $parsedRun)) { $lastRunTime = $parsedRun }
                }
                elseif ($label -eq 'Next Run Time') {
                    $parsedNext = $null
                    if ([datetime]::TryParse($value, [ref] $parsedNext)) { $nextRunTime = $parsedNext }
                }
                elseif ($label -eq 'Last Result') {
                    $parsedResult = 0
                    if ([int64]::TryParse($value, [ref] $parsedResult)) { $lastResult = $parsedResult }
                }
            }
        }
        else {
            $infoError = 'Get-ScheduledTaskInfo failed (' + $infoError + ') and schtasks /FO LIST /V exited ' + $listResult.ExitCode + '.'
        }
    }

    # 267009 is 0x41303, SCHED_S_TASK_HAS_NOT_RUN.
    $neverRunCode = [int64] 267009

    if ($null -eq $lastResult) {
        $lastResultStatus = $STATUS_UNKNOWN
        $lastResultDetail = ("the last run result could not be read, so it is UNKNOWN rather than assumed successful. {0}" -f $infoError)
    }
    else {
        $resultCode = [int64] $lastResult
        if ($resultCode -eq 0) {
            $lastResultStatus = $STATUS_PASS
            $lastResultDetail = 'LastTaskResult 0: the last scheduled run succeeded.'
        }
        elseif ($resultCode -eq $neverRunCode) {
            $lastResultStatus = $STATUS_WARN
            $lastResultDetail = 'LastTaskResult 267009 (0x41303): the task has not run yet. That is expected for a newly installed task that has not reached its trigger time, so it is a WARN and not a failure.'
        }
        else {
            $lastResultStatus = $STATUS_FAIL
            $lastResultDetail = ("LastTaskResult {0}: the last scheduled run FAILED. Nothing else in this repository reads this value, which is why it is reported here." -f $resultCode)
        }
    }

    $neverRun = ($null -eq $lastRunTime) -or ($lastRunTime -eq [datetime]::MinValue)
    if ($neverRun) {
        $lastRunStatus = $STATUS_WARN
        $lastRunDetail = 'has never run: LastRunTime is unset.'
    }
    else {
        $ageHours = [math]::Round(((Get-Date) - $lastRunTime).TotalHours, 2)
        $lastRunStatus = $STATUS_PASS
        $lastRunDetail = ('last ran {0} local, {1} h ago.' -f $lastRunTime.ToString('yyyy-MM-dd HH:mm:ss'), $ageHours)
    }

    $noNextRun = ($null -eq $nextRunTime) -or ($nextRunTime -eq [datetime]::MinValue)
    if ($noNextRun) {
        $nextRunStatus = $STATUS_WARN
        $nextRunDetail = "no next run time is set, so the task has no future run scheduled. Check the <CalendarTrigger> and the enabled state."
    }
    else {
        $inFuture = ($nextRunTime -gt (Get-Date))
        if ($inFuture) {
            $nextRunStatus = $STATUS_PASS
            $nextRunDetail = ('next run {0} local, in {1} h.' -f $nextRunTime.ToString('yyyy-MM-dd HH:mm:ss'), [math]::Round(($nextRunTime - (Get-Date)).TotalHours, 2))
        }
        else {
            $nextRunStatus = $STATUS_WARN
            $nextRunDetail = ('NextRunTime {0} is in the past. A task that has missed its trigger usually has StartWhenAvailable set, in which case the run is pending rather than lost.' -f $nextRunTime.ToString('yyyy-MM-dd HH:mm:ss'))
        }
    }
}

Add-Check -Id 'task.last_run' -Status $lastRunStatus -Detail $lastRunDetail
Add-Check -Id 'task.last_result' -Status $lastResultStatus -Detail $lastResultDetail
Add-Check -Id 'task.next_run' -Status $nextRunStatus -Detail $nextRunDetail

# --- Verdict -----------------------------------------------------------------
$checks = @($script:Checks)
$passed = @($checks | Where-Object { $_.Status -eq $STATUS_PASS }).Count
$warned = @($checks | Where-Object { $_.Status -eq $STATUS_WARN }).Count
$failed = @($checks | Where-Object { $_.Status -eq $STATUS_FAIL }).Count
$unknown = @($checks | Where-Object { $_.Status -eq $STATUS_UNKNOWN }).Count

if ($failed -gt 0) {
    $overall = 'FAIL'
    $exitCode = 2
}
elseif ($warned -gt 0 -or $unknown -gt 0) {
    # UNKNOWN is grouped with WARN on purpose. Anything this script could not
    # confirm must not be reported as a clean bill of health.
    $overall = 'WARN'
    $exitCode = 1
}
else {
    $overall = 'PASS'
    $exitCode = 0
}

Write-Host ''
foreach ($check in $checks) {
    Write-Host ('{0,-7} {1,-18} {2}' -f $check.Status, $check.Id, $check.Detail)
}

Write-Host ''
Write-Host ('TASK_VERIFY result={0} task={1} checks={2} passed={3} warned={4} failed={5} unknown={6}' -f `
    $overall, $TaskName, $checks.Count, $passed, $warned, $failed, $unknown)

if ($overall -eq 'FAIL') {
    Write-Host ("verify-backup-task.ps1: FAILED. The task '{0}' is not correctly installed for production. Install or re-register it from an elevated PowerShell with:" -f $TaskName)
    Write-Host ("verify-backup-task.ps1:    {0}" -f $installCommand)
    Write-Host 'verify-backup-task.ps1: then set the persisted environment, and re-run this script:'
    Write-Host ("verify-backup-task.ps1:    setx BACKUP_ENV {0}" -f $ExpectedEnvironment)
    Write-Host ("verify-backup-task.ps1:    setx BACKUP_CONTAINER {0}" -f $ExpectedContainer)
}
elseif ($overall -eq 'WARN') {
    Write-Host ("verify-backup-task.ps1: WARNING for task '{0}'. Nothing is provably broken, but at least one check could not be confirmed. Warnings are never reported as passes." -f $TaskName)
}
else {
    Write-Host ("verify-backup-task.ps1: PASS. Task '{0}' exists, is enabled, runs daily at {1}, runs this repository's backup.ps1, and resolves to environment '{2}' and container '{3}'." -f $TaskName, $expectedTimeText, $ExpectedEnvironment, $ExpectedContainer)
}

Write-BackupLog -Level $(if ($failed -gt 0) { 'ERROR' } elseif ($overall -eq 'WARN') { 'WARN' } else { 'INFO' }) `
    -Event $(if ($failed -gt 0) { 'BACKUP_FAILED' } else { 'TASK_VERIFIED' }) `
    -Fields @{
        phase      = 'verify_task'
        task       = $TaskName
        result     = $overall
        registered = [string] $taskRegistered
        passed     = $passed
        warned     = $warned
        failed     = $failed
        unknown    = $unknown
    }

if ($AsLines) {
    foreach ($check in $checks) {
        Write-Host ('TASK_VERIFY_CHECK id={0} result={1} {2}' -f $check.Id, $check.Status, $check.Detail)
    }
}

exit $exitCode
