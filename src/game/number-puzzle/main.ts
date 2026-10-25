// 数字消除 H5 原型入口：常规界面（年级选择、可用内容、结算）用 DOM，
// 游戏区用 Canvas 2D（render.ts）。完整流程：年级多选 → 可用内容提示 →
// 开始一局 → 作答与消除 → 结果反馈 → 再玩或返回（PLAN.md M3）。
// 正式入口为默认 URL，只走 selectExercises；?preview=candidate 为显式隔离的
// 候选预览入口（previewExercises，草稿计入可用数），两者不共享局次状态。
import type { Exercise, Grade } from '../../learning/models.js';
import {
  clickTile, completeResolve, createRound, endWrongFeedback,
  ELIMINATE_MS, FILL_MS, WRONG_FEEDBACK_MS,
} from './rules.js';
import type { RoundState } from './rules.js';
import { createRuntimeRng } from './random.js';
import { ALL_GRADES, GRADE_NAMES, describeAvailability, loadGameContent } from './content.js';
import type { GameContent } from './content.js';
import { NumberPuzzleRenderer } from './render.js';

type ScreenId = 'error' | 'select' | 'availability' | 'game' | 'result';

interface RunningRound {
  state: RoundState;
  rng: () => number;
}

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
  private selectedGrades: Grade[] = [];
  private unionExercises: readonly Exercise[] = [];
  private round: RunningRound | null = null;
  private resolveTimer: ReturnType<typeof setTimeout> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(content: GameContent, preview: boolean) {
    this.content = content;
    this.preview = preview;
    this.select = preview ? content.preview : content.select;
    this.renderer = new NumberPuzzleRenderer($('board-canvas'), { onTileClick: index => this.onTileClick(index) });
    this.wireSelectScreen();
    this.wireAvailabilityScreen();
    this.wireGameAndResultScreens();
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
    // 游戏中途退出：放弃当前局（M3 原型刷新即弃局，M4 提供完整暂停与恢复）。
    $('btn-game-return').addEventListener('click', () => {
      this.teardownRound();
      this.showScreen('select');
      this.refreshSelectScreen();
    });
  }

  private teardownRound(): void {
    if (this.resolveTimer !== null) clearTimeout(this.resolveTimer);
    if (this.feedbackTimer !== null) clearTimeout(this.feedbackTimer);
    this.resolveTimer = null;
    this.feedbackTimer = null;
    this.round = null;
    this.renderer.stop();
  }

  private startRound(exercises: readonly Exercise[]): void {
    this.teardownRound();
    const rng = createRuntimeRng();
    this.round = { state: createRound({ exercises, gradeOf: this.content.gradeOf, rng }), rng };
    this.renderer.reset(this.round.state);
    this.showScreen('game');
    this.renderer.start();
  }

  private onTileClick(tileIndex: number): void {
    const round = this.round;
    if (!round) return;
    const step = clickTile(round.state, tileIndex, round.rng);
    round.state = step.state;
    const outcome = step.outcome;
    if (outcome.type === 'correct') {
      // 计分与判定在点击瞬间完成；动画只是表现，结束后再切换题目或进入结算。
      this.renderer.applyCorrect(outcome);
      const delay = outcome.fill ? ELIMINATE_MS + FILL_MS : ELIMINATE_MS;
      this.resolveTimer = setTimeout(() => {
        this.resolveTimer = null;
        const current = this.round;
        if (!current) return;
        current.state = completeResolve(current.state);
        if (current.state.phase === 'finished') {
          this.renderer.stop();
          this.showResult(current.state);
        } else {
          this.renderer.advanceQuestion(current.state);
        }
      }, delay);
    } else if (outcome.type === 'wrong') {
      this.renderer.applyWrong(outcome);
      this.feedbackTimer = setTimeout(() => {
        this.feedbackTimer = null;
        const current = this.round;
        if (!current) return;
        current.state = endWrongFeedback(current.state);
      }, WRONG_FEEDBACK_MS);
    }
  }

  private showResult(state: RoundState): void {
    this.round = null;
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
