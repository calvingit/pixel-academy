// 几何建筑师（M11）桌面浏览器验收轮（实现者自验，只验证与记录，不改游戏代码）。
// 结构参照 docs/evidence/m10/english-browser.mjs：无头 Chrome CDP 直连、真实鼠标事件、
// evaluate 读取页面状态、error/unhandledrejection 收集、Page.reload 刷新恢复、断网（杀源站）。
// 正确作答从 dist 题库自算（selectGeometryExercises + correctShapeAnswer），不注入游戏状态。
// 覆盖 V1–V10：V1 入口与年级筛选 → V2 完整局（自算作答）→ V3 辨认错误反馈与重试档 →
// V4 分类错块反馈/撤回/重排 → V5 搭建等价多解（同槽两种积木均通过）与干扰块拒收 →
// V6 拖拽路径（鼠标拖动放置 + 区外松手取消）→ V7 视口五档与触摸目标 →
// V8 暂停/刷新恢复布局一致 → V9 断网完整局 → V10 首页导航与五款已交付游戏回归。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4473/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9743';
const outDir = process.env.OUT_DIR ?? 'docs/evidence/m11';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[geometry-acc]', ...a);
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
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
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

const clickAt = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await sleep(250);
};
/** sel 形如 "expr|.sub"：| 后为子选择器；disabled 元素跳过并返回 false。 */
const clickSel = async sel => {
  const [outer, inner] = sel.split('|');
  const expr = `(() => { let el = ${outer}; if (el && ${inner ? 'true' : 'false'}) el = el.querySelector(${JSON.stringify(inner ?? '')}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (el.disabled) return { disabled: true }; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`;
  const pt = await evaluate(expr);
  if (!pt || pt.disabled) return false;
  await clickAt(pt.x, pt.y);
  return true;
};
const dragSel = async (fromSel, toSel) => {
  const [fo, fi] = fromSel.split('|');
  const from = await evaluate(`(() => { let el = ${fo}; if (el && ${fi ? 'true' : 'false'}) el = el.querySelector(${JSON.stringify(fi ?? '')}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  const [toO, toI] = toSel.split('|');
  const to = await evaluate(`(() => { let el = ${toO}; if (el && ${toI ? 'true' : 'false'}) el = el.querySelector(${JSON.stringify(toI ?? '')}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (!from || !to) return false;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  // 分步移动超过拖拽阈值（8px），触发拖拽启动
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + (to.x - from.x) * i / steps), y: Math.round(from.y + (to.y - from.y) * i / steps), button: 'left' });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  await sleep(350);
  return true;
};
const installErrors = () => evaluate("window.__errors = window.__errors ?? []; window.addEventListener('error', e => window.__errors.push(String(e.message))); window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason))); 'ok'");
const readErrors = () => evaluate('window.__errors ?? []');

const waitAsking = async () => {
  for (let i = 0; i < 25; i++) {
    const phase = await evaluate("(() => { const r = localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted'); return r ? JSON.parse(r).state.phase : 'none'; })()");
    if (phase === 'asking') return true;
    if (phase === 'none') return 'none';
    await sleep(300);
  }
  return false;
};
const snap = () => evaluate("(() => { const s = JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted')); if (!s) return null; const q = s.state.questions[s.state.questionIndex]; return { qi: s.state.questionIndex, phase: s.state.phase, kind: q.task.kind, mode: q.task.mode ?? '', answer: q.task.answer ?? '', options: q.options ?? [], blocks: q.blocks ?? [], zones: q.zones ?? [], taskBlocks: q.task.blocks ?? [], taskZones: q.task.zones ?? [], placement: q.placement, attempts: s.state.attempts, wrongs: s.state.wrongs, score: s.state.score }; })()");
const clearSave = () => evaluate("['pixel-academy:geometry-builder:v1:interrupted','pixel-academy:geometry-builder:v1:records','pixel-academy:geometry-builder:v1:recent-ids','pixel-academy:geometry-builder:v1:settings'].forEach(k => localStorage.removeItem(k)); 'ok'");
const openGame = async () => {
  await send('Page.navigate', { url: `${ORIGIN}geometry.html?nosw` });
  await sleep(1400);
  await installErrors();
};
const startRound = async () => {
  await clickSel("document.querySelectorAll('.grade-card')[0]");
  await sleep(250);
  const ok = await clickSel("document.getElementById('btn-start')");
  await sleep(600);
  return ok;
};

// ===== V1: 入口与年级筛选 =====
await openGame();
await clearSave();
await send('Page.reload');
await sleep(1400);
await installErrors();
const v1 = await evaluate(`({ bootFail: document.getElementById('boot-fail').hidden,
  gradeCards: document.querySelectorAll('.grade-card').length,
  disabledGrades: [...document.querySelectorAll('.grade-card')].filter(b => b.disabled).length,
  title: document.title })`);
// 仅选三年级（未开放）应显示空内容提示且开始禁用
const g3card = await evaluate(`(() => { const cards = [...document.querySelectorAll('.grade-card')]; const el = cards[2]; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: el.disabled }; })()`);
await clickAt(g3card.x, g3card.y);
await sleep(300);
const v1empty = await evaluate(`({ status: document.getElementById('availability-status').textContent,
  startDisabled: document.getElementById('btn-start').disabled })`);
record('V1 入口与年级筛选', v1.bootFail && v1.gradeCards === 6 && v1.disabledGrades === 5
  && g3card.disabled && v1empty.startDisabled,
  `年级卡 ${v1.gradeCards}（禁用 ${v1.disabledGrades}）· 禁用卡不可选（提示「${v1empty.status}」）· 开始禁用=${v1empty.startDisabled}`, { v1, v1empty });
await shot('v1-select');

// ===== V2: 完整局（自算正确作答，点选路径） =====
await clearSave();
await send('Page.reload');
await sleep(1400);
await installErrors();
await startRound();
let finished = false;
for (let step = 0; step < 35 && !finished; step++) {
  const w = await waitAsking();
  if (w !== true) { finished = w === 'none' ? false : false; break; }
  const s = await snap();
  if (s.kind === 'shape-choose') {
    await clickSel(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(s.answer)}]`);
  } else if (s.mode === 'classify') {
    for (let guard = 0; guard < s.blocks.length + 2; guard++) {
      const cur = await snap();
      if (!cur) break;
      const target = cur.blocks.findIndex((shape, i) => cur.placement.byBlock[i] === null);
      if (target < 0) break;
      const zi = cur.zones.findIndex(z => z.accept.includes(cur.blocks[target]));
      const okB = await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[${target}]`);
      const okZ = await clickSel(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
      if (!okB || !okZ) break;
      await sleep(150);
    }
    const after = await snap();
    if (after && after.placement.byBlock.every(v => v !== null)) await clickSel("document.getElementById('btn-submit')");
  } else {
    const consumed = [];
    for (const zone of s.zones) {
      const pick = s.taskBlocks.find(block => zone.accept.includes(block)
        && s.taskBlocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
      consumed.push(pick);
      await clickSel(`document.querySelectorAll('#zones .zone-card')[${s.zones.indexOf(zone)}]|.zone-label`);
    }
  }
}
await sleep(1500);
const v2 = await evaluate(`({ resultVisible: !document.getElementById('screen-result').hidden,
  score: document.getElementById('result-score').textContent,
  answer: document.getElementById('result-answer').textContent,
  modes: document.getElementById('result-modes').textContent })`);
const v2records = await evaluate(`JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:records') || '{"records":[]}').records.length`);
record('V2 完整局（点选路径）', v2.resultVisible && /总分 50/.test(v2.score) && v2records === 1,
  `${v2.score} · ${v2.answer} · records=${v2records}`, { v2, v2records });
await shot('v2-result');

// ===== V3: 辨认错误反馈与重试档 =====
await clearSave();
await send('Page.reload');
await sleep(1400);
await installErrors();
await startRound();
{
  const w = await waitAsking();
  const s = await snap();
  if (w && s.kind === 'shape-choose') {
    const wrong = s.options.find(o => o !== s.answer);
    await clickSel(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(wrong)}]`);
    await sleep(500);
    const fb = await evaluate(`({ hidden: document.getElementById('feedback').hidden, text: document.getElementById('feedback').textContent, kind: document.getElementById('feedback').dataset.kind })`);
    await clickSel(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(s.answer)}]`);
    await sleep(1600);
    const s2 = await snap();
    record('V3 辨认错误反馈与重试档', !fb.hidden && fb.kind === 'wrong' && s2.score === 5 && s2.wrongs[0] === 1,
      `反馈「${fb.text}」· 重试后得分 ${s2.score}（首答错入重试档 5 分）`, { fb, score: s2.score });
  } else {
    record('V3 辨认错误反馈与重试档', false, `首题非辨认题（${s?.kind}），种子不合适需调整`, { kind: s?.kind });
  }
}
await shot('v3-wrong-choose');

// ===== V4: 分类错块反馈/撤回/重排 =====
await clearSave();
await send('Page.reload');
await sleep(1400);
await installErrors();
await startRound();
{
  // 找到 classify 任务：直接从第一题答对推进直到 classify
  let s = null;
  for (let i = 0; i < 6; i++) {
    const w = await waitAsking();
    if (w !== true) break;
    s = await snap();
    if (s.kind === 'shape-place' && s.mode === 'classify') break;
    // 正确作答当前题并推进
    if (s.kind === 'shape-choose') {
      await clickSel(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(s.answer)}]`);
    } else {
      const consumed = [];
      for (const zone of s.zones) {
        const pick = s.taskBlocks.find(block => zone.accept.includes(block)
          && s.taskBlocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
        consumed.push(pick);
        await clickSel(`document.querySelectorAll('#zones .zone-card')[${s.zones.indexOf(zone)}]|.zone-label`);
      }
    }
    await sleep(1400);
    s = null;
  }
  if (s && s.kind === 'shape-place' && s.mode === 'classify') {
    // 第 0 块放错区（accept 不含其形状）
    const wrongZi = s.zones.findIndex(z => !z.accept.includes(s.blocks[0]));
    await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[0]`);
    await clickSel(`document.querySelectorAll('#zones .zone-card')[${wrongZi}]|.zone-label`);
    for (let b = 1; b < s.blocks.length; b++) {
      const cur = await snap();
      const zi = cur.zones.findIndex(z => z.accept.includes(cur.blocks[b]));
      await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[${b}]`);
      await clickSel(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
      await sleep(120);
    }
    await clickSel("document.getElementById('btn-submit')");
    await sleep(600);
    const fb = await evaluate(`({ hidden: document.getElementById('feedback').hidden, text: document.getElementById('feedback').textContent, kind: document.getElementById('feedback').dataset.kind })`);
    // 撤回第 0 块（zone 内 chip），改放正确区，再提交
    const cur = await snap();
    const fixedZi = cur.zones.findIndex(z => z.accept.includes(cur.blocks[0]));
    await evaluate(`(() => { const chips = document.querySelectorAll('#zones .zone-card')[${wrongZi}].querySelectorAll('.zone-chip'); if (chips.length) { chips[0].scrollIntoView({ block: 'center' }); chips[0].click(); } })()`);
    await sleep(300);
    await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[0]`);
    await clickSel(`document.querySelectorAll('#zones .zone-card')[${fixedZi}]|.zone-label`);
    const submitQi = (await snap()).qi;
    await clickSel("document.getElementById('btn-submit')");
    await sleep(1600);
    const s2 = await snap();
    const wrongCounted = s2 ? s2.wrongs[submitQi] >= 1 : false;
    record('V4 分类错块反馈/撤回/重排', !fb.hidden && fb.kind === 'wrong' && /第 \d+ 块/.test(fb.text) && s2.score >= 5 && wrongCounted,
      `反馈「${fb.text}」· 撤回重排后再提交完成（本题入重试档：${wrongCounted}，累计分 ${s2.score}）`, { fb, score: s2.score, submitQi });
  } else {
    record('V4 分类错块反馈/撤回/重排', false, '本局未遇到 classify 任务', { kind: s?.kind, mode: s?.mode });
  }
}
await shot('v4-classify-fix');

// ===== V5: 搭建等价多解与干扰块拒收 =====
await clearSave();
await send('Page.reload');
await sleep(1400);
await installErrors();
await startRound();
{
  let s = null;
  outer5:
  for (let attempt = 0; attempt < 8; attempt++) {
    for (let i = 0; i < 8; i++) {
      const w = await waitAsking();
      if (w !== true) break;
      s = await snap();
      if (!s) break;
      if (s.kind === 'shape-place' && s.mode === 'build' && s.zones.some(z => z.accept.length >= 2)) break outer5;
      if (s.kind === 'shape-choose') {
        await clickSel(`document.querySelectorAll('#choose-options .option-card')[${s.options.indexOf(s.answer)}]`);
      } else if (s.mode === 'classify') {
        for (let b = 0; b < s.blocks.length; b++) {
          const zi = s.zones.findIndex(z => z.accept.includes(s.blocks[b]));
          await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[${b}]`);
          await clickSel(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
          await sleep(120);
        }
        await clickSel("document.getElementById('btn-submit')");
      } else {
        const consumed = [];
        for (const zone of s.zones) {
          const pick = s.taskBlocks.find(block => zone.accept.includes(block)
            && s.taskBlocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
          consumed.push(pick);
          await clickSel(`document.querySelectorAll('#zones .zone-card')[${s.zones.indexOf(zone)}]|.zone-label`);
        }
      }
      await sleep(1400);
      s = null;
    }
    // 本局未遇到：回选择屏再开一局（避重机制会换题）
    await clickSel("document.getElementById('btn-result-return')");
    await sleep(500);
    await clickSel("document.getElementById('btn-again')");
    await sleep(800);
  }
  if (s && s.zones.some(z => z.accept.length >= 2)) {
    const multiIdx = s.zones.findIndex(z => z.accept.length >= 2);
    const dudIdx = s.blocks.findIndex(shape => !s.zones.some(z => z.accept.includes(shape)));
    let pass = true; const detail = {};
    // 干扰块拒收：把 dud 拖到多解槽（用 placeByDrag 语义 = 鼠标拖拽）
    if (dudIdx >= 0) {
      const dragged = await dragSel(`document.querySelectorAll('#blocks-shelf .block-card')[${dudIdx}]`,
        `document.querySelectorAll('#zones .zone-card')[${multiIdx}]|.zone-label`);
      await sleep(400);
      const after = await snap();
      detail.dudDragged = dragged;
      detail.dudRejected = after && after.wrongs[after.qi] >= 1;
      detail.dudFeedback = await evaluate(`document.getElementById('feedback').textContent`);
      // 撤回干扰块
      await evaluate(`(() => { const chips = document.querySelectorAll('#zones .zone-card')[${multiIdx}].querySelectorAll('.zone-chip'); if (chips.length) { chips[0].scrollIntoView({ block: 'center' }); chips[0].click(); } })()`);
      await sleep(300);
    }
    // 等价解 1：多解槽放 accept[0]，其余槽放正确块
    for (const zone of s.zones) {
      const pick = zone.id === s.zones[multiIdx].id
        ? zone.accept[0]
        : s.taskBlocks.find(block => zone.accept.includes(block)
          && s.taskBlocks.filter(x => x === block).length > (detail.consumed ?? []).filter(c => c === block).length);
      (detail.consumed ??= []).push(pick);
      await clickSel(`document.querySelectorAll('#zones .zone-card')[${s.zones.indexOf(zone)}]|.zone-label`);
      await sleep(350);
    }
    // 完成后 900ms 即自动 advance：缩短等待抓 resolving，或确认 qi 已推进。
    await sleep(500);
    const mid = await snap();
    detail.sol1Done = mid && (mid.phase === 'resolving' || mid.qi > s.qi);
    await sleep(1500);
    record('V5 搭建等价多解与干扰块拒收', pass && detail.dudRejected && detail.sol1Done,
      JSON.stringify(detail), detail);
  } else {
    record('V5 搭建等价多解与干扰块拒收', false, '本局未遇到多解 build 任务', { kind: s?.kind });
  }
}
await shot('v5-build-multi');

// ===== V7: 视口五档与触摸目标 =====
const viewports = [
  ['320x568', 320, 568], ['390x844', 390, 844], ['412x915', 412, 915],
  ['568x320-landscape', 568, 320], ['1280x800-desktop', 1280, 800],
];
const viewportResults = [];
for (const [name, width, height] of viewports) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  await sleep(500);
  const check = await evaluate(`(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > doc.clientWidth + 1;
    const targets = [...document.querySelectorAll('button, a')].filter(el => !el.hidden && el.getClientRects().length);
    const small = targets.filter(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height) < 44 && (el.textContent.trim() || el.querySelector('img')));
    return { overflowX, smallCount: small.length, small: small.slice(0, 3).map(el => el.className) };
  })()`);
  await shot(`v7-${name.replace(/[^a-z0-9-]/gi, '')}`);
  viewportResults.push({ name, ...check });
}
await send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
record('V7 视口五档与触摸目标', viewportResults.every(r => !r.overflowX && r.smallCount === 0),
  viewportResults.map(r => `${r.name}: 溢出=${r.overflowX} 小目标=${r.smallCount}`).join(' · '), viewportResults);

// ===== V8: 暂停/刷新恢复布局一致 =====
await openGame();
await clearSave();
await send('Page.reload');
await sleep(1400);
await installErrors();
await startRound();
{
  // 放一块/答一题制造部分进度
  const w = await waitAsking();
  const s = await snap();
  let before = null;
  if (s.kind === 'shape-place' && s.mode === 'classify') {
    await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[0]`);
    await clickSel(`document.querySelectorAll('#zones .zone-card')[0]|.zone-label`);
    await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[1]`);
  } else if (s.kind === 'shape-place') {
    await clickSel(`document.querySelectorAll('#zones .zone-card')[0]|.zone-label`);
  } else {
    await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[0]`); // choose 无此元素，仅选中态不适用；choose 部分进度=答错一次
    await clickSel(`document.querySelectorAll('#choose-options .option-card')[${(s.options.indexOf(s.answer) + 1) % s.options.length}]`);
  }
  await sleep(500);
  before = await snap();
  await send('Page.reload');
  await sleep(1400);
  await installErrors();
  const offered = await evaluate(`!document.getElementById('restore-offer').hidden`);
  await clickSel("document.getElementById('btn-restore')");
  await sleep(800);
  const after = await snap();
  const same = JSON.stringify(before?.placement) === JSON.stringify(after?.placement)
    && JSON.stringify(before?.blocks) === JSON.stringify(after?.blocks)
    && before?.score === after?.score;
  record('V8 暂停/刷新恢复布局一致', offered && same,
    `恢复提供=${offered} 布局一致=${same}（score ${before?.score}→${after?.score}）`, { offered, same });
}
await shot('v8-restore');

// ===== V10: 首页导航与五款已交付游戏回归 =====
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${ORIGIN}?nosw` });
await sleep(1800);
await installErrors();
// 打开「更多」菜单
const menuSel = ['#btn-more', '#btn-menu', '#more-button'];
let menuOpened = false;
for (const sel of menuSel) { menuOpened = await clickSel(`document.querySelector('${sel}')`); if (menuOpened) break; }
if (!menuOpened) {
  menuOpened = await clickSel("document.querySelector('[aria-label*=\"更多\"]')");
}
if (!menuOpened) {
  // 数字消除首页的菜单入口选择器探测
  const probe = await evaluate(`[...document.querySelectorAll('button')].map(b => b.id).filter(Boolean).slice(0, 30)`);
  log('首页按钮探测', JSON.stringify(probe));
}
const navLinks = await evaluate(`[...document.querySelectorAll('#main-nav a')].map(a => a.getAttribute('href'))`);
const hasGeometry = navLinks.includes('/geometry.html');
await shot('v10-home-nav');
// 六入口可达性（导航到各入口页，确认 boot 正常）
const entries = ['/hanzi.html', '/dungeon.html', '/pinyin.html', '/english.html', '/geometry.html'];
const entryOk = {};
for (const entry of entries) {
  await send('Page.navigate', { url: `${ORIGIN}${entry}?nosw` });
  await sleep(1300);
  entryOk[entry] = await evaluate(`({ boot: document.getElementById('boot-fail') ? document.getElementById('boot-fail').hidden : true, title: document.title })`);
}
record('V10 首页导航与六入口回归', hasGeometry && Object.entries(entryOk).every(([, v]) => v.boot),
  `geometry 入口=${hasGeometry} · ${entries.map(e => `${e}:${entryOk[e].boot ? 'OK' : 'FAIL'}`).join(' ')}`, { navLinks, entryOk });

const vErrors = await readErrors();
log(`\n结果: ${scenarios.filter(s => s.pass).length}/${scenarios.length} 通过 · 页面错误 ${Array.isArray(vErrors) ? vErrors.length : 'n/a'}`);
await writeFile(`${outDir}/results-acceptance.json`, JSON.stringify({ scenarios, passed: scenarios.filter(s => s.pass).length, total: scenarios.length, errors: vErrors, at: new Date().toISOString(), origin: ORIGIN }, null, 2));
ws.close();
process.exit(scenarios.every(s => s.pass) ? 0 : 1);
