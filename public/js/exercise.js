// In-world training exercises: no worksheets. You stand at a machine, run around the room and
// press keys. Positional steps are confirmed by the server against your real position.
import * as THREE from 'three';
import { CELL, EYE_H } from '/shared/constants.js';
import { audio } from './audio.js';
import { net } from './net.js';
import { iconTex } from './textures.js';

const $ = (id) => document.getElementById(id);
const STEP_ICON = { cone: 'cone', spill: 'spill', box: 'box', shelf: 'shelf', counter: 'counter' };
const FOOD_NAMES = { burger: 'BURGER', fries: 'FRIES', soda: 'SODA', bucket: 'BUCKET', pie: 'PIE', nuggets: 'NUGGETS' };
const FOOD_ICON = { burger: 'burger', fries: 'fries', soda: 'cup_kfc', bucket: 'bucket', pie: 'pie', nuggets: 'nuggets' };

function billboard(key, size, y) {
  const geo = new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: iconTex(key), alphaTest: 0.5, side: THREE.DoubleSide }));
  m.position.y = y;
  return m;
}

export class ExerciseRunner {
  constructor(game, data) {
    this.game = game;
    this.data = data;
    this.spec = data.spec;
    this.type = data.type;
    this.t0 = game.time;
    this.done = false;
    this.busy = false;
    this.group = new THREE.Group();
    game.dyn.add(this.group);
    this.markers = [];
    this.stepIdx = 0;
    this.holdT = 0;
    this.count = 0;
    this.keyIdx = 0;
    this.keyT0 = game.time;
    this.entered = [];
    this.hits = [];
    this.misses = 0;
    this.carrying = null;
    this.roomId = game.map.stations[data.station].room;
    if (this.spec.steps) {
      this.spec.steps.forEach((s, i) => {
        const key = s.kind === 'food' ? FOOD_ICON[s.food] : STEP_ICON[s.kind];
        // markers float at eye height so they are always in view (no looking up or down)
        const size = s.kind === 'shelf' ? 1.8 : 1.3;
        const m = billboard(key, size, EYE_H - size / 2);
        m.position.x = s.x; m.position.z = s.z;
        this.group.add(m);
        this.markers.push(m);
      });
      this.arrow = billboard('arrow', 0.7, EYE_H + 0.75);
      this.group.add(this.arrow);
    }
    $('xhud').classList.remove('hidden');
    $('xhud-title').textContent = 'EXERCISE ' + (data.station + 1) + ': ' + data.info.title;
    $('xhud-help').textContent = data.info.blurb;
    this.render();
  }

  get frozen() { return this.type === 'pushups'; }
  get usesSpace() { return this.type === 'fryer'; }
  elapsed() { return this.game.time - this.t0; }

  // returns true when the key press belongs to the exercise
  onKey(code) {
    if (this.done || this.busy) return false;
    const key = code.startsWith('Key') ? code.slice(3) : code === 'Space' ? 'SPACE' : code;
    switch (this.type) {
      case 'pushups': {
        if (key !== 'E' && key !== 'G') return false;
        const want = this.spec.keys[this.count % 2];
        if (key === want) {
          this.count++;
          this.game.dip = 1;
          audio.play('jump', { dedupe: false, volume: 0.6 });
          if (this.count >= this.spec.count) this.submit({ count: this.count });
        } else audio.play('click', { dedupe: false });
        this.render();
        return true;
      }
      case 'sequence': case 'impossible': {
        if (!/^[A-Z]$/.test(key)) return false;
        const want = this.spec.keys[this.keyIdx];
        this.entered.push(key);
        if (key === want) {
          audio.play('pickup', { dedupe: false });
          this.keyIdx++;
          this.keyT0 = this.game.time;
          if (this.keyIdx >= this.spec.keys.length) this.submit({ sequence: this.entered.slice() });
        } else this.submit({ sequence: this.entered.slice() });
        this.render();
        return true;
      }
      case 'fryer': {
        if (key !== 'E' && key !== 'SPACE') return false;
        const p = this.needle(), z = this.spec.zones[this.hits.length];
        if (p >= z.start && p <= z.start + z.width) {
          this.hits.push(p);
          audio.play('pickup', { dedupe: false });
          if (this.hits.length >= 3) this.submit({ hits: this.hits.slice() });
        } else {
          this.misses++;
          audio.play('fail', { dedupe: false });
          if (this.misses > this.spec.maxMisses) this.submit({ hits: [] });
        }
        this.render();
        return true;
      }
      default: {
        if (key !== 'E') return false;
        const s = this.spec.steps[this.stepIdx];
        if (s && !s.hold && this.near(s)) this.step();
        else if (s && !s.hold) this.game.toast(this.hint());
        return true;
      }
    }
  }

  near(s) { return Math.hypot(s.x - this.game.me.x, s.z - this.game.me.z) < 2.5; }

  hint() {
    const s = this.spec.steps[this.stepIdx];
    if (!s) return '';
    if (s.kind === 'food') return 'Grab the ' + FOOD_NAMES[s.food] + '!';
    if (s.kind === 'counter') return 'Bring the food to the machine!';
    if (s.kind === 'box') return 'Pick up the next box!';
    if (s.kind === 'shelf') return 'Carry it to the shelf!';
    if (s.kind === 'spill') return 'Walk to the spill and hold E!';
    return 'Run to the glowing cone!';
  }

  needle() {
    const t = this.elapsed() * this.spec.speed;
    const f = t % 2;
    return f < 1 ? f : 2 - f;
  }

  async step() {
    this.busy = true;
    const i = this.stepIdx;
    const res = await net.act('exStep', { station: this.data.station, i });
    this.busy = false;
    if (this.done) return;
    if (!res.ok) { this.game.toast(res.err || 'Try again!'); this.holdT = 0; return; }
    const s = this.spec.steps[i];
    audio.play(s.kind === 'spill' ? 'eat' : 'pickup', { dedupe: false });
    this.markers[i].visible = false;
    if (s.kind === 'box') this.carrying = 'box';
    if (s.kind === 'shelf') this.carrying = null;
    if (s.kind === 'food') this.carrying = (this.carrying ? this.carrying + ', ' : '') + FOOD_NAMES[s.food];
    this.stepIdx++;
    this.holdT = 0;
    if (res.done) this.submit({ done: true });
    this.render();
  }

  async submit(answer) {
    if (this.done) return;
    this.done = true;
    const res = await net.act('exSubmit', { station: this.data.station, answer });
    this.game.exerciseFinished(this, res);
  }

  tick(dt, keys) {
    if (this.done) return;
    const g = this.game;
    // leaving the room abandons the exercise
    const r = g.map.room(Math.floor(g.me.x / CELL), Math.floor(g.me.z / CELL));
    if (!r || r.id !== this.roomId) { this.done = true; g.exerciseFinished(this, { ok: true, success: false, abandoned: true }); return; }
    if (this.spec.time && this.elapsed() > this.spec.time) { this.submit({ timeout: true, count: this.count }); return; }
    if (this.type === 'sequence' || this.type === 'impossible') {
      if (g.time - this.keyT0 > this.spec.perKey * (this.keyIdx === this.spec.keys.length - 1 && this.type === 'impossible' ? 2.5 : 1)) this.submit({ sequence: this.entered.slice() });
    }
    if (this.spec.steps) {
      const s = this.spec.steps[this.stepIdx];
      if (s && s.hold) {
        // wall-clock time, so a low frame rate never makes holding slower
        const now = performance.now() / 1000;
        if (keys.has('KeyE') && this.near(s) && !this.busy) {
          if (this.holdStart == null) this.holdStart = now - this.holdT;
          this.holdT = now - this.holdStart;
          if (this.holdT >= s.hold) { this.holdStart = null; this.step(); }
        } else { this.holdStart = null; this.holdT = Math.max(0, this.holdT - dt * 2); }
      }
      if (s && this.arrow) {
        this.arrow.position.set(s.x, EYE_H + 0.75 + Math.sin(g.time * 5) * 0.15, s.z);
        const m = this.markers[this.stepIdx];
        if (m) m.scale.setScalar(1 + Math.sin(g.time * 8) * 0.08);
      }
      for (const m of [...this.markers, this.arrow]) if (m) m.rotation.y = Math.atan2(g.camera.position.x - m.position.x, g.camera.position.z - m.position.z);
    }
    this.render();
  }

  render() {
    const big = $('xhud-big'), prog = $('xhud-prog'), bar = $('xhud-bar');
    const gauge = $('xhud-gauge');
    gauge.classList.toggle('hidden', this.type !== 'fryer');
    let timeLeft = this.spec.time ? Math.max(0, this.spec.time - this.elapsed()) : null;
    switch (this.type) {
      case 'pushups':
        big.textContent = this.spec.keys[this.count % 2];
        prog.textContent = this.count + ' / ' + this.spec.count + ' push-ups';
        break;
      case 'sequence': case 'impossible': {
        const k = this.spec.keys[this.keyIdx];
        big.textContent = k || '';
        prog.textContent = 'Key ' + Math.min(this.keyIdx + 1, this.spec.keys.length) + ' / ' + this.spec.keys.length;
        timeLeft = Math.max(0, this.spec.perKey - (this.game.time - this.keyT0));
        break;
      }
      case 'fryer': {
        big.textContent = 'E';
        const z = this.spec.zones[Math.min(this.hits.length, 2)];
        $('xhud-zone').style.left = z.start * 100 + '%';
        $('xhud-zone').style.width = z.width * 100 + '%';
        $('xhud-needle').style.left = this.needle() * 100 + '%';
        prog.textContent = 'Batch ' + Math.min(this.hits.length + 1, 3) + ' / 3' + (this.misses ? '  (missed ' + this.misses + ')' : '');
        break;
      }
      default: {
        const s = this.spec.steps[this.stepIdx];
        big.textContent = s && s.hold ? (this.holdT > 0 ? Math.round((this.holdT / s.hold) * 100) + '%' : 'HOLD E') : 'E';
        prog.textContent = this.hint() + '  (' + this.stepIdx + ' / ' + this.spec.steps.length + ')' + (this.carrying ? '  Carrying: ' + this.carrying : '');
      }
    }
    bar.style.width = (timeLeft == null ? 0 : (timeLeft / (this.spec.time || this.spec.perKey)) * 100) + '%';
  }

  dispose() {
    this.done = true;
    this.game.dyn.remove(this.group);
    $('xhud').classList.add('hidden');
  }
}
