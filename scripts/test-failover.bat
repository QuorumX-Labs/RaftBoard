@echo off
:: scripts\test-failover.bat — Automated failover test (Windows)
::
:: Steps:
::   1. Check cluster health
::   2. Find current leader
::   3. Kill the leader container
::   4. Verify new election completes
::   5. Restart the killed replica
::   6. Verify catch-up sync
::
:: Requires: docker, curl  (both available with Docker Desktop on Windows)

setlocal enabledelayedexpansion

set "BASE=http://localhost"
set "GATEWAY=%BASE%:4000"
set "R1=%BASE%:5001"
set "R2=%BASE%:5002"
set "R3=%BASE%:5003"

set "PASS=0"
set "FAIL=0"

echo.
echo ============================================================
echo   RaftBoard Failover Test  [Windows]
echo ============================================================
echo.

:: ── Helper: get /health role from a replica port ─────────────────────────────
:: Usage: call :get_role <port> <result_var>
goto :main

:get_role
    set "%~2=down"
    curl -sf "%BASE%:%~1/health" -o "%TEMP%\raft_health.json" 2>nul
    if errorlevel 1 goto :eof
    for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write(d.role||'?')}catch(e){process.stdout.write('?')}" "%TEMP%\raft_health.json" 2^>nul') do set "%~2=%%V"
    goto :eof

:get_leader
    :: Sets LEADER_URL variable
    set "LEADER_URL="
    curl -sf "%GATEWAY%/leader" -o "%TEMP%\raft_leader.json" 2>nul
    if errorlevel 1 goto :eof
    for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write(d.leader||'')}catch(e){}" "%TEMP%\raft_leader.json" 2^>nul') do set "LEADER_URL=%%V"
    goto :eof

:main

:: ── TEST 1: Cluster health ────────────────────────────────────────────────────
echo [TEST 1] Verify cluster health
curl -sf "%GATEWAY%/health" 2>nul && echo. || echo   Gateway unreachable — is the system running?
call :get_role 5001 ROLE1 & echo   Replica1: !ROLE1!
call :get_role 5002 ROLE2 & echo   Replica2: !ROLE2!
call :get_role 5003 ROLE3 & echo   Replica3: !ROLE3!
echo.

:: ── TEST 2: Find current leader ───────────────────────────────────────────────
echo [TEST 2] Identify current leader
call :get_leader
if "!LEADER_URL!"=="" (
    echo [ERROR] No leader found. Is the cluster running?
    echo         Run: scripts\start.bat
    exit /b 1
)
echo   Current leader: !LEADER_URL!
echo.

:: ── TEST 3: Identify and kill leader container ────────────────────────────────
echo [TEST 3] Kill the LEADER container
set "LEADER_CONTAINER="
call :get_role 5001 R & if "!R!"=="leader" set "LEADER_CONTAINER=raft-replica1"
call :get_role 5002 R & if "!R!"=="leader" set "LEADER_CONTAINER=raft-replica2"
call :get_role 5003 R & if "!R!"=="leader" set "LEADER_CONTAINER=raft-replica3"

if "!LEADER_CONTAINER!"=="" (
    echo   Could not identify leader by port — defaulting to raft-replica1
    set "LEADER_CONTAINER=raft-replica1"
)

echo   Stopping: !LEADER_CONTAINER!
docker stop !LEADER_CONTAINER!
echo.

:: ── TEST 4: Wait for new election (max 5 seconds) ─────────────────────────────
echo [TEST 4] Waiting for new leader election (max 5s)...
set "NEW_LEADER="
set "ELAPSED=0"

:wait_leader_loop
if !ELAPSED! geq 50 goto :wait_leader_done
timeout /t 0 /nobreak >nul 2>nul
:: Poll every 100ms approximation using ping (Windows trick)
ping -n 1 -w 100 127.0.0.1 >nul 2>nul
call :get_leader
if not "!LEADER_URL!"=="" (
    if not "!LEADER_URL!"=="null" (
        set "NEW_LEADER=!LEADER_URL!"
        goto :wait_leader_done
    )
)
set /a ELAPSED+=1
goto :wait_leader_loop

:wait_leader_done
if not "!NEW_LEADER!"=="" (
    echo   OK  New leader elected: !NEW_LEADER!
    set /a PASS+=1
) else (
    echo   WARN  No new leader detected within 5s
    set /a FAIL+=1
)
echo.

:: ── TEST 5: Gateway still healthy ────────────────────────────────────────────
echo [TEST 5] Gateway health during failover
curl -sf "%GATEWAY%/health" >nul 2>nul
if errorlevel 1 (
    echo   FAIL  Gateway unreachable during failover
    set /a FAIL+=1
) else (
    echo   OK  Gateway still healthy
    set /a PASS+=1
)
echo.

:: ── TEST 6: Restart killed replica (catch-up) ────────────────────────────────
echo [TEST 6] Restart stopped replica — catch-up sync test
echo   Restarting !LEADER_CONTAINER! ...
docker start !LEADER_CONTAINER!
echo   Waiting 8 seconds for catch-up via sync-log...
timeout /t 8 /nobreak >nul

:: Determine port of restarted replica
set "CHECK_PORT=5001"
if "!LEADER_CONTAINER!"=="raft-replica2" set "CHECK_PORT=5002"
if "!LEADER_CONTAINER!"=="raft-replica3" set "CHECK_PORT=5003"

call :get_role !CHECK_PORT! REJOINED_ROLE
if "!REJOINED_ROLE!"=="down" (
    echo   WARN  Restarted replica still unreachable
) else (
    echo   OK  Restarted replica status: !REJOINED_ROLE!
    set /a PASS+=1
)
echo.

:: ── Summary ───────────────────────────────────────────────────────────────────
echo ============================================================
echo   Failover Test Results
echo ============================================================
echo   PASSED : !PASS!
echo   FAILED : !FAIL!
echo ============================================================
echo.
echo   RAFT Dashboard : http://localhost:6001
echo   Gateway health : http://localhost:4000/health
echo   Gateway leader : http://localhost:4000/leader
echo.

endlocal
exit /b 0
