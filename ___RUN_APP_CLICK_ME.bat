@echo off
:: ================================================================
::  IBM DIGITECH HRMS - ONE-CLICK LAUNCHER
::  (Named with a leading '___' so it sorts to the top of the folder)
:: ================================================================
TITLE IBM DIGITECH HRMS Launcher
COLOR 0A

:: Ensure we are in the correct directory
CD /D "%~dp0"

ECHO ==============================================================
ECHO      IBM DIGITECH HRMS - LAUNCHER
ECHO ==============================================================
ECHO.

REM ==============================================================
REM  1. ENVIRONMENT FILE
REM
REM  This step previously wrote a hardcoded MONGODB_URI and the literal
REM  AUTH_SECRET "secret-key-generated-by-launcher". Both were wrong:
REM  prisma/schema.prisma declares provider = "postgresql", so a
REM  MongoDB URL makes `prisma db push` fail, and the placeholder
REM  secret makes every session fail to decrypt
REM  (JWTSessionError: no matching decryption secret).
REM
REM  It now copies .env.example, which contains placeholders only.
REM ==============================================================
IF NOT EXIST ".env" (
    ECHO [SETUP] No .env found - creating from .env.example
    IF EXIST ".env.example" (
        copy /Y ".env.example" ".env" >NUL
        ECHO [SETUP] .env created from .env.example
    ) ELSE (
        ECHO [ERROR] .env.example is missing. Cannot create .env.
        ECHO         Copy the values from the README and try again.
        PAUSE
        EXIT /B 1
    )
    ECHO [ACTION] .env was created from .env.example.
    ECHO           Set DATABASE_URL and DIRECT_URL to your PostgreSQL
    ECHO           connection string. AUTH_SECRET is generated for you
    ECHO           in the next step.
    ECHO.
    PAUSE
    EXIT /B 1
)

REM ==============================================================
REM  2. AUTH_SECRET
REM
REM  A placeholder secret is the single most common cause of
REM  "no matching decryption secret" on every request, and a
REM  predictable one is worse than no secret at all.
REM
REM  The value now comes from a real CSPRNG, never from Get-Random:
REM     [System.Security.Cryptography.RandomNumberGenerator]
REM     .Create().GetBytes(32)
REM  which yields 32 bytes - 256 bits - of OS entropy.
REM
REM  Those bytes are printed as 64 HEX characters, deliberately.
REM  Base64 output contains '+', '/' and '='; '+' and '=' are cmd
REM  metacharacters, so a base64 secret has to be escaped through
REM  two parsers (cmd, then PowerShell) before it can reach .env,
REM  and a single missed escape silently corrupts it. [0-9A-F]
REM  collides with nothing in cmd, PowerShell, dotenv, or a cookie
REM  value, and 64 hex characters is a lossless encoding of the
REM  same 32 bytes, so no entropy is lost by not using base64.
REM
REM  One PowerShell call does inspect -> generate -> write -> verify
REM  and reports the outcome through ERRORLEVEL. The secret never
REM  passes through a cmd variable, a command line, or an echo, so
REM  there is nothing for a metacharacter to corrupt.
REM
REM  The refusal behaviour is preserved and strengthened: a secret
REM  that is still a placeholder, is missing, or is under 32
REM  characters exits non-zero and the launcher does not start. That
REM  subsumes the old FINDSTR check for the literal
REM  "secret-key-generated-by-launcher".
REM
REM  EDITING NOTE: the command below is deliberately free of '%' and
REM  '!' - cmd expands those even inside double quotes - and of '&',
REM  '|', '<', '>' and '^'. Keep it that way. Build characters with
REM  [char]34 and [char]39; a literal quote would end the cmd string.
REM ==============================================================
powershell -NoProfile -Command "function Get-Secret([string[]]$lines) { $m = @($lines -match '^[ \t]*AUTH_SECRET[ \t]*='); if ($m.Count -eq 0) { return '' }; ($m[0] -split '=', 2)[1].Trim().Trim([char]34).Trim([char]39) }; function Test-Ph([string]$s) { (($s -eq '') -or ($s -like '*REPLACE_WITH*') -or ($s -like '*secret-key-generated-by-launcher*') -or ($s -like '*CHANGE_ME*') -or ($s -like '*CHANGE-ME*')) }; $f = '.env'; if (-not (Test-Path -LiteralPath $f)) { Write-Host '[ERROR] .env not found.'; exit 1 }; $v = Get-Secret @(Get-Content -LiteralPath $f); if (Test-Ph $v) { $b = New-Object byte[] 32; $r = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $r.GetBytes($b); $r.Dispose(); $h = [System.BitConverter]::ToString($b).Replace('-',''); if (($h.Length -ne 64) -or ($h -notmatch '^[0-9A-F]{64}$')) { Write-Host '[ERROR] CSPRNG returned an unusable value.'; exit 1 }; $n = 'AUTH_SECRET=' + $h; $t = [System.IO.File]::ReadAllText($f); if ($t -match '(?m)^[ \t]*AUTH_SECRET[ \t]*=') { $t = [regex]::Replace($t, '(?m)^[ \t]*AUTH_SECRET[ \t]*=.*$', $n) } else { $t = $t + [Environment]::NewLine + $n + [Environment]::NewLine }; [System.IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding $false)); Write-Host '[SETUP] Generated a new AUTH_SECRET (32 CSPRNG bytes, 256 bits).' } elseif ($v.Length -lt 32) { Write-Host '[ERROR] AUTH_SECRET in .env is shorter than 32 characters.'; exit 1 } else { Write-Host '[SETUP] Using the AUTH_SECRET already in .env.' }; $v = Get-Secret @(Get-Content -LiteralPath $f); if ((Test-Ph $v) -or ($v.Length -lt 32)) { Write-Host '[ERROR] AUTH_SECRET is not usable.'; exit 1 }; exit 0"
IF ERRORLEVEL 1 GOTO AUTH_SECRET_FAIL
GOTO AUTH_SECRET_OK

:AUTH_SECRET_FAIL
ECHO [ERROR] AUTH_SECRET in .env is missing, is still a placeholder, or
ECHO         is shorter than 32 characters. The app will not start
ECHO         with a secret that weak or known.
ECHO.
ECHO         Generate a real one with a CSPRNG, then put it in .env:
ECHO           powershell -NoProfile -Command "$b=New-Object byte[] 32;
ECHO             [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);
ECHO             [System.BitConverter]::ToString($b).Replace('-','')"
ECHO           node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ECHO           openssl rand -hex 32
ECHO.
PAUSE
EXIT /B 1

:AUTH_SECRET_OK
REM Intentionally falls through to the MongoDB guard below.

REM Warn on a MongoDB URL: the schema is PostgreSQL.
FINDSTR /C:"mongodb" ".env" >NUL
IF NOT ERRORLEVEL 1 (
    ECHO [ERROR] .env contains a MongoDB URL, but prisma/schema.prisma
    ECHO         declares provider = "postgresql". Remove MONGODB_URI and
    ECHO         set DATABASE_URL to a postgresql:// connection string.
    ECHO.
    PAUSE
    EXIT /B 1
)

REM ==============================================================
REM  3. DEPENDENCIES
REM ==============================================================
IF NOT EXIST "node_modules" (
    ECHO [SETUP] Installing dependencies. This can take a few minutes...
    call npm install --legacy-peer-deps
    IF NOT ERRORLEVEL 0 (
        ECHO [ERROR] npm install failed.
        PAUSE
        EXIT /B 1
    )
)

REM ==============================================================
REM  4. DATABASE
REM
REM  The database is PostgreSQL in a Docker container. Docker Desktop
REM  crashes intermittently on this machine, so container state is
REM  not proof the port is published - reachability is checked below.
REM ==============================================================
ECHO [SETUP] Checking Docker...
docker ps >NUL 2>&1
IF NOT ERRORLEVEL 0 (
    ECHO [SETUP] Docker is not running.
    ECHO        Starting Docker Desktop - this takes about a minute...
    START "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    IF ERRORLEVEL 1 (
        START "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
    )
    ECHO [SETUP] Waiting for the Docker engine...
    SET /A TRIES=0
    :WAIT_DOCKER
    docker ps >NUL 2>&1
    IF NOT ERRORLEVEL 0 (
        SET /A TRIES+=1
        IF %TRIES% GEQ 60 (
            ECHO [ERROR] Docker did not start within 5 minutes.
            ECHO         Start Docker Desktop and run this file again.
            PAUSE
            EXIT /B 1
        )
        TIMEOUT /T 5 /NOBREAK >NUL
        GOTO WAIT_DOCKER
    )
    ECHO        Docker is ready.
)

ECHO [SETUP] Ensuring the database container is running...
docker ps -a --filter "name=hr-postgres" --format "{{.Names}}" | findstr /C:"hr-postgres" >NUL
IF ERRORLEVEL 1 (
    ECHO [SETUP] Creating the hr-postgres container...
    docker run -d --name hr-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hr_system -p 5433:5432 postgres:16 >NUL
    IF ERRORLEVEL 1 (
        ECHO [ERROR] Could not create the container.
        ECHO         If a stale container exists, run:
        ECHO           docker rm -f hr-postgres
        PAUSE
        EXIT /B 1
    )
    ECHO [SETUP] First start initialises the database, giving it 15 seconds...
    TIMEOUT /T 15 /NOBREAK >NUL
) ELSE (
    docker start hr-postgres >NUL 2>&1
)

REM The container can be up while the host port is still unreachable, so
REM verify connectivity rather than trusting container state.
ECHO [SETUP] Waiting for the database to accept connections on port 5433...
SET /A TRIES=0
:WAIT_DB
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port 5433 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }" >NUL 2>&1
IF NOT ERRORLEVEL 1 (
    ECHO        Database is reachable.
    GOTO DB_READY
)
SET /A TRIES+=1
IF %TRIES% GEQ 20 (
    ECHO [ERROR] The database is not reachable on port 5433.
    ECHO         Docker may have restarted without re-publishing the port.
    ECHO         Recreate it with:
    ECHO           docker rm -f hr-postgres
    ECHO           docker run -d --name hr-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hr_system -p 5433:5432 postgres:16
    ECHO.
    PAUSE
    EXIT /B 1
)
TIMEOUT /T 3 /NOBREAK >NUL
GOTO WAIT_DB

:DB_READY
ECHO [SETUP] Syncing the database schema...
call npx prisma generate
IF NOT ERRORLEVEL 0 (
    ECHO [ERROR] prisma generate failed.
    PAUSE
    EXIT /B 1
)
call npx prisma db push
IF NOT ERRORLEVEL 0 (
    ECHO [ERROR] prisma db push failed. Check DATABASE_URL in .env.
    PAUSE
    EXIT /B 1
)

ECHO [SETUP] Seeding reference data...
call node scripts/seed-standalone.js

ECHO.
ECHO ==============================================================
ECHO   READY - starting the server
ECHO   http://localhost:3000
ECHO ==============================================================
ECHO   Sign in with the seeded accounts, e.g.
ECHO     admin@company.com  /  the password you set
ECHO.
ECHO   If you have not set a password yet, use the activation
ECHO   flow rather than a shared default.
ECHO.
call npm run dev
PAUSE
