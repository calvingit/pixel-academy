const task=await taskSpace(8),page=task.page('p1');
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
console.log(await page.snapshot());
