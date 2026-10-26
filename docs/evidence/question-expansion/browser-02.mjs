const task=await taskSpace(8), page=task.page('p1');
await page.click('input[name="grade"][value="1"]');
await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
await page.click('#btn-menu');
await page.click('#btn-open-courses');
console.log(await page.snapshot());
