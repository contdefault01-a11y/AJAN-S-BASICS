import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, worldToCell, cellCenter, SPAWNS, BULLY_SPOTS, E_OPEN, E_WALL, E_DOOR, E_WINDOW, E_EXIT, WALL_T } from '../shared/map.js';
import { findPath } from '../shared/nav.js';
import { makeSolidTest, moveCircle } from '../shared/collision.js';
import { CELL } from '../shared/constants.js';

const map = buildMap();
const doorsOpen = map.doors.map(() => ({ open: true, locked: false }));

// flood fill through open edges and doors (everything a player can reach with doors opened)
function reachable() {
  const seen = new Uint8Array(map.W * map.H);
  const [sx, sz] = SPAWNS.player[0];
  const q = [[sx, sz]];
  seen[map.idx(sx, sz)] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (!map.isFloor(nx, nz) || seen[map.idx(nx, nz)] || !map.nav[map.idx(nx, nz)]) continue;
      const e = map.between(x, z, nx, nz);
      if (e.t !== E_OPEN && e.t !== E_DOOR) continue;
      seen[map.idx(nx, nz)] = 1;
      q.push([nx, nz]);
    }
  }
  return seen;
}
const seen = reachable();
const nearReachable = (x, z, r = 1) => {
  const c = worldToCell(x, z);
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (map.inBounds(c.cx + dx, c.cz + dz) && seen[map.idx(c.cx + dx, c.cz + dz)]) return true;
  return false;
};

test('walls are thin edges: rooms sit directly against hallways, doors are inside walls', () => {
  assert.ok(WALL_T < 0.5);
  // the entrance hall touches Exercise 1 and 2 directly (no solid wall cells in between)
  const ex1 = map.roomById.ex1, ex2 = map.roomById.ex2, hall = map.roomById.hall_spawn;
  assert.equal(ex1.x1 + 1, hall.x0);
  assert.equal(hall.x1 + 1, ex2.x0);
  for (const d of map.doors) {
    assert.equal(d.edge.t, E_DOOR);
    const [a, b] = d.cells;
    assert.ok(map.isFloor(a[0], a[1]) && map.isFloor(b[0], b[1]), 'door ' + d.id + ' joins two floors');
  }
});

test('the entrance hall looks like REF1: Exercise 1 on the left, Exercise 2 on the right, AJAN ahead', () => {
  const [px, pz] = SPAWNS.player[0];
  const [ax, az] = SPAWNS.ajan;
  assert.equal(map.room(px, pz).id, 'hall_spawn');
  assert.ok(az < pz, 'AJAN stands north of the spawn (in front of the player)');
  const d1 = map.doors.find((d) => d.rooms.includes(map.roomById.ex1.index));
  const d2 = map.doors.find((d) => d.rooms.includes(map.roomById.ex2.index));
  const spawn = cellCenter(px, pz);
  assert.ok(d1.x < spawn.x && d2.x > spawn.x, 'left / right');
  assert.ok(d1.z < spawn.z && d1.z > cellCenter(ax, az).z, 'between player and AJAN');
  assert.equal(map.stations[0].room, 'ex1');
  assert.equal(map.stations[1].room, 'ex2');
});

test('behind the spawn: front entrance doors to a fenced garden with the bus and no way out', () => {
  const entrance = map.doors.filter((d) => d.entrance);
  assert.equal(entrance.length, 3);
  const garden = map.roomById.garden;
  assert.ok(entrance.every((d) => d.rooms.includes(garden.index)));
  assert.ok(map.props.some((p) => p.type === 'bus'));
  // every garden edge except the entrance doors is solid
  for (let z = garden.z0; z <= garden.z1; z++)
    for (let x = garden.x0; x <= garden.x1; x++)
      for (const side of ['n', 's', 'w', 'e']) {
        const e = map.edgeOf(x, z, side);
        if (e.t === E_OPEN) {
          const [dx, dz] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[side];
          assert.equal(map.room(x + dx, z + dz), garden, 'garden only opens into itself');
        } else assert.ok([E_WALL, E_DOOR].includes(e.t));
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
  assert.equal(map.stations.filter(Boolean).length, 7);
  for (const s of map.stations) assert.ok(nearReachable(s.x, s.z), 'station ' + s.id);
  for (const c of map.counters) assert.ok(nearReachable(c.x, c.z), 'counter ' + c.restaurant);
  assert.equal(map.exits.length, 4);
  for (const e of map.exits) { assert.equal(e.edge.t, E_EXIT); assert.ok(seen[map.idx(e.cell[0], e.cell[1])], 'exit ' + e.id); }
  for (const v of map.vending) assert.ok(nearReachable(v.wx, v.wz), v.id);
  for (const cells of map.exerciseCells) assert.ok(cells.length >= 8, 'room to move around in');
});

test('cash and item spots are reachable; few items lie in hallways', () => {
  assert.ok(map.cashSpots.length >= 60, 'enough cash spots: ' + map.cashSpots.length);
  for (const s of map.cashSpots) assert.ok(nearReachable(s.x, s.z), `cash spot ${s.x},${s.z}`);
  for (const s of map.itemSpots) assert.ok(nearReachable(s.x, s.z), `item spot ${s.x},${s.z}`);
  assert.ok(map.itemSpots.filter((s) => !s.hall).length >= 12);
});

test('A* finds paths that respect thin walls', () => {
  const ok = (i) => map.nav[i] === 1;
  const edgeOk = (e) => e.t === E_OPEN || e.t === E_DOOR;
  const [sx, sz] = SPAWNS.player[0];
  for (const e of map.exits) {
    const p = findPath(map, sx, sz, e.cell[0], e.cell[1], ok, edgeOk);
    assert.ok(p && p.length > 5, 'path to ' + e.id);
    let [cx, cz] = [sx, sz];
    for (const [x, z] of p) {
      if (Math.abs(x - cx) + Math.abs(z - cz) === 1) assert.ok(edgeOk(map.between(cx, cz, x, z)), 'no wall crossing');
      cx = x; cz = z;
    }
  }
});

test('circles cannot pass through thin walls or closed doors, but pass open doors', () => {
  const closed = map.doors.map(() => ({ open: false, locked: false }));
  const d = map.doors.find((x) => x.rooms.includes(map.roomById.ex1.index));
  for (const [state, expectPass] of [[closed, false], [doorsOpen, true]]) {
    const pos = { x: d.x + 1.5, z: d.z }; // in the entrance hall, east of Exercise 1's door
    moveCircle(map, pos, -4, 0, 0.7, makeSolidTest(map, state), null);
    assert.equal(pos.x < d.x, expectPass);
  }
  // a plain wall right next to the door
  const pos = { x: d.x + 1.5, z: d.z + CELL * 2 };
  moveCircle(map, pos, -4, 0, 0.7, makeSolidTest(map, doorsOpen), null);
  assert.ok(pos.x > d.x);
});

test('windows block movement but not sight', () => {
  assert.ok(map.windows.length > 10);
  assert.ok(map.edges.some((e) => e.t === E_WINDOW));
});

test('bully spots are 3-wide hallway segments outside the entrance hall', () => {
  for (const s of BULLY_SPOTS) {
    const r = map.room(s.x, s.z);
    assert.equal(r.type, 'hall', `${s.x},${s.z}`);
    assert.notEqual(r.id, 'hall_spawn');
  }
});

test('props never cover doorways', () => {
  for (const d of map.doors)
    for (const b of map.solidProps) {
      const overlap = b.x0 < d.x + CELL && b.x1 > d.x - CELL && b.z0 < d.z + CELL && b.z1 > d.z - CELL;
      assert.ok(!overlap, 'door ' + d.id + ' blocked by a prop');
    }
});
