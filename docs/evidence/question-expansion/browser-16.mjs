const task=await taskSpace(8),page=task.page('p1');
const fs=await import('node:fs/promises');
const out='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/question-expansion';
const assert=(v,m)=>{if(!v)throw new Error(m);};
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const read=()=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{resolve(q.result);db.close();};};}));
const idle=()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
const arithmetic=t=>t.kind==='number'?t.value:t.kind==='binary'?t.operator==='+'?t.left+t.right:t.operator==='-'?t.left-t.right:t.left*t.right:t.steps.reduce((n,s)=>n+(s.operator==='+'?s.operand:-s.operand),t.start);
const relation=(a,op,b)=>op==='>'?a>b:op==='<'?a<b:a===b;
const ids=t=>{const q=t.question;const value=q.kind==='extreme'?(q.direction==='max'?Math.max:Math.min)(...t.options.map(o=>o.value)):q.kind==='symbol'?q.left>q.right?'>':q.left<q.right?'<':'=':q.kind==='truth'?relation(arithmetic(q.left),q.relation,arithmetic(q.right)):q.total-q.addend;
return t.options.filter(o=>q.kind==='filter'?relation(o.value,q.relation,q.target):o.value===value).map(o=>o.id);};
await page.click('#btn-pause');await idle();
const before=await read();const seen=new Set();let restored=false;
for(let i=0;i<10;i++){
  let p=await read(),c=p.challenge;assert(c&&c.state.questionIndex===i,'question index');const t=c.state.questions[i].task;
  const key=t.kind==='choice'?t.question.kind:t.kind;
  if(t.kind==='choice'&&t.question.kind==='filter'&&!restored){
    await page.click(`#choice-options button[data-option-id=${JSON.stringify(ids(t)[0])}]`);await idle();
    await page.click('#btn-pause');await idle();const paused=await read();
    await page.reload();await page.waitForFunction(()=>!document.body.inert);await page.click('#btn-restore');
    const resumed=await read();assert(resumed.challenge.paused,'restores paused');assert(resumed.challenge.remainingMs===paused.challenge.remainingMs,'remaining time frozen');
    assert(JSON.stringify(resumed.challenge.state.selectedIds)===JSON.stringify(paused.challenge.state.selectedIds),'challenge half selection restored');
    await page.click('#btn-pause');await idle();restored=true;c=(await read()).challenge;
  }
  if(!seen.has(key)){await page.screenshot({path:`${out}/challenge-${key}-390.png`});seen.add(key);}
  if(t.kind==='choice'){
    const correct=ids(t);
    if(t.question.kind==='filter'){
      const selected=c.state.selectedIds??[];
      for(const id of correct.filter(id=>!selected.includes(id))){await page.click(`#choice-options button[data-option-id=${JSON.stringify(id)}]`);await idle();}
      await page.click('#btn-choice-submit');
    }else await page.click(`#choice-options button[data-option-id=${JSON.stringify(correct[0])}]`);
  }else{
    const index=c.state.board.indexOf(arithmetic(t));
    const point=await page.evaluate(async index=>{const {boardLayout}=await import('/dist/game/number-puzzle/render.js');const wrap=document.querySelector('#board-wrap'),canvas=document.querySelector('#board-canvas');const l=boardLayout(wrap.clientWidth-16,wrap.clientHeight-16),r=canvas.getBoundingClientRect();return{x:r.x+(l.boardX+(index%l.columns)*(l.tileW+8)+l.tileW/2)*r.width/l.width,y:r.y+(l.boardY+Math.floor(index/l.columns)*(l.tileH+8)+l.tileH/2)*r.height/l.height};},index);
    await page.mouse.click(point.x,point.y);
  }
  await idle();
  await page.waitForFunction(async index=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{const c=q.result.challenge;resolve(!c||c.state.questionIndex===index+1&&c.state.phase==='asking');db.close();};};}),i,{timeout:6000});
}
await page.waitForFunction(()=>document.body.dataset.screen==='result');
const after=await read(),record=after.records.at(-1);assert(record.score===100&&record.firstTryCount===10&&record.coins===30,'full challenge reward');
await page.screenshot({path:`${out}/result-grade1.png`});
await fs.writeFile(`${out}/grade1-result.json`,JSON.stringify({record,coinsBefore:before.coins,coinsAfter:after.coins,restored,seen:[...seen]},null,2));
console.log({record,restored,seen:[...seen]});console.log(await page.snapshot());
