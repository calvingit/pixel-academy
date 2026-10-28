// 几何建筑师（geometry-builder）首批静态内容：4 种立体图形（长方体、正方体、圆柱、球）、
// 18 道任务（辨认 6 + 分类 6 + 搭建 6），全部为通用原创任务，未宣称与特定教材版次对齐。
// 审核记录：docs/content-review-geometry-builder.md（zcode-agent 代理审核，时间见各题 review 字段）。
// 干扰项规则（显式、可解释）：辨认候选固定为四种立体图形名称全集（干扰=其余图形名称，
// 不引入平面图形名称混淆训练目标）；分类区/搭建槽位 accept 集合逐题在审核记录中说明。
// 全部任务映射 MAP-030（math.geometry.solids → MA-01A-U05 候选映射，各项核验 pending）。
import type { Exercise, ShapeChooseTask, ShapePlaceTask } from '../learning/models.js';
import { SHAPE_LABELS } from '../learning/shapes.js';

const REVIEW = { status: 'approved' as const, reviewer: 'zcode-agent（代理审核）', reviewedAt: '2026-10-28T12:00:00Z' };

const MAPPING = ['MAP-030'] as const;

const ALL_LABELS = Object.values(SHAPE_LABELS);

const zone = (id: string, accept: readonly string[]) => ({ id, accept });

const choose = (id: string, shape: string, image: string): Exercise<ShapeChooseTask> => ({
  id,
  subject: 'math',
  mappingIds: MAPPING,
  gameIds: ['geometry-builder'],
  task: {
    kind: 'shape-choose',
    shape,
    image,
    // 候选固定四种立体图形名称全集；渲染排列由游戏层组卷洗牌，内容顺序不影响判题。
    options: [...ALL_LABELS],
    answer: SHAPE_LABELS[shape]!,
  },
  review: REVIEW,
});

const place = (id: string, task: ShapePlaceTask): Exercise<ShapePlaceTask> => ({
  id,
  subject: 'math',
  mappingIds: MAPPING,
  gameIds: ['geometry-builder'],
  task,
  review: REVIEW,
});

export const geometryExercises: readonly Exercise<ShapeChooseTask | ShapePlaceTask>[] = [
  // ===== 辨认（6 题，MAP-030）：看渲染图选图形名称；圆柱/长方体各含一个姿态变体 =====
  choose('MA-G-001', 'cuboid', '/img/geometry-builder/cuboid.svg'),
  choose('MA-G-002', 'cube', '/img/geometry-builder/cube.svg'),
  choose('MA-G-003', 'cylinder', '/img/geometry-builder/cylinder.svg'),
  choose('MA-G-004', 'sphere', '/img/geometry-builder/sphere.svg'),
  choose('MA-G-005', 'cylinder', '/img/geometry-builder/cylinder-flat.svg'),
  choose('MA-G-006', 'cuboid', '/img/geometry-builder/cuboid-tall.svg'),

  // ===== 分类（6 题，MAP-030）：把积木放入按形状标注的分类区，整组提交；逐条 accept 说明见审核记录 =====
  place('MA-G-007', {
    kind: 'shape-place', mode: 'classify',
    prompt: '把积木按形状分类，放进对应的格子。',
    blocks: ['sphere', 'cube', 'sphere', 'cylinder'],
    zones: [zone('z1', ['sphere']), zone('z2', ['cube']), zone('z3', ['cylinder'])],
  }),
  place('MA-G-008', {
    kind: 'shape-place', mode: 'classify',
    prompt: '把积木按形状分类，放进对应的格子。',
    blocks: ['cuboid', 'cube', 'cuboid', 'sphere'],
    zones: [zone('z1', ['cuboid']), zone('z2', ['cube']), zone('z3', ['sphere'])],
  }),
  place('MA-G-009', {
    kind: 'shape-place', mode: 'classify',
    prompt: '把积木按形状分类，放进对应的格子。',
    blocks: ['cylinder', 'sphere', 'cylinder', 'cube', 'sphere'],
    zones: [zone('z1', ['cylinder']), zone('z2', ['sphere']), zone('z3', ['cube'])],
  }),
  place('MA-G-010', {
    kind: 'shape-place', mode: 'classify',
    prompt: '把积木按形状分类，放进对应的格子。',
    blocks: ['cube', 'cuboid', 'sphere', 'cube'],
    zones: [zone('z1', ['cube']), zone('z2', ['cuboid']), zone('z3', ['sphere'])],
  }),
  place('MA-G-011', {
    kind: 'shape-place', mode: 'classify',
    prompt: '把积木按形状分类，放进对应的格子。',
    blocks: ['cuboid', 'cylinder', 'cuboid', 'sphere', 'cylinder'],
    zones: [zone('z1', ['cuboid']), zone('z2', ['cylinder']), zone('z3', ['sphere'])],
  }),
  place('MA-G-012', {
    kind: 'shape-place', mode: 'classify',
    prompt: '把积木按形状分类，放进对应的格子。',
    blocks: ['sphere', 'cube', 'cylinder', 'sphere', 'cuboid', 'cube'],
    zones: [zone('z1', ['sphere']), zone('z2', ['cube']), zone('z3', ['cylinder']), zone('z4', ['cuboid'])],
  }),

  // ===== 搭建（6 题，MAP-030）：按题面把积木放到槽位，逐槽即时判定；accept 含两种形状的槽为等价多解 =====
  place('MA-G-013', {
    kind: 'shape-place', mode: 'build',
    prompt: '搭一座小塔：底座用圆柱，塔顶用正方体或长方体。',
    blocks: ['cylinder', 'cube', 'cuboid', 'sphere'],
    zones: [zone('z1', ['cylinder']), zone('z2', ['cube', 'cuboid'])],
  }),
  place('MA-G-014', {
    kind: 'shape-place', mode: 'build',
    prompt: '搭一座小桥：桥墩用两个圆柱，桥面用一块长方体。',
    blocks: ['cylinder', 'cylinder', 'cuboid', 'cube', 'sphere'],
    zones: [zone('z1', ['cylinder']), zone('z2', ['cylinder']), zone('z3', ['cuboid'])],
  }),
  place('MA-G-015', {
    kind: 'shape-place', mode: 'build',
    prompt: '拼一辆小车：车身用长方体，两只车轮都用球。',
    blocks: ['cuboid', 'sphere', 'sphere', 'cube'],
    zones: [zone('z1', ['cuboid']), zone('z2', ['sphere']), zone('z3', ['sphere'])],
  }),
  place('MA-G-016', {
    kind: 'shape-place', mode: 'build',
    prompt: '搭两级台阶：底层用长方体，上层用正方体或圆柱。',
    blocks: ['cuboid', 'cube', 'cylinder', 'sphere'],
    zones: [zone('z1', ['cuboid']), zone('z2', ['cube', 'cylinder'])],
  }),
  place('MA-G-017', {
    kind: 'shape-place', mode: 'build',
    prompt: '堆一个雪人：下面一个球，上面再放一个球。',
    blocks: ['sphere', 'sphere', 'cube'],
    zones: [zone('z1', ['sphere']), zone('z2', ['sphere'])],
  }),
  place('MA-G-018', {
    kind: 'shape-place', mode: 'build',
    prompt: '搭一座大门：两根门柱用圆柱，门梁用长方体或正方体。',
    blocks: ['cylinder', 'cylinder', 'cuboid', 'cube', 'sphere'],
    zones: [zone('z1', ['cylinder']), zone('z2', ['cylinder']), zone('z3', ['cuboid', 'cube'])],
  }),
];
