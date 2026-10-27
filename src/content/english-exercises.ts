// 英语快递员（english-courier）首批静态内容：12 词（家庭 6 + 情绪 6）、18 道任务
//（词汇识别 10 + 句意理解 8），全部为通用原创任务，未宣称与特定教材版次对齐。
// 审核记录：docs/content-review-english-courier.md（zcode-agent 代理审核，时间见各题 review 字段）。
// 干扰项规则（显式、可解释）：包裹与角色候选取自同一词表（家庭任务取家庭词表、
// 情绪任务取情绪词表），并在语义对比轴上取干扰（mum/dad、grandma/grandpa、
// brother/sister、happy/sad、tired/sleepy、hungry/thirsty 等教学常规对比），
// 逐题说明见审核记录。家庭族映射 MAP-015、情绪族映射 MAP-016，单任务不混映射。
// 首版仅文字指令；听力模式属后续切片（docs/m10-english-courier-plan.md 决策 1）。
import type { EnglishDeliveryTask, Exercise } from '../learning/models.js';
import { ENGLISH_EMOTION_WORDS, ENGLISH_FAMILY_WORDS } from '../learning/english.js';

const REVIEW = { status: 'approved' as const, reviewer: 'zcode-agent（代理审核）', reviewedAt: '2026-10-27T18:20:00Z' };

const MAPPING = { family: 'MAP-015', emotion: 'MAP-016' } as const;

/** 家庭角色候选集（包裹与角色共用同一集合：标签步考词形、角色步考词义）。 */
const FAMILY_SETS = {
  mum: ['mum', 'dad', 'grandma', 'sister'],
  dad: ['dad', 'mum', 'brother', 'grandpa'],
  grandma: ['grandma', 'grandpa', 'mum', 'sister'],
  grandpa: ['grandpa', 'grandma', 'dad', 'brother'],
  brother: ['brother', 'sister', 'dad', 'grandpa'],
  sister: ['sister', 'brother', 'mum', 'grandma'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** 情绪角色候选集（角色为显示对应表情的人物卡）。 */
const EMOTION_SETS = {
  happy: ['happy', 'sad', 'tired', 'sleepy'],
  sad: ['sad', 'happy', 'hungry', 'thirsty'],
  tired: ['tired', 'sleepy', 'happy', 'sad'],
  hungry: ['hungry', 'thirsty', 'tired', 'happy'],
  thirsty: ['thirsty', 'hungry', 'happy', 'tired'],
  sleepy: ['sleepy', 'tired', 'sad', 'happy'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const familyVocab = (word: keyof typeof FAMILY_SETS): EnglishDeliveryTask => ({
  kind: 'english-delivery',
  mode: 'vocab',
  prompt: `Deliver the parcel to ${word[0]!.toUpperCase()}${word.slice(1)}.`,
  parcels: FAMILY_SETS[word],
  recipients: FAMILY_SETS[word],
  parcelAnswers: [word],
  recipientAnswers: [word],
});

const emotionVocab = (word: keyof typeof EMOTION_SETS): EnglishDeliveryTask => ({
  kind: 'english-delivery',
  mode: 'vocab',
  prompt: `Deliver the parcel to the ${word} one.`,
  parcels: EMOTION_SETS[word],
  recipients: EMOTION_SETS[word],
  parcelAnswers: [word],
  recipientAnswers: [word],
});

const familySentence = (word: keyof typeof FAMILY_SETS, prompt: string): EnglishDeliveryTask => ({
  kind: 'english-delivery',
  mode: 'sentence',
  prompt,
  parcels: FAMILY_SETS[word],
  recipients: FAMILY_SETS[word],
  parcelAnswers: [word],
  recipientAnswers: [word],
});

const emotionSentence = (word: keyof typeof EMOTION_SETS, prompt: string): EnglishDeliveryTask => ({
  kind: 'english-delivery',
  mode: 'sentence',
  prompt,
  parcels: EMOTION_SETS[word],
  recipients: EMOTION_SETS[word],
  parcelAnswers: [word],
  recipientAnswers: [word],
});

const exercise = (
  id: string,
  family: boolean,
  task: EnglishDeliveryTask,
): Exercise<EnglishDeliveryTask> => ({
  id,
  subject: 'english',
  mappingIds: [family ? MAPPING.family : MAPPING.emotion],
  gameIds: ['english-courier'],
  task,
  review: REVIEW,
});

export const englishExercises: readonly Exercise<EnglishDeliveryTask>[] = [
  // ===== 词汇识别（10 题）：指令点名词，考词形辨认（找标签）+ 词义辨认（找角色）=====
  exercise('EN-C-001', true, familyVocab('mum')),
  exercise('EN-C-002', true, familyVocab('dad')),
  exercise('EN-C-003', true, familyVocab('grandma')),
  exercise('EN-C-004', true, familyVocab('grandpa')),
  exercise('EN-C-005', true, familyVocab('brother')),
  exercise('EN-C-006', true, familyVocab('sister')),
  exercise('EN-C-007', false, emotionVocab('happy')),
  exercise('EN-C-008', false, emotionVocab('sad')),
  exercise('EN-C-009', false, emotionVocab('tired')),
  exercise('EN-C-010', false, emotionVocab('hungry')),
  // ===== 句意理解（8 题）：短句解析定指向，考句意理解 =====
  exercise('EN-C-011', true, familySentence('dad', 'Dad wants his parcel.')),
  exercise('EN-C-012', true, familySentence('grandma', 'Grandma is waiting for her parcel.')),
  exercise('EN-C-013', true, familySentence('grandpa', 'This one is for Grandpa.')),
  exercise('EN-C-014', true, familySentence('sister', 'Sister asks for her parcel.')),
  exercise('EN-C-015', false, emotionSentence('sad', 'The sad child is waiting.')),
  exercise('EN-C-016', false, emotionSentence('tired', 'The tired one needs a rest.')),
  exercise('EN-C-017', false, emotionSentence('thirsty', 'The thirsty child wants a drink.')),
  exercise('EN-C-018', false, emotionSentence('sleepy', 'The sleepy child is going to bed.')),
];

/** 领域词表再导出：测试断言内容池与词表一致，防止两侧漂移。 */
export const ENGLISH_COURIER_WORD_LISTS = { family: ENGLISH_FAMILY_WORDS, emotion: ENGLISH_EMOTION_WORDS };
