// 拼音冒险（M9）桌面浏览器验收轮（独立验收员轮，只验证与记录，不改游戏代码）。
// 结构参照 docs/evidence/m12/dungeon-browser.mjs：无头 Chrome CDP 直连、真实鼠标事件
// trustedClick、键盘 Tab、evaluate 读取页面状态、error/unhandledrejection 注入收集、
// Page.reload 刷新恢复、杀源站进程断源、Fetch 域拦截 *.wav 触发音频不可用。
// 听辨答案从页面题面 data-exercise-id 经 dist 判题模块（/dist/game/pinyin-adventure/content.js
// 的 selectPinyinExercises + /dist/learning/pinyin.js 的 correctPinyinAnswer）自算，
// 不注入任何游戏状态。音频断言用状态机（Audio canplay/playing/error 事件、currentTime、
// Network 响应 200 / CacheStorage 命中），headless 无声输出不依赖真实声音。
// 覆盖 P1–P10：P1 首页菜单四入口 → P2 进入 pinyin.html → P3 年级筛选 →
// P4 完整局（听辨防泄露 + 可重复播放 + 再试一次重试档 + 记录/金币）→
// P5 音频不可用降级（拦截 wav → 提示 + 跳过不计分）→ P6 暂停/恢复 →
// P7 刷新恢复 → P8 三游戏回归 → P9 SW 四入口与断源听辨 →
// P10 贯穿（每场景记横向溢出与 JS 错误，末尾汇总）。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9742';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m9';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[pinyin]', ...a);
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
// Fetch 域事件处理：P5 用 requestPaused → failRequest 模拟音频资源不可达。
let fetchFailArmed = false;
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Fetch.requestPaused') {
    if (fetchFailArmed) {
      ws.send(JSON.stringify({ id: ++seq, method: 'Fetch.failRequest', params: { requestId: m.params.requestId, errorReason: 'Failed' } }));
    } else {
      ws.send(JSON.stringify({ id: ++seq, method: 'Fetch.continueRequest', params: { requestId: m.params.requestId } }));
    }
    return;
  }
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
  window.__audioLog=[];
  (function(){ var Orig = window.Audio; if (!Orig) return;
    window.Audio = function(url){ var a = new Orig(url);
      var rec = { url: String(url), t0: Date.now(), events: [], currentTimeAtPlaying: null, errorDetail: null };
      window.__audioLog.push(rec);
      a.addEventListener('canplay', function(){ rec.events.push({ ev:'canplay', t: Date.now() }); });
      a.addEventListener('playing', function(){ rec.events.push({ ev:'playing', t: Date.now() }); rec.currentTimeAtPlaying = a.currentTime; });
      a.addEventListener('error', function(){ rec.events.push({ ev:'error', t: Date.now() }); rec.errorDetail = a.error ? (a.error.code + ':' + (a.error.message||'')) : 'unknown'; });
      return a; };
    window.Audio.prototype = Orig.prototype;
  })();
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
    h1: document.querySelector('main h1, main .app-title')?.textContent ?? null,
    selectVisible: !document.getElementById('screen-select')?.hidden,
    errorVisible: !document.getElementById('screen-error')?.hidden,
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    navLabel: document.getElementById('main-nav')?.getAttribute('aria-label') ?? null,
    navItems: [...(document.getElementById('main-nav')?.children ?? [])].map(el => ({ tag: el.tagName, text: el.textContent.trim().replace(/[\\s]+/g, ' ') })),
    hanziAnchor: anchor('#main-nav a[href="/hanzi.html"]'),
    dungeonAnchor: anchor('#main-nav a[href="/dungeon.html"]'),
    pinyinAnchor: anchor('#main-nav a[href="/pinyin.html"]'),
    wallet: document.getElementById('wallet')?.textContent ?? null,
    gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
    btnToAvailabilityDisabled: document.getElementById('btn-to-availability')?.disabled,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 拼音冒险状态 =====
const pinyinState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null;
  try { const raw = localStorage.getItem('pixel-academy:pinyin-adventure:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  let recordsRaw = null;
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:pinyin-adventure:v1:records') ?? 'null'); } catch {}
  let recentIds = null;
  try { recentIds = JSON.parse(localStorage.getItem('pixel-academy:pinyin-adventure:v1:recent-ids') ?? 'null'); } catch {}
  let settingsRaw = null;
  try { settingsRaw = JSON.parse(localStorage.getItem('pixel-academy:pinyin-adventure:v1:settings') ?? 'null'); } catch {}
  // 听辨防泄露扫描：可见题面区域（除候选按钮外）不应出现任何拉丁字母/ü。
  const card = document.getElementById('question-card');
  let leakScan = null;
  if (card && !card.hidden) {
    const clone = card.cloneNode(true);
    clone.querySelectorAll('#options button').forEach(b => b.remove());
    leakScan = (clone.textContent || '').replace(/[\\s]+/g, ' ').trim();
    leakScan = { text: leakScan, hasLatin: /[a-zü]/i.test(leakScan) };
  }
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
    hudProgress: t('hud-progress'), hudScore: t('hud-score'),
    pausePressed: document.getElementById('btn-pause')?.getAttribute('aria-pressed'),
    questionVisible: !hidden('question-card'),
    qTitle: t('q-title'),
    countdown: t('countdown'),
    prompt: t('q-prompt'),
    promptExerciseId: document.getElementById('q-prompt')?.dataset.exerciseId ?? null,
    playGroupHidden: hidden('play-group'),
    btnPlayDisabled: document.getElementById('btn-play')?.disabled,
    btnPlayText: t('btn-play'),
    audioNoticeHidden: hidden('audio-notice'),
    audioNoticeText: t('audio-notice'),
    playStatus: t('play-status'),
    optionButtons: [...document.querySelectorAll('#options button')].map(b => ({
      text: b.textContent, disabled: b.disabled })),
    feedbackHidden: hidden('feedback'),
    feedback: t('feedback'),
    retryHidden: hidden('btn-retry-attempt'),
    skipHidden: hidden('btn-skip'),
    pauseOverlayHidden: hidden('pause-overlay'),
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    confirmText: t('confirm-text'),
    resultScore: t('result-score'),
    resultAnswer: t('result-answer'),
    resultModes: t('result-modes'),
    leakScan, snap, recordsRaw, recentIds, settingsRaw,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 汉字勇者 / 地下城状态（P8/P9 回归） =====
const hanziState = () => evaluate(`(() => ({
  url: location.href, title: document.title,
  h1: document.querySelector('.app-title')?.textContent ?? null,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
    return a ? { href: a.getAttribute('href'), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
  selectVisible: !document.getElementById('screen-select')?.hidden,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);
const dungeonState = () => evaluate(`(() => ({
  url: location.href, title: document.title,
  h1: document.querySelector('main h1')?.textContent ?? null,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('#grade-grid button').length,
  backLink: (() => { const a = document.querySelector('.profile-bar a.btn-ghost');
    return a ? { href: a.getAttribute('href'), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
  selectVisible: !document.getElementById('screen-select')?.hidden,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);

// ===== 题库池安装：题面 exerciseId → dist 判题模块自算 =====
const installPinyinPool = () => evaluate(`(async () => {
  const { selectPinyinExercises } = await import('/dist/game/pinyin-adventure/content.js');
  const { correctPinyinAnswer } = await import('/dist/learning/pinyin.js');
  const picked = selectPinyinExercises([1]);
  const map = {};
  for (const e of picked) {
    map[e.id] = { id: e.id, status: e.review.status, kind: e.task.kind, letter: null,
      options: [...e.task.options], audio: e.task.audio ?? null, prompt: e.task.prompt,
      answer: correctPinyinAnswer(e.task) };
  }
  window.__pool = map;
  const kinds = picked.reduce((acc, e) => { acc[e.task.kind] = (acc[e.task.kind] ?? 0) + 1; return acc; }, {});
  return { count: picked.length, kinds, statuses: [...new Set(picked.map(e => e.review.status))] };
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
const parseCountdown = text => {
  const m = (text ?? '').match(/剩余 ([0-9.]+) 秒/);
  return m ? Number(m[1]) : null;
};

const waitQuestion = (index, desc = `第 ${index + 1} 题可作答`) => waitUntil(async () => {
  const s = await pinyinState();
  if (!s.gameVisible || !s.questionVisible) return null;
  if (s.hudProgress !== `第 ${index + 1}/5 题`) return null;
  if (!(s.countdown ?? '').startsWith('剩余')) return null;
  if (!s.optionButtons.length || s.optionButtons.some(b => b.disabled)) return null;
  return s;
}, desc);

const waitRetryState = () => waitUntil(async () => {
  const s = await pinyinState();
  return s.gameVisible && s.questionVisible && s.feedbackHidden === false
    && (s.feedback ?? '').startsWith('✗') && s.retryHidden === false ? s : null;
}, '答错待再试状态');

const waitResult = () => waitUntil(async () => {
  const s = await pinyinState();
  return s.resultVisible ? s : null;
}, '结算屏');

const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click(); })()`, false);
  const s = await pinyinState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want ? s : null;
}, `勾选年级 ${name}`);

// 点击某个候选（按文本找按钮，真实鼠标事件）。
const clickOption = async text => {
  const idx = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('#options button')];
    const i = btns.findIndex(b => b.textContent === ${JSON.stringify(text)});
    if (i < 0) throw new Error('候选未找到: ' + ${JSON.stringify(text)} + '；现有: ' + btns.map(b => b.textContent).join(','));
    return i;
  })()`, false);
  await trustedClick(`#options button:nth-of-type(${idx + 1})`);
  return idx;
};

// 播放一次听辨音频：真实点击播放钮 → 等待 Audio 实例出现 → 等待 playing（或 error）。
// 注意：waitUntil 只接受 truthy 返回值，实例索引 0 须包成对象返回。
const playAudio = async () => {
  const before = await evaluate('window.__audioLog?.length ?? -1', false);
  await trustedClick('#btn-play');
  let idx = null;
  try {
    idx = await waitUntil(async () => {
      const n = await evaluate('window.__audioLog?.length ?? -1', false);
      return n > before ? { idx: n - 1 } : null;
    }, 'Audio 实例创建', 6000).then(v => v.idx);
  } catch (e) {
    const diag = await evaluate(`(() => ({
      before: ${JSON.stringify(before)},
      logExists: Array.isArray(window.__audioLog), logLen: window.__audioLog?.length ?? null,
      log: (window.__audioLog ?? []).map(r => ({ url: r.url, events: r.events.map(x => x.ev) })),
      btnDisabled: document.getElementById('btn-play')?.disabled, btnText: document.getElementById('btn-play')?.textContent,
      gameVisible: !document.getElementById('screen-game')?.hidden, questionVisible: !document.getElementById('question-card')?.hidden,
      playGroupHidden: document.getElementById('play-group')?.hidden,
      feedback: document.getElementById('feedback')?.textContent, feedbackHidden: document.getElementById('feedback')?.hidden,
      pausedOverlay: document.getElementById('pause-overlay')?.hidden === false,
      errors: window.__errors ?? null }))()`, false).catch(err => ({ diagError: String(err) }));
    throw new Error(`播放点击未产生 Audio 实例（诊断: ${JSON.stringify(diag)}）: ${e.message}`);
  }
  const rec = await waitUntil(async () => {
    const logArr = await evaluate(`window.__audioLog[${idx}] ? { url: window.__audioLog[${idx}].url, events: window.__audioLog[${idx}].events, currentTimeAtPlaying: window.__audioLog[${idx}].currentTimeAtPlaying, errorDetail: window.__audioLog[${idx}].errorDetail } : null`, false);
    return logArr && logArr.events.some(e => e.ev === 'playing' || e.ev === 'error') ? logArr : null;
  }, 'playing/error 事件', 6000);
  await sleep(150);
  return { idx, rec };
};

// 当前 CacheStorage 中查找音频（缓存命中证据）。
const cacheHitFor = url => evaluate(`(async () => {
  const keys = await caches.keys();
  for (const k of keys) {
    const c = await caches.open(k);
    const hit = await c.match(${JSON.stringify(url)});
    if (hit) return { cache: k, status: hit.status };
  }
  return null;
})()`);

// 听辨题作答断言包：防泄露 + 播放钮可用 + 播放事件 + 重复播放。
async function assertListenQuestion(s, ex, { doublePlay }) {
  // 防泄露：题面（除候选外）无拉丁字母；题面文本不含答案字形。
  const leakOk = s.leakScan && s.leakScan.hasLatin === false
    && !s.leakScan.text.includes(ex.answer)
    && (s.qTitle ?? '').includes('听声音选字母');
  // 播放钮可用 + 音频路径与 dist 题库一致。
  const btnOk = s.btnPlayDisabled === false && (s.btnPlayText ?? '').includes('播放声音');
  const first = await playAudio();
  const audioUrl = `${ORIGIN}${ex.audio}`;
  const urlOk = first.rec.url.endsWith(ex.audio);
  const playedOk = first.rec.events.some(e => e.ev === 'playing')
    && first.rec.events.some(e => e.ev === 'canplay')
    && typeof first.rec.currentTimeAtPlaying === 'number';
  let repeat = null;
  if (doublePlay) {
    repeat = await playAudio();
  }
  const cache = await cacheHitFor(`/audio/pinyin/${ex.audio.split('/').pop()}`);
  return { leakOk, btnOk, first, repeat, urlOk, playedOk, cache, audioUrl };
}

// 作答当前题：wrong=true 故意答错（选第一个非答案候选）。
async function answerCurrent({ wrong = false } = {}) {
  const s = await pinyinState();
  if (!s.questionVisible || !s.promptExerciseId) throw new Error('题面未打开或缺少 exerciseId');
  const ex = await poolEntry(s.promptExerciseId);
  if (ex.status !== 'approved') throw new Error(`非 approved 题 ${ex.id}: ${ex.status}`);
  const optionsOk = JSON.stringify(s.optionButtons.map(b => b.text)) === JSON.stringify(ex.options);
  const isListen = s.playGroupHidden === false;
  const want = wrong ? ex.options.find(o => o !== ex.answer) : ex.answer;
  if (!want) throw new Error('无可选项');
  await clickOption(want);
  return { id: ex.id, kind: ex.kind, isListen, prompt: ex.prompt, answer: ex.answer, picked: want, optionsOk, wrong };
}

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

// ============================================================
// P1 首页菜单四入口（三游戏锚点并存、键盘可达、aria）
// ============================================================
try {
  await goto(`${ORIGIN}`);
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible && s.hanziAnchor && s.dungeonAnchor && s.pinyinAnchor ? s : null; }, '首页选择屏就绪');
  const before = await idbProfileSnapshot();
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.pinyinAnchor?.visible ? s : null; }, '菜单弹层打开');
  const s1 = await homeState();
  // 键盘可达：从弹层起点连按 Tab，记录焦点路径直到拼音入口
  const focusPath = [];
  let keyboardReached = false;
  for (let i = 0; i < 18; i++) {
    const ae = await evaluate(`(() => { const el = document.activeElement;
      return el === document.querySelector('#main-nav a[href="/pinyin.html"]') ? 'TARGET'
        : (el === document.querySelector('#main-nav a[href="/hanzi.html"]') ? 'HANZI'
        : (el === document.querySelector('#main-nav a[href="/dungeon.html"]') ? 'DUNGEON'
        : (el ? (el.id || el.tagName.toLowerCase() + ':' + (el.textContent || '').trim().replace(/[\\s]+/g, ' ').slice(0, 10)) : 'none'))); })()`, false);
    if (ae === 'TARGET') { keyboardReached = true; break; }
    focusPath.push(ae);
    await pressTab();
    await sleep(60);
  }
  // aria：CDP 无障碍树取 link 角色与名称
  let axName = null, axRole = null, axFocusable = null, axQueried = false;
  try {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#main-nav a[href="/pinyin.html"]' });
    const ax = await send('Accessibility.getPartialAXTree', { nodeId: node.nodeId, fetchRelatives: true });
    const link = ax.nodes.find(n => n.role?.value === 'link');
    axRole = link?.role?.value ?? null;
    axName = link?.name?.value ?? null;
    axFocusable = link?.properties?.find(p => p.name === 'focusable')?.value?.value ?? null;
    axQueried = true;
  } catch (e) { log('无障碍树查询失败（降级结构断言）:', String(e)); }
  await shot('p1-01-home-menu');
  const ariaOk = axQueried
    ? axRole === 'link' && (axName ?? '').includes('拼音冒险') && axFocusable !== false
    : s1.pinyinAnchor?.decorAriaHidden === 'true' && (s1.pinyinAnchor?.text ?? '').includes('拼音冒险');
  const ok = (s1.h1 ?? '').startsWith('数字消除') && s1.title.includes('数字消除')
    && s1.pinyinAnchor?.href === '/pinyin.html' && s1.pinyinAnchor?.visible
    && (s1.pinyinAnchor?.text ?? '').includes('拼音冒险')
    && s1.pinyinAnchor?.decorAriaHidden === 'true'
    && s1.hanziAnchor?.visible && (s1.hanziAnchor?.text ?? '').includes('汉字勇者')
    && s1.dungeonAnchor?.visible && (s1.dungeonAnchor?.text ?? '').includes('算术地下城')
    && s1.navLabel === '学习与收藏'
    && keyboardReached && ariaOk && s1.errors.length === 0;
  record('P1 首页菜单四入口', ok,
    `数字消除为当前游戏（h1=${s1.h1?.trim()}）；菜单弹层（aria-label=${s1.navLabel}）内「拼音冒险」入口 href=/pinyin.html 可见（文本含描述「听声音认拼音字母」），装饰字 span aria-hidden=true；与「汉字勇者」「算术地下城」两入口并存（连同四功能按钮共 ${s1.navItems.length} 项）；Tab 焦点路径 ${JSON.stringify(focusPath)} 后到达拼音入口；AX 角色 ${axRole}、名称「${axName}」；IndexedDB 档案金币 ${before?.coins}（全新档案）、JS 错误 0`,
    { checks: { pinyinAnchor: s1.pinyinAnchor, hanziAnchor: s1.hanziAnchor, dungeonAnchor: s1.dungeonAnchor, navItems: s1.navItems, keyboardFocusPath: focusPath, keyboardReached, axName, axRole, axFocusable, axQueried, idbProfile: before, overflow: s1.overflowX, errors: s1.errors } });
} catch (e) {
  record('P1 首页菜单四入口', false, `失败: ${e.message}`);
}

// ============================================================
// P2 真实点击进入 pinyin.html
// ============================================================
try {
  await trustedClick('#main-nav a[href="/pinyin.html"]');
  const ps = await waitUntil(async () => {
    const s = await pinyinState();
    return s.url.includes('/pinyin.html') && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null;
  }, '拼音冒险选择屏就绪');
  await sleep(400);
  const s2 = await pinyinState();
  await shot('p2-01-pinyin-entered');
  record('P2 进入 pinyin.html', s2.h1?.includes('拼音冒险') && s2.title.includes('拼音冒险')
    && s2.backLink?.href === '/' && s2.backLink?.visible && s2.bootFailHidden && s2.errors.length === 0,
    `真实点击菜单入口后 URL=${s2.url}，标题「${s2.title}」正常加载：h1=${s2.h1?.trim()}、6 张年级卡、boot-fail 隐藏、存储可用提示隐藏=${s2.storageNoticeHidden}、「返回数字消除」锚点（href=${s2.backLink?.href}）可见，JS 错误 ${s2.errors.length} 个`,
    { checks: { backLink: s2.backLink, gradeCards: s2.gradeCards, restoreOfferHidden: s2.restoreOfferHidden, overflow: s2.overflowX, errors: s2.errors } });
} catch (e) {
  record('P2 进入 pinyin.html', false, `失败: ${e.message}`);
}

// ============================================================
// P3 年级筛选（一年级 94 题可用、二~六年级不可用不混入）
// ============================================================
try {
  const counts = await evaluate(`(async () => {
    const { selectPinyinExercises, describeAvailability } = await import('/dist/game/pinyin-adventure/content.js');
    const per = {};
    for (const g of [1,2,3,4,5,6]) {
      const picked = selectPinyinExercises([g]);
      per[g] = { total: picked.length, listen: picked.filter(e => e.task.kind === 'pinyin-listen').length };
    }
    return { per, descG2: describeAvailability([2]) };
  })()`);
  const poolInfo = await installPinyinPool();
  const s0 = await pinyinState();
  const startDisabledBefore = s0.startDisabled;
  await toggleGrade('一年级', true);
  const g1 = await pinyinState();
  const expectG1 = `本局题库：一年级 ${counts.per[1].total} 道，共 ${counts.per[1].total} 道`;
  // 未开放年级：禁用置灰，点击无效（不混入其他年级内容）
  const clickG2 = await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === '二年级'); b.click(); return b.disabled; })()`, false);
  const g2after = await pinyinState();
  const g2Card = g2after.gradeCards.find(c => c.text === '二年级');
  await shot('p3-01-grade-filter');
  const ok = poolInfo.count === 94 && poolInfo.kinds['pinyin-choose'] === 47 && poolInfo.kinds['pinyin-listen'] === 47
    && poolInfo.statuses.every(x => x === 'approved')
    && counts.per[1].total === 94 && counts.per[1].listen === 47
    && [2,3,4,5,6].every(g => counts.per[g].total === 0)
    && startDisabledBefore === true && g1.startDisabled === false
    && g1.availabilityStatus === expectG1
    && g2Card?.disabled === true && g2Card?.pressed === 'false' && clickG2 === true
    && g2after.availabilityStatus === expectG1 && g2Card?.title === '暂未开放'
    && counts.descG2.startable === false
    && g1.errors.length === 0;
  record('P3 年级筛选', ok,
    `dist 层 selectPinyinExercises([1])=${counts.per[1].total} 道（辨认 ${counts.per[1].total - counts.per[1].listen} + 听辨 ${counts.per[1].listen}，全部 approved），二~六年级各 ${[2,3,4,5,6].map(g => counts.per[g].total).join('/')} 道；UI 初始未选年级开始禁用 → 勾一年级→「${g1.availabilityStatus}」（与 dist 一致）、开始可用；二年级卡禁用置灰（disabled、title=暂未开放、点击无效，提示不变）——未开放年级不可混入；dist 层 describeAvailability([2])=「${counts.descG2.statusText}」（startable=false）；JS 错误 ${g1.errors.length} 个`,
    { checks: { poolInfo, perGrade: counts.per, descG2: counts.descG2, gradeCards: g1.gradeCards, g1Status: g1.availabilityStatus, g2Card, settings: g1.settingsRaw, overflow: g1.overflowX, errors: g1.errors } });
} catch (e) {
  record('P3 年级筛选', false, `失败: ${e.message}`);
}

// ============================================================
// P4 完整局 5 题（听辨 ≥2）：辨认点击作答 + 听辨防泄露/可重复播放 +
// 故意答错一题走「再试一次」重试档 → 结算与逐题档位吻合 → 记录与金币。
// 期望：4 题首答 +10、1 题答错后重试 +5 = 45 分、首答 4、重试 1。
// ============================================================
let p4Modes = null; // 供 P8 记录条数参考
try {
  await installPinyinPool();
  const coinsBefore = await idbProfileSnapshot();
  await click('#btn-start');
  const q1 = await waitQuestion(0, 'P4 第 1 题可作答');
  const d4RoundId = q1.snap?.roundId ?? null;
  const questions = [];   // 每题观察 { id, kind, wrong }
  const listenChecks = []; // 每道听辨题断言
  let wrongIndex = 3;     // 第 4 题故意答错
  for (let i = 0; i < 5; i++) {
    const s = await (i === 0 ? Promise.resolve(q1) : waitQuestion(i, `P4 第 ${i + 1} 题可作答`));
    const ex = await poolEntry(s.promptExerciseId);
    const isListen = s.playGroupHidden === false;
    if (isListen !== (ex.kind === 'pinyin-listen')) throw new Error(`题 ${ex.id} 渲染模式与题库不一致（playGroup=${!isListen} kind=${ex.kind}）`);
    let listenInfo = null;
    if (isListen) {
      listenInfo = await assertListenQuestion(s, ex, { doublePlay: !listenChecks.length });
      listenChecks.push({ id: ex.id, ...listenInfo, first: { url: listenInfo.first.rec.url, events: listenInfo.first.rec.events, currentTimeAtPlaying: listenInfo.first.rec.currentTimeAtPlaying }, repeat: listenInfo.repeat ? { url: listenInfo.repeat.rec.url, events: listenInfo.repeat.rec.events } : null });
      if (!listenInfo.leakOk || !listenInfo.btnOk || !listenInfo.urlOk || !listenInfo.playedOk) {
        throw new Error(`听辨断言失败 ${ex.id}: leak=${listenInfo.leakOk} btn=${listenInfo.btnOk} url=${listenInfo.urlOk} played=${listenInfo.playedOk}`);
      }
      if (listenChecks.length === 1 && !listenInfo.repeat) {
        throw new Error(`听辨重复播放失败 ${ex.id}`);
      }
      if (listenChecks.length === 1) await shot('p4-01-listen-question');
    }
    if (i === wrongIndex) await shot('p4-02-before-wrong');
    const ans = await answerCurrent({ wrong: i === wrongIndex });
    if (!ans.optionsOk) throw new Error(`题 ${ex.id} DOM 候选与题库不一致`);
    questions.push({ id: ex.id, kind: ex.kind, mode: ex.kind === 'pinyin-choose' ? 'choose' : 'listen', wrong: ans.wrong, picked: ans.picked });
    if (i === wrongIndex) {
      const retry = await waitRetryState();
      if (retry.hudScore !== '得分 30') throw new Error(`答错后扣分了: ${retry.hudScore}`);
      await shot('p4-03-wrong-retry');
      await click('#btn-retry-attempt');
      const retried = await waitQuestion(i, `P4 第 ${i + 1} 题重试后可作答`);
      if (parseCountdown(retried.countdown) === null || parseCountdown(retried.countdown) < 9) throw new Error(`重试未重开计时: ${retried.countdown}`);
      const ans2 = await answerCurrent({ wrong: false });
      if (ans2.picked !== ans2.answer) throw new Error('重试答案异常');
      questions[questions.length - 1].retryGained = 5;
    } else {
      const fb = await waitUntil(async () => { const st = await pinyinState(); return st.feedbackHidden === false && (st.feedback ?? '').startsWith('✓') ? st.feedback : null; }, '答对反馈');
      if (!fb.includes('+10')) throw new Error(`首答加分异常: ${fb}`);
    }
    if (i < 4) await waitUntil(async () => { const st = await pinyinState(); return st.hudProgress === `第 ${i + 2}/5 题` ? st : null; }, `推进到第 ${i + 2} 题`);
  }
  const result = await waitResult();
  await shot('p4-04-result');
  const s4 = await pinyinState();
  const chooseCount = questions.filter(q => q.mode === 'choose').length;
  const listenCount = questions.filter(q => q.mode === 'listen').length;
  const chooseFirst = questions.filter(q => q.mode === 'choose' && !q.wrong).length;
  const listenFirst = questions.filter(q => q.mode === 'listen' && !q.wrong).length;
  const expectScore = 4 * 10 + 5;
  const expectModes = `辨认 ${chooseFirst}/${chooseCount} 题首答 · 听辨 ${listenFirst}/${listenCount} 题首答`;
  p4Modes = { chooseCount, listenCount };
  if (listenCount < 2) throw new Error(`听辨题不足 2 道: ${listenCount}`);
  // 记录与档案
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await pinyinState(); return s.selectVisible ? s : null; }, '返回选择屏');
  const rec = await pinyinState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === d4RoundId) ?? null;
  const recordOk = recRaw && recRaw.gameId === 'pinyin-adventure' && recRaw.score === expectScore
    && recRaw.answer?.questions?.length === 5
    && JSON.stringify(recRaw.answer.questions.map(q => q.mode)) === JSON.stringify(questions.map(q => q.mode))
    && recRaw.answer.questions.every(q => q.answered === true)
    && recRaw.answer.questions.filter(q => q.firstTry).length === 4
    && recRaw.answer.questions[wrongIndex].wrongs === 1
    && rec.records.some(r => r.includes(`${expectScore} 分 · 首答 4/5`));
  const recentOk = Array.isArray(rec.recentIds) && recRaw
    && recRaw.answer.questions.every(q => rec.recentIds.includes(q.exerciseId));
  const coinsAfter = await idbProfileSnapshot();
  const finalState = await pinyinState();
  const firstListen = listenChecks[0];
  const repeatOk = firstListen?.repeat && firstListen.repeat.events.some(e => e.ev === 'playing');
  const cacheOk = listenChecks.every(c => c.cache && c.cache.status === 200);
  const ok = s4.resultScore === `总分 ${expectScore}` && s4.resultAnswer === '作答 5 题 · 首答 4 · 重试 1 次'
    && s4.resultModes === expectModes && recordOk && recentOk && repeatOk && cacheOk
    && coinsAfter?.coins === coinsBefore?.coins && finalState.errors.length === 0;
  record('P4 完整局 5 题（听辨 ≥2 + 重试档 + 记录/金币）', ok,
    `roundId=${d4RoundId}，5 题构成 ${chooseCount} 辨认 + ${listenCount} 听辨（${questions.map(q => q.id + ':' + q.mode).join('、')}）；听辨题面（除候选按钮）无任何拉丁字母/ü 且不含答案字形（leakScan 逐题通过=${listenChecks.length}）、题头为「听辨练习 · 听声音选字母」类文案；播放钮可点，Audio 事件 canplay+playing 触发、currentTime=${firstListen?.first.currentTimeAtPlaying}、音频 URL 与题库一致、CacheStorage 命中 status=${listenChecks.map(c => c.cache?.status ?? null).join('/')}；可重复播放（第二次 playing 触发=${!!repeatOk}）；第 4 题故意答错（✗、得分仍 30）→「再试一次」重开计时（倒计时回到 10 秒档）→ 重试 +5；结算「${s4.resultScore}」「${s4.resultAnswer}」「${s4.resultModes}」与逐题档位（4×10 + 5）吻合；记录 gameId=${recRaw?.gameId}、score=${expectScore}、模式序列=${JSON.stringify(recRaw?.answer?.questions?.map(q => q.mode))}、首答 4/5、第 4 题 wrongs=1；recent-ids 含本局全部题目 ID=${recentOk}；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；JS 错误 ${finalState.errors.length} 个`,
    { checks: { roundId: d4RoundId, questions, listenChecks, expect: { score: expectScore, firstTry: 4, retries: 1, modes: expectModes }, result: { score: s4.resultScore, answer: s4.resultAnswer, modes: s4.resultModes }, recordRaw: recRaw, recentOk, coinsBefore, coinsAfter, repeatOk, cacheOk, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('P4 完整局 5 题（听辨 ≥2 + 重试档 + 记录/金币）', false, `失败: ${e.message}`);
}

// ============================================================
// P5 音频不可用降级：注销 SW + ?nosw 重载（避免 SW 缓存命中绕过拦截），
// CDP Fetch 拦截 audio/pinyin/*.wav → Audio error → 提示「无法播放声音」+
// 跳过入口；跳过题不计分不计作答。期望：4 题首答 40 分 + 1 题跳过。
// ============================================================
try {
  await evaluate(`(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    for (const r of rs) await r.unregister();
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
    return { unregistered: rs.length };
  })()`);
  await goto(`${ORIGIN}pinyin.html?nosw=1`);
  await waitUntil(async () => { const s = await pinyinState(); return s.selectVisible && s.bootFailHidden && s.gradeCards.length === 6 ? s : null; }, 'P5 无 SW 页面就绪');
  const swOff = await evaluate('navigator.serviceWorker.controller === null');
  await installPinyinPool();
  await send('Fetch.enable', { patterns: [{ urlPattern: `${ORIGIN}audio/pinyin/*.wav`, requestStage: 'Request' }] });
  fetchFailArmed = true;
  const coinsBefore = await idbProfileSnapshot();
  await click('#btn-start');
  const questions = [];
  let skippedIndex = null;
  let degradedShot = false;
  for (let i = 0; i < 5; i++) {
    const s = await waitQuestion(i, `P5 第 ${i + 1} 题可作答`);
    const ex = await poolEntry(s.promptExerciseId);
    const isListen = s.playGroupHidden === false;
    if (isListen && !degradedShot) {
      // 第一道听辨题：播放 → 拦截失败 → 降级提示 + 跳过入口
      await playAudio();
      const deg = await waitUntil(async () => {
        const st = await pinyinState();
        return st.audioNoticeHidden === false && (st.feedback ?? '').includes('无法播放声音') && st.skipHidden === false ? st : null;
      }, '音频不可用降级提示与跳过入口', 10000);
      await shot('p5-01-audio-unavailable');
      degradedShot = true;
      const audioRec = await evaluate('window.__audioLog[window.__audioLog.length - 1]', false);
      if (!audioRec?.events?.some(e => e.ev === 'error')) throw new Error(`Audio error 事件未触发: ${JSON.stringify(audioRec)}`);
      if ((audioRec?.events ?? []).some(e => e.ev === 'playing')) throw new Error('拦截失败：音频竟已播放');
      questions.push({ id: ex.id, kind: ex.kind, skipped: true });
      skippedIndex = i;
      await click('#btn-skip');
      continue;
    }
    const ans = await answerCurrent({ wrong: false });
    questions.push({ id: ex.id, kind: ex.kind, skipped: false, wrong: false });
    if (i < 4) await waitUntil(async () => { const st = await pinyinState(); return st.hudProgress === `第 ${i + 2}/5 题` || st.resultVisible ? st : null; }, `P5 推进到第 ${i + 2} 题`);
  }
  const result = await waitResult();
  await shot('p5-02-result');
  const s5 = await pinyinState();
  const answeredCount = questions.filter(q => !q.skipped).length;
  const chooseCount = questions.filter(q => q.kind === 'pinyin-choose' && !q.skipped).length;
  const listenCount = questions.filter(q => q.kind === 'pinyin-listen' && !q.skipped).length;
  const expectScore = answeredCount * 10;
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await pinyinState(); return s.selectVisible ? s : null; }, 'P5 返回选择屏');
  const rec = await pinyinState();
  const recRaw = (rec.recordsRaw?.records ?? []).slice().reverse().find(r => r.answer?.questions?.some(q => q.answered === false)) ?? null;
  const skippedEntry = recRaw?.answer?.questions?.find(q => q.answered === false) ?? null;
  const recordOk = recRaw && recRaw.gameId === 'pinyin-adventure' && recRaw.score === expectScore
    && recRaw.answer.questions.length === 5
    && recRaw.answer.questions.filter(q => q.answered).length === answeredCount
    && skippedEntry && skippedEntry.mode === 'listen' && skippedEntry.firstTry === false
    && recRaw.answer.questions.filter(q => q.answered && q.firstTry).length === answeredCount
    && rec.records.some(r => r.includes(`跳过 1`));
  await send('Fetch.disable');
  fetchFailArmed = false;
  const coinsAfter = await idbProfileSnapshot();
  const finalState = await pinyinState();
  const ok = swOff && degradedShot && skippedIndex !== null
    && s5.resultScore === `总分 ${expectScore}`
    && s5.resultAnswer === `作答 ${answeredCount} 题 · 首答 ${answeredCount} · 重试 0 次 · 跳过 1 题`
    && recordOk && coinsAfter?.coins === coinsBefore?.coins && finalState.errors.length === 0;
  record('P5 音频不可用降级（拦截 wav → 提示 + 跳过不计分）', ok,
    `注销 SW 并以 ?nosw=1 重载（controller=${swOff ? 'null' : '存在'}），Fetch 拦截 ${ORIGIN}audio/pinyin/*.wav；第 ${skippedIndex + 1} 题（听辨）点播放 → Audio error 事件触发（无 playing）→ 出现「${'当前无法播放声音'}…」提示与「跳过这道听辨题」入口（截图 p5-01）→ 跳过后其余 ${answeredCount} 题（辨认 ${chooseCount} + 听辨 ${listenCount}）全部首答答对；结算「${s5.resultScore}」「${s5.resultAnswer}」——跳过题不计分不计作答；记录 score=${expectScore}、5 题中 1 题 answered=false（mode=listen、firstTry=false）=${recordOk}、列表含「跳过 1」；金币 ${coinsBefore?.coins} = ${coinsAfter?.coins}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { swOff, skippedIndex, questions, expect: { score: expectScore, answered: answeredCount }, result: { score: s5.resultScore, answer: s5.resultAnswer, modes: s5.resultModes }, recordRaw: recRaw, skippedEntry, coinsBefore, coinsAfter, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  try { await send('Fetch.disable'); } catch {}
  fetchFailArmed = false;
  record('P5 音频不可用降级（拦截 wav → 提示 + 跳过不计分）', false, `失败: ${e.message}`);
}

// ============================================================
// P6 暂停/恢复（第 1 题答对后暂停；计时中暂停对比倒计时冻结），
// 答对第 2 题后留局给 P7。
// ============================================================
try {
  await installPinyinPool();
  await click('#btn-start');
  const q = await waitQuestion(0, 'P6 第 1 题可作答');
  const p6RoundId = q.snap?.roundId ?? null;
  const a1 = await answerCurrent({ wrong: false });
  await waitUntil(async () => { const st = await pinyinState(); return st.hudProgress === '第 2/5 题' ? st : null; }, 'P6 推进到第 2 题');
  // 空闲反馈态暂停：覆盖层出现，继续后状态不变
  await trustedClick('#btn-pause');
  await waitUntil(async () => { const s = await pinyinState(); return s.pauseOverlayHidden === false ? s : null; }, 'P6 暂停覆盖层（题间）');
  const pausedIdle = await pinyinState();
  await shot('p6-01-pause-overlay');
  if (pausedIdle.hudScore !== '得分 10') throw new Error(`P6 暂停时 HUD 异常: ${pausedIdle.hudScore}`);
  await trustedClick('#btn-resume');
  await waitUntil(async () => { const s = await pinyinState(); return s.pauseOverlayHidden === true && s.gameVisible ? s : null; }, 'P6 恢复（题间）');
  // 第 2 题计时中暂停：倒计时冻结对比
  await waitQuestion(1, 'P6 第 2 题可作答');
  await sleep(700);
  const beforePause = await pinyinState();
  const c1b = parseCountdown(beforePause.countdown);
  await trustedClick('#btn-pause');
  await waitUntil(async () => { const s = await pinyinState(); return s.pauseOverlayHidden === false ? s : null; }, 'P6 暂停覆盖层（计时中）');
  const pausedTimer = await pinyinState();
  const pausedCountdown = pausedTimer.countdown; // 预期「已停止计时」
  const frozenRemaining = pausedTimer.snap?.timer?.remainingMs;
  const frozenPaused = pausedTimer.snap?.timer?.paused;
  await sleep(2500);
  const stillFrozen = await pinyinState();
  const frozenRemaining2 = stillFrozen.snap?.timer?.remainingMs;
  await shot('p6-02-pause-timer-frozen');
  await trustedClick('#btn-resume');
  const resumed = await waitQuestion(1, 'P6 恢复后第 2 题继续计时');
  const c2 = parseCountdown(resumed.countdown);
  const resumedPrompt = resumed.prompt;
  const timerOk = c1b !== null && c2 !== null
    && frozenPaused === true
    && Math.abs(frozenRemaining / 1000 - c1b) < 0.9
    && frozenRemaining2 === frozenRemaining
    && Math.abs(c2 - frozenRemaining / 1000) < 1.0
    && resumedPrompt === beforePause.prompt;
  const finalState = await pinyinState();
  // 续答第 2 题（首答），为 P7 刷新恢复准备：得分 20、进行到第 3 题
  const a2 = await answerCurrent({ wrong: false });
  const ready = await waitUntil(async () => { const s = await pinyinState(); return s.hudProgress === '第 3/5 题' ? s : null; }, 'P6 续答后到第 3 题');
  const ok = pausedIdle.pauseOverlayHidden === false && timerOk
    && ready.hudScore === '得分 20' && ready.snap?.roundId === p6RoundId
    && ready.snap?.state?.score === 20 && ready.snap?.state?.questionIndex === 2
    && finalState.errors.length === 0;
  record('P6 暂停/恢复（倒计时冻结）', ok,
    `第 1 题「${a1.prompt}」首答 +10 后暂停：覆盖层「在字母森林歇一会」出现、HUD 不变（得分 10），继续后正常；第 2 题计时中（剩 ${c1b} 秒）暂停→倒计时显示「${pausedCountdown}」、快照 remainingMs 冻结于 ${frozenRemaining}ms（paused=${frozenPaused}，2.5s 后仍 ${frozenRemaining2}ms 不变）→继续后倒计时 ${c2} 秒 ≈ 冻结值（暂停期间未流逝），题面不变「${resumedPrompt}」；续答第 2 题首答 → 第 3/5 题、得分 20、快照 roundId=${p6RoundId}、questionIndex=${ready.snap?.state?.questionIndex}（P7 前置就绪）；JS 错误 ${finalState.errors.length} 个`,
    { checks: { roundId: p6RoundId, q1: a1, pausedIdleCountdown: pausedIdle.countdown, c1b, pausedCountdown, frozenRemaining, frozenRemaining2, c2, timerOk, p7Snapshot: ready.snap, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('P6 暂停/恢复（倒计时冻结）', false, `失败: ${e.message}`);
}

// ============================================================
// P7 刷新恢复（答对 2 题刷新 → 恢复一致 → 续打不重复计分）。
// 期望：恢复到第 3 题、得分 20，续答 3 题后结算 50 分、首答 5、恰 1 条记录。
// ============================================================
try {
  const before = await pinyinState();
  const beforeSnap = before.snap;
  if (!beforeSnap || beforeSnap.state?.questionIndex !== 2) throw new Error('刷新前置状态不是第 3 题');
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => {
    const s = await pinyinState();
    return s.selectVisible && s.restoreOfferHidden === false ? s : null;
  }, '刷新后恢复提供');
  const offer = await pinyinState();
  await shot('p7-01-restore-offer');
  await click('#btn-restore');
  await waitUntil(async () => { const s = await pinyinState(); return s.gameVisible && s.hudProgress === '第 3/5 题' ? s : null; }, '恢复到第 3 题');
  await sleep(300);
  const restored = await pinyinState();
  await shot('p7-02-restored');
  // 刷新后页面模块索引丢失，重装题库池
  await installPinyinPool();
  const stateOk = restored.hudScore === `得分 ${beforeSnap.state.score}`
    && restored.hudProgress === '第 3/5 题'
    && restored.snap?.roundId === beforeSnap.roundId
    && restored.snap?.state?.score === beforeSnap.state.score
    && restored.snap?.state?.questionIndex === beforeSnap.state.questionIndex
    && JSON.stringify(restored.snap?.state?.questions?.map(q => q.exerciseId)) === JSON.stringify(beforeSnap.state.questions?.map(q => q.exerciseId))
    && restored.snap?.state?.firstTryCount === beforeSnap.state.firstTryCount
    && parseCountdown(restored.countdown) !== null;
  // 续答 3 题到结算（不重复计分：期望 = 刷新前 20 + 新增 30）
  for (let i = 2; i < 5; i++) {
    await waitQuestion(i, `P7 第 ${i + 1} 题可作答`);
    await answerCurrent({ wrong: false });
    if (i < 4) await waitUntil(async () => { const s = await pinyinState(); return s.hudProgress === `第 ${i + 2}/5 题` ? s : null; }, `P7 推进到第 ${i + 2} 题`);
  }
  const result = await waitResult();
  await shot('p7-03-result');
  const s7 = await pinyinState();
  const expectScore7 = beforeSnap.state.score + 30;
  const modes7 = s7.resultModes;
  await click('#btn-result-return');
  await waitUntil(async () => { const s = await pinyinState(); return s.selectVisible ? s : null; }, 'P7 返回选择屏');
  const rec = await pinyinState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === beforeSnap.roundId) ?? null;
  const recordOk = recRaw && recRaw.recordId === beforeSnap.roundId && recRaw.score === expectScore7
    && recRaw.answer?.questions?.length === 5 && recRaw.answer.questions.every(q => q.firstTry === true && q.answered === true)
    && (rec.recordsRaw?.records ?? []).filter(r => r.recordId === beforeSnap.roundId).length === 1;
  const finalState = await pinyinState();
  const ok = offer.restoreOfferText?.includes('有未完成的练习') && stateOk
    && s7.resultScore === `总分 ${expectScore7}`
    && s7.resultAnswer === '作答 5 题 · 首答 5 · 重试 0 次'
    && recordOk && finalState.errors.length === 0;
  record('P7 刷新恢复（不重复计分）', ok,
    `第 1、2 题首答（得分 ${beforeSnap.state.score}）后 Page.reload：出现恢复提供「${offer.restoreOfferText?.slice(0, 30)}…」→继续练习→第 3/5 题、得分 ${beforeSnap.state.score}、roundId/题目 ID 序列/firstTryCount 与刷新前一致（快照恢复）、计时继续（倒计时 ${restored.countdown}）→续答 3 题全对→结算「${s7.resultScore}」「${s7.resultAnswer}」（= 刷新前 ${beforeSnap.state.score} + 新增 30；若前两题重计应为 ${expectScore7 + beforeSnap.state.score}）「${modes7}」；记录 recordId=roundId 幂等恰 1 条、5 题全 firstTry=${recordOk}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { beforeSnap, offerText: offer.restoreOfferText, restoredSnap: restored.snap, stateOk, expect: { score: expectScore7 }, result: { score: s7.resultScore, answer: s7.resultAnswer, modes: modes7 }, recordRaw: recRaw, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('P7 刷新恢复（不重复计分）', false, `失败: ${e.message}`);
}

// ============================================================
// P8 三游戏回归（数字消除/汉字勇者/算术地下城 加载与返回正常）
// ============================================================
try {
  await trustedClick('.profile-bar a.btn-ghost');
  const home = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible && s.pinyinAnchor ? s : null;
  }, 'P8 回到数字消除首页');
  // 数字消除选择屏可用（年级勾选）
  await evaluate(`(() => { const el = document.querySelector('input[name="grade"][value="1"]');
    if (el && !el.checked) el.click(); })()`, false);
  await sleep(200);
  const npChecked = await homeState();
  await evaluate(`(() => { const el = document.querySelector('input[name="grade"][value="1"]');
    if (el && el.checked) el.click(); })()`, false);
  await sleep(200);
  // 菜单三游戏锚点并存
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, 'P8 菜单');
  const menu = await homeState();
  await shot('p8-01-home-menu');
  // 汉字勇者
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const hs = await waitUntil(async () => {
    const s = await hanziState();
    return s.url.endsWith('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, 'P8 汉字勇者加载');
  await shot('p8-02-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, 'P8 hanzi 返回首页');
  // 算术地下城
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, 'P8 菜单再开');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const ds = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible && s.gradeCards === 6 ? s : null;
  }, 'P8 地下城加载');
  await trustedClick('.profile-bar a.btn-ghost');
  const backHome = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible && s.pinyinAnchor ? s : null;
  }, 'P8 地下城返回首页');
  const finalHome = await homeState();
  const ok = menu.pinyinAnchor?.visible && menu.hanziAnchor?.visible && menu.dungeonAnchor?.visible
    && npChecked.btnToAvailabilityDisabled === false
    && hs.gradeCards === 6 && ds.selectVisible && ds.gradeCards === 6 && backHome.selectVisible
    && finalHome.errors.length === 0 && hs.errors.length === 0 && ds.errors.length === 0;
  record('P8 三游戏回归', ok,
    `拼音「返回数字消除」回首页（钱包「${home.wallet}」）；数字消除选择屏勾一年级→下一步可用（再取消复原）；菜单弹层内汉字勇者/算术地下城/拼音冒险三锚点并存可见；真实点击进 hanzi.html 正常加载（6 年级卡、boot-fail 隐藏）→返回锚点回首页；再进 dungeon.html 正常（6 年级卡）→返回锚点回首页；JS 错误 0`,
    { checks: { wallet: home.wallet, menu: { hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor, pinyin: menu.pinyinAnchor }, npOk: npChecked.btnToAvailabilityDisabled === false, hanzi: { gradeCards: hs.gradeCards, h1: hs.h1 }, dungeon: { gradeCards: ds.gradeCards, h1: ds.h1 }, overflow: finalHome.overflowX, errors: { home: finalHome.errors, hanzi: hs.errors, dungeon: ds.errors } } });
} catch (e) {
  record('P8 三游戏回归', false, `失败: ${e.message}`);
}

// ============================================================
// P9 SW 四入口与断网（sw 版本、预缓存四入口+47 音频、杀 serve 后
// 四页缓存可达、断网听辨音频缓存命中可播并完成至少一题）
// ============================================================
try {
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, 'P9 首页就绪');
  const swInfo = await waitUntil(async () => evaluate(`(async () => {
    if (navigator.serviceWorker.controller === null) return null;
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    const entries = await cache.keys();
    const wavs = entries.filter(r => r.url.includes('/audio/pinyin/')).length;
    const need = ['/', '/hanzi.html', '/dungeon.html', '/pinyin.html', '/pinyin.css', '/dist/game/pinyin-adventure/main.js', '/dist/learning/pinyin.js'];
    const missing = [];
    for (const u of need) if (!(await cache.match(u))) missing.push(u);
    if (missing.length || wavs !== 47) return { partial: true, missing, wavs };
    const swText = await fetch('/sw.js').then(r => r.text()).catch(() => '');
    return { name, wavs, fourEntries: true, swHasPinyinEntry: swText.includes('/pinyin.html') && swText.includes('/audio/pinyin/') };
  })()`), 'SW 受控且四入口+47 音频缓存就绪', 60000);
  log('SW:', JSON.stringify(swInfo));
  if (swInfo.partial) throw new Error(`预缓存不完整: missing=${JSON.stringify(swInfo.missing)} wavs=${swInfo.wavs}`);
  // 杀掉源站
  const { execSync } = await import('node:child_process');
  try { execSync('kill $(lsof -ti tcp:4173 -sTCP:LISTEN) 2>/dev/null || true', { shell: '/bin/zsh' }); } catch {}
  await sleep(1000);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}sw.js`); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  // 刷新首页：SW 缓存打开
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, '断源后首页可打开', 30000);
  const offlineHome = await homeState();
  await shot('p9-01-offline-home');
  // 菜单 → 拼音冒险
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.pinyinAnchor?.visible ? s : null; }, '断源后菜单');
  await trustedClick('#main-nav a[href="/pinyin.html"]');
  const offlinePinyin = await waitUntil(async () => {
    const s = await pinyinState();
    return s.url.includes('/pinyin.html') && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null;
  }, '断源后拼音冒险可打开', 30000);
  await shot('p9-02-offline-pinyin');
  // 断网听辨：开局答到听辨题 → 播放缓存音频 → 答对一题
  await installPinyinPool();
  await click('#btn-start');
  const questions9 = [];
  let listenPlayed = null;
  for (let i = 0; i < 5; i++) {
    const s = await waitQuestion(i, `P9 断网第 ${i + 1} 题可作答`);
    const ex = await poolEntry(s.promptExerciseId);
    const isListen = s.playGroupHidden === false;
    if (isListen) {
      const info = await assertListenQuestion(s, ex, { doublePlay: false });
      if (!info.leakOk || !info.btnOk || !info.urlOk || !info.playedOk) {
        throw new Error(`断网听辨失败 ${ex.id}: leak=${info.leakOk} btn=${info.btnOk} url=${info.urlOk} played=${info.playedOk}`);
      }
      listenPlayed = { id: ex.id, events: info.first.rec.events, cache: info.cache, audio: ex.audio };
      await shot('p9-03-offline-listen');
      const ans = await answerCurrent({ wrong: false });
      questions9.push({ id: ex.id, kind: ex.kind, answered: true });
      await waitUntil(async () => { const st = await pinyinState(); return st.feedbackHidden === false && (st.feedback ?? '').startsWith('✓') ? st : null; }, '断网听辨答对反馈');
      break;
    }
    await answerCurrent({ wrong: false });
    questions9.push({ id: ex.id, kind: ex.kind, answered: true });
  }
  if (!listenPlayed) throw new Error('本局未遇到听辨题（不可能：每局听辨 ≥2）');
  // 拼音返回锚点回首页（断源确认弹窗）
  await click('#btn-game-return');
  await waitUntil(async () => { const s = await pinyinState(); return s.confirmOpen ? s : null; }, '断源放弃确认');
  await click('#btn-confirm-yes');
  await waitUntil(async () => { const s = await pinyinState(); return s.selectVisible ? s : null; }, '断源放弃回选择屏');
  const afterDiscard = await pinyinState();
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断源后拼音返回首页', 30000);
  // 菜单 → hanzi / dungeon 缓存可达
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, '断源菜单再开');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const offlineHanzi = await waitUntil(async () => {
    const s = await hanziState();
    return s.url.endsWith('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, '断源后汉字勇者可打开', 30000);
  await shot('p9-04-offline-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断源 hanzi 返回首页', 30000);
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, '断源菜单三开');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const offlineDungeon = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible && s.gradeCards === 6 ? s : null;
  }, '断源后算术地下城可打开', 30000);
  await shot('p9-05-offline-dungeon');
  const finalHome = await homeState();
  const ok = swInfo.fourEntries && swInfo.swHasPinyinEntry && swInfo.wavs === 47 && sourceDead
    && offlineHome.selectVisible && offlinePinyin.selectVisible
    && listenPlayed.cache && listenPlayed.cache.status === 200
    && listenPlayed.events.some(e => e.ev === 'playing')
    && afterDiscard.snap === null && offlineHanzi.gradeCards === 6 && offlineDungeon.gradeCards === 6
    && finalHome.errors.length === 0 && offlineHanzi.errors.length === 0 && offlineDungeon.errors.length === 0 && offlinePinyin.errors.length === 0;
  record('P9 SW 四入口与断网听辨', ok,
    `SW 版本 ${swInfo.name} 预缓存含 /、/hanzi.html、/dungeon.html、/pinyin.html（含 /pinyin.css 与拼音 dist 模块）+ 47 条 /audio/pinyin/*.wav（清单文本含 pinyin 入口=${swInfo.swHasPinyinEntry}）；杀掉 serve 进程（源站请求确认失败）后刷新：首页由缓存打开，菜单进拼音冒险由缓存正常加载（6 年级卡）；断网开局答对前序题后遇听辨题「${listenPlayed.audio}」→ 播放成功（playing 事件触发、CacheStorage 命中 status=${listenPlayed.cache?.status}）并答对完成该听辨题（✓ 反馈，截图 p9-03）；放弃本局回选择屏（快照清除=${afterDiscard.snap === null}）→ 返回首页 → hanzi.html、dungeon.html 均由缓存正常加载——四入口缓存互导；全程 JS 错误 0`,
    { checks: { swInfo, sourceDead, listenPlayed, questions9, snapshotDiscarded: afterDiscard.snap === null, overflow: finalHome.overflowX, errors: { home: finalHome.errors, pinyin: offlinePinyin.errors, hanzi: offlineHanzi.errors, dungeon: offlineDungeon.errors } } });
} catch (e) {
  record('P9 SW 四入口与断网听辨', false, `失败: ${e.message}`);
}

// ===== P10 贯穿：无横向溢出、JS 错误 0（汇总各场景） =====
try {
  const overflowBad = scenarios.filter(s => (s.checks?.overflow === true));
  const errorBad = scenarios.filter(s => (s.checks?.errors && ((Array.isArray(s.checks.errors) ? s.checks.errors : Object.values(s.checks.errors).flat()).length > 0)));
  const ua = await evaluate('navigator.userAgent', false).catch(() => null);
  const viewport = await evaluate('({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })', false).catch(() => null);
  const ok = overflowBad.length === 0 && errorBad.length === 0;
  record('P10 贯穿（横向溢出与 JS 错误）', ok,
    `全程 ${scenarios.length - 1} 个功能场景均无横向溢出（溢出场景：${overflowBad.map(s => s.name).join('、') || '无'}）、均无 JS 错误（报错场景：${errorBad.map(s => s.name).join('、') || '无'}）；UA=${ua}`,
    { checks: { userAgent: ua, viewport, horizontalOverflowScenarios: overflowBad.map(s => s.name), jsErrorScenarios: errorBad.map(s => s.name) } });
} catch (e) {
  record('P10 贯穿（横向溢出与 JS 错误）', false, `失败: ${e.message}`);
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
await writeFile(`${outDir}/pinyin-browser-results.json`, JSON.stringify(summary, null, 2));
log('结果已写入', `${outDir}/pinyin-browser-results.json`);
log(JSON.stringify(summary.scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(0);
