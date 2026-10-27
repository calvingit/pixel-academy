// 拼音冒险页面接线：年级选择、开局组卷（辨认/听辨混合）、听辨播放与重听、
// 每题 10 秒计时（播放不暂停计时）、答错/超时可重试、听辨音频不可用跳过、
// 暂停/刷新恢复、结算与记录。
// 判题一律走 Learning Core（evaluateAnswer，经 rules 层）；计时复用数字消除 RoundSession
//（注入时钟）；音频经 PinyinSpeaker 接口注入；本文件不重复判题、不实现计时算法。
import type { Exercise, Grade, PinyinTask } from '../../learning/models.js';
import { isPinyinTask } from '../../learning/pinyin.js';
import { createRuntimeRng, restoreSeededRng } from '../number-puzzle/random.js';
import type { RestorableRng } from '../number-puzzle/random.js';
import { RoundSession } from '../number-puzzle/session.js';
import type { TimedSession } from '../number-puzzle/session.js';
import { advanceQuestion, createRound, GAME_ID, QUESTION_TIME_MS, settlement, skipCurrent,
  submitAnswer, timeoutCurrent } from './rules.js';
import type { RoundSnapshot, RoundState } from './rules.js';
import { buildRecord, createPinyinStorage, STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from './storage.js';
import type { PinyinRecord } from './storage.js';
import { createPinyinSpeaker } from './audio.js';
import { CONTENT_VERSION, describeAvailability, GRADE_NAMES, OPEN_GRADES,
  selectPinyinExercises } from './content.js';

const ALL_GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];
const store = createPinyinStorage();
const speaker = createPinyinSpeaker();
const session = new RoundSession(() => Date.now());
const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const state = {
  grades: [...store.settings().grades] as Grade[],
  round: null as RoundState | null,
  roundId: '',
  rng: null as RestorableRng | null,
  exercises: [] as readonly Exercise<PinyinTask>[],
  previousIds: [] as readonly string[],
  paused: false,
  resolving: false,
  /** 本局内音频是否已判定不可用（判定后后续听辨题直接呈现提示与跳过入口）。 */
  audioUnavailable: false,
};

// 会话层计时：只在题目处于作答尝试时运行；暂停不计时。听辨播放不暂停计时。
const timer: TimedSession = { paused: false, remainingMs: QUESTION_TIME_MS, deadline: null, timerKind: null };
// 题目面板状态：attempt=计时作答中；waitRetry=答错/超时后待再试；solved=已答对（展示反馈）。
let panelState: 'attempt' | 'waitRetry' | 'solved' = 'attempt';
let playPending = false;

// ===== 工具 =====
const cryptoId = (): string => (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
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
    const answered = r.answer.questions.filter(q => q.answered);
    const firstTry = answered.filter(q => q.firstTry).length;
    const skipped = r.answer.questions.length - answered.length;
    item.textContent = `${new Date(r.finishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      + ` · ${r.grades.map(g => GRADE_NAMES[g]).join('')} · ${r.score} 分 · 首答 ${firstTry}/${answered.length}`
      + (skipped ? ` · 跳过 ${skipped}` : '');
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
  const active = state.round !== null && panelState === 'attempt' && timer.timerKind === 'question' && !state.paused;
  if (!active) {
    countdown.textContent = state.round ? '已停止计时' : '';
    countdown.dataset.urgent = 'false';
    return;
  }
  const remaining = session.remaining(timer);
  countdown.dataset.urgent = String(remaining <= 3000);
  countdown.textContent = `剩余 ${(remaining / 1000).toFixed(1)} 秒`;
}
function tick(): void {
  if (!state.round || state.paused || panelState !== 'attempt' || timer.timerKind !== 'question') {
    if (state.round) renderCountdown();
    return;
  }
  if (session.remaining(timer) > 0) { renderCountdown(); return; }
  // 超时按答错处理：不扣分，进入待再试（听辨题可重听后再试）。
  const outcome = timeoutCurrent(state.round);
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
  $('hud-progress').textContent = `第 ${round.questionIndex + 1}/${round.questions.length} 题`;
  $('hud-score').textContent = `得分 ${round.score}`;
  renderQuestion(round, focusQuestion);
  renderCountdown();
}

/** 渲染当前题：辨认题渲染大字形题面 + 4 候选；听辨题只渲染播放钮与候选，不显示答案字形。 */
function renderQuestion(round: RoundState, focusQuestion: boolean): void {
  const card = $('question-card');
  const question = round.questions[round.questionIndex];
  card.hidden = !question;
  if (!question) return;
  const task = question.task;
  if (!isPinyinTask(task)) {
    throw new TypeError(`pinyin-adventure round contains non-pinyin task: ${JSON.stringify(task)}`);
  }
  const isListen = task.kind === 'pinyin-listen';
  const title = $('q-title');
  title.textContent = isListen ? `听辨练习 · 听声音选字母` : '辨认练习 · 找出目标字母';
  const prompt = $('q-prompt');
  const questionChanged = prompt.dataset.exerciseId !== question.exerciseId;
  if (questionChanged) {
    prompt.dataset.exerciseId = question.exerciseId;
    $('play-status').textContent = '';
    // 题面只来自 task.prompt；听辨题面不含答案字形（validatePinyinTask 结构保证）。
  }
  prompt.textContent = task.prompt;
  // 听辨区：播放钮 + 状态；辨认题隐藏整个播放区。
  const playGroup = $('play-group');
  playGroup.hidden = !isListen;
  if (isListen) renderPlayArea();
  // 候选按钮：点击即作答（单选）。渲染层只渲染 task.options，不渲染 letter/answer。
  const optionsBox = $('options');
  optionsBox.replaceChildren();
  for (const option of task.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-card';
    button.textContent = option;
    button.disabled = panelState !== 'attempt' || state.resolving || state.paused;
    button.onclick = () => void submit(option);
    optionsBox.append(button);
  }
  const skipButton = $('btn-skip') as HTMLButtonElement;
  skipButton.hidden = !(isListen && state.audioUnavailable && panelState !== 'solved');
  skipButton.disabled = state.resolving;
  $('btn-retry-attempt').hidden = panelState !== 'waitRetry';
  if (focusQuestion && questionChanged) (title as HTMLElement).focus();
  renderCountdown();
}

/** 播放区：可重复播放；音频不可用时呈现明确提示（不假装完成听力训练）。 */
function renderPlayArea(): void {
  const playButton = $('btn-play') as HTMLButtonElement;
  const notice = $('audio-notice');
  playButton.disabled = playPending || state.resolving || state.paused;
  playButton.textContent = playPending ? '播放中…' : '▶ 播放声音';
  notice.hidden = !state.audioUnavailable;
}

// ===== 局内动作 =====
async function submit(answer: string): Promise<void> {
  if (!state.round || state.paused || state.resolving || panelState !== 'attempt') return;
  const outcome = submitAnswer(state.round, answer);
  if (outcome.type === 'wrong') {
    state.round = outcome.next;
    stopTimer();
    panelState = 'waitRetry';
    showFeedback('wrong', '再想一想，或再听一遍试试');
    persistSnapshot();
    renderGame(false);
    return;
  }
  state.resolving = true;
  state.round = outcome.next;
  stopTimer();
  panelState = 'solved';
  showFeedback('correct', `答对了 +${outcome.gained}`);
  persistSnapshot();
  renderGame(false);
  await sleep(900);
  state.resolving = false;
  await advance();
}

/** 反馈后推进：切下一题（听辨区复位）或进入结算。 */
async function advance(): Promise<void> {
  if (!state.round) return;
  speaker.stop();
  playPending = false;
  $('feedback').hidden = true;
  state.round = advanceQuestion(state.round);
  if (state.round.phase === 'finished') {
    settleRound();
    return;
  }
  startAttempt();
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

/** 跳过当前听辨题（仅音频不可用时可见）：不判题不计分，记录如实标注 skipped。 */
async function skipQuestion(): Promise<void> {
  if (!state.round || state.paused || state.resolving || panelState === 'solved') return;
  state.round = skipCurrent(state.round);
  stopTimer();
  speaker.stop();
  $('feedback').hidden = true;
  if (state.round.phase === 'finished') {
    persistSnapshot();
    settleRound();
    return;
  }
  startAttempt();
  persistSnapshot();
  renderGame();
}

async function onPlay(): Promise<void> {
  const round = state.round;
  if (!round || state.paused || state.resolving || panelState === 'solved' || playPending) return;
  const question = round.questions[round.questionIndex];
  if (!question || question.task.kind !== 'pinyin-listen') return;
  playPending = true;
  renderPlayArea();
  // 听辨播放不暂停计时：播放期间作答计时继续（口径如实实现）。
  const result = await speaker.play(question.task.audio);
  playPending = false;
  if (result === 'unavailable') {
    // 降级提示只保留 audio-notice 一处（renderPlayArea 呈现并随局内听辨题持续显示），
    // 不再写入 feedback，避免同屏两条同文案提示。
    state.audioUnavailable = true;
  }
  renderGame(false);
}

// ===== 结算与恢复 =====
function settleRound(): void {
  const round = state.round!;
  const result = settlement(round);
  const record: PinyinRecord = buildRecord({
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
  const byMode = (mode: 'choose' | 'listen') => result.answered.filter(q => q.mode === mode);
  const choose = byMode('choose');
  const listen = byMode('listen');
  const skipped = result.total - result.answered.filter(q => q.answered).length;
  $('result-score').textContent = `总分 ${result.score}`;
  $('result-answer').textContent = `作答 ${result.answered.filter(q => q.answered).length} 题 · 首答 ${result.firstTry} · 重试 ${result.wrong} 次`
    + (skipped ? ` · 跳过 ${skipped} 题` : '');
  $('result-modes').textContent = `辨认 ${choose.filter(q => q.firstTry).length}/${choose.length} 题首答`
    + ` · 听辨 ${listen.filter(q => q.firstTry).length}/${listen.length} 题首答`;
  $('pause-overlay').hidden = true;
  $('btn-pause').setAttribute('aria-pressed', 'false');
  showScreen('result');
  state.round = null;
  state.paused = false;
  state.audioUnavailable = false;
  stopTimer();
}

function restoreFromSnapshot(snapshot: RoundSnapshot): void {
  state.roundId = snapshot.roundId;
  state.previousIds = [...snapshot.previousIds];
  state.grades = [...snapshot.grades];
  state.exercises = selectPinyinExercises(state.grades);
  state.round = snapshot.state;
  state.rng = restoreSeededRng(snapshot.rngState);
  state.paused = false;
  state.resolving = false;
  state.audioUnavailable = false;
  timer.paused = false;
  timer.timerKind = snapshot.timer.timerKind;
  timer.remainingMs = snapshot.timer.remainingMs;
  timer.deadline = snapshot.timer.deadline;
  if (state.round.phase === 'resolving') {
    // 答对反馈窗口期间被打断：反馈已展示过，直接推进到下一题或终局，不卡在 resolving。
    state.round = advanceQuestion(state.round);
  }
  if (state.round.phase === 'finished') {
    stopTimer();
    settleRound();
    return;
  }
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
    panelState = 'waitRetry';
  }
  showScreen('game');
  renderGame();
}

// ===== 暂停 =====
function setPaused(paused: boolean): void {
  if (!state.round || state.round.phase === 'finished') return;
  state.paused = paused;
  if (paused) {
    session.pause(timer);
    speaker.stop();
    playPending = false;
  } else if (timer.timerKind) {
    session.resume(timer);
  }
  $('pause-overlay').hidden = !paused;
  $('btn-pause').setAttribute('aria-pressed', String(paused));
  persistSnapshot();
  if (!paused) renderGame(false);
}

// ===== 接线 =====
async function startRound(): Promise<void> {
  const rng = createRuntimeRng();
  state.roundId = cryptoId();
  state.previousIds = store.recentIds();
  state.exercises = selectPinyinExercises(state.grades);
  state.round = createRound(state.exercises, state.previousIds, rng);
  state.rng = rng;
  state.paused = false;
  state.resolving = false;
  state.audioUnavailable = false;
  // 首题即为作答中：启动 10 秒计时（后续题目由 advance/skip/retry 再启动）。
  startAttempt();
  playPending = false;
  $('feedback').hidden = true;
  showScreen('game');
  renderGame();
  persistSnapshot();
}
$('btn-start').onclick = () => void startRound();
$('btn-play').onclick = () => void onPlay();
$('btn-retry-attempt').onclick = () => void retryAttempt();
$('btn-skip').onclick = () => void skipQuestion();
$('btn-pause').onclick = () => setPaused(!state.paused);
$('btn-resume').onclick = () => setPaused(false);
$('btn-game-return').onclick = () => void (async () => {
  speaker.stop();
  if (await confirm('返回将放弃本局练习进度，确定吗？')) {
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
  if (await confirm('放弃后本局练习进度将删除，确定吗？')) {
    store.clearSnapshot();
    $('restore-offer').hidden = true;
  }
})();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.round && state.round.phase !== 'finished') setPaused(true);
});
setInterval(() => tick(), 100);

function boot(): void {
  clearTimeout((window as unknown as { __pinyinBootFailed?: number }).__pinyinBootFailed);
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
    $('restore-offer-text').textContent = '有未完成的练习，可以继续（题目、得分与计时进度都会恢复）。';
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
