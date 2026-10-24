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
export type MathTask =
  | { kind: 'number'; value: number }
  | { kind: 'binary'; operator: '+' | '-' | '*'; left: number; right: number }
  | { kind: 'chain'; start: number; steps: readonly { operator: '+' | '-'; operand: number }[] };
export interface Exercise {
  id: string;
  subject: 'math';
  mappingIds: readonly string[];
  gameIds: readonly string[];
  task: MathTask;
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
