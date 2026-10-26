// 数字消除游戏区渲染（Canvas 2D）。只负责表现：题目区、点阵图示、棋盘与动画；
// 判题、计分、状态转移全部在 rules.ts（docs/architecture.md「需要保持的边界」：
// 不在动画代码重复一套判题）。动画期间输入是否忽略由规则层 phase 决定。
// choice 题卡由 main.ts 的原生控件呈现，Canvas 保留整数棋盘与点阵。
// M4：答对/答错反馈带形状与文案冗余（✓/✗ + 文字，不依赖颜色或声音单独传达）；
// 暂停冻结动画时间轴；题卡和棋盘按可用空间重排，横屏采用四列。
import { drawNumberGarden } from './garden.js';
import { answerFor } from '../../learning/evaluation.js';
import type { MathTask } from '../../learning/models.js';
import {
  BOARD_TILES, ELIMINATE_MS, FILL_MS,
} from './rules.js';
import type { ClickOutcome, RoundState } from './rules.js';

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
export function boardLayout(availW: number, availH: number) {
  const landscape = availW / availH > 1.35 && availH < 420;
  const width = landscape ? 620 : 360;
  const scale = Math.min(availW / width, 1);
  const height = Math.min(620, availH / scale);
  const columns = landscape ? 4 : 3;
  const task = landscape
    ? { x: 12, y: 46, w: 210, h: height - 78 }
    : { x: 12, y: 46, w: 336, h: Math.min(162, height * .23) };
  const boardX = landscape ? 238 : 10;
  const boardY = landscape ? 10 : task.y + task.h + 30;
  const tileW = landscape ? 86 : 108;
  const tileH = (height - boardY - 10 - (BOARD_TILES / columns - 1) * 8) / (BOARD_TILES / columns);
  return { width, height, scale, columns, task, boardX, boardY, tileW, tileH };
}

const COLOR = {
  panel: '#193b38',
  card: '#fffef8',
  cardStroke: '#d2ddc7',
  tileFill: '#fffef8',
  tileStroke: '#b8cbb0',
  tileShadow: '#a8be9b',
  success: '#1c7c43',
  hintStroke: '#795016',
  muted: '#526b60',
};

type Anim = { start: number; removedValue: number; fill: { index: number; value: number } | null };

export interface RendererCallbacks {
  onTileClick: (tileIndex: number) => void;
}

export class NumberPuzzleRenderer {
  private skin: 'garden' | 'autumn' | 'snow' = 'garden';
  private focusedTile = 0;
  private layout = boardLayout(360, 620);
  setSkin(skin: 'garden' | 'autumn' | 'snow'): void { this.skin = skin; }
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
  private rafId: number | null = null;
  private pausedAt: number | null = null;
  private lastDisplaySize: { width: number; height: number } | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.callbacks = callbacks;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = this.layout.width * ratio;
    canvas.height = this.layout.height * ratio;
    ctx.setTransform(canvas.width / this.layout.width, 0, 0, canvas.height / this.layout.height, 0, 0);
    canvas.addEventListener('pointerdown', event => this.handlePointer(event));
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-describedby', 'game-task');
    canvas.addEventListener('keydown', event => {
      const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this.layout.columns, ArrowDown: this.layout.columns };
      if (event.key in move) {
        event.preventDefault(); this.focusedTile = (this.focusedTile + move[event.key]! + BOARD_TILES) % BOARD_TILES;
        this.updateAccessibleLabel();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); this.callbacks.onTileClick(this.focusedTile);
      }
    });
  }

  /** 新一局开始：视图整体同步到规则状态，无动画；同时清掉上一局遗留的暂停冻结。 */
  reset(state: RoundState): void {
    this.slots = [...state.board];
    this.questionIndex = state.questionIndex;
    this.totalQuestions = state.questions.length;
    this.syncQuestion(state);
    this.score = state.score;
    this.anims.clear();
    this.pausedAt = null;
    this.updateAccessibleLabel();
  }

  private updateAccessibleLabel(): void {
    this.canvas.setAttribute('aria-label', `数字棋盘，按行排列：${this.slots.map(n => n ?? '空位').join('、')}。当前选择 ${this.slots[this.focusedTile] ?? '空位'}`);
  }

  /** 答对：计分即时体现；消除 → 补块动画按规则常量播放；反馈条带 ✓ 与文案。 */
  applyCorrect(outcome: Extract<ClickOutcome, { type: 'correct' }>): void {
    this.score = outcome.score;
    if (outcome.tileIndex === null || outcome.removedValue === null) return;
    this.anims.set(outcome.tileIndex, {
      start: performance.now(),
      removedValue: outcome.removedValue,
      fill: outcome.fill,
    });
    this.feedback = `答对了 +${outcome.gainedScore}`;
  }

  /**
   * 暂停：冻结动画时间轴并停止渲染循环。动画起点整体后移由 resume() 完成，
   * 保证消除动画从冻结处继续，而宿主计时器（session）冻结同一时刻的剩余时长。
   */
  pause(): void {
    if (this.pausedAt === null) {
      this.pausedAt = performance.now();
      this.stop();
    }
  }

  /** 继续：按暂停时长平移动画起点并恢复渲染循环。 */
  resume(): void {
    if (this.pausedAt === null) return;
    const delta = performance.now() - this.pausedAt;
    this.pausedAt = null;
    for (const anim of this.anims.values()) anim.start += delta;
    this.start();
  }

  /** 用真实可用空间重排题卡和棋盘，横屏为四列；命中与键盘共用同一几何。 */
  fitDisplay(availW: number, availH: number): void {
    if (availW <= 0 || availH <= 0) return;
    this.layout = boardLayout(availW, availH);
    const width = Math.round(this.layout.width * this.layout.scale);
    const height = Math.round(this.layout.height * this.layout.scale);
    if (this.lastDisplaySize && this.lastDisplaySize.width === width && this.lastDisplaySize.height === height) return;
    this.lastDisplaySize = { width, height };
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(this.canvas.width / this.layout.width, 0, 0, this.canvas.height / this.layout.height, 0, 0);
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
    this.hintActive = state.hintUsed;
    this.hintAnswer = this.hintActive && this.task && this.task.kind !== 'choice' ? answerFor(this.task) : null;
  }

  private handlePointer(event: PointerEvent): void {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) * (this.layout.width / rect.width);
    const y = (event.clientY - rect.top) * (this.layout.height / rect.height);
    const col = Math.floor((x - this.layout.boardX) / (this.layout.tileW + 8));
    const row = Math.floor((y - this.layout.boardY) / (this.layout.tileH + 8));
    if (col < 0 || col >= this.layout.columns || row < 0) return;
    const insideX = (x - this.layout.boardX) % (this.layout.tileW + 8) <= this.layout.tileW;
    const insideY = (y - this.layout.boardY) % (this.layout.tileH + 8) <= this.layout.tileH;
    if (!insideX || !insideY) return;
    const index = row * this.layout.columns + col;
    if (index >= BOARD_TILES) return;
    this.callbacks.onTileClick(index);
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.layout.width, this.layout.height);
    ctx.save();
    ctx.scale(this.layout.width / 360, this.layout.height / 620);
    drawNumberGarden(ctx, this.skin);
    ctx.restore();
    this.drawHud();
    if (this.task) this.drawTask(this.task);
    this.drawFeedback();
    this.drawBoard(now);
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const width = this.layout.columns === 4 ? 234 : this.layout.width;
    ctx.fillStyle = COLOR.card;
    this.roundRect(10, 10, width - 20, 30, 10); ctx.fill();
    ctx.fillStyle = '#d3dfc8';
    ctx.fillRect(16, 42, width - 32, 3);
    ctx.fillStyle = '#527b51';
    ctx.fillRect(16, 42, (width - 32) * this.questionIndex / Math.max(1, this.totalQuestions), 3);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR.panel;
    ctx.font = `bold 14px ${FONT_STACK}`;
    ctx.fillText(`第 ${this.questionIndex + 1} / ${this.totalQuestions} 题`, 16, 26);
    ctx.textAlign = 'right';
    ctx.fillText(`得分 ${this.score}`, width - 16, 26);
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
    if (task.kind === 'choice') return;
    const ctx = this.ctx;
    const area = this.layout.task;
    // 题目卡片：与棋盘块同族的描边卡片，划出稳定的题目区。
    ctx.fillStyle = COLOR.card;
    ctx.strokeStyle = COLOR.cardStroke;
    ctx.lineWidth = 1.5;
    this.roundRect(area.x, area.y, area.w, area.h, 18);
    ctx.fill();
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.panel;
    if (task.kind === 'binary' && task.operator === '*') {
      // 乘法点阵：left 行 × right 列的点阵（等份分组模型），配文「一共有多少个？」，不显示算式。
      // 点阵与配文整块在卡片内垂直居中，配文始终在最后一行点的下方（5 行点阵不与文字重叠）。
      const rows = task.left;
      const cols = task.right;
      const spacing = Math.min(22, (area.h - 34) / rows);
      const radius = Math.min(7, spacing * .32);
      const gridH = (rows - 1) * spacing + radius * 2;
      const topGap = Math.max((area.h - gridH - 23) / 2, 4);
      const originX = area.x + (area.w - ((cols - 1) * spacing + radius * 2)) / 2 + radius;
      const originY = area.y + topGap + radius;
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
      ctx.fillText('一共有多少个？', area.x + area.w / 2, originY + (rows - 1) * spacing + radius + 18);
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

  /** 答对反馈条：✓ 形状 + 文案双通道（docs/design.md「布局与输入」，不只靠颜色或声音）。 */
  private drawFeedback(): void {
    if (!this.feedback) {
      this.ctx.fillStyle = COLOR.muted;
      this.ctx.font = `12px ${FONT_STACK}`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('点选与答案相同的数字', this.layout.task.x + this.layout.task.w / 2, (this.layout.task.y + this.layout.task.h + 16));
      return;
    }
    const ctx = this.ctx;
    const text = this.feedback;
    const color = COLOR.success;
    ctx.fillStyle = COLOR.card;
    ctx.fillRect(this.layout.task.x, (this.layout.task.y + this.layout.task.h + 16) - 12, this.layout.task.w, 25);
    ctx.font = `bold 16px ${FONT_STACK}`;
    const textWidth = ctx.measureText(text).width;
    const glyphBox = 18;
    const gap = 8;
    const total = glyphBox + gap + textWidth;
    const left = this.layout.task.x + this.layout.task.w / 2 - total / 2;
    const cy = (this.layout.task.y + this.layout.task.h + 16);
    const gcx = left + glyphBox / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gcx - 6, cy + 1);
    ctx.lineTo(gcx - 1.5, cy + 6);
    ctx.lineTo(gcx + 7, cy - 6);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 16px ${FONT_STACK}`;
    ctx.fillText(text, left + glyphBox + gap, cy);
    ctx.restore();
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
    options: { scale?: number; alpha?: number; dy?: number; hintPhase?: number | undefined } = {},
  ): void {
    const ctx = this.ctx;
    const scale = options.scale ?? 1;
    const alpha = options.alpha ?? 1;
    if (value === null || scale <= 0 || alpha <= 0) return;
    const cx = x + this.layout.tileW / 2;
    const cy = y + this.layout.tileH / 2 + (options.dy ?? 0);
    const w = this.layout.tileW * scale;
    const h = this.layout.tileH * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 浅色实体数字块，投影随消除动画同步缩放。
    this.roundRect(cx - w / 2 + 3 * scale, cy - h / 2 + 3 * scale, w, h, 16 * scale);
    ctx.fillStyle = COLOR.tileShadow;
    ctx.fill();
    this.roundRect(cx - w / 2, cy - h / 2, w, h, 16 * scale);
    ctx.fillStyle = COLOR.tileFill;
    ctx.fill();
    ctx.fillStyle = '#e4ecd9';
    this.roundRect(cx - 12 * scale, cy + h / 2 - 12 * scale, 24 * scale, 3 * scale, 1.5 * scale);
    ctx.fill();
    this.roundRect(cx - w / 2, cy - h / 2, w, h, 16 * scale);
    ctx.lineWidth = 1.5;
    if (options.hintPhase !== undefined) {
      ctx.strokeStyle = COLOR.hintStroke;
      ctx.globalAlpha = alpha * (0.35 + 0.65 * options.hintPhase);
      ctx.lineWidth = 3 + 2 * options.hintPhase;
      ctx.stroke();
    } else {
      ctx.strokeStyle = COLOR.tileStroke;
      ctx.stroke();
    }
    const digits = String(value);
    const size = digits.length >= 3 ? 30 : digits.length === 2 ? 34 : 40;
    ctx.font = `bold ${Math.round(size * scale)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.panel;
    ctx.fillText(digits, cx, cy + 1);
    ctx.restore();
  }

  private drawBoard(now: number): void {
    const hintPhase = 0.5 + 0.5 * Math.sin(now / 450); // 缓慢呼吸
    for (let i = 0; i < BOARD_TILES; i++) {
      const col = i % this.layout.columns;
      const row = Math.floor(i / this.layout.columns);
      const x = this.layout.boardX + col * (this.layout.tileW + 8);
      const y = this.layout.boardY + row * (this.layout.tileH + 8);
      const anim = this.anims.get(i);
      if (anim) {
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
      this.drawTile(x, y, this.slots[i] ?? null, { hintPhase: this.hintPhaseFor(i, hintPhase) });
    }
    if (this.canvas === document.activeElement) {
      const x = this.layout.boardX + this.focusedTile % this.layout.columns * (this.layout.tileW + 8);
      const y = this.layout.boardY + Math.floor(this.focusedTile / this.layout.columns) * (this.layout.tileH + 8);
      this.ctx.save(); this.ctx.strokeStyle = '#193b38'; this.ctx.lineWidth = 2; this.ctx.setLineDash([4, 4]);
      this.ctx.strokeRect(x + 6, y + 6, this.layout.tileW - 12, this.layout.tileH - 12); this.ctx.restore();
    }
  }

  private hintPhaseFor(index: number, hintPhase: number): number | undefined {
    if (!this.hintActive || this.hintAnswer === null) return undefined;
    return this.slots[index] === this.hintAnswer ? hintPhase : undefined;
  }
}
