# RaftBoard — OCP Extension Package

**Distributed Real-Time Drawing Board with Mini-RAFT Consensus**
**Windows-compatible — all scripts available as `.bat` (CMD) and `.ps1` (PowerShell)**

> **OCP Principle:** Every file in this extension package is *new*.
> Zero lines of the original `RaftBoard-main/` ZIP were modified.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Folder Layout](#2-folder-layout)
3. [Setup & Run — Windows](#3-setup--run--windows)
4. [Testing Instructions — Windows](#4-testing-instructions--windows)
5. [Access URLs](#5-access-urls)
6. [Manual Docker Commands](#6-manual-docker-commands)
7. [Requirement Coverage Matrix](#7-requirement-coverage-matrix)
8. [File Inventory](#8-file-inventory)
9. [OCP Compliance Declaration](#9-ocp-compliance-declaration)

---

## 1. Prerequisites

Install all of these before running:

| Tool | Download | Notes |
|------|----------|-------|
| **Docker Desktop for Windows** | https://www.docker.com/products/docker-desktop/ | Enables `docker` and `docker-compose` in CMD/PS |
| **Node.js (LTS)** | https://nodejs.org/ | Required only for JSON-parsing helpers in test scripts |
| **curl** | Built into Windows 10 1803+ | Already available in CMD and PowerShell |

After installing Docker Desktop, make sure it is **running** before proceeding.

Verify everything works — open CMD and type:
```
docker --version
docker-compose --version
node --version
curl --version
```

---

## 2. Folder Layout

Place both folders **side by side**:

```
C:\Projects\
├── RaftBoard-main\          <- original ZIP, unzipped — NEVER TOUCHED
└── raftboard-extension\     <- this package
    ├── docker-compose.yml
    ├── README.md
    ├── gateway\
    │   ├── Dockerfile
    │   ├── server.js
    │   └── core\            <- populated by prepare.bat / prepare.ps1
    ├── replica1\src\        <- per-replica hot-reload bind-mount
    ├── replica2\src\
    ├── replica3\src\
    ├── frontend\
    │   ├── Dockerfile
    │   ├── index.html       <- drawing board UI
    │   ├── server.js
    │   └── package.json
    ├── scripts\
    │   ├── prepare.bat      <- CMD version
    │   ├── prepare.ps1      <- PowerShell version
    │   ├── start.bat
    │   ├── start.ps1
    │   ├── test-failover.bat
    │   ├── test-failover.ps1
    │   ├── test-hotreload.bat
    │   ├── test-hotreload.ps1
    │   ├── test-chaos.bat
    │   └── test-chaos.ps1
    └── docs\
        └── ARCHITECTURE.md
```

---

## 3. Setup & Run — Windows

### Option A — CMD (Command Prompt)  [Recommended]

Open **Command Prompt** (`Win + R`, type `cmd`, press Enter):

```cmd
cd C:\Projects\raftboard-extension
scripts\start.bat ..\RaftBoard-main
```

That single command will:
1. Copy Monica's original files into `gateway\core\` (with checksum verification)
2. Copy the replica source into `replica1\src\`, `replica2\src\`, `replica3\src\`
3. Run `docker-compose up --build -d`
4. Wait 15 seconds for the cluster to stabilise
5. Print all access URLs

---

### Option B — PowerShell

Open **PowerShell** (`Win + X` → Windows PowerShell):

```powershell
# One-time: allow running local scripts
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

cd C:\Projects\raftboard-extension
.\scripts\start.ps1 -Orig "..\RaftBoard-main"
```

---

### Option C — Manual step-by-step (CMD)

```cmd
cd C:\Projects\raftboard-extension

:: Step 1 — copy original files into build contexts
scripts\prepare.bat ..\RaftBoard-main

:: Step 2 — build and start all containers
docker-compose up --build -d

:: Step 3 — verify
docker-compose ps
curl http://localhost:4000/health
curl http://localhost:4000/leader
```

---

### Stopping the system

```cmd
cd C:\Projects\raftboard-extension
docker-compose down
```

### Viewing logs

```cmd
docker-compose logs -f
docker-compose logs -f gateway
docker-compose logs -f replica1
```

---

## 4. Testing Instructions — Windows

### Test A — Multi-client real-time drawing

1. Open **3 browser tabs** at `http://localhost:8080`
2. Enter different names in each tab, same room (`default`)
3. Draw in tab 1 → strokes appear in tabs 2 and 3 within ~50ms
4. Draw simultaneously in all tabs → all canvases stay consistent

---

### Test B — Leader failover

```cmd
:: CMD
scripts\test-failover.bat
```
```powershell
# PowerShell
.\scripts\test-failover.ps1
```

Manual steps (CMD):
```cmd
:: See current leader
curl http://localhost:4000/leader

:: Kill the leader (change replica number as needed)
docker stop raft-replica2

:: Draw in browser — should still work within ~1s (new election)
:: Check new leader
curl http://localhost:4000/leader

:: Restart the stopped replica (triggers catch-up via sync-log)
docker start raft-replica2
timeout /t 8
curl http://localhost:5002/status
```

---

### Test C — Hot-reload (zero downtime)

```cmd
scripts\test-hotreload.bat
```
```powershell
.\scripts\test-hotreload.ps1
```

Manual (Notepad):
- Open `replica1\src\index.js` in Notepad
- Add any comment at the top and save
- nodemon inside the container detects the change and restarts replica1
- The gateway and drawing board stay live throughout
- Watch: `docker-compose logs -f replica1`

---

### Test D — Chaos / stress

```cmd
scripts\test-chaos.bat
```
```powershell
.\scripts\test-chaos.ps1
```

---

### Test E — Catch-up sync (manual CMD)

```cmd
:: Stop replica3
docker stop raft-replica3

:: Inject 3 strokes via replica1 (assuming it becomes leader)
curl -X POST http://localhost:5001/client-entry -H "Content-Type: application/json" -d "{\"entry\":\"stroke-1\"}"
curl -X POST http://localhost:5001/client-entry -H "Content-Type: application/json" -d "{\"entry\":\"stroke-2\"}"
curl -X POST http://localhost:5001/client-entry -H "Content-Type: application/json" -d "{\"entry\":\"stroke-3\"}"

:: Restart replica3
docker start raft-replica3
timeout /t 8

:: Check log length — should match replica1
curl http://localhost:5003/status
curl http://localhost:5001/status
```

---

## 5. Access URLs

| URL | Purpose |
|-----|---------|
| `http://localhost:8080` | **Drawing Board** — open in multiple browser tabs |
| `http://localhost:4000/health` | Gateway health |
| `http://localhost:4000/leader` | Current RAFT leader URL |
| `http://localhost:6001` | **RAFT Dashboard** — elections, terms, log sizes |
| `http://localhost:5001/status` | Replica 1 full status |
| `http://localhost:5002/status` | Replica 2 full status |
| `http://localhost:5003/status` | Replica 3 full status |
| `http://localhost:5001/log` | Replica 1 raw log (last 50 entries) |

---

## 6. Manual Docker Commands

```cmd
:: All containers status
docker-compose ps

:: Stop one replica (simulate failure)
docker stop raft-replica1

:: Start it back (triggers catch-up)
docker start raft-replica1

:: Force a new election on a replica
curl -X POST http://localhost:5001/debug/force-election

:: Inject a test entry directly to a replica
curl -X POST http://localhost:5001/client-entry -H "Content-Type: application/json" -d "{\"entry\":\"test\"}"

:: Rebuild a single service
docker-compose up --build -d replica1

:: Full teardown
docker-compose down

:: Teardown + remove volumes
docker-compose down -v
```

---

## 7. Requirement Coverage Matrix

| PDF Requirement | Satisfied By | File(s) |
|----------------|-------------|---------|
| Gateway WebSocket server | Monica's original `server.js` | `gateway\core\server.js` |
| Auto re-route to new leader | Monica's original `leaderManager.js` | `gateway\core\leaderManager.js` |
| Stroke forward to leader | Monica's original `websocketHandler.js` | `gateway\core\websocketHandler.js` |
| Follower / Candidate / Leader | Original `miniraft\replica\src\index.js` | `replica{1,2,3}\src\index.js` |
| Random election timeout 500-800ms | `randomElectionTimeout()` in replica | copies |
| RequestVote RPC | `POST /request-vote` | copies |
| AppendEntries RPC | `POST /append-entries` | copies |
| Heartbeat 150ms | `sendHeartbeats()` every 150ms | copies |
| Majority-based commit | `advanceCommitIndex()` | copies |
| Catch-up sync `/sync-log` | `POST /sync-log` | copies |
| Drop stale leaders | `becomeFollower(term)` | copies |
| 3 replica containers | services `replica1/2/3` | `docker-compose.yml` |
| Distinct replica IDs via env | `REPLICA_ID` env var | `docker-compose.yml` |
| Shared Docker network | `raftboard-net` bridge | `docker-compose.yml` |
| Healthy startup ordering | `depends_on: service_healthy` | `docker-compose.yml` |
| Per-replica bind-mount hot-reload | `./replica1/src:/app/src` volumes | `docker-compose.yml` |
| Hot-reload isolation per replica | 3 separate bind-mount dirs | `replica{1,2,3}\src\` |
| nodemon auto-restart | `CMD ["npm","run","dev"]` | original `miniraft\replica\Dockerfile` |
| Browser canvas drawing | | `frontend\index.html` |
| Multi-client real-time sync | `stroke:committed` broadcast | `frontend\index.html` |
| Remote cursor display | `cursor:update` + overlay | `frontend\index.html` |
| RAFT observability dashboard | `miniraft\dashboard\` | `docker-compose.yml` port 6001 |
| Logging elections/terms/commits | `logEvent()` in replica | copies |
| Zero-downtime during reload | Gateway reconnects; <1s election | compose + `leaderManager.js` |
| Failover test | | `scripts\test-failover.bat/.ps1` |
| Hot-reload test | | `scripts\test-hotreload.bat/.ps1` |
| Chaos/stress test | | `scripts\test-chaos.bat/.ps1` |
| Architecture document | | `docs\ARCHITECTURE.md` |

---

## 8. File Inventory

### Existing files left UNTOUCHED

```
RaftBoard-main\server.js
RaftBoard-main\config.js
RaftBoard-main\leaderManager.js
RaftBoard-main\websocketHandler.js
RaftBoard-main\clientRegistry.js
RaftBoard-main\logger.js
RaftBoard-main\package.json
RaftBoard-main\Dockerfile
RaftBoard-main\docker-compose.gateway.yml
RaftBoard-main\miniraft\replica\src\index.js
RaftBoard-main\miniraft\replica\package.json
RaftBoard-main\miniraft\replica\Dockerfile
RaftBoard-main\miniraft\docker-compose.yml
RaftBoard-main\miniraft\dashboard\* (all files)
RaftBoard-main\DrawSync -bhavani\* (all files)
... (every other file in the original ZIP)
```

### New files ADDED (this extension package)

```
raftboard-extension\docker-compose.yml
raftboard-extension\README.md
raftboard-extension\gateway\Dockerfile
raftboard-extension\gateway\server.js
raftboard-extension\gateway\core\*          (7 files, byte copies)
raftboard-extension\replica1\src\index.js   (byte copy)
raftboard-extension\replica2\src\index.js   (byte copy)
raftboard-extension\replica3\src\index.js   (byte copy)
raftboard-extension\frontend\Dockerfile
raftboard-extension\frontend\server.js
raftboard-extension\frontend\package.json
raftboard-extension\frontend\index.html
raftboard-extension\scripts\prepare.bat
raftboard-extension\scripts\prepare.ps1
raftboard-extension\scripts\start.bat
raftboard-extension\scripts\start.ps1
raftboard-extension\scripts\test-failover.bat
raftboard-extension\scripts\test-failover.ps1
raftboard-extension\scripts\test-hotreload.bat
raftboard-extension\scripts\test-hotreload.ps1
raftboard-extension\scripts\test-chaos.bat
raftboard-extension\scripts\test-chaos.ps1
raftboard-extension\docs\ARCHITECTURE.md
```

---

## 9. OCP Compliance Declaration

**Confirmed:**

- No existing file in `RaftBoard-main\` was modified in any way
- No existing folder was renamed, moved, or deleted
- All new behaviour introduced through additive extension only
- `prepare.bat` uses `copy /Y` + `certutil` MD5 checksum verification
- `prepare.ps1` uses `Copy-Item` + `Get-FileHash` MD5 verification
- Both abort immediately on any checksum mismatch, proving originals are untouched
- The original `miniraft\docker-compose.yml` and `docker-compose.gateway.yml` remain intact and independently runnable

*Extend only. Never modify.*
