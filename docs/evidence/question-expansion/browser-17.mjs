const task=await taskSpace(8),page=task.page('p1');
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.click('#btn-return');
await page.waitForFunction(()=>document.body.dataset.screen==='select'&&!document.body.inert);
await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
await page.waitForFunction(async()=>{const m=await import('/dist/game/number-puzzle/generation.js');return m.GENERATION_VERSION==='generated-v3';},undefined,{timeout:15000});
console.log(await page.evaluate(async()=>{const m=await import('/dist/game/number-puzzle/generation.js');return {version:m.GENERATION_VERSION,courses:(await import('/dist/game/number-puzzle/learning.js')).COURSES.length,offline:document.querySelector('#offline-notice').textContent};}));
console.log(await page.snapshot());
