// 拼音冒险纯规则模块：混合局（辨认 + 听辨）状态机、组卷、计分、跳过与快照恢复；无 DOM/存储依赖。
// 首版口径：每局 5 题（辨认与听辨混排，听辨至少 2 题）、候选排列组卷时局内洗牌
//（答案不恒在首位，不能靠位置猜中）、首答 10 分/重试 5 分、
// 每题 10 秒由会话层注入时钟执行（复用数字消除 RoundSession，播放音频不暂停计时）；
// 答错/超时不扣分可重试（拼音答案为确定字形，重试路径无死局）；听辨题音频不可用时可跳过
//（跳过题不计分不计作答，记录如实标注 skipped，不假装完成听力训练）。
// 判题一律走 Learning Core（evaluateAnswer）；本模块不重复判题。
import type { Exercise, Grade, PinyinTask } from '../../learning/models.js';
import { evaluateAnswer } from '../../learning/evaluation.js';
import { validatePinyinTask } from '../../learning/pinyin.js';

export const GAME_ID = 'pinyin-adventure';
export const QUESTIONS_PER_ROUND = 5;
/** 每局听辨题数量下限（PLAN M9：辨认与听辨分开组织，混合局内听辨不可被挤光）。 */
export const MIN_LISTEN_QUESTIONS = 2;
export const FIRST_TRY_SCORE = 10;
export const RETRY_SCORE = 5;
/** 每题作答时长（毫秒）；与数字消除、算术地下城每题 10 秒同口径。 */
export const QUESTION_TIME_MS = 10_000;
export const STORE_PREFIX = 'pixel-academy:pinyin-adventure:v1';

export type Rng = () => number;
export type PinyinMode = 'choose' | 'listen';

/** 题目模式（记录口径按辨认/听辨分开组织）。 */
export const pinyinMode = (task: PinyinTask): PinyinMode => task.kind === 'pinyin-choose' ? 'choose' : 'listen';

export interface RoundQuestion {
  readonly exerciseId: string;
  readonly task: PinyinTask;
}

export interface RoundState {
  readonly phase: 'asking' | 'resolving' | 'finished';
  readonly questions: readonly RoundQuestion[];
  readonly questionIndex: number;
  readonly score: number;
  readonly firstTryCount: number;
  readonly totalWrongCount: number;
  /** 当前题是否已答错过（决定下一答得分档）。 */
  readonly currentWrong: boolean;
  /** 每题累计答错/超时次数（下标对齐 questions）。 */
  readonly wrongs: readonly number[];
  /** 每题是否被跳过（仅音频不可用时允许；跳过不计分不计作答）。 */
  readonly skipped: readonly boolean[];
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
  readonly timer: {
    readonly paused: boolean;
    readonly remainingMs: number;
    readonly deadline: number | null;
    /** 与数字消除 TimedSession 同形；拼音冒险只使用 'question' 与 null。 */
    readonly timerKind: 'question' | 'resolve' | null;
  };
}

/** Fisher–Yates 洗牌（消耗 rng），与汉字勇者同实现口径。 */
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
 * 从正式池抽一局 5 题：辨认与听辨混排，听辨 2–3 题（上限受池量约束），
 * 局内唯一，优先避开上一局题目 ID（池充足时全部避开）。
 * 听辨池不足 MIN_LISTEN_QUESTIONS 或总池不足 5 道时抛错（由可用性检查拦截开局）。
 */
export function createRound(
  exercises: readonly Exercise<PinyinTask>[],
  previousIds: readonly string[],
  rng: Rng,
): RoundState {
  if (exercises.length < QUESTIONS_PER_ROUND) {
    throw new RangeError(`pinyin-adventure needs at least ${QUESTIONS_PER_ROUND} approved exercises`);
  }
  // 两个模式各自「未在上一局出现者优先」：fresh 在前、repeated 在后（同汉字勇者口径）。
  const ordered = (pool: readonly Exercise<PinyinTask>[], previous: ReadonlySet<string>): readonly Exercise<PinyinTask>[] =>
    [...shuffle(pool.filter(e => !previous.has(e.id)), rng), ...shuffle(pool.filter(e => previous.has(e.id)), rng)];
  const previous = new Set(previousIds);
  const listenPool = ordered(exercises.filter(e => e.task.kind === 'pinyin-listen'), previous);
  const choosePool = ordered(exercises.filter(e => e.task.kind === 'pinyin-choose'), previous);
  if (listenPool.length < MIN_LISTEN_QUESTIONS) {
    throw new RangeError(`pinyin-adventure needs at least ${MIN_LISTEN_QUESTIONS} listen exercises`);
  }
  // 听辨题数：2–3 题由 rng 决定；辨认池不足时用更多听辨补足 5 题。
  let listenCount = MIN_LISTEN_QUESTIONS + Math.floor(rng() * 2);
  listenCount = Math.min(listenCount, listenPool.length, QUESTIONS_PER_ROUND);
  if (QUESTIONS_PER_ROUND - listenCount > choosePool.length) {
    listenCount = QUESTIONS_PER_ROUND - choosePool.length;
  }
  const picked = [...listenPool.slice(0, listenCount), ...choosePool.slice(0, QUESTIONS_PER_ROUND - listenCount)];
  if (picked.length !== QUESTIONS_PER_ROUND || new Set(picked.map(e => e.id)).size !== QUESTIONS_PER_ROUND) {
    throw new RangeError('Insufficient exercises for a mixed round');
  }
  const questions: RoundQuestion[] = shuffle(picked, rng).map(e => ({
    exerciseId: e.id,
    // 候选顺序在组卷时用局内 rng 洗牌：答案不恒在首位，不能靠位置/固定排列猜中
    //（M8 验收原则，拼音按字母身份判题同样适用）。洗牌结果随 RoundState 进入快照，
    // 恢复后排列一致；判题按字母身份，与渲染位置无关。内容模块的原始排列不变。
    task: { ...e.task, options: shuffle(e.task.options, rng) },
  }));
  return {
    phase: 'asking', questions, questionIndex: 0, score: 0, firstTryCount: 0,
    totalWrongCount: 0, currentWrong: false,
    wrongs: questions.map(() => 0), skipped: questions.map(() => false), result: null,
  };
}

// ===== 作答 =====

export type SubmitOutcome = {
  readonly type: 'correct';
  readonly gained: number;
  readonly next: RoundState;
} | {
  readonly type: 'wrong';
  readonly next: RoundState;
};

const current = (state: RoundState): RoundQuestion => {
  const question = state.questions[state.questionIndex];
  if (!question) throw new RangeError('No current question');
  return question;
};

/** 提交作答（传候选字母字符串）。首答 10 分、重试 5 分；答错不扣分可重试。 */
export function submitAnswer(state: RoundState, answer: string): SubmitOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (evaluateAnswer(question.task, answer)) {
    const gained = state.currentWrong ? RETRY_SCORE : FIRST_TRY_SCORE;
    return {
      type: 'correct',
      gained,
      next: {
        ...state,
        phase: 'resolving',
        score: state.score + gained,
        firstTryCount: state.firstTryCount + (state.currentWrong ? 0 : 1),
      },
    };
  }
  return { type: 'wrong', next: countWrong(state) };
}

/** 超时按答错处理：不扣分、计入重试与该题答错数，可再试。 */
export function timeoutCurrent(state: RoundState): SubmitOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  return { type: 'wrong', next: countWrong(state) };
}

const countWrong = (state: RoundState): RoundState => {
  const wrongs = [...state.wrongs];
  wrongs[state.questionIndex]! += 1;
  return { ...state, currentWrong: true, totalWrongCount: state.totalWrongCount + 1, wrongs };
};

// ===== 推进与跳过 =====

/** resolving → 下一题（终局切 finished；由 UI 在短反馈后调用）。 */
export function advanceQuestion(state: RoundState): RoundState {
  if (state.phase !== 'resolving') throw new Error('advanceQuestion requires resolving phase');
  const isLast = state.questionIndex + 1 >= state.questions.length;
  return {
    ...state,
    phase: isLast ? 'finished' : 'asking',
    result: isLast ? 'passed' : null,
    questionIndex: isLast ? state.questionIndex : state.questionIndex + 1,
    currentWrong: false,
  };
}

/**
 * 跳过当前听辨题（仅音频不可用时由 UI 提供）：不判题、不计分、不计作答，
 * 记录口径如实标注 skipped；直接推进到下一题。仅对听辨题允许，辨认题不可跳过。
 */
export function skipCurrent(state: RoundState): RoundState {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (question.task.kind !== 'pinyin-listen') throw new TypeError('Only listen questions can be skipped');
  const isLast = state.questionIndex + 1 >= state.questions.length;
  const skipped = [...state.skipped];
  skipped[state.questionIndex] = true;
  return {
    ...state,
    phase: isLast ? 'finished' : 'asking',
    result: isLast ? 'passed' : null,
    questionIndex: isLast ? state.questionIndex : state.questionIndex + 1,
    currentWrong: false,
    skipped,
  };
}

// ===== 结算 =====

export interface QuestionResult {
  readonly exerciseId: string;
  readonly mode: PinyinMode;
  /** 是否实际作答（跳过题为 false，不假装完成听力训练）。 */
  readonly answered: boolean;
  readonly firstTry: boolean;
  readonly wrongs: number;
}

export interface Settlement {
  readonly score: number;
  readonly firstTry: number;
  readonly wrong: number;
  readonly total: number;
  /** 每题作答表现（模式、是否作答、首答、答错数），辨认/听辨分别可统计。 */
  readonly answered: readonly QuestionResult[];
}

export function settlement(state: RoundState): Settlement {
  if (state.phase !== 'finished') throw new Error('Settlement requires finished phase');
  const answered = state.questions.map((question, index) => ({
    exerciseId: question.exerciseId,
    mode: pinyinMode(question.task),
    answered: !state.skipped[index],
    firstTry: !state.skipped[index] && state.wrongs[index] === 0,
    wrongs: state.wrongs[index]!,
  }));
  return {
    score: state.score,
    firstTry: state.firstTryCount,
    wrong: state.totalWrongCount,
    total: state.questions.length,
    answered,
  };
}

// ===== 快照 =====

const nonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** 快照结构校验（含题目结构再校验）；损坏按首次使用处理，由调用方兜底。 */
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
    if (!q || typeof q.exerciseId !== 'string' || !q.exerciseId || typeof q.task !== 'object' || q.task === null) return null;
    try { validatePinyinTask(q.task as PinyinTask); } catch { return null; }
  }
  if (typeof s.questionIndex !== 'number' || !Number.isSafeInteger(s.questionIndex)
    || s.questionIndex < 0 || s.questionIndex >= QUESTIONS_PER_ROUND) return null;
  if (!nonNegInt(s.score) || s.score > QUESTIONS_PER_ROUND * FIRST_TRY_SCORE
    || !nonNegInt(s.firstTryCount) || s.firstTryCount > QUESTIONS_PER_ROUND
    || !nonNegInt(s.totalWrongCount) || typeof s.currentWrong !== 'boolean') return null;
  if (!Array.isArray(s.wrongs) || s.wrongs.length !== QUESTIONS_PER_ROUND || !s.wrongs.every(nonNegInt)) return null;
  if (!Array.isArray(s.skipped) || s.skipped.length !== QUESTIONS_PER_ROUND
    || s.skipped.some(x => typeof x !== 'boolean')) return null;
  // 机器不变式：答错计数与总错数一致；finished ⇔ result 通过；跳过题不产生首答分。
  if (s.wrongs.reduce((a: number, b: number) => a + b, 0) !== s.totalWrongCount) return null;
  if ((s.phase === 'finished') !== (s.result === 'passed')) return null;
  const timer = v.timer as Record<string, unknown> | undefined;
  if (!timer || typeof timer.paused !== 'boolean' || !nonNegInt(timer.remainingMs)
    || (timer.deadline !== null && typeof timer.deadline !== 'number')
    // 拼音冒险只使用 question 计时（'resolve' 属于数字消除，出现在快照即损坏）。
    || (timer.timerKind !== null && timer.timerKind !== 'question')) return null;
  return v as unknown as RoundSnapshot;
}
