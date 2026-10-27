// Android 模拟器 Chrome 验证（M9 拼音冒险，口径对齐 M12/M8 device-simulators/android-round.mjs，
// 拼音玩法断言对齐 M9 桌面 pinyin-browser.mjs / pinyin-fix-verify.mjs 的状态机断言）。
// CDP 走 browser 级 endpoint + Target.attachToTarget(flatten)（per-page WebSocket 在本机
// Chrome 113 握手成功但命令可能无响应，先例 m8/production/android-prod-smoke.mjs）。
// 输入全部为 Input.dispatchTouchEvent 真实触摸；辨认/听辨候选均为真实触摸点击。
// 模拟器无声输出：音频断言全部基于状态机——页面注入 Audio 构造器包装（canplay/playing/error
// 事件台账）+ CDP Network 域记录 /audio/pinyin/ 响应 + CacheStorage 命中 200，不做声音主观判断。
// 答案一律从页面题面（#q-prompt 的 dataset.exerciseId）经 dist 判题模块
// （selectPinyinExercises + correctPinyinAnswer）自算，不注入任何游戏状态。
// 覆盖：S1 在线完整局（菜单「拼音冒险」入口、5 题混合局：辨认真实触摸 + 听辨播放后作答
// （断言 ≥1 次 Audio playing 且请求 200/缓存命中）、第 2 题故意答错→「再试一次」重试档 +5、
// 结算与逐题档位吻合、记录 gameId=pinyin-adventure 且辨认/听辨 mode 分开、金币零变化）
// → S2 返回路径与四入口并存（「返回数字消除」→ 数字消除可选年级；菜单三游戏锚点 + 当前页）
// → S3 离线（SW 就绪→杀源→刷新，首页与 /pinyin.html 由缓存打开，断网完成含听辨播放的整局）
// → S4 贯穿（横向溢出与 JS 错误台账）。
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
const networkAudio = [];   // /audio/pinyin/ 响应台账（CDP Network 域）
const networkFailed = [];  // /audio/pinyin/ 加载失败台账
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
    if (m.method === 'Network.responseReceived') {
      const url = m.params?.response?.url ?? '';
      if (url.includes('/audio/pinyin/')) {
        networkAudio.push({ url, status: m.params.response.status, fromDiskCache: m.params.response.fromDiskCache ?? null });
      }
    } else if (m.method === 'Network.loadingFailed') {
      // loadingFailed 不带 URL，只在音频请求侧记数（errorText 供诊断）。
      networkFailed.push({ errorText: m.params?.errorText ?? '', canceled: m.params?.canceled ?? null });
    }
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
  await send('Network.enable');
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
// 元素重建类坑：点击前逐次重查位置（M7/M8/M12 口径）。
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

// ===== 页面注入（JS 错误台账 + Audio 状态机包装）=====
// Audio 包装：游戏每次播放都 new Audio(url)（无预建实例），注入后所有游戏音频实例均被记录。
const INJECT_SOURCE = `
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
  })();`;

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
    pinyinAnchor: anchor('#main-nav a[href="/pinyin.html"]'),
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
  // 听辨题面泄露扫描：题头/题面/播放区/倒计时不出现任何拉丁字母或 ü（候选卡除外，候选本就展示字形）。
  const leakScan = (() => {
    if (hidden('question-card')) return null;
    const listen = !hidden('play-group');
    if (!listen) return { listen: false, leaked: null };
    const zones = ['q-title', 'q-prompt', 'play-group', 'countdown'].map(id => t(id)).join(' ');
    const m = zones.match(/[a-zü]/i);
    return { listen: true, leaked: m ? m[0] : null, zones };
  })();
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
    qTitle: t('q-title'),
    countdown: t('countdown'),
    prompt: t('q-prompt'),
    promptExerciseId: document.getElementById('q-prompt')?.dataset.exerciseId ?? null,
    playGroupHidden: hidden('play-group'),
    btnPlayDisabled: document.getElementById('btn-play')?.disabled,
    btnPlayText: t('btn-play'),
    audioNoticeHidden: hidden('audio-notice'),
    audioNoticeText: t('audio-notice'),
    optionButtons: [...document.querySelectorAll('#options button')].map(b => ({
      text: b.textContent, disabled: b.disabled })),
    feedbackHidden: hidden('feedback'),
    feedback: t('feedback'),
    retryHidden: hidden('btn-retry-attempt'),
    skipHidden: hidden('btn-skip'),
    pauseOverlayHidden: hidden('pause-overlay'),
    resultScore: t('result-score'),
    resultAnswer: t('result-answer'),
    resultModes: t('result-modes'),
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    leakScan, snap, recordsRaw, recentIds,
    audioLog: (window.__audioLog ?? []).map(r => ({ url: r.url, events: r.events.map(e => e.ev), currentTimeAtPlaying: r.currentTimeAtPlaying, errorDetail: r.errorDetail })),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
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
const installPinyinPool = () => evaluate(`(async () => {
  const { selectPinyinExercises } = await import('/dist/game/pinyin-adventure/content.js');
  const { correctPinyinAnswer } = await import('/dist/learning/pinyin.js');
  const picked = selectPinyinExercises([1]);
  window.__pool = picked.map(e => ({ id: e.id, status: e.review.status, kind: e.task.kind,
    letter: correctPinyinAnswer(e.task), options: [...e.task.options], audio: e.task.audio ?? null, prompt: e.task.prompt }));
  const kinds = picked.reduce((acc, e) => { acc[e.task.kind] = (acc[e.task.kind] ?? 0) + 1; return acc; }, {});
  return { count: picked.length, kinds, statuses: [...new Set(picked.map(e => e.review.status))] };
})()`).then(info => {
  log('正式池:', JSON.stringify(info));
  return info;
});
const syncPool = async () => {
  const pool = await evaluate(`window.__pool`, false);
  if (!Array.isArray(pool) || !pool.length) throw new Error('正式池索引为空');
  POOL_BY_ID = Object.fromEntries(pool.map(p => [p.id, p]));
  return pool.length;
};

// ===== 触摸作答辅助 =====
// 点击某个候选（按字母文本找按钮，真实触摸）。
const clickOption = async text => {
  const found = await waitUntil(async () => {
    const rect = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('#options button')];
      const b = btns.find(x => x.textContent === ${JSON.stringify(text)});
      if (!b || b.disabled) return null; const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, false);
    if (!rect) return null;
    await tap(rect.x, rect.y);
    return true;
  }, `候选「${text}」可点`, 6000);
  return found;
};

// 播放一次听辨音频：真实点击播放钮 → 等待 Audio 实例出现 → 等待 playing（或 error）。
// 注意：waitUntil 只接受 truthy 返回值，实例索引 0 须包成对象返回（桌面第 4 轮教训）。
const playAudio = async () => {
  const before = await evaluate('window.__audioLog?.length ?? -1', false);
  await clickAt('#btn-play');
  let idx = null;
  try {
    idx = await waitUntil(async () => {
      const n = await evaluate('window.__audioLog?.length ?? -1', false);
      return n > before ? { idx: n - 1 } : null;
    }, 'Audio 实例创建', 6000).then(v => v.idx);
  } catch (e) {
    const diag = await pinyinState().catch(err => ({ diagError: String(err) }));
    throw new Error(`播放点击未产生 Audio 实例（诊断: ${JSON.stringify({ before, audioLog: diag.audioLog, btnPlayDisabled: diag.btnPlayDisabled, btnPlayText: diag.btnPlayText, playGroupHidden: diag.playGroupHidden, pauseOverlayHidden: diag.pauseOverlayHidden })}）: ${e.message}`);
  }
  const rec = await waitUntil(async () => {
    const logArr = await evaluate(`window.__audioLog[${idx}] ? { url: window.__audioLog[${idx}].url, events: window.__audioLog[${idx}].events, currentTimeAtPlaying: window.__audioLog[${idx}].currentTimeAtPlaying, errorDetail: window.__audioLog[${idx}].errorDetail } : null`, false);
    return logArr && logArr.events.some(e => e.ev === 'playing' || e.ev === 'error') ? logArr : null;
  }, 'playing/error 事件', 6000);
  await sleep(150);
  return { idx, rec: { ...rec, events: rec.events.map(e => e.ev) } };
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

// ===== 题目推进辅助 =====
const handlePauseIfAny = async () => {
  const s = await pinyinState();
  if (s.pauseOverlayHidden === false) { await clickAt('#btn-resume'); await sleep(500); return true; }
  return false;
};
// waitQuestion 轮询采样（诊断用，记录最后一次未命中时的关键字段）
const qDiag = {};
const waitQuestion = (index, desc = `第 ${index + 1} 题可作答`) => waitUntil(async () => {
  await wakeUp();
  await handlePauseIfAny();
  const s = await pinyinState();
  Object.assign(qDiag, {
    gameVisible: s.gameVisible, questionVisible: s.questionVisible,
    hudProgress: s.hudProgress, countdown: s.countdown,
    optionCount: s.optionButtons.length, anyDisabled: s.optionButtons.some(b => b.disabled),
    selectVisible: s.selectVisible, resultVisible: s.resultVisible,
    pauseOverlayHidden: s.pauseOverlayHidden, feedback: s.feedback,
  });
  if (!s.gameVisible || !s.questionVisible) return null;
  if (s.hudProgress !== `第 ${index + 1}/5 题`) return null;
  if (!(s.countdown ?? '').startsWith('剩余')) return null;
  if (!s.optionButtons.length || s.optionButtons.some(b => b.disabled)) return null;
  return s;
}, desc, 15000);
const waitRetryState = () => waitUntil(async () => {
  const s = await pinyinState();
  return s.gameVisible && s.questionVisible && s.feedbackHidden === false
    && (s.feedback ?? '').startsWith('✗') && s.retryHidden === false ? s : null;
}, '答错待再试状态');
const waitResult = () => waitUntil(async () => {
  await wakeUp();
  await handlePauseIfAny();
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
}, `勾选年级 ${name}`, 12000);
async function discardPinyinResidue() {
  const s = await pinyinState();
  if (s.restoreOfferHidden === false) {
    log('发现拼音残留中断局，放弃之');
    await clickAt('#btn-discard-round');
    await sleep(600);
    await clickAt('#btn-confirm-yes');
    await waitUntil(async () => (await pinyinState()).restoreOfferHidden, '残留局清理', 8000);
  }
}

// 作答当前题：读题面 exerciseId → 池内自算答案 → （听辨先播放）→ 点击候选。
// wrongFirst=true 时先点错误候选（验证 ✗ + 重试档），再点「再试一次」→ 点正确候选。
async function answerCurrent({ index, wrongFirst = false, needPlay = true, onRetryState = null }) {
  const st = await pinyinState();
  const id = st.promptExerciseId;
  const task = POOL_BY_ID[id];
  if (!task) throw new Error(`题面 exerciseId 未在正式池匹配: ${id}`);
  if (task.status !== 'approved') throw new Error(`非 approved 题 ${id}: ${task.status}`);
  const isListen = task.kind === 'pinyin-listen';
  if ((st.playGroupHidden === false) !== isListen) {
    throw new Error(`播放区显示与题型不符: id=${id} kind=${task.kind} playGroupHidden=${st.playGroupHidden}`);
  }
  const leakOk = isListen ? st.leakScan?.leaked === null : true;
  let play = null, cache = null, netOk = null;
  if (isListen && needPlay) {
    play = await playAudio();
    if (!play.rec.events.includes('playing')) {
      throw new Error(`听辨播放未进入 playing（errorDetail=${play.rec.errorDetail}, events=${JSON.stringify(play.rec.events)}）`);
    }
    if (!play.rec.url.endsWith(task.audio ?? '__none__')) {
      throw new Error(`播放 URL 与题库音频不一致: ${play.rec.url} ≠ ${task.audio}`);
    }
    cache = await cacheHitFor(`/audio/pinyin/${(task.audio ?? '').split('/').pop()}`);
  }
  const wrongText = task.options.find(o => o !== task.letter);
  const steps = { wrongClicked: null, retryClicked: false };
  if (wrongFirst) {
    if (wrongText === undefined) throw new Error(`题 ${id} 无可用错误候选`);
    await clickOption(wrongText);
    const retry = await waitRetryState();
    if (retry.hudScore !== `得分 ${expectedScore}`) {
      throw new Error(`答错后得分变动: ${retry.hudScore} ≠ 得分 ${expectedScore}`);
    }
    if (onRetryState) await onRetryState(retry);
    await clickAt('#btn-retry-attempt');
    steps.retryClicked = true;
    await waitQuestion(index, `重试后第 ${index + 1} 题重新计时`);
  }
  await clickOption(task.letter);
  const landed = await waitUntil(async () => {
    await handlePauseIfAny();
    const s = await pinyinState();
    return s.gameVisible && s.feedbackHidden === false && (s.feedback ?? '').startsWith('✓') ? s : null;
  }, '答对反馈出现', 8000);
  const m = (landed.feedback ?? '').match(/答对了 \+(\d+)/);
  const gained = m ? Number(m[1]) : null;
  return { id, task, isListen, play, cache, leakOk, wrongFirst, retryClicked: steps.retryClicked,
    wrongText: wrongFirst ? wrongText : null, gained, feedback: landed.feedback };
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

// 完成一局（5 题）。wrongIndex: 故意答错的题下标（null = 全部首答）。
// 返回逐题记录与音频汇总。
async function playRound({ wrongIndex = null, needPlay = true, shots = {} }) {
  const questions = [];
  let chooseShot = false, listenShot = false, retryShot = false;
  expectedScore = 0;
  const snap0 = (await pinyinState()).snap;
  const roundId = snap0?.roundId ?? null;
  for (let i = 0; i < 5; i++) {
    const st = await waitQuestion(i).catch(e => { throw new Error(`${e.message} [waitQuestion 末次观察: ${JSON.stringify(qDiag)}]`); });
    const id = st.promptExerciseId;
    const isListen = POOL_BY_ID[id]?.kind === 'pinyin-listen';
    if (isListen && !listenShot && shots.listen) { await shot(shots.listen); listenShot = true; }
    if (!isListen && !chooseShot && shots.choose) { await shot(shots.choose); chooseShot = true; }
    const a = await answerCurrent({ index: i, wrongFirst: i === wrongIndex, needPlay,
      onRetryState: shots.retry ? async () => { if (!retryShot) { await shot(shots.retry); retryShot = true; } } : null });
    if (a.gained === null) throw new Error(`答对反馈未解析出得分: ${a.feedback}`);
    expectedScore += a.gained;
    questions.push({
      index: i, id, kind: a.task.kind, isListen: a.isListen, mode: a.isListen ? 'listen' : 'choose', prompt: a.task.prompt,
      audio: a.task.audio ?? null, letter: a.task.letter,
      playUrl: a.play?.rec.url ?? null, playEvents: a.play?.rec.events ?? null,
      cacheHit: a.cache ?? null, leakOk: a.leakOk,
      wrongFirst: a.wrongFirst, retryClicked: a.retryClicked, wrongText: a.wrongText,
      gained: a.gained, feedback: a.feedback,
    });
    log(`第 ${i + 1} 题 ${a.isListen ? '听辨' : '辨认'} ${id} → ${a.feedback}（累计 ${expectedScore}）`);
    if (i === 4) { await waitResult(); }
  }
  const played = questions.filter(q => q.isListen);
  return { roundId, questions, expectedScore,
    playedCount: played.filter(q => (q.playEvents ?? []).includes('playing')).length };
}

// ============================================================
// 主流程
// ============================================================
await connect();
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT_SOURCE });
await wakeUp(true);

if (phase === 'offline') {
  // ===== S3 离线：SW 就绪 → 杀源 → 刷新 → 缓存打开 → 断网完成整局（含听辨播放缓存命中）=====
  let s3 = null;
  try {
    await send('Page.navigate', { url: `${ORIGIN}/` });
    await sleep(2000);
    await wakeUp(true);
    await waitUntil(async () => (await homeState()).selectVisible, '在线末尾首页选择屏', 30000);
    // SW 就绪：受控且缓存含 /pinyin.html 与拼音音频（新版本未接管时刷新促成 activate；
    // skip-waiting 由数字消除选择屏在无进行中局次时发送）。
    let swInfo = null;
    for (let i = 0; i < 6 && !swInfo; i++) {
      swInfo = await waitUntil(async () => evaluate(`(async () => {
        if (navigator.serviceWorker.controller === null) return null;
        const keys = await caches.keys();
        const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
        if (!name) return null;
        const cache = await caches.open(name);
        const pinyin = await cache.match('/pinyin.html');
        const pinyinCss = await cache.match('/pinyin.css');
        const mainJs = await cache.match('/dist/game/pinyin-adventure/main.js');
        const audio = await cache.match('/audio/pinyin/b.wav');
        if (!pinyin || !pinyinCss || !mainJs || !audio) return null;
        let audioCount = 0;
        const keysInCache = await cache.keys();
        for (const k of keysInCache) if (k.url.includes('/audio/pinyin/')) audioCount += 1;
        return { name, pinyinCached: true, pinyinCssCached: true, mainJsCached: true, audioCached: audio.status, audioCount };
      })()`), 'SW 就绪且缓存含 /pinyin.html 与拼音音频', 15000).catch(() => null);
      if (!swInfo) {
        log(`SW 未就绪（第 ${i + 1} 次），刷新促成新版本接管`);
        await send('Page.reload', { ignoreCache: false });
        await sleep(2500);
        await waitUntil(async () => (await homeState()).selectVisible, '重载后首页选择屏', 30000);
      }
    }
    if (!swInfo) throw new Error('SW 未就绪（缓存缺 /pinyin.html 或拼音音频）');
    log('SW:', JSON.stringify(swInfo));
    await checkpoint('S3-SW就绪首页(在线)');
    // 杀源站（若先前场景已断源则 pkill 无进程）。
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
    // 菜单 → 拼音冒险（缓存打开）
    await clickAt('#btn-menu');
    await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen && h.pinyinAnchor?.visible ? h : null; }, '断源后菜单');
    await clickAt('#main-nav a[href="/pinyin.html"]');
    await waitUntil(async () => { const s = await pinyinState(); return s.url === '/pinyin.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '断源后拼音冒险由缓存打开', 30000);
    const poolInfo = await installPinyinPool().catch(e => { throw new Error(`断网下题库模块 import 失败（SW 闭包不全）: ${e.message}`); });
    await syncPool();
    await checkpoint('S3-离线拼音选择屏');
    await shot('android-offline-02-pinyin-select');
    await discardPinyinResidue();
    await toggleGrade('一年级', true);
    const avail = (await pinyinState()).availabilityStatus;
    log('离线可用性文案:', avail);
    await clickAt('#btn-start');
    const coinsBeforeOff = await idbProfileSnapshot();
    const played = await playRound({ wrongIndex: null, needPlay: true,
      shots: { listen: 'android-offline-03-offline-listen' } });
    await shot('android-offline-04-offline-result');
    const res = await pinyinState();
    // 断网下播放必须全部缓存命中（playing + CacheStorage 命中 200；源站已死，200 只能来自缓存）。
    const listenQuestions = played.questions.filter(q => q.isListen);
    const offlinePlayOk = listenQuestions.length > 0
      && listenQuestions.every(q => (q.playEvents ?? []).includes('playing') && q.cacheHit?.status === 200);
    if (!offlinePlayOk) throw new Error(`断网听辨播放/缓存命中断言失败: ${JSON.stringify(listenQuestions.map(q => ({ audio: q.audio, events: q.playEvents, cache: q.cacheHit })))}`);
    const scoreOk = res.resultScore === `总分 ${played.expectedScore}` && played.expectedScore === 50;
    const answerOk = res.resultAnswer === '作答 5 题 · 首答 5 · 重试 0 次';
    log(`断网结算: ${res.resultScore} ${res.resultAnswer} ${res.resultModes}`);
    await checkpoint('S3-离线结算屏');
    await clickAt('#btn-result-return');
    await waitUntil(async () => (await pinyinState()).selectVisible, '断网结算返回选择屏');
    const rec = await pinyinState();
    const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === played.roundId) ?? null;
    const recOk = recRaw && recRaw.gameId === 'pinyin-adventure' && recRaw.score === 50
      && recRaw.answer?.questions?.length === 5
      && recRaw.answer.questions.every(q => q.answered === true && q.firstTry === true)
      && rec.records.some(r => r.includes('50 分 · 首答 5/5'));
    const recentOk = Array.isArray(rec.recentIds) && recRaw
      && recRaw.answer.questions.every(q => rec.recentIds.includes(q.exerciseId));
    const snapCleared = (await pinyinState()).snap === null;
    await clickAt('.profile-bar a.btn-ghost');
    await waitUntil(async () => { const h = await homeState(); return h.url === '/' && h.selectVisible ? h : null; }, '断网返回首页', 30000);
    await checkpoint('S3-离线返回首页');
    const coinsAfterOff = await idbProfileSnapshot();
    s3 = { swInfo, sourceDead, serverWasAlive, poolInfo, avail, offAttempts: 1,
      offlinePlayOk, listenQuestions: listenQuestions.map(q => ({ id: q.id, audio: q.audio, url: q.playUrl, events: q.playEvents, cache: q.cacheHit })),
      result: { score: res.resultScore, answer: res.resultAnswer, modes: res.resultModes },
      scoreOk, answerOk, roundId3: played.roundId, recRaw, recOk, recentOk, snapCleared,
      coins: [coinsBeforeOff?.coins, coinsAfterOff?.coins] };
    record('S3 离线断源（缓存打开 + 断网完成整局含听辨播放缓存命中）',
      sourceDead && poolInfo.count > 0 && offlinePlayOk && scoreOk && answerOk && recOk && recentOk
        && snapCleared && coinsAfterOff?.coins === coinsBeforeOff?.coins,
      `SW ${swInfo.name} 受控且预缓存含 /pinyin.html（含 /pinyin.css、拼音 dist 模块、音频 ${swInfo.audioCount} 条，/audio/pinyin/b.wav 命中 status=${swInfo.audioCached}）；${serverWasAlive ? '杀 serve 4273（源站 fetch 确认失败）后' : '源站已在先前场景断开'}刷新同一标签页：首页由缓存打开；菜单进 /pinyin.html 由缓存正常加载（6 年级卡、boot-fail 隐藏）；断网下题库模块经 SW 预缓存 import 成功（${poolInfo.count} 题）；选一年级（${avail}）完成断网整局 5 题（辨认 ${played.questions.filter(q => !q.isListen).length} + 听辨 ${listenQuestions.length}）：${listenQuestions.map(q => `听辨 ${q.audio} playing 事件触发（${(q.playEvents ?? []).join('/')}）且 CacheStorage 命中 200（${q.cacheHit?.cache}）`).join('；')}，全部首答答对，结算「${res.resultScore}」「${res.resultAnswer}」（断网听辨播放走通且缓存命中成立）；离线练习记录新增 1 条（gameId=${recRaw?.gameId}、score=50、5 题全 firstTry）且列表显示「50 分 · 首答 5/5」；recent-ids 含本局全部题目 ID；结算返回后中断快照清除；离线金币 ${coinsBeforeOff?.coins} = ${coinsAfterOff?.coins}（零收支）；返回首页正常；全程 JS 错误 0、无横向溢出`,
      { checks: s3 });
  } catch (e) {
    record('S3 离线断源（缓存打开 + 断网完成整局含听辨播放缓存命中）', false, `失败: ${e.message}`);
  }
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, errorLedger, overflowLedger,
    networkAudio, networkFailed, allPassed: scenarios.every(s => s.pass) };
  await writeFile(join(outDir, 'android-offline-results.json'), JSON.stringify(summary, null, 2));
  log('结果已写入 android-offline-results.json');
  log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
  ws.close();
  process.exit(process.exitCode = summary.allPassed ? 0 : 1);
}

// ===== S1+S2 在线 =====
let s1 = null, s2 = null;
try {
  await send('Page.navigate', { url: `${ORIGIN}/` });
  await sleep(2500);
  await wakeUp(true);
  await waitUntil(async () => { const h = await homeState(); return h.selectVisible && !h.errorVisible ? h : null; }, '首页选择屏出现', 30000);
  await checkpoint('S1-在线首页');
  await shot('android-online-01-home');
  const coinsBefore = await idbProfileSnapshot();
  log(`IndexedDB 档案局前: coins=${coinsBefore?.coins} records=${coinsBefore?.records} revision=${coinsBefore?.revision}`);

  // S1a：首页菜单「拼音冒险」入口（四入口菜单：数字消除当前页 + 三游戏锚点）
  await clickAt('#btn-menu');
  await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen && h.pinyinAnchor?.visible ? h : null; }, '菜单弹层打开');
  const menu = await homeState();
  await shot('android-online-02-home-menu');
  const entryOk = menu.pinyinAnchor.href === '/pinyin.html' && (menu.pinyinAnchor.text ?? '').includes('拼音冒险')
    && menu.pinyinAnchor.decorAriaHidden === 'true' && menu.hanziAnchor?.visible && menu.dungeonAnchor?.visible;
  if (!entryOk) throw new Error(`菜单入口异常: ${JSON.stringify({ pinyin: menu.pinyinAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor })}`);
  // 进入 pinyin.html
  await clickAt('#main-nav a[href="/pinyin.html"]');
  await waitUntil(async () => { const s = await pinyinState(); return s.url === '/pinyin.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '拼音冒险选择屏就绪', 30000);
  await checkpoint('S1-拼音选择屏');
  const poolInfo = await installPinyinPool();
  await syncPool();
  await shot('android-online-03-pinyin-select');
  await discardPinyinResidue();
  const g1 = await toggleGrade('一年级', true);
  const expectAvail = `本局题库：一年级 ${poolInfo.count} 道，共 ${poolInfo.count} 道`;
  if (g1.availabilityStatus !== expectAvail) throw new Error(`可用性文案异常: ${g1.availabilityStatus}`);
  log('可用性文案:', g1.availabilityStatus);
  if (g1.storageNoticeHidden !== true) throw new Error('存储不可用提示意外出现');
  const backLink = (await pinyinState()).backLink;
  if (backLink?.href !== '/' || !backLink.text.includes('返回数字消除')) throw new Error(`返回链接异常: ${JSON.stringify(backLink)}`);

  // S1b：完整局 5 题（第 2 题故意答错 → 再试一次 → 重试档 +5；听辨播放后作答）
  await clickAt('#btn-start');
  const played = await playRound({ wrongIndex: 1, needPlay: true,
    shots: { choose: 'android-online-04-choose-question', listen: 'android-online-05-listen-question', retry: 'android-online-06-wrong-retry' } });
  await shot('android-online-07-result');
  const res = await pinyinState();
  const listenQuestions = played.questions.filter(q => q.isListen);
  const chooseQuestions = played.questions.filter(q => !q.isListen);
  if (listenQuestions.length < 2) throw new Error(`听辨题数不足 2: ${listenQuestions.length}`);
  const modesExpected = `辨认 ${chooseQuestions.filter(q => !q.wrongFirst).length}/${chooseQuestions.length} 题首答`
    + ` · 听辨 ${listenQuestions.filter(q => !q.wrongFirst).length}/${listenQuestions.length} 题首答`;
  const scoreOk = res.resultScore === `总分 ${played.expectedScore}`;
  const answerOk = res.resultAnswer === '作答 5 题 · 首答 4 · 重试 1 次';
  const modesOk = res.resultModes === modesExpected;
  if (!scoreOk || !answerOk || !modesOk) {
    throw new Error(`结算不符: ${res.resultScore} / ${res.resultAnswer} / ${res.resultModes}（期望 ${played.expectedScore} / 作答 5 题 · 首答 4 · 重试 1 次 / ${modesExpected}）`);
  }
  // 音频断言：≥1 次 playing；请求 200（CDP Network）或 CacheStorage 命中 200；播放 URL 与题库一致。
  const playedOk = played.playedCount >= 1
    && listenQuestions.every(q => q.playUrl?.endsWith(q.audio));
  const net200 = networkAudio.filter(r => r.status === 200);
  const cacheHits = listenQuestions.map(q => q.cacheHit).filter(Boolean);
  const reqOk = net200.length > 0 || cacheHits.some(c => c.status === 200);
  const leakOk = listenQuestions.every(q => q.leakOk);
  if (!playedOk) throw new Error(`听辨 playing 断言失败: ${JSON.stringify(listenQuestions.map(q => ({ audio: q.audio, events: q.playEvents })))}`);
  if (!reqOk) throw new Error(`音频请求 200 断言失败（CDP=${JSON.stringify(networkAudio)} 缓存命中=${JSON.stringify(cacheHits)}）`);
  if (!leakOk) throw new Error('听辨题面泄露扫描失败');
  const wrongQ = played.questions[1];
  if (!wrongQ.wrongFirst || wrongQ.gained !== 5) throw new Error(`重试档验证失败: ${JSON.stringify(wrongQ)}`);
  if (played.questions.filter(q => !q.wrongFirst).some(q => q.gained !== 10)) throw new Error('首答档非 +10');
  await checkpoint('S1-结算屏');
  // 记录核对（gameId 区分 + 辨认/听辨 mode 分开）
  await clickAt('#btn-result-return');
  await waitUntil(async () => (await pinyinState()).selectVisible, '返回选择屏');
  const rec = await pinyinState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === played.roundId) ?? null;
  const modesSequenceOk = recRaw && played.questions.every((q, i) => {
    const r = recRaw.answer?.questions?.[i];
    return r && r.exerciseId === q.id && r.mode === q.mode && r.answered === true
      && r.firstTry === !q.wrongFirst && r.wrongs === (q.wrongFirst ? 1 : 0);
  });
  const recOk = recRaw && recRaw.gameId === 'pinyin-adventure' && recRaw.score === played.expectedScore
    && recRaw.answer?.questions?.length === 5 && modesSequenceOk
    && rec.records.some(r => r.includes(`${played.expectedScore} 分 · 首答 4/5`));
  const recentOk = Array.isArray(rec.recentIds) && recRaw && recRaw.answer.questions
    .every(q => rec.recentIds.includes(q.exerciseId));
  const coinsAfter = await idbProfileSnapshot();
  const coinsOk = coinsAfter?.coins === coinsBefore?.coins;
  await shot('android-online-08-records');
  await checkpoint('S1-记录列表');
  const allApproved = played.questions.every(q => POOL_BY_ID[q.id]?.status === 'approved');
  s1 = { entry: { pinyin: menu.pinyinAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor },
    availability: g1.availabilityStatus, poolCount: poolInfo.count, roundId: played.roundId,
    play: played.questions.map(q => ({ index: q.index, id: q.id, mode: q.mode, prompt: q.prompt,
      audio: q.audio, letter: q.letter, playEvents: q.playEvents, cacheHit: q.cacheHit,
      wrongFirst: q.wrongFirst, gained: q.gained, leakOk: q.leakOk })),
    result: { score: res.resultScore, answer: res.resultAnswer, modes: res.resultModes },
    audio: { playedCount: played.playedCount, networkAudio, cacheHits },
    recOk, recentOk, modesSequenceOk, coinsBefore, coinsAfter, coinsOk, allApproved,
    errors: rec.errors, overflow: rec.overflowX };
  record('S1 在线完整局（辨认真实触摸 + 听辨播放后作答 + 第 2 题答错重试档）',
    scoreOk && answerOk && modesOk && recOk && recentOk && coinsOk && allApproved && playedOk && reqOk && leakOk
      && rec.errors.length === 0 && !rec.overflowX,
    `菜单「拼音冒险」入口（href=/pinyin.html、装饰字 aria-hidden，与汉字勇者/算术地下城锚点并存）进入拼音冒险；勾一年级→「${g1.availabilityStatus}」与 dist 层一致（${poolInfo.count} 题全 approved：辨认 ${poolInfo.kinds['pinyin-choose']} + 听辨 ${poolInfo.kinds['pinyin-listen']}）；完整局 5 题（辨认 ${chooseQuestions.length} + 听辨 ${listenQuestions.length}，题目 ${played.questions.map(q => q.id).join('、')}）：${played.questions.map(q => `第 ${q.index + 1} 题${q.isListen ? '听辨（播放 ' + q.audio + '，事件 ' + (q.playEvents ?? []).join('/') + '）' : '辨认'}「${q.prompt.slice(0, 12)}…」${q.wrongFirst ? `先答错（✗ 得分不变）→「再试一次」→` : ''}答对 ${q.feedback.slice(2)}`).join('→')}；听辨题面泄露扫描 ${listenQuestions.length}/${listenQuestions.length} 无拉丁字母；结算「${res.resultScore}」「${res.resultAnswer}」「${res.resultModes}」与逐题档位（4×10+5=45）吻合；音频断言：playing ${played.playedCount}/${listenQuestions.length} 题、请求 200（CDP ${net200.length} 条 /audio/pinyin/ 响应）与缓存命中（${cacheHits.length} 题命中 200）双通道成立；练习记录新增 1 条（gameId=${recRaw?.gameId}、recordId=roundId、score=${played.expectedScore}、逐题 mode 序列与局内观察一致、第 2 题 wrongs=1）且列表显示「${played.expectedScore} 分 · 首答 4/5」；recent-ids 含本局全部题目 ID；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；JS 错误 ${rec.errors.length}、无横向溢出`,
    { checks: s1 });

  // S2 返回路径与四入口并存
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
  // 菜单四入口并存（数字消除为当前页 + 三游戏锚点）
  await clickAt('#btn-menu');
  await waitUntil(async () => { const h = await homeState(); return h.menuDialogOpen ? h : null; }, '返回后菜单弹层');
  const menu2 = await homeState();
  await shot('android-online-09-home-returned-menu');
  const fourOk = menu2.hanziAnchor?.visible && menu2.dungeonAnchor?.visible && menu2.pinyinAnchor?.visible
    && menu2.hanziAnchor.href === '/hanzi.html' && menu2.dungeonAnchor.href === '/dungeon.html'
    && menu2.pinyinAnchor.href === '/pinyin.html';
  await checkpoint('S2-菜单四入口');
  const pcFinal = await pageCheck();
  s2 = { npOk, fourOk, menu: { hanzi: menu2.hanziAnchor, dungeon: menu2.dungeonAnchor, pinyin: menu2.pinyinAnchor },
    errors: pcFinal.errors, overflow: pcFinal.overflow };
  record('S2 返回路径与四入口并存', npOk && fourOk && pcFinal.errors.length === 0 && !pcFinal.overflow,
    `拼音冒险顶栏「${backLink.text}」返回数字消除首页；勾选一年级→下一步按钮启用（可选年级），取消复原；菜单弹层内「汉字勇者」（href=/hanzi.html）、「算术地下城」（href=/dungeon.html）与「拼音冒险」（href=/pinyin.html）三锚点并存可见（数字消除为当前页，共四入口）；JS 错误 ${pcFinal.errors.length}、无横向溢出`,
    { checks: s2 });
} catch (e) {
  record('S1/S2 在线流程', false, `失败: ${e.message}`);
}

const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, scenarios, errorLedger, overflowLedger,
  networkAudio, networkFailed, allPassed: scenarios.every(s => s.pass) };
await writeFile(join(outDir, 'android-online-results.json'), JSON.stringify(summary, null, 2));
log('结果已写入 android-online-results.json');
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(process.exitCode = scenarios.every(s => s.pass) ? 0 : 1);
