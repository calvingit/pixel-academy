import type { Exercise, Grade, MathTask } from '../../learning/models.js';
import { answerFor } from '../../learning/evaluation.js';
import type { Rng } from './rules.js';

export interface Course {
  readonly id: string;
  readonly title: string;
  readonly grade: Grade;
  readonly mappings: readonly string[];
  readonly explanation: string;
  readonly example: MathTask;
  readonly review: { readonly reviewer: string; readonly reviewedAt: string };
}

const review = { reviewer: 'Codex（代理内容审核）', reviewedAt: '2026-10-26T07:34:30Z' };
export const COURSES: readonly Course[] = [
  { id: 'numbers', title: '认识数字', grade: 1, mappings: ['MAP-006'],
    explanation: '数字表示数量。先看清要找的数字，再从数字块中选出相同的数字。0 表示一个也没有。', example: { kind: 'number', value: 3 }, review },
  { id: 'addition', title: '加法入门', grade: 1, mappings: ['MAP-007', 'MAP-010'],
    explanation: '加法把两部分合在一起。可以从一个数开始，接着往后数另一个数那么多步。加上 0，数量不变。',
    example: { kind: 'binary', operator: '+', left: 2, right: 3 }, review },
  { id: 'subtraction', title: '减法入门', grade: 1, mappings: ['MAP-008'],
    explanation: '减法表示从原来的数量中拿走一部分。可以从原来的数开始，往回数拿走的数量那么多步。减去 0，数量不变。',
    example: { kind: 'binary', operator: '-', left: 5, right: 2 }, review },
  { id: 'chain', title: '连续加减', grade: 2, mappings: ['MAP-011'],
    explanation: '只有加法和减法时，从左往右依次计算。先算出第一步的结果，再用这个结果继续算下一步。',
    example: { kind: 'chain', start: 30, steps: [{ operator: '+', operand: 5 }, { operator: '-', operand: 2 }] }, review },
  { id: 'dots', title: '乘法点阵', grade: 2, mappings: ['MAP-013'],
    explanation: '每行数量相同的圆点可以分组计数。有几行，就有几个同样多的数量。用“每行的数量 × 行数”可以求出一共有多少个圆点。',
    example: { kind: 'binary', operator: '*', left: 2, right: 3 }, review },
];

export function taskIdentity(task: MathTask): string {
  // 不包含局次、生成版本和映射 ID；保留顺序，避免合并不同点阵或运算题意。
  if (task.kind === 'number') return `number:${task.value}`;
  if (task.kind === 'binary') return `binary:${task.operator}:${task.left}:${task.right}`;
  return `chain:${task.start}:${task.steps.map(step => `${step.operator}:${step.operand}`).join(',')}`;
}

export function taskText(task: MathTask): string {
  if (task.kind === 'number') return `找出 ${task.value}`;
  if (task.kind === 'binary') return task.operator === '*'
    ? `${task.left} 行，每行 ${task.right} 个圆点，一共有多少个？`
    : `${task.left} ${task.operator === '-' ? '−' : '+'} ${task.right} = ?`;
  return `${task.start} ${task.steps.map(step => `${step.operator === '-' ? '−' : '+'} ${step.operand}`).join(' ')} = ?`;
}

export function explainTask(task: MathTask): string {
  const answer = answerFor(task);
  if (task.kind === 'number') return `题目要找的是 ${answer}，选择写着 ${answer} 的数字块。`;
  if (task.kind === 'binary') {
    if (task.operator === '*') return `把圆点按行分组：${task.left} 行，每行 ${task.right} 个。${Array(task.left).fill(task.right).join(' + ')} = ${answer}，所以一共有 ${answer} 个。`;
    return task.operator === '+' ? `把 ${task.left} 和 ${task.right} 合在一起：${task.left} + ${task.right} = ${answer}。`
      : `从 ${task.left} 中拿走 ${task.right}：${task.left} − ${task.right} = ${answer}。`;
  }
  let value = task.start;
  const steps = task.steps.map(step => {
    const before = value;
    value += step.operator === '+' ? step.operand : -step.operand;
    return `${before} ${step.operator === '+' ? '+' : '−'} ${step.operand} = ${value}`;
  });
  return `从左往右计算：${steps.join('；')}。答案是 ${answer}。`;
}

/** 输入必须来自正式 selectExercises；抽取课程范围内三道不同题，不足时显式失败。 */
export function selectCourseExercises(course: Course, exercises: readonly Exercise[], rng: Rng): readonly Exercise[] {
  const pool = exercises.filter(e => e.review.status === 'approved' && e.mappingIds.some(id => course.mappings.includes(id)));
  const chosen: Exercise[] = [];
  while (chosen.length < 3) {
    if (!pool.length) throw new Error('课程已审核练习不足 3 道');
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return chosen;
}
