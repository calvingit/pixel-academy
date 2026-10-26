// 通用原创生成规则；审核范围与限制见 docs/content-review-generation.md。
import type { Exercise, Grade, MathTask } from '../../learning/models.js';
import type { Rng } from './rules.js';

export const GENERATION_VERSION = 'generated-v1';
const review: Exercise['review'] = {
  status: 'approved', reviewer: 'Codex（代理规则审核）', reviewedAt: '2026-10-26T06:11:53Z',
};

/** 穷举有限合法候选；交换加法或乘法的操作数不另建重复题。 */
export function generateExercises(): readonly Exercise[] {
  const result: Exercise[] = [];
  const add = (mapping: string, task: MathTask, parameters: string): void => {
    result.push({ id: `${GENERATION_VERSION}:${mapping}:${parameters}`, subject: 'math',
      mappingIds: [mapping], gameIds: ['number-puzzle'], task, review });
  };
  for (let value = 0; value <= 10; value++) add('MAP-006', { kind: 'number', value }, `${value}`);
  for (let left = 0; left <= 10; left++) {
    for (let right = left; left + right <= 10; right++) {
      add(left + right <= 5 ? 'MAP-007' : 'MAP-010',
        { kind: 'binary', operator: '+', left, right }, `${left}+${right}`);
    }
  }
  for (let left = 0; left <= 5; left++) {
    for (let right = 0; right <= left; right++) {
      add('MAP-008', { kind: 'binary', operator: '-', left, right }, `${left}-${right}`);
    }
  }
  for (let start = 0; start <= 100; start++) {
    for (const first of ['+', '-'] as const) {
      for (let a = 1; a <= 10; a++) {
        const middle = start + (first === '+' ? a : -a);
        if (middle < 0 || middle > 100) continue;
        for (const second of ['+', '-'] as const) {
          for (let b = 1; b <= 10; b++) {
            const answer = middle + (second === '+' ? b : -b);
            if (answer < 0 || answer > 100) continue;
            add('MAP-011', { kind: 'chain', start, steps: [
              { operator: first, operand: a }, { operator: second, operand: b },
            ] }, `${start}${first}${a}${second}${b}`);
          }
        }
      }
    }
  }
  for (let left = 2; left <= 5; left++) {
    for (let right = left; right <= 5; right++) {
      if (left * right >= 6 && left * right <= 12) {
        add('MAP-013', { kind: 'binary', operator: '*', left, right }, `${left}*${right}`);
      }
    }
  }
  return result;
}

/** 按当前题型配额抽题，优先选上一局未出现的候选；不足时才复用。 */
export function selectRoundExercises(
  exercises: readonly Exercise[], gradeOf: (exercise: Exercise) => Grade,
  rng: Rng, previousIds: readonly string[],
): readonly Exercise[] {
  const previous = new Set(previousIds);
  const grade1 = exercises.filter(exercise => gradeOf(exercise) === 1);
  const grade2 = exercises.filter(exercise => gradeOf(exercise) === 2);
  if (!grade1.length && !grade2.length) throw new RangeError('No generated exercises for selected grades');
  const mixed = grade1.length > 0 && grade2.length > 0;
  const result: Exercise[] = [];
  const take = (candidates: readonly Exercise[], count: number): void => {
    const fresh = candidates.filter(exercise => !previous.has(exercise.id));
    const repeated = candidates.filter(exercise => previous.has(exercise.id));
    if (candidates.length < count) throw new RangeError('Insufficient candidates for question quota');
    for (let i = 0; i < count; i++) {
      const pool = fresh.length ? fresh : repeated;
      const index = Math.floor(rng() * pool.length);
      result.push(pool[index]!);
      pool[index] = pool[pool.length - 1]!;
      pool.pop();
    }
  };
  if (grade1.length) {
    take(grade1.filter(e => e.task.kind === 'number'), mixed ? 1 : 2);
    take(grade1.filter(e => e.task.kind === 'binary' && e.task.operator === '+'), mixed ? 2 : 4);
    take(grade1.filter(e => e.task.kind === 'binary' && e.task.operator === '-'), mixed ? 2 : 4);
  }
  if (grade2.length) {
    take(grade2.filter(e => e.task.kind === 'chain'), mixed ? 3 : 6);
    take(grade2.filter(e => e.task.kind === 'binary' && e.task.operator === '*'), mixed ? 2 : 4);
  }
  return result;
}
