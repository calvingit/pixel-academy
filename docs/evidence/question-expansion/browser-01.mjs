const task = await taskSpace('数学题型扩展-20261026');
const page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.goto('http://127.0.0.1:4183');
await page.waitForFunction(() => window.__pixelAcademyBooted && !document.body.inert);
console.log({spaceId:task.spaceId});
console.log(await page.snapshot());
