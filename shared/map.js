// The schoolhouse. Built from explicit room / hallway rectangles so the layout is fixed and
// learnable. Walls are THIN: they live on the edges between grid cells (Classic style), and
// doors sit directly inside those thin walls.
//
// You start in the entrance hall (behind you: the front doors to a small fenced garden with the
// school bus). Looking north at AJAN the hall is a straight corridor with a door on the left
// (Exercise 1) and on the right (Exercise 2), then it joins the main hall. The cafeteria is in
// the north-west corner with the KFC / Popeyes food court north of it.
//
// Grid coordinates: cx to the east, cz to the south. One cell = CELL world units.

import { CELL } from './constants.js';
import { makeRng } from './rng.js';

export const MAP_W = 96;
export const MAP_H = 81;
export const WALL_T = 0.2;

// edge types
export const E_OPEN = 0;
export const E_WALL = 1;
export const E_WINDOW = 2;
export const E_DOOR = 3;
export const E_EXIT = 4;

const ROOM_DEFS = [
  // id, type, name, x0, z0, x1, z1
  ['kfc', 'kfc', 'KFC', 3, 3, 20, 11],
  ['popeyes', 'popeyes', 'Popeyes', 21, 3, 40, 11],
  ['plaza', 'plaza', 'Food Court', 3, 12, 40, 17],
  ['cafeteria', 'cafe', 'Cafeteria', 3, 18, 30, 34],

  ['hall_n', 'hall', 'North Hall', 31, 18, 92, 20],
  ['hall_cafe', 'hall', 'Cafeteria Hall', 31, 21, 33, 48],
  ['hall_cv', 'hall', 'Main Hall', 47, 21, 49, 48],
  ['hall_e', 'hall', 'East Hall', 90, 21, 92, 71],
  ['hall_w', 'hall', 'West Hall', 3, 35, 5, 71],
  ['hall_mid', 'hall', 'Main Hall', 3, 49, 92, 51],
  ['hall_ne', 'hall', 'Science Wing', 50, 33, 89, 35],
  ['hall_sw', 'hall', 'Arts Wing', 6, 69, 36, 71],
  ['hall_se', 'hall', 'Gym Wing', 60, 69, 89, 71],
  ['hall_spawn', 'hall', 'Entrance Hall', 47, 52, 49, 71],

  ['janitor', 'janitor', "Janitor's Closet", 34, 21, 38, 26],
  ['storage', 'storage', 'Storage', 39, 21, 46, 26],
  ['class_nw', 'class', 'Room 102', 34, 27, 46, 36],
  ['office', 'office', "Principal's Office", 34, 37, 46, 48],

  ['ex1', 'exercise', 'Exercise Room 1', 37, 60, 46, 71],
  ['ex2', 'exercise', 'Exercise Room 2', 50, 60, 59, 71],
  ['ex3', 'exercise', 'Exercise Room 3', 6, 35, 17, 48],
  ['ex4', 'exercise', 'Exercise Room 4', 18, 35, 30, 48],
  ['ex5', 'exercise', 'Exercise Room 5', 50, 21, 62, 32],
  ['faculty', 'faculty', 'Faculty Only', 63, 21, 76, 32],
  ['class_ne', 'class', 'Room 108', 77, 21, 89, 32],
  ['ex6', 'exercise', 'Exercise Room 6', 50, 36, 69, 48],
  ['class_ne2', 'class', 'Room 110', 70, 36, 89, 48],
  ['ex7', 'exercise', 'Exercise Room 7', 6, 52, 20, 68],
  ['class_sw', 'class', 'Art Room', 21, 52, 36, 68],
  ['class_s1', 'class', 'Room 115', 37, 52, 46, 59],
  ['class_s2', 'class', 'Room 116', 50, 52, 59, 59],
  ['lab', 'class', 'Computer Lab', 60, 52, 74, 68],
  ['class_se', 'class', 'Room 124', 75, 52, 89, 68],

  ['garden', 'garden', 'Front Garden', 44, 72, 52, 79],
];

// [cx, cz, side] - the door is on that side of that cell
const DOOR_DEFS = [
  [11, 11, 's'], [30, 11, 's'],                 // KFC, Popeyes
  [16, 18, 'n'], [36, 17, 's'],                 // plaza <-> cafeteria, plaza <-> north hall
  [30, 25, 'e'], [30, 31, 'e'], [4, 34, 's'],   // cafeteria
  [36, 21, 'n'], [42, 21, 'n'], [34, 31, 'w'], [40, 48, 's'], // janitor, storage, room 102, office
  [46, 64, 'e'], [50, 64, 'w'],                 // ex1, ex2 (entrance hall)
  [6, 42, 'w'], [11, 48, 's'], [24, 48, 's'], [30, 42, 'e'], // ex3, ex4
  [56, 21, 'n'], [56, 32, 's'], [50, 27, 'w'],  // ex5
  [69, 32, 's'], [83, 21, 'n'], [89, 27, 'e'],  // faculty, room 108
  [59, 36, 'n'], [50, 42, 'w'], [79, 36, 'n'], [89, 42, 'e'], // ex6, room 110
  [6, 60, 'w'], [13, 52, 'n'], [13, 68, 's'],   // ex7
  [28, 52, 'n'], [28, 68, 's'], [41, 52, 'n'], [54, 52, 'n'], // art room, 115, 116
  [67, 52, 'n'], [67, 68, 's'], [82, 52, 'n'], [89, 60, 'e'], [82, 68, 's'], // lab, 124
  [47, 71, 's'], [48, 71, 's'], [49, 71, 's'],  // front entrance -> garden
];
export const ENTRANCE_DOORS = 3; // the last three doors are the front entrance

const WINDOW_RUNS = [
  // [x0, x1, z, 'n'|'s'] horizontal runs or [z0, z1, x, 'w'|'e'] vertical runs
  ['h', 5, 13, 18, 'n'], ['h', 19, 28, 18, 'n'],   // cafeteria -> food court
  ['h', 4, 9, 11, 's'], ['h', 13, 18, 11, 's'],    // KFC storefront
  ['h', 23, 28, 11, 's'], ['h', 32, 38, 11, 's'],  // Popeyes storefront
  ['v', 40, 45, 34, 'w'],                          // office window onto the cafeteria hall
];

const EXIT_DEFS = [
  { id: 'exit_ne', x: 91, z: 18, side: 'n' },
  { id: 'exit_se', x: 92, z: 70, side: 'e' },
  { id: 'exit_sw', x: 3, z: 70, side: 'w' },
  { id: 'exit_w', x: 3, z: 50, side: 'w' },
];

export const SPAWNS = {
  player: [[48, 70], [47, 70], [49, 70], [48, 69], [47, 69], [49, 69], [48, 68], [47, 68]],
  ajan: [48, 57],
  ajanChase: [16, 26],   // AJAN reappears in the cafeteria when the chase begins
  principal: [40, 43],
  playtime: [20, 70],
  sweep: [36, 24],
  prize: [80, 34],
  arts: [4, 40],
};

// Spots where the Bully can stand: 3-wide hallway segments (he blocks the full width).
export const BULLY_SPOTS = [
  { x: 32, z: 40 }, { x: 70, z: 19 }, { x: 4, z: 44 }, { x: 91, z: 45 },
  { x: 75, z: 70 }, { x: 25, z: 70 }, { x: 80, z: 34 }, { x: 48, z: 30 },
  { x: 20, z: 50 }, { x: 65, z: 50 },
];

export const VENDING = [
  { id: 'vend_soda', kind: 'soda', x: 31, z: 38, face: 'e' },
  { id: 'vend_bar', kind: 'bar', x: 92, z: 60, face: 'w' },
  { id: 'vend_soda2', kind: 'soda', x: 3, z: 64, face: 'e' },
];

const SIDE = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

export function cellCenter(cx, cz) {
  return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
}
export function worldToCell(x, z) {
  return { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL) };
}

export function buildMap() {
  const W = MAP_W, H = MAP_H;
  const floor = new Uint8Array(W * H);
  const roomOf = new Int16Array(W * H).fill(-1);
  const idx = (x, z) => z * W + x;
  const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
  const rooms = [];
  const roomById = {};

  for (const [id, type, name, x0, z0, x1, z1] of ROOM_DEFS) {
    const room = { id, type, name, x0, z0, x1, z1, index: rooms.length };
    rooms.push(room);
    roomById[id] = room;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { floor[idx(x, z)] = 1; roomOf[idx(x, z)] = room.index; }
  }
  const room = (x, z) => (inBounds(x, z) && roomOf[idx(x, z)] >= 0 ? rooms[roomOf[idx(x, z)]] : null);
  const group = (x, z) => { const r = room(x, z); return r ? (r.type === 'hall' ? 'hall' : r.id) : null; };

  // ---- edges: V = west side of cell (x,z) for x in 0..W ; Hz = north side of cell (x,z) for z in 0..H
  const V = new Uint8Array((W + 1) * H), Vd = new Int16Array((W + 1) * H).fill(-1);
  const Hz = new Uint8Array(W * (H + 1)), Hd = new Int16Array(W * (H + 1)).fill(-1);
  const vI = (x, z) => z * (W + 1) + x;
  const hI = (x, z) => z * W + x;
  for (let z = 0; z < H; z++)
    for (let x = 0; x <= W; x++) {
      const a = group(x - 1, z), b = group(x, z);
      if ((a || b) && a !== b) V[vI(x, z)] = E_WALL;
    }
  for (let z = 0; z <= H; z++)
    for (let x = 0; x < W; x++) {
      const a = group(x, z - 1), b = group(x, z);
      if ((a || b) && a !== b) Hz[hI(x, z)] = E_WALL;
    }
  // side of cell -> [array, data array, index]
  const slot = (cx, cz, side) => {
    if (side === 'w') return [V, Vd, vI(cx, cz)];
    if (side === 'e') return [V, Vd, vI(cx + 1, cz)];
    if (side === 'n') return [Hz, Hd, hI(cx, cz)];
    return [Hz, Hd, hI(cx, cz + 1)];
  };
  const edgeOf = (cx, cz, side) => { const [A, D, i] = slot(cx, cz, side); return { t: A[i], d: D[i] }; };

  const doors = DOOR_DEFS.map(([cx, cz, side], id) => {
    const [A, D, i] = slot(cx, cz, side);
    if (A[i] !== E_WALL) throw new Error(`door ${id} at ${cx},${cz},${side} is not on a wall`);
    A[i] = E_DOOR; D[i] = id;
    const [dx, dz] = SIDE[side];
    const c = cellCenter(cx, cz);
    const wx = c.x + dx * CELL / 2, wz = c.z + dz * CELL / 2;
    const a = roomOf[idx(cx, cz)], b = inBounds(cx + dx, cz + dz) ? roomOf[idx(cx + dx, cz + dz)] : -1;
    return { id, x: wx, z: wz, axis: dx ? 'x' : 'z', cells: [[cx, cz], [cx + dx, cz + dz]], rooms: [a, b], side, entrance: id >= DOOR_DEFS.length - ENTRANCE_DOORS };
  });

  const windows = [];
  for (const run of WINDOW_RUNS) {
    const [kind, a0, a1, fixed, side] = run;
    for (let a = a0; a <= a1; a++) {
      const cx = kind === 'h' ? a : fixed, cz = kind === 'h' ? fixed : a;
      const [A, , i] = slot(cx, cz, side);
      if (A[i] !== E_WALL) continue;
      A[i] = E_WINDOW;
      windows.push({ cx, cz, side });
    }
  }

  const exits = EXIT_DEFS.map((e, k) => {
    const [A, D, i] = slot(e.x, e.z, e.side);
    A[i] = E_EXIT; D[i] = k;
    const [dx, dz] = SIDE[e.side];
    const c = cellCenter(e.x, e.z);
    return { ...e, cell: [e.x, e.z], nx: dx, nz: dz, wx: c.x + dx * CELL / 2, wz: c.z + dz * CELL / 2 };
  });

  // flat list of non-open edges for rendering / collision
  const edges = [];
  const cellEdges = Array.from({ length: W * H }, () => []);
  const pushEdge = (o, x, z, t, d) => {
    const e = { id: edges.length, o, x, z, t, d };
    if (o === 'v') { e.x0 = x * CELL; e.x1 = x * CELL; e.z0 = z * CELL; e.z1 = (z + 1) * CELL; e.cellA = inBounds(x - 1, z) ? [x - 1, z] : null; e.cellB = inBounds(x, z) ? [x, z] : null; }
    else { e.x0 = x * CELL; e.x1 = (x + 1) * CELL; e.z0 = z * CELL; e.z1 = z * CELL; e.cellA = inBounds(x, z - 1) ? [x, z - 1] : null; e.cellB = inBounds(x, z) ? [x, z] : null; }
    edges.push(e);
    for (const c of [e.cellA, e.cellB]) if (c) cellEdges[idx(c[0], c[1])].push(e.id);
    return e;
  };
  for (let z = 0; z < H; z++) for (let x = 0; x <= W; x++) if (V[vI(x, z)]) pushEdge('v', x, z, V[vI(x, z)], Vd[vI(x, z)]);
  for (let z = 0; z <= H; z++) for (let x = 0; x < W; x++) if (Hz[hI(x, z)]) pushEdge('h', x, z, Hz[hI(x, z)], Hd[hI(x, z)]);
  for (const d of doors) d.edge = edges.find((e) => e.t === E_DOOR && e.d === d.id);
  for (const e of exits) e.edge = edges.find((x) => x.t === E_EXIT && x.d === exits.indexOf(e));

  const map = {
    W, H, floor, roomOf, rooms, roomById, doors, windows, exits, edges, cellEdges,
    idx, inBounds, room, edgeOf,
    isFloor: (x, z) => inBounds(x, z) && floor[idx(x, z)] === 1,
    // edge between two 4-neighbouring cells
    between(ax, az, bx, bz) {
      if (bx === ax + 1) return edgeOf(ax, az, 'e');
      if (bx === ax - 1) return edgeOf(ax, az, 'w');
      if (bz === az + 1) return edgeOf(ax, az, 's');
      return edgeOf(ax, az, 'n');
    },
  };

  // door clearance: no props in the two cells on each side of a doorway
  const reserved = new Uint8Array(W * H);
  for (const d of doors)
    for (const [cx, cz] of d.cells)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) if (inBounds(cx + dx, cz + dz)) reserved[idx(cx + dx, cz + dz)] = 1;
  map.reserved = reserved;

  buildProps(map);
  buildNav(map);
  return map;
}

// ---------------------------------------------------------------------------------------------
// Props, decorations, station / pickup spots. Deterministic (fixed seed).

function doorSides(map, r) {
  const sides = new Set();
  for (const d of map.doors)
    for (const [cx, cz] of d.cells) {
      if (map.room(cx, cz) !== r) continue;
      if (Math.abs(d.z - r.z0 * CELL) < 0.01) sides.add('n');
      if (Math.abs(d.z - (r.z1 + 1) * CELL) < 0.01) sides.add('s');
      if (Math.abs(d.x - r.x0 * CELL) < 0.01) sides.add('w');
      if (Math.abs(d.x - (r.x1 + 1) * CELL) < 0.01) sides.add('e');
    }
  return sides;
}

function buildProps(map) {
  const rng = makeRng(0xA7A9);
  const props = [];       // {type, x, z, w, d, h, solid, y?}
  const decals = [];      // wall decorations {type, key, x, z, y, nx, nz, w, h}
  const cashSpots = [];   // {x, z, y}
  const itemSpots = [];   // {x, z, hall?}
  const sprites = [];     // decorative flat sprites {key, x, z, y, s}
  const stations = [];
  const counters = [];
  const C = CELL, OFF = WALL_T / 2 + 0.03;

  const free = (cx, cz) => map.isFloor(cx, cz) && !map.reserved[map.idx(cx, cz)];
  const addProp = (p) => { props.push({ solid: true, y: 0, ...p }); return p; };
  const wallDecal = (r, side, along, y, w, h, type, key) => {
    let x, z, nx = 0, nz = 0;
    if (side === 'n') { x = (r.x0 + (r.x1 - r.x0 + 1) * along) * C; z = r.z0 * C + OFF; nz = 1; }
    if (side === 's') { x = (r.x0 + (r.x1 - r.x0 + 1) * along) * C; z = (r.z1 + 1) * C - OFF; nz = -1; }
    if (side === 'w') { z = (r.z0 + (r.z1 - r.z0 + 1) * along) * C; x = r.x0 * C + OFF; nx = 1; }
    if (side === 'e') { z = (r.z0 + (r.z1 - r.z0 + 1) * along) * C; x = (r.x1 + 1) * C - OFF; nx = -1; }
    decals.push({ type, key, x, z, y, nx, nz, w, h });
  };
  const deskClutter = (x, z, y) => {
    const k = rng();
    if (k < 0.35) sprites.push({ key: 'notebooks', x: x + (rng() - 0.5) * 0.6, z, y, s: 0.75 });
    else if (k < 0.6) sprites.push({ key: 'papers', x: x + (rng() - 0.5) * 0.6, z, y, s: 0.8 });
    else if (k < 0.8) sprites.push({ key: 'pencils', x: x + (rng() - 0.5) * 0.6, z, y, s: 0.6 });
  };

  const charPosters = ['AJAN', 'PRINCIPAL', 'PLAYTIME', 'BULLY', 'SWEEP', 'PRIZE', 'ARTS'];
  const rulePosters = ['rule_run', 'rule_faculty', 'rule_bully', 'rule_ajan', 'rule_train', 'rule_food'];
  map.exerciseCells = [];

  for (const r of map.rooms) {
    const sides = doorSides(map, r);
    const back = ['n', 's', 'w', 'e'].find((s) => !sides.has(s)) || 'n';
    const wx0 = r.x0 * C, wz0 = r.z0 * C, wx1 = (r.x1 + 1) * C, wz1 = (r.z1 + 1) * C;
    const cxm = (wx0 + wx1) / 2, czm = (wz0 + wz1) / 2;

    if (r.type === 'class' || r.type === 'exercise') {
      // REFCLASS look: chalkboard on the back wall, rows of chunky wooden desks with clutter
      wallDecal(r, back, 0.5, 3.8, 7.5, 3, 'chalkboard', r.type === 'exercise' ? 'board_ex' : 'board');
      const ex = r.type === 'exercise';
      const vertical = back === 'n' || back === 's';
      // rows run parallel to the board; exercise rooms keep their middle free for moving around
      const rowsAlong = vertical ? [r.z0 + 3, r.z1 - 1] : [r.x0 + 3, r.x1 - 1];
      // board on the far side: rows start next to it; flip when the board is on the near side
      const rows = [];
      if (back === 'n' || back === 'w') for (let a = rowsAlong[0]; a <= rowsAlong[1]; a += 3) rows.push(a);
      else for (let a = (vertical ? r.z1 : r.x1) - 3; a >= (vertical ? r.z0 : r.x0) + 1; a -= 3) rows.push(a);
      for (const a of ex ? rows.slice(-2) : rows) {
        const span0 = vertical ? r.x0 + 1 : r.z0 + 1, span1 = vertical ? r.x1 - 1 : r.z1 - 1;
        let s = span0;
        while (s <= span1) {
          // a block of up to 3 attached desks
          let len = 0;
          while (len < 3 && s + len <= span1 && free(vertical ? s + len : a, vertical ? a : s + len)) len++;
          if (!len) { s++; continue; }
          if (ex && rng() < 0.35) { s += len + 1; continue; }
          const p0 = cellCenter(vertical ? s : a, vertical ? a : s);
          const p1 = cellCenter(vertical ? s + len - 1 : a, vertical ? a : s + len - 1);
          const x = (p0.x + p1.x) / 2, z = (p0.z + p1.z) / 2;
          const along = len * C - 0.4;
          addProp({ type: 'woodesk', x, z, w: vertical ? along : 1.5, d: vertical ? 1.5 : along, h: 1.6 });
          for (let k = 0; k < len; k++) {
            const q = cellCenter(vertical ? s + k : a, vertical ? a : s + k);
            if (rng() < 0.7) deskClutter(q.x, q.z, 1.62);
            if (rng() < 0.25) cashSpots.push({ x: q.x, z: q.z, y: 1.65 });
          }
          s += len + 1;
        }
      }
      const posterSide = ['n', 's', 'w', 'e'].find((s) => s !== back && !sides.has(s)) || back;
      wallDecal(r, posterSide, 0.3, 3.8, 2.2, 2.6, 'poster', rng.pick(rng() < 0.5 ? charPosters : rulePosters));
      if (posterSide === back) wallDecal(r, back, 0.12, 3.8, 2.0, 2.6, 'poster', rng.pick(rulePosters));
      if (!ex && rng() < 0.5) sprites.push({ key: 'globe', x: cxm + (rng() - 0.5) * 6, z: czm, y: 1.62, s: 1.1, onDesk: true });
      itemSpots.push(cellCenter(r.x0 + 1, r.z1 - 1));

      if (ex) {
        const n = Number(r.id.slice(2)) - 1;
        let sx = cxm, sz = czm, face = 's';
        if (back === 'n') { sz = wz0 + 2.4; face = 's'; }
        if (back === 's') { sz = wz1 - 2.4; face = 'n'; }
        if (back === 'w') { sx = wx0 + 2.4; face = 'e'; }
        if (back === 'e') { sx = wx1 - 2.4; face = 'w'; }
        const horizontal = face === 'n' || face === 's';
        stations[n] = { id: n, room: r.id, x: sx, z: sz, face };
        addProp({ type: 'station', x: sx, z: sz, w: horizontal ? 2.6 : 1.4, d: horizontal ? 1.4 : 2.6, h: 2.6, stationId: n });
      }
    }

    if (r.type === 'cafe') {
      addProp({ type: 'counter', x: wx0 + 1.2, z: czm + 3, w: 2.2, d: 22, h: 1.7 });
      for (let i = 0; i < 6; i++) sprites.push({ key: 'food', x: wx0 + 1.2, z: czm - 6 + i * 3.6, y: 1.75, s: 1.1 });
      cashSpots.push({ x: wx0 + 1.2, z: czm - 4, y: 1.8 }, { x: wx0 + 1.2, z: czm + 10, y: 1.8 });
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const tx = wx0 + 14 + col * 19;
          const tz = wz0 + 9 + row * 12.5;
          addProp({ type: 'lunchtable', x: tx, z: tz, w: 12, d: 2.6, h: 1.55 });
          addProp({ type: 'bench', x: tx, z: tz - 2.4, w: 12, d: 0.9, h: 0.9, solid: false });
          addProp({ type: 'bench', x: tx, z: tz + 2.4, w: 12, d: 0.9, h: 0.9, solid: false });
          for (let k = 0; k < 3; k++) if (rng() < 0.8) sprites.push({ key: 'food', x: tx - 4 + k * 4 + rng() * 0.6, z: tz + (rng() - 0.5) * 1.0, y: 1.6, s: 1.1 });
          if (rng() < 0.4) cashSpots.push({ x: tx + (rng() - 0.5) * 8, z: tz, y: 1.65 });
        }
      for (const [bx, bz] of [[r.x1, r.z1], [r.x1, r.z0 + 6], [r.x0 + 3, r.z1]]) {
        if (!free(bx, bz)) continue;
        const p = cellCenter(bx, bz);
        addProp({ type: 'bin', x: p.x, z: p.z, w: 0.9, d: 0.9, h: 1.3 });
      }
      wallDecal(r, 'e', 0.12, 4.2, 3, 2.2, 'sign', 'sign_cafe');
      wallDecal(r, 's', 0.75, 3.6, 2.2, 2.6, 'poster', 'rule_food');
      wallDecal(r, 's', 0.45, 3.6, 2.2, 2.6, 'poster', 'AJAN');
      itemSpots.push({ x: cxm + 6, z: wz1 - 2 });
      map.cafeSpot = cellCenter(16, 26);
    }

    if (r.type === 'office') {
      // reference: white brick with a green band, blue carpet, wooden desks with globes
      addProp({ type: 'pdesk', x: cxm, z: wz0 + 6, w: 6, d: 2.2, h: 1.7 });
      addProp({ type: 'ochair', x: cxm, z: wz0 + 4, w: 1.2, d: 1.2, h: 2.0 });
      addProp({ type: 'pdesk', x: wx0 + 2.2, z: wz1 - 6, w: 2.6, d: 4.5, h: 1.6 });
      addProp({ type: 'pdesk', x: wx1 - 2.2, z: wz1 - 6, w: 2.6, d: 4.5, h: 1.6 });
      addProp({ type: 'cabinet', x: wx1 - 0.8, z: wz0 + 1.5, w: 1.4, d: 2.2, h: 3.0 });
      addProp({ type: 'chair', x: cxm - 1.6, z: wz0 + 8.6, w: 0.9, d: 0.9, h: 1.0, solid: false });
      addProp({ type: 'chair', x: cxm + 1.6, z: wz0 + 8.6, w: 0.9, d: 0.9, h: 1.0, solid: false });
      sprites.push({ key: 'globe', x: cxm + 1.8, z: wz0 + 6, y: 1.72, s: 1.5 }, { key: 'papers', x: cxm - 1.4, z: wz0 + 6, y: 1.72, s: 0.8 });
      sprites.push({ key: 'globe', x: wx0 + 2.2, z: wz1 - 6, y: 1.62, s: 1.3 }, { key: 'globe', x: wx1 - 2.2, z: wz1 - 6, y: 1.62, s: 1.3 });
      for (const [side, along, key] of [['n', 0.18, 'AJAN'], ['n', 0.42, 'PRINCIPAL'], ['n', 0.66, 'rule_run'], ['n', 0.88, 'rule_faculty'], ['e', 0.5, 'PLAYTIME'], ['e', 0.8, 'BULLY'], ['s', 0.15, 'ARTS'], ['s', 0.8, 'rule_bully']])
        wallDecal(r, side, along, 3.8, 2.0, 2.6, 'poster', key);
      wallDecal(r, 's', 0.42, 5.6, 3.2, 1.2, 'timer', 'timer');
      map.detentionSpot = { x: cxm, z: wz0 + 10 };
    }

    if (r.type === 'faculty') {
      addProp({ type: 'lunchtable', x: cxm, z: czm, w: 7, d: 3, h: 1.55 });
      addProp({ type: 'couch', x: cxm, z: wz0 + 1.2, w: 7, d: 1.8, h: 1.6 });
      addProp({ type: 'coffee', x: wx1 - 1, z: wz1 - 4, w: 1.4, d: 1.4, h: 2.4 });
      addProp({ type: 'cabinet', x: wx0 + 0.8, z: wz1 - 4, w: 1.4, d: 2.2, h: 3.0 });
      sprites.push({ key: 'papers', x: cxm + 1, z: czm, y: 1.6, s: 0.8 });
      cashSpots.push({ x: cxm + 2.5, z: czm, y: 1.65 });
      itemSpots.push({ x: wx0 + 2, z: wz0 + 4 });
      wallDecal(r, 'e', 0.4, 3.8, 2.2, 2.6, 'poster', 'rule_faculty');
    }

    if (r.type === 'janitor') {
      addProp({ type: 'shelf', x: wx0 + 0.7, z: czm + 1, w: 1.2, d: 6, h: 4.2 });
      addProp({ type: 'bucket', x: cxm + 1.5, z: wz1 - 1.0, w: 1.0, d: 1.0, h: 1.0 });
      sprites.push({ key: 'mop', x: wx1 - 0.8, z: wz1 - 0.8, y: 0, s: 2.2 }, { key: 'spray', x: wx0 + 0.7, z: czm, y: 2.1, s: 0.8 });
      wallDecal(r, 'e', 0.5, 3.8, 2.0, 2.6, 'poster', 'SWEEP');
    }

    if (r.type === 'storage') {
      addProp({ type: 'shelf', x: wx1 - 0.7, z: czm + 1, w: 1.2, d: 8, h: 4.2 });
      addProp({ type: 'box', x: wx0 + 1.2, z: wz1 - 1.2, w: 1.6, d: 1.6, h: 1.6 });
      itemSpots.push({ x: cxm - 1, z: wz0 + 3 });
      cashSpots.push({ x: wx0 + 1.2, z: wz1 - 1.2, y: 1.7 });
    }

    if (r.type === 'kfc' || r.type === 'popeyes') {
      const counterZ = wz0 + 7.5;
      addProp({ type: 'rcounter', x: cxm, z: counterZ, w: wx1 - wx0 - 4, d: 1.6, h: 1.8, restaurant: r.type });
      addProp({ type: 'kitchen', x: cxm, z: wz0 + 1.2, w: wx1 - wx0 - 6, d: 2.2, h: 2.2, restaurant: r.type });
      addProp({ type: 'register', x: cxm - 2.5, z: counterZ, w: 1.0, d: 0.8, h: 0.6, y: 1.8, solid: false, restaurant: r.type });
      addProp({ type: 'register', x: cxm + 2.5, z: counterZ, w: 1.0, d: 0.8, h: 0.6, y: 1.8, solid: false, restaurant: r.type });
      counters.push({ restaurant: r.type, x: cxm, z: counterZ + 1.8 });
      wallDecal(r, 'n', 0.5, 5.1, 12, 3.6, 'menuboard', r.type);
      for (let i = 0; i < 4; i++) sprites.push({ key: r.type === 'kfc' ? rng.pick(['bucket', 'box_kfc', 'cup_kfc']) : rng.pick(['box_pop', 'cup_pop']), x: cxm - 5 + i * 3.4, z: counterZ, y: 1.85, s: 0.9 });
      for (let i = 0; i < 3; i++) {
        const tx = wx0 + 6 + i * 5.5, tz = wz1 - 3.4;
        addProp({ type: 'rtable', x: tx, z: tz, w: 2.2, d: 2.2, h: 1.5, restaurant: r.type });
        sprites.push({ key: 'food', x: tx, z: tz, y: 1.55, s: 1.0 });
      }
      cashSpots.push({ x: wx0 + 6, z: wz1 - 3.4, y: 1.6 });
    }

    if (r.type === 'plaza') {
      decals.push({ type: 'sign', key: 'sign_kfc', x: 12 * C, z: 12 * C + OFF, y: 6.2, nx: 0, nz: 1, w: 8, h: 1.8 });
      decals.push({ type: 'sign', key: 'sign_pop', x: 31 * C, z: 12 * C + OFF, y: 6.2, nx: 0, nz: 1, w: 9, h: 1.8 });
      for (const tx of [6, 25, 38]) {
        const p = cellCenter(tx, 15);
        addProp({ type: 'rtable', x: p.x, z: p.z, w: 2.2, d: 2.2, h: 1.5, restaurant: 'plaza' });
      }
      cashSpots.push({ x: cellCenter(38, 15).x, z: cellCenter(38, 15).z, y: 1.6 });
    }

    if (r.type === 'garden') {
      // the bus, parked inside the fence - there is no way out
      addProp({ type: 'bus', x: cxm + 1.2, z: wz1 - 3.2, w: 13, d: 2.6, h: 5.4 });
      for (const [bx, bz] of [[r.x0, r.z0 + 1], [r.x1, r.z0 + 1], [r.x0, r.z0 + 3], [r.x1, r.z0 + 3]]) {
        const p = cellCenter(bx, bz);
        sprites.push({ key: 'bush', x: p.x, z: p.z, y: 0, s: 2.2 });
      }
      for (let i = 0; i < 8; i++) sprites.push({ key: 'flower', x: wx0 + 1 + rng() * (wx1 - wx0 - 2), z: wz0 + 1.5 + rng() * 5, y: 0, s: 0.6 });
      decals.push({ type: 'sign', key: 'sign_school', x: 48.5 * C, z: 72 * C + OFF, y: 6.3, nx: 0, nz: 1, w: 7.5, h: 1.2 });
    }

    if (r.type === 'hall') {
      const long = r.x1 - r.x0 > r.z1 - r.z0;
      const len = long ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let t = 5; t < len - 2; t += 9 + rng.int(0, 6)) {
        const side = long ? (rng() < 0.5 ? 'n' : 's') : (rng() < 0.5 ? 'w' : 'e');
        const cx = long ? r.x0 + t : side === 'w' ? r.x0 : r.x1;
        const cz = long ? (side === 'n' ? r.z0 : r.z1) : r.z0 + t;
        if (map.room(cx, cz) !== r) continue;
        const e = map.edgeOf(cx, cz, side);
        if (e.t !== E_WALL) continue;
        const [ox, oz] = SIDE[side];
        const p = cellCenter(cx, cz);
        decals.push({ type: 'poster', key: rng.pick(rng() < 0.45 ? charPosters : rulePosters), x: p.x + ox * (C / 2 - OFF), z: p.z + oz * (C / 2 - OFF), y: 3.6, nx: -ox, nz: -oz, w: 2.0, h: 2.6 });
      }
      if (r.id === 'hall_spawn') continue; // keep the entrance hall clean, REF1-style
      for (let t = 3; t < len - 1; t += 12 + rng.int(0, 8)) {
        const cx = long ? r.x0 + t : r.x0 + (rng() < 0.5 ? 0 : 2);
        const cz = long ? r.z0 + (rng() < 0.5 ? 0 : 2) : r.z0 + t;
        if (rng() < 0.25) itemSpots.push({ ...cellCenter(cx, cz), hall: true });
        else cashSpots.push({ ...cellCenter(cx, cz), y: 0.3 });
      }
    }
  }

  // flower pots in random hallway corners (two walls meeting, away from doors)
  const corners = [];
  for (const r of map.rooms) {
    if (r.type !== 'hall' || r.id === 'hall_spawn') continue;
    for (let z = r.z0; z <= r.z1; z++)
      for (let x = r.x0; x <= r.x1; x++) {
        if (!free(x, z) || map.room(x, z) !== r) continue;
        const wall = (side) => map.edgeOf(x, z, side).t === E_WALL;
        for (const [a, b2] of [['n', 'w'], ['n', 'e'], ['s', 'w'], ['s', 'e']])
          if (wall(a) && wall(b2)) corners.push({ x, z, sx: b2 === 'w' ? -1 : 1, sz: a === 'n' ? -1 : 1 });
      }
  }
  const potCells = new Set();
  for (const c of rng.shuffle(corners)) {
    if (potCells.size >= 14) break;
    const key = c.x + ',' + c.z;
    if (potCells.has(key)) continue;
    potCells.add(key);
    const p = cellCenter(c.x, c.z);
    const px = p.x + c.sx * 0.65, pz = p.z + c.sz * 0.65;
    sprites.push({ key: 'flowerpot', x: px, z: pz, y: 0, s: 2.8 });
    addProp({ type: 'pot', x: px, z: pz, w: 0.8, d: 0.8, h: 1.2 });
  }

  // REF1: an EXIT sign hangs over the entrance hall
  decals.push({ type: 'exitsign', key: 'exit', x: 48.5 * C, z: 66 * C, y: 6.3, nx: 0, nz: 1, w: 1.7, h: 1.7, hanging: true });

  for (const v of VENDING) {
    const p = cellCenter(v.x, v.z);
    const off = { e: [-0.75, 0], w: [0.75, 0], n: [0, 0.75], s: [0, -0.75] }[v.face];
    v.wx = p.x + off[0];
    v.wz = p.z + off[1];
    addProp({ type: 'vending', x: v.wx, z: v.wz, w: v.face === 'e' || v.face === 'w' ? 1.0 : 2, d: v.face === 'e' || v.face === 'w' ? 2 : 1.0, h: 3.6, vending: v.id, face: v.face, kind: v.kind });
  }
  map.vending = VENDING;

  for (const e of map.exits)
    decals.push({ type: 'exitsign', key: 'exit', x: e.wx - e.nx * OFF, z: e.wz - e.nz * OFF, y: 6.2, nx: -e.nx, nz: -e.nz, w: 1.6, h: 1.6 });

  const onFloor = (s) => { const c = worldToCell(s.x, s.z); return map.isFloor(c.cx, c.cz); };
  map.props = props;
  map.decals = decals;
  map.cashSpots = cashSpots.filter(onFloor);
  map.itemSpots = itemSpots.filter(onFloor);
  map.sprites = sprites;
  map.stations = stations;
  map.counters = counters;
  map.solidProps = props.filter((p) => p.solid).map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2, h: p.h }));
  const propCells = new Map();
  map.solidProps.forEach((b, i) => {
    for (let cz = Math.floor(b.z0 / C); cz <= Math.floor(b.z1 / C); cz++)
      for (let cx = Math.floor(b.x0 / C); cx <= Math.floor(b.x1 / C); cx++) {
        const k = map.idx(cx, cz);
        if (!propCells.has(k)) propCells.set(k, []);
        propCells.get(k).push(i);
      }
  });
  map.propCells = propCells;
}

// ---------------------------------------------------------------------------------------------
// Navigation grid: floor cells not substantially covered by solid props.

function buildNav(map) {
  const nav = new Uint8Array(map.W * map.H);
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (!map.isFloor(x, z)) continue;
      const cx = (x + 0.5) * CELL, cz = (z + 0.5) * CELL;
      let blocked = false;
      for (const i of map.propCells.get(map.idx(x, z)) || []) {
        const b = map.solidProps[i];
        if (b.x0 < cx + 0.7 && b.x1 > cx - 0.7 && b.z0 < cz + 0.7 && b.z1 > cz - 0.7) { blocked = true; break; }
      }
      if (!blocked) nav[map.idx(x, z)] = 1;
    }
  map.nav = nav;
  map.hallCells = [];
  map.roomCells = [];
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (!nav[map.idx(x, z)]) continue;
      const r = map.room(x, z);
      if (!r || r.type === 'garden') continue;
      if (r.type === 'hall') { if (r.id !== 'hall_spawn') map.hallCells.push([x, z]); }
      else if (r.type !== 'kfc' && r.type !== 'popeyes') map.roomCells.push([x, z]);
    }
  // free cells of every exercise room (for the moving exercises)
  map.exerciseCells = map.stations.map((st) => {
    const r = map.roomById[st.room];
    const out = [];
    for (let z = r.z0 + 1; z < r.z1; z++)
      for (let x = r.x0 + 1; x < r.x1; x++) {
        if (!nav[map.idx(x, z)]) continue;
        const c = cellCenter(x, z);
        if (Math.hypot(c.x - st.x, c.z - st.z) < 3.5) continue;
        out.push([x, z]);
      }
    return out;
  });
}

// ASCII dump for debugging / tests. Thin walls are drawn on a 2x grid.
export function mapToAscii(map) {
  const lines = [];
  for (let z = 0; z <= map.H; z++) {
    let top = '', mid = '';
    for (let x = 0; x <= map.W; x++) {
      const h = x < map.W ? map.edgeOf(x, Math.min(z, map.H - 1), z === map.H ? 's' : 'n') : { t: 0 };
      const hc = z === map.H ? map.edgeOf(x < map.W ? x : 0, map.H - 1, 's') : h;
      top += '+' + (x < map.W ? ['  ', '--', '==', 'DD', 'EE'][hc.t] : '');
      if (z < map.H) {
        const v = x < map.W ? map.edgeOf(x, z, 'w') : map.edgeOf(map.W - 1, z, 'e');
        const r = x < map.W ? map.room(x, z) : null;
        const ch = r ? { hall: '.', class: 'c', exercise: 'x', cafe: 'C', office: 'P', faculty: 'F', janitor: 'J', storage: 's', plaza: ',', kfc: 'K', popeyes: 'Y', garden: 'g' }[r.type] : ' ';
        const nav = x < map.W && map.nav[map.idx(x, z)];
        mid += [' ', '|', '"', 'D', 'E'][v.t] + (x < map.W ? (r && !nav ? 'o' : ch) + (r && !nav ? 'o' : ch) : '');
      }
    }
    lines.push(top);
    if (z < map.H) lines.push(mid);
  }
  return lines.join('\n');
}
