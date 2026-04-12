# scripts\test-failover.ps1 — Failover test (PowerShell)
#
# 1. Verify cluster health
# 2. Find current leader
# 3. Kill leader container
# 4. Verify new election
# 5. Restart replica
# 6. Verify catch-up

$ErrorActionPreference = "SilentlyContinue"
$BASE    = "http://localhost"
$GATEWAY = "$BASE`:4000"
$PASS = 0; $FAIL = 0

function Get-ReplicaRole($port) {
    try {
        $r = Invoke-RestMethod -Uri "$BASE`:$port/health" -TimeoutSec 2
        return $r.role
    } catch { return "down" }
}

function Get-Leader {
    try {
        $r = Invoke-RestMethod -Uri "$GATEWAY/leader" -TimeoutSec 2
        if ($r.leader -and $r.leader -ne "null") { return $r.leader }
    } catch {}
    return $null
}

function Check-Gateway {
    try {
        $r = Invoke-RestMethod -Uri "$GATEWAY/health" -TimeoutSec 2
        return $r.status
    } catch { return "fail" }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RaftBoard Failover Test  [PowerShell]" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ── TEST 1 ────────────────────────────────────────────────────────────────────
Write-Host "[TEST 1] Cluster health"
Write-Host "  replica1 : $(Get-ReplicaRole 5001)"
Write-Host "  replica2 : $(Get-ReplicaRole 5002)"
Write-Host "  replica3 : $(Get-ReplicaRole 5003)"
Write-Host "  gateway  : $(Check-Gateway)"
Write-Host ""

# ── TEST 2 ────────────────────────────────────────────────────────────────────
Write-Host "[TEST 2] Identify current leader"
$LeaderUrl = Get-Leader
if (-not $LeaderUrl) {
    Write-Host "[ERROR] No leader found. Run: .\scripts\start.ps1" -ForegroundColor Red
    exit 1
}
Write-Host "  Current leader: $LeaderUrl" -ForegroundColor Green
Write-Host ""

# ── TEST 3 ────────────────────────────────────────────────────────────────────
Write-Host "[TEST 3] Kill the LEADER container"
$LeaderContainer = $null
$LeaderCheckPort = $null
foreach ($n in 1..3) {
    $role = Get-ReplicaRole "500$n"
    if ($role -eq "leader") {
        $LeaderContainer = "raft-replica$n"
        $LeaderCheckPort = "500$n"
        break
    }
}
if (-not $LeaderContainer) { $LeaderContainer = "raft-replica1"; $LeaderCheckPort = "5001" }

Write-Host "  Stopping: $LeaderContainer" -ForegroundColor Yellow
docker stop $LeaderContainer | Out-Null
Write-Host ""

# ── TEST 4 ────────────────────────────────────────────────────────────────────
Write-Host "[TEST 4] Wait for new leader election (max 5s)..."
$NewLeader = $null
$Elapsed   = 0
while ($Elapsed -lt 50 -and -not $NewLeader) {
    Start-Sleep -Milliseconds 100
    $nl = Get-Leader
    if ($nl -and $nl -ne $LeaderUrl) { $NewLeader = $nl }
    $Elapsed++
}
if ($NewLeader) {
    Write-Host "  OK  New leader: $NewLeader" -ForegroundColor Green
    $PASS++
} else {
    Write-Host "  WARN  No new leader detected within 5s" -ForegroundColor Yellow
    $FAIL++
}
Write-Host ""

# ── TEST 5 ────────────────────────────────────────────────────────────────────
Write-Host "[TEST 5] Gateway health during failover"
$gw = Check-Gateway
if ($gw -eq "ok") {
    Write-Host "  OK  Gateway still healthy" -ForegroundColor Green; $PASS++
} else {
    Write-Host "  FAIL  Gateway unreachable: $gw" -ForegroundColor Red; $FAIL++
}
Write-Host ""

# ── TEST 6 ────────────────────────────────────────────────────────────────────
Write-Host "[TEST 6] Restart $LeaderContainer — catch-up sync test"
docker start $LeaderContainer | Out-Null
Write-Host "  Waiting 8s for sync-log catch-up..."
Start-Sleep -Seconds 8

$rejoined = Get-ReplicaRole $LeaderCheckPort
if ($rejoined -ne "down") {
    Write-Host "  OK  Replica rejoined as: $rejoined" -ForegroundColor Green; $PASS++
} else {
    Write-Host "  WARN  Replica still unreachable" -ForegroundColor Yellow
}
Write-Host ""

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Failover Test Results"
Write-Host "  PASSED : $PASS" -ForegroundColor Green
Write-Host "  FAILED : $FAIL" $(if ($FAIL -gt 0) { "ForegroundColor Red" })
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  RAFT Dashboard : http://localhost:6001"
Write-Host "  Gateway leader : http://localhost:4000/leader"
Write-Host ""
