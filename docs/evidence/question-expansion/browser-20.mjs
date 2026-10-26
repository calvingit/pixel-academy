const task=await taskSpace(8),page=await task.newPage();
await page.goto('http://127.0.0.1:4185');
await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
await page.waitForFunction(()=>!document.body.inert);
console.log({label:page.label});console.log(await page.snapshot());
