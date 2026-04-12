# scripts\start.ps1 — Start the full RaftBoard system (PowerShell)
#
# Usage:
#   .\scripts\start.ps1
#   .\scripts\start.ps1 -Orig "..\RaftBoard-main"

param(
    [string]$Orig = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $ScriptDir

if ($Orig -eq "") {
    $Orig = Join-Path (Split-Path -Parent $RootDir) "RaftBoard-main"
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RaftBoard — Starting Distributed Drawing Board" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Prepare ───────────────────────────────────────────────────────────
$CoreServer = Join-Path $RootDir "gateway\core\server.js"
if (-not (Test-Path $CoreServer)) {
    Write-Host "Running prepare step first..." -ForegroundColor Yellow
    & "$ScriptDir\prepare.ps1" -Orig $Orig
} else {
    Write-Host "  gateway\core already populated — skipping prepare." -ForegroundColor Green
}

# ── Step 2: Build and start ───────────────────────────────────────────────────
Write-Host ""
Write-Host "Building and starting containers..." -ForegroundColor Cyan
Set-Location $RootDir
docker-compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] docker-compose failed." -ForegroundColor Red
    exit 1
}

# ── Step 3: Wait ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Waiting 15 seconds for cluster to stabilise..."
Start-Sleep -Seconds 15

# ── Step 4: Health check ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "Checking gateway health..."
try {
    $resp = Invoke-RestMethod -Uri "http://localhost:4000/health" -TimeoutSec 5
    Write-Host "  Gateway: $($resp | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "  Gateway not ready yet — give it a few more seconds." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  System URLs" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Drawing Board   :  http://localhost:8080"
Write-Host "  Gateway WS      :  ws://localhost:4000"
Write-Host "  Gateway Health  :  http://localhost:4000/health"
Write-Host "  Gateway Leader  :  http://localhost:4000/leader"
Write-Host "  RAFT Dashboard  :  http://localhost:6001"
Write-Host "  Replica 1 status:  http://localhost:5001/status"
Write-Host "  Replica 2 status:  http://localhost:5002/status"
Write-Host "  Replica 3 status:  http://localhost:5003/status"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  View logs : docker-compose logs -f"
Write-Host "  Stop      : docker-compose down"
Write-Host ""
