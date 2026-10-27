// iOS 模拟器 Safari M12 验证（算术地下城，口径对齐 M8 device-simulators/ios-round.mjs，
// 地下城玩法断言对齐 M12 桌面 dungeon-browser.mjs / fix 轮与 Android 轮 android-round.mjs）。
// 前置：iPhone 16 Pro / iOS 18.6 模拟器（UDID 28F2F0F0-…；iOS 27.0 运行时 safaridriver 无法创建
// 会话，不可用）；safaridriver -p 4801 已运行；node scripts/serve.mjs 4373（在线阶段）已启动。
// 会话能力必须含 platformName iOS + safari:useSimulator true（UA 含 iPhone 确认，否则静默回退
// macOS Safari）。safaridriver 对 iOS 模拟器 HID 注入不完整（M7 实测），输入口径与 M3–M8 同：
// DOM 控件 execute 内 el.click()；整数题键入为合成输入（execute 设 input.value + dispatch input
// 事件，与 el.click 同口径，如实记录，非物理键盘输入）。答案一律从页面题面
// （#question-prompt 的 dataset.exerciseId）经 dist 判题模块自算，不注入任何游戏状态。
// 覆盖：S1 在线完整通关局（≥1 道整数题合成键入提交 + ≥1 道选择题点击 + 右门故意答错→「换一题」
// 重试档 +5，结算 35，记录 gameId=arithmetic-dungeon，金币零变化）→ S2 返回路径与三入口并存
// → S3 离线（SW 受控→杀源→Safari 刷新非冷导航，首页与 /dungeon.html 由缓存打开，断网完整探索
// 含整数题键入提交）→ S4 贯穿（横向溢出与 JS 错误台账）。
// 已知 WebKit 行为：iOS 冷导航离线打开受控源落系统错误页；本脚本全程用「受控后断源刷新」口径。
// 用法：node ios-round.mjs online|offline [输出目录]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const execFileP = promisify(execFile);
const phase = process.argv[2] ?? 'online';
const UDID = '28F2F0F0-4732-4493-816A-A382DCBF329A';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4373/';
const WD = process.env.WD_PORT ? `http://127.0.0.1:${process.env.WD_PORT}` : 'http://127.0.0.1:4801';
const outDir = process.argv[3] ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

const log = (...a) => console.log(`[ios-${phase}]`, ...a);
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
// Safari 的 execute/sync 会等待返回的 Promise（M7 实测），统一走 sync 端点。
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
const clickRouteByPrefix = async prefix => {
  const ok = await waitUntil(async () => {
    const found = await evalSync(`(() => {
      const btns = [...document.querySelectorAll('#route-list button')];
      const b = btns.find(x => x.textContent.startsWith(${JSON.stringify(prefix)}) && !x.disabled);
      if (!b) return null; b.click(); return true; })()`);
    return found ?? null;
  }, `路线按钮 ${prefix} 可点`, 8000);
  return ok;
};
// simctl 截图无权限直写工作区：先落 /tmp 再拷贝（本机实测坑，M8 同口径）。
const shot = async name => {
  const frame = `/tmp/ios-m12-${Date.now()}.png`;
  await execFileP('xcrun', ['simctl', 'io', UDID, 'screenshot', frame]);
  await writeFile(join(outDir, `${name}.png`), await readFile(frame));
  await rm(frame, { force: true });
  log('截图', name);
};

// ===== JS 错误 / 横向溢出台账（S4 贯穿检查；每次导航后重装收集器） =====
const INJECT = `(() => { window.__errors = window.__errors ?? [];
  addEventListener('error', e => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));
  return true; })()`;
const errorLedger = [];
const overflowLedger = [];
async function collectErrors(where) {
  const errs = await evalSync(`(window.__errors ?? []).slice()`);
  if (errs.length) errorLedger.push({ where, errors: errs });
  return errs;
}
async function checkpoint(where) {
  const o = await evalSync(`document.documentElement.scrollWidth > window.innerWidth`);
  overflowLedger.push({ where, overflow: !!o });
  if (o) throw new Error(`${where} 出现横向溢出`);
  const errs = await collectErrors(where);
  if (errs.length) throw new Error(`${where} 出现 JS 错误: ${JSON.stringify(errs)}`);
  log(`${where}: overflow=false errors=0`);
  return { overflow: false, errors: errs };
}
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

// ===== 首页（数字消除）状态 =====
const homeCheck = () => evalSync(`(() => {
  const q = s => document.querySelector(s);
  if (!q('#screen-select')) return null;
  const a = q('#main-nav a[href="/dungeon.html"]');
  const h = q('#main-nav a[href="/hanzi.html"]');
  return {
    url: location.pathname,
    select: !q('#screen-select').hidden,
    error: !q('#screen-error')?.hidden,
    menuOpen: q('#menu-dialog')?.open ?? false,
    dungeonAnchor: a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/\\s+/g, ' '),
      decorAriaHidden: a.querySelector('span')?.getAttribute('aria-hidden') ?? null,
      visible: !!(a.offsetWidth || a.offsetHeight) } : null,
    hanziAnchor: h ? { href: h.getAttribute('href'), text: h.textContent.trim().replace(/\\s+/g, ' '), visible: !!(h.offsetWidth || h.offsetHeight) } : null,
    gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
    btnToAvailabilityDisabled: q('#btn-to-availability')?.disabled,
    offlineNotice: q('#offline-notice')?.hidden ? '' : q('#offline-notice')?.textContent ?? '',
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  };
})()`);
// 数字消除档案（IndexedDB pixel-academy / profiles / local），M7/M8 同口径。
const idbProfileSnapshot = () => evalAsync(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('profiles', 'readonly');
  const req = tx.objectStore('profiles').get('local');
  const p = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  return p ? { coins: p.coins, records: (p.records ?? []).length, revision: p.revision } : null;
})()`);

// ===== 地下城状态 =====
const dungeonState = () => evalSync(`(() => {
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
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    snapshot: snap ? { roundId: snap.roundId, room: snap.state?.room, openDoors: snap.state?.openDoors,
      score: snap.state?.score, keys: snap.state?.keys, usedIds: snap.state?.usedIds } : null,
    recordsRaw, recentIds,
    errors: window.__errors ?? [],
  };
})()`);

// ===== 正式池（dist 产物自算答案）=====
let POOL_BY_ID = {};
const installDungeonPool = async grades => {
  const info = await evalAsync(`(async () => {
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
  })()`);
  log('正式池:', JSON.stringify(info));
  const pool = await evalSync(`window.__pool`);
  if (!Array.isArray(pool) || !pool.length) throw new Error('正式池索引为空');
  POOL_BY_ID = Object.fromEntries(pool.map(p => [p.id, p]));
  return info;
};

// ===== 作答辅助 =====
const tapOptionByIdx = async idx => {
  const ok = await evalSync(`(() => {
    const b = document.querySelectorAll('#options button')[${idx}];
    if (!b || b.disabled) return null; b.click(); return true; })()`);
  if (!ok) throw new Error(`选项按钮 ${idx} 不存在或禁用`);
  await sleep(200);
};
// 整数题合成键入：execute 设 input.value + dispatch input 事件（与 el.click 同口径的合成输入，
// 如实记录，非物理键盘输入；safaridriver 对 iOS 模拟器 HID 注入不完整，M7 已实测），
// 记录键入前后「开门」按钮 disabled（回归 M12 缺陷 #1 修复：input 事件实时联动）。
async function typeIntegerAnswer(value) {
  const probe = await evalSync(`(() => {
    const input = document.getElementById('answer-input');
    const btn = document.getElementById('btn-input-submit');
    if (!input || !btn) return null;
    const before = { inputDisabled: input.disabled, submitDisabled: btn.disabled };
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const after = { inputDisabled: input.disabled, submitDisabled: btn.disabled, inputValue: input.value };
    return { before, after };
  })()`);
  if (!probe) throw new Error('整数输入框或开门按钮不存在');
  return probe;
}
const submitLanded = s => {
  if (s.feedbackHidden === false && !(s.feedback ?? '').includes('时间到')) return s;
  if (!s.questionVisible) return s;
  return null;
};
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
    if (task.multiple) await clickEl('#btn-choice-submit');
    return { kind: task.multiple ? 'choice-multiple' : 'choice-single', id, prompt: st.prompt,
      picked: wantIds, wrong, typed: false };
  }
  const value = wrong ? (task.answer === 0 ? 1 : task.answer - 1) : task.answer;
  const probe = await typeIntegerAnswer(String(value));
  if (probe.after.submitDisabled !== false) {
    throw new Error(`整数题合成键入后「开门」按钮未启用（缺陷 #1 回归）: ${JSON.stringify(probe)}`);
  }
  await clickEl('#btn-input-submit');
  const landed = await waitUntil(async () => {
    const s = await dungeonState();
    return submitLanded(s);
  }, '整数题提交受理', 5000).catch(() => null);
  if (!landed) {
    const s = await dungeonState();
    throw new Error(`整数题提交未受理（键入值=${value}，末态 feedback=${JSON.stringify(s.feedback ?? null)}，倒计时=${JSON.stringify(s.countdown ?? null)}）`);
  }
  return { kind: task.kind, id, prompt: st.prompt, value, wrong, typed: true, probe, feedback: landed.feedback };
}

// 等待房间（空闲探索态）。
const waitRoom = (name, desc = `到达房间 ${name}`) => waitUntil(async () => {
  const s = await dungeonState();
  if (s.pauseOverlayHidden === false) { await clickEl('#btn-resume'); await sleep(500); return null; }
  return s.gameVisible && s.hudRoom === name && !s.questionVisible && !s.resultVisible ? s : null;
}, desc);
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
// 资源机关答对后收下钥匙（resolving 窗口内按钮 disabled，重试点击）。
async function collectKey() {
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' ? s : null; }, '资源机关解开');
  for (let i = 0; i < 8; i++) {
    const r = await clickEl('#btn-leave', { tolerant: true });
    const closed = await waitUntil(async () => { const s = await dungeonState(); return s.gameVisible && !s.questionVisible ? s : null; }, '面板关闭', 2000).catch(() => null);
    if (closed) return { closed, clickAttempts: i + 1, lastClick: r };
    await sleep(400);
  }
  throw new Error('收下钥匙后面板未关闭');
}
const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evalSync(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click();
    return true; })()`);
  const s = await dungeonState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want && s.startDisabled === false ? s : null;
}, `勾选年级 ${name}`, 12000);
async function discardDungeonResidue() {
  const s = await dungeonState();
  if (s.restoreOfferHidden === false) {
    log('发现地下城残留中断局，放弃之');
    await clickEl('#btn-discard-round');
    await sleep(600);
    await clickEl('#btn-confirm-yes');
    await waitUntil(async () => (await dungeonState()).restoreOfferHidden, '残留局清理', 8000);
  }
}
async function abandonRound(desc) {
  await clickEl('#btn-game-return');
  await sleep(600);
  const s = await dungeonState();
  if (s.confirmOpen) await clickEl('#btn-confirm-yes');
  await waitUntil(async () => (await dungeonState()).selectVisible, desc ?? '弃局回选择屏', 8000);
}
// 开局并保证本局含整数题（peek 快照 usedIds 的题型；无整数题则弃局重开）。
async function startRoundWithInteger() {
  for (let i = 0; i < 10; i++) {
    await clickEl('#btn-start');
    const room = await waitRoom('起点', `开局起点房（第 ${i + 1} 次）`);
    const used = room.snapshot?.usedIds ?? [];
    const kinds = used.map(id => POOL_BY_ID[id]?.kind ?? 'unknown');
    if (kinds.some(k => k === 'binary' || k === 'chain')) {
      log(`第 ${i + 1} 次开局命中整数题: kinds=${JSON.stringify(kinds)}`);
      return { room, used, kinds, attempts: i + 1 };
    }
    log(`第 ${i + 1} 次开局无整数题（kinds=${JSON.stringify(kinds)}），弃局重开`);
    await abandonRound(`弃局重开（第 ${i + 1} 次）`);
  }
  throw new Error('10 次开局均未抽到整数题');
}

// ===== 场景台账 =====
const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

// ===== 主流程 =====
try {
await wd('POST', `${base}/timeouts`, { implicit: 0, pageLoad: 30000, script: 30000 });
const ua = await evalSync(`navigator.userAgent`);
const udidReported = session.capabilities?.['safari:deviceUDID'] ?? null;
log('UA:', ua);
const simOk = ua.includes('iPhone') && udidReported === UDID;
if (!simOk) throw new Error(`会话未落在目标 iOS 模拟器: UA=${ua} UDID=${udidReported}`);

if (phase === 'offline') {
  // ===== S3 离线（断源刷新口径）：SW 受控 → 杀源 → Safari 刷新 → 缓存打开 → 断网完整探索 =====
  let s3 = null;
  try {
    await wd('POST', `${base}/url`, { url: ORIGIN });
    await sleep(2500);
    await waitUntil(async () => (await homeCheck())?.select, '在线末尾首页选择屏', 30000);
    await evalSync(INJECT);
    // SW 受控且缓存含 /dungeon.html（新版本未接管时刷新促成 activate）。
    let swInfo = null;
    for (let i = 0; i < 5 && !swInfo; i++) {
      swInfo = await waitUntil(async () => evalAsync(`(async () => {
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
        await wd('POST', `${base}/refresh`).catch(e => log('refresh 报错（继续等待）:', e.message.slice(0, 120)));
        await sleep(2500);
        await waitUntil(async () => (await homeCheck())?.select, '重载后首页选择屏', 30000);
        await evalSync(INJECT);
      }
    }
    if (!swInfo) throw new Error('SW 未就绪（缓存缺 /dungeon.html）');
    log('SW:', JSON.stringify(swInfo));
    await checkpoint('S3-SW就绪首页(在线)');
    // 杀源站（若先前场景已断源则 pkill 无进程）
    let serverWasAlive = true;
    try { await execFileP('pkill', ['-f', 'serve.mjs 4373']); } catch { serverWasAlive = false; }
    await sleep(1500);
    let sourceDead = false;
    try { await fetch(`${ORIGIN}sw.js`, { signal: AbortSignal.timeout(3000) }); } catch { sourceDead = true; }
    if (!sourceDead) throw new Error('源站未成功断开');
    log('源站已断开，刷新当前标签页（非冷导航）');
    await wd('POST', `${base}/refresh`).catch(e => log('refresh 报错（继续等待）:', e.message.slice(0, 120)));
    await waitUntil(async () => { const h = await homeCheck(); return h?.select && !h.error ? h : null; }, '断源刷新后首页由缓存打开', 40000);
    await evalSync(INJECT);
    const offHome = await homeCheck();
    await checkpoint('S3-离线首页');
    await shot('ios-offline-01-home');
    // 菜单 → 地下城（缓存打开）
    await clickEl('#btn-menu');
    await waitUntil(async () => { const h = await homeCheck(); return h.menuOpen && h.dungeonAnchor?.visible ? h : null; }, '断源后菜单');
    await clickEl('#main-nav a[href="/dungeon.html"]');
    await waitUntil(async () => { const s = await dungeonState(); return s.url === '/dungeon.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '断源后地下城由缓存打开', 30000);
    await evalSync(INJECT);
    const poolInfo = await installDungeonPool([1]).catch(e => { throw new Error(`断网下题库模块 import 失败（SW 闭包不全）: ${e.message}`); });
    await checkpoint('S3-离线地下城选择屏');
    await shot('ios-offline-02-dungeon-select');
    await discardDungeonResidue();
    const g1 = await toggleGrade('一年级', true);
    log('离线可用性文案:', g1.availabilityStatus);
    // 断网完整探索：逐门作答（整数题即合成键入提交），完整通关一局；整局无整数题则结算返回后再开。
    let offRound = null, offAttempts = 0, shotTaken = false;
    const shotOnce = async () => { if (!shotTaken) { await shot('ios-offline-03-offline-explore'); shotTaken = true; } };
    const coinsBeforeOff = await idbProfileSnapshot();
    for (let i = 0; i < 15 && !offRound; i++) {
      offAttempts = i + 1;
      await clickEl('#btn-start');
      const room = await waitRoom('起点', `断网开局（第 ${offAttempts} 次）`);
      const roundId = room.snapshot?.roundId ?? null;
      const steps = [];
      let typedInfo = null;
      const answerSlot = async (label, routePrefix, slotPrefix) => {
        if (routePrefix) { await clickRouteByPrefix(routePrefix); await waitQuestion(slotPrefix); }
        const a = await answerCurrent({ wrong: false });
        steps.push({ label, kind: a.kind, id: a.id, prompt: a.prompt, value: a.value ?? null, typed: a.typed });
        if (a.typed && !typedInfo) typedInfo = a;
        return a;
      };
      let a = await answerSlot('石门', '石门（锁着）', '石门');
      if (a.typed) await shotOnce();
      const junction = await waitRoom('岔口', '断网石门开启到岔口');
      if (junction.hudScore !== '得分 10') throw new Error(`断网石门后得分异常: ${junction.hudScore}`);
      a = await answerSlot('左门', '左门（锁着）', '左门');
      if (a.typed) await shotOnce();
      await waitRoom('资源房', '断网左门开启到资源房');
      a = await answerSlot('资源机关', '解读资源机关', '资源机关');
      if (a.typed) await shotOnce();
      await collectKey();
      await waitRoom('资源房', '断网收下钥匙');
      await clickRouteByPrefix('折回岔口');
      await waitRoom('岔口', '断网折回岔口');
      a = await answerSlot('右门', '右门（锁着）', '右门');
      if (a.typed) await shotOnce();
      await waitResult();
      const res = await dungeonState();
      log(`断网第 ${offAttempts} 局结算: ${res.resultScore} ${res.resultAnswer}（整数题键入=${!!typedInfo}）`);
      if (typedInfo) {
        await shotOnce();
        await shot('ios-offline-04-offline-result');
        offRound = { roundId, steps, typedInfo: { id: typedInfo.id, kind: typedInfo.kind, prompt: typedInfo.prompt, value: typedInfo.value, probe: typedInfo.probe },
          result: { score: res.resultScore, answer: res.resultAnswer, explore: res.resultExplore } };
      } else {
        await clickEl('#btn-result-return');
        await waitUntil(async () => (await dungeonState()).selectVisible, `断网第 ${offAttempts} 局返回选择屏`);
      }
    }
    if (!offRound) throw new Error('断网 15 局均未抽到整数题');
    const offScoreOk = offRound.result.score === '总分 40' && offRound.result.answer === '作答 4 题 · 首答 4/4 · 重试 0 次';
    const offExploreOk = offRound.result.explore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
    await clickEl('#btn-result-return');
    await waitUntil(async () => (await dungeonState()).selectVisible, '断网结算返回选择屏');
    const recOff = await dungeonState();
    const recRawOff = (recOff.recordsRaw?.records ?? []).find(r => r.recordId === offRound.roundId) ?? null;
    const recOffOk = recRawOff && recRawOff.gameId === 'arithmetic-dungeon' && recRawOff.score === 40;
    await checkpoint('S3-离线结算与记录');
    const afterOff = await dungeonState();
    await clickEl('.profile-bar a.btn-ghost');
    await waitUntil(async () => { const h = await homeCheck(); return h?.url === '/' && h.select ? h : null; }, '断网返回首页', 30000);
    await evalSync(INJECT);
    await checkpoint('S3-离线返回首页');
    const coinsAfterOff = await idbProfileSnapshot();
    s3 = { swInfo, sourceDead, serverWasAlive, poolInfo, avail: g1.availabilityStatus, offAttempts,
      typed: offRound.typedInfo, steps: offRound.steps, result: offRound.result, offScoreOk, offExploreOk,
      roundId3: offRound.roundId, recRawOff, recOffOk, snapshotDiscarded: afterOff.snapshot === null,
      coins: [coinsBeforeOff?.coins, coinsAfterOff?.coins],
      offlineNoticeHome: offHome.offlineNotice };
    record('S3 离线断源刷新（缓存打开 + 断网完整探索含整数合成键入提交）',
      sourceDead && poolInfo.count > 0 && offScoreOk && offExploreOk && recOffOk
        && afterOff.snapshot === null && coinsAfterOff?.coins === coinsBeforeOff?.coins,
      `SW ${swInfo.name} 受控且预缓存含 /dungeon.html（含 /dungeon.css，sw.js 本体不进预缓存故清单断言=缓存外核验）；${serverWasAlive ? '杀 serve 4373（源站 fetch 确认失败）后' : '源站已在先前场景断开'}Safari 刷新同一标签页（非冷导航）：首页由缓存打开${offHome.offlineNotice ? `（提示「${offHome.offlineNotice}」）` : ''}；菜单进 /dungeon.html 由缓存正常加载（6 年级卡、boot-fail 隐藏）；断网下题库模块经 SW 预缓存 import 成功（${poolInfo.count} 题）；选一年级（${g1.availabilityStatus}）第 ${offAttempts} 次开局完成断网完整探索：${offRound.steps.map(s => `${s.label}「${s.prompt.slice(0, 14)}…」${s.typed ? `合成键入 ${s.value}（input 事件实时启用「开门」，键入前 disabled=${offRound.typedInfo.probe.before.submitDisabled}）点击提交受理` : '选项点击作答'}`).join('→')}，结算「${offRound.result.score}」「${offRound.result.answer}」「${offRound.result.explore}」（断网整数题键入提交走通且首答档 +10 成立）；离线练习记录新增 1 条（gameId=${recRawOff?.gameId}、score=40）；结算返回后中断快照清除=${afterOff.snapshot === null}；离线金币 ${coinsBeforeOff?.coins} = ${coinsAfterOff?.coins}（零收支）；全程无溢出、JS 错误 0`,
      { checks: s3 });
  } catch (e) {
    record('S3 离线断源刷新（缓存打开 + 断网完整探索含整数合成键入提交）', false, `失败: ${e.message}`);
  }
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, udid: UDID, wdEndpoint: WD,
    userAgent: ua, scenarios, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, 'ios-offline-results.json'), JSON.stringify(summary, null, 2));
  log('结果已写入 ios-offline-results.json');
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  process.exitCode = summary.allPassed ? 0 : 1;
} else {
// ===== S1+S2 在线 =====
let s1 = null, s2 = null;
try {
  await wd('POST', `${base}/url`, { url: ORIGIN });
  await sleep(2500);
  await waitUntil(async () => { const h = await homeCheck(); return h?.select && !h.error ? h : null; }, '首页选择屏就绪', 30000);
  await evalSync(INJECT);
  await checkpoint('S1-在线首页');
  await shot('ios-online-01-home');
  const coinsBefore = await idbProfileSnapshot();
  log(`IndexedDB 档案局前: coins=${coinsBefore?.coins} records=${coinsBefore?.records} revision=${coinsBefore?.revision}`);
  // S1a：首页菜单「算术地下城」入口
  await clickEl('#btn-menu');
  await waitUntil(async () => { const h = await homeCheck(); return h.menuOpen && h.dungeonAnchor?.visible ? h : null; }, '菜单弹层打开');
  const menu = await homeCheck();
  await shot('ios-online-02-home-menu');
  const entryOk = menu.dungeonAnchor.href === '/dungeon.html' && (menu.dungeonAnchor.text ?? '').includes('算术地下城')
    && menu.dungeonAnchor.decorAriaHidden === 'true' && menu.hanziAnchor?.visible;
  if (!entryOk) throw new Error(`菜单入口异常: ${JSON.stringify({ dungeon: menu.dungeonAnchor, hanzi: menu.hanziAnchor })}`);
  await clickEl('#main-nav a[href="/dungeon.html"]');
  await waitUntil(async () => { const s = await dungeonState(); return s.url === '/dungeon.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '地下城选择屏就绪', 30000);
  await evalSync(INJECT);
  const poolInfo = await installDungeonPool([1]);
  await checkpoint('S1-地下城选择屏');
  await shot('ios-online-03-dungeon-select');
  await discardDungeonResidue();
  const g1 = await toggleGrade('一年级', true);
  const expectAvail = `本层题库：一年级 ${poolInfo.count} 道，共 ${poolInfo.count} 道`;
  if (g1.availabilityStatus !== expectAvail) throw new Error(`可用性文案异常: ${g1.availabilityStatus}`);
  log('可用性文案:', g1.availabilityStatus);
  const dungeonBack = (await dungeonState()).backLink;
  if (dungeonBack?.href !== '/' || !dungeonBack.text.includes('返回数字消除')) throw new Error(`返回链接异常: ${JSON.stringify(dungeonBack)}`);

  // S1b：完整通关局（整数合成键入 + choice 点击 + 右门答错换题重试档）
  const picked = await startRoundWithInteger();
  const roundId = picked.room.snapshot?.roundId ?? null;
  let typedOnce = false, choiceOnce = false;
  const play = [];
  const answerOpenSlot = async (label, wrong = false) => {
    const a = await answerCurrent({ wrong });
    if (a.typed) typedOnce = true;
    if (a.kind.startsWith('choice')) choiceOnce = true;
    play.push({ label, ...a, probe: a.probe ? { before: a.probe.before, after: a.probe.after } : undefined });
    return a;
  };
  const stepDoor = async (label, routePrefix, slotPrefix, wrong = false) => {
    await clickRouteByPrefix(routePrefix);
    await waitQuestion(slotPrefix);
    return answerOpenSlot(label, wrong);
  };
  await stepDoor('石门', '石门（锁着）', '石门');
  const junction = await waitRoom('岔口', '石门开启到岔口');
  if (junction.hudScore !== '得分 10') throw new Error(`岔口得分异常: ${junction.hudScore}`);
  await stepDoor('左门', '左门（锁着）', '左门');
  const resource = await waitRoom('资源房', '左门开启到资源房');
  if (resource.hudScore !== '得分 20') throw new Error(`资源房前得分异常: ${resource.hudScore}`);
  await stepDoor('资源机关', '解读资源机关', '资源机关');
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' ? s : null; }, '资源机关解开');
  const withKey = await dungeonState();
  if (withKey.hudKeys !== '备用钥匙 1/1' || withKey.hudScore !== '得分 30') throw new Error(`钥匙后 HUD 异常: ${withKey.hudKeys} ${withKey.hudScore}`);
  const leaveInfo = await collectKey();
  await waitRoom('资源房', '收下钥匙留在资源房');
  await shot('ios-online-04-resource-key');
  await clickRouteByPrefix('折回岔口');
  await waitRoom('岔口', '折回岔口');
  await stepDoor('右门-答错', '右门（锁着）', '右门', true);
  const retry = await waitRetryState();
  if (retry.hudScore !== '得分 30') throw new Error(`答错后扣分了: ${retry.hudScore}`);
  const wrongPrompt = retry.prompt;
  await shot('ios-online-05-right-wrong');
  await clickEl('#btn-swap');
  const swapped = await waitQuestion('右门', { notPrompt: wrongPrompt });
  const swapId = POOL_BY_ID[swapped.promptExerciseId]?.id;
  const wrongId = play[play.length - 1].id;
  if (swapId === wrongId) throw new Error('换一题未换题');
  await answerOpenSlot('右门-换题后');
  await waitResult();
  await shot('ios-online-06-result');
  const res = await dungeonState();
  const scoreOk = res.resultScore === '总分 35' && res.resultTitle === '通关！';
  const answerOk = res.resultAnswer === '作答 4 题 · 首答 3/4 · 重试 1 次';
  const exploreOk = res.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
  if (!typedOnce || !choiceOnce) throw new Error(`场景要求未满足: 整数合成键入=${typedOnce} choice=${choiceOnce}`);
  await checkpoint('S1-结算屏');
  await clickEl('#btn-result-return');
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
  await shot('ios-online-07-records');
  await checkpoint('S1-记录列表');
  const allApproved = play.every(p => POOL_BY_ID[p.id]?.status === 'approved');
  s1 = { entry: { dungeon: menu.dungeonAnchor, hanzi: menu.hanziAnchor }, availability: g1.availabilityStatus,
    poolCount: poolInfo.count, picked: { attempts: picked.attempts, kinds: picked.kinds, roundId },
    play: play.map(p => ({ label: p.label, kind: p.kind, id: p.id, prompt: p.prompt, value: p.value ?? null, wrong: p.wrong, typed: p.typed })),
    result: { score: res.resultScore, answer: res.resultAnswer, explore: res.resultExplore },
    recOk, recentOk, coinsBefore, coinsAfter, coinsOk, allApproved,
    leaveClickAttempts: leaveInfo.clickAttempts, errors: rec.errors, overflow: rec.overflow };
  record('S1 在线完整通关局（整数合成键入 + choice 点击 + 答错换题重试档）',
    scoreOk && answerOk && exploreOk && recOk && recentOk && coinsOk && allApproved && typedOnce && choiceOnce
      && rec.errors.length === 0 && !rec.overflow,
    `菜单「算术地下城」入口（href=/dungeon.html、装饰字 aria-hidden）进入地下城；勾一年级→「${g1.availabilityStatus}」与 dist 层一致（${poolInfo.count} 题全 approved）；第 ${picked.attempts} 次开局（kinds=${JSON.stringify(picked.kinds)}）：石门「${play[0].prompt}」→岔口（得分 10）→左门「${play[1].prompt}」→资源房（得分 20）→资源机关「${play[2].prompt}」→钥匙 1/1（收下钥匙点击 ${leaveInfo.clickAttempts} 次）→折回岔口→右门「${wrongPrompt.slice(0, 16)}…」故意答错（✗、不解锁、得分仍 30）→「换一题」换为「${swapped.prompt.slice(0, 16)}…」→答对（重试档 +5）→结算「${res.resultScore}」「${res.resultAnswer}」「${res.resultExplore}」与计分规则逐项吻合（10+10+10+5=35）；作答含整数题合成键入提交=${typedOnce}（input 事件实时启用「开门」）、choice 点击作答=${choiceOnce}；练习记录新增 1 条（gameId=${recRaw?.gameId}、recordId=roundId、score=35、keyUses=0、route 完整）且列表显示「35 分 · 首答 3/4 · 重试 1」；recent-ids 含本局全部题目 ID=${recentOk}；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；JS 错误 0、无横向溢出`,
    { checks: s1 });

  // S2 返回路径与三入口并存
  await clickEl('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const h = await homeCheck(); return h?.url === '/' && h.select ? h : null; }, '返回数字消除首页', 20000);
  await evalSync(INJECT);
  await checkpoint('S2-返回后首页');
  let npOk = false;
  for (let round = 0; round < 8 && !npOk; round++) {
    await evalSync(`(() => { const input = [...document.querySelectorAll('input[name=grade]')].find(i => i.value === '1');
      if (input && !input.checked) input.click(); return true; })()`);
    await sleep(600);
    const h = await homeCheck();
    npOk = h.gradeChecked.includes('1') && h.btnToAvailabilityDisabled === false;
  }
  if (!npOk) throw new Error('数字消除年级勾选未稳定');
  await evalSync(`(() => { const input = [...document.querySelectorAll('input[name=grade]')].find(i => i.value === '1');
    if (input && input.checked) input.click(); return true; })()`);
  await sleep(300);
  await clickEl('#btn-menu');
  await waitUntil(async () => { const h = await homeCheck(); return h.menuOpen ? h : null; }, '返回后菜单弹层');
  const menu2 = await homeCheck();
  await shot('ios-online-08-home-returned-menu');
  const threeOk = menu2.hanziAnchor?.visible && menu2.dungeonAnchor?.visible
    && menu2.hanziAnchor.href === '/hanzi.html' && menu2.dungeonAnchor.href === '/dungeon.html';
  await checkpoint('S2-菜单三入口');
  s2 = { npOk, threeOk, menu: { hanzi: menu2.hanziAnchor, dungeon: menu2.dungeonAnchor } };
  record('S2 返回路径与三入口并存', npOk && threeOk,
    `地下城顶栏「${dungeonBack.text}」返回数字消除首页；勾选一年级→下一步按钮启用（可选年级），取消复原；菜单弹层内「汉字勇者」（href=/hanzi.html）与「算术地下城」（href=/dungeon.html）两锚点并存可见（数字消除为当前页）；无溢出、JS 错误 0`,
    { checks: s2 });
} catch (e) {
  record('S1/S2 在线流程', false, `失败: ${e.message}`);
}

const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, udid: UDID, wdEndpoint: WD,
  userAgent: ua, scenarios, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
await writeFile(join(outDir, 'ios-online-results.json'), JSON.stringify(summary, null, 2));
log('结果已写入 ios-online-results.json');
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
process.exitCode = scenarios.every(s => s.pass) ? 0 : 1;
}
} finally {
  try { await wd('DELETE', base); } catch { /* 会话已失效 */ }
}
process.exitCode = scenarios.length && scenarios.every(s => s.pass) ? 0 : 1;
