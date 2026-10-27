// 英语快递员规则与存储测试：组卷（5 任务唯一、避重、包裹/站位洗牌分布）、取件/送达判定、
// 计分档（首答=第一次送达尝试）、分步反馈、快照往返恢复一致、损坏快照拒绝、
// 记录 gameId 与词汇/句意模式区分、存储解析健壮性。
// 从编译产物导入（与 tests/pinyin-adventure.test.mjs 同口径，npm test 先 build 后测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceQuestion, createRound, deliverTo, englishMode, FIRST_TRY_SCORE, GAME_ID,
  parseSnapshot, pickParcel, QUESTIONS_PER_ROUND, RETRY_SCORE, settlement, shuffle,
} from '../dist/game/english-courier/rules.js';
import { buildRecord, parseRecord, parseRecords, parseSettingsValue, STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION } from '../dist/game/english-courier/storage.js';
import { englishCanonicalWord, englishDeliveryAnswer } from '../dist/learning/english.js';
import { selectEnglishExercises } from '../dist/game/english-courier/content.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';

const pool1 = selectEnglishExercises([1]);

/** 任务的标准正确作答（[包裹, 收件人]，从洗牌后的候选中按规范身份取）。 */
const correctPairOf = question => {
  const answer = englishDeliveryAnswer(question.task);
  const parcel = question.parcels.find(w => {
    try { return englishCanonicalWord(w) === answer.parcel; } catch { return false; }
  });
  if (!parcel) throw new Error(`correct parcel missing after shuffle: ${question.exerciseId}`);
  return { parcel, recipient: answer.recipient };
};

/** 确定答错的作答组合：对包裹错收件人 / 错包裹对收件人 / 双错。 */
const wrongPairs = question => {
  const { parcel, recipient } = correctPairOf(question);
  const wrongParcel = question.parcels.find(w => w !== parcel);
  const wrongRecipient = question.stations.find(w => w !== recipient);
  return {
    wrongParcelRightRecipient: [wrongParcel, recipient],
    rightParcelWrongRecipient: [parcel, wrongRecipient],
    bothWrong: [wrongParcel, wrongRecipient],
  };
};

// ---------------------------------------------------------------------------
// 组卷
// ---------------------------------------------------------------------------

test('每局 5 任务：局内唯一、包裹与站位是任务候选的重新排列', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const round = createRound(pool1, [], createSeededRng(seed));
    assert.equal(round.questions.length, QUESTIONS_PER_ROUND);
    assert.equal(new Set(round.questions.map(q => q.exerciseId)).size, QUESTIONS_PER_ROUND, `seed ${seed} 局内重复`);
    for (const q of round.questions) {
      assert.deepEqual([...q.parcels].sort(), [...q.task.parcels].sort(), `seed ${seed} 包裹排列篡改候选`);
      assert.deepEqual([...q.stations].sort(), [...q.task.recipients].sort(), `seed ${seed} 站位篡改候选`);
      assert.equal(q.parcels.length, q.task.parcels.length);
    }
  }
});

test('避重：上一局任务在池充足时全部避开', () => {
  const first = createRound(pool1, [], createSeededRng(7));
  const firstIds = first.questions.map(q => q.exerciseId);
  const second = createRound(pool1, firstIds, createSeededRng(7));
  for (const id of firstIds) {
    assert.ok(!second.questions.some(q => q.exerciseId === id), `任务 ${id} 应被避开`);
  }
});

test('正确位置不长期固定：多种子下正确包裹与收件人的槽位分布大于 1', () => {
  const parcelSlots = new Set();
  const stationSlots = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const round = createRound(pool1, [], createSeededRng(seed));
    const q = round.questions[0];
    const { parcel, recipient } = correctPairOf(q);
    parcelSlots.add(q.parcels.indexOf(parcel));
    stationSlots.add(q.stations.indexOf(recipient));
  }
  assert.ok(parcelSlots.size > 1, `正确包裹槽位分布过窄：${[...parcelSlots]}`);
  assert.ok(stationSlots.size > 1, `正确收件人槽位分布过窄：${[...stationSlots]}`);
});

// ---------------------------------------------------------------------------
// 取件与送达
// ---------------------------------------------------------------------------

test('取件：设置携带包裹、可换包裹；站外包裹拒绝；resolving 锁定', () => {
  const round = createRound(pool1, [], createSeededRng(3));
  const question = round.questions[0];
  const parcel = question.parcels[0];
  const withParcel = pickParcel(round, parcel);
  assert.equal(withParcel.carrying, parcel);
  const switched = pickParcel(withParcel, question.parcels[1]);
  assert.equal(switched.carrying, question.parcels[1]);
  assert.throws(() => pickParcel(round, 'apple'), RangeError);
  const resolving = { ...round, phase: 'resolving' };
  assert.throws(() => pickParcel(resolving, parcel), Error);
});

test('送达：未取件直接判定被拒绝（未取件点选不构成作答）', () => {
  const round = createRound(pool1, [], createSeededRng(3));
  assert.throws(() => deliverTo(round, round.questions[0].stations[0]), Error);
});

test('送达判定矩阵：双对完成 +10；对包裹错对象 / 错包裹对对象 / 双错均为错送且不完成', () => {
  const round = createRound(pool1, [], createSeededRng(5));
  const q = round.questions[0];
  const correct = correctPairOf(q);
  const wrongs = wrongPairs(q);

  const wrongParcel = deliverTo(pickParcel(round, correct.parcel), wrongs.rightParcelWrongRecipient[1]);
  assert.equal(wrongParcel.type, 'wrong');
  assert.equal(wrongParcel.parcelOk, true);
  assert.equal(wrongParcel.recipientOk, false);
  assert.equal(wrongParcel.next.wrongs[0], 1);
  assert.equal(wrongParcel.next.attempts[0], 1);
  assert.equal(wrongParcel.next.score, 0, '答错不扣分');
  assert.equal(wrongParcel.next.carrying, correct.parcel, '错送后仍持有包裹，可纠正');

  const wrongRecipient = deliverTo(pickParcel(round, wrongs.wrongParcelRightRecipient[0]), correct.recipient);
  assert.equal(wrongRecipient.type, 'wrong');
  assert.equal(wrongRecipient.parcelOk, false);
  assert.equal(wrongRecipient.recipientOk, true);

  const bothWrong = deliverTo(pickParcel(round, wrongs.bothWrong[0]), wrongs.bothWrong[1]);
  assert.equal(bothWrong.type, 'wrong');
  assert.equal(bothWrong.parcelOk, false);
  assert.equal(bothWrong.recipientOk, false);

  const delivered = deliverTo(pickParcel(round, correct.parcel), correct.recipient);
  assert.equal(delivered.type, 'delivered');
  assert.equal(delivered.gained, FIRST_TRY_SCORE);
  assert.equal(delivered.next.score, FIRST_TRY_SCORE);
  assert.equal(delivered.next.phase, 'resolving');
  assert.equal(delivered.next.carrying, null, '送达完成清除携带');
  assert.equal(delivered.next.attempts[0], 1);
  assert.equal(delivered.next.wrongs[0], 0);
});

test('计分档：首答错送后完成入重试档 +5；完成后输入锁定不重复计分', () => {
  const round = createRound(pool1, [], createSeededRng(5));
  const q = round.questions[0];
  const { parcel, recipient } = correctPairOf(q);
  const wrong = q.stations.find(w => w !== recipient);
  const afterWrong = deliverTo(pickParcel(round, parcel), wrong);
  assert.equal(afterWrong.type, 'wrong');
  const retried = deliverTo(afterWrong.next, recipient);
  assert.equal(retried.type, 'delivered');
  assert.equal(retried.gained, RETRY_SCORE, '重试档 5 分');
  assert.equal(retried.next.firstTryCount, 0);
  assert.equal(retried.next.score, RETRY_SCORE);
  // 完成后 phase=resolving：再次送达被锁定（重复送达不重复计分）。
  assert.throws(() => deliverTo(retried.next, recipient), Error);
});

test('整局可完成：连续完成 5 任务结算 50 分、首答 5、送达尝试 5', () => {
  let round = createRound(pool1, [], createSeededRng(11));
  for (let i = 0; i < QUESTIONS_PER_ROUND; i++) {
    const q = round.questions[round.questionIndex];
    const { parcel, recipient } = correctPairOf(q);
    round = deliverTo(pickParcel(round, parcel), recipient).next;
    // 反馈窗口后推进：最后一题推进即终局。
    round = advanceQuestion(round);
  }
  assert.equal(round.phase, 'finished');
  assert.equal(round.result, 'passed');
  const result = settlement(round);
  assert.equal(result.score, 50);
  assert.equal(result.firstTry, 5);
  assert.equal(result.wrong, 0);
  assert.equal(result.attempts, 5);
  assert.equal(result.total, 5);
  const vocab = result.answered.filter(t => t.mode === 'vocab');
  const sentence = result.answered.filter(t => t.mode === 'sentence');
  assert.equal(vocab.length + sentence.length, 5);
  assert.ok(result.answered.every(t => t.firstTry && t.attempts === 1 && t.wrongs === 0));
  assert.ok(result.answered.every(t => englishMode(
    pool1.find(e => e.id === t.exerciseId).task) === t.mode), '记录模式与题目一致');
});

test('混合局结算：错送任务入重试档，尝试与错送分开统计', () => {
  let round = createRound(pool1, [], createSeededRng(12));
  // 第 1 题先错送一次再完成；其余首答完成。
  {
    const q = round.questions[0];
    const { parcel, recipient } = correctPairOf(q);
    const wrong = q.stations.find(w => w !== recipient);
    round = deliverTo(pickParcel(round, parcel), wrong).next;
    round = deliverTo(round, recipient).next;
  }
  for (let i = 1; i < QUESTIONS_PER_ROUND; i++) {
    round = advanceQuestion(round);
    const q = round.questions[round.questionIndex];
    const { parcel, recipient } = correctPairOf(q);
    round = deliverTo(pickParcel(round, parcel), recipient).next;
  }
  round = advanceQuestion(round);
  assert.equal(round.phase, 'finished');
  const result = settlement(round);
  assert.equal(result.score, 4 * FIRST_TRY_SCORE + RETRY_SCORE);
  assert.equal(result.firstTry, 4);
  assert.equal(result.wrong, 1);
  assert.equal(result.attempts, 6);
});

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

const snapshotOf = round => ({
  version: 1, gameId: GAME_ID, roundId: 'round-1', state: round,
  rngState: 0x12345678, previousIds: [], grades: [1], contentVersion: 'english-static-v1',
});

test('快照往返：asking/resolving/finished 均可解析且与原状态一致', () => {
  let round = createRound(pool1, [], createSeededRng(21));
  const askingSnapshot = parseSnapshot(snapshotOf(round));
  assert.ok(askingSnapshot);
  assert.deepEqual(askingSnapshot.state, round);

  const q = round.questions[0];
  const { parcel, recipient } = correctPairOf(q);
  const wrong = q.stations.find(w => w !== recipient);
  round = deliverTo(pickParcel(round, parcel), wrong).next;
  const carriedSnapshot = parseSnapshot(snapshotOf(round));
  assert.ok(carriedSnapshot);
  assert.equal(carriedSnapshot.state.carrying, parcel, '携带包裹进快照');

  const delivered = deliverTo(round, recipient).next;
  const resolvingSnapshot = parseSnapshot(snapshotOf(delivered));
  assert.ok(resolvingSnapshot);
  assert.equal(resolvingSnapshot.state.phase, 'resolving');

  let finished = advanceQuestion(delivered);
  for (let i = 1; i < QUESTIONS_PER_ROUND; i++) {
    const q2 = finished.questions[finished.questionIndex];
    const pair = correctPairOf(q2);
    finished = deliverTo(pickParcel(finished, pair.parcel), pair.recipient).next;
    finished = advanceQuestion(finished);
  }
  const finishedSnapshot = parseSnapshot(snapshotOf(finished));
  assert.ok(finishedSnapshot);
  assert.equal(finishedSnapshot.state.phase, 'finished');
});

test('损坏快照拒绝：版本/gameId/排列篡改/计数矛盾/终局不一致/carrying 非法', () => {
  const base = createRound(pool1, [], createSeededRng(31));
  const q = base.questions[0];
  const { parcel, recipient } = correctPairOf(q);
  const wrong = q.stations.find(w => w !== recipient);
  const afterWrong = deliverTo(pickParcel(base, parcel), wrong).next;
  const raw = snapshotOf(afterWrong);
  const clone = () => JSON.parse(JSON.stringify(raw));

  assert.equal(parseSnapshot({ ...clone(), version: 2 }), null);
  assert.equal(parseSnapshot({ ...clone(), gameId: 'pinyin-adventure' }), null);
  assert.equal(parseSnapshot({ ...clone(), contentVersion: '' }), null);
  const badGrades = clone();
  badGrades.grades = [9];
  assert.equal(parseSnapshot(badGrades), null);

  const tamperedStations = clone();
  tamperedStations.state.questions[0].stations = ['dad', 'mum', 'grandma', 'happy'];
  assert.equal(parseSnapshot(tamperedStations), null, '站位必须仍是候选的排列');

  const badCounts = clone();
  badCounts.state.wrongs[0] = badCounts.state.attempts[0] + 1;
  assert.equal(parseSnapshot(badCounts), null, '错送不得多于尝试');

  const badTotal = clone();
  badTotal.state.totalWrongCount = raw.state.totalWrongCount + 1;
  assert.equal(parseSnapshot(badTotal), null, '错送总数须与逐题一致');

  const badCarrying = clone();
  badCarrying.state.carrying = 'apple';
  assert.equal(parseSnapshot(badCarrying), null, 'carrying 只能是当前任务的包裹');

  const finishedLike = clone();
  finishedLike.state.phase = 'finished';
  finishedLike.state.result = 'passed';
  assert.equal(parseSnapshot(finishedLike), null, '非终局状态不得标 finished');

  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot('x'), null);
});

// ---------------------------------------------------------------------------
// 存储解析与记录
// ---------------------------------------------------------------------------

test('记录结构：gameId 固定本游戏，词汇/句意模式与尝试统计入记录', () => {
  const record = buildRecord({
    recordId: 'rec-1', finishedAt: '2026-10-28T08:00:00.000Z', grades: [1],
    contentVersion: 'english-static-v1', score: 45,
    answered: [
      { exerciseId: 'EN-C-001', mode: 'vocab', attempts: 2, wrongs: 1, firstTry: false },
      { exerciseId: 'EN-C-011', mode: 'sentence', attempts: 1, wrongs: 0, firstTry: true },
    ],
  });
  assert.equal(record.gameId, GAME_ID);
  assert.equal(record.schemaVersion, STORAGE_SCHEMA_VERSION);
  const parsed = parseRecord(record);
  assert.ok(parsed);
  assert.equal(parsed.answer.tasks[0].mode, 'vocab');
  assert.equal(parsed.answer.tasks[1].firstTry, true);
  assert.equal(parseRecords(JSON.stringify({ schemaVersion: 1, records: [record] })).length, 1);
  assert.deepEqual(parseRecords('not-json'), []);
  assert.deepEqual(parseRecords(null), []);
});

test('非法记录拒绝：gameId 错误、错送多于尝试、尝试为 0、模式非法', () => {
  const base = buildRecord({
    recordId: 'rec-2', finishedAt: '2026-10-28T08:00:00.000Z', grades: [1],
    contentVersion: 'english-static-v1', score: 40,
    answered: [{ exerciseId: 'EN-C-001', mode: 'vocab', attempts: 1, wrongs: 0, firstTry: true }],
  });
  assert.equal(parseRecord({ ...base, gameId: 'hanzi-hero' }), null, '其他游戏 gameId 拒绝');
  assert.equal(parseRecord({ ...base, schemaVersion: 2 }), null);
  const badWrongs = JSON.parse(JSON.stringify(base));
  badWrongs.answer.tasks[0].wrongs = 2;
  assert.equal(parseRecord(badWrongs), null, '错送多于尝试拒绝');
  const zeroAttempts = JSON.parse(JSON.stringify(base));
  zeroAttempts.answer.tasks[0].attempts = 0;
  assert.equal(parseRecord(zeroAttempts), null, '完成任务的尝试不得为 0');
  const badMode = JSON.parse(JSON.stringify(base));
  badMode.answer.tasks[0].mode = 'reading';
  assert.equal(parseRecord(badMode), null);
});

test('记录解析健壮性：合法保留、损坏单条丢弃、不拖垮整批', () => {
  const record = buildRecord({
    recordId: 'rec-3', finishedAt: '2026-10-28T08:00:00.000Z', grades: [1],
    contentVersion: 'english-static-v1', score: 50,
    answered: [{ exerciseId: 'EN-C-001', mode: 'vocab', attempts: 1, wrongs: 0, firstTry: true }],
  });
  const list = parseRecords(JSON.stringify({ schemaVersion: 1, records: [record, { broken: true }] }));
  assert.deepEqual(list, [record]);
});

test('设置解析：合法年级保留、非法拒绝', () => {
  assert.deepEqual(parseSettingsValue({ schemaVersion: 1, grades: [1] }), { schemaVersion: 1, grades: [1] });
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [0] }), null);
  assert.equal(parseSettingsValue({ schemaVersion: 2, grades: [1] }), null);
  assert.equal(parseSettingsValue(null), null);
});

test('存储键命名空间独立：不与其他游戏共享前缀', () => {
  assert.ok(STORAGE_KEYS.settings.startsWith('pixel-academy:english-courier:v1:'));
  assert.ok(!STORAGE_KEYS.records.includes('pinyin'));
  assert.ok(!STORAGE_KEYS.records.includes('number-puzzle'));
});

test('shuffle：排列保持成员一致（快照一致性基础）', () => {
  const source = ['mum', 'dad', 'grandma', 'sister'];
  for (let seed = 1; seed <= 20; seed++) {
    const shuffled = shuffle(source, createSeededRng(seed));
    assert.deepEqual([...shuffled].sort(), [...source].sort());
  }
});
