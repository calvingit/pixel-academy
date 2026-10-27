// 算术地下城纯规则模块：固定房间图、门/资源状态机、抽题、计分、钥匙与快照恢复；无 DOM/存储依赖。
// 玩法说明：docs/gameplay-arithmetic-dungeon.md（门题/资源题每题 10 秒由会话层注入时钟执行，
// 首答 10 分/重试 5 分、备用钥匙上限 1、答错不解锁不扣分可无限重试——任何路径无死局）。
// 判题一律走 Learning Core（evaluateAnswer）；本模块不重复判题。
import type { Exercise, MathTask } from '../../learning/models.js';
import { evaluateAnswer } from '../../learning/evaluation.js';

export const GAME_ID = 'arithmetic-dungeon';
export const FIRST_TRY_SCORE = 10;
export const RETRY_SCORE = 5;
/** 每局固定抽题数：3 道门题 + 1 道资源题。 */
export const QUESTIONS_NEEDED = 4;
/** 备用钥匙数量上限；资源机关答对取得，超出不重复发放。 */
export const MAX_KEYS = 1;
/** 门题/资源题每次作答尝试时长（毫秒）；与数字消除每题 10 秒同口径。 */
export const QUESTION_TIME_MS = 10_000;
export const STORE_PREFIX = 'pixel-academy:arithmetic-dungeon:v1';

export type Rng = () => number;

// ===== 固定房间图（首版手工定义，不随机生成） =====

export type RoomId = 'start' | 'junction' | 'resource' | 'end';
export type DoorId = 'gate-stone' | 'gate-left' | 'gate-right';
/** 作答机关：三扇门 + 资源房资源题。 */
export type SlotId = DoorId | 'resource';

export interface RoomDef { readonly id: RoomId; readonly name: string; readonly description: string }

export const ROOMS: Readonly<Record<RoomId, RoomDef>> = {
  start: { id: 'start', name: '起点', description: '石门前有一道算式机关，答对才能进入地下城。' },
  junction: { id: 'junction', name: '岔口', description: '左路通向资源房，右路直通终点房。选好路线再走。' },
  resource: { id: 'resource', name: '资源房', description: '石台上刻着一道资源机关，答对可以取得备用钥匙。' },
  end: { id: 'end', name: '终点房', description: '你走出了地下城，真厉害！' },
};

export interface DoorDef { readonly id: DoorId; readonly from: RoomId; readonly to: RoomId; readonly name: string }

export const DOORS: readonly DoorDef[] = [
  { id: 'gate-stone', from: 'start', to: 'junction', name: '石门' },
  { id: 'gate-left', from: 'junction', to: 'resource', name: '左门' },
  { id: 'gate-right', from: 'junction', to: 'end', name: '右门' },
];

const DOOR_BY_ID: ReadonlyMap<DoorId, DoorDef> = new Map(DOORS.map(door => [door.id, door]));

const isDoorId = (value: unknown): value is DoorId =>
  value === 'gate-stone' || value === 'gate-left' || value === 'gate-right';
const isRoomId = (value: unknown): value is RoomId =>
  value === 'start' || value === 'junction' || value === 'resource' || value === 'end';
const isSlotId = (value: unknown): value is SlotId => value === 'resource' || isDoorId(value);

/** 两个房间之间的门（双向通行，开门后任一方向自由经过）。 */
export function doorBetween(from: RoomId, to: RoomId): DoorDef | null {
  return DOORS.find(door => (door.from === from && door.to === to) || (door.from === to && door.to === from)) ?? null;
}

// ===== 局内状态 =====

export interface DungeonQuestion { readonly exerciseId: string; readonly task: MathTask }

export interface SlotState {
  /** 当前绑定的题目；答错换一题时替换，已消耗题目 ID 不再复用。 */
  readonly question: DungeonQuestion;
  /** 该机关累计答错/超时次数（跨换题累计，决定得分档与首答统计）。 */
  readonly wrongAttempts: number;
  readonly solved: boolean;
}

export type Slots = Readonly<Record<SlotId, SlotState>>;

export interface RoundState {
  readonly phase: 'exploring' | 'finished';
  readonly room: RoomId;
  readonly slots: Slots;
  /** 已开门（答对或用钥匙）；重复经过不重复出题、不重复计分。 */
  readonly openDoors: readonly DoorId[];
  readonly keys: number;
  readonly keyUses: number;
  /** 探索决策路线（按移动顺序记录，含折回）。 */
  readonly route: readonly RoomId[];
  readonly score: number;
  readonly firstTryCount: number;
  readonly totalWrongCount: number;
  /** 本局已消耗的题目 ID（含被换掉的），抽新题时避开。 */
  readonly usedIds: readonly string[];
  /** 实际作答过的机关（用钥匙开门不计入作答表现）。 */
  readonly answeredSlots: readonly SlotId[];
  /** 当前正在作答的机关（门题面板/资源机关打开时非空）。 */
  readonly activeSlot: SlotId | null;
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
  readonly grades: readonly (1 | 2 | 3 | 4 | 5 | 6)[];
  /** 内容版本指纹：不兼容时安全放弃进度。 */
  readonly contentVersion: string;
  readonly timer: {
    readonly paused: boolean;
    readonly remainingMs: number;
    readonly deadline: number | null;
    /** 与数字消除 TimedSession 同形；地下城只使用 'question' 与 null。 */
    readonly timerKind: 'question' | 'resolve' | null;
  };
}

// ===== 抽题 =====

/**
 * 抽一道新题：本局内不重复（排除 usedIds），优先避开上一局题目（previousIds）；
 * 上一局题目之外的候选用尽时才允许与其重复；完全没有未用题目时返回 null（调用方提示题库不足）。
 */
export function drawQuestion(
  exercises: readonly Exercise<MathTask>[],
  usedIds: readonly string[],
  previousIds: readonly string[],
  rng: Rng,
): DungeonQuestion | null {
  const used = new Set(usedIds);
  const unused = exercises.filter(exercise => !used.has(exercise.id));
  if (!unused.length) return null;
  const previous = new Set(previousIds);
  const fresh = unused.filter(exercise => !previous.has(exercise.id));
  const pool = fresh.length ? fresh : unused;
  const exercise = pool[Math.floor(rng() * pool.length)]!;
  return { exerciseId: exercise.id, task: exercise.task };
}

const SLOT_DRAW_ORDER: readonly SlotId[] = ['gate-stone', 'gate-left', 'gate-right', 'resource'];

/** 开局绑定 4 道题（3 门题 + 1 资源题），彼此不重复；正式池不足时抛错（由可用性检查拦截开局）。 */
export function createRound(
  exercises: readonly Exercise<MathTask>[],
  previousIds: readonly string[],
  rng: Rng,
): RoundState {
  if (exercises.length < QUESTIONS_NEEDED) {
    throw new RangeError(`arithmetic-dungeon needs at least ${QUESTIONS_NEEDED} approved exercises`);
  }
  const slots = {} as Record<SlotId, SlotState>;
  const usedIds: string[] = [];
  for (const slot of SLOT_DRAW_ORDER) {
    const drawn = drawQuestion(exercises, usedIds, previousIds, rng);
    if (!drawn) throw new RangeError('Insufficient exercises for a dungeon run');
    usedIds.push(drawn.exerciseId);
    slots[slot] = { question: drawn, wrongAttempts: 0, solved: false };
  }
  return {
    phase: 'exploring', room: 'start', slots, openDoors: [], keys: 0, keyUses: 0,
    route: ['start'], score: 0, firstTryCount: 0, totalWrongCount: 0,
    usedIds, answeredSlots: [], activeSlot: null, result: null,
  };
}

// ===== 探索移动 =====

export interface MoveOption {
  readonly to: RoomId;
  /** 经过门非空；已开可自由通过，锁着需先解开门题。 */
  readonly door: DoorId | null;
  readonly locked: boolean;
}

/** 当前房间的可用路线；门开着即自由通行（重复经过不重复出题）。 */
export function moveOptions(state: RoundState): readonly MoveOption[] {
  const options: MoveOption[] = [];
  for (const other of Object.keys(ROOMS) as RoomId[]) {
    if (other === state.room) continue;
    const door = doorBetween(state.room, other);
    if (!door) continue;
    options.push({ to: other, door: door.id, locked: !state.openDoors.includes(door.id) });
  }
  return options;
}

/** 移动到相邻房间：门必须已开；到达终点房即通关。 */
export function moveTo(state: RoundState, to: RoomId): RoundState {
  if (state.phase !== 'exploring') throw new Error('探索已结束');
  const option = moveOptions(state).find(candidate => candidate.to === to);
  if (!option) throw new Error(`不能从 ${state.room} 前往 ${to}`);
  if (option.locked) throw new Error('门还锁着，先答对门题');
  const route = [...state.route, to];
  if (to === 'end') {
    return { ...state, phase: 'finished', room: to, route, activeSlot: null, result: 'passed' };
  }
  return { ...state, room: to, route, activeSlot: null };
}

/** 机关当前是否可作答：未解开且玩家在其门边（资源机关须在资源房）。 */
export function slotEngageable(state: RoundState, slot: SlotId): boolean {
  if (state.phase !== 'exploring' || state.slots[slot].solved) return false;
  if (slot === 'resource') return state.room === 'resource';
  const door = DOOR_BY_ID.get(slot)!;
  return (state.room === door.from || state.room === door.to) && !state.openDoors.includes(slot);
}

/** 打开门题/资源机关面板（由会话层同时启动 10 秒计时）。 */
export function engageSlot(state: RoundState, slot: SlotId): RoundState {
  if (!slotEngageable(state, slot)) throw new Error('当前不能作答该机关');
  return { ...state, activeSlot: slot };
}

export function disengage(state: RoundState): RoundState {
  return state.activeSlot === null ? state : { ...state, activeSlot: null };
}

// ===== 作答 =====

export type AnswerOutcome =
  | { readonly type: 'correct'; readonly gained: number; readonly next: RoundState }
  | { readonly type: 'wrong'; readonly next: RoundState };
export type TimeoutOutcome = { readonly type: 'timeout'; readonly next: RoundState };
export type AttemptOutcome = AnswerOutcome | TimeoutOutcome;

const requireActive = (state: RoundState): SlotId => {
  if (state.phase !== 'exploring' || !state.activeSlot) throw new Error('当前没有待答机关');
  if (state.slots[state.activeSlot].solved) throw new Error('机关已解开');
  return state.activeSlot;
};

const countWrong = (state: RoundState, slot: SlotId): RoundState => {
  const current = state.slots[slot];
  return {
    ...state,
    slots: { ...state.slots, [slot]: { ...current, wrongAttempts: current.wrongAttempts + 1 } },
    totalWrongCount: state.totalWrongCount + 1,
  };
};

/** 提交作答：单选传选项 ID，多选传 ID 集合，算式传整数字符串/数值。答错不解锁、不扣分。 */
export function answerActive(state: RoundState, answer: string | readonly string[]): AnswerOutcome {
  const slot = requireActive(state);
  const current = state.slots[slot];
  if (!evaluateAnswer(current.question.task, answer)) {
    return { type: 'wrong', next: countWrong(state, slot) };
  }
  const firstTry = current.wrongAttempts === 0;
  const gained = firstTry ? FIRST_TRY_SCORE : RETRY_SCORE;
  return {
    type: 'correct',
    gained,
    next: {
      ...state,
      slots: { ...state.slots, [slot]: { ...current, solved: true } },
      openDoors: slot === 'resource' ? state.openDoors : [...state.openDoors, slot as DoorId],
      // 资源机关答对取得备用钥匙；上限 1，超出不重复发放（资源机关本局只解开一次）。
      keys: slot === 'resource' ? Math.min(MAX_KEYS, state.keys + 1) : state.keys,
      score: state.score + gained,
      firstTryCount: state.firstTryCount + (firstTry ? 1 : 0),
      answeredSlots: [...state.answeredSlots, slot],
    },
  };
}

/** 超时按答错处理：不解锁、不扣分，可再试/换题/用钥匙。 */
export function timeoutActive(state: RoundState): TimeoutOutcome {
  const slot = requireActive(state);
  return { type: 'timeout', next: countWrong(state, slot) };
}

/** 换一题：为当前机关重抽一道未用过的题（保留答错档）；题库抽尽时状态不变并回报 exhausted。 */
export function retryActive(
  state: RoundState,
  exercises: readonly Exercise<MathTask>[],
  previousIds: readonly string[],
  rng: Rng,
): { readonly type: 'drawn'; readonly next: RoundState } | { readonly type: 'exhausted'; readonly next: RoundState } {
  const slot = requireActive(state);
  const drawn = drawQuestion(exercises, state.usedIds, previousIds, rng);
  if (!drawn) return { type: 'exhausted', next: state };
  return {
    type: 'drawn',
    next: {
      ...state,
      slots: { ...state.slots, [slot]: { ...state.slots[slot], question: drawn } },
      usedIds: [...state.usedIds, drawn.exerciseId],
    },
  };
}

/** 备用钥匙代替重试直接开门：不判题、不计分，作答表现不计入该门。 */
export function useKeyActive(state: RoundState): RoundState {
  const slot = requireActive(state);
  if (slot === 'resource') throw new Error('钥匙不能代替资源机关');
  if (state.keys < 1) throw new Error('没有备用钥匙');
  return {
    ...state,
    keys: state.keys - 1,
    keyUses: state.keyUses + 1,
    slots: { ...state.slots, [slot]: { ...state.slots[slot], solved: true } },
    openDoors: [...state.openDoors, slot],
  };
}

// ===== 结算 =====

export interface SlotResult {
  readonly slot: SlotId;
  readonly exerciseId: string;
  readonly firstTry: boolean;
  readonly wrongs: number;
}

export interface Settlement {
  readonly score: number;
  /** 作答表现：实际作答过的题目（用钥匙开门的门不计入）。 */
  readonly answered: readonly SlotResult[];
  readonly firstTry: number;
  /** 探索决策：路线、钥匙使用与重试（答错/超时）次数。 */
  readonly route: readonly RoomId[];
  readonly keysHeld: number;
  readonly keyUses: number;
  readonly retries: number;
}

export function settlement(state: RoundState): Settlement {
  if (state.phase !== 'finished') throw new Error('Settlement requires finished phase');
  const answered = state.answeredSlots.map(slot => ({
    slot,
    exerciseId: state.slots[slot].question.exerciseId,
    firstTry: state.slots[slot].wrongAttempts === 0,
    wrongs: state.slots[slot].wrongAttempts,
  }));
  return {
    score: state.score,
    answered,
    firstTry: state.firstTryCount,
    route: state.route,
    keysHeld: state.keys,
    keyUses: state.keyUses,
    retries: state.totalWrongCount,
  };
}

// ===== 快照 =====

const nonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseSlots(value: unknown): Slots | null {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const slots = {} as Record<SlotId, SlotState>;
  for (const slot of SLOT_DRAW_ORDER) {
    const raw = source[slot];
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    const question = entry.question as Record<string, unknown> | undefined;
    if (!question || typeof question.exerciseId !== 'string'
      || typeof question.task !== 'object' || question.task === null) return null;
    if (!nonNegInt(entry.wrongAttempts) || typeof entry.solved !== 'boolean') return null;
    slots[slot] = {
      question: { exerciseId: question.exerciseId, task: question.task as MathTask },
      wrongAttempts: entry.wrongAttempts,
      solved: entry.solved,
    };
  }
  return slots;
}

/** 快照结构校验（损坏按首次使用处理，由调用方兜底）；内容版本兼容性由调用方另行检查。 */
export function parseSnapshot(value: unknown): RoundSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.gameId !== GAME_ID || typeof v.roundId !== 'string'
    || typeof v.contentVersion !== 'string' || !v.contentVersion
    || !Array.isArray(v.grades) || !v.grades.length
    || !v.grades.every(g => typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 6)
    || !Array.isArray(v.previousIds) || !v.previousIds.every(x => typeof x === 'string')) return null;
  if (!nonNegInt(v.rngState) || v.rngState > 0xffffffff) return null;
  const s = v.state as Record<string, unknown> | undefined;
  if (!s) return null;
  if (!['exploring', 'finished'].includes(String(s.phase)) || !isRoomId(s.room)) return null;
  const slots = parseSlots(s.slots);
  if (!slots) return null;
  if (!Array.isArray(s.openDoors) || !s.openDoors.every(isDoorId)
    || new Set(s.openDoors).size !== s.openDoors.length) return null;
  if (s.keys !== 0 && s.keys !== 1) return null;
  // 钥匙只来自资源机关：资源未解开时不可能持有钥匙。
  if (!slots.resource.solved && s.keys !== 0) return null;
  if (!nonNegInt(s.keyUses) || !nonNegInt(s.score) || !nonNegInt(s.firstTryCount)
    || !nonNegInt(s.totalWrongCount)) return null;
  if (!Array.isArray(s.route) || !s.route.length || !s.route.every(isRoomId) || s.route[0] !== 'start') return null;
  if (!Array.isArray(s.usedIds) || !s.usedIds.every(id => typeof id === 'string' && id)) return null;
  // 每个机关当前绑定的题目必须仍在已消耗集合内（防止外部篡改导致重复出题）。
  for (const slot of SLOT_DRAW_ORDER) {
    if (!s.usedIds.includes(slots[slot].question.exerciseId)) return null;
  }
  if (!Array.isArray(s.answeredSlots) || !s.answeredSlots.every(isSlotId)
    || new Set(s.answeredSlots).size !== s.answeredSlots.length) return null;
  if (s.activeSlot !== null && !isSlotId(s.activeSlot)) return null;
  if (s.phase === 'finished' ? s.result !== 'passed' : s.result !== null) return null;
  // 机器不变式：门开 ⇔ 该门已解开；作答过的机关必已解开；到达终点房即通关；
  // 钥匙只来自资源机关且上限 1（持有 + 已用 = 1）。
  for (const door of ['gate-stone', 'gate-left', 'gate-right'] as const) {
    if (slots[door].solved !== (s.openDoors as DoorId[]).includes(door)) return null;
  }
  if (!s.answeredSlots.every(slot => slots[slot].solved)) return null;
  if ((s.room === 'end') !== (s.phase === 'finished')) return null;
  if (slots.resource.solved ? s.keys + s.keyUses !== 1 : s.keys !== 0 || s.keyUses !== 0) return null;
  const timer = v.timer as Record<string, unknown> | undefined;
  if (!timer || typeof timer.paused !== 'boolean' || !nonNegInt(timer.remainingMs)
    || (timer.deadline !== null && typeof timer.deadline !== 'number')
    // 地下城只使用 question 计时（'resolve' 属于数字消除，出现在地下城快照即损坏）。
    || (timer.timerKind !== null && timer.timerKind !== 'question')) return null;
  return v as unknown as RoundSnapshot;
}
