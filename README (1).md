# 🌐 Monica's Gateway — WebSocket Server
### MiniRAFT Distributed Drawing Board | Module: Gateway

---

## 👩‍💻 My Contribution

I built the **Gateway WebSocket Server** — the central communication hub of the RaftBoard system. Every browser client connects through my gateway. It accepts drawing events, forwards them to the current RAFT leader, and broadcasts committed strokes back to all connected users in real time.

---

## 📁 My Files

```
monica_gateway/
├── server.js              ← Entry point — starts Express + WebSocket server
├── websocketHandler.js    ← Handles all drawing messages from the frontend
├── leaderManager.js       ← Detects RAFT leader, handles failover + retries
├── clientRegistry.js      ← Tracks connected clients, rooms, rate limiting
├── config.js              ← All environment variables in one place
├── logger.js              ← Structured timestamped logging
├── Dockerfile             ← ARM64-safe container (works on Mac M4 + Intel)
├── package.json           ← Dependencies (pure JS, no native binaries)
└── docker-compose.gateway.yml  ← My section for Aditi to merge
```

---

## 🏗️ How It Works

```
Browser (Bhavani's frontend)
        │
        │  WebSocket  ws://localhost:4000
        ▼
┌──────────────────────────────┐
│      Monica's Gateway        │
│                              │
│  • Accepts WS connections    │
│  • Manages rooms & clients   │
│  • Detects RAFT leader       │
│  • Forwards strokes via REST │
│  • Broadcasts to all clients │
└──────────┬───────────────────┘
           │  REST (HTTP POST)
           ▼
    [ Current RAFT Leader ]   ← Adishree's replica
     replica1 / 2 / 3
```

**A stroke's journey:**
1. User draws → frontend sends `{ type: "stroke", stroke: {...} }`
2. Gateway receives it → POSTs to RAFT leader `/append-entries`
3. Leader commits → gateway broadcasts `{ type: "stroke:committed" }` to all room clients
4. Everyone's canvas updates in real time ✅

---

## ⚙️ How to Run (Local)

**Requirements:** Node.js 18+

```bash
cd monica_gateway
npm install
node server.js
```

Gateway starts on **port 4000**.

```
╔══════════════════════════════════════════╗
║   Monica Gateway running on :4000        ║
║  WebSocket : ws://localhost:4000         ║
║  Health    : http://localhost:4000/health║
║  Leader    : http://localhost:4000/leader║
╚══════════════════════════════════════════╝
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Gateway status, connected clients, current leader |
| GET | `/leader` | Which RAFT replica is currently the leader |

---

## 📨 WebSocket Message Protocol

Matches Bhavani's DrawSync frontend exactly — **no frontend changes needed.**

### Messages the gateway receives (from frontend):

| Type | Payload | Description |
|------|---------|-------------|
| `stroke` | `{ stroke: { points, color, width, ... } }` | User drew a stroke |
| `cursor` | `{ pos: { x, y } }` | User moved their cursor |
| `undo` | — | Undo last stroke |
| `clear` | — | Clear entire canvas |

### Messages the gateway sends (to frontend):

| Type | Payload | Description |
|------|---------|-------------|
| `init` | `{ strokes, participants, yourColor, userId }` | Sent on join — full canvas state |
| `stroke:committed` | `{ stroke }` | Broadcast after leader commits a stroke |
| `undo:committed` | `{ strokes }` | Broadcast after undo is committed |
| `cursor:update` | `{ userId, userName, color, pos }` | Another user's cursor moved |
| `user:joined` | `{ userId, userName, participants }` | Someone joined the room |
| `user:left` | `{ userId, userName, participants }` | Someone left the room |
| `clear` | — | Canvas was cleared |
| `error` | `{ message }` | Rate limit, auth error, etc. |

### WebSocket Connection URL:
```
ws://localhost:4000/?roomId=ROOM&userId=USER&userName=NAME&password=PASS
```

---

## 🛡️ Unit 4 Cloud Concepts Implemented

| Concept | Where |
|---------|-------|
| **Master-Slave Model** | Strokes only go to RAFT leader (master). Cursor updates bypass consensus (peer-to-peer). |
| **Fault Tolerance** | If leader fails, gateway detects it within 2s and reroutes to new leader |
| **Retry Logic** | Failed leader forwards retry 3 times with 500ms delay before giving up |
| **Failure Detection** | Heartbeat poll every 2s with 1.5s timeout per replica |
| **Unreliable Communication** | `Promise.allSettled()` — one dead replica doesn't crash discovery |
| **Leader Election Awareness** | Polls `/heartbeat` on all replicas, routes to whoever says `{ role: "leader" }` |
| **Reverse Proxy** | Single public port 4000 — clients never see replica URLs |
| **Multitenancy** | Multiple rooms run simultaneously, fully isolated |
| **DoS Protection** | 30 msg/sec per client, 10 connections per IP, 200 HTTP req/min |
| **Resource Allocation** | Docker limits: 0.5 CPU, 256MB RAM |
| **Container Security** | Non-root user, alpine base image, no secrets in image |
| **Zero Downtime** | SIGTERM handler closes connections gracefully before exit |
| **Kubernetes-Ready** | All config via env vars, `/health` liveness probe, bind to `0.0.0.0` |

---

## 🐳 Docker

```bash
# Build
docker build -t monica-gateway ./monica_gateway

# Run standalone
docker run -p 4000:4000 \
  -e REPLICA1_URL=http://replica1:5001 \
  -e REPLICA2_URL=http://replica2:5002 \
  -e REPLICA3_URL=http://replica3:5003 \
  monica-gateway
```

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_PORT` | `4000` | Server port |
| `REPLICA1_URL` | `http://localhost:5001` | RAFT replica 1 |
| `REPLICA2_URL` | `http://localhost:5002` | RAFT replica 2 |
| `REPLICA3_URL` | `http://localhost:5003` | RAFT replica 3 |
| `HEARTBEAT_INTERVAL_MS` | `2000` | Leader poll frequency |
| `HEARTBEAT_TIMEOUT_MS` | `1500` | Replica response timeout |
| `LEADER_RETRY_ATTEMPTS` | `3` | Retries before giving up |
| `RATE_LIMIT_MSG_PER_SEC` | `30` | Max WS messages per client/sec |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

---

## 🤝 Integration Contracts

### With Bhavani (Frontend)
- **No changes needed** to her frontend
- Gateway listens on `ws://localhost:4000` — same as her old server
- All message types and event names are identical

### With Adishree (RAFT Replicas)
Each replica must expose:
```
GET /heartbeat
→ { "role": "leader" }   or   { "role": "follower" }

POST /append-entries
Body: { type, stroke/undo/clear, roomId }
→ { success: true }  or  { strokes: [...] }  (for undo)
```

### With Aditi (Deployment)
- My docker-compose section: `monica_gateway/docker-compose.gateway.yml`
- Gateway container name: `monica-gateway`
- Exposed port: `4000` only
- Expects replica containers named: `replica1`, `replica2`, `replica3`
- Internal ports: `5001`, `5002`, `5003`

---

## ✅ Testing Checklist

```bash
# 1. Health check
curl http://localhost:4000/health

# 2. Leader status
curl http://localhost:4000/leader

# 3. Open Bhavani's index.html in browser
#    → Status dot should go GREEN

# 4. Open two browser tabs, same room
#    → Cursors sync between tabs ✅
#    → Strokes sync between tabs ✅
#    → User joined/left toasts work ✅
```

---

## 👤 Team

| Member | Module |
|--------|--------|
| **Bhavani** | Frontend Drawing Board |
| **Monica** | Gateway WebSocket Server ← *this module* |
| **Adishree** | Mini-RAFT Replica Logic |
| **Aditi** | Docker Deployment & Testing |

---

*QuorumX Labs — MiniRAFT Distributed Drawing Board*
