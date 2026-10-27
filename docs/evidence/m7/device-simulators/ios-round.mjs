// iOS Simulator Safari 可玩性验证（M7 验收条件④，模拟器口径，与 android-round.mjs 同套方法）。
// 前置：iOS 模拟器已 boot（本验证使用 iPhone 16 Pro / iOS 18.6，UDID 28F2F0F0-…；
// 系统 safaridriver 26.6.2 无法为 iOS 27.0 运行时创建会话，iOS 18.6 可以）；
// 本机已开启 Safari 远程自动化（sudo safaridriver --enable）；safaridriver -p 4801 已运行；
// npm run serve -- 4173 已启动。
// 会话能力必须含 platformName iOS + safari:useSimulator true，否则静默回退到 macOS Safari。
// 用法：node ios-round.mjs online|offline [输出目录]
// 输入方式：页面级合成事件（DOM 控件 el.click()，棋盘按 canvas 几何换算后派发 PointerEvent），
// 与 M3–M7 桌面证据同方法。原因：本机 safaridriver 26.6.2 对 iOS 模拟器的 HID 输入注入不完整
// （实测 pointerdown/touchstart 送达但无 pointerup/touchend/click，后续输入整体丢失；
// element click 与 Actions touch/mouse 均无效，诊断记录见本目录 README），
// 真实 HID 触摸在 iOS 模拟器上不可用，物理真机触摸仍未验证。
// 答案一律从页面档案（IndexedDB）题面自行计算；不注入金币、不篡改状态。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const execFileP = promisify(execFile);
const phase = process.argv[2] ?? 'online';
const WD = process.env.WD_PORT ? `http://127.0.0.1:${process.env.WD_PORT}` : 'http://127.0.0.1:4801';
const UDID = '28F2F0F0-4732-4493-816A-A382DCBF329A';
const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const outDir = process.argv[3] ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

const log = (...a) => console.log(`[${phase}]`, ...a);
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
log('WebDriver 会话', sid);
const base = `/session/${sid}`;
// Safari 的 execute/sync 会等待返回的 Promise（实测验证），统一走 sync 端点。
const evalSync = script => wd('POST', `${base}/execute/sync`, { script: `return ${script}`, args: [] });
const evalAsync = evalSync;
const clickEl = async selector => {
  const ok = await evalSync(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    if (el.disabled) return 'disabled';
    el.click();
    return true; })()`);
  if (ok === null) throw new Error(`无法点击 ${selector}（不存在）`);
  if (ok === 'disabled') throw new Error(`无法点击 ${selector}（禁用）`);
};
const tapAt = async (x, y) => {
  await evalSync(`(() => {
    const canvas = document.querySelector('#board-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${x}, clientY: ${y}, bubbles: true, pointerType: 'touch' }));
    return true;
  })()`);
};
const shot = async name => {
  const r = await wd('GET', `${base}/screenshot`);
  await writeFile(join(outDir, `${name}.png`), Buffer.from(r, 'base64'));
  const frame = `/tmp/ios-frame-${phase}-${Date.now()}.png`;
  try { await execFileP('xcrun', ['simctl', 'io', UDID, 'screenshot', frame]);
    await writeFile(join(outDir, `${name}-frame.png`), await readFile(frame)); } catch (e) { log('设备帧截图失败（忽略）:', e.message); }
  log('截图', name);
};

const READ_STATE = `(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('profiles', 'readonly');
  const req = tx.objectStore('profiles').get('local');
  const p = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  const s = p && p.challenge && p.challenge.state;
  return { hasProfile: !!p, coins: p ? p.coins : null, records: p && p.records ? p.records.length : null,
    challenge: s ? { phase: s.phase, questionIndex: s.questionIndex, score: s.score, board: s.board,
      selectedIds: s.selectedIds ?? null, total: s.questions.length,
      task: s.questions[s.questionIndex] ? s.questions[s.questionIndex].task : null } : null };
})()`;
const state = () => evalAsync(READ_STATE);
const pageCheck = () => evalSync(`(() => {
  const q = s => document.querySelector(s);
  const select = q('#screen-select');
  if (!select) return null; // 页面尚未加载完成（导航中）
  return {
    select: !select.hidden,
    result: !q('#screen-result').hidden,
    preview: !q('#preview-banner').hidden,
    offline: q('#offline-notice')?.textContent ?? '',
    overlay: !q('#pause-overlay').hidden,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    notice: q('#app-notice')?.textContent ?? '' };
})()`);
async function waitUntil(fn, desc, timeoutMs = 25000) {
  const start = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; } // 导航中页面元素可能不存在
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(400);
  }
}
// 棋盘格中心（复刻 render.ts boardLayout + main.ts fitBoard 测量口径，与 Android 轮一致）。
const tilePoint = idx => evalSync(`(() => {
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
async function answerCurrent(s) {
  const task = s.challenge.task;
  const expected = await evalAsync(`(async () => {
    const t = ${JSON.stringify(task)};
    if (t.kind === 'choice') { const { correctOptionIds } = await import('/dist/learning/choice.js'); return correctOptionIds(t); }
    const { answerFor } = await import('/dist/learning/evaluation.js');
    return answerFor(t);
  })()`);
  if (task.kind === 'choice') {
    const ids = Array.isArray(expected) ? expected : [expected];
    const multiple = await evalSync(`(() => {
      const btns = [...document.querySelectorAll('#choice-options button[data-option-id]')];
      return btns.length > 0 && btns[0].querySelector('.choice-mark') != null;
    })()`);
    for (const id of ids) await clickEl(`#choice-options button[data-option-id="${id}"]`);
    if (multiple) await clickEl('#btn-choice-submit');
    return { kind: 'choice', expected: ids };
  }
  const idx = s.challenge.board.findIndex(v => v === expected);
  if (idx < 0) throw new Error(`棋盘上找不到答案 ${expected}：board=${JSON.stringify(s.challenge.board)}`);
  const pt = await tilePoint(idx);
  await tapAt(pt.x, pt.y);
  return { kind: task.kind, expected, tile: idx };
}
async function waitForProgress(prevIndex, timeoutMs = 15000) {
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
    const pc = await pageCheck();
    if (pc.result) break;
    if (pc.overlay) { log('检测到暂停遮罩，点击继续游戏'); await clickEl('#btn-resume'); await sleep(800); }
    let s = await state();
    if (!s.challenge) throw new Error(`${label}: 档案中无挑战状态`);
    if (s.challenge.phase === 'ready') { await clickEl('#btn-ready'); s = await state(); }
    if (s.challenge.phase !== 'asking') { log(`等待作答窗口 phase=${s.challenge.phase}`); await sleep(500); continue; }
    if (pendingPause !== null && s.challenge.questionIndex === pendingPause) {
      pendingPause = null;
      await clickEl('#btn-pause');
      await shot(`${label}-paused`);
      const paused = await state();
      await wd('POST', `${base}/refresh`);
      await sleep(3000);
      await waitUntil(async () => (await pageCheck()).select, '刷新后回到选择屏');
      await clickEl('#btn-restore');
      await waitUntil(async () => { const pc2 = await pageCheck(); return !pc2.select && !pc2.result ? pc2 : null; }, '恢复进入游戏屏');
      const restored = await state();
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
try {
await wd('POST', `${base}/timeouts`, { implicit: 0, pageLoad: 30000, script: 30000 });
await wd('POST', `${base}/url`, { url: ORIGIN });
await sleep(2500);
await waitUntil(async () => (await pageCheck()).select, '选择屏出现');

if (phase === 'offline') {
  // iOS Safari 冷导航到离线受控源会直接落到系统错误页（WebKit 不唤醒 SW，实测稳定复现）；
  // 改用与 M6 相同的「受控后断源刷新」口径：先在线建立受控，再终止源站并刷新同一标签页。
  await execFileP('pkill', ['-f', 'serve.mjs 4173']);
  await sleep(1500);
  await wd('POST', `${base}/refresh`).catch(e => log('refresh 报错（继续等待）:', e.message.slice(0, 120)));
  await waitUntil(async () => (await pageCheck())?.select, '离线刷新后选择屏出现', 40000);
  log('离线刷新进入应用（SW 服务，档案可用）');
}

// 清理上一轮残留的中断局。
if (await evalSync(`!document.querySelector('#restore-offer').hidden`)) {
  log('发现残留中断局，执行放弃');
  await clickEl('#btn-discard-round');
  await sleep(600);
  await clickEl('#confirm-dialog button[value="yes"]');
  await waitUntil(async () => evalSync(`document.querySelector('#restore-offer').hidden`), '残留局清理');
  await sleep(400);
}

const pc0 = await pageCheck();
if (pc0.preview) throw new Error('默认入口出现了预览横幅');
const before = await state();
log(`档案：records=${before.records} coins=${before.coins} viewport=${JSON.stringify(pc0.viewport)} overflow=${pc0.overflow}`);
if (pc0.overflow) throw new Error('选择屏出现横向溢出');
await shot(`ios-${phase}-01-select`);

// 设置年级为一+二年级（应用会重建勾选框，逐次重查元素、逐个点按）。
for (let round = 0; round < 8; round++) {
  const target = await evalSync(`(() => {
    const inputs = [...document.querySelectorAll('input[name=grade]')];
    const checked = new Set(inputs.filter(i => i.checked).map(i => Number(i.value)));
    return [1, 2].find(v => !checked.has(v)) ?? null;
  })()`);
  if (target === null) break;
  await clickEl(`input[name=grade][value="${target}"]`);
  await sleep(700);
}
const settled = await evalSync(`(() => {
  const checked = [...document.querySelectorAll('input[name=grade]')].filter(i => i.checked).map(i => Number(i.value));
  return checked.length === 2 && checked.includes(1) && checked.includes(2)
    && !document.querySelector('#btn-to-availability').disabled;
})()`);
if (!settled) throw new Error('年级勾选未稳定');
await clickEl('#btn-to-availability');
const availText = await evalSync(`document.querySelector('#availability-status').textContent`);
if (!/10 题|动态出题/.test(availText)) throw new Error(`可用性文案异常: ${availText}`);
log('可用性文案:', availText.trim());
await shot(`ios-${phase}-02-availability`);
await clickEl('#btn-start');
await waitUntil(async () => { const s = await state(); return s.challenge && s.challenge.phase !== 'ready' ? s : null; }, '开局');
await shot(`ios-${phase}-03-q1`);
await playRound(phase === 'offline' ? 'ios-c' : 'ios-a', { pauseAt: phase === 'offline' ? null : 4 });

await waitUntil(async () => { const pc = await pageCheck(); return pc.result ? pc : null; }, '结算屏');
const resultText = await evalSync(`['#result-title','#result-score','#result-first-try','#result-wrong','#result-coins'].map(s => document.querySelector(s)?.textContent).join(' | ')`);
const after = await state();
log('结算:', resultText);
log(`结算后 records=${after.records}（前 ${before.records}）coins=${after.coins}（前 ${before.coins}）`);
if (after.records !== before.records + 1) throw new Error(`成绩记录数不符: ${before.records} → ${after.records}`);
await shot(`ios-${phase}-04-result`);
const resultJson = { resultText, records: [before.records, after.records], coins: [before.coins, after.coins] };

if (phase !== 'offline') {
  await clickEl('#btn-again');
  await waitUntil(async () => { const s = await state(); return s.challenge && s.challenge.phase === 'asking' && s.challenge.questionIndex === 0 ? s : null; }, '重开回到第 1 题');
  const again = await state();
  if (again.challenge.score !== 0) throw new Error('重开后得分未清零');
  log('再来一局：第 1/10 题，得分 0');
  await shot('ios-online-05-again');
  await clickEl('#btn-game-return');
  await sleep(800);
  await clickEl('#confirm-dialog button[value="yes"]');
  await waitUntil(async () => (await pageCheck()).select, '放弃后回到选择屏');
  const abandoned = await state();
  if (abandoned.records !== after.records) throw new Error('弃局不应产生新成绩');
  log('放弃本局：无新增成绩');
  await shot('ios-online-06-records');
} else {
  await clickEl('#btn-again');
  await sleep(900);
  await clickEl('#btn-game-return');
  await sleep(800);
  const open = await evalSync(`document.querySelector('#confirm-dialog').open`);
  if (open) await clickEl('#confirm-dialog button[value="yes"]');
  await waitUntil(async () => (await pageCheck()).select, '回到选择屏');
  await shot('ios-offline-05-records');
}

const finalPc = await pageCheck();
const finalState = await state();
const summary = {
  phase, resultJson, viewport: pc0.viewport,
  offlineNotice: finalPc.offline, overflow: finalPc.overflow, notice: finalPc.notice,
  userAgent: await evalSync(`navigator.userAgent`),
  finalRecords: finalState.records, finalCoins: finalState.coins,
  swControlled: await evalSync(`!!navigator.serviceWorker.controller`),
  onLine: await evalSync(`navigator.onLine`),
};
await writeFile(join(outDir, `ios-${phase}-results.json`), JSON.stringify(summary, null, 2));
log('结果', JSON.stringify(summary, null, 2));
} finally {
  try { await wd('DELETE', base); } catch { /* 会话已失效 */ }
}
process.exit(0);
