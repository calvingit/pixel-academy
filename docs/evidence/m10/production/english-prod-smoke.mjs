// M10 英语快递员生产环境验证（Cloudflare Pages，https://pixel-academy.pages.dev）。
// 口径对齐 docs/evidence/m8|9|12/production/：无头 Chrome CDP 直连生产源；
// 覆盖 P1 在线首页五入口与 SW 版本 → P2 经菜单进 /english.html（SW 导航含 308 re-wrap 路径）
// 并完成一个真实任务 → P3 浏览器级离线仿真下首页与 /english.html 缓存可达 + 断网作答 →
// P4 离线下无扩展名 /english 导航回退（Pages 308 规范化兜底分支）。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = 'https://pixel-academy.pages.dev/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9742';
const outDir = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[prod]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

const targets = await (await fetch(`${CDP_HTTP}/json`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, msg => { clearTimeout(timer); msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result); });
  });
};
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`页面异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64'));
  log('截图', name);
};
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
` });

const waitUntil = async (fn, desc, timeoutMs = 30000) => {
  const start = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(400);
  }
};
const goto = async url => {
  await send('Page.navigate', { url });
  await sleep(1800);
};

const homeState = () => evaluate(`(() => {
  const anchor = sel => { const a = document.querySelector(sel);
    return a ? { href: a.getAttribute('href'), visible: !!(a.offsetWidth || a.offsetHeight) } : null; };
  return {
    url: location.href, selectVisible: !document.getElementById('screen-select')?.hidden,
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    englishAnchor: anchor('#main-nav a[href="/english.html"]'),
    hanziAnchor: anchor('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: anchor('#main-nav a[href="/dungeon.html"]'),
    pinyinAnchor: anchor('#main-nav a[href="/pinyin.html"]'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);
const englishState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null;
  try { const raw = localStorage.getItem('pixel-academy:english-courier:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  let recordsRaw = null;
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:english-courier:v1:records') ?? 'null'); } catch {}
  return {
    url: location.href,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    selectVisible: !hidden('screen-select'), gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'), questionVisible: !hidden('question-card'),
    gradeCards: document.querySelectorAll('#grade-grid button').length,
    hudProgress: t('hud-progress'), hudScore: t('hud-score'),
    prompt: t('q-prompt'),
    parcels: [...document.querySelectorAll('#parcels .parcel-card')].map(b => b.dataset.word),
    stationImages: [...document.querySelectorAll('#stations .station-card img')]
      .map(i => i.complete && i.naturalWidth > 0),
    feedbackHidden: hidden('feedback'), feedback: t('feedback'),
    resultScore: t('result-score'), resultAnswer: t('result-answer'),
    snap, recordsRaw,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

const swInfo = () => evaluate(`(async () => {
  if (navigator.serviceWorker.controller === null) return null;
  const keys = await caches.keys();
  const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
  if (!name) return null;
  const cache = await caches.open(name);
  const need = ['/english.html', '/english.css', '/dist/game/english-courier/main.js',
    '/dist/learning/english.js', '/dist/content/english-exercises.js', '/img/english-courier/mum.svg'];
  const missing = [];
  for (const u of need) if (!(await cache.match(u))) missing.push(u);
  let svgCount = 0;
  for (const k of await cache.keys()) if (k.url.includes('/img/english-courier/')) svgCount += 1;
  return { name, missing, svgCount };
})()`);

const planMove = () => evaluate(`(async () => {
  const raw = localStorage.getItem('pixel-academy:english-courier:v1:interrupted');
  const snap = JSON.parse(raw);
  const q = snap.state.questions[snap.state.questionIndex];
  const { selectEnglishExercises } = await import('/dist/game/english-courier/content.js');
  const { englishDeliveryAnswer, englishCanonicalWord } = await import('/dist/learning/english.js');
  const ex = selectEnglishExercises([1]).find(e => e.id === q.exerciseId);
  const answer = englishDeliveryAnswer(ex.task);
  const correctParcel = q.parcels.find(w => englishCanonicalWord(w) === answer.parcel);
  const correctStation = q.stations.findIndex(w => englishCanonicalWord(w) === answer.recipient);
  return { exerciseId: q.exerciseId, correctParcel, correctStation, qi: snap.state.questionIndex };
})()`);
const click = selector => evaluate(`(() => { document.querySelector(${JSON.stringify(selector)})?.click(); })()`, false);
const clickWord = async word => {
  const idx = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('#parcels .parcel-card')];
    return btns.findIndex(b => b.dataset.word === ${JSON.stringify(word)}); })()`, false);
  await click(`#parcels .parcel-card:nth-of-type(${idx + 1})`);
};
const clickStation = async i => { await click(`#stations .station-card:nth-of-type(${i + 1})`); };

// 勾选一年级（点击会重建年级卡，带按下态验证重试；未选年级时开始禁用）。
// 注意本脚本的 englishState().gradeCards 是数量（number），按下态在此独立读取。
const toggleGradeVerified = async (desc, timeoutMs = 20000) => {
  const start = Date.now();
  let lastDump = null;
  for (;;) {
    try {
      await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
        .find(x => x.textContent === '一年级');
        if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`, false);
      const st = await evaluate(`(() => {
        const b = [...document.querySelectorAll('#grade-grid button')].find(x => x.textContent === '一年级');
        return { pressed: b?.getAttribute('aria-pressed') ?? null,
          startDisabled: document.getElementById('btn-start')?.disabled ?? null,
          avail: document.getElementById('availability-status')?.textContent ?? '',
          errors: window.__errors ?? [] }; })()`);
      if (st.pressed === 'true' && st.startDisabled === false) return st;
      lastDump = st;
    } catch (e) {
      lastDump = { error: String(e) };
    }
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}（末次观察: ${JSON.stringify(lastDump)}）`);
    await sleep(400);
  }
};

// ===== P1 在线首页：SW 版本与五入口 =====
let swText = '';
try {
  await goto(ORIGIN);
  // 重置为本脚本档案内的全新首访状态（清测试档案数据与缓存；不影响真实用户数据）。
  await evaluate(`(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    for (const r of rs) await r.unregister();
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
    localStorage.clear();
    return true; })()`);
  await send('Page.reload', { ignoreCache: false });
  await sleep(2500);
  // 菜单锚点在关闭的 dialog 内，visible 恒为 false：先等存在，再开菜单断言可见。
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && s.englishAnchor ? s : null; }, '生产首页就绪（重置后首访含 SW 安装 128 项预缓存）', 180000);
  swText = await evaluate(`fetch('/sw.js').then(r => r.text()).catch(() => '')`);
  const info = await waitUntil(swInfo, 'SW 受控且预缓存含 english 资产', 60000);
  if (info.missing.length) throw new Error(`预缓存缺失: ${JSON.stringify(info.missing)}`);
  await click('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, '菜单打开');
  const s1 = await homeState();
  await shot('p1-01-home-menu');
  const ok = info.svgCount === 12 && s1.englishAnchor?.visible && s1.hanziAnchor?.visible
    && s1.dungeonAnchor?.visible && s1.pinyinAnchor?.visible && s1.errors.length === 0;
  record('P1 生产在线首页（SW 版本 + 五入口 + 预缓存）', ok,
    `SW ${info.name} 受控；预缓存含 /english.html、/english.css、英语 dist 模块与 ${info.svgCount} 张 /img/english-courier/*.svg；菜单弹层内英语快递员与汉字勇者/算术地下城/拼音冒险锚点并存；JS 错误 ${s1.errors.length} 个`,
    { checks: { sw: info, menu: { english: s1.englishAnchor, hanzi: s1.hanziAnchor, dungeon: s1.dungeonAnchor, pinyin: s1.pinyinAnchor }, overflow: s1.overflowX, errors: s1.errors } });
} catch (e) {
  record('P1 生产在线首页（SW 版本 + 五入口 + 预缓存）', false, `失败: ${e.message}`);
}

// ===== P2 经菜单进 /english.html（SW 导航，含 Pages 308 re-wrap 路径）并完成一个真实任务 =====
try {
  await click('#main-nav a[href="/english.html"]');
  await waitUntil(async () => { const s = await englishState(); return s.url.includes('/english.html') && s.bootFailHidden && s.selectVisible && s.gradeCards === 6 ? s : null; }, '生产 /english.html 由 SW 打开');
  // 勾选一年级（点击会重建年级卡，带按下态验证重试；未选年级时开始禁用）。
  await toggleGradeVerified('勾选一年级');
  await click('#btn-start');
  await waitUntil(async () => { const s = await englishState(); return s.gameVisible && s.questionVisible && s.parcels.length > 0 ? s : null; }, '生产局内首任务');
  const plan = await planMove();
  await clickWord(plan.correctParcel);
  await clickStation(plan.correctStation);
  const fb = await waitUntil(async () => { const s = await englishState(); return s.feedbackHidden === false && (s.feedback ?? '').startsWith('✓') ? s.feedback : null; }, '送达完成反馈');
  const s2 = await englishState();
  await shot('p2-01-english-online-task');
  const ok = (s2.prompt ?? '').length > 0 && s2.stationImages.every(Boolean)
    && fb.includes('+10') && s2.errors.length === 0;
  record('P2 生产在线 /english.html（SW 导航 + 真实任务送达）', ok,
    `经菜单真实导航进 ${s2.url}（SW 导航路径，Pages 对 /english.html 308 → /english 由 SW 回退分支与 redirected 重包处理，M8 缺陷修复口径）；首任务「${s2.prompt}」（${plan.exerciseId}）取包裹「${plan.correctParcel}」送达站位 ${plan.correctStation + 1} → ${fb}；站位角色图 ${s2.stationImages.filter(Boolean).length}/${s2.stationImages.length} 加载成功；JS 错误 ${s2.errors.length} 个`,
    { checks: { task: { id: plan.exerciseId, prompt: s2.prompt, parcel: plan.correctParcel, station: plan.correctStation }, feedback: fb, stationImages: s2.stationImages, overflow: s2.overflowX, errors: s2.errors } });
  // 弃局返回（尽力而为的环境清理；游戏侧弃局行为已在桌面 E5/探针/模拟器轮验证，
  // 此处超时不作为场景失败——核心断言为 SW 导航与真实任务送达）。
  await sleep(1300);
  try {
    await click('#btn-game-return');
    await waitUntil(async () => { const s = await englishState(); return s.confirmOpen ? s : null; }, '弃局确认', 10000);
    await click('#btn-confirm-yes');
    await waitUntil(async () => { const s = await englishState(); return s.selectVisible ? s : null; }, '弃局返回选择屏', 10000);
  } catch (e) {
    log('弃局清理未完成（不作为失败项）:', e.message.slice(0, 200));
    try { await evaluate(`document.getElementById('confirm-dialog')?.close()`); } catch {}
  }
} catch (e) {
  // 防御：关闭可能遗留的模态确认框，避免阻塞后续场景。
  try { await evaluate(`document.getElementById('confirm-dialog')?.open && document.getElementById('confirm-dialog').close()`); } catch {}
  record('P2 生产在线 /english.html（SW 导航 + 真实任务送达）', false, `失败: ${e.message}`);
}

// ===== P3 浏览器级离线仿真：首页与 /english.html 缓存可达 + 断网作答 =====
try {
  await goto(ORIGIN);
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, '离线前首页就绪', 60000);
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, '离线仿真下首页由缓存打开');
  const homeOffline = await homeState();
  await shot('p3-01-offline-home');
  await click('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.englishAnchor?.visible ? s : null; }, '离线菜单');
  await click('#main-nav a[href="/english.html"]');
  await waitUntil(async () => { const s = await englishState(); return s.url.includes('/english.html') && s.bootFailHidden && s.selectVisible && s.gradeCards === 6 ? s : null; }, '离线仿真下 /english.html 由缓存打开');
  // 勾选一年级（点击会重建年级卡，带按下态验证重试）；残留恢复提供不阻塞开局。
  await toggleGradeVerified('离线勾选一年级');
  // 点击开始（最坏重建竞态下重试三次）。
  let started = null;
  for (let attempt = 0; attempt < 3 && !started; attempt++) {
    await click('#btn-start');
    started = await waitUntil(async () => {
      const s = await englishState();
      return s.gameVisible && s.questionVisible && s.parcels.length > 0 ? s : null;
    }, `离线开局（第 ${attempt + 1} 次）`, 12000).catch(() => null);
  }
  if (!started) {
    const diag = await englishState();
    throw new Error(`离线开局失败: ${JSON.stringify({ game: diag.gameVisible, select: diag.selectVisible, startDisabled: diag.startDisabled, grades: diag.gradeCards, errors: diag.errors })}`);
  }
  const plan = await planMove();
  await clickWord(plan.correctParcel);
  await clickStation(plan.correctStation);
  const fb = await waitUntil(async () => { const s = await englishState(); return s.feedbackHidden === false && (s.feedback ?? '').startsWith('✓') ? s.feedback : null; }, '离线送达完成反馈');
  await shot('p3-02-offline-task');
  const s3 = await englishState();
  const ok = homeOffline.selectVisible && s3.stationImages.every(Boolean) && fb.includes('+10')
    && s3.errors.length === 0;
  record('P3 生产离线仿真（缓存可达 + 断网作答）', ok,
    `CDP 浏览器级离线仿真（Network.emulateNetworkConditions offline）下 Page.reload：首页由缓存打开；菜单进 /english.html 由缓存正常加载（boot-fail 隐藏）；断网开局首任务「${s3.prompt}」（${plan.exerciseId}）取「${plan.correctParcel}」送达站位 ${plan.correctStation + 1} → ${fb}；站位角色图 ${s3.stationImages.filter(Boolean).length}/${s3.stationImages.length} 加载成功（离线 200 只能来自 SW 预缓存）；JS 错误 ${s3.errors.length} 个`,
    { checks: { task: { id: plan.exerciseId, prompt: s3.prompt, parcel: plan.correctParcel, station: plan.correctStation }, feedback: fb, stationImages: s3.stationImages, overflow: s3.overflowX, errors: s3.errors } });
  // 弃局并恢复在线（尽力而为；同 P2 口径，不影响本场景核心断言）。
  try {
    await click('#btn-game-return');
    await waitUntil(async () => { const s = await englishState(); return s.confirmOpen ? s : null; }, '离线弃局确认', 10000);
    await click('#btn-confirm-yes');
  } catch (e) {
    log('离线弃局清理未完成（不作为失败项）:', e.message.slice(0, 200));
    try { await evaluate(`document.getElementById('confirm-dialog')?.close()`); } catch {}
  }
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
} catch (e) {
  try { await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch {}
  record('P3 生产离线仿真（缓存可达 + 断网作答）', false, `失败: ${e.message}`);
}

// ===== P4 离线下无扩展名 /english 导航回退（Pages 308 兜底分支） =====
try {
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await goto(`${ORIGIN}english`);
  const s4 = await waitUntil(async () => {
    const s = await englishState();
    return s.selectVisible && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, '离线 /english 由 SW 回退打开');
  await shot('p4-01-offline-no-ext');
  // sw.js 文本在 P1（在线）已取；离线 fetch 不可依赖。
  const branchOk = swText.includes("url.pathname === '/english.html' || url.pathname === '/english'");
  const ok = s4.gradeCards === 6 && branchOk;
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  record('P4 离线无扩展名 /english 导航回退', ok,
    `浏览器级离线仿真下 Page.navigate 到 ${ORIGIN}english（无扩展名；生产 Pages 曾把 /english.html 308 规范化到 /english，旧访客可能持有该 URL）：页面由 SW 导航回退分支打开（6 年级卡、boot-fail 隐藏）；sw.js 文本含 '/english.html' || '/english' 回退分支=${branchOk}；JS 错误 ${s4.errors.length} 个`,
    { checks: { gradeCards: s4.gradeCards, branchOk, overflow: s4.overflowX, errors: s4.errors } });
} catch (e) {
  try { await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch {}
  record('P4 离线无扩展名 /english 导航回退', false, `失败: ${e.message}`);
}

const summary = {
  generatedAt: new Date().toISOString(), origin: ORIGIN,
  deployment: '25092cd4', commit: 'd6dfe17',
  scenarios, allPassed: scenarios.every(s => s.pass),
};
await writeFile(`${outDir}/english-prod-results.json`, JSON.stringify(summary, null, 2));
log('结果已写入 english-prod-results.json');
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(summary.allPassed ? 0 : 1);
