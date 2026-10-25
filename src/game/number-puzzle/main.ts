// 数字消除 H5 入口：常规界面（年级选择、可用内容、结算）用 DOM，
// 游戏区用 Canvas 2D（render.ts）。完整流程：年级多选 → 可用内容提示 →
// 开始一局 → 作答与消除 → 结果反馈 → 再玩或返回（PLAN.md M3）。
// M4：游戏屏提供暂停/继续、重新开始（两击确认防误触）与返回；页面隐藏
// （visibilitychange）自动暂停且恢复前台不自动继续；动画计时器经 RoundSession
// 冻结换算，暂停期间到点的计时器在继续后按剩余时长补触发；音效为 WebAudio
// 合成、可关闭（audio.ts），只作反馈增强，不承载规则信息。
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
import { createRuntimeRng } from './random.js';
import { ALL_GRADES, GRADE_NAMES, describeAvailability, loadGameContent } from './content.js';
import type { GameContent } from './content.js';
import { NumberPuzzleRenderer } from './render.js';

type ScreenId = 'error' | 'select' | 'availability' | 'game' | 'result';

interface RunningRound {
  state: RoundState;
  rng: () => number;
}

const RESTART_CONFIRM_MS = 3000;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
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
  private round: RunningRound | null = null;
  private restartConfirmArmed = false;
  private restartConfirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(content: GameContent, preview: boolean) {
    this.content = content;
    this.preview = preview;
    this.select = preview ? content.preview : content.select;
    this.renderer = new NumberPuzzleRenderer($('board-canvas'), { onTileClick: index => this.onTileClick(index) });
    this.wireSelectScreen();
    this.wireAvailabilityScreen();
    this.wireGameAndResultScreens();
    this.wireSessionControls();
    if (preview) {
      $('preview-banner').hidden = false;
      $('result-preview-note').hidden = false;
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
      input.addEventListener('change', () => this.refreshSelectScreen());
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
      const muted = !this.audio.isMuted();
      this.audio.setMuted(muted);
      const button = $('btn-sound');
      button.textContent = muted ? '音效 关' : '音效 开';
      button.setAttribute('aria-pressed', muted ? 'false' : 'true');
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
  }

  private resumeRound(): void {
    if (!this.session.isPaused()) return; // 幂等：仅暂停态可继续
    const pending = this.session.resume();
    for (const timer of pending) {
      this.timers.set(timer.kind, setTimeout(() => this.onTimerFired(timer.kind), timer.remainingMs));
    }
    this.renderer.resume();
    this.syncPauseUi();
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
    this.renderer.stop();
    this.resetRestartConfirm();
    this.syncPauseUi();
  }

  private startRound(exercises: readonly Exercise[]): void {
    this.teardownRound();
    const rng = createRuntimeRng();
    this.session.beginRound();
    this.round = { state: createRound({ exercises, gradeOf: this.content.gradeOf, rng }), rng };
    this.showScreen('game');
    this.renderer.reset(this.round.state);
    this.fitBoard();
    this.renderer.start();
    this.syncPauseUi();
  }

  private onTileClick(tileIndex: number): void {
    const round = this.round;
    if (!round || this.session.state !== 'running') return; // 暂停/结算期间不接受棋盘输入
    const step = clickTile(round.state, tileIndex, round.rng);
    round.state = step.state;
    const outcome = step.outcome;
    if (outcome.type === 'correct') {
      // 计分与判定在点击瞬间完成；动画只是表现，结束后再切换题目或进入结算。
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
      }
    } else {
      current.state = endWrongFeedback(current.state);
    }
  }

  private showResult(state: RoundState): void {
    this.round = null;
    this.audio.play('finish');
    $('result-score').textContent = `总分 ${state.score}`;
    $('result-first-try').textContent = `一次通过 ${state.firstTryCount}/${state.questions.length}`;
    $('result-wrong').textContent = `答错 ${state.totalWrongCount} 次`;
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
