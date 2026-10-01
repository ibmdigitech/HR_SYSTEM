@echo off
:: ================================================================
::  IBM DIGITECH HRMS - ONE-CLICK LAUNCHER
::  (This file is marked with '___' to stay at the top of your folder)
:: ================================================================
TITLE IBM HRMS Launcher
COLOR 0A
CLS

ECHO --------------------------------------------------------------
ECHO      STARTING IBM DIGITECH HRMS
ECHO --------------------------------------------------------------
ECHO.

:: Ensure we are in the correct directory
CD /D "%~dp0"

:: 1. CHECK ENVIRONMENT VARIABLES
IF NOT EXIST ".env" (
    ECHO [SETUP] Creating .env file...
    REM The AUTH_SECRET used to be the literal
    REM "secret-key-generated-by-launcher", which is a public constant:
    REM it is in git history and it decrypts nothing but forges
    REM everything. It is now 32 bytes from the OS CSPRNG.
    REM
    REM HEX, not base64: base64 emits '+', '/' and '=', and cmd treats
    REM '+' and '=' as metacharacters, so a base64 secret has to be
    REM escaped through two parsers to survive this file. [0-9A-F]
    REM collides with nothing, and 64 hex characters is a lossless
    REM encoding of the same 32 bytes. The command below deliberately
    REM contains no '%', '!', '&', '|', '<', '>' or '^'.
    powershell -NoProfile -Command "$b = New-Object byte[] 32; $r = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $r.GetBytes($b); $r.Dispose(); $h = [System.BitConverter]::ToString($b).Replace('-',''); if (($h.Length -ne 64) -or ($h -notmatch '^[0-9A-F]{64}$')) { exit 1 }; [System.IO.File]::WriteAllText('.env', 'DATABASE_URL=file:./dev.db' + [Environment]::NewLine + 'AUTH_SECRET=' + $h + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))"
    IF ERRORLEVEL 1 GOTO SECRET_FAIL
    ECHO [SETUP] .env created with a random 256-bit AUTH_SECRET.
)

:: 2. REFUSE TO START WITHOUT A USABLE SECRET
FINDSTR /C:"AUTH_SECRET=" ".env" >NUL
IF ERRORLEVEL 1 GOTO SECRET_FAIL
GOTO SECRET_OK

:SECRET_FAIL
ECHO [ERROR] .env has no usable AUTH_SECRET. Generate one with:
ECHO           node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ECHO           openssl rand -hex 32
ECHO         then add AUTH_SECRET=... to .env and run this file again.
PAUSE
EXIT /B 1

:SECRET_OK

:: 3. INSTALL DEPENDENCIES (Only if missing)
IF NOT EXIST "node_modules" (
    ECHO [SETUP] Installing modules...
    call npm install --legacy-peer-deps
)

:: 4. DATABASE SYNC & SEED
ECHO [SETUP] Syncing Database...
call npx prisma generate
call npx prisma db push
call node scripts/seed-standalone.js

:: 5. LAUNCH SERVER
ECHO.
ECHO [SUCCESS] App is running at: http://localhost:3000
call npm run dev
PAUSE