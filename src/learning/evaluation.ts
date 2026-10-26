import { correctOptionIds, isMultiple } from './choice.js';
import type { MathTask } from './models.js';

import { answerFor } from './arithmetic.js';
export { answerFor } from './arithmetic.js';

export function evaluateAnswer(task: MathTask, answer: unknown): boolean {
  if (task.kind === 'choice') {
    const expected = correctOptionIds(task);
    if (!isMultiple(task)) return typeof answer === 'string' && answer === expected[0];
    return Array.isArray(answer) && answer.every(id => typeof id === 'string')
      && new Set(answer).size === answer.length && answer.length === expected.length
      && expected.every(id => answer.includes(id));
  }
  const expected = answerFor(task);
  // 不把空串、布尔值、小数、表达式或宽松解析结果当作数字答案。
  if (typeof answer === 'number') return Number.isSafeInteger(answer) && answer === expected;
  if (typeof answer !== 'string' || !/^-?\d+$/.test(answer.trim())) return false;
  const parsed = Number(answer.trim());
  return Number.isSafeInteger(parsed) && parsed === expected;
}

export function validateTask(task: MathTask): void {
  if (task.kind === 'choice') correctOptionIds(task);
  else answerFor(task);
}
