import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { solveExercise } from '../server/exercises.js';
import { cellCenter, worldToCell, SPAWNS } from '../shared/map.js';
import { CALORIE_GOAL, PHASE, RESTAURANTS, STORY } from '../shared/constants.js';

const mk = (seed = 7) => {
  const room = new Room('T' + seed, { solo: false, seed });
  room.frozenNpcs = true;
  const p = room.addPlayer('p1', 'One');
  return { room, p };
};
const place = (room, p, x, z) => { p.x = x; p.z = z; };
const run = (room, seconds) => { for (let i = 0; i < seconds * 20; i++) room.tick(0.05); };

// stand in front of a station, run its exercise the way a client would and submit
function doExercise(room, p, id, answerOverride) {
  const st = room.map.stations[id];
  const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[st.face];
  place(room, p, st.x + d[0] * 2.5, st.z + d[1] * 2.5);
  const open = room.handleAction(p, { type: 'exOpen', station: id });
  if (!open.ok) return open;
  const pend = p.pendingEx.get(id);
  const sol = solveExercise(pend.type, pend.spec, pend.solution);
  if (sol.steps) sol.steps.forEach((s, i) => { place(room, p, s.x, s.z); room.t += 1.5; assert.ok(room.handleAction(p, { type: 'exStep', station: id, i }).ok); });
  place(room, p, st.x + d[0] * 2.5, st.z + d[1] * 2.5);
  room.t += 5;
  return room.handleAction(p, { type: 'exSubmit', station: id, answer: answerOverride || sol.answer });
}
const giveCoin = (room, p) => { room.frozenNpcs = false; place(room, p, room.ajan.x, room.ajan.z + 2); room.tick(0.05); room.frozenNpcs = true; };

test('story: exercise 1 -> AJAN gives a coin -> impossible exercise 2 -> chase, then the rest', () => {
  const { room, p } = mk();
  assert.equal(p.phase, PHASE.INTRO);
  assert.equal(room.story, STORY.WELCOME);
  assert.equal(doExercise(room, p, 1).ok, false, 'exercise 2 is locked before exercise 1');
  assert.equal(doExercise(room, p, 3).ok, false, 'other rooms are locked before the chase');
  assert.equal(doExercise(room, p, 0).success, true);
  assert.equal(room.story, STORY.COIN);
  assert.equal(room.ajan.mood, 'coin');
  assert.ok(room.outbox.some((o) => o.ev.k === 'coin'), 'AJANCOIN plays');
  assert.equal(doExercise(room, p, 1).ok, false, 'must fetch the coin first');
  giveCoin(room, p);
  assert.ok(p.gotAjanCoin);
  assert.ok(p.inventory.includes('coin'));
  const r = doExercise(room, p, 1);
  assert.equal(r.impossible, true);
  assert.equal(p.exercisesDone.size, 2, 'the trick exercise still counts');
  assert.equal(room.story, STORY.CHASE);
  assert.equal(room.ajan.mood, 'angry');
  const cafe = room.map.roomById.cafeteria;
  const c = worldToCell(room.ajan.x, room.ajan.z);
  assert.equal(room.map.room(c.cx, c.cz), cafe, 'AJAN teleports to the cafeteria');
  assert.ok(room.outbox.some((o) => o.ev.k === 'mad'), 'AJANMAD plays');
  assert.ok(room.outbox.some((o) => o.ev.e === 'chase'));
  for (let i = 2; i < 7; i++) assert.equal(doExercise(room, p, i).success, true, 'exercise ' + (i + 1));
  assert.equal(p.exercisesDone.size, 7);
  assert.equal(p.phase, PHASE.COLLECT_CASH);
  assert.equal(room.handleAction(p, { type: 'exOpen', station: 4 }).ok, false, 'cannot repeat');
});

test('a failed exercise during the chase alerts AJAN and can be retried', () => {
  const { room, p } = mk();
  room.startChase(p);
  const st = room.map.stations[2];
  const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[st.face];
  place(room, p, st.x + d[0] * 2.5, st.z + d[1] * 2.5);
  assert.ok(room.handleAction(p, { type: 'exOpen', station: 2 }).ok);
  room.ajan.heard = null;
  room.t += 3;
  const r = room.handleAction(p, { type: 'exSubmit', station: 2, answer: { done: true, hits: [], count: 0 } });
  assert.equal(r.success, false, 'skipping all the steps fails');
  assert.ok(room.ajan.heard, 'AJAN heard it');
  assert.ok(doExercise(room, p, 2).success);
});

test('other characters ignore players until the chase starts', () => {
  const { room, p } = mk();
  p.phase = PHASE.TRAINING;
  assert.equal(room.canInteract(p), false);
  const b = room.npcById.bully;
  b.placeAt({ x: 70, z: 19 });
  p.inventory = ['soda', null, null];
  place(room, p, b.x + 1.5, b.z);
  b.update(0.05);
  assert.equal(p.inventory[0], 'soda', 'the bully does nothing before the chase');
  room.startChase(p);
  assert.equal(room.canInteract(p), true);
  b.update(0.05);
  assert.equal(p.inventory[0], null);
});

test('cash: $1-$4 values, gated by phase, duplicate claims rejected', () => {
  const { room, p } = mk();
  const cash = [...room.pickups.values()].filter((k) => k.kind === 'cash');
  assert.ok(cash.length >= 18);
  for (const c of cash) assert.ok([100, 200, 300, 400].includes(c.value));
  const c = cash[0];
  place(room, p, c.x, c.z);
  assert.equal(room.handleAction(p, { type: 'pickup', id: c.id }).ok, false, 'not before training');
  p.phase = PHASE.COLLECT_CASH;
  const p2 = room.addPlayer('p2', 'Two'); p2.phase = PHASE.COLLECT_CASH; place(room, p2, c.x, c.z);
  const a = room.handleAction(p, { type: 'pickup', id: c.id, reqId: 'a1' });
  const b = room.handleAction(p2, { type: 'pickup', id: c.id, reqId: 'b1' });
  const a2 = room.handleAction(p, { type: 'pickup', id: c.id, reqId: 'a2' });
  assert.equal(a.ok, true); assert.equal(b.ok, false); assert.equal(a2.ok, false);
  assert.equal(p.cash, c.value);
  assert.equal(p2.cash, c.value, 'cash is shared');
  // retry of the same request id returns the same result without paying twice
  assert.equal(room.handleAction(p, { type: 'pickup', id: c.id, reqId: 'a1' }).ok, true);
  assert.equal(p.cash, c.value);
});

test('enough cash exists for every player to reach the calorie goal', () => {
  const room = new Room('C', { seed: 3 });
  for (let i = 0; i < 4; i++) room.addPlayer('p' + i, 'P' + i);
  const total = room.cashOnMap();
  assert.ok(total >= 4 * 2500, 'total cash ' + total);
});

test('restaurant purchases: gating, distance, funds, idempotency, calories and final phase', () => {
  const { room, p } = mk();
  const kfc = room.map.counters.find((c) => c.restaurant === 'kfc');
  place(room, p, kfc.x, kfc.z);
  assert.equal(room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_bucket' }).ok, false, 'not before training');
  p.phase = PHASE.COLLECT_CASH;
  p.cash = 500;
  const poor = room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_bucket' });
  assert.equal(poor.ok, false); assert.equal(p.cash, 500);
  assert.equal(room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'pop_bigbox' }).ok, false, 'wrong restaurant');
  p.cash = 3000;
  const r1 = room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_bucket', reqId: 'x' });
  const r1b = room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_bucket', reqId: 'x' });
  assert.ok(r1.ok && r1b.ok);
  assert.equal(p.cash, 3000 - 899, 'retry did not charge twice');
  assert.equal(p.calories, 2900);
  assert.equal(p.phase, PHASE.FAST_FOOD);
  room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_bucket' });
  assert.equal(room.furious, false);
  room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_bowl' });
  room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_bowl' });
  assert.ok(p.calories >= CALORIE_GOAL);
  assert.equal(p.phase, PHASE.FINAL_ESCAPE);
  assert.equal(room.furious, true);
  assert.equal(room.ajan.mood, 'angry');
  assert.ok(room.outbox.some((o) => o.ev.e === 'sfx' && o.ev.k === 'mad'));
  // too far away
  place(room, p, 100, 100);
  p.phase = PHASE.FAST_FOOD;
  assert.equal(room.handleAction(p, { type: 'buy', restaurant: 'kfc', item: 'kfc_biscuit' }).ok, false);
});

test('a full order of about $20 reaches 7,000 calories', () => {
  // unbounded knapsack: cheapest way to reach at least the goal
  const items = Object.values(RESTAURANTS).flatMap((r) => r.menu);
  const step = 10, n = CALORIE_GOAL / step;
  const best = new Array(n + 1).fill(Infinity); best[0] = 0;
  for (let c = 1; c <= n; c++) for (const it of items) best[c] = Math.min(best[c], best[Math.max(0, c - it.cal / step | 0)] + it.price);
  assert.ok(best[n] <= 2200, 'cheapest 7,000-calorie order costs ' + best[n]);
  assert.ok(best[n] >= 1800, 'not trivially cheap: ' + best[n]);
});

test('victory only at an exit and only after 7,000 calories', () => {
  const { room, p } = mk();
  const e = room.map.exits[0];
  const c = { x: e.wx - e.nx * 1.0, z: e.wz - e.nz * 1.0 };
  place(room, p, c.x, c.z);
  p.phase = PHASE.FAST_FOOD;
  run(room, 0.5);
  assert.equal(p.phase, PHASE.FAST_FOOD);
  p.calories = CALORIE_GOAL;
  room.startFinal(p);
  place(room, p, 50, 150);
  run(room, 0.3);
  assert.equal(p.phase, PHASE.FINAL_ESCAPE, 'not near an exit');
  place(room, p, c.x, c.z);
  run(room, 0.3);
  assert.equal(p.phase, PHASE.VICTORY);
});

test('movement validation rejects teleports and walking through walls', () => {
  const { room, p } = mk();
  const x0 = p.x, z0 = p.z;
  room.t += 0.1;
  room.handleMove(p, { x: x0 + 40, z: z0, yaw: 0 });
  assert.equal(p.x, x0, 'teleport rejected');
  // west of the spawn hallway is a wall
  room.t += 0.6;
  room.handleMove(p, { x: x0 - 5, z: z0, yaw: 0 });
  assert.equal(p.x, x0, 'wall rejected');
  room.t += 0.1;
  room.handleMove(p, { x: x0, z: z0 - 1, yaw: 0 });
  assert.equal(p.z, z0 - 1, 'normal step accepted');
});

test('detention: principal2, office teleport, locked door, countdown, keys', () => {
  const { room, p } = mk();
  p.phase = PHASE.TRAINING;
  room.startDetention(p, room.npcById.principal);
  assert.ok(p.detention);
  assert.ok(room.outbox.some((o) => o.ev.k === 'principal2'));
  const office = room.map.roomById.office;
  const c = worldToCell(p.x, p.z);
  assert.equal(room.map.room(c.cx, c.cz), office);
  assert.equal(room.playerSolid(p)(room.map.doors[room.officeDoor].edge), true, 'door locked for the detainee');
  assert.equal(room.handleAction(p, { type: 'door', door: room.officeDoor }).ok, false);
  run(room, 10);
  assert.ok(p.detention, 'still detained after 10s');
  run(room, 11);
  assert.equal(p.detention, null, 'released after 20s');
  // a second detention is still 20 s; keys get you out
  room.startDetention(p, room.npcById.principal);
  assert.equal(p.detention.dur, 20, 'detention is always 20 seconds');
  p.inventory[0] = 'keys';
  const od = room.map.doors[room.officeDoor];
  place(room, p, od.x, od.z - 1.5); // inside the office, next to its door
  assert.equal(room.handleAction(p, { type: 'use', slot: 0 }).ok, true);
  assert.equal(p.detention, null);
  assert.equal(p.inventory[0], null);
});

test('principal catches a running player he can see', () => {
  const { room, p } = mk();
  room.startChase(p);
  room.frozenNpcs = false;
  p.phase = PHASE.TRAINING;
  const pr = room.npcById.principal;
  const a = cellCenter(70, 19);
  pr.x = a.x; pr.z = a.z; pr.state = 'wander';
  place(room, p, a.x + 12, a.z);
  p.sprinting = true; p.speed = 11;
  for (let i = 0; i < 100 && !p.detention; i++) { p.sprinting = true; p.speed = 11; room.tick(0.05); }
  assert.ok(p.detention, 'detained');
  assert.ok(room.outbox.some((o) => o.ev.k === 'principal1'));
});

test('playtime jump rope: start, early completion rejected, scissors cut it', () => {
  const { room, p } = mk();
  room.startChase(p);
  p.phase = PHASE.TRAINING;
  const pt = room.npcById.playtime;
  room.startJumpRope(p, pt); pt.state = 'jumping'; pt.target = p.id;
  assert.equal(room.handleAction(p, { type: 'jumpDone' }).ok, false, 'too fast');
  p.inventory[1] = 'scissors';
  assert.equal(room.handleAction(p, { type: 'use', slot: 1 }).ok, true);
  assert.equal(p.jump, null);
  assert.equal(pt.state, 'sad');
  assert.ok(room.outbox.some((o) => o.ev.e === 'hush' && o.ev.src === 'playtime'), 'playtime stops talking');
  // proper completion
  room.startJumpRope(p, pt); pt.state = 'jumping';
  room.t += 6;
  assert.equal(room.handleAction(p, { type: 'jumpDone' }).ok, true);
  assert.equal(p.jump, null);
});

test('bully takes exactly one item, or lets an empty-handed player go eventually', () => {
  const { room, p } = mk();
  room.startChase(p);
  p.phase = PHASE.TRAINING;
  const b = room.npcById.bully;
  b.placeAt({ x: 70, z: 19 });
  p.inventory = ['soda', 'coin', null];
  place(room, p, b.x + 1.5, b.z);
  b.update(0.05);
  assert.equal(p.inventory.filter(Boolean).length, 1);
  assert.equal(b.state, 'gone');
  // empty inventory
  b.placeAt({ x: 70, z: 19 });
  p.inventory = [null, null, null];
  place(room, p, b.x + 1.5, b.z);
  b.update(0.05);
  assert.ok(room.outbox.some((o) => o.ev.k === 'bullypass'));
  assert.equal(b.state, 'block');
  room.t += 9; b.update(0.05);
  assert.equal(b.state, 'gone', 'he leaves - nobody is trapped forever');
});

test('NPCs never leave the walkable school (5 simulated minutes)', () => {
  const { room, p } = mk(11);
  room.frozenNpcs = false;
  p.phase = PHASE.TRAINING;
  room.startChase(p);
  room.npcById.sweep.nextSweep = 1;
  for (let i = 0; i < 20 * 300; i++) {
    room.tick(0.05);
    if (i % 3 === 0) room.flush();
    for (const n of room.npcs) {
      if (n.hidden) continue;
      const c = worldToCell(n.x, n.z);
      assert.equal(room.map.isFloor(c.cx, c.cz), true, `${n.kind} outside the school at ${n.x.toFixed(1)},${n.z.toFixed(1)} (${n.state})`);
    }
    if (p.phase === PHASE.CAUGHT) { room.resetPlayer(p); p.phase = PHASE.TRAINING; }
  }
});

test('AJAN hunts and catches a stationary player once angry', () => {
  const { room, p } = mk(5);
  room.startChase(p);
  room.frozenNpcs = false;
  p.phase = PHASE.TRAINING;
  p.exercisesDone = new Set([0, 1, 2, 3]);
  const sp = cellCenter(20, 50); // out in the main hall
  place(room, p, sp.x, sp.z);
  let stomps = 0;
  for (let i = 0; i < 20 * 120 && p.phase !== PHASE.CAUGHT; i++) {
    if (i % 200 === 0) room.noise(p.x, p.z, 60 + 6 * 4, 1); // a door opened nearby every 10 s
    room.tick(0.05);
    stomps += room.outbox.filter((o) => o.ev.e === 'stomp').length;
    room.outbox = [];
  }
  assert.equal(p.phase, PHASE.CAUGHT);
  assert.ok(stomps > 3, 'stomped ' + stomps);
});

test('happy AJAN never catches anyone', () => {
  const { room, p } = mk();
  room.frozenNpcs = false;
  p.phase = PHASE.TRAINING;
  place(room, p, room.ajan.x, room.ajan.z + 1);
  run(room, 3);
  assert.equal(p.phase, PHASE.TRAINING);
});

test('soda pushes AJAN away, scissors disable 1st Prize', () => {
  const { room, p } = mk();
  room.startChase(p);
  p.phase = PHASE.TRAINING;
  const a = cellCenter(48, 30);
  room.ajan.x = a.x; room.ajan.z = a.z - 5; room.ajan.push = null;
  place(room, p, a.x, a.z);
  p.inventory[0] = 'soda';
  room.handleAction(p, { type: 'use', slot: 0, yaw: 0 }); // facing -z (north) toward AJAN
  for (let i = 0; i < 20; i++) room.tick(0.05);
  assert.ok(room.ajan.push || room.ajan.z < a.z - 6, 'AJAN pushed');
  for (const id of ['bully', 'sweep', 'arts']) {
    const n = room.npcById[id]; n.hidden = false; n.state = 'peek'; n.push = null;
    n.x = a.x; n.z = a.z - 4;
    p.inventory[0] = 'soda';
    room.handleAction(p, { type: 'use', slot: 0, yaw: 0 });
    for (let i = 0; i < 10; i++) room.tick(0.05);
    assert.ok(n.push && n.push.until - room.t > 2.5, id + ' pushed far');
  }
  const pr = room.npcById.prize;
  pr.x = a.x + 3; pr.z = a.z;
  p.inventory[1] = 'scissors';
  assert.equal(room.handleAction(p, { type: 'use', slot: 1 }).ok, true);
  assert.equal(pr.state, 'disabled');
  p.inventory[2] = 'scissors';
  pr.x = 10; pr.z = 10;
  assert.equal(room.handleAction(p, { type: 'use', slot: 2 }).ok, false, 'not consumed when useless');
  assert.equal(p.inventory[2], 'scissors');
});

test('gotta sweep pushes players without putting them in walls', () => {
  const { room, p } = mk();
  room.startChase(p);
  p.phase = PHASE.TRAINING;
  const sw = room.npcById.sweep;
  const a = cellCenter(60, 50);
  sw.x = a.x; sw.z = a.z; sw.state = 'sweeping'; sw.sweepUntil = room.t + 10;
  sw.setGoal(cellCenter(85, 50).x, a.z, true);
  place(room, p, a.x + 2, a.z);
  let pushed = false;
  for (let i = 0; i < 10; i++) { sw.update(0.05); room.t += 0.05; if (room.outbox.some((o) => o.ev.e === 'push' && o.to === p.id)) pushed = true; }
  assert.ok(pushed);
});

test('arts and crafters only charges players who finished all 7 exercises', () => {
  const { room, p } = mk();
  room.frozenNpcs = false;
  p.phase = PHASE.TRAINING;
  room.startChase(p);
  const arts = room.npcById.arts;
  arts.nextPeek = 0;
  run(room, 1);
  assert.notEqual(arts.state, 'lurk');
  p.exercisesDone = new Set([0, 1, 2, 3, 4, 5, 6]);
  p.phase = PHASE.COLLECT_CASH;
  arts.state = 'hidden'; arts.cooldownUntil = 0; arts.nextPeek = 0;
  for (let i = 0; i < 40 && arts.state !== 'lurk'; i++) room.tick(0.05);
  assert.equal(arts.state, 'lurk');
  // stare at him
  p.yaw = Math.atan2(-(arts.x - p.x), -(arts.z - p.z));
  const sees = arts.canSee(p, 45);
  if (sees) {
    for (let i = 0; i < 40 && arts.state === 'lurk'; i++) { p.yaw = Math.atan2(-(arts.x - p.x), -(arts.z - p.z)); room.tick(0.05); }
    assert.equal(arts.state, 'charge');
  }
});

test('one player caught does not end the match for the others', () => {
  const { room, p } = mk();
  room.startChase(p);
  const p2 = room.addPlayer('p2', 'Two');
  p.phase = PHASE.TRAINING; p2.phase = PHASE.TRAINING;
  room.catchPlayer(p);
  assert.equal(p.phase, PHASE.CAUGHT);
  assert.equal(p2.phase, PHASE.TRAINING);
  assert.equal(room.handleAction(p, { type: 'restart' }).ok, true);
  assert.equal(p.phase, PHASE.INTRO);
  assert.equal(p.exercisesDone.size, 0);
});

test('gotta sweep: loud sweepout when he leaves, sweep.wav when he comes for you, sometimes drags you to his closet', () => {
  const { room, p } = mk(3);
  room.startChase(p);
  room.frozenNpcs = false;
  const sw = room.npcById.sweep;
  sw.nextSweep = room.t; // leave the closet now
  for (const n of room.npcs) if (n !== sw) n.update = () => {};
  room.tick(0.05);
  assert.ok(room.outbox.some((o) => o.ev.k === 'sweepout' && o.ev.to === '*'), 'everyone hears him leave');
  // stand in his path in the north hall
  const c = cellCenter(60, 19);
  sw.x = c.x - 10; sw.z = c.z; sw.path = null; sw.goal = null;
  place(room, p, c.x, c.z);
  const rng = room.rng; room.rng = Object.assign(() => 0.01, rng); // force the grab
  let carried = false, heard = false;
  for (let i = 0; i < 20 * 20; i++) {
    room.tick(0.05);
    if (room.outbox.some((o) => o.ev.k === 'sweep' && o.ev.to === p.id)) heard = true;
    if (sw.state === 'carry') carried = true;
    // the client follows the pushes it is sent
    for (const o of room.outbox) if (o.ev.e === 'push' && o.to === p.id) { p.x += o.ev.vx * 0.05; p.z += o.ev.vz * 0.05; }
    for (const o of room.outbox) if (o.ev.e === 'teleport' && o.to === p.id) { p.x = o.ev.x; p.z = o.ev.z; }
    room.outbox = [];
    if (carried && sw.state === 'closet') break;
  }
  room.rng = rng;
  assert.ok(heard, 'sweep.wav when he comes for you');
  assert.ok(carried, 'he grabbed the player');
  const cell = worldToCell(p.x, p.z);
  assert.equal(room.map.room(cell.cx, cell.cz).id, 'janitor', 'dumped in the janitor closet');
});

test("the principal's whistle and the sock's song play for everyone every now and then", () => {
  const { room, p } = mk(4);
  room.frozenNpcs = false;
  p.phase = PHASE.TRAINING;
  const keys = new Set();
  for (let i = 0; i < 20 * 150; i++) { room.tick(0.05); for (const o of room.outbox) if (o.ev.e === 'sfx' && o.ev.to === '*') keys.add(o.ev.k); room.outbox = []; }
  assert.ok(keys.has('whistle'));
  assert.ok(keys.has('childmusic'));
});

test('catboy: 50/50 good item or betrayal; betrayals ambush you from around the corner', () => {
  const outcomes = new Set();
  for (let seed = 1; seed <= 40 && outcomes.size < 3; seed++) {
    const { room, p } = mk(seed);
    room.startChase(p);
    const cb = room.npcById.catboy;
    place(room, p, cb.x + 2, cb.z);
    const before = room.pickups.size;
    const r = room.handleAction(p, { type: 'catboy' });
    assert.ok(r.ok, JSON.stringify(r));
    outcomes.add(r.outcome);
    assert.equal(room.handleAction(p, { type: 'catboy' }).ok, false, 'cooldown');
    if (r.outcome === 'good') {
      assert.equal(room.pickups.size, before + 1);
      assert.ok(room.outbox.some((o) => o.ev.k === 'catboygood'));
    } else {
      const npc = r.outcome === 'ajan' ? room.ajan : room.npcById.principal;
      assert.ok(room.outbox.some((o) => o.ev.k === (r.outcome === 'ajan' ? 'catboyajan' : 'catboyprincipal')));
      run(room, 6);
      const d = Math.hypot(npc.x - p.x, npc.z - p.z);
      assert.ok(d >= 10 && d <= 52, r.outcome + ' appears nearby but not on top of you: ' + d.toFixed(1));
      const pc = worldToCell(p.x, p.z), nc = worldToCell(npc.x, npc.z);
      assert.notEqual(room.map.room(nc.cx, nc.cz), room.map.room(pc.cx, pc.cz), 'not in the same hallway');
      if (r.outcome === 'principal') assert.equal(npc.state, 'fetch');
    }
  }
  assert.ok(outcomes.has('good') && outcomes.has('ajan') && outcomes.has('principal'), [...outcomes].join());
});

test('exercise progress is shared by all players, including late joiners', () => {
  const { room, p } = mk(9);
  const p2 = room.addPlayer('p2', 'Two');
  p.phase = p2.phase = PHASE.TRAINING;
  doExercise(room, p, 0);
  assert.ok(p2.exercisesDone.has(0), 'the other player sees it done');
  const late = room.addPlayer('p3', 'Late');
  assert.ok(late.exercisesDone.has(0), 'a late joiner gets the shared progress');
  for (let i = 0; i < 7; i++) room.sharedEx.add(i);
  run(room, 4);
  for (const q of [p, p2, late]) assert.equal(q.phase, PHASE.COLLECT_CASH);
});

test('cash and calories are shared by every player, and the goal moves everyone on', () => {
  const { room, p } = mk();
  const q = room.addPlayer('p2', 'Two');
  p.cash = 500;
  assert.equal(q.cash, 500);
  room.resetPlayer(q, true);
  assert.equal(p.cash, 500, 'respawn keeps the team cash');
  p.phase = q.phase = PHASE.COLLECT_CASH;
  p.calories = CALORIE_GOAL;
  room.tick(0.05);
  assert.equal(q.phase, PHASE.FINAL_ESCAPE);
});
