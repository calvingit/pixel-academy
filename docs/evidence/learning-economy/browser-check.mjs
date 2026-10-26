// 仅操作本机 4180 验收源站；不清空档案，金币通过实际课程与挑战获得。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = '/Volumes/Data/Workspace/github/pixel-academy';
const output = `${root}/docs/evidence/learning-economy`;
const task = await taskSpace(5), page = task.page('p1');
const version = (await readFile(`${root}/web/sw.js`, 'utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await page.goto('http://127.0.0.1:4180/');
await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
await page.waitForFunction(v => document.querySelector('#offline-notice').textContent.includes(v), version);
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const idle = () => page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
const click = async selector => { await page.click(selector); await idle(); };
const profile = () => page.evaluate(async () => {
  const request = indexedDB.open('pixel-academy');
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return new Promise((resolve, reject) => { const tx = db.transaction('profiles'); const r = tx.objectStore('profiles').get('local'); r.onsuccess = () => { db.close(); resolve(r.result); }; r.onerror = () => reject(r.error); });
});
const shot = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
async function answer(wrong = false) {
  const s = await profile();
  const question = s.practice ? s.practice.exercises[s.practice.index].task : s.challenge.state.questions[s.challenge.state.questionIndex].task;
  const index = await page.evaluate(async ({ question, wrong }) => {
    const { answerFor } = await import('/dist/learning/evaluation.js');
    const canvas = document.querySelector('#board-canvas');
    const board = canvas.getAttribute('aria-label').split('按行排列：')[1].split('。')[0].split('、').map(Number);
    const expected = answerFor(question), index = board.findIndex(v => wrong ? v !== expected : v === expected);
    if (index < 0) throw new Error('正确答案不在渲染棋盘');
    const rect = canvas.getBoundingClientRect();
    const event = { clientX: rect.left + (10 + index % 3 * 116 + 54) * rect.width / 360,
      clientY: rect.top + (238 + Math.floor(index / 3) * 96 + 44) * rect.height / 620, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', event));
    canvas.dispatchEvent(new PointerEvent('pointerdown', event));
    return index;
  }, { question, wrong });
  await idle();
  return { question, index };
}
async function setGrade1() {
  if (!(await profile()).grades.includes(1)) await click('input[name="grade"][value="1"]');
}
async function course(index = 0) {
  await click('#btn-open-courses');
  await click(`#courses-list article:nth-child(${index + 1}) button`);
  await click('#courses-list button:nth-of-type(1)');
  await click('#courses-list button:nth-of-type(2)');
  for (let n = 0; n < 3; n++) { await answer(); await click('#btn-practice-next'); }
}
const initial = await profile();
await setGrade1();
await shot('home-390');
await course();
const learned = await profile();
assert.equal(learned.courses.numbers.rewarded, true);
assert.equal(learned.coins, initial.coins + (initial.courses.numbers?.rewarded ? 0 : 10));
await shot('course-complete-390');
await click('#screen-courses [data-home]');
await course();
assert.equal((await profile()).coins, learned.coins);
await click('#screen-courses [data-home]');
await click('#btn-open-shop');
await shot('shop-390');
// 两张复活卡由课程所得金币购买。
await page.click('#shop-list article:nth-child(3) button');
await click('#confirm-dialog button[value="yes"]');
assert.equal((await profile()).cards.revive, initial.cards.revive + 1);
await click('#screen-shop [data-home]');
await click('#btn-to-availability');
await click('#btn-start');
await answer(true);
await shot('revive-390');
await click('#btn-revive');
assert.equal((await profile()).challenge.state.revivals, 1);
await click('#btn-ready');
await answer(true);
assert.equal((await profile()).challenge.state.totalWrongCount, 2);
await shot('buy-revive-390');
await click('#btn-revive');
await click('#btn-hint');
assert.equal((await profile()).challenge.state.hintUsed, true);
await shot('hint-ready-390');
await click('#btn-ready');
await answer();
await page.waitForFunction(() => document.querySelector('#game-mode').textContent.includes('已复活 2') && !document.querySelector('#btn-ready').hidden);
await click('#btn-ready');
await answer(true);
await page.waitForSelector('#screen-result', { state: 'visible' });
const failed = await profile();
assert.equal(failed.challenge, null);
assert.equal(failed.records.at(-1).passed, false);
assert.equal(failed.records.at(-1).revivals, 2);
await shot('failure-390');
await click('#btn-return');
await click('#btn-open-review');
await click('#review-list article:first-child button:last-child');
await answer();
const reviewed = await profile();
assert.equal(reviewed.coins, failed.coins + 2);
await click('#btn-mastered');
assert.equal(Object.values((await profile()).mistakes).filter(m => m.mastered).length, 1);
await shot('review-390');
await click('#screen-review [data-home]');
await click('#btn-to-availability'); await click('#btn-start');
const steps = [];
for (let i = 0; i < 10; i++) {
  steps.push(await answer());
  await page.waitForFunction(() => !document.querySelector('#screen-result').hidden || document.querySelector('#board-canvas').getAttribute('aria-label').includes('按行排列：') && !document.querySelector('#screen-game').hidden && !document.body.hasAttribute('aria-busy') && document.querySelector('#countdown').textContent.startsWith('剩余'));
  if (i < 9) await page.waitForFunction(async i => {
    const r = indexedDB.open('pixel-academy'); const db = await new Promise(resolve => r.onsuccess = () => resolve(r.result));
    const p = await new Promise(resolve => { const q = db.transaction('profiles').objectStore('profiles').get('local'); q.onsuccess = () => resolve(q.result); }); db.close();
    return p.challenge?.state.questionIndex === i + 1 && p.challenge.state.phase === 'asking';
  }, i);
}
await page.waitForSelector('#screen-result', { state: 'visible' });
const passed = await profile(); assert.equal(passed.records.at(-1).score, 100); assert.equal(passed.records.at(-1).coins, 30);
await shot('result-390');
await page.reload(); await page.waitForSelector('#screen-select', { state: 'visible' });
assert.equal((await profile()).coins, passed.coins);
assert.equal((await profile()).settledRounds.length, passed.settledRounds.length);
await writeFile(`${output}/browser-result.json`, JSON.stringify({ version, initialCoins: initial.coins,
  courseCoins: learned.coins, failed: failed.records.at(-1), reviewCoins: reviewed.coins, passed: passed.records.at(-1), steps,
  errors: await page.evaluate(() => window.__errors ?? []) }, null, 2));
console.log({ version, failed: failed.records.at(-1), passed: passed.records.at(-1), coins: passed.coins });
console.log(await page.snapshot());
