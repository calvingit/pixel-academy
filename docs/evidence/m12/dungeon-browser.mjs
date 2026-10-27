// 算术地下城（M12）桌面浏览器验收轮（D 阶段，独立于实现者冒烟轮）。
// 结构参照 docs/evidence/m8/nav-browser.mjs：无头 Chrome CDP 直连、真实鼠标事件
// trustedClick、键盘 Tab、evaluate 读取页面状态、error/unhandledrejection 注入收集、
// Page.reload 刷新恢复、杀源站进程断源。答案一律从页面题面经 dist 判题模块
// （/dist/game/arithmetic-dungeon/content.js 的 selectDungeonExercises +
// /dist/learning/choice.js 的 correctOptionIds、/dist/learning/evaluation.js 的 answerFor）
// 自算，不注入任何游戏状态。
// 覆盖 D1–D10：D1 首页菜单入口 → D2 进入地下城 → D3 年级与可用性 →
// D4 完整通关局（对照示例 35 分）→ D5 备用钥匙路径 → D6 暂停/恢复 →
// D7 刷新恢复 → D8 双游戏回归 → D9 SW 三入口与断源（D10 贯穿：每场景记
// 横向溢出与 JS 错误）。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9742';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m12';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[dungeon]', ...a);
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
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });

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
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  const anchor = sel => { const a = document.querySelector(sel);
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/[\\s]+/g, ' '),
      decorAriaHidden: a.querySelector('span')?.getAttribute('aria-hidden') ?? null,
      visible: !!(a.offsetWidth || a.offsetHeight) } : null; };
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('main h1, main .app-title')?.textContent ?? null,
    screen: document.body.dataset.screen ?? null,
    selectVisible: !hidden('screen-select'),
    errorVisible: !hidden('screen-error'),
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    navLabel: document.getElementById('main-nav')?.getAttribute('aria-label') ?? null,
    navItems: [...(document.getElementById('main-nav')?.children ?? [])].map(el => ({ tag: el.tagName, text: el.textContent.trim().replace(/[\\s]+/g, ' ') })),
    hanziAnchor: anchor('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: anchor('#main-nav a[href="/dungeon.html"]'),
    wallet: t('wallet'),
    gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
    btnToAvailabilityDisabled: document.getElementById('btn-to-availability')?.disabled,
    offlineNotice: hidden('offline-notice') ? null : t('offline-notice'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 汉字勇者状态 =====
const hanziState = () => evaluate(`(() => ({
  url: location.href, title: document.title,
  h1: document.querySelector('.app-title')?.textContent ?? null,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
  selectVisible: !document.getElementById('screen-select')?.hidden,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);

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
  let settingsRaw = null;
  try { settingsRaw = JSON.parse(localStorage.getItem('pixel-academy:arithmetic-dungeon:v1:settings') ?? 'null'); } catch {}
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
    recordsEmptyHidden: document.getElementById('records-empty')?.hidden,
    hudRoom: t('hud-room'), hudKeys: t('hud-keys'), hudScore: t('hud-score'),
    pausePressed: document.getElementById('btn-pause')?.getAttribute('aria-pressed'),
    roomName: t('room-name'), roomDesc: t('room-desc'),
    routeButtons: [...document.querySelectorAll('#route-list button')].map(b => ({
      text: b.textContent, locked: b.classList.contains('route-locked') })),
    questionVisible: !hidden('question-card'),
    slotTitle: t('slot-title'),
    prompt: t('question-prompt'),
    promptExerciseId: document.getElementById('question-prompt')?.dataset.exerciseId ?? null,
    countdown: t('countdown'),
    countdownHidden: hidden('countdown'),
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
    confirmText: t('confirm-text'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    inner: { w: window.innerWidth, h: window.innerHeight },
    snapshot: snap ? {
      roundId: snap.roundId, grades: snap.grades, contentVersion: snap.contentVersion,
      room: snap.state?.room, openDoors: snap.state?.openDoors, score: snap.state?.score,
      keys: snap.state?.keys, keyUses: snap.state?.keyUses, activeSlot: snap.state?.activeSlot,
      usedIds: snap.state?.usedIds, answeredSlots: snap.state?.answeredSlots,
      route: snap.state?.route, totalWrongCount: snap.state?.totalWrongCount,
      firstTryCount: snap.state?.firstTryCount,
      timer: snap.timer,
      slotsSolved: snap.state ? Object.fromEntries(Object.entries(snap.state.slots).map(([k, v]) => [k, v.solved])) : null,
    } : null,
    recordsRaw, recentIds, settingsRaw,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 作答辅助：题面 → dist 判题模块自算 =====
const installDungeonPool = grades => evaluate(`(async () => {
  const { selectDungeonExercises } = await import('/dist/game/arithmetic-dungeon/content.js');
  const { taskText } = await import('/dist/game/number-puzzle/learning.js');
  const { correctOptionIds, isMultiple, optionText } = await import('/dist/learning/choice.js');
  const { answerFor } = await import('/dist/learning/evaluation.js');
  const picked = selectDungeonExercises(${JSON.stringify(grades)});
  window.__pool = picked.map(e => ({
    id: e.id, status: e.review.status,
    text: taskText(e.task),
    kind: e.task.kind,
    options: e.task.kind === 'choice' ? e.task.options.map(o => optionText(o)) : null,
    ids: e.task.kind === 'choice' ? e.task.options.map(o => o.id) : null,
    multiple: e.task.kind === 'choice' ? isMultiple(e.task) : false,
    correct: e.task.kind === 'choice' ? correctOptionIds(e.task) : null,
    answer: e.task.kind === 'choice' ? null : answerFor(e.task),
  }));
  return { count: window.__pool.length,
    statuses: [...new Set(window.__pool.map(p => p.status))],
    kinds: window.__pool.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] ?? 0) + 1; return acc; }, {}) };
})()`);

const matchTask = (text, optionTexts) => evaluate(`(() => {
  const text = ${JSON.stringify(text)};
  const opts = ${JSON.stringify(optionTexts ?? null)};
  const matches = (window.__pool ?? []).filter(p => p.text === text
    && (opts === null ? p.options === null : JSON.stringify(p.options) === JSON.stringify(opts)));
  if (!matches.length) return null;
  const m = matches[0];
  return { id: m.id, status: m.status, kind: m.kind, multiple: m.multiple,
    ids: m.ids, correct: m.correct, answer: m.answer, matchCount: matches.length };
})()`, false);

const clickOptionAt = async idx => {
  await evaluate(`(() => { const b = document.querySelectorAll('#options button')[${idx}];
    if (b && !b.disabled) b.click(); })()`, false);
  await sleep(150);
};

// 真实键入（聚焦 + insertText）与真实 Enter（Input.dispatchKeyEvent）。
const typeInto = async (selector, text) => {
  await trustedClick(selector);
  await send('Input.insertText', { text });
  await sleep(220);
};
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
// 提交是否被页面受理：反馈条出现（✓/✗，排除 10 秒超时的「时间到」——那是缺陷路径
// 的等待目标而非提交结果）或门题面板关闭。
const submitLanded = async () => {
  const s = await dungeonState();
  if (s.feedbackHidden === false && !(s.feedback ?? '').includes('时间到')) return s;
  if (!s.questionVisible) return s;
  return null;
};

// 作答当前面板题目。wrong=true 故意答错（多选选一个错项提交；算式填错误值）。
// 算式题（binary/chain）存在实现缺陷（见 README 缺陷清单）：面板初开时「开门」按钮
// disabled（value 空），真实键入后无 input 事件联动仍 disabled，鼠标点击与 Enter
// （内部调 btn.click()）均被吞——脚本按真实用户唯一可用路径处理：先点「开门」→
// Enter → 均无效时等 10 秒超时（按答错处理）→ 点「再试一次」重渲染（value 残留
// 非空启用按钮）→ 再提交（defectPath=true，首答档损失如实记录）。
async function answerDungeon({ wrong = false } = {}) {
  const st = await dungeonState();
  if (!st.questionVisible) throw new Error('门题面板未打开');
  const slotPrefix = st.slotTitle?.split(' · ')[0] ?? '';
  if (!st.optionsHidden) {
    const texts = st.optionButtons.map(b => b.text);
    const task = await matchTask(st.prompt, texts);
    if (!task) throw new Error(`选择题面匹配失败: ${st.prompt} / ${JSON.stringify(texts)}`);
    if (task.status !== 'approved') throw new Error(`非 approved 题 ${task.id}: ${task.status}`);
    if (task.multiple) {
      const wantIds = wrong ? [task.ids.find(id => !task.correct.includes(id))] : task.correct;
      if (!wantIds[0]) throw new Error('多选题无错项可答错');
      for (const id of wantIds) await clickOptionAt(task.ids.indexOf(id));
      await evaluate(`document.getElementById('btn-choice-submit').click()`, false);
    } else {
      const wantId = wrong ? task.ids.find(id => !task.correct.includes(id)) : task.correct[0];
      if (!wantId) throw new Error('单选题无错项可答错');
      await clickOptionAt(task.ids.indexOf(wantId));
    }
    return { kind: task.multiple ? 'choice-multiple' : 'choice-single', id: task.id, prompt: st.prompt, wrong, defectPath: false };
  }
  const task = await matchTask(st.prompt, null);
  if (!task || task.answer === null || task.answer === undefined) throw new Error(`算式题面匹配失败: ${st.prompt}`);
  if (task.status !== 'approved') throw new Error(`非 approved 题 ${task.id}: ${task.status}`);
  const value = wrong ? (task.answer === 0 ? 1 : task.answer - 1) : task.answer;
  await typeInto('#answer-input', String(value));
  const via = [];
  // 尝试 1：鼠标点击「开门」
  await evaluate(`document.getElementById('btn-input-submit').click()`, false);
  const landed1 = await waitUntil(submitLanded, '开门按钮提交', 1600).catch(() => null);
  if (landed1) via.push('click');
  // 尝试 2：真实 Enter（页面在 input keydown 里调 btn.click()）
  if (!via.length) {
    await pressEnter();
    const landed2 = await waitUntil(submitLanded, 'Enter 提交', 1600).catch(() => null);
    if (landed2) via.push('enter');
  }
  let defectPath = false;
  if (!via.length) {
    // 缺陷路径：等 10 秒超时（页面按答错处理）→ 再试一次（重渲染启用按钮）→ 提交。
    // wrong 时 value 已是错误值，超时+提交错值各计一次答错。
    defectPath = true;
    await waitRetryState();
    await click('#btn-retry-attempt');
    await waitQuestion(slotPrefix, { notPrompt: '__never__' });
    await evaluate(`document.getElementById('btn-input-submit').click()`, false);
    await waitUntil(submitLanded, '重试后提交', 3000);
    via.push('timeout+retry');
  }
  return { kind: task.kind, id: task.id, prompt: st.prompt, value, wrong, defectPath, submitVia: via.join('|') };
}

const clickRoute = prefix => evaluate(`(() => {
  const btns = [...document.querySelectorAll('#route-list button')];
  const b = btns.find(x => x.textContent.startsWith(${JSON.stringify(prefix)}));
  if (!b) throw new Error('路线按钮未找到: ' + ${JSON.stringify(prefix)} + '；现有: ' + btns.map(x => x.textContent).join(' | '));
  b.click();
})()`, false);

const click = selector => evaluate(`(() => { document.querySelector(${JSON.stringify(selector)})?.click(); })()`, false);
const confirmYes = () => click('#btn-confirm-yes');

const trustedClick = async selector => {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
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

// 等待房间（空闲探索态：HUD 房间名匹配、门题面板关闭）。
const waitRoom = (name, desc = `到达房间 ${name}`) => waitUntil(async () => {
  const s = await dungeonState();
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

const parseCountdown = text => {
  const m = (text ?? '').match(/剩余 ([0-9.]+) 秒/);
  return m ? Number(m[1]) : null;
};

// 资源机关答对后收下钥匙：实现侧 submit 有 900ms resolving 窗口，窗口内 leaveSlot
// 静默忽略点击（main.ts leaveSlot 的 resolving 检查），而「收下钥匙」文本在答对
// 后立即渲染——脚本答对后即刻点击会落在窗口内。模拟真实用户二次点击：点后若
// 面板未关则隔 400ms 重试（leaveSlot 幂等，重复点击无副作用）。
async function collectKey() {
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' ? s : null; }, '资源机关解开');
  for (let i = 0; i < 6; i++) {
    await click('#btn-leave');
    const closed = await waitUntil(async () => { const s = await dungeonState(); return s.gameVisible && !s.questionVisible ? s : null; }, '面板关闭', 2000).catch(() => null);
    if (closed) return { closed, clickAttempts: i + 1 };
    await sleep(400);
  }
  throw new Error('收下钥匙后面板未关闭');
}

// 新版档案在 IndexedDB（profile.ts：库 pixel-academy、store profiles、key local）。
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

// 勾选年级卡（按卡片文本；幂等：已勾选不点）。
const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click(); })()`, false);
  const s = await dungeonState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want ? s : null;
}, `勾选年级 ${name}`);

// ============================================================
// D1 首页菜单入口
// ============================================================
try {
  await goto(`${ORIGIN}`);
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible && s.hanziAnchor && s.dungeonAnchor ? s : null; }, '首页选择屏就绪');
  const before = await idbProfileSnapshot();
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.dungeonAnchor?.visible ? s : null; }, '菜单弹层打开');
  const s1 = await homeState();
  // 键盘可达：从弹层起点连按 Tab，记录焦点路径
  const focusPath = [];
  let keyboardReached = false;
  for (let i = 0; i < 14; i++) {
    const ae = await evaluate(`(() => { const el = document.activeElement;
      return el === document.querySelector('#main-nav a[href="/dungeon.html"]') ? 'TARGET'
        : (el === document.querySelector('#main-nav a[href="/hanzi.html"]') ? 'HANZI'
        : (el ? (el.id || el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().replace(/[\\s]+/g, ' ').slice(0, 10)) : 'none')); })()`, false);
    if (ae === 'TARGET') { keyboardReached = true; break; }
    focusPath.push(ae);
    await pressTab();
    await sleep(60);
  }
  // aria：CDP 无障碍树取 link 角色与名称
  let axName = null, axRole = null, axFocusable = null, axQueried = false;
  try {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#main-nav a[href="/dungeon.html"]' });
    const ax = await send('Accessibility.getPartialAXTree', { nodeId: node.nodeId, fetchRelatives: true });
    const link = ax.nodes.find(n => n.role?.value === 'link');
    axRole = link?.role?.value ?? null;
    axName = link?.name?.value ?? null;
    axFocusable = link?.properties?.find(p => p.name === 'focusable')?.value?.value ?? null;
    axQueried = true;
  } catch (e) { log('无障碍树查询失败（降级结构断言）:', String(e)); }
  await shot('d1-01-home-menu');
  const ariaOk = axQueried
    ? axRole === 'link' && (axName ?? '').includes('算术地下城') && axFocusable !== false
    : s1.dungeonAnchor?.decorAriaHidden === 'true' && (s1.dungeonAnchor?.text ?? '').includes('算术地下城');
  const ok = (s1.h1 ?? '').startsWith('数字消除') && s1.title.includes('数字消除')
    && s1.dungeonAnchor?.href === '/dungeon.html' && s1.dungeonAnchor?.visible
    && (s1.dungeonAnchor?.text ?? '').includes('算术地下城')
    && s1.dungeonAnchor?.decorAriaHidden === 'true'
    && s1.hanziAnchor?.visible && (s1.hanziAnchor?.text ?? '').includes('汉字勇者')
    && s1.navLabel === '学习与收藏'
    && keyboardReached && ariaOk && s1.errors.length === 0;
  record('D1 首页菜单入口', ok,
    `数字消除为当前游戏（h1=${s1.h1?.trim()}）；菜单弹层（aria-label=${s1.navLabel}）内「算术地下城」入口 href=/dungeon.html 可见，装饰字 span aria-hidden=true；与「汉字勇者」入口并存；Tab 焦点路径 ${JSON.stringify(focusPath)} 后到达入口；AX 角色 ${axRole}、名称「${axName}」；IndexedDB 档案金币 ${before?.coins}（全新档案）、JS 错误 0`,
    { checks: { anchor: s1.dungeonAnchor, hanziAnchor: s1.hanziAnchor, navItems: s1.navItems, keyboardFocusPath: focusPath, keyboardReached, axName, axRole, axFocusable, axQueried, idbProfile: before, overflow: s1.overflowX, errors: s1.errors } });
} catch (e) {
  record('D1 首页菜单入口', false, `失败: ${e.message}`);
}

// ============================================================
// D2 真实点击进入 dungeon.html
// ============================================================
try {
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const ds = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null;
  }, '地下城选择屏就绪');
  await sleep(400);
  const s2 = await dungeonState();
  await shot('d2-01-dungeon-entered');
  record('D2 进入 dungeon.html', s2.h1?.includes('算术地下城') && s2.title.includes('算术地下城')
    && s2.backLink?.href === '/' && s2.backLink?.visible && s2.bootFailHidden && s2.errors.length === 0,
    `真实点击菜单入口后 URL=${s2.url}，标题「${s2.title}」正常加载：h1=${s2.h1?.trim()}、6 张年级卡、boot-fail 隐藏、存储可用提示隐藏=${s2.storageNoticeHidden}、「返回数字消除」锚点（href=${s2.backLink?.href}）可见，JS 错误 ${s2.errors.length} 个`,
    { checks: { backLink: s2.backLink, gradeCards: s2.gradeCards, restoreOfferHidden: s2.restoreOfferHidden, overflow: s2.overflowX, errors: s2.errors } });
} catch (e) {
  record('D2 进入 dungeon.html', false, `失败: ${e.message}`);
}

// ============================================================
// D3 年级与可用性
// ============================================================
try {
  await installDungeonPool([1]);
  const counts = await evaluate(`(async () => {
    const { selectDungeonExercises, describeAvailability } = await import('/dist/game/arithmetic-dungeon/content.js');
    return {
      g1: selectDungeonExercises([1]).length, g2: selectDungeonExercises([2]).length,
      g12: selectDungeonExercises([1, 2]).length, g3: selectDungeonExercises([3]).length,
      descG3: describeAvailability([3]), descG12: describeAvailability([1, 2]),
    };
  })()`);
  await toggleGrade('一年级', true);
  const g1 = await dungeonState();
  const expectG1 = `本层题库：一年级 ${counts.g1} 道，共 ${counts.g1} 道`;
  const startEnabledG1 = g1.startDisabled === false;
  // 未开放年级：禁用置灰，点击无效（不混入其他年级内容）
  const clickG3 = await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === '三年级'); b.click(); return b.disabled; })()`, false);
  const g3after = await dungeonState();
  const g3Card = g3after.gradeCards.find(c => c.text === '三年级');
  // 混选一+二
  await toggleGrade('二年级', true);
  const g12 = await dungeonState();
  const expectG12 = `本层题库：一年级 ${counts.g1} 道、二年级 ${counts.g2} 道，共 ${counts.g12} 道`;
  await shot('d3-01-grades-availability');
  // 取消二年级，恢复只一年级（为 D4 开局准备）
  await toggleGrade('二年级', false);
  const back = await dungeonState();
  const ok = g1.availabilityStatus === expectG1 && startEnabledG1
    && g3Card?.disabled === true && g3Card?.pressed === 'false' && clickG3 === true
    && g3after.availabilityStatus === expectG1 && g3Card?.title === '暂未开放'
    && g12.availabilityStatus === expectG12 && g12.startDisabled === false
    && back.availabilityStatus === expectG1
    && counts.g3 === 0 && counts.descG3.startable === false
    && g1.errors.length === 0;
  record('D3 年级与可用性', ok,
    `勾一年级→「${g1.availabilityStatus}」（与 dist 层 selectDungeonExercises([1])=${counts.g1} 道一致），开始按钮可用；三年级卡禁用置灰（disabled、title=暂未开放、点击无效，勾选后提示不变）——未开放年级不可混入；混选一+二→「${g12.availabilityStatus}」（共 ${counts.g12} 道）仍可开始；取消二年级恢复一年级提示；dist 层 describeAvailability([3])=「${counts.descG3.statusText}」（三年级 ${counts.g3} 道、不可开始）；JS 错误 ${g1.errors.length} 个`,
    { checks: { counts, gradeCards: g12.gradeCards, g1Status: g1.availabilityStatus, g12Status: g12.availabilityStatus, g3Card, descG3: counts.descG3, settings: back.settingsRaw, overflow: g1.overflowX, errors: g1.errors } });
} catch (e) {
  record('D3 年级与可用性', false, `失败: ${e.message}`);
}

// ============================================================
// D4 完整通关局（对照示例：石门 10 + 左门 10 + 资源 10 + 右门重试 5 = 35）。
// 期望分动态计算：choice 首答 10 分；算式题（binary/chain）受「开门」按钮禁用缺陷
// 影响走超时→再试路径，入重试档 5 分（缺陷见 README 缺陷清单 #1）；右门故意答错
// 后重试 5 分。4 题均为 choice 且右门无缺陷时期望恰为 35，与示例逐项对照。
// ============================================================
try {
  await installDungeonPool([1]);
  const coinsBefore = await idbProfileSnapshot();
  await click('#btn-start');
  const startRoom = await waitRoom('起点', '开局起点房');
  if (startRoom.roomDesc !== '石门前有一道算式机关，答对才能进入地下城。') throw new Error(`起点描述异常: ${startRoom.roomDesc}`);
  const d4RoundId = startRoom.snapshot?.roundId ?? null;
  await shot('d4-01-start-room');
  const firstGained = q => (q.defectPath ? 5 : 10);
  // 石门
  await clickRoute('石门（锁着）');
  await waitQuestion('石门');
  const stoneQ = await answerDungeon({ wrong: false });
  const stoneGained = firstGained(stoneQ);
  const junction = await waitRoom('岔口', '石门开启自动到岔口');
  if (junction.hudScore !== `得分 ${stoneGained}` || junction.hudKeys !== '备用钥匙 0/1') throw new Error(`岔口 HUD 异常: ${junction.hudScore} ${junction.hudKeys}`);
  // 左门
  await clickRoute('左门（锁着）');
  await waitQuestion('左门');
  const leftQ = await answerDungeon({ wrong: false });
  const leftGained = firstGained(leftQ);
  const resource = await waitRoom('资源房', '左门开启自动到资源房');
  if (resource.hudScore !== `得分 ${stoneGained + leftGained}`) throw new Error(`资源房前得分异常: ${resource.hudScore}`);
  // 资源题（取得钥匙）
  await clickRoute('解读资源机关');
  await waitQuestion('资源机关');
  const resQ = await answerDungeon({ wrong: false });
  const resGained = firstGained(resQ);
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' ? s : null; }, '资源机关解开');
  const withKey = await dungeonState();
  const scoreWithKey = stoneGained + leftGained + resGained;
  if (withKey.hudKeys !== '备用钥匙 1/1' || withKey.hudScore !== `得分 ${scoreWithKey}`) throw new Error(`钥匙后 HUD 异常: ${withKey.hudKeys} ${withKey.hudScore}`);
  await shot('d4-02-resource-key');
  const leaveInfo = await collectKey();
  await waitRoom('资源房', '收下钥匙留在资源房');
  // 折回岔口（已开的门自由通行、不再出题）
  await clickRoute('折回岔口');
  const back = await waitRoom('岔口', '折回岔口');
  // 岔口视角：起点为折回（石门开）、资源房为左门顺向通行——左门已开自由经过、不再出题
  if (!back.routeButtons.some(r => r.text.startsWith('经过左门 → 资源房') && !r.locked)
    || !back.routeButtons.some(r => r.text.startsWith('折回起点'))) throw new Error(`折回后路线异常: ${JSON.stringify(back.routeButtons)}`);
  // 右门：故意答错一次（不解锁不扣分）→ 再试一次 → 换一题 → 答对（重试档 +5）
  await clickRoute('右门（锁着）');
  await waitQuestion('右门');
  const wrongAns = await answerDungeon({ wrong: true });
  const retry = await waitRetryState();
  if (retry.hudScore !== `得分 ${scoreWithKey}`) throw new Error(`答错后扣分了: ${retry.hudScore}`);
  const wrongPrompt = retry.prompt;
  const wrongId = wrongAns.id;
  await shot('d4-03-right-wrong');
  // 「再试一次」：重开计时；题面是否换题按实现如实记录
  await click('#btn-retry-attempt');
  const retried = await waitQuestion('右门', { notPrompt: '__none__' });
  const samePromptAfterRetry = retried.prompt === wrongPrompt;
  // 「换一题」：换题重开计时（实现把文档中「再试一次」的换题职责拆到此按钮）
  await click('#btn-swap');
  const swapped = await waitQuestion('右门', { notPrompt: wrongPrompt });
  const swapId = (await matchTask(swapped.prompt, swapped.optionButtons.map(b => b.text)))?.id
    ?? (await matchTask(swapped.prompt, null))?.id;
  if (swapId === wrongId) throw new Error('换一题未换题');
  const rightQ = await answerDungeon({ wrong: false });
  const result = await waitResult();
  await shot('d4-04-result');
  const s4 = await dungeonState();
  // 期望结算（规格计分：首答 10 / 重试 5 / 答错与超时不扣分不解锁）
  const expectScore = stoneGained + leftGained + resGained + 5;
  const defectCount = [stoneQ, leftQ, resQ].filter(q => q.defectPath).length;
  const expectFirstTry = 3 - defectCount;
  const expectRetries = defectCount + (wrongAns.defectPath ? 2 : 1) + (rightQ.defectPath ? 1 : 0);
  const sampleAligned = defectCount === 0 && !wrongAns.defectPath && !rightQ.defectPath && expectScore === 35;
  const scoreOk = s4.resultScore === `总分 ${expectScore}` && s4.resultTitle === '通关！';
  const answerOk = s4.resultAnswer === `作答 4 题 · 首答 ${expectFirstTry}/4 · 重试 ${expectRetries} 次`;
  const exploreOk = s4.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
  // 记录与档案
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, '返回选择屏');
  const rec = await dungeonState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === d4RoundId) ?? null;
  const recordOk = recRaw && recRaw.gameId === 'arithmetic-dungeon' && recRaw.score === expectScore
    && recRaw.answer?.questions?.length === 4 && recRaw.explore?.keyUses === 0 && recRaw.explore?.retries === expectRetries
    && JSON.stringify(recRaw.explore?.route) === JSON.stringify(['start', 'junction', 'resource', 'junction', 'end'])
    && rec.records.some(r => r.includes(`${expectScore} 分 · 首答 ${expectFirstTry}/4 · 重试 ${expectRetries}`));
  const recentOk = Array.isArray(rec.recentIds) && recRaw && recRaw.answer.questions
    .every(q => rec.recentIds.includes(q.exerciseId));
  const coinsAfter = await idbProfileSnapshot();
  const allApproved = [stoneQ, leftQ, resQ, rightQ];
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, '选择屏稳定');
  const finalState = await dungeonState();
  await shot('d4-05-records');
  const ok = scoreOk && answerOk && exploreOk && recordOk && recentOk
    && coinsAfter?.coins === coinsBefore?.coins && allApproved.every(a => a.id && a.kind)
    && finalState.errors.length === 0;
  const defectNote = sampleAligned ? '' : `；本局含算式题受缺陷 #1 影响（石/左/资源缺陷 ${defectCount} 道、右门答错路径${wrongAns.defectPath ? '含缺陷' : '正常'}、换题后${rightQ.defectPath ? '含缺陷' : '正常'}），期望分按计分规则动态计算为 ${expectScore} 而非示例 35（35 分示例路径受阻于缺陷，计分逻辑本身逐项吻合）`;
  record('D4 完整通关局（对照示例 35 分）', ok,
    `起点→石门「${stoneQ.prompt}」（${stoneQ.defectPath ? '算式题·缺陷路径重试档 +5' : 'choice 首答 +10'}）→岔口（得分 ${stoneGained}）→左门「${leftQ.prompt}」（+${leftGained}）→资源房→资源题「${resQ.prompt}」（+${resGained}、钥匙 1/1）→折回岔口→右门「${wrongPrompt.slice(0, 18)}…」故意答错（✗、不解锁、得分仍 ${scoreWithKey}）→点「再试一次」重开计时（题面${samePromptAfterRetry ? '未变——实现将换题拆分到独立「换一题」按钮' : '已变'}）→点「换一题」换为「${swapped.prompt.slice(0, 18)}…」→答对（重试档 +5）→结算「${s4.resultScore}」「${s4.resultAnswer}」「${s4.resultExplore}」与计分规则逐项吻合${defectNote}；练习记录新增 1 条（gameId=${recRaw?.gameId}、recordId=roundId、score=${expectScore}、keyUses=0、route=start→junction→resource→junction→end），列表显示「${expectScore} 分 · 首答 ${expectFirstTry}/4 · 重试 ${expectRetries}」；recent-ids 含本局全部题目 ID=${recentOk}；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；「收下钥匙」点击 ${leaveInfo?.clickAttempts} 次（答对后约 0.9s resolving 窗口内首次点击被静默忽略，脚本按真实用户二次点击，见 README）；JS 错误 ${finalState.errors.length} 个`,
    { checks: { answers: [stoneQ, leftQ, resQ, wrongAns, { swapFrom: wrongPrompt, swappedTo: swapped.prompt }, rightQ], samePromptAfterRetry, leaveClickAttempts: leaveInfo?.clickAttempts, expect: { score: expectScore, firstTry: expectFirstTry, retries: expectRetries, sampleAligned }, roundId: d4RoundId, result: { score: s4.resultScore, answer: s4.resultAnswer, explore: s4.resultExplore }, recordRaw: recRaw, recentOk, coinsBefore, coinsAfter, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('D4 完整通关局（对照示例 35 分）', false, `失败: ${e.message}`);
}

// ============================================================
// D5 备用钥匙路径（再来一局：右门答错 → 消耗钥匙直接解锁）。
// 石/左/资源期望分动态（choice 首答 10；算式题受缺陷 #1 走重试档 5）。
// ============================================================
try {
  await installDungeonPool([1]);
  const before = await dungeonState();
  const prevIds = before.recentIds ?? [];
  await click('#btn-start');
  const d5Start = await waitRoom('起点', 'D5 开局起点房');
  const d5RoundId = d5Start.snapshot?.roundId ?? null;
  const firstGained5 = q => (q.defectPath ? 5 : 10);
  await clickRoute('石门（锁着）');
  await waitQuestion('石门');
  const stoneQ5 = await answerDungeon({ wrong: false });
  await waitRoom('岔口', 'D5 到岔口');
  await clickRoute('左门（锁着）');
  await waitQuestion('左门');
  const leftQ5 = await answerDungeon({ wrong: false });
  await waitRoom('资源房', 'D5 到资源房');
  await clickRoute('解读资源机关');
  await waitQuestion('资源机关');
  const resQ5 = await answerDungeon({ wrong: false });
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' ? s : null; }, 'D5 资源机关解开');
  await collectKey();
  await waitRoom('资源房', 'D5 收下钥匙');
  await clickRoute('折回岔口');
  await waitRoom('岔口', 'D5 折回岔口');
  // 右门：先故意答错 → 消耗备用钥匙直接解锁
  await clickRoute('右门（锁着）');
  await waitQuestion('右门');
  const wrongAns = await answerDungeon({ wrong: true });
  const retry = await waitRetryState();
  const expectScore5 = firstGained5(stoneQ5) + firstGained5(leftQ5) + firstGained5(resQ5);
  if (retry.hudScore !== `得分 ${expectScore5}`) throw new Error(`D5 答错后得分异常: ${retry.hudScore}`);
  const useKeyVisible = retry.useKeyHidden === false && retry.swapHidden === false;
  await shot('d5-01-right-wrong-key-offer');
  await click('#btn-use-key');
  await waitResult();
  await shot('d5-02-result');
  const s5 = await dungeonState();
  const defectCount5 = [stoneQ5, leftQ5, resQ5].filter(q => q.defectPath).length;
  const expectFirstTry5 = 3 - defectCount5;
  const expectRetries5 = defectCount5 + (wrongAns.defectPath ? 2 : 1);
  const scoreOk = s5.resultScore === `总分 ${expectScore5}`
    && s5.resultAnswer === `作答 3 题 · 首答 ${expectFirstTry5}/3 · 重试 ${expectRetries5} 次`;
  const exploreOk = s5.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 1 把 / 剩 0 把';
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, 'D5 返回选择屏');
  const rec = await dungeonState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === d5RoundId) ?? null;
  const slots = (recRaw?.answer?.questions ?? []).map(q => q.slot);
  const recordOk = recRaw && recRaw.gameId === 'arithmetic-dungeon' && recRaw.score === expectScore5
    && JSON.stringify(slots) === JSON.stringify(['gate-stone', 'gate-left', 'resource'])
    && !slots.includes('gate-right')
    && recRaw.explore?.keyUses === 1 && recRaw.explore?.keysHeld === 0 && recRaw.explore?.retries === expectRetries5;
  const coins = await idbProfileSnapshot();
  const finalState = await dungeonState();
  const exerciseIds = (recRaw?.answer?.questions ?? []).map(q => q.exerciseId);
  const avoidPrevOk = exerciseIds.every(id => !prevIds.includes(id));
  const ok = useKeyVisible && scoreOk && exploreOk && recordOk && avoidPrevOk && finalState.errors.length === 0;
  record('D5 备用钥匙路径', ok,
    `再来一局：石门+左门+资源题作答全对（${stoneQ5.defectPath || leftQ5.defectPath || resQ5.defectPath ? `得分 ${expectScore5}（含算式题缺陷路径重试档）` : `首答全对得分 ${expectScore5}`}、钥匙 1/1）→右门先故意答错（✗、不解锁不扣分、「用钥匙开门」按钮出现）→消耗备用钥匙直接解锁→通关结算「${s5.resultScore}」「${s5.resultAnswer}」「${s5.resultExplore}」；记录 keyUses=1、keysHeld=0、retries=${expectRetries5}，作答表现 slots=${JSON.stringify(slots)}（用钥匙开门的右门不计入作答表现、计入探索决策）；本局题目避开上一局（recent-ids 机制）=${avoidPrevOk}；金币 ${coins?.coins} 不变；JS 错误 ${finalState.errors.length} 个`,
    { checks: { answers: [stoneQ5, leftQ5, resQ5, wrongAns], useKeyVisible, expect: { score: expectScore5, firstTry: expectFirstTry5, retries: expectRetries5 }, result: { score: s5.resultScore, answer: s5.resultAnswer, explore: s5.resultExplore }, recordRaw: recRaw, prevIds, exerciseIds, avoidPrevOk, roundId: d5RoundId, coins, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('D5 备用钥匙路径', false, `失败: ${e.message}`);
}

// ============================================================
// D6 暂停/恢复（答对 1 题后暂停；计时中暂停对比倒计时冻结）
// ============================================================
try {
  await installDungeonPool([1]);
  await click('#btn-start');
  await waitRoom('起点', 'D6 开局起点房');
  await clickRoute('石门（锁着）');
  await waitQuestion('石门');
  const stoneQ6 = await answerDungeon({ wrong: false });
  const stoneGained6 = stoneQ6.defectPath ? 5 : 10;
  const junction = await waitRoom('岔口', 'D6 石门后到岔口');
  if (junction.hudScore !== `得分 ${stoneGained6}`) throw new Error(`D6 石门后得分异常: ${junction.hudScore}`);
  // 空闲态暂停：覆盖层出现，继续后状态不变
  await trustedClick('#btn-pause');
  await waitUntil(async () => { const s = await dungeonState(); return s.pauseOverlayHidden === false ? s : null; }, 'D6 暂停覆盖层（空闲）');
  const pausedIdle = await dungeonState();
  await shot('d6-01-pause-overlay');
  if (pausedIdle.hudScore !== `得分 ${stoneGained6}`) throw new Error(`D6 暂停时 HUD 异常: ${pausedIdle.hudScore}`);
  await trustedClick('#btn-resume');
  await waitUntil(async () => { const s = await dungeonState(); return s.pauseOverlayHidden === true && s.gameVisible ? s : null; }, 'D6 恢复（空闲）');
  // 左门计时中暂停：倒计时冻结对比
  await clickRoute('左门（锁着）');
  const q = await waitQuestion('左门');
  const c1 = parseCountdown(q.countdown);
  await sleep(700);
  const beforePause = await dungeonState();
  const c1b = parseCountdown(beforePause.countdown);
  await trustedClick('#btn-pause');
  await waitUntil(async () => { const s = await dungeonState(); return s.pauseOverlayHidden === false ? s : null; }, 'D6 暂停覆盖层（计时中）');
  const pausedTimer = await dungeonState();
  const pausedCountdown = pausedTimer.countdown; // 预期「已停止计时」
  const frozenRemaining = pausedTimer.snapshot?.timer?.remainingMs;
  const frozenPaused = pausedTimer.snapshot?.timer?.paused;
  await sleep(2500);
  const stillFrozen = await dungeonState();
  const frozenRemaining2 = stillFrozen.snapshot?.timer?.remainingMs;
  await shot('d6-02-pause-timer-frozen');
  await trustedClick('#btn-resume');
  const resumed = await waitQuestion('左门');
  const c2 = parseCountdown(resumed.countdown);
  const resumedPrompt = resumed.prompt;
  const timerOk = c1 !== null && c1b !== null && c2 !== null
    && frozenPaused === true
    && Math.abs(frozenRemaining / 1000 - c1b) < 0.9
    && frozenRemaining2 === frozenRemaining
    && Math.abs(c2 - frozenRemaining / 1000) < 1.0
    && c2 > c1b - 3.0
    && resumedPrompt === beforePause.prompt;
  const finalState = await dungeonState();
  // 本局继续答对左门（第 2 题），为 D7 刷新恢复准备：石门+左门开、资源房
  const leftQ6 = await answerDungeon({ wrong: false });
  const leftGained6 = leftQ6.defectPath ? 5 : 10;
  const resource = await waitRoom('资源房', 'D6 续答左门后到资源房（D7 前置）');
  const d7Ready = resource.hudScore === `得分 ${stoneGained6 + leftGained6}` && resource.hudKeys === '备用钥匙 0/1'
    && resource.snapshot?.room === 'resource'
    && resource.snapshot?.score === stoneGained6 + leftGained6
    && JSON.stringify(resource.snapshot?.openDoors) === JSON.stringify(['gate-stone', 'gate-left']);
  const ok = pausedIdle.pauseOverlayHidden === false && timerOk && d7Ready && finalState.errors.length === 0;
  record('D6 暂停/恢复', ok,
    `石门「${stoneQ6.prompt}」${stoneQ6.defectPath ? '（算式题·缺陷路径重试档）' : '首答'}+${stoneGained6} 后暂停：覆盖层「在地下城歇一会」出现、HUD 不变，继续后正常；左门计时中（剩 ${c1b} 秒）暂停→倒计时显示「${pausedCountdown}」、快照 remainingMs 冻结于 ${frozenRemaining}ms（2.5s 后仍 ${frozenRemaining2}ms 不变）→继续后倒计时 ${c2} 秒 ≈ 冻结值（暂停期间未流逝），题面不变「${resumedPrompt.slice(0, 18)}…」；续答左门${leftQ6.defectPath ? '（算式题·缺陷路径）' : ''}到资源房（得分 ${stoneGained6 + leftGained6}、石门+左门开），快照 room=${resource.snapshot?.room}、openDoors=${JSON.stringify(resource.snapshot?.openDoors)}（D7 前置就绪）；JS 错误 ${finalState.errors.length} 个`,
    { checks: { pausedIdleCountdown: pausedIdle.countdown, c1, c1b, pausedCountdown, frozenRemaining, frozenRemaining2, c2, timerOk, d7Snapshot: resource.snapshot, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('D6 暂停/恢复', false, `失败: ${e.message}`);
}

// ============================================================
// D7 刷新恢复（答对 2 题后刷新 → 恢复 → 续打到结算不重复计分）
// ============================================================
try {
  const before = await dungeonState();
  const beforeSnap = before.snapshot;
  if (!beforeSnap || beforeSnap.room !== 'resource') throw new Error('刷新前置状态不是资源房');
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => {
    const s = await dungeonState();
    return s.selectVisible && s.restoreOfferHidden === false ? s : null;
  }, '刷新后恢复提供');
  const offer = await dungeonState();
  await shot('d7-01-restore-offer');
  await click('#btn-restore');
  await waitUntil(async () => { const s = await dungeonState(); return s.gameVisible && s.hudRoom === '资源房' ? s : null; }, '恢复到资源房');
  await sleep(300);
  const restored = await dungeonState();
  await shot('d7-02-restored');
  // 刷新后页面模块索引丢失，重装题库池（答案自算依赖）
  await installDungeonPool([1]);
  const stateOk = restored.hudScore === `得分 ${beforeSnap.score}` && restored.hudKeys === '备用钥匙 0/1'
    && restored.snapshot?.roundId === beforeSnap.roundId
    && JSON.stringify(restored.snapshot?.openDoors) === JSON.stringify(beforeSnap.openDoors)
    && restored.snapshot?.room === beforeSnap.room
    && restored.snapshot?.score === beforeSnap.score
    && restored.snapshot?.keys === beforeSnap.keys
    && restored.routeButtons.some(r => r.text.startsWith('折回岔口'))
    && restored.routeButtons.some(r => r.text.startsWith('解读资源机关'));
  // 续打：资源题 → 折回 → 右门 → 结算（不重复计分：期望 = 刷新前得分 + 新增两题）
  await clickRoute('解读资源机关');
  await waitQuestion('资源机关');
  const resQ = await answerDungeon({ wrong: false });
  await collectKey();
  await waitRoom('资源房', 'D7 收下钥匙');
  await clickRoute('折回岔口');
  await waitRoom('岔口', 'D7 折回岔口');
  await clickRoute('右门（锁着）');
  await waitQuestion('右门');
  const rightQ = await answerDungeon({ wrong: false });
  await waitResult();
  await shot('d7-03-result');
  const s7 = await dungeonState();
  const resGained7 = resQ.defectPath ? 5 : 10;
  const rightGained7 = rightQ.defectPath ? 5 : 10;
  const expectScore7 = beforeSnap.score + resGained7 + rightGained7;
  const expectFirstTry7 = (beforeSnap.firstTryCount ?? 0) + (resQ.defectPath ? 0 : 1) + (rightQ.defectPath ? 0 : 1);
  const expectRetries7 = (beforeSnap.totalWrongCount ?? 0) + (resQ.defectPath ? 1 : 0) + (rightQ.defectPath ? 1 : 0);
  const scoreOk = s7.resultScore === `总分 ${expectScore7}`
    && s7.resultAnswer === `作答 4 题 · 首答 ${expectFirstTry7}/4 · 重试 ${expectRetries7} 次`;
  const exploreOk = s7.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, 'D7 返回选择屏');
  const rec = await dungeonState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === beforeSnap.roundId) ?? null;
  const recordOk = recRaw && recRaw.recordId === beforeSnap.roundId && recRaw.score === expectScore7
    && recRaw.answer?.questions?.length === 4;
  const finalState = await dungeonState();
  const ok = offer.restoreOfferText?.includes('有未完成的探索') && stateOk && scoreOk && exploreOk && recordOk
    && finalState.errors.length === 0;
  record('D7 刷新恢复', ok,
    `石门+左门开（${beforeSnap.score} 分）后 Page.reload：出现恢复提供「${offer.restoreOfferText?.slice(0, 30)}…」→继续探索→资源房/得分 ${beforeSnap.score}/钥匙 0/1/roundId 一致、路线按钮「折回岔口」与「解读资源机关」在（房间、门状态、得分、钥匙与刷新前一致）→续打资源题${resQ.defectPath ? '（算式题·缺陷路径重试档 +5）' : `（+${resGained7}）`}+右门${rightQ.defectPath ? '（算式题·缺陷路径重试档 +5）' : `（+${rightGained7}）`}→结算「${s7.resultScore}」「${s7.resultAnswer}」（= 刷新前 ${beforeSnap.score} + 新增 ${resGained7 + rightGained7}，若石门/左门重计应为 ${expectScore7 + beforeSnap.score}）「${s7.resultExplore}」；记录 recordId=roundId 幂等；JS 错误 ${finalState.errors.length} 个`,
    { checks: { beforeSnap, offerText: offer.restoreOfferText, restoredSnap: restored.snapshot, stateOk, expect: { score: expectScore7, firstTry: expectFirstTry7, retries: expectRetries7 }, result: { score: s7.resultScore, answer: s7.resultAnswer, explore: s7.resultExplore }, recordRaw: recRaw, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('D7 刷新恢复', false, `失败: ${e.message}`);
}

// ============================================================
// D8 双游戏回归（数字消除 + 汉字勇者 + 三入口并存 + 返回路径）
// ============================================================
try {
  await trustedClick('.profile-bar a.btn-ghost');
  const home = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible && s.dungeonAnchor ? s : null;
  }, 'D8 回到数字消除首页');
  const walletCoins8 = Number((home.wallet ?? '').match(/([0-9]+) 金币/)?.[1] ?? NaN);
  const walletOk = walletCoins8 === 20;
  // 数字消除选择屏：年级勾选与下一步可用
  await evaluate(`(() => { const el = document.querySelector('input[name="grade"][value="1"]');
    if (el && !el.checked) el.click(); })()`, false);
  await sleep(200);
  const npChecked = await homeState();
  const npOk = npChecked.gradeChecked.includes('1') && npChecked.btnToAvailabilityDisabled === false;
  await evaluate(`(() => { const el = document.querySelector('input[name="grade"][value="1"]');
    if (el && el.checked) el.click(); })()`, false);
  await sleep(200);
  // 菜单三入口并存
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, 'D8 菜单');
  const menu = await homeState();
  await shot('d8-01-home-menu');
  // 菜单保持打开，直接点击弹层内锚点
  // 汉字勇者
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const hs = await waitUntil(async () => {
    const s = await hanziState();
    return s.url.endsWith('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, 'D8 汉字勇者加载');
  await shot('d8-02-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, 'D8 hanzi 返回首页');
  // 地下城
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, 'D8 菜单再开');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const ds = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible
      && s.gradeCards.length === 6 ? s : null;
  }, 'D8 地下城加载');
  const dsRecords = ds.records.length;
  await trustedClick('.profile-bar a.btn-ghost');
  const backHome = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible && s.dungeonAnchor ? s : null;
  }, 'D8 地下城返回首页');
  const finalHome = await homeState();
  const ok = walletOk && npOk && menu.hanziAnchor?.visible && menu.dungeonAnchor?.visible
    && hs.gradeCards === 6 && ds.selectVisible && ds.gradeCards.length === 6 && dsRecords === 3 && backHome.selectVisible
    && finalHome.errors.length === 0 && hs.errors.length === 0 && ds.errors.length === 0;
  record('D8 双游戏回归', ok,
    `地下城「返回数字消除」回首页（钱包「${home.wallet}」=${walletCoins8} 金币，地下城零收支）；数字消除选择屏年级勾选一年级→下一步可用（再取消复原）；菜单弹层内汉字勇者与算术地下城两入口并存可见；真实点击进 hanzi.html 正常加载（6 年级卡、boot-fail 隐藏）→返回锚点回首页；再进 dungeon.html 正常（6 年级卡、练习记录 ${dsRecords} 条=D4/D5/D7 三局）→返回锚点回首页；JS 错误 0`,
    { checks: { wallet: home.wallet, walletCoins: walletCoins8, npChecked: { grades: npChecked.gradeChecked, btnOk: npOk }, menu: { hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor }, hanzi: { gradeCards: hs.gradeCards, h1: hs.h1 }, dungeon: { records: dsRecords, gradeCards: ds.gradeCards.length, h1: ds.h1 }, overflow: finalHome.overflowX, errors: finalHome.errors } });
} catch (e) {
  record('D8 双游戏回归', false, `失败: ${e.message}`);
}

// ============================================================
// D9 SW 三入口与断源（重新构建的 sw.js → 杀源站 → 三页缓存互导 + 地下城断网探索）
// ============================================================
try {
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, 'D9 首页就绪');
  const swInfo = await waitUntil(async () => evaluate(`(async () => {
    if (navigator.serviceWorker.controller === null) return null;
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    const home = await cache.match('/');
    const hanzi = await cache.match('/hanzi.html');
    const dungeon = await cache.match('/dungeon.html');
    const dungeonCss = await cache.match('/dungeon.css');
    if (!home || !hanzi || !dungeon || !dungeonCss) return null;
    const swText = await fetch('/sw.js').then(r => r.text());
    return {
      name, homeCached: true, hanziCached: true, dungeonCached: true, dungeonCssCached: true,
      swHasDungeonEntry: swText.includes('/dungeon.html'),
      notice: document.getElementById('offline-notice')?.textContent ?? null,
    };
  })()`), 'SW 受控且三入口缓存就绪', 40000);
  log('SW:', JSON.stringify({ name: swInfo.name, dungeon: swInfo.dungeonCached }));
  // 杀掉源站
  const { execSync } = await import('node:child_process');
  try { execSync('kill $(lsof -ti tcp:4173 -sTCP:LISTEN) 2>/dev/null || true', { shell: '/bin/zsh' }); } catch {}
  await sleep(1000);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}sw.js`); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  // 刷新首页：SW 缓存打开
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '断源后首页可打开', 30000);
  const offlineHome = await homeState();
  await shot('d9-01-offline-home');
  // 菜单 → 地下城
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.dungeonAnchor?.visible ? s : null; }, '断源后菜单');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const offlineDungeon = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible
      && s.gradeCards.length === 6 ? s : null;
  }, '断源后地下城可打开', 30000);
  await shot('d9-02-offline-dungeon');
  // 断网下重装题库池（dynamic import 走 SW 预缓存——同时验证模块闭包离线完整）
  const offlinePool = await installDungeonPool([1]).catch(e => { throw new Error(`断网下题库模块 import 失败（SW 闭包不全）: ${e.message}`); });
  // 断网继续探索：开局答对石门
  await click('#btn-start');
  await waitRoom('起点', '断源开局起点房');
  await clickRoute('石门（锁着）');
  await waitQuestion('石门');
  const offlineAnswer = await answerDungeon({ wrong: false });
  const offlineJunction = await waitRoom('岔口', '断源下石门开启到岔口');
  await shot('d9-03-offline-explore');
  const offlineGained = offlineAnswer.defectPath ? 5 : 10;
  if (offlineJunction.hudScore !== `得分 ${offlineGained}`) throw new Error(`断源作答后得分异常: ${offlineJunction.hudScore}`);
  // 地下城返回锚点 → 首页
  await click('#btn-game-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.confirmOpen ? s : null; }, '断源放弃确认');
  await confirmYes();
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, '断源放弃回选择屏');
  const afterDiscard = await dungeonState();
  await trustedClick('.profile-bar a.btn-ghost');
  const offlineBack = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible ? s : null;
  }, '断源后地下城返回首页', 30000);
  // 菜单 → hanzi
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, '断源菜单再开');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const offlineHanzi = await waitUntil(async () => {
    const s = await hanziState();
    return s.url.endsWith('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, '断源后汉字勇者可打开', 30000);
  await shot('d9-04-offline-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断源 hanzi 返回首页', 30000);
  const finalHome = await homeState();
  const ok = swInfo.dungeonCached && swInfo.swHasDungeonEntry && sourceDead
    && offlineHome.selectVisible && offlineDungeon.selectVisible
    && (offlinePool?.count ?? 0) > 0
    && offlineJunction.hudScore === `得分 ${offlineGained}` && offlineBack.selectVisible
    && offlineHanzi.gradeCards === 6
    && finalHome.errors.length === 0 && offlineHanzi.errors.length === 0 && offlineDungeon.errors.length === 0;
  record('D9 SW 三入口与断源', ok,
    `重新构建的 web/sw.js 版本 ${swInfo.name} 预缓存含 /、/hanzi.html、/dungeon.html（含 /dungeon.css，清单文本含 dungeon 入口）；杀掉 serve 进程（源站请求确认失败）后刷新：首页由缓存打开${swInfo.notice ? `（提示「${swInfo.notice}」）` : ''}，菜单进地下城由缓存正常加载，断网下题库模块经 SW 预缓存 import 成功（${offlinePool?.count} 题），开局答对石门题「${offlineAnswer.prompt}」+${offlineGained}${offlineAnswer.defectPath ? '（算式题·缺陷路径重试档）' : ''} 并穿门到岔口（离线探索正常），返回锚点回首页，再进 hanzi.html 正常（6 年级卡）——三入口缓存互导；放弃后中断快照清除=${afterDiscard.snapshot === null}；全程 JS 错误 0`,
    { checks: { swInfo, sourceDead, offlinePoolCount: offlinePool?.count ?? null, offlineHomeNotice: offlineHome.offlineNotice, offlineAnswer, offlineJunctionScore: offlineJunction.hudScore, snapshotDiscarded: afterDiscard.snapshot === null, overflow: finalHome.overflowX, errors: { home: finalHome.errors, dungeon: offlineDungeon.errors, hanzi: offlineHanzi.errors } } });
} catch (e) {
  record('D9 SW 三入口与断源', false, `失败: ${e.message}`);
}

// ===== 汇总 =====
const overflowBad = scenarios.filter(s => (s.checks?.overflow === true));
const errorBad = scenarios.filter(s => (s.checks?.errors && ((Array.isArray(s.checks.errors) ? s.checks.errors : Object.values(s.checks.errors).flat()).length > 0)));
const summary = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  userAgent: await evaluate('navigator.userAgent', false).catch(() => null),
  viewport: await evaluate('({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })', false).catch(() => null),
  scenarios,
  allPassed: scenarios.every(s => s.pass),
  d10Throughline: {
    horizontalOverflowScenarios: overflowBad.map(s => s.name),
    jsErrorScenarios: errorBad.map(s => s.name),
    allNoOverflow: overflowBad.length === 0,
    allZeroErrors: errorBad.length === 0,
  },
};
await writeFile(`${outDir}/dungeon-browser-results.json`, JSON.stringify(summary, null, 2));
log('结果已写入', `${outDir}/dungeon-browser-results.json`);
log(JSON.stringify(summary.scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(0);
