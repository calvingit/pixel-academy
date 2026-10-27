// 汉字勇者内容适配：从 Learning Core 取正式语文题并建立年级索引。
// 复用受信任静态 catalog；筛选只走 selectExercises（approved），无预览入口。
import { catalog, selectExercises } from '../../index.js';
import type { Exercise, Grade } from '../../learning/models.js';
import { GAME_ID } from './rules.js';

export const OPEN_GRADES: readonly Grade[] = [1];

export const GRADE_NAMES: Readonly<Record<Grade, string>> = {
  1: '一年级', 2: '二年级', 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级',
};

/** 练习 → 关联年级（mappingIds → 单元 → 教材 grade），多年级关联取最高。 */
export function gradeOf(exercise: Exercise): Grade {
  const bookByUnit = new Map(catalog.units.map(unit => [unit.id,
    catalog.textbooks.find(book => book.id === unit.textbookId)?.grade]));
  const grades = exercise.mappingIds.flatMap(id =>
    catalog.mappings.find(mapping => mapping.id === id)?.unitIds.map(unitId => bookByUnit.get(unitId)) ?? []);
  const valid = grades.filter((g): g is Grade => g !== undefined);
  if (!valid.length) throw new RangeError(`Exercise ${exercise.id} has no resolvable grade`);
  return valid.reduce((a, b) => (b > a ? b : a));
}

/** 正式取题：仅 approved + subject chinese + gameId hanzi-hero + 所选年级。 */
export function selectHanziExercises(grades: readonly Grade[]): readonly Exercise[] {
  return selectExercises({ subject: 'chinese', grades, gameId: GAME_ID });
}

/** 可用性提示：所选年级实际供题年级与未开放年级。 */
export function describeAvailability(grades: readonly Grade[]): {
  startable: boolean; statusText: string | null; rangeText: string;
} {
  const perGrade = new Map(grades.map(grade => [grade, selectHanziExercises([grade]).length]));
  const available = grades.filter(grade => perGrade.get(grade)! > 0);
  const empty = grades.filter(grade => perGrade.get(grade) === 0);
  const openText = OPEN_GRADES.map(grade => GRADE_NAMES[grade]).join('、');
  const rangeText = `${available.map(grade => `${GRADE_NAMES[grade]} ${perGrade.get(grade)} 个`).join('、')}，共 ${available.reduce((sum, grade) => sum + perGrade.get(grade)!, 0)} 个任务`;
  if (!available.length) {
    return { startable: false, statusText: `${empty.map(g => GRADE_NAMES[g]).join('、')}暂无已审核的语文练习。当前开放：${openText}（语文）。`, rangeText };
  }
  if (empty.length) {
    return { startable: true, statusText: `本局练习来自：${available.map(g => GRADE_NAMES[g]).join('、')}。${empty.map(g => GRADE_NAMES[g]).join('、')}暂无内容。`, rangeText };
  }
  return { startable: true, statusText: null, rangeText };
}
