// 算术地下城本地存储：独立命名空间 KV（pixel-academy:arithmetic-dungeon:v1:*），
// 设置与成绩带 schemaVersion 和结构校验，损坏按首次使用处理；成绩按局次 ID 幂等。
// 不读写数字消除（IndexedDB 档案与其旧 localStorage 键）和汉字勇者的任何键；
// 成绩记录显式携带 gameId，与其他游戏记录并列、可区分（解析层只接受本游戏 gameId）。
import { GAME_ID, MAX_KEYS, STORE_PREFIX, parseSnapshot } from './rules.js';
import type { RoomId, RoundSnapshot, SlotId } from './rules.js';
import type { Grade } from '../../learning/models.js';

export const STORAGE_SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  settings: `${STORE_PREFIX}:settings`,
  records: `${STORE_PREFIX}:records`,
  snapshot: `${STORE_PREFIX}:interrupted`,
  recentIds: `${STORE_PREFIX}:recent-ids`,
} as const;

export interface DungeonSettings {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly grades: readonly Grade[];
}

/** 「作答表现」列：实际作答过的题目与首答/重试情况（用钥匙开门的门不计入）。 */
export interface DungeonAnswerQuestion {
  readonly slot: SlotId;
  readonly exerciseId: string;
  readonly firstTry: boolean;
  readonly wrongs: number;
}

/** 「探索决策」列：路线、钥匙使用与重试次数。 */
export interface DungeonExplore {
  readonly route: readonly RoomId[];
  readonly keysHeld: number;
  readonly keyUses: number;
  readonly retries: number;
}

export interface DungeonRecord {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly gameId: typeof GAME_ID;
  readonly finishedAt: string;
  readonly grades: readonly Grade[];
  readonly contentVersion: string;
  readonly score: number;
  readonly answer: { readonly questions: readonly DungeonAnswerQuestion[] };
  readonly explore: DungeonExplore;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonNegInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isGrade = (value: unknown): value is Grade =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;

const isRoomId = (value: unknown): value is RoomId =>
  value === 'start' || value === 'junction' || value === 'resource' || value === 'end';

const isSlotId = (value: unknown): value is SlotId =>
  value === 'resource' || value === 'gate-stone' || value === 'gate-left' || value === 'gate-right';

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

function parseAnswerQuestions(raw: unknown): DungeonAnswerQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  const questions: DungeonAnswerQuestion[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isSlotId(item.slot) || typeof item.exerciseId !== 'string' || !item.exerciseId
      || typeof item.firstTry !== 'boolean' || !nonNegInt(item.wrongs)) return null;
    questions.push({ slot: item.slot, exerciseId: item.exerciseId, firstTry: item.firstTry, wrongs: item.wrongs });
  }
  return questions;
}

function parseExplore(raw: unknown): DungeonExplore | null {
  if (!isRecord(raw) || !Array.isArray(raw.route) || !raw.route.every(isRoomId)
    || !nonNegInt(raw.keysHeld) || raw.keysHeld > MAX_KEYS
    || !nonNegInt(raw.keyUses) || !nonNegInt(raw.retries)) return null;
  return { route: [...raw.route], keysHeld: raw.keysHeld, keyUses: raw.keyUses, retries: raw.retries };
}

/** 单条成绩校验：gameId 必须是本游戏，与其他游戏记录可区分。 */
export function parseRecord(raw: unknown): DungeonRecord | null {
  if (!isRecord(raw) || raw.schemaVersion !== STORAGE_SCHEMA_VERSION) return null;
  if (typeof raw.recordId !== 'string' || !raw.recordId || raw.gameId !== GAME_ID) return null;
  if (!isTimestamp(raw.finishedAt) || typeof raw.contentVersion !== 'string' || !raw.contentVersion) return null;
  const grades = parseGrades(raw.grades);
  const score = nonNegInt(raw.score) ? raw.score : null;
  const answer = isRecord(raw.answer) ? parseAnswerQuestions(raw.answer.questions) : null;
  const explore = parseExplore(raw.explore);
  if (!grades || score === null || !answer || !explore) return null;
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION, recordId: raw.recordId, gameId: GAME_ID,
    finishedAt: raw.finishedAt, grades, contentVersion: raw.contentVersion, score,
    answer: { questions: answer }, explore,
  };
}

/** 成绩列表解析：单条损坏只丢弃该条，其余历史成绩保留（不可重建的数据优先抢救）。 */
export function parseRecords(raw: string | null | undefined): readonly DungeonRecord[] {
  if (raw === null || raw === undefined || raw === '') return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!isRecord(data) || data.schemaVersion !== STORAGE_SCHEMA_VERSION || !Array.isArray(data.records)) return [];
  return data.records.map(item => parseRecord(item)).filter((record): record is DungeonRecord => record !== null);
}

export function parseSettingsValue(raw: unknown): DungeonSettings | null {
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
  readonly answered: readonly { slot: SlotId; exerciseId: string; firstTry: boolean; wrongs: number }[];
  readonly route: readonly RoomId[];
  readonly keysHeld: number;
  readonly keyUses: number;
  readonly retries: number;
}

/** 结算视图 → 成绩记录（纯函数，便于测试 gameId 区分）。 */
export function buildRecord(input: BuildRecordInput): DungeonRecord {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    recordId: input.recordId,
    gameId: GAME_ID,
    finishedAt: input.finishedAt,
    grades: [...input.grades],
    contentVersion: input.contentVersion,
    score: input.score,
    answer: { questions: input.answered.map(item => ({ ...item })) },
    explore: { route: [...input.route], keysHeld: input.keysHeld, keyUses: input.keyUses, retries: input.retries },
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

export interface DungeonStorage {
  readonly available: boolean;
  readonly settings: () => DungeonSettings;
  readonly saveSettings: (settings: DungeonSettings) => void;
  readonly records: () => readonly DungeonRecord[];
  readonly addRecord: (record: DungeonRecord) => boolean;
  readonly snapshot: () => RoundSnapshot | null;
  readonly saveSnapshot: (snapshot: RoundSnapshot) => boolean;
  readonly clearSnapshot: () => void;
  readonly recentIds: () => readonly string[];
  readonly saveRecentIds: (ids: readonly string[]) => void;
}

export function createDungeonStorage(): DungeonStorage {
  let available = true;
  try {
    const probe = `${STORE_PREFIX}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    available = false;
  }
  const empty: DungeonStorage = {
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
      return value.records.map(item => parseRecord(item)).filter((record): record is DungeonRecord => record !== null);
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
