// iOS 模拟器 Safari M10 验证（英语快递员，口径对齐 M9/M12 device-simulators/ios-round.mjs）。
// 前置：iPhone 16 Pro / iOS 18.6 模拟器（UDID 28F2F0F0-…；iOS 27.0 运行时 safaridriver 无法创建
// 会话，不可用）；本地服务 4373（node scripts/serve.mjs 4373；M10 首版无音频，无需 MIME 旁路）。
// 与 M9 的差异：M10 首版仅文字指令、交互全部为 DOM 按钮（无 canvas/PointerEvent），
// el.click() 即可完整作答两步送达——无 M9 的 Audio 手势受阻问题，playing/blocked 条目不适用。
// 会话能力必须含 platformName iOS + safari:useSimulator true（UA 含 iPhone 确认）。
// 答案一律从页面快照（pixel-academy:english-courier:v1:interrupted 的 stations/parcels）
// 经 dist 判题模块（selectEnglishExercises + englishDeliveryAnswer + englishCanonicalWord）
// 自算，不注入任何游戏状态；角色卡不带英语文字标签，收件人身份只能从快照映射。
// 覆盖：S1 在线完整局（菜单「英语快递员」入口、5 任务两步送达、第 1 任务对包裹错对象→
// 「对象不对」→纠正重试档 +5、结算与逐题档位吻合、记录 gameId=english-courier 且
// 词汇/句意 mode 分开、金币零变化）→ S2 返回路径与五入口并存 → S3 离线（SW 就绪→杀源→
// Safari 刷新非冷导航，首页与 /english.html 由缓存打开，断网整局）→ 贯穿（溢出与错误台账）。
// 已知 WebKit 行为：iOS 冷导航离线打开受控源落系统错误页；本脚本全程用「受控后断源刷新」口径。
// 用法：node ios-round.mjs online|offline [输出目录]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const shot = async name => {
  const frame = `/tmp/ios-m10-${Date.now()}.png`;
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

// ===== 首页（数字消除）状态 =====
const homeCheck = () => evalSync(`(() => {
  const q = s => document.querySelector(s);
  if (!q('#screen-select')) return null;
  const anchor = sel => { const a = q(sel);
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/\\s+/g, ' '),
      decorAriaHidden: a.querySelector('span')?.getAttribute('aria-hidden') ?? null,
      visible: !!(a.offsetWidth || a.offsetHeight) } : null; };
  return {
    url: location.pathname,
    select: !q('#screen-select').hidden,
    error: !q('#screen-error')?.hidden,
    menuOpen: q('#menu-dialog')?.open ?? false,
    hanziAnchor: anchor('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: anchor('#main-nav a[href="/dungeon.html"]'),
    pinyinAnchor: anchor('#main-nav a[href="/pinyin.html"]'),
    englishAnchor: anchor('#main-nav a[href="/english.html"]'),
    gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
    btnToAvailabilityDisabled: q('#btn-to-availability')?.disabled,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  };
})()`);
const idbProfileSnapshot = () => evalAsync(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('profiles', 'readonly');
  const req = tx.objectStore('profiles').get('local');
  const p = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  return p ? { coins: p.coins, records: (p.records ?? []).length, revision: p.revision } : null;
})()`);

// ===== 英语快递员状态 =====
const englishState = () => evalSync(`(() => {
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
    const r = b.getBoundingClientRect();
    return { imgLoaded: !!img && img.complete && img.naturalWidth > 0, min: Math.min(r.width, r.height) };
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
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`);

// ===== 正式池与作答计划（dist 产物自算）=====
const installPool = async () => {
  const info = await evalAsync(`(async () => {
    const { selectEnglishExercises } = await import('/dist/game/english-courier/content.js');
    const { englishDeliveryAnswer } = await import('/dist/learning/english.js');
    const picked = selectEnglishExercises([1]);
    window.__pool = picked.map(e => { const a = englishDeliveryAnswer(e.task);
      return { id: e.id, status: e.review.status, mode: e.task.mode, prompt: e.task.prompt,
        parcelAnswer: a.parcel, recipientAnswer: a.recipient }; });
    const modes = picked.reduce((acc, e) => { acc[e.task.mode] = (acc[e.task.mode] ?? 0) + 1; return acc; }, {});
    return { count: picked.length, modes, statuses: [...new Set(picked.map(e => e.review.status))] };
  })()`);
  log('正式池:', JSON.stringify(info));
  return info;
};
// 当前任务作答计划（页面内自算：正确/错误包裹词与站位下标）。
const planMove = () => evalAsync(`(async () => {
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

// ===== 作答辅助 =====
const tapWord = async word => {
  const ok = await waitUntil(async () => {
    const done = await evalSync(`(() => {
      const btns = [...document.querySelectorAll('#parcels .parcel-card')];
      const b = btns.find(x => x.dataset.word === ${JSON.stringify(word)});
      if (!b || b.disabled) return null; b.click(); return true; })()`);
    return done ?? null;
  }, `包裹「${word}」可点`, 6000);
  return ok;
};
const tapStation = async stationIndex => {
  const ok = await waitUntil(async () => {
    const done = await evalSync(`(() => {
      const btns = [...document.querySelectorAll('#stations .station-card')];
      const b = btns[${stationIndex}];
      if (!b || b.disabled) return null; b.click(); return true; })()`);
    return done ?? null;
  }, `站位 ${stationIndex + 1} 可点`, 6000);
  return ok;
};

const handlePauseIfAny = async () => {
  const s = await englishState();
  if (s.pauseOverlayHidden === false) { await clickEl('#btn-resume'); await sleep(500); return true; }
  return false;
};
const waitTask = (index, desc = `第 ${index + 1} 个任务可作答`) => waitUntil(async () => {
  await handlePauseIfAny();
  const s = await englishState();
  return s.gameVisible && s.questionVisible
    && s.hudProgress === `第 ${index + 1}/5 个任务`
    && s.parcels.length > 0 && s.stations.length > 0
    && !s.parcels.some(p => p.word === null)
    && !s.stations.some(b => !b.imgLoaded || b.min < 44) ? s : null;
}, desc, 20000);
const waitFeedback = (prefix, desc) => waitUntil(async () => {
  const s = await englishState();
  return s.gameVisible && s.feedbackHidden === false && (s.feedback ?? '').startsWith(prefix) ? s.feedback : null;
}, desc, 10000);
const waitResult = () => waitUntil(async () => {
  await handlePauseIfAny();
  const s = await englishState();
  return s.resultVisible ? s : null;
}, '结算屏');
const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evalSync(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click();
    return true; })()`);
  const s = await englishState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want ? s : null;
}, `勾选年级 ${name}`, 12000);
async function discardResidue() {
  const s = await englishState();
  if (s.restoreOfferHidden === false) {
    log('发现英语残留中断局，放弃之');
    await clickEl('#btn-discard-round');
    await sleep(600);
    await clickEl('#btn-confirm-yes');
    await waitUntil(async () => (await englishState()).restoreOfferHidden, '残留局清理', 8000);
  }
}

// ===== 场景台账 =====
let expectedScore = 0;
const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

// 完成一局（5 任务）。wrongIndex：对包裹错对象 → ✗ 对象不对 → 纠正重试档。
async function playRound({ wrongIndex = null, shots = {} }) {
  const questions = [];
  let vocabShot = false, sentenceShot = false, wrongShot = false;
  expectedScore = 0;
  const snap0 = (await englishState()).snap;
  const roundId = snap0?.roundId ?? null;
  for (let i = 0; i < 5; i++) {
    const st = await waitTask(i);
    if (st.qMode === '词汇识别' && !vocabShot && shots.vocab) { await shot(shots.vocab); vocabShot = true; }
    if (st.qMode === '句意理解' && !sentenceShot && shots.sentence) { await shot(shots.sentence); sentenceShot = true; }
    const plan = await planMove();
    await tapWord(plan.correctParcel);
    let wrongFirst = false;
    if (i === wrongIndex) {
      await tapStation(plan.wrongStation);
      const fb = await waitFeedback('✗', '错送反馈出现');
      if (!fb.includes('对象不对')) throw new Error(`对包裹错对象应报「对象不对」: ${fb}`);
      const rowWrong = (await englishState()).snap.state;
      if (rowWrong.attempts[plan.row.qi] !== 1 || rowWrong.wrongs[plan.row.qi] !== 1) {
        throw new Error(`错送计数异常: ${JSON.stringify(rowWrong)}`);
      }
      if (shots.wrong && !wrongShot) { await shot(shots.wrong); wrongShot = true; }
      wrongFirst = true;
      await tapStation(plan.correctStation);
    } else {
      await tapStation(plan.correctStation);
    }
    const landed = await waitFeedback('✓', '送达完成反馈出现');
    const m = (landed ?? '').match(/\+(\d+)/);
    const gained = m ? Number(m[1]) : null;
    if (gained === null) throw new Error(`送达反馈未解析出得分: ${landed}`);
    expectedScore += gained;
    questions.push({ index: i, id: plan.exerciseId, mode: plan.mode, prompt: plan.prompt,
      wrongFirst, gained, feedback: landed });
    log(`第 ${i + 1} 任务 ${plan.mode} ${plan.exerciseId} → ${landed}（累计 ${expectedScore}）`);
    if (i === 4) await waitResult();
  }
  return { roundId, questions, expectedScore };
}

// 结算与记录断言。
async function verifySettlementAndRecord(played) {
  const res = await englishState();
  const vocab = played.questions.filter(q => q.mode === 'vocab');
  const sentence = played.questions.filter(q => q.mode === 'sentence');
  const firstTryCount = played.questions.filter(q => q.gained === 10).length;
  const retryCount = played.questions.filter(q => q.wrongFirst).length;
  const wrongTotal = played.questions.reduce((sum, q) => sum + (q.wrongFirst ? 1 : 0), 0);
  const attempts = 5 + wrongTotal;
  const expAnswer = `完成 5 个任务 · 首次一次完成 ${firstTryCount} · 错送 ${wrongTotal} 次 · 送达尝试 ${attempts} 次`;
  const expModes = `词汇识别 ${vocab.filter(q => !q.wrongFirst).length}/${vocab.length} 题首答`
    + ` · 句意理解 ${sentence.filter(q => !q.wrongFirst).length}/${sentence.length} 题首答`;
  const scoreOk = res.resultScore === `总分 ${played.expectedScore}`;
  const answerOk = res.resultAnswer === expAnswer;
  const modesOk = res.resultModes === expModes;
  if (!scoreOk || !answerOk || !modesOk) {
    throw new Error(`结算不符: ${res.resultScore} / ${res.resultAnswer} / ${res.resultModes}（期望 总分 ${played.expectedScore} / ${expAnswer} / ${expModes}）`);
  }
  await checkpoint('结算屏');
  await clickEl('#btn-result-return');
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
    && rec.records.some(r => r.includes(`${played.expectedScore} 分 · 首答 ${firstTryCount}/5`));
  const recentOk = Array.isArray(rec.recentIds) && recRaw && recRaw.answer.tasks
    .every(t => rec.recentIds.includes(t.exerciseId));
  const snapCleared = (await englishState()).snap === null;
  return { res, rec, recRaw, recOk, recentOk, snapCleared, modesSequenceOk, firstTryCount, retryCount };
}

// ===== 主流程 =====
let ua = null;
try {
await wd('POST', `${base}/timeouts`, { implicit: 0, pageLoad: 30000, script: 30000 });
ua = await evalSync(`navigator.userAgent`);
const udidReported = session.capabilities?.['safari:deviceUDID'] ?? null;
log('UA:', ua);
const simOk = ua.includes('iPhone') && udidReported === UDID;
if (!simOk) throw new Error(`会话未落在目标 iOS 模拟器: UA=${ua} UDID=${udidReported}`);

if (phase === 'offline') {
  // ===== S3 离线（断源刷新口径）：SW 受控 → 杀源 → Safari 刷新 → 缓存打开 → 断网整局 =====
  try {
    await wd('POST', `${base}/url`, { url: `${ORIGIN}` });
    await sleep(2500);
    await waitUntil(async () => (await homeCheck())?.select, '在线末尾首页选择屏', 30000);
    await evalSync(INJECT);
    let swInfo = null;
    for (let i = 0; i < 6 && !swInfo; i++) {
      swInfo = await waitUntil(async () => evalAsync(`(async () => {
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
        await wd('POST', `${base}/refresh`).catch(e => log('refresh 报错（继续等待）:', e.message.slice(0, 120)));
        await sleep(2500);
        await waitUntil(async () => (await homeCheck())?.select, '重载后首页选择屏', 30000);
        await evalSync(INJECT);
      }
    }
    if (!swInfo) throw new Error('SW 未就绪（缓存缺 /english.html 或角色 SVG）');
    log('SW:', JSON.stringify(swInfo));
    await checkpoint('S3-SW就绪首页(在线)');
    let serverWasAlive = true;
    try { await execFileP('pkill', ['-f', 'serve.mjs 4373']); } catch { serverWasAlive = false; }
    await sleep(1500);
    let sourceDead = false;
    try { await fetch(`${ORIGIN}sw.js`, { signal: AbortSignal.timeout(3000) }); } catch { sourceDead = true; }
    if (!sourceDead) throw new Error('源站未成功断开');
    log('源站已断开，Safari 刷新当前标签页（非冷导航）');
    await wd('POST', `${base}/refresh`).catch(e => log('refresh 报错（继续等待）:', e.message.slice(0, 120)));
    await waitUntil(async () => { const h = await homeCheck(); return h?.select && !h.error ? h : null; }, '断源刷新后首页由缓存打开', 40000);
    await evalSync(INJECT);
    await checkpoint('S3-离线首页');
    await shot('ios-offline-01-home');
    await clickEl('#btn-menu');
    await waitUntil(async () => { const h = await homeCheck(); return h.menuOpen && h.englishAnchor?.visible ? h : null; }, '断源后菜单');
    await clickEl('#main-nav a[href="/english.html"]');
    await waitUntil(async () => { const s = await englishState(); return s.url === '/english.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '断源后英语快递员由缓存打开', 30000);
    await evalSync(INJECT);
    const poolInfo = await installPool().catch(e => { throw new Error(`断网下题库模块 import 失败（SW 闭包不全）: ${e.message}`); });
    await checkpoint('S3-离线英语选择屏');
    await shot('ios-offline-02-english-select');
    await discardResidue();
    await toggleGrade('一年级', true);
    const avail = (await englishState()).availabilityStatus;
    log('离线可用性文案:', avail);
    await clickEl('#btn-start');
    const coinsBeforeOff = await idbProfileSnapshot();
    const played = await playRound({ wrongIndex: null, shots: {} });
    await shot('ios-offline-03-offline-result');
    const v = await verifySettlementAndRecord(played);
    log(`断网结算: ${v.res.resultScore} ${v.res.resultAnswer} ${v.res.resultModes}`);
    await checkpoint('S3-离线结算与记录');
    await clickEl('.profile-bar a.btn-ghost');
    await waitUntil(async () => { const h = await homeCheck(); return h?.url === '/' && h.select ? h : null; }, '断网返回首页', 30000);
    await evalSync(INJECT);
    await checkpoint('S3-离线返回首页');
    const coinsAfterOff = await idbProfileSnapshot();
    record('S3 离线断源刷新（缓存打开 + 断网整局两步送达）',
      sourceDead && poolInfo.count > 0 && v.recOk && v.recentOk && v.snapCleared
        && coinsAfterOff?.coins === coinsBeforeOff?.coins,
      `SW ${swInfo.name} 受控且预缓存含 /english.html（含 /english.css、英语 dist 模块、角色 SVG ${swInfo.svgCount} 张，/img/english-courier/mum.svg 命中 status=${swInfo.svgCached}）；${serverWasAlive ? '杀 serve 4373（源站 fetch 确认失败）后' : '源站已在先前场景断开'}Safari 刷新同一标签页（非冷导航）：首页由缓存打开；菜单进 /english.html 由缓存正常加载（6 年级卡、boot-fail 隐藏）；断网下题库模块经 SW 预缓存 import 成功（${poolInfo.count} 任务）；选一年级（${avail}）完成断网整局 5 任务两步送达，全部首答完成，结算「${v.res.resultScore}」「${v.res.resultAnswer}」（断网局内站位角色图全部加载）；离线练习记录新增 1 条（gameId=${v.recRaw?.gameId}、score=50、5 任务全 firstTry）且列表显示「50 分 · 首答 5/5」；recent-ids 含本局全部任务 ID；结算返回后中断快照清除；离线金币 ${coinsBeforeOff?.coins} = ${coinsAfterOff?.coins}（零收支）；返回首页正常；全程无溢出、JS 错误 0`,
      { checks: { swInfo, sourceDead, serverWasAlive, poolInfo, avail, result: { score: v.res.resultScore, answer: v.res.resultAnswer, modes: v.res.resultModes }, roundId: played.roundId, tasks: played.questions, recRaw: v.recRaw, recOk: v.recOk, recentOk: v.recentOk, snapCleared: v.snapCleared, coins: [coinsBeforeOff?.coins, coinsAfterOff?.coins] } });
  } catch (e) {
    record('S3 离线断源刷新（缓存打开 + 断网整局两步送达）', false, `失败: ${e.message}`);
  }
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, udid: UDID, wdEndpoint: WD,
    userAgent: ua, scenarios, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, 'ios-offline-results.json'), JSON.stringify(summary, null, 2));
  log('结果已写入 ios-offline-results.json');
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  process.exitCode = summary.allPassed ? 0 : 1;
} else {
// ===== S1+S2 在线 =====
try {
  await wd('POST', `${base}/url`, { url: ORIGIN });
  await sleep(2500);
  await waitUntil(async () => { const h = await homeCheck(); return h?.select && !h.error ? h : null; }, '首页选择屏就绪', 30000);
  await evalSync(INJECT);
  await checkpoint('S1-在线首页');
  await shot('ios-online-01-home');
  const coinsBefore = await idbProfileSnapshot();
  log(`IndexedDB 档案局前: coins=${coinsBefore?.coins} records=${coinsBefore?.records} revision=${coinsBefore?.revision}`);

  // S1a：首页菜单「英语快递员」入口（五入口菜单）
  await clickEl('#btn-menu');
  await waitUntil(async () => { const h = await homeCheck(); return h.menuOpen && h.englishAnchor?.visible ? h : null; }, '菜单弹层打开');
  const menu = await homeCheck();
  await shot('ios-online-02-home-menu');
  const entryOk = menu.englishAnchor.href === '/english.html' && (menu.englishAnchor.text ?? '').includes('英语快递员')
    && menu.englishAnchor.decorAriaHidden === 'true'
    && menu.hanziAnchor?.visible && menu.dungeonAnchor?.visible && menu.pinyinAnchor?.visible;
  if (!entryOk) throw new Error(`菜单入口异常: ${JSON.stringify({ english: menu.englishAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor, pinyin: menu.pinyinAnchor })}`);
  await clickEl('#main-nav a[href="/english.html"]');
  await waitUntil(async () => { const s = await englishState(); return s.url === '/english.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '英语快递员选择屏就绪', 30000);
  await evalSync(INJECT);
  const poolInfo = await installPool();
  await checkpoint('S1-英语选择屏');
  await shot('ios-online-03-english-select');
  await discardResidue();
  const g1 = await toggleGrade('一年级', true);
  const expectAvail = `本局题库：一年级 18 个任务，共 18 个`;
  if (g1.availabilityStatus !== expectAvail) throw new Error(`可用性文案异常: ${g1.availabilityStatus}`);
  log('可用性文案:', g1.availabilityStatus);
  if (g1.storageNoticeHidden !== true) throw new Error('存储不可用提示意外出现');
  const backLink = (await englishState()).backLink;
  if (backLink?.href !== '/' || !backLink.text.includes('返回数字消除')) throw new Error(`返回链接异常: ${JSON.stringify(backLink)}`);

  // S1b：完整局 5 任务（第 1 任务对包裹错对象 → 对象不对 → 纠正重试档 +5）
  await clickEl('#btn-start');
  const played = await playRound({ wrongIndex: 0,
    shots: { vocab: 'ios-online-04-vocab-question', sentence: 'ios-online-05-sentence-question', wrong: 'ios-online-06-wrong-recipient' } });
  await shot('ios-online-07-result');
  const wrongQ = played.questions[0];
  if (!wrongQ.wrongFirst || wrongQ.gained !== 5) throw new Error(`重试档验证失败: ${JSON.stringify(wrongQ)}`);
  if (played.questions.filter(q => !q.wrongFirst).some(q => q.gained !== 10)) throw new Error('首答档非 +10');
  const v = await verifySettlementAndRecord(played);
  const coinsAfter = await idbProfileSnapshot();
  const coinsOk = coinsAfter?.coins === coinsBefore?.coins;
  await shot('ios-online-08-records');
  await checkpoint('S1-记录列表');
  record('S1 在线完整局（两步送达 el.click() + 第 1 任务错送纠正重试档 + 记录金币）',
    v.recOk && v.recentOk && coinsOk && v.rec.errors.length === 0 && !v.rec.overflow,
    `菜单「英语快递员」入口（href=/english.html、装饰字 aria-hidden，与汉字勇者/算术地下城/拼音冒险锚点并存）进入英语快递员；勾一年级→「${g1.availabilityStatus}」与 dist 层一致（${poolInfo.count} 任务全 approved：词汇 ${poolInfo.modes.vocab} + 句意 ${poolInfo.modes.sentence}）；完整局 5 任务（${played.questions.map(q => q.id + ':' + q.mode).join('、')}）：${played.questions.map(q => `第 ${q.index + 1} 任务「${q.prompt}」${q.wrongFirst ? '先对包裹错对象（✗ 对象不对，得分不变）→' : ''}送达完成 ${q.gained} 分`).join('→')}；结算「${v.res.resultScore}」「${v.res.resultAnswer}」「${v.res.resultModes}」与逐题档位（4×10+5=45、尝试 6）吻合；练习记录新增 1 条（gameId=${v.recRaw?.gameId}、recordId=roundId、score=${played.expectedScore}、逐题 mode 序列与局内观察一致、第 1 任务 wrongs=1）且列表显示「${played.expectedScore} 分 · 首答 4/5」；recent-ids 含本局全部任务 ID；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；JS 错误 0、无横向溢出`,
    { checks: { entry: { english: menu.englishAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor, pinyin: menu.pinyinAnchor },
      availability: g1.availabilityStatus, poolCount: poolInfo.count, roundId: played.roundId,
      tasks: played.questions, result: { score: v.res.resultScore, answer: v.res.resultAnswer, modes: v.res.resultModes },
      recOk: v.recOk, recentOk: v.recentOk, modesSequenceOk: v.modesSequenceOk,
      coinsBefore, coinsAfter, coinsOk, errors: v.rec.errors, overflow: v.rec.overflow } });

  // S2 返回路径与五入口并存
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
  await shot('ios-online-09-home-returned-menu');
  const fiveOk = menu2.hanziAnchor?.visible && menu2.dungeonAnchor?.visible && menu2.pinyinAnchor?.visible
    && menu2.englishAnchor?.visible
    && menu2.hanziAnchor.href === '/hanzi.html' && menu2.dungeonAnchor.href === '/dungeon.html'
    && menu2.pinyinAnchor.href === '/pinyin.html' && menu2.englishAnchor.href === '/english.html';
  await checkpoint('S2-菜单五入口');
  record('S2 返回路径与五入口并存', npOk && fiveOk,
    `英语快递员顶栏「${backLink.text}」返回数字消除首页；勾选一年级→下一步按钮启用（可选年级），取消复原；菜单弹层内「汉字勇者」（href=/hanzi.html）、「算术地下城」（href=/dungeon.html）、「拼音冒险」（href=/pinyin.html）与「英语快递员」（href=/english.html）四锚点并存可见（数字消除为当前页，共五入口）；无溢出、JS 错误 0`,
    { checks: { npOk, fiveOk, menu: { hanzi: menu2.hanziAnchor, dungeon: menu2.dungeonAnchor, pinyin: menu2.pinyinAnchor, english: menu2.englishAnchor } } });
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
process.exit(process.exitCode = scenarios.length && scenarios.every(s => s.pass) ? 0 : 1);
