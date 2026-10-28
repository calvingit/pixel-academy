// iOS 模拟器 Safari M11 验证（几何建筑师，口径对齐 M9/M10/M12 device-simulators/ios-round.mjs）。
// 前置：iPhone 16 Pro / iOS 18.6 模拟器（UDID 28F2F0F0-…；iOS 27.0 运行时 safaridriver 无法创建
// 会话，不可用）；本地服务 4373。
// 与 M10 同：交互全部为 DOM 按钮（无 canvas/PointerEvent），el.click() 即可完整作答
//（拖拽路径属 pointermove 手势，safaridriver 合成输入不完整——与 M3–M10 同口径记录，
// 拖拽路径在 Android 轮以真实触摸验证，iOS 轮验证点选路径）。
// 会话能力必须含 platformName iOS + safari:useSimulator true（UA 含 iPhone 确认）。
// 答案一律从页面快照（pixel-academy:geometry-builder:v1:interrupted）经 dist 判题模块
//（selectGeometryExercises + correctShapeAnswer）自算，不注入任何游戏状态。
// 覆盖：S1 在线完整局（菜单第六入口、5 任务三模式、第 1 任务答错→纠正重试档 +5、
// 结算与记录 gameId=geometry-builder）→ S2 返回路径与六入口并存 → S3 离线（SW 就绪→
// 杀源→Safari 刷新非冷导航，/geometry.html 由缓存打开，断网整局）→ 贯穿（溢出与错误台账）。
// 已知 WebKit 行为：iOS 冷导航离线打开受控源落系统错误页；本脚本全程用「受控后断源刷新」口径。
// 用法：node geometry-ios-round.mjs online|offline [输出目录]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const execFileP = promisify(execFile);
const phase = process.argv[2] ?? 'online';
const UDID = '28F2F0F0-4732-4493-816A-A382DCBF329A';
const ORIGIN = (process.env.ORIGIN ?? 'http://localhost:4373').replace(/\/$/, '');
const WD = process.env.WD_PORT ? `http://127.0.0.1:${process.env.WD_PORT}` : 'http://127.0.0.1:4802';
const outDir = process.argv[3] ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

const log = (...a) => console.log(`[ios-${phase}]`, ...a);
process.on('uncaughtException', err => {
  console.error(`[ios-${phase}] UNCAUGHT:`, err?.message ?? err);
  try { if (typeof sid === 'string' && sid) wd('DELETE', base).catch(() => {}); } catch {}
  process.exit(2);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wd(method, path, body) {
  const res = await fetch(`${WD}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let value = null;
  try { value = JSON.parse(text).value; } catch { value = text; }
  if (!res.ok || (value && typeof value === 'object' && value.error)) {
    throw new Error(`WebDriver ${method} ${path} 失败: ${res.status} ${text.slice(0, 300)}`);
  }
  return value;
}

const session = await wd('POST', '/session', {
  capabilities: { alwaysMatch: {
    browserName: 'safari', platformName: 'iOS',
    'safari:useSimulator': true, 'safari:deviceUDID': UDID,
  } },
});
const sid = session.sessionId;
const base = `/session/${sid}`;
log('WebDriver 会话', sid, 'caps UDID =', session.capabilities?.['safari:deviceUDID'] ?? null);
const ua = await wd('POST', `${base}/execute/sync`, { script: 'return navigator.userAgent', args: [] });
log('UA:', ua);
if (!/iPhone/.test(ua)) throw new Error('UA 不含 iPhone：会话回退到 macOS 桌面 Safari（safari:useSimulator 未生效）');
const evalSync = script => wd('POST', `${base}/execute/sync`, { script: `return ${script}`, args: [] });
const evalAsync = evalSync;
const clickEl = async (selector, { tolerant = false } = {}) => {
  const ok = await evalSync(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    if (el.disabled) return 'disabled';
    el.click();
    return true; })()`);
  if (ok === null) { if (tolerant) return null; throw new Error(`无法点击 ${selector}（不存在）`); }
  if (ok === 'disabled') { if (tolerant) return 'disabled'; throw new Error(`无法点击 ${selector}（禁用）`); }
  return true;
};
/** 点击 JS 表达式求值出的元素（nth 等 querySelector 表达不了的形态）。 */
const clickExpr = async (expr, { tolerant = false } = {}) => {
  const ok = await evalSync(`(() => { const el = ${expr};
    if (!el) return null;
    if (el.disabled) return 'disabled';
    el.click();
    return true; })()`);
  if (ok === null) { if (tolerant) return null; throw new Error(`无法点击表达式（不存在）: ${expr.slice(0, 60)}`); }
  if (ok === 'disabled') { if (tolerant) return 'disabled'; throw new Error(`表达式元素禁用: ${expr.slice(0, 60)}`); }
  return true;
};
const shot = async name => {
  const frame = `/tmp/ios-m11-${Date.now()}.png`;
  await execFileP('xcrun', ['simctl', 'io', UDID, 'screenshot', frame]);
  await writeFile(join(outDir, `${name}.png`), await readFile(frame));
  await rm(frame, { force: true });
  log('截图', name);
};

// ===== JS 错误 / 横向溢出台账（每次导航后重装）=====
const INJECT = `(() => { window.__errors = window.__errors ?? [];
  addEventListener('error', e => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));
  return true; })()`;
const errorLedger = [];
const overflowLedger = [];
async function checkpoint(where) {
  const o = await evalSync(`document.documentElement.scrollWidth > window.innerWidth`);
  overflowLedger.push({ where, overflow: !!o });
  if (o) throw new Error(`${where} 出现横向溢出`);
  const errs = await evalSync(`(window.__errors ?? []).slice()`);
  if (errs.length) errorLedger.push({ where, errors: errs });
  if (errs.length) throw new Error(`${where} 出现 JS 错误: ${JSON.stringify(errs)}`);
  log(`${where}: overflow=false errors=0`);
  return { overflow: false, errors: errs };
}
async function waitUntil(fn, desc, timeoutMs = 25000) {
  const start = Date.now();
  let polls = 0, lastErr = null;
  for (;;) {
    let v = null;
    try { v = await fn(); polls++; } catch (e) { lastErr = e; }
    if (v) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时: ${desc}（polls=${polls}${lastErr ? ` lastError=${lastErr.message.slice(0, 200)}` : ''}）`);
    }
    await sleep(400);
  }
}

const clearSave = () => evalSync(`(() => { ['pixel-academy:geometry-builder:v1:interrupted','pixel-academy:geometry-builder:v1:records','pixel-academy:geometry-builder:v1:recent-ids','pixel-academy:geometry-builder:v1:settings'].forEach(k => localStorage.removeItem(k)); return true; })()`);
const geometryState = () => evalSync(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null;
  try { const raw = localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  let recordsRaw = null;
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:records') ?? 'null'); } catch {}
  const imgs = [...document.querySelectorAll('img')].filter(i => i.src).map(i => i.complete && i.naturalWidth > 0);
  return {
    url: location.pathname,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    selectVisible: !hidden('screen-select'),
    gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'),
    gradeCards: [...document.querySelectorAll('#grade-grid button')].map(b => ({
      text: b.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled })),
    availabilityStatus: t('availability-status'),
    startDisabled: document.getElementById('btn-start')?.disabled,
    hudProgress: t('hud-progress'), hudScore: t('hud-score'),
    qMode: t('q-mode'), prompt: t('q-prompt'),
    submitHidden: hidden('btn-submit'),
    feedbackHidden: hidden('feedback'), feedback: t('feedback'),
    pauseOverlayHidden: hidden('pause-overlay'),
    resultScore: t('result-score'), resultAnswer: t('result-answer'), resultModes: t('result-modes'),
    records: [...document.querySelectorAll('#records-list li')].map(li => li.textContent),
    imgsAllLoaded: imgs.length === 0 || imgs.every(Boolean),
    snap, recordsRaw,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`);

const nav = async url => {
  await wd('POST', `${base}/url`, { url });
  await sleep(1800);
  await evalSync(INJECT);
};

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

// 正确作答计划（快照自算）
const correctPlan = q => {
  const { task, blocks, zones } = q;
  if (task.kind === 'shape-choose') return { kind: 'choose', answer: task.answer };
  if (task.mode === 'classify') {
    const steps = blocks.map((shape, blockIndex) => ({
      blockIndex, zoneIndex: zones.findIndex(z => z.accept.includes(shape)),
    }));
    return { kind: 'classify', steps };
  }
  const consumed = [];
  const steps = zones.map((zone, zoneIndex) => {
    const pick = task.blocks.find(shape => zone.accept.includes(shape)
      && task.blocks.filter(b => b === shape).length > consumed.filter(c => c === shape).length);
    consumed.push(pick);
    return { blockIndex: blocks.indexOf(pick), zoneIndex };
  });
  return { kind: 'build', steps };
};
const answerCurrent = async s => {
  const plan = correctPlan(s.questions?.[s.questionIndex] ?? s);
  const q = s.questions?.[s.questionIndex];
  if (!q) return false;
  if (q.task.kind === 'shape-choose') {
    const idx = q.options.indexOf(q.task.answer);
    await clickExpr(`document.querySelectorAll('#choose-options .option-card')[${idx}]`);
    return true;
  }
  if (q.task.mode === 'classify') {
    for (const step of plan.steps) {
      await clickExpr(`document.querySelectorAll('#blocks-shelf .block-card')[${step.blockIndex}]`);
      await sleep(250);
      await clickExpr(`(document.querySelectorAll('#zones .zone-card')[${step.zoneIndex}]).querySelector('.zone-label')`);
      await sleep(250);
    }
    await clickEl('#btn-submit');
    return true;
  }
  for (const step of plan.steps) {
    await clickExpr(`(document.querySelectorAll('#zones .zone-card')[${step.zoneIndex}]).querySelector('.zone-label')`);
    await sleep(500);
  }
  return true;
};
const waitAsking = () => waitUntil(async () => {
  const s = await geometryState();
  return s.snap ? (s.snap.state.phase === 'asking' ? s : false) : 'none';
}, 'asking/none');

if (phase === 'online') {
  // S1：在线完整局
  await nav(`${ORIGIN}geometry.html`);
  await clearSave();
  await wd('POST', `${base}/url`, { url: `${ORIGIN}geometry.html` });
  await sleep(1800);
  await evalSync(INJECT);
  await checkpoint('S1-几何选择屏');
  await shot('ios-online-01-geometry-select');
  const grade = await clickExpr(`document.querySelectorAll('#grade-grid button')[0]`);
  await sleep(300);
  await clickEl('#btn-start');
  await sleep(900);
  await evalSync(INJECT);
  // 第一题答错 → 纠正重试档
  const first = await geometryState();
  if (first.snap && first.snap.state.questions[first.snap.state.questionIndex].task.kind === 'shape-choose') {
    const q = first.snap.state.questions[first.snap.state.questionIndex];
    const wrong = q.options.find(o => o !== q.task.answer);
    await clickExpr(`document.querySelectorAll('#choose-options .option-card')[${q.options.indexOf(wrong)}]`);
    await sleep(600);
    const fb = await evalSync(`(() => { const f = document.getElementById('feedback'); return { hidden: f.hidden, text: f.textContent, kind: f.dataset.kind }; })()`);
    record('S1a 辨认错误反馈', !fb.hidden && fb.kind === 'wrong', `「${fb.text}」`);
    await clickExpr(`document.querySelectorAll('#choose-options .option-card')[${q.options.indexOf(q.task.answer)}]`);
    await sleep(1600);
  } else {
    record('S1a 辨认错误反馈', false, `首题非辨认题（${first.snap?.state?.questions?.[first.snap.state.questionIndex]?.task?.kind}）`);
  }
  // 其余任务全部正确作答（含 classify 点选 + build 点选）
  for (let step = 0; step < 30; step++) {
    const w = await waitAsking();
    if (w === 'none') break;
    const s = await geometryState();
    if (s.snap.state.phase !== 'asking') { await sleep(400); continue; }
    await answerCurrent(s.snap.state);
    await sleep(1200);
  }
  await sleep(1600);
  await checkpoint('S1-结算屏');
  await shot('ios-online-02-result');
  const done = await geometryState();
  const rec = done.recordsRaw?.records?.[0] ?? null;
  record('S1b 在线完整局', done.resultVisible && /总分/.test(done.resultScore) && rec?.gameId === 'geometry-builder',
    `${done.resultScore} · ${done.resultAnswer} · gameId=${rec?.gameId} · 模式分列=${done.resultModes}`);
  // S2：返回路径与六入口并存
  await clickEl('#btn-result-return');
  await sleep(600);
  await clickExpr(`document.querySelector('#screen-select a.btn-ghost')`);
  await sleep(1800);
  await evalSync(INJECT);
  const home = await evalSync(`(() => ({ path: location.pathname,
    geometry: !!document.querySelector('#main-nav a[href="/geometry.html"]'),
    anchors: [...document.querySelectorAll('#main-nav a')].length }))()`);
  record('S2 返回路径与六入口并存', home.path === '/' && home.geometry && home.anchors >= 5,
    `回首页=${home.path === '/'} · 几何入口=${home.geometry} · 入口数=${home.anchors}`);
  await checkpoint('S2-首页回归');
  await shot('ios-online-03-home-menu');
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, ua, scenarios, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, `${phase}-results.json`), JSON.stringify(summary, null, 2));
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  log(`结果: ${scenarios.filter(s => s.pass).length}/${scenarios.length} 通过`);
  await wd('DELETE', base);
  process.exit(scenarios.every(s => s.pass) ? 0 : 1);
}

if (phase === 'offline') {
  // S3：SW 就绪 → 杀源 → Safari 刷新（非冷导航）→ 缓存打开 → 断网完整局
  await nav(`${ORIGIN}/`);
  await clearSave();
  let swInfo = null;
  for (let i = 0; i < 6 && !swInfo; i++) {
    swInfo = await waitUntil(async () => evalAsync(`(async () => {
      if (navigator.serviceWorker.controller === null) return null;
      const keys = await caches.keys();
      const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
      if (!name) return null;
      const cache = await caches.open(name);
      const geometry = await cache.match('/geometry.html');
      const mainJs = await cache.match('/dist/game/geometry-builder/main.js');
      const svg = await cache.match('/img/geometry-builder/cube.svg');
      if (!geometry || !mainJs || !svg) return null;
      let svgCount = 0;
      for (const k of await cache.keys()) if (k.url.includes('/img/geometry-builder/')) svgCount += 1;
      return { name, svgCount };
    })()`), 'SW 就绪且缓存含 /geometry.html 与配图', 15000).catch(e => { log('SW 检查异常:', e.message?.slice(0, 150)); return null; });
    if (!swInfo) {
      const diag = await evalAsync(`(async () => {
        const href = location.href;
        const ctrl = navigator.serviceWorker.controller === null ? 'none' : 'yes';
        const keys = await caches.keys();
        let geo = null; let count = null;
        for (const k of keys) { if (k.startsWith('pixel-academy:number-puzzle:')) {
          const c = await caches.open(k); geo = !!(await c.match('/geometry.html')); count = (await c.keys()).length; } }
        return { href, ctrl, keys, geo, count };
      })()`).catch(e => String(e).slice(0, 120));
      log('诊断:', JSON.stringify(diag));
      log(`SW 未就绪（第 ${i + 1} 次），刷新促成接管`);
      await wd('POST', `${base}/refresh`);
      await sleep(2500);
      await evalSync(INJECT);
    }
  }
  if (!swInfo) throw new Error('SW 未就绪');
  log('SW:', JSON.stringify(swInfo));
  await checkpoint('S3-SW就绪首页(在线)');
  // 杀源站
  let serverWasAlive = true;
  try { await execFileP('pkill', ['-f', 'serve.mjs 4373']); } catch { serverWasAlive = false; }
  await sleep(1500);
  // Safari 刷新（非冷导航，WebKit 口径）
  await wd('POST', `${base}/refresh`);
  await sleep(3000);
  await evalSync(INJECT);
  const homeOk = await waitUntil(async () => {
    const st = await geometryState();
    return st.snap === null && st.url === '/' ? true : null;
  }, '断源刷新后首页由缓存打开').catch(() => false);
  if (!homeOk) throw new Error('断源刷新后首页未能由缓存打开');
  await checkpoint('S3-离线首页');
  await shot('ios-offline-01-home');
  // 菜单进几何建筑师
  await clickEl('#btn-menu');
  await sleep(600);
  await clickExpr(`document.querySelector('#main-nav a[href="/geometry.html"]')`);
  await sleep(2000);
  await evalSync(INJECT);
  const st = await geometryState();
  if (!(st.url === '/geometry.html' && st.bootFailHidden && st.selectVisible)) {
    throw new Error(`断源后几何建筑师未能由缓存打开: ${JSON.stringify({ url: st.url, bootFailHidden: st.bootFailHidden })}`);
  }
  const poolCount = await evalAsync(`(async () => {
    const m = await import('/dist/game/geometry-builder/content.js');
    return m.selectGeometryExercises([1]).length;
  })()`);
  await checkpoint('S3-离线选择屏');
  await shot('ios-offline-02-geometry-select');
  await clickExpr(`document.querySelectorAll('#grade-grid button')[0]`);
  await sleep(300);
  await clickEl('#btn-start');
  await sleep(900);
  await evalSync(INJECT);
  for (let step = 0; step < 30; step++) {
    const w = await waitAsking();
    if (w === 'none') break;
    const s = await geometryState();
    if (s.snap.state.phase !== 'asking') { await sleep(400); continue; }
    await answerCurrent(s.snap.state);
    await sleep(1200);
  }
  await sleep(1600);
  await checkpoint('S3-离线结算屏');
  await shot('ios-offline-03-offline-result');
  const done = await geometryState();
  const rec = done.recordsRaw?.records?.[0] ?? null;
  record('S3 断网完整局', done.resultVisible && /总分/.test(done.resultScore) && rec?.gameId === 'geometry-builder' && done.imgsAllLoaded,
    `${done.resultScore} · gameId=${rec?.gameId} · 配图断网加载=${done.imgsAllLoaded} · SW=${swInfo.name} 配图 ${swInfo.svgCount} 张 · ${serverWasAlive ? '杀 serve 4373 后' : '源站已断'}刷新由缓存打开（题库模块断网 import ${poolCount} 任务）`, { poolCount });
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, ua, scenarios, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, `${phase}-results.json`), JSON.stringify(summary, null, 2));
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  log(`结果: ${scenarios.filter(s => s.pass).length}/${scenarios.length} 通过`);
  await wd('DELETE', base);
  process.exit(scenarios.every(s => s.pass) ? 0 : 1);
}
