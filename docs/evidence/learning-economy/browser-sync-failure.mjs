// 第八轮：陈旧提交冲突后，二次读取也失败时不能误报“已同步”。仅使用 4181 测试档案。
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const output='/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/learning-economy';
const t=await taskSpace(5),p=t.page('p3');
const version=(await readFile('/Volumes/Data/Workspace/github/pixel-academy/web/sw.js','utf8')).match(/assets-v1-[a-f0-9]{12}/)[0];
await p.evaluate(async()=>{await(await navigator.serviceWorker.ready).update()});
await p.waitForFunction(v=>document.querySelector('#offline-notice').textContent.includes(v),version);
await p.click('#btn-open-shop');
const before=await p.evaluate(async()=>{
  const {openProfileStore,createProfile}=await import('/dist/game/number-puzzle/profile.js');
  const store=await openProfileStore(),current=await store.load(createProfile);
  await store.commit(current,()=>{});
  window.__originalGet=IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get=function(...args){if(this.name==='profiles'&&this.transaction.mode==='readonly')throw new Error('test: reload denied');return window.__originalGet.apply(this,args)};
  return current.coins;
});
await p.click('#shop-list article:first-child button');await p.click('#confirm-dialog button[value="yes"]');
await p.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
const message=await p.evaluate(()=>document.querySelector('#app-notice').textContent);
assert.match(message,/无法同步档案/);assert.doesNotMatch(message,/已同步/);
assert.equal(await p.evaluate(()=>document.querySelector('#storage-notice').hidden),false);
await p.evaluate(()=>{IDBObjectStore.prototype.get=window.__originalGet});
await p.reload();await p.waitForSelector('#screen-select',{state:'visible'});
const after=await p.evaluate(async()=>{const{openProfileStore,createProfile}=await import('/dist/game/number-puzzle/profile.js');return(await(await openProfileStore()).load(createProfile)).coins});
assert.equal(after,before);
await writeFile(`${output}/sync-failure-result.json`,JSON.stringify({version,message,coinsBefore:before,coinsAfter:after,noFalseSuccess:true},null,2));
console.log({version,message,coinsBefore:before,coinsAfter:after});console.log(await p.snapshot());
