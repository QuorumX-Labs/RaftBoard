@echo off
:: scripts\start.bat — Start the full RaftBoard system (Windows)
::
:: 1. Runs prepare.bat to copy original files into build contexts
:: 2. Runs docker-compose up --build -d
:: 3. Waits for cluster to stabilise
:: 4. Prints all access URLs
::
:: Usage:
::   scripts\start.bat
::   scripts\start.bat ..\RaftBoard-main

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"

if "%~1"=="" (
    for %%I in ("%ROOT_DIR%\..\RaftBoard-main") do set "ORIG=%%~fI"
) else (
    set "ORIG=%~f1"
)

echo.
echo ============================================================
echo   RaftBoard — Starting Distributed Drawing Board  [Windows]
echo ============================================================
echo.

:: ── Step 1: Prepare (copy original files if gateway\core missing) ─────────────
if not exist "%ROOT_DIR%\gateway\core\server.js" (
    echo Running prepare step first...
    call "%SCRIPT_DIR%prepare.bat" "%ORIG%"
    if errorlevel 1 (
        echo [ERROR] Prepare step failed. Aborting.
        exit /b 1
    )
) else (
    echo   gateway\core already populated — skipping prepare.
)

:: ── Step 2: Build and start ───────────────────────────────────────────────────
echo.
echo Building and starting containers...
cd /d "%ROOT_DIR%"
docker-compose up --build -d
if errorlevel 1 (
    echo [ERROR] docker-compose failed.
    exit /b 1
)

:: ── Step 3: Wait ─────────────────────────────────────────────────────────────
echo.
echo Waiting 15 seconds for cluster to stabilise...
timeout /t 15 /nobreak >nul

:: ── Step 4: Quick health check ────────────────────────────────────────────────
echo.
echo Checking gateway health...
curl -sf http://localhost:4000/health 2>nul || echo   (gateway not ready yet — give it a few more seconds)

echo.
echo ============================================================
echo   System URLs
echo ============================================================
echo   Drawing Board   :  http://localhost:8080
echo   Gateway WS      :  ws://localhost:4000
echo   Gateway Health  :  http://localhost:4000/health
echo   Gateway Leader  :  http://localhost:4000/leader
echo   RAFT Dashboard  :  http://localhost:6001
echo   Replica 1 status:  http://localhost:5001/status
echo   Replica 2 status:  http://localhost:5002/status
echo   Replica 3 status:  http://localhost:5003/status
echo ============================================================
echo.
echo   View logs : docker-compose logs -f
echo   Stop      : docker-compose down
echo.

endlocal
exit /b 0
