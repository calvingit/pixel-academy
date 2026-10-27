// 语文汉字任务的校验与判题：结构约束 + 按内容判题，不依赖界面、显示顺序或存储。
// 题意正确性由内容审核记录支撑（docs/content-review-hanzi-hero.md），这里只保证
// 候选可达、身份唯一与语义边界（识别/组字不混淆、部件互不相同）。
import type { ChineseTask, HanziChooseTask, HanziPartsTask } from './models.js';

export const isHanziTask = (task: { readonly kind: string }): task is ChineseTask =>
  task.kind === 'hanzi-choose' || task.kind === 'hanzi-parts';

const validateCardSet = (options: readonly string[], min: number, max: number): void => {
  if (options.length < min || options.length > max) throw new RangeError(`Expected ${min}–${max} options`);
  if (options.some(o => typeof o !== 'string' || !o.trim() || [...o].length !== 1)) {
    throw new TypeError('Expected single-character options');
  }
  if (new Set(options).size !== options.length) throw new TypeError('Duplicate options');
};

/** 单字符身份：码点比较，不受显示顺序影响。 */
export const charKey = (value: string): string => {
  if ([...value].length !== 1) throw new TypeError(`Expected a single character: ${JSON.stringify(value)}`);
  return [...value].join('');
};

export function validateHanziTask(task: ChineseTask): void {
  if (task.kind === 'hanzi-choose') {
    if (task.mode !== 'shape' && task.mode !== 'meaning') throw new TypeError('Invalid hanzi-choose mode');
    validateCardSet(task.options, 4, 6);
    if (!charKey(task.target)) throw new TypeError('Invalid target');
    if (task.mode === 'meaning' && !task.image) throw new TypeError('Meaning task requires image');
    if (task.mode === 'shape' && task.image) throw new TypeError('Shape task must not carry image');
    if (!task.options.some(o => charKey(o) === charKey(task.target))) {
      throw new RangeError('Target not reachable among options');
    }
    return;
  }
  validateCardSet(task.options, 4, 6);
  if (!task.image) throw new TypeError('Parts task requires image');
  validateCardSet(task.parts, 2, 4);
  if (task.parts.some(p => charKey(p) === charKey(task.result))) {
    throw new TypeError('Result character must not appear as a part');
  }
  for (const part of task.parts) {
    if (!task.options.some(o => charKey(o) === charKey(part))) {
      throw new RangeError(`Part ${part} not reachable among options`);
    }
  }
}

/** 返回正确答案：单选为目标字所在选项 ID（唯一），多选为部件集合对应选项 ID（顺序无关）。 */
export function correctHanziIds(task: ChineseTask): readonly string[] {
  validateHanziTask(task);
  if (task.kind === 'hanzi-choose') {
    const ids = task.options.filter(o => charKey(o) === charKey(task.target));
    if (ids.length !== 1) throw new RangeError('Expected one target option');
    return [ids[0]!];
  }
  const ids = task.options.filter(o => task.parts.some(p => charKey(p) === charKey(o)));
  if (ids.length !== task.parts.length) throw new RangeError('Parts/options identity mismatch');
  return ids;
}

export const isHanziMultiple = (task: ChineseTask): boolean => task.kind === 'hanzi-parts';

/** 题面文本（无图模式或辅助说明）；组字题面固定为部件问法，不出现结果字。 */
export function hanziPrompt(task: ChineseTask): string {
  if (task.kind === 'hanzi-choose') {
    return task.mode === 'shape' ? `找出「${task.target}」字` : '图中画的是什么字？';
  }
  return '图中所示的字由哪些部件组成？';
}
