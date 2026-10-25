// 数字消除单局规则（docs/gameplay-number-puzzle.md 为唯一权威）。
// 本模块是纯逻辑：不依赖 DOM、Canvas、存储或计时器；动画时长常量仅作登记，
// 由渲染层读取使用，判题与计分不依赖动画是否完成。
import type { Exercise, Grade, MathTask } from '../../learning/models.js';
import { answerFor, evaluateAnswer } from '../../learning/evaluation.js';

/** 随机源接口：返回 [0, 1) 的浮点数；出题与棋盘逻辑不直接调用 Math.random()。 */
export type Rng = () => number;

// 「实现常量一览」：调整任何一项都必须同步更新玩法说明与测试。
export const BOARD_TILES = 12;
export const BOARD_COLUMNS = 3;
export const BOARD_ROWS = 4;
export const QUESTIONS_PER_ROUND = 10;
export const START_THRESHOLD = 5;
export const FIRST_TRY_SCORE = 10;
export const RETRY_SCORE = 5;
export const HINT_THRESHOLD = 3;
export const SAME_VALUE_CAP = 2;
export const WRONG_FEEDBACK_MS = 300;
export const ELIMINATE_MS = 400;
export const FILL_MS = 200;

/** 档位只决定干扰与补块的数域（闭区间）；题目难度由练习内容本身决定。 */
export type Tier = 'A' | 'B';
export const TIER_RANGES: Readonly<Record<Tier, { readonly min: number; readonly max: number }>> = {
  A: { min: 0, max: 10 },
  B: { min: 0, max: 100 },
};

/** 玩法说明只为一年级、二年级定义了档位；出现未定档位的年级属文档缺口，应显式失败。 */
export function tierForGrade(grade: Grade): Tier {
  if (grade === 1) return 'A';
  if (grade === 2) return 'B';
  throw new RangeError(`Grade ${grade} has no gameplay tier; update docs/gameplay-number-puzzle.md first`);
}

export interface RoundQuestion {
  readonly exerciseId: string;
  readonly task: MathTask;
  readonly tier: Tier;
}

/** null 表示已被消除且尚未补入的空位；仅在终局消除后出现，可操作时刻棋盘总是 12 块。 */
export type BoardSlot = number | null;

/**
 * questionIndex 指向「完成当前消除动画后将展示的题」：
 * asking 期间即当前题；答对后立即指向下一题（终局时等于 questions.length），
 * resoling 动画期间渲染层仍显示上一题，输入由 phase 拦截。
 */
export interface RoundState {
  readonly phase: 'asking' | 'wrong-feedback' | 'resolving' | 'finished';
  readonly questions: readonly RoundQuestion[];
  readonly questionIndex: number;
  readonly board: readonly BoardSlot[];
  readonly score: number;
  readonly firstTryCount: number;
  readonly totalWrongCount: number;
  readonly currentWrongCount: number;
}

export interface RoundSetup {
  /** 正式题集：对所选年级并集一次 selectExercises（或预览入口 previewExercises）的结果。 */
  readonly exercises: readonly Exercise[];
  /** 练习 → 关联年级（经 mappingIds → 单元 → 教材），多年级关联时取最高年级。 */
  readonly gradeOf: (exercise: Exercise) => Grade;
  readonly rng: Rng;
}

export interface FillInfo { readonly index: number; readonly value: number }
export interface GuaranteeInfo { readonly index: number; readonly from: number; readonly to: number }

export type ClickOutcome =
  | { readonly type: 'ignored' }
  | { readonly type: 'wrong'; readonly tileIndex: number; readonly wrongCount: number; readonly hintActive: boolean }
  | {
    readonly type: 'correct';
    readonly tileIndex: number;
    readonly removedValue: number;
    readonly gainedScore: number;
    readonly score: number;
    readonly firstTry: boolean;
    readonly fill: FillInfo | null;
    readonly guarantee: GuaranteeInfo | null;
    readonly nextQuestionIndex: number;
    /** 最后一题答对：不再补块，结算动画结束后进入 finished。 */
    readonly finished: boolean;
  };

/** Fisher–Yates 洗牌，自末位向前，j = floor(rng() × (i + 1))；消耗顺序见玩法说明。 */
function shuffle<T>(items: readonly T[], rng: Rng): readonly T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = a;
  }
  return arr;
}

/** 从档位数域取值 = 下界 + floor(rng() × 取值个数)；同值超过上限时再次消耗 rng 重取。 */
function drawTileValue(board: readonly BoardSlot[], range: { min: number; max: number }, rng: Rng): number {
  const count = range.max - range.min + 1;
  for (;;) {
    const value = range.min + Math.floor(rng() * count);
    if (board.filter(slot => slot === value).length < SAME_VALUE_CAP) return value;
  }
}

/**
 * 进入每道题前的保证规则：答案不在场时，按行优先索引顺序把第一个
 * 「数值不等于后续任何题目答案」的块改为答案值；若所有块都是后续题答案值，
 * 则改为第一个「数值不等于当前题答案」的块。只在答案数量为 0 时放置，不违反同值上限。
 */
function ensureAnswerReachable(
  board: BoardSlot[],
  questions: readonly RoundQuestion[],
  questionIndex: number,
): GuaranteeInfo | null {
  const question = questions[questionIndex];
  if (!question) throw new RangeError(`No question at index ${questionIndex}`);
  const answer = answerFor(question.task);
  if (board.some(slot => slot === answer)) return null;
  const futureAnswers = new Set(questions.slice(questionIndex + 1).map(item => answerFor(item.task)));
  let index = board.findIndex(slot => slot !== null && !futureAnswers.has(slot));
  if (index === -1) index = board.findIndex(slot => slot !== null && slot !== answer);
  if (index === -1) throw new Error('Reachability guarantee failed: no replaceable tile');
  const from = board[index] as number;
  board[index] = answer;
  return { index, from, to: answer };
}

export function createRound(setup: RoundSetup): RoundState {
  const { exercises, gradeOf, rng } = setup;
  if (!exercises.length) throw new RangeError('A round needs at least one exercise');
  // 消耗顺序固定：局序洗牌 → 初始棋盘 → 逐题补块。
  const ordered = shuffle(exercises, rng).slice(0, Math.min(QUESTIONS_PER_ROUND, exercises.length));
  const questions: RoundQuestion[] = ordered.map(exercise => ({
    exerciseId: exercise.id,
    task: exercise.task,
    tier: tierForGrade(gradeOf(exercise)),
  }));
  const board: BoardSlot[] = Array.from({ length: BOARD_TILES }, () => null);
  const firstRange = TIER_RANGES[questions[0]!.tier];
  for (let i = 0; i < BOARD_TILES; i++) board[i] = drawTileValue(board, firstRange, rng);
  ensureAnswerReachable(board, questions, 0);
  return {
    phase: 'asking',
    questions,
    questionIndex: 0,
    board: [...board],
    score: 0,
    firstTryCount: 0,
    totalWrongCount: 0,
    currentWrongCount: 0,
  };
}

export interface ClickResult {
  readonly state: RoundState;
  readonly outcome: ClickOutcome;
}

/**
 * 点选一个数字块。判定发生在点击瞬间，只看被点块的数值；
 * 非 asking 阶段（答错反馈 300ms、答对消除补块约 600ms、已结束）一律忽略，
 * 不计分、不判错、不累计错误数。答对即锁定该题：计分、消除、补块与
 * 下一题的保证规则都在本次转移内完成，动画只是表现。
 */
export function clickTile(state: RoundState, tileIndex: number, rng: Rng): ClickResult {
  if (state.phase !== 'asking') return { state, outcome: { type: 'ignored' } };
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= BOARD_TILES) {
    throw new RangeError(`tileIndex out of range: ${String(tileIndex)}`);
  }
  const question = state.questions[state.questionIndex]!;
  const value = state.board[tileIndex] as number;
  if (!evaluateAnswer(question.task, value)) {
    const wrongCount = state.currentWrongCount + 1;
    return {
      state: {
        ...state,
        phase: 'wrong-feedback',
        currentWrongCount: wrongCount,
        totalWrongCount: state.totalWrongCount + 1,
      },
      outcome: { type: 'wrong', tileIndex, wrongCount, hintActive: wrongCount >= HINT_THRESHOLD },
    };
  }
  const firstTry = state.currentWrongCount === 0;
  const gainedScore = firstTry ? FIRST_TRY_SCORE : RETRY_SCORE;
  const score = state.score + gainedScore;
  const isLast = state.questionIndex === state.questions.length - 1;
  const board: BoardSlot[] = [...state.board];
  board[tileIndex] = null;
  let fill: FillInfo | null = null;
  let guarantee: GuaranteeInfo | null = null;
  let nextQuestionIndex = state.questionIndex;
  if (isLast) {
    nextQuestionIndex = state.questions.length;
  } else {
    nextQuestionIndex = state.questionIndex + 1;
    const nextRange = TIER_RANGES[state.questions[nextQuestionIndex]!.tier];
    const filledValue = drawTileValue(board, nextRange, rng);
    board[tileIndex] = filledValue;
    fill = { index: tileIndex, value: filledValue };
    guarantee = ensureAnswerReachable(board, state.questions, nextQuestionIndex);
  }
  return {
    state: {
      ...state,
      phase: 'resolving',
      board,
      questionIndex: nextQuestionIndex,
      score,
      firstTryCount: state.firstTryCount + (firstTry ? 1 : 0),
      currentWrongCount: 0,
    },
    outcome: {
      type: 'correct',
      tileIndex,
      removedValue: value,
      gainedScore,
      score,
      firstTry,
      fill,
      guarantee,
      nextQuestionIndex,
      finished: isLast,
    },
  };
}

/** 答错反馈窗口（300ms）结束后由宿主调用，恢复本题判定。 */
export function endWrongFeedback(state: RoundState): RoundState {
  if (state.phase !== 'wrong-feedback') return state;
  return { ...state, phase: 'asking' };
}

/** 答对消除与补块动画结束后由宿主调用：进入下一题或结算。 */
export function completeResolve(state: RoundState): RoundState {
  if (state.phase !== 'resolving') return state;
  const finished = state.questionIndex >= state.questions.length;
  return { ...state, phase: finished ? 'finished' : 'asking' };
}
