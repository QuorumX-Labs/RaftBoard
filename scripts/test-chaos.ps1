# scripts\test-chaos.ps1 — Chaos / stress test (PowerShell)

$ErrorActionPreference = "SilentlyContinue"
$BASE    = "http://localhost"
$GATEWAY = "$BASE`:4000"
$PASS = 0; $FAIL = 0

function Get-Role($port) {
    try { return (Invoke-RestMethod "$BASE`:$port/health" -TimeoutSec 2).role }
    catch { return "down" }
}
function GW-OK {
    try { return (Invoke-RestMethod "$GATEWAY/health" -TimeoutSec 2).status -eq "ok" }
    catch { return $false }
}
function Get-Leader {
    try {
        $r = Invoke-RestMethod "$GATEWAY/leader" -TimeoutSec 2
        if ($r.leader -and $r.leader -ne "null") { return $r.leader }
    } catch {}
    return $null
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RaftBoard Chaos Test  [PowerShell]" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ── ROUND 1: Kill follower ────────────────────────────────────────────────────
Write-Host "[ROUND 1] Kill a follower, inject entry, restart" -ForegroundColor Yellow
$FollowerContainer = $null
foreach ($n in 1..3) {
    if ((Get-Role "500$n") -eq "follower") { $FollowerContainer = "raft-replica$n"; break }
}

if ($FollowerContainer) {
    Write-Host "  Stopping follower: $FollowerContainer"
    docker stop $FollowerContainer | Out-Null
    Start-Sleep -Seconds 1

    if (GW-OK) { Write-Host "  OK  Gateway healthy with follower down" -ForegroundColor Green; $PASS++ }
    else        { Write-Host "  FAIL  Gateway unhealthy" -ForegroundColor Red; $FAIL++ }

    $ldr = Get-Leader
    if ($ldr) {
        try {
            Invoke-RestMethod -Method Post -Uri "$ldr/client-entry" `
                -ContentType "application/json" `
                -Body '{"entry":"chaos-round1"}' -TimeoutSec 3 | Out-Null
            Write-Host "  OK  Entry injected while follower was down" -ForegroundColor Green; $PASS++
        } catch {
            Write-Host "  FAIL  Entry injection failed" -ForegroundColor Red; $FAIL++
        }
    }

    Write-Host "  Restarting $FollowerContainer ..."
    docker start $FollowerContainer | Out-Null
    Start-Sleep -Seconds 5
} else {
    Write-Host "  No follower found — skipping round 1" -ForegroundColor Yellow
}
Write-Host ""

# ── ROUND 2: Kill leader ──────────────────────────────────────────────────────
Write-Host "[ROUND 2] Kill the LEADER, verify election" -ForegroundColor Yellow
$LeaderContainer = $null; $LeaderPort = $null
foreach ($n in 1..3) {
    if ((Get-Role "500$n") -eq "leader") { $LeaderContainer = "raft-replica$n"; $LeaderPort = "500$n"; break }
}

if ($LeaderContainer) {
    Write-Host "  Stopping leader: $LeaderContainer"
    docker stop $LeaderContainer | Out-Null

    $NewLeader = $null
    for ($i = 0; $i -lt 30 -and -not $NewLeader; $i++) {
        Start-Sleep -Milliseconds 100
        $NewLeader = Get-Leader
    }

    if ($NewLeader) {
        Write-Host "  OK  New leader: $NewLeader" -ForegroundColor Green; $PASS++
    } else {
        Write-Host "  WARN  No new leader within 3s" -ForegroundColor Yellow; $FAIL++
    }

    docker start $LeaderContainer | Out-Null
    Start-Sleep -Seconds 7
    $role = Get-Role $LeaderPort
    Write-Host "  Restarted replica rejoined as: $role"
} else {
    Write-Host "  Could not find leader — skipping round 2" -ForegroundColor Yellow
}
Write-Host ""

# ── ROUND 3: Rapid successive kills ──────────────────────────────────────────
Write-Host "[ROUND 3] Rapid successive kills" -ForegroundColor Yellow
foreach ($c in @("raft-replica1","raft-replica2")) {
    Write-Host "  Stopping $c for 3s..."
    docker stop $c | Out-Null
    Start-Sleep -Seconds 3
    $gw = if (GW-OK) { "ok" } else { "fail" }
    Write-Host "    Gateway during kill of $c : $gw"
    docker start $c | Out-Null
    Start-Sleep -Seconds 4
}

if (GW-OK) { Write-Host "  OK  Gateway recovered from rapid kills" -ForegroundColor Green; $PASS++ }
else        { Write-Host "  FAIL  Gateway did not recover" -ForegroundColor Red; $FAIL++ }
Write-Host ""

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Chaos Test Results"
Write-Host "  PASSED : $PASS" -ForegroundColor Green
if ($FAIL -gt 0) { Write-Host "  FAILED : $FAIL" -ForegroundColor Red }
else              { Write-Host "  FAILED : $FAIL" }
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
if ($FAIL -eq 0) { Write-Host "  All checks passed." -ForegroundColor Green }
else             { Write-Host "  Some checks failed — review output above." -ForegroundColor Yellow }
Write-Host "  RAFT Dashboard : http://localhost:6001"
Write-Host ""
