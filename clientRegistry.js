/**
 * clientRegistry.js — Monica's Client Registry (flat folder version)
 */

'use strict';

const logger = require('./logger');

const clients      = new Map();
const rooms        = new Map();
const ipConnections = new Map();

function addClient(ws, { userId, userName, roomId, color, ip }) {
  clients.set(ws, {
    userId, userName, roomId, color, ip,
    connectedAt:     Date.now(),
    messageCount:    0,
    lastMessageTime: Date.now(),
  });
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    logger.info(`[ClientRegistry] New room created: "${roomId}"`);
  }
  rooms.get(roomId).add(ws);
  ipConnections.set(ip, (ipConnections.get(ip) || 0) + 1);
  logger.info(`[ClientRegistry] Client joined — user: ${userName}, room: "${roomId}", total: ${rooms.get(roomId).size}`);
}

function removeClient(ws) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(info.roomId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) { rooms.delete(info.roomId); logger.info(`[ClientRegistry] Room removed: "${info.roomId}"`); }
  }
  const count = (ipConnections.get(info.ip) || 1) - 1;
  if (count <= 0) ipConnections.delete(info.ip);
  else ipConnections.set(info.ip, count);
  clients.delete(ws);
  logger.info(`[ClientRegistry] Client left — user: ${info.userName}, room: "${info.roomId}"`);
}

function getClient(ws) { return clients.get(ws) || null; }

function broadcastToRoom(roomId, data, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room || room.size === 0) return;
  const msg = JSON.stringify(data);
  let delivered = 0;
  room.forEach(ws => {
    if (ws === excludeWs) return;
    if (ws.readyState === 1) {
      try { ws.send(msg); delivered++; }
      catch (err) { logger.warn(`[ClientRegistry] Send failed: ${err.message}`); }
    }
  });
  logger.debug(`[ClientRegistry] Broadcast room "${roomId}" — ${delivered}/${room.size}`);
}

function sendToClient(ws, data) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(data)); }
    catch (err) { logger.warn(`[ClientRegistry] Single send failed: ${err.message}`); }
  }
}

function checkRateLimit(ws, limitPerSecond) {
  const info = clients.get(ws);
  if (!info) return false;
  const now = Date.now();
  if (now - info.lastMessageTime > 1000) { info.messageCount = 0; info.lastMessageTime = now; }
  info.messageCount++;
  if (info.messageCount > limitPerSecond) {
    logger.warn(`[ClientRegistry] Rate limit — user: ${info.userName}, count: ${info.messageCount}`);
    return false;
  }
  return true;
}

function getConnectionCountForIp(ip) { return ipConnections.get(ip) || 0; }

function getRoomParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const participants = [];
  room.forEach(ws => {
    const info = clients.get(ws);
    if (info) participants.push({ userId: info.userId, userName: info.userName, color: info.color });
  });
  return participants;
}

function getTotalClients() { return clients.size; }
function getTotalRooms()   { return rooms.size; }

module.exports = {
  addClient, removeClient, getClient,
  broadcastToRoom, sendToClient,
  checkRateLimit, getConnectionCountForIp,
  getRoomParticipants, getTotalClients, getTotalRooms,
};
