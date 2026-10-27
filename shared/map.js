// The schoolhouse. Built from explicit room / hallway rectangles (not procedural) so the
// layout is fixed and learnable, Classic-style: an outer hallway ring, a central cross,
// classrooms in every quadrant, the cafeteria in the north-west corner and the fast-food
// court (KFC + Popeyes) directly north of the cafeteria, visible through its windows.
//
// Grid coordinates: cx to the east, cz to the south. One cell = CELL world units.
// World position of a cell centre: ((cx + .5) * CELL, (cz + .5) * CELL).

import { CELL } from './constants.js';
import { makeRng } from './rng.js';

export const MAP_W = 100;
export const MAP_H = 84;

export const T_FLOOR = 0;
export const T_WALL = 1;
export const T_WINDOW = 2;
export const T_EXIT = 3;

const ROOM_DEFS = [
  // id, type, name, x0, z0, x1, z1
  ['plaza', 'plaza', 'Food Court', 3, 3, 45, 16],
  ['kfc', 'kfc', 'KFC', 3, 3, 20, 11],
  ['popeyes', 'popeyes', 'Popeyes', 26, 3, 45, 11],
  ['cafeteria', 'cafe', 'Cafeteria', 3, 18, 31, 46],

  ['hall_n', 'hall', 'North Hall', 33, 18, 96, 20],
  ['hall_s', 'hall', 'South Hall', 3, 79, 96, 81],
  ['hall_w', 'hall', 'West Hall', 3, 48, 5, 81],
  ['hall_e', 'hall', 'East Hall', 94, 18, 96, 81],
  ['hall_mid', 'hall', 'Main Hall', 3, 48, 96, 50],
  ['hall_cv', 'hall', 'Main Hall', 48, 18, 50, 81],
  ['hall_cafe', 'hall', 'Cafeteria Hall', 33, 18, 35, 50],
  ['hall_ne', 'hall', 'Science Wing', 51, 33, 93, 35],
  ['hall_sw', 'hall', 'Arts Wing', 6, 64, 47, 66],
  ['hall_se', 'hall', 'Gym Wing', 72, 51, 74, 78],

  ['janitor', 'janitor', "Janitor's Closet", 37, 22, 41, 27],
  ['storage', 'storage', 'Storage', 43, 22, 46, 27],
  ['class_nw', 'class', 'Room 102', 37, 29, 46, 35],
  ['office', 'office', "Principal's Office", 37, 37, 46, 46],

  ['ex1', 'exercise', 'Exercise Room 1', 52, 22, 64, 31],
  ['faculty', 'faculty', 'Faculty Only', 66, 22, 78, 31],
  ['class_ne', 'class', 'Room 108', 80, 22, 92, 31],
  ['ex2', 'exercise', 'Exercise Room 2', 52, 37, 70, 46],
  ['ex3', 'exercise', 'Exercise Room 3', 72, 37, 92, 46],

  ['ex4', 'exercise', 'Exercise Room 4', 7, 52, 20, 62],
  ['class_sw1', 'class', 'Room 115', 22, 52, 33, 62],
  ['ex5', 'exercise', 'Exercise Room 5', 35, 52, 46, 62],
  ['ex6', 'exercise', 'Exercise Room 6', 7, 68, 26, 77],
  ['class_sw2', 'class', 'Art Room', 28, 68, 46, 77],

  ['ex7', 'exercise', 'Exercise Room 7', 52, 52, 70, 63],
  ['class_se1', 'class', 'Room 120', 52, 65, 70, 77],
  ['class_se2', 'class', 'Computer Lab', 76, 52, 92, 63],
  ['class_se3', 'class', 'Room 124', 76, 65, 92, 77],
];

// Buildings inside the plaza get their walls stamped back in before their interiors are carved.
const BUILDING_FOOTPRINTS = [
  ['kfc', 3, 3, 21, 12],
  ['popeyes', 25, 3, 45, 12],
];

const DOOR_DEFS = [
  [12, 12], [35, 12],             // KFC, Popeyes
  [17, 17], [40, 17],             // plaza <-> cafeteria, plaza <-> north hall
  [32, 30], [32, 42], [10, 47], [24, 47], // cafeteria
  [39, 21], [44, 21], [36, 32], [42, 47], // janitor, storage, room 102, office
  [58, 21], [58, 32], [72, 32], [86, 21], [93, 26], // ex1, faculty, room 108
  [61, 36], [51, 42], [82, 36], [93, 42], // ex2, ex3
  [13, 63], [6, 57], [27, 63], [40, 63], [47, 57], // ex4, room 115, ex5
  [16, 67], [16, 78], [37, 67], [47, 72], // ex6, art room
  [61, 51], [71, 58], [61, 78], [84, 51], [75, 58], [93, 71], [75, 71], // SE
];

const WINDOW_RUNS = [
  // x0, z0, x1, z1 (inclusive) on walls that separate two floor areas
  [5, 17, 14, 17], [20, 17, 29, 17],           // cafeteria -> food court
  [5, 12, 9, 12], [15, 12, 19, 12],            // KFC storefront
  [28, 12, 32, 12], [38, 12, 43, 12],          // Popeyes storefront
  [36, 24, 36, 26], [36, 40, 36, 43],          // hall -> storage / office
];

const EXIT_DEFS = [
  { id: 'exit_ne', x: 95, z: 17, nx: 0, nz: -1 },
  { id: 'exit_se', x: 97, z: 80, nx: 1, nz: 0 },
  { id: 'exit_sw', x: 2, z: 80, nx: -1, nz: 0 },
  { id: 'exit_nw', x: 2, z: 49, nx: -1, nz: 0 },
];

export const SPAWNS = {
  player: [
    [49, 61], [48, 62], [50, 62], [49, 63], [48, 64], [50, 64], [49, 65], [48, 66],
  ],
  ajan: [49, 55],
  principal: [41, 41],
  playtime: [20, 65],
  sweep: [39, 24],
  prize: [80, 34],
  arts: [6, 44],
};

// Spots where the Bully can stand: exactly-3-wide hallway segments (he blocks the full width).
export const BULLY_SPOTS = [
  { x: 34, z: 38 }, { x: 70, z: 19 }, { x: 4, z: 70 }, { x: 95, z: 45 },
  { x: 60, z: 80 }, { x: 30, z: 65 }, { x: 73, z: 70 }, { x: 80, z: 34 },
  { x: 49, z: 30 }, { x: 25, z: 80 },
];

export const VENDING = [
  { id: 'vend_soda', kind: 'soda', x: 33, z: 25, face: 'e' },
  { id: 'vend_bar', kind: 'bar', x: 96, z: 60, face: 'w' },
  { id: 'vend_soda2', kind: 'soda', x: 3, z: 74, face: 'e' },
];

export function cellCenter(cx, cz) {
  return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
}
export function worldToCell(x, z) {
  return { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL) };
}

export function buildMap() {
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(T_WALL);
  const roomOf = new Int16Array(MAP_W * MAP_H).fill(-1);
  const idx = (x, z) => z * MAP_W + x;
  const rooms = [];
  const roomById = {};

  const carve = (ri, x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        tiles[idx(x, z)] = T_FLOOR;
        roomOf[idx(x, z)] = ri;
      }
  };
  const fill = (x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        tiles[idx(x, z)] = T_WALL;
        roomOf[idx(x, z)] = -1;
      }
  };

  for (const [id, type, name, x0, z0, x1, z1] of ROOM_DEFS) {
    const ri = rooms.length;
    const room = { id, type, name, x0, z0, x1, z1, index: ri };
    rooms.push(room);
    roomById[id] = room;
    if (type === 'kfc' || type === 'popeyes') {
      const fp = BUILDING_FOOTPRINTS.find((b) => b[0] === id);
      fill(fp[1], fp[2], fp[3], fp[4]);
    }
    carve(ri, x0, z0, x1, z1);
  }

  // Doors
  const doors = DOOR_DEFS.map(([x, z], i) => {
    const wallW = tiles[idx(x - 1, z)] !== T_FLOOR;
    const wallE = tiles[idx(x + 1, z)] !== T_FLOOR;
    // axis = direction of travel through the door
    const axis = wallW && wallE ? 'z' : 'x';
    const a = axis === 'z' ? roomOf[idx(x, z - 1)] : roomOf[idx(x - 1, z)];
    const b = axis === 'z' ? roomOf[idx(x, z + 1)] : roomOf[idx(x + 1, z)];
    tiles[idx(x, z)] = T_FLOOR;
    return { id: i, x, z, axis, rooms: [a, b] };
  });
  const doorAt = new Int16Array(MAP_W * MAP_H).fill(-1);
  for (const d of doors) doorAt[idx(d.x, d.z)] = d.id;

  // Windows
  const windows = [];
  for (const [x0, z0, x1, z1] of WINDOW_RUNS)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (doorAt[idx(x, z)] >= 0) continue;
        tiles[idx(x, z)] = T_WINDOW;
        windows.push({ x, z, axis: z0 === z1 ? 'z' : 'x' });
      }

  const exits = EXIT_DEFS.map((e) => {
    tiles[idx(e.x, e.z)] = T_EXIT;
    return { ...e };
  });

  const inBounds = (x, z) => x >= 0 && z >= 0 && x < MAP_W && z < MAP_H;
  const tile = (x, z) => (inBounds(x, z) ? tiles[idx(x, z)] : T_WALL);
  const room = (x, z) => (inBounds(x, z) && roomOf[idx(x, z)] >= 0 ? rooms[roomOf[idx(x, z)]] : null);

  const map = {
    W: MAP_W, H: MAP_H, tiles, roomOf, rooms, roomById, doors, doorAt, windows, exits,
    idx, inBounds, tile, room,
    isFloor: (x, z) => tile(x, z) === T_FLOOR,
  };

  // Door clearance: no props within 2 cells of a door (keeps doorways free of collision traps).
  const reserved = new Uint8Array(MAP_W * MAP_H);
  for (const d of doors)
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) if (inBounds(d.x + dx, d.z + dz)) reserved[idx(d.x + dx, d.z + dz)] = 1;
  map.reserved = reserved;

  buildProps(map);
  buildNav(map);
  return map;
}

// ---------------------------------------------------------------------------------------------
// Props, decorations, station / pickup spots. Deterministic (fixed seed).

function doorSides(map, r) {
  const sides = new Set();
  for (const d of map.doors) {
    if (d.z === r.z0 - 1 && d.x >= r.x0 && d.x <= r.x1) sides.add('n');
    if (d.z === r.z1 + 1 && d.x >= r.x0 && d.x <= r.x1) sides.add('s');
    if (d.x === r.x0 - 1 && d.z >= r.z0 && d.z <= r.z1) sides.add('w');
    if (d.x === r.x1 + 1 && d.z >= r.z0 && d.z <= r.z1) sides.add('e');
  }
  return sides;
}

function buildProps(map) {
  const rng = makeRng(0xA7A9);
  const props = [];      // {type, x, z, w, d, h, rot, solid, y?}
  const decals = [];     // wall decorations {type, key, x, z, y, nx, nz, w, h}
  const cashSpots = [];  // {x, z, y}
  const itemSpots = [];  // {x, z}
  const foodSprites = []; // decorative flat food sprites {key, x, z, y, s}
  const stations = [];
  const counters = [];   // restaurant order points {restaurant, x, z}
  const C = CELL;

  const free = (cx, cz) => map.isFloor(cx, cz) && !map.reserved[map.idx(cx, cz)];
  const addProp = (p) => { props.push({ solid: true, rot: 0, y: 0, ...p }); return p; };
  const wallDecal = (r, side, along, y, w, h, type, key) => {
    // along: 0..1 position along the wall
    let x, z, nx = 0, nz = 0;
    if (side === 'n') { x = (r.x0 + (r.x1 - r.x0 + 1) * along) * C; z = r.z0 * C + 0.02; nz = 1; }
    if (side === 's') { x = (r.x0 + (r.x1 - r.x0 + 1) * along) * C; z = (r.z1 + 1) * C - 0.02; nz = -1; }
    if (side === 'w') { z = (r.z0 + (r.z1 - r.z0 + 1) * along) * C; x = r.x0 * C + 0.02; nx = 1; }
    if (side === 'e') { z = (r.z0 + (r.z1 - r.z0 + 1) * along) * C; x = (r.x1 + 1) * C - 0.02; nx = -1; }
    decals.push({ type, key, x, z, y, nx, nz, w, h });
  };

  const charPosters = ['AJAN', 'PRINCIPAL', 'PLAYTIME', 'BULLY', 'SWEEP', 'PRIZE', 'ARTS'];
  const rulePosters = ['rule_run', 'rule_faculty', 'rule_bully', 'rule_ajan', 'rule_train', 'rule_food'];
  let exerciseNo = 0;

  for (const r of map.rooms) {
    const sides = doorSides(map, r);
    const back = ['n', 's', 'w', 'e'].find((s) => !sides.has(s)) || 'n';
    const wx0 = r.x0 * C, wz0 = r.z0 * C, wx1 = (r.x1 + 1) * C, wz1 = (r.z1 + 1) * C;
    const cxm = (wx0 + wx1) / 2, czm = (wz0 + wz1) / 2;

    if (r.type === 'class' || r.type === 'exercise') {
      wallDecal(r, back, 0.5, 3.6, 7.5, 3, 'chalkboard', r.type === 'exercise' ? 'board_ex' : 'board');
      // desks in a grid, away from doors and the board
      const step = r.type === 'exercise' ? 2 : 2;
      for (let cz = r.z0 + 1; cz <= r.z1 - 1; cz += step)
        for (let cx = r.x0 + 1; cx <= r.x1 - 1; cx += step + 1) {
          if (!free(cx, cz)) continue;
          if (back === 'n' && cz < r.z0 + 3) continue;
          if (back === 's' && cz > r.z1 - 3) continue;
          if (back === 'w' && cx < r.x0 + 3) continue;
          if (back === 'e' && cx > r.x1 - 3) continue;
          if (r.type === 'exercise' && rng() < 0.45) continue;
          const p = cellCenter(cx, cz);
          addProp({ type: 'desk', x: p.x, z: p.z, w: 1.8, d: 1.2, h: 1.5 });
          addProp({ type: 'chair', x: p.x, z: p.z + 1.1, w: 0.9, d: 0.9, h: 1.0, solid: false });
          if (rng() < 0.35) cashSpots.push({ x: p.x, z: p.z, y: 1.6 });
        }
      // teacher desk
      const td = cellCenter(Math.floor((r.x0 + r.x1) / 2) + 2, back === 'n' ? r.z0 + 1 : back === 's' ? r.z1 - 1 : Math.floor((r.z0 + r.z1) / 2));
      if (r.type === 'class' && free(worldToCell(td.x, td.z).cx, worldToCell(td.x, td.z).cz)) {
        addProp({ type: 'tdesk', x: td.x, z: td.z, w: 3.2, d: 1.4, h: 1.6 });
        cashSpots.push({ x: td.x, z: td.z, y: 1.7 });
      }
      // a bin and a poster
      const binCell = { cx: r.x1, cz: r.z1 };
      if (free(binCell.cx, binCell.cz)) {
        const p = cellCenter(binCell.cx, binCell.cz);
        addProp({ type: 'bin', x: p.x, z: p.z, w: 0.9, d: 0.9, h: 1.3 });
      }
      const posterSide = ['n', 's', 'w', 'e'].find((s) => s !== back && !sides.has(s));
      if (posterSide) wallDecal(r, posterSide, 0.3 + rng() * 0.4, 3.6, 2.2, 2.6, 'poster', rng.pick(rng() < 0.5 ? charPosters : rulePosters));
      itemSpots.push(cellCenter(r.x0 + 1, r.z1 - 1));

      if (r.type === 'exercise') {
        exerciseNo++;
        // the training station stands in front of the board
        let sx = cxm, sz = czm, face = 's';
        if (back === 'n') { sz = wz0 + 2.6; face = 's'; }
        if (back === 's') { sz = wz1 - 2.6; face = 'n'; }
        if (back === 'w') { sx = wx0 + 2.6; face = 'e'; }
        if (back === 'e') { sx = wx1 - 2.6; face = 'w'; }
        const horizontal = face === 'n' || face === 's';
        stations.push({ id: exerciseNo - 1, room: r.id, x: sx, z: sz, face });
        addProp({ type: 'station', x: sx, z: sz, w: horizontal ? 2.6 : 1.4, d: horizontal ? 1.4 : 2.6, h: 2.6, stationId: exerciseNo - 1 });
      }
    }

    if (r.type === 'cafe') {
      // serving counter along the west wall with food displays
      addProp({ type: 'counter', x: wx0 + 1.2, z: czm + 4, w: 2.2, d: 30, h: 1.7 });
      for (let i = 0; i < 9; i++) {
        foodSprites.push({ key: rng.pick(['tray', 'burger', 'fries', 'carton', 'pizza', 'apple']), x: wx0 + 1.2, z: czm - 9 + i * 3.4, y: 1.75, s: 1.0 });
      }
      cashSpots.push({ x: wx0 + 1.2, z: czm - 4, y: 1.8 }, { x: wx0 + 1.2, z: czm + 12, y: 1.8 });
      // long lunch tables with benches
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 3; col++) {
          const tx = wx0 + 14 + col * 19;
          const tz = wz0 + 12 + row * 15.5;
          addProp({ type: 'lunchtable', x: tx, z: tz, w: 12, d: 2.6, h: 1.55 });
          addProp({ type: 'bench', x: tx, z: tz - 2.4, w: 12, d: 0.9, h: 0.9, solid: false });
          addProp({ type: 'bench', x: tx, z: tz + 2.4, w: 12, d: 0.9, h: 0.9, solid: false });
          for (let k = 0; k < 4; k++) {
            if (rng() < 0.75) foodSprites.push({ key: rng.pick(['tray', 'burger', 'fries', 'carton', 'cup', 'wrapper', 'pizza', 'apple']), x: tx - 4.5 + k * 3 + rng() * 0.6, z: tz + (rng() - 0.5) * 1.2, y: 1.6, s: 0.9 });
          }
          if (rng() < 0.4) cashSpots.push({ x: tx + (rng() - 0.5) * 8, z: tz, y: 1.65 });
        }
      for (const [bx, bz] of [[r.x1, r.z1], [r.x1, r.z0 + 6], [r.x0 + 3, r.z1]]) {
        if (!free(bx, bz)) continue;
        const p = cellCenter(bx, bz);
        addProp({ type: 'bin', x: p.x, z: p.z, w: 0.9, d: 0.9, h: 1.3 });
      }
      wallDecal(r, 'e', 0.2, 4.2, 3, 2.2, 'sign', 'sign_cafe');
      wallDecal(r, 's', 0.75, 3.6, 2.2, 2.6, 'poster', 'rule_food');
      wallDecal(r, 'e', 0.65, 3.6, 2.2, 2.6, 'poster', 'AJAN');
      itemSpots.push({ x: cxm + 6, z: wz1 - 2 }, { x: wx1 - 2, z: wz0 + 2 });
    }

    if (r.type === 'office') {
      addProp({ type: 'pdesk', x: cxm, z: wz0 + 6, w: 5, d: 1.8, h: 1.7 });
      addProp({ type: 'ochair', x: cxm, z: wz0 + 4, w: 1.2, d: 1.2, h: 2.0 });
      addProp({ type: 'chair', x: cxm - 1.6, z: wz0 + 8.2, w: 0.9, d: 0.9, h: 1.0, solid: false });
      addProp({ type: 'chair', x: cxm + 1.6, z: wz0 + 8.2, w: 0.9, d: 0.9, h: 1.0, solid: false });
      addProp({ type: 'cabinet', x: wx0 + 0.8, z: wz0 + 1.5, w: 1.4, d: 2.2, h: 3.0 });
      addProp({ type: 'cabinet', x: wx0 + 0.8, z: wz0 + 4.2, w: 1.4, d: 2.2, h: 3.0 });
      addProp({ type: 'shelf', x: wx1 - 0.7, z: wz0 + 3, w: 1.2, d: 4, h: 4.0 });
      foodSprites.push({ key: 'papers', x: cxm - 1.2, z: wz0 + 6, y: 1.75, s: 0.8 }, { key: 'mug', x: cxm + 1.5, z: wz0 + 6, y: 1.75, s: 0.6 });
      wallDecal(r, 'n', 0.18, 3.8, 2.2, 2.6, 'poster', 'AJAN');
      wallDecal(r, 'n', 0.42, 3.8, 2.2, 2.6, 'poster', 'PRINCIPAL');
      wallDecal(r, 'n', 0.66, 3.8, 2.2, 2.6, 'poster', 'rule_run');
      wallDecal(r, 'n', 0.88, 3.8, 2.0, 2.6, 'poster', 'rule_faculty');
      wallDecal(r, 'w', 0.75, 3.8, 2.0, 2.6, 'poster', 'PLAYTIME');
      wallDecal(r, 'e', 0.75, 3.8, 2.0, 2.6, 'poster', 'BULLY');
      wallDecal(r, 'w', 0.45, 3.8, 2.0, 2.6, 'poster', 'rule_bully');
      wallDecal(r, 's', 0.2, 5.4, 3.2, 1.2, 'timer', 'timer');
      map.detentionSpot = { x: cxm, z: wz0 + 9 };
    }

    if (r.type === 'faculty') {
      addProp({ type: 'lunchtable', x: cxm, z: czm, w: 7, d: 3, h: 1.55 });
      addProp({ type: 'couch', x: cxm, z: wz0 + 1.2, w: 7, d: 1.8, h: 1.6 });
      addProp({ type: 'coffee', x: wx1 - 1, z: wz1 - 1.2, w: 1.4, d: 1.4, h: 2.4 });
      addProp({ type: 'cabinet', x: wx0 + 0.8, z: wz1 - 1.5, w: 1.4, d: 2.2, h: 3.0 });
      foodSprites.push({ key: 'mug', x: cxm - 2, z: czm, y: 1.6, s: 0.6 }, { key: 'papers', x: cxm + 1, z: czm, y: 1.6, s: 0.8 });
      cashSpots.push({ x: cxm + 2.5, z: czm, y: 1.65 });
      itemSpots.push({ x: wx0 + 2, z: wz0 + 4 });
      wallDecal(r, 'e', 0.4, 3.8, 2.2, 2.6, 'poster', 'rule_faculty');
    }

    if (r.type === 'janitor') {
      addProp({ type: 'shelf', x: wx0 + 0.7, z: czm, w: 1.2, d: 6, h: 4.2 });
      addProp({ type: 'shelf', x: wx1 - 0.7, z: wz1 - 3.5, w: 1.2, d: 5, h: 4.2 });
      addProp({ type: 'bucket', x: cxm + 1.5, z: wz1 - 1.0, w: 1.0, d: 1.0, h: 1.0 });
      foodSprites.push({ key: 'mop', x: cxm - 1, z: wz1 - 0.6, y: 0, s: 2.2 }, { key: 'spray', x: wx0 + 0.7, z: czm - 1, y: 2.1, s: 0.8 }, { key: 'spray', x: wx0 + 0.7, z: czm + 1.4, y: 3.5, s: 0.8 });
      wallDecal(r, 'e', 0.2, 3.8, 2.0, 2.6, 'poster', 'SWEEP');
    }

    if (r.type === 'storage') {
      addProp({ type: 'shelf', x: wx0 + 0.7, z: czm, w: 1.2, d: 8, h: 4.2 });
      addProp({ type: 'box', x: wx1 - 1.2, z: wz1 - 1.2, w: 1.6, d: 1.6, h: 1.6 });
      addProp({ type: 'box', x: wx1 - 1.0, z: wz1 - 3.2, w: 1.4, d: 1.4, h: 1.2 });
      itemSpots.push({ x: cxm + 0.5, z: wz0 + 2 });
      cashSpots.push({ x: wx1 - 1.2, z: wz1 - 1.2, y: 1.7 });
    }

    if (r.type === 'kfc' || r.type === 'popeyes') {
      // counter across the back third, kitchen behind it, menu board on the back wall
      const counterZ = wz0 + 7.5;
      addProp({ type: 'rcounter', x: cxm, z: counterZ, w: wx1 - wx0 - 4, d: 1.6, h: 1.8, restaurant: r.type });
      addProp({ type: 'kitchen', x: cxm, z: wz0 + 1.2, w: wx1 - wx0 - 6, d: 2.2, h: 2.2, restaurant: r.type });
      addProp({ type: 'register', x: cxm - 2.5, z: counterZ, w: 1.0, d: 0.8, h: 0.6, y: 1.8, solid: false, restaurant: r.type });
      addProp({ type: 'register', x: cxm + 2.5, z: counterZ, w: 1.0, d: 0.8, h: 0.6, y: 1.8, solid: false, restaurant: r.type });
      counters.push({ restaurant: r.type, x: cxm, z: counterZ + 1.8 });
      wallDecal(r, 'n', 0.5, 5.1, 12, 3.6, 'menuboard', r.type);
      for (let i = 0; i < 5; i++) foodSprites.push({ key: r.type === 'kfc' ? rng.pick(['bucket', 'box_kfc', 'cup_kfc']) : rng.pick(['box_pop', 'cup_pop', 'fries']), x: cxm - 6 + i * 3, z: counterZ, y: 1.85, s: 0.9 });
      for (let i = 0; i < 3; i++) {
        const tx = wx0 + 5 + i * 5.5, tz = wz1 - 3.4;
        addProp({ type: 'rtable', x: tx, z: tz, w: 2.2, d: 2.2, h: 1.5, restaurant: r.type });
        foodSprites.push({ key: r.type === 'kfc' ? 'bucket' : 'box_pop', x: tx, z: tz, y: 1.55, s: 0.8 });
      }
      cashSpots.push({ x: wx0 + 5, z: wz1 - 3.4, y: 1.6 });
    }

    if (r.type === 'plaza') {
      decals.push({ type: 'sign', key: 'sign_kfc', x: 12 * C + C / 2, z: 13 * C + 0.02, y: 6.2, nx: 0, nz: 1, w: 8, h: 1.8 });
      decals.push({ type: 'sign', key: 'sign_pop', x: 35 * C + C / 2, z: 13 * C + 0.02, y: 6.2, nx: 0, nz: 1, w: 9, h: 1.8 });
      for (const tx of [6, 30, 42]) {
        const p = cellCenter(tx, 15);
        addProp({ type: 'rtable', x: p.x, z: p.z, w: 2.2, d: 2.2, h: 1.5, restaurant: 'plaza' });
      }
      cashSpots.push({ x: cellCenter(42, 15).x, z: cellCenter(42, 15).z, y: 1.6 });
      itemSpots.push(cellCenter(23, 5));
    }

    if (r.type === 'hall') {
      // ceiling-friendly hallway clutter: posters along long walls
      const long = r.x1 - r.x0 > r.z1 - r.z0;
      const len = long ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let t = 6; t < len - 2; t += 9 + rng.int(0, 6)) {
        const side = long ? (rng() < 0.5 ? 'n' : 's') : (rng() < 0.5 ? 'w' : 'e');
        // only on real wall faces
        const cx = long ? r.x0 + t : side === 'w' ? r.x0 : r.x1;
        const cz = long ? (side === 'n' ? r.z0 : r.z1) : r.z0 + t;
        const ox = side === 'w' ? -1 : side === 'e' ? 1 : 0;
        const oz = side === 'n' ? -1 : side === 's' ? 1 : 0;
        if (map.tile(cx + ox, cz + oz) !== T_WALL || map.doorAt[map.idx(cx + ox, cz + oz)] >= 0) continue;
        if (map.room(cx, cz) !== r && map.room(cx, cz)?.type !== 'hall') continue;
        const p = cellCenter(cx, cz);
        decals.push({
          type: 'poster', key: rng.pick(rng() < 0.45 ? charPosters : rulePosters),
          x: p.x + ox * (C / 2 - 0.02), z: p.z + oz * (C / 2 - 0.02), y: 3.6, nx: -ox, nz: -oz, w: 2.0, h: 2.6,
        });
      }
      for (let t = 3; t < len - 1; t += 11 + rng.int(0, 8)) {
        const cx = long ? r.x0 + t : r.x0 + (rng() < 0.5 ? 0 : 2);
        const cz = long ? r.z0 + (rng() < 0.5 ? 0 : 2) : r.z0 + t;
        if (rng() < 0.5) itemSpots.push(cellCenter(cx, cz));
        else cashSpots.push({ ...cellCenter(cx, cz), y: 0.3 });
      }
    }
  }

  // vending machines
  for (const v of VENDING) {
    const p = cellCenter(v.x, v.z);
    const off = { e: [-0.9, 0], w: [0.9, 0], n: [0, 0.9], s: [0, -0.9] }[v.face];
    v.wx = p.x + off[0];
    v.wz = p.z + off[1];
    addProp({ type: 'vending', x: v.wx, z: v.wz, w: v.face === 'e' || v.face === 'w' ? 1.2 : 2, d: v.face === 'e' || v.face === 'w' ? 2 : 1.2, h: 3.6, vending: v.id, face: v.face, kind: v.kind });
    cashSpots.push({ x: p.x + off[0] * -0.6, z: p.z + off[1] * -0.6, y: 0.3 });
  }
  map.vending = VENDING;

  // EXIT signs above each exit
  for (const e of map.exits) {
    const p = cellCenter(e.x, e.z);
    decals.push({ type: 'exitsign', key: 'exit', x: p.x - e.nx * (C / 2 + 0.03), z: p.z - e.nz * (C / 2 + 0.03), y: 6.6, nx: -e.nx, nz: -e.nz, w: 1.8, h: 0.8 });
  }

  map.props = props;
  map.decals = decals;
  map.cashSpots = cashSpots.filter((s) => {
    const c = worldToCell(s.x, s.z);
    return map.isFloor(c.cx, c.cz);
  });
  map.itemSpots = itemSpots.filter((s) => {
    const c = worldToCell(s.x, s.z);
    return map.isFloor(c.cx, c.cz);
  });
  map.foodSprites = foodSprites;
  map.stations = stations;
  map.counters = counters;
  map.solidProps = props.filter((p) => p.solid).map((p) => ({
    x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2, h: p.h,
  }));
  // per-cell list of solid props for fast collision
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
        // blocked if the prop overlaps the central 1.4-unit square of the cell
        if (b.x0 < cx + 0.7 && b.x1 > cx - 0.7 && b.z0 < cz + 0.7 && b.z1 > cz - 0.7) { blocked = true; break; }
      }
      if (!blocked) nav[map.idx(x, z)] = 1;
    }
  map.nav = nav;
  map.hallCells = [];
  map.roomCells = [];
  for (let z = 0; z < map.H; z++)
    for (let x = 0; x < map.W; x++) {
      if (!nav[map.idx(x, z)] || map.doorAt[map.idx(x, z)] >= 0) continue;
      const r = map.room(x, z);
      if (!r) continue;
      if (r.type === 'hall') map.hallCells.push([x, z]);
      else if (r.type !== 'kfc' && r.type !== 'popeyes') map.roomCells.push([x, z]);
    }
}

// ASCII dump for debugging / tests.
export function mapToAscii(map) {
  const lines = [];
  for (let z = 0; z < map.H; z++) {
    let s = '';
    for (let x = 0; x < map.W; x++) {
      const t = map.tile(x, z);
      if (map.doorAt[map.idx(x, z)] >= 0) s += 'D';
      else if (t === T_WALL) s += '#';
      else if (t === T_WINDOW) s += 'w';
      else if (t === T_EXIT) s += 'E';
      else if (!map.nav[map.idx(x, z)]) s += 'o';
      else {
        const r = map.room(x, z);
        s += r ? { hall: '.', class: 'c', exercise: 'x', cafe: 'C', office: 'P', faculty: 'F', janitor: 'J', storage: 's', plaza: ',', kfc: 'K', popeyes: 'Y' }[r.type] : '?';
      }
    }
    lines.push(s);
  }
  return lines.join('\n');
}
