// Android 模拟器 Chrome 验证（M8 汉字勇者 + 首页新导航，口径对齐 M7 android-round.mjs）。
// 前置：emulator-5556 在线；`adb reverse tcp:4273 tcp:4273` 与
// `adb forward tcp:9333 localabstract:chrome_devtools_remote` 已建立；Chrome 已打开
// http://localhost:4273/。在线阶段服务为 `node scripts/serve.mjs 4273`。
// 用法：node android-round.mjs online|offline [输出目录]
// 输入全部为真实触摸事件（Input.dispatchTouchEvent）；判题走页面内 dist 模块
// （correctHanziIds / correctOptionIds / answerFor），不注入状态、不篡改档案。
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

const log = (...a) => console.log(`[${phase}]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const adbShell = async args => { try { await execFileP('adb', ['-s', ADB_SERIAL, 'shell', ...args]); } catch { /* 忽略 */ } };
// 熄屏或标签页后台会触发应用的 visibilitychange 自动暂停，先点亮屏幕并置前。
async function wakeUp() {
  await adbShell(['input', 'keyevent', 'KEYCODE_WAKEUP']);
  try { await send('Page.bringToFront'); } catch { /* 忽略 */ }
}

const targets = await (await fetch(`${CDP_HTTP}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.startsWith(ORIGIN));
if (!page) throw new Error(`未找到 ${ORIGIN} 页面目标：${targets.map(t => t.url).join(', ')}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
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
const tap = async (x, y) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y) }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
  try { const { stdout } = await execFileP('adb', ['-s', ADB_SERIAL, 'exec-out', 'screencap', '-p']);
    await writeFile(join(outDir, `${name}-frame.png`), stdout); } catch (e) { log('设备帧截图失败（忽略）:', e.message); }
  log('截图', name);
};
const clickAt = async selector => {
  const pt = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!pt) throw new Error(`无法点击 ${selector}（不存在或禁用）`);
  await sleep(150);
  // 元素重建类坑：点击前重查位置，不沿用旧坐标。
  const pt2 = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return null; const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!pt2) throw new Error(`点击前元素消失或禁用: ${selector}`);
  await tap(pt2.x, pt2.y);
};
const tapOptionByText = async text => {
  const pt = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('#options button.option-card')]
      .find(b => b.textContent === ${JSON.stringify(text)});
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!pt) throw new Error(`找不到选项按钮: ${JSON.stringify(text)}`);
  await tap(pt.x, pt.y);
  await sleep(250);
};
async function waitUntil(fn, desc, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(300);
  }
}

// ===== 页面检查（两页共用口径）=====
const pageCheck = () => evaluate(`(() => ({
  path: location.pathname,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  errors: window.__errors ?? [],
  swControlled: !!navigator.serviceWorker.controller,
  onLine: navigator.onLine,
  offlineNotice: document.querySelector('#offline-notice')?.textContent ?? '',
}))()`, false);
async function requireClean(pc, where) {
  if (pc.overflow) throw new Error(`${where} 出现横向溢出 (scrollWidth>innerWidth)`);
  if (pc.errors.length) throw new Error(`${where} 出现 JS 错误: ${JSON.stringify(pc.errors)}`);
  log(`${where}: viewport=${pc.viewport.w}x${pc.viewport.h} overflow=false errors=0`);
}

// ===== 汉字勇者：localStorage 快照 + 正式判题 =====
const hanziState = () => evaluate(`(() => {
  const raw = localStorage.getItem('pixel-academy:hanzi-hero:v1:interrupted');
  const snap = raw ? JSON.parse(raw) : null;
  let recs = [];
  try { recs = JSON.parse(localStorage.getItem('pixel-academy:hanzi-hero:v1:records') ?? '[]'); } catch {}
  const s = snap && snap.state;
  return { records: recs.length, lastRecord: recs[recs.length - 1] ?? null,
    round: s ? { phase: s.phase, questionIndex: s.questionIndex, score: s.score,
      currentWrong: s.currentWrong, total: s.questions.length,
      task: (s.questions[s.questionIndex] ?? {}).task ?? null } : null };
})()`, false);
const hanziScreens = () => evaluate(`(() => ({
  select: !document.querySelector('#screen-select').hidden,
  game: !document.querySelector('#screen-game').hidden,
  result: !document.querySelector('#screen-result').hidden,
  paused: !document.querySelector('#pause-overlay').hidden,
  hud: document.querySelector('#hud-progress')?.textContent ?? '',
  score: document.querySelector('#hud-score')?.textContent ?? '',
}))()`, false);
async function hanziCorrectIds(task) {
  return evaluate(`(async () => {
    const t = ${JSON.stringify(task)};
    const { correctHanziIds } = await import('/dist/learning/hanzi.js');
    return correctHanziIds(t);
  })()`);
}
// 作答当前汉字题：intentionallyWrong 时先交一个确定错误的答案（choose 点非目标项；
// parts 只勾一个不完整/错误项再提交），然后由调用方等待 currentWrong 后再答对。
async function answerHanzi(task, intentionallyWrong) {
  const expected = await hanziCorrectIds(task);
  const texts = await evaluate(`[...document.querySelectorAll('#options button.option-card')].map(b => b.textContent)`, false);
  const isParts = task.kind === 'hanzi-parts';
  let picks;
  if (!intentionallyWrong) {
    picks = isParts ? [...expected] : [expected[0]];
  } else if (isParts) {
    const nonPart = texts.find(t => !expected.includes(t));
    picks = [nonPart ?? expected[0]]; // 全部候选都是部件时，只勾一个也判错
  } else {
    const wrong = texts.find(t => !expected.includes(t));
    if (wrong === undefined) throw new Error(`候选中没有可点的错误项: ${JSON.stringify(texts)}`);
    picks = [wrong];
  }
  for (const pick of picks) await tapOptionByText(pick); // 重建后逐次重查坐标
  if (isParts) { await clickAt('#btn-parts-submit'); await sleep(250); }
  return { kind: task.kind, mode: task.mode ?? null, picks, expected };
}

// 完整汉字一局：deliberateWrongAt 给出故意答错的题号（0 基），其余全对。
async function playHanziRound(label, deliberateWrongAt = null) {
  const steps = [];
  let wrongDone = deliberateWrongAt === null;
  for (let guard = 0; guard < 30; guard++) {
    await wakeUp();
    const scr0 = await hanziScreens();
    if (scr0.result) return steps;
    if (scr0.paused) { log('检测到暂停遮罩，点击继续游戏'); await clickAt('#btn-resume'); await sleep(500); continue; }
    const hs = await hanziState();
    if (!hs.round) throw new Error(`${label}: 快照缺失（局未开始或已被清除）`);
    if (hs.round.phase !== 'asking') { await sleep(400); continue; }
    const qi = hs.round.questionIndex;
    const beforeScore = hs.round.score;
    const wantWrong = !wrongDone && qi === deliberateWrongAt;
    const step = await answerHanzi(hs.round.task, wantWrong);
    if (wantWrong) {
      // 等待判错反馈：快照 currentWrong=true、题号未推进、得分未变。
      await waitUntil(async () => {
        const s = await hanziState();
        return s.round && s.round.phase === 'asking' && s.round.questionIndex === qi && s.round.currentWrong === true ? s : null;
      }, `第 ${qi + 1} 题判错`, 10000);
      const fb = await evaluate(`document.querySelector('#feedback').textContent`, false);
      log(`${label}: 第 ${qi + 1} 题故意答错 ${JSON.stringify(step.picks)}（期望 ${JSON.stringify(step.expected)}），feedback="${fb}"`);
      await shot(`${label}-q${qi + 1}-wrong`);
      wrongDone = true;
      steps.push({ question: qi + 1, ...step, outcome: 'wrong-first', feedback: fb });
      continue;
    }
    // 先抓 resolving 快照的得分增量（约 900ms 窗口），再等题号推进或结算。
    const resolving = await waitUntil(async () => {
      const s = await hanziState();
      return s.round && s.round.phase === 'resolving' && s.round.score > beforeScore ? s : null;
    }, `第 ${qi + 1} 题得分确认`, 10000);
    const gained = resolving.round.score - beforeScore;
    await waitUntil(async () => {
      const s = await hanziState();
      const sc = await hanziScreens();
      return sc.result || (s.round && s.round.phase === 'asking' && s.round.questionIndex > qi) ? { s, sc } : null;
    }, `第 ${qi + 1} 题推进`, 12000);
    log(`${label}: 第 ${qi + 1} 题 ${step.kind} 答对 ${JSON.stringify(step.picks)}，得分 ${beforeScore}→${beforeScore + gained}（+${gained}）`);
    steps.push({ question: qi + 1, ...step, outcome: 'correct', gained });
    if (qi === 0) await shot(`${label}-q1`);
  }
  throw new Error(`${label}: 超过 30 轮仍未结算`);
}
// hanzi 选择屏通用进入：清理残留局 → 选一年级 → 等开局可用。
async function enterHanziRound(prefix) {
  if (await evaluate(`!document.querySelector('#restore-offer').hidden`, false)) {
    log('发现汉字残留中断局，执行放弃');
    await clickAt('#btn-discard-round');
    await sleep(600);
    await clickAt('#btn-confirm-yes');
    await waitUntil(async () => evaluate(`document.querySelector('#restore-offer').hidden`, false), '汉字残留局清理');
    await sleep(400);
  }
  for (let round = 0; round < 8; round++) {
    await evaluate(`(() => {
      const card = [...document.querySelectorAll('#grade-grid .grade-card')].find(b => b.textContent === '一年级');
      if (card && card.getAttribute('aria-pressed') !== 'true') card.click();
    })()`);
    await sleep(500);
    const settled = await evaluate(`(() => {
      const card = [...document.querySelectorAll('#grade-grid .grade-card')].find(b => b.textContent === '一年级');
      return card && card.getAttribute('aria-pressed') === 'true' && !document.querySelector('#btn-start').disabled;
    })()`, false);
    if (settled) break;
    if (round === 7) throw new Error('年级选择未在重渲染后稳定');
  }
  const avail = await evaluate(`document.querySelector('#availability-status').textContent`, false);
  log(`${prefix}可用性文案:`, avail.trim());
  return avail.trim();
}

// ===== 数字消除（M7 口径复用）：IndexedDB 档案 + 棋盘几何 =====
const READ_STATE = `(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('profiles', 'readonly');
  const req = tx.objectStore('profiles').get('local');
  const p = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  const s = p && p.challenge && p.challenge.state;
  return { hasProfile: !!p, coins: p ? p.coins : null, records: p && p.records ? p.records.length : null,
    grades: p ? p.grades : null,
    challenge: s ? { phase: s.phase, questionIndex: s.questionIndex, score: s.score, board: s.board,
      total: s.questions.length, task: s.questions[s.questionIndex] ? s.questions[s.questionIndex].task : null } : null };
})()`;
const state = () => evaluate(READ_STATE);
const mathScreens = () => evaluate(`(() => ({
  select: !document.querySelector('#screen-select').hidden,
  availability: !document.querySelector('#screen-availability').hidden,
  game: !document.querySelector('#screen-game').hidden,
  result: !document.querySelector('#screen-result').hidden,
  preview: !document.querySelector('#preview-banner').hidden,
}))()`, false);
const tilePoint = idx => evaluate(`(() => {
  const wrap = document.querySelector('#board-wrap');
  const canvas = document.querySelector('#board-canvas');
  const rect = canvas.getBoundingClientRect();
  const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
  const landscape = availW / availH > 1.35 && availH < 420;
  const width = landscape ? 620 : 360;
  const scale = Math.min(availW / width, 1);
  const height = Math.min(620, availH / scale);
  const columns = landscape ? 4 : 3;
  const task = landscape ? { x: 12, y: 46, w: 210, h: height - 78 } : { x: 12, y: 46, w: 336, h: Math.min(162, height * .23) };
  const boardX = landscape ? 238 : 10;
  const boardY = landscape ? 10 : task.y + task.h + 30;
  const tileW = landscape ? 86 : 108;
  const tileH = (height - boardY - 10 - (12 / columns - 1) * 8) / (12 / columns);
  const col = ${idx} % columns, row = Math.floor(${idx} / columns);
  const lx = boardX + col * (tileW + 8) + tileW / 2;
  const ly = boardY + row * (tileH + 8) + tileH / 2;
  return { x: rect.left + lx * (rect.width / width), y: rect.top + ly * (rect.height / height) };
})()`);
async function answerMathCurrent(s) {
  const task = s.challenge.task;
  const expected = await evaluate(`(async () => {
    const t = ${JSON.stringify(task)};
    if (t.kind === 'choice') { const { correctOptionIds } = await import('/dist/learning/choice.js'); return correctOptionIds(t); }
    const { answerFor } = await import('/dist/learning/evaluation.js');
    return answerFor(t);
  })()`);
  if (task.kind === 'choice') {
    const ids = Array.isArray(expected) ? expected : [expected];
    const multiple = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('#choice-options button[data-option-id]')];
      return btns.length > 0 && btns[0].querySelector('.choice-mark') != null;
    })()`, false);
    for (const id of ids) await clickAt(`#choice-options button[data-option-id="${id}"]`);
    if (multiple) await clickAt('#btn-choice-submit');
    return { kind: 'choice', expected: ids };
  }
  const idx = s.challenge.board.findIndex(v => v === expected);
  if (idx < 0) throw new Error(`棋盘上找不到答案 ${expected}：board=${JSON.stringify(s.challenge.board)}`);
  const pt = await tilePoint(idx);
  await tap(pt.x, pt.y);
  return { kind: task.kind, expected, tile: idx };
}
async function waitForMathProgress(prevIndex, timeoutMs = 15000) {
  return waitUntil(async () => {
    const s = await state();
    const pc = await mathScreens();
    if (pc.result || !s.challenge) return s;
    return s.challenge.phase === 'asking' && s.challenge.questionIndex > prevIndex ? s : null;
  }, `数学第 ${prevIndex + 1} 题推进`, timeoutMs);
}

// ===== 主流程 =====
await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await wakeUp();

if (phase === 'offline') {
  // 场景3：服务已 kill，刷新当前标签页，SW 应从缓存供页。
  await send('Page.reload', { ignoreCache: false });
  await sleep(2500);
  await wakeUp();
  const pcHome = await waitUntil(async () => { const pc = await pageCheck();
    return pc.path === '/' && pc.swControlled && await evaluate(`!document.querySelector('#screen-select').hidden`, false) ? pc : null; },
    '离线首页选择屏（SW 控制）', 30000);
  const notice = pcHome.offlineNotice;
  log('离线首页提示:', notice);
  if (!notice.includes('离线缓存已就绪')) throw new Error(`离线提示异常: ${notice}`);
  await requireClean(pcHome, '离线首页');
  await shot('android-offline-01-home');
  const summary = { phase, offlineNoticeHome: notice };

  // 首页菜单 → 汉字勇者（离线导航回退）。
  await clickAt('#btn-menu');
  await sleep(600);
  await shot('android-offline-02-menu');
  const navOk = await evaluate(`(() => {
    const a = document.querySelector('#main-nav a[href="/hanzi.html"]');
    if (!a) return false; a.click(); return true;
  })()`, false);
  if (!navOk) throw new Error('离线菜单中未找到汉字勇者入口');
  await waitUntil(async () => { const pc = await pageCheck();
    return pc.path === '/hanzi.html' && await evaluate(`!document.querySelector('#screen-select').hidden`, false) ? pc : null; },
    '离线 hanzi 选择屏', 20000);
  const pcHanzi = await pageCheck();
  await requireClean(pcHanzi, '离线 hanzi 选择屏');
  await shot('android-offline-03-hanzi-select');

  const avail = await enterHanziRound('离线');
  const before = await hanziState();
  await clickAt('#btn-start');
  await waitUntil(async () => { const s = await hanziState(); return s.round && s.round.phase === 'asking' ? s : null; }, '离线开局');
  await shot('android-offline-04-hanzi-q1');
  const steps = await playHanziRound('android-offline', null);
  await waitUntil(async () => { const sc = await hanziScreens(); return sc.result ? sc : null; }, '离线结算屏');
  const resultText = await evaluate(`['#result-title','#result-score','#result-detail'].map(s => document.querySelector(s)?.textContent).join(' | ')`, false);
  const after = await hanziState();
  log('离线结算:', resultText);
  if (after.records !== before.records + 1) throw new Error(`离线成绩记录数不符: ${before.records} → ${after.records}`);
  if (!resultText.includes('总分 50') || !resultText.includes('首次答对 5/5') || !resultText.includes('答错 0 次')) {
    throw new Error(`离线结算数值异常（期望 50 分全对）: ${resultText}`);
  }
  await requireClean(await pageCheck(), '离线结算屏');
  await shot('android-offline-05-hanzi-result');
  summary.round = { steps, resultText, records: [before.records, after.records], lastRecord: after.lastRecord,
    availability: avail };
  summary.page = await pageCheck();
  await writeFile(join(outDir, 'android-offline-results.json'), JSON.stringify(summary, null, 2));
  log('结果', JSON.stringify(summary, null, 2));
  ws.close();
  process.exit(0);
}

// ===== 在线：场景1 + 场景2 =====
await send('Page.navigate', { url: `${ORIGIN}/` });
await sleep(3000);
await wakeUp();
await waitUntil(async () => { const pc = await pageCheck();
  return pc.path === '/' && await evaluate(`!document.querySelector('#screen-select').hidden`, false) ? pc : null; },
  '首页选择屏出现', 30000);
let pc0 = await pageCheck();
log('SW/在线:', JSON.stringify({ sw: pc0.swControlled, onLine: pc0.onLine, notice: pc0.offlineNotice }));
await requireClean(pc0, '在线首页');
// 清理上一轮残留的中断局（存在恢复提供时选择「放弃上局」）。
if (await evaluate(`!document.querySelector('#restore-offer').hidden`, false)) {
  log('发现残留中断局，执行放弃');
  await clickAt('#btn-discard-round');
  await sleep(600);
  await clickAt('#confirm-dialog button[value="yes"]');
  await waitUntil(async () => evaluate(`document.querySelector('#restore-offer').hidden`, false), '残留局清理');
  await sleep(400);
}
pc0 = await pageCheck();
await shot('android-online-01-home');
const mathBefore = await state();
log(`数学档案：records=${mathBefore.records} coins=${mathBefore.coins} grades=${JSON.stringify(mathBefore.grades)}`);

// 场景1a：首页新导航 → 汉字勇者。
await clickAt('#btn-menu');
await sleep(600);
const entryText = await evaluate(`document.querySelector('#main-nav a[href="/hanzi.html"]')?.textContent ?? null`, false);
if (!entryText) throw new Error('首页导航未找到汉字勇者入口');
log('首页导航汉字入口文案:', entryText.trim());
await shot('android-online-02-menu');
await clickAt('#main-nav a[href="/hanzi.html"]');
await waitUntil(async () => { const pc = await pageCheck();
  return pc.path === '/hanzi.html' && await evaluate(`!document.querySelector('#screen-select').hidden`, false) ? pc : null; },
  'hanzi 选择屏出现', 20000);
const pcHanzi = await pageCheck();
await requireClean(pcHanzi, 'hanzi 选择屏');
const backLink = await evaluate(`document.querySelector('#screen-select a.btn-ghost[href="/"]')?.textContent ?? null`, false);
log('hanzi 返回链接文案:', backLink);
if (!backLink) throw new Error('hanzi 选择屏未找到「返回数字消除」链接');
await shot('android-online-03-hanzi-select');
const avail = await enterHanziRound('汉字');
const hanziBefore = await hanziState();
log(`汉字档案：records=${hanziBefore.records} lastScore=${hanziBefore.lastRecord?.score ?? null}`);
await shot('android-online-04-hanzi-availability');
await clickAt('#btn-start');
await waitUntil(async () => { const s = await hanziState(); return s.round && s.round.phase === 'asking' ? s : null; }, '汉字开局');
await shot('android-online-05-hanzi-q1');

// 完整 5 题一局：第 2 题故意答错验证重试 5 分档。
const steps = await playHanziRound('android-online', 1);
await waitUntil(async () => { const sc = await hanziScreens(); return sc.result ? sc : null; }, '汉字结算屏');
const resultText = await evaluate(`['#result-title','#result-score','#result-detail'].map(s => document.querySelector(s)?.textContent).join(' | ')`, false);
const hanziAfter = await hanziState();
log('汉字结算:', resultText);
if (hanziAfter.records !== hanziBefore.records + 1) throw new Error(`汉字成绩记录数不符: ${hanziBefore.records} → ${hanziAfter.records}`);
// 首答 10 分×4 + 重试 5 分×1 = 45；首次答对 4/5、答错 1 次。
if (!resultText.includes('总分 45') || !resultText.includes('首次答对 4/5') || !resultText.includes('答错 1 次')) {
  throw new Error(`结算数值与首答10/重试5口径不符: ${resultText}`);
}
if (hanziAfter.lastRecord?.score !== 45) throw new Error(`记录分数异常: ${JSON.stringify(hanziAfter.lastRecord)}`);
const correctSteps = steps.filter(s => s.outcome === 'correct');
if (correctSteps.length !== 5 || correctSteps.some(s => s.gained !== (s.question === 2 ? 5 : 10))) {
  throw new Error(`逐题得分与口径不符: ${JSON.stringify(steps)}`);
}
await requireClean(await pageCheck(), '汉字结算屏');
await shot('android-online-06-hanzi-result');

// 场景2a：hanzi → 返回数字消除首页。
await clickAt('#btn-result-return');
await sleep(600);
await shot('android-online-07-hanzi-back-select');
const recordsShown = await evaluate(`[...document.querySelectorAll('#records-list li')].slice(0,2).map(li => li.textContent)`, false);
log('hanzi 练习记录前两条:', JSON.stringify(recordsShown));
await clickAt('#screen-select a.btn-ghost[href="/"]');
await waitUntil(async () => { const pc = await pageCheck();
  return pc.path === '/' && await evaluate(`!document.querySelector('#screen-select').hidden`, false) ? pc : null; },
  '返回后首页选择屏', 20000);
pc0 = await pageCheck();
await requireClean(pc0, '返回后首页');
await shot('android-online-08-home-returned');

// 场景2b：数字消除选年级并开一局，作答 2 题。
for (let round = 0; round < 8; round++) {
  await evaluate(`(async () => {
    const inputs = [...document.querySelectorAll('input[name=grade]')];
    const checked = new Set(inputs.filter(i => i.checked).map(i => Number(i.value)));
    const target = [1, 2].find(v => !checked.has(v));
    if (target !== undefined) inputs.find(i => Number(i.value) === target).click();
  })()`);
  await sleep(600);
  const settled = await evaluate(`(() => {
    const checked = [...document.querySelectorAll('input[name=grade]')].filter(i => i.checked).map(i => Number(i.value));
    return checked.length === 2 && checked.includes(1) && checked.includes(2)
      && !document.querySelector('#btn-to-availability').disabled;
  })()`, false);
  if (settled) break;
  if (round === 7) throw new Error('年级勾选未在重渲染后稳定');
}
await clickAt('#btn-to-availability');
const mathAvail = await evaluate(`document.querySelector('#availability-status').textContent`, false);
if (!/10 题|动态出题|个任务/.test(mathAvail)) throw new Error(`可用性文案异常: ${mathAvail}`);
log('数学可用性文案:', mathAvail.trim());
await shot('android-online-09-math-availability');
await clickAt('#btn-start');
await waitUntil(async () => { const s = await state(); return s.challenge && s.challenge.phase !== 'ready' ? s : null; }, '数学开局');
await shot('android-online-10-math-q1');
const mathSteps = [];
for (let n = 0; n < 2; n++) {
  await wakeUp();
  const overlay = await evaluate(`!document.querySelector('#pause-overlay').hidden`, false);
  if (overlay) { await clickAt('#btn-resume'); await sleep(600); }
  let s = await state();
  if (s.challenge.phase === 'ready') { await clickAt('#btn-ready'); s = await state(); }
  if (s.challenge.phase !== 'asking') { await sleep(500); n--; continue; }
  const step = await answerMathCurrent(s);
  log(`数学: 第 ${s.challenge.questionIndex + 1} 题 ${step.kind} 期望 ${JSON.stringify(step.expected)}${step.tile != null ? ` 块 ${step.tile}` : ''}`);
  await waitForMathProgress(s.challenge.questionIndex);
  mathSteps.push(step);
  await shot(`android-online-1${n + 1}-math-q${n + 1}`);
}

// 作答 2 题后返回（放弃本局，不产生新成绩）。
const beforeAbandon = await state();
await clickAt('#btn-game-return');
await sleep(600);
await clickAt('#confirm-dialog button[value="yes"]');
await waitUntil(async () => (await mathScreens()).select, '放弃后回到首页选择屏');
const afterAbandon = await state();
if (afterAbandon.records !== beforeAbandon.records) throw new Error('弃局不应产生新成绩');
log(`弃局后 records=${afterAbandon.records}（前 ${beforeAbandon.records}），无新增成绩`);
await requireClean(await pageCheck(), '弃局后首页');
await shot('android-online-13-math-returned');

const finalPc = await pageCheck();
const summary = {
  phase,
  hanziEntry: { navText: entryText.trim(), backLink },
  hanzi: { availability: avail, steps, resultText,
    records: [hanziBefore.records, hanziAfter.records], lastRecord: hanziAfter.lastRecord },
  math: { availability: mathAvail.trim(), steps: mathSteps,
    records: [beforeAbandon.records, afterAbandon.records] },
  page: finalPc,
  userAgent: await evaluate(`navigator.userAgent`, false),
};
await writeFile(join(outDir, 'android-online-results.json'), JSON.stringify(summary, null, 2));
log('结果', JSON.stringify(summary, null, 2));
ws.close();
process.exit(0);
