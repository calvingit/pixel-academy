// 拼音冒险本地存储：独立命名空间 KV（pixel-academy:pinyin-adventure:v1:*），
// 设置与成绩带 schemaVersion 和结构校验，损坏按首次使用处理；成绩按局次 ID 幂等。
// 不读写数字消除（IndexedDB 档案与其旧 localStorage 键）、汉字勇者、算术地下城的任何键；
// 成绩记录显式携带 gameId 且作答表现按辨认/听辨分开组织（PLAN M9 记录口径），
// 与其他游戏记录并列、可区分（解析层只接受本游戏 gameId）。
import { GAME_ID, QUESTIONS_PER_ROUND, STORE_PREFIX, parseSnapshot } from './rules.js';
import type { PinyinMode, RoundSnapshot } from './rules.js';
import type { Grade } from '../../learning/models.js';

export const STORAGE_SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  settings: `${STORE_PREFIX}:settings`,
  records: `${STORE_PREFIX}:records`,
  snapshot: `${STORE_PREFIX}:interrupted`,
  recentIds: `${STORE_PREFIX}:recent-ids`,
} as const;

export interface PinyinSettings {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly grades: readonly Grade[];
}

/** 每题作答表现：模式（辨认/听辨）、是否实际作答（跳过题为 false）、首答与答错数。 */
export interface PinyinAnswerQuestion {
  readonly exerciseId: string;
  readonly mode: PinyinMode;
  readonly answered: boolean;
  readonly firstTry: boolean;
  readonly wrongs: number;
}

export interface PinyinRecord {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly gameId: typeof GAME_ID;
  readonly finishedAt: string;
  readonly grades: readonly Grade[];
  readonly contentVersion: string;
  readonly score: number;
  readonly answer: { readonly questions: readonly PinyinAnswerQuestion[] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isGrade = (value: unknown): value is Grade =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;

const isMode = (value: unknown): value is PinyinMode => value === 'choose' || value === 'listen';

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

function parseGrades(raw: unknown): Grade[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const grades: Grade[] = [];
  for (const item of raw) {
    if (!isGrade(item)) return null;
    if (!grades.includes(item)) grades.push(item);
  }
  return grades;
}

function parseAnswerQuestions(raw: unknown): PinyinAnswerQuestion[] | null {
  if (!Array.isArray(raw) || raw.length > QUESTIONS_PER_ROUND) return null;
  const questions: PinyinAnswerQuestion[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.exerciseId !== 'string' || !item.exerciseId
      || !isMode(item.mode) || typeof item.answered !== 'boolean'
      || typeof item.firstTry !== 'boolean' || !nonNegInt(item.wrongs)) return null;
    questions.push({
      exerciseId: item.exerciseId, mode: item.mode,
      answered: item.answered, firstTry: item.firstTry, wrongs: item.wrongs,
    });
  }
  return questions;
}

/** 单条成绩校验：gameId 必须是本游戏，与其他游戏记录可区分。 */
export function parseRecord(raw: unknown): PinyinRecord | null {
  if (!isRecord(raw) || raw.schemaVersion !== STORAGE_SCHEMA_VERSION) return null;
  if (typeof raw.recordId !== 'string' || !raw.recordId || raw.gameId !== GAME_ID) return null;
  if (!isTimestamp(raw.finishedAt) || typeof raw.contentVersion !== 'string' || !raw.contentVersion) return null;
  const grades = parseGrades(raw.grades);
  const score = nonNegInt(raw.score) ? raw.score : null;
  const answer = isRecord(raw.answer) ? parseAnswerQuestions(raw.answer.questions) : null;
  if (!grades || score === null || !answer) return null;
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION, recordId: raw.recordId, gameId: GAME_ID,
    finishedAt: raw.finishedAt, grades, contentVersion: raw.contentVersion, score,
    answer: { questions: answer },
  };
}

/** 成绩列表解析：单条损坏只丢弃该条，其余历史成绩保留（不可重建的数据优先抢救）。 */
export function parseRecords(raw: string | null | undefined): readonly PinyinRecord[] {
  if (raw === null || raw === undefined || raw === '') return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!isRecord(data) || data.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(data.records)) return [];
  return data.records.map(item => parseRecord(item)).filter((record): record is PinyinRecord => record !== null);
}

export function parseSettingsValue(raw: unknown): PinyinSettings | null {
  if (!isRecord(raw) || raw.schemaVersion !== STORAGE_SCHEMA_VERSION) return null;
  const grades = parseGrades(raw.grades);
  return grades ? { schemaVersion: STORAGE_SCHEMA_VERSION, grades } : null;
}

export interface BuildRecordInput {
  readonly recordId: string;
  readonly finishedAt: string;
  readonly grades: readonly Grade[];
  readonly contentVersion: string;
  readonly score: number;
  readonly answered: readonly PinyinAnswerQuestion[];
}

/** 结算视图 → 成绩记录（纯函数，便于测试 gameId 与模式区分）。 */
export function buildRecord(input: BuildRecordInput): PinyinRecord {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    recordId: input.recordId,
    gameId: GAME_ID,
    finishedAt: input.finishedAt,
    grades: [...input.grades],
    contentVersion: input.contentVersion,
    score: input.score,
    answer: { questions: input.answered.map(item => ({ ...item })) },
  };
}

const read = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export interface PinyinStorage {
  readonly available: boolean;
  readonly settings: () => PinyinSettings;
  readonly saveSettings: (settings: PinyinSettings) => void;
  readonly records: () => readonly PinyinRecord[];
  readonly addRecord: (record: PinyinRecord) => boolean;
  readonly snapshot: () => RoundSnapshot | null;
  readonly saveSnapshot: (snapshot: RoundSnapshot) => boolean;
  readonly clearSnapshot: () => void;
  readonly recentIds: () => readonly string[];
  readonly saveRecentIds: (ids: readonly string[]) => void;
}

export function createPinyinStorage(): PinyinStorage {
  let available = true;
  try {
    const probe = `${STORE_PREFIX}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    available = false;
  }
  const empty: PinyinStorage = {
    available: false,
    settings: () => ({ schemaVersion: STORAGE_SCHEMA_VERSION, grades: [] }),
    saveSettings: () => {},
    records: () => [],
    addRecord: () => false,
    snapshot: () => null,
    saveSnapshot: () => false,
    clearSnapshot: () => {},
    recentIds: () => [],
    saveRecentIds: () => {},
  };
  if (!available) return empty;

  const MAX_RECORDS = 20;
  return {
    available: true,
    settings: () => parseSettingsValue(read(STORAGE_KEYS.settings)) ?? { schemaVersion: STORAGE_SCHEMA_VERSION, grades: [] },
    saveSettings: settings => { write(STORAGE_KEYS.settings, settings); },
    records: () => {
      const value = read(STORAGE_KEYS.records);
      if (!isRecord(value) || value.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(value.records)) return [];
      return value.records.map(item => parseRecord(item)).filter((record): record is PinyinRecord => record !== null);
    },
    addRecord: record => {
      if (!parseRecord(record)) return false;
      const existing = read(STORAGE_KEYS.records);
      const list = isRecord(existing) && Array.isArray(existing.records)
        ? existing.records.filter(item => !isRecord(item) || item.recordId !== record.recordId)
        : [];
      list.push(record);
      return write(STORAGE_KEYS.records, { schemaVersion: STORAGE_SCHEMA_VERSION, records: list.slice(-MAX_RECORDS) });
    },
    snapshot: () => parseSnapshot(read(STORAGE_KEYS.snapshot)),
    saveSnapshot: snapshot => write(STORAGE_KEYS.snapshot, snapshot),
    clearSnapshot: () => { try { localStorage.removeItem(STORAGE_KEYS.snapshot); } catch { /* 忽略 */ } },
    recentIds: () => {
      const value = read(STORAGE_KEYS.recentIds);
      return Array.isArray(value) && value.every(id => typeof id === 'string' && id) ? value as string[] : [];
    },
    saveRecentIds: ids => { write(STORAGE_KEYS.recentIds, ids); },
  };
}
