// Spins up the real HTTP + Socket.IO server and connects two independent clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createServer } from '../server/index.js';
import { PHASE } from '../shared/constants.js';

let srv, url;
before(async () => {
  process.env.AJAN_DEBUG = '1';
  srv = createServer();
  const addr = await srv.listen(0, '127.0.0.1');
  url = 'http://127.0.0.1:' + addr.port;
});
after(async () => { await srv.close(); });

const connect = () => new Promise((resolve, reject) => {
  const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});
const req = (s, ev, msg) => new Promise((resolve) => s.emit(ev, msg, resolve));
const nextSnap = (s, pred = () => true, timeout = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { s.off('s', h); reject(new Error('snapshot timeout')); }, timeout);
  const h = (m) => { if (pred(m)) { clearTimeout(t); s.off('s', h); resolve(m); } };
  s.on('s', h);
});

test('health endpoint and static client are served', async () => {
  const h = await (await fetch(url + '/healthz')).json();
  assert.equal(h.ok, true);
  const html = await (await fetch(url + '/')).text();
  assert.match(html, /AJAN'S BASICS/);
  assert.equal((await fetch(url + '/assets/AJAN.png')).status, 200);
  assert.equal((await fetch(url + '/vendor/three/build/three.module.js')).status, 200);
  assert.equal((await fetch(url + '/shared/map.js')).status, 200);
  assert.equal((await fetch(url + '/socket.io/socket.io.min.js')).status, 200);
});

test('two clients share one authoritative match', async () => {
  const a = await connect();
  const b = await connect();
  try {
    const host = await req(a, 'create', { solo: false, name: 'Alice' });
    assert.ok(host.ok);
    const code = host.init.code;
    const list = await req(b, 'list', {});
    assert.ok(list.some((g) => g.code === code), 'game is listed');
    const join = await req(b, 'join', { code, name: 'Bob' });
    assert.ok(join.ok, JSON.stringify(join));
    const ida = host.init.id, idb = join.init.id;
    assert.notEqual(ida, idb);
    assert.deepEqual(join.init.stations, host.init.stations, 'same exercise layout');

    // both see each other
    const sa = await nextSnap(a, (m) => m.p.length === 2);
    const sb = await nextSnap(b, (m) => m.p.length === 2);
    assert.ok(sa.p.find((p) => p.id === idb && p.n === 'Bob'));
    assert.ok(sb.p.find((p) => p.id === ida && p.n === 'Alice'));

    // movement replicates
    const meB = sb.p.find((p) => p.id === idb);
    for (let i = 0; i < 5; i++) { b.emit('mv', { x: meB.x, z: meB.z - 0.5 * (i + 1), yaw: 1, sprint: false, ts: 0 }); await new Promise((r) => setTimeout(r, 80)); }
    const moved = await nextSnap(a, (m) => { const p = m.p.find((q) => q.id === idb); return p && p.z < meB.z - 1.5; });
    assert.ok(moved);

    // NPC state is identical for both clients at the same server time
    const [na, nb] = await Promise.all([nextSnap(a), nextSnap(b)]);
    if (na.t === nb.t) assert.deepEqual(na.n, nb.n);
    else assert.equal(na.n.length, nb.n.length);

    // concurrent cash claims: exactly one winner
    await req(a, 'act', { type: 'debug', exercises: 7 });
    await req(b, 'act', { type: 'debug', exercises: 7 });
    const cash = host.init.pickups.find((p) => p.kind === 'cash');
    await req(a, 'act', { type: 'debug', tp: [cash.x, cash.z, 0] });
    await req(b, 'act', { type: 'debug', tp: [cash.x, cash.z, 0] });
    const [ra, rb] = await Promise.all([
      req(a, 'act', { type: 'pickup', id: cash.id, reqId: 'ca' }),
      req(b, 'act', { type: 'pickup', id: cash.id, reqId: 'cb' }),
    ]);
    assert.equal([ra.ok, rb.ok].filter(Boolean).length, 1, 'only one client got the cash');
    const selfA = (await nextSnap(a, (m) => m.self)).self;
    const selfB = (await nextSnap(b, (m) => m.self)).self;
    assert.equal(selfA.cash + selfB.cash, cash.value);
    assert.equal(selfA.phase, PHASE.COLLECT_CASH);

    // invalid requests do not grant anything
    const bad = await req(a, 'act', { type: 'buy', restaurant: 'kfc', item: 'kfc_bucket' });
    assert.equal(bad.ok, false, 'too far from the counter');
    const bogus = await req(a, 'act', { type: 'exSubmit', station: 3, answer: { line: 0 } });
    assert.equal(bogus.ok, false);

    // a disconnect does not end the match for the other player; reconnect resumes
    a.disconnect();
    const still = await nextSnap(b);
    assert.ok(still.p.length === 2, 'disconnected player kept for reconnection');
    const a2 = await connect();
    const back = await req(a2, 'resume', { key: host.key });
    assert.ok(back.ok);
    assert.equal(back.init.id, ida);
    assert.equal(back.init.self.cash, selfA.cash, 'state survived the reconnect');
    a2.disconnect();
  } finally {
    a.disconnect(); b.disconnect();
  }
});

test('solo games are private and pausable', async () => {
  const a = await connect();
  const b = await connect();
  try {
    const solo = await req(a, 'create', { solo: true, name: 'Solo' });
    assert.ok(solo.ok);
    const j = await req(b, 'join', { code: solo.init.code, name: 'Intruder' });
    assert.equal(j.ok, false);
    const s1 = await nextSnap(a);
    assert.ok((await req(a, 'act', { type: 'pause', paused: true })).ok);
    await new Promise((r) => setTimeout(r, 150));
    const t1 = (await nextSnap(a, () => true, 1500).catch(() => ({ t: s1.t }))).t;
    await new Promise((r) => setTimeout(r, 400));
    await req(a, 'act', { type: 'pause', paused: false });
    const t2 = (await nextSnap(a)).t;
    assert.ok(t2 - t1 < 0.35, 'time froze while paused');
  } finally {
    a.disconnect(); b.disconnect();
  }
});
