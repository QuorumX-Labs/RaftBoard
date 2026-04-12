@echo off
:: scripts\test-chaos.bat — Chaos / stress test (Windows)
::
:: Round 1: Kill a follower, inject entry, restart
:: Round 2: Kill the leader, verify election speed
:: Round 3: Rapid successive kills, verify recovery
::
:: Requires: docker, curl, node (for JSON parsing)

setlocal enabledelayedexpansion

set "BASE=http://localhost"
set "GATEWAY=%BASE%:4000"
set "PASS=0"
set "FAIL=0"

echo.
echo ============================================================
echo   RaftBoard Chaos Test  [Windows]
echo ============================================================
echo.

goto :main

:: ── Helper: get replica role by port ─────────────────────────────────────────
:get_role
    set "%~2=down"
    curl -sf "%BASE%:%~1/health" -o "%TEMP%\chaos_h.json" 2>nul
    if errorlevel 1 goto :eof
    for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write(d.role||'?')}catch(e){process.stdout.write('?')}" "%TEMP%\chaos_h.json" 2^>nul') do set "%~2=%%V"
    goto :eof

:: ── Helper: check gateway health ─────────────────────────────────────────────
:check_gateway
    set "%~1=fail"
    curl -sf "%GATEWAY%/health" -o "%TEMP%\chaos_gw.json" 2>nul
    if errorlevel 1 goto :eof
    for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write(d.status||'fail')}catch(e){process.stdout.write('fail')}" "%TEMP%\chaos_gw.json" 2^>nul') do set "%~1=%%V"
    goto :eof

:: ── Helper: get current leader URL ───────────────────────────────────────────
:get_leader
    set "%~1="
    curl -sf "%GATEWAY%/leader" -o "%TEMP%\chaos_ldr.json" 2>nul
    if errorlevel 1 goto :eof
    for /f "delims=" %%V in ('node -e "try{const d=require(process.argv[1]);process.stdout.write(d.leader||'')}catch(e){}" "%TEMP%\chaos_ldr.json" 2^>nul') do set "%~1=%%V"
    goto :eof

:main

:: ════════════════════════════════════════════════════════════════════
:: ROUND 1 — Kill a follower, inject entry, restart
:: ════════════════════════════════════════════════════════════════════
echo [ROUND 1] Kill a follower, inject entry, restart follower
echo.

set "FOLLOWER_CONTAINER="
for %%N in (1 2 3) do (
    call :get_role 500%%N ROLE
    if "!FOLLOWER_CONTAINER!"=="" (
        if "!ROLE!"=="follower" set "FOLLOWER_CONTAINER=raft-replica%%N"
    )
)

if "!FOLLOWER_CONTAINER!"=="" (
    echo   No follower found — skipping round 1
) else (
    echo   Stopping follower: !FOLLOWER_CONTAINER!
    docker stop !FOLLOWER_CONTAINER! >nul 2>nul
    timeout /t 1 /nobreak >nul

    call :check_gateway GW_R1
    if "!GW_R1!"=="ok" (
        echo   OK  Gateway healthy with follower down
        set /a PASS+=1
    ) else (
        echo   FAIL  Gateway unhealthy during follower outage
        set /a FAIL+=1
    )

    :: Inject an entry via leader
    call :get_leader LDR_URL
    if not "!LDR_URL!"=="" (
        curl -sf -X POST "!LDR_URL!/client-entry" ^
            -H "Content-Type: application/json" ^
            -d "{\"entry\":\"chaos-round1\"}" >nul 2>nul
        if errorlevel 1 (
            echo   FAIL  Entry injection failed
            set /a FAIL+=1
        ) else (
            echo   OK  Entry injected while follower was down
            set /a PASS+=1
        )
    ) else (
        echo   WARN  No leader URL to inject entry
    )

    echo   Restarting !FOLLOWER_CONTAINER! ...
    docker start !FOLLOWER_CONTAINER! >nul 2>nul
    timeout /t 5 /nobreak >nul
)
echo.

:: ════════════════════════════════════════════════════════════════════
:: ROUND 2 — Kill the leader, verify election
:: ════════════════════════════════════════════════════════════════════
echo [ROUND 2] Kill the LEADER, verify election completes
echo.

set "LEADER_CONTAINER="
set "LEADER_PORT="
for %%N in (1 2 3) do (
    call :get_role 500%%N ROLE
    if "!LEADER_CONTAINER!"=="" (
        if "!ROLE!"=="leader" (
            set "LEADER_CONTAINER=raft-replica%%N"
            set "LEADER_PORT=500%%N"
        )
    )
)

if "!LEADER_CONTAINER!"=="" (
    echo   Could not find leader — cluster may still be electing
    set /a FAIL+=1
) else (
    echo   Stopping leader: !LEADER_CONTAINER! (port !LEADER_PORT!)
    docker stop !LEADER_CONTAINER! >nul 2>nul

    :: Poll for new leader — up to 3 seconds (30 x 100ms)
    set "NEW_LEADER="
    for /l %%i in (1,1,30) do (
        if "!NEW_LEADER!"=="" (
            ping -n 1 -w 100 127.0.0.1 >nul 2>nul
            call :get_leader NL
            if not "!NL!"=="" (
                if not "!NL!"=="null" set "NEW_LEADER=!NL!"
            )
        )
    )

    if not "!NEW_LEADER!"=="" (
        echo   OK  New leader elected: !NEW_LEADER!
        set /a PASS+=1
    ) else (
        echo   WARN  No new leader detected within 3s
        set /a FAIL+=1
    )

    echo   Restarting !LEADER_CONTAINER! for catch-up...
    docker start !LEADER_CONTAINER! >nul 2>nul
    timeout /t 7 /nobreak >nul

    call :get_role !LEADER_PORT! REJOINED
    echo   Rejoined as: !REJOINED!
)
echo.

:: ════════════════════════════════════════════════════════════════════
:: ROUND 3 — Rapid successive kills
:: ════════════════════════════════════════════════════════════════════
echo [ROUND 3] Rapid successive kills
echo.

for %%C in (raft-replica1 raft-replica2) do (
    echo   Stopping %%C for 3s...
    docker stop %%C >nul 2>nul
    timeout /t 3 /nobreak >nul
    call :check_gateway GW_R3
    echo     Gateway during kill of %%C: !GW_R3!
    docker start %%C >nul 2>nul
    timeout /t 4 /nobreak >nul
)

call :check_gateway GW_FINAL
if "!GW_FINAL!"=="ok" (
    echo   OK  Gateway recovered from rapid kills
    set /a PASS+=1
) else (
    echo   FAIL  Gateway did not recover
    set /a FAIL+=1
)
echo.

:: ── Summary ───────────────────────────────────────────────────────────────────
echo ============================================================
echo   Chaos Test Results
echo ============================================================
echo   PASSED : !PASS!
echo   FAILED : !FAIL!
echo ============================================================
echo.
if !FAIL!==0 (
    echo   All checks passed.
) else (
    echo   Some checks failed — review output above.
)
echo   RAFT Dashboard : http://localhost:6001
echo   Gateway health : http://localhost:4000/health
echo.

endlocal
exit /b 0
