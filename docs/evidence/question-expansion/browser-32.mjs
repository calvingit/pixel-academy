const task=await taskSpace(8),page=task.page('p1');
const fs=await import('node:fs/promises');const out='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/question-expansion';
const assert=(v,m)=>{if(!v)throw new Error(m);};
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const read=()=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{resolve(q.result);db.close();};};}));
const idle=()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
const click=async selector=>{await page.evaluate(s=>document.querySelector(s).click(),selector);await idle();};
const arithmetic=t=>t.kind==='number'?t.value:t.kind==='binary'?t.operator==='+'?t.left+t.right:t.operator==='-'?t.left-t.right:t.left*t.right:t.steps.reduce((n,s)=>n+(s.operator==='+'?s.operand:-s.operand),t.start);
const relation=(a,op,b)=>op==='>'?a>b:op==='<'?a<b:a===b;
const isMulti=t=>['filter','range','digit','equivalent'].includes(t.question.kind);
const ids=t=>{const q=t.question;
  if(q.kind==='range')return t.options.filter(o=>o.value>q.lower&&o.value<q.upper).map(o=>o.id);
  if(q.kind==='digit')return t.options.filter(o=>Math.floor(o.value/(q.place==='ones'?1:10))%10===q.digit).map(o=>o.id);
  if(q.kind==='equivalent')return t.options.filter(o=>arithmetic(o.value)===q.target).map(o=>o.id);
  if(q.kind==='groups')return t.options.filter(o=>o.value.kind==='binary'&&o.value.operator==='*'&&o.value.left===q.each&&o.value.right===q.groups).map(o=>o.id);
  const value=q.kind==='extreme'?(q.direction==='max'?Math.max:Math.min)(...t.options.map(o=>o.value))
    :q.kind==='neighbor'?q.value+(q.direction==='before'?-1:1):q.kind==='sequence'?q.start+q.index*q.step
    :q.kind==='composition'?q.total-q.part:q.kind==='story'?q.start+(q.operator==='+'?q.change:-q.change)
    :q.kind==='expression-symbol'?arithmetic(q.left)>arithmetic(q.right)?'>':arithmetic(q.left)<arithmetic(q.right)?'<':'='
    :q.kind==='symbol'?q.left>q.right?'>':q.left<q.right?'<':'=':q.kind==='truth'?relation(arithmetic(q.left),q.relation,arithmetic(q.right)):q.total-q.addend;
  return t.options.filter(o=>q.kind==='filter'?relation(o.value,q.relation,q.target):o.value===value).map(o=>o.id);
};

await click('#btn-return');
await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
await page.waitForFunction(async()=> (await import('/dist/game/number-puzzle/generation.js')).GENERATION_VERSION==='generated-v4',undefined,{timeout:20000});
const results=[];
async function play(grades,label){
  for(const grade of[1,2,3,4,5,6]){const checked=await page.evaluate(g=>document.querySelector(`input[name=grade][value="${g}"]`).checked,grade);if(checked!==grades.includes(grade))await click(`input[name=grade][value="${grade}"]`);}
  await click('#btn-to-availability');await click('#btn-start');const before=await read();const tasks=[];
  for(let i=0;i<10;i++){
    let c=(await read()).challenge;assert(c.state.questionIndex===i,'question index');
    if(c.paused){await click('#btn-pause');c=(await read()).challenge;}
    const t=c.state.questions[i].task;tasks.push(t);
    if(t.kind==='choice'){
      const correct=ids(t);for(const id of correct){await click(`#choice-options button[data-option-id=${JSON.stringify(id)}]`);if(!isMulti(t))break;}
      if(isMulti(t))await click('#btn-choice-submit');
    }else{
      const index=c.state.board.indexOf(arithmetic(t));
      const point=await page.evaluate(async index=>{const{boardLayout}=await import('/dist/game/number-puzzle/render.js');const wrap=document.querySelector('#board-wrap'),canvas=document.querySelector('#board-canvas'),l=boardLayout(wrap.clientWidth-16,wrap.clientHeight-16),r=canvas.getBoundingClientRect();return{x:r.x+(l.boardX+index%l.columns*(l.tileW+8)+l.tileW/2)*r.width/l.width,y:r.y+(l.boardY+Math.floor(index/l.columns)*(l.tileH+8)+l.tileH/2)*r.height/l.height};},index);
      await page.mouse.click(point.x,point.y);await idle();
    }
    await page.waitForFunction(async i=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{const c=q.result.challenge;resolve(!c||c.state.questionIndex===i+1&&c.state.phase==='asking');db.close();};};}),i,{timeout:6000});
  }
  await page.waitForFunction(()=>document.body.dataset.screen==='result');const after=await read(),record=after.records.at(-1);
  assert(record.score===100&&record.firstTryCount===10&&record.totalWrongCount===0&&record.totalTimeoutCount===0&&record.coins===30,'complete clean round');
  assert(after.coins===before.coins+30&&after.records.length===before.records.length+1,'single reward and record');
  await page.screenshot({path:`${out}/final-result-${label}.png`});
  results.push({label,grades,record,coinsBefore:before.coins,coinsAfter:after.coins,tasks});
  await click('#btn-return');
}
for(const [grades,label]of [[[1],'grade1'],[[2],'grade2'],[[1,2],'mixed']])await play(grades,label);
await page.cdp('Network.enable');await page.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
try{await page.reload();await page.waitForFunction(()=>!document.body.inert&&document.body.dataset.screen==='select');await play([1,2],'offline');}
finally{await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
const runtime=await page.evaluate(async()=>({ua:navigator.userAgent,generation:(await import('/dist/game/number-puzzle/generation.js')).GENERATION_VERSION,choices:(await import('/dist/game/number-puzzle/choice-generation.js')).CHOICE_VERSION,offline:document.querySelector('#offline-notice').textContent}));
await fs.writeFile(`${out}/final-round-results.json`,JSON.stringify({runtime,results},null,2));
console.log({runtime,rounds:results.map(r=>({label:r.label,score:r.record.score,reward:r.record.coins,coins:r.coinsAfter}))});console.log(await page.snapshot());
