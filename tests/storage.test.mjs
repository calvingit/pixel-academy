import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LegacyStorage, STORAGE_KEYS, parseMathTask, parseSettings, parseRecords } from '../dist/game/number-puzzle/storage.js';
import { ProfileStore, ConflictError, createProfile, parseProfile, buy, consume, rename, collectMistake,
  rewardCourse, rewardReview, settleChallenge } from '../dist/game/number-puzzle/profile.js';
import { loadGameContent } from '../dist/game/number-puzzle/content.js';
import { createRound, completeResolve, clickTile } from '../dist/game/number-puzzle/rules.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';
import { answerFor } from '../dist/index.js';
import { taskIdentity } from '../dist/game/number-puzzle/learning.js';
const content = loadGameContent();
const exercise = content.select([1])[0];
const backend = () => ({ value: undefined, fail: false,
  async read() { return structuredClone(this.value); },
  async update(expected, next) {
    if (this.fail) throw new Error('disk full');
    if (expected !== 'reset' && (expected === null ? this.value !== undefined : this.value?.revision !== expected)) throw new ConflictError();
    if (expected === 'reset') next.revision = (this.value?.revision ?? -1) + 1;
    this.value = structuredClone(next);
  },
});

test('legacy import reads settings and records without touching old keys or restoring old rounds', () => {
  const values = new Map([[STORAGE_KEYS.settings, JSON.stringify({ schemaVersion: 1, selectedGrades: [2, 1], soundOn: false })],
    [STORAGE_KEYS.interrupted, 'old-round'], [STORAGE_KEYS.recentExercises, '["old-id"]']]);
  const snapshot = [...values];
  const storage = new LegacyStorage({ getItem: key => values.get(key) ?? null });
  assert.deepEqual(storage.loadSettings().selectedGrades, [2, 1]);
  assert.deepEqual(storage.loadFinishedRecords(), []);
  assert.deepEqual(storage.loadRecentExerciseIds(), ['old-id']);
  assert.deepEqual([...values], snapshot);
  assert.equal(storage.loadInterrupted, undefined);
  assert.equal(parseSettings('{').status, 'invalid');
  assert.equal(parseRecords('{').status, 'invalid');
  assert.equal(parseMathTask({ kind: 'chain', start: 1, steps: [] }), null);
});

test('profile initialization is idempotent, imports once, and concurrent creation grants only one gift', async () => {
  const db = backend(), store = new ProfileStore(db);
  let imports = 0;
  const initial = () => { imports++; return createProfile(); };
  const [a, b] = await Promise.all([store.load(initial), store.load(initial)]);
  assert.equal(a.coins, 20); assert.equal(b.coins, 20);
  assert.equal((await store.load(initial)).cards.hint, 2);
  assert.equal(imports, 2);
  assert.deepEqual(db.value, a);
});

test('purchase failure rolls back balance, stock and state; stale tabs cannot overwrite data', async () => {
  const db = backend(), store = new ProfileStore(db), old = await store.load(createProfile);
  db.fail = true;
  await assert.rejects(store.commit(old, p => buy(p, 'revive')), /保存失败/);
  assert.equal(db.value.coins, 20); assert.equal(db.value.cards.revive, 0);
  db.fail = false;
  const current = await store.commit(old, p => buy(p, 'revive'));
  assert.equal(current.coins, 5); assert.equal(current.cards.revive, 1);
  await assert.rejects(store.commit(old, p => buy(p, 'time')), ConflictError);
  await assert.rejects(store.commit(current, p => { buy(p, 'time'); consume(p, 'rename'); }), /库存/);
  assert.deepEqual(db.value, current);
});

test('cards and cosmetics cannot overdraw, permanent purchases and invalid renames cannot consume twice', () => {
  const p = createProfile(); p.coins = 500;
  buy(p, 'cat'); assert.equal(p.coins, 470); assert.ok(p.avatars.includes('cat'));
  assert.throws(() => buy(p, 'cat'), /拥有/);
  rename(p, '小猫'); assert.equal(p.cards.rename, 0);
  assert.throws(() => rename(p, '小兔'), /库存/);
  buy(p, 'rename'); rename(p, '小兔'); assert.equal(p.cards.rename, 0);
  assert.throws(() => rename(p, '  小兔  '), /变化/);
  assert.throws(() => rename(p, '  '), /1～8/);
  p.nickname = ''; rename(p, '👩‍👩‍👧‍👦'); assert.equal(p.nickname, '👩‍👩‍👧‍👦');
  assert.throws(() => consume(p, 'time'), /库存/);
  p.coins = 0; assert.throws(() => buy(p, 'revive'), /还差 15/);
});

test('mistakes keep originals, merge changed IDs, reopen after mastery without repeating rewards', () => {
  const p = createProfile(), id = taskIdentity(exercise.task);
  collectMistake(p, exercise, 1, 'wrong');
  collectMistake(p, { ...exercise, id: 'changed-version' }, 1, 'wrong');
  assert.equal(Object.keys(p.mistakes).length, 1);
  assert.equal(p.mistakes[id].exercise.id, exercise.id);
  assert.equal(p.mistakes[id].wrongs, 2);
  assert.equal(rewardReview(p, id, false), 0);
  assert.equal(rewardReview(p, id, true), 2);
  p.mistakes[id].mastered = true;
  collectMistake(p, exercise, 1, 'wrong');
  assert.equal(p.mistakes[id].mastered, false);
  assert.equal(rewardReview(p, id, true), 0);
  assert.equal(p.coins, 22);
  const timed = content.select([1])[1], tid = taskIdentity(timed.task);
  collectMistake(p, timed, 1, 'timeout'); assert.equal(rewardReview(p, tid, true), 0);
});

test('course completion requires a clean full attempt and can award only once', () => {
  const p = createProfile();
  p.practice = { courseId: 'numbers', reviewId: null, exercises: [exercise, exercise, exercise], index: 3,
    correct: 2, answered: true, revealed: false, passed: false };
  assert.throws(() => rewardCourse(p, 'numbers'), /全部三题/);
  p.practice.correct = 3; p.practice.passed = true;
  assert.equal(rewardCourse(p, 'numbers'), 10); assert.equal(rewardCourse(p, 'numbers'), 0);
  p.records = []; p.legacyRecords = []; assert.equal(rewardCourse(p, 'numbers'), 0);
  assert.equal(p.coins, 30);
});

test('settlement saves wallet and permanent receipt together even if records are cleared', async () => {
  const rng = createSeededRng(3);
  let state = createRound({ exercises: content.select([1]).filter(e => e.task.kind !== 'choice'), gradeOf: content.gradeOf, rng });
  while (state.phase !== 'finished') state = completeResolve(clickTile(state, state.board.indexOf(answerFor(state.questions[state.questionIndex].task)), rng).state);
  const challenge = { id: 'one', state, grades: [1], rngState: rng.snapshotState(), contentVersion: 'v', paused: true, remainingMs: 0, deadline: null, timerKind: null };
  const db = backend(), store = new ProfileStore(db), initial = await store.load(createProfile);
  db.fail = true;
  await assert.rejects(store.commit(initial, p => settleChallenge(p, challenge, '2026-10-26T00:00:00Z')), /保存失败/);
  assert.equal(db.value.coins, 20); assert.deepEqual(db.value.settledRounds, []);
  db.fail = false;
  const p = await store.commit(initial, p => { p.challenge = challenge; settleChallenge(p, challenge, '2026-10-26T00:00:00Z'); });
  assert.equal(p.coins, 50); assert.equal(p.challenge, null); assert.equal(p.records.length, 1);
  p.records = []; assert.equal(settleChallenge(p, challenge, '2026-10-26T00:00:00Z'), 0);
});

test('profile validation rejects corruption rather than resetting wallet or reward eligibility', () => {
  assert.deepEqual(parseProfile(createProfile()), createProfile());
  for (const mutate of [p => p.coins = -1, p => p.cards.hint = 'two', p => p.avatar = 'unknown', p => p.settledRounds = [3], p => p.courses.x = { rewarded: 'yes' }, p => p.challenge = {}]) {
    const p = createProfile(); mutate(p); assert.throws(() => parseProfile(p));
  }
});

test('explicit reset recovers corrupted data and invalidates previously loaded revisions', async () => {
  const db = backend(), store = new ProfileStore(db), old = await store.load(createProfile);
  const reset = await store.reset(); assert.equal(reset.coins, 20); assert.equal(reset.revision, old.revision + 1);
  await assert.rejects(store.commit(old, p => buy(p, 'time')), ConflictError);
  db.value.cards = 'broken'; await assert.rejects(store.load(createProfile), /损坏/);
  const recovered = await store.reset(); assert.deepEqual(recovered.cards, createProfile().cards);
});

test('legacy records keep valid historical entries, reject illegal records and overflowing tasks', () => {
  const record = { schemaVersion: 1, recordId: 'old', gameId: 'number-puzzle', finishedAt: '2026-10-25T00:00:00Z',
    grades: [1], contentVersion: 'old-content', score: 10, firstTryCount: 1, totalWrongCount: 0,
    questions: [{ exerciseId: 'MATH-001', firstTry: true, wrongCount: 0, score: 10 }] };
  const raw = JSON.stringify({ schemaVersion: 1, records: [record, { ...record, score: -1 }] });
  const legacy = new LegacyStorage({ getItem: key => key === STORAGE_KEYS.records ? raw : null });
  assert.deepEqual(legacy.loadFinishedRecords(), [record]);
  assert.equal(parseMathTask({ kind: 'binary', operator: '*', left: Number.MAX_SAFE_INTEGER, right: 2 }), null);
});
