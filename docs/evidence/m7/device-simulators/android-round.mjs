// Android 模拟器 Chrome 可玩性验证（M7 验收条件④，模拟器口径）。
// 前置：模拟器已运行（adb devices 可见），Chrome 已打开 http://10.0.2.2:4173/，
// `adb forward tcp:9333 localabstract:chrome_devtools_remote` 已建立。
// 用法：node android-round.mjs online|offline [输出目录]
// 输入全部为真实触摸事件（Input.dispatchTouchEvent），坐标由 canvas 几何换算；
// 答案一律从页面档案（IndexedDB）里的题面自行计算；不注入金币或篡改状态。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const execFileP = promisify(execFile);
const phase = process.argv[2] ?? 'online';
const ADB_SERIAL = 'emulator-5556';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9333';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4173/';
const outDir = process.argv[3] ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

const log = (...a) => console.log(`[${phase}]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const adbShell = async args => { try { await execFileP('adb', ['-s', ADB_SERIAL, 'shell', ...args]); } catch { /* 忽略 */ } };
// 模拟器熄屏或标签页后台会触发应用的 visibilitychange 自动暂停，先点亮屏幕并置前。
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
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP 超时: ${method}`)); }, 20000);
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
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: el.disabled };
  })()`);
  if (!pt) throw new Error(`无法点击 ${selector}（不存在或禁用）`);
  await sleep(150);
  const pt2 = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(pt2.x, pt2.y);
};

// 页内读取档案：IndexedDB pixel-academy / profiles / local。
const READ_STATE = `(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('profiles', 'readonly');
  const req = tx.objectStore('profiles').get('local');
  const p = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  const s = p && p.challenge && p.challenge.state;
  return { hasProfile: !!p, coins: p ? p.coins : null, records: p && p.records ? p.records.length : null,
    lastRecord: p && p.records && p.records.length ? p.records[p.records.length - 1] : null,
    grades: p ? p.grades : null,
    challenge: s ? { phase: s.phase, questionIndex: s.questionIndex, score: s.score, board: s.board,
      selectedIds: s.selectedIds ?? null, total: s.questions.length,
      task: s.questions[s.questionIndex] ? s.questions[s.questionIndex].task : null } : null };
})()`;
const state = () => evaluate(READ_STATE);
const pageCheck = () => evaluate(`(() => ({
  select: !document.querySelector('#screen-select').hidden,
  result: !document.querySelector('#screen-result').hidden,
  preview: !document.querySelector('#preview-banner').hidden,
  offline: document.querySelector('#offline-notice')?.textContent ?? '',
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  errors: window.__errors ?? [] }))()`, false);
async function waitUntil(fn, desc, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(300);
  }
}
// 棋盘格中心（复刻 render.ts boardLayout + fitDisplay 的测量口径）。
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
  return { x: rect.left + lx * (rect.width / width), y: rect.top + ly * (rect.height / height), rect: { l: rect.left, t: rect.top, w: rect.width, h: rect.height } };
})()`);
async function answerCurrent(s) {
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
async function waitForProgress(prevIndex, timeoutMs = 12000) {
  return waitUntil(async () => {
    const s = await state();
    const pc = await pageCheck();
    if (pc.result || !s.challenge) return s;
    return s.challenge.phase === 'asking' && s.challenge.questionIndex > prevIndex ? s : null;
  }, `第 ${prevIndex + 1} 题推进`, timeoutMs);
}
async function playRound(label, { pauseAt = null } = {}) {
  const steps = [];
  let pendingPause = pauseAt;
  for (let n = 0; n < 20; n++) {
    await wakeUp();
    const pc = await pageCheck();
    if (pc.result) break;
    // 若处于暂停遮罩（自动暂停恢复场景），先继续游戏。
    const overlay = await evaluate(`!document.querySelector('#pause-overlay').hidden`, false);
    if (overlay) { log('检测到暂停遮罩，点击继续游戏'); await wakeUp(); await clickAt('#btn-resume'); await sleep(600); }
    let s = await state();
    if (!s.challenge) throw new Error(`${label}: 档案中无挑战状态`);
    if (s.challenge.phase === 'ready') { await clickAt('#btn-ready'); s = await state(); }
    if (s.challenge.phase !== 'asking') { log(`等待作答窗口 phase=${s.challenge.phase}`); await sleep(500); continue; }
    if (pendingPause !== null && s.challenge.questionIndex === pendingPause) {
      pendingPause = null;
      await clickAt('#btn-pause');
      await shot(`${label}-paused`);
      const paused = await state();
      await send('Page.reload', { ignoreCache: false });
      await sleep(2500);
      await waitUntil(async () => (await pageCheck()).select, '刷新后回到选择屏');
      await clickAt('#btn-restore');
      await waitUntil(async () => (await pageCheck()).result === false, '恢复进入游戏屏');
      const restored = await state();
      const pc2 = await pageCheck();
      const ok = restored.challenge.questionIndex === paused.challenge.questionIndex
        && restored.challenge.score === paused.challenge.score
        && JSON.stringify(restored.challenge.board) === JSON.stringify(paused.challenge.board);
      if (!ok) throw new Error(`恢复不一致: 暂停=${JSON.stringify(paused.challenge)} 恢复=${JSON.stringify(restored.challenge)}`);
      log(`${label}: 暂停→刷新→恢复一致（第 ${restored.challenge.questionIndex + 1} 题，${restored.challenge.score} 分）`);
      await shot(`${label}-restored`);
      steps.push({ restored: true, questionIndex: restored.challenge.questionIndex });
      continue;
    }
    const step = await answerCurrent(s);
    log(`${label}: 第 ${s.challenge.questionIndex + 1} 题 ${step.kind} 期望 ${JSON.stringify(step.expected)}${step.tile != null ? ` 块 ${step.tile}` : ''}`);
    await waitForProgress(s.challenge.questionIndex);
    steps.push(step);
  }
  return steps;
}

// ===== 主流程 =====
await send('Page.enable');
await send('Runtime.enable');
await wakeUp();
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await send('Page.navigate', { url: ORIGIN });
await sleep(3000);
await wakeUp();
await waitUntil(async () => (await pageCheck()).select, '选择屏出现');

// 清理上一轮残留的中断局（存在恢复提供时选择「放弃上局」）。
if (await evaluate(`!document.querySelector('#restore-offer').hidden`, false)) {
  log('发现残留中断局，执行放弃');
  await clickAt('#btn-discard-round');
  await sleep(600);
  await clickAt('#confirm-dialog button[value="yes"]');
  await waitUntil(async () => evaluate(`document.querySelector('#restore-offer').hidden`, false), '残留局清理');
  await sleep(400);
}

const pc0 = await pageCheck();
if (pc0.preview) throw new Error('默认入口出现了预览横幅');
const before = await state();
log(`档案：records=${before.records} coins=${before.coins} grades=${JSON.stringify(before.grades)} viewport=${JSON.stringify(pc0.viewport)} overflow=${pc0.overflow}`);
if (pc0.overflow) throw new Error('选择屏出现横向溢出');
await shot(`android-${phase}-01-select`);

// 设置年级为一+二年级。注意：应用在勾选变化后会重建勾选框，
// 必须每次重新查询元素、逐个点击并等待界面稳定（旧引用会失效）。
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
const availText = await evaluate(`document.querySelector('#availability-status').textContent`, false);
if (!/10 题|动态出题/.test(availText)) throw new Error(`可用性文案异常: ${availText}`);
log('可用性文案:', availText.trim());
await shot(`android-${phase}-02-availability`);
await clickAt('#btn-start');
await waitUntil(async () => { const s = await state(); return s.challenge && s.challenge.phase !== 'ready' ? s : null; }, '开局');
await shot(`android-${phase}-03-q1`);
await playRound(phase === 'offline' ? 'c' : 'a', { pauseAt: phase === 'offline' ? null : 4 });

const pcResult = await waitUntil(async () => { const pc = await pageCheck(); return pc.result ? pc : null; }, '结算屏');
const resultText = await evaluate(`['#result-title','#result-score','#result-first-try','#result-wrong','#result-coins'].map(s => document.querySelector(s)?.textContent).join(' | ')`, false);
const after = await state();
log('结算:', resultText);
log(`结算后 records=${after.records}（前 ${before.records}）coins=${after.coins}（前 ${before.coins}）`);
if (after.records !== before.records + 1) throw new Error(`成绩记录数不符: ${before.records} → ${after.records}`);
await shot(`android-${phase}-04-result`);
const resultJson = { resultText, records: [before.records, after.records], coins: [before.coins, after.coins] };

if (phase !== 'offline') {
  // 重开 → 放弃。
  await clickAt('#btn-again');
  await waitUntil(async () => { const s = await state(); return s.challenge && s.challenge.phase === 'asking' && s.challenge.questionIndex === 0 ? s : null; }, '重开回到第 1 题');
  const again = await state();
  if (again.challenge.score !== 0) throw new Error('重开后得分未清零');
  log('再来一局：第 1/10 题，得分 0');
  await shot('android-online-05-again');
  await clickAt('#btn-game-return');
  await sleep(600);
  await clickAt('#confirm-dialog button[value="yes"]');
  await waitUntil(async () => (await pageCheck()).select, '放弃后回到选择屏');
  const abandoned = await state();
  if (abandoned.records !== after.records) throw new Error('弃局不应产生新成绩');
  log('放弃本局：无新增成绩');
  await shot('android-online-06-records');
} else {
  // 离线轮结束后回选择屏确认记录仍在。
  await clickAt('#btn-again');
  await sleep(800);
  await clickAt('#btn-game-return');
  await sleep(600);
  const yes = await evaluate(`!document.querySelector('#confirm-dialog').open`, false);
  if (!yes) { await clickAt('#confirm-dialog button[value="yes"]'); }
  await waitUntil(async () => (await pageCheck()).select, '回到选择屏');
  await shot('android-offline-05-records');
}

const finalPc = await pageCheck();
const finalState = await state();
const summary = {
  phase, resultJson, viewport: pc0.viewport,
  offlineNotice: finalPc.offline, overflow: finalPc.overflow, errors: finalPc.errors,
  userAgent: await evaluate(`navigator.userAgent`, false),
  finalRecords: finalState.records, finalCoins: finalState.coins,
  swControlled: await evaluate(`!!navigator.serviceWorker.controller`, false),
  onLine: await evaluate(`navigator.onLine`, false),
};
await writeFile(join(outDir, `android-${phase}-results.json`), JSON.stringify(summary, null, 2));
log('结果', JSON.stringify(summary, null, 2));
ws.close();
process.exit(0);
