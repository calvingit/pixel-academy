import type { Exercise, Grade, MathTask, SubmittedAnswer } from '../../learning/models.js';
import type { RoundState } from './rules.js';
import { roundReward } from './rules.js';
import { parseMathTask, parseFinishedRecord } from './storage.js';
import type { FinishedRoundRecordV1 } from './storage.js';
import { isMultiple } from '../../learning/choice.js';
import { taskIdentity } from './learning.js';

export type Card = 'time' | 'hint' | 'revive' | 'rename';
export type Skin = 'garden' | 'autumn' | 'snow';
export type Avatar = 'lanlan' | 'cat' | 'rabbit' | 'owl';
export interface Product { readonly id: Card | Skin | Avatar; readonly name: string; readonly price: number; readonly kind: 'card' | 'skin' | 'avatar' }
export const PRODUCTS: readonly Product[] = [
  { id: 'time', name: '加时卡', price: 3, kind: 'card' }, { id: 'hint', name: '提醒卡', price: 10, kind: 'card' },
  { id: 'revive', name: '复活卡', price: 15, kind: 'card' }, { id: 'rename', name: '改名卡', price: 30, kind: 'card' },
  { id: 'cat', name: '小猫', price: 30, kind: 'avatar' }, { id: 'rabbit', name: '兔子', price: 50, kind: 'avatar' },
  { id: 'owl', name: '猫头鹰', price: 80, kind: 'avatar' },
  { id: 'autumn', name: '秋日果园', price: 100, kind: 'skin' }, { id: 'snow', name: '雪地小屋', price: 150, kind: 'skin' },
];
export interface Mistake {
  exercise: Exercise; grade: Grade; wrongs: number; timeouts: number;
  mastered: boolean; rewarded: boolean; lastAnswer?: SubmittedAnswer;
}
export interface Practice {
  courseId: string | null; reviewId: string | null; exercises: readonly Exercise[];
  index: number; correct: number; revealed: boolean; answered: boolean; passed: boolean;
  selectedIds?: readonly string[]; answer?: SubmittedAnswer;
}
export interface SavedChallenge {
  id: string; grades: readonly Grade[]; state: RoundState; rngState: number; contentVersion: string;
  paused: boolean; remainingMs: number; deadline: number | null; timerKind: 'question' | 'resolve' | null;
}
export interface ChallengeRecord {
  id: string; at: string; score: number; firstTryCount: number; totalWrongCount: number;
  totalTimeoutCount: number; revivals: number; completed: number; total: number; passed: boolean; coins: number;
}
export interface Profile {
  schemaVersion: 2; revision: number; coins: number; nickname: string;
  cards: Record<Card, number>; avatars: Avatar[]; skins: Skin[]; avatar: Avatar; skin: Skin;
  grades: Grade[]; soundOn: boolean; legacyRecords: readonly FinishedRoundRecordV1[];
  records: ChallengeRecord[]; settledRounds: string[]; recentIds: string[];
  courses: Record<string, { stage: 'reading' | 'example' | 'practice' | 'completed'; rewarded: boolean }>;
  mistakes: Record<string, Mistake>; challenge: SavedChallenge | null; practice: Practice | null;
}
export function createProfile(): Profile {
  return { schemaVersion: 2, revision: 0, coins: 20, nickname: '', cards: { time: 0, hint: 2, revive: 0, rename: 0 },
    avatars: ['lanlan'], skins: ['garden'], avatar: 'lanlan', skin: 'garden', grades: [], soundOn: true,
    legacyRecords: [], records: [], settledRounds: [], recentIds: [], courses: {}, mistakes: {}, challenge: null, practice: null };
}
export function buy(profile: Profile, id: Product['id']): void {
  const product = PRODUCTS.find(item => item.id === id);
  if (!product) throw new Error('商品不存在');
  if (product.kind === 'avatar' && profile.avatars.includes(id as Avatar)
    || product.kind === 'skin' && profile.skins.includes(id as Skin)) throw new Error('已经拥有，无需重复购买');
  if (profile.coins < product.price) throw new Error(`还差 ${product.price - profile.coins} 金币`);
  profile.coins -= product.price;
  if (product.kind === 'card') profile.cards[id as Card]++;
  if (product.kind === 'avatar') profile.avatars.push(id as Avatar);
  if (product.kind === 'skin') profile.skins.push(id as Skin);
}
export function consume(profile: Profile, card: Card): void {
  if (profile.cards[card] <= 0) throw new Error('道具库存不足');
  profile.cards[card]--;
}
export function rename(profile: Profile, input: string): void {
  const name = input.trim();
  const length = [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(name)].length;
  if (length < 1 || length > 8) throw new Error('昵称需为 1～8 个字符');
  if (name === profile.nickname) throw new Error('昵称没有变化');
  if (profile.nickname) consume(profile, 'rename');
  profile.nickname = name;
}
export function collectMistake(profile: Profile, exercise: Exercise, grade: Grade, reason: 'wrong' | 'timeout', answer?: SubmittedAnswer): void {
  const id = taskIdentity(exercise.task);
  const entry = profile.mistakes[id] ?? { exercise, grade, wrongs: 0, timeouts: 0, mastered: false, rewarded: false };
  entry.grade = grade;
  if (reason === 'wrong') {
    entry.wrongs++; entry.mastered = false;
    if (answer !== undefined) entry.lastAnswer = answer;
  }
  else { entry.timeouts++; if (!entry.wrongs) entry.mastered = false; }
  profile.mistakes[id] = entry;
}
export function rewardReview(profile: Profile, id: string, independent: boolean): number {
  const entry = profile.mistakes[id];
  if (!entry) throw new Error('错题不存在');
  if (entry.rewarded || !entry.wrongs || !independent) return 0;
  entry.rewarded = true;
  profile.coins += 2;
  return 2;
}
export function rewardCourse(profile: Profile, id: string): number {
  const progress = profile.courses[id];
  const practice = profile.practice;
  if (!practice || practice.courseId !== id || practice.index !== 3 || practice.correct !== 3 || !practice.passed) throw new Error('请先独立完成全部三题');
  if (progress?.rewarded) return 0;
  profile.courses[id] = { stage: 'completed', rewarded: true };
  profile.coins += 10;
  return 10;
}
export function settleChallenge(profile: Profile, challenge: SavedChallenge, now: string): number {
  if (profile.settledRounds.includes(challenge.id)) return 0;
  const state = challenge.state;
  const coins = roundReward(state);
  profile.coins += coins;
  profile.settledRounds.push(challenge.id);
  profile.records.push({ id: challenge.id, at: now, score: state.score, firstTryCount: state.firstTryCount,
    totalWrongCount: state.totalWrongCount, totalTimeoutCount: state.totalTimeoutCount, revivals: state.revivals,
    completed: state.questionIndex, total: state.questions.length, passed: state.result === 'passed', coins });
  profile.records = profile.records.slice(-100);
  profile.challenge = null;
  return coins;
}

const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(item => typeof item === 'string' && item.length > 0);
function validExercise(x: unknown): x is Exercise {
  return object(x) && typeof x.id === 'string' && x.subject === 'math' && strings(x.mappingIds)
    && strings(x.gameIds) && parseMathTask(x.task) !== null && object(x.review) && x.review.status === 'approved'
    && typeof x.review.reviewer === 'string' && typeof x.review.reviewedAt === 'string';
}
function validSelection(task: MathTask, selected: unknown): boolean {
  return Array.isArray(selected) && selected.every(id => typeof id === 'string') && new Set(selected).size === selected.length
    && (selected.length === 0 || task.kind === 'choice' && isMultiple(task) && selected.every(id => task.options.some(o => o.id === id)));
}
function validAnswer(task: MathTask, answer: unknown): boolean {
  if (task.kind !== 'choice') return typeof answer === 'number' && Number.isSafeInteger(answer);
  if (isMultiple(task)) return validSelection(task, answer) && (answer as string[]).length > 0;
  return typeof answer === 'string' && task.options.some(o => o.id === answer);
}
function validRound(x: unknown): x is RoundState {
  if (!object(x) || !['ready', 'asking', 'interrupted', 'resolving', 'finished'].includes(String(x.phase))
    || !Array.isArray(x.questions) || x.questions.length < 1 || x.questions.length > 10
    || !x.questions.every(q => object(q) && typeof q.exerciseId === 'string' && parseMathTask(q.task) && ['A', 'B'].includes(String(q.tier)))
    || !Array.isArray(x.board) || x.board.length !== 12 || !x.board.every(v => v === null || integer(v) && v <= 100)) return false;
  if (!['questionIndex', 'score', 'firstTryCount', 'totalWrongCount', 'currentWrongCount', 'totalTimeoutCount', 'revivals'].every(k => integer(x[k]))) return false;
  if (!['assisted', 'hintUsed', 'timeUsed'].every(k => typeof x[k] === 'boolean') || (x.revivals as number) > 2
    || (x.questionIndex as number) > x.questions.length || ![null, 'wrong', 'timeout'].includes(x.interruption as null)
    || ![null, 'passed', 'failed'].includes(x.result as null)
    || (x.firstTryCount as number) > (x.questionIndex as number)
    || x.score !== (x.firstTryCount as number) * 10 + ((x.questionIndex as number) - (x.firstTryCount as number)) * 5
    || (x.currentWrongCount as number) > (x.totalWrongCount as number)
    || x.hintUsed === true && x.assisted !== true
    || x.phase === 'interrupted' && (x.interruption === null || (x.revivals as number) >= 2)) return false;
  const current = x.questions[Math.min(x.questionIndex as number, x.questions.length - 1)] as { task: MathTask };
  if (x.selectedIds !== undefined && !validSelection(current.task, x.selectedIds)) return false;
  return x.phase === 'finished' ? x.result !== null : x.result === null && (x.phase === 'resolving' || (x.questionIndex as number) < x.questions.length);
}
export function parseProfile(value: unknown): Profile {
  if (!object(value) || value.schemaVersion !== 2 || !integer(value.revision) || !integer(value.coins)
    || typeof value.nickname !== 'string' || typeof value.soundOn !== 'boolean'
    || !Array.isArray(value.grades) || !value.grades.every(g => Number.isInteger(g) && g >= 1 && g <= 6)
    || !object(value.cards) || !['time', 'hint', 'revive', 'rename'].every(k => integer((value.cards as Record<string, unknown>)[k]))
    || !strings(value.avatars) || !value.avatars.every(v => ['lanlan', 'cat', 'rabbit', 'owl'].includes(v))
    || !strings(value.skins) || !value.skins.every(v => ['garden', 'autumn', 'snow'].includes(v))
    || !value.avatars.includes(String(value.avatar)) || !value.skins.includes(String(value.skin))
    || !Array.isArray(value.legacyRecords) || !value.legacyRecords.every(r => parseFinishedRecord(r))
    || !Array.isArray(value.records) || !value.records.every(r => object(r) && typeof r.id === 'string' && typeof r.at === 'string'
      && ['score', 'firstTryCount', 'totalWrongCount', 'totalTimeoutCount', 'revivals', 'completed', 'total', 'coins'].every(k => integer(r[k])) && typeof r.passed === 'boolean')
    || !strings(value.settledRounds) || !strings(value.recentIds) || !object(value.courses) || !object(value.mistakes)) throw new Error('本机档案格式损坏；未覆盖原数据，请重试或明确重置档案');
  for (const progress of Object.values(value.courses)) if (!object(progress) || !['reading', 'example', 'practice', 'completed'].includes(String(progress.stage)) || typeof progress.rewarded !== 'boolean') throw new Error('课程进度损坏');
  for (const [id, entry] of Object.entries(value.mistakes)) {
    if (!object(entry) || !validExercise(entry.exercise) || taskIdentity(entry.exercise.task) !== id || !integer(entry.wrongs) || !integer(entry.timeouts)
      || !Number.isInteger(entry.grade) || Number(entry.grade) < 1 || Number(entry.grade) > 6 || typeof entry.mastered !== 'boolean' || typeof entry.rewarded !== 'boolean'
      || entry.lastAnswer !== undefined && !validAnswer(entry.exercise.task, entry.lastAnswer)) throw new Error('错题记录损坏');
  }
  if (value.challenge !== null) {
    const c = value.challenge;
    if (!object(c) || typeof c.id !== 'string' || typeof c.contentVersion !== 'string' || !validRound(c.state)
      || !Array.isArray(c.grades) || !c.grades.length || !c.grades.every(g => Number.isInteger(g) && g >= 1 && g <= 6)
      || !integer(c.rngState) || c.rngState > 0xffffffff || typeof c.paused !== 'boolean' || typeof c.remainingMs !== 'number' || !Number.isFinite(c.remainingMs) || c.remainingMs < 0 || c.remainingMs > 15000
      || !(c.deadline === null || typeof c.deadline === 'number' && Number.isFinite(c.deadline))
      || ![null, 'question', 'resolve'].includes(c.timerKind as null)
      || c.state.phase === 'asking' && c.timerKind !== 'question'
      || c.state.phase === 'resolving' && c.timerKind !== 'resolve'
      || ['ready', 'interrupted'].includes(c.state.phase) && c.timerKind !== null) throw new Error('挑战存档损坏');
  }
  if (value.practice !== null) {
    const p = value.practice;
    if (!object(p) || !(p.courseId === null || typeof p.courseId === 'string') || !(p.reviewId === null || typeof p.reviewId === 'string')
      || !Array.isArray(p.exercises) || p.exercises.length < 1 || p.exercises.length > 3 || !p.exercises.every(validExercise)
      || !integer(p.index) || p.index >= p.exercises.length || !integer(p.correct) || p.correct > p.exercises.length
      || !['revealed', 'answered', 'passed'].every(k => typeof p[k] === 'boolean')) throw new Error('练习存档损坏');
    const task = (p.exercises[p.index] as Exercise).task;
    if (p.selectedIds !== undefined && !validSelection(task, p.selectedIds)
      || p.answer !== undefined && !validAnswer(task, p.answer)) throw new Error('练习答案损坏');
  }
  return value as unknown as Profile;
}

export interface ProfileBackend {
  read(): Promise<unknown>;
  update(expectedRevision: number | null | 'reset', next: Profile): Promise<void>;
}
export class ConflictError extends Error { constructor() { super('档案已在另一页面更新，已同步最新数据，请重新操作'); } }
export class PersistenceError extends Error {
  constructor(cause: unknown) { super('档案保存失败，本次操作未成功；已进入临时模式，刷新可重试读取。', { cause }); }
}
export class ProfileStore {
  constructor(private readonly backend: ProfileBackend) {}
  async load(initial: () => Profile): Promise<Profile> {
    const raw = await this.backend.read();
    if (raw !== undefined) return parseProfile(raw);
    const profile = initial();
    try { await this.backend.update(null, profile); }
    catch (error) { if (!(error instanceof ConflictError)) throw error; return parseProfile(await this.backend.read()); }
    return profile;
  }
  async commit(current: Profile, change: (draft: Profile) => void): Promise<Profile> {
    const next = structuredClone(current);
    change(next);
    next.revision = current.revision + 1;
    parseProfile(next);
    try { await this.backend.update(current.revision, next); }
    catch (error) { if (error instanceof ConflictError) throw error; throw new PersistenceError(error); }
    return next;
  }
  async reset(): Promise<Profile> {
    const next = createProfile();
    await this.backend.update('reset', next);
    return parseProfile(await this.backend.read());
  }
}
export async function openProfileStore(): Promise<ProfileStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pixel-academy', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('profiles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他旧版页面后重试'));
  });
  db.onversionchange = () => db.close();
  return new ProfileStore({
    read: () => new Promise((resolve, reject) => {
      const tx = db.transaction('profiles', 'readonly');
      const request = tx.objectStore('profiles').get('local');
      request.onsuccess = () => resolve(request.result as unknown);
      tx.onabort = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    }),
    update: (expected, next) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('profiles', 'readwrite');
      const store = tx.objectStore('profiles');
      const request = store.get('local');
      let failure: Error | null = null;
      request.onsuccess = () => {
        const raw: unknown = request.result;
        if (expected !== 'reset' && (expected === null ? raw !== undefined : !object(raw) || raw.revision !== expected)) {
          failure = new ConflictError(); tx.abort(); return;
        }
        if (expected === 'reset') next.revision = object(raw) && integer(raw.revision) ? raw.revision + 1 : 0;
        store.put(next, 'local');
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('档案保存失败'));
      tx.onerror = () => { failure ??= tx.error; };
    }),
  });
}
