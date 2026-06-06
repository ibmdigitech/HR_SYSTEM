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
    (
        ECHO MONGODB_URI="mongodb+srv://<username>:<password>@cluster0.mongodb.net/hr-system?retryWrites=true&w=majority"
        ECHO AUTH_SECRET="secret-key-generated-by-launcher"
    ) > .env
)

:: 2. INSTALL DEPENDENCIES (Only if missing)
IF NOT EXIST "node_modules" (
    ECHO [SETUP] Installing modules...
    call npm install --legacy-peer-deps
)

:: 3. DATABASE SYNC & SEED
ECHO [SETUP] Syncing Database...
call npx prisma generate
call npx prisma db push
call node scripts/seed-standalone.js

:: 4. LAUNCH SERVER
ECHO.
ECHO [SUCCESS] App is running at: http://localhost:3000
call npm run dev
PAUSE