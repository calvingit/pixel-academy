// 本地记录与恢复（PLAN.md M5）：纯逻辑存储层，无 DOM、无 localStorage 直接依赖。
// 宿主注入 KeyValueStore（浏览器入口注入 localStorage 适配器，见 main.ts）；
// 全部结构校验、版本判断、去重与上限在此完成，可被 node --test 直接覆盖
// （tests/storage.test.mjs：损坏数据、版本不兼容、重复写入、中断恢复一致性）。
//
// 版本方案（PLAN.md M5「存储键与结构带版本字段」）：
// - 存储键带模式版本：pixel-academy:number-puzzle:v1:{settings|records|interrupted}；
// - 每条 JSON 记录同时带 schemaVersion 字段（当前 1）；
// - 键或 schemaVersion 不认识的数据（解析失败、字段非法、未知版本）一律按首次使用
//   处理并保持可游玩；单个键损坏不影响其他键（历史成绩与设置不被误删）；
// - 内容版本（contentFingerprint）与局次快照一起保存：当前内容与快照构建时的
//   正式题集不一致时，中断局次按「内容已更新」安全放弃，历史成绩与设置不受影响。
//
// 中断快照保存恢复所需最小状态：完整单局规则状态（题目、棋盘、分数、阶段）、
// RNG 的 32 位内部状态、暂停标记与动画计时器剩余时长、已累计的逐题作答结果
// （与局次 recordId 绑定，恢复后继续累计，结算时凭同一 recordId 去重，不重复记录）。
import type { Grade, MathTask } from '../../learning/models.js';
import { BOARD_TILES, QUESTIONS_PER_ROUND } from './rules.js';
import type { BoardSlot, RoundState, Tier } from './rules.js';
import type { TimerKind } from './session.js';

export const STORAGE_SCHEMA_VERSION = 1;
/** 成绩上限：防止 localStorage 无限增长导致写入失败；超出时丢弃最旧的记录。 */
export const RECORDS_CAP = 100;

const STORAGE_KEY_PREFIX = 'pixel-academy:number-puzzle';

/** 存储键：键名携带模式版本；未来 schema 升级换新键，旧键按不认识的数据处理。 */
export const STORAGE_KEYS = {
  settings: `${STORAGE_KEY_PREFIX}:v${STORAGE_SCHEMA_VERSION}:settings`,
  records: `${STORAGE_KEY_PREFIX}:v${STORAGE_SCHEMA_VERSION}:records`,
  interrupted: `${STORAGE_KEY_PREFIX}:v${STORAGE_SCHEMA_VERSION}:interrupted`,
  recentExercises: `${STORAGE_KEY_PREFIX}:v${STORAGE_SCHEMA_VERSION}:recent-exercises`,
} as const;

export interface StoredSettingsV1 {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly selectedGrades: readonly Grade[];
  readonly soundOn: boolean;
}

export interface RoundRecordQuestionV1 {
  readonly exerciseId: string;
  readonly firstTry: boolean;
  readonly wrongCount: number;
  readonly score: number;
}

export interface FinishedRoundRecordV1 {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly gameId: string;
  readonly finishedAt: string;
  readonly grades: readonly Grade[];
  readonly contentVersion: string;
  readonly score: number;
  readonly firstTryCount: number;
  readonly totalWrongCount: number;
  readonly questions: readonly RoundRecordQuestionV1[];
}

export interface StoredRecordsV1 {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly records: readonly FinishedRoundRecordV1[];
}

export interface StoredRoundQuestionV1 {
  readonly exerciseId: string;
  readonly task: MathTask;
  readonly tier: Tier;
}

export interface StoredRoundStateV1 {
  readonly phase: RoundState['phase'];
  readonly questions: readonly StoredRoundQuestionV1[];
  readonly questionIndex: number;
  readonly board: readonly BoardSlot[];
  readonly score: number;
  readonly firstTryCount: number;
  readonly totalWrongCount: number;
  readonly currentWrongCount: number;
}

export interface StoredTimerV1 {
  readonly kind: TimerKind;
  readonly remainingMs: number;
}

export interface InterruptedRoundV1 {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly gameId: string;
  readonly recordId: string;
  readonly savedAt: string;
  readonly grades: readonly Grade[];
  readonly contentVersion: string;
  readonly round: StoredRoundStateV1;
  readonly rngState: number;
  readonly paused: boolean;
  readonly timers: readonly StoredTimerV1[];
  readonly results: readonly RoundRecordQuestionV1[];
}

/** 解析结果：empty = 无存档（首次使用）；invalid = 存在但损坏或字段非法。 */
export type Parsed<T> =
  | { readonly status: 'empty' }
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'invalid'; readonly reason: string };

export type RestoreCheck =
  | { readonly status: 'restorable' }
  | { readonly status: 'incompatible'; readonly reason: 'game-id' | 'content-version' };

// ---------------------------------------------------------------------------
// 基础校验工具
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const nonNegInt = (value: unknown): number | null => {
  const parsed = safeInt(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
};

const uint32 = (value: unknown): number | null => {
  const parsed = safeInt(value);
  return parsed !== null && parsed >= 0 && parsed <= 0xffffffff ? parsed : null;
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const isGrade = (value: unknown): value is Grade =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;

function parseGrades(raw: unknown): Grade[] | null {
  if (!Array.isArray(raw)) return null;
  const grades: Grade[] = [];
  for (const item of raw) {
    if (!isGrade(item)) return null;
    if (!grades.includes(item)) grades.push(item);
  }
  return grades;
}

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

/** MathTask 结构校验：口径与 learning/evaluation.ts 的 answerFor 一致（安全整数、白名单运算符、非空链）。 */
export function parseMathTask(raw: unknown): MathTask | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'number') {
    const value = safeInt(raw.value);
    return value === null ? null : { kind: 'number', value };
  }
  if (raw.kind === 'binary') {
    const left = safeInt(raw.left);
    const right = safeInt(raw.right);
    if (left === null || right === null || typeof raw.operator !== 'string') return null;
    if (raw.operator !== '+' && raw.operator !== '-' && raw.operator !== '*') return null;
    return { kind: 'binary', operator: raw.operator, left, right };
  }
  if (raw.kind === 'chain') {
    const start = safeInt(raw.start);
    if (start === null || !Array.isArray(raw.steps)) return null;
    const steps: { operator: '+' | '-'; operand: number }[] = [];
    for (const rawStep of raw.steps) {
      if (!isRecord(rawStep) || typeof rawStep.operator !== 'string') return null;
      const operand = safeInt(rawStep.operand);
      if (operand === null || (rawStep.operator !== '+' && rawStep.operator !== '-')) return null;
      steps.push({ operator: rawStep.operator, operand });
    }
    if (!steps.length) return null; // answerFor 拒绝空链
    return { kind: 'chain', start, steps };
  }
  return null;
}

function parseStoredRoundQuestion(raw: unknown): StoredRoundQuestionV1 | null {
  if (!isRecord(raw)) return null;
  const exerciseId = nonEmptyString(raw.exerciseId);
  if (!exerciseId || (raw.tier !== 'A' && raw.tier !== 'B')) return null;
  const task = parseMathTask(raw.task);
  return task ? { exerciseId, task, tier: raw.tier } : null;
}

function parseRecordQuestion(raw: unknown): RoundRecordQuestionV1 | null {
  if (!isRecord(raw)) return null;
  const exerciseId = nonEmptyString(raw.exerciseId);
  const wrongCount = nonNegInt(raw.wrongCount);
  const score = nonNegInt(raw.score);
  if (!exerciseId || wrongCount === null || score === null || typeof raw.firstTry !== 'boolean') return null;
  return { exerciseId, firstTry: raw.firstTry, wrongCount, score };
}

/** 单条成绩记录校验； GameStorage 追加前与 parseRecords 逐条过滤共用。 */
export function parseFinishedRecord(raw: unknown): FinishedRoundRecordV1 | null {
  if (!isRecord(raw) || raw.schemaVersion !== STORAGE_SCHEMA_VERSION) return null;
  const recordId = nonEmptyString(raw.recordId);
  const gameId = nonEmptyString(raw.gameId);
  const contentVersion = nonEmptyString(raw.contentVersion);
  if (!recordId || !gameId || !contentVersion || !isTimestamp(raw.finishedAt)) return null;
  const grades = parseGrades(raw.grades);
  if (!grades || !grades.length) return null;
  const score = nonNegInt(raw.score);
  const firstTryCount = nonNegInt(raw.firstTryCount);
  const totalWrongCount = nonNegInt(raw.totalWrongCount);
  if (score === null || firstTryCount === null || totalWrongCount === null) return null;
  if (!Array.isArray(raw.questions) || !raw.questions.length) return null;
  const questions: RoundRecordQuestionV1[] = [];
  for (const item of raw.questions) {
    const question = parseRecordQuestion(item);
    if (!question) return null;
    questions.push(question);
  }
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    recordId, gameId, finishedAt: raw.finishedAt, grades, contentVersion,
    score, firstTryCount, totalWrongCount, questions,
  };
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: StoredSettingsV1 = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  selectedGrades: [],
  soundOn: true,
};

export function parseSettings(raw: string | null | undefined): Parsed<StoredSettingsV1> {
  if (raw === null || raw === undefined || raw === '') return { status: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'json-parse' };
  }
  if (!isRecord(data) || data.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    return { status: 'invalid', reason: 'schema-version' };
  }
  const grades = parseGrades(data.selectedGrades);
  if (!grades || typeof data.soundOn !== 'boolean') return { status: 'invalid', reason: 'fields' };
  return { status: 'ok', value: { schemaVersion: STORAGE_SCHEMA_VERSION, selectedGrades: grades, soundOn: data.soundOn } };
}

/** 写入前净化：非法输入返回 null（调用方放弃写入），合法输入去重年级。 */
export function sanitizeSettings(raw: StoredSettingsV1): StoredSettingsV1 | null {
  const grades = parseGrades(raw.selectedGrades);
  if (!grades || typeof raw.soundOn !== 'boolean') return null;
  return { schemaVersion: STORAGE_SCHEMA_VERSION, selectedGrades: grades, soundOn: raw.soundOn };
}

// ---------------------------------------------------------------------------
// 成绩记录
// ---------------------------------------------------------------------------

export function parseRecords(raw: string | null | undefined): Parsed<StoredRecordsV1> {
  if (raw === null || raw === undefined || raw === '') return { status: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'json-parse' };
  }
  if (!isRecord(data) || data.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(data.records)) {
    return { status: 'invalid', reason: 'schema-version' };
  }
  // 逐条校验：单条损坏只丢弃该条，其余历史成绩保留（不可重建的数据优先抢救）。
  const records: FinishedRoundRecordV1[] = [];
  for (const item of data.records) {
    const record = parseFinishedRecord(item);
    if (record) records.push(record);
  }
  return { status: 'ok', value: { schemaVersion: STORAGE_SCHEMA_VERSION, records } };
}

/** 追加一条成绩：按 recordId 幂等去重（重复写入只留一条），并执行上限裁剪。 */
export function appendFinishedRecord(
  records: readonly FinishedRoundRecordV1[],
  record: FinishedRoundRecordV1,
): readonly FinishedRoundRecordV1[] {
  const kept = records.filter(existing => existing.recordId !== record.recordId);
  const next = [...kept, record];
  return next.length > RECORDS_CAP ? next.slice(next.length - RECORDS_CAP) : next;
}

// ---------------------------------------------------------------------------
// 中断局次快照
// ---------------------------------------------------------------------------

function parseStoredRound(raw: unknown): StoredRoundStateV1 | null {
  if (!isRecord(raw)) return null;
  const phase = raw.phase;
  if (phase !== 'asking' && phase !== 'wrong-feedback' && phase !== 'resolving' && phase !== 'finished') return null;
  if (!Array.isArray(raw.questions) || !raw.questions.length || raw.questions.length > QUESTIONS_PER_ROUND) return null;
  const questions: StoredRoundQuestionV1[] = [];
  for (const item of raw.questions) {
    const question = parseStoredRoundQuestion(item);
    if (!question) return null;
    questions.push(question);
  }
  const questionIndex = safeInt(raw.questionIndex);
  if (questionIndex === null) return null;
  const total = questions.length;
  // questionIndex 指向「完成当前动画后将展示的题」：asking/wrong-feedback 必然还有当前题；
  // resolving 可处于终局消除后（index === length）；finished 必然已指向末尾。
  const indexOk = phase === 'finished'
    ? questionIndex === total
    : phase === 'resolving'
      ? questionIndex >= 0 && questionIndex <= total
      : questionIndex >= 0 && questionIndex < total;
  if (!indexOk) return null;
  if (!Array.isArray(raw.board) || raw.board.length !== BOARD_TILES) return null;
  // null 空位仅在终局消除后出现（rules.ts BoardSlot 约定）；可操作时刻棋盘总是 12 块。
  const nullsAllowed = phase === 'finished' || (phase === 'resolving' && questionIndex === total);
  const board: BoardSlot[] = [];
  for (const slot of raw.board) {
    if (slot === null) {
      if (!nullsAllowed) return null;
      board.push(null);
      continue;
    }
    const value = safeInt(slot);
    if (value === null) return null;
    board.push(value);
  }
  const score = nonNegInt(raw.score);
  const firstTryCount = nonNegInt(raw.firstTryCount);
  const totalWrongCount = nonNegInt(raw.totalWrongCount);
  const currentWrongCount = nonNegInt(raw.currentWrongCount);
  if (score === null || firstTryCount === null || totalWrongCount === null || currentWrongCount === null) return null;
  return {
    phase, questions, questionIndex, board,
    score, firstTryCount, totalWrongCount, currentWrongCount,
  };
}

export function parseInterrupted(raw: string | null | undefined): Parsed<InterruptedRoundV1> {
  if (raw === null || raw === undefined || raw === '') return { status: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'json-parse' };
  }
  if (!isRecord(data) || data.schemaVersion !== STORAGE_SCHEMA_VERSION) {
    return { status: 'invalid', reason: 'schema-version' };
  }
  const gameId = nonEmptyString(data.gameId);
  const recordId = nonEmptyString(data.recordId);
  const contentVersion = nonEmptyString(data.contentVersion);
  if (!gameId || !recordId || !contentVersion || !isTimestamp(data.savedAt)) {
    return { status: 'invalid', reason: 'fields' };
  }
  const grades = parseGrades(data.grades);
  if (!grades || !grades.length) return { status: 'invalid', reason: 'grades' };
  const round = parseStoredRound(data.round);
  if (!round) return { status: 'invalid', reason: 'round-state' };
  const rngState = uint32(data.rngState);
  if (rngState === null || typeof data.paused !== 'boolean') return { status: 'invalid', reason: 'rng-or-paused' };
  if (!Array.isArray(data.timers) || data.timers.length > 2) return { status: 'invalid', reason: 'timers' };
  const timers: StoredTimerV1[] = [];
  for (const item of data.timers) {
    if (!isRecord(item) || (item.kind !== 'resolve' && item.kind !== 'feedback')) {
      return { status: 'invalid', reason: 'timers' };
    }
    const remainingMs = nonNegInt(item.remainingMs);
    if (remainingMs === null) return { status: 'invalid', reason: 'timers' };
    if (timers.some(timer => timer.kind === item.kind)) return { status: 'invalid', reason: 'timers' };
    timers.push({ kind: item.kind, remainingMs });
  }
  if (!Array.isArray(data.results)) return { status: 'invalid', reason: 'results' };
  const results: RoundRecordQuestionV1[] = [];
  for (const item of data.results) {
    const question = parseRecordQuestion(item);
    if (!question) return { status: 'invalid', reason: 'results' };
    results.push(question);
  }
  // 与规则状态交叉核对：结果逐题累计必须与分数、一次通过数、答错总数一致
  // （当前题未答完的答错次数记在 currentWrongCount 中，见 clickTile 的转移）。
  if (results.length !== Math.min(round.questionIndex, round.questions.length)) {
    return { status: 'invalid', reason: 'results-length' };
  }
  const scoreSum = results.reduce((sum, item) => sum + item.score, 0);
  const firstTrySum = results.reduce((sum, item) => sum + (item.firstTry ? 1 : 0), 0);
  const wrongSum = results.reduce((sum, item) => sum + item.wrongCount, 0);
  if (scoreSum !== round.score || firstTrySum !== round.firstTryCount) {
    return { status: 'invalid', reason: 'results-sum' };
  }
  if (wrongSum + round.currentWrongCount !== round.totalWrongCount) {
    return { status: 'invalid', reason: 'results-sum' };
  }
  return {
    status: 'ok',
    value: {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      gameId, recordId, savedAt: data.savedAt, grades, contentVersion,
      round, rngState, paused: data.paused, timers, results,
    },
  };
}

export interface SnapshotInput {
  readonly gameId: string;
  readonly recordId: string;
  readonly grades: readonly Grade[];
  readonly contentVersion: string;
  readonly round: RoundState;
  readonly rngState: number;
  readonly paused: boolean;
  readonly timers: readonly StoredTimerV1[];
  readonly results: readonly RoundRecordQuestionV1[];
  readonly savedAt: string;
}

/** 从运行中的单局构建中断快照（复制输入，不共享可变引用）。 */
export function buildInterruptedSnapshot(input: SnapshotInput): InterruptedRoundV1 {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    gameId: input.gameId,
    recordId: input.recordId,
    savedAt: input.savedAt,
    grades: [...input.grades],
    contentVersion: input.contentVersion,
    round: {
      phase: input.round.phase,
      questions: input.round.questions.map(question => ({
        exerciseId: question.exerciseId, task: question.task, tier: question.tier,
      })),
      questionIndex: input.round.questionIndex,
      board: [...input.round.board],
      score: input.round.score,
      firstTryCount: input.round.firstTryCount,
      totalWrongCount: input.round.totalWrongCount,
      currentWrongCount: input.round.currentWrongCount,
    },
    rngState: input.rngState >>> 0,
    paused: input.paused,
    timers: input.timers.map(timer => ({ kind: timer.kind, remainingMs: timer.remainingMs })),
    results: input.results.map(question => ({ ...question })),
  };
}

/** 从快照重建单局规则状态；结构合法性已由 parseInterrupted 保证。 */
export function roundFromSnapshot(snapshot: InterruptedRoundV1): RoundState {
  const round = snapshot.round;
  return {
    phase: round.phase,
    questions: round.questions.map(question => ({
      exerciseId: question.exerciseId, task: question.task, tier: question.tier,
    })),
    questionIndex: round.questionIndex,
    board: [...round.board],
    score: round.score,
    firstTryCount: round.firstTryCount,
    totalWrongCount: round.totalWrongCount,
    currentWrongCount: round.currentWrongCount,
  };
}

/**
 * 恢复前置检查：游戏不匹配或内容版本不一致时，中断局次必须放弃
 * （PLAN.md M5：内容版本不兼容时安全放弃并说明原因，不误删历史成绩与设置）。
 */
export function checkRestore(
  snapshot: InterruptedRoundV1,
  expected: { readonly gameId: string; readonly contentVersion: string },
): RestoreCheck {
  if (snapshot.gameId !== expected.gameId) {
    return { status: 'incompatible', reason: 'game-id' };
  }
  if (snapshot.contentVersion !== expected.contentVersion) {
    return { status: 'incompatible', reason: 'content-version' };
  }
  return { status: 'restorable' };
}

// ---------------------------------------------------------------------------
// 内容版本指纹
// ---------------------------------------------------------------------------

export interface ContentFingerprintEntry {
  readonly id: string;
  readonly grade: number;
  readonly task: MathTask;
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 内容版本：对正式题集（练习 ID、关联年级、任务）做顺序无关的确定性指纹。
 * fp1 前缀是算法版本；双通道 32 位 FNV-1a 拼接，避免引入异步哈希或新依赖。
 * 内容更新后指纹改变，旧的中断局次按不兼容处理（其逐题数据随快照自包含，
 * 此检查是为了不跨内容版本续局，见 PLAN.md M5 / M6 的版本策略）。
 */
export function contentFingerprint(entries: readonly ContentFingerprintEntry[]): string {
  const canonical = entries
    .map(entry => `${entry.id}|${entry.grade}|${JSON.stringify(entry.task)}`)
    .sort()
    .join('\n');
  const laneA = fnv1a32(canonical, 0x811c9dc5);
  const laneB = fnv1a32(canonical, 0x1b873593);
  const hex = (value: number): string => value.toString(16).padStart(8, '0');
  return `fp1:${entries.length}:${hex(laneA)}${hex(laneB)}`;
}

// ---------------------------------------------------------------------------
// 成绩记录构建
// ---------------------------------------------------------------------------

export interface FinishedRecordInput {
  readonly gameId: string;
  readonly recordId: string;
  readonly grades: readonly Grade[];
  readonly contentVersion: string;
  readonly state: RoundState;
  readonly results: readonly RoundRecordQuestionV1[];
  readonly finishedAt: string;
}

/** 结束局次 → 成绩记录；phase 非 finished 属宿主接线错误，显式失败。 */
export function buildFinishedRecord(input: FinishedRecordInput): FinishedRoundRecordV1 {
  if (input.state.phase !== 'finished') {
    throw new RangeError(`buildFinishedRecord requires a finished round, got ${input.state.phase}`);
  }
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    recordId: input.recordId,
    gameId: input.gameId,
    finishedAt: input.finishedAt,
    grades: [...input.grades],
    contentVersion: input.contentVersion,
    score: input.state.score,
    firstTryCount: input.state.firstTryCount,
    totalWrongCount: input.state.totalWrongCount,
    questions: input.results.map(question => ({ ...question })),
  };
}

// ---------------------------------------------------------------------------
// GameStorage：注入式 KV 存储门面（浏览器入口注入 localStorage 适配器）
// ---------------------------------------------------------------------------

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROBE_KEY = `${STORAGE_KEY_PREFIX}:probe`;

/**
 * 存储门面：构造时探测可用性（不可用 = 从未启用）；任何写入失败都会停用
 * 后续写入（读取退回默认值），游戏逻辑照常运行——「存储不可用或写入失败时
 * 仍可游玩」，由调用方通过 isEnabled() 显示无法持久保存的提示。
 */
export class GameStorage {
  private enabled: boolean;

  constructor(private readonly backend: KeyValueStore | null) {
    this.enabled = false;
    if (!backend) return;
    try {
      backend.setItem(PROBE_KEY, '1');
      backend.removeItem(PROBE_KEY);
      this.enabled = true;
    } catch {
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private readRaw(key: string): string | null {
    if (!this.enabled || !this.backend) return null;
    try {
      return this.backend.getItem(key);
    } catch {
      return null;
    }
  }

  private writeRaw(key: string, value: string): boolean {
    if (!this.enabled || !this.backend) return false;
    try {
      this.backend.setItem(key, value);
      return true;
    } catch {
      this.enabled = false; // 写入失败（如配额满）：停用持久化，游戏继续。
      return false;
    }
  }

  private removeRaw(key: string): void {
    if (!this.backend) return;
    try {
      this.backend.removeItem(key);
    } catch {
      // 删除失败保持现状：损坏数据会在下次 loadInterrupted 再次尝试自愈。
    }
  }

  loadSettings(): StoredSettingsV1 {
    const parsed = parseSettings(this.readRaw(STORAGE_KEYS.settings));
    return parsed.status === 'ok' ? parsed.value : DEFAULT_SETTINGS;
  }

  saveSettings(settings: StoredSettingsV1): boolean {
    const sanitized = sanitizeSettings(settings);
    if (!sanitized) return false;
    return this.writeRaw(STORAGE_KEYS.settings, JSON.stringify(sanitized));
  }

  loadFinishedRecords(): readonly FinishedRoundRecordV1[] {
    const parsed = parseRecords(this.readRaw(STORAGE_KEYS.records));
    return parsed.status === 'ok' ? parsed.value.records : [];
  }

  loadRecentExerciseIds(): readonly string[] {
    const raw = this.readRaw(STORAGE_KEYS.recentExercises);
    if (raw === null) return [];
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return []; }
    return Array.isArray(value) && value.length <= QUESTIONS_PER_ROUND
      && value.every(id => nonEmptyString(id) !== null) ? value : [];
  }

  saveRecentExerciseIds(ids: readonly string[]): boolean {
    if (ids.length > QUESTIONS_PER_ROUND || ids.some(id => !nonEmptyString(id))) return false;
    return this.writeRaw(STORAGE_KEYS.recentExercises, JSON.stringify(ids));
  }

  /** 追加成绩；recordId 已存在时不重复写入。返回 false 表示未持久化（不可用或写入失败）。 */
  appendFinishedRecord(record: FinishedRoundRecordV1): boolean {
    const validated = parseFinishedRecord(record);
    if (!validated) return false;
    const next = appendFinishedRecord(this.loadFinishedRecords(), validated);
    return this.writeRaw(STORAGE_KEYS.records, JSON.stringify({
      schemaVersion: STORAGE_SCHEMA_VERSION,
      records: next,
    }));
  }

  /** 读取中断快照；损坏（解析失败、字段非法）时移除该键并报告 invalid（自愈，按首次使用处理）。 */
  loadInterrupted(): Parsed<InterruptedRoundV1> {
    const parsed = parseInterrupted(this.readRaw(STORAGE_KEYS.interrupted));
    if (parsed.status === 'invalid') this.removeRaw(STORAGE_KEYS.interrupted);
    return parsed;
  }

  saveInterrupted(snapshot: InterruptedRoundV1): boolean {
    return this.writeRaw(STORAGE_KEYS.interrupted, JSON.stringify(snapshot));
  }

  clearInterrupted(): void {
    this.removeRaw(STORAGE_KEYS.interrupted);
  }

  /** 清除本地记录：设置、成绩与中断快照全部移除，回到首次使用状态。 */
  clearAll(): void {
    for (const key of Object.values(STORAGE_KEYS)) {
      this.removeRaw(key);
    }
  }
}
