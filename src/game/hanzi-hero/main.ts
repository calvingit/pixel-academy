// 汉字勇者页面接线：年级选择、开局、作答、暂停/刷新恢复、结算与记录。
// 判题一律走 Learning Core（evaluateAnswer）；本文件不重复判题，不注入状态。
import { catalog } from '../../index.js';
import type { Grade } from '../../learning/models.js';
import { hanziPrompt, isHanziTask } from '../../learning/hanzi.js';
import { createRound, submitAnswer, advanceQuestion, togglePart, settlement, createSeededRng,
  QUESTIONS_PER_ROUND } from './rules.js';
import type { RoundState, RoundSnapshot } from './rules.js';
import { createHanziStorage } from './storage.js';
import type { HanziRecord } from './storage.js';
import { OPEN_GRADES, GRADE_NAMES, selectHanziExercises, describeAvailability } from './content.js';

const ALL_GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];
const store = createHanziStorage();
const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const state = {
  grades: [...store.settings().grades] as Grade[],
  round: null as RoundState | null,
  roundId: '',
  seed: 0,
  previousIds: [] as readonly string[],
  paused: false,
  resolving: false,
};

// ===== 工具 =====
const cryptoId = (): string => (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
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
      store.saveSettings({ grades: state.grades });
      renderGrades();
      renderAvailability();
    };
    grid.append(button);
  }
}
function renderAvailability(): void {
  const report = state.grades.length ? describeAvailability(state.grades) : null;
  // statusText 为 null 表示正常可开局，此时显示实际可用范围。
  $('availability-status').textContent = report ? (report.statusText ?? report.rangeText) : '请先选择年级';
  ($('btn-start') as HTMLButtonElement).disabled = !report?.startable;
}
function renderRecords(): void {
  const list = $('records-list');
  list.replaceChildren();
  const records = store.records();
  for (const r of [...records].reverse().slice(0, 10)) {
    const item = document.createElement('li');
    item.textContent = `${new Date(r.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${r.grades.map(g => GRADE_NAMES[g]).join('')} · ${r.score} 分 · 首次答对 ${r.firstTry}/${r.total}`;
    list.append(item);
  }
  $('records-empty').hidden = records.length > 0;
}

// ===== 局内 =====
function persistSnapshot(): void {
  if (!state.round || !store.available) return;
  const snapshot: RoundSnapshot = {
    version: 1, gameId: 'hanzi-hero', roundId: state.roundId, state: state.round,
    rngState: state.seed, previousIds: state.previousIds,
  };
  store.saveSnapshot(snapshot);
}

function renderGame(questionChanged = true): void {
  const round = state.round!;
  $('hud-progress').textContent = `第 ${round.questionIndex + 1}/${round.questions.length} 题`;
  $('hud-score').textContent = `得分 ${round.score}`;
  const task = round.questions[round.questionIndex]!.task;
  if (!isHanziTask(task)) throw new TypeError(`hanzi-hero round contains non-Chinese task: ${JSON.stringify(task)}`);
  $('question-prompt').textContent = hanziPrompt(task);
  const image = $('question-image') as HTMLImageElement;
  if (task.kind === 'hanzi-choose' && task.image) {
    image.src = `/${task.image}`; image.hidden = false;
  } else if (task.kind === 'hanzi-parts') {
    image.src = `/${task.image}`; image.hidden = false;
  } else {
    image.hidden = true;
  }
  // 反馈由 submit 流程管理：答错的提示保留到下一次尝试；仅在切换到新题时清除。
  if (questionChanged) $('feedback').hidden = true;
  const optionsBox = $('options');
  optionsBox.replaceChildren();
  if (!isHanziTask(task)) throw new TypeError('non-Chinese task in options render');
  const isParts = task.kind === 'hanzi-parts';
  $('btn-parts-submit').hidden = !isParts;
  ($('btn-parts-submit') as HTMLButtonElement).disabled = round.selectedParts.length === 0;
  for (const option of task.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-card';
    button.textContent = option;
    button.setAttribute('aria-pressed', String(isParts && round.selectedParts.includes(option)));
    button.onclick = () => void onOption(option);
    optionsBox.append(button);
  }
}

function showFeedback(kind: 'correct' | 'wrong', text: string): void {
  const feedback = $('feedback');
  feedback.dataset.kind = kind;
  feedback.textContent = kind === 'correct' ? `✓ ${text}` : `✗ ${text}`;
  feedback.hidden = false;
}

async function onOption(option: string): Promise<void> {
  if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
  const task = state.round.questions[state.round.questionIndex]!.task;
  if (task.kind === 'hanzi-parts') {
    state.round = togglePart(state.round, option);
    renderGame(false);
    return;
  }
  await submit(option);
}

async function submitParts(): Promise<void> {
  if (!state.round || state.paused || state.resolving || state.round.phase !== 'asking') return;
  await submit([...state.round.selectedParts]);
}

async function submit(answer: string | readonly string[]): Promise<void> {
  const outcome = submitAnswer(state.round!, answer);
  if (outcome.type === 'wrong') {
    state.round = outcome.next;
    showFeedback('wrong', '再想一想');
    persistSnapshot();
    renderGame(false);
    return;
  }
  $('feedback').hidden = true;
  state.resolving = true;
  state.round = outcome.next;
  showFeedback('correct', `答对了 +${outcome.gained}`);
  persistSnapshot();
  renderScore();
  await sleep(900);
  state.round = advanceQuestion(state.round);
  state.resolving = false;
  if (state.round.phase === 'finished') {
    store.clearSnapshot();
    settleRound();
  } else {
    persistSnapshot();
    renderGame();
  }
}

function renderScore(): void {
  $('hud-score').textContent = `得分 ${state.round!.score}`;
}

function settleRound(): void {
  const result = settlement(state.round!);
  const record: HanziRecord = {
    id: state.roundId,
    at: new Date().toISOString(),
    grades: [...state.grades],
    score: result.score,
    firstTry: result.firstTry,
    wrong: result.wrong,
    total: result.total,
  };
  if (!store.addRecord(record)) $('storage-notice').hidden = false;
  store.saveRecentIds(state.round!.questions.map(q => q.exerciseId));
  $('result-title').textContent = '通关！';
  $('result-score').textContent = `总分 ${result.score}`;
  $('result-detail').textContent = `首次答对 ${result.firstTry}/${result.total} · 答错 ${result.wrong} 次`;
  // 结算后局次已清，关闭可能残留的暂停遮罩（如局内页面后台化自动暂停）。
  $('pause-overlay').hidden = true;
  $('btn-pause').setAttribute('aria-pressed', 'false');
  showScreen('result');
  state.round = null;
}

// ===== 暂停/恢复与生命周期 =====
function setPaused(paused: boolean): void {
  if (!state.round || state.round.phase === 'finished') return;
  state.paused = paused;
  $('pause-overlay').hidden = !paused;
  $('btn-pause').setAttribute('aria-pressed', String(paused));
}

function restoreFromSnapshot(snapshot: RoundSnapshot): void {
  state.roundId = snapshot.roundId;
  state.seed = snapshot.rngState;
  state.previousIds = [...snapshot.previousIds];
  state.round = snapshot.state;
  state.paused = false;
  state.resolving = false;
  showScreen('game');
  if (state.round.phase === 'finished') {
    settleRound();
  } else {
    renderGame();
  }
}

// ===== 接线 =====
async function startRound(): Promise<void> {
  const seed = Math.floor(Math.random() * 0xffffffff) + 1;
  state.roundId = cryptoId();
  state.seed = seed;
  state.previousIds = store.recentIds();
  const exercises = selectHanziExercises(state.grades);
  state.round = createRound(exercises, state.previousIds, createSeededRng(seed).rng);
  state.paused = false;
  state.resolving = false;
  showScreen('game');
  renderGame();
  persistSnapshot();
}
$('btn-start').onclick = () => void startRound();
$('btn-parts-submit').onclick = () => void submitParts();
$('btn-pause').onclick = () => setPaused(!state.paused);
$('btn-resume').onclick = () => setPaused(false);
$('btn-game-return').onclick = () => void (async () => {
  if (await confirm('返回将放弃本局进度，确定吗？')) {
    store.clearSnapshot();
    state.round = null;
    showScreen('select');
    renderRecords();
  }
})();
$('btn-again').onclick = () => void startRound();
$('btn-result-return').onclick = () => { showScreen('select'); renderRecords(); };
$('btn-restore').onclick = () => {
  const snapshot = store.snapshot();
  if (snapshot) restoreFromSnapshot(snapshot);
};
$('btn-discard-round').onclick = () => void (async () => {
  if (await confirm('放弃后本局进度将删除，确定吗？')) {
    store.clearSnapshot();
    $('restore-offer').hidden = true;
  }
})();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.round && state.round.phase !== 'finished') setPaused(true);
});

function boot(): void {
  clearTimeout((window as unknown as { __hanziBootFailed?: number }).__hanziBootFailed);
  // 模块加载成功即清除兜底横幅（慢加载时 6 秒计时器可能已先触发）。
  $('boot-fail').hidden = true;
  $('storage-notice').hidden = store.available;
  renderGrades();
  renderAvailability();
  renderRecords();
  const snapshot = store.snapshot();
  if (snapshot) {
    $('restore-offer').hidden = false;
    $('restore-offer-text').textContent = '有未完成的一局，可以继续（不兼容的旧进度已安全清除）。';
  }
  if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
    // SW 不可用或注册失败时游戏仍在线可玩；离线细节由 M6 机制承担，此处只负责注册。
    // ?nosw 为验证工具入口：跳过注册，保证驱动脚本始终拿到当前构建产物。
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  showScreen('select');
}

boot();
