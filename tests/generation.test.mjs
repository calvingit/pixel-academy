import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, validateCatalog, answerFor } from '../dist/index.js';
import { generateExercises, selectRoundExercises } from '../dist/game/number-puzzle/generation.js';
import { loadGameContent } from '../dist/game/number-puzzle/content.js';
import { createSeededRng, restoreSeededRng } from '../dist/game/number-puzzle/random.js';
import { createRound, clickTile, completeResolve } from '../dist/game/number-puzzle/rules.js';


const content = loadGameContent();
const all = content.select([1, 2]);
const category = task => task.kind === 'binary' ? task.operator : task.kind;
const counts = rows => rows.reduce((result, row) => {
  const key = category(row.task);
  result[key] = (result[key] ?? 0) + 1;
  return result;
}, {});
const sample = (grades, seed, previous = []) =>
  selectRoundExercises(content.select(grades), content.gradeOf, createSeededRng(seed), previous);

test('all generated candidates satisfy reviewed bounds, associations and canonical uniqueness', () => {
  const generated = generateExercises();
  assert.deepEqual(validateCatalog({ ...catalog, exercises: generated }), []);
  assert.deepEqual(all, generated);
  assert.equal(new Set(all.map(e => e.id)).size, all.length);
  assert.equal(new Set(all.map(e => JSON.stringify(e.task))).size, all.length);
  assert.deepEqual(counts(content.select([1])), { number: 11, '+': 36, '-': 21 });
  assert.equal(all.filter(e => e.task.kind === 'binary' && e.task.operator === '*').length, 5);
  for (const exercise of all) {
    const task = exercise.task, grade = content.gradeOf(exercise), answer = answerFor(task);
    assert.equal(exercise.review.status, 'approved');
    assert.ok(answer >= 0 && answer <= (grade === 1 ? 10 : 100));
    if (task.kind === 'number') assert.equal(exercise.mappingIds[0], 'MAP-006');
    if (task.kind === 'binary') {
      const { left, right, operator } = task;
      if (operator === '+') {
        assert.ok(left <= right && left >= 0 && answer <= 10);
        assert.equal(exercise.mappingIds[0], answer <= 5 ? 'MAP-007' : 'MAP-010');
      } else if (operator === '-') {
        assert.ok(left <= 5 && right >= 0 && left >= right);
        assert.equal(exercise.mappingIds[0], 'MAP-008');
      } else {
        assert.ok(left >= 2 && left <= right && right <= 5 && answer >= 6 && answer <= 12);
        assert.equal(exercise.mappingIds[0], 'MAP-013');
      }
    }
    if (task.kind === 'chain') {
      assert.equal(exercise.mappingIds[0], 'MAP-011');
      assert.equal(task.steps.length, 2);
      let value = task.start;
      assert.ok(value >= 0 && value <= 100);
      for (const step of task.steps) {
        assert.ok(step.operand >= 1 && step.operand <= 10);
        value += step.operator === '+' ? step.operand : -step.operand;
        assert.ok(value >= 0 && value <= 100);
      }
      assert.equal(value, answer);
    }
  }
});

test('all 63 grade combinations filter without importing exercises from other grades', () => {
  for (let mask = 1; mask < 64; mask++) {
    const grades = [1, 2, 3, 4, 5, 6].filter(g => mask & (1 << (g - 1)));
    const rows = content.select(grades);
    assert.ok(rows.every(e => grades.includes(content.gradeOf(e))));
    if (!grades.includes(1) && !grades.includes(2)) assert.equal(rows.length, 0);
  }
  assert.equal(content.preview([1, 2]).length, 18);
});

test('quotas, within-round uniqueness, adjacent-round minimum overlap and seeded reproducibility', () => {
  for (const grades of [[1], [2], [1, 2], [1, 3], [2, 6]]) {
    let previous = [];
    for (let seed = 0; seed < 40; seed++) {
      const rows = sample(grades, seed, previous);
      assert.deepEqual(rows, sample(grades, seed, previous));
      assert.equal(rows.length, 10);
      assert.equal(new Set(rows.map(e => e.id)).size, 10);
      const mixed = grades.includes(1) && grades.includes(2);
      assert.deepEqual(counts(rows), mixed ? { number: 1, '+': 2, '-': 2, chain: 3, '*': 2 }
        : grades.includes(1) ? { number: 2, '+': 4, '-': 4 } : { chain: 6, '*': 4 });
      const overlap = rows.filter(e => previous.includes(e.id));
      assert.equal(overlap.length, previous.length && !mixed && grades.includes(2) ? 3 : 0);
      previous = rows.map(e => e.id);
    }
  }
  assert.throws(() => selectRoundExercises([], content.gradeOf, createSeededRng(1), []), RangeError);
  assert.throws(() => selectRoundExercises(content.select([1]).slice(0, 1), content.gradeOf, createSeededRng(1), []), RangeError);
});

test('dynamic rounds resume exactly from persisted tasks and RNG', () => {
  const finish = (initial, rng) => {
    let state = initial;
    while (state.phase !== 'finished') {
      const answer = answerFor(state.questions[state.questionIndex].task);
      state = completeResolve(clickTile(state, state.board.indexOf(answer), rng).state);
    }
    assert.equal(state.score, 100);
    return state;
  };
  for (const grades of [[1], [2], [1, 2]]) for (let seed = 0; seed < 10; seed++) {
    const rng = createSeededRng(seed);
    const selected = sample(grades, seed);
    const round = createRound({ exercises: selected, gradeOf: content.gradeOf, rng });
    const copied = JSON.parse(JSON.stringify(round));
    const restoredRng = restoreSeededRng(rng.snapshotState());
    assert.deepEqual(finish(round, rng), finish(copied, restoredRng));
  }
});
