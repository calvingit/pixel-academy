// 本地验收：npm run serve -- 4176；ego-browser nodejs < 本文件。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = '/Volumes/Data/Workspace/github/pixel-academy';
const output = `${root}/docs/evidence/dynamic-question-bank`;
const t = await taskSpace('pixel-academy-dynamic-20261026');
const p = t.page('p1');
const key = 'pixel-academy:number-puzzle:v1:interrupted';
const recentKey = 'pixel-academy:number-puzzle:v1:recent-exercises';
const version = (await readFile(`${root}/web/sw.js`, 'utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await p.goto('http://127.0.0.1:4176/');
await p.evaluate(async () => (await navigator.serviceWorker.ready).update());
await p.waitForFunction(version => document.querySelector('#offline-notice').textContent.includes(version), version);
await p.cdp('Page.bringToFront');
await p.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await p.reload();
const initialRecords = await p.evaluate(() => JSON.parse(localStorage.getItem('pixel-academy:number-puzzle:v1:records'))?.records.length ?? 0);
const snapshot = () => p.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const screenshot = name => p.screenshot({ path: `${output}/${name}.png`, fullPage: true });
async function start(grades) {
  await p.evaluate(grades => {
    for (const input of document.querySelectorAll('input[name=grade]')) {
      if (input.checked !== grades.includes(Number(input.value))) input.click();
    }
    document.querySelector('#btn-to-availability').click();
  }, grades);
  assert.match(await p.evaluate(() => document.querySelector('#availability-status').textContent), /动态出题 · 每局 10 题/);
  await screenshot(`availability-${grades.join('-')}`);
  await p.click('#btn-start');
  const s = await snapshot();
  assert.equal(s.round.questions.length, 10);
  assert.equal(new Set(s.round.questions.map(q => q.exerciseId)).size, 10);
  return s;
}
async function answer(wrong = false) {
  const step = await p.evaluate(async ({ key, wrong }) => {
    if (!document.querySelector('#pause-overlay').hidden) document.querySelector('#btn-resume').click();
    const { answerFor } = await import('/dist/learning/evaluation.js');
    const s = JSON.parse(localStorage.getItem(key));
    const expected = answerFor(s.round.questions[s.round.questionIndex].task);
    const i = s.round.board.findIndex(value => value !== null && (wrong ? value !== expected : value === expected));
    const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect();
    const event = { clientX: r.left + (10 + i % 3 * 116 + 54) * r.width / 360,
      clientY: r.top + (238 + Math.floor(i / 3) * 96 + 44) * r.height / 620, bubbles: true };
    for (let n = 0; n < 3; n++) canvas.dispatchEvent(new PointerEvent('pointerdown', event));
    return { index: s.round.questionIndex, task: s.round.questions[s.round.questionIndex].task, expected };
  }, { key, wrong });
  await p.waitForFunction(({ key, index, wrong }) => {
    const s = JSON.parse(localStorage.getItem(key));
    return s === null || (s.round.phase === 'asking' && (wrong || s.round.questionIndex > index));
  }, { key, index: step.index, wrong });
  return step;
}
async function finish() {
  const steps = [];
  for (let n = 0; n < 10; n++) {
    if (await p.evaluate(() => !document.querySelector('#screen-result').hidden)) break;
    const s = await snapshot(), task = s.round.questions[s.round.questionIndex].task;
    if (task.kind === 'chain' || task.operator === '*') await screenshot(task.kind === 'chain' ? 'task-chain' : 'task-dots');
    steps.push(await answer());
  }
  await p.waitForSelector('#screen-result', { state: 'visible' });
  const text = await p.evaluate(() => document.querySelector('#screen-result').innerText);
  assert.match(text, /一次通过 10\/10/);
  assert.match(text, /总分 100/);
  return { text, steps };
}
const grade1 = await start([1]);
await answer();
const before = await snapshot();
await p.reload();
await p.waitForSelector('#btn-restore', { state: 'visible' });
await p.click('#btn-restore');
const restored = await snapshot();
assert.equal(restored.recordId, before.recordId);
assert.deepEqual(restored.round, before.round);
const grade1Result = await finish();
await p.click('#btn-again');
const again = await snapshot();
assert.equal(again.round.questions.filter(q => grade1.round.questions.some(old => old.exerciseId === q.exerciseId)).length, 0);
await p.reload();
assert.deepEqual(await p.evaluate(key => JSON.parse(localStorage.getItem(key)), recentKey), again.round.questions.map(q => q.exerciseId));
await p.click('#btn-restore');
await p.click('#btn-restart');
assert.equal((await snapshot()).recordId, again.recordId);
await p.click('#btn-restart');
const restarted = await snapshot();
assert.notEqual(restarted.recordId, again.recordId);
assert.equal(restarted.round.questions.filter(q => again.round.questions.some(old => old.exerciseId === q.exerciseId)).length, 0);
await p.click('#btn-game-return');
await start([2]);
const grade2Result = await finish();
await screenshot('result-grade2');
await p.click('#btn-again');
await p.click('#btn-game-return');
await start([1, 2]);
const mixed = await snapshot();
assert.equal(mixed.round.questions.filter(q => q.tier === 'A').length, 5);
assert.equal(mixed.round.questions.filter(q => q.tier === 'B').length, 5);
const sizes = [];
for (const [width, height] of [[320, 568], [390, 844], [568, 320], [1280, 900]]) {
  await p.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const size = await p.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
  assert.equal(size.overflow, false); sizes.push(size); await screenshot(`game-${width}`);
}
await p.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mixedResult = await finish();
await p.click('#btn-again');
await p.click('#btn-game-return');
await p.cdp('Network.enable');
await p.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await p.reload();
await p.waitForSelector('#screen-select', { state: 'visible' });
await start([2]);
const offlineResult = await finish();
assert.equal(await p.evaluate(() => navigator.onLine), false);
await screenshot('offline-result');
await p.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
// 通过旧静态内容构造真实 v1 快照，验证旧局次指纹仍被新入口接受。
const legacy = await p.evaluate(async key => {
  const { loadGameContent } = await import('/dist/game/number-puzzle/content.js');
  const { createRound } = await import('/dist/game/number-puzzle/rules.js');
  const { createSeededRng } = await import('/dist/game/number-puzzle/random.js');
  const { buildInterruptedSnapshot, contentFingerprint } = await import('/dist/game/number-puzzle/storage.js');
  const c = loadGameContent(), rows = c.legacySelect([2]), rng = createSeededRng(99);
  const round = createRound({ exercises: rows, gradeOf: c.gradeOf, rng });
  const s = buildInterruptedSnapshot({ gameId: 'number-puzzle', recordId: 'np-legacy-dynamic-verification', grades: [2],
    contentVersion: contentFingerprint(rows.map(e => ({ id: e.id, grade: c.gradeOf(e), task: e.task }))),
    round, rngState: rng.snapshotState(), paused: true, timers: [], results: [], savedAt: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(s)); return s;
}, key);
await p.reload();
await p.waitForSelector('#btn-restore', { state: 'visible' });
await p.click('#btn-restore');
assert.deepEqual((await snapshot()).round, legacy.round);
await screenshot('legacy-restore');
await p.click('#btn-game-return');
const final = await p.evaluate(() => ({ records: JSON.parse(localStorage.getItem('pixel-academy:number-puzzle:v1:records')).records.length,
  errors: window.__errors, userAgent: navigator.userAgent, offline: document.querySelector('#offline-notice').textContent }));
assert.equal(final.records, initialRecords + 4);
assert.deepEqual(final.errors, []);
const results = { version, sizes, initialRecords, final, grade1Result, grade2Result, mixedResult, offlineResult,
  restoredRecordId: restored.recordId, legacyRestored: true };
await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2));
console.log({ version, sizes, initialRecords, final, restored: true, legacyRestored: true });
await t.finish({ keep: [] });
