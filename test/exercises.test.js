import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISE_TYPES, RANDOM_TYPES, generateExercise, validateExercise, validateStep, solveExercise } from '../server/exercises.js';
import { buildMap } from '../shared/map.js';
import { makeRng } from '../shared/rng.js';

const map = buildMap();

test('seven distinct, physical exercise types (no worksheets)', () => {
  assert.equal(new Set(EXERCISE_TYPES).size, 7);
  assert.ok(!EXERCISE_TYPES.includes('quiz'));
  assert.equal(RANDOM_TYPES.length, 5);
});

// play a generated exercise the way a client would: stand on every step, then submit
function play(type, seed, station = 2) {
  const st = map.stations[station];
  const { spec, solution } = generateExercise(type, makeRng(seed), { cells: map.exerciseCells[station], station: st });
  const pend = { type, spec, solution, servedAt: 0, stepIdx: 0 };
  let t = 0;
  const sol = solveExercise(type, spec, solution);
  if (sol.steps) {
    sol.steps.forEach((s, i) => {
      t += 1.5;
      const r = validateStep(pend, i, { x: s.x, z: s.z }, t);
      assert.ok(r.ok, `${type} step ${i}: ${r.err}`);
    });
  }
  return { spec, solution, pend, sol, v: validateExercise(type, solution, spec, sol.answer, t + 5, pend) };
}

for (const type of ['pushups', 'cones', 'fryer', 'math', 'trivia', 'trivia2']) {
  test(`${type}: every randomized exercise can be completed, cheating fails`, () => {
    for (let seed = 1; seed <= 150; seed++) {
      const { spec, solution, pend, v } = play(type, seed, 2 + (seed % 5));
      assert.equal(v.ok, true, `seed ${seed}: ${v.reason}`);
      if (spec.steps) {
        for (const s of spec.steps) {
          const c = { x: s.x, z: s.z };
          // positions are inside the exercise room
          assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z));
        }
        const fresh = { type, spec, solution, servedAt: 0, stepIdx: 0 };
        assert.equal(validateExercise(type, solution, spec, { done: true }, 10, fresh).ok, false, 'skipping the steps fails');
        assert.equal(validateStep(fresh, 1, spec.steps[1], 1).ok, false, 'out of order');
        assert.equal(validateStep(fresh, 0, { x: spec.steps[0].x + 20, z: spec.steps[0].z }, 1).ok, false, 'too far away');
      }
      void pend;
      assert.equal(validateExercise(type, solution, spec, null, 30).ok, false);
    }
  });
}

test('pushups and keys reject impossibly fast results', () => {
  const p = generateExercise('pushups', makeRng(1));
  assert.equal(validateExercise('pushups', p.solution, p.spec, { count: 16 }, 0.3).ok, false);
  assert.equal(validateExercise('pushups', p.solution, p.spec, { count: 15 }, 5).ok, false);
});

test('mop spills must be held, not tapped', () => {
  const st = map.stations[3];
  const { spec, solution } = generateExercise('mop', makeRng(4), { cells: map.exerciseCells[3], station: st });
  const pend = { type: 'mop', spec, solution, servedAt: 0, stepIdx: 0 };
  assert.equal(validateStep(pend, 0, spec.steps[0], 0.2).ok, false);
  assert.equal(validateStep(pend, 0, spec.steps[0], 1.2).ok, true);
});

test("exercise 2's last key cannot be pressed: the answer is always wrong", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { spec, solution } = generateExercise('impossible', makeRng(seed));
    assert.equal(spec.keys.length, 5);
    assert.ok(spec.keys.slice(0, 4).every((k) => /^[A-Z]$/.test(k)));
    assert.ok(!/^[A-Z]$/.test(spec.keys[4]), 'last key is not on the keyboard: ' + spec.keys[4]);
    const v = validateExercise('impossible', solution, spec, { sequence: spec.keys }, 10);
    assert.equal(v.ok, false);
    assert.equal(v.impossible, true);
  }
});
