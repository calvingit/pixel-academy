// 单屏适配复验：独立 4194 源站，TaskSpace 7；仅产生实际游玩档案，不注入金币。
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const output='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/ui-redesign/single-screen';
const task=await taskSpace(7),page=task.page('p1');
await page.goto('http://127.0.0.1:4194/');
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.waitForFunction(()=>document.body.dataset.screen==='select');
const idle=()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
const click=async selector=>{await page.evaluate(s=>document.querySelector(s).click(),selector);await idle()};
const shot=name=>page.screenshot({path:`${output}/${name}.png`});
const resize=async(width,height)=>{
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});
  await page.waitForFunction(async()=>{
    if(document.querySelector('#screen-game').hidden)return true;
    const{boardLayout}=await import('/dist/game/number-puzzle/render.js');const wrap=document.querySelector('#board-wrap'),l=boardLayout(wrap.clientWidth-16,wrap.clientHeight-16),rect=document.querySelector('#board-canvas').getBoundingClientRect();
    return Math.abs(rect.width-Math.round(l.width*l.scale))<1&&Math.abs(rect.height-Math.round(l.height*l.scale))<1;
  });
};
const sizes=[[320,568],[375,667],[390,844],[412,915],[568,320],[844,390],[1280,800]];
const results=[];
async function check(stage,selectors){
  const layout=await page.evaluate(selectors=>{
    const controls=selectors.flatMap(selector=>[...document.querySelectorAll(selector)]).filter(e=>e.getClientRects().length&&!e.disabled).map(e=>{
      const r=e.getBoundingClientRect();return{id:e.id||e.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
    });
    return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,controls};
  },selectors);
  assert.ok(layout.scrollWidth<=layout.width,`${stage}: 横向溢出`);
  assert.ok(layout.scrollHeight<=layout.height,`${stage}: 页面需要滚动`);
  for(const c of layout.controls){assert.ok(c.x>=0&&c.y>=0&&c.right<=layout.width+1&&c.bottom<=layout.height+1,`${stage}: ${c.id} 出屏`);assert.ok(c.height>=44,`${stage}: ${c.id} 高度不足44`)}
  results.push({stage,...layout});
}
for(const grade of [1,2])if(!await page.evaluate(g=>document.querySelector(`input[value="${g}"]`).checked,grade))await click(`input[value="${grade}"]`);
for(const [w,h]of sizes){await resize(w,h);await check('home',['#btn-menu','.grades label','#btn-to-availability']);await shot(`home-${w}`)}
await resize(320,568);await click('#btn-to-availability');await check('availability',['#btn-start','#btn-back-select']);await click('#btn-start');
await click('#btn-pause');await page.waitForFunction(()=>!document.querySelector('#pause-overlay').hidden);
for(const[w,h]of sizes){
  await resize(w,h);await check('game-paused',['#btn-sound','#btn-resume','#btn-pause','#btn-restart','#btn-game-return']);
  const board=await page.evaluate(async()=>{const{boardLayout}=await import('/dist/game/number-puzzle/render.js');const wrap=document.querySelector('#board-wrap'),l=boardLayout(wrap.clientWidth-16,wrap.clientHeight-16);return{columns:l.columns,tileWidth:l.tileW*l.scale,tileHeight:l.tileH*l.scale}});
  assert.ok(board.tileWidth>=44&&board.tileHeight>=44);results.at(-1).board=board;
  if(w===320||w===568)await shot(`paused-${w}`);
}
await resize(320,568);await page.reload();await page.waitForFunction(()=>document.body.dataset.screen==='select');
await check('restore',['#btn-restore','#btn-discard-round','#btn-to-availability','#btn-menu']);await shot('restore-320');await click('#btn-restore');
await click('#btn-resume');
async function answer(index){
  await page.evaluate(async()=>{
    const request=indexedDB.open('pixel-academy');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));
    const p=await new Promise(resolve=>{const r=db.transaction('profiles').objectStore('profiles').get('local');r.onsuccess=()=>resolve(r.result)});db.close();
    const{answerFor}=await import('/dist/learning/evaluation.js');const{boardLayout}=await import('/dist/game/number-puzzle/render.js');
    const task=p.challenge.state.questions[p.challenge.state.questionIndex].task;
    const canvas=document.querySelector('#board-canvas'),wrap=document.querySelector('#board-wrap'),rect=canvas.getBoundingClientRect(),l=boardLayout(wrap.clientWidth-16,wrap.clientHeight-16);
    const board=canvas.getAttribute('aria-label').split('按行排列：')[1].split('。')[0].split('、').map(Number),i=board.indexOf(answerFor(task));if(i<0)throw Error('答案不在棋盘');
    canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:rect.x+(l.boardX+i%l.columns*(l.tileW+8)+l.tileW/2)*rect.width/l.width,clientY:rect.y+(l.boardY+Math.floor(i/l.columns)*(l.tileH+8)+l.tileH/2)*rect.height/l.height,bubbles:true}));
  });await idle();
  await page.waitForFunction(async index=>{
    const r=indexedDB.open('pixel-academy');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));
    const p=await new Promise(resolve=>{const q=db.transaction('profiles').objectStore('profiles').get('local');q.onsuccess=()=>resolve(q.result)});db.close();
    return !p.challenge||p.challenge.state.questionIndex===index+1&&p.challenge.state.phase==='asking';
  },index);
}
for(let n=0;n<10;n++){
  await resize(...(n%2?[568,320]:[320,568]));
  if(n<2)await shot(`game-${n%2?568:320}`);
  await answer(n);
}
await page.waitForFunction(()=>document.body.dataset.screen==='result');await resize(320,568);
await check('result',['#btn-again','#btn-return']);await shot('result-320');
const score=await page.evaluate(()=>document.querySelector('#result-score').textContent);assert.ok(score.includes('100'));
await click('#btn-return');await click('#btn-menu');await click('#btn-open-courses');
await check('courses',['#screen-courses [data-home]']);
await click('#courses-list article:first-child button');await click('#courses-list button:first-of-type');await click('#courses-list button:nth-of-type(2)');
await check('practice',['#btn-practice-explain','#btn-game-return']);await shot('practice-320');
await click('#btn-practice-explain');assert.equal(await page.evaluate(()=>document.querySelector('#explanation-dialog').open),true);await shot('explanation-320');await click('#btn-explanation-close');
await page.evaluate(()=>document.querySelector('#btn-game-return').click());await page.evaluate(()=>document.querySelector('#confirm-dialog button[value="yes"]').click());await idle();
await click('#btn-menu');await click('#btn-open-shop');await check('shop',['#screen-shop [data-home]']);await shot('shop-320');await click('#screen-shop [data-home]');
await page.cdp('Network.enable');await page.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
await page.reload();await page.waitForFunction(()=>document.body.dataset.screen==='select');await check('offline-home',['#btn-menu','#btn-to-availability']);
await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
await writeFile(`${output}/result.json`,JSON.stringify({ua:await page.evaluate(()=>navigator.userAgent),score,results},null,2));
console.log({checks:results.length,score});
