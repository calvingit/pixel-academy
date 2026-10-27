// Android 模拟器 Chrome 验证（M12 算术地下城，口径对齐 M8 device-simulators/android-round.mjs，
// 地下城玩法断言对齐 M12 桌面 dungeon-browser.mjs / dungeon-browser-fix.mjs）。
// CDP 走 browser 级 endpoint + Target.attachToTarget(flatten)（per-page WebSocket 在本机
// Chrome 113 握手成功但命令可能无响应，先例 m8/production/android-prod-smoke.mjs）。
// 输入全部为 Input.dispatchTouchEvent 真实触摸；整数题真实键入 = 逐字符 Input.insertText
// （触发页面原生 input 事件管线，桌面 fix 轮同法），逐字符记录「开门」按钮 disabled 实时联动。
// 答案一律从页面题面（#question-prompt 的 dataset.exerciseId）经 dist 判题模块
// （selectDungeonExercises + correctOptionIds / answerFor）自算，不注入任何游戏状态。
// 覆盖：S1 在线完整通关局（≥1 道整数题真实键入提交 + ≥1 道选择题触摸作答 + 右门故意答错
// →「换一题」重试档 +5，结算 35 与逐题档位吻合，记录 gameId=arithmetic-dungeon，金币零变化）
// → S2 返回路径（地下城「返回数字消除」→ 数字消除可选年级；菜单三入口并存）
// → S3 离线（SW 就绪→杀源→刷新，首页与 /dungeon.html 由缓存打开，断网过石门且整数题键入提交）
// → S4 贯穿（横向溢出与 JS 错误台账）。
// 用法：node android-round.mjs online|offline [输出目录]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
// 熄屏或标签页后台会触发 visibilitychange 自动暂停，先点亮屏幕并置前。
// 轮询中高频调用：节流为约每 6 次执行一次，关键节点用 wakeUp(true) 强制。
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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  // /json 按「最近使用在前」排序：匹配本项目 URL 的第一个 page target。
  let attached = null;
  for (let i = 0; i < 40 && !attached; i++) {
    const info = await send('Target.getTargets', {}, null);
    const mine = info.targetInfos.find(t => t.type === 'page' && t.url.startsWith(ORIGIN));
    if (mine) {
      const att = await send('Target.attachToTarget', { targetId: mine.targetId, flatten: true }, null);
      attached = att.sessionId;
      break;
    }
    if (i === 10) await send('Target.createTarget', { url: `${ORIGIN}/` }, null);
    await sleep(500);
  }
  if (!attached) throw new Error(`未找到 ${ORIGIN} 页面目标`);
  sessionId = attached;
  await send('Page.enable');
  await send('Runtime.enable');
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
  log('截图', name);
};
// 元素重建类坑：点击前逐次重查位置（M7/M8 口径），disabled 视 wantDisabled 而定。
const clickAt = async (selector, { tolerant = false } = {}) => {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null; if (el.disabled) return 'disabled';
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
  if (rect === null) { if (tolerant) return null; throw new Error(`元素不存在: ${selector}`); }
  if (rect === 'disabled') { if (tolerant) return 'disabled'; throw new Error(`元素禁用: ${selector}`); }
  await sleep(120);
  const rect2 = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null; if (el.disabled) return 'disabled';
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
  if (rect2 === null || rect2 === 'disabled') { if (tolerant) return 'disabled'; throw new Error(`点击前元素消失或禁用: ${selector}`); }
  await tap(rect2.x, rect2.y);
  return true;
};
const waitUntil = async (fn, desc, timeoutMs = 20000) => {
  const start = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(300);
  }
};

// ===== 页面贯穿检查 =====
const pageCheck = () => evaluate(`(() => ({
  path: location.pathname,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  errors: window.__errors ?? [],
  swControlled: !!navigator.serviceWorker.controller,
  onLine: navigator.onLine,
}))()`, false);
async function requireClean(pc, where) {
  if (pc.overflow) throw new Error(`${where} 出现横向溢出 (scrollWidth>innerWidth)`);
  if (pc.errors.length) throw new Error(`${where} 出现 JS 错误: ${JSON.stringify(pc.errors)}`);
  log(`${where}: viewport=${pc.viewport.w}x${pc.viewport.h} overflow=false errors=0`);
}

// ===== 首页（数字消除）状态 =====
const homeState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  const anchor = sel => { const a = document.querySelector(sel);
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/\\s+/g, ' '),
      decorAriaHidden: a.querySelector('span')?.getAttribute('aria-hidden') ?? null,
      visible: !!(a.offsetWidth || a.offsetHeight) } : null; };
  return {
    url: location.pathname, selectVisible: !hidden('screen-select'),
    errorVisible: !hidden('screen-error'),
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    hanziAnchor: anchor('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: anchor('#main-nav a[href="/dungeon.html"]'),
    gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
    btnToAvailabilityDisabled: document.getElementById('btn-to-availability')?.disabled,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 地下城状态 =====
const dungeonState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null;
  try { const raw = localStorage.getItem('pixel-academy:arithmetic-dungeon:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  let recordsRaw = null;
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:arithmetic-dungeon:v1:records') ?? 'null'); } catch {}
  let recentIds = null;
  try { recentIds = JSON.parse(localStorage.getItem('pixel-academy:arithmetic-dungeon:v1:recent-ids') ?? 'null'); } catch {}
  return {
    url: location.pathname,
    h1: document.querySelector('main h1')?.textContent ?? null,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    selectVisible: !hidden('screen-select'),
    gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'),
    backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
      return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null; })(),
    gradeCards: [...document.querySelectorAll('#grade-grid button')].map(b => ({
      text: b.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled })),
    availabilityStatus: t('availability-status'),
    startDisabled: document.getElementById('btn-start')?.disabled,
    restoreOfferHidden: hidden('restore-offer'),
    records: [...document.querySelectorAll('#records-list li')].map(li => li.textContent),
    hudRoom: t('hud-room'), hudKeys: t('hud-keys'), hudScore: t('hud-score'),
    roomName: t('room-name'),
    routeButtons: [...document.querySelectorAll('#route-list button')].map(b => ({
      text: b.textContent, locked: b.classList.contains('route-locked'), disabled: b.disabled })),
    questionVisible: !hidden('question-card'),
    slotTitle: t('slot-title'),
    prompt: t('question-prompt'),
    promptExerciseId: document.getElementById('question-prompt')?.dataset.exerciseId ?? null,
    countdown: t('countdown'),
    optionsHidden: hidden('options'),
    optionButtons: [...document.querySelectorAll('#options button')].map(b => ({
      text: b.textContent, disabled: b.disabled, pressed: b.getAttribute('aria-pressed') })),
    inputGroupHidden: hidden('answer-input-group'),
    inputValue: document.getElementById('answer-input')?.value ?? null,
    choiceSubmitHidden: hidden('btn-choice-submit'),
    choiceSubmitDisabled: document.getElementById('btn-choice-submit')?.disabled,
    feedbackHidden: hidden('feedback'),
    feedback: t('feedback'),
    retryHidden: hidden('btn-retry-attempt'),
    swapHidden: hidden('btn-swap'),
    useKeyHidden: hidden('btn-use-key'),
    leaveText: t('btn-leave'),
    pauseOverlayHidden: hidden('pause-overlay'),
    resultTitle: t('result-title'),
    resultScore: t('result-score'),
    resultAnswer: t('result-answer'),
    resultExplore: t('result-explore'),
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    snapshot: snap ? {
      roundId: snap.roundId, room: snap.state?.room, openDoors: snap.state?.openDoors,
      score: snap.state?.score, keys: snap.state?.keys, usedIds: snap.state?.usedIds,
      answeredSlots: snap.state?.answeredSlots,
    } : null,
    recordsRaw, recentIds,
    errors: window.__errors ?? [],
  };
})()`, false);

// 新版档案在 IndexedDB（库 pixel-academy、store profiles、key local）。
const idbProfileSnapshot = () => evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction('profiles', 'readonly');
      const rq = tx.objectStore('profiles').get('local');
      rq.onsuccess = () => { const v = rq.result;
        res(v ? { coins: v.coins, records: (v.records ?? []).length, revision: v.revision } : null); };
      tx.onabort = () => rej(tx.error ?? new Error('idb read aborted'));
    });
  } finally { db.close(); }
})()`);

// ===== 正式池（dist 产物自算答案）=====
let POOL_BY_ID = {};
const installDungeonPool = grades => evaluate(`(async () => {
  const { selectDungeonExercises } = await import('/dist/game/arithmetic-dungeon/content.js');
  const { correctOptionIds, isMultiple, optionText } = await import('/dist/learning/choice.js');
  const { answerFor } = await import('/dist/learning/evaluation.js');
  const picked = selectDungeonExercises(${JSON.stringify(grades)});
  const pool = picked.map(e => ({
    id: e.id, status: e.review.status, kind: e.task.kind,
    options: e.task.kind === 'choice' ? e.task.options.map(o => optionText(o)) : null,
    ids: e.task.kind === 'choice' ? e.task.options.map(o => o.id) : null,
    multiple: e.task.kind === 'choice' ? isMultiple(e.task) : false,
    correct: e.task.kind === 'choice' ? correctOptionIds(e.task) : null,
    answer: e.task.kind === 'choice' ? null : answerFor(e.task),
  }));
  window.__pool = pool;
  return { count: pool.length,
    statuses: [...new Set(pool.map(p => p.status))],
    kinds: pool.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] ?? 0) + 1; return acc; }, {}) };
})()`).then(info => {
  log('正式池:', JSON.stringify(info));
  return info;
});

// 把页面池索引取回驱动侧（tapOption 按索引摸按钮，不必传大对象进页面）。
const syncPool = async () => {
  const pool = await evaluate(`window.__pool`, false);
  if (!Array.isArray(pool) || !pool.length) throw new Error('正式池索引为空');
  POOL_BY_ID = Object.fromEntries(pool.map(p => [p.id, p]));
  return pool.length;
};

// ===== 触摸作答辅助 =====
const tapRoute = prefix => clickAtByRouteText(prefix);
async function clickAtByRouteText(prefix) {
  const ok = await waitUntil(async () => {
    const found = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('#route-list button')];
      const b = btns.find(x => x.textContent.startsWith(${JSON.stringify(prefix)}) && !x.disabled);
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
    if (!found) return null;
    await tap(found.x, found.y);
    return true;
  }, `路线按钮 ${prefix} 可点`, 8000);
  return ok;
}
const tapOptionByIdx = async idx => {
  const found = await evaluate(`(() => {
    const b = document.querySelectorAll('#options button')[${idx}];
    if (!b || b.disabled) return null; const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
  if (!found) throw new Error(`选项按钮 ${idx} 不存在或禁用`);
  await tap(found.x, found.y);
  await sleep(200);
};

// 整数题真实键入：真实触摸聚焦输入框 → 逐字符 Input.insertText（原生 input 事件管线），
// 逐字符记录「开门」按钮 disabled（回归 M12 缺陷 #1 修复：键入实时启用）。
const readSubmitState = () => evaluate(`(() => ({
  inputDisabled: document.getElementById('answer-input')?.disabled ?? null,
  submitDisabled: document.getElementById('btn-input-submit')?.disabled ?? null,
}))()`, false);
async function typeIntegerAnswer(value) {
  await clickAt('#answer-input');
  await sleep(250);
  const before = await readSubmitState();
  const seq = [];
  for (const ch of value) {
    await send('Input.insertText', { text: ch });
    await sleep(140);
    seq.push(await readSubmitState());
  }
  return { disabledBefore: before, disabledSeq: seq, value };
}
// 键盘遮挡处理：软键盘遮住提交按钮时收起（KEYCODE_BACK 仅在按钮被视口裁剪时发送），
// 并等待视觉视口恢复（键盘动画完全结束）——否则收起过程中的点击会被吞。
async function revealSubmitThenTap() {
  const covered = await evaluate(`(() => { const b = document.getElementById('btn-input-submit');
    const vv = window.visualViewport; const r = b.getBoundingClientRect();
    return { covered: vv ? r.bottom > vv.height + 2 : false, bottom: r.bottom, vh: vv ? vv.height : null }; })()`, false);
  if (covered.covered) {
    log(`软键盘遮挡提交按钮（button.bottom=${covered.bottom} > vh=${covered.vh}），收起键盘`);
    await adbShell(['input', 'keyevent', '4']);
    await waitUntil(async () => evaluate(`(() => { const vv = window.visualViewport;
      return vv ? (vv.height >= window.innerHeight - 40 ? true : null) : true; })()`, false), '软键盘收起', 4000);
    await sleep(400);
  }
}
// 点击提交并确认受理（点击被吞时重查重试，最多 3 次；面板已关即视为已受理）。
async function tapSubmitUntilLanded() {
  let lastQ = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const landed0 = submitLanded(lastQ = await dungeonState());
    if (landed0) return landed0;
    const btn = await evaluate(`(() => { const b = document.getElementById('btn-input-submit');
      if (!b || b.disabled) return null; const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
    if (!btn) { // 按钮已不在（面板关闭中）——读末态判定
      const s = await dungeonState(); lastQ = s;
      if (submitLanded(s)) return s;
      break;
    }
    await tap(btn.x, btn.y);
    const landed = await waitUntil(async () => {
      const s = await dungeonState();
      lastQ = s;
      return submitLanded(s);
    }, `提交受理（第 ${attempt} 次点击）`, 2200).catch(() => null);
    if (landed) return landed;
    log(`第 ${attempt} 次提交点击未受理（feedback=${JSON.stringify(lastQ?.feedback ?? null)}），重查重试`);
  }
  return { __notLanded: true, lastState: lastQ };
}
// 提交是否被页面受理：反馈条出现（✓/✗，排除 10 秒超时「时间到」）或面板关闭。
const submitLanded = s => {
  if (s.feedbackHidden === false && !(s.feedback ?? '').includes('时间到')) return s;
  if (!s.questionVisible) return s;
  return null;
};

// 作答当前面板题目（kind 从正式池按 dataset.exerciseId 查得，答案自算）。
async function answerCurrent({ wrong = false } = {}) {
  const st = await dungeonState();
  if (!st.questionVisible) throw new Error('门题面板未打开');
  const id = st.promptExerciseId;
  const task = POOL_BY_ID[id];
  if (!task) throw new Error(`题面 exerciseId 未在正式池匹配: ${id}`);
  if (task.status !== 'approved') throw new Error(`非 approved 题 ${id}: ${task.status}`);
  if (task.kind === 'choice') {
    let wantIds;
    if (task.multiple) {
      wantIds = wrong ? [task.ids.find(x => !task.correct.includes(x))] : [...task.correct];
    } else {
      wantIds = [wrong ? task.ids.find(x => !task.correct.includes(x)) : task.correct[0]];
    }
    if (wantIds.some(x => x === undefined)) throw new Error(`选择题无可用${wrong ? '错' : '对'}项: ${id}`);
    for (const oid of wantIds) await tapOptionByIdx(task.ids.indexOf(oid));
    if (task.multiple) await clickAt('#btn-choice-submit');
    return { kind: task.multiple ? 'choice-multiple' : 'choice-single', id, prompt: st.prompt,
      picked: wantIds, wrong, typed: false };
  }
  const value = wrong ? (task.answer === 0 ? 1 : task.answer - 1) : task.answer;
  const probe = await typeIntegerAnswer(String(value));
  if (probe.disabledSeq.some(s => s.submitDisabled !== false)) {
    throw new Error(`整数题键入后「开门」按钮未实时启用（缺陷 #1 回归）: ${JSON.stringify(probe)}`);
  }
  await revealSubmitThenTap();
  const landed = await tapSubmitUntilLanded();
  if (landed.__notLanded) {
    const s = landed.lastState ?? {};
    throw new Error(`整数题提交未受理（键入值=${value}，末态 feedback=${JSON.stringify(s.feedback ?? null)}，倒计时=${JSON.stringify(s.countdown ?? null)}）${(s.feedback ?? '').includes('时间到') || s.retryHidden === false ? '——超时按答错处理' : '——疑似提交点击被吞或阻断'}`);
  }
  // 提交后收尾：软键盘仍开着则收起（遮挡后续按钮；未开时绝不能发 BACK——会触发浏览器后退）。
  await dismissKeyboardIfOpen();
  return { kind: task.kind, id, prompt: st.prompt, value, wrong, typed: true, probe, feedback: landed.feedback };
}

// 等待房间（空闲探索态）。
const waitRoom = (name, desc = `到达房间 ${name}`) => waitUntil(async () => {
  await wakeUp();
  const s = await dungeonState();
  if (s.pauseOverlayHidden === false) { await clickAt('#btn-resume'); await sleep(500); return null; }
  return s.gameVisible && s.hudRoom === name && !s.questionVisible && !s.resultVisible ? s : null;
}, desc);
// 等待门题/资源机关面板进入计时作答态。
const waitQuestion = (prefix, { notPrompt = null } = {}) => waitUntil(async () => {
  const s = await dungeonState();
  if (!s.gameVisible || !s.questionVisible) return null;
  if (!s.slotTitle?.startsWith(prefix)) return null;
  if (!(s.countdown ?? '').startsWith('剩余')) return null;
  if (notPrompt !== null && s.prompt === notPrompt) return null;
  return s;
}, `门题面板 ${prefix} 可作答`);
const waitResult = () => waitUntil(async () => {
  const s = await dungeonState();
  return s.resultVisible ? s : null;
}, '结算屏');
const waitRetryState = () => waitUntil(async () => {
  const s = await dungeonState();
  return s.gameVisible && s.questionVisible && s.feedbackHidden === false
    && (s.feedback ?? '').startsWith('✗') && s.retryHidden === false ? s : null;
}, '答错待再试状态');
// 软键盘若开着则收起（KEYCODE_BACK 仅在键盘确实打开时发送，否则会触发浏览器后退）。
async function dismissKeyboardIfOpen() {
  const kb = await evaluate(`(() => { const vv = window.visualViewport; return vv ? vv.height < window.innerHeight - 40 : false; })()`, false);
  if (!kb) return false;
  await adbShell(['input', 'keyevent', '4']);
  await waitUntil(async () => evaluate(`(() => { const vv = window.visualViewport;
    return vv ? (vv.height >= window.innerHeight - 40 ? true : null) : true; })()`, false), '软键盘收起', 4000);
  await sleep(300);
  return true;
}
// 资源机关答对后收下钥匙（resolving 窗口内按钮 disabled，重试点击；先收键盘防遮挡）。
async function collectKey() {
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' ? s : null; }, '资源机关解开');
  for (let i = 0; i < 8; i++) {
    await dismissKeyboardIfOpen();
    const r = await clickAt('#btn-leave', { tolerant: true });
    const closed = await waitUntil(async () => { const s = await dungeonState(); return s.gameVisible && !s.questionVisible ? s : null; }, '面板关闭', 2000).catch(() => null);
    if (closed) return { closed, clickAttempts: i + 1, lastClick: r };
    await sleep(400);
  }
  throw new Error('收下钥匙后面板未关闭');
}
// 勾选年级卡（重建坑逐次重查）。
const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click(); })()`, false);
  const s = await dungeonState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want && s.startDisabled === false ? s : null;
}, `勾选年级 ${name}`, 12000);
// 清理地下城残留中断局。
async function discardDungeonResidue() {
  const s = await dungeonState();
  if (s.restoreOfferHidden === false) {
    log('发现地下城残留中断局，放弃之');
    await clickAt('#btn-discard-round');
    await sleep(600);
    await clickAt('#btn-confirm-yes');
    await waitUntil(async () => (await dungeonState()).restoreOfferHidden, '残留局清理', 8000);
  }
}
// 弃当前局（返回 → 确认）。
async function abandonRound(desc) {
  await clickAt('#btn-game-return');
  await sleep(600);
  const s = await dungeonState();
  if (s.confirmOpen) await clickAt('#btn-confirm-yes');
  await waitUntil(async () => (await dungeonState()).selectVisible, desc ?? '弃局回选择屏', 8000);
}

// 开局并保证本局含整数题（peek 快照 usedIds 的题型；无整数题则弃局重开）。
async function startRoundWithInteger({ slotIndex = null } = {}) {
  for (let i = 0; i < 8; i++) {
    await clickAt('#btn-start');
    const room = await waitRoom('起点', `开局起点房（第 ${i + 1} 次）`);
    const used = room.snapshot?.usedIds ?? [];
    const kinds = used.map(id => POOL_BY_ID[id]?.kind ?? 'unknown');
    const idxs = slotIndex === null ? kinds.map((_, j) => j) : [slotIndex];
    if (idxs.some(j => kinds[j] === 'binary' || kinds[j] === 'chain')) {
      log(`第 ${i + 1} 次开局命中整数题: usedIds=${JSON.stringify(used)} kinds=${JSON.stringify(kinds)}`);
      return { room, used, kinds, attempts: i + 1 };
    }
    log(`第 ${i + 1} 次开局无整数题（kinds=${JSON.stringify(kinds)}），弃局重开`);
    await abandonRound(`弃局重开（第 ${i + 1} 次）`);
  }
  throw new Error('8 次开局均未抽到整数题');
}

// ===== 场景台账 =====
const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};
const errorLedger = [];
const overflowLedger = [];
async function checkpoint(where) {
  const pc = await pageCheck();
  overflowLedger.push({ where, overflow: pc.overflow, viewport: pc.viewport });
  if (pc.errors.length) errorLedger.push({ where, errors: pc.errors });
  await requireClean(pc, where);
  return pc;
}

// ============================================================
// 主流程
// ============================================================
await connect();
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
await wakeUp();

if (phase === 'offline') {
  // ===== S3 离线：SW 就绪 → 杀源 → 刷新 → 缓存打开 → 断网过石门（整数题键入提交）=====
  let s3 = null;
  try {
    await send('Page.navigate', { url: `${ORIGIN}/` });
    await sleep(2000);
    await wakeUp();
    await waitUntil(async () => (await homeState()).selectVisible, '在线末尾首页选择屏', 30000);
    // SW 就绪：受控且缓存含 /dungeon.html（新版本未接管时刷新促成 activate）。
    let swInfo = null;
    for (let i = 0; i < 5 && !swInfo; i++) {
      swInfo = await waitUntil(async () => evaluate(`(async () => {
        if (navigator.serviceWorker.controller === null) return null;
        const keys = await caches.keys();
        const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
        if (!name) return null;
        const cache = await caches.open(name);
        const dungeon = await cache.match('/dungeon.html');
        const dungeonCss = await cache.match('/dungeon.css');
        if (!dungeon || !dungeonCss) return null;
        const swEntry = await cache.match('/sw.js');
        const swText = swEntry ? await swEntry.text() : '';
        return { name, dungeonCached: true, dungeonCssCached: true,
          swHasDungeonEntry: swText.includes('/dungeon.html'), swFromCache: !!swEntry };
      })()`), 'SW 就绪且缓存含 /dungeon.html', 15000).catch(() => null);
      if (!swInfo) {
        log(`SW 未就绪（第 ${i + 1} 次），刷新促成新版本接管`);
        await send('Page.reload', { ignoreCache: false });
        await sleep(2500);
        await waitUntil(async () => (await homeState()).selectVisible, '重载后首页选择屏', 30000);
      }
    }
    if (!swInfo) throw new Error('SW 未就绪（缓存缺 /dungeon.html）');
    log('SW:', JSON.stringify(swInfo));
    const pcReady = await checkpoint('S3-SW就绪首页(在线)');
    // 杀源站（若先前场景已断源则 pkill 无进程，本轮自导航起即全程离线、导航由 SW 回退服务）。
    let serverWasAlive = true;
    try { await execFileP('pkill', ['-f', 'serve.mjs 4273']); } catch { serverWasAlive = false; }
    await sleep(1500);
    let sourceDead = false;
    try { await fetch(`${ORIGIN}/sw.js`, { signal: AbortSignal.timeout(3000) }); } catch { sourceDead = true; }
    if (!sourceDead) throw new Error('源站未成功断开');
    log('源站已断开，刷新当前标签页（非冷导航）');
    await send('Page.reload', { ignoreCache: false });
    await waitUntil(async () => { const h = await homeState(); return h.selectVisible && !h.errorVisible ? h : null; }, '断源刷新后首页由缓存打开', 30000);
    const pcOffHome = await checkpoint('S3-离线首页');
    await shot('android-offline-01-home');
    // 菜单 → 地下城（缓存打开）
    await clickAt('#btn-menu');
    await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen && h.dungeonAnchor?.visible ? h : null; }, '断源后菜单');
    await clickAt('#main-nav a[href="/dungeon.html"]');
    await waitUntil(async () => { const s = await dungeonState(); return s.url === '/dungeon.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '断源后地下城由缓存打开', 30000);
    const poolInfo = await installDungeonPool([1]).catch(e => { throw new Error(`断网下题库模块 import 失败（SW 闭包不全）: ${e.message}`); });
    await syncPool();
    const pcOffDungeon = await checkpoint('S3-离线地下城选择屏');
    await shot('android-offline-02-dungeon-select');
    await discardDungeonResidue();
    await toggleGrade('一年级', true);
    const avail = (await dungeonState()).availabilityStatus;
    log('离线可用性文案:', avail);
    // 断网完整探索：逐门作答（整数题即真实键入提交），完整通关一局；
    // 整局未抽到整数题则结算返回后再开（整数题占比 57/1074≈5%，逐门累积命中概率）。
    let offRound = null, offAttempts = 0;
    const tmpShots = [];
    const coinsBeforeOff = await idbProfileSnapshot();
    for (let i = 0; i < 15 && !offRound; i++) {
      offAttempts = i + 1;
      await clickAt('#btn-start');
      const room = await waitRoom('起点', `断网开局（第 ${offAttempts} 次）`);
      const roundId = room.snapshot?.roundId ?? null;
      const steps = [];
      let typedInfo = null;
      const answerSlot = async (label, routePrefix, slotPrefix) => {
        if (routePrefix) { await clickAtByRouteText(routePrefix); await waitQuestion(slotPrefix); }
        const a = await answerCurrent({ wrong: false });
        steps.push({ label, kind: a.kind, id: a.id, prompt: a.prompt, value: a.value ?? null, typed: a.typed });
        if (a.typed && !typedInfo) typedInfo = a;
        return a;
      };
      let shotTaken = false;
      const shotOnce = async () => { if (!shotTaken) { await shot('android-offline-03-offline-explore'); shotTaken = true; } };
      let a = await answerSlot('石门', '石门（锁着）', '石门');
      if (a.typed) await shotOnce(); // 提交受理即刻拍：面板带 ✓ 反馈与键入值
      const junction = await waitRoom('岔口', '断网石门开启到岔口');
      if (junction.hudScore !== '得分 10') throw new Error(`断网石门后得分异常: ${junction.hudScore}`);
      a = await answerSlot('左门', '左门（锁着）', '左门');
      if (a.typed) await shotOnce();
      await waitRoom('资源房', '断网左门开启到资源房');
      a = await answerSlot('资源机关', '解读资源机关', '资源机关');
      if (a.typed) await shotOnce();
      await collectKey();
      await waitRoom('资源房', '断网收下钥匙');
      await clickAtByRouteText('折回岔口');
      await waitRoom('岔口', '断网折回岔口');
      await answerSlot('右门', '右门（锁着）', '右门');
      const result = await waitResult();
      const res = await dungeonState();
      log(`断网第 ${offAttempts} 局结算: ${res.resultScore} ${res.resultAnswer}（整数题键入=${!!typedInfo}）`);
      if (typedInfo) {
        await shotOnce();
        await shot('android-offline-04-offline-result');
      } else {
        const tmpName = `android-offline-tmp-${offAttempts}`; tmpShots.push(tmpName); await shot(tmpName);
      }
      if (typedInfo) {
        offRound = { roundId, steps, typedInfo, result: { score: res.resultScore, answer: res.resultAnswer, explore: res.resultExplore } };
      } else {
        await clickAt('#btn-result-return');
        await waitUntil(async () => (await dungeonState()).selectVisible, `断网第 ${offAttempts} 局返回选择屏`);
      }
    }
    if (!offRound) throw new Error('断网 15 局均未抽到整数题');
    for (const name of tmpShots) { await rm(join(outDir, `${name}.png`), { force: true }); }
    const res3 = (await dungeonState());
    const offScoreOk = offRound.result.score === '总分 40' && offRound.result.answer === '作答 4 题 · 首答 4/4 · 重试 0 次';
    const offExploreOk = offRound.result.explore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
    await clickAt('#btn-result-return');
    await waitUntil(async () => (await dungeonState()).selectVisible, '断网结算返回选择屏');
    const recOff = await dungeonState();
    const recRawOff = (recOff.recordsRaw?.records ?? []).find(r => r.recordId === offRound.roundId) ?? null;
    const recOffOk = recRawOff && recRawOff.gameId === 'arithmetic-dungeon' && recRawOff.score === 40;
    const afterOff = await dungeonState();
    await clickAt('.profile-bar a.btn-ghost');
    await waitUntil(async () => { const h = await homeState(); return h.url === '/' && h.selectVisible ? h : null; }, '断网返回首页', 30000);
    const pcOffBack = await checkpoint('S3-离线返回首页');
    const coinsAfterOff = await idbProfileSnapshot();
    const pcOffExplore = { overflow: recOff.overflowX, errors: recOff.errors };
    await checkpoint('S3-离线结算与记录');
    s3 = { swInfo, pcReady, sourceDead, poolInfo, avail, offAttempts,
      typed: { id: offRound.typedInfo.id, kind: offRound.typedInfo.kind, prompt: offRound.typedInfo.prompt, value: offRound.typedInfo.value,
        probe: offRound.typedInfo.probe },
      steps: offRound.steps, result: offRound.result, offScoreOk, offExploreOk,
      roundId3: offRound.roundId, recRawOff, recOffOk,
      snapshotDiscarded: afterOff.snapshot === null,
      coins: [coinsBeforeOff?.coins, coinsAfterOff?.coins],
      errors: [...pcReady.errors, ...pcOffHome.errors, ...pcOffDungeon.errors, ...pcOffExplore.errors, ...pcOffBack.errors] };
    record('S3 离线断源（缓存打开 + 断网完整探索含整数键入提交）',
      sourceDead && poolInfo.count > 0 && offScoreOk && offExploreOk && recOffOk
        && afterOff.snapshot === null && coinsAfterOff?.coins === coinsBeforeOff?.coins
        && !pcOffHome.overflow && !pcOffDungeon.overflow && !pcOffExplore.overflow
        && pcOffHome.errors.length === 0 && pcOffExplore.errors.length === 0,
      `SW ${swInfo.name} 受控且预缓存含 /dungeon.html（含 /dungeon.css、预缓存 sw.js 清单含 dungeon 入口=${swInfo.swHasDungeonEntry}）；${serverWasAlive ? '杀 serve 4273（源站 fetch 确认失败）后' : '源站已在先前场景断开（本轮自导航起全程离线，导航由 SW 回退服务）'}刷新同一标签页：首页由缓存打开；菜单进 /dungeon.html 由缓存正常加载（6 年级卡、boot-fail 隐藏）；断网下题库模块经 SW 预缓存 import 成功（${poolInfo.count} 题）；选一年级（${avail}）第 ${offAttempts} 次开局完成断网完整探索：${offRound.steps.map(s => `${s.label}「${s.prompt.slice(0, 14)}…」${s.typed ? `逐字符键入 ${s.value}（每字符「开门」实时启用，键入前 disabled=${offRound.typedInfo.probe.disabledBefore.submitDisabled}）点击提交受理` : '选项触摸作答'}`).join('→')}，结算「${offRound.result.score}」「${offRound.result.answer}」「${offRound.result.explore}」（断网整数题键入提交走通且首答档 +10 成立）；离线练习记录新增 1 条（gameId=${recRawOff?.gameId}、score=40）；结算返回后中断快照清除=${afterOff.snapshot === null}；离线金币 ${coinsBeforeOff?.coins} = ${coinsAfterOff?.coins}（零收支）；返回首页正常；全程 JS 错误 0、无横向溢出`,
      { checks: s3 });
  } catch (e) {
    record('S3 离线断源（缓存打开 + 断网完整探索含整数键入提交）', false, `失败: ${e.message}`);
  }
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, errorLedger, overflowLedger,
    allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, 'android-offline-results.json'), JSON.stringify(summary, null, 2));
  log('结果已写入 android-offline-results.json');
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  ws.close();
  process.exitCode = summary.allPassed ? 0 : 1;
  process.exit(process.exitCode);
}

// ===== S1+S2 在线 =====
let s1 = null, s2 = null;
try {
  await send('Page.navigate', { url: `${ORIGIN}/` });
  await sleep(2500);
  await wakeUp();
  await waitUntil(async () => { const h = await homeState(); return h.selectVisible && !h.errorVisible ? h : null; }, '首页选择屏出现', 30000);
  const pc0 = await checkpoint('S1-在线首页');
  log('SW/在线:', JSON.stringify({ sw: pc0.swControlled, onLine: pc0.onLine }));
  await shot('android-online-01-home');
  const coinsBefore = await idbProfileSnapshot();
  log(`IndexedDB 档案局前: coins=${coinsBefore?.coins} records=${coinsBefore?.records} revision=${coinsBefore?.revision}`);

  // S1a：首页菜单「算术地下城」入口
  await clickAt('#btn-menu');
  await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen && h.dungeonAnchor?.visible ? h : null; }, '菜单弹层打开');
  const menu = await homeState();
  await shot('android-online-02-home-menu');
  const entryOk = menu.dungeonAnchor.href === '/dungeon.html' && (menu.dungeonAnchor.text ?? '').includes('算术地下城')
    && menu.dungeonAnchor.decorAriaHidden === 'true' && menu.hanziAnchor?.visible;
  if (!entryOk) throw new Error(`菜单入口异常: ${JSON.stringify({ dungeon: menu.dungeonAnchor, hanzi: menu.hanziAnchor })}`);
  // 进入 dungeon.html
  await clickAt('#main-nav a[href="/dungeon.html"]');
  await waitUntil(async () => { const s = await dungeonState(); return s.url === '/dungeon.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '地下城选择屏就绪', 30000);
  const pcD = await checkpoint('S1-地下城选择屏');
  const poolInfo = await installDungeonPool([1]);
  await syncPool();
  await shot('android-online-03-dungeon-select');
  await discardDungeonResidue();
  const g1 = await toggleGrade('一年级', true);
  const expectAvail = `本层题库：一年级 ${poolInfo.count} 道，共 ${poolInfo.count} 道`;
  if (g1.availabilityStatus !== expectAvail) throw new Error(`可用性文案异常: ${g1.availabilityStatus}`);
  log('可用性文案:', g1.availabilityStatus);
  const dungeonBack = (await dungeonState()).backLink;
  if (dungeonBack?.href !== '/' || !dungeonBack.text.includes('返回数字消除')) throw new Error(`返回链接异常: ${JSON.stringify(dungeonBack)}`);

  // S1b：完整通关局（含整数键入 + choice 点击 + 右门答错换题重试档）
  const picked = await startRoundWithInteger();
  const roundId = picked.room.snapshot?.roundId ?? null;
  let typedOnce = false, choiceOnce = false;
  const play = [];
  const answerOpenSlot = async (label, wrong = false) => {
    const a = await answerCurrent({ wrong });
    if (a.typed) typedOnce = true;
    if (a.kind.startsWith('choice')) choiceOnce = true;
    play.push({ label, ...a, probe: a.probe ? { disabledBefore: a.probe.disabledBefore, disabledSeq: a.probe.disabledSeq } : undefined });
    return a;
  };
  const stepDoor = async (label, routePrefix, slotPrefix, wrong = false) => {
    await clickAtByRouteText(routePrefix);
    await waitQuestion(slotPrefix);
    return answerOpenSlot(label, wrong);
  };
  // 石门（首答对）
  await stepDoor('石门', '石门（锁着）', '石门');
  const junction = await waitRoom('岔口', '石门开启到岔口');
  if (junction.hudScore !== '得分 10') throw new Error(`岔口得分异常: ${junction.hudScore}`);
  // 左门（首答对）
  await stepDoor('左门', '左门（锁着）', '左门');
  const resource = await waitRoom('资源房', '左门开启到资源房');
  if (resource.hudScore !== '得分 20') throw new Error(`资源房前得分异常: ${resource.hudScore}`);
  // 资源题（取得钥匙）
  await stepDoor('资源机关', '解读资源机关', '资源机关');
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' ? s : null; }, '资源机关解开');
  const withKey = await dungeonState();
  if (withKey.hudKeys !== '备用钥匙 1/1' || withKey.hudScore !== '得分 30') throw new Error(`钥匙后 HUD 异常: ${withKey.hudKeys} ${withKey.hudScore}`);
  const leaveInfo = await collectKey();
  await waitRoom('资源房', '收下钥匙留在资源房');
  await shot('android-online-04-resource-key');
  // 折回岔口 → 右门：故意答错 → 换一题 → 重试档答对
  await clickAtByRouteText('折回岔口');
  await waitRoom('岔口', '折回岔口');
  await stepDoor('右门-答错', '右门（锁着）', '右门', true);
  const retry = await waitRetryState();
  if (retry.hudScore !== '得分 30') throw new Error(`答错后扣分了: ${retry.hudScore}`);
  const wrongPrompt = retry.prompt;
  await shot('android-online-05-right-wrong');
  await clickAt('#btn-swap');
  const swapped = await waitQuestion('右门', { notPrompt: wrongPrompt });
  const swapId = POOL_BY_ID[swapped.promptExerciseId]?.id;
  const wrongId = play[play.length - 1].id;
  if (swapId === wrongId) throw new Error('换一题未换题');
  await answerOpenSlot('右门-换题后');
  const result = await waitResult();
  await shot('android-online-06-result');
  const res = await dungeonState();
  const scoreOk = res.resultScore === '总分 35' && res.resultTitle === '通关！';
  const answerOk = res.resultAnswer === '作答 4 题 · 首答 3/4 · 重试 1 次';
  const exploreOk = res.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
  if (!typedOnce || !choiceOnce) throw new Error(`场景要求未满足: 整数键入=${typedOnce} choice=${choiceOnce}`);
  await checkpoint('S1-结算屏');
  // 记录核对
  await clickAt('#btn-result-return');
  await waitUntil(async () => (await dungeonState()).selectVisible, '返回选择屏');
  const rec = await dungeonState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === roundId) ?? null;
  const recOk = recRaw && recRaw.gameId === 'arithmetic-dungeon' && recRaw.score === 35
    && recRaw.answer?.questions?.length === 4 && recRaw.explore?.keyUses === 0 && recRaw.explore?.retries === 1
    && JSON.stringify(recRaw.explore?.route) === JSON.stringify(['start', 'junction', 'resource', 'junction', 'end'])
    && rec.records.some(r => r.includes('35 分 · 首答 3/4 · 重试 1'));
  const recentOk = Array.isArray(rec.recentIds) && recRaw && recRaw.answer.questions
    .every(q => rec.recentIds.includes(q.exerciseId));
  const coinsAfter = await idbProfileSnapshot();
  const coinsOk = coinsAfter?.coins === coinsBefore?.coins;
  await shot('android-online-07-records');
  await checkpoint('S1-记录列表');
  const allApproved = play.every(p => POOL_BY_ID[p.id]?.status === 'approved');
  s1 = { entry: { dungeon: menu.dungeonAnchor, hanzi: menu.hanziAnchor }, availability: g1.availabilityStatus,
    poolCount: poolInfo.count, picked: { attempts: picked.attempts, kinds: picked.kinds, roundId },
    play: play.map(p => ({ label: p.label, kind: p.kind, id: p.id, prompt: p.prompt, value: p.value ?? null, wrong: p.wrong, typed: p.typed })),
    result: { score: res.resultScore, answer: res.resultAnswer, explore: res.resultExplore },
    recOk, recentOk, coinsBefore, coinsAfter, coinsOk, allApproved,
    leaveClickAttempts: leaveInfo.clickAttempts, errors: rec.errors, overflow: rec.overflowX };
  record('S1 在线完整通关局（整数键入 + choice 触摸 + 答错换题重试档）',
    scoreOk && answerOk && exploreOk && recOk && recentOk && coinsOk && allApproved && typedOnce && choiceOnce
      && rec.errors.length === 0 && !rec.overflowX,
    `菜单「算术地下城」入口（href=/dungeon.html、装饰字 aria-hidden）进入地下城；勾一年级→「${g1.availabilityStatus}」与 dist 层一致（${poolInfo.count} 题全 approved）；第 ${picked.attempts} 次开局（kinds=${JSON.stringify(picked.kinds)}）：石门「${play[0].prompt}」→岔口（得分 10）→左门「${play[1].prompt}」→资源房（得分 20）→资源机关「${play[2].prompt}」→钥匙 1/1（收下钥匙点击 ${leaveInfo.clickAttempts} 次）→折回岔口→右门「${wrongPrompt.slice(0, 16)}…」故意答错（✗、不解锁、得分仍 30）→「换一题」换为「${swapped.prompt.slice(0, 16)}…」→答对（重试档 +5）→结算「${res.resultScore}」「${res.resultAnswer}」「${res.resultExplore}」与计分规则逐项吻合（10+10+10+5=35）；作答含整数题真实键入提交=${typedOnce}（键入实时启用「开门」）、choice 触摸作答=${choiceOnce}；练习记录新增 1 条（gameId=${recRaw?.gameId}、recordId=roundId、score=35、keyUses=0、route 完整）且列表显示「35 分 · 首答 3/4 · 重试 1」；recent-ids 含本局全部题目 ID=${recentOk}；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；JS 错误 ${rec.errors.length}、无横向溢出`,
    { checks: s1 });

  // S2 返回路径：地下城 → 返回数字消除 → 可选年级；菜单三入口并存
  await clickAt('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const h = await homeState(); return h.url === '/' && h.selectVisible ? h : null; }, '返回数字消除首页', 20000);
  await checkpoint('S2-返回后首页');
  // 数字消除可选年级（勾选重建逐次重查）
  let npOk = false;
  for (let round = 0; round < 8 && !npOk; round++) {
    await evaluate(`(() => { const inputs = [...document.querySelectorAll('input[name=grade]')];
      const input = inputs.find(i => i.value === '1');
      if (input && !input.checked) input.click(); })()`, false);
    await sleep(600);
    const h = await homeState();
    npOk = h.gradeChecked.includes('1') && h.btnToAvailabilityDisabled === false;
  }
  if (!npOk) throw new Error('数字消除年级勾选未稳定');
  // 还原勾选
  await evaluate(`(() => { const input = [...document.querySelectorAll('input[name=grade]')].find(i => i.value === '1');
    if (input && input.checked) input.click(); })()`, false);
  await sleep(300);
  // 菜单三入口并存（数字消除为当前页 + 两游戏锚点）
  await clickAt('#btn-menu');
  await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen ? h : null; }, '返回后菜单弹层');
  const menu2 = await homeState();
  await shot('android-online-08-home-returned-menu');
  const threeOk = menu2.hanziAnchor?.visible && menu2.dungeonAnchor?.visible
    && menu2.hanziAnchor.href === '/hanzi.html' && menu2.dungeonAnchor.href === '/dungeon.html';
  await checkpoint('S2-菜单三入口');
  const pcFinal = await pageCheck();
  s2 = { npOk, threeOk, menu: { hanzi: menu2.hanziAnchor, dungeon: menu2.dungeonAnchor }, errors: pcFinal.errors, overflow: pcFinal.overflow };
  record('S2 返回路径与三入口并存', npOk && threeOk && pcFinal.errors.length === 0 && !pcFinal.overflow,
    `地下城顶栏「${dungeonBack.text}」返回数字消除首页；勾选一年级→下一步按钮启用（可选年级），取消复原；菜单弹层内「汉字勇者」（href=/hanzi.html）与「算术地下城」（href=/dungeon.html）两锚点并存可见（数字消除为当前页）；JS 错误 ${pcFinal.errors.length}、无横向溢出`,
    { checks: s2 });
} catch (e) {
  record('S1/S2 在线流程', false, `失败: ${e.message}`);
}

const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, errorLedger, overflowLedger,
  allPassed: scenarios.every(s => s.pass) };
await writeFile(join(outDir, 'android-online-results.json'), JSON.stringify(summary, null, 2));
log('结果已写入 android-online-results.json');
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exitCode = summary.allPassed ? 0 : 1;
process.exit(process.exitCode);
