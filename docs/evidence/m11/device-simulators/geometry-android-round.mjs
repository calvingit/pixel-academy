// 几何建筑师（M11）Android 模拟器 Chrome 验证（口径对齐 M9/M10/M12 device-simulators/android-round.mjs）。
// CDP 走 browser 级 endpoint + Target.attachToTarget(flatten)。输入全部为
// Input.dispatchTouchEvent 真实触摸（含拖拽手势：touchStart → 连续 touchMove → touchEnd）。
// 答案一律从页面快照（pixel-academy:geometry-builder:v1:interrupted）经 dist 判题模块
//（selectGeometryExercises + correctShapeAnswer）自算，不注入任何游戏状态。
// 覆盖：S1 在线完整局（首页菜单第六入口、5 任务三模式、真实触摸点选放置、第 2 题
// 放错→纠正重试档 +5、结算与记录 gameId=geometry-builder、金币零变化）
// → S2 返回路径与六入口并存 → S3 离线（SW 就绪→杀源→刷新，/geometry.html 由缓存打开）
// → S4 贯穿（横向溢出与 JS 错误台账）。
// 用法：node geometry-android-round.mjs online|offline [输出目录]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const execFileP = promisify(execFile);
const phase = process.argv[2] ?? 'online';
const ADB_SERIAL = 'emulator-5556';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9333';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4273';
const outDir = process.argv[3] ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

process.on('uncaughtException', err => { console.error(`[${phase}] UNCAUGHT:`, err?.stack ?? err); process.exit(2); });
const log = (...a) => console.log(`[${phase}]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const adbShell = async args => { try { await execFileP('adb', ['-s', ADB_SERIAL, 'shell', ...args]); } catch { /* 忽略 */ } };
let wakeCounter = 0;
async function wakeUp(force = false) {
  if (!force && ++wakeCounter % 6 !== 1) return;
  await adbShell(['input', 'keyevent', 'KEYCODE_WAKEUP']);
  try { await send('Page.bringToFront'); } catch { /* 忽略 */ }
}

// ===== CDP 连接（browser 级 endpoint）=====
let ws, seq = 0, sessionId = null;
const pending = new Map();
function send(method, params = {}, sid = sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP 超时: ${method}`)); }, 30000);
    pending.set(id, msg => { clearTimeout(timer); msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result); });
  });
}
async function connect() {
  ws = new WebSocket('ws://127.0.0.1:9333/devtools/browser');
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  };
  ws.onerror = () => {}; // 避免 uncaught ErrorEvent
  ws.onclose = () => log('CDP ws closed');
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let attached = null;
  for (let i = 0; i < 40 && !attached; i++) {
    const info = await send('Target.getTargets', {}, null);
    // 只取本源 target，逐个探活（Chrome 113 恢复的冻结旧 tab 命令无响应，记忆先例）。
    const mine = info.targetInfos.filter(t => t.type === 'page' && t.url.startsWith(ORIGIN));
    for (const t of mine) {
      try {
        const att = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null);
        sessionId = att.sessionId;
        const alive = await send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, att.sessionId);
        if (alive?.result?.value === 2) { attached = att.sessionId; break; }
        await send('Target.detachFromTarget', {}, att.sessionId).catch(() => {});
      } catch { /* 下一个 */ }
    }
    if (attached) break;
    if (i === 10) await send('Target.createTarget', { url: `${ORIGIN}/` }, null);
    await sleep(500);
  }
  if (!attached) throw new Error(`未找到 ${ORIGIN} 活跃页面目标`);
  sessionId = attached;
  await send('Page.enable');
  await send('Runtime.enable');
}
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`页面异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const touchTap = async (x, y) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y) }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
/** 真实触摸拖拽：touchStart → 连续 touchMove（超过 8px 阈值启动拖拽）→ touchEnd。 */
const touchDrag = async (from, to) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y) }] });
  await sleep(80);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(from.x + (to.x - from.x) * i / steps), y: Math.round(from.y + (to.y - from.y) * i / steps) }] });
    await sleep(40);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
  log('截图', name);
};
const rectOf = async (expression, { tolerant = false } = {}) => {
  const rect = await evaluate(expression, false);
  if ((rect === null || rect === 'disabled') && !tolerant) throw new Error(`元素不可点: ${expression.slice(0, 60)}`);
  return rect;
};
const tapSel = async (expression, { tolerant = false } = {}) => {
  const rect = await rectOf(expression, { tolerant });
  if (!rect || rect === 'disabled') return rect === 'disabled' ? 'disabled' : null;
  await sleep(120);
  const rect2 = await rectOf(expression, { tolerant: true });
  if (!rect2 || rect2 === 'disabled') return 'disabled';
  await touchTap(rect2.x, rect2.y);
  return true;
};
const waitUntil = async (fn, desc, timeoutMs = 20000) => {
  const start = Date.now();
  let lastErr = null, errCount = 0, polls = 0;
  for (;;) {
    let v; try { v = await fn(); polls++; } catch (e) { lastErr = e; errCount++; v = null; }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}（polls=${polls} lastError=${lastErr?.message}）`);
    await sleep(300);
  }
};

// ===== 页面注入（JS 错误台账）=====
const INJECT_SOURCE = "window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));'ok'";
const pageCheck = () => evaluate(`(() => ({
  path: location.pathname,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  viewport: { w: window.innerWidth, h: window.innerHeight },
  errors: window.__errors ?? [],
  swControlled: !!navigator.serviceWorker.controller,
  onLine: navigator.onLine,
}))()`, false);
async function requireClean(pc, where) {
  if (pc.overflow) throw new Error(`${where} 出现横向溢出`);
  if (pc.errors.length) throw new Error(`${where} 出现 JS 错误: ${JSON.stringify(pc.errors)}`);
  log(`${where}: viewport=${pc.viewport.w}x${pc.viewport.h} overflow=false errors=0`);
}
const clearSave = () => evaluate("['pixel-academy:geometry-builder:v1:interrupted','pixel-academy:geometry-builder:v1:records','pixel-academy:geometry-builder:v1:recent-ids','pixel-academy:geometry-builder:v1:settings'].forEach(k => localStorage.removeItem(k)); 'ok'");
const snap = () => evaluate("(() => { const s = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted')); if (!s) return null; const q = s.state.questions[s.state.questionIndex]; return { qi: s.state.questionIndex, phase: s.state.phase, kind: q.task.kind, mode: q.task.mode ?? '', answer: q.task.answer ?? '', options: q.options ?? [], blocks: q.blocks ?? [], zones: q.zones ?? [], taskBlocks: q.task.blocks ?? [], placement: q.placement, attempts: s.state.attempts, wrongs: s.state.wrongs, score: s.state.score }; })()", false);
const waitAsking = async () => waitUntil(async () => {
  const s = await snap();
  return s ? (s.phase === 'asking' ? s : false) : 'none';
}, 'asking/none');

// ===== 点击/拖拽辅助（SEL 形如 "expr|.sub"）=====
const centerOf = async (selExpr) => {
  const [outer, inner] = selExpr.split('|');
  return evaluate(`(() => { let el = ${outer}; if (el && ${inner ? 'true' : 'false'}) el = el.querySelector(${JSON.stringify(inner ?? '')}); if (!el || el.disabled) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
};
const tapExpr = async selExpr => {
  const p = await centerOf(selExpr);
  if (!p) return false;
  await touchTap(p.x, p.y);
  return true;
};
const dragExpr = async (fromSel, toSel) => {
  const from = await centerOf(fromSel);
  const to = await centerOf(toSel);
  if (!from || !to) return false;
  await touchDrag(from, to);
  return true;
};

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};
const checkpoint = async name => { await wakeUp(true); await shot(name); await requireClean(await pageCheck(), name); };

// ===== S1+S2 在线 =====
if (phase === 'online') {
  // 清环境：force-stop Chrome 重开（先例口径），确保干净状态；就绪后再连接
  await adbShell(['am', 'force-stop', 'com.android.chrome']);
  await sleep(1500);
  await adbShell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', `${ORIGIN}/`]);
  await waitUntil(async () => {
    try { const v = await (await fetch(`${CDP_HTTP}/json/version`)).json(); return v.Browser; }
    catch { return false; }
  }, 'CDP ready', 30000);
  await sleep(2000);
  await connect();
  await evaluate(INJECT_SOURCE);
  await clearSave();
  await send('Page.reload');
  await sleep(2500);
  await evaluate(INJECT_SOURCE);
  await checkpoint('S1-在线首页');

  // S1a：首页菜单第六入口
  // 数字消除首页菜单入口探测（M10 先例：更多按钮）
  const moreSel = await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find(b => /更多|menu/i.test(b.id + b.getAttribute('aria-label') ?? '')); return btn ? { found: true, id: btn.id } : { found: false, ids: [...document.querySelectorAll('button')].map(b => b.id).filter(Boolean) }; })()`, false);
  log('菜单按钮探测', JSON.stringify(moreSel));
  if (moreSel.found) {
    await tapExpr(`document.getElementById(${JSON.stringify(moreSel.id)})`);
    await sleep(600);
  }
  await checkpoint('S1-首页菜单');
  const navTapped = await tapExpr("document.querySelector('#main-nav a[href=\"/geometry.html\"]')");
  await sleep(1800);
  await evaluate(INJECT_SOURCE);
  const onGeometry = await evaluate(`location.pathname === '/geometry.html' && document.getElementById('boot-fail').hidden`, false);
  record('S1a 首页第六入口进入', navTapped && onGeometry, `菜单→geometry.html=${navTapped}，boot 正常=${onGeometry}`);
  await checkpoint('S1-几何选择屏');

  // S1b：完整局 5 任务（第 2 题放错 → 纠正重试档 +5）
  await tapExpr("document.querySelectorAll('.grade-card')[0]");
  await sleep(300);
  const started = await tapExpr("document.getElementById('btn-start')");
  await sleep(800);
  let wrongInjected = false;
  let finishInfo = null;
  for (let step = 0; step < 35; step++) {
    const w = await waitAsking();
    if (w === 'none') break;
    const s = await snap();
    if (s.phase !== 'asking') { await sleep(400); continue; }
    if (s.kind === 'shape-choose') {
      if (!wrongInjected) {
        // 第一个辨认题答错入重试档
        const wrong = s.options.find(o => o !== s.answer);
        await tapExpr(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(wrong)}]`);
        wrongInjected = true;
        await sleep(600);
        continue;
      }
      await tapExpr(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(s.answer)}]`);
    } else if (s.mode === 'classify') {
      for (let guard = 0; guard < s.blocks.length + 2; guard++) {
        const cur = await snap();
        if (!cur) break;
        const target = cur.blocks.findIndex((shape, i) => cur.placement.byBlock[i] === null);
        if (target < 0) break;
        const zi = cur.zones.findIndex(z => z.accept.includes(cur.blocks[target]));
        await tapExpr(`document.querySelectorAll('#blocks-shelf .block-card')[${target}]`);
        await sleep(200);
        await tapExpr(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
        await sleep(250);
      }
      await tapExpr("document.getElementById('btn-submit')");
    } else {
      // build：用真实触摸拖拽放第一槽，其余槽点选（两条路径都验证）
      let first = true;
      const consumed = [];
      for (const zone of s.zones) {
        const pick = s.taskBlocks.find(block => zone.accept.includes(block)
          && s.taskBlocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
        consumed.push(pick);
        const zi = s.zones.indexOf(zone);
        const blockIdx = s.blocks.indexOf(pick);
        if (first) {
          const dragged = await dragExpr(
            `document.querySelectorAll('#blocks-shelf .block-card')[${blockIdx}]`,
            `document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
          log('拖拽放置', zone.id, pick, dragged);
          first = false;
        } else {
          await tapExpr(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
        }
        await sleep(400);
        if ((await snap())?.phase !== 'asking') break;
      }
    }
    await sleep(1000);
    finishInfo = await snap();
  }
  await sleep(1600);
  await checkpoint('S1-结算屏');
  const v = await evaluate(`({ resultVisible: !document.getElementById('screen-result').hidden,
    score: document.getElementById('result-score').textContent,
    answer: document.getElementById('result-answer').textContent,
    modes: document.getElementById('result-modes').textContent })`, false);
  const rec = await evaluate(`(() => { const r = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:records') || 'null'); return r?.records?.[0] ?? null; })()`, false);
  record('S1b 完整局（真实触摸，含拖拽）', v.resultVisible && /总分 (40|45|50)/.test(v.score) && rec?.gameId === 'geometry-builder'
    && rec?.answer?.operations?.drags >= 1,
    `${v.score} · ${v.answer} · 拖拽操作=${rec?.answer?.operations?.drags} 记录 gameId=${rec?.gameId}`, { v, record: rec });

  // S2：返回路径与六入口并存
  await tapExpr("document.getElementById('btn-result-return')");
  await sleep(600);
  await tapExpr("document.querySelector('#screen-select a.btn-ghost')");
  await sleep(1800);
  const navCount = await evaluate(`document.querySelectorAll('#main-nav a').length`, false);
  const hasGeometryLink = await evaluate(`!!document.querySelector('#main-nav a[href="/geometry.html"]')`, false);
  const backHome = await evaluate(`location.pathname === '/'`, false);
  record('S2 返回路径与六入口并存', backHome && navCount >= 5 && hasGeometryLink,
    `回首页=${backHome} 菜单入口=${navCount}（${hasGeometryLink ? '含几何建筑师入口' : '缺几何建筑师入口——模拟器 SW 可能持旧缓存'}）`);
  await checkpoint('S2-首页菜单回归');
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, `${phase}-results.json`), JSON.stringify(summary, null, 2));
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  log(`结果: ${scenarios.filter(s => s.pass).length}/${scenarios.length} 通过`);
  ws.close();
  process.exit(scenarios.every(s => s.pass) ? 0 : 1);
}

// ===== S3 离线：SW 就绪 → 杀源 → 刷新 → 缓存打开 → 断网完整局 =====
if (phase === 'offline') {
  await connect();
  await adbShell(['am', 'force-stop', 'com.android.chrome']);
  await sleep(1500);
  await adbShell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', `${ORIGIN}/geometry.html?nosw`]);
  await waitUntil(async () => {
    try { const v = await (await fetch(`${CDP_HTTP}/json/version`)).json(); return v.Browser; }
    catch { return false; }
  }, 'CDP ready', 30000);
  await sleep(2000);
  await connect();
  await evaluate(INJECT_SOURCE);
  await clearSave();
  // ?nosw 入口没有 SW：先去首页（无 ?nosw）促成 SW 注册与预缓存
  await send('Page.navigate', { url: `${ORIGIN}/` });
  await sleep(2500);
  await evaluate(INJECT_SOURCE);
  let swInfo = null;
  for (let i = 0; i < 6 && !swInfo; i++) {
    swInfo = await waitUntil(async () => evaluate(`(async () => {
      if (navigator.serviceWorker.controller === null) return null;
      const keys = await caches.keys();
      const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
      if (!name) return null;
      const cache = await caches.open(name);
      const geometry = await cache.match('/geometry.html');
      const geometryCss = await cache.match('/geometry.css');
      const mainJs = await cache.match('/dist/game/geometry-builder/main.js');
      const svg = await cache.match('/img/geometry-builder/cube.svg');
      if (!geometry || !geometryCss || !mainJs || !svg) return null;
      let svgCount = 0;
      for (const k of await cache.keys()) if (k.url.includes('/img/geometry-builder/')) svgCount += 1;
      return { name, svgCount };
    })()`), 'SW 就绪且缓存含 /geometry.html 与配图', 15000).catch(() => null);
    if (!swInfo) {
      log(`SW 未就绪（第 ${i + 1} 次），刷新促成新版本接管`);
      await send('Page.reload', { ignoreCache: false });
      await sleep(2500);
      await evaluate(INJECT_SOURCE);
    }
  }
  if (!swInfo) throw new Error('SW 未就绪（缓存缺 /geometry.html 或配图）');
  log('SW:', JSON.stringify(swInfo));
  await checkpoint('S3-SW就绪首页(在线)');
  // 杀源站
  let serverWasAlive = true;
  try { await execFileP('pkill', ['-f', 'serve.mjs 4273']); } catch { serverWasAlive = false; }
  await sleep(1500);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}/sw.js`, { signal: AbortSignal.timeout(3000) }); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  log('源站已断开，刷新当前标签页（非冷导航）');
  // Chrome 113 断源刷新首次可能落在过渡态（renderer 未接管），重试 reload 至缓存打开。
  let homeOk = false;
  for (let i = 0; i < 5 && !homeOk; i++) {
    await send('Page.reload', { ignoreCache: false });
    await sleep(2500);
    homeOk = await evaluate(`location.pathname === '/' && document.getElementById('screen-select') !== null`, false);
  }
  if (!homeOk) throw new Error('断源刷新后首页未能由缓存打开');
  await checkpoint('S3-离线首页');
  await shot('android-offline-01-home');
  // 菜单进几何建筑师
  await tapExpr("document.getElementById('btn-menu')");
  await sleep(600);
  await tapExpr(`document.querySelector('#main-nav a[href="/geometry.html"]')`);
  await waitUntil(async () => evaluate(`location.pathname === '/geometry.html' && document.getElementById('boot-fail').hidden`, false), '断源后几何建筑师由缓存打开', 30000);
  // 断网下题库模块 import（SW 闭包）
  const poolInfo = await evaluate(`import('/dist/game/geometry-builder/content.js').then(m => m.selectGeometryExercises([1]).length).catch(e => Promise.reject(new Error(e.message)))`);
  await checkpoint('S3-离线选择屏');
  await shot('android-offline-02-geometry-select');
  // 断网完整局
  await tapExpr("document.querySelectorAll('.grade-card')[0]");
  await sleep(300);
  await tapExpr("document.getElementById('btn-start')");
  await sleep(800);
  for (let step = 0; step < 35; step++) {
    const w = await waitAsking();
    if (w === 'none') break;
    const s = await snap();
    if (s.phase !== 'asking') { await sleep(400); continue; }
    if (s.kind === 'shape-choose') {
      await tapExpr(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(s.answer)}]`);
    } else if (s.mode === 'classify') {
      for (let guard = 0; guard < s.blocks.length + 2; guard++) {
        const cur = await snap();
        if (!cur) break;
        const target = cur.blocks.findIndex((shape, i) => cur.placement.byBlock[i] === null);
        if (target < 0) break;
        const zi = cur.zones.findIndex(z => z.accept.includes(cur.blocks[target]));
        await tapExpr(`document.querySelectorAll('#blocks-shelf .block-card')[${target}]`);
        await sleep(200);
        await tapExpr(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
        await sleep(250);
      }
      await tapExpr("document.getElementById('btn-submit')");
    } else {
      const consumed = [];
      for (const zone of s.zones) {
        const pick = s.taskBlocks.find(block => zone.accept.includes(block)
          && s.taskBlocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
        consumed.push(pick);
        await tapExpr(`document.querySelectorAll('#zones .zone-card')[${s.zones.indexOf(zone)}]|.zone-label`);
        await sleep(400);
        if ((await snap())?.phase !== 'asking') break;
      }
    }
    await sleep(1000);
  }
  await sleep(1600);
  await checkpoint('S3-离线结算屏');
  await shot('android-offline-03-offline-result');
  const v = await evaluate(`({ resultVisible: !document.getElementById('screen-result').hidden,
    score: document.getElementById('result-score').textContent })`, false);
  const rec = await evaluate(`(() => { const r = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:records') || 'null'); return r?.records?.[0] ?? null; })()`, false);
  const svgLoaded = await evaluate(`(() => { const imgs = [...document.querySelectorAll('img')].filter(i => i.src.includes('geometry-builder')); return imgs.length === 0 || imgs.every(i => i.complete && i.naturalWidth > 0); })()`, false);
  record('S3 断网完整局', v.resultVisible && /总分/.test(v.score) && rec?.gameId === 'geometry-builder' && svgLoaded,
    `${v.score} · 记录 gameId=${rec?.gameId} · 配图断网加载=${svgLoaded} · SW=${swInfo.name} 预缓存配图 ${swInfo.svgCount} 张 · ${serverWasAlive ? '杀 serve 4273 后' : '源站已断'}刷新由缓存打开`, { v, record: rec, swInfo, serverWasAlive });
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, `${phase}-results.json`), JSON.stringify(summary, null, 2));
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  log(`结果: ${scenarios.filter(s => s.pass).length}/${scenarios.length} 通过`);
  ws.close();
  process.exit(scenarios.every(s => s.pass) ? 0 : 1);
}
