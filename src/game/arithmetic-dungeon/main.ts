// 算术地下城页面接线：年级选择、开局探索、门题/资源题作答（每题 10 秒计时）、
// 钥匙与换题、暂停/刷新恢复、结算与记录。
// 判题一律走 Learning Core（evaluateAnswer）；计时复用数字消除 RoundSession（注入时钟）；
// 本文件不重复判题，不实现计时算法。
import type { Exercise, Grade, MathTask } from '../../learning/models.js';
import { isMultiple, optionText } from '../../learning/choice.js';
import { taskText } from '../number-puzzle/learning.js';
import { createRuntimeRng, restoreSeededRng } from '../number-puzzle/random.js';
import type { RestorableRng } from '../number-puzzle/random.js';
import { RoundSession } from '../number-puzzle/session.js';
import type { TimedSession } from '../number-puzzle/session.js';
import { answerActive, createRound, disengage, DOORS, doorBetween, engageSlot, GAME_ID,
  MAX_KEYS, moveOptions, moveTo, QUESTION_TIME_MS, retryActive, ROOMS, settlement,
  timeoutActive, useKeyActive } from './rules.js';
import type { DoorId, RoomId, RoundSnapshot, RoundState, SlotId } from './rules.js';
import { buildRecord, createDungeonStorage, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage.js';
import type { DungeonRecord } from './storage.js';
import { syncIntegerSubmit, wireIntegerSubmit } from './input.js';
import { CONTENT_VERSION, describeAvailability, GRADE_NAMES, OPEN_GRADES,
  selectDungeonExercises } from './content.js';

const ALL_GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];
const store = createDungeonStorage();
const session = new RoundSession(() => Date.now());
const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const state = {
  grades: [...store.settings().grades] as Grade[],
  round: null as RoundState | null,
  roundId: '',
  rng: null as RestorableRng | null,
  exercises: [] as readonly Exercise<MathTask>[],
  previousIds: [] as readonly string[],
  paused: false,
  resolving: false,
};

// 会话层计时：只在门题/资源题面板打开且处于作答尝试时运行；探索移动与暂停不计时。
const timer: TimedSession = { paused: false, remainingMs: QUESTION_TIME_MS, deadline: null, timerKind: null };
// 面板状态：attempt=计时作答中；waitRetry=答错/超时后待再试；solved=已解开（展示反馈）。
let panelState: 'attempt' | 'waitRetry' | 'solved' = 'attempt';
let selectedIds: string[] = [];

// ===== 工具 =====
const cryptoId = (): string => (crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
const doorName = (door: DoorId): string => DOORS.find(item => item.id === door)!.name;
/** 门打开后的通行目标房间（答对/用钥匙后自动穿门）。 */
const doorTarget = (door: DoorId): RoomId => DOORS.find(item => item.id === door)!.to;
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
  $('availability-status').textContent = report ? (report.statusText ?? `本层题库：${report.rangeText}`) : '请先选择年级';
  ($('btn-start') as HTMLButtonElement).disabled = !report?.startable;
}
function renderRecords(): void {
  const list = $('records-list');
  list.replaceChildren();
  const records = store.records();
  for (const r of [...records].reverse().slice(0, 10)) {
    const item = document.createElement('li');
    const solved = r.answer.questions.length;
    const firstTry = r.answer.questions.filter(q => q.firstTry).length;
    item.textContent = `${new Date(r.finishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      + ` · ${r.grades.map(g => GRADE_NAMES[g]).join('')} · ${r.score} 分 · 首答 ${firstTry}/${solved} · 重试 ${r.explore.retries} 次`;
    list.append(item);
  }
  $('records-empty').hidden = records.length > 0;
}

// ===== 计时 =====
function startAttempt(): void {
  session.start(timer, 'question', QUESTION_TIME_MS);
  panelState = 'attempt';
}
function stopTimer(): void {
  session.start(timer, null, 0);
}
function renderCountdown(): void {
  const countdown = $('countdown');
  const active = state.round !== null && state.round.activeSlot !== null && panelState === 'attempt'
    && timer.timerKind === 'question' && !state.paused;
  countdown.hidden = !state.round?.activeSlot;
  if (!active) {
    countdown.textContent = state.round?.activeSlot ? '已停止计时' : '';
    countdown.dataset.urgent = 'false';
    return;
  }
  const remaining = session.remaining(timer);
  countdown.dataset.urgent = String(remaining <= 3000);
  countdown.textContent = `剩余 ${(remaining / 1000).toFixed(1)} 秒`;
}
function tick(): void {
  if (!state.round || state.paused || panelState !== 'attempt' || timer.timerKind !== 'question') {
    if (state.round?.activeSlot) renderCountdown();
    return;
  }
  if (session.remaining(timer) > 0) { renderCountdown(); return; }
  // 超时按答错处理：不解锁、不扣分，进入待再试。
  const outcome = timeoutActive(state.round);
  state.round = outcome.next;
  stopTimer();
  panelState = 'waitRetry';
  showFeedback('wrong', '时间到，休息一下再试一次吧');
  persistSnapshot();
  renderGame(false);
}

// ===== 快照 =====
function persistSnapshot(): void {
  if (!state.round || !store.available || state.round.phase === 'finished') return;
  const snapshot: RoundSnapshot = {
    version: 1, gameId: GAME_ID, roundId: state.roundId, state: state.round,
    rngState: state.rng ? state.rng.snapshotState() : 0, previousIds: state.previousIds,
    grades: [...state.grades], contentVersion: CONTENT_VERSION,
    timer: { paused: timer.paused, remainingMs: session.remaining(timer), deadline: timer.deadline, timerKind: timer.timerKind },
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

function renderGame(focusQuestion = true): void {
  const round = state.round;
  if (!round) return;
  $('hud-room').textContent = ROOMS[round.room].name;
  $('hud-score').textContent = `得分 ${round.score}`;
  $('hud-keys').textContent = `备用钥匙 ${round.keys}/${MAX_KEYS}`;
  $('room-name').textContent = ROOMS[round.room].name;
  $('room-desc').textContent = ROOMS[round.room].description;
  renderRoutes(round);
  renderQuestion(round, focusQuestion);
  renderCountdown();
}

/** 路线按钮：锁着的门进入门题面板，开着的门直接通行；资源房附资源机关入口。 */
function renderRoutes(round: RoundState): void {
  const list = $('route-list');
  list.replaceChildren();
  const actions: { label: string; locked: boolean; run: () => void }[] = [];
  for (const option of moveOptions(round)) {
    const door = option.door !== null ? doorBetween(round.room, option.to) : null;
    if (option.locked) {
      actions.push({
        label: `${doorName(option.door!)}（锁着）→ 前往${ROOMS[option.to].name}`,
        locked: true,
        run: () => void engage(option.door!),
      });
    } else {
      // 门已开：door.from === 当前房间为顺向经过，否则是折回（不重复出题、不重复计分）。
      const back = door !== null && door.from !== round.room;
      actions.push({
        label: back ? `折回${ROOMS[option.to].name}` : `经过${doorName(option.door!)} → ${ROOMS[option.to].name}`,
        locked: false,
        run: () => void doMove(option.to),
      });
    }
  }
  if (round.room === 'resource' && !round.slots.resource.solved) {
    actions.push({ label: '解读资源机关（取得备用钥匙）', locked: true, run: () => void engage('resource') });
  }
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-btn';
    button.textContent = action.label;
    if (action.locked) button.classList.add('route-locked');
    // 结算反馈窗口（resolving）内禁用路线按钮，不渲染可点假象。
    button.disabled = state.resolving;
    button.onclick = action.run;
    list.append(button);
  }
}

function renderQuestion(round: RoundState, focusQuestion: boolean): void {
  const card = $('question-card');
  const slot = round.activeSlot;
  card.hidden = slot === null;
  if (slot === null) return;
  const current = round.slots[slot]!;
  $('slot-title').textContent = slot === 'resource' ? '资源机关' : `${doorName(slot)} · 门题`;
  const task = current.question.task;
  if (task.kind !== 'choice' && task.kind !== 'binary' && task.kind !== 'chain') {
    throw new TypeError(`dungeon slot contains unsupported task: ${JSON.stringify(task)}`);
  }
  const prompt = $('question-prompt');
  const questionChanged = prompt.dataset.exerciseId !== current.question.exerciseId;
  if (questionChanged) {
    selectedIds = [];
    ($('answer-input') as HTMLInputElement).value = '';
    prompt.dataset.exerciseId = current.question.exerciseId;
  }
  prompt.textContent = taskText(task);
  const optionsBox = $('options');
  optionsBox.replaceChildren();
  const isChoice = task.kind === 'choice';
  const multiple = isChoice && isMultiple(task);
  optionsBox.hidden = !isChoice;
  $('answer-input-group').hidden = isChoice;
  if (isChoice) {
    for (const option of task.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option-card';
      button.textContent = optionText(option);
      button.setAttribute('aria-pressed', String(selectedIds.includes(option.id)));
      button.disabled = panelState !== 'attempt';
      button.onclick = () => void onOption(task, option.id);
      optionsBox.append(button);
    }
  } else {
    const input = $('answer-input') as HTMLInputElement;
    const submitButton = $('btn-input-submit') as HTMLButtonElement;
    input.disabled = panelState !== 'attempt';
    // 键入联动由 input 事件实时维护（wireIntegerSubmit）；此处按面板状态与当前值收敛。
    syncIntegerSubmit(input, submitButton);
  }
  const choiceSubmit = $('btn-choice-submit') as HTMLButtonElement;
  choiceSubmit.hidden = !multiple;
  choiceSubmit.disabled = panelState !== 'attempt' || selectedIds.length === 0;
  if (focusQuestion && questionChanged) ($('slot-title') as HTMLElement).focus();
  renderQuestionActions(round, slot);
}

function renderQuestionActions(round: RoundState, slot: SlotId): void {
  const solved = panelState === 'solved';
  $('btn-retry-attempt').hidden = panelState !== 'waitRetry';
  $('btn-swap').hidden = solved;
  $('btn-use-key').hidden = solved || slot === 'resource' || round.keys < 1;
  const leave = $('btn-leave') as HTMLButtonElement;
  leave.textContent = solved && slot === 'resource' ? '收下钥匙，返回房间' : '离开机关';
  // 结算反馈窗口（resolving）内禁用，不渲染可点假象；窗口结束后的重渲染会恢复。
  leave.disabled = state.resolving;
}

// ===== 局内动作 =====
async function onOption(task: MathTask & { kind: 'choice' }, optionId: string): Promise<void> {
  if (!state.round || state.paused || state.resolving) return;
  if (!isMultiple(task)) { await submit(optionId); return; }
  selectedIds = selectedIds.includes(optionId)
    ? selectedIds.filter(id => id !== optionId)
    : [...selectedIds, optionId];
  renderGame(false);
}

async function submit(answer: string | readonly string[]): Promise<void> {
  if (!state.round || state.paused || state.resolving || panelState !== 'attempt') return;
  const slot = state.round.activeSlot;
  if (!slot) return;
  const outcome = answerActive(state.round, answer);
  if (outcome.type === 'wrong') {
    state.round = outcome.next;
    stopTimer();
    panelState = 'waitRetry';
    showFeedback('wrong', '再想一想，或换一题试试');
    persistSnapshot();
    renderGame(false);
    return;
  }
  state.resolving = true;
  state.round = outcome.next;
  stopTimer();
  panelState = 'solved';
  $('feedback').hidden = true;
  showFeedback('correct', `答对了 +${outcome.gained}`);
  persistSnapshot();
  renderGame(false);
  await sleep(900);
  state.resolving = false;
  if (slot === 'resource') {
    // 资源机关解开后留在资源房，由玩家折回岔口重新选择路线。
    persistSnapshot();
    renderGame(false);
    return;
  }
  await doMove(doorTarget(slot));
}

async function engage(slot: SlotId): Promise<void> {
  if (!state.round || state.paused || state.resolving) return;
  state.round = engageSlot(state.round, slot);
  selectedIds = [];
  ($('answer-input') as HTMLInputElement).value = '';
  $('feedback').hidden = true;
  startAttempt();
  persistSnapshot();
  renderGame();
}

async function doMove(to: RoomId): Promise<void> {
  if (!state.round) return;
  state.round = moveTo(state.round, to);
  $('feedback').hidden = true;
  if (state.round.phase === 'finished') {
    settleRound();
    return;
  }
  persistSnapshot();
  renderGame();
}

async function retryAttempt(): Promise<void> {
  if (!state.round || state.paused || state.resolving || panelState !== 'waitRetry') return;
  $('feedback').hidden = true;
  startAttempt();
  persistSnapshot();
  renderGame(false);
}

async function swapQuestion(): Promise<void> {
  if (!state.round || !state.rng || state.paused || state.resolving || panelState === 'solved') return;
  const outcome = retryActive(state.round, state.exercises, state.previousIds, state.rng);
  if (outcome.type === 'exhausted') {
    // 题库抽尽不是死局：本题仍可反复作答或用钥匙开门。
    showFeedback('info', '题库的新题暂时用完了，继续答这道题也能开门。');
    return;
  }
  state.round = outcome.next;
  selectedIds = [];
  ($('answer-input') as HTMLInputElement).value = '';
  $('feedback').hidden = true;
  startAttempt();
  persistSnapshot();
  renderGame();
}

async function useKey(): Promise<void> {
  if (!state.round || state.paused || state.resolving || panelState === 'solved') return;
  const slot = state.round.activeSlot;
  if (!slot || slot === 'resource') return;
  state.round = useKeyActive(state.round);
  state.resolving = true;
  stopTimer();
  panelState = 'solved';
  $('feedback').hidden = true;
  showFeedback('correct', '用备用钥匙打开了门');
  persistSnapshot();
  renderGame(false);
  await sleep(900);
  state.resolving = false;
  await doMove(doorTarget(slot));
}

async function leaveSlot(): Promise<void> {
  if (!state.round || state.resolving) return;
  state.round = disengage(state.round);
  stopTimer();
  $('feedback').hidden = true;
  persistSnapshot();
  renderGame(false);
}

// ===== 结算与恢复 =====
function settleRound(): void {
  const round = state.round!;
  const result = settlement(round);
  const record: DungeonRecord = buildRecord({
    recordId: state.roundId,
    finishedAt: new Date().toISOString(),
    grades: [...state.grades],
    contentVersion: CONTENT_VERSION,
    score: result.score,
    answered: result.answered,
    route: result.route,
    keysHeld: result.keysHeld,
    keyUses: result.keyUses,
    retries: result.retries,
  });
  if (!store.addRecord(record)) $('storage-notice').hidden = false;
  store.saveRecentIds(round.usedIds);
  store.clearSnapshot();
  $('result-score').textContent = `总分 ${result.score}`;
  $('result-answer').textContent = `作答 ${result.answered.length} 题 · 首答 ${result.firstTry}/${result.answered.length} · 重试 ${result.retries} 次`;
  $('result-explore').textContent = `路线 ${result.route.map(room => ROOMS[room].name).join(' → ')} · 备用钥匙 用 ${result.keyUses} 把 / 剩 ${result.keysHeld} 把`;
  $('pause-overlay').hidden = true;
  $('btn-pause').setAttribute('aria-pressed', 'false');
  showScreen('result');
  state.round = null;
  state.paused = false;
  stopTimer();
}

function restoreFromSnapshot(snapshot: RoundSnapshot): void {
  state.roundId = snapshot.roundId;
  state.previousIds = [...snapshot.previousIds];
  state.grades = [...snapshot.grades];
  state.exercises = selectDungeonExercises(state.grades);
  state.round = snapshot.state;
  state.rng = restoreSeededRng(snapshot.rngState);
  state.paused = false;
  state.resolving = false;
  timer.paused = false;
  timer.timerKind = snapshot.timer.timerKind;
  timer.remainingMs = snapshot.timer.remainingMs;
  timer.deadline = snapshot.timer.deadline;
  if (timer.timerKind === 'question') {
    // 暂停快照按冻结剩余恢复；运行中快照按截止时间扣除经过时间（与数字消除同口径）。
    const remaining = snapshot.timer.paused ? snapshot.timer.remainingMs : session.remaining(timer);
    if (remaining <= 0) {
      // 中断期间时间耗尽：题目保留、不计答错，进入待再试。
      stopTimer();
      panelState = 'waitRetry';
    } else {
      timer.remainingMs = remaining;
      timer.deadline = Date.now() + remaining;
      panelState = 'attempt';
    }
  } else {
    stopTimer();
    panelState = state.round.activeSlot ? 'waitRetry' : 'attempt';
  }
  showScreen('game');
  if (state.round.phase === 'finished') {
    settleRound();
  } else {
    renderGame();
  }
}

// ===== 暂停 =====
function setPaused(paused: boolean): void {
  if (!state.round || state.round.phase === 'finished') return;
  state.paused = paused;
  if (paused) session.pause(timer);
  else if (timer.timerKind) session.resume(timer);
  $('pause-overlay').hidden = !paused;
  $('btn-pause').setAttribute('aria-pressed', String(paused));
  persistSnapshot();
}

// ===== 接线 =====
async function startRound(): Promise<void> {
  const rng = createRuntimeRng();
  state.roundId = cryptoId();
  state.previousIds = store.recentIds();
  state.exercises = selectDungeonExercises(state.grades);
  state.round = createRound(state.exercises, state.previousIds, rng);
  state.rng = rng;
  state.paused = false;
  state.resolving = false;
  stopTimer();
  panelState = 'attempt';
  selectedIds = [];
  ($('answer-input') as HTMLInputElement).value = '';
  $('feedback').hidden = true;
  showScreen('game');
  renderGame();
  persistSnapshot();
}
$('btn-start').onclick = () => void startRound();
// 整数题输入联动：真实键入实时启用「开门」，点击提交读取当前输入值；Enter 走按钮点击同路径。
wireIntegerSubmit(
  $('answer-input') as HTMLInputElement,
  $('btn-input-submit') as HTMLButtonElement,
  value => void submit(value),
);
$('answer-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    ($('btn-input-submit') as HTMLButtonElement).click();
  }
});
$('btn-choice-submit').onclick = () => { void submit([...selectedIds]); };
$('btn-retry-attempt').onclick = () => void retryAttempt();
$('btn-swap').onclick = () => void swapQuestion();
$('btn-use-key').onclick = () => void useKey();
$('btn-leave').onclick = () => void leaveSlot();
$('btn-pause').onclick = () => setPaused(!state.paused);
$('btn-resume').onclick = () => setPaused(false);
$('btn-game-return').onclick = () => void (async () => {
  if (await confirm('返回将放弃本局探索进度，确定吗？')) {
    store.clearSnapshot();
    state.round = null;
    stopTimer();
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
  if (await confirm('放弃后本局探索进度将删除，确定吗？')) {
    store.clearSnapshot();
    $('restore-offer').hidden = true;
  }
})();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.round && state.round.phase !== 'finished') setPaused(true);
});
setInterval(() => tick(), 100);

function boot(): void {
  clearTimeout((window as unknown as { __dungeonBootFailed?: number }).__dungeonBootFailed);
  // 模块加载成功即清除兜底横幅（慢加载时 6 秒计时器可能已先触发）。
  $('boot-fail').hidden = true;
  $('storage-notice').hidden = store.available;
  renderGrades();
  renderAvailability();
  renderRecords();
  const snapshot = store.snapshot();
  if (snapshot) {
    $('restore-offer').hidden = false;
    $('restore-offer-text').textContent = '有未完成的探索，可以继续（房间、门、钥匙与作答进度都会恢复）。';
  } else if (store.available && localStorage.getItem(STORAGE_KEYS.snapshot) !== null) {
    // 结构或内容版本不兼容的旧进度已被 snapshot() 拒绝：安全放弃并说明原因，不影响其他游戏数据。
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
