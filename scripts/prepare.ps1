# scripts\prepare.ps1 — OCP Build Preparation (PowerShell)
#
# Copies original source files (byte-for-byte) into extension build
# contexts. NO modifications are made to original files — only plain copies.
#
# Usage:
#   .\scripts\prepare.ps1
#   .\scripts\prepare.ps1 -Orig "..\RaftBoard-main"
#
# Run from the raftboard-extension\ directory.

param(
    [string]$Orig = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $ScriptDir

if ($Orig -eq "") {
    $Orig = Join-Path (Split-Path -Parent $RootDir) "RaftBoard-main"
}
$Orig = (Resolve-Path $Orig -ErrorAction SilentlyContinue)?.Path

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RaftBoard OCP Build Preparation  [PowerShell]" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Source (original, untouched) : $Orig"
Write-Host "  Extension root               : $RootDir"
Write-Host ""

# ── Validate original exists ──────────────────────────────────────────────────
if (-not (Test-Path $Orig -PathType Container)) {
    Write-Host "[ERROR] Original RaftBoard-main not found at: $Orig" -ForegroundColor Red
    Write-Host "Usage: .\scripts\prepare.ps1 -Orig '..\RaftBoard-main'"
    exit 1
}

# ── 1. Copy gateway files → gateway\core\ ────────────────────────────────────
Write-Host "[1/4] Copying gateway files to gateway\core\ ..."
$CoreDir = Join-Path $RootDir "gateway\core"
New-Item -ItemType Directory -Force -Path $CoreDir | Out-Null

$GatewayFiles = @("server.js","config.js","leaderManager.js","websocketHandler.js","clientRegistry.js","logger.js","package.json")
foreach ($f in $GatewayFiles) {
    $src = Join-Path $Orig $f
    $dst = Join-Path $CoreDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dst -Force
        Write-Host "      OK  $f" -ForegroundColor Green
    } else {
        Write-Host "      MISSING: $f" -ForegroundColor Yellow
    }
}

# ── 2. Copy replica src → replica1\src\, replica2\src\, replica3\src\ ────────
Write-Host ""
Write-Host "[2/4] Copying replica source to replica1\2\3\src\ ..."
$ReplicaSrc = Join-Path $Orig "miniraft\replica\src\index.js"
if (-not (Test-Path $ReplicaSrc)) {
    Write-Host "[ERROR] Replica source not found at: $ReplicaSrc" -ForegroundColor Red
    exit 1
}

foreach ($n in 1..3) {
    $dstDir = Join-Path $RootDir "replica$n\src"
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    Copy-Item -Path $ReplicaSrc -Destination (Join-Path $dstDir "index.js") -Force
    Write-Host "      OK  replica${n}\src\index.js" -ForegroundColor Green
}

# ── 3. Verify checksums ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Verifying byte-identity of copied files ..."

function Get-FileHash-Short($path) {
    return (Get-FileHash -Path $path -Algorithm MD5).Hash
}

$origHash = Get-FileHash-Short (Join-Path $Orig "server.js")
$copyHash = Get-FileHash-Short (Join-Path $CoreDir "server.js")
if ($origHash -eq $copyHash) {
    Write-Host "      OK  server.js checksum matches — untouched" -ForegroundColor Green
} else {
    Write-Host "[ERROR] CHECKSUM MISMATCH on server.js" -ForegroundColor Red
    Write-Host "        Original : $origHash"
    Write-Host "        Copy     : $copyHash"
    exit 1
}

$origRep = Get-FileHash-Short $ReplicaSrc
$copyRep = Get-FileHash-Short (Join-Path $RootDir "replica1\src\index.js")
if ($origRep -eq $copyRep) {
    Write-Host "      OK  replica\src\index.js checksum matches — untouched" -ForegroundColor Green
} else {
    Write-Host "[ERROR] CHECKSUM MISMATCH on replica index.js" -ForegroundColor Red
    exit 1
}

# ── 4. Summary ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] Summary"
Write-Host "      gateway\core\   — Monica's original gateway files (read-only copy)"
Write-Host "      replica1\src\   — Original replica\src\index.js"
Write-Host "      replica2\src\   — Original replica\src\index.js"
Write-Host "      replica3\src\   — Original replica\src\index.js"
Write-Host ""
Write-Host "  Preparation complete." -ForegroundColor Green
Write-Host "  Next step: docker-compose up --build"
Write-Host ""
Write-Host "  OCP COMPLIANCE: Zero modifications made to original files." -ForegroundColor Cyan
Write-Host "  Original tree at $Orig is completely untouched." -ForegroundColor Cyan
Write-Host ""
