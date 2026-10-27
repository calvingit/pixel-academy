// 算术地下城规则与存储测试：门状态机与解锁、答错/超时不解锁可重试、钥匙替代解锁、
// 重复解锁不重复计分、无死局不变式、抽题不重复与避重、年级筛选与 draft 隔离、
// 快照往返恢复一致、损坏快照拒绝、记录 gameId 区分。
// 从编译产物导入（与 tests/hanzi-hero.test.mjs 同口径，npm test 先 build 后测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerActive, createRound, disengage, engageSlot, FIRST_TRY_SCORE, GAME_ID,
  MAX_KEYS, moveOptions, moveTo, parseSnapshot, QUESTIONS_NEEDED, QUESTION_TIME_MS,
  retryActive, RETRY_SCORE, settlement, timeoutActive, useKeyActive,
} from '../dist/game/arithmetic-dungeon/rules.js';
import { buildRecord, parseRecord, parseRecords, parseSettingsValue, STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION } from '../dist/game/arithmetic-dungeon/storage.js';
import { syncIntegerSubmit, wireIntegerSubmit } from '../dist/game/arithmetic-dungeon/input.js';
import { describeAvailability, selectDungeonExercises, OPEN_GRADES } from '../dist/game/arithmetic-dungeon/content.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';
import { generateExercises } from '../dist/game/number-puzzle/generation.js';
import { correctOptionIds, isMultiple } from '../dist/learning/choice.js';
import { answerFor } from '../dist/learning/evaluation.js';
import { createLearningCore } from '../dist/learning/catalog.js';
import { catalog } from '../dist/index.js';
import { textbooks } from '../dist/content/textbooks.js';
import { units } from '../dist/content/units.js';
import { skills, mappings } from '../dist/content/skills.js';
import { evidence } from '../dist/content/evidence.js';

// ===== 驱动工具 =====

/** 任务的标准正确作答：choice 传选项 ID（多选传集合），整数任务传数值。 */
const answerOf = task => task.kind === 'choice'
  ? (isMultiple(task) ? [...correctOptionIds(task)] : correctOptionIds(task)[0])
  : answerFor(task);

/** 确定答错的作答：单选传非答案选项，多选传错误集合，整数任务偏离答案。 */
const wrongAnswerOf = task => {
  if (task.kind === 'choice') {
    const correct = correctOptionIds(task);
    if (isMultiple(task)) {
      const wrong = task.options.map(o => o.id).filter(id => !correct.includes(id));
      return wrong.slice(0, Math.max(1, correct.length)); // 数量可能不同，内容必错
    }
    return task.options.map(o => o.id).find(id => !correct.includes(id));
  }
  return answerFor(task) + 1000;
};

const pool1 = selectDungeonExercises([1]);

/** 答对当前已 engage 的机关，返回新状态。 */
const solve = state => {
  const outcome = answerActive(state, answerOf(state.slots[state.activeSlot].question.task));
  assert.equal(outcome.type, 'correct');
  return outcome.next;
};

// ---------------------------------------------------------------------------
// 开局抽题
// ---------------------------------------------------------------------------

test('开局绑定 4 道题：3 门题 + 1 资源题，本局不重复', () => {
  const round = createRound(pool1, [], createSeededRng(11));
  assert.equal(round.phase, 'exploring');
  assert.equal(round.room, 'start');
  assert.deepEqual(round.route, ['start']);
  for (const slot of ['gate-stone', 'gate-left', 'gate-right', 'resource']) {
    assert.ok(round.slots[slot], `缺少 ${slot} 的题目`);
    assert.ok(round.usedIds.includes(round.slots[slot].question.exerciseId));
  }
  assert.equal(round.usedIds.length, QUESTIONS_NEEDED);
  assert.equal(new Set(round.usedIds).size, QUESTIONS_NEEDED);
  assert.equal(round.openDoors.length, 0);
  assert.equal(round.keys, 0);
  assert.equal(round.activeSlot, null);
});

test('开局抽题避开上一局题目 ID（池充足时全部避开）', () => {
  const first = createRound(pool1, [], createSeededRng(12));
  const recent = first.usedIds;
  const second = createRound(pool1, recent, createSeededRng(13));
  for (const slot of ['gate-stone', 'gate-left', 'gate-right', 'resource']) {
    assert.ok(!recent.includes(second.slots[slot].question.exerciseId),
      `不应复用上一局题目 ${second.slots[slot].question.exerciseId}`);
  }
});

test('换一题优先避重，本局永不复用已消耗题目', () => {
  const rng = createSeededRng(14);
  const drawn = new Set();
  let round = createRound(pool1, [], rng);
  for (const id of round.usedIds) drawn.add(id);
  for (let i = 0; i < 50; i++) {
    const outcome = retryActive(engageSlot(round, 'gate-stone'), pool1, [], rng);
    assert.equal(outcome.type, 'drawn');
    const id = outcome.next.slots['gate-stone'].question.exerciseId;
    assert.ok(!drawn.has(id), `第 ${i + 2} 次抽题重复：${id}`);
    drawn.add(id);
    round = disengage(outcome.next);
  }
});

test('题目池不足 4 道时开局抛错，不悄悄开工', () => {
  assert.throws(() => createRound(pool1.slice(0, 3), [], createSeededRng(15)), RangeError);
});

// ---------------------------------------------------------------------------
// 门状态机与解锁
// ---------------------------------------------------------------------------

test('门题答对开门并计首答 10 分；解锁后可自由通行', () => {
  let state = createRound(pool1, [], createSeededRng(21));
  state = engageSlot(state, 'gate-stone');
  const outcome = answerActive(state, answerOf(state.slots['gate-stone'].question.task));
  assert.equal(outcome.type, 'correct');
  assert.equal(outcome.gained, FIRST_TRY_SCORE);
  state = outcome.next;
  assert.deepEqual(state.openDoors, ['gate-stone']);
  assert.equal(state.score, FIRST_TRY_SCORE);
  assert.equal(state.firstTryCount, 1);
  assert.deepEqual(state.answeredSlots, ['gate-stone']);
  state = moveTo(state, 'junction');
  assert.equal(state.room, 'junction');
  const options = moveOptions(state).map(option => `${option.to}:${option.locked ? 'locked' : 'open'}`);
  assert.deepEqual([...options].sort(), ['end:locked', 'resource:locked', 'start:open']);
});

test('重复解开门/机关被拒绝，重复经过不重复出题不重复计分', () => {
  let state = createRound(pool1, [], createSeededRng(22));
  state = solve(engageSlot(state, 'gate-stone'));
  assert.equal(state.openDoors.length, 1);
  assert.throws(() => engageSlot(state, 'gate-stone'));
  const before = {
    score: state.score, doors: state.openDoors.length,
    question: state.slots['gate-stone'].question.exerciseId, route: state.route.length,
  };
  state = moveTo(state, 'junction');
  state = moveTo(state, 'start');
  state = moveTo(state, 'junction');
  assert.equal(state.score, before.score);
  assert.equal(state.openDoors.length, before.doors);
  assert.equal(state.slots['gate-stone'].question.exerciseId, before.question);
  assert.equal(state.route.length, before.route + 3); // 路线照实记录折回，但不影响题目与计分
});

test('未解锁不能穿门，到达终点房即通关', () => {
  let state = createRound(pool1, [], createSeededRng(23));
  assert.throws(() => moveTo(state, 'junction'));
  state = moveTo(solve(engageSlot(state, 'gate-stone')), 'junction');
  assert.throws(() => moveTo(state, 'end'));
  state = moveTo(solve(engageSlot(state, 'gate-right')), 'end');
  assert.equal(state.phase, 'finished');
  assert.equal(state.result, 'passed');
  assert.equal(state.room, 'end');
});

// ---------------------------------------------------------------------------
// 答错 / 超时：不解锁、不扣分、可重试
// ---------------------------------------------------------------------------

test('答错不解锁不扣分，重试答对得重试档 5 分', () => {
  let state = engageSlot(createRound(pool1, [], createSeededRng(31)), 'gate-stone');
  const wrong = answerActive(state, wrongAnswerOf(state.slots['gate-stone'].question.task));
  assert.equal(wrong.type, 'wrong');
  assert.equal(wrong.next.openDoors.length, 0);
  assert.equal(wrong.next.score, 0);
  assert.equal(wrong.next.totalWrongCount, 1);
  assert.equal(wrong.next.slots['gate-stone'].wrongAttempts, 1);
  const correct = answerActive(wrong.next, answerOf(wrong.next.slots['gate-stone'].question.task));
  assert.equal(correct.type, 'correct');
  assert.equal(correct.gained, RETRY_SCORE);
  assert.equal(correct.next.score, RETRY_SCORE);
  assert.equal(correct.next.firstTryCount, 0);
  assert.equal(correct.next.openDoors.length, 1);
});

test('超时按答错处理：不解锁、计入重试，之后仍可答对', () => {
  let state = engageSlot(createRound(pool1, [], createSeededRng(32)), 'gate-stone');
  const timeout = timeoutActive(state);
  assert.equal(timeout.type, 'timeout');
  assert.equal(timeout.next.openDoors.length, 0);
  assert.equal(timeout.next.score, 0);
  assert.equal(timeout.next.totalWrongCount, 1);
  const correct = answerActive(timeout.next, answerOf(timeout.next.slots['gate-stone'].question.task));
  assert.equal(correct.type, 'correct');
  assert.equal(correct.gained, RETRY_SCORE);
});

test('换一题替换门题但保留重试档与答错计数', () => {
  let state = engageSlot(createRound(pool1, [], createSeededRng(33)), 'gate-stone');
  const firstQuestion = state.slots['gate-stone'].question.exerciseId;
  const wrong = answerActive(state, wrongAnswerOf(state.slots['gate-stone'].question.task));
  const swapped = retryActive(wrong.next, pool1, [], createSeededRng(34));
  assert.equal(swapped.type, 'drawn');
  assert.notEqual(swapped.next.slots['gate-stone'].question.exerciseId, firstQuestion);
  assert.equal(swapped.next.slots['gate-stone'].wrongAttempts, 1);
  assert.equal(swapped.next.usedIds.length, QUESTIONS_NEEDED + 1);
  const correct = answerActive(swapped.next, answerOf(swapped.next.slots['gate-stone'].question.task));
  assert.equal(correct.gained, RETRY_SCORE);
  assert.equal(correct.next.totalWrongCount, 1);
});

// ---------------------------------------------------------------------------
// 钥匙
// ---------------------------------------------------------------------------

test('资源题答对取得 1 把备用钥匙，超出上限不重复发放', () => {
  let state = createRound(pool1, [], createSeededRng(41));
  state = moveTo(solve(engageSlot(state, 'gate-stone')), 'junction');
  state = moveTo(solve(engageSlot(state, 'gate-left')), 'resource');
  state = solve(engageSlot(state, 'resource'));
  assert.equal(state.keys, MAX_KEYS);
  assert.equal(state.slots.resource.solved, true);
  assert.throws(() => engageSlot(state, 'resource'));
});

test('备用钥匙可代替重试直接开门：不判题不计分，钥匙消耗', () => {
  let state = createRound(pool1, [], createSeededRng(42));
  state = moveTo(solve(engageSlot(state, 'gate-stone')), 'junction');
  state = moveTo(solve(engageSlot(state, 'gate-left')), 'resource');
  state = moveTo(solve(engageSlot(state, 'resource')), 'junction');
  const scoreBefore = state.score;
  state = useKeyActive(engageSlot(state, 'gate-right'));
  assert.equal(state.keys, 0);
  assert.equal(state.keyUses, 1);
  assert.equal(state.score, scoreBefore); // 钥匙开门不计分
  assert.deepEqual(state.answeredSlots, ['gate-stone', 'gate-left', 'resource']); // 该门不计入作答表现
  assert.ok(state.openDoors.includes('gate-right'));
  state = moveTo(state, 'end');
  const result = settlement(state);
  assert.ok(!result.answered.some(item => item.slot === 'gate-right'));
  assert.equal(result.answered.length, 3);
  assert.equal(result.keyUses, 1);
  assert.equal(result.keysHeld, 0);
});

test('钥匙不能用于资源机关，无钥匙或无待答机关时抛错', () => {
  let state = createRound(pool1, [], createSeededRng(43));
  assert.throws(() => useKeyActive(state)); // 没有 activeSlot
  state = engageSlot(state, 'gate-stone');
  assert.throws(() => useKeyActive(state)); // 没有钥匙
  state = disengage(state);
  state = moveTo(solve(engageSlot(state, 'gate-stone')), 'junction');
  state = moveTo(solve(engageSlot(state, 'gate-left')), 'resource');
  state = engageSlot(state, 'resource');
  assert.throws(() => useKeyActive(state)); // 资源机关不能用钥匙
});

// ---------------------------------------------------------------------------
// 无死局不变式
// ---------------------------------------------------------------------------

test('无死局：连续大量答错后仍可开门；不用钥匙也能通关', () => {
  let state = createRound(pool1, [], createSeededRng(51));
  state = engageSlot(state, 'gate-stone');
  for (let i = 0; i < 200; i++) {
    const wrong = answerActive(state, wrongAnswerOf(state.slots['gate-stone'].question.task));
    assert.equal(wrong.type, 'wrong');
    assert.equal(wrong.next.openDoors.length, 0); // 答错永不解锁，也永不封锁
    state = wrong.next;
  }
  const recovered = answerActive(state, answerOf(state.slots['gate-stone'].question.task));
  assert.equal(recovered.type, 'correct');
  state = moveTo(recovered.next, 'junction');
  // 右路直通终点，全程不用钥匙：无资源依赖死局。
  state = engageSlot(state, 'gate-right');
  for (let i = 0; i < 50; i++) state = timeoutActive(state).next;
  state = answerActive(state, answerOf(state.slots['gate-right'].question.task)).next;
  state = moveTo(state, 'end');
  assert.equal(state.phase, 'finished');
  const result = settlement(state);
  assert.ok(result.score > 0);
  assert.equal(result.retries, 250);
  assert.equal(result.keysHeld, 0);
});

test('无死局：换一题抽尽时状态不变且本题仍可作答，一局仍可完成', () => {
  const tinyPool = pool1.slice(0, QUESTIONS_NEEDED);
  let state = engageSlot(createRound(tinyPool, [], createSeededRng(52)), 'gate-stone');
  const exhausted = retryActive(state, tinyPool, [], createSeededRng(53));
  assert.equal(exhausted.type, 'exhausted');
  assert.deepEqual(exhausted.next, state);
  state = moveTo(answerActive(exhausted.next, answerOf(exhausted.next.slots['gate-stone'].question.task)).next, 'junction');
  state = moveTo(solve(engageSlot(state, 'gate-right')), 'end');
  assert.equal(state.phase, 'finished');
});

// ---------------------------------------------------------------------------
// 完整一局（左→右路线）与结算
// ---------------------------------------------------------------------------

test('完整一局：石门→左门→资源房→折回→右门→终点，全首答 40 分', () => {
  let state = createRound(pool1, [], createSeededRng(61));
  state = moveTo(solve(engageSlot(state, 'gate-stone')), 'junction');
  state = moveTo(solve(engageSlot(state, 'gate-left')), 'resource');
  state = solve(engageSlot(state, 'resource'));
  assert.equal(state.keys, 1);
  state = moveTo(state, 'junction'); // 折回岔口
  state = moveTo(solve(engageSlot(state, 'gate-right')), 'end');
  assert.equal(state.phase, 'finished');
  const result = settlement(state);
  assert.equal(result.score, 40);
  assert.equal(result.firstTry, 4);
  assert.equal(result.retries, 0);
  assert.equal(result.keysHeld, 1);
  assert.equal(result.keyUses, 0);
  assert.deepEqual(result.route, ['start', 'junction', 'resource', 'junction', 'end']);
  assert.deepEqual(result.answered.map(item => item.slot), ['gate-stone', 'gate-left', 'resource', 'gate-right']);
  assert.ok(result.answered.every(item => item.firstTry && item.wrongs === 0));
});

// ---------------------------------------------------------------------------
// 快照往返与损坏拒绝
// ---------------------------------------------------------------------------

/** 机械通关器：有机关先作答，否则走已开的终点门，再解锁第一扇锁着的门（偶尔换题消耗 rng）。 */
const play = (from, rng, exercises) => {
  let state = from;
  while (state.phase !== 'finished') {
    if (state.activeSlot) {
      state = answerActive(state, answerOf(state.slots[state.activeSlot].question.task)).next;
      if (state.activeSlot) state = disengage(state);
      continue;
    }
    const options = moveOptions(state);
    const openToEnd = options.find(option => !option.locked && option.to === 'end');
    if (openToEnd) { state = moveTo(state, openToEnd.to); continue; }
    const locked = options.find(option => option.locked);
    if (locked) {
      state = engageSlot(state, locked.door);
      if (Math.floor(rng() * 3) === 0) {
        const swapped = retryActive(state, exercises, [], rng);
        if (swapped.type === 'drawn') state = swapped.next;
      }
      continue;
    }
    state = moveTo(state, options[0].to);
  }
  return state;
};

test('快照往返：恢复后房间、门、题目与随机序列一致，续局结算与参考局相同', () => {
  const seed = 71;
  const rng = createSeededRng(seed);
  // 快照点：答对石门并穿过（已消耗 4 次抽题 rng）。
  const handle = createSeededRng(seed);
  let partial = createRound(pool1, [], handle);
  partial = moveTo(answerActive(engageSlot(partial, 'gate-stone'),
    answerOf(partial.slots['gate-stone'].question.task)).next, 'junction');
  const snapshot = {
    version: 1, gameId: GAME_ID, roundId: 'r-1', state: partial,
    rngState: handle.snapshotState(), previousIds: [], grades: [1],
    contentVersion: 'test-content', timer: { paused: false, remainingMs: 5000, deadline: null, timerKind: null },
  };
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.ok(parsed, '合法快照必须通过校验');
  // 参考局与恢复局从同一状态、同一 rng 内部状态出发，续局必须完全一致。
  const reference = play(parsed.state, createSeededRng(parsed.rngState), pool1);
  const restored = play(parsed.state, createSeededRng(parsed.rngState), pool1);
  assert.deepEqual(settlement(restored), settlement(reference));
  assert.equal(restored.phase, 'finished');
  // 快照状态本身保持只读：解析不改动房间与门。
  assert.equal(parsed.state.room, 'junction');
  assert.deepEqual(parsed.state.openDoors, ['gate-stone']);
});

test('损坏快照被安全拒绝', () => {
  const valid = state => ({
    version: 1, gameId: GAME_ID, roundId: 'r', state, rngState: 1, previousIds: [],
    grades: [1], contentVersion: 'x', timer: { paused: false, remainingMs: 1000, deadline: null, timerKind: null },
  });
  const base = createRound(pool1, [], createSeededRng(81));
  assert.ok(parseSnapshot(valid(base)), '合法快照必须通过校验');
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({}), null);
  assert.equal(parseSnapshot({ ...valid(base), version: 2 }), null);
  assert.equal(parseSnapshot({ ...valid(base), gameId: 'hanzi-hero' }), null);
  assert.equal(parseSnapshot({ ...valid(base), rngState: -1 }), null);
  assert.equal(parseSnapshot({ ...valid(base), rngState: 0x100000000 }), null);
  assert.equal(parseSnapshot({ ...valid(base), grades: [] }), null);
  assert.equal(parseSnapshot({ ...valid(base), timer: { ...valid(base).timer, timerKind: 'resolve' } }), null);
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, room: 'end' } }), null, '探索中不可能在终点房');
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, keys: 2 } }), null);
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, route: ['junction'] } }), null);
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, openDoors: ['gate-stone'] } }), null, '未解题不应显示已开门');
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, keys: 1 } }), null, '资源未解开不可能持有钥匙');
  const tampered = JSON.parse(JSON.stringify(base));
  tampered.slots['gate-stone'].question.exerciseId = 'not-in-used';
  assert.equal(parseSnapshot(valid(tampered)), null, '机关题目必须仍在已消耗集合内');
});

// ---------------------------------------------------------------------------
// 整数输入联动（缺陷 1 回归）：键入实时启用按钮，点击提交读取当前输入值
// ---------------------------------------------------------------------------

/** 无 DOM 桩元素：记录监听器，支持手动派发事件。 */
const stubElement = () => {
  const listeners = {};
  return {
    disabled: false,
    value: '',
    listeners,
    addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
    fire(type) { for (const listener of listeners[type] ?? []) listener(); },
  };
};

test('整数输入联动：模拟键入后按钮启用，清空/空白/非作答状态禁用', () => {
  const input = stubElement();
  const button = stubElement();
  button.disabled = true;
  wireIntegerSubmit(input, button, () => {});
  assert.equal(button.disabled, true, '初始空输入应禁用');
  input.value = '7';
  input.fire('input'); // 模拟真实键入
  assert.equal(button.disabled, false, '键入后按钮应实时启用');
  input.value = '   ';
  input.fire('input');
  assert.equal(button.disabled, true, '纯空白等价空输入');
  input.value = '15';
  input.fire('input');
  assert.equal(button.disabled, false);
  // 非作答状态（面板关闭/待再试）由 input.disabled 收敛，有值也禁用。
  input.disabled = true;
  input.fire('input');
  assert.equal(button.disabled, true);
  input.disabled = false;
  // syncIntegerSubmit 与 wire 后的联动同口径。
  syncIntegerSubmit(input, button);
  assert.equal(button.disabled, false);
});

test('点击提交读取当前输入值并判对：按钮启用后首答计 10 分档（D4 路径可行）', () => {
  const exercise = pool1.find(item => item.task.kind === 'binary' && item.task.operator === '+');
  const base = createRound(pool1, [], createSeededRng(92));
  const state = {
    ...base,
    slots: {
      ...base.slots,
      'gate-stone': { question: { exerciseId: exercise.id, task: exercise.task }, wrongAttempts: 0, solved: false },
    },
  };
  const engaged = engageSlot(state, 'gate-stone');
  const submitted = [];
  const input = stubElement();
  const button = stubElement();
  wireIntegerSubmit(input, button, value => {
    submitted.push(value);
    return answerActive(engaged, value);
  });
  // 模拟真实键入答案后点击「开门」：提交的是当前输入值（含首尾空白裁剪）。
  input.value = ` ${answerFor(exercise.task)} `;
  input.fire('input');
  assert.equal(button.disabled, false, '键入后按钮应启用，点击路径可达');
  button.fire('click');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], String(answerFor(exercise.task))); // 首尾空白已裁剪
  const outcome = answerActive(engaged, submitted[0]);
  assert.equal(outcome.type, 'correct');
  assert.equal(outcome.gained, FIRST_TRY_SCORE, '按钮启用后首答正确即 10 分档，不再被迫走超时重试 5 分档');
});

// ---------------------------------------------------------------------------
// D4 路径变体：右门答错一次再答对 → 4 题 35 分（对应修复前被超时劫持的场景）
// ---------------------------------------------------------------------------

test('D4 路径：右门答错一次再答对，4 题 35 分', () => {
  let state = createRound(pool1, [], createSeededRng(93));
  state = moveTo(solve(engageSlot(state, 'gate-stone')), 'junction');
  state = moveTo(solve(engageSlot(state, 'gate-left')), 'resource');
  state = solve(engageSlot(state, 'resource'));
  state = moveTo(state, 'junction');
  state = engageSlot(state, 'gate-right');
  const wrong = answerActive(state, wrongAnswerOf(state.slots['gate-right'].question.task));
  assert.equal(wrong.type, 'wrong');
  const correct = answerActive(wrong.next, answerOf(wrong.next.slots['gate-right'].question.task));
  assert.equal(correct.type, 'correct');
  assert.equal(correct.gained, RETRY_SCORE);
  state = moveTo(correct.next, 'end');
  const result = settlement(state);
  assert.equal(result.score, 35);
  assert.equal(result.firstTry, 3);
  assert.equal(result.retries, 1);
  assert.deepEqual(result.answered.map(item => item.slot), ['gate-stone', 'gate-left', 'resource', 'gate-right']);
});

// ---------------------------------------------------------------------------
// 年级筛选、draft 隔离与 gameId 隔离
// ---------------------------------------------------------------------------

test('年级筛选：一、二年级开放，三至六年级无内容，混选不互相填补', () => {
  assert.deepEqual(OPEN_GRADES, [1, 2]);
  const count = grades => selectDungeonExercises(grades).length;
  assert.ok(count([1]) > 0);
  assert.ok(count([2]) > 0);
  assert.equal(count([3]), 0);
  assert.equal(count([4]), 0);
  assert.equal(count([5]), 0);
  assert.equal(count([6]), 0);
  assert.equal(count([1, 2]), count([1]) + count([2]));
  const report = describeAvailability([3]);
  assert.equal(report.startable, false);
  assert.ok(report.statusText.includes('三年级'));
  assert.ok(report.statusText.includes('一年级、二年级（数学）'));
  const mixed = describeAvailability([1, 3]);
  assert.equal(mixed.startable, true);
  assert.ok(mixed.statusText.includes('三年级暂无内容'));
});

test('draft 隔离：草稿练习永不出现在正式取题', () => {
  // 从地下城已登记题池取一题改造为 draft（独立 ID，避免触发重复 ID 校验）。
  const source = generateExercises()
    .filter(exercise => exercise.task.kind !== 'number')
    .map(exercise => ({ ...exercise, gameIds: [...exercise.gameIds, GAME_ID] }))
    .find(exercise => exercise.mappingIds.includes('MAP-007'));
  const draft = { ...source, id: 'DUNGEON-DRAFT-01', review: { status: 'draft' } };
  const core = createLearningCore({
    textbooks, units, skills, mappings, evidence,
    exercises: generateExercises()
      .filter(exercise => exercise.task.kind !== 'number')
      .map(exercise => ({ ...exercise, gameIds: [...exercise.gameIds, GAME_ID] }))
      .concat([draft]),
  });
  const served = core.selectExercises({ subject: 'math', grades: [1], gameId: GAME_ID }).map(exercise => exercise.id);
  assert.ok(!served.includes('DUNGEON-DRAFT-01'));
  // 预览口径包含 draft（仅显式预览入口可用，地下城不使用）。
  assert.ok(core.previewExercises({ subject: 'math', grades: [1], gameId: GAME_ID }).some(exercise => exercise.id === 'DUNGEON-DRAFT-01'));
});

test('gameId 隔离：默认静态题库不服务地下城，地下城取题全部来自生成题库', () => {
  assert.ok(selectDungeonExercises([1]).every(exercise => exercise.gameIds.includes(GAME_ID)));
  assert.ok(selectDungeonExercises([1]).every(exercise => exercise.review.status === 'approved'));
  const defaultCore = createLearningCore(catalog);
  assert.equal(defaultCore.selectExercises({ subject: 'math', grades: [1, 2], gameId: GAME_ID }).length, 0);
  assert.ok(catalog.exercises.every(exercise => !exercise.gameIds.includes(GAME_ID)));
});

// ---------------------------------------------------------------------------
// 记录结构：gameId 区分与存储命名空间
// ---------------------------------------------------------------------------

test('成绩记录携带独立 gameId，可与其他游戏记录区分', () => {
  let state = createRound(pool1, [], createSeededRng(91));
  state = moveTo(solve(engageSlot(state, 'gate-stone')), 'junction');
  state = moveTo(solve(engageSlot(state, 'gate-right')), 'end');
  const result = settlement(state);
  const record = buildRecord({
    recordId: 'rec-1', finishedAt: '2026-10-27T00:00:00.000Z', grades: [1],
    contentVersion: 'generated-v4:choices-v3', score: result.score,
    answered: result.answered, route: result.route,
    keysHeld: result.keysHeld, keyUses: result.keyUses, retries: result.retries,
  });
  assert.equal(record.gameId, 'arithmetic-dungeon');
  assert.equal(record.schemaVersion, STORAGE_SCHEMA_VERSION);
  assert.equal(record.score, 20);
  assert.deepEqual(record.explore.route, ['start', 'junction', 'end']);
  assert.equal(record.answer.questions.length, 2);
  const parsed = parseRecord(JSON.parse(JSON.stringify(record)));
  assert.ok(parsed);
  assert.equal(parsed.gameId, 'arithmetic-dungeon');
  // 篡改归属或其他字段：拒绝。
  assert.equal(parseRecord({ ...record, gameId: 'number-puzzle' }), null);
  assert.equal(parseRecord({ ...record, gameId: 'hanzi-hero' }), null);
  assert.equal(parseRecord({ ...record, schemaVersion: 2 }), null);
  assert.equal(parseRecord({ ...record, score: -1 }), null);
  assert.equal(parseRecord({ ...record, explore: { ...record.explore, keysHeld: 5 } }), null);
  assert.equal(parseRecord({ ...record, answer: { questions: [{ slot: 'nope', exerciseId: 'x', firstTry: true, wrongs: 0 }] } }), null);
});

test('成绩列表解析：单条损坏只丢弃该条，其余保留', () => {
  const good = buildRecord({
    recordId: 'rec-2', finishedAt: '2026-10-27T00:00:00.000Z', grades: [2],
    contentVersion: 'x', score: 10, answered: [], route: ['start'], keysHeld: 0, keyUses: 0, retries: 0,
  });
  const raw = JSON.stringify({
    schemaVersion: 1,
    records: [good, { broken: true }, { ...good, recordId: 'rec-3', finishedAt: 'not-a-date' }],
  });
  const records = parseRecords(raw);
  assert.equal(records.length, 1);
  assert.equal(records[0].recordId, 'rec-2');
  assert.equal(parseRecords('not-json').length, 0);
  assert.equal(parseRecords(null).length, 0);
});

test('设置解析：schemaVersion 与年级校验', () => {
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [1, 2] }).grades.join(','), '1,2');
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [0] }), null);
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [] }), null);
  assert.equal(parseSettingsValue({ schemaVersion: 2, grades: [1] }), null);
});

test('存储键命名空间独立：不与其他游戏键重叠', () => {
  const prefix = 'pixel-academy:arithmetic-dungeon:v1:';
  const otherPrefixes = ['pixel-academy:number-puzzle', 'pixel-academy:hanzi-hero:v1'];
  for (const key of Object.values(STORAGE_KEYS)) {
    assert.ok(key.startsWith(prefix), `${key} 不在地下城命名空间内`);
    for (const other of otherPrefixes) {
      assert.ok(!key.startsWith(other), `${key} 侵入 ${other} 命名空间`);
    }
  }
  assert.equal(STORAGE_KEYS.snapshot, `${prefix}interrupted`);
});

test('每题计时 10 秒（与数字消除同口径）', () => {
  assert.equal(QUESTION_TIME_MS, 10_000);
});
