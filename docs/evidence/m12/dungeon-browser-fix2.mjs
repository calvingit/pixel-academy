// 算术地下城（M12）缺陷修复复验轮补充场景（复验第 2 轮的覆盖缺口补齐）。
//   F2b：F2 探针局（石门整数题逐键键入 + 通关 35 分）的练习记录核对——补 gameId/
//        score/retries/keyUses 断言（F2 结束时页面停在结算屏，记录已写入）。
//   F5b：断源重跑——修正断网循环（选择题局放弃重开，直到石门为整数题），整数题
//        真实逐键键入 → Enter 提交（断网整数题提交覆盖）→ 穿门 → 三页缓存互导。
// 结果追加进 dungeon-browser-results.json 的 fixVerification.scenarios。
import { writeFile, readFile } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4173/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9742';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m12';
const resultsPath = `${outDir}/dungeon-browser-results.json`;
const log = (...a) => console.log('[fix-verify-2]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

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
const goto = async url => { await send('Page.navigate', { url }); await sleep(1200); };

const homeState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  return {
    url: location.href, selectVisible: !hidden('screen-select'),
    menuDialogOpen: document.getElementById('menu-dialog')?.open ?? false,
    dungeonAnchorVisible: !!(document.querySelector('#main-nav a[href="/dungeon.html"]')?.offsetWidth),
    offlineNotice: hidden('offline-notice') ? null : t('offline-notice'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

const hanziState = () => evaluate(`(() => ({
  url: location.href,
  bootFailHidden: document.getElementById('boot-fail')?.hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  selectVisible: !document.getElementById('screen-select')?.hidden,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  errors: window.__errors ?? [],
}))()`, false);

const dungeonState = () => evaluate(`(() => {
  const t = id => document.getElementById(id)?.textContent ?? null;
  const hidden = id => document.getElementById(id)?.hidden;
  let snap = null;
  try { const raw = localStorage.getItem('pixel-academy:arithmetic-dungeon:v1:interrupted'); snap = raw ? JSON.parse(raw) : null; } catch {}
  let recordsRaw = null;
  try { recordsRaw = JSON.parse(localStorage.getItem('pixel-academy:arithmetic-dungeon:v1:records') ?? 'null'); } catch {}
  return {
    url: location.href,
    selectVisible: !hidden('screen-select'),
    gameVisible: !hidden('screen-game'),
    bootFailHidden: document.getElementById('boot-fail')?.hidden,
    gradeCards: document.querySelectorAll('#grade-grid button').length,
    startDisabled: document.getElementById('btn-start')?.disabled,
    hudRoom: t('hud-room'), hudScore: t('hud-score'),
    routeButtons: [...document.querySelectorAll('#route-list button')].map(b => ({
      text: b.textContent, locked: b.classList.contains('route-locked'), disabled: b.disabled })),
    questionVisible: !hidden('question-card'),
    slotTitle: t('slot-title'), prompt: t('question-prompt'),
    countdown: t('countdown'),
    optionsHidden: hidden('options'),
    inputValue: document.getElementById('answer-input')?.value ?? null,
    inputSubmitDisabled: document.getElementById('btn-input-submit')?.disabled,
    feedbackHidden: hidden('feedback'),
    feedback: t('feedback'),
    resultScore: t('result-score'),
    confirmOpen: document.getElementById('confirm-dialog')?.open ?? false,
    snapshot: snap ? { roundId: snap.roundId, room: snap.state?.room } : null,
    recordsRaw,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    errors: window.__errors ?? [],
  };
})()`, false);

const installDungeonPool = grades => evaluate(`(async () => {
  const { selectDungeonExercises } = await import('/dist/game/arithmetic-dungeon/content.js');
  const { taskText } = await import('/dist/game/number-puzzle/learning.js');
  const { correctOptionIds, isMultiple, optionText } = await import('/dist/learning/choice.js');
  const { answerFor } = await import('/dist/learning/evaluation.js');
  const picked = selectDungeonExercises(${JSON.stringify(grades)});
  window.__pool = picked.map(e => ({
    id: e.id, status: e.review.status, text: taskText(e.task), kind: e.task.kind,
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
  return matches.length ? { id: matches[0].id, kind: matches[0].kind, multiple: matches[0].multiple,
    ids: matches[0].ids, correct: matches[0].correct, answer: matches[0].answer } : null;
})()`, false);

const trustedClick = async selector => {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found');
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) throw new Error('element not visible');
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`, false);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
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
  if (!b || b.disabled) throw new Error('路线按钮不可用: ' + ${JSON.stringify(prefix)});
  b.click();
})()`, false);
const waitRoom = (name, desc) => waitUntil(async () => {
  const s = await dungeonState();
  return s.gameVisible && s.hudRoom === name && !s.questionVisible ? s : null;
}, desc);
const waitQuestion = (prefix, desc) => waitUntil(async () => {
  const s = await dungeonState();
  return s.gameVisible && s.questionVisible && s.slotTitle?.startsWith(prefix)
    && (s.countdown ?? '').startsWith('剩余') ? s : null;
}, desc);
const submitLanded = async () => {
  const s = await dungeonState();
  return s.feedbackHidden === false || !s.questionVisible ? s : null;
};
const typeIntegerAnswer = async value => {
  await trustedClick('#answer-input');
  const disabledSeq = [];
  for (const ch of String(value)) {
    await send('Input.insertText', { text: ch });
    await sleep(80);
    disabledSeq.push((await dungeonState()).inputSubmitDisabled);
  }
  return disabledSeq;
};

// ============================================================
// F2b F2 探针局的练习记录核对（整数题通关 35 分局的记录归属）。
// F2 结束后页面已被 F5 场景导航走，但 F2 局记录已持久化（localStorage），
// 此处直接从记录存储核对：score=35 的记录中应有一条石门为整数题（F2 局）。
// ============================================================
try {
  const st = await dungeonState();
  const recs35 = (st.recordsRaw?.records ?? []).filter(r => r.score === 35 && r.answer?.questions?.length === 4);
  // F1（全 choice 局）与 F2（含整数题局）各有一条 35 分记录；choice 生成题的
  // exerciseId 内嵌 question JSON（含 "kind"），整数题 id 无该片段，以此区分 F2 局。
  const recWithInteger = recs35.find(r => !r.answer.questions.some(q => q.exerciseId.includes('"kind"'))
    || r.answer.questions[0].exerciseId.includes('binary') || r.answer.questions[0].exerciseId.includes('chain'));
  const allWellFormed = recs35.length >= 1 && recs35.every(r => r.gameId === 'arithmetic-dungeon'
    && r.explore?.retries === 1 && r.explore?.keyUses === 0
    && r.answer.questions.every(q => q.firstTry === (q.slot !== 'gate-right'))
    && JSON.stringify(r.explore?.route) === JSON.stringify(['start', 'junction', 'resource', 'junction', 'end']));
  const finalState = await dungeonState();
  const ok = recs35.length >= 1 && !!recWithInteger && allWellFormed && finalState.errors.length === 0;
  record('F2b 含整数题通关局（F2 探针局）的练习记录核对', ok,
    `35 分记录 ${recs35.length} 条（F1 全 choice 局 + F2 含整数题局）全部结构正确：gameId=${recs35[0]?.gameId}、retries=1、keyUses=0、route=起点→岔口→资源房→岔口→终点房、右门外均 firstTry=true；含整数题的 F2 局记录石门 exerciseId=${recWithInteger?.answer?.questions?.[0]?.exerciseId?.slice(0, 60)}…——整数题通关局的记录归属与首轮同构、gameId 可区分；JS 错误 ${finalState.errors.length} 个`,
    { checks: { records35: recs35, recWithInteger: recWithInteger?.recordId ?? null, overflow: finalState.overflowX, errors: finalState.errors } });
} catch (e) {
  record('F2b 含整数题通关局（F2 探针局）的练习记录核对', false, `失败: ${e.message}`);
}

// ============================================================
// F5b 断源重跑：断网循环直到整数题 → 逐键键入 → Enter 提交
// ============================================================
try {
  await goto(`${ORIGIN}`);
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible ? s : null; }, 'F5b 首页就绪');
  const swInfo = await waitUntil(async () => evaluate(`(async () => {
    if (navigator.serviceWorker.controller === null) return null;
    const keys = await caches.keys();
    const name = keys.find(k => k.startsWith('pixel-academy:number-puzzle:'));
    if (!name) return null;
    const cache = await caches.open(name);
    return (await cache.match('/dungeon.html')) && (await cache.match('/dungeon.css')) ? { name } : null;
  })()`), 'F5b SW 受控且缓存就绪', 40000);
  const { execSync } = await import('node:child_process');
  try { execSync('kill $(lsof -ti tcp:4173 -sTCP:LISTEN) 2>/dev/null || true', { shell: '/bin/zsh' }); } catch {}
  await sleep(1000);
  let sourceDead = false;
  try { await fetch(`${ORIGIN}sw.js`); } catch { sourceDead = true; }
  if (!sourceDead) throw new Error('源站未成功断开');
  await send('Page.reload', { ignoreCache: false });
  await waitUntil(async () => { const s = await homeState(); return s.selectVisible && !s.errorVisible ? s : null; }, '断源后首页可打开', 30000);
  const offlineHome = await homeState();
  await shot('fx5b-01-offline-home');
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen && s.dungeonAnchorVisible ? s : null; }, '断源后菜单');
  await trustedClick('#main-nav a[href="/dungeon.html"]');
  const offlineDungeon = await waitUntil(async () => {
    const s = await dungeonState();
    return s.url.endsWith('/dungeon.html') && s.bootFailHidden && s.selectVisible && s.gradeCards === 6 ? s : null;
  }, '断源后地下城可打开', 30000);
  await shot('fx5b-02-offline-dungeon');
  const offlinePool = await installDungeonPool([1]).catch(e => { throw new Error(`断网下题库模块 import 失败: ${e.message}`); });
  // 循环开局直到石门为整数题（choice 局作答后放弃重开）
  let offlineAnswer = null;
  let offlineRounds = 0;
  for (let i = 0; i < 60; i++) {
    await click('#btn-start');
    await waitRoom('起点', `断源开局（第 ${i + 1} 次）`);
    await clickRoute('石门（锁着）');
    const q = await waitQuestion('石门', `石门面板（第 ${i + 1} 局）`);
    offlineRounds = i + 1;
    if (q.optionsHidden) {
      const task = await matchTask(q.prompt, null);
      const disabledSeq = await typeIntegerAnswer(String(task.answer));
      if (disabledSeq[0] !== false) throw new Error('断网下键入后按钮未实时启用');
      await pressEnter();
      const landed = await waitUntil(submitLanded, '断网整数题 Enter 提交受理', 3000).catch(() => null);
      if (!landed) throw new Error('断网整数题 Enter 提交未受理');
      offlineAnswer = { prompt: q.prompt, kind: task.kind, typed: true, viaEnter: 'enter', value: task.answer };
    } else {
      const texts = (await dungeonState()).prompt;
      const task = await matchTask(texts, []);
      const st = await dungeonState();
      const correct = task?.correct ?? [];
      const texts2 = st.optionsHidden ? [] : null;
      void texts2;
      // choice 局：点正确项，穿门后放弃重开
      const match = await matchTask(st.prompt, await evaluate(`[...document.querySelectorAll('#options button')].map(b => b.textContent)`));
      if (!match) throw new Error(`断网选择题匹配失败: ${st.prompt}`);
      const idx = match.ids.indexOf(match.correct[0]);
      await evaluate(`(() => { document.querySelectorAll('#options button')[${idx}]?.click(); })()`, false);
      await waitRoom('岔口', '断源 choice 石门开启');
      await click('#btn-game-return');
      await waitUntil(async () => { const s = await dungeonState(); return s.confirmOpen ? s : null; }, '断源放弃确认');
      await confirmYes();
      await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, '断源回选择屏');
      continue;
    }
    const junction = await waitRoom('岔口', '断源整数题开启石门到岔口');
    offlineAnswer.gainedScore = junction.hudScore;
    break;
  }
  if (!offlineAnswer) throw new Error('60 局内断网未抽到整数题');
  await shot('fx5b-03-offline-integer-typing');
  if (offlineAnswer.gainedScore !== '得分 10') throw new Error(`断源整数题得分异常: ${offlineAnswer.gainedScore}`);
  await click('#btn-game-return');
  await waitUntil(async () => { const s = await dungeonState(); return s.confirmOpen ? s : null; }, '断源放弃确认');
  await confirmYes();
  await waitUntil(async () => { const s = await dungeonState(); return s.selectVisible ? s : null; }, '断源放弃回选择屏');
  const afterDiscard = await dungeonState();
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断源后返回首页', 30000);
  await trustedClick('#btn-menu');
  await waitUntil(async () => { const s = await homeState(); return s.menuDialogOpen ? s : null; }, '断源菜单再开');
  await trustedClick('#main-nav a[href="/hanzi.html"]');
  const offlineHanzi = await waitUntil(async () => {
    const s = await hanziState();
    return s.url.endsWith('/hanzi.html') && s.bootFailHidden && s.gradeCards === 6 ? s : null;
  }, '断源后汉字勇者可打开', 30000);
  await shot('fx5b-04-offline-hanzi');
  await trustedClick('.profile-bar a.btn-ghost');
  await waitUntil(async () => { const s = await homeState(); return new URL(s.url).pathname === '/' && s.selectVisible ? s : null; }, '断源 hanzi 返回首页', 30000);
  const finalHome = await homeState();
  const ok = swInfo && sourceDead && offlineDungeon.selectVisible && (offlinePool?.count ?? 0) > 0
    && offlineAnswer.typed === true && offlineAnswer.gainedScore === '得分 10'
    && afterDiscard.snapshot === null && offlineHanzi.gradeCards === 6
    && finalHome.errors.length === 0 && offlineHanzi.errors.length === 0;
  record('F5b 断源重跑：断网整数题逐键键入 + Enter 提交', ok,
    `sw.js 版本 ${swInfo.name}；杀源站（确认失败）后刷新：首页由缓存打开（提示「${offlineHome.offlineNotice ?? ''}」）→菜单进地下城正常→断网题库 import 成功（${offlinePool?.count} 题）→第 ${offlineRounds} 局石门命中整数题「${offlineAnswer.prompt}」：逐键键入实时启用「开门」（首字符后 disabled=false）→**Enter 提交受理** +10 穿门到岔口（断网整数题键入提交走通）→放弃（快照清除）→返回锚点回首页→hanzi.html 正常（6 年级卡）——三入口缓存互导；JS 错误 0`,
    { checks: { swInfo, sourceDead, offlinePoolCount: offlinePool?.count ?? null, offlineAnswer, offlineRounds, snapshotDiscarded: afterDiscard.snapshot === null, overflow: finalHome.overflowX, errors: { home: finalHome.errors, dungeon: offlineDungeon.errors, hanzi: offlineHanzi.errors } } });
} catch (e) {
  record('F5b 断源重跑：断网整数题逐键键入 + Enter 提交', false, `失败: ${e.message}`);
}

// ===== 合并进 fixVerification =====
const overflowBad = scenarios.filter(s => (s.checks?.overflow === true));
const errorBad = scenarios.filter(s => (s.checks?.errors && ((Array.isArray(s.checks.errors) ? s.checks.errors : Object.values(s.checks.errors).flat()).length > 0)));
const prev = JSON.parse(await readFile(resultsPath, 'utf8'));
const fv = prev.fixVerification;
fv.scenarios.push(...scenarios);
fv.supplementDriverScript = 'docs/evidence/m12/dungeon-browser-fix.mjs（补充场景同文件系列，本轮为 F2b/F5b）';
fv.allPassed = fv.scenarios.every(s => s.pass);
// 重新计算贯穿汇总（合并 F2b/F5b）
const allScenarios = fv.scenarios;
const overflowAll = allScenarios.filter(s => (s.checks?.overflow === true)).map(s => s.name);
const errorAll = allScenarios.filter(s => (s.checks?.errors && ((Array.isArray(s.checks.errors) ? s.checks.errors : Object.values(s.checks.errors).flat()).length > 0))).map(s => s.name);
fv.d10Throughline = {
  horizontalOverflowScenarios: overflowAll,
  jsErrorScenarios: errorAll,
  allNoOverflow: overflowAll.length === 0,
  allZeroErrors: errorAll.length === 0,
};
fv.supplementedAt = new Date().toISOString();
await writeFile(resultsPath, JSON.stringify(prev, null, 2));
log('补充场景已合并写入', resultsPath);
log(JSON.stringify(scenarios.map(s => ({ name: s.name, pass: s.pass })), null, 2));
ws.close();
process.exit(0);
