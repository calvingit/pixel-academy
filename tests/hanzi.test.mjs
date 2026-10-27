// 汉字勇者窄路径验证：语文任务校验/判题、非法任务拒绝、学科与 gameId 隔离、草稿隔离。
// 从编译产物导入（与 tests/learning.test.mjs 同口径，npm test 先 build 后测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, selectExercises, previewExercises, evaluateAnswer, validateTask } from '../dist/index.js';
import { createLearningCore } from '../dist/learning/catalog.js';
import { correctHanziIds } from '../dist/learning/hanzi.js';

const hanziQuery = grades => ({ subject: 'chinese', grades, gameId: 'hanzi-hero' });
const ids = rows => rows.map(e => e.id);

const chooseTask = { kind: 'hanzi-choose', mode: 'shape', target: '山', options: ['山', '川', '火', '土'] };
const meaningTask = { kind: 'hanzi-choose', mode: 'meaning', target: '日', image: 'web/img/hanzi-hero/mean-sun.svg', options: ['日', '月', '火', '土'] };
const partsTask = { kind: 'hanzi-parts', result: '明', parts: ['日', '月'], image: 'web/img/hanzi-hero/ming.svg', options: ['日', '月', '口', '木', '手'] };

test('hanzi-choose single answer: target identity decides, not position', () => {
  const id = correctHanziIds(chooseTask)[0];
  assert.equal(id, '山'); // 候选即字卡，答案身份 = 字本身
  assert.equal(evaluateAnswer(chooseTask, id), true);
  // 相同字在候选中的位置不同时，答案身份仍由字本身决定。
  const flipped = { ...chooseTask, options: [...chooseTask.options].reverse() };
  assert.equal(correctHanziIds(flipped)[0], id);
  assert.equal(evaluateAnswer(flipped, id), true);
  // 非目标选项均判错。
  for (const option of chooseTask.options) {
    if (option === '山') continue;
    assert.equal(evaluateAnswer(chooseTask, option), false);
  }
  assert.equal(evaluateAnswer(chooseTask, 'not-an-option'), false);
  assert.equal(evaluateAnswer(chooseTask, 0), false);
  assert.equal(evaluateAnswer(chooseTask, ['']), false);
});

test('hanzi meaning task validates image requirement and judges by option id', () => {
  assert.equal(validateTask(meaningTask), undefined);
  assert.equal(evaluateAnswer(meaningTask, correctHanziIds(meaningTask)[0]), true);
  assert.throws(() => validateTask({ ...meaningTask, image: undefined }), TypeError);
});

test('hanzi-parts judges the whole selected set, unordered, no duplicates', () => {
  const idsExpected = correctHanziIds(partsTask);
  assert.equal(idsExpected.length, 2);
  assert.equal(evaluateAnswer(partsTask, idsExpected), true);
  assert.equal(evaluateAnswer(partsTask, [...idsExpected].reverse()), true);
  assert.equal(evaluateAnswer(partsTask, [idsExpected[0]]), false);
  assert.equal(evaluateAnswer(partsTask, [...idsExpected, idsExpected[0]]), false);
  assert.equal(evaluateAnswer(partsTask, ['口', '木']), false);
  assert.equal(evaluateAnswer(partsTask, '日'), false);
});

test('invalid hanzi tasks fail validation, not silent acceptance', () => {
  assert.throws(() => validateTask({ ...chooseTask, options: ['山', '川', '火'] }), RangeError); // 少于 4 个候选
  assert.throws(() => validateTask({ ...chooseTask, options: ['山', '山', '火', '土'] }), TypeError); // 候选重复
  assert.throws(() => validateTask({ ...chooseTask, target: '水' }), RangeError); // 目标不在候选内
  assert.throws(() => validateTask({ ...chooseTask, target: '中外' }), TypeError); // 非单字符
  assert.throws(() => validateTask({ ...chooseTask, mode: 'meaning' }), TypeError); // meaning 缺图
  assert.throws(() => validateTask({ ...chooseTask, mode: 'shape', image: 'x.svg' }), TypeError); // shape 带图
  assert.throws(() => validateTask({ ...partsTask, parts: ['木', '木'] }), TypeError); // 部件重复（不支持重复部件）
  assert.throws(() => validateTask({ ...partsTask, result: '日', parts: ['日', '月'] }), TypeError); // 结果字混入部件
  assert.throws(() => validateTask({ ...partsTask, parts: ['日', '人'] }), RangeError); // 部件不在候选内
});

test('content pool: 28 approved chinese exercises, only grade 1, only hanzi-hero', () => {
  const hanzi = catalog.exercises.filter(e => e.subject === 'chinese');
  assert.equal(hanzi.length, 28);
  assert.ok(hanzi.every(e => e.review.status === 'approved' && e.gameIds.includes('hanzi-hero')));
  assert.ok(hanzi.every(e => e.mappingIds.some(id => ['MAP-001', 'MAP-002'].includes(id))));
  assert.equal(ids(selectExercises(hanziQuery([1]))).length, 28);
  assert.equal(ids(selectExercises(hanziQuery([2, 3, 4, 5, 6]))).length, 0);
  assert.equal(ids(selectExercises({ subject: 'chinese', grades: [1], gameId: 'number-puzzle' })).length, 0);
  assert.equal(ids(selectExercises({ subject: 'math', grades: [1], gameId: 'hanzi-hero' })).length, 0);
  // 数学正式池不被语文内容污染。
  assert.equal(selectExercises({ subject: 'math', grades: [1, 2], gameId: 'number-puzzle' }).length, 18);
  assert.equal(previewExercises(hanziQuery([1])).length, 28);
});

test('draft isolation: a draft hanzi exercise never appears in selectExercises', () => {
  // 构造含 draft（独立 ID，避免触发重复 ID 校验）的独立 catalog 验证筛选隔离。
  const draft = { ...catalog.exercises.find(e => e.subject === 'chinese'), id: 'HZ-DRAFT-01', review: { status: 'draft' } };
  const core = createLearningCore({ ...catalog, exercises: [...catalog.exercises, draft] });
  const served = ids(core.selectExercises(hanziQuery([1])));
  assert.ok(!served.includes('HZ-DRAFT-01'));
  assert.equal(served.length, 28);
  // 预览口径包含 draft（显式预览入口专用）。
  assert.equal(ids(core.previewExercises(hanziQuery([1]))).length, 29);
});
