# Bhavani — Frontend & Backend Services
### MiniRAFT Distributed Drawing Board

---

## My Contribution

I built the **frontend drawing board** and **three backend support services** for this project.

---

## Folder Structure

```
bhavani/
├── frontend/
│   └── index.html          ← full drawing board UI
└── backend/
    ├── server.js            ← Express + WebSocket server
    ├── package.json
    └── snapshots/           ← auto-created when server runs
```

---

## How to Run

**Requires:** [Node.js](https://nodejs.org)

```bash
cd backend
npm install
npm start
```

Then open **http://localhost:4000** in your browser.

**Windows:** just double-click `START.bat`

---

## Frontend Features

- Dark themed full-screen drawing canvas
- Pen and eraser tools
- 8 colors + custom color picker
- Brush size slider
- Undo / Redo — `Ctrl+Z` / `Ctrl+Y`
- Export canvas as PNG
- Clear canvas for all users
- Live cursors — see teammates drawing in real time
- Participant avatars in top bar
- Auto-reconnect if connection drops
- Keyboard shortcuts — `P` pen, `E` eraser

---

## Backend Services

### 1. Room Manager
Creates and manages drawing rooms. Users join a named room and all strokes are scoped to that room. Supports optional password protection.

### 2. Snapshot Service
Saves the full stroke log to disk as JSON every 30 seconds so drawings survive server restarts.

### 3. Replay Engine
When a new user joins a room, sends them the complete drawing history so they instantly see the current canvas state.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/rooms/join` | Join or create a room |
| POST | `/rooms/leave` | Leave a room |
| GET | `/rooms` | List active rooms |
| POST | `/strokes/commit` | Save a committed stroke |
| GET | `/replay/:roomId` | Get all strokes for a room |
| GET | `/snapshots/:roomId` | Get latest snapshot |
| GET | `/api/health` | Server health check |

---

## Tech Used

- HTML, CSS, JavaScript (frontend)
- Node.js + Express (backend)
- WebSocket (`ws` library) for real-time sync
- File system for snapshot persistence
