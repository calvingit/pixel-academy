// 几何建筑师页面接线：年级选择、开局组卷（积木/分区/选项组卷洗牌）、
// 三模式交互（辨认单选 / 分类点选+拖拽整组提交 / 搭建逐槽即时判定）、
// 分步反馈（错块定位 / 槽位不合适 / 选择错误）、暂停/刷新恢复、结算与记录。
// 判题一律走 Learning Core（经 rules 层）；本文件不重复判题、不实现计时算法
//（首版不限时，docs/m11-geometry-architect-plan.md 决策 7）。
import type { Exercise, Grade, ShapeChooseTask, ShapePlaceTask, ShapeTask } from '../../learning/models.js';
import { SHAPE_LABELS } from '../../learning/shapes.js';
import { createRuntimeRng, restoreSeededRng } from '../number-puzzle/random.js';
import type { RestorableRng } from '../number-puzzle/random.js';
import { advanceQuestion, answerChoose, createRound, GAME_ID, placeByClick, placeByDrag,
  retract, selectBlock, settlement, submitClassify } from './rules.js';
import type { RoundSnapshot, RoundState } from './rules.js';
import { buildRecord, createGeometryStorage, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage.js';
import type { GeometryRecord } from './storage.js';
import { CONTENT_VERSION, describeAvailability, GRADE_NAMES, OPEN_GRADES,
  selectGeometryExercises, SHAPE_IMAGES } from './content.js';

const ALL_GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];
const store = createGeometryStorage();
const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const state = {
  grades: [...store.settings().grades] as Grade[],
  round: null as RoundState | null,
  roundId: '',
  rng: null as RestorableRng | null,
  exercises: [] as readonly Exercise<ShapeTask>[],
  previousIds: [] as readonly string[],
  paused: false,
  resolving: false,
};

async function confirm(text: string): Promise<boolean> {
  const dialog = $('confirm-dialog') as HTMLDialogElement;
  $('confirm-text').textContent = text;
  dialog.showModal();
  return new Promise(resolve => {
    const done = (yes: boolean) => { dialog.close(); resolve(yes); };
    $('btn-confirm-yes').onclick = () => done(true);
    $('btn-confirm-no').onclick = () => done(false);
    dialog.oncancel = () => done(false);
  });
}
function showScreen(name: 'select' | 'game' | 'result'): void {
  $('screen-select').hidden = name !== 'select';
  $('screen-game').hidden = name !== 'game';
  $('screen-result').hidden = name !== 'result';
}
function showSelect(): void {
  showScreen('select');
  renderGrades();
  renderAvailability();
  renderRecords();
}

// ===== 选择屏 =====
function renderGrades(): void {
  const grid = $('grade-grid');
  grid.replaceChildren();
  for (const grade of ALL_GRADES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'grade-card';
    button.textContent = GRADE_NAMES[grade];
    button.setAttribute('aria-pressed', String(state.grades.includes(grade)));
    button.disabled = !OPEN_GRADES.includes(grade);
    if (!OPEN_GRADES.includes(grade)) button.title = '暂未开放';
    button.onclick = () => {
      state.grades = state.grades.includes(grade)
        ? state.grades.filter(g => g !== grade)
        : [...state.grades, grade].sort((a, b) => a - b);
      store.saveSettings({ schemaVersion: STORAGE_SCHEMA_VERSION, grades: state.grades });
      renderGrades();
      renderAvailability();
    };
    grid.append(button);
  }
}
function renderAvailability(): void {
  const report = state.grades.length ? describeAvailability(state.grades) : null;
  $('availability-status').textContent = report ? (report.statusText ?? `本局题库：${report.rangeText}`) : '请先选择年级';
  ($('btn-start') as HTMLButtonElement).disabled = !report?.startable;
}
function renderRecords(): void {
  const list = $('records-list');
  list.replaceChildren();
  const records = store.records();
  for (const r of [...records].reverse().slice(0, 10)) {
    const item = document.createElement('li');
    const modes = { choose: 0, classify: 0, build: 0 } as Record<string, number>;
    for (const t of r.answer.tasks) modes[t.mode]! += 1;
    const firstTry = r.answer.tasks.filter(t => t.firstTry).length;
    item.textContent = `${new Date(r.finishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      + ` · ${r.grades.map(g => GRADE_NAMES[g]).join('')} · ${r.score} 分 · 首答 ${firstTry}/${r.answer.tasks.length}`
      + ` · 错放 ${r.answer.operations.clicks + r.answer.operations.drags > 0 ? '' : ''}${r.answer.operations.retractions > 0 ? `撤回 ${r.answer.operations.retractions} 次` : ''}`.trim();
    list.append(item);
  }
  $('records-empty').hidden = records.length > 0;
}

// ===== 快照 =====
function persistSnapshot(): void {
  if (!state.round || !store.available || state.round.phase === 'finished') return;
  const snapshot: RoundSnapshot = {
    version: 1, gameId: GAME_ID, roundId: state.roundId, state: state.round,
    rngState: state.rng ? state.rng.snapshotState() : 0, previousIds: state.previousIds,
    grades: [...state.grades], contentVersion: CONTENT_VERSION,
  };
  store.saveSnapshot(snapshot);
}

// ===== 局内渲染 =====
function showFeedback(kind: 'correct' | 'wrong' | 'info', text: string): void {
  const feedback = $('feedback');
  feedback.dataset.kind = kind;
  feedback.textContent = kind === 'correct' ? `✓ ${text}` : kind === 'wrong' ? `✗ ${text}` : text;
  feedback.hidden = false;
}

function renderGame(): void {
  const round = state.round;
  if (!round) return;
  $('hud-progress').textContent = `第 ${round.questionIndex + 1}/${round.questions.length} 个任务`;
  $('hud-score').textContent = `得分 ${round.score}`;
  renderQuestion(round);
}

const MODE_NAMES = { choose: '图形辨认', classify: '图形分类', build: '搭建任务' } as const;

const modeOf = (task: ShapeTask): keyof typeof MODE_NAMES =>
  task.kind === 'shape-choose' ? 'choose' : task.mode;

/** 渲染当前任务：题面 +（辨认：渲染图与名称候选｜分类：积木栏与分区｜搭建：积木栏与槽位）。 */
function renderQuestion(round: RoundState): void {
  const card = $('question-card');
  const question = round.questions[round.questionIndex];
  card.hidden = !question;
  $('choose-area').hidden = true;
  $('place-area').hidden = true;
  if (!question) return;
  const task = question.task;
  $('q-mode').textContent = MODE_NAMES[modeOf(task)];
  $('q-prompt').textContent = task.kind === 'shape-choose' ? '图中画的是什么图形？' : task.prompt;
  if (task.kind === 'shape-choose') {
    renderChoose(round, task);
  } else {
    renderPlace(round, task);
  }
}

function renderChoose(round: RoundState, task: ShapeChooseTask): void {
  $('choose-area').hidden = false;
  const figure = $('choose-figure') as HTMLImageElement;
  figure.src = task.image;
  figure.alt = '待辨认的立体图形';
  const options = $('choose-options');
  options.replaceChildren();
  const question = round.questions[round.questionIndex]!;
  question.options.forEach(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-card';
    button.textContent = option;
    button.disabled = state.resolving || state.paused;
    button.onclick = () => {
      if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
      $('feedback').hidden = true;
      const outcome = answerChoose(state.round, option);
      void applyOutcome(outcome);
    };
    options.append(button);
  });
}

function renderPlace(round: RoundState, task: ShapePlaceTask): void {
  $('place-area').hidden = false;
  const question = round.questions[round.questionIndex]!;
  const isClassify = task.mode === 'classify';
  $('btn-submit').hidden = !isClassify;
  $('place-hint').textContent = isClassify
    ? '点选一块积木，再点格子放下；也可以直接拖过去。全部放好后点「提交」。'
    : '点选格子放下积木，或把积木拖到格子里。放错可以点格子上的「撤回」换一块。';
  // 积木栏：呈现排列来自组卷洗牌；classify 显示各块归属（已放入的块沉底置灰）。
  const shelf = $('blocks-shelf');
  shelf.replaceChildren();
  question.blocks.forEach((shape, index) => {
    const holder = document.createElement('div');
    holder.className = 'block-holder';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block-card';
    button.dataset.index = String(index);
    button.setAttribute('aria-label', `积木 ${index + 1}：${SHAPE_LABELS[shape] ?? shape}`);
    const image = document.createElement('img');
    image.src = SHAPE_IMAGES[shape] ?? '';
    image.alt = SHAPE_LABELS[shape] ?? shape;
    image.draggable = false;
    button.append(image);
    button.disabled = state.resolving || state.paused;
    if (isClassify) {
      const placed = question.placement.byBlock[index] !== null;
      button.classList.toggle('block-placed', placed);
      button.disabled = button.disabled || placed;
      button.classList.toggle('block-selected', round.selectedBlock === index);
      button.onclick = () => {
        if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
        $('feedback').hidden = true;
        state.round = selectBlock(state.round, index);
        persistSnapshot();
        renderGame();
      };
      setupDrag(button, holder, index, false);
    } else {
      // build：已被槽位占用的同形状块不再可拖（积木栏没有这块可拖）。
      setupDrag(button, holder, index, true);
    }
    holder.append(button);
    shelf.append(holder);
  });
  // 分区/槽位：呈现顺序来自组卷洗牌；槽位标注 accept 名称集合（等价解可见）。
  const zoneBox = $('zones');
  zoneBox.replaceChildren();
  question.zones.forEach((zone, zoneIndex) => {
    const zoneButton = document.createElement('button');
    zoneButton.type = 'button';
    zoneButton.className = 'zone-card';
    zoneButton.dataset.zoneIndex = String(zoneIndex);
    const label = document.createElement('span');
    label.className = 'zone-label';
    label.textContent = zone.accept.map(shape => SHAPE_LABELS[shape] ?? shape).join(' 或 ');
    zoneButton.append(label);
    if (isClassify) {
      // 已放入该区的块以缩略图显示，点块撤回。
      question.blocks.forEach((shape, blockIndex) => {
        if (question.placement.byBlock[blockIndex] !== zone.id) return;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'zone-chip';
        chip.setAttribute('aria-label', `撤回 ${SHAPE_LABELS[shape] ?? shape}`);
        const image = document.createElement('img');
        image.src = SHAPE_IMAGES[shape] ?? '';
        image.alt = SHAPE_LABELS[shape] ?? shape;
        image.draggable = false;
        chip.append(image);
        chip.disabled = state.resolving || state.paused;
        chip.onclick = () => {
          if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
          $('feedback').hidden = true;
          state.round = retract(state.round, blockIndex);
          persistSnapshot();
          renderGame();
        };
        zoneButton.append(chip);
      });
    } else {
      const filled: string | null = question.placement.inSlot[zoneIndex] ?? null;
      if (filled !== null) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'zone-chip';
        chip.setAttribute('aria-label', `撤回 ${SHAPE_LABELS[filled] ?? filled}`);
        const image = document.createElement('img');
        image.src = SHAPE_IMAGES[filled] ?? '';
        image.alt = SHAPE_LABELS[filled] ?? filled;
        image.draggable = false;
        chip.append(image);
        chip.disabled = state.resolving || state.paused;
        chip.onclick = () => {
          if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
          $('feedback').hidden = true;
          state.round = retract(state.round, zoneIndex);
          persistSnapshot();
          renderGame();
        };
        zoneButton.append(chip);
      } else if (round.selectedBlock !== null && isClassify) {
        zoneButton.classList.add('zone-target');
      }
    }
    zoneButton.disabled = state.resolving || state.paused;
    zoneButton.onclick = () => {
      if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
      try {
        const outcome = placeByClick(state.round, zoneIndex);
        $('feedback').hidden = true;
        void applyOutcome(outcome);
      } catch (error) {
        // 未选中积木点分区 / 无可放块：操作提示，不构成作答。
        showFeedback('info', error instanceof Error && /Select a block/.test(error.message) ? '先在下面点选一块积木' : '这块放不进这里，换一块试试');
      }
    };
    zoneBox.append(zoneButton);
  });
  if (isClassify) {
    const allPlaced = question.placement.byBlock.every(slot => slot !== null);
    ($('btn-submit') as HTMLButtonElement).disabled = !allPlaced || state.resolving || state.paused;
  }
}

/** 拖拽路径：pointer 事件把积木拖到分区/槽位；松手在区外=取消归位，不丢块。 */
function setupDrag(
  button: HTMLButtonElement,
  holder: HTMLDivElement,
  blockIndex: number,
  isBuild: boolean,
): void {
  let startX = 0; let startY = 0; let dragging = false; let ghost: HTMLImageElement | null = null;
  button.addEventListener('pointerdown', event => {
    if (state.resolving || state.paused) return;
    if (!isBuild && state.round?.questions[state.round.questionIndex]?.placement.byBlock[blockIndex] !== null
      && !isBuild) return;
    // 不在此 preventDefault：短按不产生位移时须让浏览器正常派发 click（点选路径依赖 onclick）；
    // 拖拽在首个 pointermove 超过阈值时才启动（届时再 preventDefault + 建 ghost）。
    startX = event.clientX; startY = event.clientY;
    dragging = false;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
  const move = (event: PointerEvent): void => {
    if (ghost) {
      ghost.style.left = `${event.clientX - 28}px`;
      ghost.style.top = `${event.clientY - 28}px`;
      return;
    }
    // 拖拽启动阈值：位移超过 8px 才视为拖拽（纯点击/抖动不拦截 click）。
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) > 8) {
      dragging = true;
      event.preventDefault();
      ghost = document.createElement('img');
      ghost.src = (button.querySelector('img') as HTMLImageElement).src;
      ghost.className = 'drag-ghost';
      ghost.style.left = `${event.clientX - 28}px`;
      ghost.style.top = `${event.clientY - 28}px`;
      document.body.append(ghost);
      button.style.visibility = 'hidden';
    }
  };
  const up = (event: PointerEvent): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    if (!dragging) return;
    dragging = false;
    ghost?.remove();
    ghost = null;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.zone-card');
    button.style.visibility = '';
    if (!target || !state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
    const zoneIndex = Number((target as HTMLElement).dataset.zoneIndex);
    if (Number.isNaN(zoneIndex)) return;
    try {
      const outcome = placeByDrag(state.round, zoneIndex, blockIndex);
      $('feedback').hidden = true;
      void applyOutcome(outcome);
    } catch {
      showFeedback('info', '这块放不进这里，换一块试试');
    }
  };
  const cancel = (): void => {
    dragging = false;
    ghost?.remove();
    ghost = null;
    button.style.visibility = '';
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    // 触摸中断取消：积木归位，不丢块、不判定。
  };
  void holder;
}

// ===== 判定结果统一处理 =====
async function applyOutcome(outcome: ReturnType<typeof submitClassify> | ReturnType<typeof answerChoose>): Promise<void> {
  if (outcome.type === 'placed') {
    state.round = outcome.next;
    persistSnapshot();
    renderGame();
    return;
  }
  state.round = outcome.next;
  if (outcome.complete) {
    state.resolving = true;
    showFeedback('correct', `完成 +${outcome.gained}`);
    persistSnapshot();
    renderGame();
    await sleep(900);
    state.resolving = false;
    await advance();
    return;
  }
  // 分步反馈：build 逐槽状态 / classify 错块定位 / choose 答案错误。
  const question = state.round!.questions[state.round!.questionIndex]!;
  if (question.task.kind === 'shape-place' && question.task.mode === 'classify' && outcome.wrongBlocks.length > 0) {
    const ordinal = (index: number): string => `第 ${index + 1} 块`;
    showFeedback('wrong', `${outcome.wrongBlocks.map(ordinal).join('、')}放错了格子，撤回换一格试试`);
  } else {
    showFeedback('wrong', '有格子放得不对，撤回再试');
  }
  persistSnapshot();
  renderGame();
}

/** 反馈后推进：切下一任务或进入结算。 */
async function advance(): Promise<void> {
  if (!state.round) return;
  $('feedback').hidden = true;
  state.round = advanceQuestion(state.round);
  if (state.round.phase === 'finished') {
    settleRound();
    return;
  }
  persistSnapshot();
  renderGame();
}

// ===== 结算与恢复 =====
function settleRound(): void {
  const round = state.round!;
  const result = settlement(round);
  const record: GeometryRecord = buildRecord({
    recordId: state.roundId,
    finishedAt: new Date().toISOString(),
    grades: [...state.grades],
    contentVersion: CONTENT_VERSION,
    score: result.score,
    answered: result.answered,
    clicks: result.clicks,
    drags: result.drags,
    retractions: result.retractions,
  });
  if (!store.addRecord(record)) $('storage-notice').hidden = false;
  store.saveRecentIds(round.questions.map(q => q.exerciseId));
  store.clearSnapshot();
  const modes = { choose: 0, classify: 0, build: 0 } as Record<string, number>;
  const firstBy = { choose: 0, classify: 0, build: 0 } as Record<string, number>;
  for (const t of result.answered) { modes[t.mode]! += 1; if (t.firstTry) firstBy[t.mode]! += 1; }
  $('result-score').textContent = `总分 ${result.score}`;
  $('result-answer').textContent = `完成 ${result.total} 个任务 · 首次一次完成 ${result.firstTry} · 错判 ${result.wrong} 次`;
  $('result-modes').textContent = `辨认 ${firstBy.choose}/${modes.choose} 首答 · 分类 ${firstBy.classify}/${modes.classify} 首答 · 搭建 ${firstBy.build}/${modes.build} 首答`
    + ` · 点选 ${result.clicks} 拖拽 ${result.drags} 撤回 ${result.retractions}`;
  $('pause-overlay').hidden = true;
  $('btn-pause').setAttribute('aria-pressed', 'false');
  showScreen('result');
  state.round = null;
  state.paused = false;
  state.resolving = false;
}

function restoreFromSnapshot(snapshot: RoundSnapshot): void {
  state.roundId = snapshot.roundId;
  state.previousIds = [...snapshot.previousIds];
  state.grades = [...snapshot.grades];
  state.exercises = selectGeometryExercises(state.grades);
  state.round = snapshot.state;
  state.rng = restoreSeededRng(snapshot.rngState);
  state.paused = false;
  state.resolving = false;
  if (state.round.phase === 'resolving') {
    // 反馈窗口期间被打断：反馈已展示过，直接推进到下一任务或终局，不卡在 resolving。
    state.round = advanceQuestion(state.round);
  }
  if (state.round.phase === 'finished') {
    settleRound();
    return;
  }
  showScreen('game');
  renderGame();
}

// ===== 暂停 =====
function setPaused(paused: boolean): void {
  if (!state.round || state.round.phase === 'finished') return;
  state.paused = paused;
  $('pause-overlay').hidden = !paused;
  $('btn-pause').setAttribute('aria-pressed', String(paused));
  persistSnapshot();
  if (!paused) renderGame();
}

// ===== 接线 =====
async function startRound(): Promise<void> {
  const rng = createRuntimeRng();
  state.roundId = (crypto.randomUUID ? crypto.randomUUID() : `g-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
  state.previousIds = store.recentIds();
  state.exercises = selectGeometryExercises(state.grades);
  state.round = createRound(state.exercises, state.previousIds, rng);
  state.rng = rng;
  state.paused = false;
  state.resolving = false;
  $('feedback').hidden = true;
  showScreen('game');
  renderGame();
  persistSnapshot();
}
$('btn-start').onclick = () => void startRound();
$('btn-pause').onclick = () => setPaused(!state.paused);
$('btn-resume').onclick = () => setPaused(false);
$('btn-game-return').onclick = () => void (async () => {
  if (await confirm('返回将放弃本局搭建进度，确定吗？')) {
    store.clearSnapshot();
    state.round = null;
    showSelect();
  }
})();
$('btn-submit').onclick = () => {
  if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
  try {
    const outcome = submitClassify(state.round);
    $('feedback').hidden = true;
    void applyOutcome(outcome);
  } catch {
    showFeedback('info', '把所有积木都放进格子后再提交');
  }
};
$('btn-again').onclick = () => void startRound();
$('btn-result-return').onclick = () => showSelect();
$('btn-restore').onclick = () => {
  const snapshot = store.snapshot();
  if (snapshot) restoreFromSnapshot(snapshot);
};
$('btn-discard-round').onclick = () => void (async () => {
  if (await confirm('放弃后本局搭建进度将删除，确定吗？')) {
    store.clearSnapshot();
    $('restore-offer').hidden = true;
  }
})();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.round && state.round.phase !== 'finished') setPaused(true);
});

function boot(): void {
  clearTimeout((window as unknown as { __geometryBootFailed?: number }).__geometryBootFailed);
  // 模块加载成功即清除兜底横幅（慢加载时 6 秒计时器可能已先触发）。
  $('boot-fail').hidden = true;
  $('storage-notice').hidden = store.available;
  renderGrades();
  renderAvailability();
  renderRecords();
  const snapshot = store.snapshot();
  if (snapshot && snapshot.contentVersion !== CONTENT_VERSION) {
    // 结构或内容版本不兼容的旧进度：安全放弃并说明原因，不影响其他游戏数据。
    store.clearSnapshot();
    $('restore-incompatible').hidden = false;
  } else if (snapshot) {
    $('restore-offer').hidden = false;
    $('restore-offer-text').textContent = '有未完成的搭建任务，可以继续（积木布局与得分都会恢复）。';
  } else if (store.available && localStorage.getItem(STORAGE_KEYS.snapshot) !== null) {
    store.clearSnapshot();
    $('restore-incompatible').hidden = false;
  }
  if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
    // SW 不可用或注册失败时游戏仍在线可玩；离线细节由 M6 机制承担，此处只负责注册。
    // ?nosw 为验证工具入口：跳过注册，保证驱动脚本始终拿到当前构建产物。
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  showScreen('select');
}

boot();
