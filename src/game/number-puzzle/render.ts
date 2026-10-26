// 数字消除游戏区渲染（Canvas 2D）。只负责表现：题目区、点阵图示、棋盘与动画；
// 判题、计分、状态转移全部在 rules.ts（docs/architecture.md「需要保持的边界」：
// 不在动画代码重复一套判题）。动画期间输入是否忽略由规则层 phase 决定。
// M4：答对/答错反馈带形状与文案冗余（✓/✗ + 文字，不依赖颜色或声音单独传达）；
// 暂停冻结动画时间轴；显示尺寸按容器宽度与视口高度自适应（保持 360:620 逻辑比例）。
import { drawNumberGarden } from './garden.js';
import { answerFor } from '../../learning/evaluation.js';
import type { MathTask } from '../../learning/models.js';
import {
  BOARD_TILES, BOARD_COLUMNS, ELIMINATE_MS, FILL_MS,
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
// 显示缩放边界：低于 0.7 时 HUD/题面字号低于可读下限，宁可让页面纵向滚动；
// 高于 1 会放大 360 逻辑宽的位图导致发虚，桌面不做放大。
const MIN_DISPLAY_SCALE = 0.7;
const MAX_DISPLAY_SCALE = 1;

const COLOR = {
  panel: '#193b38',
  card: '#fffbe5',
  cardStroke: '#71522e',
  tileFill: '#a9e5ff',
  tileStroke: '#193b38',
  tileShadow: '#254342',
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
    canvas.width = LOGICAL_W * ratio;
    canvas.height = LOGICAL_H * ratio;
    ctx.setTransform(canvas.width / LOGICAL_W, 0, 0, canvas.height / LOGICAL_H, 0, 0);
    canvas.addEventListener('pointerdown', event => this.handlePointer(event));
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-describedby', 'game-task');
    canvas.addEventListener('keydown', event => {
      const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -BOARD_COLUMNS, ArrowDown: BOARD_COLUMNS };
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

  /**
   * 显示尺寸自适应：保持 360:620 逻辑比例，取「可用宽度」与「可用高度」中较小
   * 的缩放（下限 MIN_DISPLAY_SCALE 保证可读与触摸目标，超出时页面纵向滚动而非
   * 压缩文字；上限 1 避免位图放大发虚）。可用空间由宿主测量后传入（游戏屏可见
   * 时调用；隐藏中传 0 时跳过）。
   */
  fitDisplay(availW: number, availH: number): void {
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / LOGICAL_W, availH / LOGICAL_H, MAX_DISPLAY_SCALE);
    const displayScale = Math.max(scale, MIN_DISPLAY_SCALE);
    const width = Math.round(LOGICAL_W * displayScale);
    const height = Math.round(LOGICAL_H * displayScale);
    if (this.lastDisplaySize && this.lastDisplaySize.width === width && this.lastDisplaySize.height === height) return;
    this.lastDisplaySize = { width, height };
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(this.canvas.width / LOGICAL_W, 0, 0, this.canvas.height / LOGICAL_H, 0, 0);
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
    drawNumberGarden(ctx, this.skin);
    this.drawHud();
    if (this.task) this.drawTask(this.task);
    this.drawFeedback();
    this.drawBoard(now);
  }

  private drawHud(): void {
    const ctx = this.ctx;
    ctx.fillStyle = COLOR.card;
    ctx.fillRect(8, 12, 140, 34);
    ctx.fillRect(228, 12, 124, 34);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLOR.panel;
    ctx.font = `bold 17px ${FONT_STACK}`;
    ctx.fillText(`第 ${this.questionIndex + 1} / ${this.totalQuestions} 题`, 14, HUD_Y);
    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR.panel;
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
    // 题目卡片：与棋盘块同族的描边卡片，划出稳定的题目区。
    ctx.fillStyle = COLOR.card;
    ctx.strokeStyle = COLOR.cardStroke;
    ctx.lineWidth = 3;
    this.roundRect(area.x, area.y, area.w, area.h, 10);
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
      const spacing = 22;
      const radius = 7;
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
    if (!this.feedback) return;
    const ctx = this.ctx;
    const text = this.feedback;
    const color = COLOR.success;
    ctx.fillStyle = COLOR.card;
    ctx.fillRect(12, FEEDBACK_Y - 12, 336, 25);
    ctx.font = `bold 16px ${FONT_STACK}`;
    const textWidth = ctx.measureText(text).width;
    const glyphBox = 18;
    const gap = 8;
    const total = glyphBox + gap + textWidth;
    const left = LOGICAL_W / 2 - total / 2;
    const cy = FEEDBACK_Y;
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
    const cx = x + TILE_W / 2;
    const cy = y + TILE_H / 2 + (options.dy ?? 0);
    const w = TILE_W * scale;
    const h = TILE_H * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 复古掌机块面：硬投影（无模糊）+ 厚描边，投影随消除动画同步缩放。
    this.roundRect(cx - w / 2 + 3 * scale, cy - h / 2 + 3 * scale, w, h, 10 * scale);
    ctx.fillStyle = COLOR.tileShadow;
    ctx.fill();
    this.roundRect(cx - w / 2, cy - h / 2, w, h, 10 * scale);
    ctx.fillStyle = COLOR.tileFill;
    ctx.fill();
    {
      ctx.fillStyle = '#d5f3ff';
      ctx.fillRect(cx - w / 2 + 6 * scale, cy - h / 2 + 6 * scale, w - 12 * scale, 4 * scale);
      ctx.fillStyle = '#69b9d3';
      ctx.fillRect(cx - w / 2 + 6 * scale, cy + h / 2 - 10 * scale, w - 12 * scale, 4 * scale);
    }
    ctx.lineWidth = 3;
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
      const col = i % BOARD_COLUMNS;
      const row = Math.floor(i / BOARD_COLUMNS);
      const x = BOARD_X0 + col * (TILE_W + TILE_GAP);
      const y = BOARD_Y0 + row * (TILE_H + TILE_GAP);
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
      const x = BOARD_X0 + this.focusedTile % BOARD_COLUMNS * (TILE_W + TILE_GAP);
      const y = BOARD_Y0 + Math.floor(this.focusedTile / BOARD_COLUMNS) * (TILE_H + TILE_GAP);
      this.ctx.save(); this.ctx.strokeStyle = '#193b38'; this.ctx.lineWidth = 2; this.ctx.setLineDash([4, 4]);
      this.ctx.strokeRect(x + 6, y + 6, TILE_W - 12, TILE_H - 12); this.ctx.restore();
    }
  }

  private hintPhaseFor(index: number, hintPhase: number): number | undefined {
    if (!this.hintActive || this.hintAnswer === null) return undefined;
    return this.slots[index] === this.hintAnswer ? hintPhase : undefined;
  }
}
