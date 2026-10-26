// 游戏层内容适配：把 Learning Core 的筛选结果转换成开局可用性提示与练习档位。
// 纯 TypeScript，无 DOM；不重复实现筛选或判题，只做展示口径与年级关联的汇总。
import { textbooks } from '../../content/textbooks.js';
import { units } from '../../content/units.js';
import { skills, mappings } from '../../content/skills.js';
import { exercises } from '../../content/exercises.js';
import { evidence } from '../../content/evidence.js';
import { createLearningCore } from '../../learning/catalog.js';
import type { Catalog, Exercise, ExerciseQuery, Grade } from '../../learning/models.js';
import { START_THRESHOLD } from './rules.js';
import { generateExercises } from './generation.js';

export const GAME_ID = 'number-puzzle';
export const ALL_GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];

export const GRADE_NAMES: Readonly<Record<Grade, string>> = {
  1: '一年级', 2: '二年级', 3: '三年级', 4: '四年级', 5: '五年级', 6: '六年级',
};

const query = (grades: readonly Grade[]): ExerciseQuery => ({ subject: 'math', grades, gameId: GAME_ID });
const names = (grades: readonly Grade[]): string => grades.map(grade => GRADE_NAMES[grade]).join('、');

/** 练习 → 关联年级（mappingIds → 单元 → 教材 grade），多年级关联时取最高年级。 */
export function createExerciseGradeIndex(catalog: Catalog): (exercise: Exercise) => Grade {
  const bookById = new Map(catalog.textbooks.map(book => [book.id, book]));
  const gradeByUnit = new Map(catalog.units.map(unit => [unit.id, bookById.get(unit.textbookId)?.grade]));
  const gradesByMapping = new Map(catalog.mappings.map(mapping => [mapping.id,
    mapping.unitIds.map(unitId => gradeByUnit.get(unitId)),
  ]));
  return exercise => {
    const grades = exercise.mappingIds.flatMap(id => gradesByMapping.get(id) ?? []);
    const valid = grades.filter((grade): grade is Grade => grade !== undefined);
    if (!valid.length) throw new RangeError(`Exercise ${exercise.id} has no resolvable grade`);
    return valid.reduce((a, b) => (b > a ? b : a));
  };
}

export interface GameContent {
  /** 正式取题：只返回 approved（createLearningCore(...).selectExercises）。 */
  readonly select: (grades: readonly Grade[]) => readonly Exercise[];
  /** 候选预览取题：包含 draft；仅用于显式预览入口，不作为降级路径。 */
  readonly preview: (grades: readonly Grade[]) => readonly Exercise[];
  readonly gradeOf: (exercise: Exercise) => Grade;
}

/**
 * 装配默认内容并创建 Learning Core。内容校验失败时 createLearningCore 抛错，
 * 由调用方按启动失败处理（游戏不得进入可玩状态）。
 */
export function loadGameContent(): GameContent {
  const catalog: Catalog = { textbooks, units, skills, mappings, exercises, evidence };
  const core = createLearningCore(catalog);
  const generatedCore = createLearningCore({ ...catalog, exercises: generateExercises() });
  return {
    select: grades => generatedCore.selectExercises(query(grades)),
    preview: grades => core.previewExercises(query(grades)),
    gradeOf: createExerciseGradeIndex(catalog),
  };
}

export interface AvailabilityReport {
  /** 是否满足开局条件（并集 ≥ 开局阈值且所选年级不全为空）。 */
  readonly startable: boolean;
  /** 场景文案（四场景判定顺序之一）；正常可开始时为 null，界面显示 rangeText。 */
  readonly statusText: string | null;
  /** 可用范围行（首版格式来自玩法说明一局示例：「一年级 12 道、二年级 6 道，共 18 道」）。 */
  readonly rangeText: string;
  readonly unionExercises: readonly Exercise[];
  readonly unionCount: number;
  readonly availableGrades: readonly Grade[];
  readonly emptyGrades: readonly Grade[];
}

/**
 * 按「界面文案（首版）」的场景判定顺序生成可用性提示。
 * select 传入正式或预览取题函数；预览口径下草稿计入可用数，且不适用「默认入口无 approved 内容」。
 */
export function describeAvailability(
  select: (grades: readonly Grade[]) => readonly Exercise[],
  selectedGrades: readonly Grade[],
  options: { readonly preview: boolean },
): AvailabilityReport {
  const perGradeAll = new Map(ALL_GRADES.map(grade => [grade, select([grade]).length]));
  const globalCount = [...perGradeAll.values()].reduce((sum, count) => sum + count, 0);
  const globalAvailableGrades = ALL_GRADES.filter(grade => perGradeAll.get(grade)! > 0);
  const availableGrades = selectedGrades.filter(grade => perGradeAll.get(grade)! > 0);
  const emptyGrades = selectedGrades.filter(grade => perGradeAll.get(grade) === 0);
  const unionExercises = select(selectedGrades);
  const unionCount = unionExercises.length;
  const rangeText = `${availableGrades.map(grade => `${GRADE_NAMES[grade]} ${perGradeAll.get(grade)} 道`).join('、')}，共 ${unionCount} 道`;

  let statusText: string | null = null;
  let startable = false;
  if (!options.preview && globalCount === 0) {
    statusText = '正式练习尚未就绪，暂时无法开始。请返回调整年级选择。';
  } else if (unionCount === 0) {
    const openList = globalAvailableGrades.length
      ? `${names(globalAvailableGrades)}（数学）`
      : '暂无';
    statusText = `${names(emptyGrades)}暂无已审核的数学练习。当前开放：${openList}。`;
  } else if (unionCount < START_THRESHOLD) {
    const mixed = emptyGrades.length
      ? `本局练习来自：${names(availableGrades)}。${names(emptyGrades)}暂无内容。`
      : '';
    statusText = `${mixed}可用练习不足 ${START_THRESHOLD} 道，暂时无法开始。请返回调整年级选择。`;
  } else if (emptyGrades.length) {
    statusText = `本局练习来自：${names(availableGrades)}。${names(emptyGrades)}暂无内容。`;
    startable = true;
  } else {
    startable = true;
  }
  return { startable, statusText, rangeText, unionExercises, unionCount, availableGrades, emptyGrades };
}
