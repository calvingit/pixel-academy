// 补充验收在独立 4181 源站；显式注入 1000 金币测试夹具，仅验证商品交易，不作为学习奖励证据。
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const output = '/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/learning-economy';
const task = await taskSpace(5), page = task.page('p2');
await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await page.evaluate(async () => {
  const { openProfileStore, createProfile } = await import('/dist/game/number-puzzle/profile.js');
  const store = await openProfileStore(), p = await store.load(createProfile);
  await store.commit(p, d => { d.coins = 1000; });
});
await page.reload();
const idle = () => page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
const click = async selector => { await page.click(selector); await idle(); };
const profile = () => page.evaluate(async () => {
  const r = indexedDB.open('pixel-academy'); const db = await new Promise(resolve => r.onsuccess = () => resolve(r.result));
  return new Promise(resolve => { const q = db.transaction('profiles').objectStore('profiles').get('local'); q.onsuccess = () => { db.close(); resolve(q.result); }; });
});
const shot = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
async function answer(wrong = false) {
  await page.evaluate(async wrong => {
    const r = indexedDB.open('pixel-academy'); const db = await new Promise(resolve => r.onsuccess = () => resolve(r.result));
    const p = await new Promise(resolve => { const q = db.transaction('profiles').objectStore('profiles').get('local'); q.onsuccess = () => resolve(q.result); }); db.close();
    const { answerFor } = await import('/dist/learning/evaluation.js');
    const question = p.practice ? p.practice.exercises[p.practice.index].task : p.challenge.state.questions[p.challenge.state.questionIndex].task;
    const canvas = document.querySelector('#board-canvas');
    const values = canvas.getAttribute('aria-label').split('按行排列：')[1].split('。')[0].split('、').map(Number);
    const index = values.findIndex(v => wrong ? v !== answerFor(question) : v === answerFor(question));
    if (index < 0) throw new Error('无可用数字块');
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + (10 + index % 3 * 116 + 54) * box.width / 360,
      clientY: box.top + (238 + Math.floor(index / 3) * 96 + 44) * box.height / 620, bubbles: true }));
  }, wrong);
  await idle();
}
async function buy(index) { await page.click(`#shop-list article:nth-child(${index}) button:last-child`); await click('#confirm-dialog button[value="yes"]'); }
async function home(screen) { await click(`#screen-${screen} [data-home]`); }
await click('input[name="grade"][value="1"]'); await click('input[name="grade"][value="2"]');
const courses = [];
for (let i = 0; i < 5; i++) {
  await click('#btn-open-courses'); await click(`#courses-list article:nth-child(${i + 1}) button`);
  await click('#courses-list button:nth-of-type(1)'); await click('#courses-list button:nth-of-type(2)');
  for (let n = 0; n < 3; n++) { await answer(); await click('#btn-practice-next'); }
  courses.push((await profile()).coins);
  await home('courses');
}
assert.deepEqual(courses, [1010, 1020, 1030, 1040, 1050]);
await click('#btn-open-profile'); await page.fill('#nickname', '小小园丁'); await click('#nickname-form button');
assert.equal((await profile()).nickname, '小小园丁');
await home('profile'); await click('#btn-open-shop');
for (const i of [1, 1, 3, 3, 4, 5, 6, 7, 8, 9]) await buy(i);
const purchased = await profile();
assert.deepEqual(purchased.avatars, ['lanlan', 'cat', 'rabbit', 'owl']);
assert.deepEqual(purchased.skins, ['garden', 'autumn', 'snow']);
await click('#shop-list article:nth-child(9) button:nth-of-type(1)'); await shot('skin-preview-390'); await click('#preview-close');
await click('#shop-list article:nth-child(9) button:last-child');
await home('shop'); await click('#btn-open-profile'); await page.fill('#nickname', '雪地园丁'); await click('#nickname-form button');
assert.equal((await profile()).cards.rename, 0);
await home('profile'); await click('#btn-to-availability'); await click('#btn-start');
const beforeTime = await profile(); await click('#btn-time');
const afterTime = await profile(); assert.equal(afterTime.challenge.state.timeUsed, true);
assert.equal(afterTime.cards.time, beforeTime.cards.time - 1);
assert.ok(afterTime.challenge.deadline - beforeTime.challenge.deadline >= 4900);
await click('#btn-pause'); const paused = await profile(); await page.reload();
await page.waitForSelector('#btn-restore', { state: 'visible' }); await click('#btn-restore');
const restored = await profile(); assert.equal(restored.challenge.paused, true);
assert.equal(restored.challenge.remainingMs, paused.challenge.remainingMs);
await click('#btn-resume'); await answer(true); await click('#btn-revive'); await click('#btn-ready');
assert.equal(await page.evaluate(() => document.querySelector('#btn-time').disabled), true);
await answer(true); await click('#btn-revive'); await click('#btn-hint');
const sizes = [];
for (const [width, height] of [[320, 568], [390, 844], [412, 915], [568, 320], [1280, 900]]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    readyOutsideBoard: document.querySelector('#btn-ready').getBoundingClientRect().bottom <= document.querySelector('#board-wrap').getBoundingClientRect().top,
    canvasVisible: getComputedStyle(document.querySelector('#board-canvas')).visibility === 'visible' }));
  assert.ok(layout.scrollWidth <= width); assert.equal(layout.readyOutsideBoard, true); assert.equal(layout.canvasVisible, true);
  sizes.push(layout); await shot(`hint-final-${width}`);
}
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await click('#btn-ready');
await page.waitForSelector('#screen-result', { state: 'visible', timeout: 15000 });
const timedOut = await profile(); assert.equal(timedOut.records.at(-1).totalTimeoutCount, 1); assert.equal(timedOut.records.at(-1).totalWrongCount, 2);
await shot('timeout-failure-390');
await click('#btn-return');
await page.cdp('Network.enable'); await page.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await page.reload(); await page.waitForSelector('#screen-select', { state: 'visible' });
await click('#btn-open-shop'); const beforeOfflineBuy = await profile(); await buy(1);
assert.equal((await profile()).coins, beforeOfflineBuy.coins - 3);
await home('shop'); await click('#btn-open-courses'); await click('#courses-list article:first-child button');
await click('#courses-list button:nth-of-type(1)'); await click('#courses-list button:nth-of-type(2)');
for (let n = 0; n < 3; n++) { await answer(); await click('#btn-practice-next'); }
assert.equal((await profile()).coins, beforeOfflineBuy.coins - 3);
await home('courses'); await click('#btn-to-availability'); await click('#btn-start');
for (let i = 0; i < 10; i++) {
  await answer();
  await page.waitForFunction(async i => {
    const r = indexedDB.open('pixel-academy'); const db = await new Promise(resolve => r.onsuccess = () => resolve(r.result));
    const p = await new Promise(resolve => { const q = db.transaction('profiles').objectStore('profiles').get('local'); q.onsuccess = () => resolve(q.result); }); db.close();
    return i === 9 ? !p.challenge : p.challenge?.state.phase === 'asking' && p.challenge.state.questionIndex === i + 1;
  }, i);
}
const offline = await profile(); assert.equal(offline.records.at(-1).coins, 30); assert.equal(await page.evaluate(() => navigator.onLine), false);
await shot('offline-result-final-390');
await page.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await writeFile(`${output}/extended-result.json`, JSON.stringify({ fixtureCoins: 1000, courseBalances: courses, purchased,
  sizes, timedOut: timedOut.records.at(-1), offline: offline.records.at(-1), errors: await page.evaluate(() => window.__errors ?? []) }, null, 2));
console.log({ courseBalances: courses, sizes, timeout: timedOut.records.at(-1), offline: offline.records.at(-1) });
console.log(await page.snapshot());
