// 数字消除规则测试（docs/gameplay-number-puzzle.md）。
// 与 learning.test.mjs 一样从 dist 导入编译结果执行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, createLearningCore, answerFor } from '../dist/index.js';
import {
  createRound, clickTile, reviveRound, startQuestion, useHint, completeResolve,
  BOARD_TILES, QUESTIONS_PER_ROUND, START_THRESHOLD, FIRST_TRY_SCORE, RETRY_SCORE,
  HINT_THRESHOLD, SAME_VALUE_CAP, TIER_RANGES, tierForGrade,
} from '../dist/game/number-puzzle/rules.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';
import { describeAvailability, loadGameContent, createExerciseGradeIndex } from '../dist/game/number-puzzle/content.js';

const resumeAfterWrong = state => startQuestion(reviveRound(state));
const query = grades => ({ subject: 'math', grades, gameId: 'number-puzzle' });
// 固定样本用于棋盘、随机消耗顺序与旧局次回归；动态入口在 generation.test.mjs 验证。
const loadedContent = loadGameContent();
const content = { ...loadedContent, select: loadedContent.preview };
const gradeOf = content.gradeOf;
const unionExercises = grades => content.select(grades);
// 严格序列随机源：耗尽即抛错，用于核对精确的消耗顺序。
const sequenceRng = values => {
  let used = 0;
  return {
    rng: () => {
      if (used >= values.length) throw new Error('rng exhausted');
      return values[used++];
    },
    get calls() { return used },
  };
};
const counting = rng => {
  let used = 0;
  return { rng: () => { used++; return rng(); }, get calls() { return used } };
};
// Fisher–Yates 中 j = floor(0.999999 × (i+1)) = i，即恒等洗牌：局序保持数据顺序。
const identityShuffle = n => Array.from({ length: Math.max(n - 1, 0) }, () => 0.999999);
const tierAFloat = value => (value + 0.5) / 11;
const tierBFloat = value => (value + 0.5) / 101;
const synthetic = (id, value) => ({
  id, subject: 'math', mappingIds: ['MAP-006'], gameIds: ['number-puzzle'],
  task: { kind: 'number', value },
  review: { status: 'approved', reviewer: 'rules-test', reviewedAt: '2026-10-25T00:00:00Z' },
});
// 用同一注入 rng 完整打完一局；wrongOn 为真时先点一个错误块再答对。
const playRound = (state, rng, wrongOn = () => false) => {
  let current = state;
  while (current.phase !== 'finished') {
    if (current.phase === 'asking') {
      const answer = answerFor(current.questions[current.questionIndex].task);
      if (wrongOn(current)) {
        const wrongIndex = current.board.findIndex(slot => slot !== answer);
        assert.ok(wrongIndex !== -1);
        current = resumeAfterWrong(clickTile(current, wrongIndex, rng).state);
      }
      const hit = current.board.findIndex(slot => slot === answer);
      const step = clickTile(current, hit, rng);
      assert.equal(step.outcome.type, 'correct');
      current = step.state;
    } else if (current.phase === 'resolving') {
      current = startQuestion(completeResolve(current));
    } else {
      assert.fail(`unexpected phase ${current.phase}`);
    }
  }
  return current;
};
const startAndPlay = (grades, seed, wrongOn) => {
  const rng = createSeededRng(seed);
  return playRound(createRound({ exercises: unionExercises(grades), gradeOf, rng }), rng, wrongOn);
};

test('constants and grade tiers match the gameplay spec', () => {
  assert.equal(BOARD_TILES, 12);
  assert.equal(QUESTIONS_PER_ROUND, 10);
  assert.equal(START_THRESHOLD, 5);
  assert.equal(FIRST_TRY_SCORE, 10);
  assert.equal(RETRY_SCORE, 5);
  assert.equal(HINT_THRESHOLD, 2);
  assert.equal(SAME_VALUE_CAP, 2);
  assert.deepEqual(TIER_RANGES.A, { min: 0, max: 10 });
  assert.deepEqual(TIER_RANGES.B, { min: 0, max: 100 });
  assert.equal(tierForGrade(1), 'A');
  assert.equal(tierForGrade(2), 'B');
  for (const grade of [3, 4, 5, 6]) assert.throws(() => tierForGrade(grade), RangeError);
  assert.throws(() => createRound({ exercises: [], gradeOf, rng: createSeededRng(1) }), RangeError);
});

test('rng consumption order: shuffle first, then initial board, then per-answer fills', () => {
  const exercises = unionExercises([1, 2]);
  const boardValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 0, 1];
  const seq = sequenceRng([
    ...identityShuffle(exercises.length),          // 局序洗牌（identity：j = i）
    ...boardValues.map(tierAFloat),                // 初始棋盘（首题 MATH-001 档位 A）
    tierAFloat(3),                                 // 第 1 题答对后的补块（下一题档位 A）
  ]);
  const state = createRound({ exercises, gradeOf, rng: seq.rng });
  // 恒等洗牌 → 取数据顺序前 10 道：MATH-001…MATH-010。
  assert.deepEqual(state.questions.map(q => q.exerciseId),
    ['MATH-001', 'MATH-002', 'MATH-003', 'MATH-004', 'MATH-005',
      'MATH-006', 'MATH-007', 'MATH-008', 'MATH-009', 'MATH-010']);
  assert.equal(state.phase, 'asking');
  assert.deepEqual(state.board, boardValues);
  assert.equal(seq.calls, 17 + 12); // 洗牌 17 次 + 初始棋盘 12 次，无同值重取
  // 首题答案 0 已在场，保证规则通过；点击 index 0 答对 → 按下一题档位 A 补块 3。
  const step = clickTile(state, 0, seq.rng);
  assert.equal(step.outcome.type, 'correct');
  assert.deepEqual(step.outcome.fill, { index: 0, value: 3 });
  assert.equal(step.outcome.guarantee, null);
  assert.equal(step.state.board[0], 3);
  assert.equal(seq.calls, 17 + 12 + 1); // 仅答对补块消耗 rng
});

test('same seed with the same click order reproduces the identical round', () => {
  const exercises = unionExercises([1, 2]);
  const replay = (seed, withEvents) => {
    const rng = createSeededRng(seed); // 单一序列：createRound 与逐题补块共用
    let state = createRound({ exercises, gradeOf, rng });
    const events = [];
    while (state.phase !== 'finished') {
      const answer = answerFor(state.questions[state.questionIndex].task);
      const hit = state.board.findIndex(slot => slot === answer);
      const step = clickTile(state, hit, rng);
      if (withEvents) events.push(step.outcome);
      state = completeResolve(step.state);
    }
    return { state, events };
  };
  const runA = replay(20261025, true);
  const runB = replay(20261025, true);
  assert.deepEqual(runA.events, runB.events);
  assert.deepEqual(runA.state, runB.state);
  assert.equal(runA.state.phase, 'finished');
  assert.ok(runA.state.score > 0);
  const runC = replay(99, true);
  assert.ok(
    JSON.stringify(runA.events) !== JSON.stringify(runC.events) ||
      JSON.stringify(runA.state.board) !== JSON.stringify(runC.state.board),
    'different seeds should not reproduce the same round',
  );
  // 同一种子重开一局（再来一局的复现口径）：新序列得到同一局序与棋盘。
  const again = createRound({ exercises, gradeOf, rng: createSeededRng(20261025) });
  const first = createRound({ exercises, gradeOf, rng: createSeededRng(20261025) });
  assert.deepEqual(again, first);
});

test('wrong answers never eliminate, never score and lock input during feedback', () => {
  const rng = createSeededRng(7);
  let state = createRound({ exercises: unionExercises([1, 2]), gradeOf, rng });
  assert.throws(() => clickTile(state, BOARD_TILES, rng), RangeError);
  assert.throws(() => clickTile(state, -1, rng), RangeError);
  const answer = answerFor(state.questions[0].task);
  const wrongIndex = state.board.findIndex(slot => slot !== answer);
  assert.ok(wrongIndex !== -1, 'a non-answer tile always exists (same-value cap 2)');
  const boardBefore = structuredClone(state.board);
  const countingRng = counting(rng);
  const wrong = clickTile(state, wrongIndex, countingRng.rng);
  assert.equal(wrong.outcome.type, 'wrong');
  assert.equal(wrong.outcome.wrongCount, 1);
  assert.equal(wrong.outcome.hintActive, false);
  assert.equal(wrong.state.phase, 'interrupted');
  assert.equal(wrong.state.score, 0);
  assert.equal(wrong.state.totalWrongCount, 1);
  assert.deepEqual(wrong.state.board, boardBefore, 'wrong click must not eliminate or fill any tile');
  assert.equal(countingRng.calls, 0, 'wrong clicks consume no rng');
  // 反馈窗口内的点击一律忽略：不判错、不累计错误数。
  const duringFeedback = clickTile(wrong.state, wrongIndex, countingRng.rng);
  assert.equal(duringFeedback.outcome.type, 'ignored');
  assert.deepEqual(duringFeedback.state, wrong.state);
  state = resumeAfterWrong(wrong.state);
  assert.equal(state.phase, 'asking');
  // 第二次错误仍不自动提示，复活后手动用卡。
  const second = clickTile(state, wrongIndex, rng);
  assert.equal(second.outcome.hintActive, false);
  state = startQuestion(useHint(reviveRound(second.state)));
  assert.equal(state.hintUsed, true);
  // 答错后答对：+5 分，不计一次通过。
  const hit = state.board.findIndex(slot => slot === answer);
  const corrected = clickTile(state, hit, rng);
  assert.equal(corrected.outcome.type, 'correct');
  assert.equal(corrected.outcome.firstTry, false);
  assert.equal(corrected.outcome.gainedScore, RETRY_SCORE);
  assert.equal(corrected.state.score, 5);
  assert.equal(corrected.state.firstTryCount, 0);
  assert.equal(corrected.state.totalWrongCount, 2);
  assert.equal(corrected.state.currentWrongCount, 0);
  state = completeResolve(corrected.state);
  assert.equal(state.phase, 'ready');
  assert.equal(state.questionIndex, 1);
});

test('repeated clicks during resolve are ignored and never score twice', () => {
  const rng = createSeededRng(11);
  let state = createRound({ exercises: unionExercises([1, 2]), gradeOf, rng });
  const answer = answerFor(state.questions[0].task);
  const hit = state.board.findIndex(slot => slot === answer);
  const step = clickTile(state, hit, rng);
  assert.equal(step.outcome.type, 'correct');
  assert.equal(step.outcome.gainedScore, FIRST_TRY_SCORE);
  assert.equal(step.state.score, 10);
  assert.equal(step.state.phase, 'resolving');
  state = step.state;
  const afterFirst = structuredClone({ score: state.score, board: state.board, questionIndex: state.questionIndex });
  for (const index of [hit, (hit + 1) % BOARD_TILES, (hit + 5) % BOARD_TILES]) {
    const again = clickTile(state, index, rng);
    assert.equal(again.outcome.type, 'ignored');
    assert.deepEqual(again.state, state);
  }
  assert.deepEqual({ score: state.score, board: state.board, questionIndex: state.questionIndex }, afterFirst);
  state = completeResolve(state);
  assert.equal(state.phase, 'asking');
  const nextAnswer = answerFor(state.questions[state.questionIndex].task);
  assert.ok(state.board.includes(nextAnswer), 'next question answer must be reachable after resolve');
});

test('a full round completes with expected scoring and settlement stats', () => {
  const allFirstTry = startAndPlay([1, 2], 21);
  assert.equal(allFirstTry.phase, 'finished');
  assert.equal(allFirstTry.questions.length, 10);
  assert.equal(new Set(allFirstTry.questions.map(q => q.exerciseId)).size, 10);
  assert.equal(allFirstTry.score, 100);
  assert.equal(allFirstTry.firstTryCount, 10);
  assert.equal(allFirstTry.totalWrongCount, 0);
  // 前 2 题各复活一次后答对：8 × 10 + 2 × 5 = 90。
  const withWrongs = startAndPlay([1, 2], 22, state => state.questionIndex < 2);
  assert.equal(withWrongs.score, 90);
  assert.equal(withWrongs.firstTryCount, 8);
  assert.equal(withWrongs.totalWrongCount, 2);
  // 二年级单选只有 6 道可用：一局题数 = 可用数。
  const grade2 = startAndPlay([2], 23);
  assert.equal(grade2.questions.length, 6);
  assert.equal(grade2.score, 60);
  assert.equal(grade2.firstTryCount, 6);
});

test('no unsolvable board, no null slot and no value above the cap across many seeds', () => {
  const exercises = unionExercises([1, 2]);
  for (let seed = 1; seed <= 30; seed++) {
    const rng = createSeededRng(seed);
    const wrongPicker = createSeededRng(seed * 7919 + 13);
    let state = createRound({ exercises, gradeOf, rng });
    while (state.phase !== 'finished') {
      if (state.phase === 'asking') {
        const answer = answerFor(state.questions[state.questionIndex].task);
        assert.ok(state.board.includes(answer), `seed ${seed} q${state.questionIndex}: answer ${answer} missing`);
        assert.equal(state.board.length, BOARD_TILES);
        assert.ok(state.board.every(slot => slot !== null), 'operable board must keep 12 tiles');
        for (const value of new Set(state.board)) {
          assert.ok(state.board.filter(slot => slot === value).length <= SAME_VALUE_CAP,
            `seed ${seed}: value ${value} exceeds the same-value cap`);
        }
        if (wrongPicker() < 0.5 && state.revivals < 2) {
          const wrongIndex = state.board.findIndex(slot => slot !== answer);
          const wrong = clickTile(state, wrongIndex, rng);
          assert.equal(wrong.outcome.type, 'wrong');
          assert.ok(wrong.state.board.includes(answer), 'wrong click must not remove the answer');
          state = resumeAfterWrong(wrong.state);
        }
        const hit = state.board.findIndex(slot => slot === answer);
        state = clickTile(state, hit, rng).state;
      } else if (state.phase === 'resolving') {
        state = startQuestion(completeResolve(state));
      } else {
        assert.fail(`unexpected phase ${state.phase}`);
      }
    }
    assert.equal(state.phase, 'finished');
    assert.ok(state.score > 0 && state.score <= state.questions.length * FIRST_TRY_SCORE);
  }
});

test('guarantee rule replaces the first non-future-answer tile, then again for the next question', () => {
  // 二年级 6 道（数据顺序 MATH-013…018），恒等洗牌后首题 MATH-013（答案 30+20−10 = 40）。
  const exercises = unionExercises([2]);
  const boardValues = [70, 35, 6, 12, 10, 90, 80, 35, 6, 12, 10, 90];
  const seq = sequenceRng([
    ...identityShuffle(exercises.length),
    ...boardValues.map(tierBFloat),
    tierBFloat(70), // 第 1 题答对后的补块（下一题 MATH-014 档位 B）
  ]);
  let state = createRound({ exercises, gradeOf, rng: seq.rng });
  assert.deepEqual(state.questions.map(q => q.exerciseId),
    ['MATH-013', 'MATH-014', 'MATH-015', 'MATH-016', 'MATH-017', 'MATH-018']);
  // 初始棋盘无 40：保证规则把第一个非后续答案块（index 0，值 70）改为 40。
  assert.equal(state.board[0], 40);
  assert.deepEqual(state.board, [40, 35, 6, 12, 10, 90, 80, 35, 6, 12, 10, 90]);
  const step = clickTile(state, 0, seq.rng);
  assert.equal(step.outcome.type, 'correct');
  assert.deepEqual(step.outcome.fill, { index: 0, value: 70 });
  // 下一题 MATH-014 答案 50 不在场（补块 70 后仍缺）：第一个非后续答案块仍是 index 0 → 改为 50。
  assert.deepEqual(step.outcome.guarantee, { index: 0, from: 70, to: 50 });
  state = completeResolve(step.state);
  assert.equal(state.phase, 'asking');
  assert.equal(state.board[0], 50);
  assert.ok(state.board.includes(50));
});

test('guarantee fallback replaces the first tile when every tile holds a future answer', () => {
  const exercises = [
    synthetic('SYN-00', 99),
    ...[10, 20, 30, 40, 50, 60, 70, 80, 90].map((value, i) => synthetic(`SYN-${String(i + 1).padStart(2, '0')}`, value)),
  ];
  const boardValues = [10, 10, 20, 20, 30, 30, 40, 40, 50, 50, 60, 60];
  const seq = sequenceRng([
    ...identityShuffle(exercises.length),
    ...boardValues.map(tierBFloat),
    tierBFloat(75),
  ]);
  let state = createRound({ exercises, gradeOf: () => 2, rng: seq.rng });
  // 所有块都是后续题答案值（{10,20,30,40,50,60,70,80,90}），当前题答案 99 不在场 → 兜底分支改 index 0。
  assert.equal(state.board[0], 99);
  assert.deepEqual(state.board, [99, ...boardValues.slice(1)]);
  const step = clickTile(state, 0, seq.rng);
  assert.equal(step.outcome.type, 'correct');
  assert.deepEqual(step.outcome.fill, { index: 0, value: 75 });
  assert.equal(step.outcome.guarantee, null); // 下一题答案 10 已在场
  state = completeResolve(step.state);
  assert.equal(state.phase, 'asking');
  assert.ok(state.board.includes(10));
});

test('availability scenarios follow the documented copy and judgment order', () => {
  assert.equal(content.gradeOf(catalog.exercises[0]), 1);
  assert.equal(content.gradeOf(catalog.exercises[12]), 2);
  const describe = (grades, preview = false) =>
    describeAvailability(preview ? content.preview : content.select, grades, { preview });
  assert.deepEqual(describe([1]), {
    startable: true, statusText: null, rangeText: '一年级 12 道，共 12 道',
    unionExercises: content.select([1]), unionCount: 12, availableGrades: [1], emptyGrades: [],
  });
  assert.equal(describe([2]).rangeText, '二年级 6 道，共 6 道');
  assert.equal(describe([1, 2]).rangeText, '一年级 12 道、二年级 6 道，共 18 道');
  assert.equal(describe([1, 2]).unionCount, 18);
  const onlyEmpty = describe([3]);
  assert.equal(onlyEmpty.startable, false);
  assert.equal(onlyEmpty.statusText, '三年级暂无已审核的数学练习。当前开放：一年级、二年级（数学）。');
  assert.equal(describe([3, 4]).statusText, '三年级、四年级暂无已审核的数学练习。当前开放：一年级、二年级（数学）。');
  const mixed = describe([1, 3]);
  assert.equal(mixed.startable, true);
  assert.equal(mixed.statusText, '本局练习来自：一年级。三年级暂无内容。');
  assert.equal(mixed.availableGrades.length, 1);
  assert.equal(mixed.emptyGrades.length, 1);
  assert.equal(describe([2, 5]).statusText, '本局练习来自：二年级。五年级暂无内容。');
});

test('official entry without approved content and preview counting drafts (custom catalogs)', () => {
  const withExercises = list => ({ ...structuredClone(catalog), exercises: list });
  const draft = (id, value) => ({ ...synthetic(id, value), review: { status: 'draft' } });
  const selectOf = (data, previews) => {
    const core = createLearningCore(withExercises(data));
    return grades => (previews ? core.previewExercises : core.selectExercises)(query(grades));
  };
  // 5 道草稿：正式入口全局 approved 为 0（场景 1）；预览口径草稿计入可用数，达到阈值可开始。
  const drafts = [1, 2, 3, 4, 5].map(value => draft(`PV-${String(value).padStart(2, '0')}`, value));
  const officialEmpty = describeAvailability(selectOf(drafts, false), [1], { preview: false });
  assert.equal(officialEmpty.startable, false);
  assert.equal(officialEmpty.statusText, '正式练习尚未就绪，暂时无法开始。请返回调整年级选择。');
  const previewDrafts = describeAvailability(selectOf(drafts, true), [1], { preview: true });
  assert.equal(previewDrafts.startable, true);
  assert.equal(previewDrafts.statusText, null);
  assert.equal(previewDrafts.rangeText, '一年级 5 道，共 5 道');
  // 3 道 approved：并集低于阈值 5（场景 3）；混选无题年级时先说明来源再追加不足提示。
  const few = [0, 1, 3].map((value, i) => synthetic(`FEW-${String(i + 1).padStart(2, '0')}`, value));
  const officialFew = selectOf(few, false);
  const below = describeAvailability(officialFew, [1], { preview: false });
  assert.equal(below.startable, false);
  assert.equal(below.statusText, '可用练习不足 5 道，暂时无法开始。请返回调整年级选择。');
  const belowMixed = describeAvailability(officialFew, [1, 3], { preview: false });
  assert.equal(belowMixed.startable, false);
  assert.equal(belowMixed.statusText,
    '本局练习来自：一年级。三年级暂无内容。可用练习不足 5 道，暂时无法开始。请返回调整年级选择。');
});

test('grade index mirrors the mapping chain used by Learning Core', () => {
  const gradeOfDirect = createExerciseGradeIndex(catalog);
  const gradesOf = new Map(catalog.mappings.map(mapping => [mapping.id,
    new Set(mapping.unitIds.map(unitId =>
      catalog.textbooks.find(book => book.id === catalog.units.find(unit => unit.id === unitId).textbookId).grade))]));
  for (const exercise of catalog.exercises) {
    const expected = Math.max(...exercise.mappingIds.flatMap(id => [...gradesOf.get(id)]));
    assert.equal(gradeOfDirect(exercise), expected);
  }
});
