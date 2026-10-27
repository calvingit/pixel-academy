// M12 生产环境验证（Cloudflare Pages https://pixel-academy.pages.dev，桌面无头 Chrome 经 CDP）。
// 骨架沿用 docs/evidence/m8/production/production-browser.mjs；场景扩为三入口：
// P1 生产首页与 SW 版本 → P2 汉字勇者入口往返 → P2b 地下城入口往返
// → P3 缓存清单三入口 → P4 断网刷新三页缓存可达。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'https://pixel-academy.pages.dev/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9741';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m12/production';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[prod-m12]', ...a);
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
const EXPECT_VERSION = process.env.EXPECT_VERSION ?? 'assets-v1-ed99dbc5fe1a';

const homeState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('main h1, main .app-title')?.textContent ?? null,
    selectVisible: !document.getElementById('screen-select')?.hidden,
    errorVisible: !document.getElementById('screen-error')?.hidden,
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    hanziAnchor: !!document.querySelector('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: !!document.querySelector('#main-nav a[href="/dungeon.html"]'),
    offlineNotice: document.getElementById('offline-notice')?.hidden ? null : t('offline-notice'),
    errors: window.__errors ?? [],
  };
})()`, false);
const subState = sel => evaluate(`(() => ({
  url: location.href,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null; })(),
  errors: window.__errors ?? [],
})())`, false).then(s => ({ ...s, _sel: sel }));
const waitSub = (marker, desc) => waitUntil(async () => {
  const s = await evaluate(`(() => ({
    url: location.href,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    gradeCards: document.querySelectorAll('.grade-card').length,
    backLink: document.querySelector('.profile-bar a.btn-ghost')?.getAttribute('href') ?? null,
    errors: window.__errors ?? [],
  }))()`, false);
  return s.url.includes(marker) && s.bootFailHidden && s.gradeCards === 6 ? s : null;
}, desc, 45000);

const swInfo = () => evaluate(`(async () => {
  const reg = await navigator.serviceWorker.ready;
  const keys = await caches.keys();
  const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:')) ?? null;
  let cacheOk = null;
  if (name) {
    const cache = await caches.open(name);
    const home = await cache.match('/');
    const hanzi = await cache.match('/hanzi.html');
    const dungeon = await cache.match('/dungeon.html');
    // Response.body 只能读一次：先取全文再分别 includes
    const homeText = home ? await home.text() : '';
    const hanziText = hanzi ? await hanzi.text() : '';
    const dungeonText = dungeon ? await dungeon.text() : '';
    cacheOk = {
      homeCached: !!home, hanziCached: !!hanzi, dungeonCached: !!dungeon,
      homeHasHanzi: homeText.includes('/hanzi.html'),
      homeHasDungeon: homeText.includes('/dungeon.html'),
      hanziHasBack: hanziText.includes('返回数字消除'),
      dungeonHasBack: dungeonText.includes('返回数字消除'),
      count: (await cache.keys()).length,
    };
  }
  return { scriptURL: reg.active?.scriptURL ?? null, cacheName: name, cacheOk,
    controlledViaController: navigator.serviceWorker.controller !== null };
})()`);

// ===== P1 生产首页与 SW 版本 =====
try {
  await goto(ORIGIN);
  const s1 = await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '生产首页加载', 45000);
  let info = null;
  let reloaded = false;
  const info1 = await waitUntil(async () => {
    info = await swInfo().catch(() => null);
    if (!info || !info.cacheOk?.dungeonCached) return null;
    if (!info.controlledViaController) {
      if (!reloaded) { reloaded = true; await send('Page.reload', { ignoreCache: false }); await sleep(1500); }
      return null;
    }
    return info;
  }, 'SW 接管且三入口缓存就绪', 60000);
  const s1b = await homeState();
  await shot('prod-01-home');
  const versionOk = info1.cacheName === `pixel-academy:number-puzzle:${EXPECT_VERSION}`
    && (s1b.offlineNotice ?? '').includes(EXPECT_VERSION);
  record('P1 生产首页与 SW 版本', versionOk && s1b.hanziAnchor && s1b.dungeonAnchor && s1b.errors.length === 0,
    `生产 ${s1.url} 正常加载（h1=${s1.h1?.trim()}${reloaded ? '；SW 激活后自动刷新一次完成接管' : ''}）；SW 受控，缓存 ${info1.cacheName} 与预期版本 ${EXPECT_VERSION} 一致（${info1.cacheOk.count} 项），页面提示「${s1b.offlineNotice}」；菜单含汉字勇者与算术地下城两个入口标记`,
    { checks: { home: s1, homeAfterReady: s1b, sw: info1 } });
} catch (e) { record('P1 生产首页与 SW 版本', false, `失败: ${e.message}`); }

// ===== P2 汉字勇者入口往返 =====
try {
  if (new URL((await homeState()).url).pathname !== '/') { await goto(ORIGIN); await sleep(1000); }
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.hanziAnchor && s.dungeonAnchor ? s : null; }, '菜单弹层双入口');
  await shot('prod-02-menu-entries');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const hs = await waitSub('hanzi', '生产 hanzi 页加载');
  await shot('prod-03-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  const back = await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '返回生产首页', 30000);
  record('P2 汉字勇者入口往返', hs.gradeCards === 6 && back.selectVisible && hs.errors.length === 0,
    `菜单入口点击进入 ${hs.url}（年级卡 ${hs.gradeCards} 张），「${hs.backLink}」返回生产首页正常；JS 错误 ${hs.errors.length} 个`,
    { checks: { hanzi: hs } });
} catch (e) {
  try { await shot('prod-fail-p2'); } catch {}
  record('P2 汉字勇者入口往返', false, `失败: ${e.message}`);
}

// ===== P2b 地下城入口往返 =====
try {
  if (new URL((await homeState()).url).pathname !== '/') { await goto(ORIGIN); await sleep(1000); }
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.dungeonAnchor ? s : null; }, '菜单弹层');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const ds = await waitSub('dungeon', '生产地下城页加载');
  await shot('prod-04-dungeon');
  await trustedClick('.profile-bar a.btn-ghost');
  const back = await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '返回生产首页', 30000);
  await shot('prod-05-back-home');
  record('P2b 地下城入口往返', ds.gradeCards === 6 && back.selectVisible && ds.errors.length === 0,
    `菜单入口点击进入 ${ds.url}（年级卡 ${ds.gradeCards} 张、boot-fail 隐藏），「${ds.backLink}」返回生产首页正常；JS 错误 ${ds.errors.length} 个`,
    { checks: { dungeon: ds } });
} catch (e) {
  try { await shot('prod-fail-p2b'); } catch {}
  record('P2b 地下城入口往返', false, `失败: ${e.message}`);
}

// ===== P3 缓存清单三入口 =====
try {
  const info = await swInfo();
  record('P3 缓存清单三入口', !!info.cacheOk?.homeCached && info.cacheOk.hanziCached && info.cacheOk.dungeonCached
    && info.cacheOk.homeHasHanzi && info.cacheOk.homeHasDungeon && info.cacheOk.hanziHasBack && info.cacheOk.dungeonHasBack,
    `生产缓存 ${info.cacheName} 共 ${info.cacheOk.count} 项：缓存正文核对 / 含两游戏入口标记=${info.cacheOk.homeHasHanzi && info.cacheOk.homeHasDungeon}，/hanzi.html 含返回标记=${info.cacheOk.hanziHasBack}，/dungeon.html 含返回标记=${info.cacheOk.dungeonHasBack}`,
    { checks: { sw: info } });
} catch (e) { record('P3 缓存清单三入口', false, `失败: ${e.message}`); }

// ===== P4 断网刷新三页缓存可达 =====
try {
  if (new URL((await homeState()).url).pathname !== '/') { await goto(ORIGIN); await sleep(1000); }
  const pre = await waitUntil(async () => { const i = await swInfo().catch(() => null); return i?.controlledViaController && i.cacheOk?.dungeonCached ? i : null; }, 'SW 接管就绪', 30000);
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await sleep(300);
  await send('Page.reload', { ignoreCache: false });
  const offHome = await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '断网首页由缓存打开', 30000);
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.dungeonAnchor ? s : null; }, '断网菜单');
  await shot('prod-06-offline-home');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const offDungeon = await waitSub('dungeon', '断网地下城由缓存打开');
  await shot('prod-07-offline-dungeon');
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断网返回首页', 30000);
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.hanziAnchor ? s : null; }, '断网菜单再开');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const offHanzi = await waitSub('hanzi', '断网 hanzi 由缓存打开');
  await shot('prod-08-offline-hanzi');
  record('P4 断网刷新三页缓存可达', offDungeon.gradeCards === 6 && offHanzi.gradeCards === 6
    && offHome.errors.length === 0 && offDungeon.errors.length === 0 && offHanzi.errors.length === 0,
    `SW 受控（缓存 ${pre.cacheName}）后浏览器级断网仿真刷新：首页由缓存打开（提示「${(offHome.offlineNotice ?? '').slice(0, 36)}…」），菜单入口离线进入地下城（年级卡 ${offDungeon.gradeCards} 张）与 hanzi（年级卡 ${offHanzi.gradeCards} 张），返回链接离线可达，全程 JS 错误 0 个`,
    { checks: { offlineHome: offHome, offlineDungeon: offDungeon, offlineHanzi: offHanzi } });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
} catch (e) {
  try { await shot('prod-fail-p4'); } catch {}
  try { await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch {}
  record('P4 断网刷新三页缓存可达', false, `失败: ${e.message}`);
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
