export type Grade = 1 | 2 | 3 | 4 | 5 | 6;
export type Subject = 'chinese' | 'math' | 'english';
export type Verification = 'pending' | 'verified';
export interface Evidence {
  id: string;
  kind: 'conversation-handoff';
  locator: string;
  verification: Verification;
  note: string;
}
export interface Textbook {
  id: string;
  subject: Subject;
  grade: Grade;
  term: 'A' | 'B';
  series: string;
  title: string | null;
  isbn: string | null;
  edition: string | null;
  localAdoptionVerification: Verification;
  sourceVerification: Verification;
  directoryStatus: 'candidate' | 'deferred';
  evidenceIds: readonly string[];
}
export interface Unit {
  id: string;
  textbookId: string;
  title: string;
  kind: 'main' | 'preparation' | 'practice' | 'activity' | 'review';
  order: number;
  lessons: readonly string[];
  lessonCoverage: 'complete-candidate' | 'examples' | 'not-extracted';
  sourceVerification: Verification;
  evidenceIds: readonly string[];
}
export interface Skill { id: string; subject: Subject; title: string }
export interface Mapping {
  id: string;
  skillId: string;
  unitIds: readonly string[];
  sourceVerification: Verification;
  curriculumVerification: Verification;
  evidenceIds: readonly string[];
}
export type ArithmeticTask =
  | { kind: 'number'; value: number }
  | { kind: 'binary'; operator: '+' | '-' | '*'; left: number; right: number }
  | { kind: 'chain'; start: number; steps: readonly { operator: '+' | '-'; operand: number }[] };
export type Relation = '>' | '<' | '=';
export type ChoiceQuestion =
  | { kind: 'extreme'; direction: 'max' | 'min' }
  | { kind: 'symbol'; left: number; right: number }
  | { kind: 'filter'; relation: '>' | '<'; target: number }
  | { kind: 'truth'; left: ArithmeticTask; relation: Relation; right: ArithmeticTask }
  | { kind: 'missing'; addend: number; total: number }
  | { kind: 'range'; lower: number; upper: number }
  | { kind: 'neighbor'; value: number; direction: 'before' | 'after' }
  | { kind: 'sequence'; start: number; step: number; length: number; index: number }
  | { kind: 'composition'; total: number; part: number }
  | { kind: 'digit'; place: 'ones' | 'tens'; digit: number }
  | { kind: 'expression-symbol'; left: ArithmeticTask; right: ArithmeticTask }
  | { kind: 'equivalent'; target: number }
  | { kind: 'groups'; groups: number; each: number }
  | { kind: 'story'; start: number; change: number; operator: '+' | '-' };
export interface ChoiceOption { readonly id: string; readonly value: number | boolean | Relation | ArithmeticTask }
export interface ChoiceTask {
  readonly kind: 'choice';
  readonly question: ChoiceQuestion;
  readonly options: readonly ChoiceOption[];
}
export type MathTask = ArithmeticTask | ChoiceTask;

/** 语文固定候选任务：目标字识别（shape）/ 图文配对（meaning）为单选，部件组字为多选。 */
export interface HanziChooseTask {
  readonly kind: 'hanzi-choose';
  readonly mode: 'shape' | 'meaning';
  /** 题面目标字；meaning 模式下配图与该字对应。 */
  readonly target: string;
  /** meaning 模式的原创图片路径（构建产物内相对路径）；shape 模式无图。 */
  readonly image?: string;
  readonly options: readonly string[];
}
/** 语文部件组字任务：多选部件集合判题（无序、无重复），部件互不相同。 */
export interface HanziPartsTask {
  readonly kind: 'hanzi-parts';
  /** 组字结果字（题面不显示，仅用于审核与记录）。 */
  readonly result: string;
  /** 原创图片路径（表达部件意象，不含结果字字形）。 */
  readonly image: string;
  readonly parts: readonly string[];
  readonly options: readonly string[];
}
export type ChineseTask = HanziChooseTask | HanziPartsTask;
export type Task = MathTask | ChineseTask;
export type SubmittedAnswer = number | string | readonly string[];
export interface Exercise<T extends Task = Task> {
  id: string;
  subject: Subject;
  mappingIds: readonly string[];
  gameIds: readonly string[];
  task: T;
  review: { status: 'draft' } | { status: 'approved'; reviewer: string; reviewedAt: string };
}
export interface Catalog {
  textbooks: readonly Textbook[];
  units: readonly Unit[];
  skills: readonly Skill[];
  mappings: readonly Mapping[];
  exercises: readonly Exercise[];
  evidence: readonly Evidence[];
}
export interface ExerciseQuery {
  subject: Subject;
  grades: readonly Grade[];
  gameId: string;
}
