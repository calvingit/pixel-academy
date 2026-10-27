// 拼音任务（PinyinTask）校验与判题测试：按字母身份判、候选排列无关、非法任务拒绝、
// 听辨题结构级无泄露断言、内容池筛选与 draft 隔离、年级过滤。
// 从编译产物导入（与 tests/hanzi.test.mjs 同口径，npm test 先 build 后测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPinyinLetter, isPinyinTask, correctPinyinAnswer, validatePinyinTask,
  PINYIN_INITIALS, PINYIN_FINALS } from '../dist/learning/pinyin.js';
import { evaluateAnswer, validateTask } from '../dist/learning/evaluation.js';
import {
  PINYIN_CONFUSABLE_GROUPS, PINYIN_AUDIO_BY_LETTER,
  pinyinDistractors, pinyinExercises,
} from '../dist/content/pinyin-exercises.js';
import { describeAvailability, OPEN_GRADES, selectPinyinExercises } from '../dist/game/pinyin-adventure/content.js';
import { createLearningCore } from '../dist/learning/catalog.js';
import { catalog } from '../dist/index.js';
import { textbooks } from '../dist/content/textbooks.js';
import { units } from '../dist/content/units.js';
import { skills, mappings } from '../dist/content/skills.js';
import { evidence } from '../dist/content/evidence.js';
import { GAME_ID } from '../dist/game/pinyin-adventure/rules.js';

// ===== 测试用任务构造 =====

const choose = (overrides = {}) => ({
  kind: 'pinyin-choose', letter: 'b', prompt: '找出字母「b」',
  options: ['b', 'd', 'p', 'q'], answer: 'b', ...overrides,
});
const listen = (overrides = {}) => ({
  kind: 'pinyin-listen', letter: 'b', audio: 'audio/pinyin/b.wav',
  prompt: '听一听，是哪个字母？', options: ['b', 'd', 'p', 'q'], answer: 'b', ...overrides,
});

// ---------------------------------------------------------------------------
// 字母与结构校验
// ---------------------------------------------------------------------------

test('isPinyinLetter：单字母（含 ü）与 zh/ch/sh 合法，其余拒绝', () => {
  for (const letter of ['b', 'ü', 'z', 'zh', 'ch', 'sh', 'w']) assert.ok(isPinyinLetter(letter));
  for (const letter of ['B', 'bd', 'abc', 'yu', 'üng', '', ' b', 1, null, undefined]) {
    assert.equal(isPinyinLetter(letter), false, `${String(letter)} 应非法`);
  }
});

test('合法辨认/听辨任务通过校验，isPinyinTask 识别两类', () => {
  assert.ok(isPinyinTask(choose()));
  assert.ok(isPinyinTask(listen()));
  assert.equal(isPinyinTask({ kind: 'choice' }), false);
  assert.equal(isPinyinTask({ kind: 'hanzi-choose' }), false);
  validatePinyinTask(choose());
  validatePinyinTask(listen());
  correctPinyinAnswer(choose());
  correctPinyinAnswer(listen());
});

test('非法任务被拒绝：字母、答案身份、候选数量/重复/可达、题面、音频路径', () => {
  assert.throws(() => validatePinyinTask(choose({ letter: 'bd' })), TypeError);
  assert.throws(() => validatePinyinTask(choose({ letter: 'B' })), TypeError);
  assert.throws(() => validatePinyinTask(choose({ answer: 'd' })), TypeError, '答案必须与目标字母同身份');
  assert.throws(() => validatePinyinTask(choose({ options: ['b', 'd', 'p'] })), RangeError, '候选少于 4');
  assert.throws(() => validatePinyinTask(choose({ options: ['b', 'b', 'd', 'p'] })), TypeError, '候选重复');
  assert.throws(() => validatePinyinTask(choose({ options: ['d', 'p', 'q', 't'] })), RangeError, '答案不可达');
  assert.throws(() => validatePinyinTask(choose({ options: ['b', 'd', 'p', 'bb'] })), TypeError, '候选须为合法字母');
  assert.throws(() => validatePinyinTask(choose({ prompt: '  ' })), TypeError);
  assert.throws(() => validatePinyinTask(listen({ prompt: '选出你听到的 b' })), TypeError, '听辨题面出现字母即泄露');
  assert.throws(() => validatePinyinTask(listen({ prompt: '听一听，选出 B' })), TypeError, '大写字母同样算泄露');
  assert.throws(() => validatePinyinTask(listen({ prompt: '听一听，是 ü 吗？' })), TypeError, 'ü 字形同样算泄露');
  assert.throws(() => validatePinyinTask(listen({ audio: '/abs/b.wav' })), TypeError);
  assert.throws(() => validatePinyinTask(listen({ audio: 'audio/pinyin/b.mp3' })), TypeError);
  assert.throws(() => validatePinyinTask(listen({ audio: 'audio/pinyin/Ü.wav' })), TypeError, '音频文件名必须 ASCII');
  assert.throws(() => validatePinyinTask(listen({ audio: '' })), TypeError);
});

test('判题按字母身份：候选反转排列不变、非字符串答案拒绝', () => {
  const task = choose({ options: ['b', 'd', 'p', 'q'] });
  assert.equal(evaluateAnswer(task, 'b'), true);
  assert.equal(evaluateAnswer(task, 'd'), false);
  assert.equal(evaluateAnswer(task, 'q'), false);
  // 反转候选排列：答案身份不变，判题结果不变（不依赖位置/排列）。
  const reversed = choose({ options: ['q', 'p', 'd', 'b'] });
  validatePinyinTask(reversed);
  assert.equal(evaluateAnswer(reversed, 'b'), true);
  assert.equal(evaluateAnswer(reversed, 'q'), false);
  assert.equal(evaluateAnswer(task, 0), false);
  assert.equal(evaluateAnswer(task, ['b']), false);
  assert.equal(evaluateAnswer(task, ' b '), false, '判题只按字母身份，不做宽松裁剪');
});

test('validateTask 路由拼音任务：合法不抛、非法抛', () => {
  validateTask(choose());
  validateTask(listen());
  assert.throws(() => validateTask(choose({ answer: 'd' })));
  assert.throws(() => validateTask(listen({ prompt: '答案是 zh' })));
});

// ---------------------------------------------------------------------------
// 首批内容：94 题结构与听辨无泄露断言
// ---------------------------------------------------------------------------

test('内容池：23 声母 + 24 韵母 × 2 模式 = 94 题，ID 与映射正确', () => {
  assert.equal(PINYIN_INITIALS.length, 23);
  assert.equal(PINYIN_FINALS.length, 24);
  assert.equal(pinyinExercises.length, 94);
  const ids = pinyinExercises.map(e => e.id);
  assert.equal(new Set(ids).size, 94, '练习 ID 唯一');
  for (const exercise of pinyinExercises) {
    const task = exercise.task;
    assert.ok(isPinyinTask(task));
    const expectMapping = PINYIN_INITIALS.includes(task.letter) ? 'MAP-003' : 'MAP-004';
    assert.deepEqual(exercise.mappingIds, [expectMapping]);
    assert.deepEqual(exercise.gameIds, [GAME_ID]);
    assert.equal(exercise.subject, 'chinese');
    assert.equal(exercise.review.status, 'approved');
  }
});

test('全部 94 题通过结构校验；候选恰好 4 个且含答案、无重复', () => {
  for (const exercise of pinyinExercises) {
    validatePinyinTask(exercise.task);
    assert.equal(exercise.task.options.length, 4);
    assert.ok(exercise.task.options.includes(exercise.task.answer));
    assert.equal(new Set(exercise.task.options).size, 4);
    assert.notEqual(exercise.review.reviewer, '');
  }
});

test('听辨题结构级无泄露：题面无任何拼音字母、audio 与字母一一对应', () => {
  const LATIN = /[a-zü]/i;
  for (const exercise of pinyinExercises) {
    const task = exercise.task;
    if (task.kind !== 'pinyin-listen') continue;
    assert.ok(!LATIN.test(task.prompt), `${exercise.id} 题面泄露字母：${task.prompt}`);
    assert.doesNotMatch(task.audio, /[ü]/, '音频路径不含非 ASCII');
    assert.equal(task.audio, `audio/pinyin/${PINYIN_AUDIO_BY_LETTER[task.letter]}.wav`,
      `${exercise.id} 音频与字母不对应`);
  }
});

test('辨认题与听辨题答案身份一致（同字母两模式同一答案）', () => {
  for (const exercise of pinyinExercises) {
    const task = exercise.task;
    assert.equal(task.answer, task.letter);
    assert.equal(correctPinyinAnswer(task), task.letter);
  }
});

test('干扰项可解释：每个干扰项来自目标所在易混组或同类别拼音表', () => {
  for (const exercise of pinyinExercises) {
    const task = exercise.task;
    const category = PINYIN_INITIALS.includes(task.letter) ? 'initials' : 'finals';
    assert.deepEqual(task.options.filter(o => o !== task.letter), [...pinyinDistractors(task.letter, category)],
      `${exercise.id} 干扰项与生成规则不一致`);
    const groupMates = new Set(PINYIN_CONFUSABLE_GROUPS
      .filter(group => group.includes(task.letter)).flatMap(group => group));
    for (const distractor of task.options) {
      if (distractor === task.letter) continue;
      assert.ok(
        groupMates.has(distractor)
        || (category === 'initials' ? PINYIN_INITIALS : PINYIN_FINALS).includes(distractor),
        `${exercise.id} 干扰项 ${distractor} 既不在易混组也不在同类别表`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 正式池筛选、draft 隔离与年级过滤
// ---------------------------------------------------------------------------

const pool1 = selectPinyinExercises([1]);

test('正式池筛选：一年级 94 道 approved，二至六年级无内容且不互相填补', () => {
  assert.equal(pool1.length, 94);
  assert.ok(pool1.every(exercise => exercise.review.status === 'approved'));
  assert.ok(pool1.every(exercise => exercise.gameIds.includes(GAME_ID)));
  assert.deepEqual(OPEN_GRADES, [1]);
  for (const grade of [2, 3, 4, 5, 6]) {
    assert.equal(selectPinyinExercises([grade]).length, 0, `${grade} 年级应无内容`);
  }
  assert.equal(selectPinyinExercises([1, 2]).length, 94, '混选不由其他年级填补');
  const report = describeAvailability([2]);
  assert.equal(report.startable, false);
  assert.ok(report.statusText.includes('二年级'));
  assert.ok(describeAvailability([1]).startable, true);
});

test('draft 隔离：草稿练习永不出现在正式取题', () => {
  const draft = {
    ...pool1[0],
    id: 'PY-DRAFT-01',
    review: { status: 'draft' },
  };
  const core = createLearningCore({
    textbooks, units, skills, mappings, evidence,
    exercises: [...pinyinExercises, draft],
  });
  const served = core.selectExercises({ subject: 'chinese', grades: [1], gameId: GAME_ID }).map(e => e.id);
  assert.ok(!served.includes('PY-DRAFT-01'));
  // 预览口径包含 draft（仅显式预览入口可用，拼音冒险不使用）。
  assert.ok(core.previewExercises({ subject: 'chinese', grades: [1], gameId: GAME_ID }).some(e => e.id === 'PY-DRAFT-01'));
});

test('gameId 隔离：默认静态 catalog 不含拼音冒险内容，其他游戏取不到拼音题', () => {
  assert.ok(catalog.exercises.every(exercise => !exercise.gameIds.includes(GAME_ID)),
    '拼音题库按地下城先例走游戏独立核心，不进默认 catalog');
  const defaultCore = createLearningCore(catalog);
  assert.equal(defaultCore.selectExercises({ subject: 'chinese', grades: [1], gameId: GAME_ID }).length, 0);
  assert.equal(defaultCore.selectExercises({ subject: 'chinese', grades: [1], gameId: 'hanzi-hero' })
    .filter(exercise => isPinyinTask(exercise.task)).length, 0);
  assert.equal(selectPinyinExercises([1]).filter(exercise => exercise.gameIds.includes('hanzi-hero')).length, 0);
});
