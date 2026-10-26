const task=await taskSpace(8),page=task.page('p2');
const fs=await import('node:fs/promises');const out='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/question-expansion';
const assert=(v,m)=>{if(!v)throw new Error(m);};
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.evaluate(()=>document.querySelector('#btn-game-return').click());await page.waitForSelector('#confirm-dialog[open]');await page.click('#confirm-dialog button[value="yes"]');
await page.waitForFunction(()=>document.body.dataset.screen==='select'&&!document.body.inert);
await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
await page.waitForFunction(async()=> (await import('/dist/game/number-puzzle/generation.js')).GENERATION_VERSION==='generated-v4',undefined,{timeout:20000});
const results=[];
for(const name of ['subtraction-truth','mixed-expression']){
  const sample=await page.evaluate(async name=>{
    const {loadGameContent}=await import('/dist/game/number-puzzle/content.js');const {openProfileStore,createProfile}=await import('/dist/game/number-puzzle/profile.js');const content=loadGameContent();
    const e=content.select([1]).find(e=>{if(e.task.kind!=='choice')return false;const q=e.task.question;return name==='subtraction-truth'?q.kind==='truth'&&q.left.kind==='binary'&&q.left.operator==='-'&&q.left.left===7&&q.left.right===3&&q.right.value===5:q.kind==='expression-symbol'&&q.left.left+q.left.right===7&&q.right.operator==='-'&&q.right.left===9&&q.right.right===1;});
    if(!e)throw Error('approved example missing');
    const store=await openProfileStore(),p=await store.load(createProfile);await store.commit(p,d=>{d.grades=[1];d.practice={courseId:null,reviewId:null,exercises:[e],index:0,correct:0,revealed:false,answered:false,passed:true};});
    return {id:e.id,answerId:e.task.options.find(o=>o.value===(name==='subtraction-truth'?false:'<')).id};
  },name);
  await page.reload();await page.waitForFunction(()=>!document.body.inert);await page.click('#btn-restore');
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});
  await page.screenshot({path:`${out}/final-${name}-320.png`});
  await page.click(`#choice-options button[data-option-id=${JSON.stringify(sample.answerId)}]`);await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
  assert(await page.evaluate(()=>document.querySelector('#choice-feedback').textContent.startsWith('✓')),'example accepted');
  await page.click('#btn-practice-explain');
  const explanation=await page.evaluate(()=>document.querySelector('#practice-feedback').textContent);
  assert(explanation.includes('4')||name==='mixed-expression','subtraction correction shown');
  await page.screenshot({path:`${out}/final-${name}-explanation.png`});
  await page.click('#btn-explanation-close');results.push({name,...sample,explanation});
}
await fs.writeFile(`${out}/subtraction-result.json`,JSON.stringify(results,null,2));
console.log(results);console.log(await page.snapshot());
