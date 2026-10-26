const task=await taskSpace(8),page=task.page('p1');
await page.click('#courses-list article:has-text("找出所有符合的数") button');
await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
console.log(await page.snapshot());
