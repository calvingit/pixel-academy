// 运行：ego-browser nodejs < docs/evidence/game-style/browser-check.mjs（需本地 4175 服务）。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = '/Volumes/Data/Workspace/github/pixel-academy';
const evidence = `${root}/docs/evidence/game-style`;
const t = await taskSpace('pixel-academy-game-style-20261026');
const p = t.page('p1');
await p.cdp('Page.bringToFront');
const key = 'pixel-academy:number-puzzle:v1:interrupted';
const targetVersion = (await readFile(`${root}/web/sw.js`, 'utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await p.goto('http://127.0.0.1:4175/');
await p.evaluate(async () => (await navigator.serviceWorker.ready).update());
await p.waitForFunction(version => document.querySelector('#offline-notice').textContent.includes(version), targetVersion);
await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await p.reload();
const initialRecords = await p.evaluate(() => JSON.parse(localStorage.getItem('pixel-academy:number-puzzle:v1:records'))?.records.length ?? 0);
async function start(grades) {
  await p.evaluate(grades => {
    for (const input of document.querySelectorAll('input[name=grade]')) {
      if (input.checked !== grades.includes(Number(input.value))) input.click();
    }
    document.querySelector('#btn-to-availability').click();
    document.querySelector('#btn-start').click();
  }, grades);
}
async function screenshot(name) { await p.screenshot({ path: `${evidence}/${name}.png`, fullPage: true }); }
async function clickTile(wrong = false) {
  return p.evaluate(async ({ key, wrong }) => {
    if (!document.querySelector('#pause-overlay').hidden) document.querySelector('#btn-resume').click();
    const { answerFor } = await import('/dist/learning/evaluation.js');
    const s = JSON.parse(localStorage.getItem(key));
    const answer = answerFor(s.round.questions[s.round.questionIndex].task);
    const i = s.round.board.findIndex(value => value !== null && (wrong ? value !== answer : value === answer));
    const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect();
    const event = { clientX: r.left + (10 + i % 3 * 116 + 54) * r.width / 360, clientY: r.top + (238 + Math.floor(i / 3) * 96 + 44) * r.height / 620, bubbles: true };
    for (let n = 0; n < 3; n++) canvas.dispatchEvent(new PointerEvent('pointerdown', event));
    return { index: s.round.questionIndex, task: s.round.questions[s.round.questionIndex].task, answer, tile: i };
  }, { key, wrong });
}
async function completeRound() {
  const steps = [];
  for (let n = 0; n < 10; n++) {
    if (await p.evaluate(() => !document.querySelector('#screen-result').hidden)) break;
    const task = await p.evaluate(key => {
      const s = JSON.parse(localStorage.getItem(key));
      return s.round.questions[s.round.questionIndex].task;
    }, key);
    if (task.kind === 'chain' || task.kind === 'binary') await screenshot(`task-${task.kind === 'chain' ? 'chain' : task.operator === '*' ? 'dots-' + task.left : 'binary'}`);
    const step = await clickTile();
    steps.push(step);
    await p.waitForFunction(({ key, index }) => {
      const s = JSON.parse(localStorage.getItem(key));
      return s === null || (s.round.phase === 'asking' && s.round.questionIndex > index);
    }, { key, index: step.index });
  }
  await p.waitForSelector('#screen-result', { state: 'visible' });
  return steps;
}
await screenshot('select-390');
await start([1, 2]);
const sizes = [];
for (const [width, height] of [[320, 568], [390, 844], [412, 915], [568, 320], [1280, 900]]) {
  await p.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const size = await p.evaluate(() => {
    const c = document.querySelector('canvas').getBoundingClientRect();
    return { viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth > innerWidth, canvas: [c.width, c.height], tile: [108 * c.width / 360, 88 * c.height / 620], minButton: Math.min(...[...document.querySelectorAll('button')].filter(b => b.getClientRects().length).flatMap(b => [b.getBoundingClientRect().width, b.getBoundingClientRect().height])) };
  });
  assert.equal(size.overflow, false); assert.ok(size.tile.every(n => n >= 48)); assert.ok(size.minButton >= 48);
  sizes.push(size); await screenshot(`game-${width}`);
}
await p.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await p.evaluate(() => {
  if (!document.querySelector('#pause-overlay').hidden) document.querySelector('#btn-resume').click();
  document.querySelector('#btn-pause').click();
});
assert.equal(await p.evaluate(() => document.querySelector('#pause-overlay').hidden), false);
await screenshot('pause-390');
await p.evaluate(() => document.querySelector('#btn-resume').click());
const before = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
await p.reload(); await p.waitForSelector('#btn-restore', { state: 'visible' });
await screenshot('restore-390'); await p.click('#btn-restore');
const after = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
assert.equal(after.recordId, before.recordId); assert.deepEqual(after.round, before.round);
for (let n = 0; n < 3; n++) {
  await clickTile(true);
  await p.waitForFunction(key => JSON.parse(localStorage.getItem(key)).round.phase === 'asking', key);
}
await screenshot('wrong-hint-390');
const onlineSteps = await completeRound();
const online = await p.evaluate(() => ({ text: document.querySelector('#screen-result').innerText, records: JSON.parse(localStorage.getItem('pixel-academy:number-puzzle:v1:records')).records, errors: window.__errors }));
assert.match(online.text, /总分 95/); assert.match(online.text, /答错 3 次/);
assert.equal(online.records.length, initialRecords + 1); assert.deepEqual(online.errors, []);
await screenshot('result-390');
await p.evaluate(() => document.querySelector('#btn-again').click());
assert.equal(await p.evaluate(key => JSON.parse(localStorage.getItem(key)).round.score, key), 0);
await p.evaluate(() => document.querySelector('#btn-game-return').click());
await screenshot('select-390');
await p.cdp('Network.enable');
await p.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await p.reload(); await p.waitForSelector('#screen-select', { state: 'visible' });
await start([2]); const offlineSteps = await completeRound();
const offline = await p.evaluate(() => ({ text: document.querySelector('#screen-result').innerText, count: JSON.parse(localStorage.getItem('pixel-academy:number-puzzle:v1:records')).records.length, errors: window.__errors, online: navigator.onLine }));
assert.equal(offline.online, false); assert.match(offline.text, /总分 60/); assert.equal(offline.count, initialRecords + 2); assert.deepEqual(offline.errors, []);
await screenshot('offline-result-390');
await p.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await writeFile(`${evidence}/browser-results.json`, JSON.stringify({ targetVersion, sizes, restoredRecordId: before.recordId, onlineSteps, online, offlineSteps, offline }, null, 2));
console.log({ sizes, online: online.text, offline });
