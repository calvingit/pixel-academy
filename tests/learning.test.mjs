import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, validateCatalog, createLearningCore, selectExercises, previewExercises, answerFor, evaluateAnswer } from '../dist/index.js';
const query = grades => ({ subject: 'math', grades, gameId: 'number-puzzle' });
const ids = rows => rows.map(row => row.id).sort();
const changed = changes => ({ ...structuredClone(catalog), ...changes });

test('36 unique textbook slots, four candidate directories, 16 skills and mappings', () => {
  assert.deepEqual(validateCatalog(catalog), []);
  assert.equal(catalog.textbooks.length, 36);
  assert.equal(new Set(catalog.textbooks.map(b => `${b.subject}/${b.grade}/${b.term}`)).size, 36);
  assert.equal(catalog.textbooks.filter(b => b.directoryStatus === 'candidate').length, 4);
  assert.equal(catalog.skills.length, 16);
  assert.equal(catalog.mappings.length, 16);
  for (const b of catalog.textbooks) {
    assert.equal(b.isbn, null);
    assert.equal(b.localAdoptionVerification, 'pending');
  }
});
test('main unit IDs do not shift when practice or preparation blocks are inserted', () => {
  for (const [book, count] of [['CH-01A',8],['MA-01A',5],['MA-02A',8],['EN-01A',6]]) {
    assert.deepEqual(catalog.units.filter(u => u.textbookId === book && u.kind === 'main').map(u => u.id),
      Array.from({ length: count }, (_, i) => `${book}-U${String(i+1).padStart(2,'0')}`));
  }
});
test('production serves only the 15 approved exercises; 3 deferred drafts stay preview-only', () => {
  assert.equal(catalog.exercises.length, 18);
  const approved = ids(selectExercises(query([1,2])));
  assert.equal(approved.length, 15);
  for (const id of ['MATH-016', 'MATH-017', 'MATH-018']) assert.ok(!approved.includes(id));
  assert.equal(selectExercises(query([1])).length, 12);
  assert.equal(selectExercises(query([2])).length, 3);
  assert.equal(previewExercises(query([1,2])).length, 18);
});
test('all 63 grade subsets respect exact membership, including unavailable grades', () => {
  for (let mask = 1; mask < 64; mask++) {
    const grades = [1,2,3,4,5,6].filter(g => mask & (1 << (g-1)));
    const result = previewExercises(query(grades));
    assert.equal(result.length, (grades.includes(1) ? 12 : 0) + (grades.includes(2) ? 6 : 0));
    assert.deepEqual(ids(result), ids(previewExercises(query([...grades, ...grades]))));
  }
});
test('subject and game filters are mandatory boundaries', () => {
  assert.deepEqual(previewExercises({ ...query([1,2]), subject: 'english' }), []);
  assert.deepEqual(previewExercises({ ...query([1,2]), gameId: 'other' }), []);
  assert.throws(() => previewExercises(query([])), RangeError);
  assert.throws(() => previewExercises(query([7])), RangeError);
  assert.throws(() => previewExercises({ ...query([1]), gameId: ' ' }), TypeError);
});
test('reviewed exercises can run independently of pending textbook adoption verification', () => {
  const exercise = structuredClone(catalog.exercises[12]);
  exercise.review = { status: 'approved', reviewer: 'test-fixture-only', reviewedAt: '2026-10-25T00:00:00Z' };
  const core = createLearningCore(changed({ exercises: [exercise, catalog.exercises[15]] }));
  assert.deepEqual(core.selectExercises(query([1])), []);
  assert.deepEqual(ids(core.selectExercises(query([2]))), [exercise.id]);
  assert.equal(core.previewExercises(query([1,2])).length, 2);
});
test('multi-grade associations do not duplicate the exercise', () => {
  const exercise = { ...catalog.exercises[0], mappingIds: ['MAP-006','MAP-011'] };
  const core = createLearningCore(changed({ exercises: [exercise] }));
  assert.equal(core.previewExercises(query([1,2])).length, 1);
});
test('dangling links, duplicate IDs, missing evidence and subject mismatch fail early', () => {
  for (const broken of [
    changed({ textbooks: [...catalog.textbooks, catalog.textbooks[0]] }),
    changed({ evidence: [] }),
    changed({ mappings: [{ ...catalog.mappings[0], unitIds: ['missing'] }] }),
    changed({ mappings: [{ ...catalog.mappings[0], unitIds: ['MA-01A-U01'] }] }),
    changed({ exercises: [{ ...catalog.exercises[0], mappingIds: [] }] }),
    changed({ exercises: [{ ...catalog.exercises[0], mappingIds: ['missing'] }] }),
    changed({ exercises: [{ ...catalog.exercises[0], mappingIds: ['MAP-001'] }] }),
    changed({ exercises: [{ ...catalog.exercises[0], review: { status: 'approved', reviewer: '', reviewedAt: 'bad' } }] }),
  ]) assert.throws(() => createLearningCore(broken));
});
test('arithmetic and strict answer parsing', () => {
  const task = { kind: 'chain', start: 45, steps: [{ operator: '+', operand: 12 }, { operator: '-', operand: 7 }] };
  assert.equal(answerFor(task), 50);
  for (const value of [50, '50', ' 50 ']) assert.equal(evaluateAnswer(task, value), true);
  for (const value of ['', ' ', true, null, '50x', '5e1', '50.0', '25+25', 49, NaN, Infinity, {}, []]) {
    assert.equal(evaluateAnswer(task, value), false);
  }
  assert.equal(answerFor({ kind: 'binary', operator: '*', left: 3, right: 4 }), 12);
  assert.equal(answerFor({ kind: 'binary', operator: '-', left: 4, right: 4 }), 0);
  assert.equal(evaluateAnswer({ kind: 'number', value: 0 }, '0'), true);
});
test('invalid tasks fail rather than executing strings or overflowing silently', () => {
  for (const task of [
    { kind: 'binary', operator: '/', left: 1, right: 2 },
    { kind: 'binary', operator: '+', left: Number.MAX_SAFE_INTEGER, right: 1 },
    { kind: 'number', value: 0.5 }, { kind: 'number', value: NaN },
    { kind: 'chain', start: 1, steps: [] }, { kind: 'eval', code: '1+1' },
  ]) assert.throws(() => answerFor(task));
});
test('math samples obey the advertised numeric ranges and mapping concepts', () => {
  for (const exercise of catalog.exercises) {
    const result = answerFor(exercise.task);
    assert.ok(Number.isSafeInteger(result) && result >= 0);
    const mapping = exercise.mappingIds[0];
    const max = mapping === 'MAP-007' || mapping === 'MAP-008' ? 5 : mapping === 'MAP-011' ? 100 : mapping === 'MAP-013' ? 100 : 10;
    assert.ok(result <= max);
    if (exercise.task.kind === 'binary') {
      assert.ok(exercise.task.left >= 0 && exercise.task.left <= max);
      assert.ok(exercise.task.right >= 0 && exercise.task.right <= max);
    }
    if (mapping === 'MAP-011') {
      assert.equal(exercise.task.kind, 'chain');
      assert.ok(exercise.task.steps.length >= 2);
    }
  }
});
// 期望集合同样取自编译产物：exercises → mappingIds → 映射 → 单元 → 教材 grade，
// 与 src/learning/catalog.ts 的 mappingGrades 索引和 select 语义同构，但不复用其实现。
const bookGradeByUnit = new Map(catalog.units.map(u => [u.id,
  catalog.textbooks.find(b => b.id === u.textbookId).grade]));
const mappingGrades = new Map(catalog.mappings.map(m => [m.id,
  new Set(m.unitIds.map(id => bookGradeByUnit.get(id)))]));
const expectedApproved = grade => catalog.exercises
  .filter(e => e.review.status === 'approved' && e.subject === 'math' &&
    e.gameIds.includes('number-puzzle') &&
    e.mappingIds.some(id => mappingGrades.get(id).has(grade)))
  .map(e => e.id).sort();
// 数值范围来自 docs/gameplay-number-puzzle.md「年级、数值范围与难度分档」与「实现常量一览」：
// 档位 A（一年级）0–10、档位 B（二年级）0–100，均为含端点闭区间。
const tierRange = { 1: [0, 10], 2: [0, 100] };

test('selectExercises for a single grade equals the approved set derived from content data', () => {
  for (const grade of [1, 2]) {
    assert.deepEqual(ids(selectExercises(query([grade]))), expectedApproved(grade));
  }
});
test('approved answers stay inside the gameplay numeric range of their grade tier', () => {
  for (const exercise of catalog.exercises) {
    if (exercise.review.status !== 'approved') continue;
    const grades = exercise.mappingIds.flatMap(id => [...mappingGrades.get(id)]);
    // 多年级关联的练习按玩法说明取最高档；出现未定档位的年级属文档缺口，应让测试失败。
    const [min, max] = tierRange[Math.max(...grades)];
    const answer = answerFor(exercise.task);
    assert.ok(answer >= min && answer <= max, `${exercise.id} answer ${answer} outside ${min}–${max}`);
  }
});
test('draft exercises never appear in any selectExercises result', () => {
  const draftIds = new Set(catalog.exercises.filter(e => e.review.status === 'draft').map(e => e.id));
  for (let mask = 1; mask < 64; mask++) {
    const grades = [1,2,3,4,5,6].filter(g => mask & (1 << (g-1)));
    for (const id of ids(selectExercises(query(grades)))) assert.ok(!draftIds.has(id), `draft ${id} was served`);
  }
});
