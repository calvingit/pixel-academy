const task=await taskSpace(8),page=task.page('p1');
await page.click('@21');
await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
await page.screenshot({path:'/Volumes/Data/Workspace/github/pixel-academy/docs/evidence/question-expansion/multiple-390.png'});
console.log(await page.snapshot());
