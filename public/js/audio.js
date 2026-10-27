// Central audio manager: preloads the supplied MP3s, synthesizes the effects that have no
// asset (stomps, doors, pickups...), handles distance/stereo panning, volume buses and
// de-duplication so the same voice line never restarts or stacks.
import { AUDIO } from '/shared/constants.js';

// Voice lines that are not supplied yet. They are loaded if the files appear in /assets,
// otherwise a synthesized placeholder plays and the gap is logged once.
const OPTIONAL = new Set(['bullysee', 'bullytake', 'bullypass']);
// Voice lines get loudness-normalized so every character is clearly audible over the music.
const VOICES = new Set(['menuvoice', 'start', 'coin', 'principal1', 'principal2', 'playtime1', 'playtime2', 'bullysee', 'bullytake', 'bullypass', 'mad', 'prize',
  'sweep', 'sweepout', 'whistle', 'childmusic', 'win',
  'catboypass', 'catboypass2', 'catboysee', 'catboygood', 'catboyajan', 'catboyprincipal']);
// Relative level of each music track (music always sits under the voices).
export const MUSIC_LEVEL = { menu: 0.55, music1: 0.32, music2: 0.5, musicwrong: 0.75, musicescape: 0.6 };
// STOMP.mp3 starts with ~0.86 s of silence: skip it so the hit lands on the step.
const START_OFFSET = { stomp: 0.84 };

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.missing = new Set();
    this.playing = new Map(); // dedupe key -> {src, gain, pan, pos, until}
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.settings = { master: 0.8, music: 0.6, sfx: 0.9 };
    this.music = null;
    this.loops = new Map();
    this.norm = new Map();
  }

  // Must be called from a user gesture (browser autoplay policy).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
      this.voiceBus = this.ctx.createGain(); this.voiceBus.connect(this.master);
      this.applyVolumes();
      this.noiseBuf = this.makeNoise(2);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.master;
    this.musicBus.gain.value = this.settings.music;
    this.sfxBus.gain.value = this.settings.sfx;
    this.voiceBus.gain.value = Math.min(1.4, this.settings.sfx * 1.3);
  }

  async loadAll(onProgress) {
    const entries = Object.entries(AUDIO);
    let done = 0;
    await Promise.all(entries.map(async ([key, file]) => {
      try {
        const res = await fetch('/assets/' + file);
        if (!res.ok) throw new Error(res.status);
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this.buffers.set(key, buf);
        if (VOICES.has(key)) this.norm.set(key, this.loudnessGain(buf, -13, -0.5));
        if (key === 'stomp') this.norm.set(key, this.loudnessGain(buf, -10, -0.3));
        // school-wide noises (sweepout, whistle, the sock's song) are meant to be LOUD
        if (key === 'sweepout' || key === 'whistle' || key === 'childmusic') this.norm.set(key, this.loudnessGain(buf, -10, -0.3));
      } catch (e) {
        this.missing.add(key);
        console.warn(`[audio] ${file} is ${OPTIONAL.has(key) ? 'not supplied yet' : 'MISSING'} - using a synthesized placeholder for "${key}".`);
      }
      onProgress && onProgress(++done / entries.length);
    }));
  }

  // gain that brings a clip's RMS to targetDb without pushing its peak above peakDb
  loudnessGain(buf, targetDb, peakDb) {
    let sum = 0, n = 0, peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i += 4) { const v = Math.abs(d[i]); if (v > 0.003) { sum += v * v; n++; } if (v > peak) peak = v; }
    }
    if (!n || !peak) return 1;
    const rmsDb = 10 * Math.log10(sum / n), peakDbNow = 20 * Math.log10(peak);
    return Math.max(0.5, Math.min(10 ** ((targetDb - rmsDb) / 20), 10 ** ((peakDb - peakDbNow) / 20), 12));
  }

  makeNoise(seconds) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setListener(x, z, yaw) { this.listener = { x, z, yaw }; }

  // distance attenuation + stereo pan relative to the camera
  spatial(pos, range) {
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const vol = Math.max(0, 1 - d / range) ** 1.6;
    // right vector of the listener: forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw)
    const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
    return { vol, pan };
  }

  // opts: { pos:{x,z} | getPos(), range, volume, dedupe, bus, loop }
  play(key, opts = {}) {
    if (!this.ctx) return null;
    const dedupe = opts.dedupe === undefined ? key : opts.dedupe;
    if (dedupe && this.playing.has(dedupe)) return this.playing.get(dedupe);
    const buf = this.buffers.get(key);
    if (!buf) return this.synth(key, opts);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!opts.loop;
    if (this.norm.has(key)) opts = { ...opts, volume: (opts.volume ?? 1) * this.norm.get(key) };
    if (VOICES.has(key) && !opts.bus) opts = { ...opts, bus: 'voice' };
    return this.route(src, key, dedupe, opts, buf.duration - (START_OFFSET[key] || 0));
  }

  route(src, key, dedupe, opts, duration) {
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    let head = gain;
    if (opts.muffle) {
      // distant sounds get darker (heard through walls)
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.muffle;
      src.connect(lp); lp.connect(gain);
    } else src.connect(head);
    gain.connect(pan);
    pan.connect(opts.bus === 'music' ? this.musicBus : opts.bus === 'voice' ? this.voiceBus : this.sfxBus);
    const h = { src, gain, pan, opts, key };
    this.updateHandle(h);
    src.start(0, START_OFFSET[key] || 0);
    if (dedupe) {
      this.playing.set(dedupe, h);
      src.onended = () => { if (this.playing.get(dedupe) === h) this.playing.delete(dedupe); };
    }
    h.duration = duration;
    return h;
  }

  updateHandle(h) {
    const o = h.opts;
    let v = o.volume ?? 1;
    let p = 0;
    const pos = o.getPos ? o.getPos() : o.pos;
    if (pos) {
      const s = this.spatial(pos, o.range || 60);
      v *= s.vol; p = s.pan;
    }
    if (!Number.isFinite(v)) v = 0;
    if (!Number.isFinite(p)) p = 0;
    h.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    h.pan.pan.setTargetAtTime(p, this.ctx.currentTime, 0.03);
  }

  update() {
    if (!this.ctx) return;
    for (const h of this.playing.values()) if (h.opts.pos || h.opts.getPos) this.updateHandle(h);
  }

  stop(dedupe) {
    const h = this.playing.get(dedupe);
    if (h) { try { h.src.stop(); } catch { /* already stopped */ } this.playing.delete(dedupe); }
  }

  stopAll() { for (const k of [...this.playing.keys()]) this.stop(k); this.stopMusic(); }

  isPlaying(dedupe) { return this.playing.has(dedupe); }

  // One looping music track at a time; starting one stops the previous one.
  playMusic(key) {
    if (!this.ctx) return;
    if (this.music && this.music.key === key) return;
    this.stopMusic();
    if (!key || !this.buffers.has(key)) return;
    const h = this.play(key, { loop: true, bus: 'music', dedupe: 'music:' + key, volume: MUSIC_LEVEL[key] ?? 0.6 });
    if (h) this.music = { key, h };
  }
  stopMusic() {
    if (this.music) { this.stop('music:' + this.music.key); this.music = null; }
  }

  // ------------------------------------------------------------------ synthesized sounds
  tone(type, f0, f1, dur, vol, dest, delay = 0) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  noiseBurst(dur, vol, dest, filterF = 1000, q = 1, type = 'lowpass', delay = 0) {
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterF; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  synth(key, opts) {
    // a gain/pan chain that the synth voices feed into
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    gain.connect(pan); pan.connect(opts.bus === 'voice' ? this.voiceBus : this.sfxBus);
    const h = { src: { stop() {} }, gain, pan, opts, key };
    this.updateHandle(h);
    const out = gain;
    let dur = 0.3;
    switch (key) {
      case 'stomp':
        this.tone('sine', 95, 32, 0.35, 1.0, out); this.noiseBurst(0.18, 0.6, out, 220); dur = 0.4; break;
      case 'door':
        this.noiseBurst(0.12, 0.5, out, 900); this.tone('square', 180, 90, 0.08, 0.15, out); dur = 0.2; break;
      case 'doorclose':
        this.noiseBurst(0.1, 0.4, out, 600); this.tone('sine', 120, 60, 0.12, 0.4, out); dur = 0.2; break;
      case 'lock':
        this.tone('square', 900, 700, 0.05, 0.25, out); this.tone('square', 500, 300, 0.08, 0.25, out, 0.08); dur = 0.2; break;
      case 'pickup':
        this.tone('square', 660, 660, 0.07, 0.2, out); this.tone('square', 990, 990, 0.1, 0.2, out, 0.07); dur = 0.2; break;
      case 'cash':
        this.tone('triangle', 1318, 1318, 0.08, 0.35, out); this.tone('triangle', 1760, 1760, 0.18, 0.35, out, 0.08); dur = 0.3; break;
      case 'buy':
        this.tone('square', 523, 523, 0.08, 0.2, out); this.tone('square', 659, 659, 0.08, 0.2, out, 0.08); this.tone('square', 784, 784, 0.15, 0.2, out, 0.16); dur = 0.35; break;
      case 'success':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.1, 0.18, out, i * 0.09)); dur = 0.5; break;
      case 'fail':
        this.tone('sawtooth', 220, 110, 0.4, 0.25, out); dur = 0.45; break;
      case 'click':
        this.tone('square', 800, 800, 0.03, 0.12, out); dur = 0.05; break;
      case 'snip':
        this.noiseBurst(0.05, 0.5, out, 4000, 1, 'highpass'); this.noiseBurst(0.05, 0.5, out, 4000, 1, 'highpass', 0.08); dur = 0.15; break;
      case 'spray':
        this.noiseBurst(0.6, 0.45, out, 2500, 0.7, 'bandpass'); dur = 0.6; break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noiseBurst(0.07, 0.4, out, 700, 1, 'lowpass', i * 0.15); dur = 0.5; break;
      case 'drink':
        for (let i = 0; i < 4; i++) this.tone('sine', 300 + i * 40, 200, 0.1, 0.3, out, i * 0.12); dur = 0.5; break;
      case 'vend':
        this.tone('square', 200, 200, 0.2, 0.2, out); this.noiseBurst(0.2, 0.4, out, 400, 1, 'lowpass', 0.25); dur = 0.5; break;
      case 'teleport':
        this.tone('sine', 200, 1600, 0.5, 0.35, out); dur = 0.55; break;
      case 'arts':
        this.tone('sawtooth', 300, 1400, 0.7, 0.35, out); this.noiseBurst(0.7, 0.3, out, 3000, 2, 'bandpass'); dur = 0.75; break;
      case 'alarm':
        for (let i = 0; i < 16; i++) this.tone('square', i % 2 ? 1800 : 1500, i % 2 ? 1800 : 1500, 0.12, 0.25, out, i * 0.14); dur = 2.3; break;
      case 'sweep':
        for (let i = 0; i < 10; i++) this.noiseBurst(0.25, 0.4, out, 1800, 0.8, 'bandpass', i * 0.3); dur = 3; break;
      case 'jump':
        this.tone('square', 300, 600, 0.12, 0.15, out); dur = 0.15; break;
      case 'scare':
        this.tone('sawtooth', 120, 40, 1.2, 0.9, out); this.noiseBurst(1.0, 0.8, out, 1200); this.tone('square', 600, 90, 0.9, 0.35, out); dur = 1.3; break;
      case 'win':
        [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.3, out, i * 0.12)); dur = 1; break;
      // --- placeholders for Bully voice lines that are not supplied yet ---
      case 'bullysee':
        this.tone('sawtooth', 140, 110, 0.25, 0.4, out); this.tone('sawtooth', 120, 90, 0.35, 0.4, out, 0.3); dur = 0.7; break;
      case 'bullytake':
        this.tone('sawtooth', 160, 220, 0.2, 0.4, out); this.tone('sawtooth', 220, 140, 0.3, 0.4, out, 0.22); this.noiseBurst(0.15, 0.3, out, 900, 1, 'lowpass', 0.5); dur = 0.8; break;
      case 'bullypass':
        this.tone('sawtooth', 130, 70, 0.6, 0.45, out); dur = 0.7; break;
      default:
        this.tone('sine', 440, 220, 0.2, 0.2, out); break;
    }
    h.duration = dur;
    const dedupe = opts.dedupe === undefined ? key : opts.dedupe;
    if (dedupe) {
      this.playing.set(dedupe, h);
      setTimeout(() => { if (this.playing.get(dedupe) === h) this.playing.delete(dedupe); }, dur * 1000);
    }
    return h;
  }
}

export const audio = new AudioManager();
