// iOS 模拟器 Safari M9 验证（拼音冒险，口径对齐 M12/M8 device-simulators/ios-round.mjs，
// 拼音玩法断言对齐 M9 桌面 pinyin-browser.mjs 的状态机断言与 Android 轮 android-round.mjs）。
// 前置：iPhone 16 Pro / iOS 18.6 模拟器（UDID 28F2F0F0-…；iOS 27.0 运行时 safaridriver 无法创建
// 会话，不可用）；safaridriver -p 4801 已运行；本地服务 4373 已启动（本轮为验证旁路服务，见下）。
//
// ★ iOS 轮特殊环境（与本机探针实测，详见 README「iOS 听辨播放受阻」节）：
// 1. 本轮本地服务为 /tmp/serve-mime.mjs（scripts/serve.mjs 克隆 + audio/wav MIME + Content-Length +
//    Accept-Ranges/206）：serve.mjs 对 .wav 返回 application/octet-stream 且响应无 Content-Length
//    （Node 隐式 chunked）、不支持 Range——fetch() 正常但 WebKit 媒体栈加载失败（Audio error
//    code 4）；Chrome 嗅探内容可播（桌面/Android 轮未暴露）；生产 Pages 自带正确 MIME 与 Range。
// 2. 听辨播放的 Audio playing 断言在 iOS 受阻：safaridriver 对 iOS 模拟器无有效 HID 注入（M7 实测、
//    本轮再证：原生 element click 调用成功但 onclick 从未触发），合成 el.click() 的 isTrusted=false
//    且不产生 userActivation → WebKit 拒绝 play()（NotAllowedError）；MediaPlaybackRequiresUserAction
//    默认值在 iOS 18.6 冷重启后仍不生效；idb 未安装、AppleScript 无辅助功能权限（-1712）。
//    真实手势通道全部不可用 → playing 断言无法执行，如实记受阻。
// 3. 因此 iOS 局内听辨题按游戏设计的「音频不可用降级」路径验证（这本身是 M9 验收条件）：
//    播放点击 → 无 playing（事件台账如实记录）→ 「当前无法播放声音」提示 + 「跳过这道听辨题」入口
//    出现 → 跳过不计分不计作答（记录 skipped 如实标注）。缓存命中（CacheStorage match 200）断言
//    在线与断网均照常执行。辨认题 el.click() 作答 + 故意答错重试档照常验证。
// 会话能力必须含 platformName iOS + safari:useSimulator true（UA 含 iPhone 确认）。
// 答案一律从页面题面（#q-prompt 的 dataset.exerciseId）经 dist 判题模块
// （selectPinyinExercises + correctPinyinAnswer）自算，不注入任何游戏状态。
// 覆盖：S1 在线完整局（菜单「拼音冒险」入口、5 题混合局：辨认 el.click() + 首道辨认题故意答错→
// 「再试一次」重试档 +5、听辨题播放尝试→降级提示+跳过不计分、结算与逐题档位吻合、
// 记录 gameId=pinyin-adventure 且辨认/听辨 mode 分开、音频缓存命中 200、金币零变化）
// → S2 返回路径与四入口并存 → S3 离线（SW 就绪→杀源→Safari 刷新非冷导航，首页与 /pinyin.html
// 由缓存打开，断网整局含听辨降级与音频缓存命中）→ S4 贯穿（横向溢出与 JS 错误台账）。
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
// simctl 截图无权限直写工作区：先落 /tmp 再拷贝（本机实测坑，M8/M12 同口径）。
const shot = async name => {
  const frame = `/tmp/ios-m9-${Date.now()}.png`;
  await execFileP('xcrun', ['simctl', 'io', UDID, 'screenshot', frame]);
  await writeFile(join(outDir, `${name}.png`), await readFile(frame));
  await rm(frame, { force: true });
  log('截图', name);
};

// ===== JS 错误 / 横向溢出台账 + Audio 状态机包装（每次导航后重装） =====
// Audio 包装：游戏每次播放都 new Audio(url)（无预建实例），导航完成后注入仍可拦截全部后续实例。
const INJECT = `(() => { window.__errors = window.__errors ?? [];
  addEventListener('error', e => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));
  window.__audioLog = window.__audioLog ?? [];
  (function(){ var Orig = window.Audio; if (!Orig || window.__audioHooked) return;
    window.__audioHooked = true;
    window.Audio = function(url){ var a = new Orig(url);
      var rec = { url: String(url), t0: Date.now(), events: [], currentTimeAtPlaying: null, errorDetail: null };
      window.__audioLog.push(rec);
      a.addEventListener('canplay', function(){ rec.events.push({ ev:'canplay', t: Date.now() }); });
      a.addEventListener('playing', function(){ rec.events.push({ ev:'playing', t: Date.now() }); rec.currentTimeAtPlaying = a.currentTime; });
      a.addEventListener('error', function(){ rec.events.push({ ev:'error', t: Date.now() }); rec.errorDetail = a.error ? (a.error.code + ':' + (a.error.message||'')) : 'unknown'; });
      return a; };
    window.Audio.prototype = Orig.prototype;
  })();
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
  let polls = 0, lastErr = null;
  for (;;) {
    let v = null;
    try { v = await fn(); polls++; } catch (e) { lastErr = e; } // 导航中页面元素可能不存在
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
    gradeChecked: [...document.querySelectorAll('input[name="grade"]')].filter(i => i.checked).map(i => i.value),
    btnToAvailabilityDisabled: q('#btn-to-availability')?.disabled,
    offlineNotice: q('#offline-notice')?.hidden ? '' : q('#offline-notice')?.textContent ?? '',
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  };
})()`);
// 数字消除档案（IndexedDB pixel-academy / profiles / local），M7/M8/M12 同口径。
const idbProfileSnapshot = () => evalAsync(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('profiles', 'readonly');
  const req = tx.objectStore('profiles').get('local');
  const p = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  return p ? { coins: p.coins, records: (p.records ?? []).length, revision: p.revision } : null;
})()`);

// ===== 拼音冒险状态 =====
const pinyinState = () => evalSync(`(() => {
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
    return { listen: true, leaked: m ? m[0] : null };
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
    playStatus: t('play-status'),
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
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`);

// ===== 正式池（dist 产物自算答案）=====
let POOL_BY_ID = {};
const installPinyinPool = async () => {
  const info = await evalAsync(`(async () => {
    const { selectPinyinExercises } = await import('/dist/game/pinyin-adventure/content.js');
    const { correctPinyinAnswer } = await import('/dist/learning/pinyin.js');
    const picked = selectPinyinExercises([1]);
    window.__pool = picked.map(e => ({ id: e.id, status: e.review.status, kind: e.task.kind,
      letter: correctPinyinAnswer(e.task), options: [...e.task.options], audio: e.task.audio ?? null, prompt: e.task.prompt }));
    const kinds = picked.reduce((acc, e) => { acc[e.task.kind] = (acc[e.task.kind] ?? 0) + 1; return acc; }, {});
    return { count: picked.length, kinds, statuses: [...new Set(picked.map(e => e.review.status))] };
  })()`);
  log('正式池:', JSON.stringify(info));
  const pool = await evalSync(`window.__pool`);
  if (!Array.isArray(pool) || !pool.length) throw new Error('正式池索引为空');
  POOL_BY_ID = Object.fromEntries(pool.map(p => [p.id, p]));
  return info;
};

// ===== 作答辅助 =====
const clickOption = async text => {
  const ok = await waitUntil(async () => {
    const done = await evalSync(`(() => {
      const btns = [...document.querySelectorAll('#options button')];
      const b = btns.find(x => x.textContent === ${JSON.stringify(text)});
      if (!b || b.disabled) return null; b.click(); return true; })()`);
    return done ?? null;
  }, `候选「${text}」可点`, 6000);
  return ok;
};

// 播放一次听辨音频：execute 点击播放钮 → 等待 Audio 实例 → 等待终态
// （playing / error 事件 / 降级提示出现 / 播放钮回到可点文案）。
// iOS 合成点击下 play() 被 NotAllowedError 拒绝且不触发 error 事件（本机探针实测），
// 游戏按设计把 playPending 复位并呈现 audio-notice——该终态同样被本函数捕获，供降级路径断言。
const playAttempt = async () => {
  const before = await evalSync(`window.__audioLog?.length ?? -1`);
  await clickEl('#btn-play');
  let idx = null;
  try {
    idx = await waitUntil(async () => {
      const n = await evalSync(`window.__audioLog?.length ?? -1`);
      return n > before ? { idx: n - 1 } : null;
    }, 'Audio 实例创建', 6000).then(v => v.idx);
  } catch (e) {
    const diag = await pinyinState().catch(err => ({ diagError: String(err) }));
    throw new Error(`播放点击未产生 Audio 实例（诊断: ${JSON.stringify({ before, audioLog: diag.audioLog, btnPlayDisabled: diag.btnPlayDisabled, btnPlayText: diag.btnPlayText, playGroupHidden: diag.playGroupHidden, pauseOverlayHidden: diag.pauseOverlayHidden, notice: diag.audioNoticeText })}）: ${e.message}`);
  }
  const r = await waitUntil(async () => {
    const s = await pinyinState();
    const rec = await evalSync(`window.__audioLog[${idx}] ? { url: window.__audioLog[${idx}].url, events: window.__audioLog[${idx}].events.map(e => e.ev), errorDetail: window.__audioLog[${idx}].errorDetail } : null`);
    if (!rec) return null;
    const playing = rec.events.includes('playing');
    const errored = rec.events.includes('error');
    const settled = playing || errored || s.audioNoticeHidden === false
      || (s.btnPlayText !== '播放中…' && s.btnPlayDisabled === false);
    return settled ? { rec, noticeShown: s.audioNoticeHidden === false, playing, errored,
      noticeText: s.audioNoticeText, skipHidden: s.skipHidden } : null;
  }, '播放终态（playing/error/降级提示）', 9000);
  await sleep(150);
  return r;
};

// 当前 CacheStorage 中查找音频（缓存命中证据）。
const cacheHitFor = url => evalAsync(`(async () => {
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
  if (s.pauseOverlayHidden === false) { await clickEl('#btn-resume'); await sleep(500); return true; }
  return false;
};
const waitQuestion = (index, desc = `第 ${index + 1} 题可作答`) => waitUntil(async () => {
  await handlePauseIfAny();
  const s = await pinyinState();
  return s.gameVisible && s.questionVisible
    && s.hudProgress === `第 ${index + 1}/5 题`
    && (s.countdown ?? '').startsWith('剩余')
    && s.optionButtons.length > 0 && !s.optionButtons.some(b => b.disabled) ? s : null;
}, desc, 15000);
const waitRetryState = () => waitUntil(async () => {
  const s = await pinyinState();
  return s.gameVisible && s.questionVisible && s.feedbackHidden === false
    && (s.feedback ?? '').startsWith('✗') && s.retryHidden === false ? s : null;
}, '答错待再试状态');
const waitResult = () => waitUntil(async () => {
  await handlePauseIfAny();
  const s = await pinyinState();
  return s.resultVisible ? s : null;
}, '结算屏');
const toggleGrade = async (name, want = true) => waitUntil(async () => {
  await evalSync(`(() => { const b = [...document.querySelectorAll('#grade-grid button')]
    .find(x => x.textContent === ${JSON.stringify(name)});
    if (b && (b.getAttribute('aria-pressed') === 'true') !== ${want ? 'true' : 'false'}) b.click();
    return true; })()`);
  const s = await pinyinState();
  const card = s.gradeCards.find(c => c.text === name);
  return card && (card.pressed === 'true') === want ? s : null;
}, `勾选年级 ${name}`, 12000);
async function discardPinyinResidue() {
  const s = await pinyinState();
  if (s.restoreOfferHidden === false) {
    log('发现拼音残留中断局，放弃之');
    await clickEl('#btn-discard-round');
    await sleep(600);
    await clickEl('#btn-confirm-yes');
    await waitUntil(async () => (await pinyinState()).restoreOfferHidden, '残留局清理', 8000);
  }
}

// ===== 场景台账 =====
let expectedScore = 0;
const scenarios = [];
const blocked = [];
// iOS 听辨播放受阻（本机探针实测，详见 README）：playing 断言无法执行，降级路径与缓存命中已验。
blocked.push({
  item: '听辨题 Audio playing 断言（在线与离线）',
  status: '受阻（验证环境，非游戏缺陷）',
  evidence: [
    'safaridriver 对 iOS 模拟器无有效 HID 注入（M7 实测；本轮再证：WebDriver 原生 element click 端点调用成功但 onclick 从未触发）',
    '合成 el.click() 的 isTrusted=false 且 navigator.userActivation.isActive=false → WebKit 拒绝 play()（NotAllowedError）',
    'MediaPlaybackRequiresUserAction=0 默认值在 iOS 18.6 模拟器冷重启后仍不生效',
    'idb 未安装；AppleScript System Events 无辅助功能权限（AppleEvent 超时 -1712）；simctl 无触摸注入',
    '游戏自身对播放失败的处置（audio-notice 提示 + 跳过入口 + 跳过不计分）已在本轮实测为按设计工作',
  ],
});
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

// 完成一局（5 题）。
// 辨认题：首道辨认题故意答错 → 「再试一次」→ 重试档 +5；其余 +10。
// 听辨题：播放尝试 → 若 playing 则作答（+10/+5 档位随 currentWrong）；若降级（iOS 自动化无手势）
//   则断言「当前无法播放声音」提示 + 跳过入口出现 → 跳过不计分不计作答。
async function playRound({ shots = {} }) {
  const questions = [];
  let chooseShot = false, listenShot = false, retryShot = false, wrongDone = false;
  expectedScore = 0;
  const snap0 = (await pinyinState()).snap;
  const roundId = snap0?.roundId ?? null;
  for (let i = 0; i < 5; i++) {
    const st = await waitQuestion(i);
    const id = st.promptExerciseId;
    const task = POOL_BY_ID[id];
    if (task.status !== 'approved') throw new Error(`非 approved 题 ${id}: ${task.status}`);
    const isListen = task.kind === 'pinyin-listen';
    if ((st.playGroupHidden === false) !== isListen) {
      throw new Error(`播放区显示与题型不符: id=${id} kind=${task.kind} playGroupHidden=${st.playGroupHidden}`);
    }
    const leakOk = isListen ? st.leakScan?.leaked === null : true;
    if (!isListen && !chooseShot && shots.choose) { await shot(shots.choose); chooseShot = true; }
    if (isListen) {
      const attempt = await playAttempt();
      const cache = await cacheHitFor(`/audio/pinyin/${(task.audio ?? '').split('/').pop()}`);
      if (attempt.playing) {
        if (!listenShot && shots.listen) { await shot(shots.listen); listenShot = true; }
        await clickOption(task.letter);
        const landed = await waitUntil(async () => {
          await handlePauseIfAny();
          const s = await pinyinState();
          return s.gameVisible && s.feedbackHidden === false && (s.feedback ?? '').startsWith('✓') ? s : null;
        }, '答对反馈出现', 8000);
        const m = (landed.feedback ?? '').match(/答对了 \+(\d+)/);
        const gained = m ? Number(m[1]) : null;
        if (gained === null) throw new Error(`答对反馈未解析出得分: ${landed.feedback}`);
        expectedScore += gained;
        questions.push({ index: i, id, kind: task.kind, isListen: true, mode: 'listen', prompt: task.prompt,
          audio: task.audio ?? null, letter: task.letter, playUrl: attempt.rec?.url ?? null,
          playEvents: attempt.rec?.events ?? [], cacheHit: cache, leakOk,
          played: true, skipped: false, wrongFirst: false, gained, feedback: landed.feedback });
        log(`第 ${i + 1} 题 听辨 ${id} → 播放 playing → ${landed.feedback}（累计 ${expectedScore}）`);
      } else {
        // 降级路径（iOS 自动化无手势 → play 被拒；游戏按设计呈现提示与跳过入口）：
        const s2 = await pinyinState();
        const noticeOk = s2.audioNoticeHidden === false && (s2.audioNoticeText ?? '').startsWith('当前无法播放声音');
        const skipOk = s2.skipHidden === false;
        if (!listenShot && shots.listen) { await shot(shots.listen); listenShot = true; }
        if (!noticeOk || !skipOk) {
          throw new Error(`音频不可用降级断言失败: noticeHidden=${s2.audioNoticeHidden} notice=${JSON.stringify(s2.audioNoticeText)} skipHidden=${s2.skipHidden} playEvents=${JSON.stringify(attempt.rec?.events)} errorDetail=${JSON.stringify(attempt.rec?.errorDetail ?? null)}`);
        }
        await clickEl('#btn-skip');
        questions.push({ index: i, id, kind: task.kind, isListen: true, mode: 'listen', prompt: task.prompt,
          audio: task.audio ?? null, letter: task.letter, playUrl: attempt.rec?.url ?? null,
          playEvents: attempt.rec?.events ?? [], cacheHit: cache, leakOk,
          played: false, skipped: true, wrongFirst: false, gained: 0,
          feedback: null, noticeText: s2.audioNoticeText });
        log(`第 ${i + 1} 题 听辨 ${id} → 音频不可用降级（提示 + 跳过，不计分；缓存命中=${cache?.status ?? '无'}）`);
      }
      if (i === 4) await waitResult();
      continue;
    }
    // ===== 辨认题 =====
    const wrongFirst = !wrongDone;
    wrongDone = true;
    const wrongText = task.options.find(o => o !== task.letter);
    if (wrongFirst) {
      if (wrongText === undefined) throw new Error(`题 ${id} 无可用错误候选`);
      await clickOption(wrongText);
      const retry = await waitRetryState();
      if (retry.hudScore !== `得分 ${expectedScore}`) {
        throw new Error(`答错后得分变动: ${retry.hudScore} ≠ 得分 ${expectedScore}`);
      }
      if (shots.retry && !retryShot) { await shot(shots.retry); retryShot = true; }
      await clickEl('#btn-retry-attempt');
      await waitQuestion(i, `重试后第 ${i + 1} 题重新计时`);
    }
    await clickOption(task.letter);
    const landed = await waitUntil(async () => {
      await handlePauseIfAny();
      const s = await pinyinState();
      return s.gameVisible && s.feedbackHidden === false && (s.feedback ?? '').startsWith('✓') ? s : null;
    }, '答对反馈出现', 8000);
    const m = (landed.feedback ?? '').match(/答对了 \+(\d+)/);
    const gained = m ? Number(m[1]) : null;
    if (gained === null) throw new Error(`答对反馈未解析出得分: ${landed.feedback}`);
    expectedScore += gained;
    questions.push({ index: i, id, kind: task.kind, isListen: false, mode: 'choose', prompt: task.prompt,
      audio: null, letter: task.letter, playUrl: null, playEvents: null, cacheHit: null, leakOk,
      played: false, skipped: false, wrongFirst, wrongText: wrongFirst ? wrongText : null,
      gained, feedback: landed.feedback });
    log(`第 ${i + 1} 题 辨认 ${id} → ${landed.feedback}（累计 ${expectedScore}）`);
    if (i === 4) await waitResult();
  }
  const listenQuestions = questions.filter(q => q.isListen);
  const playedCount = listenQuestions.filter(q => q.played).length;
  const cacheHitCount = questions.filter(q => q.cacheHit?.status === 200).length;
  return { roundId, questions, expectedScore, playedCount, listenCount: listenQuestions.length, cacheHitCount };
}

// 结算与记录断言（辨认/听辨分开、跳过如实标注、金币零变化、溢出与 JS 错误）。
async function verifySettlementAndRecord(played, { scoreLinePrefix = '' } = {}) {
  const res = await pinyinState();
  const answered = played.questions.filter(q => !q.skipped);
  const firstTryCount = answered.filter(q => q.gained === 10).length;
  const retryCount = answered.filter(q => q.wrongFirst).length;
  const skippedCount = played.questions.filter(q => q.skipped).length;
  const choose = played.questions.filter(q => !q.isListen);
  const listen = played.questions.filter(q => q.isListen);
  const expAnswer = `作答 ${answered.length} 题 · 首答 ${firstTryCount} · 重试 ${retryCount} 次`
    + (skippedCount ? ` · 跳过 ${skippedCount} 题` : '');
  const expModes = `辨认 ${choose.filter(q => !q.wrongFirst).length}/${choose.length} 题首答`
    + ` · 听辨 ${listen.filter(q => q.played).length}/${listen.length} 题首答`;
  const scoreOk = res.resultScore === `总分 ${played.expectedScore}`;
  const answerOk = res.resultAnswer === expAnswer;
  const modesOk = res.resultModes === expModes;
  if (!scoreOk || !answerOk || !modesOk) {
    throw new Error(`结算不符: ${res.resultScore} / ${res.resultAnswer} / ${res.resultModes}（期望 总分 ${played.expectedScore} / ${expAnswer} / ${expModes}）`);
  }
  await checkpoint('结算屏');
  await clickEl('#btn-result-return');
  await waitUntil(async () => (await pinyinState()).selectVisible, '返回选择屏');
  const rec = await pinyinState();
  const recRaw = (rec.recordsRaw?.records ?? []).find(r => r.recordId === played.roundId) ?? null;
  const modesSequenceOk = recRaw && played.questions.every((q, i) => {
    const r = recRaw.answer?.questions?.[i];
    return r && r.exerciseId === q.id && r.mode === q.mode
      && r.answered === !q.skipped
      && r.firstTry === (!q.skipped && !q.wrongFirst)
      && r.wrongs === (q.wrongFirst ? 1 : 0);
  });
  const recOk = recRaw && recRaw.gameId === 'pinyin-adventure' && recRaw.score === played.expectedScore
    && recRaw.answer?.questions?.length === 5 && modesSequenceOk
    && rec.records.some(r => r.includes(`${played.expectedScore} 分 · 首答 ${firstTryCount}/${answered.length}`)
      && (skippedCount ? r.includes(`跳过 ${skippedCount}`) : true));
  const recentOk = Array.isArray(rec.recentIds) && recRaw && recRaw.answer.questions
    .every(q => rec.recentIds.includes(q.exerciseId));
  const snapCleared = (await pinyinState()).snap === null;
  return { res, rec, recRaw, recOk, recentOk, snapCleared, modesSequenceOk,
    expAnswer, expModes, firstTryCount, retryCount, skippedCount };
}

// ===== 主流程 =====
try {
await wd('POST', `${base}/timeouts`, { implicit: 0, pageLoad: 30000, script: 30000 });
const ua = await evalSync(`navigator.userAgent`);
const udidReported = session.capabilities?.['safari:deviceUDID'] ?? null;
log('UA:', ua);
const simOk = ua.includes('iPhone') && udidReported === UDID;
if (!simOk) throw new Error(`会话未落在目标 iOS 模拟器: UA=${ua} UDID=${udidReported}`);

if (phase === 'offline') {
  // ===== S3 离线（断源刷新口径）：SW 受控 → 杀源 → Safari 刷新 → 缓存打开 → 断网整局 =====
  let s3 = null;
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
        await wd('POST', `${base}/refresh`).catch(e => log('refresh 报错（继续等待）:', e.message.slice(0, 120)));
        await sleep(2500);
        await waitUntil(async () => (await homeCheck())?.select, '重载后首页选择屏', 30000);
        await evalSync(INJECT);
      }
    }
    if (!swInfo) throw new Error('SW 未就绪（缓存缺 /pinyin.html 或拼音音频）');
    log('SW:', JSON.stringify(swInfo));
    await checkpoint('S3-SW就绪首页(在线)');
    let serverWasAlive = true;
    try { await execFileP('pkill', ['-f', 'serve-mime.mjs 4373']); } catch { serverWasAlive = false; }
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
    await waitUntil(async () => { const h = await homeCheck(); return h.menuOpen && h.pinyinAnchor?.visible ? h : null; }, '断源后菜单');
    await clickEl('#main-nav a[href="/pinyin.html"]');
    await waitUntil(async () => { const s = await pinyinState(); return s.url === '/pinyin.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '断源后拼音冒险由缓存打开', 30000);
    await evalSync(INJECT);
    const poolInfo = await installPinyinPool().catch(e => { throw new Error(`断网下题库模块 import 失败（SW 闭包不全）: ${e.message}`); });
    await checkpoint('S3-离线拼音选择屏');
    await shot('ios-offline-02-pinyin-select');
    await discardPinyinResidue();
    await toggleGrade('一年级', true);
    const avail = (await pinyinState()).availabilityStatus;
    log('离线可用性文案:', avail);
    await clickEl('#btn-start');
    const coinsBeforeOff = await idbProfileSnapshot();
    const played = await playRound({ shots: { listen: 'ios-offline-03-offline-listen' } });
    await shot('ios-offline-04-offline-result');
    const listenQuestions = played.questions.filter(q => q.isListen);
    const cacheHits = listenQuestions.map(q => q.cacheHit).filter(Boolean);
    const cacheOk = listenQuestions.length > 0 && cacheHits.every(c => c?.status === 200);
    const v = await verifySettlementAndRecord(played);
    log(`断网结算: ${v.res.resultScore} ${v.res.resultAnswer} ${v.res.resultModes}`);
    await checkpoint('S3-离线结算与记录');
    await clickEl('.profile-bar a.btn-ghost');
    await waitUntil(async () => { const h = await homeCheck(); return h?.url === '/' && h.select ? h : null; }, '断网返回首页', 30000);
    await evalSync(INJECT);
    await checkpoint('S3-离线返回首页');
    const coinsAfterOff = await idbProfileSnapshot();
    s3 = { swInfo, sourceDead, serverWasAlive, poolInfo, avail,
      listenQuestions: listenQuestions.map(q => ({ id: q.id, audio: q.audio, url: q.playUrl, events: q.playEvents, cache: q.cacheHit, skipped: q.skipped })),
      cacheOk, result: { score: v.res.resultScore, answer: v.res.resultAnswer, modes: v.res.resultModes },
      roundId3: played.roundId, recRaw: v.recRaw, recOk: v.recOk, recentOk: v.recentOk, snapCleared: v.snapCleared,
      coins: [coinsBeforeOff?.coins, coinsAfterOff?.coins] };
    record('S3 离线断源刷新（缓存打开 + 断网整局：听辨音频缓存命中 + 降级跳过 + 辨认作答）',
      sourceDead && poolInfo.count > 0 && cacheOk && v.recOk && v.recentOk && v.snapCleared
        && coinsAfterOff?.coins === coinsBeforeOff?.coins,
      `SW ${swInfo.name} 受控且预缓存含 /pinyin.html（含 /pinyin.css、拼音 dist 模块、音频 ${swInfo.audioCount} 条，/audio/pinyin/b.wav 命中 status=${swInfo.audioCached}）；${serverWasAlive ? '杀源服务（源站 fetch 确认失败）后' : '源站已在先前场景断开'}Safari 刷新同一标签页（非冷导航）：首页由缓存打开；菜单进 /pinyin.html 由缓存正常加载（6 年级卡、boot-fail 隐藏）；断网下题库模块经 SW 预缓存 import 成功（${poolInfo.count} 题）；选一年级（${avail}）完成断网整局 5 题（辨认 ${played.questions.filter(q => !q.isListen).length} + 听辨 ${listenQuestions.length}）：${listenQuestions.map(q => `听辨 ${q.audio} CacheStorage 命中 200（断网下 200 只能来自缓存）${q.skipped ? '，播放被拒（iOS 手势受阻）→「当前无法播放声音」提示 + 跳过不计分' : '，playing 后作答'}`).join('；')}，结算「${v.res.resultScore}」「${v.res.resultAnswer}」（跳过题不计分不计作答，辨认首答/重试档位照常）；离线练习记录新增 1 条（gameId=${v.recRaw?.gameId}、score=${played.expectedScore}、跳过题 answered=false 如实标注）且列表含「${played.expectedScore} 分 · 首答 ${v.firstTryCount}/${answeredOf(played)}${v.skippedCount ? ` · 跳过 ${v.skippedCount}` : ''}」；recent-ids 含本局全部题目 ID；结算返回后中断快照清除；离线金币 ${coinsBeforeOff?.coins} = ${coinsAfterOff?.coins}（零收支）；返回首页正常；全程无溢出、JS 错误 0`,
      { checks: s3 });
  } catch (e) {
    record('S3 离线断源刷新（缓存打开 + 断网整局：听辨音频缓存命中 + 降级跳过 + 辨认作答）', false, `失败: ${e.message}`);
  }
  const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, udid: UDID, wdEndpoint: WD,
    userAgent: ua, scenarios, blocked, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
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

  // S1a：首页菜单「拼音冒险」入口（四入口菜单：数字消除当前页 + 三游戏锚点）
  await clickEl('#btn-menu');
  await waitUntil(async () => { const h = await homeCheck(); return h.menuOpen && h.pinyinAnchor?.visible ? h : null; }, '菜单弹层打开');
  const menu = await homeCheck();
  await shot('ios-online-02-home-menu');
  const entryOk = menu.pinyinAnchor.href === '/pinyin.html' && (menu.pinyinAnchor.text ?? '').includes('拼音冒险')
    && menu.pinyinAnchor.decorAriaHidden === 'true' && menu.hanziAnchor?.visible && menu.dungeonAnchor?.visible;
  if (!entryOk) throw new Error(`菜单入口异常: ${JSON.stringify({ pinyin: menu.pinyinAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor })}`);
  await clickEl('#main-nav a[href="/pinyin.html"]');
  await waitUntil(async () => { const s = await pinyinState(); return s.url === '/pinyin.html' && s.bootFailHidden && s.selectVisible && s.gradeCards.length === 6 ? s : null; }, '拼音冒险选择屏就绪', 30000);
  await evalSync(INJECT);
  const poolInfo = await installPinyinPool();
  await checkpoint('S1-拼音选择屏');
  await shot('ios-online-03-pinyin-select');
  await discardPinyinResidue();
  const g1 = await toggleGrade('一年级', true);
  const expectAvail = `本局题库：一年级 ${poolInfo.count} 道，共 ${poolInfo.count} 道`;
  if (g1.availabilityStatus !== expectAvail) throw new Error(`可用性文案异常: ${g1.availabilityStatus}`);
  log('可用性文案:', g1.availabilityStatus);
  if (g1.storageNoticeHidden !== true) throw new Error('存储不可用提示意外出现');
  const backLink = (await pinyinState()).backLink;
  if (backLink?.href !== '/' || !backLink.text.includes('返回数字消除')) throw new Error(`返回链接异常: ${JSON.stringify(backLink)}`);

  // S1b：完整局 5 题（听辨播放尝试→降级跳过或 playing 作答；首道辨认题故意答错→重试档 +5）
  await clickEl('#btn-start');
  const played = await playRound({ shots: { choose: 'ios-online-04-choose-question',
    listen: 'ios-online-05-listen-question', retry: 'ios-online-06-wrong-retry' } });
  await shot('ios-online-07-result');
  const listenQuestions = played.questions.filter(q => q.isListen);
  const chooseQuestions = played.questions.filter(q => !q.isListen);
  const cacheHits = played.questions.map(q => q.cacheHit).filter(Boolean);
  const leakOk = listenQuestions.every(q => q.leakOk);
  if (listenQuestions.length < 2) throw new Error(`听辨题数不足 2: ${listenQuestions.length}`);
  if (!leakOk) throw new Error('听辨题面泄露扫描失败');
  const wrongQ = played.questions.find(q => q.wrongFirst);
  if (!wrongQ || wrongQ.gained !== 5) throw new Error(`重试档验证失败: ${JSON.stringify(wrongQ)}`);
  if (played.questions.filter(q => !q.skipped && !q.wrongFirst).some(q => q.gained !== 10)) throw new Error('首答档非 +10');
  const v = await verifySettlementAndRecord(played);
  const coinsAfter = await idbProfileSnapshot();
  const coinsOk = coinsAfter?.coins === coinsBefore?.coins;
  await shot('ios-online-08-records');
  await checkpoint('S1-记录列表');
  const allApproved = played.questions.every(q => POOL_BY_ID[q.id]?.status === 'approved');
  s1 = { entry: { pinyin: menu.pinyinAnchor, hanzi: menu.hanziAnchor, dungeon: menu.dungeonAnchor },
    availability: g1.availabilityStatus, poolCount: poolInfo.count, roundId: played.roundId,
    play: played.questions.map(q => ({ index: q.index, id: q.id, mode: q.mode, prompt: q.prompt,
      audio: q.audio, letter: q.letter, playEvents: q.playEvents, cacheHit: q.cacheHit,
      played: q.played, skipped: q.skipped, wrongFirst: q.wrongFirst, gained: q.gained, leakOk: q.leakOk })),
    result: { score: v.res.resultScore, answer: v.res.resultAnswer, modes: v.res.resultModes },
    audio: { playedCount: played.playedCount, listenCount: played.listenCount, cacheHitCount: played.cacheHitCount,
      degradedCount: listenQuestions.filter(q => q.skipped).length },
    recOk: v.recOk, recentOk: v.recentOk, modesSequenceOk: v.modesSequenceOk,
    coinsBefore, coinsAfter, coinsOk, allApproved,
    errors: v.rec.errors, overflow: v.rec.overflow };
  record('S1 在线完整局（辨认点击 + 首道辨认题答错重试档 + 听辨播放尝试/降级跳过 + 记录金币）',
    v.recOk && v.recentOk && coinsOk && allApproved && leakOk
      && v.rec.errors.length === 0 && !v.rec.overflow,
    `菜单「拼音冒险」入口（href=/pinyin.html、装饰字 aria-hidden，与汉字勇者/算术地下城锚点并存）进入拼音冒险；勾一年级→「${g1.availabilityStatus}」与 dist 层一致（${poolInfo.count} 题全 approved：辨认 ${poolInfo.kinds['pinyin-choose']} + 听辨 ${poolInfo.kinds['pinyin-listen']}）；完整局 5 题（辨认 ${chooseQuestions.length} + 听辨 ${listenQuestions.length}，题目 ${played.questions.map(q => q.id).join('、')}）：${played.questions.map(q => `第 ${q.index + 1} 题${q.isListen ? (q.skipped ? `听辨「${q.prompt.slice(0, 10)}…」播放尝试（事件 ${JSON.stringify(q.playEvents)}）→「当前无法播放声音」提示 + 跳过入口 → 跳过不计分` : `听辨（播放 ${q.audio}，事件 ${(q.playEvents ?? []).join('/') || '无'}）「${q.prompt.slice(0, 10)}…」答对 ${q.gained}`) : `辨认「${q.prompt.slice(0, 12)}…」${q.wrongFirst ? `先答错（✗ 得分不变）→「再试一次」→` : ''}答对 ${q.feedback.slice(2)}`}`).join('→')}；听辨题面泄露扫描 ${listenQuestions.length}/${listenQuestions.length} 无拉丁字母；音频缓存命中 ${played.cacheHitCount}/${listenQuestions.length} 题（CacheStorage 命中 200）；结算「${v.res.resultScore}」「${v.res.resultAnswer}」「${v.res.resultModes}」与逐题档位吻合；练习记录新增 1 条（gameId=${v.recRaw?.gameId}、recordId=roundId、score=${played.expectedScore}、逐题 mode 序列与局内观察一致、跳过题 answered=false）且列表显示「${played.expectedScore} 分 · 首答 ${v.firstTryCount}/${answeredOf(played)}${v.skippedCount ? ` · 跳过 ${v.skippedCount}` : ''}」；recent-ids 含本局全部题目 ID；IndexedDB 金币局前 ${coinsBefore?.coins} = 局后 ${coinsAfter?.coins}（零收支）；JS 错误 0、无横向溢出【听辨 playing 断言在 iOS 受阻，见 README】`,
    { checks: s1 });

  // S2 返回路径与四入口并存
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
  const fourOk = menu2.hanziAnchor?.visible && menu2.dungeonAnchor?.visible && menu2.pinyinAnchor?.visible
    && menu2.hanziAnchor.href === '/hanzi.html' && menu2.dungeonAnchor.href === '/dungeon.html'
    && menu2.pinyinAnchor.href === '/pinyin.html';
  await checkpoint('S2-菜单四入口');
  s2 = { npOk, fourOk, menu: { hanzi: menu2.hanziAnchor, dungeon: menu2.dungeonAnchor, pinyin: menu2.pinyinAnchor } };
  record('S2 返回路径与四入口并存', npOk && fourOk,
    `拼音冒险顶栏「${backLink.text}」返回数字消除首页；勾选一年级→下一步按钮启用（可选年级），取消复原；菜单弹层内「汉字勇者」（href=/hanzi.html）、「算术地下城」（href=/dungeon.html）与「拼音冒险」（href=/pinyin.html）三锚点并存可见（数字消除为当前页，共四入口）；无溢出、JS 错误 0`,
    { checks: s2 });
} catch (e) {
  record('S1/S2 在线流程', false, `失败: ${e.message}`);
}

const summary = { generatedAt: new Date().toISOString(), phase, origin: ORIGIN, udid: UDID, wdEndpoint: WD,
  userAgent: ua, scenarios, blocked, errorLedger, overflowLedger, allPassed: scenarios.every(s => s.pass) };
await writeFile(join(outDir, 'ios-online-results.json'), JSON.stringify(summary, null, 2));
log('结果已写入 ios-online-results.json');
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
process.exitCode = scenarios.every(s => s.pass) ? 0 : 1;
}
} finally {
  try { await wd('DELETE', base); } catch { /* 会话已失效 */ }
}

function answeredOf(played) {
  return played.questions.filter(q => !q.skipped).length;
}
process.exit(process.exitCode = scenarios.length && scenarios.every(s => s.pass) ? 0 : 1);
