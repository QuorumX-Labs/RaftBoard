/**
 * websocketHandler.js — Monica's WebSocket Message Handler (flat folder version)
 */

'use strict';

const WebSocket   = require('ws');
const crypto      = require('crypto');
const registry    = require('./clientRegistry');
const leaderMgr   = require('./leaderManager');
const { ENDPOINTS, RATE_LIMIT_MESSAGES_PER_SECOND,
        RATE_LIMIT_CONNECTIONS_PER_IP } = require('./config');
const logger      = require('./logger');

// ── Color Pool ────────────────────────────────────────────────────────────────
const USER_COLORS = ['#7c6aff','#3ddc84','#ff5f57','#ffbd2e',
                     '#00c8ff','#ff6baf','#ff8c42','#a594ff'];
let colorIndex = 0;
function nextColor() { return USER_COLORS[colorIndex++ % USER_COLORS.length]; }

// ── In-Memory Stroke Cache ────────────────────────────────────────────────────
const roomStrokes = new Map();

function getStrokes(roomId) {
  if (!roomStrokes.has(roomId)) roomStrokes.set(roomId, []);
  return roomStrokes.get(roomId);
}

// ── Leader Change Listener ────────────────────────────────────────────────────
leaderMgr.onLeaderChange((newLeader, oldLeader) => {
  logger.info(`[WSHandler] Leader changed — new: ${newLeader}, old: ${oldLeader || 'none'}`);
});

// ── Main Connection Handler ───────────────────────────────────────────────────
function attach(wss) {

  wss.on('connection', (ws, req) => {
    const rawUrl = req.url || '/';
    const params = new URLSearchParams(rawUrl.replace('/?', '?').replace(/^[^?]*\?/, ''));

    const roomId   = params.get('roomId')   || 'default';
    const userId   = params.get('userId')   || `u-${crypto.randomBytes(3).toString('hex')}`;
    const userName = decodeURIComponent(params.get('userName') || 'Guest');
    const ip       = req.socket.remoteAddress || '0.0.0.0';
    const color    = nextColor();

    // Per-IP connection limit
    const connCount = registry.getConnectionCountForIp(ip);
    if (connCount >= RATE_LIMIT_CONNECTIONS_PER_IP) {
      logger.warn(`[WSHandler] Connection rejected — IP ${ip} at limit`);
      registry.sendToClient(ws, { type: 'error', message: 'Too many connections from your IP' });
      ws.close();
      return;
    }

    registry.addClient(ws, { userId, userName, roomId, color, ip });
    logger.info(`[WSHandler] Client connected — user: "${userName}", room: "${roomId}"`);

    // Send init to new client
    registry.sendToClient(ws, {
      type:         'init',
      strokes:      getStrokes(roomId),
      participants: registry.getRoomParticipants(roomId),
      yourColor:    color,
      userId:       userId,
      leaderUrl:    leaderMgr.getCurrentLeader() || 'discovering...',
    });

    // Tell others someone joined
    registry.broadcastToRoom(roomId, {
      type:         'user:joined',
      userId:       userId,
      userName:     userName,
      color:        color,
      participants: registry.getRoomParticipants(roomId),
    }, ws);

    // ── Message Handler ───────────────────────────────────────────
    ws.on('message', async (raw) => {

      if (!registry.checkRateLimit(ws, RATE_LIMIT_MESSAGES_PER_SECOND)) {
        registry.sendToClient(ws, { type: 'error', message: 'Rate limit exceeded — slow down' });
        return;
      }

      let msg;
      try { msg = JSON.parse(raw); }
      catch { logger.warn(`[WSHandler] Invalid JSON from ${userName}`); return; }

      const info = registry.getClient(ws);
      if (!info) return;

      switch (msg.type) {

        case 'stroke':
          await _handleStroke(ws, info, msg);
          break;

        case 'cursor':
          registry.broadcastToRoom(roomId, {
            type:     'cursor:update',
            userId:   info.userId,
            userName: info.userName,
            color:    info.color,
            pos:      msg.pos,
          }, ws);
          break;

        case 'undo':
          await _handleUndo(ws, info);
          break;

        case 'clear':
          await _handleClear(ws, info);
          break;

        default:
          logger.debug(`[WSHandler] Unknown message type "${msg.type}" from ${userName}`);
      }
    });

    // ── Disconnect ────────────────────────────────────────────────
    ws.on('close', () => {
      const info = registry.getClient(ws);
      if (!info) return;
      const { userId, userName, roomId } = info;
      registry.removeClient(ws);
      registry.broadcastToRoom(roomId, {
        type:         'user:left',
        userId:       userId,
        userName:     userName,
        participants: registry.getRoomParticipants(roomId),
      });
      logger.info(`[WSHandler] Client disconnected — user: "${userName}", room: "${roomId}"`);
    });

    ws.on('error', (err) => {
      logger.error(`[WSHandler] WebSocket error for ${userName}: ${err.message}`);
    });

  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function _handleStroke(ws, info, msg) {
  const stroke = {
    ...msg.stroke,
    userId:   info.userId,
    userName: info.userName,
    color:    info.color,
  };

  try {
    await leaderMgr.forwardToLeader(ENDPOINTS.APPEND, {
      type:   'stroke',
      stroke: stroke,
      roomId: info.roomId,
    });

    getStrokes(info.roomId).push(stroke);
    registry.broadcastToRoom(info.roomId, { type: 'stroke:committed', stroke });
    logger.debug(`[WSHandler] Stroke committed — user: ${info.userName}, room: "${info.roomId}"`);

  } catch (err) {
    logger.error(`[WSHandler] Stroke forward failed: ${err.message}`);
    // Graceful degradation — commit locally if no RAFT leader available
    getStrokes(info.roomId).push(stroke);
    registry.broadcastToRoom(info.roomId, { type: 'stroke:committed', stroke });
    logger.warn(`[WSHandler] Stroke committed locally (no leader) — user: ${info.userName}`);
  }
}

async function _handleUndo(ws, info) {
  try {
    const response = await leaderMgr.forwardToLeader(ENDPOINTS.APPEND, {
      type:   'undo',
      userId: info.userId,
      roomId: info.roomId,
    });
    const strokes = response.strokes || _undoLocalStroke(info.roomId, info.userId);
    roomStrokes.set(info.roomId, strokes);
    const payload = { type: 'undo:committed', strokes };
    registry.broadcastToRoom(info.roomId, payload);
    registry.sendToClient(ws, payload);
  } catch (err) {
    logger.warn(`[WSHandler] Undo — no leader, applying locally`);
    const strokes = _undoLocalStroke(info.roomId, info.userId);
    const payload  = { type: 'undo:committed', strokes };
    registry.broadcastToRoom(info.roomId, payload);
    registry.sendToClient(ws, payload);
  }
}

async function _handleClear(ws, info) {
  try {
    await leaderMgr.forwardToLeader(ENDPOINTS.APPEND, {
      type:   'clear',
      userId: info.userId,
      roomId: info.roomId,
    });
  } catch (err) {
    logger.warn(`[WSHandler] Clear — no leader, applying locally`);
  }
  roomStrokes.set(info.roomId, []);
  const payload = { type: 'clear' };
  registry.broadcastToRoom(info.roomId, payload);
  registry.sendToClient(ws, payload);
}

function _undoLocalStroke(roomId, userId) {
  const strokes = getStrokes(roomId);
  const idx = [...strokes].reverse().findIndex(s => s.userId === userId);
  if (idx !== -1) strokes.splice(strokes.length - 1 - idx, 1);
  return [...strokes];
}

module.exports = { attach };
