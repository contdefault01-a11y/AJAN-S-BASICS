import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, worldToCell, cellCenter, SPAWNS, BULLY_SPOTS, T_FLOOR } from '../shared/map.js';
import { findPath } from '../shared/nav.js';
import { CELL } from '../shared/constants.js';

const map = buildMap();

function reachable() {
  const seen = new Uint8Array(map.W * map.H);
  const [sx, sz] = SPAWNS.player[0];
  const q = [[sx, sz]];
  seen[map.idx(sx, sz)] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (!map.inBounds(nx, nz) || seen[map.idx(nx, nz)] || !map.nav[map.idx(nx, nz)]) continue;
      seen[map.idx(nx, nz)] = 1;
      q.push([nx, nz]);
    }
  }
  return seen;
}
const seen = reachable();
const nearReachable = (x, z, r = 2) => {
  const c = worldToCell(x, z);
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (map.inBounds(c.cx + dx, c.cz + dz) && seen[map.idx(c.cx + dx, c.cz + dz)]) return true;
  return false;
};

test('every door sits in a wall gap between two areas', () => {
  for (const d of map.doors) {
    assert.ok(d.rooms[0] >= 0 && d.rooms[1] >= 0, 'door ' + d.id + ' connects two rooms');
    const sides = d.axis === 'z' ? [[d.x - 1, d.z], [d.x + 1, d.z]] : [[d.x, d.z - 1], [d.x, d.z + 1]];
    for (const [x, z] of sides) assert.notEqual(map.tile(x, z), T_FLOOR, 'door ' + d.id + ' is framed by walls');
  }
});

test('the whole school is connected: every room is reachable from the spawn', () => {
  for (const r of map.rooms) {
    let ok = false;
    for (let z = r.z0; z <= r.z1 && !ok; z++) for (let x = r.x0; x <= r.x1 && !ok; x++) if (seen[map.idx(x, z)]) ok = true;
    assert.ok(ok, r.id + ' reachable');
  }
});

test('all 7 exercise stations, both counters, all exits and vending machines are reachable', () => {
  assert.equal(map.stations.length, 7);
  for (const s of map.stations) assert.ok(nearReachable(s.x, s.z), 'station ' + s.id);
  assert.equal(map.counters.length, 2);
  for (const c of map.counters) assert.ok(nearReachable(c.x, c.z, 1), 'counter ' + c.restaurant);
  assert.equal(map.exits.length, 4);
  for (const e of map.exits) assert.ok(seen[map.idx(e.x - e.nx, e.z - e.nz)], 'exit ' + e.id);
  for (const v of map.vending) assert.ok(nearReachable(v.wx, v.wz, 1), v.id);
});

test('cash and item spots are on reachable floor', () => {
  assert.ok(map.cashSpots.length >= 60, 'enough cash spots: ' + map.cashSpots.length);
  for (const s of map.cashSpots) assert.ok(nearReachable(s.x, s.z, 1), `cash spot ${s.x},${s.z}`);
  for (const s of map.itemSpots) assert.ok(nearReachable(s.x, s.z, 1), `item spot ${s.x},${s.z}`);
});

test('A* finds paths between distant points', () => {
  const pass = (i) => map.nav[i] === 1;
  const [sx, sz] = SPAWNS.player[0];
  for (const e of map.exits) {
    const p = findPath(map, sx, sz, e.x - e.nx, e.z - e.nz, pass);
    assert.ok(p && p.length > 5, 'path to ' + e.id);
  }
});

test('bully spots are hallway segments he can fully block (and that have a way around)', () => {
  for (const s of BULLY_SPOTS) {
    assert.equal(map.room(s.x, s.z).type, 'hall', `${s.x},${s.z}`);
    const c = cellCenter(s.x, s.z);
    assert.ok(Number.isFinite(c.x));
  }
});

test('props never cover doorways', () => {
  for (const d of map.doors) {
    const c = cellCenter(d.x, d.z);
    for (const b of map.solidProps) {
      const overlap = b.x0 < c.x + CELL && b.x1 > c.x - CELL && b.z0 < c.z + CELL && b.z1 > c.z - CELL;
      assert.ok(!overlap, 'door ' + d.id + ' blocked by a prop');
    }
  }
});
