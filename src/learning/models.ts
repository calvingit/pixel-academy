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
/** 拼音字母辨认任务：呈现目标字形，从候选中选认（单选）。 */
export interface PinyinChooseTask {
  readonly kind: 'pinyin-choose';
  /** 目标拼音字母（声母或韵母；zh/ch/sh 为双字母，ü 为单字母）。 */
  readonly letter: string;
  /** 题面文案（辨认题可含目标字形，与字形认读玩法一致）。 */
  readonly prompt: string;
  readonly options: readonly string[];
  /** 正确答案字母；判题按字母身份，与候选排列无关。 */
  readonly answer: string;
}
/** 拼音听辨任务：播放音频选认字母。 */
export interface PinyinListenTask {
  readonly kind: 'pinyin-listen';
  /** 目标拼音字母（仅用于判题与记录；题面与渲染层不得展示）。 */
  readonly letter: string;
  /** 音频资源路径（web 根内相对路径，随构建预缓存，如 audio/pinyin/b.wav）。 */
  readonly audio: string;
  /** 题面文案；结构级防泄露：不得包含任何拼音字母字形。 */
  readonly prompt: string;
  readonly options: readonly string[];
  readonly answer: string;
}
export type PinyinTask = PinyinChooseTask | PinyinListenTask;
/** 英语快递任务：读指令 → 取对应地址包裹 → 送达对应角色；两步分开判定（双对才算送达）。 */
export interface EnglishDeliveryTask {
  readonly kind: 'english-delivery';
  /** 任务类别：vocab 词汇识别（指令点名词，考词形辨认）/ sentence 句意理解（短句解析定指向）。 */
  readonly mode: 'vocab' | 'sentence';
  /** 英语指令（固定文案随构建交付；表述正确性由内容审核记录支撑）。 */
  readonly prompt: string;
  /** 包裹候选：地址标签词（含正确词与干扰词，取自英语词表）。 */
  readonly parcels: readonly string[];
  /** 收件角色候选：身份词（家庭任务取家庭词表、情绪任务取情绪词表；角色卡不带英语文字标签）。 */
  readonly recipients: readonly string[];
  /** 正确包裹的可接受标签词集合（同义表达同指一个规范词，如 ['mum','mother']）。 */
  readonly parcelAnswers: readonly string[];
  /** 正确收件人的可接受身份词集合。 */
  readonly recipientAnswers: readonly string[];
}
export type EnglishTask = EnglishDeliveryTask;
/** 立体图形辨认任务：呈现图形渲染图，从中文名称候选中选认（单选；判题按形状身份）。 */
export interface ShapeChooseTask {
  readonly kind: 'shape-choose';
  /** 目标形状身份（SHAPES_3D 内）。 */
  readonly shape: string;
  /** 题面渲染图路径（web 根内相对路径，随构建预缓存）。 */
  readonly image: string;
  /** 中文名称候选（含正确名与干扰名，取自 SHAPE_LABELS）。 */
  readonly options: readonly string[];
  /** 正确答案中文名；判题按形状身份，与候选排列无关。 */
  readonly answer: string;
}
/** 立体图形放置任务：把积木放入分类区（classify，整组提交）或搭建槽位（build，逐槽即时判定）。 */
export interface ShapePlaceTask {
  readonly kind: 'shape-place';
  readonly mode: 'classify' | 'build';
  /** 中文题面。 */
  readonly prompt: string;
  /** 积木形状身份序列（语义序；渲染排列由组卷洗牌决定）。 */
  readonly blocks: readonly string[];
  /** classify：分类区（accept 恰一个形状）；build：按序槽位（accept 为可接受形状集合，等价解来源）。 */
  readonly zones: readonly { readonly id: string; readonly accept: readonly string[] }[];
}
export type ShapeTask = ShapeChooseTask | ShapePlaceTask;
export type Task = MathTask | ChineseTask | PinyinTask | EnglishTask | ShapeTask;
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
