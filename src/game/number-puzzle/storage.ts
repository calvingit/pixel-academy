// 旧 localStorage 档案的只读导入及持久化输入校验；新版存储见 profile.ts。
import { answerFor } from '../../learning/evaluation.js';
import type { Grade, MathTask } from '../../learning/models.js';

export const STORAGE_SCHEMA_VERSION = 1;

const STORAGE_KEY_PREFIX = 'pixel-academy:number-puzzle';

/** 仅导入已确认的 v1 设置、成绩和避重信息；旧中断键不读取、不删除。 */
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

/** 解析结果：empty = 无存档（首次使用）；invalid = 存在但损坏或字段非法。 */
export type Parsed<T> =
  | { readonly status: 'empty' }
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'invalid'; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const nonNegInt = (value: unknown): number | null => {
  const parsed = safeInt(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
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
function parseMathTaskShape(raw: unknown): MathTask | null {
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

export function parseMathTask(raw: unknown): MathTask | null {
  const task = parseMathTaskShape(raw);
  if (!task) return null;
  try { answerFor(task); return task; }
  catch (error) { if (error instanceof RangeError || error instanceof TypeError) return null; throw error; }
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

export interface KeyValueStore { getItem(key: string): string | null }
export class LegacyStorage {
  constructor(private readonly backend: KeyValueStore) {}
  loadSettings(): StoredSettingsV1 {
    const result = parseSettings(this.backend.getItem(STORAGE_KEYS.settings));
    return result.status === 'ok' ? result.value : DEFAULT_SETTINGS;
  }
  loadFinishedRecords(): readonly FinishedRoundRecordV1[] {
    const result = parseRecords(this.backend.getItem(STORAGE_KEYS.records));
    return result.status === 'ok' ? result.value.records : [];
  }
  loadRecentExerciseIds(): readonly string[] {
    const raw = this.backend.getItem(STORAGE_KEYS.recentExercises);
    if (!raw) return [];
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return []; }
    return Array.isArray(value) && value.length <= 10 && value.every(id => typeof id === 'string' && id.length > 0) ? value : [];
  }
}
