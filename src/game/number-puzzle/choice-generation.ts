// 通用原创候选；范围与审核记录见 docs/content-review-question-expansion.md。
import type { ChoiceOption, ChoiceQuestion, ChoiceTask, Exercise, Grade, ArithmeticTask } from '../../learning/models.js';
import { isMultiple, optionKey } from '../../learning/choice.js';
import { createSeededRng } from './random.js';

export const CHOICE_VERSION = 'choices-v3';
const subtractionReview: Exercise['review'] = { status: 'approved', reviewer: 'Codex（代理规则与内容审核）', reviewedAt: '2026-10-26T12:38:25Z' };
export const ADVANCED_REVIEW = { status: 'approved', reviewer: 'Codex（代理规则与内容审核）', reviewedAt: '2026-10-26T12:04:55Z' } as const;
export const CHOICE_REVIEW = { status: 'approved', reviewer: 'Codex（代理规则与内容审核）', reviewedAt: '2026-10-26T11:41:43Z' } as const;

export function generateChoiceExercises(): readonly Exercise[] {
  const result: Exercise[] = [];
  const add = (grade: Grade, question: ChoiceQuestion, values: readonly ChoiceOption['value'][], mapping: string, review: Exercise['review'] = CHOICE_REVIEW): void => {
    const options = values.map(value => ({ id: optionKey(value), value }));
    const id = `${CHOICE_VERSION}:${grade}:${JSON.stringify(question)}:${values.map(optionKey).sort().join(',')}`;
    const rng = createSeededRng(result.length + 1);
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j]!, options[i]!];
    }
    result.push({ id, subject: 'math', mappingIds: [mapping], gameIds: ['number-puzzle'],
      task: { kind: 'choice', question, options }, review });
  };
  for (const grade of [1, 2] as const) {
    const max = grade === 1 ? 10 : 100;
    const comparison = grade === 1 ? 'MAP-017' : 'MAP-018';
    for (let a = 0; a <= max; a++) {
      for (let b = a + 1; b <= Math.min(max, a + 10); b++) {
        for (const direction of ['max', 'min'] as const) {
          add(grade, { kind: 'extreme', direction }, [a, b], comparison);
          if (b + 2 <= max) add(grade, { kind: 'extreme', direction }, [a, b, b + 1, b + 2], comparison);
        }
      }
      for (const b of [...new Set([Math.max(0, a - 1), a, Math.min(max, a + 1)])]) {
        add(grade, { kind: 'symbol', left: a, right: b }, ['>', '<', '='], comparison);
        for (const relation of ['>', '<', '='] as const) add(grade,
          { kind: 'truth', left: { kind: 'number', value: a }, relation, right: { kind: 'number', value: b } }, [true, false], comparison);
      }
      if (a >= 2 && a <= max - 2) {
        for (const relation of ['>', '<'] as const) {
          // 等于边界必在干扰项中；另一侧至少两项，正确项数量随参数变化。
          const count = 2 + a % 3;
          const correct = Array.from({ length: Math.min(count, relation === '>' ? max - a : a) }, (_, i) => relation === '>' ? a + i + 1 : a - i - 1);
          const otherSide = Array.from({ length: max + 1 }, (_, i) => i).filter(n => relation === '>' ? n < a : n > a);
          const wrong = [a, ...otherSide.slice(0, 5 - correct.length)];
          if (wrong.every(n => n >= 0 && n <= max) && new Set([...correct, ...wrong]).size === 6) {
            add(grade, { kind: 'filter', relation, target: a }, [...correct, ...wrong], comparison);
          }
        }
      }
    }
    // 填空和计算判断只使用当前已审核运算的范围，不据数域扩大运算教学范围。
    const limit = grade === 1 ? 10 : 100;
    for (let total = 0; total <= limit; total++) for (let addend = 0; addend <= Math.min(total, 10); addend++) {
      const expected = total - addend;
      const values = [expected, ...[expected - 1, expected + 1, expected + 2, expected - 2].filter(n => n >= 0 && n <= limit)].slice(0, 4);
      add(grade, { kind: 'missing', total, addend }, values, grade === 1 ? 'MAP-019' : 'MAP-020');
      for (const delta of [-1, 0, 1]) {
        const claimed = total + delta;
        if (claimed < 0 || claimed > limit) continue;
        const mapping = grade === 1 ? (total <= 5 ? 'MAP-007' : 'MAP-010') : 'MAP-011';
        const left = grade === 1 ? { kind: 'binary' as const, operator: '+' as const, left: expected, right: addend }
          : { kind: 'chain' as const, start: expected, steps: [{ operator: '+' as const, operand: addend }] };
        add(grade, { kind: 'truth', left, relation: '=', right: { kind: 'number', value: claimed } }, [true, false], mapping);
      }
    }
  }
  const around = (answer: number, max: number): readonly number[] => [answer, ...Array.from({ length: max + 1 }, (_, i) => i)
    .filter(n => n !== answer).sort((a, b) => Math.abs(a - answer) - Math.abs(b - answer))].slice(0, 4);
  const plus = (left: number, right: number): ArithmeticTask => ({ kind: 'binary', operator: '+', left, right });
  const minus = (left: number, right: number): ArithmeticTask => ({ kind: 'binary', operator: '-', left, right });
  for (const grade of [1, 2] as const) {
    const max = grade === 1 ? 10 : 100;
    const comparison = grade === 1 ? 'MAP-017' : 'MAP-018';
    const ordering = grade === 1 ? 'MAP-021' : 'MAP-022';
    const composition = grade === 1 ? 'MAP-023' : 'MAP-024';
    const expressions = grade === 1 ? 'MAP-026' : 'MAP-027';
    for (let lower = 0; lower <= max - 4; lower++) for (const width of [4, 5]) {
      const upper = lower + width;
      const values = width === 4 ? [lower, lower + 1, lower + 2, lower + 3, upper, upper + 1]
        : [lower, lower + 1, lower + 2, lower + 3, lower + 4, upper];
      if (values.every(n => n <= max)) add(grade, { kind: 'range', lower, upper }, values, comparison, ADVANCED_REVIEW);
    }
    for (let value = 1; value < max; value++) for (const direction of ['before', 'after'] as const) {
      add(grade, { kind: 'neighbor', value, direction }, around(value + (direction === 'before' ? -1 : 1), max), ordering, ADVANCED_REVIEW);
    }
    for (const step of [1, 2, 5]) for (let start = 0; start + step * 4 <= max; start++) for (const index of [1, 2, 3]) {
      add(grade, { kind: 'sequence', start, step, length: 5, index }, around(start + step * index, max), ordering, ADVANCED_REVIEW);
    }
    for (let total = 0; total <= max; total++) for (let part = 0; part <= Math.min(total, 10); part++) {
      add(grade, { kind: 'composition', total, part }, around(total - part, max), composition, ADVANCED_REVIEW);
    }
    for (let a = 0; a <= max; a++) {
      for (const b of [...new Set([Math.max(0, a - 1), a, Math.min(max, a + 1)])]) {
        const left = plus(Math.floor(a / 2), a - Math.floor(a / 2));
        add(grade, { kind: 'expression-symbol', left, right: plus(b, 0) }, ['>', '<', '='], expressions, ADVANCED_REVIEW);
        if (b < max) add(grade, { kind: 'expression-symbol', left, right: minus(b + 1, 1) }, ['>', '<', '='], expressions, subtractionReview);
      }
      const correct = [plus(a, 0)];
      if (a > 0) correct.push(plus(a - 1, 1));
      if (a < max) correct.push(minus(a + 1, 1));
      if (correct.length < 3) correct.push(a === 0 ? minus(2, 2) : plus(a - 2, 2));
      const wrong = [a - 1, a + 1, a - 2, a + 2].filter(n => n >= 0 && n <= max).map(n => plus(n, 0));
      if (wrong.length < 3) wrong.push(plus(a === 0 ? 3 : max - 3, 0));
      add(grade, { kind: 'equivalent', target: a }, [...correct, ...wrong.slice(0, 3)], expressions, ADVANCED_REVIEW);
      for (let change = 0; change <= 5; change++) for (const operator of ['+', '-'] as const) {
        const answer = a + (operator === '+' ? change : -change);
        if (answer < 0 || answer > max) continue;
        add(grade, { kind: 'story', start: a, change, operator }, around(answer, max), grade === 1 ? 'MAP-028' : 'MAP-029', ADVANCED_REVIEW);
        if (operator === '-') for (const delta of [-1, 0, 1]) {
          const claimed = answer + delta;
          if (claimed < 0 || claimed > max) continue;
          add(grade, { kind: 'truth', left: minus(a, change), relation: '=', right: { kind: 'number', value: claimed } },
            [true, false], expressions, subtractionReview);
        }
      }
    }
  }
  for (const place of ['ones', 'tens'] as const) for (let digit = 0; digit <= 9; digit++) {
    const matches = (n: number): boolean => Math.floor(n / (place === 'ones' ? 1 : 10)) % 10 === digit;
    if (place === 'tens' && digit === 0) continue;
    const values = Array.from({ length: 101 }, (_, i) => i).filter(n => place === 'ones' || n >= 10 && n <= 99);
    for (let offset = 0; offset < 3; offset++) add(2, { kind: 'digit', place, digit },
      [...values.filter(matches).slice(offset, offset + 3), ...values.filter(n => !matches(n)).slice(offset, offset + 3)], 'MAP-025', ADVANCED_REVIEW);
  }
  for (let groups = 2; groups <= 4; groups++) for (let each = 2; each <= 5; each++) {
    if (groups * each > 12) continue;
    const times = (left: number, right: number): ArithmeticTask => ({ kind: 'binary', operator: '*', left, right });
    add(2, { kind: 'groups', groups, each }, [times(each, groups), times(each + 1, groups), plus(each, groups),
      each === groups ? times(each, groups + 1) : times(groups, each)], 'MAP-013', ADVANCED_REVIEW);
  }

  return result;
}

export const choiceCategory = (task: ChoiceTask): string => isMultiple(task) ? 'multiple'
  : task.question.kind === 'truth' ? 'truth' : 'single';
