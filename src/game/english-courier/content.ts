// 英语快递员内容适配：静态英语题库（审核记录 docs/content-review-english-courier.md）
// 经 Learning Core 校验后由 selectExercises 正式筛选；正式取题只走 approved，无预览入口。
// 题库为本游戏独占内容（gameIds 仅 'english-courier'），不与其他游戏共享题目，
// 照拼音冒险先例按本游戏独立 gameId 重建 Learning Core，不改默认静态 catalog。
import { textbooks } from '../../content/textbooks.js';
import { units } from '../../content/units.js';
import { skills, mappings } from '../../content/skills.js';
import { evidence } from '../../content/evidence.js';
import { englishExercises } from '../../content/english-exercises.js';
import { createLearningCore } from '../../learning/catalog.js';
import type { EnglishDeliveryTask, Exercise, Grade } from '../../learning/models.js';
import { ENGLISH_EMOTION_WORDS, ENGLISH_FAMILY_WORDS } from '../../learning/english.js';
import { GAME_ID, QUESTIONS_PER_ROUND } from './rules.js';

/** 内容版本指纹：静态题库结构变化（题量/结构校验规则）时需更新以放弃旧进度。 */
export const CONTENT_VERSION = 'english-static-v1';

/** 英语内容关联 EN-01A（一年级上册候选映射），首版仅开放一年级。 */
export const OPEN_GRADES: readonly Grade[] = [1];

export const GRADE_NAMES: Readonly<Record<Grade, string>> = {
  1: '一年级', 2: '二年级', 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级',
};

/** 收件角色配图映射：原创 SVG 随构建交付（web/img/english-courier/）；角色卡不带英语文字标签。 */
export const RECIPIENT_IMAGES: Readonly<Record<string, string>> = Object.fromEntries([
  ...[...ENGLISH_FAMILY_WORDS, ...ENGLISH_EMOTION_WORDS].map(
    word => [word, `/img/english-courier/${word}.svg`] as const,
  ),
]);

const core = createLearningCore({
  textbooks, units, skills, mappings, evidence,
  exercises: englishExercises,
});

/** 正式取题：仅 approved + subject english + gameId english-courier + 所选年级。 */
export function selectEnglishExercises(grades: readonly Grade[]): readonly Exercise<EnglishDeliveryTask>[] {
  // Learning Core 的 select 统一以 Exercise<MathTask> 署名；本核心题库全部为 EnglishDeliveryTask，
  // 经 validateCatalog 逐题校验后此断言成立（拼音冒险同款先例注释）。
  return core.selectExercises({ subject: 'english', grades, gameId: GAME_ID }) as unknown as readonly Exercise<EnglishDeliveryTask>[];
}

/** 可用性提示：所选年级实际供题量与开局门槛（每局 5 任务）。 */
export function describeAvailability(grades: readonly Grade[]): {
  startable: boolean; statusText: string | null; rangeText: string;
} {
  const perGrade = new Map(grades.map(grade => [grade, selectEnglishExercises([grade]).length]));
  const available = grades.filter(grade => perGrade.get(grade)! > 0);
  const empty = grades.filter(grade => perGrade.get(grade) === 0);
  const total = available.reduce((sum, grade) => sum + perGrade.get(grade)!, 0);
  const names = (list: readonly Grade[]): string => list.map(grade => GRADE_NAMES[grade]).join('、');
  const openText = `${OPEN_GRADES.map(grade => GRADE_NAMES[grade]).join('、')}（英语）`;
  const rangeText = `${available.map(grade => `${GRADE_NAMES[grade]} ${perGrade.get(grade)} 个任务`).join('、')}，共 ${total} 个`;
  if (!available.length) {
    return { startable: false, statusText: `${names(empty)}暂无已审核的英语练习。当前开放：${openText}。`, rangeText };
  }
  if (total < QUESTIONS_PER_ROUND) {
    return {
      startable: false,
      statusText: `可用练习不足（每局需要 ${QUESTIONS_PER_ROUND} 个任务），暂时无法开始。请返回调整年级选择。`,
      rangeText,
    };
  }
  if (empty.length) {
    return { startable: true, statusText: `本局任务来自：${names(available)}。${names(empty)}暂无内容。`, rangeText };
  }
  return { startable: true, statusText: null, rangeText };
}
