// Builds the 3D school from the shared map: merged low-poly walls/floors/ceilings per surface,
// recessed swinging doors, windows, exits, box-built props, wall decals and ceiling lights.
import * as THREE from 'three';
import { CELL, WALL_H } from '/shared/constants.js';
import { T_FLOOR, T_WALL, T_WINDOW, T_EXIT, cellCenter } from '/shared/map.js';
import {
  surfaceTex, doorTex, exitTex, signTex, chalkboardTex, posterTex, menuBoardTex, stationTex,
  vendingTex, timerCanvas, drawTimer, iconTex, toTex, canvas,
} from './textures.js';

const ZONE = {
  hall: { wall: 'brick', floor: 'carpet', ceil: 'ceiling' },
  class: { wall: 'plaster', floor: 'classcarpet', ceil: 'ceiling' },
  exercise: { wall: 'gymwall', floor: 'gymfloor', ceil: 'ceiling' },
  cafe: { wall: 'cafewall', floor: 'cafefloor', ceil: 'ceiling' },
  office: { wall: 'wood', floor: 'redcarpet', ceil: 'ceiling' },
  faculty: { wall: 'beige', floor: 'classcarpet', ceil: 'ceiling' },
  janitor: { wall: 'concrete', floor: 'concrete', ceil: 'ceiling' },
  storage: { wall: 'concrete', floor: 'concrete', ceil: 'ceiling' },
  plaza: { wall: 'outbrick', floor: 'tiles', ceil: 'plazaceil' },
  kfc: { wall: 'kfcwall', floor: 'checker', ceil: 'ceiling' },
  popeyes: { wall: 'popwall', floor: 'browntile', ceil: 'ceiling' },
};
const SILL = 2.2, HEADER = 5.2, DOOR_H = 5.0;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

class Batch {
  constructor() { this.pos = []; this.uv = []; this.col = []; }
  // quad from 4 corners (counter-clockwise when viewed from the front)
  quad(a, b, c, d, uvs, shade = 1) {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const [ua, ub, uc, ud] = uvs;
    this.uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
    for (let i = 0; i < 6; i++) this.col.push(shade, shade, shade);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// Box with per-face shading and a solid vertex colour (props).
function pushBox(b, x0, y0, z0, x1, y1, z1, color) {
  const c = new THREE.Color(color);
  const faces = [
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 1.0],   // top
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.5],   // bottom
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.85],  // +z
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.8],   // -z
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.72],  // +x
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.68],  // -x
  ];
  for (const [p0, p1, p2, p3, s] of faces) {
    b.pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    const w = Math.hypot(p1[0] - p0[0], p1[2] - p0[2], p1[1] - p0[1]) / 2, h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]) / 2;
    b.uv.push(0, 0, w, 0, w, h, 0, 0, w, h, 0, h);
    for (let i = 0; i < 6; i++) b.col.push(c.r * s, c.g * s, c.b * s);
  }
}

export function buildWorld(map) {
  const root = new THREE.Group();
  const batches = new Map();
  const batch = (k) => { if (!batches.has(k)) batches.set(k, new Batch()); return batches.get(k); };
  const occluders = [];
  const zoneOf = (cx, cz) => {
    const r = map.room(cx, cz);
    if (r) return r.type;
    const d = map.doorAt[map.idx(cx, cz)];
    if (d >= 0) {
      const dd = map.doors[d];
      const types = dd.rooms.map((i) => (i >= 0 ? map.rooms[i].type : 'hall'));
      return types.includes('hall') ? 'hall' : types.includes('plaza') ? 'plaza' : types[0];
    }
    return 'hall';
  };

  // vertical face on the boundary of floor cell (cx,cz) toward direction (dx,dz), spanning y0..y1
  const wallFace = (key, cx, cz, dx, dz, y0, y1) => {
    const x = cx * CELL, z = cz * CELL;
    const shade = dx ? 0.86 : 1.0;
    const v0 = y0 / CELL, v1 = y1 / CELL;
    let a, b;
    if (dx === 1) { a = [x + CELL, z]; b = [x + CELL, z + CELL]; }
    if (dx === -1) { a = [x, z + CELL]; b = [x, z]; }
    if (dz === 1) { a = [x + CELL, z + CELL]; b = [x, z + CELL]; }
    if (dz === -1) { a = [x, z]; b = [x + CELL, z]; }
    batch('w:' + key).quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [[0, v0], [1, v0], [1, v1], [0, v1]], shade);
  };
  const hquad = (key, x0, z0, x1, z1, y, up) => {
    const uv = [[x0 / CELL, z0 / CELL], [x1 / CELL, z0 / CELL], [x1 / CELL, z1 / CELL], [x0 / CELL, z1 / CELL]];
    if (up) batch(key).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [uv[3], uv[2], uv[1], uv[0]], 1);
    else batch(key).quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], uv, 0.95);
  };

  const exitMeshes = [];
  for (let cz = 0; cz < map.H; cz++)
    for (let cx = 0; cx < map.W; cx++) {
      const t = map.tile(cx, cz);
      if (t === T_FLOOR) {
        const z = ZONE[zoneOf(cx, cz)] || ZONE.hall;
        hquad('f:' + z.floor, cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL, 0, true);
        hquad('c:' + z.ceil, cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL, WALL_H, false);
        for (const [dx, dz] of DIRS) {
          const nt = map.tile(cx + dx, cz + dz);
          if (nt === T_WALL) wallFace(z.wall, cx, cz, dx, dz, 0, WALL_H);
          else if (nt === T_WINDOW) { wallFace(z.wall, cx, cz, dx, dz, 0, SILL); wallFace(z.wall, cx, cz, dx, dz, HEADER, WALL_H); }
          else if (nt === T_EXIT) {
            wallFace(z.wall, cx, cz, dx, dz, DOOR_H, WALL_H);
            const ex = map.exits.find((e) => e.x === cx + dx && e.z === cz + dz);
            const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL, DOOR_H), new THREE.MeshBasicMaterial({ map: exitTex(false) }));
            const c = cellCenter(cx, cz);
            m.position.set(c.x + dx * (CELL / 2 - 0.01), DOOR_H / 2, c.z + dz * (CELL / 2 - 0.01));
            m.rotation.y = Math.atan2(-dx, -dz);
            root.add(m);
            exitMeshes.push({ mesh: m, exit: ex });
          }
          // lintel above doorways
          if (map.doorAt[map.idx(cx, cz)] >= 0) continue;
          if (nt === T_FLOOR && map.doorAt[map.idx(cx + dx, cz + dz)] >= 0) wallFace(z.wall, cx, cz, dx, dz, DOOR_H, WALL_H);
        }
        if (map.doorAt[map.idx(cx, cz)] >= 0) hquad('c:' + z.ceil, cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL, DOOR_H, false);
      } else if (t === T_WINDOW) {
        // sill top, header underside, jambs, glass
        let zk = 'hall';
        for (const [dx, dz] of DIRS) if (map.tile(cx + dx, cz + dz) === T_FLOOR) { zk = zoneOf(cx + dx, cz + dz); break; }
        const z = ZONE[zk];
        hquad('f:' + z.wall, cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL, SILL, true);
        hquad('c:' + z.wall, cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL, HEADER, false);
        for (const [dx, dz] of DIRS) if (map.tile(cx + dx, cz + dz) === T_WALL) wallFace(z.wall, cx, cz, dx, dz, SILL, HEADER);
        const w = map.windows.find((ww) => ww.x === cx && ww.z === cz);
        const c = cellCenter(cx, cz);
        const gb = batch('glass');
        if (w && w.axis === 'z') gb.quad([c.x - CELL / 2, SILL, c.z], [c.x + CELL / 2, SILL, c.z], [c.x + CELL / 2, HEADER, c.z], [c.x - CELL / 2, HEADER, c.z], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        else gb.quad([c.x, SILL, c.z - CELL / 2], [c.x, SILL, c.z + CELL / 2], [c.x, HEADER, c.z + CELL / 2], [c.x, HEADER, c.z - CELL / 2], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        // window frame cross bar
        pushBox(batch('props'), c.x - (w.axis === 'z' ? CELL / 2 : 0.06), SILL + 1.45, c.z - (w.axis === 'z' ? 0.06 : CELL / 2), c.x + (w.axis === 'z' ? CELL / 2 : 0.06), SILL + 1.6, c.z + (w.axis === 'z' ? 0.06 : CELL / 2), '#dddddd');
      }
    }

  // ceiling lights
  const lb = batch('light');
  for (let cz = 0; cz < map.H; cz++)
    for (let cx = 0; cx < map.W; cx++) {
      if (map.tile(cx, cz) !== T_FLOOR || map.doorAt[map.idx(cx, cz)] >= 0) continue;
      const r = map.room(cx, cz);
      if (!r) continue;
      const midx = Math.floor((r.x0 + r.x1) / 2), midz = Math.floor((r.z0 + r.z1) / 2);
      const isHall = r.type === 'hall';
      const on = isHall ? ((r.x1 - r.x0 > r.z1 - r.z0) ? cz === midz && cx % 5 === 0 : cx === midx && cz % 5 === 0) : (cx - r.x0) % 4 === 2 && (cz - r.z0) % 4 === 2;
      if (!on) continue;
      const c = cellCenter(cx, cz);
      lb.quad([c.x - 0.9, WALL_H - 0.02, c.z - 0.5], [c.x + 0.9, WALL_H - 0.02, c.z - 0.5], [c.x + 0.9, WALL_H - 0.02, c.z + 0.5], [c.x - 0.9, WALL_H - 0.02, c.z + 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }

  // ---------------------------------------------------------------- props
  const pb = batch('props');
  const stationMeshes = [];
  const vendingMeshes = [];
  const registerMeshes = [];
  const box = (x0, y0, z0, x1, y1, z1, col) => pushBox(pb, x0, y0, z0, x1, y1, z1, col);
  for (const p of map.props) {
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
    switch (p.type) {
      case 'desk':
        box(x0, p.h - 0.12, z0, x1, p.h, z1, '#c79a5b');
        box(x0 + 0.05, 0.6, z0 + 0.05, x1 - 0.05, p.h - 0.12, z0 + 0.6, '#8a8f96');
        for (const [lx, lz] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.2, z0 + 0.1], [x0 + 0.1, z1 - 0.2], [x1 - 0.2, z1 - 0.2]]) box(lx, 0, lz, lx + 0.1, p.h - 0.12, lz + 0.1, '#5d6066');
        break;
      case 'tdesk': case 'pdesk':
        box(x0, p.h - 0.15, z0, x1, p.h, z1, p.type === 'pdesk' ? '#6b3e1c' : '#a7773f');
        box(x0 + 0.1, 0, z0 + 0.1, x0 + 0.9, p.h - 0.15, z1 - 0.1, p.type === 'pdesk' ? '#5a3216' : '#8f6533');
        box(x1 - 0.9, 0, z0 + 0.1, x1 - 0.1, p.h - 0.15, z1 - 0.1, p.type === 'pdesk' ? '#5a3216' : '#8f6533');
        break;
      case 'chair':
        box(x0, 0.75, z0, x1, 0.85, z1, '#d33a2c');
        box(x0, 0.85, z1 - 0.1, x1, 1.7, z1, '#d33a2c');
        for (const [lx, lz] of [[x0, z0], [x1 - 0.08, z0], [x0, z1 - 0.08], [x1 - 0.08, z1 - 0.08]]) box(lx, 0, lz, lx + 0.08, 0.75, lz + 0.08, '#444');
        break;
      case 'ochair':
        box(x0, 0.8, z0, x1, 1.0, z1, '#222');
        box(x0, 1.0, z0, x1, 2.4, z0 + 0.2, '#222');
        box(p.x - 0.08, 0, p.z - 0.08, p.x + 0.08, 0.8, p.z + 0.08, '#777');
        break;
      case 'lunchtable': case 'rtable':
        box(x0, p.h - 0.12, z0, x1, p.h, z1, p.restaurant === 'kfc' ? '#c8102e' : p.restaurant === 'popeyes' ? '#f26522' : '#d69a4c');
        if (p.w > 4) { box(x0 + 1, 0, p.z - 0.15, x0 + 1.3, p.h - 0.12, p.z + 0.15, '#222'); box(x1 - 1.3, 0, p.z - 0.15, x1 - 1, p.h - 0.12, p.z + 0.15, '#222'); }
        else box(p.x - 0.12, 0, p.z - 0.12, p.x + 0.12, p.h - 0.12, p.z + 0.12, '#222');
        if (p.type === 'rtable') for (const [sx, sz] of [[x0 - 0.6, p.z], [x1 + 0.6, p.z]]) { box(sx - 0.35, 0.8, sz - 0.35, sx + 0.35, 0.9, sz + 0.35, '#333'); box(sx - 0.06, 0, sz - 0.06, sx + 0.06, 0.8, sz + 0.06, '#555'); }
        break;
      case 'bench':
        box(x0, p.h - 0.12, z0, x1, p.h, z1, '#c98a3a');
        box(x0 + 1, 0, p.z - 0.1, x0 + 1.2, p.h - 0.12, p.z + 0.1, '#222');
        box(x1 - 1.2, 0, p.z - 0.1, x1 - 1, p.h - 0.12, p.z + 0.1, '#222');
        break;
      case 'counter': case 'rcounter':
        box(x0, 0, z0, x1, p.h - 0.15, z1, p.restaurant === 'kfc' ? '#b80f2a' : p.restaurant === 'popeyes' ? '#d9561a' : '#9aa3ad');
        box(x0 - 0.1, p.h - 0.15, z0 - 0.1, x1 + 0.1, p.h, z1 + 0.1, '#e8e8e8');
        if (p.type === 'counter') box(x0 + 0.2, p.h, z0 + 0.3, x1 - 0.2, p.h + 0.9, z1 - 0.3, '#bfe6ff');
        break;
      case 'kitchen':
        box(x0, 0, z0, x1, p.h, z1, '#a9b0b6');
        for (let i = 0; i < 4; i++) { const fx = x0 + 1 + i * ((p.w - 2) / 4); box(fx, p.h, z0 + 0.3, fx + 1.4, p.h + 0.2, z1 - 0.3, '#3b2a12'); }
        break;
      case 'register': {
        const reg = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), new THREE.MeshBasicMaterial({ color: '#1b1b1b' }));
        reg.position.set(p.x, p.y + p.h / 2, p.z);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), new THREE.MeshBasicMaterial({ color: '#33ff66' }));
        scr.position.set(0, 0.45, p.d / 2 - 0.1); scr.rotation.x = -0.3;
        reg.add(scr);
        reg.userData = { kind: 'register', restaurant: p.restaurant };
        root.add(reg);
        registerMeshes.push(reg);
        break;
      }
      case 'cabinet':
        box(x0, 0, z0, x1, p.h, z1, '#8d949b');
        for (let i = 0; i < 3; i++) box(x1 - 0.02, 0.5 + i * 0.9, p.z - 0.3, x1 + 0.03, 0.62 + i * 0.9, p.z + 0.3, '#444');
        break;
      case 'shelf':
        box(x0, 0, z0, x1, p.h, z0 + 0.1, '#7a5a3a'); box(x0, 0, z1 - 0.1, x1, p.h, z1, '#7a5a3a');
        for (let i = 0; i < 4; i++) {
          const y = 0.3 + i * (p.h - 0.4) / 3;
          box(x0, y, z0, x1, y + 0.1, z1, '#9a7a50');
          for (let k = 0; k < Math.floor(p.d / 0.9); k++) box(x0 + 0.1, y + 0.1, z0 + 0.2 + k * 0.9, x1 - 0.15, y + 0.6 + (k % 2) * 0.2, z0 + 0.7 + k * 0.9, ['#d33', '#3a6', '#36c', '#eb3', '#fff'][(k + i) % 5]);
        }
        break;
      case 'bin':
        box(x0, 0, z0, x1, p.h, z1, '#4a7a4a');
        box(x0 - 0.05, p.h, z0 - 0.05, x1 + 0.05, p.h + 0.08, z1 + 0.05, '#2f5a2f');
        break;
      case 'couch':
        box(x0, 0, z0, x1, 0.9, z1, '#5f6fa8'); box(x0, 0.9, z0, x1, 1.6, z0 + 0.5, '#4f5f98');
        break;
      case 'coffee':
        box(x0, 0, z0, x1, 1.2, z1, '#777'); box(x0 + 0.2, 1.2, z0 + 0.2, x1 - 0.2, p.h, z1 - 0.2, '#222');
        break;
      case 'bucket':
        box(x0, 0, z0, x1, p.h, z1, '#f2c200');
        break;
      case 'box':
        box(x0, 0, z0, x1, p.h, z1, '#b8915a');
        break;
      case 'station': {
        box(x0, 0, z0, x1, 1.2, z1, '#555b63');
        const st = map.stations[p.stationId];
        const face = st.face;
        const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[face];
        const g = new THREE.BoxGeometry(face === 'n' || face === 's' ? p.w : 0.5, 1.6, face === 'n' || face === 's' ? 0.5 : p.d);
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#3d4249' }));
        mesh.position.set(p.x - n[0] * 0.3, 2.0, p.z - n[1] * 0.3);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: stationTex('order', false, p.stationId + 1) }));
        scr.position.set(n[0] * 0.26, 0, n[1] * 0.26);
        scr.rotation.y = Math.atan2(n[0], n[1]);
        mesh.add(scr);
        mesh.userData = { kind: 'station', id: p.stationId, screen: scr };
        root.add(mesh);
        stationMeshes.push(mesh);
        break;
      }
      case 'vending': {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), new THREE.MeshBasicMaterial({ color: p.kind === 'soda' ? '#9a1414' : '#143f9a' }));
        mesh.position.set(p.x, p.h / 2, p.z);
        const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[p.face];
        const front = new THREE.Mesh(new THREE.PlaneGeometry(1.8, p.h - 0.1), new THREE.MeshBasicMaterial({ map: vendingTex(p.kind) }));
        front.position.set(n[0] * (p.w / 2 + 0.01), 0, n[1] * (p.d / 2 + 0.01));
        front.rotation.y = Math.atan2(n[0], n[1]);
        mesh.add(front);
        mesh.userData = { kind: 'vending', id: p.vending, vkind: p.kind };
        root.add(mesh);
        vendingMeshes.push(mesh);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- doors
  const doorMeshes = [];
  for (const d of map.doors) {
    const c = cellCenter(d.x, d.z);
    const types = d.rooms.map((i) => (i >= 0 ? map.rooms[i] : null));
    const other = types.find((r) => r && r.type !== 'hall' && r.type !== 'plaza') || types.find((r) => r && r.type !== 'hall') || types[0];
    let kind = 'normal', label = '';
    if (other) {
      if (other.type === 'office') { kind = 'office'; label = 'PRINCIPAL'; }
      else if (other.type === 'faculty') { kind = 'faculty'; label = 'FACULTY ONLY'; }
      else if (other.type === 'janitor') { kind = 'janitor'; label = 'JANITOR'; }
      else if (other.type === 'exercise') { kind = 'ex'; label = 'EXERCISE ' + other.id.slice(2); }
      else if (other.type === 'kfc') { kind = 'kfc'; label = 'KFC'; }
      else if (other.type === 'popeyes') { kind = 'popeyes'; label = 'POPEYES'; }
      else if (other.type === 'cafe') { label = 'CAFETERIA'; }
      else if (other.type === 'plaza') { kind = 'plaza'; label = 'FOOD COURT'; }
      else if (other.type === 'storage') { label = 'STORAGE'; }
      else label = other.name.toUpperCase().slice(0, 12);
    }
    // the panel sits at the end of the doorway facing `other` and swings into the doorway
    const otherIdx = other ? d.rooms.indexOf(other.index) : 1;
    const sgn = otherIdx === 0 ? -1 : 1; // direction toward `other` along the travel axis
    const pivot = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: doorTex(kind, label) });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(CELL, DOOR_H, 0.14), [
      new THREE.MeshBasicMaterial({ color: '#777' }), new THREE.MeshBasicMaterial({ color: '#777' }),
      new THREE.MeshBasicMaterial({ color: '#777' }), new THREE.MeshBasicMaterial({ color: '#777' }), mat, mat,
    ]);
    panel.position.set(CELL / 2, DOOR_H / 2, 0);
    pivot.add(panel);
    if (d.axis === 'z') {
      pivot.position.set(c.x - CELL / 2, 0, c.z + sgn * (CELL / 2 - 0.1));
      pivot.rotation.y = 0;
    } else {
      pivot.position.set(c.x + sgn * (CELL / 2 - 0.1), 0, c.z + CELL / 2);
      pivot.rotation.y = Math.PI / 2;
    }
    const closedRot = pivot.rotation.y;
    // open: swing toward the inside of the doorway (away from `other`)
    const openRot = closedRot + sgn * (Math.PI / 2);
    pivot.userData = { kind: 'door', id: d.id, closedRot, openRot, t: 0 };
    panel.userData = { kind: 'door', id: d.id };
    root.add(pivot);
    doorMeshes.push({ pivot, panel, def: d, mat, kind, label });
  }

  // ---------------------------------------------------------------- decals
  let timer = null;
  for (const dc of map.decals) {
    let tex;
    if (dc.type === 'poster') tex = posterTex(dc.key);
    else if (dc.type === 'chalkboard') tex = chalkboardTex(dc.key);
    else if (dc.type === 'menuboard') tex = menuBoardTex(dc.key);
    else if (dc.type === 'sign' || dc.type === 'exitsign') tex = signTex(dc.key);
    else if (dc.type === 'timer') {
      const cv = timerCanvas(); drawTimer(cv, '--:--', false);
      tex = toTex(cv, { repeat: false });
      timer = { canvas: cv, tex };
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(dc.w, dc.h), new THREE.MeshBasicMaterial({ map: tex, transparent: dc.type === 'exitsign' ? false : false }));
    m.position.set(dc.x + dc.nx * 0.03, dc.y, dc.z + dc.nz * 0.03);
    m.rotation.y = Math.atan2(dc.nx, dc.nz);
    root.add(m);
  }

  // ---------------------------------------------------------------- materials & meshes
  const glassMat = new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  const propTex = toTex(canvas(16, 16, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 16); for (let i = 0; i < 30; i++) { g.fillStyle = i % 2 ? '#e8e8e8' : '#f6f6f6'; g.fillRect((i * 7) % 16, (i * 11) % 16, 1, 1); } }));
  for (const [k, b] of batches) {
    let mat;
    if (k === 'glass') mat = glassMat;
    else if (k === 'light') mat = lightMat;
    else if (k === 'props') mat = new THREE.MeshBasicMaterial({ vertexColors: true, map: propTex });
    else mat = new THREE.MeshBasicMaterial({ map: surfaceTex(k.slice(2)), vertexColors: true });
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.matrixAutoUpdate = false;
    if (k === 'glass') mesh.renderOrder = 5;
    root.add(mesh);
    if (k.startsWith('w:') || k === 'props') occluders.push(mesh);
  }

  return {
    root, doorMeshes, stationMeshes, vendingMeshes, registerMeshes, exitMeshes, occluders, timer,
    setExitsOpen(open) { for (const e of exitMeshes) e.mesh.material.map = exitTex(open); },
    setStation(id, type, done) {
      const m = stationMeshes.find((s) => s.userData.id === id);
      if (m) { m.userData.screen.material.map = stationTex(type, done, id + 1); m.userData.screen.material.needsUpdate = true; }
    },
    animateDoors(dt, doorOpen) {
      for (const dm of doorMeshes) {
        const u = dm.pivot.userData;
        const target = doorOpen(dm.def.id) ? 1 : 0;
        u.t += Math.sign(target - u.t) * Math.min(Math.abs(target - u.t), dt * 6);
        dm.pivot.rotation.y = u.closedRot + (u.openRot - u.closedRot) * u.t;
      }
    },
  };
}

export { iconTex };
