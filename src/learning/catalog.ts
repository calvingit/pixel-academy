import type { Catalog, Exercise, ExerciseQuery } from './models.js';
import { validateTask } from './evaluation.js';

/** 校验受 TypeScript 约束的静态数据；不是外部 JSON 的反序列化器。 */
export function validateCatalog(catalog: Catalog): readonly string[] {
  const errors: string[] = [];
  const index = <T extends { id: string }>(rows: readonly T[], name: string) => {
    const map = new Map<string, T>();
    for (const row of rows) {
      if (map.has(row.id)) errors.push(`Duplicate ${name}: ${row.id}`);
      map.set(row.id, row);
    }
    return map;
  };
  const books = index(catalog.textbooks, 'textbook');
  const units = index(catalog.units, 'unit');
  const skills = index(catalog.skills, 'skill');
  const mappings = index(catalog.mappings, 'mapping');
  index(catalog.exercises, 'exercise');
  const evidence = index(catalog.evidence, 'evidence');
  for (const row of [...catalog.textbooks, ...catalog.units, ...catalog.mappings]) {
    if (!row.evidenceIds.length) errors.push(`Missing evidence: ${row.id}`);
    for (const id of row.evidenceIds) if (!evidence.has(id)) errors.push(`Unknown evidence: ${row.id}/${id}`);
  }
  for (const book of books.values()) {
    if (![1, 2, 3, 4, 5, 6].includes(book.grade)) errors.push(`Invalid grade: ${book.id}`);
  }
  for (const unit of units.values()) {
    const book = books.get(unit.textbookId);
    if (!book) errors.push(`Unknown textbook: ${unit.id}`);
    else if (book.directoryStatus === 'deferred') errors.push(`Deferred textbook has units: ${unit.id}`);
  }
  for (const mapping of mappings.values()) {
    const skill = skills.get(mapping.skillId);
    if (!skill) errors.push(`Unknown skill: ${mapping.id}`);
    if (!mapping.unitIds.length) errors.push(`Empty mapping: ${mapping.id}`);
    for (const id of mapping.unitIds) {
      const unit = units.get(id);
      if (!unit) errors.push(`Unknown unit: ${mapping.id}/${id}`);
      else if (skill && books.get(unit.textbookId)?.subject !== skill.subject) errors.push(`Subject mismatch: ${mapping.id}`);
    }
  }
  for (const exercise of catalog.exercises) {
    if (!exercise.mappingIds.length || !exercise.gameIds.length) errors.push(`Missing exercise scope: ${exercise.id}`);
    for (const id of exercise.mappingIds) {
      const mapping = mappings.get(id);
      if (!mapping) errors.push(`Unknown mapping: ${exercise.id}/${id}`);
      else if (skills.get(mapping.skillId)?.subject !== exercise.subject) errors.push(`Subject mismatch: ${exercise.id}`);
    }
    if (exercise.review.status === 'approved' && (
      !exercise.review.reviewer.trim() || !/^\d{4}-\d{2}-\d{2}T/.test(exercise.review.reviewedAt) ||
      !Number.isFinite(Date.parse(exercise.review.reviewedAt))
    )) errors.push(`Invalid approval: ${exercise.id}`);
    try { validateTask(exercise.task); } catch { errors.push(`Invalid task: ${exercise.id}`); }
  }
  return errors;
}

export function createLearningCore(catalog: Catalog) {
  const errors = validateCatalog(catalog);
  if (errors.length) throw new Error(errors.join('\n'));
  const books = new Map(catalog.textbooks.map(book => [book.id, book]));
  const units = new Map(catalog.units.map(unit => [unit.id, unit]));
  const mappingGrades = new Map(catalog.mappings.map(mapping => [mapping.id,
    mapping.unitIds.map(id => books.get(units.get(id)!.textbookId)!.grade),
  ]));
  const select = (query: ExerciseQuery, drafts: boolean): readonly Exercise[] => {
    if (!query.grades.length || query.grades.some(g => ![1, 2, 3, 4, 5, 6].includes(g))) {
      throw new RangeError('Select at least one grade between 1 and 6');
    }
    if (!query.gameId.trim()) throw new TypeError('gameId is required');
    return catalog.exercises.filter(exercise =>
      (drafts || exercise.review.status === 'approved') &&
      exercise.subject === query.subject && exercise.gameIds.includes(query.gameId) &&
      exercise.mappingIds.some(id => mappingGrades.get(id)!.some(grade => query.grades.includes(grade))),
    );
  };
  return {
    selectExercises: (query: ExerciseQuery) => select(query, false),
    previewExercises: (query: ExerciseQuery) => select(query, true),
  };
}
