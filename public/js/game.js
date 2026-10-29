// One play session on the client: first-person controller, prediction + server reconciliation,
// interpolated NPCs / remote players as camera-facing sprites, HUD, interactions, item use,
// exercises, restaurant counter, jump-rope minigame, stomp shake, face reactions and FX.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  CELL, EYE_H, PLAYER_R, WALK_SPEED, RUN_SPEED, STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN,
  INTERACT_DIST, CLIENT_SEND_HZ, ITEMS, RESTAURANTS, CALORIE_GOAL, EXERCISE_COUNT, PHASE, fmtCash,
} from '/shared/constants.js';
import { cellCenter, worldToCell } from '/shared/map.js';
import { makeSolidTest, moveCircle, resolveCircle } from '/shared/collision.js';
import { lineOfSight } from '/shared/nav.js';
import { audio } from './audio.js';
import { net } from './net.js';
import { spriteTex, labelTex, iconTex, iconDataURL, sprayTex, drawTimer, imageTex } from './textures.js';
import { ExerciseRunner } from './exercise.js';

const $ = (id) => document.getElementById(id);
const VOICE = new Set(['start', 'coin', 'principal1', 'principal2', 'playtime1', 'playtime2', 'bullysee', 'bullytake', 'bullypass', 'mad', 'prize', 'sweep', 'sweepout', 'whistle', 'childmusic', 'catboypass', 'catboypass2', 'catboysee', 'catboygood', 'catboyajan', 'catboyprincipal', 'facu', 'prinbul', 'pr1', 'pr2', 'pr3', 'lockcaught']);
const NPC_LOOK = {
  ajan: { img: 'AJAN', h: 5.6 }, principal: { img: 'PRINCIPAL', h: 5.0 }, playtime: { img: 'PLAYTIME', h: 4.1 },
  bully: { img: 'BULLY', h: 4.7 }, catboy: { img: 'CATBOY', h: 4.8 }, car: { img: null, h: 2.5 }, sweep: { img: 'SWEEP', h: 4.0 }, prize: { img: 'PRIZE', h: 6.7 }, arts: { img: 'ARTS', h: 4.3 },
};
const FACES = ['FACE1', 'FACE2', 'FACE3'];
// the final-chase car (assets/car.glb): ~5.2 long, 3 wide - fits a 7.5-wide hallway
let carModel = null;
function loadCar() {
  if (!carModel) carModel = new GLTFLoader().loadAsync('/assets/car.glb').then((g) => {
    const m = g.scene;
    // the school has no lights: show the car with its own texture colours, unlit
    m.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ map: o.material.map || null, color: o.material.map ? 0xffffff : o.material.color }); });
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
    const k = 5.2 / Math.max(size.x, size.z);
    m.scale.setScalar(k);
    m.position.y = -box.min.y * k;
    if (size.x > size.z) m.rotation.y = Math.PI / 2; // long axis along z (the NPC's forward)
    return m;
  }).catch(() => null);
  return carModel;
}
const MAD_LEN = 3.7; // seconds of AJANMAD.mp3
const ACTIVE = new Set([PHASE.INTRO, PHASE.TRAINING, PHASE.COLLECT_CASH, PHASE.FAST_FOOD, PHASE.FINAL_ESCAPE]);
const fwd = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

function makeBillboard(tex, aspect, h, y = 0) {
  const geo = new THREE.PlaneGeometry(h * aspect, h);
  geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
  m.position.y = y;
  return m;
}

export class Game {
  constructor(app, init, opts) {
    this.app = app;
    this.map = app.map;
    this.world = app.world;
    this.opts = opts; // { onQuit, onRestartSolo }
    this.scene = app.scene;
    this.camera = app.camera;
    this.dyn = new THREE.Group();
    this.scene.add(this.dyn);
    this.time = 0;
    this.keys = new Set();
    this.npcs = new Map();
    this.remotes = new Map();
    this.pickups = new Map();
    this.objs = new Map();
    this.splashes = [];
    this.snaps = [];
    this.renderT = 0;
    this.latestT = 0;
    this.doorStr = '';
    this.doorState = this.map.doors.map(() => ({ open: false, locked: false }));
    this.predictOpen = new Map();
    this.shake = 0;
    this.lastFace = -1;
    this.lastFaceT = -10;
    this.sendAcc = 0;
    this.ui = null; // 'exercise' | 'shop' | null
    this.jump = null;
    this.ended = false;
    this.paused = false;
    this.lastPhase = null;
    this.lockedAt = 0;
    this.debug = new URLSearchParams(location.search).has('debug');
    this.buildHud();
    this.applyInit(init);
    this.bindInput();
    $('hud').classList.remove('hidden');
    $('debug').classList.toggle('hidden', !this.debug);
    this.world.setExitsOpen(false);
    this.world.setCursed(init.self.cursed || []);
  }

  applyInit(init) {
    this.id = init.id;
    this.code = init.code;
    this.solo = init.solo;
    this.self = init.self;
    this.stationTypes = init.stations;
    this.me = this.me || { x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, stamina: STAMINA_MAX, push: null, ts: 0 };
    for (const pk of this.pickups.values()) this.dyn.remove(pk.mesh);
    this.pickups.clear();
    for (const p of init.pickups) this.addPickup(p);
    for (let i = 0; i < this.map.stations.length; i++) this.world.setStation(i, this.stationTypes[i], this.self.ex.includes(i));
    this.setSelf(init.self, true);
    this.chaseShown = init.self.story === 'chase';
    this.baseMusic = init.self.furious ? 'musicescape' : init.self.story === 'chase' ? null : 'music1';
    this.updateMusic();
    $('mp-status').classList.toggle('hidden', this.solo);
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const canvas = this.app.canvas;
    this.onKeyDown = (e) => {
      if (this.ui || this.ended) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      // a running exercise gets first pick of the keys (E, G, Space, letters...)
      if (this.ex && !this.paused && this.ex.onKey(e.code)) { e.preventDefault(); return; }
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 3) this.select(n); }
      if (e.code === 'Space') { e.preventDefault(); if (this.jump) this.jumpPress(); }
      if (e.code === 'KeyE' || e.code === 'KeyF') this.interact();
      if (e.code === 'KeyQ') this.useItem();
      if (e.code === 'F3') { e.preventDefault(); this.debug = !this.debug; $('debug').classList.toggle('hidden', !this.debug); }
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onMouseMove = (e) => {
      if (document.pointerLockElement !== canvas) return;
      // Chrome can report one huge bogus delta right after locking; ignore it
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400 || performance.now() - this.lockedAt < 80) return;
      const s = this.app.settings.sens * 0.0022;
      this.me.yaw -= e.movementX * s;
      // Classic controls: you can only turn left and right, never look up or down
    };
    this.onMouseDown = (e) => {
      if (this.ui || this.ended) return;
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) { if (this.jump) this.jumpPress(); else this.interact(); }
      if (e.button === 2) this.useItem();
    };
    this.onWheel = (e) => {
      if (this.ui || document.pointerLockElement !== canvas) return;
      this.select((this.self.sel + (e.deltaY > 0 ? 1 : 2)) % 3);
    };
    this.onContext = (e) => e.preventDefault();
    this.onLockChange = () => {
      if (this.ended) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !this.ui) this.pause(true);
      if (locked) { this.lockedAt = performance.now(); $('clicklock').classList.add('hidden'); if (this.paused) this.pause(false); }
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', this.onContext);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.onBlur = () => this.keys.clear();
    window.addEventListener('blur', this.onBlur);
  }

  lock() {
    const c = this.app.canvas;
    if (document.pointerLockElement === c) return;
    try {
      const p = c.requestPointerLock();
      if (p && p.catch) p.catch(() => $('clicklock').classList.remove('hidden'));
    } catch { $('clicklock').classList.remove('hidden'); }
  }

  pause(on) {
    if (this.ended) return;
    this.paused = on;
    $('pause').classList.toggle('hidden', !on);
    $('pause-note').textContent = this.solo ? 'The school is frozen.' : 'Multiplayer: the game keeps running while you are paused!';
    if (this.solo) net.act('pause', { paused: on });
    if (on) this.keys.clear();
  }

  select(n) {
    this.self.sel = n;
    this.updateInventory();
    net.act('select', { slot: n });
  }

  // ------------------------------------------------------------------ server state
  setSelf(s, initial = false) {
    const prev = this.self;
    this.self = s;
    if (!initial && prev) {
      for (const id of s.ex) if (!prev.ex.includes(id)) this.world.setStation(id, this.stationTypes[id], true);
      if (prev.ex.length && !s.ex.length) for (let i = 0; i < this.map.stations.length; i++) this.world.setStation(i, this.stationTypes[i], false);
    }
    if (s.phase !== this.lastPhase) this.onPhase(s.phase, this.lastPhase);
    this.lastPhase = s.phase;
    if (!initial && s.story === 'chase' && !this.chaseShown) this.onChase();
    if (!initial && s.furious && this.baseMusic !== 'musicescape') { this.baseMusic = 'musicescape'; this.updateMusic(); }
    this.world.setExitsOpen(s.phase === PHASE.FINAL_ESCAPE);
    this.world.setCursed(s.cursed || []);
    this.updateHud();
  }

  onPhase(phase, prev) {
    const cashVisible = [PHASE.COLLECT_CASH, PHASE.FAST_FOOD, PHASE.FINAL_ESCAPE].includes(phase);
    for (const pk of this.pickups.values()) if (pk.data.kind === 'cash') pk.mesh.visible = cashVisible;
    if (phase === PHASE.INTRO && (prev === PHASE.CAUGHT || prev === PHASE.VICTORY)) {
      $('end').classList.add('hidden');
      $('win').classList.add('hidden');
      $('hud').classList.remove('hidden');
      this.ended = false;
      this.lock();
      this.updateMusic();
    }
  }

  onSnapshot(s) {
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    if (s.t < this.latestT - 1) { this.snaps = [s]; this.renderT = s.t; } // server restarted/new room
    this.latestT = s.t;
    if (!this.renderT) this.renderT = s.t - 0.1;
    if (s.d !== this.doorStr) {
      this.doorStr = s.d;
      for (let i = 0; i < s.d.length; i++) {
        const prevOpen = this.doorState[i].open;
        this.doorState[i].open = s.d[i] === 'o';
        this.doorState[i].locked = s.d[i] === 'l';
        if (prevOpen && !this.doorState[i].open) {
          const d = this.map.doors[i]; const c = { x: d.x, z: d.z };
          if (Math.hypot(c.x - this.me.x, c.z - this.me.z) < 30) audio.play('doorclose', { pos: c, range: 30, dedupe: false, volume: 0.6 });
        }
      }
    }
    if (s.self) this.setSelf(s.self);
    this.syncEntities(s);
    for (const ev of s.ev) this.handleEvent(ev);
    if (!this.solo) {
      $('mp-status').innerHTML = 'GAME CODE: <b>' + this.code + '</b><br>' + s.p.map((p) => `<span style="color:${p.c}">■</span> ${escapeHtml(p.n)}${p.id === this.id ? ' (you)' : ''} - ${phaseLabel(p.ph, p)}`).join('<br>');
    }
  }

  syncEntities(s) {
    for (const n of s.n) {
      let e = this.npcs.get(n.id);
      if (!e) {
        const look = NPC_LOOK[n.k];
        let mesh;
        if (n.k === 'car') {
          mesh = new THREE.Group();
          loadCar().then((m) => { if (m) mesh.add(m.clone()); });
        } else {
          const st = spriteTex(look.img);
          mesh = makeBillboard(st.tex, st.aspect, look.h);
        }
        this.dyn.add(mesh);
        e = { id: n.id, k: n.k, mesh, look, x: n.x, z: n.z, squash: 0, img: look.img };
        this.npcs.set(n.id, e);
      }
      e.state = n.s;
      e.hidden = !!n.h;
      e.yaw = n.y;
      e.v = n.v;
      if (n.k === 'ajan') {
        const img = n.m === 'a' ? 'AJANBAD' : 'AJAN';
        if (img !== e.img) {
          e.img = img;
          const st = spriteTex(img);
          e.mesh.material.map = st.tex;
          e.mesh.geometry.dispose();
          e.mesh.geometry = new THREE.PlaneGeometry(e.look.h * st.aspect, e.look.h).translate(0, e.look.h / 2, 0);
        }
      }
      e.box = n.b ? { x0: n.b[0], x1: n.b[1], z0: n.b[2], z1: n.b[3] } : null;
    }
    // remote players
    const seen = new Set();
    for (const p of s.p) {
      if (p.id === this.id) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        const st = spriteTex('Male1'); // other players are a flat picture (Male1.webp)
        const mesh = makeBillboard(st.tex, st.aspect, 4.2);
        const label = makeBillboard(labelTex(p.n, p.c), 128 / 24, 0.6, 4.4);
        label.material.alphaTest = 0;
        label.material.transparent = true;
        this.dyn.add(mesh, label);
        r = { id: p.id, mesh, label, x: p.x, z: p.z };
        this.remotes.set(p.id, r);
      }
      r.visible = !!p.cn && ACTIVE.has(p.ph) && !p.hd; // nobody can see you in a locker
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { this.dyn.remove(r.mesh, r.label); this.remotes.delete(id); }
    // objects
    const oseen = new Set();
    for (const o of s.o) {
      oseen.add(o.id);
      let e = this.objs.get(o.id);
      if (!e) {
        const mesh = o.k === 'soda' ? makeBillboard(sprayTex(), 1, 3.3, 1.0) : makeBillboard(iconTex('clock'), 1, 1.0, 0);
        this.dyn.add(mesh);
        e = { mesh, x: o.x, z: o.z, k: o.k };
        this.objs.set(o.id, e);
      }
      e.tx = o.x; e.tz = o.z; e.ring = o.r;
    }
    for (const [id, e] of this.objs) if (!oseen.has(id)) {
      this.dyn.remove(e.mesh); this.objs.delete(id);
      // the soda ends in a big fizzy splash
      if (e.k === 'soda') {
        const m = makeBillboard(sprayTex(), 1, 3.3, 1.0);
        m.material = m.material.clone(); m.material.transparent = true; m.material.alphaTest = 0.05;
        m.position.set(e.x, 1.0, e.z);
        this.dyn.add(m);
        this.splashes.push({ m, t: 0 });
      }
    }
  }

  addPickup(p) {
    if (this.pickups.has(p.id)) return;
    let mesh;
    if (p.kind === 'cash') {
      // everything you can pick up floats at eye height (you cannot look up or down)
      mesh = makeBillboard(iconTex('cash'), 1, 1.0, EYE_H - 0.5);
      mesh.visible = [PHASE.COLLECT_CASH, PHASE.FAST_FOOD, PHASE.FINAL_ESCAPE].includes(this.self && this.self.phase);
    } else {
      mesh = makeBillboard(iconTex(p.item), 1, 1.3, EYE_H - 0.65);
    }
    mesh.position.x = p.x; mesh.position.z = p.z;
    mesh.userData = { kind: 'pickup', id: p.id };
    this.dyn.add(mesh);
    this.pickups.set(p.id, { data: p, mesh, baseY: mesh.position.y, phase: Math.random() * 6 });
  }

  removePickup(id) {
    const pk = this.pickups.get(id);
    if (!pk) return;
    this.dyn.remove(pk.mesh);
    this.pickups.delete(id);
  }

  handleEvent(ev) {
    switch (ev.e) {
      case 'sfx': this.playSfx(ev); break;
      case 'stomp': {
        // STOMP.mp3: loud and heavy up close, quieter and muffled the further away AJAN is
        const d = Math.hypot(ev.x - this.me.x, ev.z - this.me.z);
        audio.play('stomp', { pos: { x: ev.x, z: ev.z }, range: 150, dedupe: false, volume: ev.f ? 1.6 : 1.35, muffle: d > 30 ? Math.max(350, 2400 - d * 18) : 0 });
        const k = Math.max(0, 1 - d / 85);
        if (this.app.settings.shake) this.shake = Math.max(this.shake, k * k * (ev.f ? 1.1 : 0.85) + (k > 0 ? 0.08 : 0));
        if (d < 22) { this.app.postfx.flash = Math.max(this.app.postfx.flash, (1 - d / 22) * 0.25); this.fovKick = (1 - d / 22) * 5; }
        const a = this.npcs.get('ajan'); if (a) a.squash = 1;
        break;
      }
      case 'ajan_angry': this.app.postfx.flash = 0.6; this.shake = 0.8; break;
      case 'chase': this.onChase(); break;
      case 'mad': this.redAt = this.time + MAD_LEN; this.toast('AJAN IS FURIOUS!', 'money'); // red + shaking start when his AJANMAD line ends this.baseMusic = 'musicescape'; this.updateMusic(); break;
      case 'face': if (this.time - this.lastFaceT > 1) this.showFace(); break;
      case 'toast': this.toast(ev.text); break;
      case 'cash': this.toast('+' + fmtCash(ev.v), 'money'); audio.play('cash', { dedupe: false }); break;
      case 'teleport':
        this.me.x = ev.x; this.me.z = ev.z; this.me.ts = ev.seq; this.me.vx = this.me.vz = 0; this.me.push = null;
        if (ev.yaw != null) this.me.yaw = ev.yaw;
        this.sendMove();
        break;
      case 'correct': this.me.x = ev.x; this.me.z = ev.z; this.me.vx = this.me.vz = 0; break;
      case 'unhide': if (ev.thrown) { this.shake = 1; this.app.postfx.flash = 0.3; } audio.play('door', { dedupe: false }); break;
      case 'cursed': this.app.postfx.flash = 0.5; this.shake = Math.max(this.shake, 0.6); audio.play('fail', { dedupe: false }); break;
      case 'cursedme': this.shake = 1.6; audio.play('jump' + (1 + Math.floor(Math.random() * 3)), { dedupe: false, volume: 0.45, bus: 'voice' }); break;
      case 'carhit': this.startKnock(); break;
      case 'artsspin': this.startArtsSpin(ev.d || 2.6); break;
      case 'push': this.me.push = { vx: ev.vx, vz: ev.vz, until: this.time + ev.d }; break;
      case 'stamina': this.me.stamina = Math.max(this.me.stamina, ev.v); break;
      case 'pk+': this.addPickup(ev.p); break;
      case 'pk-': this.removePickup(ev.id); break;
      case 'jump_start': this.startJump(ev); break;
      case 'jump_end': this.endJump(ev.why); break;
      case 'hush':
        audio.voiceQueue = audio.voiceQueue.filter((q) => !String(q.dedupe).startsWith('v:' + ev.src));
        for (const k of [...audio.playing.keys()]) if (k.startsWith('v:' + ev.src)) audio.stop(k);
        break;
      case 'caught': this.caught(); break;
      case 'victory': this.victory(); break;
      case 'phase': break;
    }
  }

  playSfx(ev) {
    const k = ev.k;
    const isMe = ev.to === this.id || ev.to === '*';
    if (ev.only && !isMe) return;
    const spatial = !isMe && (ev.x || ev.z);
    if (!isMe && !spatial) return; // a private 2D sound meant for another player
    const voice = VOICE.has(k);
    const dedupe = voice ? 'v:' + k + ':' + (ev.src || '') + (isMe ? ':me' : '') : (k === 'door' || k === 'lock' ? false : k + ':' + (ev.src || ''));
    if (isMe) {
      audio.play(k, { dedupe, bus: voice ? 'voice' : 'sfx' });
      return;
    }
    // spatial: follow the NPC that is speaking if we know it
    const npc = ev.src && this.npcs.get(ev.src);
    const opts = { range: k.startsWith('catboy') ? 60 : voice ? 75 : k === 'alarm' ? 120 : 55, dedupe, bus: voice ? 'voice' : 'sfx', volume: k.startsWith('catboy') ? 1.3 : 1 };
    if (npc) opts.getPos = () => ({ x: npc.x, z: npc.z });
    else opts.pos = { x: ev.x, z: ev.z };
    audio.play(k, opts);
  }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const inv = $('inv');
    inv.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.append(document.createElement('img'));
      inv.append(s);
    }
  }

  updateInventory() {
    const slots = $('inv').children;
    for (let i = 0; i < 3; i++) {
      const it = this.self.inv[i];
      slots[i].classList.toggle('sel', i === this.self.sel);
      const img = slots[i].firstChild;
      if (it) { img.src = iconDataURL(it); img.style.visibility = 'visible'; } else img.style.visibility = 'hidden';
    }
    const cur = this.self.inv[this.self.sel];
    $('inv-name').textContent = cur ? ITEMS[cur].name : 'Nothing';
  }

  updateHud() {
    const s = this.self;
    if (!s) return;
    $('hud-ex').textContent = s.ex.length + '/' + EXERCISE_COUNT + ' Exercises';
    const post = s.ex.length >= EXERCISE_COUNT;
    $('hud-cash').classList.toggle('hidden', !post);
    $('hud-cal').classList.toggle('hidden', !post);
    $('hud-cash').textContent = 'CASH: ' + fmtCash(s.cash);
    $('hud-cal').textContent = 'CALORIES: ' + s.cal.toLocaleString('en-US') + ' / ' + CALORIE_GOAL.toLocaleString('en-US');
    $('hud-cal').classList.toggle('done', s.cal >= CALORIE_GOAL);
    const obj = $('hud-obj');
    obj.classList.toggle('final', s.phase === PHASE.FINAL_ESCAPE);
    obj.textContent = {
      INTRO: 'Find the 7 training exercises!',
      TRAINING: 'Find the training exercises: ' + (EXERCISE_COUNT - s.ex.length) + ' left',
      COLLECT_CASH: 'Collect cash, then buy food at KFC or Popeyes (north of the Cafeteria)',
      FAST_FOOD: 'Buy food at the counter: ' + Math.max(0, CALORIE_GOAL - s.cal).toLocaleString('en-US') + ' calories to go',
      FINAL_ESCAPE: 'GET OUT! RUN TO THE FRONT DOORS (WHERE YOU STARTED)!',
      CAUGHT: 'Caught!', VICTORY: 'You escaped!',
    }[s.phase] || '';
    this.updateInventory();
    if (this.ui === 'shop') this.renderShop();
  }

  toast(text, cls = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + cls;
    t.textContent = text;
    const box = $('toasts');
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), 3200);
  }

  // Door reactions: only once AJAN is mad (the chase). A random face shakes hard, and after a
  // second it turns into another one that shakes half as much, in the same spot.
  showFace() {
    if (this.self.story !== 'chase') return;
    this.lastFaceT = this.time;
    const order = FACES.map((k) => [Math.random(), k]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const a = $('face');
    const pop = (key, cls) => {
      a.src = '/assets/' + key + '.png';
      a.classList.remove('show', 'show2'); void a.offsetWidth; // restart the shake
      a.classList.add(cls);
    };
    clearTimeout(this.faceTimer); clearTimeout(this.faceTimer2);
    pop(order[0], 'show');
    this.faceTimer2 = setTimeout(() => pop(order[1], 'show2'), 1000); // turns into another face, half the shake
    this.faceTimer = setTimeout(() => a.classList.remove('show', 'show2'), 2300);
  }

  // ------------------------------------------------------------------ car hit
  startKnock() {
    if (this.knock) return;
    this.knock = { t: 0, dir: Math.random() < 0.5 ? -1 : 1, spin: (Math.random() - 0.5) * 5, stage: 0 };
    this.shake = 1.2;
  }

  clearKnock() {
    this.knock = null;
    this.app.canvas.style.filter = '';
    $('knockblack').style.opacity = 0;
    audio.restoreVolume();
  }

  // Camera pose while knocked down: tumble to the floor, black-out, then slowly get back up.
  knockPose(dt) {
    const k = this.knock, black = $('knockblack'), cv = this.app.canvas;
    if (!k) return { dh: 0, roll: 0, pitch: 0, yaw: 0 };
    if (this.ended) { this.clearKnock(); return { dh: 0, roll: 0, pitch: 0, yaw: 0 }; }
    k.t += dt;
    const t = k.t, low = 0.35 - EYE_H;
    if (k.stage === 0 && t >= 1) { k.stage = 1; audio.knockout(3, 20); }
    let f; // 1 = lying on the floor, 0 = standing
    if (t < 1) f = 1 - (1 - t) * (1 - t);
    else if (t < 4) f = 1;
    else f = Math.max(0, 1 - (t - 4) / 4); // get up over 4 s
    black.style.opacity = t < 0.8 ? 0 : t < 1 ? (t - 0.8) / 0.2 : t < 4 ? 1 : Math.max(0, 1 - (t - 4) / 1.5);
    const blur = t < 4 ? 0 : Math.max(0, 12 * (1 - (t - 4) / 10)); // blurry for 10 s after waking
    cv.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(1) + 'px)' : '';
    if (t > 24) this.clearKnock();
    const tumble = t < 1 ? Math.sin(t * 9) * (1 - t) : 0;
    return {
      dh: low * f,
      roll: k.dir * 1.35 * f + tumble * 0.8,
      pitch: (t < 1 ? -0.9 * Math.sin(t * Math.PI) : 0.25 * f) + tumble * 0.5,
      yaw: k.spin * Math.min(1, t) * f,
    };
  }

  // ------------------------------------------------------------------ Arts and Crafters spin
  startArtsSpin(d) {
    if (this.artsSpin) return;
    const st = spriteTex('ARTS');
    const meshes = [];
    for (let i = 0; i < 8; i++) { const m = makeBillboard(st.tex, st.aspect, 3.4, 0.3); m.visible = false; this.dyn.add(m); meshes.push(m); }
    this.artsSpin = { t: 0, d, meshes };
    this.shake = Math.max(this.shake, 0.6);
  }

  updateArtsSpin(dt) {
    const s = this.artsSpin;
    if (!s) return;
    s.t += dt;
    const k = s.t / s.d;
    if (k >= 1) { for (const m of s.meshes) this.dyn.remove(m); this.artsSpin = null; return; }
    // more and more socks circle you, faster and closer
    const n = Math.min(s.meshes.length, 1 + Math.floor(k * 9));
    const R = 3.4 - k * 1.4, w = 2 + k * 7;
    const cx = this.camera.position.x, cz = this.camera.position.z;
    s.meshes.forEach((m, i) => {
      m.visible = i < n;
      const a = s.t * w + (i / s.meshes.length) * Math.PI * 2;
      m.position.set(this.me.x + Math.cos(a) * R, 0.3 + Math.sin(s.t * 6 + i) * 0.3, this.me.z + Math.sin(a) * R);
      m.rotation.y = Math.atan2(cx - m.position.x, cz - m.position.z);
    });
  }

  // ------------------------------------------------------------------ interaction
  solidTest() {
    const doors = this.doorState.map((d, i) => ({ open: d.open || (this.predictOpen.get(i) || 0) > this.time, locked: d.locked }));
    return makeSolidTest(this.map, doors, { detainedDoor: this.self.det > 0 ? this.self.officeDoor : -1 });
  }

  // what the crosshair is pointing at (cone + range + line-of-sight)
  lookTarget() {
    const f = fwd(this.viewYaw());
    const cands = [];
    const consider = (x, z, range, kind, data, cone = 0.82) => {
      const dx = x - this.me.x, dz = z - this.me.z;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      const cos = d < 0.8 ? 1 : (dx * f.x + dz * f.z) / d;
      if (cos < cone) return;
      cands.push({ kind, data, d, score: d * (2 - cos) });
    };
    for (const d of this.map.doors) {
      const st = this.doorState[d.id];
      if (st.open || (this.predictOpen.get(d.id) || 0) > this.time) continue;
      consider(d.x, d.z, INTERACT_DIST, 'door', d, 0.7);
    }
    for (const pk of this.pickups.values()) {
      if (!pk.mesh.visible) continue;
      consider(pk.data.x, pk.data.z, 3.2, 'pickup', pk.data, 0.75);
    }
    for (const st of this.map.stations) {
      if (this.self.ex.includes(st.id) || this.ex) continue;
      consider(st.x, st.z, 4.6, 'station', st, 0.75);
    }
    for (const c of this.map.counters) consider(c.x, c.z - 1.8, 6.5, 'counter', c, 0.55);
    for (const v of this.map.vending) consider(v.wx, v.wz, 4.0, 'vending', v, 0.7);
    const cat = this.npcs.get('catboy');
    if (cat && !cat.hidden) consider(cat.x, cat.z, 4.5, 'catboy', { x: cat.x, z: cat.z }, 0.75);
    for (const l of this.map.lockers) consider(l.x, l.z, 3.4, 'locker', l, 0.6);
    cands.sort((a, b) => a.score - b.score);
    for (const c of cands) {
      const tx = c.data.wx ?? c.data.x;
      const tz = c.data.wz ?? c.data.z;
      // doors sit inside the wall - test sight to a point just in front of the target
      const dd = Math.hypot(tx - this.me.x, tz - this.me.z) || 1;
      const back = Math.min(0.6, dd * 0.5) / dd;
      const ex = tx - (tx - this.me.x) * back, ez = tz - (tz - this.me.z) * back;
      if (c.kind === 'vending' || lineOfSight(this.map, this.me.x, this.me.z, ex, ez, this.doorState)) return c;
    }
    return null;
  }

  async interact() {
    if (!ACTIVE.has(this.self.phase)) return;
    if (this.self.hide) { net.act('locker'); return; } // climb back out
    const t = this.lookTarget();
    if (!t) return;
    if (t.kind === 'door') {
      const d = t.data;
      if (this.doorState[d.id].locked) { this.toast('This door is locked.'); return; }
      if (this.self.det > 0 && d.id === this.self.officeDoor) { this.toast('The door is locked. Detention!'); return; }
      this.predictOpen.set(d.id, this.time + 0.8);
      this.showFace();
      const res = await net.act('door', { door: d.id });
      if (!res.ok) { this.predictOpen.delete(d.id); if (res.err) this.toast(res.err); }
    } else if (t.kind === 'pickup') {
      const res = await net.act('pickup', { id: t.data.id });
      if (res.ok) this.removePickup(t.data.id);
      else if (res.err) this.toast(res.err);
    } else if (t.kind === 'station') {
      this.openExercise(t.data.id);
    } else if (t.kind === 'counter') {
      this.openShop(t.data.restaurant);
    } else if (t.kind === 'catboy') {
      const res = await net.act('catboy');
      if (!res.ok && res.err) this.toast(res.err);
    } else if (t.kind === 'locker') {
      const res = await net.act('locker', { id: t.data.id });
      if (!res.ok && res.err) this.toast(res.err);
    } else if (t.kind === 'vending') {
      this.toast('Use a Shiny Quarter (right-click) on this machine.');
    }
  }

  async useItem() {
    if (!ACTIVE.has(this.self.phase)) return;
    const slot = this.self.sel;
    const item = this.self.inv[slot];
    if (!item) return;
    const msg = { slot, yaw: this.viewYaw() };
    if (item === 'lock') {
      // nearest door in front of the player, open or closed
      const f = fwd(this.viewYaw());
      let best = null, bd = 1e9;
      for (const d of this.map.doors) {
        const c = { x: d.x, z: d.z };
        const dx = c.x - this.me.x, dz = c.z - this.me.z, dist = Math.hypot(dx, dz);
        if (dist > 7 || (dist > 1 && (dx * f.x + dz * f.z) / dist < 0.6)) continue;
        if (dist < bd) { bd = dist; best = d; }
      }
      if (best) msg.door = best.id;
    }
    const res = await net.act('use', msg);
    if (!res.ok && res.err) this.toast(res.err);
  }

  // ------------------------------------------------------------------ exercises (in-world)
  async openExercise(id) {
    if (this.ex) return;
    const res = await net.act('exOpen', { station: id });
    if (!res.ok) { if (res.err) this.toast(res.err); return; }
    this.ex = new ExerciseRunner(this, res);
    this.updateMusic();
  }

  exerciseFinished(runner, r) {
    if (this.ex !== runner) return;
    runner.dispose();
    this.ex = null;
    const id = runner.data.station;
    if (r && r.impossible) {
      this.world.setStation(id, this.stationTypes[id], true);
      this.toast('WRONG! ...nobody can press that key.');
    } else if (r && r.abandoned) {
      this.toast('You left the exercise. Go back to the machine to try again.');
    } else if (r && r.ok && r.success) {
      this.world.setStation(id, this.stationTypes[id], true);
      this.toast('GREAT JOB! ' + r.done + ' / ' + EXERCISE_COUNT + ' exercises', 'money');
    } else {
      this.toast(((r && (r.reason || r.err)) || 'Try again.') + ' Press E at the machine to retry.');
    }
    this.updateMusic();
  }

  // ------------------------------------------------------------------ music
  // music1 plays while AJAN welcomes you; music2 replaces it during an exercise; the chase
  // itself is silent (just the stomps); musicescape loops once everything turns red.
  updateMusic() {
    const want = this.ended ? null : this.ex ? 'music2' : this.baseMusic;
    if (want) audio.playMusic(want); else audio.stopMusic();
  }

  onChase() {
    if (this.chaseShown) return;
    this.chaseShown = true;
    this.baseMusic = this.self && this.self.furious ? 'musicescape' : null;
    this.updateMusic();
    audio.play('musicwrong', { bus: 'music', dedupe: 'musicwrong', volume: 0.75 });
    this.app.postfx.flash = 0.8;
    this.shake = 1.0;
    // AJAN's shocked face stays in the corner for a few seconds
    const f = $('face');
    f.src = '/assets/FACE3.png';
    f.classList.add('show');
    clearTimeout(this.faceTimer);
    this.faceTimer = setTimeout(() => f.classList.remove('show'), 3500);
    this.lastFaceT = this.time + 3;
    this.toast('AJAN IS MAD! RUN!');
  }

  closeUi(relock = true) {
    this.ui = null;
    $('shop').classList.add('hidden');
    if (relock) this.lock();
  }

  // ------------------------------------------------------------------ restaurant counter
  openShop(rid) {
    this.ui = 'shop';
    this.shopRid = rid;
    this.keys.clear();
    document.exitPointerLock();
    $('shop').classList.remove('hidden');
    this.renderShop();
  }

  renderShop() {
    const r = RESTAURANTS[this.shopRid];
    const s = this.self;
    const panel = $('shop-panel');
    const canBuy = s.phase === PHASE.COLLECT_CASH || s.phase === PHASE.FAST_FOOD;
    panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'shop-head';
    head.style.background = r.colors[0];
    head.innerHTML = `<h2>${r.name}</h2><span>Can I take your order?</span>`;
    const stats = document.createElement('div');
    stats.className = 'shop-stats';
    stats.innerHTML = `<span>CASH: ${fmtCash(s.cash)}</span><span>CALORIES: ${s.cal.toLocaleString('en-US')} / ${CALORIE_GOAL.toLocaleString('en-US')}</span>`;
    panel.append(head, stats);
    if (!canBuy) {
      const p = document.createElement('p');
      p.className = 'err';
      p.textContent = s.phase === PHASE.FINAL_ESCAPE ? "You've had enough! RUN!" : 'Sorry, we only serve trained staff. Finish all 7 exercises first!';
      panel.append(p);
    }
    for (const m of r.menu) {
      const row = document.createElement('div');
      row.className = 'menu-row' + (s.cash < m.price ? ' cant' : '');
      row.innerHTML = `<span>${m.name}</span><span class="price">${fmtCash(m.price)}</span><span class="cal">${m.cal.toLocaleString('en-US')} cal</span>`;
      const b = document.createElement('button');
      b.className = 'xbtn go';
      b.textContent = 'BUY';
      b.disabled = !canBuy;
      b.onclick = async () => {
        b.disabled = true;
        const res = await net.act('buy', { restaurant: r.id, item: m.id });
        if (res.ok) {
          this.self.cash = res.cash; this.self.cal = res.cal;
          this.toast('Bought ' + m.name + ' (+' + m.cal + ' cal)', 'money');
          if (res.cal >= CALORIE_GOAL) { this.closeUi(); return; }
        } else this.toast(res.err || 'Could not buy that.');
        this.renderShop();
      };
      row.append(b);
      panel.append(row);
    }
    const foot = document.createElement('div');
    foot.className = 'xfoot';
    const close = document.createElement('button');
    close.className = 'xbtn quit'; close.textContent = 'LEAVE COUNTER (Esc)';
    close.onclick = () => this.closeUi();
    foot.append(close);
    panel.append(foot);
  }

  // ------------------------------------------------------------------ jump rope
  startJump(ev) {
    this.jump = { t0: this.time, period: ev.period, need: ev.need, count: 0, cycle: -1, jumped: false, hop: 0, done: false };
    $('jump').classList.remove('hidden');
    $('jump-text').textContent = 'Ready... jump rope with Playtime!';
    this.updateJumpUi();
  }

  jumpPhase() {
    const j = this.jump;
    const t = (this.time - j.t0) / j.period - 1; // first cycle is a free "ready" cycle
    return { cycle: Math.floor(t), phase: ((t % 1) + 1) % 1, ready: t < 0 };
  }

  jumpPress() {
    const j = this.jump;
    if (!j || j.done) return;
    const { phase, ready } = this.jumpPhase();
    j.hop = 1;
    audio.play('jump', { dedupe: false });
    if (ready) return;
    if (Math.abs(phase - 0.5) < 0.15 && !j.jumped) {
      j.jumped = true;
      j.count++;
      $('jump-text').textContent = 'Nice!';
      if (j.count >= j.need) this.finishJump();
    } else if (!j.jumped) this.jumpMiss();
    this.updateJumpUi();
  }

  jumpMiss() {
    const j = this.jump;
    j.count = 0;
    j.jumped = true;
    $('jump-text').textContent = 'Oops! You messed up! Start over!';
    audio.play('fail', { dedupe: false });
  }

  async finishJump() {
    const j = this.jump;
    j.done = true;
    const res = await net.act('jumpDone');
    if (!res.ok && this.jump === j) { j.done = false; j.count = j.need - 1; this.toast(res.err || 'Keep jumping!'); }
  }

  updateJumpUi() {
    if (this.jump) $('jump-count').textContent = this.jump.count + ' / ' + this.jump.need;
  }

  tickJump(dt) {
    const j = this.jump;
    if (!j) return;
    const { cycle, phase, ready } = this.jumpPhase();
    if (!ready && cycle !== j.cycle) {
      // a new swing: if the previous one passed the floor without a jump, it is a miss
      if (j.cycle >= 0 && !j.jumped && !j.done) this.jumpMiss();
      j.cycle = cycle;
      j.jumped = false;
      this.updateJumpUi();
    }
    j.hop = Math.max(0, j.hop - dt * 3.5);
    // draw the rope
    const c = $('jump-canvas'), g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#d9c39a'; g.fillRect(0, 170, 320, 30);
    const ang = (ready ? ((this.time - j.t0) / j.period) % 1 : phase) * Math.PI * 2;
    const ropeY = 100 - Math.cos(ang) * 75; // phase 0.5 => floor
    const front = Math.sin(ang) > 0;
    g.strokeStyle = front ? '#ff3fa0' : 'rgba(255,63,160,0.45)'; g.lineWidth = front ? 6 : 4;
    g.beginPath(); g.moveTo(20, 100); g.quadraticCurveTo(160, ropeY * 2 - 100, 300, 100); g.stroke();
    g.fillStyle = '#333'; g.fillRect(12, 92, 10, 16); g.fillRect(298, 92, 10, 16);
    const inWin = !ready && Math.abs(phase - 0.5) < 0.15;
    g.fillStyle = inWin ? '#1db954' : '#999';
    g.font = 'bold 18px sans-serif'; g.textAlign = 'center';
    g.fillText(ready ? 'GET READY' : inWin ? 'JUMP!' : '', 160, 30);
  }

  endJump(why) {
    this.jump = null;
    $('jump').classList.add('hidden');
    if (why === 'done') audio.play('success', { dedupe: false });
  }

  // ------------------------------------------------------------------ end states
  // AJAN got you: the game freezes on the exact frame you died, a random JUMPSCARE picture
  // covers the lower half of the screen with a random (very loud) jump sound, then a black
  // screen with a random picture from /assets/random for 3 seconds, then the main menu.
  caught() {
    this.ended = true;
    this.frozen = true;
    if (this.ex) { this.ex.dispose(); this.ex = null; }
    this.updateMusic();
    this.endJump();
    this.closeUi(false);
    document.exitPointerLock();
    audio.stopAll();
    const n = 1 + Math.floor(Math.random() * 3);
    $('scare-img').src = '/assets/JUMPSCARE' + n + '.png';
    $('scare').classList.remove('hidden');
    $('hud').classList.add('hidden');
    audio.play('jump' + (1 + Math.floor(Math.random() * 3)), { dedupe: false, volume: 0.8, bus: 'voice' });
    audio.play('scare', { dedupe: false, volume: 1.2 });
    const pics = this.app.randomImages || [];
    setTimeout(() => {
      $('scare').classList.add('hidden');
      const card = $('deathcard');
      $('deathcard-img').src = pics.length ? '/assets/random/' + pics[Math.floor(Math.random() * pics.length)] + '.webp' : '';
      card.classList.remove('hidden');
      setTimeout(() => { card.classList.add('hidden'); this.opts.onDeath(); }, 3000);
    }, 2600);
  }

  victory() {
    this.ended = true;
    if (this.ex) { this.ex.dispose(); this.ex = null; }
    this.updateMusic();
    this.closeUi(false);
    document.exitPointerLock();
    audio.stopMusic();
    audio.play('win', { dedupe: false, volume: 1.2 });
    $('hud').classList.add('hidden');
    $('win').classList.remove('hidden');
  }

  async restart() {
    if (this.solo) { this.opts.onRestartSolo(); return; }
    const res = await net.act('restart');
    if (!res.ok) this.toast(res.err || 'Could not restart.');
  }

  // ------------------------------------------------------------------ per-frame
  // Holding Space looks straight behind you (the body keeps facing forward).
  lookingBack() { return this.keys.has('Space') && !this.jump && !this.ui && !this.ended && !(this.ex && this.ex.usesSpace); }
  viewYaw() { return this.me.yaw + (this.lookingBack() ? Math.PI : 0); }

  sendMove() {
    net.move({ x: +this.me.x.toFixed(3), z: +this.me.z.toFixed(3), yaw: +this.viewYaw().toFixed(3), sprint: this.sprinting, ts: this.me.ts });
  }

  frame(dt) {
    this.time += dt;
    const me = this.me;
    const active = ACTIVE.has(this.self.phase) && !this.ended;
    const frozen = !active || !!this.ui || !!this.jump || !!this.self.hide || !!(this.knock && this.knock.t < 8) || (this.paused && this.solo) || !!(this.ex && this.ex.frozen);
    if (this.ex) this.ex.tick(dt, this.keys);

    // ---- movement
    let ix = 0, iz = 0;
    if (!frozen && !this.paused) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    }
    const moving = ix || iz;
    const wantRun = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && moving;
    const energy = this.self.energy > 0;
    this.sprinting = wantRun && (me.stamina > 0 || energy);
    if (this.sprinting && !energy) me.stamina = Math.max(0, me.stamina - STAMINA_DRAIN * dt);
    else if (!this.sprinting && me.stamina < STAMINA_MAX) me.stamina = Math.min(STAMINA_MAX, me.stamina + STAMINA_REGEN * dt * (moving ? 1 : 1.3));
    const speed = this.sprinting ? RUN_SPEED : WALK_SPEED;
    let wx = 0, wz = 0;
    if (moving) {
      const l = Math.hypot(ix, iz);
      const s = Math.sin(me.yaw), c = Math.cos(me.yaw);
      // local (ix right, iz back) -> world
      wx = ((ix * c + iz * s) / l) * speed;
      wz = ((-ix * s + iz * c) / l) * speed;
    }
    const k = Math.min(1, dt * 14);
    me.vx += (wx - me.vx) * k;
    me.vz += (wz - me.vz) * k;
    let dx = me.vx * dt, dz = me.vz * dt;
    if (me.push && this.time < me.push.until) { dx += me.push.vx * dt; dz += me.push.vz * dt; }
    if (this.jump) { dx = 0; dz = 0; }
    if (frozen && !(me.push && this.time < me.push.until)) { dx = 0; dz = 0; me.vx = me.vz = 0; }
    const extra = [];
    for (const n of this.npcs.values()) if (n.box && !n.hidden) extra.push(n.box);
    const solid = this.solidTest();
    const pos = { x: me.x, z: me.z };
    if (dx || dz) moveCircle(this.map, pos, dx, dz, PLAYER_R, solid, extra);
    else resolveCircle(this.map, pos, PLAYER_R, solid, extra);
    me.x = pos.x; me.z = pos.z;

    // ---- network send
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / CLIENT_SEND_HZ) { this.sendAcc = 0; this.sendMove(); }

    // ---- interpolation clock
    const targetT = this.latestT - 0.1;
    this.renderT += dt;
    if (Math.abs(this.renderT - targetT) > 0.5) this.renderT = targetT;
    else this.renderT += (targetT - this.renderT) * Math.min(1, dt * 2);
    this.interpolate();

    // ---- camera
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const red = !!this.self.furious && !this.ended && this.time >= (this.redAt || 0);
    if (red && !this.wasRed) { this.app.postfx.flash = 1; this.shake = 1; }
    this.wasRed = red;
    this.app.postfx.target = red ? 1 : 0;
    if (red && this.app.settings.shake) this.shake = Math.max(this.shake, 0.85); // the ground never stops shaking
    const sh = this.shake * this.shake;
    const hop = (this.jump ? Math.sin(this.jump.hop * Math.PI) * 1.2 : 0) - (this.dip || 0) * 1.4;
    this.dip = Math.max(0, (this.dip || 0) - dt * 6);
    this.fovKick = Math.max(0, (this.fovKick || 0) - dt * 18);
    const fov = this.app.settings.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const kn = this.knockPose(dt);
    this.camera.position.set(me.x + (Math.random() - 0.5) * sh * 0.5, EYE_H + hop + kn.dh + (Math.random() - 0.5) * sh * 0.6, me.z + (Math.random() - 0.5) * sh * 0.5);
    this.camera.rotation.set((Math.random() - 0.5) * sh * 0.04 + kn.pitch, this.viewYaw() + kn.yaw, (Math.random() - 0.5) * sh * 0.05 + kn.roll, 'YXZ');
    this.updateArtsSpin(dt);
    audio.setListener(me.x, me.z, me.yaw);
    audio.update();

    // ---- sprites face the camera (cylindrical billboards)
    const cx = this.camera.position.x, cz = this.camera.position.z;
    const face = (m) => { m.rotation.y = Math.atan2(cx - m.position.x, cz - m.position.z); };
    const aj = this.npcs.get('ajan');
    const showCoin = !!aj && !aj.hidden && this.self.story === 'coin' && !this.self.coin;
    if (showCoin && !this.coinMesh) { this.coinMesh = makeBillboard(imageTex('random/QuarterIcon_Large'), 1, 1.1); this.dyn.add(this.coinMesh); }
    if (this.coinMesh) {
      this.coinMesh.visible = showCoin;
      if (showCoin) {
        // beside his hand, toward the camera's right
        const dx = cx - aj.x, dz = cz - aj.z, l = Math.hypot(dx, dz) || 1;
        this.coinMesh.position.set(aj.x + (dz / l) * 1.7 + (dx / l) * 0.4, 2.6 + Math.sin(this.time * 3) * 0.15, aj.z - (dx / l) * 1.7 + (dz / l) * 0.4);
        face(this.coinMesh);
      }
    }
    for (const e of this.npcs.values()) {
      e.mesh.visible = !e.hidden;
      e.mesh.position.set(e.x, e.look.y || 0, e.z);
      if (e.k === 'car') {
        // a solid 3D car that turns to face where it drives; its engine is heard only up close
        e.ry = e.ry == null ? e.yaw : e.ry + Math.atan2(Math.sin(e.yaw - e.ry), Math.cos(e.yaw - e.ry)) * Math.min(1, dt * 8);
        e.mesh.rotation.y = e.ry + Math.PI;
        if (!e.hidden && !this.ended) audio.play('carengine', { loop: true, dedupe: 'carengine', range: 40, bus: 'sfx', getPos: () => ({ x: e.x, z: e.z }) });
        else audio.stop('carengine');
        continue;
      }
      e.squash = Math.max(0, e.squash - dt * 5);
      const bob = e.k === 'ajan' ? 1 - e.squash * 0.12 : 1 + Math.sin(this.time * 9 + e.x) * 0.015 * (e.state === 'idle' || e.state === 'closet' ? 0 : 1);
      e.mesh.scale.set(e.k === 'ajan' ? 1 + e.squash * 0.08 : 1, bob, 1);
      face(e.mesh);
      e.mesh.rotation.z = e.v === 'off' ? 0.5 : 0;
      e.mesh.material.color.set(e.v === 'sad' ? '#8fa8ff' : '#ffffff');
    }
    for (const r of this.remotes.values()) {
      r.mesh.visible = r.label.visible = r.visible;
      r.mesh.position.set(r.x, 0, r.z); r.label.position.set(r.x, 4.4, r.z);
      face(r.mesh); face(r.label);
    }
    for (const pk of this.pickups.values()) {
      pk.mesh.position.y = pk.baseY + Math.sin(this.time * 2 + pk.phase) * 0.12;
      face(pk.mesh);
    }
    for (const o of this.objs.values()) {
      o.x += ((o.tx ?? o.x) - o.x) * Math.min(1, dt * 12); o.z += ((o.tz ?? o.z) - o.z) * Math.min(1, dt * 12);
      o.mesh.position.x = o.x; o.mesh.position.z = o.z;
      if (o.k === 'clock') o.mesh.rotation.z = o.ring ? Math.sin(this.time * 40) * 0.2 : 0;
      face(o.mesh);
    }
    for (const fs of this.app.foodSprites) face(fs);
    this.splashes = this.splashes.filter((s) => {
      s.t += dt;
      const k = s.t / 0.6;
      s.m.scale.setScalar(1 + k * 0.8);
      s.m.material.opacity = Math.max(0, 1 - k);
      face(s.m);
      if (k >= 1) { this.dyn.remove(s.m); s.m.material.dispose(); return false; }
      return true;
    });

    // ---- doors
    this.world.showLocks((id) => this.doorState[id].locked);
    this.world.animateDoors(dt, (id) => this.doorState[id].open || (this.predictOpen.get(id) || 0) > this.time);

    // ---- HUD bits
    const st = $('stamina').querySelector('.st-fill');
    st.style.width = Math.min(100, me.stamina) + '%';
    st.classList.toggle('over', me.stamina > STAMINA_MAX);
    const det = this.self.det > 0;
    if (det) this.self.det = Math.max(0, this.self.det - dt);
    $('detention').classList.toggle('hidden', !det);
    const hide = this.self.hide;
    $('lockerview').classList.toggle('hidden', !hide);
    if (this.self.lockerCd > 0) this.self.lockerCd = Math.max(0, this.self.lockerCd - dt);
    if (hide) {
      hide.left = Math.max(0, hide.left - dt);
      $('lockerview').firstChild.textContent = 'HIDING ' + Math.ceil(hide.left) + 's  (click to get out)';
      if (hide.left < 2.2) this.shake = Math.max(this.shake, 0.55); // it starts rattling... out you go
    }
    if (det) $('detention').innerHTML = 'DETENTION<br>' + Math.ceil(this.self.det) + 's' + (this.self.inv.includes('keys') ? '<br><small style="font-size:40%">Use the Principal\'s Keys at the door!</small>' : '');
    if (this.world.timer && (!this.timerAcc || this.time - this.timerAcc > 0.25)) {
      this.timerAcc = this.time;
      const txt = det ? '0:' + String(Math.ceil(this.self.det)).padStart(2, '0') : '--:--';
      if (txt !== this.lastTimerTxt) { this.lastTimerTxt = txt; drawTimer(this.world.timer.canvas, txt, det); this.world.timer.tex.needsUpdate = true; }
    }
    this.tickJump(dt);
    if (!this.ui && !this.ended && (!this.promptAcc || this.time - this.promptAcc > 0.1)) {
      this.promptAcc = this.time;
      const t = active ? this.lookTarget() : null;
      $('crosshair').classList.toggle('hot', !!t);
      $('prompt').textContent = t ? promptFor(t, this.self) : '';
    }
    if (this.debug) this.drawDebug();
  }

  interpolate() {
    const snaps = this.snaps;
    if (!snaps.length) return;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= this.renderT && snaps[i + 1].t >= this.renderT) { a = snaps[i]; b = snaps[i + 1]; break; }
    if (this.renderT >= b.t) a = b;
    const span = b.t - a.t;
    const f = span > 0 ? Math.max(0, Math.min(1, (this.renderT - a.t) / span)) : 1;
    const amap = new Map(a.n.map((n) => [n.id, n]));
    for (const n of b.n) {
      const e = this.npcs.get(n.id);
      if (!e) continue;
      const p = amap.get(n.id) || n;
      if (Math.hypot(n.x - p.x, n.z - p.z) > 10) { e.x = n.x; e.z = n.z; continue; } // teleported
      e.x = p.x + (n.x - p.x) * f;
      e.z = p.z + (n.z - p.z) * f;
    }
    const apl = new Map(a.p.map((p) => [p.id, p]));
    for (const p of b.p) {
      const r = this.remotes.get(p.id);
      if (!r) continue;
      const q = apl.get(p.id) || p;
      if (Math.hypot(p.x - q.x, p.z - q.z) > 10) { r.x = p.x; r.z = p.z; continue; }
      r.x = q.x + (p.x - q.x) * f;
      r.z = q.z + (p.z - q.z) * f;
    }
  }

  drawDebug() {
    const c = worldToCell(this.me.x, this.me.z);
    const lines = [`pos ${this.me.x.toFixed(1)},${this.me.z.toFixed(1)} cell ${c.cx},${c.cz} ${this.map.room(c.cx, c.cz)?.name || ''}`,
      `phase ${this.self.phase} stamina ${this.me.stamina.toFixed(0)} fps ${(1 / Math.max(1e-3, this.app.lastDt)).toFixed(0)}`];
    for (const e of this.npcs.values()) lines.push(`${e.k.padEnd(9)} ${e.state.padEnd(11)} ${e.x.toFixed(0)},${e.z.toFixed(0)}${e.hidden ? ' (hidden)' : ''}`);
    $('debug').textContent = lines.join('\n');
  }

  dispose() {
    if (this.ex) { this.ex.dispose(); this.ex = null; }
    this.clearKnock();
    audio.stop('carengine');
    audio.stopMusic();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.closeUi(false);
    this.endJump();
    this.scene.remove(this.dyn);
    for (const id of ['hud', 'pause', 'end', 'scare', 'clicklock', 'netwarn', 'win']) $(id).classList.add('hidden');
    $('toasts').innerHTML = '';
    this.app.postfx.target = 0;
    this.app.postfx.amount = 0;
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function promptFor(t, self) {
  switch (t.kind) {
    case 'door': return 'Click: open door';
    case 'pickup': return t.data.kind === 'cash' ? 'Click: take ' + fmtCash(t.data.value) : 'Click: pick up ' + ITEMS[t.data.item].name;
    case 'station': return 'Click: start the exercise';
    case 'counter': return 'Click: order at ' + RESTAURANTS[t.data.restaurant].name;
    case 'catboy': return 'Click: talk to the catboy';
    case 'locker': return self.lockerCd > 0 ? 'Locker (wait ' + Math.ceil(self.lockerCd) + 's)' : 'Click: hide in the locker';
    case 'vending': return self.inv[self.sel] === 'coin' ? 'Right-click: insert the quarter' : 'Vending machine (needs a Shiny Quarter)';
  }
  return '';
}

function phaseLabel(ph, p) {
  if (p.d) return 'detention';
  if (p.j) return 'jumping rope';
  return { INTRO: 'starting', TRAINING: 'training', COLLECT_CASH: 'collecting cash', FAST_FOOD: 'eating', FINAL_ESCAPE: 'ESCAPING', CAUGHT: 'caught', VICTORY: 'escaped!' }[ph] || ph;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
