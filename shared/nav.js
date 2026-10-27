// Grid A* pathfinding (with thin walls on cell edges) and line of sight.
import { CELL } from './constants.js';
import { E_OPEN, E_WINDOW, E_DOOR, worldToCell, cellCenter } from './map.js';

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

// edgeOk(edge) -> may an NPC pass this edge (open, or an unlocked door)
export function defaultEdgeOk(doorState) {
  return (e) => e.t === E_OPEN || (e.t === E_DOOR && !(doorState && doorState[e.d] && doorState[e.d].locked));
}

// cellOk(idx) -> walkable cell. Returns list of [cx, cz] (start excluded) or null.
export function findPath(map, sx, sz, gx, gz, cellOk, edgeOk, maxNodes = 9000) {
  const W = map.W;
  const start = sz * W + sx;
  if (!map.inBounds(gx, gz) || !cellOk(gz * W + gx)) {
    // snap to the nearest walkable cell of the same room (never across a thin wall)
    const goalRoom = map.inBounds(gx, gz) ? map.roomOf[gz * W + gx] : -1;
    let best = -1, bd = 1e9;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = gx + dx, z = gz + dz;
        if (!map.inBounds(x, z)) continue;
        const i = z * W + x;
        if (goalRoom >= 0 && map.roomOf[i] !== goalRoom) continue;
        if (cellOk(i) && dx * dx + dz * dz < bd) { bd = dx * dx + dz * dz; best = i; }
      }
    if (best < 0) return null;
    gx = best % W; gz = (best / W) | 0;
  }
  const goal = gz * W + gx;
  if (start === goal) return [];
  const step = (ax, az, bx, bz) => cellOk(bz * W + bx) && edgeOk(map.between(ax, az, bx, bz));
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
        if (dx && dz) {
          // diagonal only through an open corner: both L-routes must be walkable
          if (!(step(cx, cz, x, cz) && step(x, cz, x, z) && step(cx, cz, cx, z) && step(cx, z, x, z))) continue;
        } else if (!step(cx, cz, x, z)) continue;
        const ni = z * W + x;
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

// Sight between world points. Walls, closed doors and exits block; windows do not.
export function lineOfSight(map, ax, az, bx, bz, doorState) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (CELL * 0.2)));
  let cx = Math.floor(ax / CELL), cz = Math.floor(az / CELL);
  const pass = (x0, z0, x1, z1) => {
    if (!map.inBounds(x1, z1)) return false;
    const e = map.between(x0, z0, x1, z1);
    if (e.t === E_OPEN || e.t === E_WINDOW) return true;
    if (e.t === E_DOOR) return !!(doorState && doorState[e.d] && doorState[e.d].open);
    return false;
  };
  for (let i = 1; i <= steps; i++) {
    const nx = Math.floor((ax + (dx * i) / steps) / CELL), nz = Math.floor((az + (dz * i) / steps) / CELL);
    if (nx === cx && nz === cz) continue;
    if (nx !== cx && nz !== cz) {
      if (!((pass(cx, cz, nx, cz) && pass(nx, cz, nx, nz)) || (pass(cx, cz, cx, nz) && pass(cx, nz, nx, nz)))) return false;
    } else if (!pass(cx, cz, nx, nz)) return false;
    cx = nx; cz = nz;
  }
  return true;
}

// Can a circle walk straight from a to b along walkable cells without crossing blocked edges?
export function straightWalkable(map, ax, az, bx, bz, cellOk, edgeOk) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz) || 1;
  const px = (-dz / dist) * 0.85, pz = (dx / dist) * 0.85;
  for (const s of [-1, 0, 1]) {
    const x0 = ax + px * s, z0 = az + pz * s, x1 = bx + px * s, z1 = bz + pz * s;
    const steps = Math.ceil(dist / (CELL * 0.2));
    let c = worldToCell(x0, z0);
    if (!map.inBounds(c.cx, c.cz) || !cellOk(c.cz * map.W + c.cx)) return false;
    for (let i = 1; i <= steps; i++) {
      const n = worldToCell(x0 + ((x1 - x0) * i) / steps, z0 + ((z1 - z0) * i) / steps);
      if (n.cx === c.cx && n.cz === c.cz) continue;
      if (!map.inBounds(n.cx, n.cz) || !cellOk(n.cz * map.W + n.cx)) return false;
      if (n.cx !== c.cx && n.cz !== c.cz) {
        const okA = map.inBounds(n.cx, c.cz) && cellOk(c.cz * map.W + n.cx) && edgeOk(map.between(c.cx, c.cz, n.cx, c.cz)) && edgeOk(map.between(n.cx, c.cz, n.cx, n.cz));
        const okB = map.inBounds(c.cx, n.cz) && cellOk(n.cz * map.W + c.cx) && edgeOk(map.between(c.cx, c.cz, c.cx, n.cz)) && edgeOk(map.between(c.cx, n.cz, n.cx, n.cz));
        if (!okA || !okB) return false;
      } else if (!edgeOk(map.between(c.cx, c.cz, n.cx, n.cz))) return false;
      c = n;
    }
  }
  return true;
}

export { cellCenter, worldToCell };
