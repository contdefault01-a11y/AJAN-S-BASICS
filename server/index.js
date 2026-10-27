// HTTP + Socket.IO server. Serves the client, the shared modules, the assets and three.js,
// and hosts authoritative game rooms (solo games are private one-player rooms).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Room, getMap } from './room.js';
import { TICK_HZ, SNAPSHOT_HZ } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 8;
const RECONNECT_GRACE_MS = 60_000;

export function createServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*' },
    pingInterval: 10000,
    pingTimeout: 20000,
  });

  const rooms = new Map();
  const sessions = new Map(); // reconnect key -> { code, playerId }

  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
  app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1h', fallthrough: true }));
  app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: 0 }));
  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '1d' }));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));

  getMap(); // build once at boot

  const newCode = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let c;
    do c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); while (rooms.has(c));
    return c;
  };
  const cleanName = (n) => String(n || '').replace(/[^\w \-'.!]/g, '').trim().slice(0, 16) || 'Trainee';

  function joinRoom(socket, room, name, key) {
    let p;
    const sess = key && sessions.get(key);
    if (sess && sess.code === room.code && room.players.has(sess.playerId)) {
      p = room.players.get(sess.playerId);
      p.connected = true;
      p.dirty = true;
    } else {
      const id = crypto.randomUUID().slice(0, 8);
      p = room.addPlayer(id, cleanName(name));
      key = crypto.randomUUID();
      sessions.set(key, { code: room.code, playerId: id });
    }
    socket.data.room = room.code;
    socket.data.pid = p.id;
    socket.join(room.code);
    p.socketId = socket.id;
    return { ok: true, key, init: room.initPayload(p) };
  }

  io.on('connection', (socket) => {
    socket.on('create', (msg, ack) => {
      if (typeof ack !== 'function') return;
      leave(socket);
      const solo = !!(msg && msg.solo);
      const room = new Room(newCode(), { solo, name: cleanName(msg && msg.name) });
      rooms.set(room.code, room);
      ack(joinRoom(socket, room, msg && msg.name));
    });

    socket.on('join', (msg, ack) => {
      if (typeof ack !== 'function') return;
      const code = String((msg && msg.code) || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return ack({ ok: false, err: 'No game with code ' + (code || '????') + '.' });
      if (room.solo) return ack({ ok: false, err: 'That is a private solo game.' });
      const resuming = msg.key && sessions.get(msg.key)?.code === code;
      if (!resuming && room.players.size >= MAX_PLAYERS) return ack({ ok: false, err: 'That game is full.' });
      leave(socket);
      ack(joinRoom(socket, room, msg.name, msg.key));
    });

    socket.on('resume', (msg, ack) => {
      if (typeof ack !== 'function') return;
      const sess = msg && sessions.get(msg.key);
      const room = sess && rooms.get(sess.code);
      if (!room || !room.players.has(sess.playerId)) return ack({ ok: false, err: 'Session expired.' });
      ack(joinRoom(socket, room, '', msg.key));
    });

    socket.on('list', (_msg, ack) => {
      if (typeof ack !== 'function') return;
      ack([...rooms.values()].filter((r) => !r.solo && r.players.size < MAX_PLAYERS).map((r) => ({ code: r.code, host: r.name, players: r.players.size })));
    });

    socket.on('mv', (m) => {
      const room = rooms.get(socket.data.room);
      if (room) room.handleMove(room.players.get(socket.data.pid), m);
    });

    socket.on('act', (msg, ack) => {
      const room = rooms.get(socket.data.room);
      const res = room ? room.handleAction(room.players.get(socket.data.pid), msg) : { ok: false, err: 'Not in a game.' };
      if (typeof ack === 'function') ack(res);
    });

    socket.on('leave', () => leave(socket, true));
    socket.on('disconnect', () => leave(socket, false));
  });

  function leave(socket, explicit) {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const p = room.players.get(socket.data.pid);
    socket.leave(room.code);
    socket.data.room = null;
    if (p && p.socketId === socket.id) {
      if (explicit || room.solo) room.removePlayer(p.id);
      else { p.connected = false; p.disconnectedAt = Date.now(); }
    }
    if (room.players.size === 0) rooms.delete(room.code);
  }

  // simulation + network loops
  let lastSnap = 0;
  const tickMs = 1000 / TICK_HZ;
  const loop = setInterval(() => {
    const now = Date.now();
    const doSnap = now - lastSnap >= 1000 / SNAPSHOT_HZ - 2;
    if (doSnap) lastSnap = now;
    for (const room of rooms.values()) {
      for (const p of [...room.players.values()])
        if (!p.connected && now - p.disconnectedAt > RECONNECT_GRACE_MS) room.removePlayer(p.id);
      if (room.players.size === 0) { rooms.delete(room.code); continue; }
      try { room.tick(1 / TICK_HZ); } catch (err) { console.error('tick error in room', room.code, err); }
      if (doSnap) {
        const out = room.flush();
        for (const p of room.players.values()) if (p.connected && out.has(p.id)) io.to(p.socketId).emit('s', out.get(p.id));
      }
    }
  }, tickMs);

  return {
    app, server, io, rooms,
    listen: (port = PORT, host = HOST) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => { clearInterval(loop); io.close(); server.close(() => resolve()); }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = createServer();
  s.listen().then((addr) => console.log(`AJAN'S BASICS server listening on http://${HOST}:${addr.port}`));
  const stop = () => s.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
