// Android 模拟器 Chrome 验证（M10 英语快递员，口径对齐 M9/M12 device-simulators/android-round.mjs）。
// CDP 走 browser 级 endpoint + Target.attachToTarget(flatten)（per-page WebSocket 在本机
// Chrome 113 握手成功但命令可能无响应）。输入全部为 Input.dispatchTouchEvent 真实触摸。
// 答案一律从页面快照（pixel-academy:english-courier:v1:interrupted 的 stations/parcels）
// 经 dist 判题模块（selectEnglishExercises + englishDeliveryAnswer + englishCanonicalWord）
// 自算，不注入任何游戏状态；角色卡不带英语文字标签，收件人身份只能从快照映射。
// 覆盖：S1 在线完整局（菜单「英语快递员」入口、5 任务两步送达：取包裹→送达角色，
// 第 2 题对包裹错对象→「对象不对」→纠正重试档 +5、结算与逐题档位吻合、
// 记录 gameId=english-courier 且词汇/句意 mode 分开、金币零变化）
// → S2 返回路径与五入口并存 → S3 离线（SW 就绪→杀源→刷新，首页与 /english.html
// 由缓存打开，断网完成含 12 张角色 SVG 的整局）→ S4 贯穿（横向溢出与 JS 错误台账）。
// 用法：node android-round.mjs online|offline [输出目录]
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
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
const clickAt = async (selector, { tolerant = false } = {}) => {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null; if (el.disabled) return 'disabled';
    el.scrollIntoView({ block: 'center' });
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
  let lastErr = null, errCount = 0, polls = 0;
  for (;;) {
    let v; try { v = await fn(); polls++; } catch (e) { lastErr = e; errCount++; v = null; }
    if (v) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时: ${desc}（polls=${polls} exceptions=${errCount}${lastErr ? ` lastError=${lastErr.message}` : ''}）`);
    }
    await sleep(300);
  }
};

// ===== 页面注入（JS 错误台账）=====
const INJECT_SOURCE = `
  window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));`;

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
    pinyinAnchor: anchor('#main-nav a[href="/pinyin.html"]'),
    englishAnchor: anchor('#main-nav a[href="/english.html"]'),
    gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
    btnToAvailabilityDisabled: document.getElementById('btn-to-availability')?.disabled,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 英语快递员状态 =====
const englishState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null;
  try { const raw = localStorage.getItem('pixel-academy:english-courier:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  let recordsRaw = null;
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:english-courier:v1:records') ?? 'null'); } catch {}
  let recentIds = null;
  try { recentIds = JSON.parse(localStorage.getItem('pixel-academy:english-courier:v1:recent-ids') ?? 'null'); } catch {}
  const stations = [...document.querySelectorAll('#stations .station-card')].map(b => {
    const img = b.querySelector('img');
    return { imgLoaded: !!img && img.complete && img.naturalWidth > 0, min: Math.min(...(() => { const r = b.getBoundingClientRect(); return [r.width, r.height]; })()) };
  });
  const parcels = [...document.querySelectorAll('#parcels .parcel-card')].map(b => ({
    word: b.dataset.word ?? null, carried: b.classList.contains('parcel-carried') }));
  return {
    url: location.pathname,
    h1: document.querySelector('main h1')?.textContent ?? null,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    selectVisible: !hidden('screen-select'),
    gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'),
    questionVisible: !hidden('question-card'),
    backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
      return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null; })(),
    gradeCards: [...document.querySelectorAll('#grade-grid button')].map(b => ({
      text: b.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled })),
    availabilityStatus: t('availability-status'),
    startDisabled: document.getElementById('btn-start')?.disabled,
    storageNoticeHidden: hidden('storage-notice'),
    restoreOfferHidden: hidden('restore-offer'),
    restoreIncompatibleHidden: hidden('restore-incompatible'),
    records: [...document.querySelectorAll('#records-list li')].map(li => li.textContent),
    hudProgress: t('hud-progress'), hudScore: t('hud-score'),
    qMode: t('q-mode'),
    prompt: t('q-prompt'),
    carryingStatus: t('carrying-status'),
    parcels, stations,
    feedbackHidden: hidden('feedback'),
    feedback: t('feedback'),
    pauseOverlayHidden: hidden('pause-overlay'),
    resultScore: t('result-score'),
    resultAnswer: t('result-answer'),
    resultModes: t('result-modes'),
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    snap, recordsRaw, recentIds,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

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
const installPool = () => evaluate(`(async () => {
  const { selectEnglishExercises } = await import('/dist/game/english-courier/content.js');
  const { englishDeliveryAnswer } = await import('/dist/learning/english.js');
  const picked = selectEnglishExercises([1]);
  window.__pool = picked.map(e => { const a = englishDeliveryAnswer(e.task);
    return { id: e.id, status: e.review.status, mode: e.task.mode, prompt: e.task.prompt,
      parcelAnswer: a.parcel, recipientAnswer: a.recipient }; });
  const modes = picked.reduce((acc, e) => { acc[e.task.mode] = (acc[e.task.mode] ?? 0) + 1; return acc; }, {});
  return { count: picked.length, modes, statuses: [...new Set(picked.map(e => e.review.status))] };
})()`).then(info => { log('正式池:', JSON.stringify(info)); return info; });

// ===== 当前任务作答计划（页面内自算：正确/错误包裹与站位下标）=====
const planMove = () => evaluate(`(async () => {
  const raw = localStorage.getItem('pixel-academy:english-courier:v1:interrupted');
  const snap = JSON.parse(raw);
  const row = { qi: snap.state.questionIndex, question: snap.state.questions[snap.state.questionIndex],
    carrying: snap.state.carrying, score: snap.state.score, attempts: snap.state.attempts, wrongs: snap.state.wrongs };
  const { selectEnglishExercises } = await import('/dist/game/english-courier/content.js');
  const { englishDeliveryAnswer, englishCanonicalWord } = await import('/dist/learning/english.js');
  const ex = selectEnglishExercises([1]).find(e => e.id === row.question.exerciseId);
  if (!ex) throw new Error('题库池缺少 exerciseId: ' + row.question.exerciseId);
  if (ex.review.status !== 'approved') throw new Error('非 approved 题 ' + ex.id);
  const answer = englishDeliveryAnswer(ex.task);
  const correctParcel = row.question.parcels.find(w => englishCanonicalWord(w) === answer.parcel);
  const correctStation = row.question.stations.findIndex(w => englishCanonicalWord(w) === answer.recipient);
  const wrongParcel = row.question.parcels.find(w => englishCanonicalWord(w) !== answer.parcel);
  const wrongStation = row.question.stations.findIndex(w => englishCanonicalWord(w) !== answer.recipient);
  if (!correctParcel || correctStation < 0 || !wrongParcel || wrongStation < 0) {
    throw new Error('任务 ' + ex.id + ' 正确/错误答案不可达');
  }
  return { exerciseId: ex.id, mode: ex.task.mode, prompt: ex.task.prompt, status: ex.review.status,
    correctParcel, correctStation, wrongParcel, wrongStation, row };
})()`);

// ===== 触摸作答辅助 =====
const tapWord = async word => {
  const found = await waitUntil(async () => {
    const rect = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('#parcels .parcel-card')];
      const b = btns.find(x => x.dataset.word === ${JSON.stringify(word)});
      if (!b || b.disabled) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
    if (!rect) return null;
    await tap(rect.x, rect.y);
    return true;
  }, `包裹「${word}」可点`, 6000);
  return found;
};
const tapStation = async stationIndex => {
  const found = await waitUntil(async () => {
    const rect = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('#stations .station-card')];
      const b = btns[${stationIndex}];
      if (!b || b.disabled) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
    if (!rect) return null;
    await tap(rect.x, rect.y);
    return true;
  }, `站位 ${stationIndex + 1} 可点`, 6000);
  return found;
};

const handlePauseIfAny = async () => {
  const s = await englishState();
  if (s.pauseOverlayHidden === false) { await clickAt('#btn-resume'); await sleep(500); return true; }
  return false;
};
const qDiag = {};
const waitTask = (index, desc = `第 ${index + 1} 个任务可作答`) => waitUntil(async () => {
  await wakeUp();
  await handlePauseIfAny();
  const s = await englishState();
  Object.assign(qDiag, {
    gameVisible: s.gameVisible, questionVisible: s.questionVisible, hudProgress: s.hudProgress,
    parcelCount: s.parcels.length, stationCount: s.stations.length,
    selectVisible: s.selectVisible, resultVisible: s.resultVisible,
    pauseOverlayHidden: s.pauseOverlayHidden, feedback: s.feedback,
  });
  if (!s.gameVisible || !s.questionVisible) return null;
  if (s.hudProgress !== `第 ${index + 1}/5 个任务`) return null;
  if (!s.parcels.length || !s.stations.length) return null;
  if (s.parcels.some(p => p.word === null) || s.stations.some(b => !b.imgLoaded || b.min < 44)) return null;
  return s;
}, desc, 20000);
const waitFeedback = (prefix, desc) => waitUntil(async () => {
  const s = await englishState();
  return s.gameVisible && s.feedbackHidden === false && (s.feedback ?? '').startsWith(prefix) ? s.feedback : null;
}, desc, 10000);
const waitResult = () => waitUntil(async () => {
  await wakeUp();
  await handlePauseIfAny();
  const s = await englishState();
  return s.resultVisible ? s : null;
}, '结算屏');
const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click(); })()`, false);
  const s = await englishState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want ? s : null;
}, `勾选年级 ${name}`, 12000);
async function discardResidue() {
  const s = await englishState();
  if (s.restoreOfferHidden === false) {
    log('发现英语残留中断局，放弃之');
    await clickAt('#btn-discard-round');
    await sleep(600);
    await clickAt('#btn-confirm-yes');
    await waitUntil(async () => (await englishState()).restoreOfferHidden, '残留局清理', 8000);
  }
}

// 完成当前任务。wrongFirst=true：对包裹错对象 → ✗ 对象不对 → 再送正确站位（重试档）。
async function solveCurrent({ wrongFirst = false, onWrongShot = null } = {}) {
  const plan = await planMove();
  await tapWord(wrongFirst ? plan.correctParcel : plan.correctParcel);
  if (wrongFirst) {
    await tapStation(plan.wrongStation);
    const fb = await waitFeedback('✗', '错送反馈出现');
    if (!fb.includes('对象不对')) throw new Error(`对包裹错对象应报「对象不对」: ${fb}`);
    const rowWrong = (await englishState()).snap.state;
    if (rowWrong.attempts[plan.row.qi] !== 1 || rowWrong.wrongs[plan.row.qi] !== 1) {
      throw new Error(`错送计数异常: ${JSON.stringify(rowWrong)}`);
    }
    if (onWrongShot) await onWrongShot();
    await tapStation(plan.correctStation);
  } else {
    await tapStation(plan.correctStation);
  }
  const landed = await waitFeedback('✓', '送达完成反馈出现');
  const m = (landed ?? '').match(/\+(\d+)/);
  const gained = m ? Number(m[1]) : null;
  return { id: plan.exerciseId, mode: plan.mode, prompt: plan.prompt, wrongFirst, gained, feedback: landed };
}

// ===== 场景台账 =====
let expectedScore = 0;
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

async function playRound({ wrongIndex = null, shots = {} }) {
  const questions = [];
  let vocabShot = false, sentenceShot = false, wrongShot = false;
  expectedScore = 0;
  const snap0 = (await englishState()).snap;
  const roundId = snap0?.roundId ?? null;
  for (let i = 0; i < 5; i++) {
    const st = await waitTask(i).catch(e => { throw new Error(`${e.message} [waitTask 末次观察: ${JSON.stringify(qDiag)}]`); });
    if (st.qMode === '词汇识别' && !vocabShot && shots.vocab) { await shot(shots.vocab); vocabShot = true; }
    if (st.qMode === '句意理解' && !sentenceShot && shots.sentence) { await shot(shots.sentence); sentenceShot = true; }
    const a = await solveCurrent({ wrongFirst: i === wrongIndex,
      onWrongShot: shots.wrong && !wrongShot ? async () => { await shot(shots.wrong); wrongShot = true; } : null });
    if (a.gained === null) throw new Error(`送达反馈未解析出得分: ${a.feedback}`);
    expectedScore += a.gained;
    questions.push({ index: i, id: a.id, mode: a.mode, prompt: a.prompt, wrongFirst: a.wrongFirst, gained: a.gained });
    log(`第 ${i + 1} 任务 ${a.mode} ${a.id} → ${a.feedback}（累计 ${expectedScore}）`);
    if (i === 4) { await waitResult(); }
  }
  return { roundId, questions, expectedScore };
}

// ============================================================
// 主流程
// ============================================================
await connect();
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT_SOURCE });
await wakeUp(true);

if (phase === 'offline') {
  // ===== S3 离线：SW 就绪 → 杀源 → 刷新 → 缓存打开 → 断网完成整局 =====
  try {
    await send('Page.navigate', { url: `${ORIGIN}/` });
    await sleep(2000);
    await wakeUp(true);
    await waitUntil(async () => (await homeState()).selectVisible, '在线末尾首页选择屏', 30000);
    let swInfo = null;
    for (let i = 0; i < 6 && !swInfo; i++) {
      swInfo = await waitUntil(async () => evaluate(`(async () => {
        if (navigator.serviceWorker.controller === null) return null;
        const keys = await caches.keys();
        const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
        if (!name) return null;
        const cache = await caches.open(name);
        const english = await cache.match('/english.html');
        const englishCss = await cache.match('/english.css');
        const mainJs = await cache.match('/dist/game/english-courier/main.js');
        const svg = await cache.match('/img/english-courier/mum.svg');
        if (!english || !englishCss || !mainJs || !svg) return null;
        let svgCount = 0;
        const keysInCache = await cache.keys();
        for (const k of keysInCache) if (k.url.includes('/img/english-courier/')) svgCount += 1;
        return { name, englishCached: true, mainJsCached: true, svgCached: svg.status, svgCount };
      })()`), 'SW 就绪且缓存含 /english.html 与角色 SVG', 15000).catch(() => null);
      if (!swInfo) {
        log(`SW 未就绪（第 ${i + 1} 次），刷新促成新版本接管`);
        await send('Page.reload', { ignoreCache: false });
        await sleep(2500);
        await waitUntil(async () => (await homeState()).selectVisible, '重载后首页选择屏', 30000);
      }
    }
    if (!swInfo) throw new Error('SW 未就绪（缓存缺 /english.html 或角色 SVG）');
    log('SW:', JSON.stringify(swInfo));
    await checkpoint('S3-SW就绪首页(在线)');
    let serverWasAlive = true;
    try { await execFileP('pkill', ['-f', 'serve.mjs 4273']); } catch { serverWasAlive = false; }
    await sleep(1500);
    let sourceDead = false;
    try { await fetch(`${ORIGIN}/sw.js`, { signal: AbortSignal.timeout(3000) }); } catch { sourceDead = true; }
    if (!sourceDead) throw new Error('源站未成功断开');
    log('源站已断开，刷新当前标签页（非冷导航）');
    await send('Page.reload', { ignoreCache: false });
    await waitUntil(async () => { const h = await homeState(); return h.selectVisible && !h.errorVisible ? h : null; }, '断源刷新后首页由缓存打开', 30000);
    await checkpoint('S3-离线首页');
    await shot('android-offline-01-home');
    await clickAt('#btn-menu');
    await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen && h.englishAnchor?.visible ? h : null; }, '断源后菜单');
    await clickAt('#main-nav a[href="/english.html"]');
    await waitUntil(async () => { const s = await englishState(); return s.url === '/english.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '断源后英语快递员由缓存打开', 30000);
    const poolInfo = await installPool().catch(e => { throw new Error(`断网下题库模块 import 失败（SW 闭包不全）: ${e.message}`); });
    await checkpoint('S3-离线英语选择屏');
    await shot('android-offline-02-english-select');
    await discardResidue();
    await toggleGrade('一年级', true);
    const avail = (await englishState()).availabilityStatus;
    log('离线可用性文案:', avail);
    await clickAt('#btn-start');
    const coinsBeforeOff = await idbProfileSnapshot();
    const played = await playRound({ wrongIndex: null, shots: {} });
    await shot('android-offline-03-offline-result');
    const res = await englishState();
    const scoreOk = res.resultScore === `总分 ${played.expectedScore}` && played.expectedScore === 50;
    const answerOk = res.resultAnswer === '完成 5 个任务 · 首次一次完成 5 · 错送 0 次 · 送达尝试 5 次';
    log(`断网结算: ${res.resultScore} ${res.resultAnswer} ${res.resultModes}`);
    await checkpoint('S3-离线结算屏');
    await clickAt('#btn-result-return');
    await waitUntil(async () => (await englishState()).selectVisible, '断网结算返回选择屏');
    const rec = await englishState();
    const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === played.roundId) ?? null;
    const recOk = recRaw && recRaw.gameId === 'english-courier' && recRaw.score === 50
      && recRaw.answer?.tasks?.length === 5
      && recRaw.answer.tasks.every(t => t.attempts === 1 && t.firstTry === true)
      && rec.records.some(r => r.includes('50 分 · 首答 5/5'));
    const recentOk = Array.isArray(rec.recentIds) && recRaw
      && recRaw.answer.tasks.every(t => rec.recentIds.includes(t.exerciseId));
    const snapCleared = (await englishState()).snap === null;
    await clickAt('.profile-bar a.btn-ghost');
    await waitUntil(async () => { const h = await homeState(); return h.url === '/' && h.selectVisible ? h : null; }, '断网返回首页', 30000);
    await checkpoint('S3-离线返回首页');
    const coinsAfterOff = await idbProfileSnapshot();
    record('S3 离线断源（缓存打开 + 断网完成整局）',
      sourceDead && poolInfo.count > 0 && scoreOk && answerOk && recOk && recentOk
        && snapCleared && coinsAfterOff?.coins === coinsBeforeOff?.coins,
      `SW ${swInfo.name} 受控且预缓存含 /english.html（含 /english.css、英语 dist 模块、角色 SVG ${swInfo.svgCount} 张，/img/english-courier/mum.svg 命中 status=${swInfo.svgCached}）；${serverWasAlive ? '杀 serve 4273（源站 fetch 确认失败）后' : '源站已在先前场景断开'}刷新同一标签页：首页由缓存打开；菜单进 /english.html 由缓存正常加载（6 年级卡、boot-fail 隐藏）；断网下题库模块经 SW 预缓存 import 成功（${poolInfo.count} 任务）；选一年级（${avail}）完成断网整局 5 任务两步送达，全部首答完成，结算「${res.resultScore}」「${res.resultAnswer}」（断网局内站位角色图全部加载）；离线练习记录新增 1 条（gameId=${recRaw?.gameId}、score=50、5 任务全 firstTry）且列表显示「50 分 · 首答 5/5」；recent-ids 含本局全部任务 ID；结算返回后中断快照清除；离线金币 ${coinsBeforeOff?.coins} = ${coinsAfterOff?.coins}（零收支）；返回首页正常；全程 JS 错误 0、无横向溢出`,
      { checks: { swInfo, sourceDead, serverWasAlive, poolInfo, avail, result: { score: res.resultScore, answer: res.resultAnswer, modes: res.resultModes }, roundId: played.roundId, tasks: played.questions, recRaw, recOk, recentOk, snapCleared, coins: [coinsBeforeOff?.coins, coinsAfterOff?.coins] } });
  } catch (e) {
    record('S3 离线断源（缓存打开 + 断网完成整局）', false, `失败: ${e.message}`);
  }
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, 'android-offline-results.json'), JSON.stringify(summary, null, 2));
  log('结果已写入 android-offline-results.json');
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  ws.close();
  process.exit(process.exitCode = summary.allPassed ? 0 : 1);
}

// ===== S1+S2 在线 =====
try {
  await send('Page.navigate', { url: `${ORIGIN}/` });
  await sleep(2500);
  await wakeUp(true);
  await waitUntil(async () => { const h = await homeState(); return h.selectVisible && !h.errorVisible ? h : null; }, '首页选择屏出现', 30000);
  await checkpoint('S1-在线首页');
  await shot('android-online-01-home');
  const coinsBefore = await idbProfileSnapshot();
  log(`IndexedDB 档案局前: coins=${coinsBefore?.coins} records=${coinsBefore?.records} revision=${coinsBefore?.revision}`);

  // S1a：首页菜单「英语快递员」入口（五入口菜单）
  await clickAt('#btn-menu');
  await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen && h.englishAnchor?.visible ? h : null; }, '菜单弹层打开');
  const menu = await homeState();
  await shot('android-online-02-home-menu');
  const entryOk = menu.englishAnchor.href === '/english.html' && (menu.englishAnchor.text ?? '').includes('英语快递员')
    && menu.englishAnchor.decorAriaHidden === 'true'
    && menu.hanziAnchor?.visible && menu.dungeonAnchor?.visible && menu.pinyinAnchor?.visible;
  if (!entryOk) throw new Error(`菜单入口异常: ${JSON.stringify({ english: menu.englishAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor, pinyin: menu.pinyinAnchor })}`);
  await clickAt('#main-nav a[href="/english.html"]');
  await waitUntil(async () => { const s = await englishState(); return s.url === '/english.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '英语快递员选择屏就绪', 30000);
  await checkpoint('S1-英语选择屏');
  const poolInfo = await installPool();
  await shot('android-online-03-english-select');
  await discardResidue();
  const g1 = await toggleGrade('一年级', true);
  const expectAvail = `本局题库：一年级 18 个任务，共 18 个`;
  if (g1.availabilityStatus !== expectAvail) throw new Error(`可用性文案异常: ${g1.availabilityStatus}`);
  log('可用性文案:', g1.availabilityStatus);
  if (g1.storageNoticeHidden !== true) throw new Error('存储不可用提示意外出现');
  const backLink = (await englishState()).backLink;
  if (backLink?.href !== '/' || !backLink.text.includes('返回数字消除')) throw new Error(`返回链接异常: ${JSON.stringify(backLink)}`);

  // S1b：完整局 5 任务（第 2 题对包裹错对象 → 对象不对 → 纠正重试档 +5）
  await clickAt('#btn-start');
  const played = await playRound({ wrongIndex: 1,
    shots: { vocab: 'android-online-04-vocab-question', sentence: 'android-online-05-sentence-question', wrong: 'android-online-06-wrong-recipient' } });
  await shot('android-online-07-result');
  const res = await englishState();
  const vocabQuestions = played.questions.filter(q => q.mode === 'vocab');
  const sentenceQuestions = played.questions.filter(q => q.mode === 'sentence');
  const modesExpected = `词汇识别 ${vocabQuestions.filter(q => !q.wrongFirst).length}/${vocabQuestions.length} 题首答`
    + ` · 句意理解 ${sentenceQuestions.filter(q => !q.wrongFirst).length}/${sentenceQuestions.length} 题首答`;
  const scoreOk = res.resultScore === `总分 ${played.expectedScore}`;
  const answerOk = res.resultAnswer === '完成 5 个任务 · 首次一次完成 4 · 错送 1 次 · 送达尝试 6 次';
  const modesOk = res.resultModes === modesExpected;
  if (!scoreOk || !answerOk || !modesOk) {
    throw new Error(`结算不符: ${res.resultScore} / ${res.resultAnswer} / ${res.resultModes}（期望 总分 ${played.expectedScore} / 完成式 / ${modesExpected}）`);
  }
  const wrongQ = played.questions[1];
  if (!wrongQ.wrongFirst || wrongQ.gained !== 5) throw new Error(`重试档验证失败: ${JSON.stringify(wrongQ)}`);
  if (played.questions.filter(q => !q.wrongFirst).some(q => q.gained !== 10)) throw new Error('首答档非 +10');
  await checkpoint('S1-结算屏');
  await clickAt('#btn-result-return');
  await waitUntil(async () => (await englishState()).selectVisible, '返回选择屏');
  const rec = await englishState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === played.roundId) ?? null;
  const modesSequenceOk = recRaw && played.questions.every((q, i) => {
    const r = recRaw.answer?.tasks?.[i];
    return r && r.exerciseId === q.id && r.mode === q.mode && r.attempts >= 1
      && r.firstTry === !q.wrongFirst && r.wrongs === (q.wrongFirst ? 1 : 0);
  });
  const recOk = recRaw && recRaw.gameId === 'english-courier' && recRaw.score === played.expectedScore
    && recRaw.answer?.tasks?.length === 5 && modesSequenceOk
    && rec.records.some(r => r.includes(`${played.expectedScore} 分 · 首答 4/5`));
  const recentOk = Array.isArray(rec.recentIds) && recRaw && recRaw.answer.tasks
    .every(t => rec.recentIds.includes(t.exerciseId));
  const coinsAfter = await idbProfileSnapshot();
  const coinsOk = coinsAfter?.coins === coinsBefore?.coins;
  await shot('android-online-08-records');
  await checkpoint('S1-记录列表');
  const allApproved = played.questions.every(q => q.mode !== null);
  record('S1 在线完整局（两步送达真实触摸 + 第 2 任务错送纠正重试档）',
    scoreOk && answerOk && modesOk && recOk && recentOk && coinsOk && allApproved
      && rec.errors.length === 0 && !rec.overflowX,
    `菜单「英语快递员」入口（href=/english.html、装饰字 aria-hidden，与汉字勇者/算术地下城/拼音冒险锚点并存）进入英语快递员；勾一年级→「${g1.availabilityStatus}」与 dist 层一致（${poolInfo.count} 任务全 approved：词汇 ${poolInfo.modes.vocab} + 句意 ${poolInfo.modes.sentence}）；完整局 5 任务（${played.questions.map(q => q.id + ':' + q.mode).join('、')}）：${played.questions.map(q => `第 ${q.index + 1} 任务「${q.prompt}」${q.wrongFirst ? '先对包裹错对象（✗ 对象不对，得分不变）→' : ''}送达完成 ${q.gained} 分`).join('→')}；结算「${res.resultScore}」「${res.resultAnswer}」「${res.resultModes}」与逐题档位（4×10+5=45、尝试 6）吻合；练习记录新增 1 条（gameId=${recRaw?.gameId}、recordId=roundId、score=${played.expectedScore}、逐题 mode 序列与局内观察一致、第 2 任务 wrongs=1）且列表显示「${played.expectedScore} 分 · 首答 4/5」；recent-ids 含本局全部任务 ID；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；JS 错误 ${rec.errors.length}、无横向溢出`,
    { checks: { entry: { english: menu.englishAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor, pinyin: menu.pinyinAnchor },
      availability: g1.availabilityStatus, poolCount: poolInfo.count, roundId: played.roundId,
      tasks: played.questions, result: { score: res.resultScore, answer: res.resultAnswer, modes: res.resultModes },
      recOk, recentOk, modesSequenceOk, coinsBefore, coinsAfter, coinsOk, allApproved, errors: rec.errors, overflow: rec.overflowX } });

  // S2 返回路径与五入口并存
  await clickAt('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const h = await homeState(); return h.url === '/' && h.selectVisible ? h : null; }, '返回数字消除首页', 20000);
  await checkpoint('S2-返回后首页');
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
  await evaluate(`(() => { const input = [...document.querySelectorAll('input[name=grade]')].find(i => i.value === '1');
    if (input && input.checked) input.click(); })()`, false);
  await sleep(300);
  await clickAt('#btn-menu');
  await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen ? h : null; }, '返回后菜单弹层');
  const menu2 = await homeState();
  await shot('android-online-09-home-returned-menu');
  const fiveOk = menu2.hanziAnchor?.visible && menu2.dungeonAnchor?.visible && menu2.pinyinAnchor?.visible
    && menu2.englishAnchor?.visible
    && menu2.hanziAnchor.href === '/hanzi.html' && menu2.dungeonAnchor.href === '/dungeon.html'
    && menu2.pinyinAnchor.href === '/pinyin.html' && menu2.englishAnchor.href === '/english.html';
  await checkpoint('S2-菜单五入口');
  const pcFinal = await pageCheck();
  record('S2 返回路径与五入口并存', npOk && fiveOk && pcFinal.errors.length === 0 && !pcFinal.overflow,
    `英语快递员顶栏「${backLink.text}」返回数字消除首页；勾选一年级→下一步按钮启用（可选年级），取消复原；菜单弹层内「汉字勇者」「算术地下城」「拼音冒险」「英语快递员」四锚点并存可见（数字消除为当前页，共五入口）；JS 错误 ${pcFinal.errors.length}、无横向溢出`,
    { checks: { npOk, fiveOk, menu: { hanzi: menu2.hanziAnchor, dungeon: menu2.dungeonAnchor, pinyin: menu2.pinyinAnchor, english: menu2.englishAnchor }, errors: pcFinal.errors, overflow: pcFinal.overflow } });
} catch (e) {
  record('S1/S2 在线流程', false, `失败: ${e.message}`);
}

const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
await writeFile(join(outDir, 'android-online-results.json'), JSON.stringify(summary, null, 2));
log('结果已写入 android-online-results.json');
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(process.exitCode = scenarios.every(s => s.pass) ? 0 : 1);
