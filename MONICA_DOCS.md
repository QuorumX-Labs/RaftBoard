# Monica's Gateway — Full Documentation
### MiniRAFT Distributed Drawing Board
#### Module: Gateway WebSocket Server

---

## 1. Architecture Explanation (Student Written Style)

### What is the Gateway?

Think of the gateway as a **receptionist at a company**. All visitors (browser clients) talk only to the receptionist. The receptionist knows who the manager (RAFT leader) is today, and forwards important messages to them. If the manager changes (leader election happens), the receptionist quietly finds the new manager and continues working — the visitors notice nothing.

The gateway sits between Bhavani's frontend (the drawing board) and Adishree's RAFT replicas (the three servers that store strokes). It has three jobs:

1. **Accept WebSocket connections** from every browser client
2. **Forward strokes to the current RAFT leader** via REST calls
3. **Broadcast committed strokes** back to all clients in the room

```
Browser (Bhavani's frontend)
    │
    │  WebSocket (ws://gateway:4000)
    ▼
┌─────────────────────────────────────┐
│           Monica's Gateway          │
│                                     │
│  ┌──────────────────────────────┐   │
│  │    websocketHandler.js       │   │  ← handles all client messages
│  │    clientRegistry.js         │   │  ← tracks connected clients
│  │    leaderManager.js          │   │  ← polls replicas for leader
│  └──────────────────────────────┘   │
└─────────────┬───────────────────────┘
              │  REST (HTTP POST)
              ▼
    ┌─────────────────────┐
    │  Current RAFT Leader│  ← only one replica accepts writes
    │  (replica1/2/3)     │
    └─────────────────────┘
          │  Replication
    ┌─────┴──────┐
    ▼            ▼
 replica2     replica3   ← followers (read-only)
```

### How a Drawing Stroke Flows

1. User draws on canvas → Bhavani's frontend sends `{ type: "stroke", stroke: {...} }` over WebSocket
2. Gateway receives it → calls `leaderManager.forwardToLeader('/append-entries', stroke)`
3. If leader is alive → leader commits stroke, returns OK
4. Gateway stores stroke in local cache → broadcasts `{ type: "stroke:committed", stroke }` to ALL clients in the room
5. Other users' canvases update in real time

### What Happens When a Leader Fails

1. `leaderManager.js` polls `/heartbeat` on all 3 replicas every 2 seconds
2. If replica1 (leader) stops responding → it's marked unreachable
3. RAFT replicas internally elect a new leader (Adishree's logic handles this)
4. On the next poll, replica2 responds with `{ role: "leader" }` → gateway updates `currentLeaderUrl`
5. All future strokes go to replica2
6. Clients never disconnect — they just experience a brief pause (≤2 seconds)

---

## 2. How the Gateway Implements Unit 4 Topics

### Master-Slave vs Peer-to-Peer Models
- **Master-slave for writes**: The gateway enforces that all stroke commits go only to the RAFT leader (master). Followers (slaves) never receive write requests from the gateway.
- **Peer-to-peer for cursor updates**: Cursor positions are ephemeral and don't need consensus. The gateway fans them out directly to all room clients without involving the RAFT layer.
- *Code location*: `websocketHandler.js` — the `switch(msg.type)` block routes `stroke` to the leader but handles `cursor` directly.

### Resource Allocation
- The Docker Compose `deploy.resources` block caps the gateway at 0.5 CPU and 256MB RAM. This prevents the gateway from starving the replica containers on the same host.
- Per-IP connection limiting (`RATE_LIMIT_CONN_PER_IP`) ensures no single client monopolises gateway connections.
- *Code location*: `docker-compose.gateway.yml`, `clientRegistry.js`.

### Scheduling Algorithms (Request Handling)
- The `switch(msg.type)` in `websocketHandler.js` is a basic request dispatcher — each message type is scheduled to its correct handler.
- Messages that exceed the rate limit are dropped (priority scheduling: well-behaved clients get through, flooded clients are dropped).
- Broadcast delivery iterates clients in insertion order — fair round-robin delivery.
- *Code location*: `websocketHandler.js`, `clientRegistry.js`.

### Cluster Coordination and Consensus Awareness
- The gateway is *consensus-aware* but does NOT implement consensus. It asks replicas "who is the leader?" via `/heartbeat` and routes to the answer.
- When the leader changes (detected by `leaderManager.js`), all registered callbacks fire so the system adapts immediately.
- *Code location*: `leaderManager.js` — `_discoverLeader()` and `onLeaderChange()`.

### Fault Tolerance and Partial Failure Handling
- If one replica is down, the gateway skips it and checks the others.
- If the leader goes down mid-stroke, `forwardToLeader` retries 3 times with 500ms delays before giving up.
- If the gateway itself restarts, clients auto-reconnect (Bhavani's frontend has auto-reconnect logic with 2s retry).
- During undo, if the leader is unreachable, the gateway degrades gracefully by applying undo locally.
- *Code location*: `leaderManager.js` — `_postWithRetry()`, `websocketHandler.js` — catch blocks.

### Failure Detection and Retry Logic
- Every 2 seconds, `leaderManager.js` checks all 3 replicas with a 1.5s timeout.
- If a replica doesn't respond within 1.5s, it's treated as failed (partial failure).
- `_postWithRetry` retries forwarding 3 times with 500ms gaps.
- *Code location*: `leaderManager.js` — `_checkReplica()` and `_postWithRetry()`.

### Unreliable Communication Handling
- All HTTP calls to replicas have explicit timeouts (not relying on OS defaults).
- `Promise.allSettled()` is used instead of `Promise.all()` so one failed replica doesn't crash the whole discovery.
- JSON parse errors from replica responses are caught and handled.
- *Code location*: `leaderManager.js` — `_checkReplica()` uses `allSettled`, `_httpPost()` wraps in try/catch.

### Leader Election Awareness
- The gateway does not vote, does not maintain a RAFT log, and does not send heartbeats as a RAFT node.
- It only READS the election result by querying `/heartbeat` on each replica.
- When `{ role: "leader" }` is detected, that replica's URL becomes `currentLeaderUrl`.
- *Code location*: `leaderManager.js` — entire file.

### Distributed Coordination
- The in-memory stroke cache in `websocketHandler.js` provides local coordination — new joiners get the canvas state immediately without querying a replica.
- `clientRegistry.js` coordinates room membership — who is in which room, who just joined, who left.
- Room broadcasts coordinate all clients to see the same canvas state.

### Reverse Proxy Based Scaling
- The gateway is the single entry point for all clients. No client ever knows the replica URLs.
- This is the reverse proxy pattern — one public endpoint, multiple hidden backends.
- If we add a 4th replica, only `REPLICA4_URL` needs adding in env vars. No client changes needed.
- *Code location*: `config.js` — `REPLICAS` array, `docker-compose.gateway.yml` — single exposed port.

### Hybrid Cloud Readiness
- All config comes from environment variables. This means the same Docker image runs on a local laptop, an AWS EC2 instance, or a Kubernetes cluster with no code changes.
- The Dockerfile produces a portable image that works on both ARM64 (Mac M4) and AMD64 (cloud VMs).
- *Code location*: `config.js`, `Dockerfile`.

### Multitenancy (Multiple Clients Drawing Simultaneously)
- Each `roomId` is an isolated tenant. Strokes from room "alice" never reach room "bob".
- `clientRegistry.js` maintains a `rooms` Map where each key is a roomId and the value is the Set of WebSocket connections in that room.
- Multiple rooms run simultaneously with no interference.
- *Code location*: `clientRegistry.js` — `rooms` Map, `broadcastToRoom()`.

### Cloud Security Requirements
- **Rate limiting**: `express-rate-limit` on HTTP endpoints, per-client message rate limiting on WebSocket.
- **Per-IP connection cap**: Prevents a single machine from opening hundreds of WebSocket connections.
- **Non-root container**: Dockerfile creates a `gateway` user and runs as it.
- **Authentication-ready**: The WebSocket URL includes `userId`, `userName`, and `password` params matching Bhavani's frontend. The gateway is structured to accept a JWT token here in future (IAM-compatible).
- **Input validation**: All incoming WebSocket messages are JSON-parsed in a try/catch. Malformed messages are silently dropped.
- *Code location*: `server.js`, `clientRegistry.js`, `Dockerfile`.

### Container Security
- Minimal base image: `node:18-alpine` (~50MB vs ~1GB for `node:18`).
- Non-root user: `adduser gateway` + `USER gateway`.
- Only production dependencies installed (`--omit=dev`).
- Only source files copied, never `.env` files or secrets.

### Authentication-Ready Architecture (IAM Compatible)
- The gateway reads `password` from the WebSocket URL params (same as Bhavani's frontend).
- The architecture is ready for JWT: just add a `token` param check in `websocketHandler.js` before `addClient()`. No other changes needed.

### DoS Awareness
- HTTP rate limit: 200 requests/minute per IP (via `express-rate-limit`).
- WebSocket message rate: 30 messages/second per client (via `checkRateLimit()` in `clientRegistry.js`).
- Per-IP connection cap: 10 connections per IP.
- Clients that exceed limits receive an error message and continue (not hard-blocked, to avoid false positives).

---

## 3. Docker Build Instructions

### Prerequisites
- Docker Desktop (Mac M4 / Apple Silicon — already ARM-native, no flags needed)
- Node.js 18+ (only if running locally without Docker)

### Build the Gateway Image

```bash
# From the project root
docker build -t monica-gateway ./monica_gateway

# Verify it built for the correct architecture
docker inspect monica-gateway | grep Architecture
# Should show: "arm64" on Mac M4, "amd64" on Intel
```

### Run with Docker Compose (full project)

```bash
# From project root — starts all containers
docker-compose up --build

# Rebuild only Monica's gateway without restarting replicas
docker-compose up --build gateway

# View gateway logs only
docker-compose logs -f gateway
```

### Run Gateway Locally (for development, without Docker)

```bash
cd monica_gateway
npm install

# Set replica URLs (pointing to wherever Adishree's replicas run)
export REPLICA1_URL=http://localhost:5001
export REPLICA2_URL=http://localhost:5002
export REPLICA3_URL=http://localhost:5003

npm start
# Gateway starts on ws://localhost:4000
```

### Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_PORT` | `4000` | WebSocket + HTTP port |
| `REPLICA1_URL` | `http://replica1:5001` | First RAFT replica |
| `REPLICA2_URL` | `http://replica2:5002` | Second RAFT replica |
| `REPLICA3_URL` | `http://replica3:5003` | Third RAFT replica |
| `HEARTBEAT_INTERVAL_MS` | `2000` | How often to poll for leader |
| `HEARTBEAT_TIMEOUT_MS` | `1500` | Replica response timeout |
| `LEADER_RETRY_ATTEMPTS` | `3` | Retries before giving up |
| `LEADER_RETRY_DELAY_MS` | `500` | Delay between retries |
| `RATE_LIMIT_MSG_PER_SEC` | `30` | Max WebSocket msgs per client/sec |
| `RATE_LIMIT_CONN_PER_IP` | `10` | Max WebSocket connections per IP |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

---

## 4. How to Test Leader Failover

### Test 1: Basic Failover

```bash
# Start everything
docker-compose up --build

# Check who the leader is
curl http://localhost:4000/leader
# → { "leader": "http://replica1:5001", "status": "found" }

# Open Bhavani's frontend and draw something — strokes should commit

# Kill the current leader
docker-compose stop replica1

# Wait ~2 seconds (one heartbeat cycle)

# Check leader again
curl http://localhost:4000/leader
# → { "leader": "http://replica2:5002", "status": "found" }

# Draw again — strokes should still commit to the new leader
# The frontend stays connected — no page refresh needed
```

### Test 2: Gateway Logs During Failover

```bash
docker-compose logs -f gateway
```

You should see:
```
[INFO] [LeaderManager] Replica http://replica1:5001 unreachable: connect ECONNREFUSED
[WARN] [LeaderManager] No leader found (attempt 1). Replicas may be electing.
[INFO] [LeaderManager] Leader changed: http://replica1:5001 → http://replica2:5002
```

### Test 3: Replica Restart (Zero Downtime)

```bash
# Restart replica1 (simulates container restart / deploy)
docker-compose restart replica1

# Watch the gateway logs — it should seamlessly switch to replica2
# then switch back to replica1 when it becomes leader again (if RAFT elects it)
# All the while, browser clients stay connected
```

### Test 4: Multiple Clients (Multitenancy)

```bash
# Open Bhavani's frontend in 3 browser tabs
# Tab 1: room = "room-alpha", Tab 2: room = "room-alpha", Tab 3: room = "room-beta"

# Draw in Tab 1 → Tab 2 sees the stroke (same room)
# Draw in Tab 3 → Tabs 1 and 2 do NOT see it (different room)

# Check health endpoint
curl http://localhost:4000/health
# → { "clients": 3, "rooms": 2, ... }
```

### Test 5: Rate Limiting

```bash
# Flood the gateway with WebSocket messages from a single client
# (can write a quick Node.js test script for this)

# The gateway should:
# 1. Allow the first 30 messages/second through
# 2. Send { "type": "error", "message": "Rate limit exceeded" } for excess messages
# 3. NOT disconnect the client
```

---

## 5. Sample Logs

### Normal Startup
```
[2025-04-01T10:00:00.000Z] [INFO] [Server] ╔══════════════════════════════════════════╗
[2025-04-01T10:00:00.001Z] [INFO] [Server]    Monica's Gateway running on :4000
[2025-04-01T10:00:00.002Z] [INFO] [LeaderManager] Starting leader detection loop
[2025-04-01T10:00:00.100Z] [INFO] [LeaderManager] Leader changed: none → http://replica1:5001
```

### Client Joins
```
[2025-04-01T10:00:15.220Z] [INFO] [ClientRegistry] New room created: "art-room"
[2025-04-01T10:00:15.221Z] [INFO] [ClientRegistry] Client joined — user: Alice, room: "art-room", ip: 172.18.0.5, total room size: 1
[2025-04-01T10:00:15.222Z] [INFO] [WSHandler] Client connected — user: "Alice" (u-a3f7b2), room: "art-room", ip: 172.18.0.5
[2025-04-01T10:00:18.500Z] [INFO] [ClientRegistry] Client joined — user: Bob, room: "art-room", ip: 172.18.0.6, total room size: 2
```

### Stroke Committed
```
[2025-04-01T10:00:22.100Z] [DEBUG] [WSHandler] Stroke committed — user: Alice, room: "art-room", leader: http://replica1:5001
[2025-04-01T10:00:22.101Z] [DEBUG] [ClientRegistry] Broadcast to room "art-room" — 2/2 clients
```

### Leader Failover
```
[2025-04-01T10:05:00.000Z] [DEBUG] [LeaderManager] Timeout checking http://replica1:5001
[2025-04-01T10:05:00.001Z] [WARN]  [LeaderManager] No leader found (attempt 1). Replicas may be electing.
[2025-04-01T10:05:02.002Z] [WARN]  [LeaderManager] No leader found (attempt 2). Replicas may be electing.
[2025-04-01T10:05:04.003Z] [INFO]  [LeaderManager] Leader changed: http://replica1:5001 → http://replica2:5002
```

### Rate Limit Hit
```
[2025-04-01T10:07:45.300Z] [WARN] [ClientRegistry] Rate limit hit — user: Charlie, room: "art-room", count: 31
```

### Client Disconnects
```
[2025-04-01T10:10:00.000Z] [INFO] [WSHandler] Client disconnected — user: "Alice", room: "art-room"
[2025-04-01T10:10:00.001Z] [INFO] [ClientRegistry] Room empty, removed: "art-room"
```

### Graceful Shutdown
```
[2025-04-01T10:15:00.000Z] [INFO] [Server] Received SIGTERM — shutting down gracefully
[2025-04-01T10:15:00.001Z] [INFO] [Server] HTTP server closed
```

---

## 6. How This Avoids Overlapping with RAFT Logic

This is important: Monica's gateway does NOT implement any RAFT algorithms.

| What RAFT Does (Adishree's module) | What the Gateway Does (Monica's module) |
|---|---|
| Runs leader election (RequestVote RPC) | Asks "who won?" via GET /heartbeat |
| Manages election timeouts and terms | Never tracks RAFT terms |
| Replicates log entries to followers | Only POSTs to the leader, never to followers |
| Handles AppendEntries RPC between nodes | Uses AppendEntries as a REST endpoint (black box) |
| Maintains a persistent log on disk | Keeps a lightweight in-memory stroke cache only |
| Commits entries when quorum is reached | Trusts the leader's response as "committed" |
| Detects follower failures | Only detects if a replica is reachable or not |

**The gateway treats RAFT replicas as black boxes.** It knows:
- There exists a `/heartbeat` endpoint that tells it who the leader is
- There exists an `/append-entries` endpoint that the leader uses to accept writes
- If the leader changes, the next heartbeat poll will tell it who the new leader is

The gateway does not care HOW the leader was elected. It does not participate in votes. It does not send heartbeats as a RAFT node. It only reads the output of the RAFT algorithm (who is the current leader) and routes accordingly.

---

## 7. Integration Note for Bhavani

Your DrawSync frontend connects to `ws://localhost:4000` — **that's exactly what the gateway listens on**. No changes needed to your frontend.

The gateway handles all the same message types your backend did:

| Your message (sent) | Gateway handles it |
|---|---|
| `{ type: "stroke", stroke: {...} }` | ✅ Forwards to RAFT leader, broadcasts `stroke:committed` |
| `{ type: "cursor", pos: {...} }` | ✅ Broadcasts `cursor:update` directly (no RAFT needed) |
| `{ type: "undo" }` | ✅ Forwards to leader, broadcasts `undo:committed` |
| `{ type: "clear" }` | ✅ Forwards to leader, broadcasts `clear` |

| Your message (received) | Gateway sends it |
|---|---|
| `init` | ✅ Sent on connection with full stroke history |
| `stroke:committed` | ✅ Broadcast after leader commits |
| `undo:committed` | ✅ Broadcast after leader commits |
| `cursor:update` | ✅ Fanned out directly |
| `user:joined` | ✅ Broadcast on new connection |
| `user:left` | ✅ Broadcast on disconnect |
| `clear` | ✅ Broadcast after leader commits |
| `error` | ✅ Sent for rate limit, leader unavailable, bad password |

**Your connection URL format is preserved exactly:**
```
ws://localhost:4000/?roomId=xxx&userId=xxx&userName=xxx&password=xxx
```
