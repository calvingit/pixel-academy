import type { Grade, Subject, Textbook } from '../learning/models.js';
const subjects = [
  ['CH', 'chinese', '统编语文（人民教育出版社）'],
  ['MA', 'math', '北师大版数学'],
  ['EN', 'english', '深圳用沪教英语目标系列（低年级正式书名待核）'],
] as const;
const firstBatch = new Set(['CH-01A', 'MA-01A', 'MA-02A', 'EN-01A']);
export const textbooks: readonly Textbook[] = subjects.flatMap(([prefix, subject, series]) =>
  Array.from({ length: 6 }, (_, i) => (['A', 'B'] as const).map(term => {
    const id = `${prefix}-${String(i + 1).padStart(2, '0')}${term}`;
    return { id, subject: subject as Subject, grade: (i + 1) as Grade, term, series,
      title: null, isbn: null, edition: null,
      localAdoptionVerification: 'pending' as const, sourceVerification: 'pending' as const,
      directoryStatus: firstBatch.has(id) ? 'candidate' as const : 'deferred' as const,
      evidenceIds: ['handoff-2026-10-25'],
    };
  })).flat());
