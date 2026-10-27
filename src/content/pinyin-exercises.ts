// 拼音冒险（pinyin-adventure）首批静态内容：23 声母 + 24 韵母，每字母辨认 + 听辨各一题 = 94 题。
// 审核记录：docs/content-review-pinyin.md（zcode-agent 代理审核；发音真人试听为如实记录的缺口）。
// 干扰项规则（显式、可解释、可复现）：优先取字母所在易混组（PINYIN_CONFUSABLE_GROUPS）成员，
// 不足 3 个时按同类别拼音表顺序补充（fill），补充项在审核记录中逐类说明。
// 音频映射 PINYIN_AUDIO_BY_LETTER 与生成脚本 scripts/gen-pinyin-audio.sh 的发音映射表一一对应
//（tests/pinyin.test.mjs 断言两侧一致且 WAV 文件真实存在）。
import type { Exercise, PinyinTask } from '../learning/models.js';
import { PINYIN_INITIALS, PINYIN_FINALS } from '../learning/pinyin.js';

const REVIEW = { status: 'approved' as const, reviewer: 'zcode-agent（代理审核）', reviewedAt: '2026-10-27T12:00:00Z' };

/**
 * 易混干扰组（显式定义，可解释）：镜像/旋转、竖线家族、平舌/翘舌、复韵母序颠倒、
 * 前后鼻音等教学常规对比。每个字母的干扰项优先从其所在组内取。
 */
export const PINYIN_CONFUSABLE_GROUPS: readonly (readonly string[])[] = [
  ['b', 'd', 'p', 'q'],    // 半圆朝向镜像/旋转变换
  ['f', 't'],              // 竖弯钩镜像
  ['m', 'n'],              // 拱形镜像
  ['w', 'm'],              // 上下镜像
  ['h', 'n'],              // 左竖 + 拱形，形近
  ['n', 'u'],              // 上下镜像
  ['l', 'i', 'j'],         // 竖线家族（i 带点、j 带钩）
  ['g', 'q'],              // 左下半圆 + 竖钩，形近
  ['ü', 'u'],              // 两点差异
  ['a', 'o', 'e'],         // 单韵母开口口型对比
  ['z', 'c', 's'],         // 平舌音一组，形近
  ['zh', 'ch', 'sh', 'r'], // 翘舌音一组
  ['ei', 'ie'],            // 复韵母字母序颠倒
  ['ui', 'iu'],            // 复韵母字母序颠倒
  ['ao', 'ou'],            // 复韵母形近
  ['er', 'e'],             // 包含关系
  ['an', 'ang'],           // 前鼻音 / 后鼻音
  ['en', 'eng'],           // 前鼻音 / 后鼻音
  ['in', 'ing'],           // 前鼻音 / 后鼻音
  ['eng', 'ong'],          // 后鼻音形近
  ['un', 'ün'],            // 两点差异
];

/** 每字母固定 3 个干扰项：易混组成员优先，不足按同类别拼音表顺序补充。 */
export function pinyinDistractors(letter: string, category: 'initials' | 'finals'): readonly string[] {
  const distractors: string[] = [];
  for (const group of PINYIN_CONFUSABLE_GROUPS) {
    if (!group.includes(letter)) continue;
    for (const member of group) {
      if (member !== letter && !distractors.includes(member)) distractors.push(member);
    }
  }
  const table = category === 'initials' ? PINYIN_INITIALS : PINYIN_FINALS;
  for (const candidate of table) {
    if (distractors.length >= 3) break;
    if (candidate !== letter && !distractors.includes(candidate)) distractors.push(candidate);
  }
  if (distractors.length < 3) throw new RangeError(`Cannot build distractors for ${letter}`);
  // 易混组成员可能超过 3 个（如 q 同时在 b/d/p/q 与 g/q 组）：固定取前 3 个（组序在前优先）。
  return distractors.slice(0, 3);
}

/**
 * 音频映射：字母 → web/audio/pinyin/ 下的 WAV 文件名（不含扩展名）。
 * ü/üe/ün 无 ASCII 文件名，按拼音输入惯例用 v/ve/vn；TTS 输入口径见生成脚本映射表
 *（ü/üe/ün 为 yu/yue/yun 近似，ui/iu/un 用 uei/iou/uen 全拼保滑音），审核记录同步标注。
 */
export const PINYIN_AUDIO_BY_LETTER: Readonly<Record<string, string>> = Object.fromEntries([
  ...PINYIN_INITIALS.map(letter => [letter, letter] as const),
  ...PINYIN_FINALS.map(letter => [letter, letter === 'ü' ? 'v' : letter === 'üe' ? 've' : letter === 'ün' ? 'vn' : letter] as const),
]);

const CATEGORY_OF: Readonly<Record<string, 'initials' | 'finals'>> = Object.fromEntries([
  ...PINYIN_INITIALS.map(letter => [letter, 'initials' as const] as const),
  ...PINYIN_FINALS.map(letter => [letter, 'finals' as const] as const),
]);

const MAPPING_OF = { initials: 'MAP-003', finals: 'MAP-004' } as const;

const chooseTask = (letter: string): PinyinTask => ({
  kind: 'pinyin-choose',
  letter,
  prompt: `找出字母「${letter}」`,
  options: [letter, ...pinyinDistractors(letter, CATEGORY_OF[letter]!)],
  answer: letter,
});

const listenTask = (letter: string): PinyinTask => ({
  kind: 'pinyin-listen',
  letter,
  audio: `audio/pinyin/${PINYIN_AUDIO_BY_LETTER[letter]!}.wav`,
  // 听辨题面固定问法，不含任何拼音字母（结构级防泄露，validatePinyinTask 强制）。
  prompt: '听一听，是哪个字母？',
  options: [letter, ...pinyinDistractors(letter, CATEGORY_OF[letter]!)],
  answer: letter,
});

const exercise = (id: string, letter: string, task: PinyinTask): Exercise<PinyinTask> => ({
  id,
  subject: 'chinese',
  mappingIds: [MAPPING_OF[CATEGORY_OF[letter]!]],
  gameIds: ['pinyin-adventure'],
  task,
  review: REVIEW,
});

const LETTERS: readonly string[] = [...PINYIN_INITIALS, ...PINYIN_FINALS];

export const pinyinExercises: readonly Exercise<PinyinTask>[] = LETTERS.flatMap((letter, index) => {
  const serial = String(index + 1).padStart(3, '0');
  return [
    exercise(`PY-C-${serial}`, letter, chooseTask(letter)),
    exercise(`PY-L-${serial}`, letter, listenTask(letter)),
  ];
});
