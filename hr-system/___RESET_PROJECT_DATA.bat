@echo off
TITLE IBM HRMS - RESET TOOL
COLOR 4F
CLS
ECHO ==============================================================
ECHO    WARNING: THIS WILL DELETE ALL DATA AND RESET THE APP
ECHO ==============================================================
ECHO.
ECHO Actions to be performed:
ECHO  1. Delete database (dev.db) - ALL DATA WILL BE LOST
ECHO  2. Delete node_modules (Clean install)
ECHO  3. Delete .next build folder
ECHO.
SET /P AREYOUSURE=Are you sure you want to proceed? (Y/[N]): 
IF /I "%AREYOUSURE%" NEQ "Y" GOTO END

ECHO.
ECHO [1/3] Deleting Database...
IF EXIST "dev.db" DEL /F /Q "dev.db"

ECHO [2/3] Deleting Build Cache...
IF EXIST ".next" RMDIR /S /Q ".next"

ECHO [3/3] Deleting Dependencies...
IF EXIST "node_modules" RMDIR /S /Q "node_modules"

ECHO.
ECHO [DONE] Project reset. Run '___RUN_APP_CLICK_ME.bat' to reinstall.
PAUSE
EXIT

:END
ECHO [CANCELLED] No changes made.
PAUSE