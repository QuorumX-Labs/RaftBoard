@echo off
:: scripts\test-hotreload.bat — Hot-reload zero-downtime test (Windows)
::
:: Appends a harmless comment to replica1\src\index.js
:: nodemon inside the container detects the change and restarts replica1.
:: The test verifies the gateway stays healthy throughout.
::
:: Requires: docker, curl

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"

set "BASE=http://localhost"
set "GATEWAY=%BASE%:4000"
set "SRC=%ROOT_DIR%\replica1\src\index.js"

echo.
echo ============================================================
echo   Hot-Reload Zero-Downtime Test  [Windows]
echo ============================================================
echo.

:: ── Helper: get role ─────────────────────────────────────────────────────────
goto :main
:get_role
    set "%~2=down"
    curl -sf "%BASE%:%~1/health" -o "%TEMP%\raft_hr.json" 2>nul
    if errorlevel 1 goto :eof
    for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write(d.role||'?')}catch(e){process.stdout.write('?')}" "%TEMP%\raft_hr.json" 2^>nul') do set "%~2=%%V"
    goto :eof

:main

:: ── Baseline ─────────────────────────────────────────────────────────────────
echo [STEP 1] Baseline cluster state:
call :get_role 5001 R1 & echo   replica1 - !R1!
call :get_role 5002 R2 & echo   replica2 - !R2!
call :get_role 5003 R3 & echo   replica3 - !R3!
curl -sf "%GATEWAY%/health" -o "%TEMP%\gw.json" 2>nul
for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write(d.status||'?')}catch(e){process.stdout.write('?')}" "%TEMP%\gw.json" 2^>nul') do set "GW_STATUS=%%V"
echo   gateway  - !GW_STATUS!
echo.

:: ── Check source file exists ──────────────────────────────────────────────────
if not exist "%SRC%" (
    echo [ERROR] Source file not found: %SRC%
    echo         Run scripts\prepare.bat first.
    exit /b 1
)

:: ── Trigger hot-reload ────────────────────────────────────────────────────────
echo [STEP 2] Triggering hot-reload on replica1 ...
echo           Appending comment to: replica1\src\index.js

:: Append a timestamp comment — harmless, no logic change
echo.>> "%SRC%"
echo // [hot-reload-test] %DATE% %TIME%>> "%SRC%"

echo   File touched. nodemon inside raft-replica1 will restart automatically.
echo.

:: ── Poll gateway during restart ───────────────────────────────────────────────
echo [STEP 3] Gateway health DURING replica1 restart (3 polls x 1s):
for /l %%i in (1,1,3) do (
    timeout /t 1 /nobreak >nul
    curl -sf "%GATEWAY%/health" >nul 2>nul
    if errorlevel 1 (
        echo   Poll %%i: GATEWAY DOWN
    ) else (
        echo   Poll %%i: gateway OK
    )
)
echo.

:: ── Wait for replica1 to rejoin ───────────────────────────────────────────────
echo [STEP 4] Waiting for replica1 to rejoin (max 10s)...
set "REJOINED=0"
for /l %%i in (1,1,10) do (
    if !REJOINED!==0 (
        timeout /t 1 /nobreak >nul
        call :get_role 5001 ROLE
        if not "!ROLE!"=="down" (
            echo   replica1 rejoined as: !ROLE!
            set "REJOINED=1"
        )
    )
)
if !REJOINED!==0 echo   WARN  replica1 did not rejoin within 10s
echo.

:: ── Final state ───────────────────────────────────────────────────────────────
echo [STEP 5] Final cluster state after hot-reload:
call :get_role 5001 R1 & echo   replica1 - !R1!
call :get_role 5002 R2 & echo   replica2 - !R2!
call :get_role 5003 R3 & echo   replica3 - !R3!
curl -sf "%GATEWAY%/leader" -o "%TEMP%\ldr.json" 2>nul
for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write('leader='+String(d.leader||'?'))}catch(e){process.stdout.write('?')}" "%TEMP%\ldr.json" 2^>nul') do echo   gateway  - %%V
echo.
echo   Hot-reload test complete.
echo   Check RAFT dashboard: http://localhost:6001
echo.

endlocal
exit /b 0
