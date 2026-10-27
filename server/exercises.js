// Training exercises are physical, in-world activities: you move around the exercise room and
// press keys (E / G / Space...). The server generates each one (positions come from the room's
// free cells), checks every positional step against the player's real position, and validates
// the result. Exercise 2 is AJAN's trick: its last prompt is impossible.
import { cellCenter } from '../shared/map.js';

export const EXERCISE_TYPES = ['pushups', 'impossible', 'cones', 'order', 'fryer', 'mop', 'boxes'];
export const RANDOM_TYPES = ['cones', 'order', 'fryer', 'mop', 'boxes'];

export const EXERCISE_INFO = {
  pushups:    { title: 'PUSH-UPS',        blurb: 'Press the keys shown, alternating E and G, as fast as you can!' },
  impossible: { title: 'REACTION KEYS',   blurb: 'Press each key as it appears.' },
  sequence:   { title: 'REACTION KEYS',   blurb: 'Press each key as it appears.' },
  cones:      { title: 'CONE SPRINT',     blurb: 'Run to the glowing cone and press E. Hit them all before time runs out.' },
  order:      { title: 'ORDER RUN',       blurb: 'Grab the food in order (E), then bring it to the counter.' },
  fryer:      { title: 'KITCHEN TIMING',  blurb: 'Press E when the needle is in the green zone, 3 times.' },
  mop:        { title: 'CLEAN-UP',        blurb: 'Walk to each spill and HOLD E to mop it up.' },
  boxes:      { title: 'BOX CARRY',       blurb: 'Pick up a box (E) and carry it to the shelf (E). 3 boxes.' },
};

const KEYS = ['E', 'G', 'R', 'F', 'T', 'Q', 'C', 'V', 'X', 'Z'];
const IMPOSSIBLE_KEYS = ['Ж', 'Ω', '¿', '§', 'ß'];
const FOODS = ['burger', 'fries', 'soda', 'bucket', 'pie', 'nuggets'];

function pickCells(rng, cells, n, minGap = 3) {
  const out = [];
  const pool = rng.shuffle(cells.slice());
  for (const c of pool) {
    const p = cellCenter(c[0], c[1]);
    if (out.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= minGap * 2.5)) out.push(p);
    if (out.length >= n) break;
  }
  while (out.length < n && pool.length) out.push(cellCenter(...pool[out.length % pool.length]));
  return out.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
}

// ctx: { cells: free cells of the room, station: {x, z} }
export function generateExercise(type, rng, ctx = { cells: [[10, 10], [14, 10], [10, 14], [14, 14], [18, 18], [6, 6]], station: { x: 30, z: 30 } }) {
  const st = { x: +ctx.station.x.toFixed(2), z: +ctx.station.z.toFixed(2) };
  switch (type) {
    case 'pushups':
      return { spec: { type, keys: ['E', 'G'], count: 16, time: 20 }, solution: 16 };
    case 'sequence':
    case 'impossible': {
      const keys = rng.shuffle(KEYS.slice()).slice(0, 5);
      if (type === 'impossible') keys[4] = rng.pick(IMPOSSIBLE_KEYS);
      return { spec: { type, keys, perKey: 2.2 }, solution: keys };
    }
    case 'cones': {
      const pts = pickCells(rng, ctx.cells, 5, 2);
      return { spec: { type, time: 40, steps: pts.map((p) => ({ ...p, kind: 'cone' })) }, solution: pts.length };
    }
    case 'order': {
      const pts = pickCells(rng, ctx.cells, 3, 2);
      const foods = rng.shuffle(FOODS.slice()).slice(0, 3);
      const steps = pts.map((p, i) => ({ ...p, kind: 'food', food: foods[i] }));
      steps.push({ ...st, kind: 'counter' });
      return { spec: { type, time: 50, steps }, solution: steps.length };
    }
    case 'fryer': {
      const zones = [];
      for (let i = 0; i < 3; i++) {
        const width = 0.14 + rng() * 0.06;
        zones.push({ start: 0.1 + rng() * (0.8 - width), width });
      }
      return { spec: { type, zones, speed: 0.55 + rng() * 0.25, maxMisses: 2 }, solution: zones };
    }
    case 'mop': {
      const pts = pickCells(rng, ctx.cells, 4, 2);
      return { spec: { type, time: 50, hold: 1.0, steps: pts.map((p) => ({ ...p, kind: 'spill', hold: 1.0 })) }, solution: pts.length };
    }
    case 'boxes': {
      const pts = pickCells(rng, ctx.cells, 4, 2);
      const shelf = pts[0];
      const steps = [];
      for (let i = 1; i <= 3; i++) steps.push({ ...pts[i], kind: 'box' }, { ...shelf, kind: 'shelf' });
      return { spec: { type, time: 60, steps }, solution: steps.length };
    }
    default:
      throw new Error('unknown exercise type ' + type);
  }
}

// Positional step check: is the player standing at step i (and held long enough)?
export function validateStep(pend, i, player, now) {
  const steps = pend.spec.steps;
  if (!steps) return { ok: false, err: 'This exercise has no steps.' };
  if (i !== pend.stepIdx) return { ok: false, err: 'Wrong order!' };
  const s = steps[i];
  if (!s) return { ok: false, err: 'No such step.' };
  if (Math.hypot(s.x - player.x, s.z - player.z) > 2.8) return { ok: false, err: 'Get closer!' };
  if (s.hold && now - (pend.lastStepAt ?? pend.servedAt) < s.hold * 0.8) return { ok: false, err: 'Hold it longer!' };
  if (pend.spec.time && now - pend.servedAt > pend.spec.time + 3) return { ok: false, err: "Time's up!" };
  pend.stepIdx++;
  pend.lastStepAt = now;
  return { ok: true, done: pend.stepIdx >= steps.length };
}

// Returns { ok, reason? }. elapsed = seconds since the exercise was served.
export function validateExercise(type, solution, spec, answer, elapsed, pend = null) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'No answer.' };
  switch (type) {
    case 'pushups': {
      const n = answer.count | 0;
      if (n < solution) return { ok: false, reason: 'Not enough push-ups!' };
      if (elapsed < solution * 0.09) return { ok: false, reason: 'Too fast to be real.' };
      if (elapsed > spec.time + 3) return { ok: false, reason: 'Too slow!' };
      return { ok: true };
    }
    case 'sequence': {
      const seq = Array.isArray(answer.sequence) ? answer.sequence : [];
      if (elapsed < 1) return { ok: false, reason: 'Too fast to be real.' };
      return seq.length === solution.length && seq.every((k, i) => k === solution[i]) ? { ok: true } : { ok: false, reason: 'Wrong key!' };
    }
    case 'impossible':
      // nobody can press that last key
      return { ok: false, reason: 'WRONG!', impossible: true };
    case 'fryer': {
      const hits = Array.isArray(answer.hits) ? answer.hits : [];
      if (hits.length !== 3) return { ok: false, reason: 'Burnt!' };
      if (elapsed < 1.2) return { ok: false, reason: 'Too fast to be real.' };
      for (let i = 0; i < 3; i++) {
        const z = solution[i], h = Number(hits[i]);
        if (!(h >= z.start - 0.015 && h <= z.start + z.width + 0.015)) return { ok: false, reason: 'Burnt!' };
      }
      return { ok: true };
    }
    case 'cones': case 'order': case 'mop': case 'boxes': {
      if (!pend || pend.stepIdx < spec.steps.length) return { ok: false, reason: answer.timeout ? "Time's up!" : 'Not finished!' };
      if (elapsed > spec.time + 3) return { ok: false, reason: "Time's up!" };
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'Unknown exercise.' };
  }
}

// Reference solver used by tests: returns { steps: [positions to stand at], answer }.
export function solveExercise(type, spec, solution) {
  switch (type) {
    case 'pushups': return { answer: { count: solution } };
    case 'sequence': return { answer: { sequence: solution.slice() } };
    case 'impossible': return { answer: { sequence: solution.slice() } };
    case 'fryer': return { answer: { hits: solution.map((z) => z.start + z.width / 2) } };
    default: return { steps: spec.steps, answer: { done: true } };
  }
}
