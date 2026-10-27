// 英语快递任务（english-delivery）的校验与判题：结构约束 + 按词义身份两步判题，
// 不依赖界面、显示顺序或存储。指令表述、角色配图与词义的对应关系由内容审核记录支撑
//（docs/content-review-english-courier.md），这里保证：候选与可接受集合合法、可达，
// 且同一集合内全部同指一个规范词（多种合理表达不误判的判题口径）。
// 听力模式属后续切片（docs/m10-english-courier-plan.md 决策 1），届时再扩展音频字段
// 与结构级防泄露校验，不在首版预置未用字段。
import type { EnglishDeliveryTask } from './models.js';

/** 家庭成员词表（6 词，通用原创教学词表，不宣称对应特定教材课次）。 */
export const ENGLISH_FAMILY_WORDS: readonly string[] =
  ['mum', 'dad', 'grandma', 'grandpa', 'brother', 'sister'];
/** 状态感受词表（6 词）。 */
export const ENGLISH_EMOTION_WORDS: readonly string[] =
  ['happy', 'sad', 'tired', 'hungry', 'thirsty', 'sleepy'];
/** 规范词全集（判题身份的最小集合）。 */
export const ENGLISH_WORDS: readonly string[] = [...ENGLISH_FAMILY_WORDS, ...ENGLISH_EMOTION_WORDS];

/**
 * 同义表达 → 规范词：可接受答案集合可收录同义表达，判题按规范身份接受
 *（PLAN M10「多种合理表达不会被错误判错」）；候选标签也可同时收录同义表达
 *（如 mum 与 mother 同时候选，均指向 mum，判为同义正确）。
 */
export const ENGLISH_SYNONYMS: Readonly<Record<string, string>> = {
  mother: 'mum', mom: 'mum', mummy: 'mum', mommy: 'mum',
  father: 'dad', daddy: 'dad',
  grandmother: 'grandma', granny: 'grandma',
  grandfather: 'grandpa', granddad: 'grandpa',
  glad: 'happy', unhappy: 'sad',
};

const WORD_SET: ReadonlySet<string> = new Set(ENGLISH_WORDS);

/** 词表内词：规范词或已登记同义表达。 */
export const isEnglishWord = (value: unknown): value is string =>
  typeof value === 'string' && (WORD_SET.has(value) || value in ENGLISH_SYNONYMS);

/** 规范身份：同义表达归一到规范词；词表外词抛错。 */
export function englishCanonicalWord(value: string): string {
  if (WORD_SET.has(value)) return value;
  const canonical = ENGLISH_SYNONYMS[value];
  if (canonical !== undefined) return canonical;
  throw new TypeError(`Not an english word: ${JSON.stringify(value)}`);
}

export const isEnglishTask = (task: { readonly kind: string }): task is EnglishDeliveryTask =>
  task.kind === 'english-delivery';

const validateCandidates = (words: readonly string[], min: number, max: number, label: string): void => {
  if (words.length < min || words.length > max) throw new RangeError(`Expected ${min}–${max} ${label}`);
  if (words.some(w => typeof w !== 'string' || !isEnglishWord(w))) throw new TypeError(`Invalid ${label}`);
  if (new Set(words).size !== words.length) throw new TypeError(`Duplicate ${label}`);
};

/**
 * 可接受答案集合：非空、全部为词表内词、同指一个规范词（多种合理表达同身份），
 * 且至少一个成员在对应候选中可达（「Answer not reachable」先例：src/learning/pinyin.ts:45）。
 */
const validateAnswerSet = (answers: readonly string[], candidates: readonly string[], label: string): void => {
  if (!answers.length) throw new TypeError(`Empty ${label}`);
  if (answers.some(w => typeof w !== 'string' || !isEnglishWord(w))) throw new TypeError(`Invalid ${label}`);
  const identities = new Set(answers.map(w => englishCanonicalWord(w)));
  if (identities.size !== 1) throw new TypeError(`${label} must refer to one identity`);
  if (!answers.some(w => candidates.includes(w))) throw new RangeError(`${label} not reachable among candidates`);
};

export function validateEnglishTask(task: EnglishDeliveryTask): void {
  if (task.mode !== 'vocab' && task.mode !== 'sentence') throw new TypeError('Invalid english-delivery mode');
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) throw new TypeError('Prompt required');
  validateCandidates(task.parcels, 3, 4, 'parcels');
  validateCandidates(task.recipients, 3, 4, 'recipients');
  validateAnswerSet(task.parcelAnswers, task.parcels, 'parcelAnswers');
  validateAnswerSet(task.recipientAnswers, task.recipients, 'recipientAnswers');
}

export interface EnglishDeliveryResult {
  /** 包裹步：所选标签词在可接受集合内。 */
  readonly parcel: boolean;
  /** 送达步：所选角色在可接受集合内。 */
  readonly recipient: boolean;
  /** 两步全对（送达完成）。 */
  readonly complete: boolean;
}

/** 可接受集合按规范身份比较；集合外/非法词一律不匹配，不做宽松裁剪或模糊匹配。 */
const matchesAnswerSet = (word: string, answers: readonly string[]): boolean => {
  try {
    const identity = englishCanonicalWord(word);
    return answers.some(a => englishCanonicalWord(a) === identity);
  } catch {
    return false;
  }
};

/**
 * 两步分解判定：包裹步与送达步各自独立判定，complete = parcel && recipient。
 * 它与 evaluateAnswer 是同一判定逻辑的粒度分解（evaluateAnswer 只返回 complete），
 * 供规则层获取分步反馈（包裹不对 / 对象不对 / 都不对），不是第二个判定入口。
 * 作答契约：长度恰为 2 的字符串数组 [包裹标签词, 收件人身份词]；其余形状一律不算完成。
 */
export function englishDeliveryResult(task: EnglishDeliveryTask, answer: unknown): EnglishDeliveryResult {
  validateEnglishTask(task);
  if (!Array.isArray(answer) || answer.length !== 2
    || typeof answer[0] !== 'string' || typeof answer[1] !== 'string') {
    return { parcel: false, recipient: false, complete: false };
  }
  const [parcelWord, recipientWord] = answer;
  const parcel = task.parcels.includes(parcelWord) && matchesAnswerSet(parcelWord, task.parcelAnswers);
  const recipient = task.recipients.includes(recipientWord) && matchesAnswerSet(recipientWord, task.recipientAnswers);
  return { parcel, recipient, complete: parcel && recipient };
}

/** 规范答案身份（校验后返回）；供测试与记录引用，判题本身不依赖。 */
export function englishDeliveryAnswer(
  task: EnglishDeliveryTask,
): { readonly parcel: string; readonly recipient: string } {
  validateEnglishTask(task);
  return {
    parcel: englishCanonicalWord(task.parcelAnswers[0]!),
    recipient: englishCanonicalWord(task.recipientAnswers[0]!),
  };
}
