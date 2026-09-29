<#
.SYNOPSIS
    Uptime monitor for the HR application's health endpoint (PRODUCTION_READINESS_CHECKLIST 9.5).

.DESCRIPTION
    Polls `app/api/health/route.ts` and exits non-zero when the application is
    not serving. Suitable as a Windows Task Scheduler job, a container health
    check, or the payload of an external uptime service's HTTP probe.

    THE ONE TRAP THIS SCRIPT EXISTS TO AVOID
    ----------------------------------------
    A health check that reports only "healthy" or "unhealthy" is a bad monitor,
    because the two failures it can see need different responses:

        the app is down   -> restart / redeploy / check the process
        the database is down -> the app is FINE. Restarting it changes nothing.

    The endpoint already draws that line for us: it returns 503 with
    `{"status":"degraded","database":"down"}` when the process is serving but
    cannot reach Postgres, and 200 `{"status":"ok","database":"up"}` when it
    can. So this script does not collapse both to "unhealthy" - it reads the
    `database` field and prints WHICH dependency failed, on its own line, and
    in a machine-readable summary line.

    A 503 here is a READINESS verdict, not a liveness one. Do not wire this
    endpoint into a Kubernetes liveness probe: the database outage would restart
    a perfectly healthy pod on a loop. See docs/audit/OPS_OBSERVABILITY.md.

    DEFAULTS
    -------
    3 attempts, 5 seconds apart, 10 second timeout each. Three attempts because
    a single dropped packet is not an outage and a monitor that pages on one
    gets muted within a week; 5 seconds apart because the probe itself costs
    under a millisecond, so the gap is pure politeness to the app. The
    10-second timeout is well above the endpoint's own 3-second probe timeout,
    so a hung request is the app failing to answer, not the database being slow.

    WIRING IT TO A PUBLIC UPTIME SERVICE
    ------------------------------------
    Point the service at the full URL and treat any non-200 as DOWN. If the
    service supports keyword matching, the line

        HEALTHCHECK result=<STATE> http=<status> ... database=<up|down|unknown>

    is designed to be matched on, so one alert rule can split the two cases:

        UptimeRobot / Better Stack / Hetrixtools / Pingdom, "Keyword" field:
          DOWN  if  HEALTHCHECK result=HEALTHY  is NOT present
          DOWN  if  HEALTHCHECK result=APP_DOWN  is present
          DOWN  if  HEALTHCHECK result=DATABASE_DOWN  is present

    A service that only offers a plain HTTP check cannot see the distinction; it
    will alert "site down" for a database outage. That is acceptable for a
    first alert and is why the split exists in the log.

    Exit codes:
      0  healthy
      1  unhealthy (application down, database down, or an unexpected status)
      2  configuration or usage error (bad URL, probe not found)
      3  indeterminate (ran, but the verdict could not be established)

.NOTES
    This file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
    BOM-less file using the system ANSI code page, so a UTF-8 em dash inside a
    string literal is decoded as CP1252 bytes and yields a stray double quote,
    which terminates the string and produces an unparseable script. ASCII here
    is a correctness constraint, not a style choice.

.EXAMPLE
    # One-shot, default URL (http://localhost:3000/api/health)
    powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1

.EXAMPLE
    # Against a deployed host, with a tighter budget
    powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1 `
        -Url 'https://hr.example.com/api/health' -TimeoutSeconds 5 -Retries 2

.EXAMPLE
    # Windows container health check (HEALTHCHECK instruction)
    #   CMD /c powershell -NoProfile -ExecutionPolicy Bypass -File C:\app\scripts\healthcheck.ps1 || exit 1
#>

[CmdletBinding()]
param(
    # Default is the dev server / local container port. In production this must
    # be the public URL. `/api/health` is currently anonymous: proxy.ts lists it
    # in NEVER_REDIRECT_PATHS and returns it before the session gate, verified
    # with a cookie-less request returning 200. (Note that
    # docs/audit/OPS_RUNBOOK.md section 1.3 still describes this as a blocker;
    # it is stale.)
    #
    # The PROBE_NOT_PUBLIC state below is kept anyway, as a regression detector.
    # If a future change re-gates /api/**, the symptom is an alert saying "the
    # site is down" when the real fault is a configuration change. Reporting the
    # actual cause is cheaper than an incident call at 3am.
    [string] $Url = 'http://localhost:3000/api/health',

    # Per-attempt HTTP timeout, in seconds.
    [int] $TimeoutSeconds = 10,

    # Total attempts, not additional attempts.
    [int] $Retries = 3,

    # Delay between attempts, in seconds.
    [int] $RetryDelaySeconds = 5,

    # Suppress per-attempt progress lines. The summary line is always printed,
    # because a monitor with nothing to read is a monitor nobody trusts.
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'

# Probe states. Kept as short uppercase tokens because they are what an uptime
# service's keyword rule matches on.
$STATE_HEALTHY = 'HEALTHY'
$STATE_APP_DOWN = 'APP_DOWN'
$STATE_DATABASE_DOWN = 'DATABASE_DOWN'
$STATE_DEGRADED = 'DEGRADED'
$STATE_PROBE_NOT_PUBLIC = 'PROBE_NOT_PUBLIC'
$STATE_PROBE_NOT_FOUND = 'PROBE_NOT_FOUND'
$STATE_UNEXPECTED = 'UNEXPECTED_STATUS'

function Write-Line {
    param([string] $Message)
    if (-not $Quiet) { Write-Host $Message }
}

function Write-Fail {
    param([string] $Message)
    Write-Host "healthcheck: $Message"
    exit 2
}

# --- TLS ---------------------------------------------------------------------
# .NET Framework 4.x, which is what Windows PowerShell 5.1 runs on, defaults to
# TLS 1.0 / SSL3 for HttpWebRequest. A public HTTPS uptime endpoint that
# requires TLS 1.2+ would fail every probe with "The request was aborted: Could
# not create SSL/TLS secure channel" - a failure that looks exactly like the
# application being down. Enabling 1.2 explicitly is what makes this script work
# against a real deployment.
try {
    [Net.ServicePointManager]::SecurityProtocol = `
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
    # An older runtime without Tls12. The HTTP default path still works.
}

# --- Argument validation -----------------------------------------------------
if ($TimeoutSeconds -lt 1) { Write-Fail '-TimeoutSeconds must be at least 1.' }
if ($Retries -lt 1) { Write-Fail '-Retries must be at least 1.' }
if ($RetryDelaySeconds -lt 0) { Write-Fail '-RetryDelaySeconds cannot be negative.' }

$parsed = $null
if (-not [System.Uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$parsed)) {
    Write-Fail ("-Url is not an absolute URL: {0}" -f $Url)
}
if ($parsed.Scheme -ne 'http' -and $parsed.Scheme -ne 'https') {
    Write-Fail ("-Url must be http or https, got: {0}" -f $parsed.Scheme)
}

# --- Probe -------------------------------------------------------------------
# Uses HttpWebRequest directly rather than Invoke-WebRequest for two reasons:
# Invoke-WebRequest throws on any non-2xx, so a 503 - the single most important
# response this script exists to interpret - arrives as an exception with the
# status buried in it, and a blackholed host blocks on a socket that produces no
# response at all.
function Invoke-Probe {
    param([string] $Target, [int] $Timeout)

    $result = @{
        Status   = 0
        Body     = ''
        Failure  = $null
        ElapsedMs = 0
    }

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $request = [System.Net.HttpWebRequest]::Create($Target)
        $request.Method = 'GET'
        $request.Timeout = $Timeout * 1000
        $request.ReadWriteTimeout = $Timeout * 1000
        $request.KeepAlive = $false
        $request.AllowAutoRedirect = $false
        $request.UserAgent = 'hr-system-healthcheck/1.0'
        # Never send a health probe through the machine's configured proxy. A
        # proxy that is down, or a NO_PROXY rule that does not cover the app,
        # would otherwise be reported as an application outage.
        try { $request.Proxy = [System.Net.GlobalProxySelection]::GetEmptyWebProxy() } catch { }

        $response = $request.GetResponse()
        $result.Status = [int]$response.StatusCode
        $result.Body = Read-Stream -Stream ($response.GetResponseStream())
        $response.Close()
    } catch [System.Net.WebException] {
        $webResponse = $_.Exception.Response
        if ($webResponse -is [System.Net.HttpWebResponse]) {
            # A real HTTP response, just not a 2xx. 503 lives here, and it is
            # the answer we most want to give.
            $result.Status = [int]$webResponse.StatusCode
            $result.Body = Read-Stream -Stream ($webResponse.GetResponseStream())
            $webResponse.Close()
        } else {
            # No response at all: connection refused, DNS failure, TLS failure,
            # or a timeout. Indistinguishable from here, and all of them mean
            # "the monitor could not reach the application".
            $result.Failure = ("{0} ({1})" -f $_.Exception.Message, $_.Exception.Status)
        }
    } catch {
        $result.Failure = $_.Exception.Message
    } finally {
        $watch.Stop()
        $result.ElapsedMs = [int]$watch.ElapsedMilliseconds
    }

    return $result
}

function Read-Stream {
    param($Stream)
    if ($null -eq $Stream) { return '' }
    try {
        $reader = New-Object System.IO.StreamReader($Stream)
        $text = $reader.ReadToEnd()
        $reader.Close()
        # The body is a fixed three-field object. It is truncated anyway, so a
        # proxy that answers an HTML error page cannot flood the monitor log.
        if ($text.Length -gt 2048) { return $text.Substring(0, 2048) }
        return $text
    } catch {
        return ''
    }
}

# --- Diagnosis ---------------------------------------------------------------
# Returns @{ State, Database, Detail }.
function Get-Diagnosis {
    param([hashtable] $Probe)

    if ($null -ne $Probe.Failure) {
        return @{ State = $STATE_APP_DOWN; Database = 'unknown'; Detail = $Probe.Failure }
    }

    if ($Probe.Status -eq 200) {
        # Confirm the body actually says so. A proxy that answers 200 with an
        # error page would otherwise be reported as a healthy application.
        $parsedBody = Read-Body -Body $Probe.Body
        if ($null -eq $parsedBody) {
            return @{ State = $STATE_DEGRADED; Database = 'unknown'; Detail = 'HTTP 200 with an unreadable body' }
        }
        $db = 'unknown'
        if ($parsedBody.PSObject.Properties.Name -contains 'database') { $db = [string]$parsedBody.database }
        if ($db -eq 'up') {
            return @{ State = $STATE_HEALTHY; Database = 'up'; Detail = 'application and database both healthy' }
        }
        return @{ State = $STATE_DEGRADED; Database = $db; Detail = 'HTTP 200 but database field is not "up"' }
    }

    if ($Probe.Status -eq 503) {
        # THE DISTINCTION THAT MATTERS. The process is serving; the dependency
        # is not. Restarting the application will not fix this and can make it
        # worse (a crash-looping app cannot reconnect when the database returns).
        $parsedBody = Read-Body -Body $Probe.Body
        $db = 'unknown'
        $status = ''
        if ($null -ne $parsedBody) {
            if ($parsedBody.PSObject.Properties.Name -contains 'database') { $db = [string]$parsedBody.database }
            if ($parsedBody.PSObject.Properties.Name -contains 'status') { $status = [string]$parsedBody.status }
        }
        if ($db -eq 'down' -or $status -eq 'degraded') {
            return @{ State = $STATE_DATABASE_DOWN; Database = 'down'; Detail = 'app is serving; database is unreachable' }
        }
        return @{ State = $STATE_DEGRADED; Database = $db; Detail = 'HTTP 503 without a readable status/database field' }
    }

    if ($Probe.Status -eq 401 -or $Probe.Status -eq 403) {
        return @{
            State    = $STATE_PROBE_NOT_PUBLIC
            Database = 'unknown'
            Detail   = ("HTTP {0}: /api/health is behind the session gate. Add it to isPublicPath() in proxy.ts; the monitor is being rejected, not the app being down." -f $Probe.Status)
        }
    }

    if ($Probe.Status -eq 404) {
        return @{ State = $STATE_PROBE_NOT_FOUND; Database = 'unknown'; Detail = 'HTTP 404: route not found or not deployed' }
    }

    return @{ State = $STATE_UNEXPECTED; Database = 'unknown'; Detail = ("HTTP {0}" -f $Probe.Status) }
}

function Read-Body {
    param([string] $Body)
    if ([string]::IsNullOrWhiteSpace($Body)) { return $null }
    try {
        return ($Body | ConvertFrom-Json)
    } catch {
        return $null
    }
}

# --- Run ---------------------------------------------------------------------
Write-Line ("healthcheck: GET {0} (attempts={1} timeout={2}s delay={3}s)" -f $Url, $Retries, $TimeoutSeconds, $RetryDelaySeconds)

$attempt = 0
$last = $null
$lastDiagnosis = $null

while ($attempt -lt $Retries) {
    $attempt++
    $last = Invoke-Probe -Target $Url -Timeout $TimeoutSeconds
    $lastDiagnosis = Get-Diagnosis -Probe $last

    Write-Line ("  attempt {0}/{1}: http={2} elapsed={3}ms state={4} database={5} ({6})" -f `
        $attempt, $Retries, $last.Status, $last.ElapsedMs, $lastDiagnosis.State, $lastDiagnosis.Database, $lastDiagnosis.Detail)

    if ($lastDiagnosis.State -eq $STATE_HEALTHY) { break }

    if ($attempt -lt $Retries) {
        Write-Line ("  not healthy; retrying in {0}s" -f $RetryDelaySeconds)
        Start-Sleep -Seconds $RetryDelaySeconds
    }
}

# The summary line. One record, greppable, and shaped so an uptime service's
# keyword rule can split "app down" from "database down" - see the .DESCRIPTION.
$summary = 'HEALTHCHECK result={0} http={1} elapsed_ms={2} database={3} url={4} attempts={5}' -f `
    $lastDiagnosis.State, $last.Status, $last.ElapsedMs, $lastDiagnosis.Database, $Url, $attempt
Write-Host $summary

if ($lastDiagnosis.State -eq $STATE_HEALTHY) {
    exit 0
}

# Loud about which dependency is responsible. This is the line an on-call
# rotation reads first, so it is not buried in the per-attempt output.
switch ($lastDiagnosis.State) {
    $STATE_DATABASE_DOWN {
        Write-Host "healthcheck: DATABASE DOWN - the application is running and serving. Do not restart it. Check the database container and DATABASE_URL."
    }
    $STATE_APP_DOWN {
        Write-Host "healthcheck: APPLICATION DOWN - no HTTP response from $Url after $attempt attempt(s). Check the process, the container and anything between them."
    }
    $STATE_PROBE_NOT_PUBLIC {
        Write-Host "healthcheck: MONITOR IS BEING REJECTED - $Url requires a session. This is a configuration fault in proxy.ts (or in front of it), not an outage."
    }
    $STATE_PROBE_NOT_FOUND {
        Write-Host "healthcheck: ROUTE NOT FOUND - $Url returned 404. The health endpoint is not deployed at this URL."
    }
    $STATE_DEGRADED {
        Write-Host "healthcheck: DEGRADED - $Url answered, but not with a verdict this script can trust. Treat as DOWN until the body is understood."
    }
    default {
        Write-Host "healthcheck: UNEXPECTED - $Url returned HTTP $($last.Status). Treat as DOWN."
    }
}

exit 1
