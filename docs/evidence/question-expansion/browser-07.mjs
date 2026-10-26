const task=await taskSpace(8),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
console.log(await page.evaluate(()=>({w:innerWidth,h:innerHeight,visual:visualViewport.width,sw:screen.width})));
await page.click('#choice-options button[data-option-id="number:6"]');
await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
await page.screenshot({path:'/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/question-expansion/multiple-selected-390.png'});
console.log(await page.evaluate(()=>({w:innerWidth,h:innerHeight,selected:[...document.querySelectorAll('#choice-options button[aria-pressed="true"]')].map(e=>e.dataset.optionId),disabled:document.querySelector('#btn-choice-submit').disabled})));
console.log(await page.snapshot());
