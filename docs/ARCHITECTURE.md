# RaftBoard — Architecture Document

## 1. Cluster Diagram

```
Browser Clients (multiple tabs / users)
         │   WebSocket (ws://localhost:4000)
         ▼
┌────────────────────────────────┐
│        GATEWAY SERVICE         │  ← Monica's original code (untouched)
│   server.js + leaderManager    │    Extended via OCP: new Docker context
│   websocketHandler.js          │    wires it to port 5001/5002/5003
│      Port 4000                 │
└──────────┬─────────────────────┘
           │  HTTP POST /append-entries  (forwarded to current leader)
           │  HTTP GET  /heartbeat       (leader detection polling)
    ┌──────┼──────────────────────────┐
    │      │                          │
    ▼      ▼                          ▼
┌────────┐  ┌────────┐  ┌────────┐
│Replica1│  │Replica2│  │Replica3│  ← miniraft/replica/src/index.js (untouched)
│Port 5001│  │Port 5002│  │Port 5003│    Extended: separate bind-mount dirs
│follower│  │ LEADER │  │follower│    per replica for hot-reload isolation
└────────┘  └────────┘  └────────┘
         All on raftboard-net (Docker bridge)

┌────────────────────────────────┐
│    RAFT DASHBOARD (port 6001)  │  ← miniraft/dashboard (untouched)
│  Polls /status from replicas   │    Rewired to ports 5001/5002/5003
└────────────────────────────────┘

┌────────────────────────────────┐
│   FRONTEND (port 8080)         │  ← NEW: extension-added drawing board
│   Canvas + WebSocket client    │    Connects to gateway :4000
└────────────────────────────────┘
```

---

## 2. Mini-RAFT Protocol Design

### 2.1 Node States

```
            timeout / no heartbeat
  ┌─────────────────────────────────┐
  │                                 ▼
FOLLOWER ──────────────────── CANDIDATE
  ▲                                 │
  │  higher term seen               │  majority votes received
  │                                 ▼
  └───────────────────────────── LEADER
         step down if higher term
```

### 2.2 Term Lifecycle

```
Term 1:  [R1=follower] [R2=follower] [R3=follower]
         → R1 times out first → R1 becomes candidate → R1 wins → R1=LEADER

Term 2:  R1 stops → R2 or R3 times out → new election → new leader (T2)

Term 3:  R1 restarts → gets heartbeat from T2 leader → rejoins as follower
         → calls /sync-log → catches up committed entries
```

### 2.3 Timing Parameters

| Parameter         | Value      | Reasoning                              |
|-------------------|------------|----------------------------------------|
| Election timeout  | 500–800ms  | Random to avoid split votes            |
| Heartbeat interval| 150ms      | << election timeout → followers stay stable |
| RPC timeout       | 250ms      | Fast enough for 3-node LAN             |
| Gateway poll      | 2000ms     | Leader detection without overload      |

---

## 3. State Transition Diagrams

### 3.1 Follower State Machine

```
FOLLOWER
├── on AppendEntries(term >= currentTerm):
│     reset election timer, update commitIndex, ack success
├── on RequestVote(term >= currentTerm, log up-to-date):
│     grant vote, reset election timer
├── on heartbeat timeout (500–800ms):
│     → CANDIDATE
└── on higher term seen:
      update term, reset votedFor
```

### 3.2 Candidate State Machine

```
CANDIDATE
├── on start:
│     increment term, vote for self, send RequestVote to all peers
├── on majority votes received:
│     → LEADER
├── on AppendEntries from valid leader:
│     → FOLLOWER (leader already elected)
├── on higher term seen:
│     → FOLLOWER
└── on election timeout (no majority):
      retry election (new term)
```

### 3.3 Leader State Machine

```
LEADER
├── on start:
│     initialize nextIndex[], matchIndex[], start heartbeat timer (150ms)
├── every 150ms:
│     send AppendEntries(entries=[]) to all peers (heartbeat)
├── on /append-entries from gateway (new stroke):
│     append to log, replicate via AppendEntries, advance commitIndex
│     when majority acks → mark committed → gateway broadcasts to clients
├── on follower conflict response:
│     decrement nextIndex[peer], retry AppendEntries
├── on higher term seen:
│     → FOLLOWER
└── on majority of peers unreachable:
      keeps trying (remains leader until higher term arrives)
```

---

## 4. API Definitions

### Replica RPC Endpoints

#### POST /request-vote
```json
Request:  { "term": 3, "candidateId": "replica2",
            "lastLogIndex": 5, "lastLogTerm": 2 }
Response: { "term": 3, "voteGranted": true }
```

#### POST /append-entries
```json
Request:  { "term": 3, "leaderId": "replica2",
            "prevLogIndex": 4, "prevLogTerm": 2,
            "entries": [{"term":3,"index":5,"entry":{...}}],
            "leaderCommit": 4 }
Response: { "term": 3, "success": true }
       OR { "term": 3, "success": false, "conflictIndex": 3 }
```

#### GET /heartbeat  (Gateway detection probe)
```json
Response: { "status": "ok", "id": "replica2", "role": "leader", "term": 3 }
```

#### POST /heartbeat  (RAFT heartbeat from leader)
```json
Request:  { "term": 3, "leaderId": "replica2" }
Response: { "term": 3, "success": true, "logLength": 6 }
```

#### POST /sync-log
```json
// Mode A — called ON the leader (pull missing entries)
Request:  { "fromIndex": 3 }
Response: { "success": true, "entries": [...], "commitIndex": 5, "term": 3 }

// Mode B — called ON a follower (push entries from leader)
Request:  { "term": 3, "leaderId": "replica2",
            "entries": [...], "commitIndex": 5 }
Response: { "term": 3, "success": true, "logLength": 6 }
```

#### POST /client-entry  (Gateway stroke submission)
```json
Request:  { "entry": { "type": "stroke", "points": [...], "color": "#7c6aff" } }
Response: { "success": true, "index": 5, "term": 3 }
       OR { "success": false, "error": "Not leader", "leaderId": "replica2" }
```

#### GET /status  (Dashboard / observability)
```json
{ "id": "replica2", "role": "leader", "currentTerm": 3,
  "logLength": 6, "commitIndex": 5, "lastApplied": 5,
  "rpcStats": { "sent": 42, "received": 38, "failed": 1 },
  "recentEvents": [...], "electionHistory": [...] }
```

---

## 5. Failure-Handling Design

| Failure Scenario            | System Response                                               |
|-----------------------------|---------------------------------------------------------------|
| Leader container killed     | Followers time out (500–800ms), new election, new leader      |
| Follower container killed   | Leader detects no ACK, keeps committing with 2/3 majority     |
| All replicas down           | Gateway queues/drops strokes, reconnects when replicas return |
| Network partition (1 node)  | Isolated node stays follower/candidate; majority side wins    |
| Stale leader (higher term)  | Higher-term AppendEntries causes step-down immediately        |
| Restarted node empty log    | prevLogIndex check fails → leader calls sync-log → catch-up  |
| Split vote election         | Random timeout means retry; resolves within 1–2 election cycles |
| Gateway restart             | Clients auto-reconnect; strokes from cache replayed on init   |

---

## 6. OCP Compliance Summary

```
Original files (FROZEN — zero modifications):
  RaftBoard-main/server.js
  RaftBoard-main/config.js
  RaftBoard-main/leaderManager.js
  RaftBoard-main/websocketHandler.js
  RaftBoard-main/clientRegistry.js
  RaftBoard-main/logger.js
  RaftBoard-main/package.json
  RaftBoard-main/Dockerfile
  RaftBoard-main/docker-compose.gateway.yml
  RaftBoard-main/miniraft/replica/src/index.js
  RaftBoard-main/miniraft/replica/package.json
  RaftBoard-main/miniraft/replica/Dockerfile
  RaftBoard-main/miniraft/docker-compose.yml
  RaftBoard-main/miniraft/dashboard/* (all files)
  RaftBoard-main/DrawSync -bhavani/* (all files)

Extension strategy:
  - gateway/          New Docker context that COPIES original files byte-for-byte
  - replica1/src/     Bind-mount target for hot-reload (copy of original)
  - replica2/src/     Bind-mount target for hot-reload (copy of original)
  - replica3/src/     Bind-mount target for hot-reload (copy of original)
  - frontend/         Entirely new drawing board UI
  - docker-compose.yml New orchestration wiring all components on unified network
  - scripts/          New automation (prepare, start, test-failover, chaos)
  - docs/             New documentation
```
