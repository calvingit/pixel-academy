import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, validateCatalog, createLearningCore, evaluateAnswer, validateTask, answerFor } from '../dist/index.js';
import { generateChoiceExercises } from '../dist/game/number-puzzle/choice-generation.js';
import { correctOptionIds, isMultiple } from '../dist/learning/choice.js';
import { createExerciseGradeIndex } from '../dist/game/number-puzzle/content.js';
import { taskIdentity, taskText, explainTask, answerFeedback } from '../dist/game/number-puzzle/learning.js';
import { createRound, toggleOption, submitChoice, completeResolve, reviveRound, startQuestion, useHint, useExtraTime, timeoutRound, roundReward } from '../dist/game/number-puzzle/rules.js';
import { createSeededRng, restoreSeededRng } from '../dist/game/number-puzzle/random.js';
import { parseMathTask } from '../dist/game/number-puzzle/storage.js';
import { createProfile, parseProfile, collectMistake, rewardReview, ProfileStore } from '../dist/game/number-puzzle/profile.js';

const rows = generateChoiceExercises();
const gradeOf = createExerciseGradeIndex(catalog);
const multiple = rows.find(e => e.task.question.kind === 'filter');
const exercise = task => ({ ...multiple, task });
const round = (e = multiple) => createRound({ exercises: [e], gradeOf, rng: createSeededRng(3) });
const arithmetic = t => t.kind === 'number' ? t.value : t.kind === 'binary'
  ? t.operator === '+' ? t.left + t.right : t.operator === '-' ? t.left - t.right : t.left * t.right
  : t.steps.reduce((n, step) => n + (step.operator === '+' ? step.operand : -step.operand), t.start);
const relation = (a, op, b) => op === '>' ? a > b : op === '<' ? a < b : a === b;
function expectedIds(task) {
  const q = task.question;
  if (q.kind === 'range') return task.options.filter(o => o.value > q.lower && o.value < q.upper).map(o => o.id);
  if (q.kind === 'digit') return task.options.filter(o => Math.floor(o.value / (q.place === 'ones' ? 1 : 10)) % 10 === q.digit).map(o => o.id);
  if (q.kind === 'equivalent') return task.options.filter(o => arithmetic(o.value) === q.target).map(o => o.id);
  if (q.kind === 'groups') return task.options.filter(o => o.value.kind === 'binary' && o.value.operator === '*' && o.value.left === q.each && o.value.right === q.groups).map(o => o.id);
  if (q.kind === 'filter') return task.options.filter(o => relation(o.value, q.relation, q.target)).map(o => o.id);
  const expected = q.kind === 'extreme' ? (q.direction === 'max' ? Math.max : Math.min)(...task.options.map(o => o.value))
    : q.kind === 'neighbor' ? q.value + (q.direction === 'before' ? -1 : 1)
    : q.kind === 'sequence' ? q.start + q.index * q.step
    : q.kind === 'composition' ? q.total - q.part
    : q.kind === 'story' ? q.start + (q.operator === '+' ? q.change : -q.change)
    : q.kind === 'expression-symbol' ? arithmetic(q.left) > arithmetic(q.right) ? '>' : arithmetic(q.left) < arithmetic(q.right) ? '<' : '='
    : q.kind === 'symbol' ? q.left > q.right ? '>' : q.left < q.right ? '<' : '='
    : q.kind === 'truth' ? relation(arithmetic(q.left), q.relation, arithmetic(q.right)) : q.total - q.addend;
  return task.options.filter(o => o.value === expected).map(o => o.id);
}

test('every generated choice has correct mathematics, reviewed bounds, unique IDs and complete seventeen-family coverage', () => {
  assert.equal(rows.length, 16381);
  assert.deepEqual(validateCatalog({ ...catalog, exercises: rows }), []);
  assert.equal(new Set(rows.map(e => e.id)).size, rows.length);
  for (const grade of [1, 2]) {
    const list = rows.filter(e => gradeOf(e) === grade);
    assert.equal(new Set(list.map(e => taskIdentity(e.task))).size, list.length);
    const families = new Set();
    for (const e of list) {
      const t = e.task, q = t.question, ids = expectedIds(t), max = grade === 1 ? 10 : 100;
      assert.deepEqual(correctOptionIds(t), ids);
      assert.deepEqual(parseMathTask(t), t);
      assert.ok(taskText(t).length > 0 && explainTask(t).length > 0);
      for (const o of t.options) if (typeof o.value === 'number') assert.ok(o.value >= 0 && o.value <= max);
      const operands = [...t.options.map(o => o.value).filter(v => typeof v === 'object'), ...(q.kind === 'truth' || q.kind === 'expression-symbol' ? [q.left, q.right] : [])];
      for (const operand of operands) {
        assert.ok(arithmetic(operand) >= 0 && arithmetic(operand) <= max);
        if (operand.kind === 'binary') assert.ok(operand.left >= 0 && operand.left <= max && operand.right >= 0 && operand.right <= max);
      }
      if (['filter', 'range', 'digit', 'equivalent'].includes(q.kind)) {
        families.add(q.kind === 'filter' ? `filter:${q.relation}` : q.kind);
        assert.equal(t.options.length, 6); assert.ok(ids.length >= 2 && ids.length <= 4);
        if (q.kind === 'filter') assert.ok(t.options.some(o => o.value === q.target));
        if (q.kind === 'range') assert.ok(t.options.some(o => o.value === q.lower) && t.options.some(o => o.value === q.upper));
        for (let mask = 0; mask < 64; mask++) {
          const selected = t.options.filter((_, i) => mask & (1 << i)).map(o => o.id);
          const same = selected.length === ids.length && selected.every(id => ids.includes(id));
          assert.equal(evaluateAnswer(t, selected), same);
        }
        assert.equal(evaluateAnswer(t, [...ids].reverse()), true);
        assert.equal(evaluateAnswer(t, [...ids, ids[0]]), false);
        assert.equal(evaluateAnswer(t, ids.join(',')), false);
      } else {
        families.add(q.kind === 'extreme' ? `extreme:${t.options.length}` : q.kind === 'truth' ? `truth:${q.left.kind === 'number' ? 'number' : 'calculation'}` : q.kind);
        for (const o of t.options) assert.equal(evaluateAnswer(t, o.id), ids.includes(o.id));
        assert.equal(evaluateAnswer(t, ids), false);
      }
      assert.equal(evaluateAnswer(t, 'unknown-id'), false);
      const reversed = { ...t, options: [...t.options].reverse() };
      assert.equal(taskIdentity(reversed), taskIdentity(t));
      assert.deepEqual([...correctOptionIds(reversed)].sort(), [...ids].sort());
    }
    assert.deepEqual([...families].sort(), ['extreme:2', 'extreme:4', 'filter:<', 'filter:>', 'missing', 'symbol', 'truth:calculation', 'truth:number', 'range', 'neighbor', 'sequence', 'composition', 'expression-symbol', 'equivalent', 'story', ...(grade === 2 ? ['digit', 'groups'] : [])].sort());
  }
});

test('draft isolation and all 63 grade combinations apply to expanded tasks', () => {
  const draftCore = createLearningCore({ ...catalog, exercises: rows.map(e => ({ ...e, review: { status: 'draft' } })) });
  const core = createLearningCore({ ...catalog, exercises: rows });
  for (let mask = 1; mask < 64; mask++) {
    const grades = [1,2,3,4,5,6].filter(g => mask & (1 << (g-1)));
    const query = { subject: 'math', grades, gameId: 'number-puzzle' };
    assert.deepEqual(draftCore.selectExercises(query), []);
    assert.ok(core.previewExercises(query).every(e => grades.includes(gradeOf(e))));
    assert.ok(core.selectExercises(query).every(e => grades.includes(gradeOf(e))));
  }
});

test('invalid structure, unsupported semantics, impossible choices and unsafe integers are rejected at storage and core boundaries', () => {
  const bad = [
    { ...multiple.task, options: multiple.task.options.slice(0, 5) },
    { ...multiple.task, options: multiple.task.options.map(o => ({ ...o, id: 'same' })) },
    { ...multiple.task, options: multiple.task.options.map(o => ({ ...o, value: 5 })) },
    { ...multiple.task, question: { kind: 'filter', relation: '=', target: 3 } },
    { ...multiple.task, question: { kind: 'filter', relation: '>', target: -100 } },
    { ...multiple.task, question: { kind: 'filter', relation: '>', target: 100 } },
    { ...multiple.task, question: { kind: 'unknown' } },
    { ...multiple.task, question: { kind: 'range', lower: 6, upper: 3 } },
    { ...multiple.task, question: { kind: 'digit', place: 'ones', digit: 10 } },
    { ...multiple.task, question: { kind: 'sequence', start: 0, step: 0, length: 5, index: 2 } },
    { ...multiple.task, question: { kind: 'sequence', start: Number.MAX_SAFE_INTEGER, step: 2, length: 5, index: 2 } },
    { ...multiple.task, question: { kind: 'composition', total: 2, part: 3 } },
    { ...multiple.task, question: { kind: 'story', start: 2, change: 3, operator: '-' } },
    { ...multiple.task, options: multiple.task.options.map((o, i) => i ? o : { ...o, value: Number.MAX_SAFE_INTEGER + 1 }) },
    { kind: 'choice', question: { kind: 'truth', left: { kind: 'number', value: 2 }, relation: '?', right: { kind: 'number', value: 3 } }, options: [{ id: 't', value: true }, { id: 'f', value: false }] },
    { kind: 'choice', question: { kind: 'symbol', left: 2, right: 3 }, options: [{ id: 'a', value: '>' }, { id: 'b', value: '<' }, { id: 'c', value: {} }] },
    { kind: 'choice', question: { kind: 'missing', total: 2, addend: 1 }, options: [{ id: 'a', value: 0 }, { id: 'b', value: 2 }] },
  ];
  for (const task of bad) {
    assert.equal(parseMathTask(task), null);
    assert.throws(() => validateTask(task));
    assert.ok(validateCatalog({ ...catalog, exercises: [exercise(task)] }).some(e => e.includes('Invalid task')));
  }
  assert.throws(() => answerFor(multiple.task), TypeError);
});

test('multi-select toggles do not score; submission is atomic, order independent and locked during resolve', () => {
  const rng = createSeededRng(8), ids = correctOptionIds(multiple.task);
  let s = round();
  const first = toggleOption(s, ids[0]);
  assert.equal(first.score, 0); assert.equal(first.totalWrongCount, 0); assert.deepEqual(first.board, s.board);
  assert.deepEqual(toggleOption(first, ids[0]).selectedIds, []);
  assert.equal(submitChoice(s, [], rng).outcome.type, 'ignored');
  assert.throws(() => toggleOption(s, 'not-an-option'), RangeError);
  for (const id of ids) s = toggleOption(s, id);
  const saved = JSON.parse(JSON.stringify(s));
  const restoredRng = restoreSeededRng(rng.snapshotState());
  const step = submitChoice(s, s.selectedIds, rng);
  assert.deepEqual(step, submitChoice(saved, saved.selectedIds, restoredRng));
  assert.equal(step.outcome.type, 'correct'); assert.equal(step.state.score, 10);
  assert.deepEqual(step.state.selectedIds, []);
  assert.equal(submitChoice(step.state, ids, rng).outcome.type, 'ignored');
  const done = completeResolve(step.state); assert.equal(done.result, 'passed'); assert.equal(roundReward(done), 12);
});

test('wrong sets, timeout, revive, hint and extra-time obey whole-question challenge rules', () => {
  const rng = createSeededRng(5), ids = correctOptionIds(multiple.task);
  let s = round();
  s = submitChoice(s, [ids[0]], rng).state;
  assert.equal(s.totalWrongCount, 1); assert.equal(s.score, 0);
  s = startQuestion(reviveRound(s)); assert.deepEqual(s.selectedIds, []);
  const wrong = multiple.task.options.find(o => !ids.includes(o.id)).id;
  s = submitChoice(s, [...ids, wrong], rng).state;
  assert.equal(s.totalWrongCount, 2);
  s = useHint(reviveRound(s)); assert.ok(s.hintUsed && s.assisted);
  s = useExtraTime(startQuestion(s)); assert.ok(s.timeUsed);
  const step = submitChoice(s, ids, rng); assert.equal(step.state.score, 5); assert.equal(step.state.firstTryCount, 0);
  assert.equal(roundReward(completeResolve(step.state)), 5);
  const expired = timeoutRound(toggleOption(round(), ids[0]));
  assert.equal(expired.totalWrongCount, 0); assert.equal(expired.totalTimeoutCount, 1);
  assert.equal(submitChoice(expired, ids, rng).outcome.type, 'ignored');
  assert.equal(timeoutRound(expired), expired);
});

test('practice selections, actual wrong answers and reward identities survive persistence and option reorder', async () => {
  // A test-only review fixture grants no production approval.
  const e = { ...multiple, review: { status: 'approved', reviewer: 'test-fixture-only', reviewedAt: '2026-10-26T00:00:00Z' } };
  const ids = correctOptionIds(e.task);
  let p = createProfile();
  p.practice = { courseId: null, reviewId: null, exercises: [e], index: 0, correct: 0, revealed: false, answered: false, passed: true, selectedIds: [ids[0]] };
  collectMistake(p, e, 1, 'wrong', [ids[0]]);
  assert.deepEqual(parseProfile(structuredClone(p)).practice.selectedIds, [ids[0]]);
  const identity = taskIdentity(e.task);
  assert.deepEqual(p.mistakes[identity].lastAnswer, [ids[0]]);
  assert.match(answerFeedback(e.task, [ids[0]]), /漏选/);
  assert.equal(rewardReview(p, identity, true), 2);
  collectMistake(p, { ...e, task: { ...e.task, options: [...e.task.options].reverse() } }, 1, 'wrong', ids);
  collectMistake(p, { ...e, id: 'same-task-grade2' }, 2, 'wrong', ids);
  assert.equal(p.mistakes[identity].grade, 2); assert.equal(p.mistakes[identity].exercise.id, e.id);
  assert.equal(Object.keys(p.mistakes).length, 1); assert.equal(rewardReview(p, identity, true), 0);
  assert.equal(p.mistakes[identity].mastered, false);
  const bad = structuredClone(p); bad.practice.selectedIds = ['unknown']; assert.throws(() => parseProfile(bad));
  const duplicate = structuredClone(p); duplicate.practice.selectedIds = [ids[0], ids[0]]; assert.throws(() => parseProfile(duplicate));
  let persisted = structuredClone(p);
  const store = new ProfileStore({ read: async () => persisted, update: async (_, value) => { persisted = structuredClone(value); } });
  p = await store.commit(p, draft => { draft.practice.selectedIds = ids; });
  assert.deepEqual((await store.load(createProfile)).practice.selectedIds, ids);
  p.challenge = { id: 'test', grades: [1], state: toggleOption(round(e), ids[0]), rngState: 3,
    contentVersion: 'test', paused: true, remainingMs: 5000, deadline: null, timerKind: 'question' };
  assert.deepEqual(parseProfile(structuredClone(p)).challenge.state.selectedIds, [ids[0]]);
  const old = createProfile(); old.coins = 17; old.cards.time = 3; old.settledRounds = ['old-award'];
  assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(old))), old);
});


test('subtraction judgement and mixed arithmetic comparison match the design examples', () => {
  const judgement = rows.find(e => { const q = e.task.question; return q.kind === 'truth' && q.left.kind === 'binary' && q.left.operator === '-' && q.left.left === 7 && q.left.right === 3 && q.right.value === 5; }).task;
  const falseId = judgement.options.find(o => o.value === false).id;
  assert.equal(evaluateAnswer(judgement, falseId), true);
  assert.match(explainTask(judgement), /7 − 3 = 4/);
  const comparison = rows.find(e => { const q = e.task.question; return q.kind === 'expression-symbol' && arithmetic(q.left) === 7 && q.right.kind === 'binary' && q.right.operator === '-' && q.right.left === 9 && q.right.right === 1; }).task;
  assert.equal(evaluateAnswer(comparison, comparison.options.find(o => o.value === '<').id), true);
  assert.match(taskText(comparison), /9 − 1/);
});
