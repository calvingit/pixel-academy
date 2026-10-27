// 算术地下城内容适配：复用经规则审核的数学动态题库（generated-v4，审核见
// docs/content-review-generation.md），按本游戏独立 gameId 重建 Learning Core。
// 正式取题只走 selectExercises（approved），无预览入口；认数任务（「找出 N」）
// 依赖数字消除点阵棋盘玩法，无门题/资源题题面形态，不进入地下城题池。
import { textbooks } from '../../content/textbooks.js';
import { units } from '../../content/units.js';
import { skills, mappings } from '../../content/skills.js';
import { exercises } from '../../content/exercises.js';
import { evidence } from '../../content/evidence.js';
import { createLearningCore } from '../../learning/catalog.js';
import type { Exercise, Grade, MathTask } from '../../learning/models.js';
import { generateExercises, GENERATION_VERSION } from '../number-puzzle/generation.js';
import { CHOICE_VERSION } from '../number-puzzle/choice-generation.js';
import { GAME_ID, QUESTIONS_NEEDED } from './rules.js';

/** 内容版本指纹：组合整数与选择题生成规则版本，快照兼容性据此判定。 */
export const CONTENT_VERSION = `${GENERATION_VERSION}:${CHOICE_VERSION}`;

export const OPEN_GRADES: readonly Grade[] = [1, 2];

export const GRADE_NAMES: Readonly<Record<Grade, string>> = {
  1: '一年级', 2: '二年级', 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级',
};

const core = createLearningCore({
  textbooks, units, skills, mappings, evidence,
  exercises: generateExercises()
    .filter(exercise => exercise.task.kind !== 'number')
    // 同一份已审核题库同时服务数字消除与地下城：gameIds 追加本游戏，不改审核元数据。
    .map(exercise => ({ ...exercise, gameIds: [...exercise.gameIds, GAME_ID] })),
});

/** 正式取题：仅 approved + subject math + gameId arithmetic-dungeon + 所选年级。 */
export function selectDungeonExercises(grades: readonly Grade[]): readonly Exercise<MathTask>[] {
  return core.selectExercises({ subject: 'math', grades, gameId: GAME_ID });
}

/** 可用性提示：所选年级实际供题年级、未开放年级与开局门槛（每局至少 4 道）。 */
export function describeAvailability(grades: readonly Grade[]): {
  startable: boolean; statusText: string | null; rangeText: string;
} {
  const perGrade = new Map(grades.map(grade => [grade, selectDungeonExercises([grade]).length]));
  const available = grades.filter(grade => perGrade.get(grade)! > 0);
  const empty = grades.filter(grade => perGrade.get(grade) === 0);
  const total = available.reduce((sum, grade) => sum + perGrade.get(grade)!, 0);
  const names = (list: readonly Grade[]): string => list.map(grade => GRADE_NAMES[grade]).join('、');
  const openText = `${OPEN_GRADES.map(grade => GRADE_NAMES[grade]).join('、')}（数学）`;
  const rangeText = `${available.map(grade => `${GRADE_NAMES[grade]} ${perGrade.get(grade)} 道`).join('、')}，共 ${total} 道`;
  if (!available.length) {
    return { startable: false, statusText: `${names(empty)}暂无已审核的数学练习。当前开放：${openText}。`, rangeText };
  }
  if (total < QUESTIONS_NEEDED) {
    const mixed = empty.length ? `本局练习来自：${names(available)}。${names(empty)}暂无内容。` : '';
    return { startable: false, statusText: `${mixed}可用练习不足 ${QUESTIONS_NEEDED} 道，暂时无法开始。请返回调整年级选择。`, rangeText };
  }
  if (empty.length) {
    return { startable: true, statusText: `本局练习来自：${names(available)}。${names(empty)}暂无内容。`, rangeText };
  }
  return { startable: true, statusText: null, rangeText };
}
