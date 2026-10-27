// Socket.IO wrapper. Actions carry a request id so retries after a network hiccup are
// idempotent on the server (no double purchases / pickups).
/* global io */

function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (window.AJAN_SERVER_URL) return window.AJAN_SERVER_URL;
  return undefined; // same origin
}

export class Net {
  constructor() {
    this.socket = null;
    this.handlers = {};
    this.reqN = 0;
    this.key = null;
    this.connected = false;
  }

  on(ev, fn) { this.handlers[ev] = fn; }
  emitLocal(ev, data) { this.handlers[ev] && this.handlers[ev](data); }

  connect() {
    if (this.socket) return Promise.resolve();
    if (typeof io !== 'function') return Promise.reject(new Error('Socket.IO client failed to load. Is the game server running?'));
    return new Promise((resolve, reject) => {
      const url = serverUrl();
      this.socket = url ? io(url, { transports: ['websocket', 'polling'] }) : io({ transports: ['websocket', 'polling'] });
      let first = true;
      const timer = setTimeout(() => { if (first) { first = false; reject(new Error('Could not reach the game server.')); } }, 8000);
      this.socket.on('connect', () => {
        this.connected = true;
        if (first) { first = false; clearTimeout(timer); resolve(); }
        else this.emitLocal('reconnected');
      });
      this.socket.on('disconnect', () => { this.connected = false; this.emitLocal('disconnected'); });
      this.socket.on('connect_error', () => { this.emitLocal('connect_error'); });
      this.socket.on('s', (m) => this.emitLocal('snapshot', m));
    });
  }

  request(ev, msg, timeout = 6000) {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) return resolve({ ok: false, err: 'Not connected to the server.' });
      this.socket.timeout(timeout).emit(ev, msg, (err, res) => resolve(err ? { ok: false, err: 'The server did not answer.' } : res));
    });
  }

  // gameplay action with retries (same reqId => server returns the cached result)
  async act(type, data = {}) {
    const reqId = Date.now().toString(36) + '-' + (++this.reqN);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.request('act', { ...data, type, reqId }, 2500);
      if (res && (res.ok || res.err !== 'The server did not answer.')) return res;
    }
    return { ok: false, err: 'Network problem - try again.' };
  }

  move(m) { if (this.socket && this.socket.connected) this.socket.volatile.emit('mv', m); }

  leave() { if (this.socket && this.socket.connected) this.socket.emit('leave'); this.key = null; }
}

export const net = new Net();
