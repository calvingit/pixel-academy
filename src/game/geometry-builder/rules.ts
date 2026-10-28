// 几何建筑师纯规则模块：搭建局状态机、组卷（积木/分区/选项洗牌）、放置与判定、
// 计分与快照恢复；无 DOM/存储依赖。首版不限时（操作型任务，docs/m11-geometry-architect-plan
// 决策 7），不复用计时会话；无旋转操作（决策 6），积木以标准方向呈现。
// 判题一律走 Learning Core（shapePlaceResult / evaluateAnswer）；本模块不重复判题，
// 只组织作答契约并消费 Learning Core 的分解判定结果。
// 计分口径：首答 = choose 第一次选择 / classify 第一次整组提交 / build 第一次放置判定；
// 任一首次判定错误入重试档，答错不扣分可纠正，无死局；完成后 resolving 锁定不重复判定。
// 操作口径：点选/拖拽/撤回计入操作统计（placedByClick/placedByDrag/retractions），
// 不构成作答尝试、不消耗首答档位（M10「语言作答与移动操作分开」先例）。
import type { Grade, ShapeChooseTask, ShapePlaceTask, ShapeTask } from '../../learning/models.js';
import { shapePlaceResult } from '../../learning/shapes.js';

export const GAME_ID = 'geometry-builder';
export const QUESTIONS_PER_ROUND = 5;
export const FIRST_TRY_SCORE = 10;
export const RETRY_SCORE = 5;
export const STORE_PREFIX = 'pixel-academy:geometry-builder:v1';

export type Rng = () => number;
/** 记录口径按辨认/分类/搭建分开组织。 */
export type GeometryMode = 'choose' | 'classify' | 'build';

export const geometryMode = (task: ShapeTask): GeometryMode =>
  task.kind === 'shape-choose' ? 'choose' : task.mode;

/** 放置/作答结果：placed=布局已更新未判定（classify 点选、撤回后重放）；
 * judged=一次判定完成（choose 选择、classify 提交、build 放置即时判定）。 */
export type PlaceOutcome = {
  readonly type: 'placed';
  readonly next: RoundState;
} | {
  readonly type: 'judged';
  readonly complete: boolean;
  /** 完成时的得分增量（首答 10 / 重试 5）；未完成恒 0。 */
  readonly gained: number;
  /** 分步反馈：build 为逐槽状态；classify 为错块下标集合；choose 恒空。 */
  readonly slotOk: readonly boolean[];
  readonly wrongBlocks: readonly number[];
  readonly next: RoundState;
};

/** 放置状态：classify 每块当前归属的分区 id；build 每槽已放的形状（语义身份）。 */
export interface PlacementState {
  /** classify：blocks（呈现序）下标 → zone id；build：恒空数组。 */
  readonly byBlock: readonly (string | null)[];
  /** build：zones（呈现序）下标 → 已放形状；classify：恒空数组。 */
  readonly inSlot: readonly (string | null)[];
}

export interface RoundQuestion {
  readonly exerciseId: string;
  readonly task: ShapeTask;
  /** 积木呈现排列（组卷时洗牌；判题按形状身份与呈现位置无关）。 */
  readonly blocks: readonly string[];
  /** 分区/槽位呈现顺序（组卷时洗牌；accept 集合保持任务原语义）。 */
  readonly zones: readonly { readonly id: string; readonly accept: readonly string[] }[];
  /** 辨认选项排列（组卷时洗牌；正确答案不恒在首位）。 */
  readonly options: readonly string[];
  /** 当前放置状态（点选/拖拽修改；随快照保存，恢复后布局一致）。 */
  readonly placement: PlacementState;
}

export interface RoundState {
  readonly phase: 'asking' | 'resolving' | 'finished';
  readonly questions: readonly RoundQuestion[];
  readonly questionIndex: number;
  readonly score: number;
  readonly firstTryCount: number;
  readonly totalWrongCount: number;
  /** 当前任务是否已判错过（决定下一判定得分档）。 */
  readonly currentWrong: boolean;
  /** 每任务判定次数（choose 选择 / classify 提交 / build 放置判定；下标对齐 questions）。 */
  readonly attempts: readonly number[];
  /** 每任务错判次数（未完成判定；下标对齐 questions）。 */
  readonly wrongs: readonly number[];
  /** 每任务操作统计：点选放置 / 拖拽放置 / 撤回次数（下标对齐 questions）。 */
  readonly placedByClick: readonly number[];
  readonly placedByDrag: readonly number[];
  readonly retractions: readonly number[];
  /** 当前选中的积木（classify 点选路径的选中态；恢复后保持）。 */
  readonly selectedBlock: number | null;
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

/** Fisher–Yates 洗牌（消耗 rng），与既有四款游戏同实现口径。 */
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
 * 从正式池抽一局 5 任务：题型配额轮转（choose → classify → build 逐轮取题），
 * 首轮优先避开上一局任务 ID，轮转与兜底都不够时从全池补齐；局内唯一。
 * 每任务的积木排列、分区顺序与辨认选项在组卷时用局内 rng 洗牌——正确位置
 * 不长期固定（PLAN M11 验收），洗牌结果随 RoundState 进入快照，恢复后排列一致不重排。
 */
export function createRound(
  exercises: readonly { readonly id: string; readonly task: ShapeTask }[],
  previousIds: readonly string[],
  rng: Rng,
): RoundState {
  if (exercises.length < QUESTIONS_PER_ROUND) {
    throw new RangeError(`geometry-builder needs at least ${QUESTIONS_PER_ROUND} approved exercises`);
  }
  const previous = new Set(previousIds);
  const pickOrder: readonly GeometryMode[] = ['choose', 'classify', 'build'];
  const byMode = new Map<GeometryMode, { readonly id: string; readonly task: ShapeTask }[]>(
    pickOrder.map(mode => [mode, []]),
  );
  for (const exercise of shuffle(exercises, rng)) {
    byMode.get(geometryMode(exercise.task))!.push(exercise);
  }
  const picked: { readonly id: string; readonly task: ShapeTask }[] = [];
  const used = new Set<string>();
  const takeOne = (predicate: (e: { readonly id: string }) => boolean): boolean => {
    for (const mode of pickOrder) {
      const candidate = byMode.get(mode)!.find(e => !used.has(e.id) && predicate(e));
      if (candidate) { picked.push(candidate); used.add(candidate.id); return true; }
    }
    return false;
  };
  // 第 1 轮：每模式各取一题（避开上一局）；随后继续避重补满；避重不足时才从全池补齐。
  for (const mode of pickOrder) {
    if (picked.length >= QUESTIONS_PER_ROUND) break;
    const candidate = byMode.get(mode)!.find(e => !used.has(e.id) && !previous.has(e.id));
    if (candidate) { picked.push(candidate); used.add(candidate.id); }
  }
  while (picked.length < QUESTIONS_PER_ROUND && takeOne(e => !previous.has(e.id))) { /* 避重补满 */ }
  while (picked.length < QUESTIONS_PER_ROUND && takeOne(() => true)) { /* 兜底补满 */ }
  if (picked.length !== QUESTIONS_PER_ROUND || new Set(picked.map(e => e.id)).size !== QUESTIONS_PER_ROUND) {
    throw new RangeError('Insufficient exercises for a round');
  }
  const questions: RoundQuestion[] = picked.map(e => {
    const task = e.task;
    if (task.kind === 'shape-choose') {
      return {
        exerciseId: e.id, task,
        blocks: [], zones: [], options: shuffle(task.options, rng),
        placement: { byBlock: [], inSlot: [] },
      };
    }
    return {
      exerciseId: e.id, task,
      blocks: shuffle(task.blocks, rng),
      zones: shuffle(task.zones.map(z => ({ id: z.id, accept: [...z.accept] })), rng),
      options: [],
      placement: {
        byBlock: task.mode === 'classify' ? task.blocks.map(() => null) : [],
        inSlot: task.mode === 'build' ? task.zones.map(() => null) : [],
      },
    };
  });
  return {
    phase: 'asking', questions, questionIndex: 0, score: 0, firstTryCount: 0,
    totalWrongCount: 0, currentWrong: false,
    attempts: questions.map(() => 0), wrongs: questions.map(() => 0),
    placedByClick: questions.map(() => 0), placedByDrag: questions.map(() => 0),
    retractions: questions.map(() => 0),
    selectedBlock: null, result: null,
  };
}

// ===== 局内辅助 =====

const current = (state: RoundState): RoundQuestion => {
  const question = state.questions[state.questionIndex];
  if (!question) throw new RangeError('No current question');
  return question;
};

function withQuestion(
  state: RoundState,
  question: RoundQuestion,
  rest: Partial<RoundState>,
): RoundState {
  const questions = [...state.questions];
  questions[state.questionIndex] = question;
  return { ...state, questions, ...rest };
}

const bumpAt = (arr: readonly number[], index: number): number[] => {
  const next = [...arr];
  next[index] = next[index]! + 1;
  return next;
};

/** 判定完成/错误的公共收尾：完成入 resolving（计分），错误记错判（可纠正）。 */
function finishJudge(
  state: RoundState,
  attempts: readonly number[],
  complete: boolean,
  detail: { readonly slotOk: readonly boolean[]; readonly wrongBlocks: readonly number[] },
): PlaceOutcome {
  if (complete) {
    const gained = state.currentWrong ? RETRY_SCORE : FIRST_TRY_SCORE;
    return {
      type: 'judged', complete: true, slotOk: detail.slotOk, wrongBlocks: detail.wrongBlocks, gained,
      next: {
        ...state,
        phase: 'resolving',
        score: state.score + gained,
        firstTryCount: state.firstTryCount + (state.currentWrong ? 0 : 1),
        attempts,
      },
    };
  }
  const wrongs = bumpAt(state.wrongs, state.questionIndex);
  return {
    type: 'judged', complete: false, slotOk: detail.slotOk, wrongBlocks: detail.wrongBlocks, gained: 0,
    next: { ...state, attempts, wrongs, currentWrong: true, totalWrongCount: state.totalWrongCount + 1 },
  };
}

// ===== 点选路径 =====

/** 点选积木（classify 选中态高亮；再点同一块取消选中）。不判题、不计分、不构成作答。 */
export function selectBlock(state: RoundState, blockIndex: number): RoundState {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (question.task.kind !== 'shape-place' || question.task.mode !== 'classify') {
    throw new TypeError('Block selection only applies to classify tasks');
  }
  if (blockIndex < 0 || blockIndex >= question.blocks.length) throw new RangeError('Block out of range');
  return { ...state, selectedBlock: state.selectedBlock === blockIndex ? null : blockIndex };
}

/**
 * 点选放置：classify 把选中积木放入分区（未选中不构成放置）；build 把选中积木
 * （未选中则取首个未上场的语义块）放入槽位并即时判定。计入点选操作统计。
 */
export function placeByClick(state: RoundState, zoneIndex: number): PlaceOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (question.task.kind !== 'shape-place') throw new TypeError('Placement only applies to place tasks');
  if (zoneIndex < 0 || zoneIndex >= question.zones.length) throw new RangeError('Zone out of range');
  const zone = question.zones[zoneIndex]!;
  if (question.task.mode === 'classify') {
    const blockIndex = state.selectedBlock;
    if (blockIndex === null) throw new Error('Select a block before placing');
    const byBlock = [...question.placement.byBlock];
    byBlock[blockIndex] = zone.id;
    const moved = withQuestion(state,
      { ...question, placement: { ...question.placement, byBlock } },
      { placedByClick: bumpAt(state.placedByClick, state.questionIndex), selectedBlock: null });
    return { type: 'placed', next: moved };
  }
  // 占用按「每个形状还剩几块可拖」计：剩余 = 总块数 − 已放入该形状的块数
  //（同形状多块逐块消耗；不能按「形状是否出现过」跳过，否则同形状第二块被误判为已占用）。
  const usedShapes = question.placement.inSlot.filter(shape => shape !== null) as readonly string[];
  const remaining = new Map<string, number>();
  for (const shape of question.blocks) {
    remaining.set(shape, (remaining.get(shape) ?? 0) + 1);
  }
  for (const shape of usedShapes) {
    remaining.set(shape, (remaining.get(shape) ?? 1) - 1);
  }
  let pickIndex = state.selectedBlock;
  // 无选中（或选中的块已被占用/不满足该槽）时：取首个「有剩余且满足该槽 accept」的块——
  // 点槽位放置的默认语义是「给这个格子配一块合适的积木」，不能拿第一块未占用块硬塞。
  // acceptable 按呈现槽位（question.zones）的 accept 集合判断；zoneIndex 是呈现序下标。
  const acceptable = (shape: string): boolean => question.zones[zoneIndex]!.accept.includes(shape);
  if (pickIndex === null || usedShapes.includes(question.blocks[pickIndex]!)
    || !acceptable(question.blocks[pickIndex]!)) {
    pickIndex = question.blocks.findIndex(shape => (remaining.get(shape) ?? 0) > 0 && acceptable(shape));
    if (pickIndex < 0) throw new Error('No block available for this slot');
  }
  const inSlot = [...question.placement.inSlot];
  inSlot[zoneIndex] = question.blocks[pickIndex]!;
  const moved = withQuestion(state,
    { ...question, placement: { ...question.placement, inSlot } },
    { placedByClick: bumpAt(state.placedByClick, state.questionIndex), selectedBlock: null });
  return judgeBuild(moved, zoneIndex);
}

/** 拖拽放置：指定积木放入分区/槽位；build 即时判定。计入拖拽操作统计。 */
export function placeByDrag(state: RoundState, zoneIndex: number, blockIndex: number): PlaceOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (question.task.kind !== 'shape-place') throw new TypeError('Placement only applies to place tasks');
  if (zoneIndex < 0 || zoneIndex >= question.zones.length) throw new RangeError('Zone out of range');
  if (blockIndex < 0 || blockIndex >= question.blocks.length) throw new RangeError('Block out of range');
  if (question.task.mode === 'classify') {
    const byBlock = [...question.placement.byBlock];
    byBlock[blockIndex] = question.zones[zoneIndex]!.id;
    const moved = withQuestion(state,
      { ...question, placement: { ...question.placement, byBlock } },
      { placedByDrag: bumpAt(state.placedByDrag, state.questionIndex), selectedBlock: null });
    return { type: 'placed', next: moved };
  }
  // build：指定形状若已全部被占用（同形状多块），该拖拽不成立（积木栏无此块可拖）。
  const shape = question.blocks[blockIndex]!;
  const occupied = question.placement.inSlot.filter(s => s === shape).length;
  const available = question.blocks.filter(b => b === shape).length;
  if (occupied >= available) throw new RangeError('No such block available on the shelf');
  const inSlot = [...question.placement.inSlot];
  inSlot[zoneIndex] = shape;
  const moved = withQuestion(state,
    { ...question, placement: { ...question.placement, inSlot } },
    { placedByDrag: bumpAt(state.placedByDrag, state.questionIndex), selectedBlock: null });
  return judgeBuild(moved, zoneIndex);
}

/** build 即时判定：全槽判定走 Learning Core（shapePlaceResult）。
 * inSlot 按呈现槽位序存储，作答条目须用呈现 zones 的 id 映射（分区顺序组卷时洗牌过）。
 * 错判口径：本次放置的槽不可接受才计错判（中间槽的正确放置只累计判定次数，
 * 鼓励逐槽搭建，不错判、不进重试档）；全部槽已放且全对 → 任务完成（finishJudge 结算）。 */
function judgeBuild(state: RoundState, placedZoneIndex: number): PlaceOutcome {
  const question = current(state);
  const answer = question.placement.inSlot
    .map((shape, i) => shape === null ? null : `${shape}@${question.zones[i]!.id}`)
    .filter((entry): entry is string => entry !== null);
  const result = shapePlaceResult(question.task as ShapePlaceTask, answer);
  const allFilled = question.placement.inSlot.every(slot => slot !== null);
  const attempts = bumpAt(state.attempts, state.questionIndex);
  if (allFilled && result.complete) {
    return finishJudge(state, attempts, true, { slotOk: result.slotOk, wrongBlocks: [] });
  }
  // 本次放置槽的状态：slotOk 按 task.zones 语义序排列，按 zoneId 查找（呈现序已洗牌）。
  const placedZoneId = question.zones[placedZoneIndex]!.id;
  const placedOk = question.placement.inSlot[placedZoneIndex] !== null
    && result.slotOk[(question.task as ShapePlaceTask).zones.findIndex(z => z.id === placedZoneId)] === true;
  if (placedOk) {
    return {
      type: 'judged', complete: false, gained: 0,
      slotOk: result.slotOk, wrongBlocks: [],
      next: { ...state, attempts },
    };
  }
  const wrongs = bumpAt(state.wrongs, state.questionIndex);
  return {
    type: 'judged', complete: false, gained: 0,
    slotOk: result.slotOk, wrongBlocks: [],
    next: { ...state, attempts, wrongs, currentWrong: true, totalWrongCount: state.totalWrongCount + 1 },
  };
}

// ===== 提交与作答 =====

/** classify 整组提交：全部块已分配才构成提交；判定走 Learning Core，反馈错块集合。 */
export function submitClassify(state: RoundState): PlaceOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (question.task.kind !== 'shape-place' || question.task.mode !== 'classify') {
    throw new TypeError('submitClassify only applies to classify tasks');
  }
  if (question.placement.byBlock.some(slot => slot === null)) {
    throw new Error('All blocks must be placed before submitting');
  }
  const answer = question.placement.byBlock
    .map((zoneId, blockIndex) => `${question.blocks[blockIndex]}@${zoneId}`);
  const result = shapePlaceResult(question.task as ShapePlaceTask, answer);
  const attempts = bumpAt(state.attempts, state.questionIndex);
  return finishJudge(state, attempts, result.complete, { slotOk: [], wrongBlocks: result.wrongBlocks });
}

/** choose 作答：单选，第一次选择即判定（Learning Core evaluateAnswer 同口径：按答案名比较）。 */
export function answerChoose(state: RoundState, option: string): PlaceOutcome {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (question.task.kind !== 'shape-choose') throw new TypeError('answerChoose only applies to choose tasks');
  if (!question.options.includes(option)) throw new RangeError('Option not on the shelf');
  const attempts = bumpAt(state.attempts, state.questionIndex);
  return finishJudge(state, attempts, option === question.task.answer, { slotOk: [], wrongBlocks: [] });
}

// ===== 撤回 =====

/** 撤回（classify：块归回积木栏；build：槽位清空）。不判题不计分，计入撤回统计。 */
export function retract(state: RoundState, target: number): RoundState {
  if (state.phase !== 'asking') throw new Error('Input locked outside asking phase');
  const question = current(state);
  if (question.task.kind !== 'shape-place') throw new TypeError('Retraction only applies to place tasks');
  if (question.task.mode === 'classify') {
    if (target < 0 || target >= question.blocks.length) throw new RangeError('Block out of range');
    const byBlock = [...question.placement.byBlock];
    if (byBlock[target] === null) throw new RangeError('Block not placed');
    byBlock[target] = null;
    return withQuestion(state, { ...question, placement: { ...question.placement, byBlock } },
      { retractions: bumpAt(state.retractions, state.questionIndex), selectedBlock: null });
  }
  if (target < 0 || target >= question.zones.length) throw new RangeError('Slot out of range');
  const inSlot = [...question.placement.inSlot];
  if (inSlot[target] === null) throw new RangeError('Slot empty');
  inSlot[target] = null;
  return withQuestion(state, { ...question, placement: { ...question.placement, inSlot } },
    { retractions: bumpAt(state.retractions, state.questionIndex) });
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
    selectedBlock: null,
  };
}

export interface QuestionResult {
  readonly exerciseId: string;
  readonly mode: GeometryMode;
  readonly attempts: number;
  readonly wrongs: number;
  /** 首答 = 第一次判定即完成（无错判）。 */
  readonly firstTry: boolean;
}

export interface Settlement {
  readonly score: number;
  readonly firstTry: number;
  readonly wrong: number;
  readonly total: number;
  /** 放置操作口径：点选 / 拖拽 / 撤回次数总数，与图形作答分开呈现。 */
  readonly clicks: number;
  readonly drags: number;
  readonly retractions: number;
  readonly answered: readonly QuestionResult[];
}

export function settlement(state: RoundState): Settlement {
  if (state.phase !== 'finished') throw new Error('Settlement requires finished phase');
  const answered = state.questions.map((question, index) => ({
    exerciseId: question.exerciseId,
    mode: geometryMode(question.task),
    attempts: state.attempts[index]!,
    wrongs: state.wrongs[index]!,
    firstTry: state.wrongs[index] === 0,
  }));
  const sum = (arr: readonly number[]): number => arr.reduce((a: number, b: number) => a + b, 0);
  return {
    score: state.score,
    firstTry: state.firstTryCount,
    wrong: state.totalWrongCount,
    total: state.questions.length,
    clicks: sum(state.placedByClick),
    drags: sum(state.placedByDrag),
    retractions: sum(state.retractions),
    answered,
  };
}

// ===== 快照 =====

const nonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const sameMembers = (a: readonly unknown[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/** 快照结构校验（含任务结构再校验与排列一致性）；损坏按首次使用处理，由调用方兜底。 */
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
      || !Array.isArray(q.blocks) || !Array.isArray(q.zones) || !Array.isArray(q.options)
      || !Array.isArray(q.options)) return null;
    const task = q.task as ShapeTask;
    try {
      if (task.kind === 'shape-choose') {
        // 选项必须是任务候选的重新排列（恢复后不重排、也不能凭空换候选）。
        if (!sameMembers(q.options, task.options)) return null;
        if ((q.blocks as unknown[]).length !== 0 || (q.zones as unknown[]).length !== 0) return null;
      } else {
        if (!sameMembers(q.blocks, task.blocks)) return null;
        const zones = q.zones as readonly { id: string; accept: readonly string[] }[];
        // 分区顺序洗牌过：按 id 找回任务原分区核对语义，不按下标。
        if (zones.length !== task.zones.length
          || !zones.every(z => {
            if (!z || typeof z.id !== 'string') return false;
            const origin = task.zones.find(tz => tz.id === z.id);
            return origin !== undefined && sameMembers(z.accept, origin.accept);
          })) return null;
        if (new Set(zones.map(z => z.id)).size !== zones.length) return null;
        if ((q.options as unknown[]).length !== 0) return null;
      }
    } catch {
      return null;
    }
    // 放置状态合法性：数组长度与任务结构一致；值域合法。
    const placement = q.placement as Record<string, unknown> | undefined;
    if (!placement || !Array.isArray(placement.byBlock) || !Array.isArray(placement.inSlot)) return null;
    if (task.kind === 'shape-choose') {
      if (placement.byBlock.length !== 0 || placement.inSlot.length !== 0) return null;
    } else if (task.mode === 'classify') {
      if (placement.byBlock.length !== task.blocks.length || placement.inSlot.length !== 0) return null;
      if (!(placement.byBlock as unknown[]).every(slot => slot === null
        || (typeof slot === 'string' && task.zones.some(z => z.id === slot)))) return null;
    } else {
      if (placement.byBlock.length !== 0 || placement.inSlot.length !== task.zones.length) return null;
      if (!(placement.inSlot as unknown[]).every(slot => slot === null
        || (typeof slot === 'string' && task.blocks.includes(slot)))) return null;
    }
  }
  if (typeof s.questionIndex !== 'number' || !Number.isSafeInteger(s.questionIndex)
    || s.questionIndex < 0 || s.questionIndex >= QUESTIONS_PER_ROUND) return null;
  if (!nonNegInt(s.score) || s.score > QUESTIONS_PER_ROUND * FIRST_TRY_SCORE
    || !nonNegInt(s.firstTryCount) || s.firstTryCount > QUESTIONS_PER_ROUND
    || !nonNegInt(s.totalWrongCount) || typeof s.currentWrong !== 'boolean'
    || (s.selectedBlock !== null && (typeof s.selectedBlock !== 'number' || s.selectedBlock < 0))) return null;
  for (const key of ['attempts', 'wrongs', 'placedByClick', 'placedByDrag', 'retractions'] as const) {
    if (!Array.isArray(s[key]) || s[key]!.length !== QUESTIONS_PER_ROUND || !s[key]!.every(nonNegInt)) return null;
  }
  // 机器不变式：错判不多于判定、已完成任务至少一次判定、终局一致；选中块仅 classify asking 有效。
  const wrongs = s.wrongs as number[];
  const attempts = s.attempts as number[];
  for (let i = 0; i < QUESTIONS_PER_ROUND; i++) {
    if (wrongs[i]! > attempts[i]!) return null;
    if (attempts[i] === 0 && (i < s.questionIndex || s.phase === 'finished')) return null;
  }
  if (wrongs.reduce((a: number, b: number) => a + b, 0) !== s.totalWrongCount) return null;
  if (s.phase === 'finished' && s.questionIndex !== QUESTIONS_PER_ROUND - 1) return null;
  if ((s.phase === 'finished') !== (s.result === 'passed')) return null;
  if (s.selectedBlock !== null) {
    const question = s.questions[s.questionIndex] as Record<string, unknown> | null;
    const task = question?.task as ShapeTask | undefined;
    const blocks = question ? question.blocks as readonly string[] : null;
    if (!blocks || !task || task.kind !== 'shape-place' || task.mode !== 'classify'
      || s.selectedBlock >= blocks.length || s.phase !== 'asking') return null;
  }
  return v as unknown as RoundSnapshot;
}
