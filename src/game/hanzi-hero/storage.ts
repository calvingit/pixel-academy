// 汉字勇者本地存储：独立命名空间 KV，成绩按局次 ID 幂等；损坏按首次使用处理。
// 玩法说明：docs/gameplay-hanzi-hero.md（最多 20 条记录；不读写数字消除档案与旧键）。
import { STORE_PREFIX, parseSnapshot } from './rules.js';
import type { RoundSnapshot } from './rules.js';

export interface HanziRecord {
  readonly id: string;
  readonly at: string;
  readonly grades: readonly Grade[];
  readonly score: number;
  readonly firstTry: number;
  readonly wrong: number;
  readonly total: number;
}
type Grade = 1 | 2 | 3 | 4 | 5 | 6;

export interface HanziSettings { readonly grades: readonly Grade[] }

const KEY_SETTINGS = `${STORE_PREFIX}:settings`;
const KEY_RECORDS = `${STORE_PREFIX}:records`;
const KEY_SNAPSHOT = `${STORE_PREFIX}:interrupted`;
const KEY_RECENT = `${STORE_PREFIX}:recent-ids`;
const MAX_RECORDS = 20;

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

export interface HanziStorage {
  readonly available: boolean;
  readonly settings: () => HanziSettings;
  readonly saveSettings: (settings: HanziSettings) => void;
  readonly records: () => readonly HanziRecord[];
  readonly addRecord: (record: HanziRecord) => boolean;
  readonly snapshot: () => RoundSnapshot | null;
  readonly saveSnapshot: (snapshot: RoundSnapshot) => boolean;
  readonly clearSnapshot: () => void;
  readonly recentIds: () => readonly string[];
  readonly saveRecentIds: (ids: readonly string[]) => void;
}

export function createHanziStorage(): HanziStorage {
  let available = true;
  try {
    const probe = `${STORE_PREFIX}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    available = false;
  }
  const empty: HanziStorage = {
    available: false,
    settings: () => ({ grades: [] }),
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

  const validGrades = (value: unknown): value is readonly Grade[] =>
    Array.isArray(value) && value.length > 0 && value.every(g => Number.isInteger(g) && g >= 1 && g <= 6);

  return {
    available: true,
    settings: () => {
      const value = read(KEY_SETTINGS);
      return value !== null && typeof value === 'object' && validGrades((value as HanziSettings).grades)
        ? value as HanziSettings : { grades: [] };
    },
    saveSettings: settings => { write(KEY_SETTINGS, settings); },
    records: () => {
      const value = read(KEY_RECORDS);
      if (!Array.isArray(value)) return [];
      return value.filter(r => typeof r === 'object' && r !== null && typeof (r as HanziRecord).id === 'string'
        && typeof (r as HanziRecord).at === 'string' && validGrades((r as HanziRecord).grades)
        && typeof (r as HanziRecord).score === 'number' && typeof (r as HanziRecord).firstTry === 'number'
        && typeof (r as HanziRecord).wrong === 'number' && typeof (r as HanziRecord).total === 'number') as readonly HanziRecord[];
    },
    addRecord: record => {
      const existing = read(KEY_RECORDS);
      const list = Array.isArray(existing) ? existing.filter(r => (r as HanziRecord).id !== record.id) : [];
      list.push(record);
      const trimmed = list.slice(-MAX_RECORDS);
      return write(KEY_RECORDS, trimmed);
    },
    snapshot: () => {
      const parsed = parseSnapshot(read(KEY_SNAPSHOT));
      return parsed;
    },
    saveSnapshot: snapshot => write(KEY_SNAPSHOT, snapshot),
    clearSnapshot: () => { try { localStorage.removeItem(KEY_SNAPSHOT); } catch { /* 忽略 */ } },
    recentIds: () => {
      const value = read(KEY_RECENT);
      return Array.isArray(value) && value.every(x => typeof x === 'string') ? value as string[] : [];
    },
    saveRecentIds: ids => { write(KEY_RECENT, ids); },
  };
}
