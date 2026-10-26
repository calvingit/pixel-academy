const task=await taskSpace(8),page=task.page('p1');
const assert=(v,m)=>{if(!v)throw new Error(m);};
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const read=()=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{resolve(q.result);db.close();};};}));
const idle=()=>page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
await page.click('loc=role:button[name="示例已理解，开始三题小练习"]');await idle();
const before=await read();
for(let i=0;i<3;i++){
  const p=await read(),t=p.practice.exercises[i].task,q=t.question;
  for(const o of t.options.filter(o=>q.relation==='>'?o.value>q.target:o.value<q.target)){await page.click(`#choice-options button[data-option-id=${JSON.stringify(o.id)}]`);await idle();}
  await page.click('#btn-choice-submit');await idle();
  assert((await read()).practice.correct===i+1,'whole-set answer accepted');
  await page.click('#btn-practice-next');await idle();
}
const done=await read();assert(done.coins===before.coins+10,'course reward +10');assert(done.courses['filter-1'].rewarded,'course complete');
await page.click('button[data-home]');
console.log({courseCoins:done.coins,firstCourseReward:10});
console.log(await page.snapshot());
