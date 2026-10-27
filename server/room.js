// One match. The server owns everything gameplay-critical: NPCs, doors, pickups, exercise
// progress, cash, calories, inventory, detention timers, phase transitions and victory.
// Clients own only their own camera / movement, which the server sanity-checks.
import {
  CELL, PLAYER_R, WALK_SPEED, RUN_SPEED, INVENTORY_SLOTS, EXERCISE_COUNT, CALORIE_GOAL,
  ITEMS, RESTAURANTS, CASH_VALUES, BEST_CAL_PER_CENT, PHASE, STORY, canTransition, TICK_HZ,
} from '../shared/constants.js';
import { buildMap, cellCenter, worldToCell, SPAWNS, E_OPEN, E_DOOR } from '../shared/map.js';
import { makeSolidTest, resolveCircle, segmentBlocked } from '../shared/collision.js';
import { makeRng, randomSeed } from '../shared/rng.js';
import { RANDOM_TYPES, EXERCISE_INFO, generateExercise, validateExercise, validateStep } from './exercises.js';
import { Ajan, Principal, Playtime, Bully, Sweep, Prize, Arts, fwd } from './npcs.js';

let SHARED_MAP = null;
export function getMap() {
  if (!SHARED_MAP) SHARED_MAP = buildMap();
  return SHARED_MAP;
}

const COLORS = ['#3b6cff', '#ff4fa3', '#21c45a', '#ffb800', '#9b5bff', '#00c2c7', '#ff6b2b', '#8a8a8a'];
const ACTIVE_PHASES = new Set([PHASE.INTRO, PHASE.TRAINING, PHASE.COLLECT_CASH, PHASE.FAST_FOOD, PHASE.FINAL_ESCAPE]);

export class Room {
  constructor(code, { solo = false, seed = randomSeed(), name = '' } = {}) {
    this.code = code;
    this.solo = solo;
    this.name = name;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.map = getMap();
    this.t = 0;
    this.paused = false;
    this.furious = false;
    this.players = new Map();
    this.doors = this.map.doors.map(() => ({ open: false, locked: false, closeAt: 0, lockedUntil: 0 }));
    this.npcSolid = makeSolidTest(this.map, this.doors, { ignoreDoors: true });
    this.officeDoor = this.map.doors.find((d) => d.rooms.includes(this.map.roomById.office.index)).id;
    this.pickups = new Map();
    this.nextPickup = 1;
    this.objs = [];
    this.nextObj = 1;
    this.outbox = [];
    this.nextColor = 0;
    // Exercise 1 (left of the entrance hall) is push-ups, Exercise 2 (right) is AJAN's impossible
    // trick; the other five rooms get the remaining exercises in a random order.
    this.stationTypes = ['pushups', 'impossible', ...this.rng.shuffle(RANDOM_TYPES.slice())];
    this.story = STORY.WELCOME;
    this.ajan = new Ajan(this);
    this.npcs = [this.ajan, new Principal(this), new Playtime(this), new Bully(this), new Sweep(this), new Prize(this), new Arts(this)];
    this.npcById = Object.fromEntries(this.npcs.map((n) => [n.id, n]));
    this.cashSpawnedFor = 0;
    this.lastBalanceCheck = 0;
    this.lastItemRespawn = 0;
    this.createdAt = Date.now();
    this.spawnInitialItems();
  }

  // ------------------------------------------------------------------ helpers
  isActive(p) { return p.connected && ACTIVE_PHASES.has(p.phase); }
  maxProgress() {
    let m = 0;
    for (const p of this.players.values()) if (this.isActive(p)) m = Math.max(m, p.exercisesDone.size);
    return m;
  }
  itemName(id) { return ITEMS[id] ? ITEMS[id].name : id; }
  get chase() { return this.story === STORY.CHASE; }
  // other characters only notice players once AJAN's chase has started
  canInteract(p) { return this.chase && this.isActive(p); }
  npcEdgeOk(e) { return e.t === E_OPEN || (e.t === E_DOOR && !this.doors[e.d].locked); }

  event(ev, to = null) { this.outbox.push({ ev, to }); }
  sfx(k, src, to = null, extra = {}) {
    this.event({ e: 'sfx', k, x: src ? +src.x.toFixed(1) : 0, z: src ? +src.z.toFixed(1) : 0, to: to || '', src: src && src.id ? src.id : '', ...extra });
  }
  toast(p, text) { this.event({ e: 'toast', text }, p.id); }
  noise(x, z, range, priority = 1) { this.ajan.hear({ x, z, range, priority }); }

  setPhase(p, phase) {
    if (p.phase === phase) return true;
    if (!canTransition(p.phase, phase)) return false;
    p.phase = phase;
    p.dirty = true;
    return true;
  }

  // ------------------------------------------------------------------ players
  addPlayer(id, name) {
    const idx = this.players.size;
    const sp = SPAWNS.player[idx % SPAWNS.player.length];
    const pos = cellCenter(sp[0], sp[1]);
    const p = {
      id, name, color: COLORS[this.nextColor++ % COLORS.length],
      x: pos.x, z: pos.z, yaw: 0, sprinting: false, speed: 0,
      connected: true, disconnectedAt: 0,
      lastMoveT: this.t, tseq: 0, awaitTseq: 0,
      reqCache: new Map(),
      cd: {}, dirty: true,
    };
    this.resetPlayer(p, false);
    this.players.set(id, p);
    // keep enough cash in the world for every player
    this.ensureCash();
    return p;
  }

  resetPlayer(p, teleport = true) {
    p.phase = PHASE.INTRO;
    p.introUntil = this.t + 3;
    p.exercisesDone = new Set();
    p.pendingEx = new Map();
    p.cash = 0;
    p.calories = 0;
    p.purchases = [];
    p.inventory = new Array(INVENTORY_SLOTS).fill(null);
    p.selected = 0;
    p.detention = null;
    p.detentionCount = 0;
    p.jump = null;
    p.quietUntil = 0;
    p.energyUntil = 0;
    p.gotAjanCoin = false;
    p.pushUntil = 0;
    p.dirty = true;
    this.sfx('start', this.ajan, p.id, { only: 1 });
    if (teleport) {
      const sp = SPAWNS.player[0];
      const pos = cellCenter(sp[0], sp[1]);
      this.teleport(p, pos.x, pos.z, 0);
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.jump) this.npcById.playtime.endEncounter(false);
  }

  selfState(p) {
    return {
      id: p.id, phase: p.phase, ex: [...p.exercisesDone], cash: p.cash, cal: p.calories,
      inv: p.inventory, sel: p.selected,
      det: p.detention ? Math.max(0, p.detention.until - this.t) : 0,
      jump: p.jump ? { period: p.jump.period, need: p.jump.need } : null,
      quiet: Math.max(0, p.quietUntil - this.t), energy: Math.max(0, p.energyUntil - this.t),
      furious: this.furious, officeDoor: this.officeDoor, stations: this.stationTypes, story: this.story, coin: !!p.gotAjanCoin,
      solo: this.solo, code: this.code,
    };
  }

  teleport(p, x, z, yaw) {
    p.x = x; p.z = z; p.yaw = yaw;
    p.tseq++;
    p.awaitTseq = p.tseq;
    this.event({ e: 'teleport', x: +x.toFixed(2), z: +z.toFixed(2), yaw, seq: p.tseq }, p.id);
  }

  pushPlayer(p, vx, vz, dur) {
    p.pushUntil = this.t + dur;
    this.event({ e: 'push', vx: +vx.toFixed(2), vz: +vz.toFixed(2), d: dur }, p.id);
  }

  playerSolid(p) {
    return makeSolidTest(this.map, this.doors, { detainedDoor: p.detention ? this.officeDoor : -1 });
  }

  // Client-reported movement. Accept if plausible, otherwise send a correction.
  handleMove(p, m) {
    if (!p || typeof m !== 'object') return;
    const x = Number(m.x), z = Number(m.z), yaw = Number(m.yaw);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (Number.isFinite(yaw)) p.yaw = yaw;
    if (p.awaitTseq && m.ts !== p.awaitTseq) return; // still waiting for the client to apply a teleport
    p.awaitTseq = 0;
    const dt = Math.max(0.03, this.t - p.lastMoveT);
    p.lastMoveT = this.t;
    if (!ACTIVE_PHASES.has(p.phase)) return;
    const d = Math.hypot(x - p.x, z - p.z);
    const pushing = this.t < p.pushUntil + 0.5;
    const maxD = ((pushing ? 22 : RUN_SPEED) * 1.35) * Math.min(dt, 0.5) + 0.8;
    let ok = d <= maxD;
    if (p.jump && Math.hypot(x - p.jump.x, z - p.jump.z) > 1.5) ok = false;
    if (ok) {
      // the destination must be open floor and the straight segment must not pass through walls
      const solid = makeSolidTest(this.map, this.doors, { ignoreDoors: true, detainedDoor: p.detention ? this.officeDoor : -1 });
      const c = worldToCell(x, z);
      if (!this.map.isFloor(c.cx, c.cz) || segmentBlocked(this.map, p.x, p.z, x, z, solid)) ok = false;
    }
    if (ok && p.detention) {
      const r = this.map.roomById.office;
      if (x < r.x0 * CELL || x > (r.x1 + 1) * CELL || z < r.z0 * CELL || z > (r.z1 + 1) * CELL) ok = false;
    }
    if (!ok) {
      this.event({ e: 'correct', x: +p.x.toFixed(2), z: +p.z.toFixed(2) }, p.id);
      return;
    }
    p.speed = d / dt;
    p.sprinting = !!m.sprint && p.speed > WALK_SPEED * 1.08 && !pushing;
    p.x = x; p.z = z;
  }

  // ------------------------------------------------------------------ world
  openDoor(id, player, npc) {
    const d = this.doors[id];
    if (!d || d.locked) return false;
    const def = this.map.doors[id];
    const c = { x: def.x, z: def.z };
    if (!d.open) {
      d.open = true;
      this.event({ e: 'sfx', k: 'door', x: c.x, z: c.z, to: '' });
      if (player) {
        this.event({ e: 'face' }, player.id);
        if (this.t >= player.quietUntil) this.noise(c.x, c.z, 45 + 6 * this.maxProgress(), 1);
      }
    }
    d.closeAt = this.t + (npc ? 2.0 : 3.5);
    return true;
  }

  spawnInitialItems() {
    // mostly in rooms; at most three items lie around in the hallways
    const rooms = this.rng.shuffle(this.map.itemSpots.filter((s) => !s.hall));
    const halls = this.rng.shuffle(this.map.itemSpots.filter((s) => s.hall)).slice(0, 3);
    const spots = rooms.slice(0, 9).concat(halls);
    const list = ['scissors', 'scissors', 'soda', 'soda', 'keys', 'coin', 'bar', 'lock', 'sneakers', 'clock', 'energy', 'soda'];
    this.rng.shuffle(list).forEach((item, i) => { const s = spots[i]; if (s) this.addPickup({ kind: 'item', item, x: s.x, z: s.z, y: 0 }); });
  }

  addPickup(p) {
    const pk = { id: this.nextPickup++, ...p };
    this.pickups.set(pk.id, pk);
    this.event({ e: 'pk+', p: pk });
    return pk;
  }

  cashOnMap() {
    let v = 0;
    for (const pk of this.pickups.values()) if (pk.kind === 'cash') v += pk.value;
    return v;
  }

  spawnCash(n, awayFrom = null) {
    const used = new Set([...this.pickups.values()].filter((p) => p.kind === 'cash').map((p) => p.spot));
    const spots = this.rng.shuffle(this.map.cashSpots.map((s, i) => ({ ...s, i })).filter((s) => !used.has(s.i)));
    let made = 0;
    for (const s of spots) {
      if (made >= n) break;
      if (awayFrom && Math.hypot(s.x - awayFrom.x, s.z - awayFrom.z) < 25) continue;
      const value = this.rng.weighted(CASH_VALUES).v * 100;
      this.addPickup({ kind: 'cash', value, x: s.x, z: s.z, y: s.y, spot: s.i });
      made++;
    }
    return made;
  }

  // Keeps the calorie goal reachable for everyone: ~$34 of cash per player in the world.
  ensureCash() {
    const want = Math.min(this.players.size, 8);
    while (this.cashSpawnedFor < want) {
      this.spawnCash(this.cashSpawnedFor === 0 ? 18 : 14);
      this.cashSpawnedFor++;
    }
  }

  balanceCash() {
    const needy = [...this.players.values()].filter((p) => this.isActive(p) && (p.phase === PHASE.COLLECT_CASH || p.phase === PHASE.FAST_FOOD));
    if (!needy.length) return;
    const onMap = this.cashOnMap();
    let need = 0;
    for (const p of needy) need += Math.max(0, Math.ceil((CALORIE_GOAL - p.calories) / BEST_CAL_PER_CENT) - p.cash);
    if (onMap < need * 1.25) this.spawnCash(Math.ceil((need * 1.25 - onMap) / 230) + 1, needy[0]);
  }

  giveItem(p, item, msg) {
    const slot = p.inventory.indexOf(null);
    if (slot >= 0) p.inventory[slot] = item;
    else this.addPickup({ kind: 'item', item, x: p.x, z: p.z, y: 0 });
    p.dirty = true;
    if (msg) this.toast(p, msg);
  }

  // ------------------------------------------------------------------ rules / encounters
  ruleViolation(p) {
    if (p.sprinting && p.speed > WALK_SPEED * 1.08) return 'run';
    const r = this.map.room(...Object.values(worldToCell(p.x, p.z)));
    if (r && r.type === 'faculty') return 'faculty';
    return null;
  }

  startDetention(p, principal) {
    if (p.detention || !this.isActive(p)) return;
    p.detentionCount++;
    const dur = Math.min(45, 20 + (p.detentionCount - 1) * 5);
    p.detention = { until: this.t + dur, dur };
    if (p.jump) { this.npcById.playtime.endEncounter(false); p.jump = null; this.event({ e: 'jump_end', why: 'detention' }, p.id); }
    const spot = this.map.detentionSpot;
    this.teleport(p, spot.x, spot.z, 0);
    const d = this.doors[this.officeDoor];
    d.open = false;
    const od = this.map.doors[this.officeDoor];
    const dc = { x: od.x, z: od.z };
    principal.x = dc.x; principal.z = dc.z + 3; principal.path = null; principal.goal = null;
    this.sfx('principal2', principal, p.id);
    this.toast(p, 'Detention for you. ' + dur + ' seconds!');
    this.noise(spot.x, spot.z, 9999, 2); // AJAN hears where you are
    p.dirty = true;
  }

  endDetention(p, why) {
    if (!p.detention) return;
    p.detention = null;
    p.dirty = true;
    this.toast(p, why === 'keys' ? "You unlocked the door with the Principal's Keys!" : 'Detention is over. You may leave.');
  }

  startJumpRope(p, npc) {
    p.jump = { start: this.t, npc: npc.id, x: p.x, z: p.z, period: 1.2, need: 5 };
    p.dirty = true;
    this.event({ e: 'jump_start', period: 1.2, need: 5 }, p.id);
    this.sfx('playtime2', npc, p.id);
  }

  endJumpRope(p, how) {
    if (!p.jump) return;
    p.jump = null;
    p.dirty = true;
    this.npcById.playtime.endEncounter(how === 'cut');
    this.event({ e: 'jump_end', why: how }, p.id);
  }

  catchPlayer(p) {
    if (!this.isActive(p) || this.ajan.mood !== 'angry') return;
    if (p.jump) this.endJumpRope(p, 'caught');
    p.detention = null;
    p.phase = PHASE.CAUGHT;
    p.dirty = true;
    this.event({ e: 'caught', by: 'ajan' }, p.id);
    for (const o of this.players.values()) if (o !== p) this.toast(o, p.name + ' was caught by AJAN!');
    // AJAN wanders off after a catch instead of camping the body
    this.ajan.lastSeen = null;
    this.ajan.heard = null;
    this.ajan.goal = null;
  }

  artsTeleport(p) {
    let best = null;
    for (let i = 0; i < 80; i++) {
      const [cx, cz] = this.map.hallCells[Math.floor(this.rng() * this.map.hallCells.length)];
      const c = cellCenter(cx, cz);
      if (Math.hypot(c.x - p.x, c.z - p.z) < 45) continue;
      const probe = { x: c.x, z: c.z };
      if (resolveCircle(this.map, probe, PLAYER_R, this.playerSolid(p))) continue;
      best = c; break;
    }
    if (!best) return;
    if (p.jump) this.endJumpRope(p, 'arts');
    this.teleport(p, best.x, best.z, p.yaw);
    this.sfx('teleport', null, p.id);
    this.toast(p, 'Arts and Crafters whisked you away!');
  }

  // ------------------------------------------------------------------ actions
  handleAction(p, msg) {
    if (!p || !msg || typeof msg !== 'object') return { ok: false, err: 'bad' };
    const reqId = typeof msg.reqId === 'string' ? msg.reqId.slice(0, 40) : null;
    if (reqId && p.reqCache.has(reqId)) return p.reqCache.get(reqId); // idempotent retries
    let res;
    try { res = this.doAction(p, msg); } catch (err) { res = { ok: false, err: 'server error' }; console.error(err); }
    if (reqId) {
      p.reqCache.set(reqId, res);
      if (p.reqCache.size > 200) p.reqCache.delete(p.reqCache.keys().next().value);
    }
    return res;
  }

  doAction(p, msg) {
    const t = this.t;
    switch (msg.type) {
      case 'pause':
        if (!this.solo) return { ok: false, err: 'Multiplayer games cannot be paused.' };
        this.paused = !!msg.paused;
        return { ok: true };

      case 'debug': {
        // test hooks, only when the server runs with AJAN_DEBUG=1 (never in production)
        if (process.env.AJAN_DEBUG !== '1') return { ok: false, err: 'Debug disabled.' };
        if (msg.tp) this.teleport(p, +msg.tp[0], +msg.tp[1], +(msg.tp[2] || 0));
        if (msg.exercises) {
          for (let i = 0; i < Math.min(EXERCISE_COUNT, msg.exercises | 0); i++) p.exercisesDone.add(i);
          if (p.phase === PHASE.INTRO) this.setPhase(p, PHASE.TRAINING);
          if (p.exercisesDone.size >= EXERCISE_COUNT) this.setPhase(p, PHASE.COLLECT_CASH);
        }
        if (Array.isArray(msg.types)) this.stationTypes = this.stationTypes.map((t, i) => msg.types[i] || t);
        if (msg.cash) p.cash += msg.cash | 0;
        if (msg.give && ITEMS[msg.give]) this.giveItem(p, msg.give);
        if (msg.ajan === 'angry' || msg.chase) this.startChase(p);
        else if (msg.ajan) this.ajan.mood = msg.ajan;
        if (msg.npc) { const n = this.npcById[msg.npc[0]]; if (n) { n.x = +msg.npc[1]; n.z = +msg.npc[2]; n.path = null; n.hidden = false; if (msg.npc[3]) n.state = msg.npc[3]; } }
        if (msg.freeze != null) this.frozenNpcs = !!msg.freeze;
        p.dirty = true;
        return { ok: true };
      }

      case 'restart':
        if (p.phase !== PHASE.CAUGHT && p.phase !== PHASE.VICTORY) return { ok: false, err: 'Not finished.' };
        this.resetPlayer(p, true);
        this.ensureCash();
        return { ok: true };
    }

    if (!this.isActive(p)) return { ok: false, err: 'You are not in play.' };

    switch (msg.type) {
      case 'door': {
        const def = this.map.doors[msg.door | 0];
        if (!def) return { ok: false };
        if (Math.hypot(def.x - p.x, def.z - p.z) > 6) return { ok: false, err: 'Too far.' };
        if (p.detention && def.id === this.officeDoor) return { ok: false, err: 'The door is locked. Detention!' };
        if (this.doors[def.id].locked) return { ok: false, err: 'This door is locked.' };
        this.openDoor(def.id, p, null);
        return { ok: true };
      }

      case 'select':
        p.selected = Math.max(0, Math.min(INVENTORY_SLOTS - 1, msg.slot | 0));
        p.dirty = true;
        return { ok: true };

      case 'pickup': {
        const pk = this.pickups.get(msg.id | 0);
        if (!pk) return { ok: false, err: 'Already taken.' };
        if (Math.hypot(pk.x - p.x, pk.z - p.z) > 3.4) return { ok: false, err: 'Too far.' };
        if (pk.kind === 'cash') {
          if (p.phase !== PHASE.COLLECT_CASH && p.phase !== PHASE.FAST_FOOD && p.phase !== PHASE.FINAL_ESCAPE) return { ok: false, err: 'Finish your training first!' };
          this.pickups.delete(pk.id);
          this.event({ e: 'pk-', id: pk.id });
          p.cash += pk.value;
          p.dirty = true;
          this.event({ e: 'cash', v: pk.value }, p.id);
          return { ok: true, cash: p.cash };
        }
        this.pickups.delete(pk.id);
        this.event({ e: 'pk-', id: pk.id });
        let slot = p.inventory.indexOf(null);
        if (slot < 0) {
          slot = p.selected;
          const old = p.inventory[slot];
          this.addPickup({ kind: 'item', item: old, x: pk.x, z: pk.z, y: 0 });
        }
        p.inventory[slot] = pk.item;
        p.selected = slot;
        p.dirty = true;
        this.event({ e: 'sfx', k: 'pickup', to: p.id, x: 0, z: 0 }, p.id);
        return { ok: true };
      }

      case 'use': return this.useItem(p, msg);

      case 'exOpen': {
        const st = this.map.stations[msg.station | 0];
        if (!st) return { ok: false };
        if (Math.hypot(st.x - p.x, st.z - p.z) > 6) return { ok: false, err: 'Too far.' };
        if (p.exercisesDone.has(st.id)) return { ok: false, err: 'You already completed this exercise.' };
        if (p.jump) return { ok: false, err: 'Busy!' };
        // AJAN's lesson plan: Exercise 1, then his coin, then Exercise 2, then the rest
        if (st.id === 1 && !p.exercisesDone.has(0)) return { ok: false, err: 'AJAN: "Do Exercise 1 first!"' };
        if (st.id === 1 && !p.gotAjanCoin && !this.chase) return { ok: false, err: 'AJAN: "Come get your coin first!"' };
        if (st.id >= 2 && !this.chase) return { ok: false, err: 'AJAN: "Finish the exercises in the entrance hall first!"' };
        const type = this.stationTypes[st.id];
        const g = generateExercise(type, this.rng, { cells: this.map.exerciseCells[st.id], station: st });
        const pend = { type, spec: g.spec, solution: g.solution, servedAt: t, stepIdx: 0 };
        p.pendingEx.set(st.id, pend);
        return { ok: true, station: st.id, type, info: EXERCISE_INFO[type], spec: pend.spec };
      }

      case 'exStep': {
        const pend = p.pendingEx.get(msg.station | 0);
        if (!pend) return { ok: false, err: 'Start the exercise first.' };
        return validateStep(pend, msg.i | 0, p, t);
      }

      case 'exSubmit': {
        const st = this.map.stations[msg.station | 0];
        if (!st) return { ok: false };
        if (p.exercisesDone.has(st.id)) return { ok: false, err: 'Already completed.' };
        const pend = p.pendingEx.get(st.id);
        if (!pend) return { ok: false, err: 'Open the exercise first.' };
        const room = this.map.roomById[st.room];
        const c = worldToCell(p.x, p.z);
        if (this.map.room(c.cx, c.cz) !== room) return { ok: false, err: 'Stay in the exercise room!' };
        const v = validateExercise(pend.type, pend.solution, pend.spec, msg.answer, t - pend.servedAt, pend);
        p.pendingEx.delete(st.id);
        if (v.impossible) {
          // the trick question: it still counts, but AJAN loses his temper
          p.exercisesDone.add(st.id);
          if (p.phase === PHASE.INTRO) this.setPhase(p, PHASE.TRAINING);
          p.dirty = true;
          this.startChase(p);
          return { ok: true, success: false, impossible: true, done: p.exercisesDone.size, reason: v.reason };
        }
        if (!v.ok) {
          this.sfx('fail', null, p.id);
          if (this.chase) {
            this.noise(st.x, st.z, 9999, 2);
            this.ajan.angerBonus = Math.min(0.25, this.ajan.angerBonus + 0.04);
          }
          return { ok: true, success: false, reason: v.reason };
        }
        p.exercisesDone.add(st.id);
        if (p.phase === PHASE.INTRO) this.setPhase(p, PHASE.TRAINING);
        p.dirty = true;
        this.sfx('success', null, p.id);
        if (this.chase) this.noise(st.x, st.z, 60, 1);
        if (st.id === 0 && !this.chase) {
          this.sfx('coin', this.ajan, p.id);
          if (this.ajan.mood === 'happy') { this.ajan.mood = 'coin'; this.story = STORY.COIN; }
          this.toast(p, 'AJAN wants to give you a coin - go to him!');
        }
        if (p.exercisesDone.size >= EXERCISE_COUNT) {
          this.setPhase(p, PHASE.COLLECT_CASH);
          this.toast(p, 'All training done! Collect cash and buy 7,000 calories at KFC or Popeyes!');
          this.event({ e: 'phase', phase: p.phase }, p.id);
        }
        return { ok: true, success: true, done: p.exercisesDone.size };
      }

      case 'buy': {
        if (p.phase !== PHASE.COLLECT_CASH && p.phase !== PHASE.FAST_FOOD) return { ok: false, err: p.phase === PHASE.FINAL_ESCAPE ? 'You already ate enough! RUN!' : 'The restaurants only serve trained staff. Finish all 7 exercises!' };
        const r = RESTAURANTS[msg.restaurant];
        const item = r && r.menu.find((m) => m.id === msg.item);
        if (!item) return { ok: false, err: 'Not on the menu.' };
        const counter = this.map.counters.find((c) => c.restaurant === r.id);
        if (Math.hypot(counter.x - p.x, counter.z - p.z) > 7) return { ok: false, err: 'Walk up to the counter.' };
        if (p.cash < item.price) return { ok: false, err: "You can't afford that!" };
        p.cash -= item.price;
        p.calories += item.cal;
        p.purchases.push(item.id);
        p.dirty = true;
        this.setPhase(p, PHASE.FAST_FOOD);
        this.event({ e: 'sfx', k: 'buy', to: p.id, x: 0, z: 0 }, p.id);
        if (p.calories >= CALORIE_GOAL) this.startFinal(p);
        return { ok: true, cash: p.cash, cal: p.calories };
      }

      case 'jumpDone': {
        if (!p.jump) return { ok: false };
        const need = p.jump.need * p.jump.period * 0.85;
        if (t - p.jump.start < need) return { ok: false, err: 'Keep jumping!' };
        this.endJumpRope(p, 'done');
        this.toast(p, 'Playtime: "Thanks for playing!"');
        return { ok: true };
      }

      case 'enterRestaurant':
        if (p.phase === PHASE.COLLECT_CASH) {
          const r = this.map.room(...Object.values(worldToCell(p.x, p.z)));
          if (r && (r.type === 'kfc' || r.type === 'popeyes')) this.setPhase(p, PHASE.FAST_FOOD);
        }
        return { ok: true };
    }
    return { ok: false, err: 'Unknown action.' };
  }

  useItem(p, msg) {
    const slot = Math.max(0, Math.min(INVENTORY_SLOTS - 1, msg.slot | 0));
    const item = p.inventory[slot];
    if (!item) return { ok: false, err: 'Nothing to use.' };
    const t = this.t;
    const consume = () => { p.inventory[slot] = null; p.dirty = true; };
    const yaw = Number.isFinite(Number(msg.yaw)) ? Number(msg.yaw) : p.yaw;
    switch (item) {
      case 'scissors': {
        if (p.jump) { consume(); this.sfx('snip', null, p.id); this.endJumpRope(p, 'cut'); this.toast(p, 'You cut the rope!'); return { ok: true }; }
        const prize = this.npcById.prize;
        if (Math.hypot(prize.x - p.x, prize.z - p.z) < 7 && prize.state !== 'disabled') {
          consume(); this.sfx('snip', prize, p.id); prize.disable(15); this.toast(p, "You cut 1st Prize's wires!"); return { ok: true };
        }
        return { ok: false, err: 'Nothing to cut here.' };
      }
      case 'coin': {
        const v = this.map.vending.find((vm) => Math.hypot(vm.wx - p.x, vm.wz - p.z) < 4.5);
        if (!v) return { ok: false, err: 'Use it on a vending machine.' };
        p.inventory[slot] = v.kind === 'soda' ? 'soda' : 'bar';
        p.dirty = true;
        this.event({ e: 'sfx', k: 'vend', to: p.id, x: v.wx, z: v.wz }, p.id);
        this.toast(p, 'The machine gave you a ' + this.itemName(p.inventory[slot]) + '.');
        return { ok: true };
      }
      case 'soda': {
        consume();
        const f = fwd(yaw);
        this.objs.push({ id: this.nextObj++, k: 'soda', x: p.x + f.x * 1.2, z: p.z + f.z * 1.2, vx: f.x * 17, vz: f.z * 17, until: t + 1.8, hit: new Set() });
        this.sfx('spray', p, null);
        return { ok: true };
      }
      case 'keys': {
        const od = this.map.doors[this.officeDoor];
        const c = { x: od.x, z: od.z };
        if (!p.detention) return { ok: false, err: 'You are not in detention.' };
        if (Math.hypot(c.x - p.x, c.z - p.z) > 6) return { ok: false, err: 'Get closer to the door.' };
        consume();
        this.endDetention(p, 'keys');
        this.openDoor(this.officeDoor, p, null);
        return { ok: true };
      }
      case 'bar':
        consume();
        this.event({ e: 'stamina', v: 200 }, p.id);
        this.sfx('eat', null, p.id);
        return { ok: true };
      case 'energy':
        consume();
        p.energyUntil = t + 15;
        this.event({ e: 'stamina', v: 100 }, p.id);
        this.sfx('drink', null, p.id);
        return { ok: true };
      case 'sneakers':
        consume();
        p.quietUntil = t + 30;
        this.toast(p, 'Quiet Sneakers on: AJAN cannot hear your doors for 30s.');
        return { ok: true };
      case 'lock': {
        const def = this.map.doors[msg.door | 0];
        if (!def || msg.door == null) return { ok: false, err: 'Look at a door.' };
        const c = { x: def.x, z: def.z };
        if (Math.hypot(c.x - p.x, c.z - p.z) > 7) return { ok: false, err: 'Get closer to the door.' };
        if (def.id === this.officeDoor && p.detention) return { ok: false, err: 'Nice try.' };
        const ds = this.doors[def.id];
        if (ds.locked) return { ok: false, err: 'Already locked.' };
        // never lock a door on top of someone
        for (const o of [...this.players.values(), ...this.npcs]) if (Math.hypot(o.x - c.x, o.z - c.z) < 1.8) return { ok: false, err: 'Something is in the doorway.' };
        consume();
        ds.open = false;
        ds.locked = true;
        ds.lockedUntil = t + 15;
        for (const n of this.npcs) n.path = null;
        this.event({ e: 'sfx', k: 'lock', x: c.x, z: c.z, to: '' });
        return { ok: true };
      }
      case 'clock': {
        consume();
        this.objs.push({ id: this.nextObj++, k: 'clock', x: p.x, z: p.z, ringAt: t + 5, until: t + 20 });
        this.toast(p, 'The Alarm Clock will ring in 5 seconds.');
        return { ok: true };
      }
    }
    return { ok: false, err: 'Cannot use that.' };
  }

  // The impossible answer: AJAN gets mad (AJANMAD + musicwrong + FACE3 on the client),
  // vanishes to the cafeteria and the chase is on. Everyone else becomes dangerous too.
  startChase(p) {
    if (this.chase) { this.noise(p.x, p.z, 9999, 2); return; }
    this.story = STORY.CHASE;
    this.ajan.becomeAngry();
    this.event({ e: 'chase', by: p.id });
    this.sfx('mad', this.ajan, '*');
    for (const o of this.players.values()) o.dirty = true;
  }

  startFinal(p) {
    if (!this.setPhase(p, PHASE.FINAL_ESCAPE)) return;
    this.toast(p, '7,000 CALORIES! AJAN IS FURIOUS! GET TO AN EXIT!');
    this.event({ e: 'phase', phase: p.phase }, p.id);
    if (!this.furious) {
      this.furious = true;
      this.ajan.becomeAngry();
      this.event({ e: 'mad' });
      this.sfx('mad', this.ajan, '*');
      for (const o of this.players.values()) o.dirty = true;
    }
    this.noise(p.x, p.z, 9999, 3);
  }

  // ------------------------------------------------------------------ simulation tick
  tick(dt = 1 / TICK_HZ) {
    if (this.paused) return;
    this.t += dt;
    const t = this.t;

    for (const p of this.players.values()) {
      if (p.phase === PHASE.INTRO && t >= p.introUntil) this.setPhase(p, PHASE.TRAINING);
      if (p.detention && t >= p.detention.until) this.endDetention(p, 'time');
      if (p.jump && t - p.jump.start > 45) this.endJumpRope(p, 'timeout');
      if (p.phase === PHASE.FINAL_ESCAPE && p.calories >= CALORIE_GOAL) {
        for (const e of this.map.exits) {
          if (Math.hypot(e.wx - p.x, e.wz - p.z) < CELL * 0.9) {
            this.setPhase(p, PHASE.VICTORY);
            this.event({ e: 'victory' }, p.id);
            for (const o of this.players.values()) if (o !== p) this.toast(o, p.name + ' escaped!');
            break;
          }
        }
      }
      if (p.phase === PHASE.COLLECT_CASH) {
        const r = this.map.room(...Object.values(worldToCell(p.x, p.z)));
        if (r && (r.type === 'kfc' || r.type === 'popeyes')) this.setPhase(p, PHASE.FAST_FOOD);
      }
    }

    if (!this.frozenNpcs) for (const n of this.npcs) n.update(dt);

    // doors
    this.doors.forEach((d, i) => {
      if (d.locked && t >= d.lockedUntil) { d.locked = false; for (const n of this.npcs) n.path = null; }
      if (d.open && t >= d.closeAt) {
        const def = this.map.doors[i];
        // never slam a door shut on someone standing in the doorway
        const along = def.axis === 'x' ? 'z' : 'x', across = def.axis;
        const inDoor = (o, r) => Math.abs(o[along] - def[along]) < CELL * 0.5 + r && Math.abs(o[across] - def[across]) < r + 0.15;
        let occupied = false;
        for (const o of this.players.values()) if (inDoor(o, PLAYER_R)) occupied = true;
        for (const o of this.npcs) if (!o.hidden && inDoor(o, o.r)) occupied = true;
        if (!occupied) d.open = false;
        else d.closeAt = t + 0.5;
      }
    });

    // objects: soda sprays and alarm clocks
    const solid = makeSolidTest(this.map, this.doors);
    this.objs = this.objs.filter((o) => {
      if (o.k === 'soda') {
        const nx = o.x + o.vx * dt, nz = o.z + o.vz * dt;
        if (segmentBlocked(this.map, o.x, o.z, nx, nz, solid) || t > o.until) return false;
        o.x = nx; o.z = nz;
        for (const n of this.npcs) {
          if (!n.sodaPushable || n.hidden || o.hit.has(n.id)) continue;
          if (Math.hypot(n.x - o.x, n.z - o.z) < 1.9) {
            o.hit.add(n.id);
            n.push = { vx: o.vx * 0.9, vz: o.vz * 0.9, until: t + 1.0 };
          }
        }
        return true;
      }
      if (o.k === 'clock') {
        if (t >= o.ringAt) {
          if (!o.ringing) { o.ringing = true; this.event({ e: 'sfx', k: 'alarm', x: o.x, z: o.z, to: '', src: 'clock' + o.id }); }
          this.noise(o.x, o.z, 9999, 2);
        }
        return t < o.until;
      }
      return false;
    });

    if (t - this.lastBalanceCheck > 5) { this.lastBalanceCheck = t; this.balanceCash(); }
    if (t - this.lastItemRespawn > 45) {
      this.lastItemRespawn = t;
      const items = [...this.pickups.values()].filter((p) => p.kind === 'item').length;
      if (items < 8) {
        const s = this.rng.pick(this.map.itemSpots);
        this.addPickup({ kind: 'item', item: this.rng.pick(['scissors', 'soda', 'bar', 'coin', 'keys', 'clock', 'energy', 'lock', 'sneakers']), x: s.x, z: s.z, y: 0 });
      }
    }
  }

  // Build per-recipient network payloads and clear the outbox.
  flush() {
    const npcs = this.npcs.map((n) => n.snapshot());
    const doors = this.doors.map((d) => (d.locked ? 'l' : d.open ? 'o' : 'c')).join('');
    const objs = this.objs.map((o) => ({ id: o.id, k: o.k, x: +o.x.toFixed(2), z: +o.z.toFixed(2), r: o.ringing ? 1 : 0 }));
    const players = [...this.players.values()].map((p) => ({ id: p.id, n: p.name, c: p.color, x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.yaw.toFixed(2), ph: p.phase, j: p.jump ? 1 : 0, d: p.detention ? 1 : 0, cn: p.connected ? 1 : 0 }));
    const out = new Map();
    for (const p of this.players.values()) {
      const ev = this.outbox.filter((o) => !o.to || o.to === p.id).map((o) => o.ev);
      const msg = { t: +this.t.toFixed(2), p: players, n: npcs, d: doors, o: objs, ev, f: this.furious ? 1 : 0 };
      if (p.dirty || Math.floor(this.t * 2) !== p.lastSelfHalf) {
        p.lastSelfHalf = Math.floor(this.t * 2);
        msg.self = this.selfState(p);
        p.dirty = false;
      }
      out.set(p.id, msg);
    }
    this.outbox = [];
    return out;
  }

  initPayload(p) {
    return {
      id: p.id, code: this.code, solo: this.solo, seed: this.seed,
      pickups: [...this.pickups.values()],
      stations: this.stationTypes, self: this.selfState(p),
    };
  }
}
