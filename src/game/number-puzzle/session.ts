// 宿主注入时钟；持久化绝对截止时间以防刷新重置，暂停保存剩余时间。
export interface TimedSession {
  paused: boolean;
  remainingMs: number;
  deadline: number | null;
  timerKind: 'question' | 'resolve' | null;
}
export class RoundSession {
  constructor(private readonly clock: () => number) {}
  remaining(timer: TimedSession): number {
    return timer.paused || timer.deadline === null ? timer.remainingMs : Math.max(0, timer.deadline - this.clock());
  }
  start(timer: TimedSession, kind: TimedSession['timerKind'], milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('计时长度无效');
    timer.timerKind = kind; timer.remainingMs = milliseconds;
    timer.deadline = !timer.paused && kind ? this.clock() + milliseconds : null;
  }
  pause(timer: TimedSession): void {
    timer.remainingMs = this.remaining(timer); timer.paused = true; timer.deadline = null;
  }
  resume(timer: TimedSession): void {
    timer.paused = false;
    timer.deadline = timer.timerKind ? this.clock() + timer.remainingMs : null;
  }
}
