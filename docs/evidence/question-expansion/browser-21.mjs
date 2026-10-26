const task=await taskSpace(8),page=task.page('p1');
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
console.log(await page.snapshot());
console.log(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pixel-academy',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('profiles','readonly').objectStore('profiles').get('local');q.onsuccess=()=>{const c=q.result.challenge;resolve({c,notice:document.querySelector('#app-notice').textContent,hidden:document.hidden});db.close();};};})));
