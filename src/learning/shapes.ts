// 立体图形任务（shape-choose / shape-place）的校验与判题：结构约束 + 按形状身份判题，
// 不依赖界面、显示顺序或存储。渲染图与形状的对应关系由内容审核记录支撑
//（docs/content-review-geometry-builder.md），这里保证：候选与 accept 集合合法、可达、
// 无死区（每区/槽至少被一块积木满足），判题与渲染位置、放置顺序、操作路径无关
//（PLAN M11「判题基于形状、关系或槽位语义，不能只比截图像素或唯一操作顺序」）。
import type { ShapeChooseTask, ShapePlaceTask, ShapeTask } from './models.js';

/** 立体图形身份词表（4 种，一年级上学期通用范围，不宣称对应教材页码）。 */
export const SHAPES_3D: readonly string[] = ['cuboid', 'cube', 'cylinder', 'sphere'];

/** 形状身份 → 中文名称（题面、候选与分区标注统一从这里取，防两侧漂移）。 */
export const SHAPE_LABELS: Readonly<Record<string, string>> = {
  cuboid: '长方体', cube: '正方体', cylinder: '圆柱', sphere: '球',
};

const SHAPE_SET: ReadonlySet<string> = new Set(SHAPES_3D);

export const isShapeName = (value: unknown): value is string =>
  typeof value === 'string' && SHAPE_SET.has(value);

export const isShapeTask = (task: { readonly kind: string }): task is ShapeTask =>
  task.kind === 'shape-choose' || task.kind === 'shape-place';

const isZone = (value: unknown): value is { readonly id: string; readonly accept: readonly string[] } => {
  if (typeof value !== 'object' || value === null) return false;
  const z = value as Record<string, unknown>;
  return typeof z.id === 'string' && z.id.trim() !== ''
    && Array.isArray(z.accept) && z.accept.length >= 1 && z.accept.every(isShapeName);
};

export function validateShapeTask(task: ShapeTask): void {
  if (task.kind === 'shape-choose') {
    if (!isShapeName(task.shape)) throw new TypeError('Invalid shape identity');
    if (typeof task.image !== 'string' || !/^\/img\/geometry-builder\/[a-z-]+\.svg$/.test(task.image)) {
      throw new TypeError('Invalid shape-choose image path');
    }
    if (task.options.length !== 4) throw new RangeError('Expected 4 options');
    if (task.options.some(o => typeof o !== 'string' || !Object.values(SHAPE_LABELS).includes(o))) {
      throw new TypeError('Options must be shape labels');
    }
    if (new Set(task.options).size !== task.options.length) throw new TypeError('Duplicate options');
    if (task.answer !== SHAPE_LABELS[task.shape]) throw new TypeError('Answer does not match shape identity');
    if (!task.options.includes(task.answer)) throw new RangeError('Answer not reachable among options');
    return;
  }
  // shape-place
  if (task.mode !== 'classify' && task.mode !== 'build') throw new TypeError('Invalid shape-place mode');
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) throw new TypeError('Prompt required');
  if (task.blocks.length < 1 || task.blocks.length > 6) throw new RangeError('Expected 1–6 blocks');
  if (task.blocks.some(b => !isShapeName(b))) throw new TypeError('Invalid block identity');
  if (task.zones.length < 1 || task.zones.length > 4) throw new RangeError('Expected 1–4 zones');
  if (!task.zones.every(isZone)) throw new TypeError('Invalid zone structure');
  if (new Set(task.zones.map(z => z.id)).size !== task.zones.length) throw new TypeError('Duplicate zone ids');
  if (task.blocks.length < task.zones.length) throw new RangeError('Fewer blocks than zones: unwinnable');
  if (task.mode === 'classify') {
    // 分类区 accept 恰一个形状且互异：每块恰有唯一归属区，不出现两区都收同块。
    if (task.zones.some(z => z.accept.length !== 1)) throw new TypeError('Classify zones accept exactly one shape');
    const accepts = task.zones.map(z => z.accept[0]!);
    if (new Set(accepts).size !== accepts.length) throw new TypeError('Classify zone shapes must differ');
  }
  // 可达性：每区/槽至少被一块积木满足（无空区/死槽），整局可完成。
  for (const zone of task.zones) {
    if (!task.blocks.some(block => zone.accept.includes(block))) {
      throw new RangeError(`Zone ${zone.id} not satisfiable by any block`);
    }
  }
}

/** 可接受集合按形状身份比较；集合外形状一律不匹配，不做宽松裁剪。 */
const zoneAccepts = (zone: { readonly accept: readonly string[] }, shape: string): boolean =>
  zone.accept.includes(shape);

/** 放置作答条目解析："<形状>@<分区 id>"；非法条目返回 null。 */
const parsePlacement = (item: unknown): { readonly shape: string; readonly zoneId: string } | null => {
  if (typeof item !== 'string') return null;
  const at = item.lastIndexOf('@');
  if (at <= 0 || at === item.length - 1) return null;
  const shape = item.slice(0, at);
  const zoneId = item.slice(at + 1);
  return isShapeName(shape) && /^[a-z0-9-]+$/.test(zoneId) ? { shape, zoneId } : null;
};

export interface ShapePlaceResult {
  /** classify：每块积木是否归属正确（下标对齐 blocks）；build：恒空数组。 */
  readonly wrongBlocks: readonly number[];
  /** build：每槽当前放置是否正确（下标对齐 zones）；classify：恒空数组。 */
  readonly slotOk: readonly boolean[];
  /** 全部块/槽正确（任务完成）。 */
  readonly complete: boolean;
}

/**
 * 放置分解判定：classify 按块逐一定位错块（整组提交反馈用）；build 按槽逐一定位槽状态。
 * 它与 evaluateAnswer 是同一判定逻辑的粒度分解（evaluateAnswer 只返回 complete），
 * 供规则层获取分步反馈，不是第二个判定入口。
 * 作答契约：shape-place 的 SubmittedAnswer 为字符串数组，每项 "<形状>@<分区 id>"；
 * classify 须覆盖全部块（未分配=错），build 每槽至多一项（重复放置由规则层约束）。
 */
export function shapePlaceResult(task: ShapePlaceTask, answer: unknown): ShapePlaceResult {
  validateShapeTask(task);
  const items = Array.isArray(answer) ? answer.map(parsePlacement) : [];
  if (task.mode === 'classify') {
    // 按形状计数判定：同形状多块时逐块对号（每条目消耗一个未匹配的该形状块）。
    // 未匹配块报告为错块（未分配、分错区或条目被同形状多余项占用），与渲染顺序无关。
    const unmatched = new Map<string, number>();
    for (const shape of task.blocks) unmatched.set(shape, (unmatched.get(shape) ?? 0) + 1);
    const matched = task.blocks.map(() => false);
    for (const parsed of items) {
      if (!parsed || (unmatched.get(parsed.shape) ?? 0) <= 0) continue;
      unmatched.set(parsed.shape, unmatched.get(parsed.shape)! - 1);
      matched[task.blocks.findIndex((shape, i) => !matched[i] && shape === parsed.shape)] = true;
    }
    // 错块反馈：优先报告分到错误分区的已匹配块（zone 不收该形状），其余未匹配块次之。
    const wrongBlocks: number[] = [];
    for (const item of items) {
      if (!item) continue;
      const blockIndex = matched.findIndex((used, i) => used && task.blocks[i] === item.shape);
      if (blockIndex < 0) continue;
      const zone = task.zones.find(z => z.id === item.zoneId);
      if (!zone || !zoneAccepts(zone, item.shape)) {
        if (!wrongBlocks.includes(blockIndex)) wrongBlocks.push(blockIndex);
      }
    }
    for (let i = 0; i < task.blocks.length; i++) {
      if (!matched[i] && !wrongBlocks.includes(i)) wrongBlocks.push(i);
    }
    return { wrongBlocks, slotOk: [], complete: wrongBlocks.length === 0 && items.length === task.blocks.length };
  }
  // build：每槽取其放置条目（同槽多条以最后一条为准，规则层保证不会发生）。
  // slotOk 按**作答条目中的 zoneId 在 task.zones 的语义序**排列；规则层若以呈现序
  // 槽位放置，须自行按 zoneId 查找本槽状态（slotOk 与呈现顺序无关）。
  const slotOk = task.zones.map(zone => {
    const entry = items.filter(item => item !== null && item.zoneId === zone.id).pop();
    return entry !== undefined && entry !== null && zoneAccepts(zone, entry.shape);
  });
  return { wrongBlocks: [], slotOk, complete: slotOk.every(ok => ok) };
}

/** 规范答案（校验后返回）：choose 为答案名；classify 为全部分配（每块归属其唯一 accept 区）；
 * build 为每槽一个可满足放置（每槽取第一块满足 accept 的积木；干扰块不进规范答案）。 */
export function correctShapeAnswer(
  task: ShapeTask,
): string | readonly string[] {
  validateShapeTask(task);
  if (task.kind === 'shape-choose') return task.answer;
  if (task.mode === 'classify') {
    return task.blocks.map(shape => {
      const zone = task.zones.find(z => z.accept.includes(shape));
      if (!zone) throw new RangeError(`No zone accepts block ${shape}`);
      return `${shape}@${zone.id}`;
    });
  }
  return task.zones.map(zone => {
    const shape = task.blocks.find(block => zone.accept.includes(block));
    if (shape === undefined) throw new RangeError(`No block satisfies zone ${zone.id}`);
    return `${shape}@${zone.id}`;
  });
}
