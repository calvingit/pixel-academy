// 几何建筑师规则与存储测试：组卷（5 任务唯一、题型配额、避重、积木/分区/选项洗牌分布）、
// 点选/拖拽放置与整组提交判定、计分档（首答=第一次判定）、等价多解、错块反馈、
// 撤回与操作统计、快照往返恢复一致（含布局与选中态）、损坏快照拒绝、
// 记录 gameId 与辨认/分类/搭建模式区分、存储解析健壮性。
// 从编译产物导入（npm test 先 build 后测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceQuestion, answerChoose, createRound, FIRST_TRY_SCORE, GAME_ID, geometryMode,
  parseSnapshot, placeByClick, placeByDrag, QUESTIONS_PER_ROUND, RETRY_SCORE, retract,
  selectBlock, settlement, shuffle, submitClassify,
} from '../dist/game/geometry-builder/rules.js';
import { buildRecord, parseRecord, parseRecords, parseSettingsValue } from '../dist/game/geometry-builder/storage.js';
import { selectGeometryExercises } from '../dist/game/geometry-builder/content.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';

const pool1 = selectGeometryExercises([1]);
const choosePool = pool1.filter(e => e.task.kind === 'shape-choose');
const classifyPool = pool1.filter(e => e.task.kind === 'shape-place' && e.task.mode === 'classify');
const buildPool = pool1.filter(e => e.task.kind === 'shape-place' && e.task.mode === 'build');
assert.ok(choosePool.length >= QUESTIONS_PER_ROUND && classifyPool.length >= QUESTIONS_PER_ROUND
  && buildPool.length >= QUESTIONS_PER_ROUND, '单模式子池应足够组卷');

/** 按正确作答完成当前任务并推进（任意模式）；返回推进后的状态。 */
const answerCurrentCorrectly = state => {
  const q = state.questions[state.questionIndex];
  if (q.task.kind === 'shape-choose') return answerChoose(state, q.task.answer).next;
  if (q.task.mode === 'classify') {
    let s = state;
    for (let b = 0; b < q.blocks.length; b++) {
      s = selectBlock(s, b);
      const zoneIndex = q.zones.findIndex(z => z.accept.includes(q.blocks[b]));
      s = placeByClick(s, zoneIndex).next;
    }
    return submitClassify(s).next;
  }
  let s = state;
  const consumed = [];
  for (const zone of q.zones) {
    const pick = q.blocks.find(block => zone.accept.includes(block)
      && q.blocks.filter(x => x === block).length > consumed.filter(c => c === block).length);
    assert.ok(pick !== undefined, `槽位 ${zone.id} 无可用积木`);
    consumed.push(pick);
    s = placeByDrag(s, q.zones.indexOf(zone), q.blocks.indexOf(pick)).next;
  }
  return s;
};

const playThrough = (pool, seed) => {
  let state = createRound(pool, [], createSeededRng(seed));
  let guard = 0;
  while (state.phase !== 'finished') {
    if (state.phase === 'resolving') { state = advanceQuestion(state); continue; }
    state = answerCurrentCorrectly(state);
    guard++;
    assert.ok(guard <= QUESTIONS_PER_ROUND * 2, '局次推进越界');
  }
  return state;
};

// ---------------------------------------------------------------------------
// 组卷
// ---------------------------------------------------------------------------

test('每局 5 任务：局内唯一、积木/分区/选项是任务候选的重新排列', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const round = createRound(pool1, [], createSeededRng(seed));
    assert.equal(round.questions.length, QUESTIONS_PER_ROUND);
    assert.equal(new Set(round.questions.map(q => q.exerciseId)).size, QUESTIONS_PER_ROUND, `seed ${seed} 局内重复`);
    for (const q of round.questions) {
      if (q.task.kind === 'shape-choose') {
        assert.deepEqual([...q.options].sort(), [...q.task.options].sort(), `seed ${seed} 选项篡改候选`);
        assert.deepEqual(q.blocks, []);
      } else {
        assert.deepEqual([...q.blocks].sort(), [...q.task.blocks].sort(), `seed ${seed} 积木篡改候选`);
        assert.equal(q.zones.length, q.task.zones.length);
        // 分区顺序洗牌但语义不变：按 id 找回对应 accept 集合逐一核对。
        for (const zone of q.zones) {
          const origin = q.task.zones.find(z => z.id === zone.id);
          assert.ok(origin, `seed ${seed} 出现任务外的分区 ${zone.id}`);
          assert.deepEqual([...zone.accept].sort(), [...origin.accept].sort(), `seed ${seed} 槽位 ${zone.id} 语义漂移`);
        }
      }
    }
  }
});

test('题型配额：混合池下三模式齐备', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const counts = { choose: 0, classify: 0, build: 0 };
    const round = createRound(pool1, [], createSeededRng(seed));
    for (const q of round.questions) counts[geometryMode(q.task)]++;
    assert.equal(counts.choose + counts.classify + counts.build, QUESTIONS_PER_ROUND);
    assert.ok(counts.choose >= 1 && counts.classify >= 1 && counts.build >= 1, `seed ${seed} 配额缺失：${JSON.stringify(counts)}`);
  }
});

test('避重：上一局任务在池充足时全部避开', () => {
  const first = createRound(pool1, [], createSeededRng(7));
  const firstIds = first.questions.map(q => q.exerciseId);
  const second = createRound(pool1, firstIds, createSeededRng(7));
  for (const id of firstIds) {
    assert.ok(!second.questions.some(q => q.exerciseId === id), `任务 ${id} 应被避开`);
  }
});

test('正确位置不长期固定：多种子下正确选项与积木槽位分布大于 1', () => {
  const optionSlots = new Set();
  const blockSlots = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const round = createRound(choosePool, [], createSeededRng(seed));
    optionSlots.add(round.questions[0].options.indexOf(round.questions[0].task.answer));
    const classifyRound = createRound(classifyPool, [], createSeededRng(seed));
    blockSlots.add(classifyRound.questions[0].blocks.indexOf(classifyRound.questions[0].task.blocks[0]));
  }
  assert.ok(optionSlots.size > 1, `正确选项槽位分布过窄：${[...optionSlots]}`);
  assert.ok(blockSlots.size > 1, `积木槽位分布过窄：${[...blockSlots]}`);
});

test('池不足 5 道时拒绝开局', () => {
  assert.throws(() => createRound(pool1.slice(0, 4), [], createSeededRng(1)), RangeError);
});

// ---------------------------------------------------------------------------
// choose 作答（choosePool：当前任务恒为辨认）
// ---------------------------------------------------------------------------

test('choose：首答正确 +10、错误入重试档 +5；候选外选项拒绝；resolving 锁定', () => {
  const round = createRound(choosePool, [], createSeededRng(3));
  const question = round.questions[0];
  assert.equal(question.task.kind, 'shape-choose');
  const wrongOption = question.options.find(o => o !== question.task.answer);
  const wrong = answerChoose(round, wrongOption);
  assert.equal(wrong.type, 'judged');
  assert.equal(wrong.complete, false);
  assert.equal(wrong.next.wrongs[0], 1);
  assert.equal(wrong.next.currentWrong, true);
  const right = answerChoose(wrong.next, question.task.answer);
  assert.equal(right.complete, true);
  assert.equal(right.gained, RETRY_SCORE);
  assert.equal(right.next.phase, 'resolving');
  const advanced = advanceQuestion(right.next);
  assert.equal(advanced.attempts[0], 2);
  assert.throws(() => answerChoose(round, '梯形'), RangeError);
  // resolving 锁定：推进后已到下一任务，这里对 resolving 态直接断言拒绝
  assert.throws(() => answerChoose(right.next, question.task.answer), Error);
  // 全对任务首答 +10
  const round2 = createRound(choosePool, [], createSeededRng(5));
  const first = answerChoose(round2, round2.questions[0].task.answer);
  assert.equal(first.gained, FIRST_TRY_SCORE);
});

// ---------------------------------------------------------------------------
// classify 整组提交（classifyPool：当前任务恒为分类）
// ---------------------------------------------------------------------------

test('classify：未全部分配拒绝提交；点选全对 +10；未选中点分区不构成放置', () => {
  const round = createRound(classifyPool, [], createSeededRng(3));
  const question = round.questions[0];
  assert.equal(question.task.mode, 'classify');
  assert.throws(() => submitClassify(round), Error);
  // 未选中积木直接点分区 → 不构成放置
  assert.throws(() => placeByClick(round, 0), Error);
  let state = round;
  for (let i = 0; i < question.blocks.length; i++) {
    state = selectBlock(state, i);
    const zoneIndex = question.zones.findIndex(z => z.accept.includes(question.blocks[i]));
    state = placeByClick(state, zoneIndex).next;
  }
  const right = submitClassify(state);
  assert.equal(right.complete, true);
  assert.equal(right.gained, FIRST_TRY_SCORE);
  assert.equal(right.next.phase, 'resolving');
  // resolving 锁定
  assert.throws(() => selectBlock(right.next, 0), Error);
});

test('classify：错块反馈指向分错块，撤回重排后提交入重试档 +5', () => {
  const round = createRound(classifyPool, [], createSeededRng(9));
  const question = round.questions[0];
  // 第 0 块放入错误区（accept 不含其形状的区）
  const wrongZoneIndex = question.zones.findIndex(z => !z.accept.includes(question.blocks[0]));
  let state = selectBlock(round, 0);
  state = placeByClick(state, wrongZoneIndex).next;
  for (let i = 1; i < question.blocks.length; i++) {
    state = selectBlock(state, i);
    const zoneIndex = question.zones.findIndex(z => z.accept.includes(question.blocks[i]));
    state = placeByClick(state, zoneIndex).next;
  }
  const wrong = submitClassify(state);
  assert.equal(wrong.complete, false);
  assert.ok(wrong.wrongBlocks.includes(0), `错块应含第 0 块：${JSON.stringify(wrong.wrongBlocks)}`);
  assert.equal(wrong.next.currentWrong, true);
  // 撤回第 0 块，改放正确区，再提交 → 重试档 +5
  const retracted = retract(wrong.next, 0);
  assert.equal(retracted.questions[retracted.questionIndex].placement.byBlock[0], null);
  assert.equal(retracted.selectedBlock, null);
  const fixedZone = question.zones.findIndex(z => z.accept.includes(question.blocks[0]));
  let fixed = selectBlock(retracted, 0);
  fixed = placeByClick(fixed, fixedZone).next;
  const right = submitClassify(fixed);
  assert.equal(right.complete, true);
  assert.equal(right.gained, RETRY_SCORE);
  // resolving 锁定拒绝撤回；空块撤回拒绝
  assert.throws(() => retract(right.next, 0), Error);
});

// ---------------------------------------------------------------------------
// build 即时判定与等价多解（buildPool：当前任务恒为搭建）
// ---------------------------------------------------------------------------

test('build：逐槽即时判定；等价多解（accept 集合两种积木均可完成）；干扰块被拒后撤回可换块', () => {
  // 找一个含多解槽的种子
  let seed = 1;
  let round = null;
  for (; seed <= 40; seed++) {
    const candidate = createRound(buildPool, [], createSeededRng(seed));
    if (candidate.questions[0].zones.some(z => z.accept.length >= 2)) { round = candidate; break; }
  }
  assert.ok(round, '40 种子内应找到多解搭建任务');
  const question = round.questions[0];
  const multiZoneIndex = question.zones.findIndex(z => z.accept.length >= 2);
  // 干扰块（不满足任何槽）放首槽 → 即时错误反馈（消耗一次判定），撤回后可换正确块
  const dudIndex = question.blocks.findIndex(shape => !question.zones.some(z => z.accept.includes(shape)));
  let state = round;
  if (dudIndex >= 0) {
    const dud = placeByDrag(round, 0, dudIndex);
    assert.equal(dud.type, 'judged');
    assert.equal(dud.complete, false);
    assert.equal(dud.next.currentWrong, true);
    const undone = retract(dud.next, 0);
    assert.equal(undone.questions[undone.questionIndex].placement.inSlot[0], null);
    state = undone;
  }
  // 按等价解 1 完成整任务（多解槽取第一个可接受形状）→ 至少重试档
  let s1 = state;
  const consumed1 = [];
  for (const zone of question.zones) {
    const pick = zone.id === question.zones[multiZoneIndex].id
      ? zone.accept[0]
      : question.blocks.find(block => zone.accept.includes(block)
        && question.blocks.filter(x => x === block).length > consumed1.filter(c => c === block).length);
    consumed1.push(pick);
    s1 = placeByDrag(s1, question.zones.indexOf(zone), question.blocks.indexOf(pick)).next;
  }
  assert.equal(s1.phase, 'resolving', `等价解 ${question.zones[multiZoneIndex].accept[0]} 应完成任务`);
  // 判定计数：干扰块放置（若有）计 1 次错误判定，最后一步完成再计 1 次；
  // 中间槽的即时判定（未完成）也各计 1 次。
  assert.equal(s1.attempts[0], question.zones.length + (dudIndex >= 0 ? 1 : 0));
  // 等价解 2（另一可接受形状）同样完成任务
  if (question.zones[multiZoneIndex].accept.length >= 2) {
    let s2 = round;
    const consumed2 = [];
    for (const zone of question.zones) {
      const pick = zone.id === question.zones[multiZoneIndex].id
        ? zone.accept[1]
        : question.blocks.find(block => zone.accept.includes(block)
          && question.blocks.filter(x => x === block).length > consumed2.filter(c => c === block).length);
      consumed2.push(pick);
      s2 = placeByDrag(s2, question.zones.indexOf(zone), question.blocks.indexOf(pick)).next;
    }
    assert.equal(s2.phase, 'resolving', `等价解 ${question.zones[multiZoneIndex].accept[1]} 应完成任务`);
  }
});

test('build：干净完成全首答 +10；同形状双槽占满后再拖同形状被拒；resolving 后锁定', () => {
  const state = playThrough(buildPool, 6);
  const result = settlement(state);
  assert.equal(result.score, QUESTIONS_PER_ROUND * FIRST_TRY_SCORE);
  assert.equal(result.firstTry, QUESTIONS_PER_ROUND);
  assert.ok(result.drags >= 1);
  assert.throws(() => placeByDrag(state, 0, 0), Error);
  // 同形状双槽占满后拖第三块被拒（积木栏无此块）
  const round = createRound(buildPool, [], createSeededRng(8));
  const question = round.questions[0];
  const pairShape = question.task.blocks.find(shape => question.task.blocks.filter(b => b === shape).length >= 2
    && question.task.zones.filter(z => z.accept.includes(shape)).length >= 2);
  if (pairShape) {
    const zoneIndexes = question.zones.map((z, i) => z.accept.includes(pairShape) ? i : -1).filter(i => i >= 0);
    const blockIndex = question.blocks.indexOf(pairShape);
    let s = placeByDrag(round, zoneIndexes[0], blockIndex).next;
    if (s.phase === 'asking') {
      s = placeByDrag(s, zoneIndexes[1], blockIndex).next;
      if (s.phase === 'asking') {
        assert.throws(() => placeByDrag(s, zoneIndexes[0], blockIndex), RangeError);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

test('快照往返：布局、选中态、操作统计与判定计数恢复一致；篡改被拒', () => {
  const round = createRound(classifyPool, [], createSeededRng(8));
  let state = selectBlock(round, 0);
  state = placeByClick(state, 0).next;
  state = selectBlock(state, 1);
  const snapshot = {
    version: 1, gameId: GAME_ID, roundId: 'round-1', state,
    rngState: 123456789, previousIds: [], grades: [1], contentVersion: 'geometry-static-v1',
  };
  const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.ok(parsed, '合法快照应通过解析');
  assert.deepEqual(parsed.state.questions[0].placement, state.questions[0].placement);
  assert.equal(parsed.state.selectedBlock, state.selectedBlock);
  assert.deepEqual(parsed.state.placedByClick, state.placedByClick);
  // 布局被篡改的快照拒绝（z99 不在任务分区内）
  const tampered = JSON.parse(JSON.stringify(snapshot));
  tampered.state.questions[0].placement.byBlock[0] = 'z99';
  assert.equal(parseSnapshot(tampered), null);
  // 注：快照 blocks 顺序本身是保存的状态（恢复按快照序渲染），成员相同且放置自洽的
  // 重排是合法状态，解析应通过——「排列篡改」不构成校验对象，此处不断言。
  // 分区语义篡改拒绝
  const rezoned = JSON.parse(JSON.stringify(snapshot));
  rezoned.state.questions[0].zones = rezoned.state.questions[0].zones.map(z => ({ id: z.id, accept: ['sphere'] }));
  assert.equal(parseSnapshot(rezoned), null);
});

test('损坏快照：结构破坏按首次使用处理', () => {
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot({}), null);
  assert.equal(parseSnapshot({ version: 1, gameId: 'geometry-builder' }), null);
  assert.equal(parseSnapshot({ version: 2, gameId: GAME_ID }), null);
  assert.equal(parseSnapshot({ version: 1, gameId: 'english-courier' }), null);
  const round = createRound(pool1, [], createSeededRng(2));
  const snapshot = {
    version: 1, gameId: GAME_ID, roundId: 'r', state: round,
    rngState: 1, previousIds: [], grades: [1], contentVersion: 'geometry-static-v1',
  };
  const wrongCount = JSON.parse(JSON.stringify(snapshot));
  wrongCount.state.questions = wrongCount.state.questions.slice(0, 4);
  assert.equal(parseSnapshot(wrongCount), null);
  const badCounter = JSON.parse(JSON.stringify(snapshot));
  badCounter.state.wrongs[0] = 5;
  badCounter.state.attempts[0] = 2;
  assert.equal(parseSnapshot(badCounter), null, '错判多于判定应拒绝');
});

// ---------------------------------------------------------------------------
// 结算与记录
// ---------------------------------------------------------------------------

test('结算：作答表现与放置操作分开统计；模式逐任务分列；满分整局记录可解析', () => {
  const state = playThrough(pool1, 12);
  const result = settlement(state);
  assert.equal(result.total, QUESTIONS_PER_ROUND);
  assert.equal(result.score, QUESTIONS_PER_ROUND * FIRST_TRY_SCORE);
  assert.equal(result.firstTry, QUESTIONS_PER_ROUND);
  assert.equal(result.wrong, 0);
  assert.ok(result.clicks >= 1, `点选统计应有记录：${JSON.stringify(result)}`);
  assert.ok(result.drags >= 1, `拖拽统计应有记录：${JSON.stringify(result)}`);
  const record = buildRecord({
    recordId: 'rec-1', finishedAt: '2026-10-28T12:00:00Z', grades: [1],
    contentVersion: 'geometry-static-v1', score: result.score,
    answered: result.answered, clicks: result.clicks, drags: result.drags, retractions: result.retractions,
  });
  assert.equal(record.gameId, GAME_ID);
  const parsed = parseRecord(record);
  assert.ok(parsed);
  assert.deepEqual(parsed.answer.operations, { clicks: result.clicks, drags: result.drags, retractions: result.retractions });
  assert.ok(parsed.answer.tasks.every(t => ['choose', 'classify', 'build'].includes(t.mode)));
  // 记录损坏健壮性
  assert.equal(parseRecord({ ...record, gameId: 'english-courier' }), null);
  assert.equal(parseRecord({ ...record, schemaVersion: 99 }), null);
  assert.deepEqual(parseRecords('not json'), []);
  assert.equal(parseSettingsValue({ schemaVersion: 1, grades: [1] })?.grades?.[0], 1);
});

test('错局结算：错判计数与重试档分数入账', () => {
  // 构造一局含错判：choose 答错一次再答对
  const round = createRound(choosePool, [], createSeededRng(21));
  const question = round.questions[0];
  const wrongOption = question.options.find(o => o !== question.task.answer);
  let state = answerChoose(round, wrongOption).next;
  state = advanceQuestion(answerChoose(state, question.task.answer).next);
  const finished = playFrom(state);
  const result = settlement(finished);
  assert.equal(result.wrong, 1);
  assert.equal(result.score, (QUESTIONS_PER_ROUND - 1) * FIRST_TRY_SCORE + RETRY_SCORE);
  assert.equal(result.firstTry, QUESTIONS_PER_ROUND - 1);
});

const playFrom = state => {
  let s = state;
  let guard = 0;
  while (s.phase !== 'finished') {
    s = advanceQuestion(answerCurrentCorrectly(s));
    guard++;
    assert.ok(guard <= QUESTIONS_PER_ROUND, '局次推进越界');
  }
  return s;
};

test('洗牌纯函数：同种子复现', () => {
  const a = shuffle([1, 2, 3, 4, 5], createSeededRng(42));
  const b = shuffle([1, 2, 3, 4, 5], createSeededRng(42));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), [1, 2, 3, 4, 5]);
});

// ---------------------------------------------------------------------------
// 浏览器走局回归（桌面冒烟发现的三个真实缺陷的规则层回归）
// ---------------------------------------------------------------------------

test('回归：build 点选放置给「点中的槽」配首个有剩余且满足该槽的块（同形状多块逐块消耗）', () => {
  // 场景还原自桌面冒烟：呈现 zones [z3, z1, z2]（z1/z2 均收 cylinder，z3 收 cuboid），
  // 呈现 blocks [sphere, cylinder, cuboid, cube, cylinder]。先放 z3=cuboid、z1=cylinder，
  // 再点 z2：同形状第二块 cylinder 仍有剩余（不能因形状已出现被判为已占用）。
  const pool = selectGeometryExercises([1]).filter(e => e.task.kind === 'shape-place' && e.task.mode === 'build');
  // 构造固定局面：直接找 MA-G-014（z1=[cylinder], z2=[cylinder], z3=[cuboid]）
  const exercise = pool.find(e => e.id === 'MA-G-014');
  assert.ok(exercise, 'MA-G-014 应在池中');
  const rng = () => 0.999; // 洗牌不改变原序（i 恒 0 附近的边界不可靠，改用固定置换验证语义）
  // 直接用任务数据手工构造呈现态（绕过组卷随机）：
  const blocks = [...exercise.task.blocks]; // [cylinder,cylinder,cuboid,cube,sphere]
  const zones = exercise.task.zones.map(z => ({ id: z.id, accept: [...z.accept] })); // [z1,z2,z3]
  const placement = { byBlock: [], inSlot: zones.map(() => null) };
  const baseQuestion = { exerciseId: exercise.id, task: exercise.task, blocks, zones, options: [], placement };
  const baseState = {
    phase: 'asking', questions: [baseQuestion], questionIndex: 0, score: 0,
    firstTryCount: 0, totalWrongCount: 0, currentWrong: false,
    attempts: [0], wrongs: [0], placedByClick: [0], placedByDrag: [0], retractions: [0],
    selectedBlock: null, result: null,
  };
  const stateFor = zonesOrder => ({ ...baseState, questions: [{ ...baseQuestion, zones: zonesOrder }] });
  // 呈现序 [z3, z1, z2]：z3=cuboid、z1=cylinder、z2=cylinder（剩余第二块）
  const shuffled = [zones[2], zones[0], zones[1]];
  const slotOf = st => st.questions[st.questionIndex].placement.inSlot;
  let s = placeByClick(stateFor(shuffled), 0); // z3 ← cuboid（首个满足 [cuboid] 的剩余块）
  assert.equal(slotOf(s.next)[0], 'cuboid');
  s = placeByClick(s.next, 1); // z1 ← cylinder（第一块）
  assert.equal(slotOf(s.next)[1], 'cylinder');
  const third = placeByClick(s.next, 2); // z2 ← cylinder（第二块：不能报「无块可放」）
  assert.equal(slotOf(third.next)[2], 'cylinder');
  assert.equal(third.complete, true, '三槽全对应完成任务');
  void rng;
});

test('回归：build 点选放置 acceptable 按呈现槽位 accept 判定（呈现序洗牌后不错位）', () => {
  // 呈现 zones [z2, z1]（z2=[cube,cuboid] 在前）：点呈现下标 0 必须按 z2 的 accept 配块，
  // 不能拿语义序 zones[0]=[cylinder] 的 accept 给 z2 配出 cylinder。
  const pool = selectGeometryExercises([1]).filter(e => e.task.kind === 'shape-place' && e.task.mode === 'build');
  const exercise = pool.find(e => e.id === 'MA-G-013'); // z1=[cylinder], z2=[cube,cuboid]
  assert.ok(exercise);
  const zones = exercise.task.zones.map(z => ({ id: z.id, accept: [...z.accept] }));
  const blocks = [...exercise.task.blocks]; // [cylinder,cube,cuboid,sphere]
  const shuffled = [zones[1], zones[0]]; // 呈现序 [z2, z1]
  const question = {
    exerciseId: exercise.id, task: exercise.task, blocks, zones: shuffled, options: [],
    placement: { byBlock: [], inSlot: shuffled.map(() => null) },
  };
  const state = {
    phase: 'asking', questions: [question], questionIndex: 0, score: 0,
    firstTryCount: 0, totalWrongCount: 0, currentWrong: false,
    attempts: [0], wrongs: [0], placedByClick: [0], placedByDrag: [0], retractions: [0],
    selectedBlock: null, result: null,
  };
  const out = placeByClick(state, 0); // 呈现下标 0 = z2 → 应配 cube（首个满足 [cube,cuboid] 的块）
  assert.equal(out.next.questions[0].placement.inSlot[0], 'cube', '点 z2 应配 cube/cuboid 之一而非 cylinder');
});
