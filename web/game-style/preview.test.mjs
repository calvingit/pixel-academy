import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenes } from './scenes.js';
import { drawScene } from './render.js';

test('九款场景有独立 ID、完整展示文案与可见选项', () => {
  assert.equal(scenes.length, 9);
  assert.equal(new Set(scenes.map(scene => scene.id)).size, 9);
  for (const scene of scenes) {
    for (const key of ['title', 'task', 'caption', 'world', 'description']) assert.ok(scene[key].trim());
    assert.ok(scene.choices.length > 0);
    assert.equal(new Set(scene.choices).size, scene.choices.length);
    assert.equal(scene.palette.length, 3);
    assert.ok(scene.palette.every(color => /^#[0-9a-f]{6}$/i.test(color)));
  }
});

test('每款 Canvas 场景可独立绘制，动画帧不产生非法坐标，绘制栈平衡', () => {
  for (const scene of scenes) {
    let depth = 0;
    let rectangles = 0;
    const check = (...values) => assert.ok(values.every(Number.isFinite));
    const context = {
      save() { depth++; }, restore() { depth--; assert.ok(depth >= 0); },
      scale: check, moveTo: check, lineTo: check,
      fillRect(...values) { check(...values); assert.ok(values[2] > 0 && values[3] > 0); rectangles++; },
      beginPath() {}, closePath() {}, fill() {},
    };
    for (const time of [0, 450, 1400]) drawScene({ getContext: () => context }, scene.id, time);
    assert.equal(depth, 0, scene.id);
    assert.ok(rectangles > 100, scene.id);
  }
});
