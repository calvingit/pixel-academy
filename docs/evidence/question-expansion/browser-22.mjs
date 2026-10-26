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
await page.evaluate(()=>document.querySelector('#btn-revive').click());await idle();
if((await read()).challenge.paused){await page.evaluate(()=>document.querySelector('#btn-pause').click());await idle();}
await page.evaluate(()=>document.querySelector('#btn-ready').click());await idle();
const before=await read();const seen=new Set();let restored=true;
for(let i=before.challenge.state.questionIndex;i<10;i++){
  const [width,height] = i % 2 ? [568,320] : [320,568];
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await page.waitForFunction(([w,h])=>innerWidth===w&&innerHeight===h,[width,height]);
  let p=await read(),c=p.challenge;assert(c&&c.state.questionIndex===i,'question index');const t=c.state.questions[i].task;
  const key=t.kind==='choice'?t.question.kind:t.kind;
  if(t.kind==='choice'&&isMulti(t)&&!restored){
    await page.click(`#choice-options button[data-option-id=${JSON.stringify(ids(t)[0])}]`);await idle();
    await page.click('#btn-pause');await idle();const paused=await read();
    await page.reload();await page.waitForFunction(()=>!document.body.inert);await page.click('#btn-restore');
    const resumed=await read();assert(resumed.challenge.paused,'restores paused');assert(resumed.challenge.remainingMs===paused.challenge.remainingMs,'remaining time frozen');
    assert(JSON.stringify(resumed.challenge.state.selectedIds)===JSON.stringify(paused.challenge.state.selectedIds),'challenge half selection restored');
    await page.click('#btn-pause');await idle();restored=true;c=(await read()).challenge;
  }
  const layout = await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#choice-board button,#choice-board h2,.game-actions button')].filter(e=>e.getClientRects().length).map(e=>({id:e.id||e.textContent,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,bottom:e.getBoundingClientRect().bottom,height:e.getBoundingClientRect().height}))}));
  assert(layout.sw<=layout.w,'horizontal overflow'); for(const b of layout.controls){assert(b.x>=0&&b.right<=layout.w+1&&b.bottom<=layout.h+1,'control outside viewport: '+b.id);}
  seen.add(key);
  if(t.kind==='choice'){
    const correct=ids(t);
    if(isMulti(t)){
      const selected=c.state.selectedIds??[];
      for(const id of correct.filter(id=>!selected.includes(id))){await page.evaluate(id=>document.querySelector(`#choice-options button[data-option-id=${JSON.stringify(id)}]`).click(),id);await idle();}
      await page.evaluate(()=>document.querySelector('#btn-choice-submit').click());
    }else await page.evaluate(id=>document.querySelector(`#choice-options button[data-option-id=${JSON.stringify(id)}]`).click(),correct[0]);
  }else{
    const index=c.state.board.indexOf(arithmetic(t));
    const point=await page.evaluate(async index=>{const {boardLayout}=await import('/dist/game/number-puzzle/render.js');const wrap=document.querySelector('#board-wrap'),canvas=document.querySelector('#board-canvas');const l=boardLayout(wrap.clientWidth-16,wrap.clientHeight-16),r=canvas.getBoundingClientRect();return{x:r.x+(l.boardX+(index%l.columns)*(l.tileW+8)+l.tileW/2)*r.width/l.width,y:r.y+(l.boardY+Math.floor(index/l.columns)*(l.tileH+8)+l.tileH/2)*r.height/l.height};},index);
    await page.mouse.click(point.x,point.y);
  }
  await idle();
  await page.waitForFunction(async index=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{const c=q.result.challenge;resolve(!c||c.state.questionIndex===index+1&&c.state.phase==='asking');db.close();};};}),i,{timeout:6000});
}
await page.waitForFunction(()=>document.body.dataset.screen==='result');
const after=await read(),record=after.records.at(-1);assert(record.score===95&&record.firstTryCount===9&&record.coins===23&&record.totalTimeoutCount===1&&record.revivals===1,'revived challenge settlement');
await page.screenshot({path:`${out}/result-grade2-revived.png`});
await fs.writeFile(`${out}/grade2-revived-result.json`,JSON.stringify({record,coinsBefore:before.coins,coinsAfter:after.coins,restored,seen:[...seen]},null,2));
console.log({record,restored,seen:[...seen]});console.log(await page.snapshot());
