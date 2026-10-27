// 英语快递员纯规则模块：配送局状态机、组卷（包裹排列与站位洗牌）、取件/送达判定、
// 计分与快照恢复；无 DOM/存储/音频依赖。首版仅文字指令、不限时
//（docs/m10-english-courier-plan.md 决策 1/6），不复用计时会话。
// 判题一律走 Learning Core（englishDeliveryResult / evaluateAnswer）；本模块不重复判题。
// 计分口径：首答 = 本任务第一次送达尝试（已取件后点选目标触发判定），任一步错入重试档；
// 未取件点选角色不构成作答（规则层无从提交，仅 UI 呈现移动反馈），不计尝试不消耗首答档位。
import type { EnglishDeliveryTask, Exercise, Grade } from '../../learning/models.js';
import { englishDeliveryResult, validateEnglishTask } from '../../learning/english.js';

export const GAME_ID = 'english-courier';
export const QUESTIONS_PER_ROUND = 5;
export const FIRST_TRY_SCORE = 10;
export const RETRY_SCORE = 5;
export const STORE_PREFIX = 'pixel-academy:english-courier:v1';

export type Rng = () => number;
export type EnglishMode = 'vocab' | 'sentence';

/** 记录口径按词汇识别/句意理解分开组织。 */
export const englishMode = (task: EnglishDeliveryTask): EnglishMode => task.mode;

export interface RoundQuestion {
  readonly exerciseId: string;
  readonly task: EnglishDeliveryTask;
  /** 站位槽位上的收件角色（组卷时洗牌；下标即站位槽，判题按身份与位置无关）。 */
  readonly stations: readonly string[];
  /** 包裹排列（组卷时洗牌；下标即包裹槽，正确包裹不恒在首位）。 */
  readonly parcels: readonly string[];
}

export interface RoundState {
  readonly phase: 'asking' | 'resolving' | 'finished';
  readonly questions: readonly RoundQuestion[];
  readonly questionIndex: number;
  readonly score: number;
  readonly firstTryCount: number;
  readonly totalWrongCount: number;
  /** 当前任务是否已答错过（决定下一答得分档）。 */
  readonly currentWrong: boolean;
  /** 每任务送达尝试次数（已取件后的判定次数；下标对齐 questions）。 */
  readonly attempts: readonly number[];
  /** 每任务错送次数（送达尝试中未完成判定；下标对齐 questions）。 */
  readonly wrongs: readonly number[];
  /** 当前已取包裹标签词；null = 未取件。 */
  readonly carrying: string | null;
  readonly result: 'passed' | null;
}

export interface RoundSnapshot {
  readonly version: 1;
  readonly gameId: typeof GAME_ID;
  readonly roundId: string;
  readonly state: RoundState;
  readonly rngState: number;
  readonly previousIds: readonly string[];
  /** 开局所选年级：恢复后据此重建抽题池。 */
  readonly grades: readonly Grade[];
  /** 内容版本指纹：不兼容时由调用方安全放弃进度。 */
  readonly contentVersion: string;
}

/** Fisher–Yates 洗牌（消耗 rng），与拼音冒险/汉字勇者同实现口径。 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ===== 组卷 =====

/**
 * 从正式池抽一局 5 任务：局内唯一，优先避开上一局任务 ID（池充足时全部避开）。
 * 每任务的包裹排列与站位分配在组卷时用局内 rng 洗牌——正确位置不长期固定
 *（PLAN M10 验收），洗牌结果随 RoundState 进入快照，恢复后排列与站位一致不重排。
 */
export function createRound(
  exercises: readonly Exercise<EnglishDeliveryTask>[],
  previousIds: readonly string[],
  rng: Rng,
): RoundState {
  if (exercises.length < QUESTIONS_PER_ROUND) {
    throw new RangeError(`english-courier needs at least ${QUESTIONS_PER_ROUND} approved exercises`);
  }
  const previous = new Set(previousIds);
  const ordered = [
    ...shuffle(exercises.filter(e => !previous.has(e.id)), rng),
    ...shuffle(exercises.filter(e => previous.has(e.id)), rng),
  ];
  const picked = ordered.slice(0, QUESTIONS_PER_ROUND);
  if (picked.length !== QUESTIONS_PER_ROUND || new Set(picked.map(e => e.id)).size !== QUESTIONS_PER_ROUND) {
    throw new RangeError('Insufficient exercises for a round');
  }
  const questions: RoundQuestion[] = picked.map(e => ({
    exerciseId: e.id,
    task: e.task,
    parcels: shuffle(e.task.parcels, rng),
    stations: shuffle(e.task.recipients, rng),
  }));
  return {
    phase: 'asking', questions, questionIndex: 0, score: 0, firstTryCount: 0,
    totalWrongCount: 0, currentWrong: false,
    attempts: questions.map(() => 0), wrongs: questions.map(() => 0),
    carrying: null, result: null,
  };
}

// ===== 取件与送达 =====

const current = (state: RoundState): RoundQuestion => {
  const question = state.questions[state.questionIndex];
  if (!question) throw new RangeError('No current question');
  return question;
};

/** 取件（可换包裹）：不判题、不计分、不构成作答尝试；仅 asking 阶段允许。 */
export function pickParcel(state: RoundState, parcel: string): RoundState {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  if (!current(state).parcels.includes(parcel)) throw new RangeError('Parcel not on the shelf');
  return { ...state, carrying: parcel };
}

export type DeliverOutcome = {
  readonly type: 'delivered';
  readonly gained: number;
  readonly next: RoundState;
} | {
  readonly type: 'wrong';
  /** 分步反馈：包裹不对 / 对象不对 / 都不对。 */
  readonly parcelOk: boolean;
  readonly recipientOk: boolean;
  readonly next: RoundState;
};

/** 送达判定（须已取件）：双对完成入 resolving；任一步错按一次错送计，可纠正重试。 */
export function deliverTo(state: RoundState, recipient: string): DeliverOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (state.carrying === null) throw new Error('Deliver requires a carried parcel');
  if (!question.stations.includes(recipient)) throw new RangeError('Recipient not on the scene');
  const outcome = englishDeliveryResult(question.task, [state.carrying, recipient]);
  const attempts = [...state.attempts];
  attempts[state.questionIndex]! += 1;
  if (outcome.complete) {
    const gained = state.currentWrong ? RETRY_SCORE : FIRST_TRY_SCORE;
    return {
      type: 'delivered',
      gained,
      next: {
        ...state,
        phase: 'resolving',
        score: state.score + gained,
        firstTryCount: state.firstTryCount + (state.currentWrong ? 0 : 1),
        attempts,
        carrying: null,
      },
    };
  }
  const wrongs = [...state.wrongs];
  wrongs[state.questionIndex]! += 1;
  return {
    type: 'wrong',
    parcelOk: outcome.parcel,
    recipientOk: outcome.recipient,
    next: {
      ...state,
      attempts,
      wrongs,
      currentWrong: true,
      totalWrongCount: state.totalWrongCount + 1,
    },
  };
}

// ===== 推进与结算 =====

/** resolving → 下一任务（终局切 finished；由 UI 在短反馈后调用）。 */
export function advanceQuestion(state: RoundState): RoundState {
  if (state.phase !== 'resolving') throw new Error('advanceQuestion requires resolving phase');
  const isLast = state.questionIndex + 1 >= state.questions.length;
  return {
    ...state,
    phase: isLast ? 'finished' : 'asking',
    result: isLast ? 'passed' : null,
    questionIndex: isLast ? state.questionIndex : state.questionIndex + 1,
    currentWrong: false,
    carrying: null,
  };
}

export interface QuestionResult {
  readonly exerciseId: string;
  readonly mode: EnglishMode;
  readonly attempts: number;
  readonly wrongs: number;
  /** 首答 = 第一次送达尝试即完成（无错送）。 */
  readonly firstTry: boolean;
}

export interface Settlement {
  readonly score: number;
  readonly firstTry: number;
  readonly wrong: number;
  readonly total: number;
  /** 送达尝试总数（移动操作口径），与语言作答分开呈现。 */
  readonly attempts: number;
  readonly answered: readonly QuestionResult[];
}

export function settlement(state: RoundState): Settlement {
  if (state.phase !== 'finished') throw new Error('Settlement requires finished phase');
  const answered = state.questions.map((question, index) => ({
    exerciseId: question.exerciseId,
    mode: englishMode(question.task),
    attempts: state.attempts[index]!,
    wrongs: state.wrongs[index]!,
    firstTry: state.wrongs[index] === 0,
  }));
  return {
    score: state.score,
    firstTry: state.firstTryCount,
    wrong: state.totalWrongCount,
    total: state.questions.length,
    attempts: state.attempts.reduce((a: number, b: number) => a + b, 0),
    answered,
  };
}

// ===== 快照 =====

const nonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const sameMembers = (a: readonly unknown[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** 快照结构校验（含题目结构再校验与排列一致性）；损坏按首次使用处理，由调用方兜底。 */
export function parseSnapshot(value: unknown): RoundSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.gameId !== GAME_ID || typeof v.roundId !== 'string' || !v.roundId
    || typeof v.contentVersion !== 'string' || !v.contentVersion
    || !Array.isArray(v.grades) || !v.grades.length
    || !v.grades.every(g => typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 6)
    || !Array.isArray(v.previousIds) || !v.previousIds.every(x => typeof x === 'string')) return null;
  if (!nonNegInt(v.rngState) || v.rngState > 0xffffffff) return null;
  const s = v.state as Record<string, unknown> | undefined;
  if (!s || !['asking', 'resolving', 'finished'].includes(String(s.phase))
    || !Array.isArray(s.questions) || s.questions.length !== QUESTIONS_PER_ROUND) return null;
  for (const raw of s.questions) {
    const q = raw as Record<string, unknown> | null;
    if (!q || typeof q.exerciseId !== 'string' || !q.exerciseId
      || typeof q.task !== 'object' || q.task === null
      || !Array.isArray(q.parcels) || !Array.isArray(q.stations)) return null;
    const task = q.task as EnglishDeliveryTask;
    try {
      validateEnglishTask(task);
      // 站位与包裹必须是任务候选的重新排列（恢复后不重排、也不能凭空换题）。
      if (!sameMembers(q.parcels, task.parcels) || !sameMembers(q.stations, task.recipients)) return null;
    } catch {
      return null;
    }
  }
  if (typeof s.questionIndex !== 'number' || !Number.isSafeInteger(s.questionIndex)
    || s.questionIndex < 0 || s.questionIndex >= QUESTIONS_PER_ROUND) return null;
  if (!nonNegInt(s.score) || s.score > QUESTIONS_PER_ROUND * FIRST_TRY_SCORE
    || !nonNegInt(s.firstTryCount) || s.firstTryCount > QUESTIONS_PER_ROUND
    || !nonNegInt(s.totalWrongCount) || typeof s.currentWrong !== 'boolean'
    || (s.carrying !== null && typeof s.carrying !== 'string')) return null;
  if (!Array.isArray(s.attempts) || s.attempts.length !== QUESTIONS_PER_ROUND || !s.attempts.every(nonNegInt)) return null;
  if (!Array.isArray(s.wrongs) || s.wrongs.length !== QUESTIONS_PER_ROUND || !s.wrongs.every(nonNegInt)) return null;
  // 机器不变式：错送不多于尝试、总数一致；已完成任务至少一次送达尝试；
  // carrying 只能是当前任务的包裹且仅作答阶段存在；终局一致。
  for (let i = 0; i < QUESTIONS_PER_ROUND; i++) {
    if (s.wrongs[i]! > s.attempts[i]!) return null;
    if (s.attempts[i] === 0 && (i < s.questionIndex || s.phase === 'finished')) return null;
  }
  if (s.wrongs.reduce((a: number, b: number) => a + b, 0) !== s.totalWrongCount) return null;
  if (s.phase === 'finished' && s.questionIndex !== QUESTIONS_PER_ROUND - 1) return null;
  if ((s.phase === 'finished') !== (s.result === 'passed')) return null;
  if (s.carrying !== null) {
    const question = s.questions[s.questionIndex] as Record<string, unknown> | null;
    const parcels = question ? question.parcels as readonly string[] : null;
    if (!parcels || !parcels.includes(s.carrying) || s.phase !== 'asking') return null;
  }
  return v as unknown as RoundSnapshot;
}
