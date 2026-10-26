import type { ChoiceOption, ChoiceTask, Relation, ArithmeticTask } from './models.js';
import { answerFor } from './arithmetic.js';

const integer = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError('Expected a safe integer');
  return value;
};
function compare(left: number, relation: Relation, right: number): boolean {
  integer(left); integer(right);
  if (relation === '>') return left > right;
  if (relation === '<') return left < right;
  if (relation === '=') return left === right;
  throw new TypeError('Unsupported relation');
}
export const isMultiple = (task: ChoiceTask): boolean => ['filter', 'range', 'digit', 'equivalent'].includes(task.question.kind);
export function optionText(option: ChoiceOption): string {
  if (typeof option.value === 'object') return arithmeticText(option.value);
  return typeof option.value === 'boolean' ? option.value ? '对 ✓' : '错 ✗'
    : String(option.value).replace('>', '＞').replace('<', '＜').replace('=', '＝');
}

/** 返回固定候选中的答案身份；校验题意、选项类型及答案可达性，不依赖显示顺序。 */
export function correctOptionIds(task: ChoiceTask): readonly string[] {
  const { question: q, options } = task;
  if (options.length < 2 || options.length > 6 || options.some(o => typeof o.id !== 'string' || !o.id.trim())
    || new Set(options.map(o => o.id)).size !== options.length
    || new Set(options.map(o => optionKey(o.value))).size !== options.length) throw new TypeError('Invalid choices');
  const numeric = (): number[] => options.map(o => {
    if (typeof o.value !== 'number') throw new TypeError('Expected numeric choices');
    return integer(o.value);
  });
  const expressions = (): readonly ArithmeticTask[] => options.map(o => {
    if (typeof o.value !== 'object' || o.value === null || o.value.kind === undefined) throw new TypeError('Expected arithmetic choices');
    answerFor(o.value); return o.value;
  });
  const multipleIds = (matches: (option: ChoiceOption) => boolean): readonly string[] => {
    const ids = options.filter(matches).map(o => o.id);
    if (options.length !== 6 || ids.length < 2 || ids.length > 4) throw new RangeError('Expected 2–4 correct choices among six');
    return ids;
  };
  let expected: number | boolean | Relation;
  switch (q.kind) {
    case 'filter': {
      numeric();
      if (q.relation !== '>' && q.relation !== '<') throw new TypeError('Invalid filter relation');
      integer(q.target);
      return multipleIds(o => compare(o.value as number, q.relation, q.target));
    }
    case 'range':
      numeric(); integer(q.lower); integer(q.upper);
      if (q.lower >= q.upper) throw new RangeError('Invalid interval');
      return multipleIds(o => Number(o.value) > q.lower && Number(o.value) < q.upper);
    case 'digit':
      numeric(); integer(q.digit);
      if (q.digit < 0 || q.digit > 9 || (q.place !== 'ones' && q.place !== 'tens') || numeric().some(n => n < 0 || q.place === 'tens' && n < 10)) throw new RangeError('Invalid digit question');
      return multipleIds(o => Math.floor(Number(o.value) / (q.place === 'ones' ? 1 : 10)) % 10 === q.digit);
    case 'equivalent':
      expressions(); integer(q.target);
      return multipleIds(o => answerFor(o.value as ArithmeticTask) === q.target);
    case 'groups': {
      const values = expressions(); integer(q.groups); integer(q.each);
      if (q.groups < 1 || q.each < 1 || q.groups > 5 || q.each > 5) throw new RangeError('Invalid equal groups');
      const ids = options.filter((_, i) => { const t = values[i]!; return t.kind === 'binary' && t.operator === '*' && t.left === q.each && t.right === q.groups; }).map(o => o.id);
      if (ids.length !== 1) throw new RangeError('Expected one grouping expression');
      return ids;
    }
    case 'neighbor':
      numeric(); integer(q.value);
      if (q.direction !== 'before' && q.direction !== 'after') throw new TypeError('Invalid neighbor direction');
      expected = integer(q.value + (q.direction === 'before' ? -1 : 1)); break;
    case 'sequence':
      numeric(); integer(q.start); integer(q.step); integer(q.length); integer(q.index);
      if (q.step <= 0 || q.length < 3 || q.length > 6 || q.index < 0 || q.index >= q.length) throw new RangeError('Invalid sequence');
      integer(q.start + q.step * (q.length - 1)); expected = integer(q.start + q.step * q.index); break;
    case 'composition':
      numeric(); integer(q.total); integer(q.part);
      if (q.part < 0 || q.total < q.part) throw new RangeError('Invalid composition');
      expected = integer(q.total - q.part); break;
    case 'story':
      numeric(); integer(q.start); integer(q.change);
      if (q.start < 0 || q.change < 0 || (q.operator !== '+' && q.operator !== '-')) throw new RangeError('Invalid story');
      expected = integer(q.start + (q.operator === '+' ? q.change : -q.change));
      if (expected < 0) throw new RangeError('Negative quantity');
      break;
    case 'expression-symbol': {
      const left = answerFor(q.left), right = answerFor(q.right);
      if (options.length !== 3 || options.some(o => !(o.value === '>' || o.value === '<' || o.value === '='))) throw new TypeError('Expected relation choices');
      expected = left > right ? '>' : left < right ? '<' : '='; break;
    }
    case 'extreme': {
      const values = numeric();
      if (q.direction !== 'max' && q.direction !== 'min') throw new TypeError('Invalid extreme direction');
      expected = q.direction === 'max' ? Math.max(...values) : Math.min(...values); break;
    }
    case 'symbol':
      integer(q.left); integer(q.right);
      if (options.length !== 3 || options.some(o => !(o.value === '>' || o.value === '<' || o.value === '='))) throw new TypeError('Expected relation choices');
      expected = q.left > q.right ? '>' : q.left < q.right ? '<' : '='; break;
    case 'truth':
      if (options.length !== 2 || options.some(o => typeof o.value !== 'boolean')) throw new TypeError('Expected boolean choices');
      expected = compare(answerFor(q.left), q.relation, answerFor(q.right)); break;
    case 'missing':
      numeric(); integer(q.addend); integer(q.total);
      expected = integer(q.total - q.addend); break;
    default: throw new TypeError('Unsupported choice question');
  }
  const ids = options.filter(o => o.value === expected).map(o => o.id);
  if (ids.length !== 1) throw new RangeError('Expected one reachable answer');
  return ids;
}

export function arithmeticText(task: ArithmeticTask): string {
  if (task.kind === 'number') return String(task.value);
  if (task.kind === 'binary') return `${task.left} ${task.operator === '*' ? '×' : task.operator === '-' ? '−' : '＋'} ${task.right}`;
  return `${task.start} ${task.steps.map(s => `${s.operator === '+' ? '＋' : '−'} ${s.operand}`).join(' ')}`;
}

export function optionKey(value: ChoiceOption['value']): string {
  if (typeof value !== 'object' || value === null) return `${typeof value}:${value}`;
  if (value.kind === 'number') return `expression:number:${value.value}`;
  if (value.kind === 'binary') return `expression:binary:${value.operator}:${value.left}:${value.right}`;
  if (value.kind === 'chain') return `expression:chain:${value.start}:${value.steps.map(s => `${s.operator}:${s.operand}`).join(',')}`;
  throw new TypeError('Invalid arithmetic option');
}
