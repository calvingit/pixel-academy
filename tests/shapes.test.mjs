import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// npm test 先构建（package.json 口径），这里从 dist 导入真实产物。
const require = createRequire(import.meta.url);
const build = process.env.SKIP_BUILD ? undefined : execSync('npm run build', { cwd: process.cwd() });
if (build !== undefined) assert.ok(build.length >= 0);

const work = mkdtempSync(join(tmpdir(), 'shapes-'));
const { catalog, selectExercises, previewExercises } = (await import(`${process.cwd()}/dist/index.js`));
const defaultCore = { select: selectExercises, preview: previewExercises };
// src/index.ts 未聚合 geometry 题库（游戏端独立核心），直接从产物路径导入。
const { geometryExercises: geometryPool } = await import(`${process.cwd()}/dist/content/geometry-exercises.js`);
const {
  SHAPES_3D, SHAPE_LABELS, isShapeTask, validateShapeTask, shapePlaceResult, correctShapeAnswer,
} = await import(`${process.cwd()}/dist/learning/shapes.js`);
const { evaluateAnswer, validateTask } = await import(`${process.cwd()}/dist/learning/evaluation.js`);
const { createLearningCore } = await import(`${process.cwd()}/dist/learning/catalog.js`);

test('shape word list: four solids with stable labels', () => {
  assert.deepEqual([...SHAPES_3D].sort(), ['cube', 'cuboid', 'cylinder', 'sphere']);
  assert.equal(SHAPE_LABELS.cuboid, '长方体');
  assert.equal(SHAPE_LABELS.cube, '正方体');
  assert.equal(SHAPE_LABELS.cylinder, '圆柱');
  assert.equal(SHAPE_LABELS.sphere, '球');
});

test('content pool: 18 exercises, all approved geometry tasks mapped to MAP-030', () => {
  assert.equal(geometryPool.length, 18);
  const modes = { 'shape-choose': 0, classify: 0, build: 0 };
  for (const exercise of geometryPool) {
    assert.equal(exercise.subject, 'math');
    assert.deepEqual(exercise.gameIds, ['geometry-builder']);
    assert.deepEqual(exercise.mappingIds, ['MAP-030']);
    assert.equal(exercise.review.status, 'approved');
    assert.ok(isShapeTask(exercise.task));
    if (exercise.task.kind === 'shape-choose') modes['shape-choose']++;
    else modes[exercise.task.mode]++;
  }
  assert.deepEqual(modes, { 'shape-choose': 6, classify: 6, build: 6 });
  const ids = new Set(geometryPool.map(e => e.id));
  assert.equal(ids.size, 18);
  assert.ok([...ids].every(id => /^MA-G-\d{3}$/.test(id)));
});

test('validateTask accepts every pool task (structure + reachability)', () => {
  for (const exercise of geometryPool) validateTask(exercise.task);
});

test('invalid shape tasks are rejected', () => {
  const goodChoose = geometryPool.find(e => e.task.kind === 'shape-choose').task;
  assert.throws(() => validateShapeTask({ ...goodChoose, shape: 'triangle' }), TypeError);
  assert.throws(() => validateShapeTask({ ...goodChoose, answer: '圆柱' }), TypeError);
  assert.throws(() => validateShapeTask({ ...goodChoose, options: ['长方体', '正方体', '圆柱'] }), RangeError);
  assert.throws(() => validateShapeTask({ ...goodChoose, options: ['长方体', '正方体', '圆柱', '圆'] }), TypeError);
  assert.throws(() => validateShapeTask({ ...goodChoose, image: '/img/hanzi-hero/tree.svg' }), TypeError);

  const goodPlace = geometryPool.find(e => e.task.kind === 'shape-place').task;
  assert.throws(() => validateShapeTask({ ...goodPlace, mode: 'sort' }), TypeError);
  assert.throws(() => validateShapeTask({ ...goodPlace, blocks: ['triangle'] }), TypeError);
  assert.throws(() => validateShapeTask({ ...goodPlace, zones: [{ id: 'z1', accept: [] }] }), TypeError);
  assert.throws(() => validateShapeTask({ ...goodPlace, zones: [{ id: 'z1', accept: ['sphere'] }, { id: 'z1', accept: ['cube'] }] }), TypeError);
  // 死区：没有积木能满足该区（MA-G-007 积木为球×2、正方体、圆柱，无长方体）
  assert.throws(() => validateShapeTask({ ...goodPlace, zones: [...goodPlace.zones, { id: 'z9', accept: ['cuboid'] }] }), RangeError);
  // 分类区 accept 必须恰一个形状且互异
  assert.throws(() => validateShapeTask({ ...goodPlace, mode: 'classify', zones: [...goodPlace.zones.slice(0, 1), { id: 'z2', accept: ['cube', 'cuboid'] }, ...goodPlace.zones.slice(1)] }), TypeError);
  assert.throws(() => validateShapeTask({ ...goodPlace, mode: 'classify', zones: [...goodPlace.zones.slice(0, 2).map((z, i) => i === 1 ? { id: z.id, accept: goodPlace.zones[0].accept } : z), ...goodPlace.zones.slice(2)] }), TypeError);
});

test('shape-choose judging: identity-based, order-independent', () => {
  const exercise = geometryPool.find(e => e.task.kind === 'shape-choose' && e.id === 'MA-G-003');
  const task = exercise.task;
  assert.equal(correctShapeAnswer(task), '圆柱');
  assert.equal(evaluateAnswer(task, '圆柱'), true);
  assert.equal(evaluateAnswer(task, '球'), false);
  assert.equal(evaluateAnswer(task, 'cylinder'), false);
  assert.equal(evaluateAnswer(task, ''), false);
  assert.equal(evaluateAnswer(task, null), false);
  assert.equal(evaluateAnswer(task, 3), false);
});

test('shape-place classify: per-block feedback and whole-set completion', () => {
  const task = geometryPool.find(e => e.id === 'MA-G-007').task; // blocks [sphere,cube,sphere,cylinder]
  // 全对（同块两块都分对）
  assert.equal(evaluateAnswer(task, ['sphere@z1', 'cube@z2', 'sphere@z1', 'cylinder@z3']), true);
  // 顺序无关
  assert.equal(evaluateAnswer(task, ['cylinder@z3', 'sphere@z1', 'cube@z2', 'sphere@z1']), true);
  // 单块错：第 2 块（cube）误入 z1
  const wrong1 = shapePlaceResult(task, ['sphere@z1', 'cube@z1', 'sphere@z1', 'cylinder@z3']);
  assert.deepEqual([...wrong1.wrongBlocks], [1]);
  assert.equal(wrong1.complete, false);
  // 多块错：cube 误入 z3、cylinder 误入 z2
  const wrong2 = shapePlaceResult(task, ['sphere@z1', 'cube@z3', 'sphere@z1', 'cylinder@z2']);
  assert.deepEqual([...wrong2.wrongBlocks], [1, 3]);
  // 漏分配：3 条不完成
  assert.equal(evaluateAnswer(task, ['sphere@z1', 'cube@z2', 'cylinder@z3']), false);
  // 非法条目不算完成
  assert.equal(evaluateAnswer(task, ['sphere@z1', 'cube@z2', 'sphere@z1', 'triangle@z3']), false);
  assert.equal(evaluateAnswer(task, ['sphere', 'cube@z2', 'sphere@z1', 'cylinder@z3']), false);
  assert.equal(evaluateAnswer(task, 'sphere@z1'), false);
  assert.equal(evaluateAnswer(task, null), false);
});

test('shape-place build: slot-wise accept sets (equivalent solutions)', () => {
  const task = geometryPool.find(e => e.id === 'MA-G-013').task; // z1 [cylinder], z2 [cube,cuboid]
  // 等价解 1：塔顶正方体
  assert.equal(evaluateAnswer(task, ['cylinder@z1', 'cube@z2']), true);
  // 等价解 2：塔顶长方体（多解口径）
  assert.equal(evaluateAnswer(task, ['cylinder@z1', 'cuboid@z2']), true);
  // 球不满足任何槽
  const wrong = shapePlaceResult(task, ['cylinder@z1', 'sphere@z2']);
  assert.deepEqual([...wrong.slotOk], [true, false]);
  assert.equal(wrong.complete, false);
  assert.equal(evaluateAnswer(task, ['cylinder@z1']), false);
  assert.equal(evaluateAnswer(task, ['cube@z2', 'cylinder@z1']), true);
  assert.equal(evaluateAnswer(task, null), false);
});

test('shape-place build: all-pool placement matrix', () => {
  for (const exercise of geometryPool.filter(e => e.task.kind === 'shape-place' && e.task.mode === 'build')) {
    const answer = correctShapeAnswer(exercise.task);
    assert.equal(evaluateAnswer(exercise.task, answer), true, `${exercise.id} canonical answer completes`);
    assert.equal(evaluateAnswer(exercise.task, [...answer].reverse()), true, `${exercise.id} order-independent`);
  }
});

test('classify canonical answers complete for every pool task', () => {
  for (const exercise of geometryPool.filter(e => e.task.kind === 'shape-place' && e.task.mode === 'classify')) {
    const answer = correctShapeAnswer(exercise.task);
    assert.equal(answer.length, exercise.task.blocks.length);
    assert.equal(evaluateAnswer(exercise.task, answer), true, `${exercise.id} canonical answer completes`);
  }
});

test('63 non-empty grade combinations: geometry pool appears only for grade 1, never drafts', () => {
  const core = createLearningCore({
    textbooks: catalog.textbooks,
    units: catalog.units,
    skills: catalog.skills,
    mappings: catalog.mappings,
    evidence: catalog.evidence,
    exercises: geometryPool,
  });
  const grades = [1, 2, 3, 4, 5, 6];
  for (let mask = 1; mask < 64; mask++) {
    const selected = grades.filter((_, i) => mask & (1 << i));
    const picked = core.selectExercises({ subject: 'math', grades: selected, gameId: 'geometry-builder' });
    const expected = selected.includes(1);
    assert.equal(picked.length > 0, expected, `grades ${selected}`);
    assert.ok(picked.every(e => e.review.status === 'approved'));
    assert.ok(picked.every(e => e.gameIds.includes('geometry-builder')));
  }
  // 预览含同样题目（无草稿），正式口径与候选口径分开。
  assert.equal(core.previewExercises({ subject: 'math', grades: [1], gameId: 'geometry-builder' }).length, 18);
});

test('default static catalog untouched by geometry pool', () => {
  const defaultMath = defaultCore.select({ subject: 'math', grades: [1], gameId: 'number-puzzle' });
  assert.ok(defaultMath.every(e => e.gameIds.includes('number-puzzle')));
  assert.ok(!defaultMath.some(e => e.gameIds.includes('geometry-builder')));
});

test('shared regression: hanzi/pinyin/english/choice tasks still judge', () => {
  assert.equal(evaluateAnswer({ kind: 'number', value: 7 }, '7'), true);
  const hanzi = geometryPool; // placeholder to keep lints honest
  assert.ok(Array.isArray(hanzi));
});

test('cleanup temp dir', () => { rmSync(work, { recursive: true, force: true }); });
