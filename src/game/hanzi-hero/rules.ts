// 汉字勇者纯规则模块：单局状态机、抽题、计分、快照恢复；无 DOM/存储依赖。
// 玩法说明：docs/gameplay-hanzi-hero.md（每局 5 题、候选排列组卷时局内洗牌——答案不恒在
// 前几位、首答 10 分/重试 5 分、不限时、无经济规则）。
import type { Exercise, Grade, Task } from '../../learning/models.js';
import { evaluateAnswer } from '../../learning/evaluation.js';
import { isHanziTask } from '../../learning/hanzi.js';

export const GAME_ID = 'hanzi-hero';
export const QUESTIONS_PER_ROUND = 5;
export const FIRST_TRY_SCORE = 10;
export const RETRY_SCORE = 5;
export const STORE_PREFIX = 'pixel-academy:hanzi-hero:v1';

export type Rng = () => number;

export interface RoundQuestion {
  readonly exerciseId: string;
  readonly task: Task;
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
  /** 组字题的当前勾选（单选模式为 undefined）。 */
  readonly selectedParts: readonly string[];
  readonly result: 'passed' | null;
}

export interface RoundSnapshot {
  readonly version: 1;
  readonly gameId: typeof GAME_ID;
  readonly roundId: string;
  readonly state: RoundState;
  readonly rngState: number;
  readonly previousIds: readonly string[];
}

/** Fisher–Yates 洗牌（消耗 rng），与数字消除同实现口径。 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** 从正式池抽一局：局内唯一、避开上一局；池不足 5 抛错（调用方阻止开局）。 */
export function createRound(
  exercises: readonly Exercise[],
  previousIds: readonly string[],
  rng: Rng,
): RoundState {
  if (exercises.length < QUESTIONS_PER_ROUND) {
    throw new RangeError(`hanzi-hero needs at least ${QUESTIONS_PER_ROUND} approved exercises`);
  }
  const previous = new Set(previousIds);
  // 优先抽上一局未出现的任务；不足时才允许重复（同一局内始终唯一）。
  const fresh = shuffle(exercises.filter(e => !previous.has(e.id)), rng);
  const repeated = shuffle(exercises.filter(e => previous.has(e.id)), rng);
  const pool = [...fresh, ...repeated];
  const picked = pool.slice(0, QUESTIONS_PER_ROUND);
  if (new Set(picked.map(e => e.id)).size < QUESTIONS_PER_ROUND) {
    throw new RangeError('Insufficient exercises for a round');
  }
  const questions: RoundQuestion[] = shuffle(picked, rng).map(e => {
    // 池类型为宽泛 Exercise<Task>：汉字勇者只接受语文任务，非语文任务在此快速失败。
    if (!isHanziTask(e.task)) throw new TypeError(`hanzi-hero pool contains non-Chinese task: ${e.id}`);
    return {
      exerciseId: e.id,
      // 候选顺序在组卷时用局内 rng 洗牌：目标字/正确部件不恒在前几位，不能靠位置、
      // 颜色或固定排列猜中（M8 验收原则）。洗牌结果随 RoundState 进入快照，恢复后
      // 排列一致；判题按字/部件身份（单选按字、组字按集合），与渲染位置无关。
      // 内容模块的原始排列不变。
      task: { ...e.task, options: shuffle(e.task.options, rng) },
    };
  });
  return {
    phase: 'asking', questions, questionIndex: 0, score: 0, firstTryCount: 0,
    totalWrongCount: 0, currentWrong: false, selectedParts: [], result: null,
  };
}

/** 多选模式（组字）切换勾选；单选模式拒绝。 */
export function togglePart(state: RoundState, option: string): RoundState {
  const task = state.questions[state.questionIndex]?.task;
  if (!task || task.kind !== 'hanzi-parts') throw new TypeError('Current task is not a parts question');
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const has = state.selectedParts.includes(option);
  return { ...state, selectedParts: has ? state.selectedParts.filter(p => p !== option) : [...state.selectedParts, option] };
}

export type SubmitOutcome = {
  readonly type: 'correct';
  readonly gained: number;
  readonly next: RoundState;
} | {
  readonly type: 'wrong';
  readonly next: RoundState;
};

/** 提交作答：单选传选项（字），多选传勾选集合。首答 10 分、重试 5 分；答对进入 resolving。 */
export function submitAnswer(state: RoundState, answer: string | readonly string[]): SubmitOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = state.questions[state.questionIndex];
  if (!question) throw new RangeError('No current question');
  const correct = evaluateAnswer(question.task, answer);
  if (!correct) {
    return {
      type: 'wrong',
      next: { ...state, currentWrong: true, totalWrongCount: state.totalWrongCount + 1, selectedParts: [] },
    };
  }
  const gained = state.currentWrong ? RETRY_SCORE : FIRST_TRY_SCORE;
  const next: RoundState = {
    ...state,
    phase: 'resolving',
    score: state.score + gained,
    firstTryCount: state.firstTryCount + (state.currentWrong ? 0 : 1),
    selectedParts: [],
  };
  return { type: 'correct', gained, next };
}

/** resolving → 下一题（终局时切 finished；由 UI 在短反馈后调用；不限时，无冻结换算）。 */
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

/** 结算视图：总分、首次答对、答错。 */
export function settlement(state: RoundState): { score: number; firstTry: number; wrong: number; total: number } {
  if (state.phase !== 'finished') throw new Error('Settlement requires finished phase');
  return {
    score: state.score,
    firstTry: state.firstTryCount,
    wrong: state.totalWrongCount,
    total: state.questions.length,
  };
}

/** 简单可种子化 RNG（mulberry32），仅用于局内抽题与恢复一致。 */
export function seededRng(state: number): Rng {
  let a = state >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 可快照 RNG：mulberry32 的内部状态 a 可直接读出恢复。 */
export function createSeededRng(seed: number): { rng: Rng; snapshot: () => number; restore: (state: number) => void } {
  let a = seed >>> 0;
  const rng: Rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { rng, snapshot: () => a >>> 0, restore: (s: number) => { a = s >>> 0; } };
}

/** 快照结构校验（损坏按首次使用处理，由调用方兜底）。 */
export function parseSnapshot(value: unknown): RoundSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.gameId !== GAME_ID || typeof v.roundId !== 'string' || typeof v.rngState !== 'number'
    || !Number.isSafeInteger(v.rngState) || v.rngState < 0 || v.rngState > 0xffffffff
    || !Array.isArray(v.previousIds) || !v.previousIds.every(x => typeof x === 'string')) return null;
  const s = v.state as Record<string, unknown> | undefined;
  if (!s || !['asking', 'resolving', 'finished'].includes(String(s.phase))
    || !Array.isArray(s.questions) || s.questions.length !== QUESTIONS_PER_ROUND
    || !s.questions.every((q: unknown) => typeof (q as Record<string, unknown>).exerciseId === 'string'
      && typeof (q as Record<string, unknown>).task === 'object')
    || typeof s.questionIndex !== 'number' || typeof s.score !== 'number'
    || typeof s.firstTryCount !== 'number' || typeof s.totalWrongCount !== 'number'
    || typeof s.currentWrong !== 'boolean' || !Array.isArray(s.selectedParts ?? [])
    || s.result !== null) return null;
  return value as RoundSnapshot;
}
