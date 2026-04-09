@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================================
echo    Mini-RAFT Cluster  --  Setup Script (Windows)
echo  ============================================================
echo.

REM ── Check Docker ──────────────────────────────────────────────
docker --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker is not installed or not in PATH.
    echo          Please install Docker Desktop from https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)
echo  [OK]  Docker found

docker compose version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker Compose plugin not found.
    echo          Please update Docker Desktop to a recent version.
    pause
    exit /b 1
)
echo  [OK]  Docker Compose found
echo.

REM ── Build images ──────────────────────────────────────────────
echo  [STEP 1/2]  Building Docker images (this may take a minute)...
echo.
docker compose build --parallel
if errorlevel 1 (
    echo.
    echo  [ERROR] Build failed. Check the output above.
    pause
    exit /b 1
)

echo.
echo  [OK]  All images built successfully.
echo.
echo  ============================================================
echo    Setup complete!  Run  run.bat  to start the cluster.
echo  ============================================================
echo.
pause
