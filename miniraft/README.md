# Mini-RAFT Replica Cluster

> **Assignment Scope:** This deliverable covers the **Replica Logic + Dashboard** component only.  
> It does NOT include the Frontend Drawing Board, Gateway WebSocket Server, or full Docker test suite — those are separate sub-systems.

---

## What's Included

| Component | Description |
|-----------|-------------|
| `replica/src/index.js` | Full Mini-RAFT consensus implementation (Follower / Candidate / Leader) |
| `dashboard/` | Real-time visual dashboard (aggregator server + HTML UI) |
| `docker-compose.yml` | Orchestrates 3 replicas + dashboard |
| `setup.bat` | One-click Windows build |
| `run.bat` | One-click Windows start + browser open |
| `stop.bat` | Graceful shutdown |

---

## Quick Start (Windows)

```
1.  Double-click  setup.bat   ← builds Docker images (once)
2.  Double-click  run.bat     ← starts cluster, opens browser
3.  Open          http://localhost:4000   ← Dashboard
4.  Double-click  stop.bat    ← graceful shutdown
```

**Prerequisites:** Docker Desktop ≥ 4.x installed and running.

---

## Architecture

```
┌────────────────────────────────────────────────┐
│                Docker Network: raft-net         │
│                                                 │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐  │
│   │ replica1 │◄──│ replica2 │──►│ replica3 │  │
│   │ :3001    │   │ :3002    │   │ :3003    │  │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘  │
│        │              │              │         │
│        └──────────────┴──────────────┘         │
│                       │                        │
│               ┌───────▼──────┐                 │
│               │  dashboard   │                 │
│               │  :4000       │                 │
│               └──────────────┘                 │
└────────────────────────────────────────────────┘
```

---

## Mini-RAFT Protocol Implemented

### Node States
- **Follower** — waits for leader heartbeats; starts election on timeout
- **Candidate** — increments term, requests votes from all peers
- **Leader** — replicates log, sends heartbeats, commits entries

### Timing (per spec)
| Parameter | Value |
|-----------|-------|
| Election timeout | 500–800 ms (random) |
| Heartbeat interval | 150 ms |
| RPC timeout | 250 ms |

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/request-vote` | Vote RPC — grants/denies vote with log-up-to-date check |
| POST | `/append-entries` | Core replication RPC + heartbeat (entries=[] for pure heartbeat) |
| POST | `/heartbeat` | Explicit heartbeat endpoint |
| POST | `/sync-log` | Catch-up sync — leader sends missing entries to rejoining node |
| POST | `/client-entry` | Accept new entry from Gateway (leader only; redirects otherwise) |
| GET  | `/status` | Full diagnostic snapshot for dashboard |
| GET  | `/log` | Full log dump (last 50 entries) |
| GET  | `/health` | Liveness probe |
| POST | `/debug/force-election` | Force an election (testing/demo) |

### Log Replication Flow
```
Client → /client-entry (leader)
  └── Leader appends to local log
  └── Leader sends AppendEntries to all followers
        ├── Followers append entries, reply success
        └── Once majority (≥2) acknowledge → leader advances commitIndex
              └── Applied entries broadcast back to Gateway
```

### Catch-Up Protocol (Restarted Node)
```
1. Node restarts → Follower with empty log
2. Receives AppendEntries → prevLogIndex check fails
3. Node replies with its logLength (conflict hint)
4. Leader calls /sync-log with all committed entries from that index
5. Follower installs entries, updates commitIndex
6. Participates normally
```

### Safety Guarantees
- Committed entries are NEVER overwritten (`log.slice(0, prevLogIndex+1)` on conflict)
- Higher term always wins (`becomeFollower()` on any higher-term response)
- Split votes trigger timer retry (random timeout prevents livelock)
- Leader checks `log[N].term === currentTerm` before committing (no stale-term commit)

---

## Dashboard Features

Open **http://localhost:4000** after running.

| Panel | What it shows |
|-------|---------------|
| **Node Cards** | Role (Leader/Candidate/Follower/Offline), term, log length, commit index, live event stream per node |
| **Cluster Topology** | SVG canvas showing nodes, edges, leader crown, glow rings |
| **Log Length Chart** | Time-series chart (60 seconds) for all 3 replicas |
| **Term Chart** | Term number over time per replica |
| **RPC Statistics** | Aggregated sent / received / failed RPC counts |
| **Leader History** | Timestamped timeline of every leader election |
| **Inject Entry** | Button to push a test entry through the current leader |
| **Force Election** | Per-node button to simulate leader loss |

Dashboard polls `/api/cluster` every **1 second**.

---

## Hot-Reload (Bind Mount)

All three replicas bind-mount `./replica/src` into the container.  
Edit any `.js` file in `replica/src/` → **nodemon** restarts that container automatically → RAFT election occurs → cluster re-converges without client disconnection.

```
replica/src/index.js    ← shared source, all 3 replicas use it
```

---

## Testing Scenarios

### 1. Kill the Leader
```bash
docker compose stop replica1
# Watch dashboard — election occurs within 500-800ms
# New leader elected among replica2 / replica3
docker compose start replica1
# Replica1 rejoins as follower, catches up via sync-log
```

### 2. Force Election via Dashboard
Click **⚡ Force Election** on any leader card.

### 3. Inject Entries
Use the **Inject to Leader** button on the dashboard, or:
```bash
curl -X POST http://localhost:3001/client-entry \
     -H "Content-Type: application/json" \
     -d '{"entry":"my-stroke-data"}'
```

### 4. Observe Logs
```bash
docker compose logs -f replica1
docker compose logs -f replica2
docker compose logs -f replica3
```

### 5. Hot-Reload Test
Open `replica/src/index.js`, change `HEARTBEAT_INTERVAL = 150` to `200`, save.  
The container restarts; watch the dashboard for the brief candidacy and re-election.

---

## Integration with Gateway

When the Gateway needs to submit a stroke:
```
POST http://replica1:3001/client-entry
Content-Type: application/json
{ "entry": { "type": "stroke", "points": [...] } }
```
If replica1 is not the leader, it responds:
```json
{ "success": false, "error": "Not leader", "leaderId": "replica2",
  "redirect": "http://replica2/client-entry" }
```
Gateway should follow the redirect.

To discover the current leader from any replica:
```
GET http://replica1:3001/status  →  { "leaderId": "replica2", ... }
```

---

## File Structure

```
miniraft/
├── replica/
│   ├── src/
│   │   └── index.js          ← All RAFT logic (single file)
│   ├── package.json
│   ├── Dockerfile
│   └── .dockerignore
├── dashboard/
│   ├── public/
│   │   └── index.html        ← Full dashboard UI (zero dependencies)
│   ├── server.js             ← Aggregator + API proxy
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── setup.bat                 ← Windows: build images
├── run.bat                   ← Windows: start + open browser
├── stop.bat                  ← Windows: graceful stop
└── README.md
```
