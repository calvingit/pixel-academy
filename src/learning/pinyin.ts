// 拼音字母任务的校验与判题：结构约束 + 按字母身份判题，不依赖界面、显示顺序或存储。
// 题意正确性由内容审核记录支撑（docs/content-review-pinyin.md），这里保证：
// 字母形态合法（领域词表内）、候选可达且唯一、答案与目标同身份；
// 听辨题在结构层面禁止题面泄露答案。
// 拼音字母表（23 声母 + 24 韵母）属拼音领域词表，作为任务结构与内容生成的共同口径放此，
// 内容模块从此引用，避免两侧清单漂移。
import type { PinyinTask } from './models.js';

/** 拼音声母表（23 个，含 zh/ch/sh 双字母）。 */
export const PINYIN_INITIALS: readonly string[] = [
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x',
  'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w',
];
/** 拼音韵母表（24 个：单韵母 6 + 复韵母 9（含 er）+ 鼻韵母 9；ü 系按 ü 本字表示）。 */
export const PINYIN_FINALS: readonly string[] = [
  'a', 'o', 'e', 'i', 'u', 'ü',
  'ai', 'ei', 'ui', 'ao', 'ou', 'iu', 'ie', 'üe', 'er',
  'an', 'en', 'in', 'un', 'ün', 'ang', 'eng', 'ing', 'ong',
];
/** 拼音字母全集（47 个）。 */
export const PINYIN_LETTERS: readonly string[] = [...PINYIN_INITIALS, ...PINYIN_FINALS];

const LETTER_SET: ReadonlySet<string> = new Set(PINYIN_LETTERS);

/** 合法拼音字母：领域词表内成员（单字母含 ü，或 zh/ch/sh 及双字母韵母）。 */
export const isPinyinLetter = (value: unknown): value is string =>
  typeof value === 'string' && LETTER_SET.has(value);

export const isPinyinTask = (task: { readonly kind: string }): task is PinyinTask =>
  task.kind === 'pinyin-choose' || task.kind === 'pinyin-listen';

/** 拉丁字母（含 ü、大小写）；听辨题面出现任一即视为文字泄露。 */
const LATIN_RE = /[a-zü]/i;

/** 听辨音频路径：web 根内相对路径，audio/pinyin/ 下 ASCII 文件名 WAV（随构建预缓存）。 */
const AUDIO_PATH_RE = /^audio\/pinyin\/[a-z]+\.wav$/;

export function validatePinyinTask(task: PinyinTask): void {
  if (!isPinyinLetter(task.letter)) throw new TypeError('Invalid pinyin letter');
  // 答案必须与目标字母同身份：判题按字母身份，防止答案与题意脱钩。
  if (task.answer !== task.letter) throw new TypeError('Answer must match letter identity');
  if (task.options.length < 4 || task.options.length > 6) throw new RangeError('Expected 4–6 options');
  if (task.options.some(option => !isPinyinLetter(option))) throw new TypeError('Options must be pinyin letters');
  if (new Set(task.options).size !== task.options.length) throw new TypeError('Duplicate options');
  if (!task.options.includes(task.letter)) throw new RangeError('Answer not reachable among options');
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) throw new TypeError('Prompt required');
  if (task.kind === 'pinyin-listen') {
    // 听辨题结构级防泄露：题面不得出现任何拉丁字母/ü（含大小写），渲染层只允许播放钮与候选。
    if (LATIN_RE.test(task.prompt)) throw new TypeError('Listen prompt must not contain pinyin letters');
    if (typeof task.audio !== 'string' || !AUDIO_PATH_RE.test(task.audio)) throw new TypeError('Invalid audio path');
  }
}

/** 正确答案身份（字母字符串）：校验后返回目标字母，判题只比较字母身份。 */
export function correctPinyinAnswer(task: PinyinTask): string {
  validatePinyinTask(task);
  return task.letter;
}
