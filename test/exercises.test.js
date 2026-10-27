import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISE_TYPES, generateExercise, validateExercise, solveExercise } from '../server/exercises.js';
import { makeRng } from '../shared/rng.js';

test('there are seven distinct exercise types', () => {
  assert.equal(new Set(EXERCISE_TYPES).size, 7);
});

for (const type of EXERCISE_TYPES) {
  test(`${type}: every randomized puzzle is solvable and wrong answers fail`, () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rng = makeRng(seed);
      const { spec, solution } = generateExercise(type, rng);
      assert.ok(!JSON.stringify(spec).includes('"solution"'));
      const good = solveExercise(type, spec, solution);
      assert.equal(validateExercise(type, solution, spec, good, 30).ok, true, `seed ${seed}`);
      assert.equal(validateExercise(type, solution, spec, {}, 30).ok, false);
      assert.equal(validateExercise(type, solution, spec, null, 30).ok, false);
    }
  });
}

test('quality control always has exactly one problem line', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const { spec, solution } = generateExercise('qc', makeRng(seed));
    let okLines = 0;
    for (let i = 0; i < spec.ticket.length; i++) if (validateExercise('qc', solution, spec, { line: i }, 5).ok) okLines++;
    assert.equal(okLines, 1);
    // the chosen line really differs from the tray
    const t = spec.ticket[solution];
    assert.ok(!spec.tray.some((x) => x.item === t.item && x.qty === t.qty));
  }
});

test('quiz answers are not always in the same position', () => {
  const pos = new Set();
  for (let seed = 1; seed <= 50; seed++) generateExercise('quiz', makeRng(seed)).solution.forEach((a) => pos.add(a));
  assert.ok(pos.size >= 3);
});

test('timing and prep reject impossibly fast submissions', () => {
  const t = generateExercise('timing', makeRng(3));
  assert.equal(validateExercise('timing', t.solution, t.spec, solveExercise('timing', t.spec, t.solution), 0.2).ok, false);
  const p = generateExercise('prep', makeRng(3));
  assert.equal(validateExercise('prep', p.solution, p.spec, solveExercise('prep', p.spec, p.solution), 0.5).ok, false);
});
