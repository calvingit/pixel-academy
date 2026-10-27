// 拼音冒险内容适配：静态拼音题库（审核记录 docs/content-review-pinyin.md）经 Learning Core
// 校验后由 selectExercises 正式筛选；正式取题只走 approved，无预览入口。
// 题库为本游戏独占内容（gameIds 仅 'pinyin-adventure'），不与其他游戏共享题目，
// 故照算术地下城先例按本游戏独立 gameId 重建 Learning Core，不改默认静态 catalog。
import { textbooks } from '../../content/textbooks.js';
import { units } from '../../content/units.js';
import { skills, mappings } from '../../content/skills.js';
import { evidence } from '../../content/evidence.js';
import { pinyinExercises } from '../../content/pinyin-exercises.js';
import { createLearningCore } from '../../learning/catalog.js';
import type { Exercise, Grade, PinyinTask } from '../../learning/models.js';
import { GAME_ID, MIN_LISTEN_QUESTIONS, QUESTIONS_PER_ROUND } from './rules.js';

/** 内容版本指纹：静态题库结构变化（题量/结构校验规则）时需更新以放弃旧进度。 */
export const CONTENT_VERSION = 'pinyin-static-v1';

/** 拼音内容关联 CH-01A（一年级上册候选映射），首版仅开放一年级。 */
export const OPEN_GRADES: readonly Grade[] = [1];

export const GRADE_NAMES: Readonly<Record<Grade, string>> = {
  1: '一年级', 2: '二年级', 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级',
};

const core = createLearningCore({
  textbooks, units, skills, mappings, evidence,
  exercises: pinyinExercises,
});

/** 正式取题：仅 approved + subject chinese + gameId pinyin-adventure + 所选年级。 */
export function selectPinyinExercises(grades: readonly Grade[]): readonly Exercise<PinyinTask>[] {
  // Learning Core 的 select 统一以 Exercise<MathTask> 署名；本核心题库全部为 PinyinTask，
  // 经 validateCatalog 逐题校验后此断言成立。
  return core.selectExercises({ subject: 'chinese', grades, gameId: GAME_ID }) as unknown as readonly Exercise<PinyinTask>[];
}

/** 可用性提示：所选年级实际供题量与开局门槛（每局 5 题且听辨至少 2 题）。 */
export function describeAvailability(grades: readonly Grade[]): {
  startable: boolean; statusText: string | null; rangeText: string;
} {
  const perGrade = new Map(grades.map(grade => [grade, selectPinyinExercises([grade]).length]));
  const available = grades.filter(grade => perGrade.get(grade)! > 0);
  const empty = grades.filter(grade => perGrade.get(grade) === 0);
  const total = available.reduce((sum, grade) => sum + perGrade.get(grade)!, 0);
  const listenTotal = available.reduce((sum, grade) => sum
    + selectPinyinExercises([grade]).filter(e => e.task.kind === 'pinyin-listen').length, 0);
  const names = (list: readonly Grade[]): string => list.map(grade => GRADE_NAMES[grade]).join('、');
  const openText = `${OPEN_GRADES.map(grade => GRADE_NAMES[grade]).join('、')}（语文）`;
  const rangeText = `${available.map(grade => `${GRADE_NAMES[grade]} ${perGrade.get(grade)} 道`).join('、')}，共 ${total} 道`;
  if (!available.length) {
    return { startable: false, statusText: `${names(empty)}暂无已审核的拼音练习。当前开放：${openText}。`, rangeText };
  }
  if (total < QUESTIONS_PER_ROUND || listenTotal < MIN_LISTEN_QUESTIONS) {
    return {
      startable: false,
      statusText: `可用练习不足（每局需要 ${QUESTIONS_PER_ROUND} 道且听辨至少 ${MIN_LISTEN_QUESTIONS} 道），暂时无法开始。请返回调整年级选择。`,
      rangeText,
    };
  }
  if (empty.length) {
    return { startable: true, statusText: `本局练习来自：${names(available)}。${names(empty)}暂无内容。`, rangeText };
  }
  return { startable: true, statusText: null, rangeText };
}
