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
    ECHO [ACTION] .env contains PLACEHOLDERS. Edit it and set:
    ECHO           DATABASE_URL, DIRECT_URL, AUTH_SECRET
    ECHO         The app cannot start until AUTH_SECRET is a real value.
    ECHO.
    PAUSE
    EXIT /B 1
)

REM ==============================================================
REM  2. AUTH_SECRET CHECK
REM
REM  A placeholder secret is the single most common cause of
REM  "no matching decryption secret" on every request. Detect it
REM  rather than letting it fail mysteriously at runtime.
REM ==============================================================
FINDSTR /C:"secret-key-generated-by-launcher" ".env" >NUL
IF NOT ERRORLEVEL 1 (
    ECHO [ERROR] .env still contains the placeholder AUTH_SECRET.
    ECHO         Generate a real one:
    ECHO           node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    ECHO         then replace the AUTH_SECRET line in .env.
    ECHO.
    PAUSE
    EXIT /B 1
)

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
