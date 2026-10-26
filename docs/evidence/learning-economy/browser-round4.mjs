// 第四轮：真实 IndexedDB 事务中止、多页面冲突、存储拒绝和练习中的更新延后。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const output = '/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/learning-economy';
const task = await taskSpace(5), page = task.page('p2');
const version = (await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js','utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
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

await click('#btn-return');
await click('#btn-open-courses'); await click('#courses-list article:first-child button');
await click('#courses-list button:nth-of-type(1)'); await click('#courses-list button:nth-of-type(2)');
const beforeUpdate = await profile();
await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
await page.waitForFunction(() => /新版本已下载/.test(document.querySelector('#offline-notice').textContent));
assert.ok((await profile()).practice);
await shot('update-deferred-practice');
for(let i=0;i<3;i++){ await answer(); await click('#btn-practice-next'); }
await home('courses');
await page.waitForFunction(v => document.querySelector('#offline-notice').textContent.includes(v), version);
assert.equal((await profile()).coins, beforeUpdate.coins);
const other = await task.newPage();
await other.goto('http://127.0.0.1:4181/'); await other.waitForSelector('#screen-select',{state:'visible'});
await other.click('#btn-open-shop');
await click('#btn-open-shop');
const beforeConflict=await profile(); await buy(1); const afterFirst=await profile();
assert.equal(afterFirst.coins,beforeConflict.coins-3);
await other.click('#shop-list article:first-child button');
await other.click('#confirm-dialog button[value="yes"]');
await other.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
assert.match(await other.evaluate(()=>document.querySelector('#app-notice').textContent),/另一页面更新/);
assert.equal((await profile()).coins,afterFirst.coins);
await shot('shop-after-conflict');
await page.evaluate(()=>{
  const original=IDBObjectStore.prototype.put;
  window.__originalPut=original;
  IDBObjectStore.prototype.put=function(...args){ const request=original.apply(this,args); if(this.name==='profiles')this.transaction.abort(); return request; };
});
await page.click('#shop-list article:first-child button'); await click('#confirm-dialog button[value="yes"]');
assert.equal((await profile()).coins,afterFirst.coins);
assert.match(await page.evaluate(()=>document.querySelector('#app-notice').textContent),/保存失败/);
assert.equal(await page.evaluate(()=>document.querySelector('#storage-notice').hidden),false);
await shot('transaction-abort');
await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__originalPut;});
await page.reload(); await page.waitForSelector('#screen-select',{state:'visible'});
assert.equal((await profile()).coins,afterFirst.coins);
const blocked=await other.cdp('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'indexedDB',{get(){throw new Error('test: storage denied')}})"});
await other.reload(); await other.waitForSelector('#screen-select',{state:'visible'});
assert.equal(await other.evaluate(()=>document.querySelector('#storage-notice').hidden),false);
await other.click('#btn-open-shop');
assert.equal(await other.evaluate(()=>[...document.querySelectorAll('#shop-list article button')].filter(b=>b.textContent.startsWith('购买')).every(b=>b.disabled)),true);
await other.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:blocked.identifier});
await other.reload(); await other.waitForSelector('#screen-select',{state:'visible'});
await writeFile(`${output}/fault-result.json`,JSON.stringify({version,otherPage:other.label,coinsBefore:beforeConflict.coins,
  coinsAfterSinglePurchase:afterFirst.coins,coinsAfterConflictAndAbort:(await profile()).coins,
  updateDeferred:true,abortRolledBack:true,deniedStorage:true},null,2));
console.log({version,otherPage:other.label,coins:(await profile()).coins,conflict:true,abortRolledBack:true,deniedStorage:true});
console.log(await page.snapshot());
