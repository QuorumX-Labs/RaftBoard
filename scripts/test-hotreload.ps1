# scripts\test-hotreload.ps1 — Hot-reload zero-downtime test (PowerShell)

$ErrorActionPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $ScriptDir
$BASE      = "http://localhost"
$GATEWAY   = "$BASE`:4000"
$SRC       = Join-Path $RootDir "replica1\src\index.js"

function Get-Role($port) {
    try { return (Invoke-RestMethod "$BASE`:$port/health" -TimeoutSec 2).role }
    catch { return "down" }
}
function GW-Status {
    try { return (Invoke-RestMethod "$GATEWAY/health" -TimeoutSec 2).status }
    catch { return "fail" }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Hot-Reload Zero-Downtime Test  [PowerShell]" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[STEP 1] Baseline cluster state:"
Write-Host "  replica1 : $(Get-Role 5001)"
Write-Host "  replica2 : $(Get-Role 5002)"
Write-Host "  replica3 : $(Get-Role 5003)"
Write-Host "  gateway  : $(GW-Status)"
Write-Host ""

if (-not (Test-Path $SRC)) {
    Write-Host "[ERROR] $SRC not found. Run .\scripts\prepare.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "[STEP 2] Triggering hot-reload on replica1..."
Add-Content -Path $SRC -Value "`n// [hot-reload-test] $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
Write-Host "  File touched. nodemon will restart replica1 automatically." -ForegroundColor Yellow
Write-Host ""

Write-Host "[STEP 3] Gateway health DURING replica1 restart (3 polls x 1s):"
for ($i = 1; $i -le 3; $i++) {
    Start-Sleep -Seconds 1
    $s = GW-Status
    $color = if ($s -eq "ok") { "Green" } else { "Red" }
    Write-Host "  Poll $i : $s" -ForegroundColor $color
}
Write-Host ""

Write-Host "[STEP 4] Waiting for replica1 to rejoin (max 10s)..."
$rejoined = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    $role = Get-Role 5001
    if ($role -ne "down") {
        Write-Host "  replica1 rejoined as: $role" -ForegroundColor Green
        $rejoined = $true
        break
    }
}
if (-not $rejoined) { Write-Host "  WARN  replica1 did not rejoin within 10s" -ForegroundColor Yellow }
Write-Host ""

Write-Host "[STEP 5] Final cluster state after hot-reload:"
Write-Host "  replica1 : $(Get-Role 5001)"
Write-Host "  replica2 : $(Get-Role 5002)"
Write-Host "  replica3 : $(Get-Role 5003)"
try {
    $ldr = (Invoke-RestMethod "$GATEWAY/leader" -TimeoutSec 2).leader
    Write-Host "  leader   : $ldr"
} catch { Write-Host "  leader   : (unreachable)" }
Write-Host ""
Write-Host "  Hot-reload test complete." -ForegroundColor Green
Write-Host "  RAFT Dashboard : http://localhost:6001"
Write-Host ""
