const task=await taskSpace(8),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.click('@47');await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
await page.click('#btn-menu');await page.click('#btn-open-review');
console.log(await page.snapshot());
