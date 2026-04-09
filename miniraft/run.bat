@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================================
echo    Mini-RAFT Cluster  --  Starting (Windows)
echo  ============================================================
echo.

REM ── Check Docker ──────────────────────────────────────────────
docker --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker is not installed or not in PATH.
    pause
    exit /b 1
)

REM ── Check images exist (suggest setup.bat if not) ─────────────
docker image inspect miniraft-replica >nul 2>&1
if errorlevel 1 (
    echo  [WARN]  Images not found. Running setup first...
    echo.
    call setup.bat
)

REM ── Start cluster ─────────────────────────────────────────────
echo  [STEP 1/2]  Starting all containers...
echo.
docker compose up -d
if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start containers. Check Docker is running.
    pause
    exit /b 1
)

echo.
echo  [STEP 2/2]  Waiting for replicas to become healthy...
timeout /t 8 /nobreak >nul

REM ── Print status ──────────────────────────────────────────────
echo.
echo  Container status:
docker compose ps
echo.
echo  ============================================================
echo    Cluster is UP!
echo.
echo    Dashboard  :  http://localhost:4000
echo    Replica 1  :  http://localhost:3001/status
echo    Replica 2  :  http://localhost:3002/status
echo    Replica 3  :  http://localhost:3003/status
echo.
echo    To stream logs:    docker compose logs -f
echo    To stop cluster:   docker compose down
echo    To stop + wipe:    docker compose down -v
echo  ============================================================
echo.

REM ── Open dashboard in browser ─────────────────────────────────
echo  Opening dashboard in your browser...
timeout /t 2 /nobreak >nul
start http://localhost:4000

pause
