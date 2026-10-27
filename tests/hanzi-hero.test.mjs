// 汉字勇者规则模块测试：抽题、计分、组字勾选、快照恢复与损坏处理。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRound, submitAnswer, advanceQuestion, togglePart, settlement, createSeededRng, parseSnapshot,
  QUESTIONS_PER_ROUND, FIRST_TRY_SCORE, RETRY_SCORE } from '../dist/game/hanzi-hero/rules.js';
import { evaluateAnswer } from '../dist/learning/evaluation.js';
import { hanziHeroExercises } from '../dist/content/hanzi-hero.js';

const seed = n => createSeededRng(n);

test('createRound draws exactly 5 unique tasks and avoids previous ids when possible', () => {
  const { rng } = seed(1);
  const round = createRound(hanziHeroExercises, [], rng);
  assert.equal(round.questions.length, QUESTIONS_PER_ROUND);
  assert.equal(new Set(round.questions.map(q => q.exerciseId)).size, QUESTIONS_PER_ROUND);
  assert.equal(round.phase, 'asking');
  // 上一局避重：23 个 fresh 足够时全部避开。
  const prevIds = round.questions.map(q => q.exerciseId);
  const round2 = createRound(hanziHeroExercises, prevIds, rng);
  assert.ok(round2.questions.every(q => !prevIds.includes(q.exerciseId)));
});

test('insufficient pool throws instead of starting a short round', () => {
  assert.throws(() => createRound(hanziHeroExercises.slice(0, 4), [], seed(2).rng), RangeError);
});

test('scoring: first try 10, after wrong 5; wrong does not score', () => {
  const { rng } = seed(3);
  const round = createRound(hanziHeroExercises, [], rng);
  const q = round.questions[0];
  const wrongTask = q.task.kind === 'hanzi-choose'
    ? q.task.options.find(o => o !== q.task.target)
    : undefined;
  if (q.task.kind === 'hanzi-choose' && wrongTask) {
    const w = submitAnswer(round, wrongTask);
    assert.equal(w.type, 'wrong');
    assert.equal(w.next.totalWrongCount, 1);
    assert.equal(w.next.score, 0);
    const c = submitAnswer(w.next, q.task.kind === 'hanzi-choose' ? q.task.target : '');
    assert.equal(c.type, 'correct');
    assert.equal(c.gained, RETRY_SCORE);
    assert.equal(c.next.score, RETRY_SCORE);
  } else {
    // 组字题为多选：提交错误集合再提交正确集合，断言同口径。
    const p = q.task;
    assert.equal(p.kind, 'hanzi-parts');
    const wrongSet = p.options.filter(o => !p.parts.includes(o)).slice(0, 2);
    const w = submitAnswer(round, wrongSet);
    assert.equal(w.type, 'wrong');
    const c = submitAnswer(w.next, p.parts);
    assert.equal(c.type, 'correct');
    assert.equal(c.gained, RETRY_SCORE);
  }
});

test('parts question: toggle accumulates selection, submit wrong set then correct set', () => {
  const { rng } = seed(4);
  const round = createRound(hanziHeroExercises, [], rng);
  const idx = round.questions.findIndex(q => q.task.kind === 'hanzi-parts');
  // 用固定组字题直接驱动 toggle/submit 状态机（不依赖洗牌落点）。
  const partsQuestion = { exerciseId: 'HZ-026', task: hanziHeroExercises.find(e => e.id === 'HZ-026').task };
  const state = { ...round, questions: [partsQuestion], questionIndex: 0 };
  const t1 = togglePart(state, '日');
  assert.deepEqual(t1.selectedParts, ['日']);
  const t2 = togglePart(t1, '月');
  assert.deepEqual(t2.selectedParts, ['日', '月']);
  const t3 = togglePart(t2, '日');
  assert.deepEqual(t3.selectedParts, ['月']);
  const wrong = submitAnswer(t3, ['口', '木']);
  assert.equal(wrong.type, 'wrong');
  assert.deepEqual(wrong.next.selectedParts, []); // 答错清空勾选
  const right = submitAnswer(togglePart(wrong.next, '月'), ['日', '月']);
  assert.equal(right.type, 'correct');
  assert.equal(right.gained, RETRY_SCORE);
  void idx; void rng;
});

test('full round to settlement: all first-try scores 50', () => {
  const { rng } = seed(5);
  let state = createRound(hanziHeroExercises, [], rng);
  for (let i = 0; i < QUESTIONS_PER_ROUND; i++) {
    const q = state.questions[state.questionIndex];
    const answer = q.task.kind === 'hanzi-choose' ? q.task.target : q.task.parts;
    const outcome = submitAnswer(state, answer);
    assert.equal(outcome.type, 'correct');
    assert.equal(outcome.gained, FIRST_TRY_SCORE);
    state = advanceQuestion(outcome.next);
  }
  assert.equal(state.phase, 'finished');
  const result = settlement(state);
  assert.deepEqual(result, { score: 50, firstTry: 5, wrong: 0, total: 5 });
});

test('snapshot round-trips: restore continues to identical settlement', () => {
  const handle = seed(6);
  let state = createRound(hanziHeroExercises, ['HZ-001', 'HZ-002'], handle.rng);
  // 答一题后保存快照。
  const q0 = state.questions[0];
  const outcome = submitAnswer(state, q0.task.kind === 'hanzi-choose' ? q0.task.target : q0.task.parts);
  state = advanceQuestion(outcome.next);
  const snapshot = {
    version: 1, gameId: 'hanzi-hero', roundId: 'r-1', state,
    rngState: handle.snapshot(), previousIds: ['HZ-001', 'HZ-002'],
  };
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.ok(parsed);
  // 从快照恢复续打至终局，与不间断参考局一致。
  handle.restore(parsed.rngState);
  let restored = parsed.state;
  while (restored.phase !== 'finished') {
    const q = restored.questions[restored.questionIndex];
    const o = submitAnswer(restored, q.task.kind === 'hanzi-choose' ? q.task.target : q.task.parts);
    restored = advanceQuestion(o.next);
  }
  const reference = { ...state };
  let cont = reference;
  while (cont.phase !== 'finished') {
    const q = cont.questions[cont.questionIndex];
    const o = submitAnswer(cont, q.task.kind === 'hanzi-choose' ? q.task.target : q.task.parts);
    cont = advanceQuestion(o.next);
  }
  assert.deepEqual(settlement(restored), settlement(cont));
});

test('corrupted snapshots are rejected safely', () => {
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({}), null);
  assert.equal(parseSnapshot({ version: 2, gameId: 'hanzi-hero' }), null);
  assert.equal(parseSnapshot({ version: 1, gameId: 'number-puzzle', roundId: 'x', state: {}, rngState: 0, previousIds: [] }), null);
  const { rng } = seed(7);
  const state = createRound(hanziHeroExercises, [], rng);
  const ok = parseSnapshot({ version: 1, gameId: 'hanzi-hero', roundId: 'r', state, rngState: 1, previousIds: [] });
  assert.ok(ok);
  assert.equal(parseSnapshot({ ...ok, rngState: -1 }), null);
  assert.equal(parseSnapshot({ ...ok, state: { ...state, phase: 'paused' } }), null);
});

test('all content tasks pass evaluateAnswer with their own answer', () => {
  for (const e of hanziHeroExercises) {
    const t = e.task;
    const answer = t.kind === 'hanzi-choose' ? t.target : t.parts;
    assert.equal(evaluateAnswer(t, answer), true, `${e.id} own answer must be correct`);
  }
});
