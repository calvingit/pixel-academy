// iOS 模拟器 Safari M8 验证（汉字勇者 + 首页新导航）。方法先例：m7 ios-round.mjs。
// 前置：iPhone 16 Pro / iOS 18.6 模拟器（UDID 28F2F0F0-…，iOS 27.0 运行时 safaridriver 无法创建会话，
// 不可用）；safaridriver 26.6.2 -p 4801 已运行；node scripts/serve.mjs 4373 已启动。
// 会话能力必须含 platformName iOS + safari:useSimulator true，否则静默回退 macOS Safari（用 UA 含 iPhone 确认）。
// 输入方式：DOM 控件 execute 内 el.click()；棋盘画布按几何换算派发 PointerEvent（safaridriver 对
// iOS 模拟器 HID 注入不完整，与 M3–M7 桌面证据同口径）。答案从页面题面经 dist 判题模块自算，不注入状态。
// 场景：S1 在线 首页入口→hanzi 完整局 5 题（第 1 题先错后对验证重试 5 分档）→ S2 hanzi 返回首页、
// 数字消除选年级开局作答 2 题后弃局 → S3 SW 受控断源刷新，首页/hanzi 均由缓存打开并完整玩一局
// → S4 全程 JS 错误与横向溢出台账（贯穿检查）。
// 已知 WebKit 行为：iOS 冷导航离线打开受控源落系统错误页；本脚本全程用「受控后断源刷新」口径。
// 用法：node ios-round.mjs [输出目录]（默认脚本所在目录）
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const execFileP = promisify(execFile);
const UDID = '28F2F0F0-4732-4493-816A-A382DCBF329A';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4373/';
const WD = process.env.WD_PORT ? `http://127.0.0.1:${process.env.WD_PORT}` : 'http://127.0.0.1:4801';
const outDir = process.argv[2] ?? new URL('.', import.meta.url).pathname.replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

const log = (...a) => console.log('[ios-m8]', ...a);
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
const clickEl = async selector => {
  const ok = await evalSync(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    if (el.disabled) return 'disabled';
    el.click();
    return true; })()`);
  if (ok === null) throw new Error(`无法点击 ${selector}（不存在）`);
  if (ok === 'disabled') throw new Error(`无法点击 ${selector}（禁用）`);
};
const tapAt = async (x, y) => {
  await evalSync(`(() => {
    const canvas = document.querySelector('#board-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${x}, clientY: ${y}, bubbles: true, pointerType: 'touch' }));
    return true;
  })()`);
};
const shot = async name => {
  const r = await wd('GET', `${base}/screenshot`);
  await writeFile(join(outDir, `${name}.png`), Buffer.from(r, 'base64'));
  // simctl 截图无权限直写工作区：先落 /tmp 再拷贝（本机实测坑）。
  const frame = `/tmp/ios-m8-frame-${Date.now()}.png`;
  try { await execFileP('xcrun', ['simctl', 'io', UDID, 'screenshot', frame]);
    await writeFile(join(outDir, `${name}-frame.png`), await readFile(frame)); } catch (e) { log('设备帧截图失败（忽略）:', e.message.slice(0, 80)); }
  log('截图', name);
};

// ===== JS 错误 / 横向溢出台账（S4 贯穿检查；每次导航后重装收集器） =====
const INJECT = `(() => { window.__errors = window.__errors ?? [];
  addEventListener('error', e => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));
  return true; })()`;
const errorLedger = [];
const overflowLedger = [];
async function collectErrors(where) {
  const errs = await evalSync(`(window.__errors ?? []).slice()`);
  if (errs.length) errorLedger.push({ where, errors: errs });
  return errs;
}
async function checkOverflow(where) {
  const o = await evalSync(`document.documentElement.scrollWidth > window.innerWidth`);
  overflowLedger.push({ where, overflow: !!o });
  return !!o;
}
async function waitUntil(fn, desc, timeoutMs = 25000) {
  const start = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; } // 导航中页面元素可能不存在
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(400);
  }
}

// ===== 首页（数字消除）状态 =====
const homeCheck = () => evalSync(`(() => {
  const q = s => document.querySelector(s);
  if (!q('#screen-select')) return null;
  const a = q('#main-nav a[href="/hanzi.html"]');
  return {
    url: location.pathname,
    select: !q('#screen-select').hidden,
    availability: !q('#screen-availability')?.hidden,
    availabilityStatus: q('#availability-status')?.textContent ?? '',
    game: !q('#screen-game')?.hidden,
    result: !q('#screen-result')?.hidden,
    error: !q('#screen-error')?.hidden,
    menuOpen: q('#menu-dialog')?.open ?? false,
    anchor: a ? { href: a.getAttribute('href'), text: a.textContent.trim().replace(/\\s+/g, ' '),
      visible: !!(a.offsetWidth || a.offsetHeight), decorAriaHidden: a.querySelector('span')?.getAttribute('aria-hidden') ?? null } : null,
    wallet: q('#wallet')?.textContent ?? '',
    offlineNotice: q('#offline-notice')?.hidden ? '' : q('#offline-notice')?.textContent ?? '',
    restoreOffer: !q('#restore-offer')?.hidden,
    overlay: !q('#pause-overlay')?.hidden,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  };
})()`);
// 数字消除档案（IndexedDB pixel-academy / profiles / local），M7 同口径。
const READ_STATE = `(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('pixel-academy', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('profiles', 'readonly');
  const req = tx.objectStore('profiles').get('local');
  const p = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  const s = p && p.challenge && p.challenge.state;
  return { hasProfile: !!p, coins: p ? p.coins : null, records: p && p.records ? p.records.length : null,
    challenge: s ? { phase: s.phase, questionIndex: s.questionIndex, score: s.score, board: s.board,
      total: s.questions.length, task: s.questions[s.questionIndex] ? s.questions[s.questionIndex].task : null } : null };
})()`;
const state = () => evalAsync(READ_STATE);
// 棋盘格中心（复刻 render.ts boardLayout + main.ts fitBoard 测量口径，M7 iOS 轮同款）。
const tilePoint = idx => evalSync(`(() => {
  const wrap = document.querySelector('#board-wrap');
  const canvas = document.querySelector('#board-canvas');
  const rect = canvas.getBoundingClientRect();
  const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
  const landscape = availW / availH > 1.35 && availH < 420;
  const width = landscape ? 620 : 360;
  const scale = Math.min(availW / width, 1);
  const height = Math.min(620, availH / scale);
  const columns = landscape ? 4 : 3;
  const task = landscape ? { x: 12, y: 46, w: 210, h: height - 78 } : { x: 12, y: 46, w: 336, h: Math.min(162, height * .23) };
  const boardX = landscape ? 238 : 10;
  const boardY = landscape ? 10 : task.y + task.h + 30;
  const tileW = landscape ? 86 : 108;
  const tileH = (height - boardY - 10 - (12 / columns - 1) * 8) / (12 / columns);
  const col = ${idx} % columns, row = Math.floor(${idx} / columns);
  const lx = boardX + col * (tileW + 8) + tileW / 2;
  const ly = boardY + row * (tileH + 8) + tileH / 2;
  return { x: rect.left + lx * (rect.width / width), y: rect.top + ly * (rect.height / height) };
})()`);
// 数字消除作答：选择题主模块判题，棋盘题从档案任务自算答案后按几何点按。
async function answerNumberCurrent(s) {
  const task = s.challenge.task;
  const expected = await evalAsync(`(async () => {
    const t = ${JSON.stringify(task)};
    if (t.kind === 'choice') { const { correctOptionIds } = await import('/dist/learning/choice.js'); return correctOptionIds(t); }
    const { answerFor } = await import('/dist/learning/evaluation.js');
    return answerFor(t);
  })()`);
  if (task.kind === 'choice') {
    const ids = Array.isArray(expected) ? expected : [expected];
    const multiple = await evalSync(`(() => {
      const btns = [...document.querySelectorAll('#choice-options button[data-option-id]')];
      return btns.length > 0 && btns[0].querySelector('.choice-mark') != null;
    })()`);
    for (const id of ids) await clickEl(`#choice-options button[data-option-id="${id}"]`);
    if (multiple) await clickEl('#btn-choice-submit');
    return { kind: 'choice', expected: ids };
  }
  const idx = s.challenge.board.findIndex(v => v === expected);
  if (idx < 0) throw new Error(`棋盘上找不到答案 ${expected}：board=${JSON.stringify(s.challenge.board)}`);
  const pt = await tilePoint(idx);
  await tapAt(pt.x, pt.y);
  return { kind: task.kind, expected, tile: idx };
}
async function waitForNumberProgress(prevIndex, timeoutMs = 15000) {
  return waitUntil(async () => {
    const s = await state();
    const pc = await homeCheck();
    if (pc.result || !s.challenge) return s;
    return s.challenge.phase === 'asking' && s.challenge.questionIndex > prevIndex ? s : null;
  }, `第 ${prevIndex + 1} 题推进`, timeoutMs);
}

// ===== hanzi 页状态与作答 =====
const hanziCheck = () => evalSync(`(() => {
  const q = s => document.querySelector(s);
  if (!q('#screen-select')) return null;
  return {
    select: !q('#screen-select').hidden,
    game: !q('#screen-game').hidden,
    result: !q('#screen-result').hidden,
    overlay: !q('#pause-overlay').hidden,
    bootFail: !q('#boot-fail').hidden,
    gradeCards: document.querySelectorAll('.grade-card').length,
    backLink: (() => { const a = q('.profile-bar a.btn-ghost');
      return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), visible: !!(a.offsetWidth || a.offsetHeight) } : null; })(),
    offlineNotice: q('#offline-notice')?.hidden ? '' : q('#offline-notice')?.textContent ?? '',
    storageNotice: q('#storage-notice')?.hidden ? '' : q('#storage-notice')?.textContent ?? '',
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  };
})()`);
const hanziRound = () => evalSync(`(() => {
  const cards = [...document.querySelectorAll('.option-card')];
  return {
    prompt: document.querySelector('#question-prompt')?.textContent ?? '',
    imageHidden: document.querySelector('#question-image')?.hidden,
    imageSrc: document.querySelector('#question-image')?.hidden ? null : document.querySelector('#question-image')?.getAttribute('src') ?? null,
    options: cards.map(c => c.textContent),
    partsSubmitHidden: document.querySelector('#btn-parts-submit')?.hidden,
    partsSubmitDisabled: document.querySelector('#btn-parts-submit')?.disabled,
    progress: document.querySelector('#hud-progress')?.textContent ?? '',
    score: document.querySelector('#hud-score')?.textContent ?? '',
    feedback: document.querySelector('#feedback')?.hidden ? null : document.querySelector('#feedback')?.textContent,
  };
})()`);
// 题面 → 构建产物正式池（dist/content/hanzi-hero.js）匹配任务并自算答案（M8 桌面证据同款）。
const matchHanziTask = (prompt, src) => evalAsync(`(async () => {
  const prompt = ${JSON.stringify(prompt)};
  const src = ${JSON.stringify(src)};
  const { hanziHeroExercises } = await import('/dist/content/hanzi-hero.js');
  const { correctHanziIds } = await import('/dist/learning/hanzi.js');
  const matches = hanziHeroExercises.filter(e => {
    const t = e.task;
    if (t.kind === 'hanzi-choose' && t.mode === 'shape') return prompt.includes('找出「' + t.target + '」');
    if (t.kind === 'hanzi-choose' && t.mode === 'meaning') return src?.endsWith(t.image);
    return src?.endsWith(t.image);
  });
  if (matches.length !== 1) return { error: '题面匹配失败: ' + matches.length + ' prompt=' + prompt + ' src=' + src };
  return { ids: [...correctHanziIds(matches[0].task)], task: matches[0].task };
})()`);
const clickCard = async text => evalSync(`(() => {
  const card = [...document.querySelectorAll('.option-card')].find(c => c.textContent === ${JSON.stringify(text)});
  if (!card) return null; card.click(); return true; })()`);
const submitParts = () => evalSync(`(() => { document.querySelector('#btn-parts-submit')?.click(); return true; })()`);
async function answerHanziCorrect() {
  const view = await hanziRound();
  const m = await matchHanziTask(view.prompt, view.imageSrc);
  if (m.error) throw new Error(m.error);
  if (m.task.kind === 'hanzi-parts') {
    for (const part of m.task.parts) {
      const ok = await clickCard(part);
      if (!ok) throw new Error('部件卡未找到: ' + part);
      await sleep(120);
    }
    await submitParts();
  } else {
    const ok = await clickCard(m.ids[0]);
    if (!ok) throw new Error('字卡未找到: ' + m.ids[0] + ' 选项=' + JSON.stringify(view.options));
  }
  return m;
}
// 故意答错一次（choose 点干扰字卡 / parts 勾干扰部件提交），返回答错反馈文本。
async function answerHanziWrongOnce() {
  const view = await hanziRound();
  const m = await matchHanziTask(view.prompt, view.imageSrc);
  if (m.error) throw new Error(m.error);
  if (m.task.kind === 'hanzi-parts') {
    const wrong = m.task.options.filter(o => !m.task.parts.includes(o)).slice(0, 2);
    if (wrong.length < 2) throw new Error('干扰部件不足: ' + JSON.stringify(m.task.options));
    for (const part of wrong) { await clickCard(part); await sleep(140); }
    await submitParts();
  } else {
    const wrong = m.task.options.find(o => o !== m.task.target);
    if (wrong === undefined) throw new Error('无干扰项: ' + JSON.stringify(m.task.options));
    await clickCard(wrong);
  }
  return waitUntil(async () => {
    const v = await hanziRound();
    return v.feedback && /再想一想/.test(v.feedback) ? v.feedback : null;
  }, '答错反馈「再想一想」', 10000);
}
async function playHanziRound(label, { wrongFirst = false, shotPrefix = null } = {}) {
  const steps = [];
  for (let n = 0; n < 12; n++) {
    const pc = await hanziCheck();
    if (pc.result) break;
    if (pc.overlay) { log('检测到暂停遮罩，点击继续游戏'); await clickEl('#btn-resume'); await sleep(700); }
    const view = await hanziRound();
    if (view.feedback) { await sleep(1100); continue; } // 上一题反馈窗口，等推进
    const before = view.progress;
    let detail;
    if (n === 0 && wrongFirst) {
      const fb = await answerHanziWrongOnce();
      log(`${label}: 第 1 题故意答错（${JSON.stringify(view.options)}），反馈「${fb}」`);
      if (shotPrefix) await shot(`${shotPrefix}-04-q1-wrong`);
      detail = await answerHanziCorrect();
      log(`${label}: 第 1 题重试正确 → 5 分档`);
    } else {
      detail = await answerHanziCorrect();
      log(`${label}: 第 ${n + 1} 题 ${detail.task.kind} 正确作答 ${JSON.stringify(detail.ids)}`);
    }
    await waitUntil(async () => {
      const v = await hanziRound();
      const c = await hanziCheck();
      return c.result || v.progress !== before ? v : null;
    }, `hanzi 第 ${n + 1} 题推进`, 20000);
    steps.push({ no: n + 1, kind: detail.task.kind, progress: before });
    if (n === 0 && shotPrefix) await shot(`${shotPrefix}-05-q2`);
  }
  return waitUntil(async () => { const c = await hanziCheck(); return c.result ? c : null; }, 'hanzi 结算屏', 20000);
}
const hanziRecords = () => evalSync(`(() => { const raw = localStorage.getItem('pixel-academy:hanzi-hero:v1:records'); return raw ? JSON.parse(raw).length : 0; })()`);
async function selectHanziGrade1() {
  await waitUntil(async () => {
    await evalSync(`(() => { const card = [...document.querySelectorAll('.grade-card')].find(c => c.textContent === '一年级');
      if (card && card.getAttribute('aria-pressed') !== 'true') card.click();
      return true; })()`);
    return evalSync(`(() => { const card = [...document.querySelectorAll('.grade-card')].find(c => c.textContent === '一年级');
      return card?.getAttribute('aria-pressed') === 'true' && !document.querySelector('#btn-start')?.disabled; })()`);
  }, '一年级勾选', 12000);
  return evalSync(`document.querySelector('#availability-status')?.textContent`);
}

// ===== 场景台账 =====
const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

// ===== 主流程 =====
try {
await wd('POST', `${base}/timeouts`, { implicit: 0, pageLoad: 30000, script: 30000 });
const ua = await evalSync(`navigator.userAgent`);
const udidReported = session.capabilities?.['safari:deviceUDID'] ?? null;
log('UA:', ua);
const simOk = ua.includes('iPhone') && udidReported === UDID;
if (!simOk) throw new Error(`会话未落在目标 iOS 模拟器: UA=${ua} UDID=${udidReported}`);

// ============================================================
// S1 在线：首页入口 → hanzi.html → 完整局 5 题 → 结算（首答 10 分、重试 5 分）
// ============================================================
let s1 = null;
try {
  await wd('POST', `${base}/url`, { url: ORIGIN });
  await sleep(2500);
  await waitUntil(async () => { const pc = await homeCheck(); return pc?.select && pc.anchor ? pc : null; }, '首页选择屏就绪');
  await evalSync(INJECT);
  const pc0 = await homeCheck();
  const ovHome = await checkOverflow('S1-首页选择屏');
  if (ovHome) throw new Error('首页出现横向溢出');
  await collectErrors('S1-首页选择屏');
  // 菜单内的汉字勇者入口
  await clickEl('#btn-menu');
  await waitUntil(async () => { const pc = await homeCheck(); return pc.menuOpen && pc.anchor?.visible ? pc : null; }, '菜单弹层打开');
  const entryPc = await homeCheck();
  const entryOk = entryPc.anchor.href === '/hanzi.html' && entryPc.anchor.text.includes('汉字勇者')
    && entryPc.anchor.decorAriaHidden === 'true';
  await shot('ios-s1-01-home-entry');
  if (!entryOk) throw new Error(`汉字勇者入口异常: ${JSON.stringify(entryPc.anchor)}`);
  // 点击入口进入 hanzi.html
  await collectErrors('S1-首页菜单'); // 导航会清空 window，先入账
  await clickEl('#main-nav a[href="/hanzi.html"]');
  await waitUntil(async () => { const c = await hanziCheck(); return c && !c.bootFail && c.gradeCards === 6 && c.select ? c : null; }, 'hanzi 选择屏就绪', 30000);
  await evalSync(INJECT);
  const hc0 = await hanziCheck();
  const ovHanzi = await checkOverflow('S1-hanzi选择屏');
  if (ovHanzi) throw new Error('hanzi 选择屏出现横向溢出');
  await shot('ios-s1-02-hanzi-select');
  const availText = await selectHanziGrade1();
  log('可用性文案:', availText);
  await shot('ios-s1-03-availability');
  const recordsBefore = await hanziRecords();
  await clickEl('#btn-start');
  await waitUntil(async () => (await hanziCheck()).game, 'hanzi 进入游戏屏');
  // 第 1 题先错后对（重试 5 分档），第 2–5 题首答正确（10 分档）→ 期望总分 45
  await playHanziRound('S1', { wrongFirst: true, shotPrefix: 'ios-s1' });
  await waitUntil(async () => (await hanziCheck()).result, 'hanzi 结算屏出现');
  const resultScore = await evalSync(`document.querySelector('#result-score')?.textContent`);
  const resultDetail = await evalSync(`document.querySelector('#result-detail')?.textContent`);
  const recordsAfter = await hanziRecords();
  const scoreOk = /总分 45/.test(resultScore ?? '') && /首次答对 4\/5/.test(resultDetail ?? '') && /答错 1 次/.test(resultDetail ?? '');
  await shot('ios-s1-06-result');
  const errs = await collectErrors('S1-hanzi对局与结算');
  const ovResult = await checkOverflow('S1-hanzi结算屏');
  s1 = { resultScore, resultDetail, records: [recordsBefore, recordsAfter], entry: entryPc.anchor, availability: availText, errors: errs, overflowResult: ovResult };
  record('S1 在线 hanzi 完整局（入口→5 题→结算）',
    scoreOk && recordsAfter === recordsBefore + 1 && errs.length === 0 && !ovResult,
    `首页菜单「汉字勇者」入口（href=${entryPc.anchor.href}）点击进入 hanzi.html；选一年级（${availText}）开局；第 1 题先错后对（重试 5 分档）、第 2–5 题首答正确（10 分档），结算「${resultScore}」「${resultDetail}」（= 5 + 10×4，验证首答 10 分、重试 5 分）；记录 ${recordsBefore}→${recordsAfter} 条；JS 错误 ${errs.length}、结算屏溢出 ${ovResult}`,
    { checks: s1 });
} catch (e) {
  record('S1 在线 hanzi 完整局（入口→5 题→结算）', false, `失败: ${e.message}`, { checks: s1 });
}

// ============================================================
// S2 返回路径：hanzi 返回数字消除首页 → 选年级开局 → 作答 2 题 → 弃局
// ============================================================
let s2 = null;
try {
  // hanzi 结算 → 返回选择 → 顶栏「返回数字消除」回首页
  await clickEl('#btn-result-return');
  await waitUntil(async () => { const c = await hanziCheck(); return c.select ? c : null; }, 'hanzi 返回选择屏');
  const back = (await hanziCheck()).backLink;
  if (!back?.visible || back.href !== '/') throw new Error(`返回链接异常: ${JSON.stringify(back)}`);
  await collectErrors('S2-hanzi选择屏'); // 即将导航，先入账
  await clickEl('.profile-bar a.btn-ghost');
  // 窄屏下导航入口收纳于菜单弹层，未开菜单时 anchor 不可见：只断言 pathname+选择屏，
  // 再开菜单核对入口可见（与桌面 nav-browser.mjs S3 同口径）。
  await waitUntil(async () => { const pc = await homeCheck(); return pc?.select && pc.url === '/' ? pc : null; }, '返回数字消除首页', 30000);
  await evalSync(INJECT);
  await clickEl('#btn-menu');
  await waitUntil(async () => { const pc = await homeCheck(); return pc.menuOpen && pc.anchor?.visible ? pc : null; }, '返回后菜单弹层');
  const homePc = await homeCheck();
  if (homePc.anchor.href !== '/hanzi.html') throw new Error(`返回后入口异常: ${JSON.stringify(homePc.anchor)}`);
  const ovHome2 = await checkOverflow('S2-返回后首页(菜单开)');
  await shot('ios-s2-01-home-back');
  await clickEl('#btn-menu-close');
  await waitUntil(async () => { const pc = await homeCheck(); return !pc.menuOpen ? pc : null; }, '菜单关闭');
  const before = await state();
  log(`S2 局前 records=${before.records} coins=${before.coins}`);
  // 选一年级 → 可用性屏 → 开局
  for (let round = 0; round < 8; round++) {
    const need = await evalSync(`(() => { const inputs = [...document.querySelectorAll('input[name=grade]')];
      const checked = new Set(inputs.filter(i => i.checked).map(i => Number(i.value)));
      return checked.has(1) ? null : 1; })()`);
    if (need === null) break;
    await clickEl(`input[name=grade][value="1"]`);
    await sleep(700);
  }
  const settled = await evalSync(`(() => { const checked = [...document.querySelectorAll('input[name=grade]')].filter(i => i.checked);
    return checked.length === 1 && checked[0].value === '1' && !document.querySelector('#btn-to-availability').disabled; })()`);
  if (!settled) throw new Error('数字消除年级勾选未稳定');
  await clickEl('#btn-to-availability');
  await waitUntil(async () => { const pc = await homeCheck(); return pc.availability ? pc : null; }, '数字消除可用性屏');
  const availText2 = (await homeCheck()).availabilityStatus;
  await shot('ios-s2-02-availability');
  await clickEl('#btn-start');
  // 残留局确认弹窗（全新档案不应出现，防御性处理）
  await waitUntil(async () => {
    const pc = await homeCheck();
    if (pc.game) return pc;
    const open = await evalSync(`document.querySelector('#confirm-dialog')?.open ?? false`);
    if (open) { await clickEl('#confirm-dialog button[value="yes"]'); }
    return null;
  }, '数字消除进入对局', 25000);
  await waitUntil(async () => { const s = await state(); return s.challenge && s.challenge.phase !== 'ready' ? s : null; }, '数字消除开局');
  // 作答 2 题（choice 经 el.click()，棋盘经 PointerEvent 几何点按）
  const answered = [];
  for (let n = 0; n < 10 && answered.length < 2; n++) {
    const pc = await homeCheck();
    if (pc.result) break;
    if (pc.overlay) { await clickEl('#btn-resume'); await sleep(700); }
    let s = await state();
    if (!s.challenge) throw new Error('数字消除：档案中无挑战状态');
    if (s.challenge.phase === 'ready') { await clickEl('#btn-ready'); s = await state(); }
    if (s.challenge.phase !== 'asking') { await sleep(500); continue; }
    const step = await answerNumberCurrent(s);
    log(`S2: 数字消除第 ${s.challenge.questionIndex + 1} 题 ${step.kind} 期望 ${JSON.stringify(step.expected)}${step.tile != null ? ` 块 ${step.tile}` : ''}`);
    await waitForNumberProgress(s.challenge.questionIndex);
    answered.push(step);
  }
  if (answered.length < 2) throw new Error(`数字消除仅作答 ${answered.length} 题`);
  await shot('ios-s2-03-answered2');
  // 弃局：返回 → 确认
  await clickEl('#btn-game-return');
  await sleep(800);
  const open = await evalSync(`document.querySelector('#confirm-dialog')?.open ?? false`);
  if (open) await clickEl('#confirm-dialog button[value="yes"]');
  await waitUntil(async () => { const pc = await homeCheck(); return pc.select ? pc : null; }, '弃局后回到选择屏');
  const after = await state();
  await collectErrors('S2-数字消除对局');
  const ovSel = await checkOverflow('S2-数字消除选择屏');
  await shot('ios-s2-04-select-after-abandon');
  s2 = { backLink: back, answered: answered.length, availability: availText2, records: [before.records, after.records], coins: [before.coins, after.coins] };
  record('S2 返回路径与数字消除开局', homePc.select && ovHome2 === false && answered.length >= 2 && after.records === before.records,
    `hanzi 顶栏「${back.text}」返回 ${ORIGIN} 首页（无溢出）；勾选一年级 → 可用性「${availText2}」→ 开局，作答 2 题（${answered.map(a => a.kind).join('、')}）后弃局返回选择屏；成绩 ${before.records}→${after.records} 条（弃局不产生成绩）；金币 ${before.coins}→${after.coins}`,
    { checks: s2 });
} catch (e) {
  record('S2 返回路径与数字消除开局', false, `失败: ${e.message}`, { checks: s2 });
}

// ============================================================
// S3 离线（断源刷新口径）：SW 受控 → kill 服务 → 刷新 → 首页/hanzi 缓存打开 → hanzi 完整局
// ============================================================
let s3 = null;
try {
  // SW 受控与预缓存断言（在线末尾）
  let controlled = await evalSync(`!!navigator.serviceWorker.controller`);
  if (!controlled) {
    log('SW 未受控，在线重载一次');
    await wd('POST', `${base}/refresh`);
    await sleep(2500);
    await waitUntil(async () => (await homeCheck())?.select, '重载后选择屏');
    controlled = await evalSync(`!!navigator.serviceWorker.controller`);
  }
  if (!controlled) throw new Error('SW 未受控，无法进入断源口径');
  const cacheInfo = await evalAsync(`(async () => {
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    const home = await cache.match('/'); const hanzi = await cache.match('/hanzi.html');
    return { name, homeCached: !!home, hanziCached: !!hanzi,
      homeHasEntry: home ? (await home.text()).includes('/hanzi.html') : false,
      hanziHasBack: hanzi ? (await hanzi.text()).includes('返回数字消除') : false };
  })()`);
  await collectErrors('S3-断源前在线首页');
  const onLineBefore = await evalSync(`navigator.onLine`);
  // 断源：杀本地静态服务
  await execFileP('pkill', ['-f', 'serve.mjs 4373']);
  await sleep(1500);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}sw.js`, { signal: AbortSignal.timeout(3000) }); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  log('源站已断开，刷新当前标签页（非冷导航）');
  await wd('POST', `${base}/refresh`).catch(e => log('refresh 报错（继续等待）:', e.message.slice(0, 120)));
  await waitUntil(async () => { const pc = await homeCheck(); return pc?.select && !pc.error ? pc : null; }, '断源刷新后首页由缓存打开', 40000);
  await evalSync(INJECT);
  const offHome = await homeCheck();
  // 残留中断局清理（如有）
  if (offHome.restoreOffer) {
    log('发现残留中断局，放弃之');
    await clickEl('#btn-discard-round'); await sleep(600);
    await clickEl('#confirm-dialog button[value="yes"]');
    await waitUntil(async () => { const pc = await homeCheck(); return !pc.restoreOffer ? pc : null; }, '残留局清理');
  }
  const onLineAfter = await evalSync(`navigator.onLine`);
  const ovOffHome = await checkOverflow('S3-离线首页');
  await collectErrors('S3-离线首页');
  await shot('ios-s3-01-offline-home');
  // 经菜单入口离线进入 hanzi.html
  await clickEl('#btn-menu');
  await waitUntil(async () => { const pc = await homeCheck(); return pc.menuOpen && pc.anchor?.visible ? pc : null; }, '断源后菜单');
  await clickEl('#main-nav a[href="/hanzi.html"]');
  await waitUntil(async () => { const c = await hanziCheck(); return c && !c.bootFail && c.gradeCards === 6 && c.select ? c : null; }, '断源后 hanzi 页由缓存打开', 30000);
  await evalSync(INJECT);
  const offHanzi = await hanziCheck();
  const ovOffHanzi = await checkOverflow('S3-离线hanzi选择屏');
  await shot('ios-s3-02-offline-hanzi-select');
  const availText3 = await selectHanziGrade1();
  const recordsBefore3 = await hanziRecords();
  await clickEl('#btn-start');
  await waitUntil(async () => (await hanziCheck()).game, '离线 hanzi 进入游戏屏');
  await playHanziRound('S3-离线', { wrongFirst: false, shotPrefix: 'ios-s3' });
  await waitUntil(async () => (await hanziCheck()).result, '离线 hanzi 结算屏出现');
  const resultScore3 = await evalSync(`document.querySelector('#result-score')?.textContent`);
  const resultDetail3 = await evalSync(`document.querySelector('#result-detail')?.textContent`);
  const recordsAfter3 = await hanziRecords();
  const scoreOk3 = /总分 50/.test(resultScore3 ?? '') && /首次答对 5\/5/.test(resultDetail3 ?? '');
  await shot('ios-s3-04-offline-result');
  const errs3 = await collectErrors('S3-离线hanzi对局与结算');
  const ovOffResult = await checkOverflow('S3-离线hanzi结算屏');
  s3 = { controlled: true, cacheInfo, onLineBefore, onLineAfter, offlineNoticeHome: offHome.offlineNotice,
    offlineNoticeHanzi: offHanzi.offlineNotice, resultScore: resultScore3, resultDetail: resultDetail3,
    records: [recordsBefore3, recordsAfter3], availability: availText3, errors: errs3 };
  record('S3 离线断源刷新（首页+hanzi 缓存打开+完整局）',
    !!cacheInfo?.homeHasEntry && !!cacheInfo?.hanziCached && ovOffHome === false && ovOffHanzi === false
      && scoreOk3 && recordsAfter3 === recordsBefore3 + 1 && errs3.length === 0 && !ovOffResult,
    `SW ${cacheInfo.name} 受控（预缓存含 /${cacheInfo.homeHasEntry ? '+' : '-'}入口与 /hanzi.html${cacheInfo.hanziCached ? '+' : '-'}）；杀源后刷新同一标签页，首页由缓存打开（离线提示「${offHome.offlineNotice}」，navigator.onLine=${onLineAfter}）；经菜单入口离线进入 hanzi.html（离线提示「${offHanzi.offlineNotice}」），选一年级（${availText3}）完整玩 5 题全对，结算「${resultScore3}」「${resultDetail3}」；记录 ${recordsBefore3}→${recordsAfter3} 条；JS 错误 ${errs3.length}；溢出 首页${ovOffHome}/hanzi${ovOffHanzi}/结算${ovOffResult}`,
    { checks: s3 });
} catch (e) {
  record('S3 离线断源刷新（首页+hanzi 缓存打开+完整局）', false, `失败: ${e.message}`, { checks: s3 });
}

// ============================================================
// S4 全程无 JS 错误、无横向溢出（贯穿台账汇总）
// ============================================================
const allScenariosPass = scenarios.every(x => x.pass);
const s4Pass = errorLedger.length === 0 && overflowLedger.every(x => !x.overflow) && allScenariosPass;
record('S4 全程无 JS 错误、无横向溢出', s4Pass,
  `台账覆盖 ${overflowLedger.length} 个页面检查点，溢出 ${overflowLedger.filter(x => x.overflow).length} 处；JS 错误台账 ${errorLedger.length} 条（${JSON.stringify(errorLedger)}）`,
  { checks: { errorLedger, overflowLedger } });

const summary = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN, udid: UDID, wdEndpoint: WD,
  userAgent: ua, sessionUdid: udidReported,
  scenarios, errorLedger, overflowLedger,
  allPassed: scenarios.every(x => x.pass),
};
await writeFile(join(outDir, 'ios-results.json'), JSON.stringify(summary, null, 2));
log('结果已写入', join(outDir, 'ios-results.json'));
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
} finally {
  try { await wd('DELETE', base); } catch { /* 会话已失效 */ }
}
process.exitCode = scenarios.length && scenarios.every(x => x.pass) ? 0 : 1;
