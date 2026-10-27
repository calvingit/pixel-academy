// 拼音冒险规则与存储测试：混合局组卷（5 题唯一、听辨下限、避重）、计分档、超时、
// 听辨跳过不计分、快照往返恢复一致、损坏快照拒绝、记录 gameId 与辨认/听辨模式区分、
// 存储命名空间独立、音频映射表与 WAV 文件一一对应。
// 从编译产物导入（与 tests/arithmetic-dungeon.test.mjs 同口径，npm test 先 build 后测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  advanceQuestion, createRound, FIRST_TRY_SCORE, GAME_ID, MIN_LISTEN_QUESTIONS,
  parseSnapshot, pinyinMode, QUESTION_TIME_MS, QUESTIONS_PER_ROUND, RETRY_SCORE,
  settlement, shuffle, skipCurrent, submitAnswer, timeoutCurrent,
} from '../dist/game/pinyin-adventure/rules.js';
import { buildRecord, parseRecord, parseRecords, parseSettingsValue, STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION } from '../dist/game/pinyin-adventure/storage.js';
import { PINYIN_AUDIO_BY_LETTER } from '../dist/content/pinyin-exercises.js';
import { PINYIN_INITIALS, PINYIN_FINALS } from '../dist/learning/pinyin.js';
import { evaluateAnswer } from '../dist/learning/evaluation.js';
import { selectPinyinExercises } from '../dist/game/pinyin-adventure/content.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const pool1 = selectPinyinExercises([1]);

/** 任务的标准正确作答（字母字符串）。 */
const answerOf = task => task.answer;

/** 确定答错的作答：取候选中非答案的一个字母。 */
const wrongAnswerOf = task => task.options.find(option => option !== task.answer);

// ---------------------------------------------------------------------------
// 组卷
// ---------------------------------------------------------------------------

test('每局 5 题：本局唯一、辨认与听辨混排、听辨至少 2 题', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const round = createRound(pool1, [], createSeededRng(seed));
    assert.equal(round.questions.length, QUESTIONS_PER_ROUND);
    assert.equal(new Set(round.questions.map(q => q.exerciseId)).size, QUESTIONS_PER_ROUND, `seed ${seed} 局内重复`);
    const listenCount = round.questions.filter(q => q.task.kind === 'pinyin-listen').length;
    assert.ok(listenCount >= MIN_LISTEN_QUESTIONS, `seed ${seed} 听辨不足`);
    assert.ok(listenCount <= QUESTIONS_PER_ROUND - 1, '听辨与辨认混排（辨认题保留）');
    for (const q of round.questions) assert.ok(['pinyin-choose', 'pinyin-listen'].includes(q.task.kind));
  }
});

test('开局抽题避开上一局题目 ID（池充足时全部避开）', () => {
  const recent = createRound(pool1, [], createSeededRng(11)).questions.map(q => q.exerciseId);
  for (let seed = 12; seed <= 40; seed++) {
    const round = createRound(pool1, recent, createSeededRng(seed));
    for (const q of round.questions) {
      assert.ok(!recent.includes(q.exerciseId), `seed ${seed} 复用了上一局题目 ${q.exerciseId}`);
    }
  }
});

test('同一种子组卷确定；不同种子混排顺序可不同', () => {
  const a = createRound(pool1, [], createSeededRng(21));
  const b = createRound(pool1, [], createSeededRng(21));
  assert.deepEqual(b.questions, a.questions);
  const orders = new Set();
  for (let seed = 22; seed <= 34; seed++) {
    orders.add(createRound(pool1, [], createSeededRng(seed)).questions.map(q => q.exerciseId).join(','));
  }
  assert.ok(orders.size > 1, '混排应随种子变化');
});

test('候选局内洗牌：答案位置分布不恒定，多个种子下四种位置均出现', () => {
  // 固定种子集 → 断言确定（非随机测试）；60 局 × 5 题 = 300 个答案位置样本。
  const positions = [];
  for (let seed = 101; seed <= 160; seed++) {
    const round = createRound(pool1, [], createSeededRng(seed));
    for (const q of round.questions) {
      const index = q.task.options.indexOf(q.task.answer);
      assert.ok(index >= 0, '答案必须在候选内');
      positions.push(index);
    }
  }
  assert.equal(positions.length, 300);
  assert.deepEqual([...new Set(positions)].sort((x, y) => x - y), [0, 1, 2, 3],
    '答案不应恒在某一位（缺陷回归：恒为第一张候选卡）');
  assert.ok(positions.filter(p => p === 0).length < positions.length);
});

test('判题按字母身份与渲染排列无关：打乱排列后答案仍判对', () => {
  const round = createRound(pool1, [], createSeededRng(171));
  for (const q of round.questions) {
    const reversed = { ...q.task, options: [...q.task.options].reverse() };
    const rotated = [...q.task.options.slice(1), q.task.options[0]];
    assert.equal(evaluateAnswer(reversed, q.task.answer), true, '反转排列后按字母身份仍判对');
    assert.equal(evaluateAnswer({ ...q.task, options: rotated }, q.task.answer), true, '轮换排列后仍判对');
    assert.equal(evaluateAnswer(reversed, wrongAnswerOf(reversed)), false, '非答案字母仍判错');
    assert.deepEqual([...reversed.options].sort(), [...q.task.options].sort(), '洗牌/打乱不改变候选集合');
  }
});

test('快照往返保留洗牌后的候选排列', () => {
  const round = createRound(pool1, [], createSeededRng(181));
  const snapshot = {
    version: 1, gameId: GAME_ID, roundId: 'r', state: round, rngState: 1, previousIds: [],
    grades: [1], contentVersion: 'x',
    timer: { paused: false, remainingMs: 1000, deadline: null, timerKind: null },
  };
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.ok(parsed, '合法快照必须通过校验');
  assert.deepEqual(parsed.state.questions.map(q => q.task.options),
    round.questions.map(q => q.task.options), '恢复后排列与快照一致');
});

test('题池不足 5 道或听辨不足 2 道时开局抛错，不悄悄开工', () => {
  assert.throws(() => createRound(pool1.slice(0, 4), [], createSeededRng(31)), RangeError);
  const onlyChoose = pool1.filter(e => e.task.kind === 'pinyin-choose');
  assert.throws(() => createRound(onlyChoose.concat(onlyChoose[0]), [], createSeededRng(32)), RangeError);
});

// ---------------------------------------------------------------------------
// 计分与推进
// ---------------------------------------------------------------------------

test('首答 10 分；答错不扣分可重试，重试答对得 5 分', () => {
  let round = createRound(pool1, [], createSeededRng(41));
  const first = submitAnswer(round, answerOf(round.questions[0].task));
  assert.equal(first.type, 'correct');
  assert.equal(first.gained, FIRST_TRY_SCORE);
  assert.equal(first.next.score, FIRST_TRY_SCORE);
  assert.equal(first.next.firstTryCount, 1);
  // 第二题：先答错再答对。
  round = advanceQuestion(first.next);
  const wrong = submitAnswer(round, wrongAnswerOf(round.questions[1].task));
  assert.equal(wrong.type, 'wrong');
  assert.equal(wrong.next.score, FIRST_TRY_SCORE, '答错不扣分');
  assert.equal(wrong.next.totalWrongCount, 1);
  assert.equal(wrong.next.currentWrong, true);
  const retry = submitAnswer(wrong.next, answerOf(wrong.next.questions[1].task));
  assert.equal(retry.type, 'correct');
  assert.equal(retry.gained, RETRY_SCORE);
  assert.equal(retry.next.score, FIRST_TRY_SCORE + RETRY_SCORE);
  assert.equal(retry.next.firstTryCount, 1);
});

test('重复答错累计答错数且重试档不变；判题只按字母身份', () => {
  let round = createRound(pool1, [], createSeededRng(42));
  for (let i = 0; i < 20; i++) {
    const wrong = submitAnswer(round, wrongAnswerOf(round.questions[0].task));
    assert.equal(wrong.type, 'wrong');
    assert.equal(wrong.next.score, 0);
    round = wrong.next;
  }
  const correct = submitAnswer(round, answerOf(round.questions[0].task));
  assert.equal(correct.gained, RETRY_SCORE);
  assert.equal(correct.next.totalWrongCount, 20);
});

test('超时按答错处理：不扣分、计入重试，之后仍可答对', () => {
  let round = createRound(pool1, [], createSeededRng(43));
  const timeout = timeoutCurrent(round);
  assert.equal(timeout.type, 'wrong');
  assert.equal(timeout.next.score, 0);
  assert.equal(timeout.next.totalWrongCount, 1);
  const correct = submitAnswer(timeout.next, answerOf(timeout.next.questions[0].task));
  assert.equal(correct.gained, RETRY_SCORE);
});

test('完整一局全首答 50 分；结算含每题模式与首答口径', () => {
  let round = createRound(pool1, [], createSeededRng(51));
  while (round.phase !== 'finished') {
    round = advanceQuestion(submitAnswer(round, answerOf(round.questions[round.questionIndex].task)).next);
  }
  const result = settlement(round);
  assert.equal(result.score, 50);
  assert.equal(result.firstTry, 5);
  assert.equal(result.wrong, 0);
  assert.equal(result.total, 5);
  assert.equal(result.answered.length, 5);
  const listenCount = result.answered.filter(q => q.mode === 'listen').length;
  assert.ok(listenCount >= 2);
  assert.ok(result.answered.every(q => q.answered && q.firstTry && q.wrongs === 0));
  assert.ok(result.answered.every(q => q.mode === pinyinMode(round.questions[result.answered.indexOf(q)].task)));
});

test('跳过听辨题：不判题不计分不计作答，推进到下一题；辨认题不可跳过', () => {
  let round = createRound(pool1, [], createSeededRng(52));
  while (round.questions[round.questionIndex].task.kind !== 'pinyin-listen') {
    round = advanceQuestion(submitAnswer(round, answerOf(round.questions[round.questionIndex].task)).next);
  }
  const index = round.questionIndex;
  const skipped = skipCurrent(round);
  assert.equal(skipped.skipped[index], true);
  assert.equal(skipped.score, round.score);
  assert.equal(skipped.totalWrongCount, round.totalWrongCount);
  assert.equal(skipped.questionIndex, index + 1);
  // 辨认题不可跳过：推进到一道辨认题再尝试跳过。
  let state = skipped;
  while (state.phase !== 'finished' && state.questions[state.questionIndex].task.kind !== 'pinyin-choose') {
    state = advanceQuestion(submitAnswer(state, answerOf(state.questions[state.questionIndex].task)).next);
  }
  if (state.phase !== 'finished') {
    assert.throws(() => skipCurrent(state), TypeError);
  }
});

test('全部听辨题被跳过时结算如实呈现：0 分、answered=false，不假装完成', () => {
  // 构造一局 3 听辨 + 2 辨认的局，仅跳过听辨题、答对辨认题。
  let round = createRound(pool1, [], createSeededRng(53));
  const answered = [];
  while (round.phase !== 'finished') {
    const question = round.questions[round.questionIndex];
    if (question.task.kind === 'pinyin-listen') {
      answered.push({ mode: 'listen', skipped: true });
      round = skipCurrent(round);
    } else {
      answered.push({ mode: 'choose', skipped: false });
      round = advanceQuestion(submitAnswer(round, answerOf(question.task)).next);
    }
  }
  const result = settlement(round);
  const listenResults = result.answered.filter(q => q.mode === 'listen');
  assert.ok(listenResults.length >= 2);
  assert.ok(listenResults.every(q => !q.answered && !q.firstTry && q.wrongs === 0));
  const chooseResults = result.answered.filter(q => q.mode === 'choose');
  assert.ok(chooseResults.length >= 1, '混排局应保留辨认题');
  assert.ok(chooseResults.every(q => q.answered && q.firstTry));
  assert.equal(result.score, 10 * chooseResults.length); // 仅辨认首答计分
});

// ---------------------------------------------------------------------------
// 快照往返与损坏拒绝
// ---------------------------------------------------------------------------

test('快照往返：恢复后题目、进度、随机序列一致，续局结算与参考局相同', () => {
  const seed = 61;
  const handle = createSeededRng(seed);
  let partial = createRound(pool1, [], handle);
  // 快照点：答对第一题、进入第二题作答中（已消耗组卷与洗牌的 rng）。
  partial = advanceQuestion(submitAnswer(partial, answerOf(partial.questions[0].task)).next);
  const snapshot = {
    version: 1, gameId: GAME_ID, roundId: 'r-1', state: partial,
    rngState: handle.snapshotState(), previousIds: [], grades: [1],
    contentVersion: 'test-content',
    timer: { paused: false, remainingMs: 5000, deadline: null, timerKind: null },
  };
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.ok(parsed, '合法快照必须通过校验');
  const finishFrom = state => {
    let current = state;
    while (current.phase !== 'finished') {
      current = advanceQuestion(submitAnswer(current, answerOf(current.questions[current.questionIndex].task)).next);
    }
    return settlement(current);
  };
  // 参考局与恢复局从同一状态出发（后续推进不消耗 rng），结算必须完全一致。
  assert.deepEqual(finishFrom(parsed.state), finishFrom(partial));
  assert.equal(parsed.state.questionIndex, 1);
  assert.equal(parsed.state.score, FIRST_TRY_SCORE);
});

test('损坏快照被安全拒绝', () => {
  const valid = state => ({
    version: 1, gameId: GAME_ID, roundId: 'r', state, rngState: 1, previousIds: [],
    grades: [1], contentVersion: 'x', timer: { paused: false, remainingMs: 1000, deadline: null, timerKind: null },
  });
  const base = createRound(pool1, [], createSeededRng(71));
  assert.ok(parseSnapshot(valid(base)), '合法快照必须通过校验');
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({}), null);
  assert.equal(parseSnapshot({ ...valid(base), version: 2 }), null);
  assert.equal(parseSnapshot({ ...valid(base), gameId: 'hanzi-hero' }), null);
  assert.equal(parseSnapshot({ ...valid(base), rngState: -1 }), null);
  assert.equal(parseSnapshot({ ...valid(base), rngState: 0x100000000 }), null);
  assert.equal(parseSnapshot({ ...valid(base), grades: [] }), null);
  assert.equal(parseSnapshot({ ...valid(base), timer: { ...valid(base).timer, timerKind: 'resolve' } }), null);
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, questions: base.questions.slice(0, 4) } }), null, '题数必须是 5');
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, score: 60 } }), null, '首答满分 50');
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, result: 'passed' } }), null, '未终局不得有结果');
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, wrongs: [1, 0, 0, 0, 0] } }), null, '答错计数须与总错数一致');
  assert.equal(parseSnapshot({ ...valid(base), state: { ...base, skipped: [0, false, false, false, false] } }), null);
  const tampered = JSON.parse(JSON.stringify(base));
  tampered.questions[0].task.answer = 'zz';
  assert.equal(parseSnapshot(valid(tampered)), null, '快照题目必须通过拼音任务校验');
  const foreign = JSON.parse(JSON.stringify(base));
  foreign.questions[0].task = { kind: 'choice', question: { kind: 'extreme', direction: 'max' }, options: [] };
  assert.equal(parseSnapshot(valid(foreign)), null, '非拼音任务不得混入快照');
});

// ---------------------------------------------------------------------------
// 记录结构：gameId 与辨认/听辨模式区分、存储命名空间
// ---------------------------------------------------------------------------

test('成绩记录携带独立 gameId，辨认/听辨作答表现分开记录', () => {
  const record = buildRecord({
    recordId: 'rec-1', finishedAt: '2026-10-27T00:00:00.000Z', grades: [1],
    contentVersion: 'pinyin-static-v1', score: 35,
    answered: [
      { exerciseId: 'PY-C-001', mode: 'choose', answered: true, firstTry: true, wrongs: 0 },
      { exerciseId: 'PY-L-003', mode: 'listen', answered: true, firstTry: false, wrongs: 1 },
      { exerciseId: 'PY-L-005', mode: 'listen', answered: false, firstTry: false, wrongs: 0 },
    ],
  });
  assert.equal(record.gameId, 'pinyin-adventure');
  assert.equal(record.schemaVersion, STORAGE_SCHEMA_VERSION);
  assert.equal(record.answer.questions[0].mode, 'choose');
  assert.equal(record.answer.questions[1].mode, 'listen');
  assert.equal(record.answer.questions[1].firstTry, false);
  assert.equal(record.answer.questions[2].answered, false, '跳过题如实记录');
  const parsed = parseRecord(JSON.parse(JSON.stringify(record)));
  assert.ok(parsed);
  assert.equal(parsed.gameId, 'pinyin-adventure');
  // 篡改归属或其他字段：拒绝。
  assert.equal(parseRecord({ ...record, gameId: 'number-puzzle' }), null);
  assert.equal(parseRecord({ ...record, gameId: 'hanzi-hero' }), null);
  assert.equal(parseRecord({ ...record, gameId: 'arithmetic-dungeon' }), null);
  assert.equal(parseRecord({ ...record, schemaVersion: 2 }), null);
  assert.equal(parseRecord({ ...record, score: -1 }), null);
  assert.equal(parseRecord({ ...record, answer: { questions: [{ exerciseId: 'x', mode: 'shape', answered: true, firstTry: true, wrongs: 0 }] } }), null, '模式只接受 choose/listen');
  assert.equal(parseRecord({ ...record, answer: { questions: [{ exerciseId: 'x', mode: 'listen', answered: 1, firstTry: true, wrongs: 0 }] } }), null);
  assert.equal(parseRecord({ ...record, answer: { questions: new Array(6).fill(record.answer.questions[0]) } }), null, '一局最多 5 题记录');
});

test('成绩列表解析：单条损坏只丢弃该条，其余保留', () => {
  const good = buildRecord({
    recordId: 'rec-2', finishedAt: '2026-10-27T00:00:00.000Z', grades: [1],
    contentVersion: 'x', score: 10,
    answered: [{ exerciseId: 'PY-C-001', mode: 'choose', answered: true, firstTry: true, wrongs: 0 }],
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
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [1] }).grades.join(','), '1');
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [0] }), null);
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [] }), null);
  assert.equal(parseSettingsValue({ schemaVersion: 2, grades: [1] }), null);
});

test('存储键命名空间独立：不与其他游戏键重叠', () => {
  const prefix = 'pixel-academy:pinyin-adventure:v1:';
  const otherPrefixes = ['pixel-academy:number-puzzle', 'pixel-academy:hanzi-hero:v1', 'pixel-academy:arithmetic-dungeon:v1'];
  for (const key of Object.values(STORAGE_KEYS)) {
    assert.ok(key.startsWith(prefix), `${key} 不在拼音冒险命名空间内`);
    for (const other of otherPrefixes) {
      assert.ok(!key.startsWith(other), `${key} 侵入 ${other} 命名空间`);
    }
  }
  assert.equal(STORAGE_KEYS.snapshot, `${prefix}interrupted`);
});

// ---------------------------------------------------------------------------
// 音频映射表与 WAV 文件一一对应
// ---------------------------------------------------------------------------

/** 解析生成脚本发音映射表行「类别|字母|文件名|TTS输入」。 */
function parseScriptEntries() {
  const source = readFileSync(join(root, 'scripts/gen-pinyin-audio.sh'), 'utf8');
  const block = source.match(/ENTRIES=\(\n([\s\S]*?)\n\)/);
  assert.ok(block, '生成脚本应含 ENTRIES 映射表');
  const entries = [];
  for (const match of block[1].matchAll(/"([^"|]+)\|([^"|]+)\|([^"|]+)\|([^"]*)"/g)) {
    entries.push({ category: match[1], letter: match[2], file: match[3], text: match[4] });
  }
  return entries;
}

test('音频映射表 47 条：TS 映射、生成脚本、磁盘 WAV 三方一一对应且文件真实存在', () => {
  const letters = [...PINYIN_INITIALS, ...PINYIN_FINALS];
  assert.equal(letters.length, 47);
  assert.deepEqual(Object.keys(PINYIN_AUDIO_BY_LETTER).sort(), [...letters].sort(), 'TS 映射覆盖 47 个字母');
  const scriptEntries = parseScriptEntries();
  assert.equal(scriptEntries.length, 47, '生成脚本映射表应为 47 条');
  assert.deepEqual(scriptEntries.map(e => e.letter).sort(), [...letters].sort(), '脚本字母集合与内容模块一致');
  for (const entry of scriptEntries) {
    assert.equal(PINYIN_AUDIO_BY_LETTER[entry.letter], entry.file, `字母 ${entry.letter} 的文件名两侧一致`);
    const wav = join(root, 'web/audio/pinyin', `${entry.file}.wav`);
    assert.ok(existsSync(wav), `缺少音频文件 ${entry.file}.wav`);
  }
  // TTS 输入口径抽查：呼读音、整体直读、ü 系近似与全拼滑音形式。
  const byLetter = Object.fromEntries(scriptEntries.map(e => [e.letter, e.text]));
  for (const [letter, text] of [['b', 'bo'], ['p', 'po'], ['zh', 'zhi'], ['y', 'yi'], ['w', 'wu'],
    ['ü', 'yu'], ['üe', 'yue'], ['ün', 'yun'], ['ui', 'uei'], ['iu', 'iou'], ['un', 'uen'], ['er', 'er']]) {
    assert.equal(byLetter[letter], text, `字母 ${letter} 的 TTS 输入口径`);
  }
});

test('听辨题 audio 路径与磁盘 WAV 一一对应（47 条全存在）', () => {
  const listenExercises = selectPinyinExercises([1]).filter(e => e.task.kind === 'pinyin-listen');
  assert.equal(listenExercises.length, 47);
  const files = new Set(listenExercises.map(e => e.task.audio));
  assert.equal(files.size, 47);
  for (const audio of files) {
    assert.ok(existsSync(join(root, 'web', audio)), `缺少 ${audio}`);
  }
});

test('每题计时 10 秒（与数字消除同口径）', () => {
  assert.equal(QUESTION_TIME_MS, 10_000);
});

test('shuffle 纯函数：不修改输入数组', () => {
  const input = [1, 2, 3, 4, 5];
  const copy = [...input];
  shuffle(input, createSeededRng(81));
  assert.deepEqual(input, copy);
});
