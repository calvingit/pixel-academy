// 最终样式微调后检查菜单、练习操作及紧凑五行点阵；点阵仅为显式渲染样例。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const output='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/ui-redesign/single-screen';
const version=(await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js','utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
const task=await taskSpace(7),page=task.page('p1');
await page.goto('http://127.0.0.1:4194/');await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.evaluate(async()=>(await navigator.serviceWorker.ready).update());await page.waitForFunction(v=>document.querySelector('#offline-notice').textContent.includes(v),version);
await page.cdp('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});
await page.evaluate(()=>document.querySelector('#btn-menu').click());await page.screenshot({path:`output` .replace('output',`${output}/menu-320.png`)});
await page.evaluate(()=>document.querySelector('#btn-menu-close').click());
await page.evaluate(async()=>{
  const{loadGameContent}=await import('/dist/game/number-puzzle/content.js');const{createRound}=await import('/dist/game/number-puzzle/rules.js');const{createRuntimeRng}=await import('/dist/game/number-puzzle/random.js');const{NumberPuzzleRenderer}=await import('/dist/game/number-puzzle/render.js');
  const content=loadGameContent();const exercise=content.select([2]).find(e=>e.task.kind==='binary'&&e.task.operator==='*'&&e.task.left===5&&e.task.right===2);if(!exercise)throw Error('缺少已审核的五行点阵样例');
  document.querySelector('#preview-title').textContent='紧凑点阵布局 · 代理验证样例';const body=document.querySelector('#preview-body');body.replaceChildren();const canvas=document.createElement('canvas');body.append(canvas);
  const renderer=new NumberPuzzleRenderer(canvas,{onTileClick(){}});renderer.reset(createRound({exercises:[exercise],gradeOf:content.gradeOf,rng:createRuntimeRng()}));renderer.fitDisplay(240,300);renderer.start();
  const dialog=document.querySelector('#preview-dialog');dialog.addEventListener('close',()=>renderer.stop(),{once:true});dialog.showModal();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
});
await page.screenshot({path:`${output}/dots-320.png`});await page.evaluate(()=>document.querySelector('#preview-close').click());
const height=await page.evaluate(()=>document.documentElement.scrollHeight);assert.equal(height,568);
await writeFile(`${output}/final.json`,JSON.stringify({version,fiveRowDots:true,menu:true,pageHeight:height},null,2));console.log({version,fiveRowDots:true,menu:true});
