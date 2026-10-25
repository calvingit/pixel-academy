// 单局会话状态机（纯逻辑）：运行 / 暂停切换与动画计时器的冻结换算。
// 不依赖 DOM、setTimeout 或 performance.now——宿主注入时钟并在 pause/resume
// 返回值上落地真实计时器；visibilitychange 自动暂停走 autoPause()。
// 状态语义（PLAN.md M4「页面切到后台时停止推进需要玩家参与的状态」）：
// 仅 running 可暂停；hidden 自动暂停只在 running 时生效，已暂停的局保持冻结，
// 恢复前台不自动继续，由玩家显式「继续」。
export type SessionStatus = 'idle' | 'running' | 'paused' | 'finished';

/** 宿主需要用 setTimeout 重新挂载的计时器；remainingMs 已按暂停时刻冻结（≥ 0）。 */
export interface PendingTimer {
  readonly kind: TimerKind;
  readonly remainingMs: number;
}

export type TimerKind = 'resolve' | 'feedback';

export class RoundSession {
  private status: SessionStatus = 'idle';
  /** running 期间的绝对截止时刻（clock() 毫秒）。 */
  private readonly deadlines = new Map<TimerKind, number>();
  /** paused 期间冻结的剩余时长。 */
  private readonly frozen = new Map<TimerKind, number>();

  constructor(private readonly clock: () => number) {}

  get state(): SessionStatus {
    return this.status;
  }

  isPaused(): boolean {
    return this.status === 'paused';
  }

  /** 开局：idle → running。 */
  beginRound(): void {
    if (this.status !== 'idle') {
      throw new Error(`beginRound requires idle status, got ${this.status}`);
    }
    this.status = 'running';
  }

  /** 结算：running | paused → finished（含暂停中打完最后一题的路径）。 */
  finishRound(): void {
    if (this.status !== 'running' && this.status !== 'paused') {
      throw new Error(`finishRound requires running or paused status, got ${this.status}`);
    }
    this.deadlines.clear();
    this.frozen.clear();
    this.status = 'finished';
  }

  /** 弃局（返回年级选择 / 重新开始 / 结算后再开）：running | paused | finished → idle。 */
  abandonRound(): void {
    if (this.status !== 'running' && this.status !== 'paused' && this.status !== 'finished') {
      throw new Error(`abandonRound requires running, paused or finished status, got ${this.status}`);
    }
    this.deadlines.clear();
    this.frozen.clear();
    this.status = 'idle';
  }

  /** 登记一个动画计时器；仅 running 时允许，提前触发属宿主接线错误。 */
  scheduleTimer(kind: TimerKind, durationMs: number): void {
    if (this.status !== 'running') {
      throw new Error(`scheduleTimer requires running status, got ${this.status}`);
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError(`Invalid timer duration: ${String(durationMs)}`);
    }
    this.deadlines.set(kind, this.clock() + durationMs);
  }

  clearTimer(kind: TimerKind): void {
    this.deadlines.delete(kind);
    this.frozen.delete(kind);
  }

  /** 当前剩余时长；未登记返回 null。running 按时钟推算，paused 读冻结值。 */
  remainingMs(kind: TimerKind): number | null {
    const deadline = this.deadlines.get(kind);
    if (deadline !== undefined) return Math.max(0, deadline - this.clock());
    const frozenRemaining = this.frozen.get(kind);
    return frozenRemaining === undefined ? null : frozenRemaining;
  }

  /**
   * 暂停：running → paused，返回需要 clearTimeout 的计时器（剩余时长冻结）。
   * 非 running（含已暂停、已结束、未开局）为幂等空操作，返回空数组。
   */
  pause(): readonly PendingTimer[] {
    if (this.status !== 'running') return [];
    const pending: PendingTimer[] = [];
    for (const [kind, deadline] of this.deadlines) {
      const remaining = Math.max(0, deadline - this.clock());
      this.frozen.set(kind, remaining);
      pending.push({ kind, remainingMs: remaining });
    }
    this.deadlines.clear();
    this.status = 'paused';
    return pending;
  }

  /**
   * 继续：paused → running，返回需要重新 setTimeout 的计时器（剩余时长不变）。
   * 非 paused 为幂等空操作，返回空数组。
   */
  resume(): readonly PendingTimer[] {
    if (this.status !== 'paused') return [];
    const pending: PendingTimer[] = [];
    for (const [kind, remaining] of this.frozen) {
      this.deadlines.set(kind, this.clock() + remaining);
      pending.push({ kind, remainingMs: remaining });
    }
    this.frozen.clear();
    this.status = 'running';
    return pending;
  }

  /** 页面隐藏（visibilitychange）时的自动暂停：仅 running 时生效并返回 true。 */
  autoPause(): boolean {
    if (this.status !== 'running') return false;
    this.pause();
    return true;
  }
}
