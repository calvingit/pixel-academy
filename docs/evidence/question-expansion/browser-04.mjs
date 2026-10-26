const task=await taskSpace(8),page=task.page('p1');
await page.click('@14');
await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
console.log(await page.snapshot());
