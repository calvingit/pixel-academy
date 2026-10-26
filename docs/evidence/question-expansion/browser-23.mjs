// 仅用于独立 4185 测试源站：注入正式筛选后的原题，验证渲染和交互；不证明入口或奖励。
const task=await taskSpace(8),page=task.page('p2');
const fs=await import('node:fs/promises');
const out='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/question-expansion';
const cases=JSON.parse(await fs.readFile(`${out}/render-cases.json`,'utf8'));
const assert=(v,m)=>{if(!v)throw new Error(m);};
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
const idle=()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
const results=[];
for(const sample of cases){
  await page.evaluate(async exercise=>{
    const {openProfileStore,createProfile}=await import('/dist/game/number-puzzle/profile.js');const store=await openProfileStore();const p=await store.load(createProfile);
    await store.commit(p,draft=>{draft.grades=[2];draft.challenge=null;draft.practice={courseId:null,reviewId:null,exercises:[exercise],index:0,correct:0,revealed:false,answered:false,passed:true};});
  },sample.exercise);
  await page.reload();await page.waitForFunction(()=>!document.body.inert);await page.click('#btn-restore');
  for(const [width,height] of [[320,568],[568,320]]){
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#choice-board button,#choice-board h2,.game-actions button,#practice-tools button')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return{id:e.id||e.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,overflow:e.scrollWidth>e.clientWidth};})}));
    assert(geometry.scrollWidth<=geometry.width,`${sample.name}:horizontal overflow`);
    for(const c of geometry.controls){assert(c.x>=0&&c.y>=0&&c.right<=width+1&&c.bottom<=height+1,`${sample.name}:out of viewport ${c.id}`);if(c.id!=='choice-task')assert(c.height>=44,`${sample.name}:small control ${c.id}`);assert(!c.overflow,`${sample.name}:text clipped ${c.id}`);}
    if(sample.name==='groups') assert(await page.evaluate(()=>document.querySelectorAll('.choice-dot').length)===sample.exercise.task.question.groups*sample.exercise.task.question.each,'dots reflect groups');
    await page.screenshot({path:`${out}/type-${sample.name}-${width}.png`});results.push({name:sample.name,...geometry});
  }
  for(const id of sample.ids){await page.evaluate(id=>document.querySelector(`#choice-options button[data-option-id=${JSON.stringify(id)}]`).click(),id);await idle();}
  if(sample.multiple){await page.evaluate(()=>document.querySelector('#btn-choice-submit').click());await idle();}
  const passed=await page.evaluate(()=>document.querySelector('#choice-feedback').textContent.startsWith('✓'));
  assert(passed,`${sample.name}:correct answer accepted`);
}
await fs.writeFile(`${out}/render-results.json`,JSON.stringify(results,null,2));
console.log({cases:cases.length,sizes:results.length});console.log(await page.snapshot());
