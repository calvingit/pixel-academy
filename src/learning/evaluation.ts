import type { MathTask } from './models.js';

/** 仅处理有限、安全整数；不执行表达式字符串。 */
export function answerFor(task: MathTask): number {
  const integer = (n: number): number => {
    if (!Number.isSafeInteger(n)) throw new RangeError('Expected a safe integer');
    return n;
  };
  switch (task.kind) {
    case 'number': return integer(task.value);
    case 'binary': {
      const a = integer(task.left), b = integer(task.right);
      switch (task.operator) {
        case '+': return integer(a + b);
        case '-': return integer(a - b);
        case '*': return integer(a * b);
        default: throw new TypeError('Unsupported operator');
      }
    }
    case 'chain': {
      if (task.steps.length === 0) throw new TypeError('Empty operation chain');
      return task.steps.reduce((result, step) => {
        const n = integer(step.operand);
        if (step.operator === '+') return integer(result + n);
        if (step.operator === '-') return integer(result - n);
        throw new TypeError('Unsupported operator');
      }, integer(task.start));
    }
    default: throw new TypeError('Unsupported task');
  }
}

export function evaluateAnswer(task: MathTask, answer: unknown): boolean {
  const expected = answerFor(task);
  // 不把空串、布尔值、小数、表达式或宽松解析结果当作数字答案。
  if (typeof answer === 'number') return Number.isSafeInteger(answer) && answer === expected;
  if (typeof answer !== 'string' || !/^-?\d+$/.test(answer.trim())) return false;
  const parsed = Number(answer.trim());
  return Number.isSafeInteger(parsed) && parsed === expected;
}
