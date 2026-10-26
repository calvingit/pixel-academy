// 第三轮：续接补充验收；第二轮的视口断言早于 resize 布局完成，增加两帧稳定等待后复验。
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const output = '/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/learning-economy';
const task = await taskSpace(5), page = task.page('p2');
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
const purchased = await profile();
const sizes = [];
for (const [width, height] of [[320, 568], [390, 844], [412, 915], [568, 320], [1280, 900]]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
await writeFile(`${output}/extended-result.json`, JSON.stringify({ fixtureCoins: 1000, courseBalances: [1010,1020,1030,1040,1050], purchased,
  sizes, timedOut: timedOut.records.at(-1), offline: offline.records.at(-1), errors: await page.evaluate(() => window.__errors ?? []) }, null, 2));
console.log({ sizes, timeout: timedOut.records.at(-1), offline: offline.records.at(-1) });
console.log(await page.snapshot());
