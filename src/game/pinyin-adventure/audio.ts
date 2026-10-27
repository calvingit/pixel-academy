// 拼音冒险音频播放封装：听辨题可无限重听；播放失败/超时（Audio error 事件或 3 秒无 playing）
// 返回不可用状态，由 UI 呈现「当前无法播放声音」并允许返回或跳过，不假装完成听力训练。
// 音量/静音属系统行为不做检测，只做播放失败检测。接口注入式设计：规则层不触碰音频，
// 测试可注入桩实现。
export type AudioPlayResult =
  | 'played'       // 已开始播放
  | 'unavailable'  // 当前播放失败或 3 秒内未就绪（文件缺失/解码失败/被策略拒绝等）
  | 'stopped';     // 被后续播放或显式 stop 取代（非失败，UI 不提示）

export interface PinyinSpeaker {
  /** 播放指定音频；同一时刻只保留最新一次播放，被取代的调用如实回报 stopped。 */
  play(url: string): Promise<AudioPlayResult>;
  /** 停止当前播放（跳过/切题/暂停时调用），未决的 play 调用以 stopped 收尾。 */
  stop(): void;
}

/** 3 秒内未开始播放即判为不可用（WAV 均为本地预缓存资源，正常应 < 1 秒出声）。 */
const PLAY_TIMEOUT_MS = 3_000;

export function createPinyinSpeaker(): PinyinSpeaker {
  let current: HTMLAudioElement | null = null;
  let token = 0;
  /** 当前播放的收尾入口：stop() 或被新播放取代时调用，让未决的 await 如实收尾。 */
  let pendingFinish: (() => void) | null = null;

  return {
    stop(): void {
      token += 1;
      if (current) {
        current.pause();
        current = null;
      }
      const finish = pendingFinish;
      pendingFinish = null;
      finish?.();
    },
    play(url: string): Promise<AudioPlayResult> {
      token += 1;
      const my = token;
      if (current) current.pause();
      const superseded = pendingFinish;
      pendingFinish = null;
      superseded?.();
      return new Promise<AudioPlayResult>(resolve => {
        let audio: HTMLAudioElement;
        try {
          audio = new Audio(url);
        } catch {
          resolve('unavailable');
          return;
        }
        current = audio;
        let done = false;
        const cleanup = (): void => {
          clearTimeout(timer);
          audio.removeEventListener('playing', onPlaying);
          audio.removeEventListener('error', onError);
          if (pendingFinish === registeredFinish) pendingFinish = null;
          if (current === audio) current = null;
        };
        const finish = (result: AudioPlayResult): void => {
          if (done) return;
          done = true;
          cleanup();
          resolve(result);
        };
        // 事件收尾带 token 守卫：被取代后迟到的 error/playing 不误报为本播放的结果。
        const onPlaying = (): void => finish(my === token ? 'played' : 'stopped');
        const onError = (): void => finish(my === token ? 'unavailable' : 'stopped');
        const registeredFinish = (): void => finish('stopped');
        const timer = setTimeout(() => finish(my === token ? 'unavailable' : 'stopped'), PLAY_TIMEOUT_MS);
        pendingFinish = registeredFinish;
        audio.addEventListener('playing', onPlaying);
        audio.addEventListener('error', onError);
        // 尽量同步调用 play() 保留用户手势上下文；浏览器策略拒绝按不可用处理。
        audio.play().catch(() => finish(my === token ? 'unavailable' : 'stopped'));
      });
    },
  };
}
