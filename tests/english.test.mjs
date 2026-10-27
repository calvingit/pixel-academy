// 英语快递任务（EnglishDeliveryTask）校验与判题测试：两步复合判题、可接受集合同义身份、
// 候选排列无关、非法任务拒绝、内容池结构与映射、正式池筛选与 draft/gameId 隔离、年级过滤。
// 从编译产物导入（与 tests/pinyin.test.mjs 同口径，npm test 先 build 后测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEnglishWord, isEnglishTask, englishCanonicalWord, englishDeliveryAnswer,
  englishDeliveryResult, validateEnglishTask,
  ENGLISH_FAMILY_WORDS, ENGLISH_EMOTION_WORDS, ENGLISH_WORDS, ENGLISH_SYNONYMS } from '../dist/learning/english.js';
import { evaluateAnswer, validateTask } from '../dist/learning/evaluation.js';
import { englishExercises } from '../dist/content/english-exercises.js';
import { describeAvailability, OPEN_GRADES, RECIPIENT_IMAGES, selectEnglishExercises } from '../dist/game/english-courier/content.js';
import { GAME_ID } from '../dist/game/english-courier/rules.js';
import { createLearningCore } from '../dist/learning/catalog.js';
import { catalog } from '../dist/index.js';
import { textbooks } from '../dist/content/textbooks.js';
import { units } from '../dist/content/units.js';
import { skills, mappings } from '../dist/content/skills.js';
import { evidence } from '../dist/content/evidence.js';

// ===== 测试用任务构造 =====

const task = (overrides = {}) => ({
  kind: 'english-delivery', mode: 'vocab',
  prompt: 'Deliver the parcel to Mum.',
  parcels: ['mum', 'dad', 'grandma', 'sister'],
  recipients: ['mum', 'dad', 'grandma', 'sister'],
  parcelAnswers: ['mum'],
  recipientAnswers: ['mum'],
  ...overrides,
});
const pair = (parcel, recipient) => [parcel, recipient];

// ---------------------------------------------------------------------------
// 词表与结构校验
// ---------------------------------------------------------------------------

test('词表：家庭 6 + 情绪 6，无交集；同义表归一到规范词', () => {
  assert.equal(ENGLISH_FAMILY_WORDS.length, 6);
  assert.equal(ENGLISH_EMOTION_WORDS.length, 6);
  assert.equal(new Set(ENGLISH_WORDS).size, 12);
  assert.equal(englishCanonicalWord('mother'), 'mum');
  assert.equal(englishCanonicalWord('mom'), 'mum');
  assert.equal(englishCanonicalWord('father'), 'dad');
  assert.equal(englishCanonicalWord('grandmother'), 'grandma');
  assert.equal(englishCanonicalWord('grandfather'), 'grandpa');
  assert.equal(englishCanonicalWord('glad'), 'happy');
  assert.equal(englishCanonicalWord('unhappy'), 'sad');
  assert.equal(englishCanonicalWord('mum'), 'mum');
  assert.throws(() => englishCanonicalWord('apple'), TypeError, '词表外词拒绝');
  assert.equal(isEnglishWord('sister'), true);
  assert.equal(isEnglishWord('mummy'), true);
  assert.equal(isEnglishWord('Mum'), false, '数据层只收小写规范/同义形');
  assert.equal(isEnglishWord(''), false);
  assert.equal(isEnglishWord(1), false);
});

test('合法任务通过校验，isEnglishTask 识别', () => {
  assert.ok(isEnglishTask(task()));
  assert.equal(isEnglishTask({ kind: 'choice' }), false);
  assert.equal(isEnglishTask({ kind: 'pinyin-choose' }), false);
  validateEnglishTask(task());
  englishDeliveryAnswer(task());
});

test('非法任务被拒绝：mode、题面、候选数量/重复/词表、答案集合', () => {
  assert.throws(() => validateEnglishTask(task({ mode: 'reading' })), TypeError);
  assert.throws(() => validateEnglishTask(task({ prompt: '  ' })), TypeError);
  assert.throws(() => validateEnglishTask(task({ parcels: ['mum', 'dad'] })), RangeError, '包裹少于 3');
  assert.throws(() => validateEnglishTask(task({ recipients: ['mum', 'dad'] })), RangeError, '角色少于 3');
  assert.throws(() => validateEnglishTask(task({ parcels: ['mum', 'dad', 'grandma', 'sister', 'brother'] })), RangeError, '包裹多于 4');
  assert.throws(() => validateEnglishTask(task({ recipients: ['mum', 'mum', 'dad', 'sister'] })), TypeError, '角色重复');
  assert.throws(() => validateEnglishTask(task({ parcels: ['mum', 'dad', 'grandma', 'apple'] })), TypeError, '词表外包裹');
  assert.throws(() => validateEnglishTask(task({ recipients: ['mum', 'dad', 'grandma', 'HAPPY'] })), TypeError, '大小写敏感');
  assert.throws(() => validateEnglishTask(task({ parcelAnswers: [] })), TypeError, '空答案集合');
  assert.throws(() => validateEnglishTask(task({ parcelAnswers: ['mother'] })), RangeError, '答案不在候选中不可达');
  assert.throws(() => validateEnglishTask(task({ recipientAnswers: ['mum', 'dad'] })), TypeError, '答案集合必须同指一个身份');
  assert.throws(() => validateEnglishTask(task({ parcelAnswers: ['cat'] })), TypeError, '答案须为词表内词');
});

test('可接受集合容纳同义表达：mother 与 mum 同集合同身份', () => {
  const withSynonym = task({ parcels: ['mum', 'mother', 'dad', 'sister'], parcelAnswers: ['mum', 'mother'] });
  validateEnglishTask(withSynonym);
  assert.deepEqual(englishDeliveryAnswer(withSynonym), { parcel: 'mum', recipient: 'mum' });
  assert.equal(englishDeliveryResult(withSynonym, pair('mother', 'mum')).complete, true);
  assert.equal(englishDeliveryResult(withSynonym, pair('mum', 'mum')).complete, true);
});

// ---------------------------------------------------------------------------
// 判题：两步复合、排列无关、作答契约
// ---------------------------------------------------------------------------

test('判题：双对才算完成；单步错误给出分步结果', () => {
  assert.deepEqual(englishDeliveryResult(task(), pair('mum', 'mum')),
    { parcel: true, recipient: true, complete: true });
  assert.deepEqual(englishDeliveryResult(task(), pair('dad', 'mum')),
    { parcel: false, recipient: true, complete: false }, '选错包裹送对人');
  assert.deepEqual(englishDeliveryResult(task(), pair('mum', 'dad')),
    { parcel: true, recipient: false, complete: false }, '选对包裹送错人');
  assert.deepEqual(englishDeliveryResult(task(), pair('dad', 'sister')),
    { parcel: false, recipient: false, complete: false }, '双错');
});

test('判题按身份不按位置：候选反转后结果不变', () => {
  const reversed = task({
    parcels: ['sister', 'grandma', 'dad', 'mum'],
    recipients: ['sister', 'grandma', 'dad', 'mum'],
  });
  validateEnglishTask(reversed);
  assert.equal(evaluateAnswer(reversed, pair('mum', 'mum')), true);
  assert.equal(evaluateAnswer(reversed, pair('sister', 'sister')), false);
});

test('作答契约：非长度 2 数组、非字符串成员、集合外词一律不算完成', () => {
  assert.equal(evaluateAnswer(task(), 'mum'), false);
  assert.equal(evaluateAnswer(task(), ['mum']), false);
  assert.equal(evaluateAnswer(task(), ['mum', 'mum', 'dad']), false);
  assert.equal(evaluateAnswer(task(), [1, 'mum']), false);
  assert.equal(evaluateAnswer(task(), pair('mum', 2)), false);
  assert.equal(evaluateAnswer(task(), pair('apple', 'mum')), false, '包裹须在候选内');
  assert.equal(evaluateAnswer(task(), pair('mum', 'dragon')), false, '角色须在候选内');
  assert.equal(evaluateAnswer(task(), null), false);
});

test('validateTask 路由英语任务；evaluateAnswer 对既有学科不受影响', () => {
  validateTask(task());
  assert.throws(() => validateTask(task({ recipientAnswers: ['mum', 'dad'] })), TypeError, '答案集合必须同指一个身份');
  // 共享分派回归：数学/拼音判题行为不变。
  assert.equal(evaluateAnswer({ kind: 'number', value: 5 }, 5), true);
  assert.equal(evaluateAnswer({ kind: 'number', value: 5 }, '6'), false);
});

// ---------------------------------------------------------------------------
// 首批内容池：18 题结构与映射
// ---------------------------------------------------------------------------

test('内容池：18 题全部 approved，词汇 10 + 句意 8，ID 与映射正确', () => {
  assert.equal(englishExercises.length, 18);
  const ids = englishExercises.map(e => e.id);
  assert.equal(new Set(ids).size, 18);
  assert.deepEqual(ids, ids.map((id, i) => `EN-C-${String(i + 1).padStart(3, '0')}`), 'ID 段 EN-C-001 起连续');
  const vocab = englishExercises.filter(e => e.task.mode === 'vocab');
  const sentence = englishExercises.filter(e => e.task.mode === 'sentence');
  assert.equal(vocab.length, 10);
  assert.equal(sentence.length, 8);
  for (const exercise of englishExercises) {
    const isFamily = ENGLISH_FAMILY_WORDS.includes(exercise.task.parcelAnswers[0]);
    assert.deepEqual(exercise.mappingIds, [isFamily ? 'MAP-015' : 'MAP-016'],
      `${exercise.id} 映射与词族不一致`);
    assert.deepEqual(exercise.gameIds, [GAME_ID]);
    assert.equal(exercise.subject, 'english');
    assert.equal(exercise.review.status, 'approved');
    assert.ok(exercise.review.reviewer.trim());
  }
});

test('内容池全部通过结构校验；12 词均被至少一题覆盖；候选取自同族词表', () => {
  const covered = new Set();
  for (const exercise of englishExercises) {
    const t = exercise.task;
    validateEnglishTask(t);
    const family = ENGLISH_FAMILY_WORDS;
    const emotion = ENGLISH_EMOTION_WORDS;
    const list = family.includes(t.parcelAnswers[0]) ? family : emotion;
    for (const w of [...t.parcels, ...t.recipients]) {
      assert.ok(list.includes(w), `${exercise.id} 候选 ${w} 不在同族词表`);
    }
    covered.add(englishDeliveryAnswer(t).parcel);
  }
  for (const word of ENGLISH_WORDS) {
    assert.ok(covered.has(word), `词 ${word} 未被任何任务覆盖`);
  }
});

test('角色配图映射覆盖全部 12 词且文件路径规范', () => {
  for (const word of ENGLISH_WORDS) {
    assert.match(RECIPIENT_IMAGES[word], new RegExp(`^/img/english-courier/${word}\\.svg$`));
  }
});

// ---------------------------------------------------------------------------
// 正式池筛选、draft 隔离与年级过滤
// ---------------------------------------------------------------------------

const pool1 = selectEnglishExercises([1]);

test('正式池筛选：一年级 18 个 approved 任务，二至六年级无内容且不互相填补', () => {
  assert.equal(pool1.length, 18);
  assert.ok(pool1.every(exercise => exercise.review.status === 'approved'));
  assert.ok(pool1.every(exercise => exercise.gameIds.includes(GAME_ID)));
  assert.deepEqual(OPEN_GRADES, [1]);
  for (const grade of [2, 3, 4, 5, 6]) {
    assert.equal(selectEnglishExercises([grade]).length, 0, `${grade} 年级应无内容`);
  }
  assert.equal(selectEnglishExercises([1, 2]).length, 18, '混选不由其他年级填补');
  const report = describeAvailability([2]);
  assert.equal(report.startable, false);
  assert.ok(report.statusText.includes('二年级'));
  assert.equal(describeAvailability([1]).startable, true);
});

test('draft 隔离：草稿练习永不出现在正式取题', () => {
  const draft = {
    ...pool1[0],
    id: 'EN-DRAFT-01',
    review: { status: 'draft' },
  };
  const core = createLearningCore({
    textbooks, units, skills, mappings, evidence,
    exercises: [...englishExercises, draft],
  });
  const served = core.selectExercises({ subject: 'english', grades: [1], gameId: GAME_ID }).map(e => e.id);
  assert.ok(!served.includes('EN-DRAFT-01'));
  assert.ok(core.previewExercises({ subject: 'english', grades: [1], gameId: GAME_ID }).some(e => e.id === 'EN-DRAFT-01'));
});

test('gameId 隔离：默认静态 catalog 不含英语快递员内容，其他游戏取不到英语题', () => {
  assert.ok(catalog.exercises.every(exercise => !exercise.gameIds.includes(GAME_ID)),
    '英语题库按拼音冒险先例走游戏独立核心，不进默认 catalog');
  const defaultCore = createLearningCore(catalog);
  assert.equal(defaultCore.selectExercises({ subject: 'english', grades: [1], gameId: GAME_ID }).length, 0);
  assert.equal(selectEnglishExercises([1]).filter(exercise => exercise.gameIds.includes('hanzi-hero')).length, 0);
});
