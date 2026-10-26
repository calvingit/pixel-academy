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
await page.waitForFunction(()=>document.querySelector('#offline-notice').textContent.includes('assets-v1-c3f7f6144e39'),undefined,{timeout:15000});
const initial=await read();
await click('#btn-menu');await click('#btn-open-shop');await click('#shop-list article:first-child button');
await page.waitForSelector('#confirm-dialog[open]');await click('#confirm-dialog button[value="yes"]');
await click('#screen-shop [data-home]');
await click('#btn-to-availability');await click('#btn-start');
const advance=index=>page.waitForFunction(async i=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{const c=q.result.challenge;resolve(!c||c.state.questionIndex===i+1&&['asking','ready'].includes(c.state.phase));db.close();};};}),index,{timeout:6000});
async function answer(correct=true){
  const c=(await read()).challenge,t=c.state.questions[c.state.questionIndex].task;
  if(t.kind==='choice'){
    const accepted=ids(t);
    const chosen=correct?accepted:[t.options.find(o=>!accepted.includes(o.id)).id];
    for(const id of chosen){await click(`#choice-options button[data-option-id=${JSON.stringify(id)}]`);if(!isMulti(t))break;}
    if(isMulti(t))await click('#btn-choice-submit');
  }else{
    const value=arithmetic(t),index=correct?c.state.board.indexOf(value):c.state.board.findIndex(n=>n!==value);
    await page.evaluate(async index=>{const{boardLayout}=await import('/dist/game/number-puzzle/render.js');const wrap=document.querySelector('#board-wrap'),canvas=document.querySelector('#board-canvas'),r=canvas.getBoundingClientRect(),l=boardLayout(wrap.clientWidth-16,wrap.clientHeight-16);canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.x+(l.boardX+index%l.columns*(l.tileW+8)+l.tileW/2)*r.width/l.width,clientY:r.y+(l.boardY+Math.floor(index/l.columns)*(l.tileH+8)+l.tileH/2)*r.height/l.height,bubbles:true}));},index);await idle();
  }
}
let c=(await read()).challenge;
const deadline=c.deadline;await click('#btn-time');
c=(await read()).challenge;assert(Math.abs(c.deadline-deadline-5000)<100,'time adds five seconds');assert(c.state.timeUsed,'time card used');
while(true){c=(await read()).challenge;const t=c.state.questions[c.state.questionIndex].task;if(t.kind==='choice'&&isMulti(t))break;const i=c.state.questionIndex;await answer();await advance(i);}
const questionIndex=c.state.questionIndex,t=c.state.questions[questionIndex].task,correctIds=ids(t);
await click(`#choice-options button[data-option-id=${JSON.stringify(correctIds[0])}]`);await click('#btn-choice-submit');
assert((await read()).challenge.state.totalWrongCount===1,'incomplete set counted once');
await click('#btn-revive');await click('#btn-ready');
assert((await read()).challenge.state.selectedIds.length===0,'revival clears selection');
await answer(false);assert((await read()).challenge.state.totalWrongCount===2,'second error counted');
await click('#btn-revive');await click('#btn-hint');
const hinted=await read();assert(hinted.challenge.state.phase==='ready'&&hinted.challenge.state.hintUsed,'hint before timer');
assert(await page.evaluate(()=>document.querySelectorAll('#choice-options button[data-hint="true"]').length)===correctIds.length,'all correct choices highlighted');
await page.screenshot({path:`${out}/hint-ready.png`});
await click('#btn-ready');await answer();await advance(questionIndex);
const next=(await read()).challenge;assert(next.state.score===questionIndex*10+5,'hinted set earns five points');assert(next.state.firstTryCount===questionIndex,'assisted answer not first try');
if(next.state.phase==='ready')await click('#btn-ready');
await answer(false);await page.waitForFunction(()=>document.body.dataset.screen==='result');
const after=await read(),record=after.records.at(-1);assert(record.revivals===2&&record.totalWrongCount===3&&!record.passed,'third wrong ends challenge');
assert(after.cards.hint===initial.cards.hint-1,'one hint consumed');assert(after.coins===initial.coins-3-30+record.coins,'purchases and rewards exact');
await fs.writeFile(`${out}/tools-result.json`,JSON.stringify({record,coinsBefore:initial.coins,coinsAfter:after.coins,timeAddVerifiedWithin100ms:true,allCorrectHinted:true,selectionClearedOnRevive:true},null,2));
console.log({record,coins:after.coins});console.log(await page.snapshot());
