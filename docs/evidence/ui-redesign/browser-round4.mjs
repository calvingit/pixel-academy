// 最终 CSS 微调后复验；与第三轮同一源站、同一档案，不注入金币或修改题目。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const output='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/ui-redesign';
const task=await taskSpace(6),page=task.page('p1');
const version=(await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js','utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await page.goto('http://127.0.0.1:4192/');await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.evaluate(async()=>(await navigator.serviceWorker.ready).update());
await page.waitForFunction(v=>document.querySelector('#offline-notice').textContent.includes(v),version);
const idle=()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
const click=async selector=>{await page.evaluate(s=>document.querySelector(s).click(),selector);await idle()};
const shot=name=>page.screenshot({path:`${output}/${name}.png`,fullPage:true});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});
await shot('home-final-320');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await click('#btn-to-availability');await click('#btn-start');
await page.waitForFunction(()=>document.querySelector('#countdown').dataset.urgent==='true');
await shot('urgent-390');
await page.waitForFunction(()=>document.querySelector('#revive-dialog').open);
await shot('timeout-dialog-390');await click('#btn-end');await click('#btn-return');
await page.cdp('Network.enable');await page.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
await page.reload();await page.waitForFunction(()=>document.body.dataset.screen==='select');
await click('#btn-to-availability');await click('#btn-start');
for(let n=0;n<10;n++){
  await page.evaluate(async()=>{
    const r=indexedDB.open('pixel-academy');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));
    const p=await new Promise(resolve=>{const q=db.transaction('profiles').objectStore('profiles').get('local');q.onsuccess=()=>resolve(q.result)});db.close();
    const {answerFor}=await import('/dist/learning/evaluation.js');const question=p.challenge.state.questions[p.challenge.state.questionIndex].task;
    const canvas=document.querySelector('#board-canvas'),rect=canvas.getBoundingClientRect();
    const board=canvas.getAttribute('aria-label').split('按行排列：')[1].split('。')[0].split('、').map(Number),i=board.indexOf(answerFor(question));
    assertIndex(i);
    function assertIndex(i){if(i<0)throw Error('无正确答案块')}
    canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:rect.left+(10+i%3*116+54)*rect.width/360,clientY:rect.top+(238+Math.floor(i/3)*96+44)*rect.height/620,bubbles:true}));
  });await idle();
  await page.waitForFunction(async index=>{
    const r=indexedDB.open('pixel-academy');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));
    const p=await new Promise(resolve=>{const q=db.transaction('profiles').objectStore('profiles').get('local');q.onsuccess=()=>resolve(q.result)});db.close();
    return !p.challenge||p.challenge.state.questionIndex===index+1&&p.challenge.state.phase==='asking';
  },n);
}
await page.waitForFunction(()=>document.body.dataset.screen==='result');
const result=await page.evaluate(()=>document.querySelector('#screen-result').innerText);assert.ok(result.includes('100'));
await shot('offline-final-result-390');
await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
await click('#btn-return');await shot('home-final-390');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await shot('home-final-desktop');
await writeFile(`${output}/final-result.json`,JSON.stringify({version,urgent:true,timeoutDialog:true,offline:result},null,2));
console.log({version,urgent:true,timeoutDialog:true,offlineScore:100});
