import type { Exercise, Grade, MathTask, ChoiceQuestion, ChoiceTask, ArithmeticTask } from '../../learning/models.js';
import { correctOptionIds, optionText, isMultiple, arithmeticText, optionKey } from '../../learning/choice.js';
import { answerFor } from '../../learning/evaluation.js';
import { CHOICE_REVIEW, ADVANCED_REVIEW } from './choice-generation.js';
import type { Rng } from './rules.js';

export interface Course {
  readonly id: string;
  readonly title: string;
  readonly grade: Grade;
  readonly mappings: readonly string[];
  readonly explanation: string;
  readonly example: MathTask;
  readonly questionKinds?: readonly ChoiceQuestion['kind'][];
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
  ...([1, 2] as const).flatMap(grade => {
    const mapping = grade === 1 ? 'MAP-017' : 'MAP-018';
    const options = [2, 3, 4, 5, 6, 7].map(value => ({ id: `number:${value}`, value }));
    const task = (question: ChoiceQuestion, values: ChoiceTask['options'] = options): ChoiceTask => ({ kind: 'choice', question, options: values });
    return [
      { id: `comparison-${grade}`, title: '比较大小', grade, mappings: [mapping], questionKinds: ['extreme', 'symbol'] as const,
        explanation: '比较两个数或一组数，选出较大、较小、最大或最小的数。＞表示大于，＜表示小于，＝表示相等。',
        example: task({ kind: 'symbol', left: 7, right: 4 }, (['>', '<', '='] as const).map(value => ({ id: `string:${value}`, value }))), review: CHOICE_REVIEW },
      { id: `filter-${grade}`, title: '找出所有符合的数', grade, mappings: [mapping], questionKinds: ['filter', 'range'] as const,
        explanation: '“所有”表示符合条件的数一个也不能漏。先逐个比较，选完再提交；选中的数可以再点一次取消。比 4 大不包括 4 本身。',
        example: task({ kind: 'filter', relation: '>', target: 4 }), review: ADVANCED_REVIEW },
      { id: `judgement-${grade}`, title: '数学对错判断', grade, mappings: [mapping, ...(grade === 1 ? ['MAP-007', 'MAP-010', 'MAP-026'] : ['MAP-011', 'MAP-027'])], questionKinds: ['truth'] as const,
        explanation: '先比较大小或算出结果，再判断整句话是否正确。觉得不对时，也要想清楚正确的关系是什么。',
        example: { kind: 'choice' as const, question: { kind: 'truth' as const, left: { kind: 'number' as const, value: 6 }, relation: '>' as const, right: { kind: 'number' as const, value: 9 } }, options: [{ id: 'boolean:true', value: true }, { id: 'boolean:false', value: false }] }, review: CHOICE_REVIEW },
      { id: `missing-${grade}`, title: '找出缺少的数', grade, mappings: [grade === 1 ? 'MAP-019' : 'MAP-020'], questionKinds: ['missing'] as const,
        explanation: '把选中的数放进方框里，检查两边是否相等。例如 □＋3＝8，可以想 5＋3＝8，所以方框里是 5。',
        example: task({ kind: 'missing', addend: 3, total: 8 }), review: CHOICE_REVIEW },
    ];
  }),
  ...([1, 2] as const).flatMap(grade => {
    const choice = (question: ChoiceQuestion, values: readonly ChoiceTask['options'][number]['value'][]): ChoiceTask => ({
      kind: 'choice', question, options: values.map(value => ({ id: optionKey(value), value })),
    });
    const plus = (left: number, right: number): ArithmeticTask => ({ kind: 'binary', operator: '+', left, right });
    const entries: Course[] = [
      { id: `order-${grade}`, title: '数的顺序与组成', grade, mappings: grade === 1 ? ['MAP-021', 'MAP-023'] : ['MAP-022', 'MAP-024'], questionKinds: ['neighbor', 'sequence', 'composition'],
        explanation: '相邻的整数相差 1。数列按题目写明的步长依次增加。把一个数分成两部分，两部分合起来还等于原数。',
        example: choice({ kind: 'sequence', start: 0, step: 1, length: 5, index: 2 }, [0, 1, 2, 3]), review: ADVANCED_REVIEW },
      { id: `equivalence-${grade}`, title: '算式比较与等值', grade, mappings: [grade === 1 ? 'MAP-026' : 'MAP-027'], questionKinds: ['expression-symbol', 'equivalent'],
        explanation: '先分别计算算式的结果，再比较。不同算式可能有相同结果；题目要求找出所有等值算式时，每个符合的算式都要选。',
        example: choice({ kind: 'equivalent', target: 4 }, [plus(3, 1), plus(2, 2), plus(4, 0), plus(2, 1), plus(4, 1), plus(1, 1)]), review: ADVANCED_REVIEW },
      { id: `story-${grade}`, title: '生活中的加减法', grade, mappings: [grade === 1 ? 'MAP-028' : 'MAP-029'], questionKinds: ['story'],
        explanation: '先想清数量怎样变化。又拿来是合在一起，用加法；种下一部分后求剩余，用减法。题目只使用给出的数量，不需要猜测。',
        example: choice({ kind: 'story', start: 7, change: 2, operator: '-' }, [4, 5, 6, 9]), review: ADVANCED_REVIEW },
    ];
    if (grade === 2) {
      entries.push({ id: 'digits-2', title: '认识个位与十位', grade, mappings: ['MAP-025'], questionKinds: ['digit'],
        explanation: '从右往左，第一位是个位，第二位是十位。先看清题目问哪一位，再逐个检查；十位练习使用两位数。',
        example: choice({ kind: 'digit', place: 'ones', digit: 3 }, [13, 23, 43, 30, 35, 50]), review: ADVANCED_REVIEW });
      const times = (left: number, right: number): ArithmeticTask => ({ kind: 'binary', operator: '*', left, right });
      entries.push({ id: 'groups-2', title: '看图选择乘法算式', grade, mappings: ['MAP-013'], questionKinds: ['groups'],
        explanation: '先数清有几组、每组几个。本练习要求按“每组个数 × 组数”选择算式；只算出相同结果，还不一定符合这个写法。',
        example: choice({ kind: 'groups', groups: 2, each: 3 }, [times(3, 2), times(2, 3), plus(3, 2), times(3, 3)]), review: ADVANCED_REVIEW });
    }
    return entries;
  }),
];

export function taskIdentity(task: MathTask): string {
  // 不包含局次、生成版本和映射 ID；保留顺序，避免合并不同点阵或运算题意。
  if (task.kind === 'choice') return `choice:${JSON.stringify({ question: task.question, options: [...task.options].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) })}`;
  if (task.kind === 'number') return `number:${task.value}`;
  if (task.kind === 'binary') return `binary:${task.operator}:${task.left}:${task.right}`;
  return `chain:${task.start}:${task.steps.map(step => `${step.operator}:${step.operand}`).join(',')}`;
}

export function taskText(task: MathTask): string {
  if (task.kind === 'choice') {
    const q = task.question;
    switch (q.kind) {
      case 'extreme': return task.options.length === 2 ? `哪个数更${q.direction === 'max' ? '大' : '小'}？` : `找出最${q.direction === 'max' ? '大' : '小'}的数`;
      case 'symbol': return `${q.left} ○ ${q.right}，选择正确符号`;
      case 'filter': return `找出所有比 ${q.target} ${q.relation === '>' ? '大' : '小'}的数`;
      case 'truth': return `${statementText(task)}，对不对？`;
      case 'range': return `找出所有比 ${q.lower} 大、比 ${q.upper} 小的数`;
      case 'neighbor': return `${q.value} ${q.direction === 'before' ? '前面' : '后面'}的一个数是多少？`;
      case 'sequence': return `${Array.from({ length: q.length }, (_, i) => i === q.index ? '□' : q.start + i * q.step).join('、')}（每次增加 ${q.step}）`;
      case 'composition': return `${q.total} 可以分成 ${q.part} 和几？`;
      case 'digit': return `找出所有${q.place === 'ones' ? '个' : '十'}位是 ${q.digit} 的数`;
      case 'expression-symbol': return `${arithmeticText(q.left)} ○ ${arithmeticText(q.right)}`;
      case 'equivalent': return `找出所有结果是 ${q.target} 的算式`;
      case 'groups': return `${q.groups} 组，每组 ${q.each} 个。按“每组个数 × 组数”选算式`;
      case 'story': return q.operator === '+' ? `原来有 ${q.start} 颗种子，又拿来 ${q.change} 颗，现在有几颗？` : `原来有 ${q.start} 颗种子，种下 ${q.change} 颗，还剩几颗？`;
      case 'missing': return `□ ＋ ${q.addend} ＝ ${q.total}`;
    }
  }
  if (task.kind === 'number') return `找出 ${task.value}`;
  if (task.kind === 'binary') return task.operator === '*'
    ? `${task.left} 行，每行 ${task.right} 个圆点，一共有多少个？`
    : `${task.left} ${task.operator === '-' ? '−' : '+'} ${task.right} = ?`;
  return `${task.start} ${task.steps.map(step => `${step.operator === '-' ? '−' : '+'} ${step.operand}`).join(' ')} = ?`;
}

export function explainTask(task: MathTask): string {
  if (task.kind === 'choice') {
    const ids = correctOptionIds(task);
    const answers = task.options.filter(o => ids.includes(o.id)).map(optionText).join('、');
    const q = task.question;
    if (q.kind === 'range') return `比 ${q.lower} 大并且比 ${q.upper} 小，两条条件都要满足。符合的是 ${answers}；两个边界 ${q.lower}、${q.upper} 都不包括。`;
    if (q.kind === 'neighbor') return `${q.value} ${q.direction === 'before' ? '减去' : '加上'} 1，得到 ${answers}。`;
    if (q.kind === 'sequence') return `每次增加 ${q.step}：${Array.from({ length: q.length }, (_, i) => q.start + i * q.step).join('、')}。方框里填 ${answers}。`;
    if (q.kind === 'composition') return `${q.total} − ${q.part} = ${q.total - q.part}，所以 ${q.part} 和 ${answers} 合起来是 ${q.total}。`;
    if (q.kind === 'digit') return `看每个数从右往左第 ${q.place === 'ones' ? '一' : '二'} 位。符合的是 ${answers}。${task.options.map(o => `${o.value} 的${q.place === 'ones' ? '个' : '十'}位是 ${Math.floor(Number(o.value) / (q.place === 'ones' ? 1 : 10)) % 10}`).join('；')}。`;
    if (q.kind === 'expression-symbol') return `${arithmeticText(q.left)} = ${answerFor(q.left)}；${arithmeticText(q.right)} = ${answerFor(q.right)}。比较结果，应选 ${answers}。`;
    if (q.kind === 'equivalent') return `逐个计算：${task.options.map(o => `${optionText(o)} = ${answerFor(o.value as ArithmeticTask)}`).join('；')}。结果是 ${q.target} 的算式有 ${answers}。`;
    if (q.kind === 'groups') return `每组 ${q.each} 个，有 ${q.groups} 组，按题目要求写成 ${q.each} × ${q.groups}，应选 ${answers}，共有 ${q.each * q.groups} 个。`;
    if (q.kind === 'story') return q.operator === '+' ? `又拿来表示合在一起：${q.start} ＋ ${q.change} = ${q.start + q.change}，现在有 ${answers} 颗。` : `种下后剩余的数量：${q.start} − ${q.change} = ${q.start - q.change}，还剩 ${answers} 颗。`;
    if (q.kind === 'filter') return `符合条件的数是 ${answers}。${task.options.map(o => `${o.value} ${Number(o.value) > q.target ? '大于' : Number(o.value) < q.target ? '小于' : '等于'} ${q.target}`).join('；')}。${q.target} 本身不符合“比它${q.relation === '>' ? '大' : '小'}”的条件。`;
    if (q.kind === 'truth') {
      const left = answerFor(q.left), right = answerFor(q.right);
      return `${statementText(task)}，应选${answers}。${q.left.kind === 'number' ? '' : `${taskText(q.left).replace(' = ?', '')} = ${left}。`}${left} ${left > right ? '大于' : left < right ? '小于' : '等于'} ${right}。`;
    }
    if (q.kind === 'missing') return `${q.total} − ${q.addend} = ${q.total - q.addend}。把 ${answers} 放入方框：${answers} ＋ ${q.addend} = ${q.total}。`;
    if (q.kind === 'symbol') return `${q.left} ${q.left > q.right ? '大于' : q.left < q.right ? '小于' : '等于'} ${q.right}，选 ${answers}。`;
    return `把这些数从小到大排好：${task.options.map(o => Number(o.value)).sort((a, b) => a - b).join('、')}。最${q.direction === 'max' ? '大' : '小'}的是 ${answers}。`;
  }
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
  const pool = exercises.filter(e => e.review.status === 'approved' && e.mappingIds.some(id => course.mappings.includes(id))
    && (course.questionKinds ? e.task.kind === 'choice' && course.questionKinds.includes(e.task.question.kind) : e.task.kind !== 'choice'));
  const chosen: Exercise[] = [];
  while (chosen.length < 3) {
    if (!pool.length) throw new Error('课程已审核练习不足 3 道');
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return chosen;
}

function statementText(task: ChoiceTask): string {
  const q = task.question;
  if (q.kind !== 'truth') throw new TypeError('Expected truth question');
  const expression = (t: MathTask): string => t.kind === 'number' ? String(t.value) : taskText(t).replace(' = ?', '');
  return `${expression(q.left)} ${q.relation === '>' ? '＞' : q.relation === '<' ? '＜' : '＝'} ${expression(q.right)}`;
}

export function answerFeedback(task: MathTask, answer: unknown): string {
  if (task.kind !== 'choice' || !isMultiple(task) || !Array.isArray(answer)) return '';
  const expected = correctOptionIds(task);
  const missing = task.options.filter(o => expected.includes(o.id) && !answer.includes(o.id)).map(optionText);
  const extra = task.options.filter(o => !expected.includes(o.id) && answer.includes(o.id)).map(optionText);
  return [missing.length ? `漏选：${missing.join('、')}` : '', extra.length ? `多选：${extra.join('、')}` : ''].filter(Boolean).join('；');
}
