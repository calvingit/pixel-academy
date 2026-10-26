import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRound, clickTile, timeoutRound, reviveRound, startQuestion, useHint, useExtraTime,
  completeResolve, roundReward } from '../dist/game/number-puzzle/rules.js';
import { loadGameContent } from '../dist/game/number-puzzle/content.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';
import { answerFor } from '../dist/index.js';
const content = loadGameContent();
const rng = createSeededRng(7);
const create = () => createRound({ exercises: content.select([1]), gradeOf: content.gradeOf, rng });

test('two revivals cap all interruptions and no automatic answer hint is activated', () => {
  let s = create(); const wrong = s.board.findIndex(n => n !== answerFor(s.questions[0].task));
  assert.throws(() => useHint(s));
  s = clickTile(s, wrong, rng).state; assert.equal(s.phase, 'interrupted'); assert.equal(s.hintUsed, false);
  assert.equal(clickTile(s, wrong, rng).outcome.type, 'ignored');
  s = startQuestion(reviveRound(s)); s = clickTile(s, wrong, rng).state;
  s = useHint(reviveRound(s)); assert.equal(s.phase, 'ready'); assert.equal(s.revivals, 2); assert.equal(s.hintUsed, true);
  s = startQuestion(s); s = timeoutRound(s);
  assert.equal(s.result, 'failed'); assert.equal(s.phase, 'finished'); assert.equal(s.totalWrongCount, 2); assert.equal(s.totalTimeoutCount, 1);
  assert.throws(() => reviveRound(s)); assert.equal(roundReward(s), 0);
});

test('timeouts do not unlock hints, revival denies first-try rewards, time card stays used', () => {
  let s = useExtraTime(create()); s = timeoutRound(s); s = startQuestion(reviveRound(s));
  assert.equal(s.timeUsed, true); assert.throws(() => useExtraTime(s)); assert.throws(() => useHint(s));
  const step = clickTile(s, s.board.indexOf(answerFor(s.questions[0].task)), rng);
  assert.equal(step.outcome.gainedScore, 5); assert.equal(step.state.firstTryCount, 0);
  assert.equal(completeResolve(step.state).timeUsed, false);
});

