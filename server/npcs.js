// Server-side NPC AI. Every character is a state machine on top of a shared Npc base that
// handles grid pathfinding, door opening, collision-aware movement, pushes and stuck recovery.
import { CELL } from '../shared/constants.js';
import { findPath, lineOfSight, straightWalkable } from '../shared/nav.js';
import { cellCenter, worldToCell, SPAWNS, BULLY_SPOTS } from '../shared/map.js';
import { moveCircle } from '../shared/collision.js';

export const fwd = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Npc {
  constructor(room, kind, cx, cz, r = 0.9) {
    this.room = room;
    this.kind = kind;
    this.id = kind;
    const p = cellCenter(cx, cz);
    this.x = p.x; this.z = p.z;
    this.home = { x: p.x, z: p.z };
    this.yaw = 0;
    this.r = r;
    this.state = 'idle';
    this.path = null;
    this.goal = null;
    this.repathAt = 0;
    this.push = null;
    this.hidden = false;
    this.stuckT = 0;
    this.lastProgress = { x: this.x, z: this.z, t: 0 };
    this.pushable = true;
    this.sodaPushable = true;
  }

  get map() { return this.room.map; }
  cell() { return worldToCell(this.x, this.z); }

  passable = (i) => this.map.nav[i] === 1 && !this.room.doorLockedIdx(i);

  setGoal(x, z, force = false) {
    const g = worldToCell(x, z);
    if (!force && this.goal && this.goal.cx === g.cx && this.goal.cz === g.cz && this.path && this.room.t < this.repathAt) return;
    this.goal = { cx: g.cx, cz: g.cz, x, z };
    const c = this.cell();
    this.path = findPath(this.map, c.cx, c.cz, g.cx, g.cz, this.passable);
    this.repathAt = this.room.t + 0.6;
    if (this.path) this.path = this.path.map(([px, pz]) => cellCenter(px, pz));
    if (this.path && this.path.length) this.path[this.path.length - 1] = this.passable(g.cz * this.map.W + g.cx) ? { x, z } : this.path[this.path.length - 1];
  }

  atGoal(tol = 1.2) {
    return !this.path || this.path.length === 0 || (this.goal && Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < tol);
  }

  randomHallGoal(minDist = 0) {
    const rng = this.room.rng;
    for (let i = 0; i < 20; i++) {
      const [cx, cz] = this.map.hallCells[Math.floor(rng() * this.map.hallCells.length)];
      const p = cellCenter(cx, cz);
      if (Math.hypot(p.x - this.x, p.z - this.z) >= minDist) return p;
    }
    return cellCenter(...this.map.hallCells[0]);
  }

  // Move along the current path by `step` world units. Returns true if moved.
  followPath(step) {
    if (!this.path || !this.path.length) {
      // final approach: the goal may sit in a cell partly covered by a prop, walk straight at it
      if (!this.goal) return false;
      const dx = this.goal.x - this.x, dz = this.goal.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3 || d > CELL * 3) return false;
      const s = Math.min(step, d);
      this.moveBy((dx / d) * s, (dz / d) * s);
      this.yaw = yawTo(dx, dz);
      return true;
    }
    // string-pull: skip waypoints we can walk straight to
    while (this.path.length > 1 && straightWalkable(this.map, this.x, this.z, this.path[1].x, this.path[1].z, this.passable)) this.path.shift();
    const wp = this.path[0];
    // open any closed door on the way
    const wc = worldToCell(wp.x, wp.z);
    const ahead = worldToCell(this.x + Math.sign(wp.x - this.x) * CELL * 0.9, this.z + Math.sign(wp.z - this.z) * CELL * 0.9);
    for (const c of [wc, ahead]) {
      const d = this.map.doorAt[this.map.idx(c.cx, c.cz)];
      if (d >= 0) this.room.openDoor(d, null, this);
    }
    const dx = wp.x - this.x, dz = wp.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.path.shift(); return true; }
    const s = Math.min(step, d);
    this.moveBy((dx / d) * s, (dz / d) * s);
    if (s >= d - 1e-3) this.path.shift();
    this.yaw = yawTo(dx, dz);
    return true;
  }

  moveBy(dx, dz) {
    const pos = { x: this.x, z: this.z };
    const hit = moveCircle(this.map, pos, dx, dz, this.r, this.room.npcSolid, null, true);
    this.x = pos.x; this.z = pos.z;
    return hit;
  }

  applyPush(dt) {
    if (!this.push) return false;
    if (this.room.t > this.push.until) { this.push = null; return false; }
    this.moveBy(this.push.vx * dt, this.push.vz * dt);
    this.path = null;
    return true;
  }

  checkStuck(dt, wantsToMove) {
    const t = this.room.t;
    if (!wantsToMove) { this.lastProgress = { x: this.x, z: this.z, t }; return false; }
    if (Math.hypot(this.x - this.lastProgress.x, this.z - this.lastProgress.z) > 1.0) {
      this.lastProgress = { x: this.x, z: this.z, t };
      return false;
    }
    if (t - this.lastProgress.t > 2.5) {
      // recovery: snap to the nearest nav cell centre and force a repath
      const c = this.cell();
      if (!this.map.nav[this.map.idx(c.cx, c.cz)]) {
        for (let r = 1; r < 4; r++) {
          let found = null;
          for (let dz = -r; dz <= r && !found; dz++)
            for (let dx = -r; dx <= r && !found; dx++)
              if (this.map.inBounds(c.cx + dx, c.cz + dz) && this.map.nav[this.map.idx(c.cx + dx, c.cz + dz)]) found = cellCenter(c.cx + dx, c.cz + dz);
          if (found) { this.x = found.x; this.z = found.z; break; }
        }
      }
      this.path = null;
      this.goal = null;
      this.lastProgress = { x: this.x, z: this.z, t };
      return true;
    }
    return false;
  }

  canSee(p, maxD = 120) {
    const d = dist(this, p);
    if (d > maxD) return false;
    return lineOfSight(this.map, this.x, this.z, p.x, p.z, this.room.doors);
  }

  snapshot() {
    return { id: this.id, k: this.kind, x: +this.x.toFixed(2), z: +this.z.toFixed(2), y: +this.yaw.toFixed(2), s: this.state, h: this.hidden ? 1 : 0 };
  }

  reset() {
    this.x = this.home.x; this.z = this.home.z;
    this.path = null; this.goal = null; this.push = null;
  }
}

// ------------------------------------------------------------------------------------------
// AJAN — the main antagonist. Happy at first, then stomps after the players with a cadence
// that speeds up with training progress, and goes berserk in the final phase.
export class Ajan extends Npc {
  constructor(room) {
    super(room, 'ajan', ...SPAWNS.ajan, 0.9);
    this.mood = 'happy';     // happy | coin | angry
    this.yaw = 0;
    this.nextStomp = 0;
    this.lungeUntil = 0;
    this.stompCount = 0;
    this.heard = null;
    this.lastSeen = null;
    this.target = null;
    this.coinTarget = null;
    this.coinUntil = 0;
    this.angerBonus = 0;
    this.thinkAt = 0;
    this.yaw = Math.PI; // face the spawn (south)
  }

  interval() {
    if (this.room.furious) return 0.36;
    const L = Math.max(1, this.room.maxProgress());
    const base = 1.5 - ((L - 1) / 6) * 1.0; // 1.5s -> 0.5s
    return Math.max(0.42, base - this.angerBonus);
  }

  hear(noise) {
    if (this.mood !== 'angry') return;
    const d = Math.hypot(noise.x - this.x, noise.z - this.z);
    if (d > noise.range) return;
    if (!this.heard || noise.priority >= this.heard.priority || this.room.t - this.heard.t > 3) this.heard = { ...noise, t: this.room.t };
  }

  becomeAngry() {
    if (this.mood === 'angry') return;
    this.mood = 'angry';
    this.state = 'hunt';
    this.nextStomp = this.room.t + 0.8;
    this.room.event({ e: 'ajan_angry' });
  }

  update(dt) {
    const room = this.room, t = room.t;
    if (this.applyPush(dt)) return;

    if (this.mood === 'happy') { this.state = 'idle'; return; }

    if (this.mood === 'coin') {
      // "You earned a coin, come over here!" — walks calmly toward the player, gives a quarter.
      this.state = 'coin';
      const p = room.players.get(this.coinTarget);
      if (p && room.isActive(p)) {
        if (dist(this, p) < 3.2) {
          if (!p.gotAjanCoin) {
            p.gotAjanCoin = true;
            room.giveItem(p, 'coin', 'AJAN handed you a Shiny Quarter!');
            this.coinUntil = Math.min(this.coinUntil, t + 2.5);
          }
          this.yaw = yawTo(p.x - this.x, p.z - this.z);
        } else {
          this.setGoal(p.x, p.z);
          this.followPath(3.2 * dt);
        }
      }
      if (t >= this.coinUntil) this.becomeAngry();
      return;
    }

    // ---- angry ----
    if (t >= this.thinkAt) {
      this.thinkAt = t + 0.2;
      // perception: nearest visible active player
      let best = null, bd = 1e9;
      for (const p of room.players.values()) {
        if (!room.isActive(p)) continue;
        const d = dist(this, p);
        if (d < bd && this.canSee(p, 140)) { bd = d; best = p; }
      }
      if (best) {
        this.target = best.id;
        this.lastSeen = { x: best.x, z: best.z, t };
        this.state = 'chase';
        this.setGoal(best.x, best.z);
      } else if (this.heard && t - this.heard.t < 25) {
        this.state = 'investigate';
        this.setGoal(this.heard.x, this.heard.z);
        if (this.atGoal(2.5)) this.heard = null;
      } else if (this.lastSeen && t - this.lastSeen.t < 12) {
        this.state = 'search';
        this.setGoal(this.lastSeen.x, this.lastSeen.z);
        if (this.atGoal(2.5)) this.lastSeen = null;
      } else {
        this.state = 'wander';
        if (this.atGoal(2) || !this.goal) {
          const g = this.randomHallGoal(30);
          this.setGoal(g.x, g.z, true);
        }
      }
    }

    // stomp cadence: each stomp is a short lunge, then a pause (like the Classic ruler slap)
    if (t >= this.nextStomp) {
      const iv = this.interval();
      this.nextStomp = t + iv;
      this.lungeUntil = t + Math.min(0.26, iv * 0.6);
      this.lungeSpeed = 3.6 / Math.min(0.26, iv * 0.6);
      this.stompCount++;
      room.event({ e: 'stomp', x: +this.x.toFixed(1), z: +this.z.toFixed(1), f: room.furious ? 1 : 0 });
    }
    let moving = false;
    if (t < this.lungeUntil) {
      if (!this.path || !this.path.length) {
        if (this.goal) this.setGoal(this.goal.x, this.goal.z, true);
      }
      moving = this.followPath(this.lungeSpeed * dt);
    }
    if (this.checkStuck(dt, !!(this.path && this.path.length))) {
      if (this.goal) this.setGoal(this.goal.x, this.goal.z, true);
    }

    // catching
    for (const p of room.players.values()) {
      if (!room.isActive(p)) continue;
      if (dist(this, p) < 2.0) room.catchPlayer(p);
    }
    return moving;
  }

  snapshot() {
    const s = super.snapshot();
    s.m = this.mood === 'angry' ? 'a' : 'h';
    return s;
  }
}

// ------------------------------------------------------------------------------------------
export class Principal extends Npc {
  constructor(room) {
    super(room, 'principal', ...SPAWNS.principal, 0.8);
    this.state = 'wander';
    this.target = null;
    this.chaseUntil = 0;
    this.lostAt = 0;
    this.thinkAt = 0;
  }

  update(dt) {
    const room = this.room, t = room.t;
    if (this.applyPush(dt)) return;
    if (t >= this.thinkAt) {
      this.thinkAt = t + 0.15;
      if (this.state !== 'chase') {
        for (const p of room.players.values()) {
          if (!room.isActive(p) || p.detention) continue;
          if (!this.canSee(p, 38)) continue;
          const violation = room.ruleViolation(p);
          if (!violation) continue;
          if (t < (p.cd.principalWarn || 0)) continue;
          p.cd.principalWarn = t + 6;
          this.state = 'chase';
          this.target = p.id;
          this.lostAt = t;
          this.chaseUntil = t + 25;
          room.sfx('principal1', this, p.id);
          room.toast(p, violation === 'run' ? 'No running in the halls!' : 'Faculty only!');
          break;
        }
      }
    }

    if (this.state === 'chase') {
      const p = room.players.get(this.target);
      if (!p || !room.isActive(p) || p.detention || t > this.chaseUntil) { this.state = 'wander'; this.target = null; return; }
      if (this.canSee(p, 80)) this.lostAt = t;
      if (t - this.lostAt > 7) { this.state = 'wander'; this.target = null; return; }
      this.setGoal(p.x, p.z);
      this.followPath(11.5 * dt);
      if (dist(this, p) < 2.0) {
        room.startDetention(p, this);
        this.state = 'wander';
        this.target = null;
      }
    } else {
      this.state = 'wander';
      if (this.atGoal(1.5) || !this.goal) {
        const g = this.randomHallGoal(20);
        this.setGoal(g.x, g.z, true);
      }
      this.followPath(4.5 * dt);
    }
    if (this.checkStuck(dt, true)) this.goal = null;
  }
}

// ------------------------------------------------------------------------------------------
export class Playtime extends Npc {
  constructor(room) {
    super(room, 'playtime', ...SPAWNS.playtime, 0.8);
    this.state = 'wander';
    this.target = null;
    this.cooldownUntil = 0;
    this.thinkAt = 0;
    this.sadUntil = 0;
  }

  update(dt) {
    const room = this.room, t = room.t;
    if (this.applyPush(dt)) { if (this.state === 'approach') this.state = 'wander'; return; }
    if (this.state === 'jumping') {
      const p = room.players.get(this.target);
      if (!p || !p.jump || !room.isActive(p)) { this.endEncounter(false); return; }
      this.yaw = yawTo(p.x - this.x, p.z - this.z);
      return;
    }
    if (this.state === 'sad' && t < this.sadUntil) { this.followPath(3 * dt); return; }
    if (this.state === 'sad') this.state = 'wander';

    if (this.state === 'wander' && t >= this.thinkAt && t >= this.cooldownUntil) {
      this.thinkAt = t + 0.25;
      for (const p of room.players.values()) {
        if (!room.isActive(p) || p.detention || p.jump || t < (p.cd.playtime || 0)) continue;
        if (!this.canSee(p, 30)) continue;
        this.state = 'approach';
        this.target = p.id;
        this.approachUntil = t + 15;
        room.sfx('playtime1', this, p.id);
        break;
      }
    }

    if (this.state === 'approach') {
      const p = room.players.get(this.target);
      if (!p || !room.isActive(p) || p.detention || p.jump || t > this.approachUntil) { this.state = 'wander'; this.target = null; return; }
      this.setGoal(p.x, p.z);
      this.followPath(9.5 * dt);
      if (dist(this, p) < 2.4) {
        this.state = 'jumping';
        room.startJumpRope(p, this);
      }
    } else if (this.state === 'wander') {
      if (this.atGoal(1.5) || !this.goal) {
        const g = this.randomHallGoal(15);
        this.setGoal(g.x, g.z, true);
      }
      this.followPath(4 * dt);
    }
    if (this.checkStuck(dt, this.state !== 'jumping')) this.goal = null;
  }

  endEncounter(cut) {
    const t = this.room.t;
    const p = this.room.players.get(this.target);
    if (p) p.cd.playtime = t + (cut ? 35 : 25);
    this.target = null;
    this.cooldownUntil = t + (cut ? 20 : 10);
    if (cut) { this.state = 'sad'; this.sadUntil = t + 8; const g = this.randomHallGoal(20); this.setGoal(g.x, g.z, true); }
    else this.state = 'wander';
  }

  snapshot() {
    const s = super.snapshot();
    if (this.state === 'sad') s.v = 'sad';
    return s;
  }
}

// ------------------------------------------------------------------------------------------
// The Bully stands across a hallway. A thin blocker box spans the full corridor width.
export class Bully extends Npc {
  constructor(room) {
    super(room, 'bully', BULLY_SPOTS[0].x, BULLY_SPOTS[0].z, 0.8);
    this.pushable = false;
    this.sodaPushable = false;
    this.state = 'block';
    this.box = null;
    this.relocateAt = 0;
    this.respawnAt = 0;
    this.leaveAt = 0;
    this.busy = false;
    this.placeAt(BULLY_SPOTS[1]);
  }

  placeAt(spot) {
    const map = this.map;
    const p = cellCenter(spot.x, spot.z);
    this.x = p.x; this.z = p.z;
    // corridor orientation: if floor continues east-west, it is an x-running hall
    const runsX = map.isFloor(spot.x - 2, spot.z) && map.isFloor(spot.x + 2, spot.z);
    if (runsX) {
      let z0 = spot.z, z1 = spot.z;
      while (map.isFloor(spot.x, z0 - 1)) z0--;
      while (map.isFloor(spot.x, z1 + 1)) z1++;
      this.box = { x0: p.x - 0.5, x1: p.x + 0.5, z0: z0 * CELL, z1: (z1 + 1) * CELL };
      this.yaw = Math.PI / 2;
    } else {
      let x0 = spot.x, x1 = spot.x;
      while (map.isFloor(x0 - 1, spot.z)) x0--;
      while (map.isFloor(x1 + 1, spot.z)) x1++;
      this.box = { x0: x0 * CELL, x1: (x1 + 1) * CELL, z0: p.z - 0.5, z1: p.z + 0.5 };
      this.yaw = 0;
    }
    this.hidden = false;
    this.state = 'block';
    this.relocateAt = this.room.t + 80 + this.room.rng() * 40;
    this.leaveAt = 0;
  }

  relocate(delay) {
    this.hidden = true;
    this.state = 'gone';
    this.box = null;
    this.respawnAt = this.room.t + delay;
  }

  pickSpot() {
    const room = this.room;
    const spots = room.rng.shuffle(BULLY_SPOTS.slice());
    for (const s of spots) {
      const p = cellCenter(s.x, s.z);
      let ok = true;
      for (const pl of room.players.values()) if (Math.hypot(pl.x - p.x, pl.z - p.z) < 18) ok = false;
      if (ok) return s;
    }
    return spots[0];
  }

  update() {
    const room = this.room, t = room.t;
    if (this.state === 'gone') {
      if (t >= this.respawnAt) this.placeAt(this.pickSpot());
      return;
    }
    if ((this.leaveAt && t >= this.leaveAt) || t >= this.relocateAt) {
      let near = false;
      for (const p of room.players.values()) if (dist(this, p) < 6) near = true;
      if (!near || this.leaveAt) { this.relocate(30 + room.rng() * 30); return; }
    }
    for (const p of room.players.values()) {
      if (!room.isActive(p)) continue;
      const d = dist(this, p);
      if (d < 16 && t >= (p.cd.bullySee || 0) && this.canSee(p, 16)) {
        p.cd.bullySee = t + 20;
        room.sfx('bullysee', this, p.id);
      }
      if (d < 3.0 && !this.busy && t >= (p.cd.bullyTouch || 0)) {
        // the encounter is resolved atomically on the server tick; `busy` keeps it to one player
        this.busy = true;
        const slots = p.inventory.map((it, i) => (it ? i : -1)).filter((i) => i >= 0);
        if (slots.length) {
          const slot = slots[Math.floor(room.rng() * slots.length)];
          const stolen = p.inventory[slot];
          p.inventory[slot] = null;
          p.dirty = true;
          room.sfx('bullytake', this, p.id);
          room.toast(p, 'The Bully took your ' + room.itemName(stolen) + '!');
          this.relocate(45 + room.rng() * 30);
        } else {
          p.cd.bullyTouch = t + 6;
          room.sfx('bullypass', this, p.id);
          room.toast(p, 'No items? No pass! (He will get bored soon...)');
          if (!this.leaveAt) this.leaveAt = t + 8;
        }
        this.busy = false;
        if (this.state === 'gone') return;
      }
    }
  }

  snapshot() {
    const s = super.snapshot();
    if (this.box) s.b = [this.box.x0, this.box.x1, this.box.z0, this.box.z1].map((v) => +v.toFixed(2));
    return s;
  }
}

// ------------------------------------------------------------------------------------------
export class Sweep extends Npc {
  constructor(room) {
    super(room, 'sweep', ...SPAWNS.sweep, 0.9);
    this.pushable = false;
    this.sodaPushable = false;
    this.state = 'closet';
    this.nextSweep = 35 + room.rng() * 20;
    this.sweepUntil = 0;
    this.vel = { x: 0, z: 0 };
  }

  update(dt) {
    const room = this.room, t = room.t;
    if (this.state === 'closet') {
      this.vel = { x: 0, z: 0 };
      if (t >= this.nextSweep) {
        this.state = 'sweeping';
        this.sweepUntil = t + 22;
        room.sfx('sweep', this, null);
        const g = this.randomHallGoal(25);
        this.setGoal(g.x, g.z, true);
      }
      return;
    }
    const speed = this.state === 'sweeping' ? 14 : 10;
    if (this.state === 'sweeping') {
      if (t >= this.sweepUntil) {
        this.state = 'return';
        this.setGoal(this.home.x, this.home.z, true);
      } else if (this.atGoal(1.5) || !this.goal) {
        const g = this.randomHallGoal(25);
        this.setGoal(g.x, g.z, true);
      }
    } else if (this.state === 'return') {
      if (dist(this, this.home) < 1.2 || (this.atGoal(1.2) && dist(this, this.home) < 4)) {
        this.state = 'closet';
        this.nextSweep = t + 60 + room.rng() * 40;
        return;
      }
      if (!this.path || !this.path.length) this.setGoal(this.home.x, this.home.z, true);
    }
    const ox = this.x, oz = this.z;
    this.followPath(speed * dt);
    this.vel = { x: (this.x - ox) / Math.max(dt, 1e-3), z: (this.z - oz) / Math.max(dt, 1e-3) };
    if (this.checkStuck(dt, true)) {
      if (this.state === 'return') this.setGoal(this.home.x, this.home.z, true);
      else this.goal = null;
    }
    // sweep everything in front of the broom along the travel direction
    const v = Math.hypot(this.vel.x, this.vel.z);
    if (v > 1) {
      const nx = this.vel.x / v, nz = this.vel.z / v;
      for (const p of room.players.values()) {
        if (!room.isActive(p) || p.detention) continue;
        if (dist(this, p) < 2.3) room.pushPlayer(p, nx * speed * 1.05, nz * speed * 1.05, 0.3);
      }
      for (const n of room.npcs) {
        if (n === this || !n.pushable || n.hidden) continue;
        if (dist(this, n) < 2.3) n.push = { vx: nx * speed, vz: nz * speed, until: t + 0.3 };
      }
    }
  }
}

// ------------------------------------------------------------------------------------------
// 1st Prize: slow awkward turning, then a strong forward charge that shoves whatever it hits.
export class Prize extends Npc {
  constructor(room) {
    super(room, 'prize', ...SPAWNS.prize, 1.0);
    this.state = 'wander';
    this.speed = 0;
    this.target = null;
    this.recoverUntil = 0;
    this.disabledUntil = 0;
    this.chargeUntil = 0;
    this.thinkAt = 0;
    this.yaw = Math.PI / 2;
  }

  turnToward(tx, tz, rate, dt) {
    const want = yawTo(tx - this.x, tz - this.z);
    const d = angDiff(this.yaw, want);
    const s = Math.max(-rate * dt, Math.min(rate * dt, d));
    this.yaw += s;
    return Math.abs(d - s);
  }

  update(dt) {
    const room = this.room, t = room.t;
    if (this.applyPush(dt)) return;
    if (this.state === 'disabled') {
      if (t >= this.disabledUntil) this.state = 'wander';
      return;
    }
    if (this.state === 'recover') {
      this.speed = 0;
      if (t >= this.recoverUntil) { this.state = 'wander'; this.goal = null; }
      return;
    }

    if ((this.state === 'wander') && t >= this.thinkAt) {
      this.thinkAt = t + 0.3;
      for (const p of room.players.values()) {
        if (!room.isActive(p) || p.detention) continue;
        if (!this.canSee(p, 36)) continue;
        this.state = 'turning';
        this.target = p.id;
        this.turnUntil = t + 6;
        if (t >= (p.cd.prize || 0)) { p.cd.prize = t + 14; room.sfx('prize', this, p.id); }
        break;
      }
    }

    if (this.state === 'wander') {
      if (this.atGoal(1.5) || !this.goal) {
        const g = this.randomHallGoal(15);
        this.setGoal(g.x, g.z, true);
      }
      // awkward: slowly rotate toward the next waypoint and only creep when roughly facing it
      if (this.path && this.path.length) {
        const wp = this.path[0];
        const off = this.turnToward(wp.x, wp.z, 1.4, dt);
        const keepYaw = this.yaw;
        if (off < 0.5) this.followPath(3 * dt);
        this.yaw = keepYaw;
      }
      if (this.checkStuck(dt, true)) this.goal = null;
      return;
    }

    const p = room.players.get(this.target);
    if (!p || !room.isActive(p)) { this.state = 'wander'; this.speed = 0; return; }

    if (this.state === 'turning') {
      const off = this.turnToward(p.x, p.z, 0.9, dt);
      if (off < 0.2) { this.state = 'charge'; this.chargeUntil = t + 7; this.speed = 0; }
      else if (t > this.turnUntil) this.state = 'wander';
      return;
    }

    if (this.state === 'charge') {
      this.turnToward(p.x, p.z, 0.45, dt);
      this.speed = Math.min(19, this.speed + 16 * dt);
      const f = fwd(this.yaw);
      const before = { x: this.x, z: this.z };
      // open doors in front
      const ahead = worldToCell(this.x + f.x * 2, this.z + f.z * 2);
      const d = this.map.doorAt[this.map.idx(ahead.cx, ahead.cz)];
      if (d >= 0) room.openDoor(d, null, this);
      this.moveBy(f.x * this.speed * dt, f.z * this.speed * dt);
      const moved = Math.hypot(this.x - before.x, this.z - before.z);
      for (const pl of room.players.values()) {
        if (!room.isActive(pl) || pl.detention) continue;
        const dx = pl.x - this.x, dz = pl.z - this.z;
        const along = dx * f.x + dz * f.z;
        if (Math.hypot(dx, dz) < 2.4 && along > -0.3) room.pushPlayer(pl, f.x * Math.max(this.speed, 8), f.z * Math.max(this.speed, 8), 0.3);
      }
      if ((this.speed > 4 && moved < this.speed * dt * 0.3) || t > this.chargeUntil) {
        this.state = 'recover';
        this.recoverUntil = t + 2.5;
        this.speed = 0;
      }
    }
  }

  disable(seconds) {
    this.state = 'disabled';
    this.disabledUntil = this.room.t + seconds;
    this.speed = 0;
  }

  snapshot() {
    const s = super.snapshot();
    if (this.state === 'disabled') s.v = 'off';
    return s;
  }
}

// ------------------------------------------------------------------------------------------
// Arts and Crafters: a shy, rare sighting early; after 7 exercises, stare at him and he charges.
export class Arts extends Npc {
  constructor(room) {
    super(room, 'arts', ...SPAWNS.arts, 0.8);
    this.pushable = false;
    this.sodaPushable = false;
    this.state = 'hidden';
    this.hidden = true;
    this.nextPeek = 40 + room.rng() * 30;
    this.peekUntil = 0;
    this.stare = new Map();
    this.target = null;
    this.cooldownUntil = 0;
  }

  spotAwayFrom(players, minD, maxD) {
    const room = this.room;
    const cells = room.rng() < 0.4 ? this.map.roomCells : this.map.hallCells;
    for (let i = 0; i < 60; i++) {
      const [cx, cz] = cells[Math.floor(room.rng() * cells.length)];
      const p = cellCenter(cx, cz);
      let ok = true, nearest = 1e9;
      for (const pl of players) nearest = Math.min(nearest, Math.hypot(pl.x - p.x, pl.z - p.z));
      if (nearest < minD || nearest > maxD) ok = false;
      if (ok) return p;
    }
    return null;
  }

  update(dt) {
    const room = this.room, t = room.t;
    const all = [...room.players.values()].filter((p) => room.isActive(p));
    const hunters = all.filter((p) => p.exercisesDone.size >= 7);
    const active = hunters.length > 0;

    if (this.state === 'hidden') {
      this.hidden = true;
      if (t < this.cooldownUntil || t < this.nextPeek || !all.length) return;
      const spot = this.spotAwayFrom(active ? hunters : all, active ? 18 : 28, active ? 55 : 70);
      if (!spot) { this.nextPeek = t + 5; return; }
      this.x = spot.x; this.z = spot.z;
      this.hidden = false;
      this.state = active ? 'lurk' : 'peek';
      this.peekUntil = t + (active ? 40 : 10);
      this.stare.clear();
      return;
    }

    if (this.state === 'peek') {
      // shy: vanishes if approached
      for (const p of all) if (dist(this, p) < 14) this.peekUntil = 0;
      if (active) { this.state = 'lurk'; this.peekUntil = t + 40; }
      if (t >= this.peekUntil) { this.state = 'hidden'; this.hidden = true; this.nextPeek = t + 50 + room.rng() * 40; }
      return;
    }

    if (this.state === 'lurk') {
      if (!active) { this.state = 'peek'; return; }
      for (const p of hunters) {
        if (p.detention || p.jump) continue;
        const dx = this.x - p.x, dz = this.z - p.z;
        const d = Math.hypot(dx, dz);
        const f = fwd(p.yaw);
        const cos = (dx * f.x + dz * f.z) / (d || 1);
        const looking = d < 45 && cos > 0.96 && lineOfSight(this.map, p.x, p.z, this.x, this.z, room.doors);
        const s = (this.stare.get(p.id) || 0) + (looking ? dt : -dt * 0.5);
        this.stare.set(p.id, Math.max(0, s));
        if (s > 1.1) {
          this.state = 'charge';
          this.target = p.id;
          this.chargeUntil = t + 7;
          room.sfx('arts', this, null);
          room.toast(p, 'You stared too long...');
          return;
        }
      }
      if (t >= this.peekUntil) { this.state = 'hidden'; this.hidden = true; this.nextPeek = t + 8; }
      return;
    }

    if (this.state === 'charge') {
      const p = room.players.get(this.target);
      if (!p || !room.isActive(p) || t > this.chargeUntil) { this.goAway(); return; }
      this.setGoal(p.x, p.z);
      this.followPath(27 * dt);
      if (dist(this, p) < 2.2) {
        room.artsTeleport(p);
        this.goAway();
      }
    }
  }

  goAway() {
    this.state = 'hidden';
    this.hidden = true;
    this.target = null;
    this.cooldownUntil = this.room.t + 25;
    this.nextPeek = this.room.t + 25;
    this.path = null;
  }
}

