// 基础合成音效（WebAudio 振荡器，无音频文件、无新增依赖）：答对上行双音、
// 答错低音短鸣、结算琶音。音效只是反馈增强，核心结果同时有形状与文案冗余
// （render.ts 的 ✓/✗ 与文字横幅），关闭音效不损失任何规则信息。
// 播放全部容错：AudioContext 缺失、被策略挂起或创建失败都不影响游戏逻辑。
export type GameSound = 'correct' | 'wrong' | 'finish';

interface ToneSpec {
  readonly frequency: number;
  readonly startOffset: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly gain: number;
}

// 三种音效的音色区分：答对（三角波上行双音）、答错（锯齿波低音）、结算（方波琶音）。
const TONES: Readonly<Record<GameSound, readonly ToneSpec[]>> = {
  correct: [
    { frequency: 660, startOffset: 0, duration: 0.09, type: 'triangle', gain: 0.16 },
    { frequency: 990, startOffset: 0.09, duration: 0.12, type: 'triangle', gain: 0.16 },
  ],
  wrong: [
    { frequency: 170, startOffset: 0, duration: 0.18, type: 'sawtooth', gain: 0.14 },
  ],
  finish: [
    { frequency: 523, startOffset: 0, duration: 0.12, type: 'square', gain: 0.1 },
    { frequency: 659, startOffset: 0.12, duration: 0.12, type: 'square', gain: 0.1 },
    { frequency: 784, startOffset: 0.24, duration: 0.2, type: 'square', gain: 0.1 },
  ],
};

export class GameAudio {
  private context: AudioContext | null = null;
  private muted = false;

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  play(sound: GameSound): void {
    if (this.muted) return;
    const context = this.ensureContext();
    if (!context) return;
    try {
      const start = context.currentTime + 0.01;
      for (const tone of TONES[sound]) this.tone(context, start, tone);
    } catch {
      // 音频失败不游戏化处理：保持静默即可。
    }
  }

  /** 懒创建 AudioContext（首次播放总在用户手势之后的调用链上）；suspended 时尝试 resume。 */
  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.context) {
        const Ctor = window.AudioContext;
        if (!Ctor) return null;
        this.context = new Ctor();
      }
      if (this.context.state === 'suspended') void this.context.resume();
      return this.context;
    } catch {
      this.context = null;
      return null;
    }
  }

  private tone(context: AudioContext, start: number, spec: ToneSpec): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.frequency, start + spec.startOffset);
    gain.gain.setValueAtTime(0, start + spec.startOffset);
    gain.gain.linearRampToValueAtTime(spec.gain, start + spec.startOffset + 0.012);
    gain.gain.setValueAtTime(spec.gain, start + spec.startOffset + spec.duration - 0.03);
    gain.gain.linearRampToValueAtTime(0, start + spec.startOffset + spec.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + spec.startOffset);
    oscillator.stop(start + spec.startOffset + spec.duration + 0.02);
  }
}
