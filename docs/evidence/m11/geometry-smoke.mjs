// 几何建筑师（M11）桌面浏览器窄路径冒烟（实现者自验，非验收轮）：
// 无头 Chrome CDP 直连、真实鼠标事件、正确作答从 dist 题库自算（不注入游戏状态）。
// G1 打开 geometry.html（boot 无错）→ G2 选一年级开局 → G3 完整一局
//（choose 自算点选 / classify 点选放置提交 / build 点选放置）→ G4 结算与记录 →
// G5 刷新恢复布局一致 → G6 SVG 加载核对。
import { writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4473/';
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9743';
const outDir = 'docs/evidence/m11';
await mkdir(outDir, { recursive: true });
const log = (...a) => console.log('[geometry]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const scenarios = [];
const record = (name, pass, result, extra = {}) => {
  scenarios.push({ name, pass, result, ...extra });
  log(pass ? 'PASS' : 'FAIL', name, '-', result);
};

// ===== CDP 连接（独立无头 Chrome 由外部启动，--remote-debugging-port=9743）=====
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
const clickSel = async sel => {
  // sel 形如 "expr|.sub"：| 后为子选择器。
  const [outer, inner] = sel.split('|');
  const expr = `(() => { let el = ${outer}; if (el && ${inner ? 'true' : 'false'}) el = el.querySelector(${JSON.stringify(inner ?? '')}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (el.disabled) return { disabled: true }; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`;
  const pt = await evaluate(expr);
  if (!pt || pt.disabled) return false;
  await trustedClick(pt);
  return true;
};

// 错误收集
await evaluate(`window.__errors = []; window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));`);

const trustedClick = async x => {
  // x: {x, y} 视口坐标；先滚动到可见再点
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x.x, y: x.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x.x, y: x.y, button: 'left', clickCount: 1 });
  await sleep(120);
};
const centerOf = async selector => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);

/** 从快照读取当前任务的正确作答操作序列（纯计算，不下发）。 */
const correctPlan = (question) => {
  const { task, blocks, zones } = question;
  if (task.kind === 'shape-choose') return { kind: 'choose', answer: task.answer };
  if (task.mode === 'classify') {
    // 每块放其唯一 accept 区（按呈现序），逐块 (blockIndex, zoneIndex)
    const steps = blocks.map((shape, blockIndex) => ({
      blockIndex,
      zoneIndex: zones.findIndex(z => z.accept.includes(shape)),
    }));
    return { kind: 'classify', steps };
  }
  // build：每槽取首个满足且未被占用的呈现块
  const consumed = [];
  const steps = zones.map((zone, zoneIndex) => {
    const pick = blocks.find(shape => zone.accept.includes(shape)
      && blocks.filter(b => b === shape).length > consumed.filter(c => c === shape).length);
    consumed.push(pick);
    return { blockIndex: blocks.indexOf(pick), zoneIndex };
  });
  return { kind: 'build', steps };
};

const readQuestion = () => evaluate(`(() => {
  const raw = localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted');
  if (!raw) return null;
  const snap = JSON.parse(raw);
  const qi = snap.state.questionIndex;
  const q = snap.state.questions[qi];
  return { qi, question: { task: q.task, blocks: q.blocks, zones: q.zones, options: q.options },
    placement: q.placement, phase: snap.state.phase };
})()`);

// ===== G1: 打开入口页 =====
await send('Page.navigate', { url: `${ORIGIN}geometry.html?nosw` });
await sleep(1500);
// 错误收集器注入在导航前会随文档卸载丢失，导航后重装。
await evaluate(`window.__errors = []; window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));`);
const g1 = await evaluate(`({ title: document.title, bootFail: document.getElementById('boot-fail').hidden,
  gradeGrid: document.querySelectorAll('.grade-card').length, errors: window.__errors ?? [] })`);
record('G1 入口页打开', g1.bootFail && g1.gradeGrid === 6 && g1.errors.length === 0,
  `title=${g1.title} 年级卡=${g1.gradeGrid} 错误=${g1.errors.length}`, g1);
await shot('g1-select');

// ===== 导入 dist 判题数据（正确作答自算，不注入；同源导航后才可动态导入） =====
const pool = await evaluate(`import(${JSON.stringify(`${ORIGIN}dist/game/geometry-builder/content.js`)}).then(m => m.selectGeometryExercises([1]).map(e => ({ id: e.id, task: e.task })))`);
log('题池', pool.length, '道');

// ===== G2: 选一年级开局 =====
const gradeClicked = await clickSel("document.querySelectorAll('.grade-card')[0]");
await sleep(250);
const startEnabled = await evaluate(`!document.getElementById('btn-start').disabled`);
if (!gradeClicked || !startEnabled) throw new Error(`年级点击或开始按钮异常: clicked=${gradeClicked} enabled=${startEnabled}`);
await clickSel("document.getElementById('btn-start')");
await sleep(600);
const g2 = await evaluate(`({ progress: document.getElementById('hud-progress').textContent,
  mode: document.getElementById('q-mode').textContent, gameVisible: !document.getElementById('screen-game').hidden })`);
record('G2 开局', g2.gameVisible && /第 1\/5/.test(g2.progress), JSON.stringify(g2), g2);

// ===== G3: 完整一局（自算正确作答；按快照 placement 只放未放的块，zone 点 zone-label 避开 chip） =====
const waitAsking = async () => {
  for (let i = 0; i < 25; i++) {
    const phase = await evaluate("(() => { const r = localStorage.getItem('pixel-academy:geometry-builder:v1:interrupted'); return r ? JSON.parse(r).state.phase : 'none'; })()");
    if (phase === 'asking') return true;
    if (phase === 'none') return 'none';
    await sleep(300);
  }
  return false;
};
for (let step = 0; step < 35; step++) {
  const w = await waitAsking();
  if (w !== true) break;
  const snap = await readQuestion();
  if (!snap) break;
  const plan = correctPlan(snap.question);
  if (plan.kind === 'choose') {
    const optionIndex = snap.question.options.indexOf(plan.answer);
    await clickSel(`document.querySelectorAll('#choose-options .option-card')[${optionIndex}]`);
  } else if (plan.kind === 'classify') {
    for (let guard = 0; guard < snap.question.blocks.length + 2; guard++) {
      const cur = await readQuestion();
      if (!cur) break;
      const target = cur.question.blocks.findIndex((shape, i) => cur.placement.byBlock[i] === null);
      if (target < 0) break;
      const zi = cur.question.zones.findIndex(z => z.accept.includes(cur.question.blocks[target]));
      const okB = await clickSel(`document.querySelectorAll('#blocks-shelf .block-card')[${target}]`);
      const okZ = await clickSel(`document.querySelectorAll('#zones .zone-card')[${zi}]|.zone-label`);
      if (!okB || !okZ) break;
      await sleep(150);
    }
    const after = await readQuestion();
    if (after && after.placement.byBlock.every(v => v !== null)) {
      await clickSel("document.getElementById('btn-submit')");
    }
  } else {
    const consumed = [];
    for (const zone of snap.question.zones) {
      const pick = snap.question.task.blocks.find(block => zone.accept.includes(block)
        && snap.question.task.blocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
      consumed.push(pick);
      await clickSel(`document.querySelectorAll('#zones .zone-card')[${snap.question.zones.indexOf(zone)}]|.zone-label`);
    }
  }
}
await sleep(1500);
const g3 = await evaluate(`({ resultVisible: !document.getElementById('screen-result').hidden,
  score: document.getElementById('result-score').textContent,
  answer: document.getElementById('result-answer').textContent,
  modes: document.getElementById('result-modes').textContent })`);
record('G3 完整一局', g3.resultVisible && /总分 50/.test(g3.score),
  JSON.stringify(g3), g3);
await shot('g3-result');

// ===== G4: 记录入库 =====
const records = await evaluate(`JSON.parse(localStorage.getItem('pixel-academy:geometry-builder:v1:records') || '{"records":[]}').records.length`);
record('G4 记录入库', records === 1, `records=${records}`, { records });

// ===== G5: 刷新恢复（开局后刷新，布局一致） =====
await trustedClick(await centerOf('#btn-result-return'));
await sleep(400);
await trustedClick(await centerOf('#btn-start'));
await sleep(600);
// 放一块积木再刷新（若当前是 classify/build）
let before = await readQuestion();
if (before && before.question.task.kind === 'shape-place') {
  if (before.question.task.mode === 'classify') {
    await trustedClick(await centerOf('#blocks-shelf .block-card[data-index="0"]'));
    await sleep(150);
    await trustedClick(await centerOf('#zones .zone-card:nth-child(1)'));
  } else {
    await trustedClick(await centerOf('#zones .zone-card:nth-child(1)'));
  }
  await sleep(400);
}
before = await readQuestion();
await send('Page.reload');
await sleep(1500);
await trustedClick(await centerOf('#btn-restore'));
await sleep(800);
const after = await readQuestion();
const g5same = JSON.stringify(before?.placement) === JSON.stringify(after?.placement)
  && JSON.stringify(before?.question.blocks) === JSON.stringify(after?.question.blocks);
record('G5 刷新恢复布局一致', g5same, `一致=${g5same}`, { before, after });
await shot('g5-restore');

// ===== G6: SVG 加载核对（当前题面 img + 六张配图逐个 fetch） =====
let svgOk = false;
for (let i = 0; i < 10; i++) {
  svgOk = await evaluate(`(() => {
    const imgs = [...document.querySelectorAll('img')].filter(img => img.src);
    return imgs.length > 0 && imgs.every(img => img.complete && img.naturalWidth > 0);
  })()`);
  if (svgOk) break;
  await sleep(400);
}
const svgs = ['cuboid', 'cube', 'cylinder', 'sphere', 'cylinder-flat', 'cuboid-tall'];
const svgFetch = await evaluate(`Promise.all(${JSON.stringify(svgs)}.map(n =>
  fetch('/img/geometry-builder/' + n + '.svg').then(r => r.status)))
  .then(states => states.every(st => st === 200))`);
await evaluate("window.__errors = window.__errors ?? []; window.addEventListener('error', e => window.__errors.push(String(e.message)));");
const g6errors = await evaluate('window.__errors.length');
record('G6 SVG 加载', svgOk && svgFetch && g6errors === 0, `页面img=${svgOk} 六图fetch=${svgFetch} 错误=${g6errors}`, { svgOk, svgFetch, errors: g6errors });
await shot('g6-svg');

const passed = scenarios.filter(s => s.pass).length;
log(`\n结果: ${passed}/${scenarios.length} 通过`);
await writeFile(`${outDir}/results-smoke.json`, JSON.stringify({ scenarios, passed, total: scenarios.length, at: new Date().toISOString(), origin: ORIGIN }, null, 2));
ws.close();
process.exit(passed === scenarios.length ? 0 : 1);
