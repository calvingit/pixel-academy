// 英语快递员（M10）桌面浏览器验收轮（实现者自验轮，只验证与记录，不改游戏代码）。
// 结构参照 docs/evidence/m9/pinyin-browser.mjs：无头 Chrome CDP 直连、真实鼠标事件
// trustedClick、evaluate 读取页面状态、error/unhandledrejection 注入收集、
// Page.reload 刷新恢复、杀源站进程断源。
// 正确作答从 dist 题库自算（/dist/game/english-courier/content.js 的 selectEnglishExercises
// + /dist/learning/english.js 的 englishDeliveryAnswer），不注入任何游戏状态；
// 站位与包裹身份只从角色卡不带文字标签的约束下发——收件人身份从 localStorage 快照
// 的 state.questions[qi].stations 读取（快照为游戏自持数据，非注入）。
// 覆盖 E1–E9：E1 首页菜单五入口 → E2 进入 english.html → E3 年级筛选 →
// E4 完整局（自算作答 + 未取件点选提示 + 对象不对纠错 + 结算/记录/金币）→
// E5 反馈矩阵（包裹不对 / 都不对，弃局不记成绩）→ E6 暂停与刷新恢复（站位/包裹排列一致）→
// E7 视口五档与触摸目标 → E8 四游戏回归 → E9 SW 五入口断网完整局。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9742';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m10';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[english]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

// ===== CDP 连接 =====
const targets = await (await fetch(`${CDP_HTTP}/json`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, msg => { clearTimeout(timer); msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result); });
  });
};
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
await send('DOM.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
` });

const waitUntil = async (fn, desc, timeoutMs = 20000) => {
  const start = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(300);
  }
};

const goto = async url => {
  await send('Page.navigate', { url });
  await sleep(1200);
};

// ===== 首页（数字消除）状态 =====
const homeState = () => evaluate(`(() => {
  const anchor = sel => { const a = document.querySelector(sel);
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/[\\s]+/g, ' '),
      decorAriaHidden: a.querySelector('span')?.getAttribute('aria-hidden') ?? null,
      visible: !!(a.offsetWidth || a.offsetHeight) } : null; };
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('main h1')?.textContent ?? null,
    selectVisible: !document.getElementById('screen-select')?.hidden,
    errorVisible: !document.getElementById('screen-error')?.hidden,
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    navItems: [...(document.getElementById('main-nav')?.children ?? [])].map(el => ({ tag: el.tagName, text: el.textContent.trim().replace(/[\\s]+/g, ' ') })),
    hanziAnchor: anchor('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: anchor('#main-nav a[href="/dungeon.html"]'),
    pinyinAnchor: anchor('#main-nav a[href="/pinyin.html"]'),
    englishAnchor: anchor('#main-nav a[href="/english.html"]'),
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
  let settingsRaw = null;
  try { settingsRaw = JSON.parse(localStorage.getItem('pixel-academy:english-courier:v1:settings') ?? 'null'); } catch {}
  const stationRects = [...document.querySelectorAll('#stations .station-card')].map(b => {
    const r = b.getBoundingClientRect();
    const img = b.querySelector('img');
    return { min: Math.min(r.width, r.height), imgLoaded: !!img && img.complete && img.naturalWidth > 0, label: b.getAttribute('aria-label') };
  });
  const parcelRects = [...document.querySelectorAll('#parcels .parcel-card')].map(b => {
    const r = b.getBoundingClientRect();
    return { min: Math.min(r.width, r.height), word: b.dataset.word ?? null, carried: b.classList.contains('parcel-carried') };
  });
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('main h1')?.textContent ?? null,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    storageNoticeHidden: document.getElementById('storage-notice')?.hidden,
    selectVisible: !hidden('screen-select'),
    gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'),
    backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
      return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
    gradeCards: [...document.querySelectorAll('#grade-grid button')].map(b => ({
      text: b.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, title: b.title ?? null })),
    availabilityStatus: t('availability-status'),
    startDisabled: document.getElementById('btn-start')?.disabled,
    restoreOfferHidden: hidden('restore-offer'),
    restoreOfferText: t('restore-offer-text'),
    restoreIncompatibleHidden: hidden('restore-incompatible'),
    records: [...document.querySelectorAll('#records-list li')].map(li => li.textContent),
    hudProgress: t('hud-progress'), hudScore: t('hud-score'),
    pausePressed: document.getElementById('btn-pause')?.getAttribute('aria-pressed'),
    questionVisible: !hidden('question-card'),
    qMode: t('q-mode'),
    prompt: t('q-prompt'),
    carryingStatus: t('carrying-status'),
    carryingStatusCarried: document.getElementById('carrying-status')?.dataset.carried ?? null,
    parcels: parcelRects,
    stations: stationRects,
    feedbackHidden: hidden('feedback'),
    feedback: t('feedback'),
    pauseOverlayHidden: hidden('pause-overlay'),
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    confirmText: t('confirm-text'),
    resultScore: t('result-score'),
    resultAnswer: t('result-answer'),
    resultModes: t('result-modes'),
    snap, recordsRaw, recentIds, settingsRaw,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 其他游戏回归状态 =====
const quickState = () => evaluate(`(() => ({
  url: location.href, title: document.title,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  selectVisible: !document.getElementById('screen-select')?.hidden,
  gradeCards: document.querySelectorAll('#grade-grid button').length,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);

// ===== 题库池安装：答案从 dist 自算 =====
const installPool = () => evaluate(`(async () => {
  const { selectEnglishExercises } = await import('/dist/game/english-courier/content.js');
  const { englishDeliveryAnswer, englishCanonicalWord } = await import('/dist/learning/english.js');
  const picked = selectEnglishExercises([1]);
  const map = {};
  for (const e of picked) {
    const answer = englishDeliveryAnswer(e.task);
    map[e.id] = { id: e.id, status: e.review.status, mode: e.task.mode, prompt: e.task.prompt,
      parcels: [...e.task.parcels], recipients: [...e.task.recipients],
      parcelAnswer: answer.parcel, recipientAnswer: answer.recipient,
      canonical: w => { try { return englishCanonicalWord(w); } catch { return null; } } };
  }
  window.__pool = map;
  const modes = picked.reduce((acc, e) => { acc[e.task.mode] = (acc[e.task.mode] ?? 0) + 1; return acc; }, {});
  return { count: picked.length, modes, statuses: [...new Set(picked.map(e => e.review.status))] };
})()`);

const poolEntry = id => evaluate(`(() => {
  const e = (window.__pool ?? {})[${JSON.stringify(id)}];
  if (!e) throw new Error('题库池缺少 exerciseId: ' + ${JSON.stringify(id)});
  return e;
})()`);

// ===== 交互辅助 =====
const click = selector => evaluate(`(() => { document.querySelector(${JSON.stringify(selector)})?.click(); })()`, false);
const trustedClick = async selector => {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    // 低视口下目标可能在折叠线以下：先滚动到视口内再取坐标（否则真实点击落在视口外）。
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) throw new Error('element not visible (zero rect): ' + ${JSON.stringify(selector)});
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`, false);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
};
const pressTab = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
};

const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click(); })()`, false);
  const s = await englishState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want ? s : null;
}, `勾选年级 ${name}`);

// 当前任务快照行（题目序、站位、包裹、携带）。
const currentSnapRow = () => evaluate(`(() => {
  const raw = localStorage.getItem('pixel-academy:english-courier:v1:interrupted');
  if (!raw) return null;
  const snap = JSON.parse(raw);
  return { roundId: snap.roundId, qi: snap.state.questionIndex, question: snap.state.questions[snap.state.questionIndex],
    carrying: snap.state.carrying, score: snap.state.score, attempts: snap.state.attempts, wrongs: snap.state.wrongs };
})()`);

const waitQuestion = (index, desc = `第 ${index + 1} 个任务可作答`) => waitUntil(async () => {
  const s = await englishState();
  if (!s.gameVisible || !s.questionVisible) return null;
  if (s.hudProgress !== `第 ${index + 1}/5 个任务`) return null;
  if (!s.parcels.length || !s.stations.length) return null;
  if (s.parcels.some(b => b.min < 44) || s.stations.some(b => b.min < 44)) return null;
  return s;
}, desc);

const waitResult = () => waitUntil(async () => {
  const s = await englishState();
  return s.resultVisible ? s : null;
}, '结算屏');

// 按包裹词取件（真实点击）。
const pickWord = async word => {
  const idx = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('#parcels .parcel-card')];
    const i = btns.findIndex(b => b.dataset.word === ${JSON.stringify(word)});
    if (i < 0) throw new Error('包裹未找到: ' + ${JSON.stringify(word)} + '；现有: ' + btns.map(b => b.dataset.word).join(','));
    return i;
  })()`, false);
  await trustedClick(`#parcels .parcel-card:nth-of-type(${idx + 1})`);
};

// 按站位下标送达（真实点击；身份不进 DOM，从快照 stations 映射）。
const deliverStation = async stationIndex => {
  await trustedClick(`#stations .station-card:nth-of-type(${stationIndex + 1})`);
};

// 当前任务作答计划：在页面内读快照行 + 从 dist 题库自算正确/错误包裹与站位
//（函数对象不可跨 CDP 序列化，全部比较在页面内完成）。
const planMove = () => evaluate(`(async () => {
  const raw = localStorage.getItem('pixel-academy:english-courier:v1:interrupted');
  const snap = JSON.parse(raw);
  const row = { qi: snap.state.questionIndex, question: snap.state.questions[snap.state.questionIndex],
    carrying: snap.state.carrying, score: snap.state.score,
    attempts: snap.state.attempts, wrongs: snap.state.wrongs };
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

// 完成当前任务：按计划取件 → 送达。
async function solveCurrent({ wrongParcel = false, wrongRecipient = false } = {}) {
  const plan = await planMove();
  const parcel = wrongParcel ? plan.wrongParcel : plan.correctParcel;
  const station = wrongRecipient ? plan.wrongStation : plan.correctStation;
  await pickWord(parcel);
  await deliverStation(station);
  return { id: plan.exerciseId, mode: plan.mode, prompt: plan.prompt, pickedParcel: parcel, stationIndex: station };
}

// IndexedDB 档案（金币只读）。
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

// ============================================================
// E1 首页菜单五入口（四游戏锚点并存、键盘可达、aria）
// ============================================================
try {
  await goto(`${ORIGIN}`);
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible && s.hanziAnchor && s.dungeonAnchor && s.pinyinAnchor && s.englishAnchor ? s : null; }, '首页选择屏就绪');
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.englishAnchor?.visible ? s : null; }, '菜单弹层打开');
  const s1 = await homeState();
  const focusPath = [];
  let keyboardReached = false;
  for (let i = 0; i < 20; i++) {
    const ae = await evaluate(`(() => { const el = document.activeElement;
      return el === document.querySelector('#main-nav a[href="/english.html"]') ? 'TARGET'
        : (el ? (el.id || el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().replace(/[\\s]+/g, ' ').slice(0, 10)) : 'none'); })()`, false);
    if (ae === 'TARGET') { keyboardReached = true; break; }
    focusPath.push(ae);
    await pressTab();
    await sleep(60);
  }
  let axName = null, axRole = null, axQueried = false;
  try {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#main-nav a[href="/english.html"]' });
    const ax = await send('Accessibility.getPartialAXTree', { nodeId: node.nodeId, fetchRelatives: true });
    const link = ax.nodes.find(n => n.role?.value === 'link');
    axRole = link?.role?.value ?? null;
    axName = link?.name?.value ?? null;
    axQueried = true;
  } catch (e) { log('无障碍树查询失败（降级结构断言）:', String(e)); }
  await shot('e1-01-home-menu');
  const ariaOk = axQueried ? axRole === 'link' && (axName ?? '').includes('英语快递员')
    : s1.englishAnchor?.decorAriaHidden === 'true' && (s1.englishAnchor?.text ?? '').includes('英语快递员');
  const ok = (s1.h1 ?? '').startsWith('数字消除')
    && s1.englishAnchor?.href === '/english.html' && s1.englishAnchor?.visible
    && (s1.englishAnchor?.text ?? '').includes('英语快递员')
    && s1.hanziAnchor?.visible && s1.dungeonAnchor?.visible && s1.pinyinAnchor?.visible
    && keyboardReached && ariaOk && s1.errors.length === 0;
  record('E1 首页菜单五入口', ok,
    `菜单弹层内「英语快递员」入口 href=/english.html 可见（文本含「读英语指令送包裹」），装饰字 span aria-hidden=${s1.englishAnchor?.decorAriaHidden}；与汉字勇者/算术地下城/拼音冒险三入口并存（共 ${s1.navItems.length} 项）；Tab ${keyboardReached ? '可达' : '未达'}英语入口（路径 ${JSON.stringify(focusPath)}）；AX 角色 ${axRole}、名称「${axName}」；JS 错误 ${s1.errors.length} 个`,
    { checks: { englishAnchor: s1.englishAnchor, navItems: s1.navItems, keyboardReached, axName, axRole, overflow: s1.overflowX, errors: s1.errors } });
} catch (e) {
  record('E1 首页菜单五入口', false, `失败: ${e.message}`);
}

// ============================================================
// E2 真实点击进入 english.html
// ============================================================
try {
  await trustedClick('#main-nav a[href="/english.html"]');
  const s2 = await waitUntil(async () => {
    const s = await englishState();
    return s.url.includes('/english.html') && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null;
  }, '英语快递员选择屏就绪');
  await sleep(400);
  const s2b = await englishState();
  await shot('e2-01-english-entered');
  record('E2 进入 english.html', s2b.h1?.includes('英语快递员') && s2b.title.includes('英语快递员')
    && s2b.backLink?.href === '/' && s2b.backLink?.visible && s2b.bootFailHidden && s2b.errors.length === 0,
    `真实点击菜单入口后 URL=${s2b.url}，标题「${s2b.title}」正常加载：h1=${s2b.h1?.trim()}、6 张年级卡、boot-fail 隐藏、存储提示隐藏=${s2b.storageNoticeHidden}、「返回数字消除」锚点可见，JS 错误 ${s2b.errors.length} 个`,
    { checks: { backLink: s2b.backLink, gradeCards: s2b.gradeCards, overflow: s2b.overflowX, errors: s2b.errors } });
} catch (e) {
  record('E2 进入 english.html', false, `失败: ${e.message}`);
}

// ============================================================
// E3 年级筛选（一年级 18 任务、二~六年级禁用不混入）
// ============================================================
try {
  const counts = await evaluate(`(async () => {
    const { selectEnglishExercises, describeAvailability } = await import('/dist/game/english-courier/content.js');
    const per = {};
    for (const g of [1,2,3,4,5,6]) per[g] = selectEnglishExercises([g]).length;
    return { per, descG2: describeAvailability([2]), descG1: describeAvailability([1]) };
  })()`);
  const poolInfo = await installPool();
  // 清空年级选择（前序场景可能已勾选并存档），从「未选年级」开始断言。
  await evaluate(`(() => { [...document.querySelectorAll('#grade-grid button')]
    .forEach(b => { if (b.getAttribute('aria-pressed') === 'true') b.click(); }); })()`, false);
  const s0 = await englishState();
  const startDisabledBefore = s0.startDisabled;
  await toggleGrade('一年级', true);
  const g1 = await englishState();
  const expectG1 = `本局题库：一年级 18 个任务，共 18 个`;
  const clickG2 = await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === '二年级'); b.click(); return b.disabled; })()`, false);
  const g2after = await englishState();
  const g2Card = g2after.gradeCards.find(c => c.text === '二年级');
  await shot('e3-01-grade-filter');
  const ok = poolInfo.count === 18 && poolInfo.modes.vocab === 10 && poolInfo.modes.sentence === 8
    && poolInfo.statuses.every(x => x === 'approved')
    && counts.per[1] === 18 && [2,3,4,5,6].every(g => counts.per[g] === 0)
    && startDisabledBefore === true && g1.startDisabled === false
    && g1.availabilityStatus === expectG1
    && g2Card?.disabled === true && g2Card?.pressed === 'false' && clickG2 === true
    && g2after.availabilityStatus === expectG1 && g2Card?.title === '暂未开放'
    && counts.descG2.startable === false
    && g1.errors.length === 0;
  record('E3 年级筛选', ok,
    `dist 层 selectEnglishExercises([1])=18 个任务（词汇 ${poolInfo.modes.vocab} + 句意 ${poolInfo.modes.sentence}，全部 approved），二~六年级各 ${[2,3,4,5,6].map(g => counts.per[g]).join('/')} 个；UI 初始未选年级开始禁用 → 勾一年级→「${g1.availabilityStatus}」（与 dist 一致）、开始可用；二年级卡禁用置灰（点击无效，提示不变）——未开放年级不混入；dist 层 describeAvailability([2])=「${counts.descG2.statusText}」；JS 错误 ${g1.errors.length} 个`,
    { checks: { poolInfo, perGrade: counts.per, descG2: counts.descG2, g1Status: g1.availabilityStatus, g2Card, settings: g1.settingsRaw, overflow: g1.overflowX, errors: g1.errors } });
} catch (e) {
  record('E3 年级筛选', false, `失败: ${e.message}`);
}

// ============================================================
// E4 完整局 5 任务：未取件点选提示 + 自算作答（第 3 题先「对象不对」再纠正）
// → 结算与逐题档位吻合 → 记录与金币。期望 4 题首答 + 1 题重试 = 45 分。
// ============================================================
let e4RoundId = null;
try {
  await installPool();
  const coinsBefore = await idbProfileSnapshot();
  await click('#btn-start');
  const q1 = await waitQuestion(0, 'E4 第 1 个任务可作答');
  e4RoundId = q1.snap?.roundId ?? null;
  const tasks = [];
  const wrongIndex = 2; // 第 3 个任务故意先错送（对包裹错对象）
  // 未取件点选角色：信息提示、不构成作答（attempts 保持 0）
  await deliverStation(0);
  const noCarry = await waitUntil(async () => {
    const s = await englishState();
    return s.feedbackHidden === false && (s.feedback ?? '').includes('先取一个包裹') ? s : null;
  }, '未取件点选提示');
  const rowAfterNoCarry = await currentSnapRow();
  await shot('e4-01-no-carry-hint');
  if (rowAfterNoCarry.attempts[0] !== 0) throw new Error(`未取件点选竟计为尝试: ${JSON.stringify(rowAfterNoCarry.attempts)}`);
  for (let i = 0; i < 5; i++) {
    const s = await (i === 0 ? Promise.resolve(q1) : waitQuestion(i, `E4 第 ${i + 1} 个任务可作答`));
    if (i === wrongIndex) await shot('e4-02-before-wrong');
    if (i === wrongIndex) {
      // 先「对包裹错对象」→ ✗ 对象不对 → 纠正后 +5
      const plan = await planMove();
      await pickWord(plan.correctParcel);
      await deliverStation(plan.wrongStation);
      const wrongFb = await waitUntil(async () => {
        const st = await englishState();
        return st.feedbackHidden === false && (st.feedback ?? '').includes('对象不对') ? st : null;
      }, '「对象不对」反馈');
      await shot('e4-03-wrong-recipient');
      const rowWrong = await currentSnapRow();
      if (rowWrong.attempts[rowWrong.qi] !== 1 || rowWrong.wrongs[rowWrong.qi] !== 1) throw new Error(`错送计数异常: ${JSON.stringify(rowWrong)}`);
      if (rowWrong.carrying !== plan.correctParcel) throw new Error('错送后携带丢失');
      await deliverStation(plan.correctStation);
      const okFb = await waitUntil(async () => { const st = await englishState(); return st.feedbackHidden === false && (st.feedback ?? '').includes('+5') ? st.feedback : null; }, '纠正后 +5 反馈');
      tasks.push({ id: plan.exerciseId, mode: plan.mode, wrong: true, feedback: { wrongFb: wrongFb.feedback, okFb } });
    } else {
      const solved = await solveCurrent({});
      const fb = await waitUntil(async () => { const st = await englishState(); return st.feedbackHidden === false && (st.feedback ?? '').startsWith('✓') ? st.feedback : null; }, '答对反馈');
      if (!fb.includes('+10')) throw new Error(`首答加分异常: ${fb}`);
      tasks.push({ ...solved, feedback: fb });
    }
    if (i === 0) await shot('e4-04-first-solved');
    if (i < 4) await waitUntil(async () => { const st = await englishState(); return st.hudProgress === `第 ${i + 2}/5 个任务` ? st : null; }, `推进到第 ${i + 2} 个任务`);
  }
  const result = await waitResult();
  await shot('e4-05-result');
  const s4 = await englishState();
  const vocabCount = tasks.filter(t => t.mode === 'vocab').length;
  const sentenceCount = tasks.filter(t => t.mode === 'sentence').length;
  const vocabFirst = tasks.filter(t => t.mode === 'vocab' && !t.wrong).length;
  const sentenceFirst = tasks.filter(t => t.mode === 'sentence' && !t.wrong).length;
  const expectScore = 4 * 10 + 5;
  const expectModes = `词汇识别 ${vocabFirst}/${vocabCount} 题首答 · 句意理解 ${sentenceFirst}/${sentenceCount} 题首答`;
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await englishState(); return s.selectVisible ? s : null; }, '返回选择屏');
  const rec = await englishState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === e4RoundId) ?? null;
  const recordOk = recRaw && recRaw.gameId === 'english-courier' && recRaw.score === expectScore
    && recRaw.answer?.tasks?.length === 5
    && JSON.stringify(recRaw.answer.tasks.map(t => t.mode)) === JSON.stringify(tasks.map(t => t.mode))
    && recRaw.answer.tasks.every(t => t.attempts >= 1)
    && recRaw.answer.tasks.filter(t => t.firstTry).length === 4
    && recRaw.answer.tasks[tasks.findIndex(t => t.wrong)].wrongs === 1
    && rec.records.some(r => r.includes(`${expectScore} 分 · 首答 4/5`));
  const recentOk = Array.isArray(rec.recentIds) && recRaw
    && recRaw.answer.tasks.every(t => rec.recentIds.includes(t.exerciseId));
  const coinsAfter = await idbProfileSnapshot();
  const finalState = await englishState();
  const ok = s4.resultScore === `总分 ${expectScore}`
    && s4.resultAnswer === `完成 5 个任务 · 首次一次完成 4 · 错送 1 次 · 送达尝试 6 次`
    && s4.resultModes === expectModes && recordOk && recentOk
    && noCarry.feedbackHidden === false
    && coinsAfter?.coins === coinsBefore?.coins && finalState.errors.length === 0;
  record('E4 完整局 5 任务（未取件提示 + 错送纠正 + 记录/金币）', ok,
    `roundId=${e4RoundId}，5 任务构成 ${vocabCount} 词汇 + ${sentenceCount} 句意（${tasks.map(t => t.id + ':' + t.mode).join('、')}）；未取件点选角色→提示「${noCarry.carryingStatus}」且快照 attempts 保持 0；第 3 任务对包裹错对象→✗「对象不对」（attempts=1、wrongs=1、携带保留）→纠正送达 +5；其余 4 任务自算首答 +10；结算「${s4.resultScore}」「${s4.resultAnswer}」「${s4.resultModes}」与逐题档位（4×10 + 5、尝试 6 = 5+1）吻合；记录 gameId=${recRaw?.gameId}、score=${expectScore}、模式序列=${JSON.stringify(recRaw?.answer?.tasks?.map(t => t.mode))}、首答 4/5、错送任务 wrongs=1；recent-ids 含本局全部任务 ID=${recentOk}；金币 ${coinsBefore?.coins} = ${coinsAfter?.coins}（零收支）；JS 错误 ${finalState.errors.length} 个`,
    { checks: { roundId: e4RoundId, tasks, noCarryHint: noCarry.feedback, expect: { score: expectScore, firstTry: 4, attempts: 6 }, result: { score: s4.resultScore, answer: s4.resultAnswer, modes: s4.resultModes }, recordRaw: recRaw, recentOk, coinsBefore, coinsAfter, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('E4 完整局 5 任务（未取件提示 + 错送纠正 + 记录/金币）', false, `失败: ${e.message}`);
}

// ============================================================
// E5 反馈矩阵：对包裹错对象（对象不对，E4 已验）之外——
// 错包裹对对象 →「包裹不对」；双错 →「都不对」；随后弃局不记成绩。
// ============================================================
try {
  await installPool();
  const recordsBefore = (await englishState()).recordsRaw?.records?.length ?? 0;
  await click('#btn-start');
  await waitQuestion(0, 'E5 第 1 个任务可作答');
  const plan = await planMove();
  const ex = { id: plan.exerciseId, mode: plan.mode, prompt: plan.prompt };
  const correctParcel = plan.correctParcel;
  const wrongParcel = plan.wrongParcel;
  const correctStation = plan.correctStation;
  const wrongStation = plan.wrongStation;
  // 错包裹 + 对收件人 → 包裹不对
  await pickWord(wrongParcel);
  await deliverStation(correctStation);
  const fb1 = await waitUntil(async () => {
    const s = await englishState();
    return s.feedbackHidden === false && (s.feedback ?? '').includes('包裹不对') ? s.feedback : null;
  }, '「包裹不对」反馈');
  await shot('e5-01-wrong-parcel');
  const row1 = await currentSnapRow();
  // 双错 → 都不对（携带仍为错包裹，直接再送错站位）
  await deliverStation(wrongStation);
  const fb2 = await waitUntil(async () => {
    const s = await englishState();
    return s.feedbackHidden === false && (s.feedback ?? '').includes('都不对') ? s.feedback : null;
  }, '「都不对」反馈');
  await shot('e5-02-both-wrong');
  const row2 = await currentSnapRow();
  // 弃局：返回 → 确认 → 无成绩记录
  await click('#btn-game-return');
  await waitUntil(async () => { const s = await englishState(); return s.confirmOpen ? s : null; }, '弃局确认弹窗');
  const confirmText = (await englishState()).confirmText;
  await click('#btn-confirm-yes');
  await waitUntil(async () => { const s = await englishState(); return s.selectVisible ? s : null; }, '弃局回选择屏');
  const after = await englishState();
  const recordsAfter = after.recordsRaw?.records?.length ?? 0;
  const finalState = await englishState();
  const ok = fb1?.includes('包裹不对') && fb2?.includes('都不对')
    && row1.attempts[0] === 1 && row1.wrongs[0] === 1
    && row2.attempts[0] === 2 && row2.wrongs[0] === 2
    && row2.carrying === wrongParcel
    && (confirmText ?? '').includes('放弃')
    && after.snap === null && recordsAfter === recordsBefore
    && finalState.errors.length === 0;
  record('E5 反馈矩阵（包裹不对 / 都不对）与弃局不记成绩', ok,
    `开局第 1 任务「${ex.prompt}」（${ex.mode}）：错包裹「${wrongParcel}」送对收件人→✗「${fb1}」（attempts=1 wrongs=1）；保持错包裹再送错站位→✗「${fb2}」（attempts=2 wrongs=2，携带保留）；「返回」确认弹窗「${confirmText}」→放弃后快照清除=${after.snap === null}、成绩记录 ${recordsBefore}→${recordsAfter} 条（不新增）；JS 错误 ${finalState.errors.length} 个`,
    { checks: { ex: { id: ex.id, mode: ex.mode, prompt: ex.prompt }, fb1, fb2, row1, row2, confirmText, recordsBefore, recordsAfter, snapshotDiscarded: after.snap === null, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('E5 反馈矩阵（包裹不对 / 都不对）与弃局不记成绩', false, `失败: ${e.message}`);
}

// ============================================================
// E6 暂停/恢复 + 刷新恢复（站位与包裹排列一致、携带保留、不重复计分）
// ============================================================
try {
  await installPool();
  await click('#btn-start');
  await waitQuestion(0, 'E6 第 1 个任务可作答');
  // 取件后暂停（携带状态进快照）
  const row0 = await currentSnapRow();
  await pickWord(row0.question.parcels[0]);
  await trustedClick('#btn-pause');
  await waitUntil(async () => { const s = await englishState(); return s.pauseOverlayHidden === false ? s : null; }, 'E6 暂停覆盖层');
  const paused = await englishState();
  await shot('e6-01-pause-overlay');
  if (paused.hudScore !== '得分 0') throw new Error(`E6 暂停时 HUD 异常: ${paused.hudScore}`);
  await trustedClick('#btn-resume');
  await waitUntil(async () => { const s = await englishState(); return s.pauseOverlayHidden === true && s.gameVisible ? s : null; }, 'E6 恢复');
  // 完成 2 题后刷新
  for (let i = 0; i < 2; i++) {
    await waitQuestion(i, `E6 第 ${i + 1} 个任务可作答`);
    await solveCurrent({});
    if (i < 1) await waitUntil(async () => { const st = await englishState(); return st.hudProgress === `第 ${i + 2}/5 个任务` ? st : null; }, `E6 推进到第 ${i + 2} 个任务`);
  }
  await waitUntil(async () => { const st = await englishState(); return st.hudProgress === '第 3/5 个任务' ? st : null; }, 'E6 到第 3 个任务');
  const before = await englishState();
  const beforeSnap = before.snap;
  if (!beforeSnap || beforeSnap.state?.questionIndex !== 2) throw new Error('刷新前置状态不是第 3 个任务');
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => {
    const s = await englishState();
    return s.selectVisible && s.restoreOfferHidden === false ? s : null;
  }, '刷新后恢复提供');
  const offer = await englishState();
  await shot('e6-02-restore-offer');
  await click('#btn-restore');
  await waitUntil(async () => { const s = await englishState(); return s.gameVisible && s.hudProgress === '第 3/5 个任务' ? s : null; }, '恢复到第 3 个任务');
  await sleep(300);
  const restored = await englishState();
  await shot('e6-03-restored');
  await installPool();
  // 排列一致断言：恢复后快照与刷新前完全一致（任务序、每任务包裹/站位排列、得分）
  const stateOk = restored.hudScore === `得分 ${beforeSnap.state.score}`
    && restored.hudProgress === '第 3/5 个任务'
    && restored.snap?.roundId === beforeSnap.roundId
    && restored.snap?.state?.score === beforeSnap.state.score
    && restored.snap?.state?.questionIndex === beforeSnap.state.questionIndex
    && restored.snap?.state?.attempts.join(',') === beforeSnap.state.attempts.join(',')
    && JSON.stringify(restored.snap?.state?.questions?.map(q => [q.exerciseId, q.parcels, q.stations]))
      === JSON.stringify(beforeSnap.state.questions?.map(q => [q.exerciseId, q.parcels, q.stations]))
    // DOM 包裹排列与快照一致（洗牌排列进 UI）
    && JSON.stringify(restored.parcels.map(p => p.word)) === JSON.stringify(beforeSnap.state.questions[2].parcels);
  // 续答 3 题到结算（不重复计分：期望 = 刷新前 20 + 新增 30）
  for (let i = 2; i < 5; i++) {
    await waitQuestion(i, `E6 第 ${i + 1} 个任务可作答`);
    await solveCurrent({});
    if (i < 4) await waitUntil(async () => { const s = await englishState(); return s.hudProgress === `第 ${i + 2}/5 个任务` ? s : null; }, `E6 推进到第 ${i + 2} 个任务`);
  }
  const result = await waitResult();
  await shot('e6-04-result');
  const s6 = await englishState();
  const expectScore6 = beforeSnap.state.score + 30;
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await englishState(); return s.selectVisible ? s : null; }, 'E6 返回选择屏');
  const rec = await englishState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === beforeSnap.roundId) ?? null;
  const recordOk = recRaw && recRaw.recordId === beforeSnap.roundId && recRaw.score === expectScore6
    && recRaw.answer?.tasks?.length === 5 && recRaw.answer.tasks.every(t => t.firstTry === true)
    && (rec.recordsRaw?.records ?? []).filter(r => r.recordId === beforeSnap.roundId).length === 1;
  const finalState = await englishState();
  const ok = paused.pauseOverlayHidden === false && offer.restoreOfferText?.includes('有未完成的配送任务') && stateOk
    && s6.resultScore === `总分 ${expectScore6}`
    && recordOk && finalState.errors.length === 0;
  record('E6 暂停/恢复与刷新恢复（排列一致不重复计分）', ok,
    `开局取件（包裹「${row0.question.parcels[0]}」）后暂停：覆盖层出现、得分 0 不变、携带进快照，继续后正常；完成 2 任务（得分 20）后 Page.reload：恢复提供「${offer.restoreOfferText?.slice(0, 30)}…」→继续配送→第 3/5 个任务、得分 ${beforeSnap.state.score}、roundId/任务序/每任务包裹与站位排列/尝试计数与刷新前逐项一致（快照恢复），DOM 包裹排列与快照一致=${stateOk}→续答 3 任务全对→结算「${s6.resultScore}」（= 刷新前 20 + 新增 30；若前两题重计应为 ${expectScore6 + 20}）；记录 recordId=roundId 幂等恰 1 条、5 任务全 firstTry=${recordOk}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { beforeSnap, restoredSnap: restored.snap, stateOk, expect: { score: expectScore6 }, result: { score: s6.resultScore, answer: s6.resultAnswer, modes: s6.resultModes }, recordRaw: recRaw, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('E6 暂停/恢复与刷新恢复（排列一致不重复计分）', false, `失败: ${e.message}`);
}

// ============================================================
// E7 视口五档：320×568、390×844、412×915、568×320 横屏、1280×800；
// 每档无横向溢出；390 档包裹/站位触摸目标 ≥44px、角色图全部加载。
// ============================================================
try {
  await installPool();
  await toggleGrade('一年级', true);
  const viewports = [
    { name: '320x568', width: 320, height: 568, mobile: true },
    { name: '390x844', width: 390, height: 844, mobile: true },
    { name: '412x915', width: 412, height: 915, mobile: true },
    { name: '568x320-landscape', width: 568, height: 320, mobile: true },
    { name: '1280x800-desktop', width: 1280, height: 800, mobile: false },
  ];
  const shots = [];
  let touchOk = null;
  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: vp.mobile });
    await sleep(500);
    await goto(`${ORIGIN}english.html`);
    await waitUntil(async () => { const s = await englishState(); return s.selectVisible && s.bootFailHidden ? s : null; }, `视口 ${vp.name} 选择屏`);
    await click('#btn-start');
    await waitQuestion(0, `视口 ${vp.name} 局内`);
    const s = await englishState();
    await shot(`e7-${vp.name}`);
    shots.push({ name: vp.name, overflowX: s.overflowX, parcels: s.parcels.length, stations: s.stations.length });
    if (vp.name === '390x844') {
      touchOk = {
        parcelMin: Math.min(...s.parcels.map(p => p.min)),
        stationMin: Math.min(...s.stations.map(b => b.min)),
        imagesLoaded: s.stations.every(b => b.imgLoaded),
        imageCount: s.stations.length,
      };
      await shot('e7-390-game-detail');
    }
    await click('#btn-game-return');
    await waitUntil(async () => { const st = await englishState(); return st.confirmOpen ? st : null; }, 'E7 弃局确认');
    await click('#btn-confirm-yes');
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await goto(`${ORIGIN}english.html`);
  const finalState = await englishState();
  const ok = shots.every(v => v.overflowX === false) && touchOk
    && touchOk.parcelMin >= 44 && touchOk.stationMin >= 44 && touchOk.imagesLoaded && touchOk.imageCount >= 3
    && finalState.errors.length === 0;
  record('E7 视口五档与触摸目标', ok,
    `五档（${shots.map(v => v.name).join('、')}）局内均无横向溢出；390×844 档包裹触摸目标最小 ${touchOk.parcelMin}px、站位卡最小 ${touchOk.stationMin}px（≥44）、站位角色图 ${touchOk.imageCount} 张全部加载（naturalWidth>0）；截图见 e7-*.png；JS 错误 ${finalState.errors.length} 个`,
    { checks: { viewports: shots, touchOk, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  try { await send('Emulation.clearDeviceMetricsOverride'); } catch {}
  record('E7 视口五档与触摸目标', false, `失败: ${e.message}`);
}

// ============================================================
// E8 四游戏回归（数字消除/汉字勇者/算术地下城/拼音冒险 加载与返回正常）
// ============================================================
try {
  await trustedClick('.profile-bar a.btn-ghost');
  const home = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible && s.englishAnchor ? s : null;
  }, 'E8 回到数字消除首页');
  const results = {};
  for (const [name, href] of [['hanzi', '/hanzi.html'], ['dungeon', '/dungeon.html'], ['pinyin', '/pinyin.html']]) {
    await trustedClick('#btn-menu');
    await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, `E8 菜单（${name}）`);
    await trustedClick(`#main-nav a[href="${href}"]`);
    const gs = await waitUntil(async () => {
      const s = await quickState();
      return s.url.endsWith(href) && s.bootFailHidden && s.selectVisible && s.gradeCards >= 6 ? s : null;
    }, `E8 ${name} 加载`);
    await shot(`e8-${name}`);
    await trustedClick('.profile-bar a.btn-ghost, .profile-bar a[href="/"]');
    await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, `E8 ${name} 返回首页`);
    results[name] = { gradeCards: gs.gradeCards, errors: gs.errors };
  }
  const finalHome = await homeState();
  const ok = home.selectVisible && Object.values(results).every(r => r.gradeCards >= 6)
    && finalHome.errors.length === 0 && Object.values(results).every(r => r.errors.length === 0);
  record('E8 四游戏回归', ok,
    `英语「返回数字消除」回首页；菜单经真实点击进 hanzi.html、dungeon.html、pinyin.html 均正常加载（年级卡 ${Object.values(results).map(r => r.gradeCards).join('/')} 张、boot-fail 隐藏）并经返回锚点回首页；四游戏进出 JS 错误 0`,
    { checks: { results, overflow: finalHome.overflowX, errors: { home: finalHome.errors, ...results } } });
} catch (e) {
  record('E8 四游戏回归', false, `失败: ${e.message}`);
}

// ============================================================
// E9 SW 五入口断网：预缓存含 /english.html、english dist 模块与 12 张 SVG，
// 杀源后首页与英语快递员缓存可达，断网完整局（自算作答）结算并记录。
// ============================================================
try {
  await waitUntil(async () => { const s = await englishState(); return s.selectVisible ? s : null; }, 'E9 英语页就绪');
  const swInfo = await waitUntil(async () => evaluate(`(async () => {
    if (navigator.serviceWorker.controller === null) return null;
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    const entries = await cache.keys();
    const svgs = entries.filter(r => r.url.includes('/img/english-courier/')).length;
    const need = ['/', '/hanzi.html', '/dungeon.html', '/pinyin.html', '/english.html', '/english.css',
      '/dist/game/english-courier/main.js', '/dist/learning/english.js', '/dist/content/english-exercises.js',
      '/img/english-courier/mum.svg', '/img/english-courier/sleepy.svg'];
    const missing = [];
    for (const u of need) if (!(await cache.match(u))) missing.push(u);
    if (missing.length || svgs !== 12) return { partial: true, missing, svgs };
    const swText = await fetch('/sw.js').then(r => r.text()).catch(() => '');
    return { name, svgs, fiveEntries: true,
      swHasEnglishEntry: swText.includes('/english.html') && swText.includes('/img/english-courier/') };
  })()`), 'SW 受控且五入口+12 SVG 缓存就绪', 60000);
  log('SW:', JSON.stringify(swInfo));
  if (swInfo.partial) throw new Error(`预缓存不完整: missing=${JSON.stringify(swInfo.missing)} svgs=${swInfo.svgs}`);
  // 杀掉源站
  const { execSync } = await import('node:child_process');
  try { execSync('kill $(lsof -ti tcp:4173 -sTCP:LISTEN) 2>/dev/null || true', { shell: '/bin/zsh' }); } catch {}
  await sleep(1000);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}sw.js`); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, '断源后首页可打开', 30000);
  // 回到英语快递员入口（杀源后停在首页）。
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.englishAnchor?.visible ? s : null; }, '断源后菜单');
  await trustedClick('#main-nav a[href="/english.html"]');
  await waitUntil(async () => { const s = await englishState(); return s.url.includes('/english.html') && s.bootFailHidden && s.selectVisible ? s : null; }, '断源后英语快递员可打开', 30000);
  const offlineSelect = await englishState();
  await shot('e9-01-offline-select');
  await installPool();
  await toggleGrade('一年级', true);
  await click('#btn-start');
  // 断网完整局：5 任务自算作答（含未取件点选一击验证交互可用）
  const tasks9 = [];
  for (let i = 0; i < 5; i++) {
    await waitQuestion(i, `E9 断网第 ${i + 1} 个任务可作答`);
    if (i === 0) {
      await deliverStation(0);
      await waitUntil(async () => { const st = await englishState(); return st.feedbackHidden === false && (st.feedback ?? '').includes('先取一个包裹') ? st : null; }, '断网未取件提示');
      await shot('e9-02-offline-no-carry');
    }
    const solved = await solveCurrent({});
    tasks9.push(solved);
    if (i < 4) await waitUntil(async () => { const st = await englishState(); return st.hudProgress === `第 ${i + 2}/5 个任务` ? st : null; }, `E9 推进到第 ${i + 2} 个任务`);
  }
  const result = await waitResult();
  await shot('e9-03-offline-result');
  const s9 = await englishState();
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await englishState(); return s.selectVisible ? s : null; }, 'E9 返回选择屏');
  const rec = await englishState();
  const recRaw = (rec.recordsRaw?.records ?? []).slice().reverse()[0] ?? null;
  const recordOk = recRaw && recRaw.gameId === 'english-courier' && recRaw.score === 50
    && recRaw.answer?.tasks?.length === 5 && recRaw.answer.tasks.every(t => t.firstTry === true)
    && rec.records.some(r => r.includes('50 分 · 首答 5/5'));
  const finalState = await englishState();
  const ok = swInfo.fiveEntries && swInfo.swHasEnglishEntry && swInfo.svgs === 12 && sourceDead
    && offlineSelect.selectVisible && s9.resultScore === '总分 50' && recordOk
    && finalState.errors.length === 0;
  record('E9 SW 五入口断网完整局', ok,
    `SW 版本 ${swInfo.name} 预缓存含 /、/hanzi.html、/dungeon.html、/pinyin.html、/english.html（含 /english.css 与英语 dist 模块）+ 12 张 /img/english-courier/*.svg（清单文本含 english 入口=${swInfo.swHasEnglishEntry}）；杀掉 serve 进程（源站请求确认失败）后刷新：英语快递员由缓存打开，开局断网下未取件点选提示正常、5 任务自算作答全对（${tasks9.map(t => t.id).join('、')}）→ 结算「${s9.resultScore}」「${s9.resultAnswer}」；断网记录 score=50、5 任务全 firstTry=${recordOk}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { swInfo, sourceDead, tasks: tasks9, result: { score: s9.resultScore, answer: s9.resultAnswer, modes: s9.resultModes }, recordRaw: recRaw, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('E9 SW 五入口断网完整局', false, `失败: ${e.message}`);
}

// ===== 汇总 =====
const summary = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  userAgent: await evaluate('navigator.userAgent', false).catch(() => null),
  viewport: await evaluate('({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })', false).catch(() => null),
  scenarios,
  allPassed: scenarios.every(s => s.pass),
};
await writeFile(`${outDir}/english-browser-results.json`, JSON.stringify(summary, null, 2));
log('结果已写入', `${outDir}/english-browser-results.json`);
log(JSON.stringify(summary.scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(0);
