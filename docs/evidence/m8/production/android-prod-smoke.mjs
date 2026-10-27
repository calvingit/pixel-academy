// Android 模拟器生产冒烟（M8 首页导航 + hanzi 入口，对齐 M7 R3/R4 生产口径）。
// 前置：emulator-5556 在线；adb forward tcp:9333 localabstract:chrome_devtools_remote；
// Chrome 已启动。生产 https://pixel-academy.pages.dev（HTTPS 安全上下文，SW 可注册）。
// 场景：P1 生产首页 + SW 版本 → P2 菜单入口进 hanzi + 返回 → P3 飞行模式刷新缓存可达。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';

const execFileP = promisify(execFile);
const ADB_SERIAL = 'emulator-5556';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9333';
const ORIGIN = 'https://pixel-academy.pages.dev';
const EXPECT_VERSION = 'assets-v1-c443b797b0e8';
const outDir = 'docs/evidence/m8/production';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[android-prod]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const adbShell = async args => { try { await execFileP('adb', ['-s', ADB_SERIAL, 'shell', ...args]); } catch { /* 忽略 */ } };

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

let ws, seq = 0, sessionId = null; const pending = new Map();
function send(method, params = {}, sid = sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP 超时: ${method}`)); }, 30000);
    pending.set(id, msg => { clearTimeout(timer); msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result); });
  });
}
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
const tapCenter = async selector => {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: (r.x + r.width / 2) * window.devicePixelRatio, y: (r.y + r.height / 2) * window.devicePixelRatio,
      css: { x: r.x + r.width / 2, y: r.y + r.height / 2 } }; })()`, false);
  if (!rect) throw new Error(`元素不存在: ${selector}`);
  // dispatchTouchEvent 用视口 CSS 坐标（与 M7 android-round.mjs 一致，不再乘 dpr）
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(rect.css.x), y: Math.round(rect.css.y) }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const waitUntil = async (fn, desc, timeoutMs = 30000) => {
  const start = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(500);
  }
};
const connect = async () => {
  // per-page WebSocket 在本机 Chrome 113 上握手成功但命令无响应；browser 级
  // endpoint + Target.attachToTarget(flatten) 实测可用，统一走该路径。
  ws = new WebSocket('ws://127.0.0.1:9333/devtools/browser');
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const info = await send('Target.getTargets', {}, null);
  let mine = info.targetInfos.find(t => t.type === 'page' && t.url.startsWith(ORIGIN));
  if (!mine) mine = (await send('Target.createTarget', { url: `${ORIGIN}/` }, null));
  const att = await send('Target.attachToTarget', { targetId: mine.targetId, flatten: true }, null);
  sessionId = att.sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.bringToFront').catch(() => {});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
};
const homeState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  return {
    url: location.href, h1: document.querySelector('main h1, main .app-title')?.textContent ?? null,
    selectVisible: !document.getElementById('screen-select')?.hidden,
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    hanziAnchor: !!document.querySelector('#main-nav a[href="/hanzi.html"]'),
    offlineNotice: document.getElementById('offline-notice')?.hidden ? null : t('offline-notice'),
    controlled: (navigator.serviceWorker && navigator.serviceWorker.controller) ? true : false,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);
const hanziState = () => evaluate(`(() => ({
  url: location.href,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  backLink: !!document.querySelector('.profile-bar a.btn-ghost'),
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);
const waitHanzi = () => waitUntil(async () => {
  const s = await hanziState();
  return (s.url.includes('/hanzi') && s.bootFailHidden && s.gradeCards === 6) ? s : null;
}, 'hanzi 页加载', 45000);

try {
  await adbShell(['input', 'keyevent', 'KEYCODE_WAKEUP']);
  await connect();
  await send('Page.bringToFront').catch(() => {});
  // ===== P1 生产首页 + SW 版本 =====
  await send('Page.navigate', { url: `${ORIGIN}/` });
  await sleep(2500);
  const s1 = await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, '生产首页加载', 45000);
  const sw = await waitUntil(async () => evaluate(`(async () => {
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    if (!(await cache.match('/hanzi.html'))) return null;
    return { name, count: (await cache.keys()).length, controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller) };
  })()`), 'SW 预缓存就绪', 60000);
  await shot('android-prod-01-home');
  record('P1 生产首页 + SW 版本', sw.name === `pixel-academy:number-puzzle:${EXPECT_VERSION}` && sw.controlled && !s1.overflow && s1.errors.length === 0,
    `生产首页加载（${s1.h1?.trim()}）；缓存 ${sw.name}（${sw.count} 项）与预期 ${EXPECT_VERSION} 一致，SW 受控；无横向溢出，JS 错误 ${s1.errors.length} 个`,
    { checks: { home: s1, sw } });

  // ===== P2 菜单入口进 hanzi + 返回 =====
  await tapCenter('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.hanziAnchor ? s : null; }, '菜单弹层');
  await shot('android-prod-02-menu-entry');
  await tapCenter('#main-nav a[href="/hanzi.html"]');
  const hs = await waitHanzi();
  await shot('android-prod-03-hanzi');
  await tapCenter('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); const path = new URL(s.url).pathname; return path === '/' || path === '' ? s : null; }, '返回生产首页', 30000);
  await shot('android-prod-04-back-home');
  record('P2 菜单入口进 hanzi + 返回', hs.gradeCards === 6 && hs.errors.length === 0 && !hs.overflow,
    `真实触摸菜单入口进入 ${hs.url}（年级卡 ${hs.gradeCards} 张、boot-fail 隐藏），返回链接回首页正常；无横向溢出，JS 错误 ${hs.errors.length} 个`,
    { checks: { hanzi: hs } });

  // ===== P3 飞行模式离线（对齐 M7 R4：真机断网口径） =====
  await adbShell(['cmd', 'connectivity', 'airplane-mode', 'enable']);
  await sleep(1500);
  try {
    await send('Page.reload', { ignoreCache: false });
    const offHome = await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, '飞行模式首页由缓存打开', 45000);
    await tapCenter('#btn-menu');
    await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.hanziAnchor ? s : null; }, '飞行模式菜单');
    await shot('android-prod-05-offline-home');
    await tapCenter('#main-nav a[href="/hanzi.html"]');
    const offHanzi = await waitHanzi();
    await shot('android-prod-06-offline-hanzi');
    record('P3 飞行模式离线可达', offHanzi.gradeCards === 6 && offHanzi.errors.length === 0 && !offHanzi.overflow,
      `飞行模式后刷新：首页由缓存打开（提示「${(offHome.offlineNotice ?? '').slice(0, 36)}…」），菜单入口离线进入 hanzi（年级卡 ${offHanzi.gradeCards} 张）；无横向溢出，JS 错误 ${offHanzi.errors.length} 个`,
      { checks: { offlineHome: offHome, offlineHanzi: offHanzi } });
  } finally {
    await adbShell(['cmd', 'connectivity', 'airplane-mode', 'disable']);
    await sleep(800);
  }
} catch (e) {
  try { await shot('android-prod-fail'); } catch {}
  record('执行中断', false, `失败: ${e.message}`);
  try { await adbShell(['cmd', 'connectivity', 'airplane-mode', 'disable']); } catch {}
}

const summary = {
  generatedAt: new Date().toISOString(), origin: ORIGIN, expectedVersion: EXPECT_VERSION,
  scenarios, allPassed: scenarios.every(s => s.pass),
};
await writeFile(`${outDir}/android-prod-results.json`, JSON.stringify(summary, null, 2));
log('结果已写入', `${outDir}/android-prod-results.json`);
log(JSON.stringify(summary.scenarios.map(s => ({ name: s.name, pass: s.pass }))));
process.exit(summary.allPassed ? 0 : 1);
