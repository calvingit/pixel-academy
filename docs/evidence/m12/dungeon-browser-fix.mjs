// 算术地下城（M12）缺陷修复复验轮（桌面无头 Chrome 经 CDP，全新 profile）。
// 针对首轮验收（dungeon-browser.mjs，结果见 dungeon-browser-results.json 首段）发现的
// 两个缺陷的修复做回归复验，只验证不修改游戏代码：
//   缺陷 #1（算式题「开门」按钮键入后不启用）：修复为 input.ts 的
//     wireIntegerSubmit——input 事件实时联动按钮、点击提交读取当前输入值、Enter 同路径。
//   缺陷 #2（resolving 窗口内点击被静默忽略）：修复为窗口内路线按钮与
//     「离开机关/收下钥匙」按钮渲染为 disabled（main.ts renderRoutes/renderQuestionActions）。
// 场景：
//   F1 D4 复验：完整通关局（右门答错→换一题→重试档），整数题真实逐键键入→按钮实时
//      启用→点击提交（首答 10 分档），结算恒 35 分逐项核对、记录 gameId、金币零变化。
//   F2 探针局：循环开局直到石门为整数题——探针 A 键入前后按钮 disabled 状态与实时联动；
//      探针 B 资源题答对 resolving 窗口内路线/离开按钮 disabled、窗口后恢复；右门答错
//      （整数题键入错值或 choice）→换一题→重试档，通关结算 35 分。
//   F3 D5 抽查：备用钥匙路径通关 30 分（钥匙解锁门不计入作答表现）。
//   F4 D7 抽查：答对 2 题刷新→恢复一致→续打结算 40（不重复计分）。
//   F5 D9 抽查：SW 受控→杀源站→三页缓存互导→断网循环开局直到整数题→逐键键入→
//      Enter 提交→穿门（断网整数题提交）→放弃→回首页→hanzi。
//   D10 贯穿：每场景记录横向溢出与 JS 错误。
// 结果合并写入 dungeon-browser-results.json 的 fixVerification 字段（与首轮并列区分）。
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9742';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m12';
const resultsPath = `${outDir}/dungeon-browser-results.json`;
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[fix-verify]', ...a);
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
    selectVisible: !hidden('screen-select'),
    errorVisible: !hidden('screen-error'),
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    hanziAnchor: anchor('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: anchor('#main-nav a[href="/dungeon.html"]'),
    wallet: t('wallet'),
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

// ===== 地下城状态（含缺陷回归探针所需的 disabled 字段） =====
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
    url: location.href, title: document.title,
    h1: document.querySelector('main h1')?.textContent ?? null,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
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
    records: [...document.querySelectorAll('#records-list li')].map(li => li.textContent),
    hudRoom: t('hud-room'), hudKeys: t('hud-keys'), hudScore: t('hud-score'),
    roomName: t('room-name'), roomDesc: t('room-desc'),
    routeButtons: [...document.querySelectorAll('#route-list button')].map(b => ({
      text: b.textContent, locked: b.classList.contains('route-locked'), disabled: b.disabled })),
    questionVisible: !hidden('question-card'),
    slotTitle: t('slot-title'),
    prompt: t('question-prompt'),
    countdown: t('countdown'),
    optionsHidden: hidden('options'),
    optionButtons: [...document.querySelectorAll('#options button')].map(b => ({
      text: b.textContent, disabled: b.disabled, pressed: b.getAttribute('aria-pressed') })),
    inputDisabled: document.getElementById('answer-input')?.disabled,
    inputSubmitDisabled: document.getElementById('btn-input-submit')?.disabled,
    inputValue: document.getElementById('answer-input')?.value ?? null,
    feedbackHidden: hidden('feedback'),
    feedback: t('feedback'),
    retryHidden: hidden('btn-retry-attempt'),
    swapHidden: hidden('btn-swap'),
    useKeyHidden: hidden('btn-use-key'),
    leaveDisabled: document.getElementById('btn-leave')?.disabled,
    leaveText: t('btn-leave'),
    pauseOverlayHidden: hidden('pause-overlay'),
    resultScore: t('result-score'),
    resultAnswer: t('result-answer'),
    resultExplore: t('result-explore'),
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    snapshot: snap ? {
      roundId: snap.roundId, room: snap.state?.room, openDoors: snap.state?.openDoors,
      score: snap.state?.score, keys: snap.state?.keys, activeSlot: snap.state?.activeSlot,
      usedIds: snap.state?.usedIds, answeredSlots: snap.state?.answeredSlots,
      route: snap.state?.route, totalWrongCount: snap.state?.totalWrongCount,
      firstTryCount: snap.state?.firstTryCount,
      timer: snap.timer,
    } : null,
    recordsRaw, recentIds,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 题库索引与题面自算 =====
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
  return { count: window.__pool.length, statuses: [...new Set(window.__pool.map(p => p.status))] };
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
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};

const click = selector => evaluate(`(() => { document.querySelector(${JSON.stringify(selector)})?.click(); })()`, false);
const confirmYes = () => click('#btn-confirm-yes');
const clickRoute = prefix => evaluate(`(() => {
  const btns = [...document.querySelectorAll('#route-list button')];
  const b = btns.find(x => x.textContent.startsWith(${JSON.stringify(prefix)}));
  if (!b) throw new Error('路线按钮未找到: ' + ${JSON.stringify(prefix)} + '；现有: ' + btns.map(x => x.textContent).join(' | '));
  if (b.disabled) throw new Error('路线按钮处于 disabled: ' + b.textContent);
  b.click();
})()`, false);

const waitRoom = (name, desc = `到达房间 ${name}`) => waitUntil(async () => {
  const s = await dungeonState();
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

// 提交是否被页面受理：反馈条出现（✓/✗）或门题面板关闭。
const submitLanded = async () => {
  const s = await dungeonState();
  return s.feedbackHidden === false || !s.questionVisible ? s : null;
};

// 真实逐键键入（逐字符 insertText，触发页面原生 input 事件管线），逐字符记录按钮态。
async function typeIntegerAnswer(value) {
  const before = await dungeonState();
  const disabledBefore = before.inputSubmitDisabled;
  await trustedClick('#answer-input');
  const disabledSeq = [];
  for (const ch of String(value)) {
    await send('Input.insertText', { text: ch });
    await sleep(80);
    const s = await dungeonState();
    disabledSeq.push({ value: s.inputValue, submitDisabled: s.inputSubmitDisabled });
  }
  return { disabledBefore, disabledSeq };
}

// 整数题作答：真实逐键键入 → 断言按钮实时启用 → click 或 Enter 提交 → 受理验证。
async function answerInteger(value, { viaEnter = false } = {}) {
  const st = await dungeonState();
  const typing = await typeIntegerAnswer(value);
  if (!typing.disabledSeq.length || typing.disabledSeq[0].submitDisabled !== false) {
    throw new Error(`缺陷 #1 回归失败：键入后「开门」按钮未实时启用 ${JSON.stringify(typing.disabledSeq)}`);
  }
  if (viaEnter) await pressEnter();
  else await evaluate(`document.getElementById('btn-input-submit').click()`, false);
  const landed = await waitUntil(submitLanded, '整数题提交受理', 3000).catch(() => null);
  if (!landed) throw new Error('整数题提交未被受理（点击/Enter 均无响应）');
  return { typing, viaEnter: viaEnter ? 'enter' : 'click' };
}

// choice 作答（单选直点、多选选齐提交）。
async function answerChoice({ wrong = false } = {}) {
  const st = await dungeonState();
  const texts = st.optionButtons.map(b => b.text);
  const task = await matchTask(st.prompt, texts);
  if (!task) throw new Error(`选择题面匹配失败: ${st.prompt} / ${JSON.stringify(texts)}`);
  if (task.status !== 'approved') throw new Error(`非 approved 题 ${task.id}: ${task.status}`);
  const clickIdx = async i => { await evaluate(`(() => { const b = document.querySelectorAll('#options button')[${i}]; if (b && !b.disabled) b.click(); })()`, false); await sleep(150); };
  let chosen;
  if (task.multiple) {
    const wantIds = wrong ? [task.ids.find(id => !task.correct.includes(id))] : task.correct;
    if (!wantIds[0]) throw new Error('多选题无错项可答错');
    for (const id of wantIds) await clickIdx(task.ids.indexOf(id));
    await evaluate(`document.getElementById('btn-choice-submit').click()`, false);
    chosen = wantIds;
  } else {
    const wantId = wrong ? task.ids.find(id => !task.correct.includes(id)) : task.correct[0];
    if (!wantId) throw new Error('单选题无错项可答错');
    await clickIdx(task.ids.indexOf(wantId));
    chosen = [wantId];
  }
  const landed = await waitUntil(submitLanded, '选择题提交受理', 3000).catch(() => null);
  if (!landed) throw new Error('选择题提交未被受理');
  return { kind: task.multiple ? 'choice-multiple' : 'choice-single', id: task.id, prompt: st.prompt, wrong, chosen };
}

// 统一作答当前面板题：整数题真实键入（修复后首答直提交），choice 点击。
async function answerCurrent({ wrong = false, viaEnter = false } = {}) {
  const st = await dungeonState();
  if (!st.questionVisible) throw new Error('门题面板未打开');
  if (!st.optionsHidden) return { ...(await answerChoice({ wrong })), typed: false };
  const task = await matchTask(st.prompt, null);
  if (!task || task.answer === null || task.answer === undefined) throw new Error(`算式题面匹配失败: ${st.prompt}`);
  if (task.status !== 'approved') throw new Error(`非 approved 题 ${task.id}: ${task.status}`);
  const value = wrong ? (task.answer === 0 ? 1 : task.answer - 1) : task.answer;
  const res = await answerInteger(String(value), { viaEnter });
  return { kind: task.kind, id: task.id, prompt: st.prompt, value, wrong, typed: true, ...res };
}

const collectKey = async () => {
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' && s.leaveDisabled === false ? s : null; }, '资源机关解开（按钮恢复可用）');
  await click('#btn-leave');
  await waitUntil(async () => { const s = await dungeonState(); return s.gameVisible && !s.questionVisible ? s : null; }, '面板关闭', 2500);
};

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

const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click(); })()`, false);
  const s = await dungeonState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want ? s : null;
}, `勾选年级 ${name}`);

// ============================================================
// F1 D4 复验：完整通关局 35 分（右门答错→换一题→重试档）
// ============================================================
try {
  // 先访问数字消除首页：全新 profile 上首次加载会初始化 IndexedDB 档案库
  // （profiles store），否则地下城页直接读档案会因 store 不存在抛 NotFoundError。
  await goto(`${ORIGIN}`);
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '首页档案初始化');
  const coinsInit = await idbProfileSnapshot();
  if (coinsInit?.coins !== 20) throw new Error(`全新档案金币应初始 20，实际 ${coinsInit?.coins}`);
  await goto(`${ORIGIN}dungeon.html`);
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible && s.bootFailHidden && s.gradeCards.length === 6 ? s : null; }, '地下城选择屏就绪');
  await installDungeonPool([1]);
  const coinsBefore = await idbProfileSnapshot();
  await toggleGrade('一年级', true);
  await click('#btn-start');
  const startRoom = await waitRoom('起点', 'F1 开局起点房');
  const f1RoundId = startRoom.snapshot?.roundId ?? null;
  await shot('fx1-01-start-room');
  const answers = [];
  let score = 0;
  // 石门 → 岔口 → 左门 → 资源房（每题首答 10；整数题真实逐键键入）
  const doors = [
    { route: '石门（锁着）', panel: '石门', room: '岔口' },
    { route: '左门（锁着）', panel: '左门', room: '资源房' },
  ];
  for (const d of doors) {
    await clickRoute(d.route);
    await waitQuestion(d.panel);
    const ans = await answerCurrent({ wrong: false });
    answers.push(ans);
    score += 10;
    const room = await waitRoom(d.room, `${d.panel}开启到 ${d.room}`);
    if (room.hudScore !== `得分 ${score}`) throw new Error(`${d.panel} 后得分异常: ${room.hudScore}`);
  }
  // 资源题（整数题时逐键键入 + click 提交）
  await clickRoute('解读资源机关');
  await waitQuestion('资源机关');
  const resQ = await answerCurrent({ wrong: false });
  answers.push(resQ);
  score += 10;
  await waitUntil(async () => { const s = await dungeonState(); return s.questionVisible && s.leaveText === '收下钥匙，返回房间' && s.leaveDisabled === false ? s : null; }, '资源机关解开（按钮可用）');
  const withKey = await dungeonState();
  if (withKey.hudKeys !== '备用钥匙 1/1' || withKey.hudScore !== `得分 ${score}`) throw new Error(`钥匙后 HUD 异常: ${withKey.hudKeys} ${withKey.hudScore}`);
  await shot('fx1-02-resource-key');
  await collectKey();
  await waitRoom('资源房', 'F1 收下钥匙');
  await clickRoute('折回岔口');
  await waitRoom('岔口', 'F1 折回岔口');
  // 右门：故意答错一次 → 换一题 → 答对（重试档 5）
  await clickRoute('右门（锁着）');
  await waitQuestion('右门');
  const wrongAns = await answerCurrent({ wrong: true });
  const retry = await waitRetryState();
  if (retry.hudScore !== `得分 ${score}`) throw new Error(`答错后扣分了: ${retry.hudScore}`);
  const wrongPrompt = retry.prompt;
  await shot('fx1-03-right-wrong');
  await click('#btn-swap');
  const swapped = await waitQuestion('右门', { notPrompt: wrongPrompt });
  const rightQ = await answerCurrent({ wrong: false });
  answers.push(rightQ);
  score += 5;
  const result = await waitResult();
  await shot('fx1-04-result-35');
  const s1 = await dungeonState();
  const scoreOk = s1.resultScore === `总分 ${score}` && score === 35;
  const answerOk = s1.resultAnswer === '作答 4 题 · 首答 3/4 · 重试 1 次';
  const exploreOk = s1.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, 'F1 返回选择屏');
  const rec = await dungeonState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === f1RoundId) ?? null;
  const recordOk = recRaw && recRaw.gameId === 'arithmetic-dungeon' && recRaw.score === 35
    && recRaw.answer?.questions?.length === 4 && recRaw.explore?.keyUses === 0 && recRaw.explore?.retries === 1
    && rec.records.some(r => r.includes('35 分 · 首答 3/4 · 重试 1'));
  const coinsAfter = await idbProfileSnapshot();
  const finalState = await dungeonState();
  const typedCount = answers.filter(a => a.typed).length;
  const ok = scoreOk && answerOk && exploreOk && recordOk && coinsAfter?.coins === coinsBefore?.coins
    && finalState.errors.length === 0;
  record('F1 D4 复验：完整通关局 35 分', ok,
    `修复后 35 分路径直接达成：起点→${answers.map(a => `${a.prompt.slice(0, 12)}…(${a.typed ? `整数题逐键键入[${a.viaEnter}]` : 'choice'}首答+10)`).join('→')}→右门「${wrongPrompt.slice(0, 12)}…」故意答错（${wrongAns.typed ? '键入错值直接提交生效' : 'choice 错项'}，不解锁不扣分）→「换一题」→「${rightQ.prompt.slice(0, 12)}…」重试档 +5→结算「${s1.resultScore}」「${s1.resultAnswer}」「${s1.resultExplore}」与规格示例逐项吻合（10+10+10+5=35）；记录 gameId=${recRaw?.gameId}、score=35、retries=1；金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}；整数题键入 ${typedCount} 道；JS 错误 ${finalState.errors.length} 个`,
    { checks: { answers, wrongAns, expect: { score: 35, firstTry: 3, retries: 1 }, roundId: f1RoundId, result: { score: s1.resultScore, answer: s1.resultAnswer, explore: s1.resultExplore }, recordRaw: recRaw, coinsBefore, coinsAfter, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('F1 D4 复验：完整通关局 35 分', false, `失败: ${e.message}`);
}

// ============================================================
// F2 探针局：整数题键入联动探针（A）+ resolving 窗口按钮探针（B）→ 通关 35 分
// ============================================================
try {
  await installDungeonPool([1]);
  await click('#btn-start');
  let found = false;
  let probeA = null;
  let stoneQ = null;
  for (let i = 0; i < 40 && !found; i++) {
    const room = await waitRoom('起点', `F2 开局（第 ${i + 1} 次）`);
    await clickRoute('石门（锁着）');
    const q = await waitQuestion('石门');
    if (q.optionsHidden) {
      // 整数题：探针 A
      const task = await matchTask(q.prompt, null);
      const probeTyping = await typeIntegerAnswer(String(task.answer));
      probeA = {
        disabledBefore: probeTyping.disabledBefore,
        firstCharEnables: probeTyping.disabledSeq[0]?.submitDisabled === false,
        seq: probeTyping.disabledSeq,
        round: i,
      };
      // 点击提交（首答 10 分档）
      await evaluate(`document.getElementById('btn-input-submit').click()`, false);
      const landed = await waitUntil(submitLanded, '探针 A 提交受理', 3000).catch(() => null);
      if (!landed) throw new Error('探针 A：键入后点击提交未受理');
      stoneQ = { kind: task.kind, id: task.id, prompt: q.prompt, typed: true, viaEnter: 'click' };
      found = true;
    } else {
      await answerChoice({ wrong: false });
      await waitRoom('岔口', '石门开启到岔口');
      // 放弃重开，直到石门为整数题
      await click('#btn-game-return');
      await waitUntil(async () => { const s = await dungeonState(); return s.confirmOpen ? s : null; }, 'F2 放弃确认');
      await confirmYes();
      await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, 'F2 回选择屏');
      await click('#btn-start');
    }
  }
  if (!found) throw new Error('40 局内石门未抽到整数题，探针 A 未覆盖');
  const junction = await waitRoom('岔口', '探针 A：石门整数题首答 +10 到岔口');
  if (junction.hudScore !== '得分 10') throw new Error(`探针 A 首答得分异常: ${junction.hudScore}`);
  await shot('fx2-01-typing-probe');
  // 左门（choice 或整数，整数则走 Enter 路径）
  await clickRoute('左门（锁着）');
  const leftWait = await waitQuestion('左门');
  let leftAns;
  if (leftWait.optionsHidden) {
    const task = await matchTask(leftWait.prompt, null);
    leftAns = { ...(await answerInteger(String(task.answer), { viaEnter: true })), kind: task.kind, id: task.id, prompt: leftWait.prompt, typed: true };
  } else {
    leftAns = { ...(await answerChoice({ wrong: false })), typed: false };
  }
  await waitRoom('资源房', 'F2 左门开启到资源房');
  // 资源机关：探针 B（resolving 窗口内路线/离开按钮 disabled → 窗口后恢复）
  await clickRoute('解读资源机关');
  await waitQuestion('资源机关');
  const resWait = await dungeonState();
  const resIsInteger = resWait.optionsHidden;
  let resAns;
  if (resIsInteger) {
    const task = await matchTask(resWait.prompt, null);
    resAns = { ...(await answerInteger(String(task.answer), { viaEnter: true })), kind: task.kind, id: task.id, prompt: resWait.prompt, typed: true };
  } else {
    resAns = { ...(await answerChoice({ wrong: false })), typed: false };
  }
  // 窗口内（feedback ✓ 已渲染、resolving 仍 true）立即读按钮态
  await sleep(120);
  const inWindow = await dungeonState();
  await shot('fx2-02-resolving-window');
  await sleep(1300);
  const afterWindow = await dungeonState();
  await shot('fx2-03-window-recovered');
  const probeB = {
    inWindow: {
      feedback: inWindow.feedback,
      leaveDisabled: inWindow.leaveDisabled,
      routeButtons: inWindow.routeButtons,
    },
    afterWindow: {
      leaveDisabled: afterWindow.leaveDisabled,
      leaveText: afterWindow.leaveText,
      routeButtons: afterWindow.routeButtons,
    },
  };
  const probeBOk = probeB.inWindow.leaveDisabled === true
    && probeB.inWindow.routeButtons.length > 0
    && probeB.inWindow.routeButtons.every(r => r.disabled === true)
    && probeB.afterWindow.leaveDisabled === false
    && probeB.afterWindow.routeButtons.every(r => r.disabled === false)
    && probeB.afterWindow.leaveText === '收下钥匙，返回房间';
  // 收下钥匙（窗口后按钮已恢复可用，一次点击生效）
  await click('#btn-leave');
  await waitRoom('资源房', 'F2 收下钥匙');
  if ((await dungeonState()).hudKeys !== '备用钥匙 1/1') throw new Error('F2 钥匙异常');
  await clickRoute('折回岔口');
  await waitRoom('岔口', 'F2 折回岔口');
  // 右门：故意答错（整数题键入错值直接提交 / choice 错项）→ 换一题 → 答对（重试档）
  await clickRoute('右门（锁着）');
  await waitQuestion('右门');
  const rightWait = await dungeonState();
  let wrongAns;
  if (rightWait.optionsHidden) {
    const task = await matchTask(rightWait.prompt, null);
    const wrongValue = task.answer === 0 ? 1 : task.answer - 1;
    const typing = await typeIntegerAnswer(String(wrongValue));
    await pressEnter();
    const landed = await waitUntil(submitLanded, '右门整数题错值提交', 3000).catch(() => null);
    if (!landed) throw new Error('右门整数题错值提交未受理');
    wrongAns = { kind: task.kind, id: task.id, prompt: rightWait.prompt, value: wrongValue, wrong: true, typed: true, viaEnter: 'enter', typing };
  } else {
    wrongAns = { ...(await answerChoice({ wrong: true })), typed: false };
  }
  await waitRetryState();
  await click('#btn-swap');
  await waitQuestion('右门', { notPrompt: wrongAns.prompt });
  const rightQ = await answerCurrent({ wrong: false });
  await waitResult();
  await shot('fx2-04-result-35');
  const s2 = await dungeonState();
  const scoreOk2 = s2.resultScore === '总分 35' && s2.resultAnswer === '作答 4 题 · 首答 3/4 · 重试 1 次';
  const probeAOk = probeA.disabledBefore === true && probeA.firstCharEnables === true
    && probeA.seq.every(step => step.submitDisabled === false);
  const finalState = await dungeonState();
  const ok = probeAOk && probeBOk && scoreOk2 && finalState.errors.length === 0;
  record('F2 缺陷回归探针（整数题键入联动 + resolving 窗口）', ok,
    `探针 A（缺陷 #1 回归）：循环 ${probeA.round + 1} 局命中石门整数题「${stoneQ.prompt}」，键入前「开门」disabled=${probeA.disabledBefore}，逐键键入后每字符按钮实时启用（首字符即 ${probeA.firstCharEnables}）${JSON.stringify(probeA.seq)}，点击提交受理、首答 +10（choice 级首答档恢复）→左门${leftAns.typed ? '（整数题 Enter 提交）' : ''}→资源机关${resAns.typed ? '（整数题 Enter 提交）' : ''}→探针 B（缺陷 #2 回归）：答对后 resolving 窗口内路线按钮全部 disabled=${JSON.stringify(probeB.inWindow.routeButtons.map(r => r.disabled))}、「收下钥匙」disabled=${probeB.inWindow.leaveDisabled}；窗口结束后恢复：路线按钮全部启用、「收下钥匙」disabled=${probeB.afterWindow.leaveDisabled}、一次点击生效→右门${wrongAns.typed ? '键入错值 Enter 提交' : 'choice 错项'}答错（不解锁不扣分）→换一题→重试档 +5→通关结算「${s2.resultScore}」「${s2.resultAnswer}」（35 分路径再次达成）；JS 错误 ${finalState.errors.length} 个`,
    { checks: { probeA, probeB, probeAOk, probeBOk, answers: [stoneQ, leftAns, resAns, wrongAns, rightQ], result: { score: s2.resultScore, answer: s2.resultAnswer }, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('F2 缺陷回归探针（整数题键入联动 + resolving 窗口）', false, `失败: ${e.message}`);
}

// ============================================================
// F3 D5 抽查：备用钥匙路径通关 30 分
// ============================================================
try {
  await installDungeonPool([1]);
  const prev = await dungeonState();
  const prevIds = prev.recentIds ?? [];
  await click('#btn-start');
  const f3Start = await waitRoom('起点', 'F3 开局起点房');
  const f3RoundId = f3Start.snapshot?.roundId ?? null;
  for (const d of [{ route: '石门（锁着）', panel: '石门', room: '岔口' }, { route: '左门（锁着）', panel: '左门', room: '资源房' }]) {
    await clickRoute(d.route);
    await waitQuestion(d.panel);
    await answerCurrent({ wrong: false });
    await waitRoom(d.room, `F3 ${d.panel}后`);
  }
  await clickRoute('解读资源机关');
  await waitQuestion('资源机关');
  await answerCurrent({ wrong: false });
  await collectKey();
  await waitRoom('资源房', 'F3 收下钥匙');
  await clickRoute('折回岔口');
  await waitRoom('岔口', 'F3 折回岔口');
  await clickRoute('右门（锁着）');
  await waitQuestion('右门');
  const wrongAns3 = await answerCurrent({ wrong: true });
  const retry3 = await waitRetryState();
  if (retry3.hudScore !== '得分 30') throw new Error(`F3 答错后得分异常: ${retry3.hudScore}`);
  const useKeyVisible = retry3.useKeyHidden === false;
  await shot('fx3-01-key-offer');
  await click('#btn-use-key');
  await waitResult();
  await shot('fx3-02-result-30');
  const s3 = await dungeonState();
  const scoreOk = s3.resultScore === '总分 30' && s3.resultAnswer === '作答 3 题 · 首答 3/3 · 重试 1 次'
    && s3.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 1 把 / 剩 0 把';
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, 'F3 返回选择屏');
  const rec = await dungeonState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === f3RoundId) ?? null;
  const slots = (recRaw?.answer?.questions ?? []).map(q => q.slot);
  const recordOk = recRaw && recRaw.score === 30 && JSON.stringify(slots) === JSON.stringify(['gate-stone', 'gate-left', 'resource'])
    && !slots.includes('gate-right') && recRaw.explore?.keyUses === 1 && recRaw.explore?.keysHeld === 0;
  const exerciseIds = (recRaw?.answer?.questions ?? []).map(q => q.exerciseId);
  const avoidPrevOk = exerciseIds.every(id => !prevIds.includes(id));
  const finalState = await dungeonState();
  const ok = useKeyVisible && scoreOk && recordOk && avoidPrevOk && finalState.errors.length === 0;
  record('F3 D5 抽查：备用钥匙路径', ok,
    `石门+左门+资源题首答全对（30 分、钥匙 1/1）→右门故意答错（${wrongAns3.typed ? '整数题键入错值直接提交' : 'choice 错项'}，不解锁不扣分）→消耗备用钥匙直接解锁→通关结算「${s3.resultScore}」「${s3.resultAnswer}」；作答表现 slots=${JSON.stringify(slots)}（钥匙解锁的右门不计入）、keyUses=1、本局避开上一局=${avoidPrevOk}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { wrongAns: wrongAns3, result: { score: s3.resultScore, answer: s3.resultAnswer, explore: s3.resultExplore }, recordRaw: recRaw, avoidPrevOk, roundId: f3RoundId, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('F3 D5 抽查：备用钥匙路径', false, `失败: ${e.message}`);
}

// ============================================================
// F4 D7 抽查：答对 2 题 → 刷新恢复 → 续打结算 40（不重复计分）
// ============================================================
try {
  await installDungeonPool([1]);
  await click('#btn-start');
  await waitRoom('起点', 'F4 开局起点房');
  await clickRoute('石门（锁着）');
  await waitQuestion('石门');
  await answerCurrent({ wrong: false });
  await waitRoom('岔口', 'F4 石门后');
  await clickRoute('左门（锁着）');
  await waitQuestion('左门');
  await answerCurrent({ wrong: false });
  const before = await waitRoom('资源房', 'F4 到资源房（D7 前置）');
  const beforeSnap = before.snapshot;
  if (!beforeSnap || beforeSnap.room !== 'resource' || beforeSnap.score !== 20) throw new Error(`F4 前置状态异常: ${JSON.stringify(beforeSnap)}`);
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => {
    const s = await dungeonState();
    return s.selectVisible && s.restoreOfferHidden === false && s.gradeCards.length === 6 ? s : null;
  }, 'F4 刷新后恢复提供');
  await shot('fx4-01-restore-offer');
  await click('#btn-restore');
  await waitUntil(async () => { const s = await dungeonState(); return s.gameVisible && s.hudRoom === '资源房' ? s : null; }, 'F4 恢复到资源房');
  await sleep(300);
  const restored = await dungeonState();
  await shot('fx4-02-restored');
  const stateOk = restored.hudScore === '得分 20' && restored.hudKeys === '备用钥匙 0/1'
    && restored.snapshot?.roundId === beforeSnap.roundId
    && JSON.stringify(restored.snapshot?.openDoors) === JSON.stringify(beforeSnap.openDoors)
    && restored.snapshot?.room === beforeSnap.room
    && restored.snapshot?.score === beforeSnap.score
    && restored.routeButtons.some(r => r.text.startsWith('折回岔口') && !r.disabled)
    && restored.routeButtons.some(r => r.text.startsWith('解读资源机关'));
  await installDungeonPool([1]);
  await clickRoute('解读资源机关');
  await waitQuestion('资源机关');
  const resQ4 = await answerCurrent({ wrong: false });
  await collectKey();
  await waitRoom('资源房', 'F4 收下钥匙');
  await clickRoute('折回岔口');
  await waitRoom('岔口', 'F4 折回岔口');
  await clickRoute('右门（锁着）');
  await waitQuestion('右门');
  const rightQ4 = await answerCurrent({ wrong: false });
  await waitResult();
  await shot('fx4-03-result-40');
  const s4 = await dungeonState();
  const scoreOk = s4.resultScore === '总分 40' && s4.resultAnswer === '作答 4 题 · 首答 4/4 · 重试 0 次'
    && s4.resultExplore === '路线 起点 → 岔口 → 资源房 → 岔口 → 终点房 · 备用钥匙 用 0 把 / 剩 1 把';
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, 'F4 返回选择屏');
  const rec = await dungeonState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === beforeSnap.roundId) ?? null;
  const recordOk = recRaw && recRaw.recordId === beforeSnap.roundId && recRaw.score === 40 && recRaw.answer?.questions?.length === 4;
  const finalState = await dungeonState();
  const ok = stateOk && scoreOk && recordOk && finalState.errors.length === 0;
  record('F4 D7 抽查：刷新恢复不重复计分', ok,
    `石门+左门开（20 分）后 Page.reload→恢复提供→继续探索：资源房/得分 20/钥匙 0/1/roundId/门状态与刷新前一致（stateOk=${stateOk}）→续打资源题${resQ4.typed ? '（整数题键入）' : ''}+右门${rightQ4.typed ? '（整数题键入）' : ''}→结算「${s4.resultScore}」「${s4.resultAnswer}」（=20+20；若石门/左门重计应为 60，未发生）；记录 recordId=roundId 幂等；JS 错误 ${finalState.errors.length} 个`,
    { checks: { beforeSnap, restoredSnap: restored.snapshot, stateOk, result: { score: s4.resultScore, answer: s4.resultAnswer, explore: s4.resultExplore }, recordRaw: recRaw, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('F4 D7 抽查：刷新恢复不重复计分', false, `失败: ${e.message}`);
}

// ============================================================
// F5 D9 抽查：SW 受控 → 杀源站 → 三页缓存互导 → 断网整数题键入提交
// ============================================================
try {
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, 'F5 回首页');
  const swInfo = await waitUntil(async () => evaluate(`(async () => {
    if (navigator.serviceWorker.controller === null) return null;
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    const dungeon = await cache.match('/dungeon.html');
    const dungeonCss = await cache.match('/dungeon.css');
    if (!dungeon || !dungeonCss) return null;
    return { name, dungeonCached: true,
      notice: document.getElementById('offline-notice')?.textContent ?? null };
  })()`), 'F5 SW 受控且地下城入口缓存就绪', 40000);
  log('F5 SW:', JSON.stringify({ name: swInfo.name }));
  // 杀掉源站
  const { execSync } = await import('node:child_process');
  try { execSync('kill $(lsof -ti tcp:4173 -sTCP:LISTEN) 2>/dev/null || true', { shell: '/bin/zsh' }); } catch {}
  await sleep(1000);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}sw.js`); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '断源后首页可打开', 30000);
  const offlineHome = await homeState();
  await shot('fx5-01-offline-home');
  // 菜单 → 地下城
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.dungeonAnchor?.visible ? s : null; }, '断源后菜单');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const offlineDungeon = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null;
  }, '断源后地下城可打开', 30000);
  await shot('fx5-02-offline-dungeon');
  // 断网下题库模块 import（SW 预缓存）+ 循环开局直到整数题
  const offlinePool = await installDungeonPool([1]).catch(e => { throw new Error(`断网下题库模块 import 失败: ${e.message}`); });
  let offlineAnswer = null;
  let offlineRounds = 0;
  for (let i = 0; i < 60; i++) {
    await click('#btn-start');
    await waitRoom('起点', `断源开局（第 ${i + 1} 次）`);
    await clickRoute('石门（锁着）');
    const q = await waitQuestion('石门');
    offlineRounds = i + 1;
    if (q.optionsHidden) {
      // 整数题：断网下真实逐键键入 → Enter 提交（覆盖 Enter 路径）
      const task = await matchTask(q.prompt, null);
      const typing = await typeIntegerAnswer(String(task.answer));
      if (typing.disabledSeq[0]?.submitDisabled !== false) throw new Error('断网下键入后按钮未实时启用');
      await pressEnter();
      const landed = await waitUntil(submitLanded, '断网整数题 Enter 提交受理', 3000).catch(() => null);
      if (!landed) throw new Error('断网整数题 Enter 提交未受理');
      offlineAnswer = { prompt: q.prompt, kind: task.kind, id: task.id, typed: true, viaEnter: 'enter', value: task.answer };
    } else {
      await answerChoice({ wrong: false });
      offlineAnswer = { prompt: q.prompt, typed: false };
    }
    const junction = await waitRoom('岔口', '断源下石门开启到岔口');
    offlineAnswer.gainedScore = junction.hudScore;
    break;
  }
  if (!offlineAnswer) throw new Error('60 局内断网未抽到整数题');
  await shot('fx5-03-offline-explore');
  if (offlineAnswer.gainedScore !== '得分 10') throw new Error(`断源作答后得分异常: ${offlineAnswer.gainedScore}`);
  // 放弃 → 返回锚点 → 首页 → hanzi → 返回
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
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, '断源菜单再开');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const offlineHanzi = await waitUntil(async () => {
    const s = await hanziState();
    return s.url.endsWith('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, '断源后汉字勇者可打开', 30000);
  await shot('fx5-04-offline-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断源 hanzi 返回首页', 30000);
  const finalHome = await homeState();
  const ok = swInfo.dungeonCached && sourceDead && offlineDungeon.selectVisible
    && (offlinePool?.count ?? 0) > 0 && offlineAnswer.gainedScore === '得分 10'
    && offlineBack.selectVisible && offlineHanzi.gradeCards === 6
    && finalHome.errors.length === 0 && offlineHanzi.errors.length === 0 && offlineDungeon.errors.length === 0;
  record('F5 D9 抽查：断源三页缓存与断网整数题提交', ok,
    `重新构建的 sw.js 版本 ${swInfo.name} 预缓存含 /dungeon.html（含 /dungeon.css）；杀掉 serve 进程（源站确认失败）后刷新：首页由缓存打开${swInfo.notice ? `（提示「${swInfo.notice}」）` : ''}→菜单进地下城正常→断网下题库模块 import 成功（${offlinePool?.count} 题）→第 ${offlineRounds} 局石门命中${offlineAnswer.typed ? `整数题「${offlineAnswer.prompt}」：逐键键入实时启用按钮、**Enter 提交**受理 +10 穿门（断网整数题提交走通）` : `选择题「${offlineAnswer.prompt}」+10（本局未抽到整数题，断网键入提交未覆盖）`}→放弃（快照清除=${afterDiscard.snapshot === null}）→返回锚点回首页→hanzi.html 正常（6 年级卡）——三入口缓存互导；JS 错误 0`,
    { checks: { swInfo, sourceDead, offlinePoolCount: offlinePool?.count ?? null, offlineAnswer, offlineRounds, snapshotDiscarded: afterDiscard.snapshot === null, overflow: finalHome.overflowX, errors: { home: finalHome.errors, dungeon: offlineDungeon.errors, hanzi: offlineHanzi.errors } } });
} catch (e) {
  record('F5 D9 抽查：断源三页缓存与断网整数题提交', false, `失败: ${e.message}`);
}

// ===== 汇总：合并写入 dungeon-browser-results.json（fixVerification 字段） =====
const overflowBad = scenarios.filter(s => (s.checks?.overflow === true));
const errorBad = scenarios.filter(s => (s.checks?.errors && ((Array.isArray(s.checks.errors) ? s.checks.errors : Object.values(s.checks.errors).flat()).length > 0)));
const fixSummary = {
  driverScript: 'dungeon-browser-fix.mjs',
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
const prev = JSON.parse(await readFile(resultsPath, 'utf8'));
prev.fixVerification = fixSummary;
await writeFile(resultsPath, JSON.stringify(prev, null, 2));
log('复验结果已合并写入', resultsPath, '(fixVerification 字段)');
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(0);
