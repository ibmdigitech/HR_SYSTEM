<#
.SYNOPSIS
    Installs or updates the nightly HR database backup task in Windows Task Scheduler.
.DESCRIPTION
    Runs scripts/backup.ps1 every day at 02:00 and keeps the latest 14 dumps.
    Run this once in an elevated PowerShell window on the Docker host.
#>
[CmdletBinding()]
param(
    [string] $TaskName = 'HRMS-Backup',
    [string] $BackupScript = (Join-Path $PSScriptRoot 'backup.ps1'),
    [string] $Time = '02:00',
    [int] $Keep = 14
)

$ErrorActionPreference = 'Stop'
$resolvedScript = [System.IO.Path]::GetFullPath($BackupScript)
if (-not (Test-Path -LiteralPath $resolvedScript -PathType Leaf)) {
    throw "Backup script not found: $resolvedScript"
}
if ($Keep -lt 1) { throw '-Keep must be at least 1.' }
try { $runAt = [datetime]::ParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture) }
catch { throw "Time must use 24-hour HH:mm format, for example 02:00. Received: $Time" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$resolvedScript`" -Keep $Keep"
$trigger = New-ScheduledTaskTrigger -Daily -At $runAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Nightly PostgreSQL logical backup for HRMS' -Force | Out-Null
Write-Host "Installed task '$TaskName' at $($runAt.ToString('HH:mm')) daily. Run Get-ScheduledTaskInfo -TaskName '$TaskName' to inspect its last result."
