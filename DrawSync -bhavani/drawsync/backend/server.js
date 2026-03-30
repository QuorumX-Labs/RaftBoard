const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Serve frontend statically
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── IN-MEMORY STATE ───
const rooms = new Map();       // roomId → { passwordHash, participants, strokes }
const clients = new Map();     // ws → { userId, userName, roomId, color }

const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR);

const USER_COLORS = ['#7c6aff','#3ddc84','#ff5f57','#ffbd2e','#00c8ff','#ff6baf','#ff8c42','#a594ff'];
let colorIndex = 0;
function nextColor() { return USER_COLORS[colorIndex++ % USER_COLORS.length]; }

function getOrCreateRoom(roomId, password) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      passwordHash: password ? crypto.createHash('sha256').update(password).digest('hex') : null,
      participants: new Map(),
      strokes: loadSnapshot(roomId)
    });
    console.log(`[Room] Created: ${roomId}`);
  }
  return rooms.get(roomId);
}

function broadcast(roomId, data, excludeWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      const info = clients.get(ws);
      if (info && info.roomId === roomId && ws !== excludeWs) {
        ws.send(msg);
      }
    }
  });
}

function getRoomParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.participants.values());
}

// ─── SNAPSHOT ───
function saveSnapshot(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const filePath = path.join(SNAPSHOT_DIR, `${roomId}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ strokes: room.strokes, savedAt: Date.now() }));
}

function loadSnapshot(roomId) {
  const filePath = path.join(SNAPSHOT_DIR, `${roomId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`[Snapshot] Loaded ${data.strokes.length} strokes for room ${roomId}`);
      return data.strokes;
    } catch (e) { return []; }
  }
  return [];
}

// Auto-save every 30s
setInterval(() => {
  rooms.forEach((_, roomId) => saveSnapshot(roomId));
}, 30000);

// ─── WEBSOCKET ───
wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url.replace('/?', ''));
  const roomId = params.get('roomId') || 'default';
  const userId = params.get('userId') || `u-${Math.random().toString(36).slice(2,8)}`;
  const userName = decodeURIComponent(params.get('userName') || 'Guest');
  const password = params.get('password') || '';
  const color = nextColor();

  // Validate password
  const room = getOrCreateRoom(roomId, password);
  if (room.passwordHash) {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    if (hash !== room.passwordHash) {
      ws.send(JSON.stringify({ type: 'error', message: 'Incorrect room password' }));
      ws.close();
      return;
    }
  }

  // Register client
  clients.set(ws, { userId, userName, roomId, color });
  room.participants.set(userId, { userId, userName, color });

  console.log(`[WS] ${userName} joined room "${roomId}" (${room.participants.size} users)`);

  // Send existing strokes to new client
  ws.send(JSON.stringify({
    type: 'init',
    strokes: room.strokes,
    participants: getRoomParticipants(roomId),
    yourColor: color,
    userId
  }));

  // Tell others someone joined
  broadcast(roomId, {
    type: 'user:joined',
    userId, userName, color,
    participants: getRoomParticipants(roomId)
  }, ws);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const info = clients.get(ws);
    if (!info) return;

    switch (msg.type) {
      case 'stroke': {
        const stroke = { ...msg.stroke, userId: info.userId, userName: info.userName };
        room.strokes.push(stroke);
        broadcast(roomId, { type: 'stroke:committed', stroke }, ws);
        break;
      }
      case 'undo': {
        // Remove last stroke by this user
        const idx = [...room.strokes].reverse().findIndex(s => s.userId === info.userId);
        if (idx !== -1) {
          room.strokes.splice(room.strokes.length - 1 - idx, 1);
          broadcast(roomId, { type: 'undo:committed', strokes: room.strokes });
          ws.send(JSON.stringify({ type: 'undo:committed', strokes: room.strokes }));
        }
        break;
      }
      case 'cursor': {
        broadcast(roomId, {
          type: 'cursor:update',
          userId: info.userId, userName: info.userName,
          color: info.color, pos: msg.pos
        }, ws);
        break;
      }
      case 'clear': {
        room.strokes = [];
        broadcast(roomId, { type: 'clear' });
        ws.send(JSON.stringify({ type: 'clear' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (!info) return;
    clients.delete(ws);
    const r = rooms.get(info.roomId);
    if (r) {
      r.participants.delete(info.userId);
      broadcast(info.roomId, {
        type: 'user:left',
        userId: info.userId, userName: info.userName,
        participants: getRoomParticipants(info.roomId)
      });
      if (r.participants.size === 0) saveSnapshot(info.roomId);
    }
    console.log(`[WS] ${info.userName} left room "${info.roomId}"`);
  });
});

// ─── REST API ───
app.get('/api/rooms', (req, res) => {
  const list = [];
  rooms.forEach((r, id) => list.push({ id, users: r.participants.size, protected: !!r.passwordHash }));
  res.json(list);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, clients: clients.size, uptime: Math.floor(process.uptime()) });
});

// ─── START ───
const PORT = 4000;
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   DrawSync Server running on :${PORT}   ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║  Open: http://localhost:${PORT}          ║`);
  console.log(`║  Share your IP for teammates to join ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
