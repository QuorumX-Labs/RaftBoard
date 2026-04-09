/**
 * server.js — Monica's Gateway Entry Point (flat folder version)
 */

'use strict';

const express      = require('express');
const http         = require('http');
const WebSocket    = require('ws');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');

const config         = require('./config');
const wsHandler      = require('./websocketHandler');
const leaderMgr      = require('./leaderManager');
const registry       = require('./clientRegistry');
const logger         = require('./logger');

// ── Express App ──────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// ── HTTP Rate Limiting ───────────────────────────────────────────────────────
const httpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests from this IP' },
});
app.use(httpLimiter);

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:        'ok',
    gateway:       'monica-gateway',
    currentLeader: leaderMgr.getCurrentLeader() || 'discovering',
    replicas:      config.REPLICAS,
    clients:       registry.getTotalClients(),
    rooms:         registry.getTotalRooms(),
    uptime:        Math.floor(process.uptime()),
    timestamp:     new Date().toISOString(),
  });
});

// ── Leader Status ─────────────────────────────────────────────────────────────
app.get('/leader', (req, res) => {
  const leader = leaderMgr.getCurrentLeader();
  if (leader) {
    res.json({ leader, status: 'found' });
  } else {
    res.status(503).json({ leader: null, status: 'election in progress' });
  }
});

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });
wsHandler.attach(wss);

// ── Start Leader Detection ────────────────────────────────────────────────────
leaderMgr.startLeaderDetection();

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`[Server] Received ${signal} — shutting down gracefully`);
  leaderMgr.stopLeaderDetection();
  wss.clients.forEach(ws => {
    ws.send(JSON.stringify({ type: 'error', message: 'Gateway restarting — please reconnect' }));
    ws.close();
  });
  server.close(() => {
    logger.info('[Server] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(config.GATEWAY_PORT, '0.0.0.0', () => {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════════╗');
  logger.info(`║   Monica Gateway running on :${config.GATEWAY_PORT}                ║`);
  logger.info('╠══════════════════════════════════════════════════╣');
  logger.info(`║  WebSocket : ws://localhost:${config.GATEWAY_PORT}                 ║`);
  logger.info(`║  Health    : http://localhost:${config.GATEWAY_PORT}/health        ║`);
  logger.info(`║  Leader    : http://localhost:${config.GATEWAY_PORT}/leader        ║`);
  logger.info('╚══════════════════════════════════════════════════╝');
  logger.info('');
});
