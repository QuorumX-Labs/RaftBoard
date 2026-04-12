/**
 * Mini-RAFT Replica Node
 * Implements: Leader Election, Log Replication, Heartbeat, Catch-Up Sync
 * Part of: Distributed Real-Time Drawing Board Assignment
 */

const express = require('express');
const axios   = require('axios');
const cors    = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ─── Config ────────────────────────────────────────────────────────────────
const REPLICA_ID           = process.env.REPLICA_ID  || 'replica1';
const PORT                 = parseInt(process.env.PORT) || 3001;
const PEERS                = (process.env.PEERS || '').split(',').filter(Boolean);
const ELECTION_TIMEOUT_MIN = 500;   // ms
const ELECTION_TIMEOUT_MAX = 800;   // ms
const HEARTBEAT_INTERVAL   = 150;   // ms
const RPC_TIMEOUT          = 250;   // ms per RPC call

// ─── Persistent State (would be written to disk in production) ─────────────
let currentTerm = 0;   // latest term this node has seen
let votedFor    = null; // candidateId we voted for in currentTerm
let raftLog     = [];   // [{term, index, entry, timestamp}]

// ─── Volatile State ─────────────────────────────────────────────────────────
let commitIndex  = -1;  // highest log entry known to be committed
let lastApplied  = -1;  // highest log entry applied to state machine

// ─── Leader Volatile State ──────────────────────────────────────────────────
let nextIndex  = {};  // peer → next log index to send
let matchIndex = {};  // peer → highest log index replicated

// ─── Node Role ──────────────────────────────────────────────────────────────
let role     = 'follower';  // follower | candidate | leader
let leaderId = null;
let votesReceived = new Set();

// ─── Timers ─────────────────────────────────────────────────────────────────
let electionTimer  = null;
let heartbeatTimer = null;
let startTime      = Date.now();

// ─── Dashboard / Observability ──────────────────────────────────────────────
let eventLog      = [];   // recent events (newest first)
let electionHistory = []; // all elections this node participated in
let termChanges   = [];   // timeline of term transitions
let rpcStats      = { sent: 0, received: 0, failed: 0 };
let lastHeartbeatReceived = null;
let lastHeartbeatSent     = null;
let appliedEntries = [];  // committed strokes (state machine output)

// ═══════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════
function logEvent(type, msg, meta = {}) {
  const ev = {
    time:      new Date().toISOString(),
    timestamp: Date.now(),
    type,           // ELECTION | VOTE | LEADER | APPEND | COMMIT | SYNC | HEARTBEAT | ERROR
    message:   msg,
    term:      currentTerm,
    role,
    ...meta
  };
  eventLog.unshift(ev);
  if (eventLog.length > 200) eventLog.pop();
  console.log(`[${REPLICA_ID}][${role.toUpperCase()}][T${currentTerm}] ${type}: ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Timer Management
// ═══════════════════════════════════════════════════════════════════════════
function randomElectionTimeout() {
  return Math.floor(Math.random() * (ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN))
    + ELECTION_TIMEOUT_MIN;
}

function resetElectionTimer() {
  if (electionTimer) clearTimeout(electionTimer);
  const timeout = randomElectionTimeout();
  electionTimer = setTimeout(startElection, timeout);
}

function stopElectionTimer() {
  if (electionTimer) { clearTimeout(electionTimer); electionTimer = null; }
}

function stopHeartbeatTimer() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Role Transitions
// ═══════════════════════════════════════════════════════════════════════════
function becomeFollower(term, fromId) {
  const prevRole = role;
  role = 'follower';

  if (term > currentTerm) {
    currentTerm = term;
    votedFor    = null;
    termChanges.push({ term: currentTerm, role: 'follower', from: fromId, time: Date.now() });
  }

  if (fromId) leaderId = fromId;
  stopHeartbeatTimer();
  resetElectionTimer();

  if (prevRole !== 'follower') {
    logEvent('ROLE', `Stepped down to FOLLOWER (term=${currentTerm}, leader=${leaderId || '?'})`);
  }
}

function becomeCandidate() {
  role          = 'candidate';
  currentTerm  += 1;
  votedFor      = REPLICA_ID;
  votesReceived = new Set([REPLICA_ID]);
  leaderId      = null;

  stopHeartbeatTimer();
  resetElectionTimer();

  termChanges.push({ term: currentTerm, role: 'candidate', time: Date.now() });
  electionHistory.push({
    term:      currentTerm,
    startTime: Date.now(),
    outcome:   'pending',
    votes:     1,
    needed:    majority()
  });

  logEvent('ELECTION', `Started election (term=${currentTerm}, peers=${PEERS.length})`);
}

function becomeLeader() {
  role     = 'leader';
  leaderId = REPLICA_ID;

  stopElectionTimer();
  stopHeartbeatTimer();

  // Initialise per-peer indices
  for (const peer of PEERS) {
    nextIndex[peer]  = raftLog.length;
    matchIndex[peer] = -1;
  }

  // Mark last election as won
  const last = electionHistory[electionHistory.length - 1];
  if (last && last.term === currentTerm) {
    last.outcome  = 'won';
    last.votes    = votesReceived.size;
    last.endTime  = Date.now();
    last.duration = last.endTime - last.startTime;
  }

  termChanges.push({ term: currentTerm, role: 'leader', time: Date.now() });
  logEvent('LEADER', `WON election — now LEADER (term=${currentTerm}, votes=${votesReceived.size}/${PEERS.length + 1})`);

  // Start heartbeat loop
  sendHeartbeats();
  heartbeatTimer = setInterval(sendHeartbeats, HEARTBEAT_INTERVAL);
}

function majority() {
  return Math.floor((PEERS.length + 1) / 2) + 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// Leader Election
// ═══════════════════════════════════════════════════════════════════════════
async function startElection() {
  becomeCandidate();

  const lastLogIndex = raftLog.length - 1;
  const lastLogTerm  = lastLogIndex >= 0 ? raftLog[lastLogIndex].term : -1;

  const requests = PEERS.map(peer => requestVoteFrom(peer, lastLogIndex, lastLogTerm));
  await Promise.allSettled(requests);

  // If still candidate and not enough votes → split vote → retry via timer
  if (role === 'candidate') {
    const last = electionHistory[electionHistory.length - 1];
    if (last && last.outcome === 'pending') {
      last.outcome = 'split';
      last.endTime = Date.now();
    }
    logEvent('ELECTION', `Split vote — will retry (term=${currentTerm})`);
  }
}

async function requestVoteFrom(peer, lastLogIndex, lastLogTerm) {
  try {
    rpcStats.sent++;
    const res = await axios.post(`http://${peer}/request-vote`, {
      term:         currentTerm,
      candidateId:  REPLICA_ID,
      lastLogIndex,
      lastLogTerm
    }, { timeout: RPC_TIMEOUT });

    rpcStats.received++;

    if (res.data.term > currentTerm) {
      logEvent('VOTE', `Higher term from ${peer} — stepping down`);
      becomeFollower(res.data.term, null);
      return;
    }

    if (role !== 'candidate') return; // Already decided

    if (res.data.voteGranted) {
      votesReceived.add(peer);
      logEvent('VOTE', `Vote granted by ${peer} (${votesReceived.size}/${majority()} needed)`);

      const last = electionHistory[electionHistory.length - 1];
      if (last) last.votes = votesReceived.size;

      if (votesReceived.size >= majority()) {
        becomeLeader();
      }
    } else {
      logEvent('VOTE', `Vote denied by ${peer}`);
    }
  } catch {
    rpcStats.failed++;
    logEvent('ERROR', `RequestVote to ${peer} failed (unreachable)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Heartbeats & Log Replication
// ═══════════════════════════════════════════════════════════════════════════
async function sendHeartbeats() {
  if (role !== 'leader') return;
  lastHeartbeatSent = Date.now();

  const tasks = PEERS.map(peer => replicateToPeer(peer));
  await Promise.allSettled(tasks);
}

async function replicateToPeer(peer) {
  const ni           = nextIndex[peer] !== undefined ? nextIndex[peer] : raftLog.length;
  const prevLogIndex = ni - 1;
  const prevLogTerm  = prevLogIndex >= 0 && raftLog[prevLogIndex] ? raftLog[prevLogIndex].term : -1;
  const entries      = raftLog.slice(ni);

  try {
    rpcStats.sent++;
    const res = await axios.post(`http://${peer}/append-entries`, {
      term:        currentTerm,
      leaderId:    REPLICA_ID,
      prevLogIndex,
      prevLogTerm,
      entries,
      leaderCommit: commitIndex
    }, { timeout: RPC_TIMEOUT });

    rpcStats.received++;

    if (!res.data.success) {
      if (res.data.term > currentTerm) {
        becomeFollower(res.data.term, null);
        return;
      }
      // Log inconsistency — back up nextIndex
      if (res.data.conflictIndex !== undefined) {
        nextIndex[peer] = Math.max(0, res.data.conflictIndex);
      } else {
        nextIndex[peer] = Math.max(0, ni - 1);
      }
      return;
    }

    // Success
    if (entries.length > 0) {
      nextIndex[peer]  = ni + entries.length;
      matchIndex[peer] = nextIndex[peer] - 1;
      logEvent('APPEND', `Replicated ${entries.length} entries to ${peer}`);
      advanceCommitIndex();
    }
  } catch {
    rpcStats.failed++;
  }
}

function advanceCommitIndex() {
  // Find highest N > commitIndex such that log[N].term === currentTerm
  // and a majority of matchIndex[peer] >= N
  for (let n = raftLog.length - 1; n > commitIndex; n--) {
    if (!raftLog[n] || raftLog[n].term !== currentTerm) continue;

    let replicationCount = 1; // count self
    for (const peer of PEERS) {
      if ((matchIndex[peer] || -1) >= n) replicationCount++;
    }

    if (replicationCount >= majority()) {
      commitIndex = n;
      applyCommitted();
      logEvent('COMMIT', `Committed index=${n} (replicated on ${replicationCount}/${PEERS.length + 1} nodes)`);
      break;
    }
  }
}

function applyCommitted() {
  while (lastApplied < commitIndex) {
    lastApplied++;
    const entry = raftLog[lastApplied];
    if (entry) {
      appliedEntries.push({ index: lastApplied, entry: entry.entry, time: Date.now() });
      if (appliedEntries.length > 500) appliedEntries.shift();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RPC Endpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /request-vote
 * Called by candidates. Grants or denies vote based on RAFT rules.
 */
app.post('/request-vote', (req, res) => {
  rpcStats.received++;
  const { term, candidateId, lastLogIndex, lastLogTerm } = req.body;

  if (term > currentTerm) {
    becomeFollower(term, null);
  }

  const myLastLogIndex = raftLog.length - 1;
  const myLastLogTerm  = myLastLogIndex >= 0 ? raftLog[myLastLogIndex].term : -1;

  // RAFT log-up-to-date check
  const logUpToDate =
    lastLogTerm > myLastLogTerm ||
    (lastLogTerm === myLastLogTerm && lastLogIndex >= myLastLogIndex);

  const canVote = (votedFor === null || votedFor === candidateId);
  const voteGranted = term >= currentTerm && canVote && logUpToDate;

  if (voteGranted) {
    votedFor = candidateId;
    resetElectionTimer();
    logEvent('VOTE', `Granted vote to ${candidateId} (term=${term})`);
  } else {
    logEvent('VOTE', `Denied vote to ${candidateId} (term=${term}, votedFor=${votedFor}, logOK=${logUpToDate})`);
  }

  rpcStats.sent++;
  res.json({ term: currentTerm, voteGranted });
});

/**
 * POST /append-entries
 * Core replication RPC. Also serves as heartbeat when entries=[].
 */
app.post('/append-entries', (req, res) => {
  rpcStats.received++;
  const { term, leaderId: lid, prevLogIndex, prevLogTerm, entries, leaderCommit } = req.body;

  // Reject stale leader
  if (term < currentTerm) {
    rpcStats.sent++;
    return res.json({ term: currentTerm, success: false });
  }

  // Valid leader — reset election timer
  becomeFollower(term, lid);
  lastHeartbeatReceived = Date.now();

  // Consistency check on prevLogIndex/prevLogTerm
  if (prevLogIndex >= 0) {
    if (raftLog.length <= prevLogIndex) {
      // Our log is too short
      rpcStats.sent++;
      return res.json({
        term: currentTerm,
        success: false,
        conflictIndex: raftLog.length
      });
    }
    if (raftLog[prevLogIndex] && raftLog[prevLogIndex].term !== prevLogTerm) {
      // Term conflict — find first index of conflicting term
      const conflictTerm  = raftLog[prevLogIndex].term;
      let conflictIndex   = prevLogIndex;
      while (conflictIndex > 0 && raftLog[conflictIndex - 1].term === conflictTerm) {
        conflictIndex--;
      }
      rpcStats.sent++;
      return res.json({ term: currentTerm, success: false, conflictIndex });
    }
  }

  // Append new entries (overwrite any conflicting tail)
  if (entries && entries.length > 0) {
    raftLog = raftLog.slice(0, prevLogIndex + 1);
    raftLog.push(...entries);
    logEvent('APPEND', `Appended ${entries.length} entries from ${lid} (logLen=${raftLog.length})`);
  }

  // Advance commit index
  if (leaderCommit > commitIndex) {
    commitIndex = Math.min(leaderCommit, raftLog.length - 1);
    applyCommitted();
  }

  rpcStats.sent++;
  res.json({ term: currentTerm, success: true });
});

/**
 * POST /heartbeat
 * Explicit heartbeat endpoint (can also be handled by /append-entries with empty entries).
 */
app.post('/heartbeat', (req, res) => {
  rpcStats.received++;
  const { term, leaderId: lid } = req.body;

  if (term < currentTerm) {
    rpcStats.sent++;
    return res.json({ term: currentTerm, success: false });
  }

  becomeFollower(term, lid);
  lastHeartbeatReceived = Date.now();

  rpcStats.sent++;
  res.json({ term: currentTerm, success: true, logLength: raftLog.length });
});

/**
 * POST /sync-log
 * Called BY the leader ON a follower that needs catch-up.
 * The follower calls this on the leader to pull missing entries.
 * (Per spec: leader calls /sync-log on follower — here leader PUSHES via this endpoint too)
 * 
 * Two modes:
 *  - If called on leader: responds with entries from fromIndex onward
 *  - If called on follower: installs entries sent by leader
 */
app.post('/sync-log', (req, res) => {
  rpcStats.received++;

  // Mode A: This node is the leader — send missing entries
  if (role === 'leader') {
    const { fromIndex = 0 } = req.body;
    const entries = raftLog.slice(fromIndex);
    logEvent('SYNC', `Sent ${entries.length} entries from index ${fromIndex} for catch-up`);
    rpcStats.sent++;
    return res.json({ success: true, entries, commitIndex, term: currentTerm });
  }

  // Mode B: This node is a follower — install entries from leader
  const { term, leaderId: lid, entries, commitIndex: leaderCommit } = req.body;

  if (term && term < currentTerm) {
    rpcStats.sent++;
    return res.json({ term: currentTerm, success: false });
  }

  if (term) becomeFollower(term, lid);

  if (entries && entries.length > 0) {
    raftLog = entries; // Replace log wholesale during catch-up
    logEvent('SYNC', `Catch-up complete: installed ${entries.length} entries from ${lid || leaderId}`);
  }

  if (leaderCommit !== undefined && leaderCommit > commitIndex) {
    commitIndex = Math.min(leaderCommit, raftLog.length - 1);
    applyCommitted();
  }

  rpcStats.sent++;
  res.json({ term: currentTerm, success: true, logLength: raftLog.length });
});

/**
 * POST /client-entry
 * Called by the Gateway to submit a new stroke (or any command).
 * Only the leader accepts this; followers redirect to leader.
 */
app.post('/client-entry', async (req, res) => {
  if (role !== 'leader') {
    return res.status(307).json({
      success:  false,
      error:    'Not leader',
      leaderId,
      redirect: leaderId ? `http://${leaderId}/client-entry` : null
    });
  }

  const { entry } = req.body;
  const newEntry = {
    term:      currentTerm,
    index:     raftLog.length,
    entry,
    timestamp: Date.now()
  };

  raftLog.push(newEntry);
  logEvent('APPEND', `New client entry at index=${newEntry.index}`);

  // Immediately attempt replication (don't wait for heartbeat interval)
  await sendHeartbeats();

  res.json({ success: true, index: newEntry.index, term: currentTerm });
});

// ═══════════════════════════════════════════════════════════════════════════
// Status / Health / Debug Endpoints (for Dashboard)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /status
 * Full diagnostic snapshot for the dashboard.
 */
app.get('/status', (req, res) => {
  const now = Date.now();
  res.json({
    // Identity
    id:          REPLICA_ID,
    port:        PORT,
    peers:       PEERS,

    // Role & Term
    role,
    currentTerm,
    leaderId,
    votedFor,

    // Log
    logLength:   raftLog.length,
    commitIndex,
    lastApplied,
    lastEntries: raftLog.slice(-5).map(e => ({
      index: e.index, term: e.term, ts: e.timestamp
    })),

    // Leader state (only meaningful when role===leader)
    nextIndex:   role === 'leader' ? nextIndex  : {},
    matchIndex:  role === 'leader' ? matchIndex : {},

    // Timing
    uptime:                   Math.floor((now - startTime) / 1000),
    lastHeartbeatReceived,
    lastHeartbeatSent,
    msSinceHeartbeat:         lastHeartbeatReceived ? now - lastHeartbeatReceived : null,

    // Observability
    rpcStats,
    recentEvents:             eventLog.slice(0, 30),
    electionHistory:          electionHistory.slice(-10),
    termHistory:              termChanges.slice(-20),
    appliedCount:             appliedEntries.length
  });
});

/**
 * GET /log
 * Full raft log dump (for debugging).
 */
app.get('/log', (req, res) => {
  res.json({
    id:          REPLICA_ID,
    logLength:   raftLog.length,
    commitIndex,
    entries:     raftLog.slice(-50)  // last 50 entries
  });
});

/**
 * GET /health
 * Simple liveness probe.
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', id: REPLICA_ID, role, term: currentTerm });
});

/**
 * POST /debug/force-election  (dev/test only)
 * Immediately trigger an election (simulate leader loss).
 */
app.post('/debug/force-election', (req, res) => {
  logEvent('DEBUG', 'Force-election triggered via API');
  stopElectionTimer();
  stopHeartbeatTimer();
  role = 'follower';
  startElection();
  res.json({ success: true, message: 'Election started' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  startTime = Date.now();
  logEvent('BOOT', `Replica ${REPLICA_ID} started on port ${PORT}. Peers: [${PEERS.join(', ')}]`);
  // Begin as follower — wait for heartbeat or timeout → election
  becomeFollower(0, null);
  resetElectionTimer();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logEvent('BOOT', 'SIGTERM received — shutting down gracefully');
  stopElectionTimer();
  stopHeartbeatTimer();
  process.exit(0);
});
