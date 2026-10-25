// 数字消除游戏区渲染（Canvas 2D）。只负责表现：题目区、点阵图示、棋盘与动画；
// 判题、计分、状态转移全部在 rules.ts（docs/architecture.md「需要保持的边界」：
// 不在动画代码重复一套判题）。动画期间输入是否忽略由规则层 phase 决定。
import { answerFor } from '../../learning/evaluation.js';
import type { MathTask } from '../../learning/models.js';
import {
  BOARD_TILES, BOARD_COLUMNS, ELIMINATE_MS, FILL_MS, WRONG_FEEDBACK_MS,
} from './rules.js';
import type { ClickOutcome, RoundState } from './rules.js';

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
const LOGICAL_W = 360;
const LOGICAL_H = 620;
const HUD_Y = 30;
const TASK_AREA = { x: 12, y: 46, w: 336, h: 162 };
const FEEDBACK_Y = 222;
const BOARD_X0 = 10;
const BOARD_Y0 = 238;
const TILE_W = 108;
const TILE_H = 88;
const TILE_GAP = 8;

const COLOR = {
  background: '#f6f2e7',
  panel: '#2f2a45',
  tileFill: '#fffdf7',
  tileStroke: '#2f2a45',
  wrongFill: '#fde3e0',
  wrongStroke: '#b3271e',
  wrongText: '#b3271e',
  hintStroke: '#a96f00',
  muted: '#6f6a86',
};

type Anim =
  | { type: 'resolve'; start: number; removedValue: number; fill: { index: number; value: number } | null }
  | { type: 'shake'; start: number };

export interface RendererCallbacks {
  onTileClick: (tileIndex: number) => void;
}

export class NumberPuzzleRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: RendererCallbacks;
  private slots: (number | null)[] = [];
  private questionIndex = 0;
  private totalQuestions = 0;
  private task: MathTask | null = null;
  private score = 0;
  private feedback: string | null = null;
  private hintActive = false;
  private hintAnswer: number | null = null;
  private readonly anims = new Map<number, Anim>();
  private pendingGuarantee: { index: number; to: number } | null = null;
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.callbacks = callbacks;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = LOGICAL_W * ratio;
    canvas.height = LOGICAL_H * ratio;
    ctx.scale(ratio, ratio);
    canvas.addEventListener('pointerdown', event => this.handlePointer(event));
  }

  /** 新一局开始：视图整体同步到规则状态，无动画。 */
  reset(state: RoundState): void {
    this.slots = [...state.board];
    this.questionIndex = state.questionIndex;
    this.totalQuestions = state.questions.length;
    this.syncQuestion(state);
    this.score = state.score;
    this.anims.clear();
    this.pendingGuarantee = null;
  }

  /** 答对：计分即时体现；消除 → 补块动画按规则常量播放。 */
  applyCorrect(outcome: Extract<ClickOutcome, { type: 'correct' }>): void {
    this.score = outcome.score;
    this.anims.set(outcome.tileIndex, {
      type: 'resolve',
      start: performance.now(),
      removedValue: outcome.removedValue,
      fill: outcome.fill,
    });
    this.pendingGuarantee = outcome.guarantee ? { index: outcome.guarantee.index, to: outcome.guarantee.to } : null;
  }

  /** 答错：被点块抖动变色，题目区提示「再想一想」；达到阈值时高亮答案块。 */
  applyWrong(outcome: Extract<ClickOutcome, { type: 'wrong' }>): void {
    this.anims.set(outcome.tileIndex, { type: 'shake', start: performance.now() });
    this.feedback = '再想一想';
    this.hintActive = outcome.hintActive;
    if (this.hintActive && this.task) this.hintAnswer = answerFor(this.task);
  }

  /**
   * 消除与补块动画结束后：切换题目区、应用保证规则替换（即时生效，无动画）。
   * 本方法由宿主在动画时长结束后调用，可能先于最后一帧 rAF 执行；必须先落补块值
   * 并完成补块动画，再应用替换，否则迟到的动画尾帧会用补块值覆盖替换结果，
   * 在替换位与补块位重合时把下一题答案从棋盘上抹掉（渲染竞态，形成无解局面）。
   */
  advanceQuestion(state: RoundState): void {
    this.questionIndex = Math.min(state.questionIndex, state.questions.length - 1);
    this.syncQuestion(state);
    for (const [index, anim] of this.anims) {
      if (anim.type === 'resolve') {
        if (anim.fill) this.slots[index] = anim.fill.value;
        this.anims.delete(index);
      }
    }
    if (this.pendingGuarantee) {
      this.slots[this.pendingGuarantee.index] = this.pendingGuarantee.to;
      this.pendingGuarantee = null;
    }
  }

  start(): void {
    if (this.rafId !== null) return;
    const frame = () => {
      this.rafId = requestAnimationFrame(frame);
      this.draw(performance.now());
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private syncQuestion(state: RoundState): void {
    const question = state.questions[this.questionIndex];
    this.task = question ? question.task : null;
    this.feedback = null;
    this.hintActive = state.currentWrongCount >= 3;
    this.hintAnswer = this.hintActive && this.task ? answerFor(this.task) : null;
  }

  private handlePointer(event: PointerEvent): void {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) * (LOGICAL_W / rect.width);
    const y = (event.clientY - rect.top) * (LOGICAL_H / rect.height);
    const col = Math.floor((x - BOARD_X0) / (TILE_W + TILE_GAP));
    const row = Math.floor((y - BOARD_Y0) / (TILE_H + TILE_GAP));
    if (col < 0 || col >= BOARD_COLUMNS || row < 0) return;
    const insideX = (x - BOARD_X0) % (TILE_W + TILE_GAP) <= TILE_W;
    const insideY = (y - BOARD_Y0) % (TILE_H + TILE_GAP) <= TILE_H;
    if (!insideX || !insideY) return;
    const index = row * BOARD_COLUMNS + col;
    if (index >= BOARD_TILES) return;
    this.callbacks.onTileClick(index);
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    this.drawHud();
    if (this.task) this.drawTask(this.task);
    this.drawFeedback();
    this.drawBoard(now);
  }

  private drawHud(): void {
    const ctx = this.ctx;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR.panel;
    ctx.font = `bold 17px ${FONT_STACK}`;
    ctx.fillText(`第 ${this.questionIndex + 1} / ${this.totalQuestions} 题`, 14, HUD_Y);
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR.muted;
    ctx.fillText(`得分 ${this.score}`, LOGICAL_W - 14, HUD_Y);
  }

  private fitFont(text: string, maxWidth: number, size: number, weight = 'bold'): string {
    const ctx = this.ctx;
    for (let s = size; s >= 12; s -= 2) {
      ctx.font = `${weight} ${s}px ${FONT_STACK}`;
      if (ctx.measureText(text).width <= maxWidth) return ctx.font;
    }
    return `bold 12px ${FONT_STACK}`;
  }

  private drawTask(task: MathTask): void {
    const ctx = this.ctx;
    const area = TASK_AREA;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.panel;
    if (task.kind === 'binary' && task.operator === '*') {
      // 乘法点阵：left 行 × right 列的点阵（等份分组模型），配文「一共有多少个？」，不显示算式。
      const rows = task.left;
      const cols = task.right;
      const spacing = 22;
      const radius = 7;
      const gridW = (cols - 1) * spacing + radius * 2;
      const gridH = (rows - 1) * spacing + radius * 2;
      const originX = area.x + (area.w - gridW) / 2 + radius;
      const originY = area.y + 8 + radius;
      ctx.fillStyle = COLOR.panel;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.beginPath();
          ctx.arc(originX + c * spacing, originY + r * spacing, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.font = `15px ${FONT_STACK}`;
      ctx.fillStyle = COLOR.muted;
      ctx.fillText('一共有多少个？', area.x + area.w / 2, originY + gridH / 2 + radius + 16);
      return;
    }
    if (task.kind === 'number') {
      // 「找出 {N}」，目标数字大号显示。
      const label = '找出';
      const digits = String(task.value);
      ctx.font = `bold 24px ${FONT_STACK}`;
      const labelWidth = ctx.measureText(`${label} `).width;
      ctx.font = `bold 46px ${FONT_STACK}`;
      const digitWidth = Math.min(ctx.measureText(digits).width, area.w - labelWidth);
      const total = labelWidth + digitWidth;
      const centerX = area.x + (area.w - total) / 2;
      const centerY = area.y + area.h / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLOR.panel;
      ctx.font = `bold 24px ${FONT_STACK}`;
      ctx.fillText(label, centerX, centerY);
      ctx.save();
      ctx.beginPath();
      ctx.rect(centerX + labelWidth - 2, area.y, area.w, area.h);
      ctx.clip();
      ctx.font = `bold 46px ${FONT_STACK}`;
      ctx.fillStyle = COLOR.panel;
      ctx.fillText(digits, centerX + labelWidth, centerY);
      ctx.restore();
      return;
    }
    const text = task.kind === 'binary'
      ? `${task.left} ${task.operator === '+' ? '+' : '−'} ${task.right} = ?`
      : `${task.start} ${task.steps.map(step => `${step.operator === '+' ? '+' : '−'} ${step.operand}`).join(' ')} = ?`;
    ctx.font = this.fitFont(text, area.w, task.kind === 'chain' ? 30 : 34);
    ctx.fillStyle = COLOR.panel;
    ctx.fillText(text, area.x + area.w / 2, area.y + area.h / 2);
  }

  private drawFeedback(): void {
    if (!this.feedback) return;
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.wrongText;
    ctx.font = `bold 16px ${FONT_STACK}`;
    ctx.fillText(this.feedback, LOGICAL_W / 2, FEEDBACK_Y);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawTile(
    x: number, y: number, value: number | null,
    options: { scale?: number; alpha?: number; dx?: number; dy?: number; wrong?: boolean; hintPhase?: number | undefined } = {},
  ): void {
    const ctx = this.ctx;
    const scale = options.scale ?? 1;
    const alpha = options.alpha ?? 1;
    if (value === null || scale <= 0 || alpha <= 0) return;
    const cx = x + TILE_W / 2 + (options.dx ?? 0);
    const cy = y + TILE_H / 2 + (options.dy ?? 0);
    const w = TILE_W * scale;
    const h = TILE_H * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    this.roundRect(cx - w / 2, cy - h / 2, w, h, 10 * scale);
    ctx.fillStyle = options.wrong ? COLOR.wrongFill : COLOR.tileFill;
    ctx.fill();
    ctx.lineWidth = 2;
    if (options.hintPhase !== undefined) {
      ctx.strokeStyle = options.wrong ? COLOR.wrongStroke : COLOR.hintStroke;
      ctx.globalAlpha = alpha * (0.35 + 0.65 * options.hintPhase);
      ctx.lineWidth = 3 + 2 * options.hintPhase;
      ctx.stroke();
    } else {
      ctx.strokeStyle = options.wrong ? COLOR.wrongStroke : COLOR.tileStroke;
      ctx.stroke();
    }
    const digits = String(value);
    const size = digits.length >= 3 ? 30 : digits.length === 2 ? 34 : 40;
    ctx.font = `bold ${Math.round(size * scale)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = options.wrong ? COLOR.wrongStroke : COLOR.panel;
    ctx.fillText(digits, cx, cy + 1);
    ctx.restore();
  }

  private drawBoard(now: number): void {
    const hintPhase = 0.5 + 0.5 * Math.sin(now / 450); // 缓慢呼吸
    for (let i = 0; i < BOARD_TILES; i++) {
      const col = i % BOARD_COLUMNS;
      const row = Math.floor(i / BOARD_COLUMNS);
      const x = BOARD_X0 + col * (TILE_W + TILE_GAP);
      const y = BOARD_Y0 + row * (TILE_H + TILE_GAP);
      const anim = this.anims.get(i);
      if (anim && anim.type === 'resolve') {
        const t = now - anim.start;
        if (t < ELIMINATE_MS) {
          const p = t / ELIMINATE_MS;
          this.drawTile(x, y, anim.removedValue, { scale: 1 - p, alpha: 1 - p });
        } else if (anim.fill && t < ELIMINATE_MS + FILL_MS) {
          const p = (t - ELIMINATE_MS) / FILL_MS;
          this.slots[i] = anim.fill.value;
          this.drawTile(x, y, anim.fill.value, { alpha: p, dy: -26 * (1 - p) });
        } else {
          this.slots[i] = anim.fill ? anim.fill.value : null;
          this.anims.delete(i);
          this.drawTile(x, y, this.slots[i] ?? null, { hintPhase: this.hintPhaseFor(i, hintPhase) });
        }
        continue;
      }
      if (anim && anim.type === 'shake') {
        const t = now - anim.start;
        if (t < WRONG_FEEDBACK_MS) {
          const dx = Math.sin((t / WRONG_FEEDBACK_MS) * Math.PI * 6) * 7 * (1 - t / WRONG_FEEDBACK_MS);
          this.drawTile(x, y, this.slots[i] ?? null, { dx, wrong: true });
          continue;
        }
        this.anims.delete(i);
      }
      this.drawTile(x, y, this.slots[i] ?? null, { hintPhase: this.hintPhaseFor(i, hintPhase) });
    }
  }

  private hintPhaseFor(index: number, hintPhase: number): number | undefined {
    if (!this.hintActive || this.hintAnswer === null) return undefined;
    return this.slots[index] === this.hintAnswer ? hintPhase : undefined;
  }
}
