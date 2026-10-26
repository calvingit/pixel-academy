// 第六轮：移除过时渲染分支后的最终构建通关、动画暂停和装扮装备验证。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const output='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/learning-economy';
const task=await taskSpace(5),page=task.page('p2');
const version=(await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js','utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await page.evaluate(async()=>{await(await navigator.serviceWorker.ready).update()});
await page.waitForFunction(v=>document.querySelector('#offline-notice').textContent.includes(v),version);
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

const initial=await profile();
await click('#btn-open-shop'); await click('#shop-list article:nth-child(7) button:last-child');
assert.equal((await profile()).avatar,'owl');
await click('#shop-list article:nth-child(8) button:last-child'); assert.equal((await profile()).skin,'autumn');
await click('#default-equipment button:last-child'); assert.equal((await profile()).skin,'garden');
await click('#shop-list article:nth-child(9) button:last-child'); assert.equal((await profile()).skin,'snow');
assert.equal((await profile()).coins,initial.coins);
await home('shop');await click('#btn-to-availability');await click('#btn-start');
assert.match((await profile()).challenge.contentVersion,/:challenge-v1$/);
await answer();
await page.evaluate(()=>document.querySelector('#btn-pause').click());await idle();
const paused=await profile();assert.equal(paused.challenge.paused,true);
const pausedPhase=paused.challenge.state.phase;
await click('#btn-resume');
await page.waitForFunction(()=>document.querySelector('#countdown').textContent.startsWith('剩余'));
for(let i=1;i<10;i++){
  await answer();
  await page.waitForFunction(async i=>{
    const r=indexedDB.open('pixel-academy');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));
    const p=await new Promise(resolve=>{const q=db.transaction('profiles').objectStore('profiles').get('local');q.onsuccess=()=>resolve(q.result)});db.close();
    return i===9?!p.challenge:p.challenge?.state.phase==='asking'&&p.challenge.state.questionIndex===i+1;
  },i);
}
const settled=await profile();assert.equal(settled.records.at(-1).score,100);assert.equal(settled.coins,initial.coins+30);
await shot('cleanup-result-390');await page.reload();await page.waitForSelector('#screen-select',{state:'visible'});
assert.equal((await profile()).coins,settled.coins);
await writeFile(`${output}/cleanup-result.json`,JSON.stringify({version,pausedPhase,score:settled.records.at(-1).score,
  coinsBefore:initial.coins,coinsAfter:settled.coins,avatar:(await profile()).avatar,skin:(await profile()).skin,
  errors:await page.evaluate(()=>window.__errors??[])},null,2));
console.log({version,pausedPhase,score:100,coins:settled.coins});console.log(await page.snapshot());
