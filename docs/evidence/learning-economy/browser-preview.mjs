// 第七轮：正式档案与候选预览的实际浏览器隔离检查，不清空或修改正式档案。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const output='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/learning-economy';
const t=await taskSpace(5),p=t.page('p3');
const version=(await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js','utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await p.goto('http://127.0.0.1:4181/');
await p.evaluate(async()=>{await(await navigator.serviceWorker.ready).update()});
await p.waitForFunction(v=>document.querySelector('#offline-notice').textContent.includes(v),version);
const read=()=>p.evaluate(async()=>{const{openProfileStore,createProfile}=await import('/dist/game/number-puzzle/profile.js');return JSON.stringify(await(await openProfileStore()).load(createProfile));});
const before=await read();
await p.goto('http://127.0.0.1:4181/?preview=candidate');
await p.waitForSelector('#screen-select',{state:'visible'});
assert.equal(await p.evaluate(()=>document.querySelector('#main-nav').hidden),true);
assert.equal(await p.evaluate(()=>document.querySelector('#records-section').hidden),true);
await p.click('input[name="grade"][value="1"]');
await p.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
await p.click('#btn-to-availability');await p.click('#btn-start');
await p.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
assert.equal(await p.evaluate(()=>document.querySelector('#preview-banner').hidden),false);
await p.evaluate(async()=>{
  const {loadGameContent}=await import('/dist/game/number-puzzle/content.js');
  const{taskText}=await import('/dist/game/number-puzzle/learning.js');
  const{answerFor}=await import('/dist/learning/evaluation.js');
  const label=document.querySelector('#game-task').textContent;
  const row=loadGameContent().preview([1]).find(e=>label.startsWith(taskText(e.task)));
  if(!row)throw new Error('预览题面不匹配');
  const canvas=document.querySelector('canvas'),box=canvas.getBoundingClientRect();
  const values=canvas.getAttribute('aria-label').split('按行排列：')[1].split('。')[0].split('、').map(Number);
  const index=values.findIndex(v=>v!==answerFor(row.task));
  canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:box.left+(10+index%3*116+54)*box.width/360,
    clientY:box.top+(238+Math.floor(index/3)*96+44)*box.height/620,bubbles:true}));
});
await p.waitForSelector('#revive-dialog',{state:'visible'});
assert.equal(await p.evaluate(()=>document.querySelector('#btn-revive').disabled),true);
await p.click('#btn-end');await p.waitForSelector('#screen-result',{state:'visible'});
assert.equal(await p.evaluate(()=>document.querySelector('#result-preview-note').hidden),false);
assert.equal(await read(),before);
await p.screenshot({path:`${output}/candidate-preview-final.png`,fullPage:true});
await writeFile(`${output}/preview-result.json`,JSON.stringify({version,formalProfileUnchanged:true,
  resultBannerVisible:true,formalCardsUnavailable:true},null,2));
await p.goto('http://127.0.0.1:4181/');
console.log({version,formalProfileUnchanged:true,resultBannerVisible:true});console.log(await p.snapshot());
