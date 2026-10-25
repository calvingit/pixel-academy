// 单局会话状态机测试（PLAN.md M4：暂停/继续/切后台不推进需要玩家参与的状态）。
// RoundSession 是纯逻辑：宿主注入时钟，把 pause/resume 返回值落到真实 setTimeout。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundSession } from '../dist/game/number-puzzle/session.js';

const makeClock = () => {
  let now = 0;
  return {
    now: () => now,
    advance: ms => { now += ms; },
  };
};

test('lifecycle: idle → running → paused → running → finished with strict transitions', () => {
  const clock = makeClock();
  const session = new RoundSession(clock.now);
  assert.equal(session.state, 'idle');
  assert.equal(session.isPaused(), false);
  // idle 下不能登记计时器，也不能结算/弃局。
  assert.throws(() => session.scheduleTimer('resolve', 600), Error);
  assert.throws(() => session.finishRound(), Error);
  assert.throws(() => session.abandonRound(), Error);
  session.beginRound();
  assert.equal(session.state, 'running');
  assert.throws(() => session.beginRound(), Error); // 不能重复开局
  session.scheduleTimer('resolve', 600);
  const pending = session.pause();
  assert.equal(session.state, 'paused');
  assert.equal(session.isPaused(), true);
  assert.deepEqual(pending, [{ kind: 'resolve', remainingMs: 600 }]);
  assert.deepEqual(session.resume(), [{ kind: 'resolve', remainingMs: 600 }]);
  assert.equal(session.state, 'running');
  session.finishRound();
  assert.equal(session.state, 'finished');
  // 结束后暂停/继续/登记计时器都是空操作或报错。
  assert.deepEqual(session.pause(), []);
  assert.deepEqual(session.resume(), []);
  assert.equal(session.isPaused(), false);
  assert.throws(() => session.scheduleTimer('feedback', 300), Error);
});

test('pause freezes the remaining duration; wall-clock time while paused does not advance it', () => {
  const clock = makeClock();
  const session = new RoundSession(clock.now);
  session.beginRound();
  session.scheduleTimer('resolve', 600);
  clock.advance(250);
  assert.equal(session.remainingMs('resolve'), 350);
  const pending = session.pause();
  assert.deepEqual(pending, [{ kind: 'resolve', remainingMs: 350 }]);
  // 暂停期间真实时间继续流逝，剩余时长保持冻结值。
  clock.advance(500);
  assert.equal(session.remainingMs('resolve'), 350);
  // 恢复时以冻结剩余重新挂载：再走 350ms 计时器到点。
  const resumed = session.resume();
  assert.deepEqual(resumed, [{ kind: 'resolve', remainingMs: 350 }]);
  clock.advance(349);
  assert.equal(session.remainingMs('resolve'), 1);
  clock.advance(1);
  assert.equal(session.remainingMs('resolve'), 0);
});

test('autoPause (visibilitychange hidden) pauses only a running round and never auto-resumes', () => {
  const clock = makeClock();
  // idle：切后台不动作。
  const idle = new RoundSession(clock.now);
  assert.equal(idle.autoPause(), false);
  assert.equal(idle.state, 'idle');
  // running：切后台自动暂停并冻结计时器。
  const session = new RoundSession(clock.now);
  session.beginRound();
  session.scheduleTimer('feedback', 300);
  clock.advance(120);
  assert.equal(session.autoPause(), true);
  assert.equal(session.state, 'paused');
  assert.deepEqual(session.remainingMs('feedback'), 180);
  // 已暂停时再次 hidden 不重复动作，冻结值不变；前台恢复也不自动继续。
  assert.equal(session.autoPause(), false);
  clock.advance(900);
  assert.equal(session.remainingMs('feedback'), 180);
  assert.equal(session.state, 'paused');
  // finished：切后台不动作。
  session.resume();
  session.finishRound();
  assert.equal(session.autoPause(), false);
  assert.equal(session.state, 'finished');
});

test('pause/resume are idempotent and a second pause keeps the first frozen remaining', () => {
  const clock = makeClock();
  const session = new RoundSession(clock.now);
  session.beginRound();
  session.scheduleTimer('resolve', 600);
  clock.advance(100);
  assert.deepEqual(session.pause(), [{ kind: 'resolve', remainingMs: 500 }]);
  clock.advance(100);
  assert.deepEqual(session.pause(), []); // 已暂停：幂等
  assert.equal(session.remainingMs('resolve'), 500); // 不被二次暂停重算
  assert.deepEqual(session.resume(), [{ kind: 'resolve', remainingMs: 500 }]);
  assert.deepEqual(session.resume(), []); // 运行中：幂等
  assert.equal(session.remainingMs('resolve'), 500); // 以继续时刻为基准重新计时
});

test('expired timers clamp to zero and pause reports zero remaining, never negative', () => {
  const clock = makeClock();
  const session = new RoundSession(clock.now);
  session.beginRound();
  session.scheduleTimer('resolve', 300);
  clock.advance(1000);
  assert.equal(session.remainingMs('resolve'), 0);
  assert.deepEqual(session.pause(), [{ kind: 'resolve', remainingMs: 0 }]);
  assert.equal(session.remainingMs('resolve'), 0);
  // 竞态口径：冻结剩余为 0 的计时器由宿主以 setTimeout(0) 重新挂载，立即补触发。
  assert.deepEqual(session.resume(), [{ kind: 'resolve', remainingMs: 0 }]);
});

test('abandonRound clears every timer and allows a fresh round; pause snapshot covers both kinds', () => {
  const clock = makeClock();
  const session = new RoundSession(clock.now);
  session.beginRound();
  session.scheduleTimer('resolve', 600);
  session.scheduleTimer('feedback', 300);
  clock.advance(50);
  const pending = session.pause();
  assert.deepEqual(pending, [
    { kind: 'resolve', remainingMs: 550 },
    { kind: 'feedback', remainingMs: 250 },
  ]);
  session.clearTimer('resolve');
  assert.equal(session.remainingMs('resolve'), null);
  assert.equal(session.remainingMs('feedback'), 250);
  // 弃局（返回年级选择 / 重新开始）：清空全部计时，回到 idle 可再开局。
  session.abandonRound();
  assert.equal(session.state, 'idle');
  assert.equal(session.remainingMs('feedback'), null);
  session.beginRound();
  assert.equal(session.state, 'running');
  assert.equal(session.remainingMs('resolve'), null);
  // 结算后（finished）同样可以弃局回 idle：支撑「再来一局」。
  session.finishRound();
  session.abandonRound();
  assert.equal(session.state, 'idle');
});

test('invalid durations are rejected', () => {
  const clock = makeClock();
  const session = new RoundSession(clock.now);
  session.beginRound();
  assert.throws(() => session.scheduleTimer('resolve', -1), RangeError);
  assert.throws(() => session.scheduleTimer('resolve', Number.NaN), RangeError);
  assert.throws(() => session.scheduleTimer('resolve', Number.POSITIVE_INFINITY), RangeError);
});
