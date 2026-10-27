// 拼音冒险（M9）+ 汉字勇者（M8）缺陷修复合并复验轮（独立验收员轮，只验证与记录）。
// 修复内容：① M9 拼音组卷洗牌（rules.ts createRound 用局内 rng 洗 options，随快照恢复）；
// ② M9 降级提示去重（只保留 audio-notice 一处，feedback 不再写同文案）；
// ③ M8 hanzi-hero 同款组卷洗牌（choose+parts 同路径，判题按字/部件集合身份，内容零改动）。
// 结构参照 pinyin-browser.mjs / dungeon-browser.mjs：无头 Chrome CDP 直连、真实鼠标事件、
// 答案经 dist 判题模块自算（pinyin 按字母身份；hanzi 用 /dist/learning/hanzi.js 的
// correctHanziIds 作用于快照内洗牌后 task，与内容原始序解耦）、Fetch 拦截 *.wav、
// Page.reload 刷新恢复。覆盖 FX1–FX5，结果合入 pinyin-browser-results.json 的
// fixVerification 字段，截图 fx- 前缀。
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9742';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m9';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[fixverify]', ...a);
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
let fetchFailArmed = false;
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Fetch.requestPaused') {
    const respond = fetchFailArmed ? 'Fetch.failRequest' : 'Fetch.continueRequest';
    const params = fetchFailArmed ? { requestId: m.params.requestId, errorReason: 'Failed' } : { requestId: m.params.requestId };
    ws.send(JSON.stringify({ id: ++seq, method: respond, params }));
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
  window.__audioLog=[];
  (function(){ var Orig = window.Audio; if (!Orig) return;
    window.Audio = function(url){ var a = new Orig(url);
      var rec = { url: String(url), events: [], currentTimeAtPlaying: null };
      window.__audioLog.push(rec);
      a.addEventListener('canplay', function(){ rec.events.push({ ev:'canplay' }); });
      a.addEventListener('playing', function(){ rec.events.push({ ev:'playing' }); rec.currentTimeAtPlaying = a.currentTime; });
      a.addEventListener('error', function(){ rec.events.push({ ev:'error' }); });
      return a; };
    window.Audio.prototype = Orig.prototype; })();
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
const goto = async url => { await send('Page.navigate', { url }); await sleep(1200); };

const permEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ===== 拼音冒险状态（复验所需子集 + 听辨防泄露扫描） =====
const pinyinState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null, recordsRaw = null;
  try { const raw = localStorage.getItem('pixel-academy:pinyin-adventure:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:pinyin-adventure:v1:records') ?? 'null'); } catch {}
  const card = document.getElementById('question-card');
  let leakScan = null;
  if (card && !card.hidden) {
    const clone = card.cloneNode(true);
    clone.querySelectorAll('#options button').forEach(b => b.remove());
    const text = (clone.textContent || '').replace(/[\\s]+/g, ' ').trim();
    leakScan = { text, hasLatin: /[a-zü]/i.test(text) };
  }
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('main h1')?.textContent ?? null,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    selectVisible: !hidden('screen-select'), gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'),
    backLink: document.querySelector('.profile-bar a.btn-ghost')?.getAttribute('href') ?? null,
    gradeCards: [...document.querySelectorAll('#grade-grid button')].map(b => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled })),
    availabilityStatus: t('availability-status'),
    startDisabled: document.getElementById('btn-start')?.disabled,
    hudProgress: t('hud-progress'), hudScore: t('hud-score'),
    questionVisible: !hidden('question-card'), qTitle: t('q-title'), countdown: t('countdown'),
    promptExerciseId: document.getElementById('q-prompt')?.dataset.exerciseId ?? null,
    playGroupHidden: hidden('play-group'),
    btnPlayDisabled: document.getElementById('btn-play')?.disabled,
    audioNoticeHidden: hidden('audio-notice'),
    optionButtons: [...document.querySelectorAll('#options button')].map(b => ({ text: b.textContent, disabled: b.disabled })),
    feedbackHidden: hidden('feedback'), feedback: t('feedback'),
    retryHidden: hidden('btn-retry-attempt'), skipHidden: hidden('btn-skip'),
    pauseOverlayHidden: hidden('pause-overlay'),
    resultScore: t('result-score'), resultAnswer: t('result-answer'), resultModes: t('result-modes'),
    leakScan, snap, recordsRaw,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 汉字勇者状态 =====
const hanziState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null, recordsRaw = null;
  try { const raw = localStorage.getItem('pixel-academy:hanzi-hero:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:hanzi-hero:v1:records') ?? 'null'); } catch {}
  return {
    url: location.href, title: document.title,
    h1: document.querySelector('.app-title')?.textContent ?? null,
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    selectVisible: !hidden('screen-select'), gameVisible: !hidden('screen-game'),
    resultVisible: !hidden('screen-result'),
    gradeCards: [...document.querySelectorAll('#grade-grid button')].map(b => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled })),
    hudProgress: t('hud-progress'), hudScore: t('hud-score'),
    prompt: t('question-prompt'),
    imageHidden: hidden('question-image'),
    optionButtons: [...document.querySelectorAll('#options button')].map(b => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed') })),
    partsSubmitHidden: hidden('btn-parts-submit'),
    partsSubmitDisabled: document.getElementById('btn-parts-submit')?.disabled,
    feedbackHidden: hidden('feedback'), feedback: t('feedback'),
    resultScore: t('result-score'), resultDetail: t('result-detail'),
    restoreOfferHidden: hidden('restore-offer'),
    snap, recordsRaw,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

// ===== 首页 / 地下城状态（FX4 回归） =====
const homeState = () => evaluate(`(() => ({
  url: location.href,
  selectVisible: !document.getElementById('screen-select')?.hidden,
  gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
  btnToAvailabilityDisabled: document.getElementById('btn-to-availability')?.disabled,
  menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
  pinyinAnchorVisible: !!(document.querySelector('#main-nav a[href="/pinyin.html"]')?.offsetWidth || document.querySelector('#main-nav a[href="/pinyin.html"]')?.offsetHeight),
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);
const dungeonState = () => evaluate(`(() => ({
  url: location.href, title: document.title,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  selectVisible: !document.getElementById('screen-select')?.hidden,
  gradeCards: document.querySelectorAll('#grade-grid button').length,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);

// ===== 题库池安装 =====
const installPinyinPool = () => evaluate(`(async () => {
  const { selectPinyinExercises } = await import('/dist/game/pinyin-adventure/content.js');
  const picked = selectPinyinExercises([1]);
  const map = {};
  for (const e of picked) map[e.id] = { id: e.id, status: e.review.status, kind: e.task.kind,
    options: [...e.task.options], answer: e.task.answer, audio: e.task.audio ?? null };
  window.__pinyinPool = map;
  return { count: picked.length };
})()`);

const installHanziCore = () => evaluate(`(async () => {
  const { selectHanziExercises } = await import('/dist/game/hanzi-hero/content.js');
  const { correctHanziIds } = await import('/dist/learning/hanzi.js');
  const picked = selectHanziExercises([1]);
  const map = {};
  for (const e of picked) map[e.id] = { id: e.id, status: e.review.status, kind: e.task.kind,
    options: [...e.task.options], target: e.task.target ?? null, parts: e.task.parts ?? null };
  window.__hanziPool = map;
  window.__correctTexts = task => [...correctHanziIds(task)];
  return { count: picked.length, statuses: [...new Set(picked.map(e => e.review.status))] };
})()`);

const poolEntry = (poolName, id) => evaluate(`(() => {
  const e = (window[${JSON.stringify(poolName)}] ?? {})[${JSON.stringify(id)}];
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
const parseCountdown = text => { const m = (text ?? '').match(/剩余 ([0-9.]+) 秒/); return m ? Number(m[1]) : null; };

const waitPinyinQuestion = (index, desc) => waitUntil(async () => {
  const s = await pinyinState();
  if (!s.gameVisible || !s.questionVisible || s.hudProgress !== `第 ${index + 1}/5 题`) return null;
  if (!(s.countdown ?? '').startsWith('剩余')) return null;
  if (!s.optionButtons.length || s.optionButtons.some(b => b.disabled)) return null;
  return s;
}, desc);
const waitRetryState = () => waitUntil(async () => {
  const s = await pinyinState();
  return s.gameVisible && s.questionVisible && s.feedbackHidden === false
    && (s.feedback ?? '').startsWith('✗') && s.retryHidden === false ? s : null;
}, '答错待再试状态');
const waitPinyinResult = () => waitUntil(async () => { const s = await pinyinState(); return s.resultVisible ? s : null; }, '结算屏');
const clickPinyinOption = async text => {
  const idx = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('#options button')];
    const i = btns.findIndex(b => b.textContent === ${JSON.stringify(text)});
    if (i < 0) throw new Error('候选未找到: ' + ${JSON.stringify(text)});
    return i; })()`, false);
  await trustedClick(`#options button:nth-of-type(${idx + 1})`);
  return idx;
};
const playAudio = async () => {
  const before = await evaluate('window.__audioLog?.length ?? -1', false);
  await trustedClick('#btn-play');
  const found = await waitUntil(async () => {
    const n = await evaluate('window.__audioLog?.length ?? -1', false);
    return n > before ? { idx: n - 1 } : null;
  }, 'Audio 实例创建', 6000);
  const rec = await waitUntil(async () => {
    const logArr = await evaluate(`window.__audioLog[${found.idx}]`, false);
    return logArr && logArr.events.some(e => e.ev === 'playing' || e.ev === 'error') ? logArr : null;
  }, 'playing/error 事件', 6000);
  await sleep(150);
  return rec;
};
const cacheHitFor = url => evaluate(`(async () => {
  const keys = await caches.keys();
  for (const k of keys) { const c = await caches.open(k); const hit = await c.match(${JSON.stringify(url)}); if (hit) return { cache: k, status: hit.status }; }
  return null; })()`);

const idbProfileSnapshot = () => evaluate(`(async () => {
  // 全新档案下库可能尚未由游戏创建：先探测（indexedDB.databases），绝不带版本号
  // open，避免抢先创建缺 store 的空库污染档案。
  const dbs = await indexedDB.databases();
  if (!dbs.some(d => d.name === 'pixel-academy')) return null;
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    if (!db.objectStoreNames.contains('profiles')) return null;
    return await new Promise((res, rej) => {
      const tx = db.transaction('profiles', 'readonly');
      const rq = tx.objectStore('profiles').get('local');
      rq.onsuccess = () => { const v = rq.result; res(v ? { coins: v.coins } : null); };
      tx.onabort = () => rej(tx.error ?? new Error('idb read aborted'));
    });
  } finally { db.close(); }
})()`);

// ============================================================
// FX1 M9-P4 重跑（3 局）：组卷洗牌生效 + 字母身份判对 + 防泄露照旧 +
// 重试档 + 结算/记录模式区分 + 金币零变化。
// ============================================================
try {
  // 先访问首页：让数字消除主模块创建 IndexedDB 档案（profiles store），金币断言才有意义。
  await goto(`${ORIGIN}`);
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, 'FX1 首页就绪（档案初始化）');
  await goto(`${ORIGIN}pinyin.html`);
  await waitUntil(async () => { const s = await pinyinState(); return s.selectVisible && s.bootFailHidden && s.gradeCards.length === 6 ? s : null; }, '拼音选择屏就绪');
  await installPinyinPool();
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')].find(x => x.textContent === '一年级');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`, false);
  await sleep(200);
  const coinsBefore = await idbProfileSnapshot();
  const rounds = [];
  for (let r = 0; r < 3; r++) {
    await click('#btn-start');
    const q0 = await waitPinyinQuestion(0, `FX1 第 ${r + 1} 局第 1 题`);
    const roundId = q0.snap?.roundId ?? null;
    const questions = [];
    let played = false;
    for (let i = 0; i < 5; i++) {
      const s = await (i === 0 ? Promise.resolve(q0) : waitPinyinQuestion(i, `FX1 第 ${r + 1} 局第 ${i + 1} 题`));
      const ex = await poolEntry('__pinyinPool', s.promptExerciseId);
      if (ex.status !== 'approved') throw new Error(`非 approved 题 ${ex.id}`);
      const domOpts = s.optionButtons.map(b => b.text);
      if (!permEq(domOpts, ex.options)) throw new Error(`题 ${ex.id} 渲染候选不是内容候选的排列: ${JSON.stringify(domOpts)} vs ${JSON.stringify(ex.options)}`);
      const isListen = s.playGroupHidden === false;
      if (isListen !== (ex.kind === 'pinyin-listen')) throw new Error(`题 ${ex.id} 模式渲染不一致`);
      // 防泄露照旧：听辨题面（除候选）无拉丁字母/ü 且不含答案字形
      if (isListen && !(s.leakScan && s.leakScan.hasLatin === false && !s.leakScan.text.includes(ex.answer))) {
        throw new Error(`听辨题 ${ex.id} 防泄露断言失败: ${JSON.stringify(s.leakScan)}`);
      }
      // 每局第一道听辨题播放一次（修复不破坏音频链路）
      let audio = null;
      if (isListen && !played) {
        const rec = await playAudio();
        if (!rec.events.some(e => e.ev === 'playing') || !rec.url.endsWith(ex.audio)) throw new Error(`听辨播放失败 ${ex.id}: ${JSON.stringify(rec)}`);
        audio = { url: rec.url, events: rec.events.map(e => e.ev), cache: await cacheHitFor(`/audio/pinyin/${ex.audio.split('/').pop()}`) };
        played = true;
      }
      const targetIndex = domOpts.indexOf(ex.answer);
      questions.push({ id: ex.id, mode: ex.kind === 'pinyin-choose' ? 'choose' : 'listen',
        domOptions: domOpts, originalOptions: ex.options, shuffled: JSON.stringify(domOpts) !== JSON.stringify(ex.options), targetIndex, audio });
      // 作答：第 4 题故意答错 → 再试一次 → 重试档；其余按字母身份答对
      if (i === 3) {
        const wrongOpt = domOpts.find(o => o !== ex.answer);
        await clickPinyinOption(wrongOpt);
        const retry = await waitRetryState();
        if (retry.hudScore !== '得分 30') throw new Error(`答错后扣分了: ${retry.hudScore}`);
        await click('#btn-retry-attempt');
        const retried = await waitPinyinQuestion(i, `FX1 第 ${r + 1} 局第 ${i + 1} 题重试`);
        if (parseCountdown(retried.countdown) === null || parseCountdown(retried.countdown) < 9) throw new Error(`重试未重开计时: ${retried.countdown}`);
        await clickPinyinOption(ex.answer);
      } else {
        await clickPinyinOption(ex.answer);
        const fb = await waitUntil(async () => { const st = await pinyinState(); return st.feedbackHidden === false && (st.feedback ?? '').startsWith('✓') ? st.feedback : null; }, '答对反馈');
        if (!fb.includes('+10')) throw new Error(`首答加分异常: ${fb}`);
      }
      if (i < 4) await waitUntil(async () => { const st = await pinyinState(); return st.hudProgress === `第 ${i + 2}/5 题` ? st : null; }, `FX1 推进第 ${i + 2} 题`);
    }
    await waitPinyinResult();
    const sRes = await pinyinState();
    if (r === 0) await shot('fx-1-01-result-round1');
    const chooseN = questions.filter(q => q.mode === 'choose').length;
    const listenN = questions.filter(q => q.mode === 'listen').length;
    const chooseF = questions.filter(q => q.mode === 'choose' && q.id !== questions[3].id).length;
    const listenF = questions.filter(q => q.mode === 'listen' && q.id !== questions[3].id).length;
    const expectModes = `辨认 ${chooseF}/${chooseN} 题首答 · 听辨 ${listenF}/${listenN} 题首答`;
    await click('#btn-result-return');
    await waitUntil(async () => { const st = await pinyinState(); return st.selectVisible ? st : null; }, `FX1 第 ${r + 1} 局返回选择屏`);
    const rec = await pinyinState();
    const recRaw = (rec.recordsRaw?.records ?? []).find(x => x.recordId === roundId) ?? null;
    const recordOk = recRaw && recRaw.gameId === 'pinyin-adventure' && recRaw.score === 45
      && recRaw.answer?.questions?.length === 5
      && JSON.stringify(recRaw.answer.questions.map(q => q.mode)) === JSON.stringify(questions.map(q => q.mode))
      && recRaw.answer.questions.filter(q => q.firstTry).length === 4
      && recRaw.answer.questions[3].wrongs === 1;
    if (!recordOk) throw new Error(`第 ${r + 1} 局记录校验失败: ${JSON.stringify(recRaw)}`);
    if (sRes.resultScore !== '总分 45' || sRes.resultAnswer !== '作答 5 题 · 首答 4 · 重试 1 次' || sRes.resultModes !== expectModes) {
      throw new Error(`第 ${r + 1} 局结算不符: ${sRes.resultScore} / ${sRes.resultAnswer} / ${sRes.resultModes}`);
    }
    rounds.push({ roundId, questions, resultModes: sRes.resultModes, recordOk });
  }
  const coinsAfter = await idbProfileSnapshot();
  const allTargets = rounds.flatMap(x => x.questions.map(q => q.targetIndex));
  const distinctPositions = [...new Set(allTargets)];
  const zeroCount = allTargets.filter(i => i === 0).length;
  const shuffledCount = rounds.flatMap(x => x.questions).filter(q => JSON.stringify(q.domOptions) !== JSON.stringify(q.originalOptions)).length;
  // 洗牌生效判据：15 题位置不全为 0、至少出现 2 个不同位置、与内容原始序不同的题 ≥ 1。
  // （均匀洗牌下 15 题全在首位的概率 ≈ (1/4)^15，阈值留足裕度。）
  const shuffleOk = allTargets.length === 15 && distinctPositions.length >= 2 && zeroCount <= 7 && shuffledCount >= 1;
  const finalState = await pinyinState();
  const ok = shuffleOk && rounds.every(x => x.recordOk) && coinsAfter?.coins === coinsBefore?.coins && finalState.errors.length === 0;
  record('FX1 M9-P4 重跑（3 局洗牌 + 判题/记录/金币）', ok,
    `3 局各 5 题全部完成：答案位置分布 ${JSON.stringify(allTargets)}（不同位置 ${distinctPositions.length} 个、首位 ${zeroCount} 题）、与内容原始序不同的题 ${shuffledCount}/15——洗牌生效（修复前恒为首位）；每题渲染候选均为内容候选的排列（判题按字母身份点击正确字母）；听辨防泄露逐题通过（题面无拉丁字母/ü、不含答案字形）；每局第一道听辨播放成功（playing + 缓存命中 ${rounds.flatMap(x => x.questions).find(q => q.audio)?.audio.cache?.status ?? '?'}）；第 4 题答错→再试一次→重试档，结算「总分 45」「作答 5 题 · 首答 4 · 重试 1 次」逐局吻合，记录 gameId/score/模式序列/wrongs 校验 3/3；IndexedDB 金币 ${coinsBefore?.coins} = ${coinsAfter?.coins}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { rounds: rounds.map(x => ({ roundId: x.roundId, questions: x.questions.map(q => ({ id: q.id, mode: q.mode, targetIndex: q.targetIndex, shuffled: q.shuffled })), resultModes: x.resultModes, recordOk: x.recordOk })), allTargets, distinctPositions, zeroCount, shuffledCount, shuffleOk, coinsBefore, coinsAfter, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('FX1 M9-P4 重跑（3 局洗牌 + 判题/记录/金币）', false, `失败: ${e.message}`);
}

// ============================================================
// FX2 M9-P5 重跑：拦截 *.wav → 降级同屏仅 audio-notice 一条提示 +
// feedback 无重复文案 + 跳过不计分。
// ============================================================
try {
  await evaluate(`(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    for (const r of rs) await r.unregister();
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
    return true; })()`);
  await goto(`${ORIGIN}pinyin.html?nosw=1`);
  await waitUntil(async () => { const s = await pinyinState(); return s.selectVisible && s.bootFailHidden ? s : null; }, 'FX2 无 SW 页面就绪');
  const swOff = await evaluate('navigator.serviceWorker.controller === null');
  await installPinyinPool();
  await send('Fetch.enable', { patterns: [{ urlPattern: `${ORIGIN}audio/pinyin/*.wav`, requestStage: 'Request' }] });
  fetchFailArmed = true;
  const coinsBefore = await idbProfileSnapshot();
  await click('#btn-start');
  const questions = [];
  let skippedIndex = null, degradeState = null, audioRec = null;
  for (let i = 0; i < 5; i++) {
    const s = await waitPinyinQuestion(i, `FX2 第 ${i + 1} 题可作答`);
    const ex = await poolEntry('__pinyinPool', s.promptExerciseId);
    const isListen = s.playGroupHidden === false;
    if (isListen && !degradeState) {
      audioRec = await playAudio();
      degradeState = await waitUntil(async () => {
        const st = await pinyinState();
        return st.audioNoticeHidden === false ? st : null;
      }, 'audio-notice 降级提示', 10000);
      await shot('fx-2-01-audio-unavailable');
      if (!audioRec.events.some(e => e.ev === 'error')) throw new Error(`Audio error 事件未触发: ${JSON.stringify(audioRec)}`);
      if (audioRec.events.some(e => e.ev === 'playing')) throw new Error('拦截失败：音频竟已播放');
      questions.push({ id: ex.id, kind: ex.kind, skipped: true });
      skippedIndex = i;
      await click('#btn-skip');
      continue;
    }
    await clickPinyinOption(ex.answer);
    questions.push({ id: ex.id, kind: ex.kind, skipped: false });
    if (i < 4) await waitUntil(async () => { const st = await pinyinState(); return st.hudProgress === `第 ${i + 2}/5 题` || st.resultVisible ? st : null; }, `FX2 推进第 ${i + 2} 题`);
  }
  await waitPinyinResult();
  const s5 = await pinyinState();
  await shot('fx-2-02-result');
  const answeredCount = questions.filter(q => !q.skipped).length;
  const expectScore = answeredCount * 10;
  // 同屏仅一条提示：降级时刻 feedback 必须不含「无法播放声音」文案
  const singleNotice = degradeState.feedbackHidden === true || !(degradeState.feedback ?? '').includes('无法播放声音');
  await click('#btn-result-return');
  await waitUntil(async () => { const st = await pinyinState(); return st.selectVisible ? st : null; }, 'FX2 返回选择屏');
  const rec = await pinyinState();
  const recRaw = (rec.recordsRaw?.records ?? []).slice().reverse().find(r => r.answer?.questions?.some(q => q.answered === false)) ?? null;
  const skippedEntry = recRaw?.answer?.questions?.find(q => q.answered === false) ?? null;
  const recordOk = recRaw && recRaw.gameId === 'pinyin-adventure' && recRaw.score === expectScore
    && recRaw.answer.questions.length === 5 && skippedEntry && skippedEntry.mode === 'listen' && skippedEntry.firstTry === false
    && recRaw.answer.questions.filter(q => q.answered && q.firstTry).length === answeredCount;
  await send('Fetch.disable');
  fetchFailArmed = false;
  const coinsAfter = await idbProfileSnapshot();
  const finalState = await pinyinState();
  const ok = swOff && skippedIndex !== null && singleNotice && recordOk
    && s5.resultScore === `总分 ${expectScore}`
    && s5.resultAnswer === `作答 ${answeredCount} 题 · 首答 ${answeredCount} · 重试 0 次 · 跳过 1 题`
    && coinsAfter?.coins === coinsBefore?.coins && finalState.errors.length === 0;
  record('FX2 M9-P5 重跑（降级单提示 + 跳过不计分）', ok,
    `注销 SW 并 ?nosw=1 重载（controller=${swOff ? 'null' : '存在'}），Fetch 拦截 *.wav；第 ${skippedIndex + 1} 题（听辨）播放 → Audio error（无 playing）→ audio-notice 降级提示出现，**feedback ${degradeState.feedbackHidden === true ? '保持隐藏' : `显示「${degradeState.feedback}」`}**——同屏仅一条提示（修复前 feedback 重复同文案）→ 跳过后其余 ${answeredCount} 题全部首答答对；结算「${s5.resultScore}」「${s5.resultAnswer}」；记录 score=${expectScore}、跳过题 answered=false（mode=listen、firstTry=false）=${recordOk}；金币 ${coinsBefore?.coins} = ${coinsAfter?.coins}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { swOff, skippedIndex, degradeFeedback: { hidden: degradeState.feedbackHidden, text: degradeState.feedback }, singleNotice, questions, expect: { score: expectScore }, result: { score: s5.resultScore, answer: s5.resultAnswer }, recordRaw: recRaw, coinsBefore, coinsAfter, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  try { await send('Fetch.disable'); } catch {}
  fetchFailArmed = false;
  record('FX2 M9-P5 重跑（降级单提示 + 跳过不计分）', false, `失败: ${e.message}`);
}

// ============================================================
// FX3 M8 抽验：hanzi.html 完整局——渲染序与内容原始序不同、
// 目标字/部件位置不恒定、按字身份判对、组字多选照常、结算正确、刷新恢复照常
//（含洗牌排列随快照恢复一致）。一年级池 28 题中仅 3 道组字题，单局随机抽可能
// 不含组字题：首局（含刷新恢复）后如未覆盖组字题则续局，最多 5 局。
// ============================================================
try {
  await goto(`${ORIGIN}hanzi.html`);
  await waitUntil(async () => { const s = await hanziState(); return s.selectVisible && s.bootFailHidden && s.gradeCards.length === 6 ? s : null; }, '汉字勇者选择屏就绪');
  const core = await installHanziCore();
  if (!core.statuses.every(x => x === 'approved')) throw new Error(`非 approved 题存在: ${JSON.stringify(core.statuses)}`);
  await evaluate(`(() => { const b = [...document.querySelectorAll('#grade-grid button')].find(x => x.textContent === '一年级');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); })()`, false);
  await sleep(200);
  const coinsBefore = await idbProfileSnapshot();
  const hanziRecordsList = rec => Array.isArray(rec?.recordsRaw) ? rec.recordsRaw : (rec?.recordsRaw?.records ?? []);
  const playHanziRound = async (roundNo, { withReload }) => {
    await click('#btn-start');
    const questions = [];
    let roundId = null;
    for (let i = 0; i < 5; i++) {
      const s = await waitUntil(async () => {
        const st = await hanziState();
        return st.gameVisible && st.hudProgress === `第 ${i + 1}/5 题`
          && st.snap?.state?.phase === 'asking' && st.snap?.state?.questionIndex === i
          && st.optionButtons.length ? st : null;
      }, `FX3 第 ${roundNo + 1} 局第 ${i + 1} 题可作答`);
      roundId = s.snap.roundId;
      const snapQ = s.snap.state.questions[i];
      const ex = await poolEntry('__hanziPool', snapQ.exerciseId);
      if (ex.status !== 'approved') throw new Error(`非 approved 题 ${ex.id}`);
      const domOpts = s.optionButtons.map(b => b.text);
      if (JSON.stringify(domOpts) !== JSON.stringify(snapQ.task.options)) throw new Error(`题 ${ex.id} DOM 候选与快照洗牌序不一致`);
      if (!permEq(domOpts, ex.options)) throw new Error(`题 ${ex.id} 渲染候选不是内容候选的排列`);
      // 经 dist 判题模块对洗牌后 task 自算正确选项（按字/部件集合身份）
      const correctTexts = await evaluate(`window.__correctTexts(${JSON.stringify(snapQ.task)})`);
      if (!correctTexts.length) throw new Error(`题 ${ex.id} 判题返回空`);
      const isParts = snapQ.task.kind === 'hanzi-parts';
      const targetIndex = Math.min(...correctTexts.map(t => domOpts.indexOf(t)).filter(x => x >= 0));
      questions.push({ id: ex.id, kind: ex.kind, domOptions: domOpts, originalOptions: ex.options, correctTexts, targetIndex });
      if (isParts) {
        if (roundNo === 0 || questions.filter(q => q.kind === 'hanzi-parts').length === 1) await shot('fx-3-04-parts-question');
        for (const text of correctTexts) {
          const idx = domOpts.indexOf(text);
          await trustedClick(`#options button:nth-of-type(${idx + 1})`);
          await sleep(120);
        }
        const pressed = await evaluate(`[...document.querySelectorAll('#options button')].filter(b => b.getAttribute('aria-pressed') === 'true').length`, false);
        if (pressed !== correctTexts.length) throw new Error(`组字题勾选数不符: ${pressed} vs ${correctTexts.length}`);
        await trustedClick('#btn-parts-submit');
      } else {
        await trustedClick(`#options button:nth-of-type(${domOpts.indexOf(correctTexts[0]) + 1})`);
      }
      const fb = await waitUntil(async () => { const st = await hanziState(); return st.feedbackHidden === false && (st.feedback ?? '').startsWith('✓') ? st.feedback : null; }, `FX3 第 ${roundNo + 1} 局第 ${i + 1} 题答对反馈`);
      if (!fb.includes('+10')) throw new Error(`首答加分异常: ${fb}`);
      if (withReload && i === 1) {
        // 答对 2 题后刷新：等推进到第 3 题（快照已按 asking/questionIndex=2 持久化），
        // 记录洗牌排列（快照内全部题目 options 序列）供恢复一致性比对
        await waitUntil(async () => { const st = await hanziState(); return st.hudProgress === '第 3/5 题' ? st : null; }, 'FX3 推进第 3 题');
        const pre = await hanziState();
        var preReload = { roundId: pre.snap.roundId, score: pre.snap.state.score, questionIndex: pre.snap.state.questionIndex,
          optionsPerQuestion: pre.snap.state.questions.map(q => [...q.task.options]) };
        await send('Page.reload', { ignoreCache: false });
        await waitUntil(async () => { const st = await hanziState(); return st.selectVisible && st.bootFailHidden ? st : null; }, 'FX3 刷新后选择屏', 40000).catch(async e => {
          const diag = await evaluate(`(() => ({ url: location.href, ready: document.readyState,
            select: !document.getElementById('screen-select')?.hidden,
            bootFailHidden: document.getElementById('boot-fail')?.hidden,
            errors: window.__errors ?? null }))()`, false).catch(err => ({ diagError: String(err) }));
          log('FX3 刷新后状态诊断:', JSON.stringify(diag));
          throw e;
        });
        const offerState = await waitUntil(async () => { const st = await hanziState(); return st.restoreOfferHidden === false ? st : null; }, 'FX3 刷新后恢复提供');
        await shot('fx-3-01-restore-offer');
        if (hanziRecordsList(offerState).length > 0) throw new Error('刷新后不应已有记录');
        await click('#btn-restore');
        await waitUntil(async () => { const st = await hanziState(); return st.gameVisible && st.hudProgress === '第 3/5 题' ? st : null; }, 'FX3 恢复到第 3 题');
        await sleep(300);
        const restored = await hanziState();
        await shot('fx-3-02-restored');
        const restoredSnap = restored.snap;
        if (restoredSnap.roundId !== preReload.roundId || restoredSnap.state.score !== preReload.score
          || restoredSnap.state.questionIndex !== preReload.questionIndex
          || JSON.stringify(restoredSnap.state.questions.map(q => [...q.task.options])) !== JSON.stringify(preReload.optionsPerQuestion)) {
          throw new Error('恢复后洗牌排列与刷新前不一致');
        }
        const domNow = restored.optionButtons.map(b => b.text);
        if (JSON.stringify(domNow) !== JSON.stringify(restoredSnap.state.questions[2].task.options)) throw new Error('恢复后 DOM 候选与快照不一致');
        await installHanziCore();
      } else if (i < 4) {
        await waitUntil(async () => { const st = await hanziState(); return st.hudProgress === `第 ${i + 2}/5 题` ? st : null; }, `FX3 第 ${roundNo + 1} 局推进第 ${i + 2} 题`);
      }
    }
    await waitUntil(async () => { const st = await hanziState(); return st.resultVisible ? st : null; }, `FX3 第 ${roundNo + 1} 局结算屏`);
    const sRes = await hanziState();
    if (roundNo === 0) await shot('fx-3-03-result');
    const resultOk = sRes.resultScore === '总分 50' && sRes.resultDetail === '首次答对 5/5 · 答错 0 次';
    await click('#btn-result-return');
    await waitUntil(async () => { const st = await hanziState(); return st.selectVisible ? st : null; }, `FX3 第 ${roundNo + 1} 局返回选择屏`);
    const rec = await hanziState();
    const list = hanziRecordsList(rec);
    const recRaw = list.find(r => r.id === roundId) ?? null;
    const recordOk = !!recRaw && recRaw.score === 50 && recRaw.firstTry === 5 && recRaw.wrong === 0
      && list.filter(r => r.id === roundId).length === 1;
    return { roundId, questions, preReload: typeof preReload !== 'undefined' ? preReload : null,
      resultScore: sRes.resultScore, resultDetail: sRes.resultDetail, resultOk, recordOk,
      partsCount: questions.filter(q => q.kind === 'hanzi-parts').length };
  };
  const rounds = [];
  let totalParts = 0;
  for (let r = 0; r < 5 && totalParts === 0; r++) {
    const res = await playHanziRound(r, { withReload: r === 0 });
    rounds.push(res);
    totalParts += res.partsCount;
  }
  const allQuestions = rounds.flatMap(x => x.questions);
  const allTargets = allQuestions.map(q => q.targetIndex);
  const distinctPositions = [...new Set(allTargets)];
  const shuffledCount = allQuestions.filter(q => JSON.stringify(q.domOptions) !== JSON.stringify(q.originalOptions)).length;
  const shuffleOk = distinctPositions.length >= 2 && allTargets.filter(x => x === 0).length <= allTargets.length / 2 && shuffledCount >= 1;
  const coinsAfter = await idbProfileSnapshot();
  const finalState = await hanziState();
  const ok = shuffleOk && totalParts >= 1 && rounds.every(x => x.resultOk && x.recordOk)
    && coinsAfter?.coins === coinsBefore?.coins && finalState.errors.length === 0;
  record('FX3 M8 抽验（hanzi 洗牌 + 身份判题 + 组字多选 + 刷新恢复）', ok,
    `共 ${rounds.length} 局（首局含刷新恢复；一年级池 28 题含 3 道组字题，单局随机抽可能不含，续局直至覆盖组字题）：组字多选共 ${totalParts} 题（勾选+「提交答案」）；渲染候选与内容原始序不同的题 ${shuffledCount}/${allQuestions.length}、正确选项位置分布 ${JSON.stringify(allTargets)}（不同位置 ${distinctPositions.length} 个、首位 ${allTargets.filter(x => x === 0).length} 题）——洗牌生效（修复前目标字/部件恒在首位）；每题经 /dist/learning/hanzi.js correctHanziIds 对洗牌后 task 自算正确选项（choose 按字身份、parts 按部件集合身份），全部首答 ✓+10；首局答对 2 题（20 分）后 Page.reload → 恢复提供 → 继续上局：roundId/得分/题目洗牌排列逐题与刷新前一致（洗牌结果随快照恢复）、DOM 候选与快照一致 → 续打 3 题；各局结算「总分 50」「首次答对 5/5 · 答错 0 次」${rounds.map(x => x.resultOk).every(Boolean) ? '全部吻合' : '存在不符'}；记录 id=roundId 恰 1 条、score=50、firstTry=5、wrong=0 ${rounds.map(x => x.recordOk).every(Boolean) ? '逐局成立' : '存在失败'}；金币 ${coinsBefore?.coins} = ${coinsAfter?.coins}；JS 错误 ${finalState.errors.length} 个`,
    { checks: { rounds: rounds.map(x => ({ roundId: x.roundId, partsCount: x.partsCount, questions: x.questions.map(q => ({ id: q.id, kind: q.kind, targetIndex: q.targetIndex, shuffled: JSON.stringify(q.domOptions) !== JSON.stringify(q.originalOptions) })), resultScore: x.resultScore, resultOk: x.resultOk, recordOk: x.recordOk })), allTargets, distinctPositions, shuffledCount, shuffleOk, totalParts, preReload: rounds[0].preReload, coinsBefore, coinsAfter, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('FX3 M8 抽验（hanzi 洗牌 + 身份判题 + 组字多选 + 刷新恢复）', false, `失败: ${e.message}`);
}

// ============================================================
// FX4 快速回归：数字消除选择屏正常 + dungeon.html 加载正常。
// ============================================================
try {
  await trustedClick('.profile-bar a.btn-ghost');
  const home = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible ? s : null;
  }, 'FX4 回到数字消除首页');
  await evaluate(`(() => { const el = document.querySelector('input[name="grade"][value="1"]');
    if (el && !el.checked) el.click(); })()`, false);
  await sleep(200);
  const npChecked = await homeState();
  await evaluate(`(() => { const el = document.querySelector('input[name="grade"][value="1"]');
    if (el && el.checked) el.click(); })()`, false);
  await sleep(200);
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.pinyinAnchorVisible ? s : null; }, 'FX4 菜单');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const ds = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible && s.gradeCards === 6 ? s : null;
  }, 'FX4 地下城加载');
  await trustedClick('.profile-bar a.btn-ghost');
  const backHome = await waitUntil(async () => {
    const s = await homeState();
    return new URL(s.url).pathname === '/' && s.selectVisible ? s : null;
  }, 'FX4 地下城返回首页');
  const finalHome = await homeState();
  const ok = npChecked.btnToAvailabilityDisabled === false && ds.selectVisible && ds.gradeCards === 6
    && backHome.selectVisible && finalHome.errors.length === 0 && ds.errors.length === 0;
  record('FX4 快速回归（数字消除 + 地下城）', ok,
    `数字消除选择屏勾一年级→下一步可用（数学题无选项卡，不受洗牌修复影响，再取消复原）；菜单进 dungeon.html 正常加载（6 年级卡、boot-fail 隐藏）→返回锚点回首页；JS 错误 0`,
    { checks: { npOk: npChecked.btnToAvailabilityDisabled === false, dungeon: { gradeCards: ds.gradeCards, title: ds.title }, overflow: finalHome.overflowX, errors: { home: finalHome.errors, dungeon: ds.errors } } });
} catch (e) {
  record('FX4 快速回归（数字消除 + 地下城）', false, `失败: ${e.message}`);
}

// ============================================================
// FX5 贯穿：无横向溢出、JS 错误 0（汇总各场景）。
// ============================================================
try {
  const overflowBad = scenarios.filter(s => (s.checks?.overflow === true));
  const errorBad = scenarios.filter(s => (s.checks?.errors && ((Array.isArray(s.checks.errors) ? s.checks.errors : Object.values(s.checks.errors).flat()).length > 0)));
  const ua = await evaluate('navigator.userAgent', false).catch(() => null);
  const viewport = await evaluate('({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })', false).catch(() => null);
  const ok = overflowBad.length === 0 && errorBad.length === 0;
  record('FX5 贯穿（横向溢出与 JS 错误）', ok,
    `复验全程 ${scenarios.length - 1} 个场景均无横向溢出（溢出场景：${overflowBad.map(s => s.name).join('、') || '无'}）、均无 JS 错误（报错场景：${errorBad.map(s => s.name).join('、') || '无'}）；UA=${ua}`,
    { checks: { userAgent: ua, viewport, horizontalOverflowScenarios: overflowBad.map(s => s.name), jsErrorScenarios: errorBad.map(s => s.name) } });
} catch (e) {
  record('FX5 贯穿（横向溢出与 JS 错误）', false, `失败: ${e.message}`);
}

// ===== 汇总：fixVerification 合入 pinyin-browser-results.json =====
const swVersion = await evaluate(`(async () => {
  try { const t = await fetch('/sw.js').then(r => r.text());
    const m = t.match(/APP_VERSION = "([^"]+)"/); return m ? m[1] : null; } catch { return null; }
})()`).catch(() => null);
const fixVerification = {
  executedAt: new Date().toISOString(),
  purpose: '缺陷修复合并复验轮：M9 ①组卷洗牌 ②降级提示去重 + M8 hanzi-hero 同款洗牌',
  script: 'pinyin-fix-verify.mjs',
  buildVersion: swVersion,
  fixes: {
    m9Shuffle: 'src/game/pinyin-adventure/rules.ts createRound 以局内 rng 洗每题 options（随 RoundState/快照恢复）',
    m9SingleNotice: 'src/game/pinyin-adventure/main.ts onPlay 降级只置 audioUnavailable（audio-notice 呈现），不再写 feedback',
    m8Shuffle: 'src/game/hanzi-hero/rules.ts createRound 同款洗牌（choose+parts 同路径，判题按字/部件集合身份，内容数据零改动）',
  },
  npmCheck: { rerun: true, result: '167 项通过（含新增 hanzi-hero 洗牌与 offline 测试更新）' },
  scenarios,
  allPassed: scenarios.every(s => s.pass),
};
const resultsPath = `${outDir}/pinyin-browser-results.json`;
const existing = JSON.parse(await readFile(resultsPath, 'utf8'));
existing.fixVerification = fixVerification;
await writeFile(resultsPath, JSON.stringify(existing, null, 2));
log('fixVerification 已合入', resultsPath);
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(fixVerification.allPassed ? 0 : 1);
