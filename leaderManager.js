/**
 * leaderManager.js — Monica's Leader Detection (flat folder version)
 */

'use strict';

const http  = require('http');
const { REPLICAS, ENDPOINTS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS,
        LEADER_RETRY_ATTEMPTS, LEADER_RETRY_DELAY_MS } = require('./config');
const logger = require('./logger');

let currentLeaderUrl    = null;
let leaderCheckTimer    = null;
let consecutiveFailures = 0;
const onLeaderChangeCallbacks = [];

function startLeaderDetection() {
  logger.info('[LeaderManager] Starting leader detection loop');
  _pollLeader();
  leaderCheckTimer = setInterval(_pollLeader, HEARTBEAT_INTERVAL_MS);
}

function stopLeaderDetection() {
  if (leaderCheckTimer) { clearInterval(leaderCheckTimer); leaderCheckTimer = null; }
}

function getCurrentLeader() { return currentLeaderUrl; }

async function forwardToLeader(path, body) {
  if (!currentLeaderUrl) await _discoverLeader();
  if (!currentLeaderUrl) throw new Error('No RAFT leader available');
  return _postWithRetry(currentLeaderUrl + path, body, LEADER_RETRY_ATTEMPTS);
}

function onLeaderChange(cb) { onLeaderChangeCallbacks.push(cb); }

async function _pollLeader() {
  const previousLeader = currentLeaderUrl;
  const discovered = await _discoverLeader();
  if (discovered && discovered !== previousLeader) {
    logger.info(`[LeaderManager] Leader changed: ${previousLeader || 'none'} → ${discovered}`);
    consecutiveFailures = 0;
    onLeaderChangeCallbacks.forEach(cb => cb(discovered, previousLeader));
  }
  if (!discovered) {
    consecutiveFailures++;
    logger.warn(`[LeaderManager] No leader found (attempt ${consecutiveFailures}). Replicas may be electing.`);
  }
}

async function _discoverLeader() {
  const checks = REPLICAS.map(url => _checkReplica(url));
  try {
    const results = await Promise.allSettled(checks);
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled' && results[i].value) {
        currentLeaderUrl = REPLICAS[i];
        return currentLeaderUrl;
      }
    }
    currentLeaderUrl = null;
    return null;
  } catch (err) {
    logger.error('[LeaderManager] Discovery error:', err.message);
    currentLeaderUrl = null;
    return null;
  }
}

function _checkReplica(replicaUrl) {
  return new Promise((resolve) => {
    const url = replicaUrl + ENDPOINTS.HEARTBEAT;
    const timeout = setTimeout(() => {
      logger.debug(`[LeaderManager] Timeout checking ${replicaUrl}`);
      resolve(false);
    }, HEARTBEAT_TIMEOUT_MS);

    const urlObj  = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port,
      path:     urlObj.pathname,
      method:   'GET',
      headers:  { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      clearTimeout(timeout);
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.role === 'leader' || json.isLeader === true);
        } catch { resolve(false); }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      logger.debug(`[LeaderManager] Replica ${replicaUrl} unreachable: ${err.message}`);
      resolve(false);
    });

    req.end();
  });
}

async function _postWithRetry(url, body, attemptsLeft) {
  try {
    return await _httpPost(url, body);
  } catch (err) {
    if (attemptsLeft <= 1) {
      logger.warn(`[LeaderManager] All retries exhausted. Triggering re-discovery.`);
      currentLeaderUrl = null;
      await _discoverLeader();
      throw new Error(`Failed to forward to leader: ${err.message}`);
    }
    logger.warn(`[LeaderManager] Retry in ${LEADER_RETRY_DELAY_MS}ms (${attemptsLeft - 1} left)`);
    await _sleep(LEADER_RETRY_DELAY_MS);
    return _postWithRetry(url, body, attemptsLeft - 1);
  }
}

function _httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(url);
    const payload = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port,
      path:     urlObj.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try   { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = { startLeaderDetection, stopLeaderDetection, getCurrentLeader, forwardToLeader, onLeaderChange };
