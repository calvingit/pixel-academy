// 第五轮：最终构建的键盘作答、退出取消冻结、皮肤／头像和旧中断隔离检查。
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
const output='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/learning-economy';
const task=await taskSpace(5),page=task.page('p2');
const version=(await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js','utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await page.evaluate(async()=>{await(await navigator.serviceWorker.ready).update()});
await page.waitForFunction(v=>document.querySelector('#offline-notice').textContent.includes(v),version);
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
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

await click('#btn-to-availability');await click('#btn-start');
const initial=await profile();
const target=await page.evaluate(async()=>{
  const c=document.querySelector('canvas'),values=c.getAttribute('aria-label').split('按行排列：')[1].split('。')[0].split('、').map(Number);
  const r=indexedDB.open('pixel-academy');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));
  const p=await new Promise(resolve=>{const q=db.transaction('profiles').objectStore('profiles').get('local');q.onsuccess=()=>resolve(q.result)});db.close();
  const {answerFor}=await import('/dist/learning/evaluation.js');return values.indexOf(answerFor(p.challenge.state.questions[0].task));
});
await page.focus('#board-canvas');
for(let i=0;i<target;i++)await page.press('#board-canvas','ArrowRight');
await page.press('#board-canvas','Enter');await idle();
assert.equal((await profile()).challenge.state.score,10);
await page.waitForFunction(()=>document.querySelector('#countdown').textContent.startsWith('剩余'));
await page.click('#btn-game-return');await page.waitForFunction(()=>document.querySelector('#confirm-dialog').open);
const frozen=await profile();assert.equal(frozen.challenge.paused,true);assert.equal(frozen.challenge.deadline,null);
await page.click('#confirm-dialog button[value="no"]');await idle();
assert.equal((await profile()).challenge.paused,false);
await page.screenshot({path:`${output}/game-final-390.png`,fullPage:true});
await page.click('#btn-game-return');await page.click('#confirm-dialog button[value="yes"]');await idle();
await click('#btn-open-shop');await click('#shop-list article:nth-child(7) button:first-of-type');
await page.screenshot({path:`${output}/owl-preview-final-390.png`});await click('#preview-close');
await click('#shop-list article:nth-child(9) button:first-of-type');
await page.screenshot({path:`${output}/snow-preview-final-390.png`});await click('#preview-close');
await home('shop');
const before=await profile();
await page.evaluate(()=>{localStorage.setItem('pixel-academy:number-puzzle:v1:interrupted','legacy-sentinel')});
await page.reload();await page.waitForSelector('#screen-select',{state:'visible'});
assert.equal(await page.evaluate(()=>localStorage.getItem('pixel-academy:number-puzzle:v1:interrupted')),'legacy-sentinel');
assert.equal((await profile()).challenge,null);assert.equal((await profile()).coins,before.coins);
await writeFile(`${output}/final-result.json`,JSON.stringify({version,keyboardScore:10,cancelFreezesTimer:true,
  legacyInterruptedIgnored:true,legacyKeyPreserved:true,coins:(await profile()).coins,
  browser:await page.evaluate(()=>navigator.userAgent),errors:await page.evaluate(()=>window.__errors??[])},null,2));
console.log({version,keyboardScore:10,cancelFreezesTimer:true,legacyKeyPreserved:true});console.log(await page.snapshot());
