/**
 * Mini-RAFT Dashboard Server
 * Aggregates status from all 3 replicas and serves the visual dashboard.
 */

const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = parseInt(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Replica endpoints from environment (or defaults for docker-compose)
const REPLICAS = [
  { id: 'replica1', url: process.env.REPLICA1_URL || 'http://replica1:3001' },
  { id: 'replica2', url: process.env.REPLICA2_URL || 'http://replica2:3002' },
  { id: 'replica3', url: process.env.REPLICA3_URL || 'http://replica3:3003' },
];

// ─── In-memory history for timeline charts ───────────────────────────────
const MAX_HISTORY = 120;  // ~2 minutes at 1s intervals
let clusterHistory = [];  // [{time, states: [{id,role,term,logLength}]}]
let leaderTimeline = [];  // [{time, leaderId, term}]

// ─── Aggregate status ─────────────────────────────────────────────────────
async function fetchReplicaStatus(replica) {
  try {
    const res = await axios.get(`${replica.url}/status`, { timeout: 1000 });
    return { ...res.data, reachable: true, fetchedAt: Date.now() };
  } catch (e) {
    return {
      id: replica.id,
      reachable: false,
      role: 'unknown',
      currentTerm: 0,
      logLength: 0,
      commitIndex: -1,
      error: e.message,
      fetchedAt: Date.now()
    };
  }
}

async function pollCluster() {
  const statuses = await Promise.all(REPLICAS.map(fetchReplicaStatus));

  const snapshot = {
    time:   Date.now(),
    states: statuses.map(s => ({
      id:          s.id,
      role:        s.role,
      term:        s.currentTerm,
      logLength:   s.logLength,
      commitIndex: s.commitIndex,
      reachable:   s.reachable
    }))
  };

  clusterHistory.push(snapshot);
  if (clusterHistory.length > MAX_HISTORY) clusterHistory.shift();

  // Track leader changes
  const leader = statuses.find(s => s.role === 'leader');
  const last   = leaderTimeline[leaderTimeline.length - 1];
  if (leader && (!last || last.leaderId !== leader.id || last.term !== leader.currentTerm)) {
    leaderTimeline.push({ time: Date.now(), leaderId: leader.id, term: leader.currentTerm });
    if (leaderTimeline.length > 50) leaderTimeline.shift();
  }

  return statuses;
}

// Poll every second
let latestStatuses = [];
setInterval(async () => {
  latestStatuses = await pollCluster();
}, 1000);

// Initial poll
(async () => { latestStatuses = await pollCluster(); })();

// ─── API Routes ────────────────────────────────────────────────────────────

// Full cluster snapshot
app.get('/api/cluster', async (req, res) => {
  res.json({
    replicas:       latestStatuses,
    clusterHistory: clusterHistory.slice(-60),
    leaderTimeline,
    pollTime:       Date.now()
  });
});

// Individual replica passthrough
app.get('/api/replica/:id/status', async (req, res) => {
  const replica = REPLICAS.find(r => r.id === req.params.id);
  if (!replica) return res.status(404).json({ error: 'Not found' });
  const status = await fetchReplicaStatus(replica);
  res.json(status);
});

app.get('/api/replica/:id/log', async (req, res) => {
  const replica = REPLICAS.find(r => r.id === req.params.id);
  if (!replica) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await axios.get(`${replica.url}/log`, { timeout: 1000 });
    res.json(result.data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Force-election on a replica
app.post('/api/replica/:id/force-election', async (req, res) => {
  const replica = REPLICAS.find(r => r.id === req.params.id);
  if (!replica) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await axios.post(`${replica.url}/debug/force-election`, {}, { timeout: 1000 });
    res.json(result.data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Inject a test log entry via leader
app.post('/api/inject-entry', async (req, res) => {
  const { entry = 'test-stroke-' + Date.now() } = req.body;
  const leader = latestStatuses.find(s => s.role === 'leader' && s.reachable);
  if (!leader) return res.status(503).json({ error: 'No leader available' });

  const replica = REPLICAS.find(r => r.id === leader.id);
  try {
    const result = await axios.post(`${replica.url}/client-entry`, { entry }, { timeout: 1000 });
    res.json(result.data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Dashboard] Running on http://localhost:${PORT}`);
  console.log(`[Dashboard] Monitoring: ${REPLICAS.map(r => r.url).join(', ')}`);
});
