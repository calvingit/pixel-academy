import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundSession } from '../dist/game/number-puzzle/session.js';
const timer = () => ({ paused: false, remainingMs: 0, deadline: null, timerKind: null });
test('deadline is authoritative, exact deadline expires and delayed callbacks cannot create extra time', () => {
  let now = 100; const session = new RoundSession(() => now), t = timer();
  session.start(t, 'question', 10000); now = 10099; assert.equal(session.remaining(t), 1);
  now = 10100; assert.equal(session.remaining(t), 0); now = 20000; assert.equal(session.remaining(t), 0);
});
test('pause and resume freeze remaining time, repeated pause is idempotent', () => {
  let now = 0; const session = new RoundSession(() => now), t = timer();
  session.start(t, 'question', 10000); now = 3200; session.pause(t); now = 50000;
  assert.equal(session.remaining(t), 6800); session.pause(t); assert.equal(t.remainingMs, 6800);
  session.resume(t); assert.equal(t.deadline, 56800); now = 56800; assert.equal(session.remaining(t), 0);
});
test('persisted running state deducts elapsed time while paused restore does not', () => {
  let now = 0; const session = new RoundSession(() => now), t = timer(); session.start(t, 'question', 10000);
  now = 9000; const restored = JSON.parse(JSON.stringify(t)); session.pause(restored);
  assert.equal(restored.remainingMs, 1000); now = 100000; assert.equal(session.remaining(restored), 1000);
  session.resume(restored); assert.equal(session.remaining(restored), 1000);
});
test('extra time preserves elapsed duration and ready states do not start clocks', () => {
  let now = 0; const session = new RoundSession(() => now), t = timer(); session.start(t, 'question', 10000);
  now = 8000; session.start(t, 'question', session.remaining(t) + 5000); assert.equal(session.remaining(t), 7000);
  session.start(t, null, 10000); now = 100000; assert.equal(session.remaining(t), 10000); assert.equal(t.deadline, null);
  assert.throws(() => session.start(t, 'question', -1), RangeError);
  assert.throws(() => session.start(t, 'question', Infinity), RangeError);
});
