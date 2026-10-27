// Builds the 3D school from the shared map: merged low-poly floors/ceilings per surface, THIN
// walls on cell edges (doors and windows sit inside them), box-built props, decals and lights.
import * as THREE from 'three';
import { CELL, WALL_H } from '/shared/constants.js';
import { E_WALL, E_WINDOW, E_DOOR, E_EXIT, WALL_T, cellCenter } from '/shared/map.js';
import {
  surfaceTex, doorTex, exitTex, signTex, chalkboardTex, posterTex, menuBoardTex, stationTex,
  vendingTex, timerCanvas, drawTimer, iconTex, imageTex, getImage, toTex, canvas,
} from './textures.js';

const ZONE = {
  hall: { wall: 'brick', floor: 'carpet', ceil: 'ceiling' },
  class: { wall: 'brick', floor: 'bluecarpet', ceil: 'ceiling' },
  exercise: { wall: 'brick', floor: 'bluecarpet', ceil: 'ceiling' },
  cafe: { wall: 'cafewall', floor: 'cafefloor', ceil: 'ceiling' },
  office: { wall: 'brickgreen', floor: 'bluecarpet', ceil: 'ceiling' },
  faculty: { wall: 'beige', floor: 'classcarpet', ceil: 'ceiling' },
  janitor: { wall: 'concrete', floor: 'concrete', ceil: 'ceiling' },
  storage: { wall: 'concrete', floor: 'concrete', ceil: 'ceiling' },
  plaza: { wall: 'outbrick', floor: 'tiles', ceil: 'plazaceil' },
  kfc: { wall: 'kfcwall', floor: 'checker', ceil: 'ceiling' },
  popeyes: { wall: 'popwall', floor: 'browntile', ceil: 'ceiling' },
  garden: { wall: 'hedge', floor: 'grass', ceil: null },
};
const SILL = 2.2, HEADER = 5.2, DOOR_H = 5.0, HEDGE_H = 3.4;
const HT = WALL_T / 2;

class Batch {
  constructor() { this.pos = []; this.uv = []; this.col = []; }
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

// Box with per-face shading and a solid vertex colour (props). UVs in world units / 2.
function pushBox(b, x0, y0, z0, x1, y1, z1, color) {
  const c = new THREE.Color(color);
  const faces = [
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 1.0],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.5],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.85],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.8],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.72],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.68],
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
  const zoneOf = (cx, cz) => { const r = map.room(cx, cz); return r ? r.type : 'hall'; };

  const hquad = (key, x0, z0, x1, z1, y, up) => {
    const uv = [[x0 / CELL, z0 / CELL], [x1 / CELL, z0 / CELL], [x1 / CELL, z1 / CELL], [x0 / CELL, z1 / CELL]];
    if (up) batch(key).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [uv[3], uv[2], uv[1], uv[0]], 1);
    else batch(key).quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], uv, 0.95);
  };

  // ---------------------------------------------------------------- floors & ceilings
  for (let cz = 0; cz < map.H; cz++)
    for (let cx = 0; cx < map.W; cx++) {
      if (!map.isFloor(cx, cz)) continue;
      const z = ZONE[zoneOf(cx, cz)] || ZONE.hall;
      hquad('f:' + z.floor, cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL, 0, true);
      if (z.ceil) hquad('c:' + z.ceil, cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL, WALL_H, false);
    }
  // grass all around outside, only visible over the garden hedge
  hquad('f:grass', -200, -200, map.W * CELL + 200, map.H * CELL + 200, -0.02, true);

  // ---------------------------------------------------------------- thin walls
  // A face of edge e as seen from cell (cx,cz): offset half a wall thickness toward that cell.
  const exitMeshes = [];
  const face = (key, e, cx, cz, y0, y1, ext = HT) => {
    if (key === 'brickgreen') {
      // office walls: white brick with a green band along the ceiling
      const band = WALL_H - 0.7;
      if (y0 < band) face('brick', e, cx, cz, y0, Math.min(y1, band), ext);
      if (y1 > band) face('greenband', e, cx, cz, Math.max(y0, band), y1, ext);
      return;
    }
    const vertical = e.o === 'v';
    const c = cellCenter(cx, cz);
    const shade = vertical ? 0.86 : 1.0;
    const v0 = y0 / CELL, v1 = y1 / CELL;
    if (vertical) {
      const x = e.x0 + (c.x > e.x0 ? HT : -HT);
      const za = e.z0 - ext, zb = e.z1 + ext;
      const ua = za / CELL, ub = zb / CELL;
      // face looking toward the cell
      if (c.x > e.x0) batch('w:' + key).quad([x, y0, zb], [x, y0, za], [x, y1, za], [x, y1, zb], [[ub, v0], [ua, v0], [ua, v1], [ub, v1]], shade);
      else batch('w:' + key).quad([x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za], [[ua, v0], [ub, v0], [ub, v1], [ua, v1]], shade);
    } else {
      const z = e.z0 + (c.z > e.z0 ? HT : -HT);
      const xa = e.x0 - ext, xb = e.x1 + ext;
      const ua = xa / CELL, ub = xb / CELL;
      if (c.z > e.z0) batch('w:' + key).quad([xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], [[ua, v0], [ub, v0], [ub, v1], [ua, v1]], shade);
      else batch('w:' + key).quad([xb, y0, z], [xa, y0, z], [xa, y1, z], [xb, y1, z], [[ub, v0], [ua, v0], [ua, v1], [ub, v1]], shade);
    }
  };
  // small faces closing the wall thickness at the ends of an opening (door / window jambs)
  const jambs = (key, e, y0, y1) => {
    const b = batch('w:' + key);
    const v0 = y0 / CELL, v1 = y1 / CELL;
    if (e.o === 'v') {
      for (const [zz, dir] of [[e.z0, 1], [e.z1, -1]]) {
        const a = [e.x0 - HT, zz], c2 = [e.x0 + HT, zz];
        if (dir > 0) b.quad([a[0], y0, zz], [c2[0], y0, zz], [c2[0], y1, zz], [a[0], y1, zz], [[0, v0], [0.08, v0], [0.08, v1], [0, v1]], 0.7);
        else b.quad([c2[0], y0, zz], [a[0], y0, zz], [a[0], y1, zz], [c2[0], y1, zz], [[0, v0], [0.08, v0], [0.08, v1], [0, v1]], 0.7);
      }
    } else {
      for (const [xx, dir] of [[e.x0, 1], [e.x1, -1]]) {
        if (dir > 0) b.quad([xx, y0, e.z0 + HT], [xx, y0, e.z0 - HT], [xx, y1, e.z0 - HT], [xx, y1, e.z0 + HT], [[0, v0], [0.08, v0], [0.08, v1], [0, v1]], 0.7);
        else b.quad([xx, y0, e.z0 - HT], [xx, y0, e.z0 + HT], [xx, y1, e.z0 + HT], [xx, y1, e.z0 - HT], [[0, v0], [0.08, v0], [0.08, v1], [0, v1]], 0.7);
      }
    }
  };
  const slab = (key, e, y, up) => {
    if (e.o === 'v') hquad(key, e.x0 - HT, e.z0, e.x0 + HT, e.z1, y, up);
    else hquad(key, e.x0, e.z0 - HT, e.x1, e.z0 + HT, y, up);
  };

  for (const e of map.edges) {
    const sides = [e.cellA, e.cellB].filter((c) => c && map.isFloor(c[0], c[1]));
    if (!sides.length) continue;
    const other = (c) => (c === e.cellA ? e.cellB : e.cellA);
    for (const c of sides) {
      const zt = zoneOf(c[0], c[1]);
      let key = (ZONE[zt] || ZONE.hall).wall;
      let top = WALL_H;
      if (zt === 'garden') {
        const o = other(c);
        if (o && map.isFloor(o[0], o[1])) key = 'outbrick'; // the school's front wall
        else top = HEDGE_H;
      }
      if (e.t === E_WALL) face(key, e, c[0], c[1], 0, top);
      else if (e.t === E_WINDOW) { face(key, e, c[0], c[1], 0, SILL, 0); face(key, e, c[0], c[1], HEADER, WALL_H, 0); }
      else if (e.t === E_DOOR || e.t === E_EXIT) face(key, e, c[0], c[1], DOOR_H, WALL_H, 0);
    }
    const key0 = (ZONE[zoneOf(sides[0][0], sides[0][1])] || ZONE.hall).wall;
    if (e.t === E_WINDOW) {
      slab('f:' + key0, e, SILL, true);
      slab('c:' + key0, e, HEADER, false);
      jambs(key0, e, SILL, HEADER);
      const gb = batch('glass');
      if (e.o === 'v') gb.quad([e.x0, SILL, e.z0], [e.x0, SILL, e.z1], [e.x0, HEADER, e.z1], [e.x0, HEADER, e.z0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      else gb.quad([e.x0, SILL, e.z0], [e.x1, SILL, e.z0], [e.x1, HEADER, e.z0], [e.x0, HEADER, e.z0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      const vertical = e.o === 'v';
      pushBox(batch('props'), vertical ? e.x0 - 0.05 : e.x0, SILL + 1.45, vertical ? e.z0 : e.z0 - 0.05, vertical ? e.x0 + 0.05 : e.x1, SILL + 1.58, vertical ? e.z1 : e.z0 + 0.05, '#dddddd');
    }
    if (e.t === E_DOOR || e.t === E_EXIT) {
      slab('c:' + key0, e, DOOR_H, false);
      jambs(key0, e, 0, DOOR_H);
    }
    if (e.t === E_EXIT) {
      const ex = map.exits.find((x) => x.edge === e);
      const c = sides[0];
      const cc = cellCenter(c[0], c[1]);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL, DOOR_H), new THREE.MeshBasicMaterial({ map: exitTex(false) }));
      const nx = e.o === 'v' ? Math.sign(cc.x - e.x0) : 0, nz = e.o === 'h' ? Math.sign(cc.z - e.z0) : 0;
      m.position.set((e.x0 + e.x1) / 2 + nx * 0.02, DOOR_H / 2, (e.z0 + e.z1) / 2 + nz * 0.02);
      m.rotation.y = Math.atan2(nx, nz);
      root.add(m);
      exitMeshes.push({ mesh: m, exit: ex });
    }
  }

  // ---------------------------------------------------------------- ceiling lights
  const lb = batch('light');
  for (let cz = 0; cz < map.H; cz++)
    for (let cx = 0; cx < map.W; cx++) {
      if (!map.isFloor(cx, cz)) continue;
      const r = map.room(cx, cz);
      if (!r || r.type === 'garden') continue;
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
      case 'woodesk': {
        // REFCLASS: chunky attached wooden desks
        const wb = batch('wood');
        pushBox(wb, x0, 0, z0, x1, p.h - 0.18, z1, '#ffffff');
        pushBox(wb, x0 - 0.12, p.h - 0.18, z0 - 0.12, x1 + 0.12, p.h, z1 + 0.12, '#f2e2c8');
        break;
      }
      case 'bus': {
        const t = getImage('random/Bus');
        const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.w * (t ? t.height / t.width : 0.42)), new THREE.MeshBasicMaterial({ map: t ? imageTex('random/Bus') : null, alphaTest: 0.5, side: THREE.DoubleSide }));
        m.position.set(p.x, (p.w * (t ? t.height / t.width : 0.42)) / 2, p.z);
        m.rotation.y = Math.PI; // the readable side faces the school entrance
        root.add(m);
        break;
      }
      case 'desk':
        box(x0, p.h - 0.12, z0, x1, p.h, z1, '#c79a5b');
        box(x0 + 0.05, 0.6, z0 + 0.05, x1 - 0.05, p.h - 0.12, z0 + 0.6, '#8a8f96');
        for (const [lx, lz] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.2, z0 + 0.1], [x0 + 0.1, z1 - 0.2], [x1 - 0.2, z1 - 0.2]]) box(lx, 0, lz, lx + 0.1, p.h - 0.12, lz + 0.1, '#5d6066');
        break;
      case 'tdesk': case 'pdesk': {
        // reference office: solid orange-wood desks
        const wb = batch('wood');
        pushBox(wb, x0 + 0.1, 0, z0 + 0.1, x1 - 0.1, p.h - 0.15, z1 - 0.1, '#ffffff');
        pushBox(wb, x0, p.h - 0.15, z0, x1, p.h, z1, '#f2e2c8');
        break;
      }
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
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: stationTex('pushups', false, p.stationId + 1) }));
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

  // ---------------------------------------------------------------- doors (inside the thin walls)
  const doorMeshes = [];
  for (const d of map.doors) {
    const types = d.rooms.map((i) => (i >= 0 ? map.rooms[i] : null));
    const other = types.find((r) => r && r.type !== 'hall' && r.type !== 'plaza' && r.type !== 'garden') || types.find((r) => r && r.type !== 'hall') || types[0];
    let kind = 'normal', label = '';
    if (d.entrance) { kind = 'entrance'; label = 'ENTRANCE'; }
    else if (other) {
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
    // The panel fills the opening in the wall, hinged at one end. It swings 90 degrees into
    // the room side (the non-hallway side) when open.
    const roomCell = d.cells.find(([cx, cz]) => { const r = map.room(cx, cz); return r && r.type !== 'hall'; }) || d.cells[1];
    const rc = cellCenter(roomCell[0], roomCell[1]);
    const pivot = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: doorTex(kind, label) });
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#777' });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.04, DOOR_H - 0.02, 0.12), [edgeMat, edgeMat, edgeMat, edgeMat, mat, mat]);
    panel.position.set((CELL - 0.04) / 2 + 0.02, DOOR_H / 2, 0);
    pivot.add(panel);
    let closedRot, openRot;
    if (d.axis === 'z') {
      // horizontal wall edge: panel along +x from the west end
      pivot.position.set(d.x - CELL / 2, 0, d.z);
      closedRot = 0;
      openRot = rc.z > d.z ? -Math.PI / 2 : Math.PI / 2;
    } else {
      // vertical wall edge: panel along -z from the south end (rotation PI/2 maps +x to -z)
      pivot.position.set(d.x, 0, d.z + CELL / 2);
      closedRot = Math.PI / 2;
      openRot = rc.x > d.x ? Math.PI / 2 - Math.PI / 2 : Math.PI / 2 + Math.PI / 2;
    }
    pivot.rotation.y = closedRot;
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
    if (dc.hanging) { m.material.side = THREE.DoubleSide; m.material.alphaTest = 0.5; }
    else if (dc.type === 'exitsign') m.material.alphaTest = 0.5;
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
    else if (k === 'wood') mat = new THREE.MeshBasicMaterial({ vertexColors: true, map: surfaceTex('deskwood') });
    else mat = new THREE.MeshBasicMaterial({ map: surfaceTex(k.slice(2)), vertexColors: true, side: k === 'f:grass' ? THREE.FrontSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.matrixAutoUpdate = false;
    if (k === 'glass') mesh.renderOrder = 5;
    root.add(mesh);
    if (k.startsWith('w:') || k === 'props' || k === 'wood') occluders.push(mesh);
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
