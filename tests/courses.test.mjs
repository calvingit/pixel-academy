import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSES, selectCourseExercises, taskIdentity, explainTask } from '../dist/game/number-puzzle/learning.js';
import { loadGameContent } from '../dist/game/number-puzzle/content.js';
import { createSeededRng } from '../dist/game/number-puzzle/random.js';
import { correctOptionIds, optionText } from '../dist/learning/choice.js';
import { answerFor } from '../dist/index.js';
const content = loadGameContent();
const explanationHasAnswer = task => task.kind === 'choice' ? task.options.filter(o => correctOptionIds(task).includes(o.id)).every(o => explainTask(task).includes(optionText(o))) : explainTask(task).includes(String(answerFor(task)));
test('twenty-one courses have reviewed examples and three unique approved exercises from the correct grade', () => {
  assert.equal(COURSES.length, 21);
  for (const course of COURSES) {
    assert.match(course.review.reviewer, /代理/); assert.ok(Number.isFinite(Date.parse(course.review.reviewedAt)));
    const selected = selectCourseExercises(course, content.select([course.grade]), createSeededRng(42));
    assert.equal(selected.length, 3); assert.equal(new Set(selected.map(e => taskIdentity(e.task))).size, 3);
    for (const e of selected) { assert.equal(content.gradeOf(e), course.grade); assert.equal(e.review.status, 'approved'); assert.ok(explanationHasAnswer(e.task)); }
    assert.ok(explanationHasAnswer(course.example));
    assert.throws(() => selectCourseExercises(course, [], createSeededRng(1)), /不足/);
  }
});
test('identity ignores generator IDs but preserves dot layout and ordered operations', () => {
  assert.notEqual(taskIdentity({ kind: 'binary', operator: '*', left: 2, right: 3 }), taskIdentity({ kind: 'binary', operator: '*', left: 3, right: 2 }));
  assert.notEqual(taskIdentity({ kind: 'number', value: 6 }), taskIdentity({ kind: 'binary', operator: '+', left: 2, right: 4 }));
});
