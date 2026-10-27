// M8 生产环境验证（Cloudflare Pages https://pixel-academy.pages.dev，桌面无头 Chrome 经 CDP）。
// 参照 nav-browser.mjs 基础设施；生产环境只做只读关键路径，不跑整局、不注入状态：
// P1 生产首页与 SW 版本 → P2 导航入口进入 hanzi 并返回 → P3 缓存清单双入口
// → P4 断网刷新离线可达（首页与 hanzi 往返）→ 恢复在线。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'https://pixel-academy.pages.dev/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9741';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m8/production';
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
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 30000);
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });

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
const goto = async url => { await send('Page.navigate', { url }); await sleep(1500); };
const trustedClick = async selector => {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`, false);
  if (!rect) throw new Error(`元素不存在: ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
};
const EXPECT_VERSION = process.env.EXPECT_VERSION ?? 'assets-v1-c443b797b0e8';

const homeState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('main h1, main .app-title')?.textContent ?? null,
    selectVisible: !document.getElementById('screen-select')?.hidden,
    errorVisible: !document.getElementById('screen-error')?.hidden,
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    hanziAnchor: (() => { const a = document.querySelector('#main-nav a[href="/hanzi.html"]');
      return a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/\\s+/g, ' '), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
    offlineNotice: document.getElementById('offline-notice')?.hidden ? null : t('offline-notice'),
    controlled: navigator.serviceWorker.controller !== null,
    errors: window.__errors ?? [],
  };
})()`, false);

const hanziState = () => evaluate(`(() => ({
  url: location.href, title: document.title,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
  selectVisible: !document.getElementById('screen-select')?.hidden,
  errors: window.__errors ?? [],
}))()`, false);

const swInfo = () => evaluate(`(async () => {
  const reg = await navigator.serviceWorker.ready;
  const keys = await caches.keys();
  const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:')) ?? null;
  let cacheOk = null;
  if (name) {
    const cache = await caches.open(name);
    const home = await cache.match('/');
    const hanzi = await cache.match('/hanzi.html');
    cacheOk = {
      homeCached: !!home, hanziCached: !!hanzi,
      homeHasEntry: home ? (await home.text()).includes('/hanzi.html') : false,
      hanziHasBack: hanzi ? (await hanzi.text()).includes('返回数字消除') : false,
      count: (await cache.keys()).length,
    };
  }
  return { scriptURL: reg.active?.scriptURL ?? null, cacheName: name, cacheOk,
    controlledViaController: navigator.serviceWorker.controller !== null,
    scope: reg.active ? new URL(reg.active.scriptURL).origin : null };
})()`);

// ===== P1 生产首页与 SW 版本 =====
// 首访时序：SW install（预缓存写入）→ activate → 接管（controller 非空）→ 页面提示 ready。
// 预缓存写入早于接管，故必须等到 controller 非空且提示含版本号才算就绪；未接管时自动刷新一次。
try {
  await goto(ORIGIN);
  const s1 = await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '生产首页加载', 45000);
  let info = null;
  let reloaded = false;
  const info1 = await waitUntil(async () => {
    info = await swInfo().catch(() => null);
    if (!info || !info.cacheOk?.hanziCached) return null;
    if (!info.controlledViaController) {
      // activate 完成但本页未被接管：刷新一次让 controllerchange 生效
      if (!reloaded) { reloaded = true; await send('Page.reload', { ignoreCache: false }); await sleep(1500); }
      return null;
    }
    return info;
  }, 'SW 接管且缓存就绪', 60000);
  const s1b = await homeState();
  // 缓存条目形态如实记录（Pages 308 规范化下 /hanzi.html 条目为 redirected=true，
  // 由 SW 回退分支的 re-wrap 兜底，导航正确性由 P2/P4 实测验证）；
  // 并断言生产 sw.js 源含 re-wrap 逻辑。
  const clean = await evaluate(`(async () => {
    const cache = await caches.open('pixel-academy:number-puzzle:${EXPECT_VERSION}');
    const home = await cache.match('/'); const hanzi = await cache.match('/hanzi.html');
    const swText = await (await fetch('/sw.js', { cache: 'no-store' })).text();
    return { homeRedirected: home?.redirected ?? null, hanziRedirected: hanzi?.redirected ?? null,
      rewrapInSw: swText.includes('hit.redirected ? new Response(hit.body') };
  })()`);
  await shot('prod-01-home');
  const versionOk = info1.cacheName === `pixel-academy:number-puzzle:${EXPECT_VERSION}`
    && (s1b.offlineNotice ?? '').includes(EXPECT_VERSION);
  record('P1 生产首页与 SW 版本', versionOk && !!s1b.hanziAnchor && s1b.errors.length === 0 && clean.rewrapInSw,
    `生产 ${s1.url} 正常加载（h1=${s1.h1?.trim()}${reloaded ? '；SW 激活后自动刷新一次完成接管' : ''}）；SW 受控，缓存 ${info1.cacheName} 与预期版本 ${EXPECT_VERSION} 一致（${info1.cacheOk.count} 项），页面提示「${s1b.offlineNotice}」；缓存条目 redirected：/=${clean.homeRedirected}、/hanzi.html=${clean.hanziRedirected}（Pages 308 规范化所致，由 SW re-wrap 兜底），生产 sw.js 含 re-wrap 逻辑=${clean.rewrapInSw}；导航入口存在于菜单（href=${s1b.hanziAnchor?.href ?? '缺失'}，可见性由 P2 实际点击验证）`,
    { checks: { home: s1, homeAfterReady: s1b, sw: info1, cacheRedirected: clean } });
} catch (e) { record('P1 生产首页与 SW 版本', false, `失败: ${e.message}`); }

// ===== P2 生产导航入口进入 hanzi 并返回 =====
try {
  // P1 结束后可能停留在首页任意位置；回到干净首页再开菜单
  if (new URL((await homeState()).url).pathname !== '/') { await goto(ORIGIN); await sleep(1000); }
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.hanziAnchor?.visible ? s : null; }, '菜单弹层');
  await shot('prod-02-menu-entry');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const hs = await waitUntil(async () => {
    const s = await hanziState();
    if (s.url.includes('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6) return s;
    return null;
  }, '生产 hanzi 页加载', 45000);
  await shot('prod-03-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  const back = await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '返回生产首页', 30000);
  await shot('prod-04-back-home');
  record('P2 生产导航入口进入 hanzi 并返回', hs.gradeCards === 6 && back.selectVisible && hs.errors.length === 0 && back.errors.length === 0,
    `菜单入口点击进入 ${hs.url}（年级卡 ${hs.gradeCards} 张、boot-fail 隐藏）；「${hs.backLink?.text}」返回生产首页正常；全程 JS 错误 0 个`,
    { checks: { hanzi: hs, back: { url: back.url, selectVisible: back.selectVisible } } });
} catch (e) {
  try { await shot('prod-fail-p2'); } catch {}
  record('P2 生产导航入口进入 hanzi 并返回', false, `失败: ${e.message}`);
}

// ===== P3 缓存清单双入口（生产） =====
try {
  const info = await swInfo();
  record('P3 缓存清单双入口', !!info.cacheOk?.homeCached && !!info.cacheOk?.hanziCached && info.cacheOk.homeHasEntry && info.cacheOk.hanziHasBack,
    `生产缓存 ${info.cacheName} 共 ${info.cacheOk.count} 项，缓存正文核对：/ 含汉字勇者入口标记=${info.cacheOk.homeHasEntry}，/hanzi.html 含返回标记=${info.cacheOk.hanziHasBack}`,
    { checks: { sw: info } });
} catch (e) { record('P3 缓存清单双入口', false, `失败: ${e.message}`); }

// ===== P4 断网刷新离线可达（浏览器级离线仿真） =====
try {
  // 前置：回到首页且 SW 已接管（否则断网刷新无缓存可依）
  if (new URL((await homeState()).url).pathname !== '/') { await goto(ORIGIN); await sleep(1000); }
  const pre = await waitUntil(async () => { const i = await swInfo().catch(() => null); return i?.controlledViaController && i.cacheOk?.hanziCached ? i : null; }, 'SW 接管就绪', 30000);
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await sleep(300);
  await send('Page.reload', { ignoreCache: false });
  const offHome = await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '断网首页由缓存打开', 30000);
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.hanziAnchor?.visible ? s : null; }, '断网菜单');
  await shot('prod-05-offline-home');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const offHanzi = await waitUntil(async () => { const s = await hanziState(); return s.bootFailHidden && s.gradeCards === 6 ? s : null; }, '断网 hanzi 由缓存打开', 30000);
  await shot('prod-06-offline-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  const offBack = await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断网返回首页', 30000);
  await shot('prod-07-offline-back');
  record('P4 断网刷新离线可达', offHome.selectVisible && offHanzi.gradeCards === 6 && offBack.selectVisible
    && offHome.errors.length === 0 && offHanzi.errors.length === 0,
    `SW 受控（缓存 ${pre.cacheName}）后浏览器级断网仿真刷新：首页由缓存打开（提示「${(offHome.offlineNotice ?? '').slice(0, 40)}…」），菜单入口离线进入 hanzi（年级卡 ${offHanzi.gradeCards} 张），返回链接离线回首页，全程 JS 错误 0 个`,
    { checks: { offlineHome: offHome, offlineHanzi: offHanzi } });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
} catch (e) {
  try { await shot('prod-fail-p4'); } catch {}
  try { await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch {}
  record('P4 断网刷新离线可达', false, `失败: ${e.message}`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN, expectedVersion: EXPECT_VERSION,
  userAgent: await evaluate('navigator.userAgent', false).catch(() => null),
  viewport: await evaluate('({ w: window.innerWidth, h: window.innerHeight })', false).catch(() => null),
  scenarios, allPassed: scenarios.every(s => s.pass),
};
await writeFile(`${outDir}/production-browser-results.json`, JSON.stringify(summary, null, 2));
log('结果已写入', `${outDir}/production-browser-results.json`);
log(JSON.stringify(summary.scenarios.map(s => ({ name: s.name, pass: s.pass }))));
ws.close();
process.exit(summary.allPassed ? 0 : 1);
