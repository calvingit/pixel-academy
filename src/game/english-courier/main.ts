// 英语快递员页面接线：年级选择、开局组卷（包裹/站位组卷洗牌）、取件→送达两步交互、
// 分步反馈（包裹不对/对象不对/都不对）、暂停/刷新恢复、结算与记录。
// 判题一律走 Learning Core（经 rules 层）；本文件不重复判题、不实现计时算法
//（首版不限时，docs/m10-english-courier-plan.md 决策 6）。
import type { EnglishDeliveryTask, Exercise, Grade } from '../../learning/models.js';
import { isEnglishTask } from '../../learning/english.js';
import { createRuntimeRng, restoreSeededRng } from '../number-puzzle/random.js';
import type { RestorableRng } from '../number-puzzle/random.js';
import { advanceQuestion, createRound, deliverTo, GAME_ID, pickParcel,
  settlement } from './rules.js';
import type { RoundSnapshot, RoundState } from './rules.js';
import { buildRecord, createEnglishStorage, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage.js';
import type { EnglishRecord } from './storage.js';
import { CONTENT_VERSION, describeAvailability, GRADE_NAMES, OPEN_GRADES,
  RECIPIENT_IMAGES, selectEnglishExercises } from './content.js';

const ALL_GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];
const store = createEnglishStorage();
const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 包裹标签展示形：首字母大写（数据保持词表小写规范形）。 */
const displayLabel = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const state = {
  grades: [...store.settings().grades] as Grade[],
  round: null as RoundState | null,
  roundId: '',
  rng: null as RestorableRng | null,
  exercises: [] as readonly Exercise<EnglishDeliveryTask>[],
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
    const vocab = r.answer.tasks.filter(t => t.mode === 'vocab');
    const sentence = r.answer.tasks.filter(t => t.mode === 'sentence');
    const attempts = r.answer.tasks.reduce((sum, t) => sum + t.attempts, 0);
    const firstTry = r.answer.tasks.filter(t => t.firstTry).length;
    item.textContent = `${new Date(r.finishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      + ` · ${r.grades.map(g => GRADE_NAMES[g]).join('')} · ${r.score} 分 · 首答 ${firstTry}/${r.answer.tasks.length}`
      + ` · 送达 ${attempts} 次`
      + (vocab.length && sentence.length ? ` · 词 ${vocab.filter(t => t.firstTry).length}/${vocab.length} 句 ${sentence.filter(t => t.firstTry).length}/${sentence.length}` : '');
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

/** 渲染当前任务：指令 + 包裹架（带词标签）+ 场景站位（角色图，不带英语文字标签）。 */
function renderQuestion(round: RoundState): void {
  const card = $('question-card');
  const question = round.questions[round.questionIndex];
  card.hidden = !question;
  if (!question) return;
  const task = question.task;
  if (!isEnglishTask(task)) {
    throw new TypeError(`english-courier round contains non-english task: ${JSON.stringify(task)}`);
  }
  $('q-mode').textContent = task.mode === 'vocab' ? '词汇识别' : '句意理解';
  // 题面只来自 task.prompt（首版文字指令）；角色卡不渲染英语标签，防退化为读词点同词。
  $('q-prompt').textContent = task.prompt;
  // 取件状态：未取件提示先取包裹；已取件显示所持标签并引导送达。
  $('carrying-status').textContent = round.carrying === null
    ? '先在包裹架上点选一个包裹'
    : `已取包裹：${displayLabel(round.carrying)} · 点选要送达的角色`;
  $('carrying-status').dataset.carried = round.carrying === null ? 'false' : 'true';
  // 包裹架：排列来自组卷洗牌（不恒在首位）；点击即取件（可换）。
  const parcelBox = $('parcels');
  parcelBox.replaceChildren();
  question.parcels.forEach((word, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'parcel-card';
    button.textContent = displayLabel(word);
    button.dataset.word = word;
    button.setAttribute('aria-label', `包裹 ${index + 1}：${displayLabel(word)}`);
    button.disabled = state.resolving || state.paused;
    button.classList.toggle('parcel-carried', round.carrying === word);
    button.onclick = () => selectParcel(word);
    parcelBox.append(button);
  });
  // 场景站位：角色图即目标，不带英语文字标签；未取件点选不构成作答（仅视为移动）。
  const scene = $('stations');
  scene.replaceChildren();
  question.stations.forEach((recipient, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'station-card';
    const image = document.createElement('img');
    image.src = RECIPIENT_IMAGES[recipient] ?? '';
    image.alt = '';
    image.draggable = false;
    button.append(image);
    button.setAttribute('aria-label', `收件角色 ${index + 1}`);
    button.disabled = state.resolving || state.paused;
    button.onclick = () => void deliver(recipient);
    scene.append(button);
  });
  // 反馈条不在此隐藏：送达反馈需在反馈窗口内保持可见（advance/selectParcel 时再隐藏）。
}

// ===== 局内动作 =====
function selectParcel(word: string): void {
  if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
  // 取件不判题不计分；重复点选同一包裹无副作用。上一条反馈随新动作失效。
  $('feedback').hidden = true;
  state.round = pickParcel(state.round, word);
  persistSnapshot();
  renderGame();
}

async function deliver(recipient: string): Promise<void> {
  const round = state.round;
  if (!round || state.paused || state.resolving || round.phase !== 'asking') return;
  if (round.carrying === null) {
    // 未取件点选角色：不构成作答尝试，不计分不消耗首答档位，仅给出移动反馈。
    showFeedback('info', '先取一个包裹，再送到角色这里');
    return;
  }
  const outcome = deliverTo(round, recipient);
  if (outcome.type === 'wrong') {
    state.round = outcome.next;
    const message = outcome.parcelOk && !outcome.recipientOk ? '对象不对，再看看这位是谁'
      : !outcome.parcelOk && outcome.recipientOk ? '包裹不对，再读一读指令'
      : '都不对，重新读指令试试';
    showFeedback('wrong', message);
    persistSnapshot();
    renderGame();
    return;
  }
  state.resolving = true;
  state.round = outcome.next;
  showFeedback('correct', `送达完成 +${outcome.gained}`);
  persistSnapshot();
  renderGame();
  await sleep(900);
  state.resolving = false;
  await advance();
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
  const record: EnglishRecord = buildRecord({
    recordId: state.roundId,
    finishedAt: new Date().toISOString(),
    grades: [...state.grades],
    contentVersion: CONTENT_VERSION,
    score: result.score,
    answered: result.answered,
  });
  if (!store.addRecord(record)) $('storage-notice').hidden = false;
  store.saveRecentIds(round.questions.map(q => q.exerciseId));
  store.clearSnapshot();
  const vocab = result.answered.filter(t => t.mode === 'vocab');
  const sentence = result.answered.filter(t => t.mode === 'sentence');
  $('result-score').textContent = `总分 ${result.score}`;
  $('result-answer').textContent = `完成 ${result.total} 个任务 · 首次一次完成 ${result.firstTry} · 错送 ${result.wrong} 次 · 送达尝试 ${result.attempts} 次`;
  $('result-modes').textContent = `词汇识别 ${vocab.filter(t => t.firstTry).length}/${vocab.length} 题首答`
    + ` · 句意理解 ${sentence.filter(t => t.firstTry).length}/${sentence.length} 题首答`;
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
  state.exercises = selectEnglishExercises(state.grades);
  state.round = snapshot.state;
  state.rng = restoreSeededRng(snapshot.rngState);
  state.paused = false;
  state.resolving = false;
  if (state.round.phase === 'resolving') {
    // 送达反馈窗口期间被打断：反馈已展示过，直接推进到下一任务或终局，不卡在 resolving。
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
  state.roundId = (crypto.randomUUID ? crypto.randomUUID() : `e-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
  state.previousIds = store.recentIds();
  state.exercises = selectEnglishExercises(state.grades);
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
  if (await confirm('返回将放弃本局配送进度，确定吗？')) {
    store.clearSnapshot();
    state.round = null;
    showSelect();
  }
})();
$('btn-again').onclick = () => void startRound();
$('btn-result-return').onclick = () => showSelect();
$('btn-restore').onclick = () => {
  const snapshot = store.snapshot();
  if (snapshot) restoreFromSnapshot(snapshot);
};
$('btn-discard-round').onclick = () => void (async () => {
  if (await confirm('放弃后本局配送进度将删除，确定吗？')) {
    store.clearSnapshot();
    $('restore-offer').hidden = true;
  }
})();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.round && state.round.phase !== 'finished') setPaused(true);
});

function boot(): void {
  clearTimeout((window as unknown as { __englishBootFailed?: number }).__englishBootFailed);
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
    $('restore-offer-text').textContent = '有未完成的配送任务，可以继续（包裹、站位与得分都会恢复）。';
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
