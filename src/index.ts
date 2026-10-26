import { textbooks } from './content/textbooks.js';
import { units } from './content/units.js';
import { skills, mappings } from './content/skills.js';
import { exercises } from './content/exercises.js';
import { evidence } from './content/evidence.js';
import { createLearningCore } from './learning/catalog.js';
import type { Catalog } from './learning/models.js';

export const catalog: Catalog = { textbooks, units, skills, mappings, exercises, evidence };
export const { selectExercises, previewExercises } = createLearningCore(catalog);
export { createLearningCore, validateCatalog } from './learning/catalog.js';
export { answerFor, evaluateAnswer, validateTask } from './learning/evaluation.js';
export type * from './learning/models.js';
