import { correctOptionIds, isMultiple } from './choice.js';
import { correctHanziIds, isHanziTask, isHanziMultiple } from './hanzi.js';
import { correctPinyinAnswer, isPinyinTask } from './pinyin.js';
import { englishDeliveryResult, isEnglishTask } from './english.js';
import { correctShapeAnswer, isShapeTask, shapePlaceResult } from './shapes.js';
import type { Task } from './models.js';

import { answerFor } from './arithmetic.js';
export { answerFor } from './arithmetic.js';

export function evaluateAnswer(task: Task, answer: unknown): boolean {
  if (isHanziTask(task)) {
    const expected = correctHanziIds(task);
    if (!isHanziMultiple(task)) return typeof answer === 'string' && answer === expected[0];
    return Array.isArray(answer) && answer.every(id => typeof id === 'string')
      && new Set(answer).size === answer.length && answer.length === expected.length
      && expected.every(id => answer.includes(id));
  }
  if (isPinyinTask(task)) {
    return typeof answer === 'string' && answer === correctPinyinAnswer(task);
  }
  if (isEnglishTask(task)) {
    return englishDeliveryResult(task, answer).complete;
  }
  if (isShapeTask(task)) {
    if (task.kind === 'shape-choose') {
      return typeof answer === 'string' && answer === correctShapeAnswer(task);
    }
    return shapePlaceResult(task, answer).complete;
  }
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

export function validateTask(task: Task): void {
  if (isHanziTask(task)) { correctHanziIds(task); return; }
  if (isPinyinTask(task)) { correctPinyinAnswer(task); return; }
  if (isEnglishTask(task)) { englishDeliveryResult(task, null); return; }
  if (isShapeTask(task)) { correctShapeAnswer(task); return; }
  if (task.kind === 'choice') correctOptionIds(task);
  else answerFor(task);
}
