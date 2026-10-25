// 数字消除 H5 入口：常规界面（年级选择、可用内容、结算）用 DOM，
// 游戏区用 Canvas 2D（render.ts）。完整流程：年级多选 → 可用内容提示 →
// 开始一局 → 作答与消除 → 结果反馈 → 再玩或返回（PLAN.md M3）。
// M4：游戏屏提供暂停/继续、重新开始（两击确认防误触）与返回；页面隐藏
// （visibilitychange）自动暂停且恢复前台不自动继续；动画计时器经 RoundSession
// 冻结换算，暂停期间到点的计时器在继续后按剩余时长补触发；音效为 WebAudio
// 合成、可关闭（audio.ts），只作反馈增强，不承载规则信息。
// M5：本地记录与恢复（storage.ts 为纯逻辑，此处只做接线）。年级选择与音效设置
// 即改即存；单局每次规则状态变化后把最小恢复状态（题目、棋盘、分数、阶段、
// RNG 内部状态、计时器剩余）写入中断快照，刷新或关闭后可继续且不重复计分；
// 结束局次写入成绩记录（按 recordId 去重）；内容版本不一致时放弃中断局次并说明；
// 存储不可用或写入失败时游戏照常可玩并提示无法持久保存；提供清除本地记录入口
// （两击确认）。预览入口不读写任何正式记录存储。
// 正式入口为默认 URL，只走 selectExercises；?preview=candidate 为显式隔离的
// 候选预览入口（previewExercises，草稿计入可用数），两者不共享局次状态。
import type { Exercise, Grade } from '../../learning/models.js';
import {
  clickTile, completeResolve, createRound, endWrongFeedback,
  ELIMINATE_MS, FILL_MS, WRONG_FEEDBACK_MS,
} from './rules.js';
import type { RoundState } from './rules.js';
import type { TimerKind } from './session.js';
import { RoundSession } from './session.js';
import { GameAudio } from './audio.js';
import { createRuntimeRng, restoreSeededRng } from './random.js';
import type { RestorableRng } from './random.js';
import { ALL_GRADES, GAME_ID, GRADE_NAMES, describeAvailability, loadGameContent } from './content.js';
import type { GameContent } from './content.js';
import { NumberPuzzleRenderer } from './render.js';
import {
  GameStorage, STORAGE_SCHEMA_VERSION, buildFinishedRecord, buildInterruptedSnapshot,
  checkRestore, contentFingerprint, roundFromSnapshot,
} from './storage.js';
import type {
  FinishedRoundRecordV1, InterruptedRoundV1, KeyValueStore, RoundRecordQuestionV1, StoredTimerV1,
} from './storage.js';

type ScreenId = 'error' | 'select' | 'availability' | 'game' | 'result';

interface RunningRound {
  state: RoundState;
  rng: RestorableRng;
}

const RESTART_CONFIRM_MS = 3000;
/** 记录列表最多展示的条数（更早的记录仍保存在存储中）。 */
const RECORDS_SHOWN = 10;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

/** 浏览器 localStorage 适配器：读取被策略阻止时抛错，返回 null 走无存储模式。 */
function createBrowserKeyValueStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 局次记录 ID：同一局（含中断恢复后的续局）共享，用于成绩去重。 */
function createRecordId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `np-${cryptoApi.randomUUID()}`;
  return `np-${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
}

const formatRecordTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}-${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`;
};

class NumberPuzzleApp {
  private readonly content: GameContent;
  private readonly preview: boolean;
  private readonly select: (grades: readonly Grade[]) => readonly Exercise[];
  private readonly renderer: NumberPuzzleRenderer;
  private readonly session = new RoundSession(() => performance.now());
  private readonly audio = new GameAudio();
  private readonly timers = new Map<TimerKind, ReturnType<typeof setTimeout>>();
  private selectedGrades: Grade[] = [];
  private unionExercises: readonly Exercise[] = [];
  /** 与 unionExercises 配套的年级集合（开始/重开/再来一局的记录来源）。 */
  private unionGrades: readonly Grade[] = [];
  private round: RunningRound | null = null;
  /** 正式记录存储；预览入口为 null（预览局不读写正式记录存储）。 */
  private readonly storage: GameStorage | null;
  /** 恢复提供中待用户决定的中断快照。 */
  private pendingRestore: InterruptedRoundV1 | null = null;
  /** 当前局次身份与逐题作答累计（含恢复续局，随快照保存）。 */
  private recordId: string | null = null;
  private roundGrades: readonly Grade[] = [];
  private roundResults: readonly RoundRecordQuestionV1[] = [];
  private roundContentVersion = '';
  /** 内容版本指纹按年级组合缓存（同一组合的 select 结果在一次会话内不变）。 */
  private readonly fingerprintCache = new Map<string, string>();
  private restartConfirmArmed = false;
  private restartConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  private clearConfirmArmed = false;
  private clearConfirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(content: GameContent, preview: boolean) {
    this.content = content;
    this.preview = preview;
    this.select = preview ? content.preview : content.select;
    this.storage = preview ? null : new GameStorage(createBrowserKeyValueStore());
    this.renderer = new NumberPuzzleRenderer($('board-canvas'), { onTileClick: index => this.onTileClick(index) });
    this.wireSelectScreen();
    this.wireAvailabilityScreen();
    this.wireGameAndResultScreens();
    this.wireSessionControls();
    this.wireStorageUi();
    if (preview) {
      $('preview-banner').hidden = false;
      $('result-preview-note').hidden = false;
      $('records-section').hidden = true; // 预览局不读写正式记录存储
    } else {
      this.applyStoredSettings();
      this.updateStorageNotice();
      this.renderRecords(this.storage!.loadFinishedRecords());
      this.prepareRestoreOffer();
    }
    this.showScreen('select');
  }

  private showScreen(id: ScreenId): void {
    for (const screen of ['error', 'select', 'availability', 'game', 'result'] as const) {
      $(`screen-${screen}`).hidden = screen !== id;
    }
  }

  private readSelectedGrades(): Grade[] {
    return ALL_GRADES.filter(grade => {
      const input = document.querySelector<HTMLInputElement>(`input[name="grade"][value="${grade}"]`);
      return input?.checked ?? false;
    });
  }

  private openGradesText(): string {
    const open = ALL_GRADES.filter(grade => this.select([grade]).length > 0);
    return open.length ? `${open.map(grade => GRADE_NAMES[grade]).join('、')}（数学）` : '暂无';
  }

  private wireSelectScreen(): void {
    $('select-open-hint').textContent = `可任意选择一个或多个年级。当前开放：${this.openGradesText()}。`;
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="grade"]')) {
      input.addEventListener('change', () => {
        this.refreshSelectScreen();
        this.saveSettings(); // M5：年级选择即改即存
      });
    }
    $('btn-to-availability').addEventListener('click', () => this.showAvailability());
    this.refreshSelectScreen();
  }

  private refreshSelectScreen(): void {
    this.selectedGrades = this.readSelectedGrades();
    $('select-empty-hint').hidden = this.selectedGrades.length > 0;
    ($('btn-to-availability') as HTMLButtonElement).disabled = this.selectedGrades.length === 0;
  }

  private showAvailability(): void {
    const report = describeAvailability(this.select, this.selectedGrades, { preview: this.preview });
    this.unionExercises = report.unionExercises;
    this.unionGrades = [...this.selectedGrades];
    const status = $('availability-status');
    status.textContent = report.statusText ?? report.rangeText;
    status.classList.toggle('status-warning', report.statusText !== null);
    ($('btn-start') as HTMLButtonElement).disabled = !report.startable;
    this.showScreen('availability');
  }

  private wireAvailabilityScreen(): void {
    $('btn-back-select').addEventListener('click', () => this.showScreen('select'));
    $('btn-start').addEventListener('click', () => this.startRound(this.unionExercises));
  }

  private wireGameAndResultScreens(): void {
    $('btn-again').addEventListener('click', () => this.startRound(this.unionExercises));
    $('btn-return').addEventListener('click', () => {
      this.teardownRound();
      this.showScreen('select');
      this.refreshSelectScreen();
    });
    // 游戏中途退出：放弃当前局。
    $('btn-game-return').addEventListener('click', () => {
      this.teardownRound();
      this.showScreen('select');
      this.refreshSelectScreen();
    });
  }

  /** 暂停/继续、暂停覆盖层、重新开始（两击确认）与音效开关。 */
  private wireSessionControls(): void {
    $('btn-pause').addEventListener('click', () => {
      if (this.session.isPaused()) this.resumeRound();
      else this.pauseRound();
    });
    $('btn-resume').addEventListener('click', () => this.resumeRound());
    $('btn-restart').addEventListener('click', () => this.onRestartClick());
    $('btn-sound').addEventListener('click', () => {
      this.audio.setMuted(!this.audio.isMuted());
      this.syncSoundButton();
      this.saveSettings(); // M5：音效设置即改即存
    });
    // 切到后台：停止推进需要玩家参与的状态（仅 running 时自动暂停；恢复前台
    // 保持暂停，由玩家显式「继续」）；恢复后视口可能变化，重新自适应画布尺寸。
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pauseRound();
      else this.fitBoard();
    });
    window.addEventListener('resize', () => this.fitBoard());
    window.addEventListener('orientationchange', () => this.fitBoard());
    window.visualViewport?.addEventListener('resize', () => this.fitBoard());
  }

  // -------------------------------------------------------------------
  // M5：本地记录与恢复（纯逻辑在 storage.ts，此处只做 DOM 接线）。
  // -------------------------------------------------------------------

  private syncSoundButton(): void {
    const muted = this.audio.isMuted();
    const button = $('btn-sound');
    button.textContent = muted ? '音效 关' : '音效 开';
    button.setAttribute('aria-pressed', muted ? 'false' : 'true');
  }

  /** 启动时应用已保存的设置（缺失或损坏按首次使用处理，保持默认）。 */
  private applyStoredSettings(): void {
    if (!this.storage) return;
    const settings = this.storage.loadSettings();
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="grade"]')) {
      input.checked = settings.selectedGrades.includes(Number(input.value) as Grade);
    }
    this.audio.setMuted(!settings.soundOn);
    this.syncSoundButton();
    this.refreshSelectScreen();
  }

  private saveSettings(): void {
    if (!this.storage) return;
    this.storage.saveSettings({
      schemaVersion: STORAGE_SCHEMA_VERSION,
      selectedGrades: this.selectedGrades,
      soundOn: !this.audio.isMuted(),
    });
    this.updateStorageNotice();
  }

  /** 存储不可用或写入失败时提示当前记录无法持久保存；预览入口不提示。 */
  private updateStorageNotice(): void {
    const notice = $('storage-notice');
    notice.hidden = !this.storage || this.storage.isEnabled();
  }

  /** 年级组合 → 内容版本指纹（缓存；指纹覆盖练习 ID、关联年级与任务）。 */
  private contentVersionFor(grades: readonly Grade[]): string {
    const key = grades.join(',');
    const cached = this.fingerprintCache.get(key);
    if (cached !== undefined) return cached;
    const version = contentFingerprint(this.select(grades).map(exercise => ({
      id: exercise.id,
      grade: this.content.gradeOf(exercise),
      task: exercise.task,
    })));
    this.fingerprintCache.set(key, version);
    return version;
  }

  /** 单局进行中把最小恢复状态写入中断快照；写入失败时提示无法持久保存。 */
  private persistSnapshot(): void {
    const round = this.round;
    if (!round || !this.storage || !this.recordId) return;
    const timers: StoredTimerV1[] = [];
    for (const kind of ['resolve', 'feedback'] as const) {
      const remaining = this.session.remainingMs(kind);
      if (remaining !== null) timers.push({ kind, remainingMs: remaining });
    }
    const saved = this.storage.saveInterrupted(buildInterruptedSnapshot({
      gameId: GAME_ID,
      recordId: this.recordId,
      grades: this.roundGrades,
      contentVersion: this.roundContentVersion,
      round: round.state,
      rngState: round.rng.snapshotState(),
      paused: this.session.isPaused(),
      timers,
      results: this.roundResults,
      savedAt: new Date().toISOString(),
    }));
    if (!saved) this.updateStorageNotice();
  }

  /** 结束局次写入成绩（recordId 去重）并清除中断快照，不重复记录已结束局次。 */
  private recordFinishedRound(state: RoundState): void {
    const storage = this.storage;
    if (!storage || !this.recordId) return;
    const record = buildFinishedRecord({
      gameId: GAME_ID,
      recordId: this.recordId,
      grades: this.roundGrades,
      contentVersion: this.roundContentVersion,
      state,
      results: this.roundResults,
      finishedAt: new Date().toISOString(),
    });
    const appended = storage.appendFinishedRecord(record);
    storage.clearInterrupted(); // 无论写入是否成功都清快照；极端情况下重载按同 recordId 去重兜底。
    if (appended) this.renderRecords(storage.loadFinishedRecords());
    this.updateStorageNotice();
  }

  private renderRecords(records: readonly FinishedRoundRecordV1[]): void {
    const list = $('records-list');
    list.textContent = '';
    const empty = $('records-empty');
    if (!records.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const recent = records.slice(-RECORDS_SHOWN).reverse();
    for (const record of recent) {
      const item = document.createElement('li');
      item.textContent = `${formatRecordTime(record.finishedAt)} · `
        + `${record.grades.map(grade => GRADE_NAMES[grade]).join('、')} · `
        + `总分 ${record.score} · 一次通过 ${record.firstTryCount}/${record.questions.length} · `
        + `答错 ${record.totalWrongCount} 次`;
      list.appendChild(item);
    }
    const older = records.length - recent.length;
    if (older > 0) {
      const item = document.createElement('li');
      item.className = 'records-more';
      item.textContent = `……更早的 ${older} 条记录已保存。`;
      list.appendChild(item);
    }
  }

  /** 启动时检查中断快照：可恢复则提供「继续上局」；内容版本不兼容则安全放弃并说明；损坏按首次使用处理。 */
  private prepareRestoreOffer(): void {
    const storage = this.storage;
    if (!storage) return;
    const loaded = storage.loadInterrupted();
    if (loaded.status === 'invalid') {
      console.warn(`Discarded a corrupted interrupted-round save: ${loaded.reason}`);
      return;
    }
    if (loaded.status !== 'ok') return;
    const snapshot = loaded.value;
    const check = checkRestore(snapshot, {
      gameId: GAME_ID,
      contentVersion: this.contentVersionFor(snapshot.grades),
    });
    if (check.status !== 'restorable') {
      // 内容版本不兼容（或游戏不匹配）：只放弃中断局次，历史成绩与设置保持不动。
      storage.clearInterrupted();
      const status = $('restore-status');
      status.textContent = '内容已更新，上次中断的局次无法继续，已安全放弃。历史成绩与设置不受影响。';
      status.classList.add('status-warning');
      status.hidden = false;
      return;
    }
    this.pendingRestore = snapshot;
    const round = snapshot.round;
    const answered = Math.min(round.questionIndex, round.questions.length);
    $('restore-offer-text').textContent =
      `检测到上次未完成的局次：已完成 ${answered}/${round.questions.length} 题，得分 ${round.score}。`;
    $('restore-offer').hidden = false;
  }

  /** 继续中断的局次：题目、分数、阶段与 RNG 状态与中断时刻一致，暂停态原样恢复。 */
  private restoreInterruptedRound(): void {
    const snapshot = this.pendingRestore;
    const storage = this.storage;
    this.pendingRestore = null;
    $('restore-offer').hidden = true;
    if (!snapshot || !storage) return;
    const exercises = this.select(snapshot.grades);
    if (!exercises.length) {
      // 双保险：内容版本一致时不会发生；发生则按不兼容处理，不清历史成绩。
      storage.clearInterrupted();
      return;
    }
    this.session.restoreRound({ paused: snapshot.paused, timers: snapshot.timers });
    this.round = { state: roundFromSnapshot(snapshot), rng: restoreSeededRng(snapshot.rngState) };
    this.recordId = snapshot.recordId;
    this.roundGrades = [...snapshot.grades];
    this.roundResults = snapshot.results.map(question => ({ ...question }));
    this.roundContentVersion = snapshot.contentVersion;
    this.unionExercises = exercises;
    this.unionGrades = [...snapshot.grades];
    this.showScreen('game');
    this.renderer.reset(this.round.state);
    this.fitBoard();
    this.renderer.start();
    this.syncPauseUi();
    // 运行中恢复：按保存的剩余时长重挂动画计时器；暂停恢复由「继续」时重挂。
    if (!snapshot.paused) {
      for (const timer of snapshot.timers) {
        this.timers.set(timer.kind, setTimeout(() => this.onTimerFired(timer.kind), timer.remainingMs));
      }
    }
  }

  private discardInterruptedRound(): void {
    this.pendingRestore = null;
    $('restore-offer').hidden = true;
    if (this.storage) this.storage.clearInterrupted();
  }

  /** 清除本地记录（两击确认）：回到首次使用状态，界面同步复位。 */
  private wireStorageUi(): void {
    $('btn-restore').addEventListener('click', () => this.restoreInterruptedRound());
    $('btn-discard-round').addEventListener('click', () => this.discardInterruptedRound());
    const clearButton = $('btn-clear-records');
    clearButton.addEventListener('click', () => {
      if (!this.clearConfirmArmed) {
        this.clearConfirmArmed = true;
        clearButton.textContent = '确认清除？';
        this.clearConfirmTimer = setTimeout(() => this.resetClearConfirm(), RESTART_CONFIRM_MS);
        return;
      }
      this.resetClearConfirm();
      this.performClearRecords();
    });
  }

  private resetClearConfirm(): void {
    if (this.clearConfirmTimer !== null) {
      clearTimeout(this.clearConfirmTimer);
      this.clearConfirmTimer = null;
    }
    this.clearConfirmArmed = false;
    $('btn-clear-records').textContent = '清除本地记录';
  }

  private performClearRecords(): void {
    if (!this.storage) return;
    this.storage.clearAll();
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="grade"]')) {
      input.checked = false;
    }
    this.audio.setMuted(false);
    this.syncSoundButton();
    this.refreshSelectScreen();
    this.renderRecords([]);
    this.discardInterruptedRound();
    const status = $('restore-status');
    status.textContent = '本地记录已清除。';
    status.classList.remove('status-warning');
    status.hidden = false;
  }

  /**
   * 计算画布可用空间并交给渲染层自适应：以视口高度减去画布上方的固定区域
   * （页眉、音效行、设备内边距）与下方操作区（按钮行、外边距、设备底部内边距）。
   * 这些区域高度都不依赖画布尺寸，测量结果确定，无 flex 循环。
   */
  private fitBoard(): void {
    if ($('screen-game').hidden) return;
    const app = document.querySelector<HTMLElement>('.app');
    const actions = document.querySelector<HTMLElement>('.game-actions');
    const wrap = $('board-wrap');
    if (!app || !actions) return;
    const appRect = app.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const bodyStyle = getComputedStyle(document.body);
    const appStyle = getComputedStyle(app);
    const bodyPadding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
    const topOffset = wrapRect.top - appRect.top;
    const bottomReserve = actions.offsetHeight + 16 /* .game-actions margin-top */
      + parseFloat(appStyle.paddingBottom) + parseFloat(appStyle.borderBottomWidth);
    const availH = window.innerHeight - bodyPadding - topOffset - bottomReserve;
    this.renderer.fitDisplay(wrap.clientWidth, availH);
  }

  private onRestartClick(): void {
    if (!this.restartConfirmArmed) {
      // 第一击只进入确认态：误触不会不可逆地弃掉当前局（docs/design.md「布局与输入」）。
      this.restartConfirmArmed = true;
      $('btn-restart').textContent = '确认重开？';
      this.restartConfirmTimer = setTimeout(() => this.resetRestartConfirm(), RESTART_CONFIRM_MS);
      return;
    }
    this.resetRestartConfirm();
    this.startRound(this.unionExercises);
  }

  private resetRestartConfirm(): void {
    if (this.restartConfirmTimer !== null) {
      clearTimeout(this.restartConfirmTimer);
      this.restartConfirmTimer = null;
    }
    this.restartConfirmArmed = false;
    $('btn-restart').textContent = '重新开始';
  }

  private syncPauseUi(): void {
    const paused = this.session.isPaused();
    $('pause-overlay').hidden = !paused;
    $('btn-pause').textContent = paused ? '继续' : '暂停';
  }

  private pauseRound(): void {
    if (this.session.state !== 'running') return; // 幂等：未开局/已暂停/已结束不动作
    const pending = this.session.pause();
    for (const timer of pending) {
      const id = this.timers.get(timer.kind);
      if (id !== undefined) {
        clearTimeout(id);
        this.timers.delete(timer.kind);
      }
    }
    this.renderer.pause();
    this.syncPauseUi();
    this.persistSnapshot(); // M5：暂停态与冻结剩余时长一并入快照，关页后可原样恢复
  }

  private resumeRound(): void {
    if (!this.session.isPaused()) return; // 幂等：仅暂停态可继续
    const pending = this.session.resume();
    for (const timer of pending) {
      this.timers.set(timer.kind, setTimeout(() => this.onTimerFired(timer.kind), timer.remainingMs));
    }
    this.renderer.resume();
    this.syncPauseUi();
    this.persistSnapshot();
  }

  private teardownRound(): void {
    for (const kind of ['resolve', 'feedback'] as const) {
      const id = this.timers.get(kind);
      if (id !== undefined) {
        clearTimeout(id);
        this.timers.delete(kind);
      }
    }
    if (this.session.state !== 'idle') {
      this.session.abandonRound(); // running/paused/finished → idle，保证「再来一局」可重新开局
    }
    this.round = null;
    this.recordId = null;
    this.roundResults = [];
    this.renderer.stop();
    this.resetRestartConfirm();
    this.syncPauseUi();
    // 中途放弃当前局：不写成绩，也不保留中断快照（重新开始/返回都走这里）。
    if (this.storage) this.storage.clearInterrupted();
  }

  private startRound(exercises: readonly Exercise[]): void {
    this.teardownRound();
    // 新一局取代未处理的恢复提供（快照将在下方被覆盖）。
    this.pendingRestore = null;
    $('restore-offer').hidden = true;
    const rng = createRuntimeRng();
    this.session.beginRound();
    this.round = { state: createRound({ exercises, gradeOf: this.content.gradeOf, rng }), rng };
    // M5：局次身份、年级来源与内容版本随快照/成绩保存；年级取本局题集对应的组合。
    this.recordId = createRecordId();
    this.roundGrades = this.unionGrades.length ? this.unionGrades : [...this.selectedGrades];
    this.roundResults = [];
    this.roundContentVersion = this.contentVersionFor(this.roundGrades);
    this.showScreen('game');
    this.renderer.reset(this.round.state);
    this.fitBoard();
    this.renderer.start();
    this.syncPauseUi();
    this.persistSnapshot(); // 开局即存：第一题作答前关闭页面也可恢复
  }

  private onTileClick(tileIndex: number): void {
    const round = this.round;
    if (!round || this.session.state !== 'running') return; // 暂停/结算期间不接受棋盘输入
    const exerciseId = round.state.questions[round.state.questionIndex]!.exerciseId;
    const wrongsBefore = round.state.currentWrongCount; // 本题作答前已答错次数
    const step = clickTile(round.state, tileIndex, round.rng);
    round.state = step.state;
    const outcome = step.outcome;
    if (outcome.type === 'correct') {
      // 计分与判定在点击瞬间完成；动画只是表现，结束后再切换题目或进入结算。
      this.roundResults = [...this.roundResults, {
        exerciseId,
        firstTry: outcome.firstTry,
        wrongCount: wrongsBefore,
        score: outcome.gainedScore,
      }];
      this.audio.play('correct');
      this.renderer.applyCorrect(outcome);
      const delay = outcome.fill ? ELIMINATE_MS + FILL_MS : ELIMINATE_MS;
      this.session.scheduleTimer('resolve', delay);
      this.timers.set('resolve', setTimeout(() => this.onTimerFired('resolve'), delay));
    } else if (outcome.type === 'wrong') {
      this.audio.play('wrong');
      this.renderer.applyWrong(outcome);
      this.session.scheduleTimer('feedback', WRONG_FEEDBACK_MS);
      this.timers.set('feedback', setTimeout(() => this.onTimerFired('feedback'), WRONG_FEEDBACK_MS));
    }
    this.persistSnapshot(); // 每次规则状态变化后更新快照：任意时刻刷新/关闭都可恢复
  }

  private onTimerFired(kind: TimerKind): void {
    this.timers.delete(kind);
    // 竞态兜底：暂停后仍到点的计时器不推进状态，resume() 会按冻结剩余时长重新调度。
    if (this.session.state === 'paused') return;
    this.session.clearTimer(kind);
    const current = this.round;
    if (!current) return;
    if (kind === 'resolve') {
      current.state = completeResolve(current.state);
      if (current.state.phase === 'finished') {
        this.session.finishRound();
        this.renderer.stop();
        this.showResult(current.state);
      } else {
        this.renderer.advanceQuestion(current.state);
        this.persistSnapshot();
      }
    } else {
      current.state = endWrongFeedback(current.state);
      this.persistSnapshot();
    }
  }

  private showResult(state: RoundState): void {
    this.round = null;
    this.audio.play('finish');
    $('result-score').textContent = `总分 ${state.score}`;
    $('result-first-try').textContent = `一次通过 ${state.firstTryCount}/${state.questions.length}`;
    $('result-wrong').textContent = `答错 ${state.totalWrongCount} 次`;
    this.recordFinishedRound(state); // M5：写入成绩并清除中断快照（预览局不写）
    this.showScreen('result');
  }
}

function boot(): void {
  const preview = new URLSearchParams(window.location.search).get('preview') === 'candidate';
  try {
    const content = loadGameContent();
    new NumberPuzzleApp(content, preview);
  } catch (error) {
    // createLearningCore 校验失败：不得进入可玩状态，按启动失败处理。
    console.error(error);
    const message = $('error-message');
    message.textContent = '内容数据校验失败，游戏无法启动。请检查练习与教材数据后重试。';
    for (const screen of ['select', 'availability', 'game', 'result'] as const) {
      $(`screen-${screen}`).hidden = true;
    }
    $('screen-error').hidden = false;
  }
}

boot();
