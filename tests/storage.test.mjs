// 本地记录与恢复测试（PLAN.md M5）：损坏数据、版本不兼容、重复写入、中断恢复一致性。
// 从 dist 导入编译结果执行；GameStorage 用注入式 KeyValueStore 在 Node 内验证，
// 与浏览器 localStorage 适配器（main.ts）解耦。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerFor } from '../dist/index.js';
import { createRound, clickTile, endWrongFeedback, completeResolve, ELIMINATE_MS, FILL_MS } from '../dist/game/number-puzzle/rules.js';
import { createSeededRng, restoreSeededRng } from '../dist/game/number-puzzle/random.js';
import { RoundSession } from '../dist/game/number-puzzle/session.js';
import {
  DEFAULT_SETTINGS, GameStorage, RECORDS_CAP, STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION, appendFinishedRecord, buildFinishedRecord, buildInterruptedSnapshot,
  checkRestore, contentFingerprint, parseInterrupted, parseRecords, parseSettings, roundFromSnapshot,
} from '../dist/game/number-puzzle/storage.js';
import { GAME_ID, loadGameContent } from '../dist/game/number-puzzle/content.js';

const content = loadGameContent();
const gradeOf = content.gradeOf;
const unionExercises = content.legacySelect([1, 2]);
const contentVersion = contentFingerprint(
  unionExercises.map(exercise => ({ id: exercise.id, grade: gradeOf(exercise), task: exercise.task })),
);

const memoryStore = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
};
const blockedStore = () => ({
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
  removeItem: () => { throw new Error('SecurityError'); },
});

const sessionTimers = session => {
  const timers = [];
  for (const kind of ['resolve', 'feedback']) {
    const remaining = session.remainingMs(kind);
    if (remaining !== null) timers.push({ kind, remainingMs: remaining });
  }
  return timers;
};

// 与 main.ts 一致的逐题作答累计：wrongFirst 为真时当前题先答错一次再答对。
const answerCurrent = (state, rng, { wrongFirst = false } = {}) => {
  const question = state.questions[state.questionIndex];
  const wrongsBefore = state.currentWrongCount;
  let current = state;
  if (wrongFirst) {
    const answer = answerFor(question.task);
    const wrongIndex = current.board.findIndex(slot => slot !== answer);
    assert.ok(wrongIndex !== -1);
    current = endWrongFeedback(clickTile(current, wrongIndex, rng).state);
  }
  const answer = answerFor(current.questions[current.questionIndex].task);
  const hit = current.board.findIndex(slot => slot === answer);
  const step = clickTile(current, hit, rng);
  assert.equal(step.outcome.type, 'correct');
  return {
    state: step.state,
    result: {
      exerciseId: question.exerciseId,
      firstTry: step.outcome.firstTry,
      wrongCount: wrongsBefore + (wrongFirst ? 1 : 0),
      score: step.outcome.gainedScore,
    },
  };
};

// 参考局：同一种子、同一作答方式，不间断打完整局。
const playFullRound = (seed, wrongOn) => {
  const rng = createSeededRng(seed);
  let state = createRound({ exercises: unionExercises, gradeOf, rng });
  const results = [];
  let answered = 0;
  while (state.phase !== 'finished') {
    if (state.phase === 'resolving') {
      state = completeResolve(state);
      continue;
    }
    const step = answerCurrent(state, rng, { wrongFirst: wrongOn(answered) });
    results.push(step.result);
    state = step.state;
    answered++;
  }
  return { state, results };
};

const makeRecord = (id, overrides = {}) => ({
  schemaVersion: STORAGE_SCHEMA_VERSION,
  recordId: id,
  gameId: GAME_ID,
  finishedAt: '2026-10-25T08:00:00Z',
  grades: [1],
  contentVersion: 'fp1:1:0000000000000000',
  score: 10,
  firstTryCount: 1,
  totalWrongCount: 0,
  questions: [{ exerciseId: 'MATH-001', firstTry: true, wrongCount: 0, score: 10 }],
  ...overrides,
});

const baseSnapshotRound = () => {
  const rng = createSeededRng(5);
  return createRound({ exercises: unionExercises, gradeOf, rng });
};
const baseSnapshot = () => buildInterruptedSnapshot({
  gameId: GAME_ID,
  recordId: 'np-base',
  grades: [1, 2],
  contentVersion,
  round: baseSnapshotRound(),
  rngState: 12345,
  paused: false,
  timers: [{ kind: 'resolve', remainingMs: 600 }],
  results: [],
  savedAt: '2026-10-25T08:00:00.000Z',
});

test('storage keys and default settings carry the schema version', () => {
  assert.equal(STORAGE_SCHEMA_VERSION, 1);
  assert.equal(STORAGE_KEYS.settings, 'pixel-academy:number-puzzle:v1:settings');
  assert.equal(STORAGE_KEYS.records, 'pixel-academy:number-puzzle:v1:records');
  assert.equal(STORAGE_KEYS.interrupted, 'pixel-academy:number-puzzle:v1:interrupted');
  assert.deepEqual(DEFAULT_SETTINGS, { schemaVersion: 1, selectedGrades: [], soundOn: true });
});

test('settings: corrupted or foreign-version saves are treated as first use', () => {
  assert.equal(parseSettings(null).status, 'empty');
  assert.equal(parseSettings('').status, 'empty');
  assert.equal(parseSettings('not-json{').status, 'invalid');
  assert.equal(parseSettings('[]').status, 'invalid');
  assert.equal(parseSettings('{"schemaVersion":2,"selectedGrades":[1],"soundOn":true}').status, 'invalid');
  assert.equal(parseSettings('{"schemaVersion":1,"selectedGrades":[1,9],"soundOn":true}').status, 'invalid');
  assert.equal(parseSettings('{"schemaVersion":1,"selectedGrades":"1","soundOn":true}').status, 'invalid');
  assert.equal(parseSettings('{"schemaVersion":1,"selectedGrades":[1],"soundOn":"yes"}').status, 'invalid');
  assert.equal(parseSettings('{"schemaVersion":1,"soundOn":true}').status, 'invalid');
  const ok = parseSettings('{"schemaVersion":1,"selectedGrades":[2,1,1],"soundOn":false}');
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.value, { schemaVersion: 1, selectedGrades: [2, 1], soundOn: false });
});

test('settings roundtrip through GameStorage, corrupt blob falls back to defaults', () => {
  const store = memoryStore();
  const storage = new GameStorage(store);
  assert.deepEqual(storage.loadSettings(), DEFAULT_SETTINGS); // 首次使用
  assert.ok(storage.saveSettings({ schemaVersion: 1, selectedGrades: [3, 1, 1], soundOn: false }));
  assert.deepEqual(storage.loadSettings(), { schemaVersion: 1, selectedGrades: [3, 1], soundOn: false });
  store.map.set(STORAGE_KEYS.settings, '{corrupted');
  assert.deepEqual(storage.loadSettings(), DEFAULT_SETTINGS); // 损坏按首次使用，且可游玩
});

test('records: blob corruption resets, illegal entries are dropped individually', () => {
  assert.equal(parseRecords(null).status, 'empty');
  assert.equal(parseRecords('[[').status, 'invalid');
  assert.equal(parseRecords('{"schemaVersion":3,"records":[]}').status, 'invalid');
  assert.equal(parseRecords('{"schemaVersion":1,"records":"nope"}').status, 'invalid');
  const good = makeRecord('r1');
  const parsed = parseRecords(JSON.stringify({
    schemaVersion: 1,
    records: [
      good,
      makeRecord('r2', { score: -1 }),
      makeRecord('r3', { questions: [] }),
      makeRecord('r4', { finishedAt: 'not-a-date' }),
      makeRecord('r5', { grades: [9] }),
      makeRecord('r6', { questions: [{ exerciseId: 'MATH-001', firstTry: true, wrongCount: 0, score: 'ten' }] }),
    ],
  }));
  assert.equal(parsed.status, 'ok');
  assert.deepEqual(parsed.value.records.map(record => record.recordId), ['r1']);
});

test('duplicate writes of the same recordId keep one entry; cap keeps the newest', () => {
  const storage = new GameStorage(memoryStore());
  assert.ok(storage.appendFinishedRecord(makeRecord('a')));
  assert.ok(storage.appendFinishedRecord(makeRecord('a'))); // 重复写入
  assert.ok(storage.appendFinishedRecord(makeRecord('b')));
  assert.deepEqual(storage.loadFinishedRecords().map(record => record.recordId), ['a', 'b']);
  for (let i = 0; i < RECORDS_CAP; i++) {
    assert.ok(storage.appendFinishedRecord(makeRecord(`bulk-${String(i).padStart(3, '0')}`)));
  }
  const capped = storage.loadFinishedRecords();
  assert.equal(capped.length, RECORDS_CAP);
  assert.ok(!capped.some(record => record.recordId === 'a'), 'oldest records are trimmed');
  assert.ok(capped.some(record => record.recordId === `bulk-${String(RECORDS_CAP - 1).padStart(3, '0')}`));
});

test('content fingerprint is deterministic, order-independent and content-sensitive', () => {
  const entries = unionExercises.map(exercise => ({ id: exercise.id, grade: gradeOf(exercise), task: exercise.task }));
  const fingerprint = contentFingerprint(entries);
  assert.equal(fingerprint, contentFingerprint([...entries].reverse()));
  assert.match(fingerprint, /^fp1:18:/);
  assert.notEqual(fingerprint, contentFingerprint(
    entries.map(entry => (entry.id === 'MATH-001' ? { ...entry, task: { kind: 'number', value: 999 } } : entry)),
  ));
  assert.notEqual(fingerprint, contentFingerprint(entries.slice(1)));
  assert.match(contentFingerprint([]), /^fp1:0:/);
});

test('interrupted round restores identically and continues without rescoring', () => {
  const seed = 424242;
  const reference = playFullRound(seed, question => question === 0 || question === 3);
  assert.equal(reference.state.phase, 'finished');
  assert.equal(reference.results.length, 10);

  // 中断局：同种子同作答；第 3 题答对后停在消除动画（resolving）内刷新。
  const rng = createSeededRng(seed);
  const session = new RoundSession(() => 0);
  session.beginRound();
  let state = createRound({ exercises: unionExercises, gradeOf, rng });
  const results = [];
  for (let question = 0; question < 3; question++) {
    const step = answerCurrent(state, rng, { wrongFirst: question === 0 });
    results.push(step.result);
    state = step.state;
    if (question < 2) {
      state = completeResolve(state);
    } else {
      session.scheduleTimer('resolve', ELIMINATE_MS + FILL_MS);
    }
  }
  const snapshotRaw = JSON.stringify(buildInterruptedSnapshot({
    gameId: GAME_ID,
    recordId: 'np-restore',
    grades: [1, 2],
    contentVersion,
    round: state,
    rngState: rng.snapshotState(),
    paused: false,
    timers: sessionTimers(session),
    results,
    savedAt: '2026-10-25T08:10:00.000Z',
  }));

  // 重载后：解析、版本检查、状态重建全部一致。
  const parsed = parseInterrupted(snapshotRaw);
  assert.equal(parsed.status, 'ok');
  assert.deepEqual(checkRestore(parsed.value, { gameId: GAME_ID, contentVersion }), { status: 'restorable' });
  const restored = roundFromSnapshot(parsed.value);
  assert.deepEqual(restored, state); // 题目、棋盘、分数、一次通过、答错数与阶段一致
  assert.equal(restored.score, 25); // 第 1 题 5 分（先答错）+ 第 2、3 题 10+10

  // 从恢复点继续：RNG 内部状态恢复后，与不间断参考局完全一致（无重复计分、无状态漂移）。
  const restoredSession = new RoundSession(() => 0);
  restoredSession.restoreRound({ paused: false, timers: parsed.value.timers });
  assert.deepEqual(restoredSession.remainingMs('resolve'), ELIMINATE_MS + FILL_MS);
  restoredSession.clearTimer('resolve');
  const resumedRng = restoreSeededRng(parsed.value.rngState);
  const resumedResults = parsed.value.results.map(question => ({ ...question }));
  let current = completeResolve(restored);
  for (let question = 3; question < 10; question++) {
    const step = answerCurrent(current, resumedRng, { wrongFirst: question === 3 });
    resumedResults.push(step.result);
    current = completeResolve(step.state);
  }
  assert.deepEqual(current, reference.state);
  assert.deepEqual(resumedResults, reference.results);
});

test('paused interrupted round restores frozen timers via restoreRound', () => {
  const clock = { now: 1000 };
  const session = new RoundSession(() => clock.now);
  session.beginRound();
  session.scheduleTimer('resolve', 600);
  clock.now += 250;
  session.pause(); // 冻结剩余 350
  const raw = JSON.stringify(buildInterruptedSnapshot({
    gameId: GAME_ID,
    recordId: 'np-paused',
    grades: [1],
    contentVersion,
    round: baseSnapshotRound(),
    rngState: 7,
    paused: true,
    timers: sessionTimers(session),
    results: [],
    savedAt: '2026-10-25T08:20:00.000Z',
  }));
  const parsed = parseInterrupted(raw);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.value.paused, true);
  assert.deepEqual(parsed.value.timers, [{ kind: 'resolve', remainingMs: 350 }]);
  const restored = new RoundSession(() => clock.now);
  restored.restoreRound({ paused: parsed.value.paused, timers: parsed.value.timers });
  assert.equal(restored.isPaused(), true);
  clock.now += 5000;
  assert.equal(restored.remainingMs('resolve'), 350); // 暂停期间不推进
  assert.deepEqual(restored.resume(), [{ kind: 'resolve', remainingMs: 350 }]);
});

test('a snapshot saved after the final correct click rebuilds the same record exactly once', () => {
  const reference = playFullRound(777, () => false);
  // 终局快照：phase finished、棋盘带一个终局空位、逐题结果齐全。
  const raw = JSON.stringify(buildInterruptedSnapshot({
    gameId: GAME_ID,
    recordId: 'np-final',
    grades: [1, 2],
    contentVersion,
    round: reference.state,
    rngState: createSeededRng(1).snapshotState(),
    paused: false,
    timers: [],
    results: reference.results,
    savedAt: '2026-10-25T08:30:00.000Z',
  }));
  const parsed = parseInterrupted(raw);
  assert.equal(parsed.status, 'ok');
  const state = roundFromSnapshot(parsed.value);
  assert.equal(state.phase, 'finished');
  const record = buildFinishedRecord({
    gameId: GAME_ID,
    recordId: 'np-final',
    grades: [1, 2],
    contentVersion,
    state,
    results: parsed.value.results,
    finishedAt: '2026-10-25T08:31:00.000Z',
  });
  assert.equal(record.score, reference.state.score);
  assert.deepEqual(record.questions, reference.results);
  // 清除失败等极端情况下重复结算：同 recordId 幂等，不产生两条成绩。
  const once = appendFinishedRecord([], record);
  const twice = appendFinishedRecord(once, {
    ...record,
    finishedAt: '2026-10-25T09:00:00.000Z',
  });
  assert.equal(once.length, 1);
  assert.equal(twice.length, 1);
  assert.deepEqual(twice.map(entry => entry.recordId), ['np-final']);
});

test('field-illegal interrupted snapshots are rejected while the valid baseline passes', () => {
  const base = baseSnapshot();
  assert.equal(parseInterrupted(JSON.stringify(base)).status, 'ok');
  const expectInvalid = (mutate, label) => {
    const value = JSON.parse(JSON.stringify(base));
    mutate(value);
    const parsed = parseInterrupted(JSON.stringify(value));
    assert.equal(parsed.status, 'invalid', label);
  };
  expectInvalid(value => { value.round.board = value.round.board.slice(0, 11); }, 'short board');
  expectInvalid(value => { value.round.board[0] = null; }, 'null slot while asking');
  expectInvalid(value => { value.round.board[0] = '7'; }, 'non-numeric tile');
  expectInvalid(value => { value.round.questionIndex = 99; }, 'question index out of range');
  expectInvalid(value => { value.round.phase = 'finished'; }, 'finished with wrong index');
  expectInvalid(value => { value.rngState = 4294967296; }, 'rngState beyond uint32');
  expectInvalid(value => { value.rngState = 1.5; }, 'rngState not an integer');
  expectInvalid(value => { value.paused = 'yes'; }, 'paused not boolean');
  expectInvalid(value => { value.timers.push({ kind: 'resolve', remainingMs: 1 }); }, 'duplicate timer kind');
  expectInvalid(value => { value.timers[0].remainingMs = -5; }, 'negative timer remaining');
  expectInvalid(value => { value.round.score += 5; }, 'score sum mismatch');
  expectInvalid(value => { value.round.totalWrongCount += 1; }, 'wrong sum mismatch');
  expectInvalid(value => { value.results.push({ exerciseId: 'X', firstTry: true, wrongCount: 0, score: 10 }); }, 'results length mismatch');
  expectInvalid(value => { value.grades = []; }, 'empty grades');
  expectInvalid(value => { value.gameId = ''; }, 'empty gameId');
  expectInvalid(value => { value.contentVersion = ''; }, 'empty contentVersion');
  expectInvalid(value => { value.savedAt = 'not-a-date'; }, 'bad savedAt');
  expectInvalid(value => { value.round.questions[0].task = { kind: 'binary', operator: '/', left: 1, right: 2 }; }, 'illegal operator');
  expectInvalid(value => { value.round.questions[0].tier = 'C'; }, 'unknown tier');
  expectInvalid(value => { value.schemaVersion = 2; }, 'foreign schema version');
});

test('content-version or game mismatch abandons only the interrupted round', () => {
  const store = memoryStore();
  const storage = new GameStorage(store);
  assert.ok(storage.isEnabled());
  assert.ok(storage.saveSettings({ schemaVersion: 1, selectedGrades: [1, 2], soundOn: false }));
  assert.ok(storage.appendFinishedRecord(makeRecord('history-1', { recordId: 'history-1' })));
  const stale = buildInterruptedSnapshot({
    gameId: GAME_ID,
    recordId: 'np-stale',
    grades: [1, 2],
    contentVersion: 'fp1:18:00000000deadbeef',
    round: baseSnapshotRound(),
    rngState: 1,
    paused: false,
    timers: [],
    results: [],
    savedAt: '2026-10-25T08:40:00.000Z',
  });
  assert.ok(storage.saveInterrupted(stale));
  // 启动流程：设置与历史成绩照常可读，中断局次判定为内容版本不兼容。
  assert.deepEqual(storage.loadSettings(), { schemaVersion: 1, selectedGrades: [1, 2], soundOn: false });
  assert.equal(storage.loadFinishedRecords().length, 1);
  const loaded = storage.loadInterrupted();
  assert.equal(loaded.status, 'ok');
  assert.deepEqual(
    checkRestore(loaded.value, { gameId: GAME_ID, contentVersion }),
    { status: 'incompatible', reason: 'content-version' },
  );
  assert.deepEqual(
    checkRestore({ ...loaded.value, gameId: 'other-game' }, { gameId: GAME_ID, contentVersion }),
    { status: 'incompatible', reason: 'game-id' },
  );
  // 安全放弃：只清中断快照，历史成绩与设置不受影响。
  storage.clearInterrupted();
  assert.equal(storage.loadInterrupted().status, 'empty');
  assert.equal(storage.loadFinishedRecords().length, 1);
  assert.deepEqual(storage.loadSettings().selectedGrades, [1, 2]);
});

test('storage unavailable or write failure keeps reads and game flow safe', () => {
  const blocked = new GameStorage(blockedStore());
  assert.equal(blocked.isEnabled(), false);
  assert.deepEqual(blocked.loadSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(blocked.loadFinishedRecords(), []);
  assert.equal(blocked.loadInterrupted().status, 'empty');
  assert.equal(blocked.saveInterrupted(baseSnapshot()), false);
  assert.equal(blocked.appendFinishedRecord(makeRecord('x')), false);
  assert.doesNotThrow(() => blocked.clearAll());
  assert.doesNotThrow(() => blocked.clearInterrupted());

  // 运行中写入失败（如配额满）：停用持久化，读取退回默认，游戏逻辑不受影响。
  let fail = false;
  const flaky = new GameStorage({
    getItem: () => null,
    setItem: () => { if (fail) throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  });
  assert.ok(flaky.isEnabled());
  assert.ok(flaky.appendFinishedRecord(makeRecord('kept')));
  fail = true;
  assert.equal(flaky.appendFinishedRecord(makeRecord('dropped')), false);
  assert.equal(flaky.isEnabled(), false);
  assert.deepEqual(flaky.loadFinishedRecords(), []);
  assert.equal(flaky.saveSettings({ schemaVersion: 1, selectedGrades: [1], soundOn: true }), false);
  assert.doesNotThrow(() => flaky.clearAll());
});

test('buildFinishedRecord refuses a round that has not finished', () => {
  const asking = baseSnapshotRound();
  assert.throws(() => buildFinishedRecord({
    gameId: GAME_ID,
    recordId: 'np-bad',
    grades: [1],
    contentVersion,
    state: asking,
    results: [],
    finishedAt: '2026-10-25T08:00:00.000Z',
  }), RangeError);
});
