// 本轮会话证据：TaskSpace 6、独立 4190 源站；不清除或注入档案。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const output = '/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/ui-redesign';
const task = await taskSpace(6), page = task.page('p1');
const version = (await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js', 'utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await page.goto('http://127.0.0.1:4190/');
await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
await page.waitForFunction(v => document.querySelector('#offline-notice').textContent.includes(v), version);
await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await page.reload();
await page.waitForFunction(() => document.body.dataset.screen === 'select');
const idle = () => page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
const click = async selector => { await page.click(selector); await idle(); };
const shot = name => page.screenshot({path:`${output}/${name}.png`,fullPage:true});
const profile = () => page.evaluate(async () => {
  const r = indexedDB.open('pixel-academy');
  const db = await new Promise((resolve,reject) => {r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  return new Promise((resolve,reject) => {const q=db.transaction('profiles').objectStore('profiles').get('local');q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=()=>reject(q.error)});
});
const resize = async (width,height) => {
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});
  await page.waitForFunction(w => innerWidth===w, width);
};
const layouts=[];
for (const [width,height] of [[320,568],[390,844],[412,915],[568,320],[1280,900]]) {
  await resize(width,height);
  const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.equal(layout.width,layout.scrollWidth);layouts.push(layout);
  await shot(`home-${width}`);
}
await resize(390,844);
const initial=await profile();
for(const grade of initial.grades) await click(`input[value="${grade}"]`);
assert.equal(await page.evaluate(()=>document.querySelector('#btn-to-availability').disabled),true);
await click('input[value="3"]');await click('#btn-to-availability');
assert.equal(await page.evaluate(()=>document.querySelector('#btn-start').disabled),true);
await shot('empty-grade-390');await click('#btn-back-select');
await click('input[value="3"]');await click('input[value="1"]');await click('input[value="2"]');
await click('#btn-to-availability');await shot('ready-390');await click('#btn-start');
await click('#btn-pause');
await page.waitForFunction(()=>!document.querySelector('#pause-overlay').hidden);
const pausedRemaining=(await profile()).challenge.remainingMs;
for (const [width,height] of [[320,568],[390,844],[412,915],[568,320],[1280,900]]) {
  await resize(width,height);
  const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,boardWidth:document.querySelector('#board-canvas').getBoundingClientRect().width}));
  assert.equal(layout.width,layout.scrollWidth); assert.ok(layout.boardWidth>=252);layouts.push(layout);
  await shot(`paused-${width}`);
}
await resize(390,844);await page.reload();await page.waitForFunction(()=>document.body.dataset.screen==='select');
await click('#btn-restore');await page.waitForFunction(()=>!document.querySelector('#pause-overlay').hidden);
assert.equal((await profile()).challenge.remainingMs,pausedRemaining);
await click('#btn-resume');await page.waitForFunction(()=>document.querySelector('#pause-overlay').hidden);
await shot('game-390');
const steps=[];
async function answerRound() {
  for(let n=0;n<10;n++) {
    const p=await profile();const q=p.challenge.state.questions[p.challenge.state.questionIndex].task;
    await page.evaluate(async question=>{
      const {answerFor}=await import('/dist/learning/evaluation.js');
      const canvas=document.querySelector('#board-canvas');
      const board=canvas.getAttribute('aria-label').split('按行排列：')[1].split('。')[0].split('、').map(Number);
      const i=board.indexOf(answerFor(question));if(i<0)throw Error('答案不在棋盘');
      const rect=canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:rect.left+(10+i%3*116+54)*rect.width/360,clientY:rect.top+(238+Math.floor(i/3)*96+44)*rect.height/620,bubbles:true}));
    },q);await idle();
    await page.waitForFunction(async index=>{
      const r=indexedDB.open('pixel-academy');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));
      const p=await new Promise(resolve=>{const q=db.transaction('profiles').objectStore('profiles').get('local');q.onsuccess=()=>resolve(q.result)});db.close();
      return !p.challenge||p.challenge.state.questionIndex===index+1&&p.challenge.state.phase==='asking';
    },n);steps.push(q);
  }
  await page.waitForFunction(()=>document.body.dataset.screen==='result');
  const result=(await profile()).records.at(-1);assert.equal(result.score,100);assert.equal(result.firstTryCount,10);return result;
}
const online=await answerRound();await shot('result-390');await click('#btn-return');
await click('#records-section summary');await shot('records-390');
await click('#btn-open-courses');await shot('courses-390');await click('#screen-courses [data-home]');
await click('#btn-open-review');await shot('review-390');await click('#screen-review [data-home]');
await click('#btn-open-shop');await shot('shop-390');
await page.click('#shop-list article:last-child button:first-of-type');await shot('skin-preview-390');await click('#preview-close');
await click('#screen-shop [data-home]');
await click('#btn-open-profile');await shot('profile-390');await click('#screen-profile [data-home]');
await page.cdp('Network.enable');
await page.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
await page.reload();await page.waitForFunction(()=>document.body.dataset.screen==='select');
await click('#btn-to-availability');await click('#btn-start');const offline=await answerRound();await shot('offline-result-390');
await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
await click('#btn-return');await resize(1280,900);await shot('home-final-desktop');
const errors=await page.evaluate(()=>window.__errors);assert.deepEqual(errors,[]);
await writeFile(`${output}/result.json`,JSON.stringify({version,ua:await page.evaluate(()=>navigator.userAgent),layouts,online,offline,pausedRemaining,steps,errors},null,2));
console.log({version,online:online.score,offline:offline.score,layouts:layouts.length,errors});
