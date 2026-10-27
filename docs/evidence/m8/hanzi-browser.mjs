// 汉字勇者首版浏览器验证（M8-D）：桌面无头 Chrome 经 CDP，DOM 控件真实点击。
// 答案从页面任务（DOM 读取题面）经 dist 判题模块自算；不注入状态。
// 场景：V1 完整局（识别/配对/组字混合）→ 结算断言 → 刷新恢复核对 → 再来一局 → 记录。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4191/';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m8';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[hanzi]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// CDP 连接
const CDP_HTTP = process.env.CDP_HTTP ?? '';
let send, evaluate, shot, closeWs;
if (CDP_HTTP) {
  const targets = await (await fetch(`${CDP_HTTP}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, msg => { clearTimeout(timer); msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result); });
    });
  };
  evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`页面异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  shot = async name => {
    // 证据截图前确认页面处于可玩状态（boot-fail 不可见），避免把引导瞬态当证据。
    const bad = await evaluate(`!document.querySelector('#boot-fail')?.hidden`, false).catch(() => true);
    if (bad) throw new Error(`截图 ${name} 时页面处于 boot-fail 状态`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64'));
    log('截图', name);
  };
  closeWs = () => ws.close();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));" });
  await send('Page.navigate', { url: `${ORIGIN}hanzi.html?nosw` });
  await sleep(1500);
  // 验证要求每轮都跑当前构建：注销 SW 并清其缓存（仅本源），随后以空档案重载。
  await evaluate(`(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) await reg.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('pixel-academy:')).map(k => caches.delete(k)));
    Object.keys(localStorage).filter(k => k.startsWith('pixel-academy:hanzi-hero:')).forEach(k => localStorage.removeItem(k));
  })()`, true);
  await send('Page.reload', { ignoreCache: true });
} else {
  throw new Error('需要 CDP_HTTP 环境变量（Chrome DevTools 端点）');
}
// 引导期模块慢加载/SW 更新：等待选择屏接线就绪（最长 20 秒），失败则强刷重试一次。
let booted = false;
for (let attempt = 0; attempt < 2 && !booted; attempt++) {
  if (attempt) { log('主模块未就绪，强刷重试'); await send('Page.reload', { ignoreCache: true }); }
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const ok = await evaluate(`(() => { try {
      return document.querySelector('#boot-fail')?.hidden === true
        && document.querySelectorAll('.grade-card').length === 6
        && typeof document.querySelector('#btn-start')?.onclick === 'function'; } catch { return false; } })()`, false);
    if (ok) { booted = true; break; }
    await sleep(500);
  }
}
if (!booted) throw new Error('主模块加载失败：20 秒未就绪');

const pageCheck = () => evaluate(`(() => ({
  select: !document.querySelector('#screen-select').hidden,
  game: !document.querySelector('#screen-game').hidden,
  result: !document.querySelector('#screen-result').hidden,
  overlay: !document.querySelector('#pause-overlay').hidden,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
  viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  notice: document.querySelector('#storage-notice')?.hidden,
  errors: window.__errors ?? [] }))()`, false);

async function waitUntil(fn, desc, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时: ${desc}`);
    await sleep(300);
  }
}

const readRound = () => evaluate(`(() => {
  const cards = [...document.querySelectorAll('.option-card')];
  return {
    prompt: document.querySelector('#question-prompt')?.textContent ?? '',
    imageHidden: document.querySelector('#question-image')?.hidden,
    imageSrc: document.querySelector('#question-image')?.hidden ? null : document.querySelector('#question-image')?.getAttribute('src') ?? null,
    options: cards.map(c => c.textContent),
    partsSubmitHidden: document.querySelector('#btn-parts-submit')?.hidden,
    progress: document.querySelector('#hud-progress')?.textContent ?? '',
    score: document.querySelector('#hud-score')?.textContent ?? '',
    feedback: document.querySelector('#feedback')?.hidden ? null : document.querySelector('#feedback')?.textContent,
  };
})()`);

async function answerCurrent() {
  const view = await readRound();
  const expected = await evaluate(`(async () => {
    const prompt = ${JSON.stringify(view.prompt)};
    const src = ${JSON.stringify(view.imageSrc)};
    // 从构建产物取全部正式题，按题面（prompt/image）匹配当前题并推导答案。
    const { hanziHeroExercises } = await import('/dist/content/hanzi-hero.js');
    const { correctHanziIds } = await import('/dist/learning/hanzi.js');
    const matches = hanziHeroExercises.filter(e => {
      const t = e.task;
      if (t.kind === 'hanzi-choose' && t.mode === 'shape') return prompt.includes('找出「' + t.target + '」');
      if (t.kind === 'hanzi-choose' && t.mode === 'meaning') return src?.endsWith(t.image);
      return src?.endsWith(t.image);
    });
    if (matches.length !== 1) throw new Error('题面匹配失败: ' + matches.length);
    return { ids: [...correctHanziIds(matches[0].task)], task: matches[0].task };
  })()`);
  const isParts = expected.task.kind === 'hanzi-parts';
  if (isParts) {
    // 组字：点选全部正确部件后提交。
    for (const part of expected.task.parts) {
      const card = await evaluate(`(() => {
        const cards = [...document.querySelectorAll('.option-card')];
        return cards.findIndex(c => c.textContent === ${JSON.stringify(part)});
      })()`);
      await evaluate(`(() => { document.querySelectorAll('.option-card')[${card}]?.click(); })()`, false);
      await sleep(120);
    }
    await evaluate(`(() => { document.querySelector('#btn-parts-submit')?.click(); })()`, false);
  } else {
    const optionText = expected.ids[0];
    await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.option-card')];
      const card = cards.find(c => c.textContent === ${JSON.stringify(optionText)});
      card?.click();
    })()`, false);
  }
  log('作答', isParts ? `组字 ${expected.task.parts.join('+')}` : expected.ids[0]);
  return expected;
}

// ===== V1：完整局 =====
let pc = await waitUntil(async () => { const c = await pageCheck(); return c.select ? c : null; }, '选择屏');
log('视口', JSON.stringify(pc.viewport), '溢出', pc.overflow, '存储可用', pc.notice);
if (pc.overflow) throw new Error('选择屏横向溢出');
await shot('hanzi-v1-01-select');

// 勾选一年级
// 勾选一年级：模块启动可能读到残留 settings，点击后按最终状态补点直至目标达成。
for (let i = 0; i < 4; i++) {
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.grade-card')].find(c => c.textContent === '一年级');
    if (card && card.getAttribute('aria-pressed') !== 'true') card.click();
  })()`, false);
  const ok = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.grade-card')].find(c => c.textContent === '一年级');
    return card?.getAttribute('aria-pressed') === 'true' && !document.querySelector('#btn-start')?.disabled
      ? document.querySelector('#availability-status')?.textContent : null;
  })()`, false);
  if (ok && /28 个任务/.test(ok)) { var avail = ok; break; }
  await sleep(400);
  if (i === 3) throw new Error('一年级勾选未达成');
}
const avail2 = avail;
log('可用性:', avail2);
await shot('hanzi-v1-02-availability');

// 开局
await evaluate(`(() => { document.querySelector('#btn-start')?.click(); })()`, false);
await waitUntil(async () => (await pageCheck()).game, '进入游戏屏');
const steps = [];
for (let n = 0; n < 8; n++) {
  const pcGame = await pageCheck();
  if (pcGame.result) break;
  const view = await readRound();
  if (view.feedback) { await sleep(1100); continue; }
  const before = view.progress;
  await answerCurrent();
  await waitUntil(async () => (await readRound()).progress !== before || (await pageCheck()).result, '题目推进');
  steps.push(before);
}
const pcResult = await waitUntil(async () => (await pageCheck()).result ? await pageCheck() : null, '结算屏');
const resultScore = await evaluate(`document.querySelector('#result-score')?.textContent`, false);
const resultDetail = await evaluate(`document.querySelector('#result-detail')?.textContent`, false);
log('结算:', resultScore, '|', resultDetail);
if (!/总分 50/.test(resultScore)) throw new Error(`首答全对应为 50 分: ${resultScore}`);
if (!/首次答对 5\/5/.test(resultDetail)) throw new Error(`首次答对应为 5/5: ${resultDetail}`);
await shot('hanzi-v1-03-result');

// 记录恰一条
const records = await evaluate(`(() => { const raw = localStorage.getItem('pixel-academy:hanzi-hero:v1:records'); return raw ? JSON.parse(raw).length : 0; })()`);
if (records !== 1) throw new Error(`记录应为 1 条: ${records}`);

// ===== V2：再来一局后第 1 题暂停→刷新→恢复 =====
await evaluate(`(() => { document.querySelector('#btn-again')?.click(); })()`, false);
await waitUntil(async () => (await pageCheck()).game, '再来一局进入游戏屏');
await sleep(300);
const q1 = await readRound();
log('第 2 局第 1 题:', q1.prompt, '| 选项', JSON.stringify(q1.options));
// 第 1 题故意答错一次再答对（验证 5 分档），然后第 2 题暂停刷新恢复。
// 任意题型都可"答错一次再答对"：shape/meaning 点错字卡，组字勾错部件提交。
const firstTask = await evaluate(`(async () => {
  const prompt = ${JSON.stringify(q1.prompt)};
  const src = ${JSON.stringify(q1.imageSrc)};
  const { hanziHeroExercises } = await import('/dist/content/hanzi-hero.js');
  const matches = hanziHeroExercises.filter(e => {
    const t = e.task;
    if (t.kind === 'hanzi-choose') {
      if (t.mode === 'shape') return prompt.includes('找出「' + t.target + '」') && !src;
      return src?.endsWith(t.image) ?? false;
    }
    return src?.endsWith(t.image) ?? false;
  });
  if (matches.length !== 1) throw new Error('第 1 题匹配失败: ' + matches.length + ' prompt=' + prompt + ' src=' + src);
  return matches[0].task;
})()`);
if (firstTask.kind === 'hanzi-parts') {
  // 组字：勾两个干扰部件提交（保证是错误集合）→ 清空后勾正确部件提交。
  const wrongParts = firstTask.options.filter(o => !firstTask.parts.includes(o)).slice(0, 2);
  for (const part of wrongParts) {
    await evaluate(`(() => { [...document.querySelectorAll('.option-card')].find(c => c.textContent === ${JSON.stringify(part)})?.click(); })()`, false);
    await sleep(150);
  }
  await evaluate(`(() => { document.querySelector('#btn-parts-submit')?.click(); })()`, false);
  await sleep(300);
  const wrongFeedback = await evaluate(`(() => { const f = document.querySelector('#feedback'); return f.hidden ? null : f.textContent; })()`, false);
  if (!/再想一想/.test(wrongFeedback ?? '')) throw new Error(`组字答错反馈异常: ${wrongFeedback}`);
  await shot('hanzi-v2-01-wrong');
  for (const part of firstTask.parts) {
    await evaluate(`(() => { [...document.querySelectorAll('.option-card')].find(c => c.textContent === ${JSON.stringify(part)})?.click(); })()`, false);
    await sleep(150);
  }
  await evaluate(`(() => { document.querySelector('#btn-parts-submit')?.click(); })()`, false);
  await sleep(1100);
} else {
  const wrongOption = firstTask.options.find(o => o !== firstTask.target);
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.option-card')];
    cards.find(c => c.textContent === ${JSON.stringify(wrongOption)})?.click();
  })()`, false);
  await sleep(300);
  const wrongFeedback = await evaluate(`(() => { const f = document.querySelector('#feedback'); return f.hidden ? null : f.textContent; })()`, false);
  if (!/再想一想/.test(wrongFeedback ?? '')) throw new Error(`答错反馈异常: ${wrongFeedback}`);
  await shot('hanzi-v2-01-wrong');
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.option-card')];
    cards.find(c => c.textContent === ${JSON.stringify(firstTask.target)})?.click();
  })()`, false);
  await sleep(1100);
}
const q2Before = await readRound();
log('第 2 题（暂停前）:', q2Before.prompt, JSON.stringify(q2Before.options), q2Before.score);
// 暂停 → 刷新 → 恢复
await evaluate(`(() => { document.querySelector('#btn-pause')?.click(); })()`, false);
await sleep(300);
if (!(await pageCheck()).overlay) throw new Error('暂停遮罩未出现');
await shot('hanzi-v2-02-paused');
await send('Page.reload', { ignoreCache: false });
await sleep(2500);
await waitUntil(async () => (await pageCheck()).select, '刷新后回到选择屏');
const restoreOffer = await evaluate(`!document.querySelector('#restore-offer').hidden`, false);
if (!restoreOffer) throw new Error('刷新后未提供恢复');
await evaluate(`(() => { document.querySelector('#btn-restore')?.click(); })()`, false);
await waitUntil(async () => (await pageCheck()).game, '恢复进入游戏屏');
const q2After = await readRound();
if (q2After.prompt !== q2Before.prompt || q2After.options.join() !== q2Before.options.join() || q2After.score !== q2Before.score) {
  throw new Error(`恢复不一致: 前=${JSON.stringify(q2Before)} 后=${JSON.stringify(q2After)}`);
}
log('恢复一致：', q2After.progress, q2After.score);
await shot('hanzi-v2-03-restored');

// ===== V3：直接提交错误组字集合 + 记录核对（续打完本局）=====
for (let n = 0; n < 6; n++) {
  const pcGame = await pageCheck();
  if (pcGame.result) break;
  const view = await readRound();
  if (view.feedback) { await sleep(1100); continue; }
  await answerCurrent();
  await waitUntil(async () => (await readRound()).progress !== view.progress || (await pageCheck()).result, '续局推进');
}
const result2 = await waitUntil(async () => (await pageCheck()).result ? await pageCheck() : null, '第二局结算');
const score2 = await evaluate(`document.querySelector('#result-score')?.textContent`, false);
const detail2 = await evaluate(`document.querySelector('#result-detail')?.textContent`, false);
log('第二局结算:', score2, '|', detail2);
// 第 1 题答错一次：总分应为 5 + 10×4 = 45，首次答对 4/5，答错 1 次。
if (!/总分 45/.test(score2)) throw new Error(`第二局应 45 分: ${score2}`);
if (!/首次答对 4\/5/.test(detail2) || !/答错 1 次/.test(detail2)) throw new Error(`第二局明细异常: ${detail2}`);
await shot('hanzi-v3-01-result2');
const records2 = await evaluate(`(() => { const raw = localStorage.getItem('pixel-academy:hanzi-hero:v1:records'); return raw ? JSON.parse(raw).length : 0; })()`);
if (records2 !== 2) throw new Error(`记录应为 2 条: ${records2}`);
const record2 = await evaluate(`(() => JSON.parse(localStorage.getItem('pixel-academy:hanzi-hero:v1:records')).at(-1))()`);
if (record2.id === undefined || record2.score !== 45) throw new Error(`第二局记录异常: ${JSON.stringify(record2)}`);

const finalPc = await pageCheck();
const summary = {
  viewport: finalPc.viewport, overflow: finalPc.overflow, errors: finalPc.errors,
  userAgent: await evaluate(`navigator.userAgent`, false),
  v1: { score: 50, detail: 'first-try 5/5' }, v2: { restored: true }, v3: { score: 45, detail2 },
  records: records2, snapshotCleared: await evaluate(`localStorage.getItem('pixel-academy:hanzi-hero:v1:interrupted') === null`, false),
};
await writeFile(`${outDir}/hanzi-browser-results.json`, JSON.stringify(summary, null, 2));
log('结果', JSON.stringify(summary, null, 2));
closeWs();
process.exit(0);
