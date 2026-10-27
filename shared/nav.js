// Grid A* pathfinding and line-of-sight on the school map.
import { CELL } from './constants.js';
import { T_FLOOR, worldToCell, cellCenter } from './map.js';

class MinHeap {
  constructor() { this.a = []; }
  push(n, f) {
    const a = this.a; a.push([f, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

// passable(idx) -> bool. Returns a list of [cx, cz] cells (start excluded) or null.
export function findPath(map, sx, sz, gx, gz, passable, maxNodes = 9000) {
  const W = map.W;
  const start = sz * W + sx, goal = gz * W + gx;
  if (start === goal) return [];
  if (!passable(goal)) {
    // snap the goal to the nearest passable neighbour
    let best = -1, bd = 1e9;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = gx + dx, z = gz + dz;
        if (!map.inBounds(x, z)) continue;
        const i = z * W + x;
        if (passable(i) && dx * dx + dz * dz < bd) { bd = dx * dx + dz * dz; best = i; }
      }
    if (best < 0) return null;
    gx = best % W; gz = (best / W) | 0;
    return findPath(map, sx, sz, gx, gz, passable, maxNodes);
  }
  const g = new Map([[start, 0]]);
  const came = new Map();
  const open = new MinHeap();
  const h = (i) => { const x = i % W, z = (i / W) | 0; const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  open.push(start, h(start));
  const closed = new Set();
  let n = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (++n > maxNodes) return null;
    const cx = cur % W, cz = (cur / W) | 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx, z = cz + dz;
        if (!map.inBounds(x, z)) continue;
        const ni = z * W + x;
        if (!passable(ni)) continue;
        // no corner cutting
        if (dx && dz && (!passable(cz * W + x) || !passable(z * W + cx))) continue;
        const ng = g.get(cur) + (dx && dz ? 1.414 : 1);
        if (ng < (g.get(ni) ?? Infinity)) {
          g.set(ni, ng); came.set(ni, cur);
          open.push(ni, ng + h(ni));
        }
      }
  }
  if (!came.has(goal)) return null;
  const out = [];
  for (let c = goal; c !== start; c = came.get(c)) out.push([c % W, (c / W) | 0]);
  return out.reverse();
}

// Sight test between world points; blocks on walls, closed doors (unless see-through) and exits.
// Windows are see-through.
export function lineOfSight(map, ax, az, bx, bz, doorState) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.ceil(dist / (CELL * 0.25));
  for (let i = 1; i < steps; i++) {
    const x = ax + (dx * i) / steps, z = az + (dz * i) / steps;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const t = map.tile(cx, cz);
    if (t === 2) continue; // window
    if (t !== T_FLOOR) return false;
    const d = map.doorAt[map.idx(cx, cz)];
    if (d >= 0 && doorState && !doorState[d].open) return false;
  }
  return true;
}

// Can a circle of radius r travel in a straight line between two points along walkable nav cells?
export function straightWalkable(map, ax, az, bx, bz, passable) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.ceil(dist / (CELL * 0.3));
  const px = (-dz / (dist || 1)) * 0.8, pz = (dx / (dist || 1)) * 0.8;
  for (let i = 1; i <= steps; i++) {
    const x = ax + (dx * i) / steps, z = az + (dz * i) / steps;
    for (const s of [-1, 0, 1]) {
      const c = worldToCell(x + px * s, z + pz * s);
      if (!map.inBounds(c.cx, c.cz) || !passable(c.cz * map.W + c.cx)) return false;
    }
  }
  return true;
}

export function randomCell(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export { cellCenter, worldToCell };
