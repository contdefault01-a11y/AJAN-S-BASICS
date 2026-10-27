// Circle-vs-grid / circle-vs-box collision shared by client player movement and server NPCs.
import { CELL } from './constants.js';
import { T_FLOOR } from './map.js';

// isBlockedCell(cx, cz) decides whether a grid cell is solid (walls, windows, exits, closed doors).
// extraBoxes: optional array of {x0,x1,z0,z1} (e.g. Bully blocker) checked in addition to props.
export function makeSolidTest(map, doorState, opts = {}) {
  const { ignoreDoors = false, detainedDoor = -1 } = opts;
  return (cx, cz) => {
    if (!map.inBounds(cx, cz)) return true;
    const t = map.tiles[map.idx(cx, cz)];
    if (t !== T_FLOOR) return true;
    const d = map.doorAt[map.idx(cx, cz)];
    if (d >= 0) {
      if (d === detainedDoor) return true;
      const ds = doorState ? doorState[d] : null;
      if (ds && ds.locked) return true;
      if (!ignoreDoors && ds && !ds.open) return true;
    }
    return false;
  };
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
    // centre inside the box: push out along the smallest penetration axis
    const pl = pos.x - x0, pr = x1 - pos.x, pt = pos.z - z0, pb = z1 - pos.z;
    const m = Math.min(pl, pr, pt, pb);
    if (m === pl) pos.x = x0 - r;
    else if (m === pr) pos.x = x1 + r;
    else if (m === pt) pos.z = z0 - r;
    else pos.z = z1 + r;
  }
  return true;
}

export function resolveCircle(map, pos, r, isSolid, extraBoxes, useProps = true) {
  let hit = false;
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    const cx0 = Math.floor((pos.x - r) / CELL), cx1 = Math.floor((pos.x + r) / CELL);
    const cz0 = Math.floor((pos.z - r) / CELL), cz1 = Math.floor((pos.z + r) / CELL);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (isSolid(cx, cz)) {
          if (pushOutOfBox(pos, r, cx * CELL, (cx + 1) * CELL, cz * CELL, (cz + 1) * CELL)) any = true;
        } else if (useProps) {
          const list = map.propCells.get(map.idx(cx, cz));
          if (list)
            for (const i of list) {
              const b = map.solidProps[i];
              if (pushOutOfBox(pos, r, b.x0, b.x1, b.z0, b.z1)) any = true;
            }
        }
      }
    if (extraBoxes)
      for (const b of extraBoxes) if (pushOutOfBox(pos, r, b.x0, b.x1, b.z0, b.z1)) any = true;
    if (!any) break;
    hit = true;
  }
  return hit;
}

// Move a circle by (dx, dz) in sub-steps so fast movers (Gotta Sweep, pushes) never tunnel.
export function moveCircle(map, pos, dx, dz, r, isSolid, extraBoxes, useProps = true) {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
  let hit = false;
  for (let i = 0; i < steps; i++) {
    pos.x += dx / steps;
    pos.z += dz / steps;
    if (resolveCircle(map, pos, r, isSolid, extraBoxes, useProps)) hit = true;
  }
  return hit;
}

// True when a circle at (x, z) overlaps no solid geometry.
export function circleFree(map, x, z, r, isSolid, useProps = true) {
  const p = { x, z };
  return !resolveCircle(map, p, r, isSolid, null, useProps) || Math.hypot(p.x - x, p.z - z) < 1e-4;
}
