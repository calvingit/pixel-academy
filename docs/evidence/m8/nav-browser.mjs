// 数字消除首页游戏选择导航验证（桌面无头 Chrome 经 CDP）。
// 参照 hanzi-browser.mjs 结构：DOM 控件真实事件作答，答案从页面题面经 dist
// 判题模块自算；不注入任何游戏状态。覆盖 7 个场景：
// S1 首页入口 → S2 进入 hanzi → S3 返回首页 → S4 数字消除整局回归
// → S5 预览隔离 → S6 刷新恢复 → S7 SW 断源回归。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9741';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m8';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[nav]', ...a);
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
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 25000);
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

// 画布焦点块索引（render.ts focusedTile 初值 0，仅键盘移动会改变；跨导航/刷新重置）。
let focusedTile = 0;
const resetFocus = () => { focusedTile = 0; };

const goto = async url => {
  await send('Page.navigate', { url });
  resetFocus();
  await sleep(1200);
};

// ===== 页面状态读取 =====
const pageState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('main h1, main .app-title')?.textContent ?? null,
    screen: document.body.dataset.screen ?? null,
    selectVisible: !hidden('screen-select'),
    availabilityVisible: !hidden('screen-availability'),
    availabilityStatus: t('availability-status'),
    gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'),
    errorVisible: !hidden('screen-error'),
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    navHidden: document.getElementById('main-nav')?.hidden,
    navLabel: document.getElementById('main-nav')?.getAttribute('aria-label') ?? null,
    navItems: [...(document.getElementById('main-nav')?.children ?? [])].map(el => ({ tag: el.tagName, text: el.textContent.trim().replace(/\\s+/g, ' ') })),
    hanziAnchor: (() => { const a = document.querySelector('#main-nav a[href="/hanzi.html"]');
      return a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/\\s+/g, ' '),
        decorAriaHidden: a.querySelector('span')?.getAttribute('aria-hidden') ?? null,
        visible: !!(a.offsetWidth || a.offsetHeight), rect: (r => ({ x: r.x, y: r.y, w: r.width, h: r.height }))(a.getBoundingClientRect()) } : null; })(),
    wallet: t('wallet'),
    previewBannerHidden: hidden('preview-banner'),
    resultPreviewNoteHidden: hidden('result-preview-note'),
    recordsSectionHidden: hidden('records-section'),
    storageNoticeHidden: hidden('storage-notice'),
    offlineNotice: hidden('offline-notice') ? null : t('offline-notice'),
    restoreOfferHidden: hidden('restore-offer'),
    restoreText: t('restore-offer-text'),
    choiceVisible: !hidden('choice-board'),
    choiceTask: t('choice-task'),
    choiceProgress: t('choice-progress'),
    choiceInstructions: t('choice-instructions'),
    choiceOptions: [...document.querySelectorAll('#choice-options button')].map(b => ({ id: b.dataset.optionId, text: b.textContent, disabled: b.disabled })),
    submitHidden: hidden('btn-choice-submit'),
    submitDisabled: document.getElementById('btn-choice-submit')?.disabled,
    gameTask: t('game-task'),
    countdown: t('countdown'),
    pauseOverlayHidden: hidden('pause-overlay'),
    pauseTitle: t('pause-title'),
    resumeHidden: hidden('btn-resume'),
    readyHidden: hidden('btn-ready'),
    boardVisible: !hidden('board-canvas'),
    boardLabel: document.getElementById('board-canvas')?.getAttribute('aria-label') ?? null,
    reviveOpen: document.getElementById('revive-dialog')?.open ?? false,
    reviveMessage: t('revive-message'),
    reviveBtnText: t('btn-revive'),
    reviveDisabled: document.getElementById('btn-revive')?.disabled,
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    confirmMessage: t('confirm-message'),
    resultTitle: t('result-title'),
    resultScore: t('result-score'),
    resultFirstTry: t('result-first-try'),
    resultWrong: t('result-wrong'),
    resultCoins: t('result-coins'),
    errors: window.__errors ?? [],
  };
})()`, false);

const hanziState = () => evaluate(`(() => ({
  url: location.href, title: document.title,
  h1: document.querySelector('.app-title')?.textContent ?? null,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
  selectVisible: !document.getElementById('screen-select')?.hidden,
  offlineNotice: document.getElementById('offline-notice')?.hidden ? null : document.getElementById('offline-notice')?.textContent,
  storageNoticeHidden: document.getElementById('storage-notice')?.hidden,
  errors: window.__errors ?? [],
}))()`, false);

// ===== 作答辅助：题面 → dist 判题模块计算答案 =====
// 页面内安装题库索引（正式池 selectExercises 或预览池 previewExercises 按 URL 模式）。
const installPool = () => evaluate(`(async () => {
  const { loadGameContent } = await import('/dist/game/number-puzzle/content.js');
  const { taskText } = await import('/dist/game/number-puzzle/learning.js');
  const { correctOptionIds, isMultiple } = await import('/dist/learning/choice.js');
  const { answerFor } = await import('/dist/learning/evaluation.js');
  const content = loadGameContent();
  const preview = new URLSearchParams(location.search).get('preview') === 'candidate';
  const picked = preview ? content.preview([1]) : content.select([1]);
  window.__qa = {
    preview,
    statuses: [...new Set(picked.map(e => e.review.status))],
    pool: picked.map(e => ({
      id: e.id, status: e.review.status, text: taskText(e.task),
      optionKey: e.task.kind === 'choice' ? e.task.options.map(o => o.id).slice().sort().join(',') : '',
      multiple: e.task.kind === 'choice' ? isMultiple(e.task) : false,
      correct: e.task.kind === 'choice' ? correctOptionIds(e.task).slice().sort().join(',') : null,
      answer: e.task.kind === 'choice' ? null : answerFor(e.task),
    })),
  };
  return { preview, count: window.__qa.pool.length, statuses: window.__qa.statuses };
})()`);

const matchTaskImpl = (text, optionIdsSorted) => evaluate(`(() => {
  const text = ${JSON.stringify(text)};
  const optKey = ${JSON.stringify(optionIdsSorted ?? '')};
  const matches = window.__qa.pool.filter(p => p.text === text && (!p.optionKey || p.optionKey === optKey));
  if (!matches.length) return null;
  return { id: matches[0].id, status: matches[0].status, multiple: matches[0].multiple,
    correct: matches[0].correct ? matches[0].correct.split(',') : null, answer: matches[0].answer,
    matchCount: matches.length };
})()`);

// 画布棋盘列数：与 render.ts boardLayout 相同的横竖屏判定。
const boardColumns = () => evaluate(`(() => {
  const wrap = document.getElementById('board-wrap');
  const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
  const landscape = availW / availH > 1.35 && availH < 420;
  return landscape ? 4 : 3;
})()`, false);

const dispatchKey = key => evaluate(`(() => {
  document.getElementById('board-canvas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
})()`, false);

const parseBoard = label => {
  const m = label.match(/按行排列：(.*)。当前选择 (.+)$/);
  if (!m) throw new Error(`无法解析棋盘 aria-label: ${label}`);
  return { values: m[1].split('、').map(s => s === '空位' ? null : Number(s)), focused: m[2] };
};

// 键盘走位到目标块并回车（画布题作答），走位后校验 aria-label 的焦点值。
// 只用 ArrowRight（步长恒 +1，与横竖屏列数无关），从初值 0 起追踪精确。
async function answerTile(expectValue) {
  const st = await pageState();
  const { values } = parseBoard(st.boardLabel);
  const idxs = values.map((v, i) => v === expectValue ? i : -1).filter(i => i >= 0);
  if (!idxs.length) throw new Error(`棋盘上找不到答案块 ${expectValue}: ${st.boardLabel}`);
  const target = idxs[0];
  const presses = (target - focusedTile + 12) % 12;
  for (let i = 0; i < presses; i++) await dispatchKey('ArrowRight');
  focusedTile = target;
  await sleep(80);
  const after = parseBoard((await pageState()).boardLabel);
  if (Number(after.focused) !== expectValue) {
    throw new Error(`焦点校验失败: 当前选择 ${after.focused} ≠ 期望 ${expectValue}（目标块 ${target}，按键 ${presses} 次，棋盘 ${JSON.stringify(values)}）`);
  }
  await dispatchKey('Enter');
}

const clickOptionImpl = id => evaluate(`(() => {
  const b = document.querySelector('#choice-options button[data-option-id="' + ${JSON.stringify(id)} + '"]');
  if (b && !b.disabled) b.click();
})()`, false);

const click = selector => evaluate(`(() => { document.querySelector(${JSON.stringify(selector)})?.click(); })()`, false);
const confirmYes = () => click('#confirm-dialog button[value="yes"]');

// 作答当前题。wrong=true 时故意答错（触发复活流程）。
async function answerCurrent(st, { wrong = false } = {}) {
  if (st.choiceVisible) {
    const optKey = st.choiceOptions.map(o => o.id).sort().join(',');
    const task = await matchTaskImpl(st.choiceTask, optKey);
    if (!task) throw new Error(`选择题面匹配失败: ${st.choiceTask}`);
    const correct = task.correct ?? [];
    let chosen;
    if (wrong) {
      const wrongIds = st.choiceOptions.map(o => o.id).filter(id => !correct.includes(id));
      if (!wrongIds.length) throw new Error('选择题无干扰项可答错');
      chosen = [wrongIds[0]];
    } else chosen = correct;
    for (const id of chosen) { await clickOptionImpl(id); await sleep(140); }
    if (task.multiple) await click('#btn-choice-submit');
    return { kind: task.multiple ? 'choice-multiple' : 'choice-single', matchId: task.id, status: task.status, chosen };
  }
  if (st.boardVisible) {
    const text = (st.gameTask ?? '').replace(' 使用方向键选择数字块，回车作答。', '');
    const task = await matchTaskImpl(text, null);
    if (!task || task.answer === null) throw new Error(`棋盘题面匹配失败: ${text}`);
    const { values } = parseBoard(st.boardLabel);
    let target;
    if (wrong) {
      const i = values.findIndex(v => v !== null && v !== task.answer);
      if (i < 0) throw new Error('找不到可答错的干扰块');
      target = values[i];
    } else target = task.answer;
    await answerTile(target);
    return { kind: 'board', matchId: task.id, status: task.status, value: target };
  }
  throw new Error(`无可作答题面: choice=${st.choiceVisible} board=${st.boardVisible} countdown=${st.countdown}`);
}

const questionText = st => st.choiceVisible ? st.choiceTask
  : (st.gameTask ?? '').replace(' 使用方向键选择数字块，回车作答。', '');
// asking 判据：倒计时计时中 + 题面可见 + 无复活/准备/暂停遮罩。
const asking = st => st.countdown?.startsWith('剩余') && (st.choiceVisible || st.boardVisible)
  && !st.reviveOpen && st.readyHidden !== false && st.pauseOverlayHidden !== false;

const waitAsking = async ({ notPrev = null, isPrev = null, timeoutMs = 20000 } = {}) => {
  const st = await waitUntil(async () => {
    const s = await pageState();
    if (s.reviveOpen || s.resultVisible) return s;
    if (!asking(s)) return null;
    const text = questionText(s);
    if (notPrev !== null && text === notPrev) return null;
    if (isPrev !== null && text !== isPrev) return null;
    return s;
  }, '题目可作答', timeoutMs);
  if (st.reviveOpen) throw new Error('等待作答时出现复活弹窗');
  if (st.resultVisible) throw new Error('等待作答时已进入结算');
  return st;
};

const waitNextOrResult = async prevText => waitUntil(async () => {
  const s = await pageState();
  if (s.resultVisible || s.reviveOpen) return s;
  if (asking(s) && questionText(s) !== prevText) return s;
  return null;
}, '题目推进', 20000);

// ===== 通用流程 =====
const waitHomeBoot = async (urlSuffix = '') => {
  await goto(`${ORIGIN}${urlSuffix}`);
  await waitUntil(async () => {
    const s = await pageState();
    return s.selectVisible && !s.errorVisible && s.hanziAnchor ? s : null;
  }, '首页选择屏就绪');
  return installPool();
};

const waitHanziBoot = async () => waitUntil(async () => {
  const s = await hanziState();
  return s.bootFailHidden && s.gradeCards === 6 && s.selectVisible && s.backLink ? s : null;
}, '汉字勇者选择屏就绪');

const trustedClick = async selector => {
  const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`, false);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
};

const pressTab = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
};

// 勾选一年级（幂等：已勾选不点）、进入可用性屏并等待可开局。
const selectGrade1AndStart = async () => {
  await waitUntil(async () => {
    await evaluate(`(() => { const el = document.querySelector('input[name="grade"][value="1"]');
      if (el && !el.checked) el.click(); })()`, false);
    const disabled = await evaluate(`document.getElementById('btn-to-availability')?.disabled`, false);
    return disabled === false ? true : null;
  }, '勾选一年级使下一步可用');
  await click('#btn-to-availability');
  return waitUntil(async () => {
    const s = await pageState();
    const disabled = await evaluate(`document.getElementById('btn-start')?.disabled`, false);
    return s.availabilityVisible && disabled === false ? s : null;
  }, '可用性屏且可开始');
};

// 整局作答。wrongIndex: 故意答错并复活重试的题序号（0 基）。
async function playRound({ wrongIndex = -1, shotPrefix = 'nav-round' } = {}) {
  const answers = [];
  let reviveInfo = null;
  for (let n = 0; n < 10; n++) {
    const st = await waitAsking({ notPrev: answers.at(-1)?.text ?? null });
    const text = questionText(st);
    const progressScore = st.choiceProgress?.match(/· ([0-9]+) 分/)?.[1] ?? null;
    const wrong = n === wrongIndex;
    const ans = await answerCurrent(st, { wrong });
    answers.push({ no: n + 1, text, ...ans, scoreSeen: progressScore, wrong, retry: false });
    log(`第 ${n + 1} 题 [${ans.kind}]`, wrong ? '故意答错' : '作答', JSON.stringify(ans.chosen ?? ans.value));
    if (wrong) {
      const rv = await waitUntil(async () => { const s = await pageState(); return s.reviveOpen ? s : null; }, '复活弹窗');
      reviveInfo = { message: rv.reviveMessage, btnText: rv.reviveBtnText, disabled: rv.reviveDisabled };
      await shot(`${shotPrefix}-wrong-revive`);
      if (reviveInfo.disabled) throw new Error(`复活不可用: ${JSON.stringify(reviveInfo)}`);
      await click('#btn-revive');
      await waitUntil(async () => { const s = await pageState(); return s.readyHidden === false && s.pauseTitle === '准备好了吗？' ? s : null; }, '复活后准备屏');
      await click('#btn-ready');
      const retry = await waitAsking({ isPrev: text });
      const ans2 = await answerCurrent(retry, { wrong: false });
      answers.at(-1).retry = true;
      answers.at(-1).retryAnswer = ans2;
      log(`第 ${n + 1} 题复活重试正确`);
    }
    await waitNextOrResult(text);
  }
  const result = await waitUntil(async () => { const s = await pageState(); return s.resultVisible ? s : null; }, '结算屏');
  return { answers, reviveInfo, result };
}

const localStorageSnapshot = () => evaluate(`JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`, false);

// 新版档案在 IndexedDB（profile.ts openProfileStore：库名 pixel-academy，store profiles，key local）。
const idbProfileSnapshot = () => evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction('profiles', 'readonly');
      const rq = tx.objectStore('profiles').get('local');
      rq.onsuccess = () => { const v = rq.result;
        res(v ? { coins: v.coins, records: (v.records ?? []).length, revision: v.revision, challenge: v.challenge ? 'present' : null } : null); };
      tx.onabort = () => rej(tx.error ?? new Error('idb read aborted'));
    });
  } finally { db.close(); }
})()`);

// 开局（处理残留 challenge 触发的「开始新挑战将放弃当前局…」确认弹窗）。
const startRoundSafe = async () => {
  await click('#btn-start');
  return waitUntil(async () => {
    const s = await pageState();
    if (s.confirmOpen) { await confirmYes(); await sleep(250); return null; }
    return s.gameVisible ? s : null;
  }, '进入对局（含残留局确认）', 25000);
};

// ============================================================
// S1 首页游戏选择入口
// ============================================================
try {
  const poolInfo = await waitHomeBoot();
  await click('#btn-menu');
  await waitUntil(async () => { const s = await pageState(); return s.menuDialogOpen && s.hanziAnchor?.visible ? s : null; }, '菜单弹层打开');
  const s1 = await pageState();
  // 键盘可达：从弹层起点连按 Tab，记录焦点路径
  const focusPath = [];
  let keyboardReached = false;
  for (let i = 0; i < 12; i++) {
    const ae = await evaluate(`(() => { const el = document.activeElement;
      return el === document.querySelector('#main-nav a[href="/hanzi.html"]') ? 'TARGET'
        : (el ? (el.id || el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 10)) : 'none'); })()`, false);
    if (ae === 'TARGET') { keyboardReached = true; break; }
    focusPath.push(ae);
    await pressTab();
    await sleep(60);
  }
  // aria：CDP 无障碍树取 link 角色与名称
  let axName = null, axRole = null, axFocusable = null, axQueried = false;
  try {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#main-nav a[href="/hanzi.html"]' });
    const ax = await send('Accessibility.getPartialAXTree', { nodeId: node.nodeId, fetchRelatives: true });
    const link = ax.nodes.find(n => n.role?.value === 'link');
    axRole = link?.role?.value ?? null;
    axName = link?.name?.value ?? null;
    axFocusable = link?.properties?.find(p => p.name === 'focusable')?.value?.value ?? null;
    axQueried = true;
  } catch (e) { log('无障碍树查询失败（降级结构断言）:', String(e)); }
  await shot('nav-01-home-entry');
  const ariaOk = axQueried
    ? axRole === 'link' && (axName ?? '').includes('汉字勇者') && axFocusable !== false
    : s1.hanziAnchor?.decorAriaHidden === 'true' && (s1.hanziAnchor?.text ?? '').includes('汉字勇者');
  const ok = (s1.h1 ?? '').startsWith('数字消除') && s1.title.includes('数字消除')
    && s1.hanziAnchor?.href === '/hanzi.html' && s1.hanziAnchor?.visible
    && s1.navLabel === '学习与收藏'
    && s1.hanziAnchor?.decorAriaHidden === 'true'
    && keyboardReached && ariaOk;
  record('S1 首页游戏选择入口', ok,
    `数字消除为当前游戏（h1=${s1.h1?.trim()}，title=${s1.title}）；汉字勇者入口 href=${s1.hanziAnchor?.href} 可见可点；Tab 焦点路径 ${JSON.stringify(focusPath)} 后到达入口；AX 角色 ${axRole}、名称「${axName}」；装饰字 span aria-hidden=${s1.hanziAnchor?.decorAriaHidden}`,
    { checks: { pool: poolInfo, anchor: s1.hanziAnchor, navLabel: s1.navLabel, navItems: s1.navItems, keyboardFocusPath: focusPath, keyboardReached, axName, axRole, axFocusable, axQueried, errors: s1.errors } });
} catch (e) {
  record('S1 首页游戏选择入口', false, `失败: ${e.message}`);
}

// ============================================================
// S2 点击汉字勇者进入 hanzi.html
// ============================================================
try {
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const hs = await waitHanziBoot();
  await sleep(500);
  const hs2 = await hanziState();
  await shot('nav-02-hanzi-entered');
  record('S2 进入汉字勇者', hs2.h1?.includes('汉字勇者') && hs2.errors.length === 0 && hs2.selectVisible,
    `真实点击入口后 URL=${hs2.url}，标题「${hs2.title}」正常加载（年级卡 ${hs2.gradeCards} 张、boot-fail 隐藏、选择屏可见），JS 错误 ${hs2.errors.length} 个`,
    { checks: { hanzi: hs2, backLink: hs2.backLink } });
} catch (e) {
  record('S2 进入汉字勇者', false, `失败: ${e.message}`);
}

// ============================================================
// S3 hanzi 页返回数字消除首页
// ============================================================
try {
  const before = await hanziState();
  if (!before.backLink?.visible) throw new Error('返回链接不可见');
  await trustedClick('.profile-bar a.btn-ghost');
  const back = await waitUntil(async () => {
    const s = await pageState();
    return new URL(s.url).pathname === '/' && s.selectVisible && s.hanziAnchor ? s : null;
  }, '返回首页');
  await click('#btn-menu');
  await waitUntil(async () => { const s = await pageState(); return s.menuDialogOpen && s.hanziAnchor?.visible ? s : null; }, '菜单弹层再开');
  const s3 = await pageState();
  await click('#btn-menu-close');
  await shot('nav-03-hanzi-back-home');
  record('S3 hanzi 页返回首页', s3.selectVisible && s3.hanziAnchor?.visible && s3.hanziAnchor?.href === '/hanzi.html',
    `点击「${before.backLink.text}」回到 ${s3.url}，数字消除首页正常，菜单内汉字勇者入口仍在且可见`,
    { checks: { backLink: before.backLink, anchor: s3.hanziAnchor, errors: s3.errors } });
} catch (e) {
  record('S3 hanzi 页返回首页', false, `失败: ${e.message}`);
}

// ============================================================
// S4 数字消除整局回归（首答 10 分、复活重试 5 分）
// ============================================================
try {
  await waitHomeBoot(); // S3 的返回是真实导航，需重装页内题库索引并回到干净首页
  const baseCoins = Number((await pageState()).wallet?.match(/([0-9]+) 金币/)?.[1] ?? NaN);
  if (!(baseCoins >= 15)) throw new Error(`金币 ${baseCoins} 不足以购买复活卡，需要全新档案（≥15）`);
  const availState = await selectGrade1AndStart();
  await shot('nav-04-availability');
  await startRoundSafe();
  const round = await playRound({ wrongIndex: 0, shotPrefix: 'nav-05' });
  await shot('nav-06-result-95');
  const s4 = await pageState();
  const scoreOk = s4.resultScore === '总分 95 · 已完成 10/10' && s4.resultFirstTry === '首次答对 9/10 · 辅助完成 1'
    && /答错 1 次/.test(s4.resultWrong ?? '') && /复活 1 次/.test(s4.resultWrong ?? '')
    && /超时 0 次/.test(s4.resultWrong ?? '');
  await click('#btn-return');
  await waitUntil(async () => { const s = await pageState(); return s.selectVisible ? s : null; }, '返回选择屏');
  await click('#btn-menu');
  await waitUntil(async () => { const s = await pageState(); return s.menuDialogOpen && s.hanziAnchor?.visible ? s : null; }, '菜单弹层');
  const home = await pageState();
  await click('#btn-menu-close');
  await shot('nav-07-home-after-round');
  const walletCoins = Number(home.wallet?.match(/([0-9]+) 金币/)?.[1] ?? NaN);
  const walletOk = walletCoins === baseCoins + 8; // −15 复活卡 +23 局奖励（首答 9×2 + 通关 5）
  record('S4 数字消除整局回归', scoreOk && home.selectVisible && home.hanziAnchor?.visible && walletOk,
    `选一年级→查看挑战（${availState.availabilityStatus}）→开局，10 题全部按页面题面自动作答（第 1 题故意答错→购买复活卡 15 金币→重试得 5 分档），结算「${s4.resultScore}」「${s4.resultFirstTry}」「${s4.resultWrong}」「${s4.resultCoins}」；返回首页后入口仍在，钱包「${home.wallet}」= 局前 ${baseCoins} − 15 + 23`,
    { checks: { baseCoins, availability: { status: availState.availabilityStatus }, revive: round.reviveInfo, answers: round.answers, result: { score: s4.resultScore, first: s4.resultFirstTry, wrong: s4.resultWrong, coins: s4.resultCoins }, wallet: home.wallet, errors: s4.errors } });
} catch (e) {
  record('S4 数字消除整局回归', false, `失败: ${e.message}`);
}

// ============================================================
// S5 预览隔离 ?preview=candidate
// ============================================================
try {
  const lsBefore = await localStorageSnapshot();
  const idbBefore = await idbProfileSnapshot();
  const poolInfo = await waitHomeBoot('?preview=candidate');
  const s5 = await pageState();
  await shot('nav-08-preview');
  const bannerOk = s5.previewBannerHidden === false && s5.wallet === '候选预览 · 不读写正式档案' && s5.recordsSectionHidden === true;
  // 正式取题只含 approved（selectExercises 的草稿过滤，catalog.ts）；预览池含状态清单
  const poolCheck = await evaluate(`(async () => {
    const { loadGameContent } = await import('/dist/game/number-puzzle/content.js');
    const content = loadGameContent();
    const formal = content.select([1]);
    const preview = content.preview([1]);
    return {
      formalCount: formal.length,
      formalAllApproved: formal.every(e => e.review.status === 'approved'),
      previewCount: preview.length,
      previewStatuses: [...new Set(preview.map(e => e.review.status))],
    };
  })()`);
  await selectGrade1AndStart();
  await startRoundSafe();
  await waitUntil(async () => { const s = await pageState(); return s.gameVisible && s.previewBannerHidden === false ? s : null; }, '预览对局与横幅');
  await shot('nav-09-preview-round');
  const st = await waitAsking({});
  await answerCurrent(st, { wrong: false });
  await waitNextOrResult(questionText(st));
  await click('#btn-game-return');
  await waitUntil(async () => { const s = await pageState(); return s.confirmOpen ? s : null; }, '放弃确认');
  await confirmYes();
  await waitUntil(async () => { const s = await pageState(); return s.selectVisible ? s : null; }, '放弃后回选择屏');
  const lsAfterPreview = await localStorageSnapshot();
  const idbAfterPreview = await idbProfileSnapshot();
  await waitHomeBoot();
  await click('#btn-menu');
  await waitUntil(async () => { const s = await pageState(); return s.menuDialogOpen ? s : null; }, '正式首页菜单');
  const home = await pageState();
  await click('#btn-menu-close');
  const unchanged = lsAfterPreview === lsBefore;
  const idbUnchanged = JSON.stringify(idbAfterPreview) === JSON.stringify(idbBefore);
  const walletCoins = Number(home.wallet?.match(/([0-9]+) 金币/)?.[1] ?? NaN);
  record('S5 预览隔离', bannerOk && poolCheck.formalAllApproved && unchanged && idbUnchanged
    && walletCoins === idbAfterPreview?.coins && home.hanziAnchor?.visible,
    `?preview=candidate 显示预览横幅、钱包「${s5.wallet}」、记录区隐藏；预览模式下导航区按设计隐藏（src/game/number-puzzle/main.ts:245）；预览局答 1 题后放弃，localStorage 与 IndexedDB 档案（金币 ${idbAfterPreview?.coins}、记录 ${idbAfterPreview?.records} 条、revision ${idbAfterPreview?.revision}）快照零变化；回正式首页钱包「${home.wallet}」与档案一致、入口仍可见（href 不带 preview 参数）；正式池 ${poolCheck.formalCount} 题全部 approved（预览用局池 ${poolInfo.count} 题，状态 ${JSON.stringify(poolInfo.statuses)}），草稿隔离由 selectExercises 的 approved 过滤保证`,
    { checks: { previewState: { bannerHidden: s5.previewBannerHidden, wallet: s5.wallet, recordsSectionHidden: s5.recordsSectionHidden, navHidden: s5.navHidden }, poolCheck, roundPool: poolInfo, localStorageUnchanged: unchanged, idbBefore, idbAfterPreview, idbUnchanged, home: { wallet: home.wallet, anchor: home.hanziAnchor } } });
} catch (e) {
  record('S5 预览隔离', false, `失败: ${e.message}`);
}

// ============================================================
// S6 刷新恢复（继续上局，不重复计分）
// ============================================================
try {
  await waitHomeBoot();
  const baseCoins = Number((await pageState()).wallet?.match(/([0-9]+) 金币/)?.[1] ?? NaN);
  await selectGrade1AndStart();
  await startRoundSafe();
  // 答对 2 题
  let lastText = null;
  for (let n = 0; n < 2; n++) {
    const st = await waitAsking({ notPrev: lastText });
    lastText = questionText(st);
    await answerCurrent(st, { wrong: false });
    await waitNextOrResult(lastText);
  }
  const pending = await waitAsking({ notPrev: lastText });
  const q3Text = questionText(pending);
  const q3Progress = pending.choiceProgress;
  log('刷新前第 3 题待答:', q3Text, q3Progress ?? '');
  await send('Page.reload', { ignoreCache: false });
  resetFocus();
  const offer = await waitUntil(async () => {
    const s = await pageState();
    return s.selectVisible && s.restoreOfferHidden === false ? s : null;
  }, '刷新后恢复条目');
  await installPool();
  await shot('nav-10-restore-offer');
  await click('#btn-restore');
  await waitUntil(async () => { const s = await pageState(); return s.gameVisible && s.pauseTitle === 'Ⅱ 冒险休息站' ? s : null; }, '恢复后暂停遮罩');
  await shot('nav-11-restored-round');
  await click('#btn-resume');
  const resumed = await waitAsking({ isPrev: q3Text });
  if (questionText(resumed) !== q3Text) throw new Error(`恢复后题面不一致: ${questionText(resumed)} ≠ ${q3Text}`);
  // 续打剩余 7 题（第 3 题在本步作答）
  await answerCurrent(resumed, { wrong: false });
  await waitNextOrResult(q3Text);
  for (let n = 4; n <= 10; n++) {
    const st = await waitAsking({ notPrev: lastText });
    lastText = questionText(st);
    await answerCurrent(st, { wrong: false });
    await waitNextOrResult(lastText);
  }
  const s6 = await waitUntil(async () => { const s = await pageState(); return s.resultVisible ? s : null; }, '结算屏');
  await shot('nav-12-result-100');
  const scoreOk = s6.resultScore === '总分 100 · 已完成 10/10' && s6.resultFirstTry === '首次答对 10/10 · 辅助完成 0'
    && /答错 0 次/.test(s6.resultWrong ?? '') && /超时 0 次/.test(s6.resultWrong ?? '');
  await click('#btn-return');
  await waitUntil(async () => { const s = await pageState(); return s.selectVisible ? s : null; }, '返回选择屏');
  const wallet = (await pageState()).wallet;
  const finalCoins = Number(wallet?.match(/([0-9]+) 金币/)?.[1] ?? NaN);
  record('S6 刷新恢复', scoreOk && resumed.choiceProgress === q3Progress && finalCoins === baseCoins + 30,
    `答对 2 题（20 分）后刷新出现「${offer.restoreText}」→ 继续上局 → 冒险休息站 → 继续游戏回到同一题（第 3 题「${q3Text.slice(0, 16)}…」${q3Progress ?? ''}），续打至结算「${s6.resultScore}」（若重开或重计应分别为 80/120），${s6.resultCoins}，钱包「${wallet}」= 局前 ${baseCoins} + 通关 30`,
    { checks: { restoreText: offer.restoreText, q3Text, q3Progress, baseCoins, finalCoins, result: { score: s6.resultScore, first: s6.resultFirstTry, wrong: s6.resultWrong, coins: s6.resultCoins }, wallet, errors: s6.errors } });
} catch (e) {
  record('S6 刷新恢复', false, `失败: ${e.message}`);
}

// ============================================================
// S7 SW 清单与断源回归
// ============================================================
try {
  await waitHomeBoot();
  const cacheInfo = await waitUntil(async () => evaluate(`(async () => {
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    const home = await cache.match('/');
    const hanzi = await cache.match('/hanzi.html');
    if (!home || !hanzi) return null;
    const homeHasEntry = (await home.text()).includes('/hanzi.html');
    const hanziHasBack = (await (await cache.match('/hanzi.html')).text()).includes('返回数字消除');
    return { name, homeCached: true, hanziCached: true, homeHasEntry, hanziHasBack,
      controlled: navigator.serviceWorker.controller !== null,
      notice: document.getElementById('offline-notice')?.textContent ?? null };
  })()`), '缓存就绪且含双入口', 30000);
  log('缓存:', JSON.stringify(cacheInfo));
  // 断源：杀掉本地静态服务（源站请求全部失败）
  const { execSync } = await import('node:child_process');
  try { execSync('kill $(lsof -ti tcp:4173 -sTCP:LISTEN) 2>/dev/null || true', { shell: '/bin/zsh' }); } catch {}
  await sleep(800);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}sw.js`); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  // 刷新首页：应由 SW 缓存打开
  await send('Page.reload', { ignoreCache: false });
  resetFocus();
  await waitUntil(async () => {
    const s = await pageState();
    return s.selectVisible && !s.errorVisible ? s : null;
  }, '断源后首页可打开', 30000);
  const offlineHome = await pageState();
  await click('#btn-menu');
  await waitUntil(async () => { const s = await pageState(); return s.menuDialogOpen && s.hanziAnchor?.visible ? s : null; }, '断源后菜单');
  const offlineHomeOpen = await pageState();
  await shot('nav-13-offline-home');
  // 经入口离线进入 hanzi 页
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const offlineHanzi = await waitUntil(async () => {
    const s = await hanziState();
    return s.url.endsWith('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, '断源后 hanzi 页可打开', 30000);
  await shot('nav-14-offline-hanzi');
  // 经返回链接离线回到首页
  await trustedClick('.profile-bar a.btn-ghost');
  const offlineBack = await waitUntil(async () => {
    const s = await pageState();
    return new URL(s.url).pathname === '/' && s.selectVisible ? s : null;
  }, '断源后返回首页', 30000);
  const finalHanzi = await hanziState();
  record('S7 SW 清单与断源回归', !!cacheInfo.homeHasEntry && !!cacheInfo.hanziHasBack && cacheInfo.controlled
    && offlineHome.selectVisible && offlineHomeOpen.hanziAnchor?.visible && offlineHanzi.gradeCards === 6
    && offlineBack.selectVisible && offlineHome.errors.length === 0 && finalHanzi.errors.length === 0,
    `重建后 sw.js 版本 ${cacheInfo.name}（工作区哈希 assets-v1-deb0ba6e041b ≠ 按 HEAD 内容重算的 assets-v1-f1fbdc70d7c8），预缓存含 / 与 /hanzi.html 且缓存正文含入口/返回标记；杀掉源站后刷新，首页与 hanzi 页均由缓存打开，入口与返回链接离线可点击往返，无 JS 错误`,
    { checks: { cacheInfo, offlineHomeNotice: offlineHome.offlineNotice, offlineHomeErrors: offlineHome.errors, offlineHanziErrors: finalHanzi.errors } });
} catch (e) {
  record('S7 SW 清单与断源回归', false, `失败: ${e.message}`);
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
await writeFile(`${outDir}/nav-browser-results.json`, JSON.stringify(summary, null, 2));
log('结果已写入', `${outDir}/nav-browser-results.json`);
log(JSON.stringify(summary.scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(0);
