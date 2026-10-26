import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, validateCatalog, answerFor } from '../dist/index.js';
import { generateExercises, selectRoundExercises } from '../dist/game/number-puzzle/generation.js';
import { loadGameContent } from '../dist/game/number-puzzle/content.js';
import { createSeededRng, restoreSeededRng } from '../dist/game/number-puzzle/random.js';
import { createRound, clickTile, submitChoice, completeResolve } from '../dist/game/number-puzzle/rules.js';


import { correctOptionIds, isMultiple } from '../dist/learning/choice.js';
import { taskIdentity } from '../dist/game/number-puzzle/learning.js';
const content = loadGameContent();
const all = content.select([1, 2]);
const category = task => task.kind === 'choice' ? isMultiple(task) ? 'multiple' : task.question.kind === 'truth' ? 'truth' : 'single' : task.kind === 'binary' ? task.operator : task.kind;
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
  assert.deepEqual(all, generated.filter(e => e.review.status === 'approved'));
  assert.equal(new Set(all.map(e => e.id)).size, all.length);
  for (const grade of [1,2]) { const pool = content.select([grade]); assert.equal(new Set(pool.map(e => taskIdentity(e.task))).size, pool.length); }
  assert.deepEqual(counts(content.select([1])), { number: 11, '+': 36, '-': 21, single: 555, truth: 425, multiple: 37 });
  assert.equal(all.filter(e => e.task.kind === 'binary' && e.task.operator === '*').length, 5);
  for (const exercise of all.filter(e => e.task.kind !== 'choice')) {
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
      assert.equal(new Set(rows.map(e => taskIdentity(e.task))).size, 10);
      const mixed = grades.includes(1) && grades.includes(2);
      assert.deepEqual(counts(rows), mixed ? { '+': 1, '-': 1, single: 2, multiple: 2, truth: 2, chain: 1, '*': 1 }
        : grades.includes(1) ? { '+': 2, '-': 2, single: 2, multiple: 2, truth: 2 } : { chain: 2, '*': 2, single: 2, multiple: 2, truth: 2 });
      const overlap = rows.filter(e => previous.includes(e.id));
      assert.equal(overlap.length, 0);
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
      const task = state.questions[state.questionIndex].task;
      const ids = task.kind === 'choice' ? correctOptionIds(task) : null;
      const step = ids ? submitChoice(state, isMultiple(task) ? ids : ids[0], rng) : clickTile(state, state.board.indexOf(answerFor(task)), rng);
      state = completeResolve(step.state);
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

test('family-first sampling gives every implemented family a real chance without duplicate semantics', () => {
  const seen = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const rows = sample([2], seed);
    const choices = rows.filter(e => e.task.kind === 'choice');
    const family = e => e.task.question.kind === 'extreme' ? `extreme:${e.task.options.length}` : e.task.question.kind === 'filter' ? `filter:${e.task.question.relation}`
      : e.task.question.kind === 'truth' ? `truth:${e.task.question.left.kind === 'number' ? 'number' : 'calculation'}` : e.task.question.kind;
    for (const e of choices) seen.add(family(e));
    for (const categoryName of ['single', 'multiple', 'truth']) {
      const group = choices.filter(e => category(e.task) === categoryName);
      assert.equal(group.length, 2);
      assert.equal(new Set(group.map(family)).size, 2);
    }
  }
  assert.deepEqual([...seen].sort(), ['extreme:2','extreme:4','symbol','missing','filter:>','filter:<','truth:number','truth:calculation','range','neighbor','sequence','composition','digit','expression-symbol','equivalent','groups','story'].sort());
});
