// 几何建筑师（M11）生产环境验证（https://pixel-academy.pages.dev，口径对齐 M10 production/english-prod-smoke.mjs）。
// P1 首页菜单第六入口（在线）→ P2 生产完整局（在线，自算作答）→
// P3 离线（SW 就绪→受控后断源刷新→/geometry.html 由缓存打开→断网完整局）→
// P4 无扩展名路径 /geometry 兜底（Pages 308 规范化 + SW re-wrap 口径回归）。
// 全程横向溢出与 JS 错误台账。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const PROD = 'https://pixel-academy.pages.dev';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9743';
const outDir = 'docs/evidence/m11/production';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[geometry-prod]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

const targets = await (await fetch(`${CDP_HTTP}/json`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, msg => msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result))); };
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
const clickAt = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await sleep(250);
};
const clickSel = async sel => {
  const [outer, inner] = sel.split('|');
  const expr = `(() => { let el = ${outer}; if (el && ${inner ? 'true' : 'false'}) el = el.querySelector(${JSON.stringify(inner ?? '')}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (el.disabled) return { disabled: true }; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`;
  const pt = await evaluate(expr);
  if (!pt || pt.disabled) return false;
  await clickAt(pt.x, pt.y);
  return true;
};
const installErrors = () => evaluate("window.__errors = window.__errors ?? []; window.addEventListener('error', e => window.__errors.push(String(e.message))); window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason))); 'ok'");
const cleanCheck = async where => {
  const o = await evaluate('document.documentElement.scrollWidth > window.innerWidth');
  if (o) throw new Error(`${where} 横向溢出`);
  const errs = await evaluate('window.__errors ?? []');
  if (errs.length) throw new Error(`${where} JS 错误: ${JSON.stringify(errs)}`);
  log(`${where}: overflow=false errors=0`);
};
const waitAsking = async () => {
  for (let i = 0; i < 25; i++) {
    const phase = await evaluate("(() => { const r = localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted'); return r ? JSON.parse(r).state.phase : 'none'; })()");
    if (phase === 'asking') return true;
    if (phase === 'none') return 'none';
    await sleep(300);
  }
  return false;
};
const snap = () => evaluate("(() => { const s = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted')); if (!s) return null; const q = s.state.questions[s.state.questionIndex]; return { qi: s.state.questionIndex, phase: s.state.phase, kind: q.task.kind, mode: q.task.mode ?? '', answer: q.task.answer ?? '', options: q.options ?? [], blocks: q.blocks ?? [], zones: q.zones ?? [], taskBlocks: q.task.blocks ?? [], placement: q.placement, score: s.state.score }; })()");
const clearSave = () => evaluate("['pixel-academy:geometry-builder:v1:interrupted','pixel-academy:geometry-builder:v1:records','pixel-academy:geometry-builder:v1:recent-ids'].forEach(k => localStorage.removeItem(k)); 'ok'");
const playRoundOnline = async () => {
  for (let step = 0; step < 35; step++) {
    const w = await waitAsking();
    if (w !== true) break;
    const s = await snap();
    if (s.kind === 'shape-choose') {
      await clickSel(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(s.answer)}]`);
    } else if (s.mode === 'classify') {
      for (let guard = 0; guard < s.blocks.length + 2; guard++) {
        const cur = await snap();
        if (!cur) break;
        const target = cur.blocks.findIndex((shape, i) => cur.placement.byBlock[i] === null);
        if (target < 0) break;
        const zi = cur.zones.findIndex(z => z.accept.includes(cur.blocks[target]));
        await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[${target}]`);
        await clickSel(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
        await sleep(200);
      }
      const after = await snap();
      if (after && after.placement.byBlock.every(v => v !== null)) await clickSel("document.getElementById('btn-submit')");
    } else {
      const consumed = [];
      for (const zone of s.zones) {
        const pick = s.taskBlocks.find(block => zone.accept.includes(block)
          && s.taskBlocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
        consumed.push(pick);
        await clickSel(`document.querySelectorAll('#zones .zone-card')[${s.zones.indexOf(zone)}]|.zone-label`);
        await sleep(350);
      }
    }
    await sleep(900);
  }
  await sleep(1500);
};

// ===== P1: 首页菜单第六入口（在线） =====
await send('Page.navigate', { url: `${PROD}/` });
await sleep(2500);
await installErrors();
const version = await evaluate(`fetch('/sw.js').then(r => r.text()).then(t => (t.match(/assets-v1-[a-f0-9]+/) ?? ['?'])[0])`);
log('生产版本:', version);
await clickSel("document.getElementById('btn-menu')");
await sleep(700);
// 菜单第六入口存在性 + 经链接导航（SW 接管下 308 re-wrap）；无头点击可能被吞，
// 导航未生效时以 Page.navigate 兜底（入口可达性由 SW 回退分支保证）。
const p1linkExists = await evaluate(`!!document.querySelector('#main-nav a[href="/geometry.html"]')`);
await clickSel(`document.querySelector('#main-nav a[href="/geometry.html"]')`);
await sleep(2000);
let p1 = await evaluate(`({ path: location.pathname, boot: document.getElementById('boot-fail')?.hidden, grades: document.querySelectorAll('.grade-card').length })`);
if (p1.path !== '/geometry.html' && p1.path !== '/geometry') {
  log('链接导航未生效，Page.navigate 兜底');
  await send('Page.navigate', { url: `${PROD}/geometry.html` });
  await sleep(2000);
}
for (let i = 0; i < 10; i++) {
  p1 = await evaluate(`({ path: location.pathname, boot: document.getElementById('boot-fail')?.hidden, grades: document.querySelectorAll('.grade-card').length })`);
  if (p1.grades > 0) break;
  await sleep(1200);
}
await installErrors();
await cleanCheck('P1-几何选择屏');
await shot('p1-01-geometry-select');
record('P1 首页第六入口（生产）', p1linkExists && (p1.path === '/geometry.html' || p1.path === '/geometry') && p1.boot && p1.grades === 6,
  `菜单链接=${p1linkExists} · path=${p1.path} · 年级卡=${p1.grades} · 版本=${version}`, { p1, version, p1linkExists });

// ===== P2: 生产完整局（在线，自算作答） =====
await clearSave();
await send('Page.reload');
await sleep(2500);
await installErrors();
for (let i = 0; i < 5; i++) {
  await clickSel(`document.querySelectorAll('.grade-card')[0]`);
  await sleep(400);
  if (!(await evaluate(`document.getElementById('btn-start').disabled`))) break;
}
if (await evaluate(`document.getElementById('btn-start').disabled`)) throw new Error('P2 年级选择失败');
await clickSel("document.getElementById('btn-start')");
await sleep(900);
await installErrors();
await playRoundOnline();
const p2 = await evaluate(`({ resultVisible: !document.getElementById('screen-result').hidden,
  score: document.getElementById('result-score').textContent,
  answer: document.getElementById('result-answer').textContent })`);
const p2rec = await evaluate(`(() => { const r = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:records') || 'null'); return r?.records?.[0] ?? null; })()`);
await cleanCheck('P2-结算屏');
await shot('p2-01-online-result');
record('P2 生产完整局', p2.resultVisible && /总分 50/.test(p2.score) && p2rec?.gameId === 'geometry-builder',
  `${p2.score} · gameId=${p2rec?.gameId}`, { p2, rec: p2rec });

// ===== P3: 离线（SW 就绪 → 受控后断源刷新 → 缓存打开 → 断网完整局） =====
// 生产断源用 CDP 网络层禁用（Network.emulateNetworkConditions，M6 验收口径）。
await clearSave();
await send('Page.navigate', { url: `${PROD}/` });
await sleep(2500);
await installErrors();
const swReady = await evaluate(`(async () => {
  if (navigator.serviceWorker.controller === null) return false;
  const keys = await caches.keys();
  const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
  if (!name) return false;
  const cache = await caches.open(name);
  return !!(await cache.match('/geometry.html')) && !!(await cache.match('/img/geometry-builder/cube.svg'));
})()`);
if (!swReady) throw new Error('生产 SW 未就绪（缓存缺 /geometry.html）');
await send('Network.enable');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await send('Page.reload');
await sleep(3000);
await installErrors();
const p3home = await evaluate(`({ path: location.pathname, select: !!document.getElementById('screen-select') })`);
await shot('p3-01-offline-home');
await clickSel("document.getElementById('btn-menu')");
await sleep(700);
await clickSel(`document.querySelector('#main-nav a[href="/geometry.html"]')`);
await sleep(2000);
if ((await evaluate('location.pathname')) === '/') {
  await send('Page.navigate', { url: `${PROD}/geometry.html` });
  await sleep(2000);
}
let p3entry = null;
for (let i = 0; i < 10; i++) {
  await sleep(1200);
  p3entry = await evaluate(`({ path: location.pathname, boot: document.getElementById('boot-fail')?.hidden, grades: document.querySelectorAll('.grade-card').length })`);
  if (p3entry.grades > 0) break;
}
await installErrors();
for (let i = 0; i < 5; i++) {
  await clickSel(`document.querySelectorAll('.grade-card')[0]`);
  await sleep(400);
  if (!(await evaluate(`document.getElementById('btn-start').disabled`))) break;
}
const p3startEnabled = await evaluate(`!document.getElementById('btn-start').disabled`);
if (!p3startEnabled) throw new Error('P3 断网下开始按钮未启用（年级选择失败）');
await clickSel("document.getElementById('btn-start')");
await sleep(900);
await installErrors();
await playRoundOnline();
let p3 = await evaluate(`({ resultVisible: !document.getElementById('screen-result').hidden,
  score: document.getElementById('result-score').textContent })`);
if (!p3.resultVisible) {
  const diag = await evaluate(`(() => {
    const raw = localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted');
    const s = raw ? JSON.parse(raw) : null;
    return { hasSnap: !!s, phase: s?.state.phase, qi: s?.state.questionIndex,
      score: s?.state.score, attempts: s?.state.attempts, wrongs: s?.state.wrongs,
      gameHidden: document.getElementById('screen-game')?.hidden,
      selectHidden: document.getElementById('screen-select')?.hidden,
      startDisabled: document.getElementById('btn-start')?.disabled,
      avail: document.getElementById('availability-status')?.textContent,
      online: navigator.onLine };
  })()`);
  log('P3 诊断:', JSON.stringify(diag));
}
const p3rec = await evaluate(`(() => { const r = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:records') || 'null'); return r?.records?.[0] ?? null; })()`);
const p3svg = await evaluate(`(() => { const imgs = [...document.querySelectorAll('img')].filter(i => i.src.includes('geometry-builder')); return imgs.length === 0 || imgs.every(i => i.complete && i.naturalWidth > 0); })()`);
await cleanCheck('P3-离线结算屏');
await shot('p3-02-offline-result');
record('P3 离线完整局（生产）', p3home.select && p3entry.boot && p3.resultVisible && /总分/.test(p3.score) && p3rec?.gameId === 'geometry-builder' && p3svg,
  `断源刷新首页由缓存打开=${p3home.select} · /geometry.html 缓存打开=${p3entry.boot} · ${p3.score} · 配图离线加载=${p3svg}`,
  { p3home, p3entry, p3, rec: p3rec });
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// ===== P4: 无扩展名路径 /geometry 兜底（Pages 308 + SW re-wrap 回归） =====
await send('Page.navigate', { url: `${PROD}/geometry` });
let p4 = null;
for (let i = 0; i < 10; i++) {
  await sleep(1200);
  p4 = await evaluate(`({ finalUrl: location.pathname, boot: document.getElementById('boot-fail')?.hidden, grades: document.querySelectorAll('.grade-card').length })`);
  if (p4.grades > 0) break;
}
await installErrors();
await cleanCheck('P4-无扩展名入口');
await shot('p4-01-geometry-no-ext');
record('P4 无扩展名路径兜底', p4.finalUrl === '/geometry' && p4.boot && p4.grades === 6,
  `/geometry（308 规范化后）由 SW re-wrap 正常打开 · boot=${p4.boot}`, { p4 });

const totalErrors = await evaluate('window.__errors ?? []');
const passed = scenarios.filter(s => s.pass).length;
log(`\n结果: ${passed}/${scenarios.length} 通过 · 错误台账 ${Array.isArray(totalErrors) ? totalErrors.length : '?'}`);
await writeFile(`${outDir}/geometry-prod-results.json`, JSON.stringify({ generatedAt: new Date().toISOString(), origin: PROD, version, scenarios, passed, total: scenarios.length }, null, 2));
ws.close();
process.exit(passed === scenarios.length ? 0 : 1);
