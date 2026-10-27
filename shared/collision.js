// Circle-vs-thin-wall / circle-vs-box collision shared by client movement and server NPCs.
// Walls live on cell edges; each solid edge is treated as a thin box of thickness WALL_T.
import { CELL } from './constants.js';
import { E_OPEN, E_WALL, E_WINDOW, E_DOOR, E_EXIT, WALL_T } from './map.js';

// Returns edgeSolid(edge) deciding whether a wall edge currently blocks movement.
// doorState: [{open, locked}] ; opts.ignoreDoors: NPCs walk through closed (unlocked) doors;
// opts.detainedDoor: door id that is always solid (detention).
export function makeSolidTest(map, doorState, opts = {}) {
  const { ignoreDoors = false, detainedDoor = -1 } = opts;
  return (e) => {
    if (e.t === E_OPEN) return false;
    if (e.t === E_WALL || e.t === E_WINDOW || e.t === E_EXIT) return true;
    if (e.t === E_DOOR) {
      if (e.d === detainedDoor) return true;
      const ds = doorState ? doorState[e.d] : null;
      if (ds && ds.locked) return true;
      if (!ignoreDoors && ds && !ds.open) return true;
      return false;
    }
    return true;
  };
}

// Can something move from cell a to the 4-neighbour cell b?
export function canCross(map, ax, az, bx, bz, isSolid) {
  if (!map.isFloor(bx, bz)) return false;
  const e = map.between(ax, az, bx, bz);
  if (e.t === E_OPEN) return true;
  if (e.t === E_DOOR) return !isSolid({ t: E_DOOR, d: e.d });
  return false;
}

function pushOutOfBox(pos, r, x0, x1, z0, z1) {
  const nx = Math.max(x0, Math.min(pos.x, x1));
  const nz = Math.max(z0, Math.min(pos.z, z1));
  const dx = pos.x - nx, dz = pos.z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    pos.x = nx + (dx / d) * r;
    pos.z = nz + (dz / d) * r;
  } else {
    const pl = pos.x - x0, pr = x1 - pos.x, pt = pos.z - z0, pb = z1 - pos.z;
    const m = Math.min(pl, pr, pt, pb);
    if (m === pl) pos.x = x0 - r;
    else if (m === pr) pos.x = x1 + r;
    else if (m === pt) pos.z = z0 - r;
    else pos.z = z1 + r;
  }
  return true;
}

const H = WALL_T / 2;
export function edgeBox(e) {
  return { x0: e.x0 - H, x1: e.x1 + H, z0: e.z0 - H, z1: e.z1 + H };
}

export function resolveCircle(map, pos, r, isSolid, extraBoxes, useProps = true) {
  let hit = false;
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    // moving bodies (Bully, 1st Prize) first; walls are resolved after them so walls always win,
    // and a push out of a body that would cross a wall is cancelled
    if (extraBoxes)
      for (const b of extraBoxes) {
        const bx = pos.x, bz = pos.z;
        if (!pushOutOfBox(pos, r, b.x0, b.x1, b.z0, b.z1)) continue;
        if (segmentBlocked(map, bx, bz, pos.x, pos.z, isSolid)) { pos.x = bx; pos.z = bz; } else any = true;
      }
    const cx0 = Math.floor((pos.x - r) / CELL) - 1, cx1 = Math.floor((pos.x + r) / CELL) + 1;
    const cz0 = Math.floor((pos.z - r) / CELL) - 1, cz1 = Math.floor((pos.z + r) / CELL) + 1;
    const seen = new Set();
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!map.inBounds(cx, cz)) continue;
        for (const id of map.cellEdges[map.idx(cx, cz)]) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = map.edges[id];
          if (!isSolid(e)) continue;
          if (pushOutOfBox(pos, r, e.x0 - H, e.x1 + H, e.z0 - H, e.z1 + H)) any = true;
        }
        if (useProps) {
          const list = map.propCells.get(map.idx(cx, cz));
          if (list)
            for (const i of list) {
              const b = map.solidProps[i];
              if (pushOutOfBox(pos, r, b.x0, b.x1, b.z0, b.z1)) any = true;
            }
        }
      }
    if (!any) break;
    hit = true;
  }
  return hit;
}

// Move a circle by (dx, dz) in sub-steps so fast movers never tunnel through thin walls.
export function moveCircle(map, pos, dx, dz, r, isSolid, extraBoxes, useProps = true) {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / Math.min(r * 0.5, 0.25)));
  let hit = false;
  for (let i = 0; i < steps; i++) {
    pos.x += dx / steps;
    pos.z += dz / steps;
    if (resolveCircle(map, pos, r, isSolid, extraBoxes, useProps)) hit = true;
  }
  return hit;
}

// Does the straight segment a->b cross any solid edge? (cell-walk along the segment)
export function segmentBlocked(map, ax, az, bx, bz, isSolid) {
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (CELL * 0.2)));
  let cx = Math.floor(ax / CELL), cz = Math.floor(az / CELL);
  for (let i = 1; i <= steps; i++) {
    const nx = Math.floor((ax + (dx * i) / steps) / CELL), nz = Math.floor((az + (dz * i) / steps) / CELL);
    if (nx === cx && nz === cz) continue;
    if (nx !== cx && nz !== cz) {
      // diagonal step: need one of the two L-shaped routes to be open
      const viaX = crossOk(map, cx, cz, nx, cz, isSolid) && crossOk(map, nx, cz, nx, nz, isSolid);
      const viaZ = crossOk(map, cx, cz, cx, nz, isSolid) && crossOk(map, cx, nz, nx, nz, isSolid);
      if (!viaX && !viaZ) return true;
    } else if (!crossOk(map, cx, cz, nx, nz, isSolid)) return true;
    cx = nx; cz = nz;
  }
  return false;
}

function crossOk(map, ax, az, bx, bz, isSolid) {
  if (!map.inBounds(bx, bz)) return false;
  const e = map.between(ax, az, bx, bz);
  return !isSolid({ t: e.t, d: e.d });
}

export { E_OPEN, E_WALL, E_WINDOW, E_DOOR, E_EXIT };
