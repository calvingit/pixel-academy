import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawNumberGarden } from '../dist/game/number-puzzle/garden.js';

test('数字花园静态绘制坐标有效，Canvas 状态不泄漏且不修改坐标变换', () => {
  let depth = 0;
  const backgrounds = new Set();
  let rectangles = 0;
  const check = (...values) => assert.ok(values.every(Number.isFinite));
  const ctx = {
    save() { depth++; },
    restore() { depth--; assert.ok(depth >= 0); },
    fillRect(x, y, w, h) {
      check(x, y, w, h);
      assert.ok(w > 0 && h > 0);
      assert.ok(x >= 0 && y >= 0 && x + w <= 360 && y + h <= 620);
      if (w === 360 && h === 620) backgrounds.add(this.fillStyle);
      rectangles++;
    },
    beginPath() {}, moveTo: check, lineTo: check, closePath() {}, fill() {},
  };
  for (const skin of ['garden', 'autumn', 'snow']) drawNumberGarden(ctx, skin);
  assert.equal(depth, 0);
  assert.ok(rectangles > 3, '各皮肤除底色外仍绘制植物装饰');
  assert.equal(backgrounds.size, 3, '三款皮肤具有不同底色');
});
