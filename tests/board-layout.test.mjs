import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardLayout } from '../dist/game/number-puzzle/render.js';

test('单屏棋盘在紧凑竖屏与横屏中保留十二个触摸目标，题卡和棋盘互不覆盖', () => {
  for (const [width, height] of [[288, 350], [343, 440], [380, 650], [396, 252], [640, 340]]) {
    const l = boardLayout(width, height);
    assert.ok(l.width * l.scale <= width);
    assert.ok(l.height * l.scale <= height);
    assert.ok(l.tileW * l.scale >= 44);
    assert.ok(l.tileH * l.scale >= 44);
    assert.ok(l.task.h > 0);
    for (let index = 0; index < 12; index++) {
      const x = l.boardX + index % l.columns * (l.tileW + 8);
      const y = l.boardY + Math.floor(index / l.columns) * (l.tileH + 8);
      assert.ok(x + l.tileW <= l.width);
      assert.ok(y + l.tileH <= l.height);
      assert.ok(x >= l.task.x + l.task.w || y >= l.task.y + l.task.h);
      assert.equal(Math.floor((y - l.boardY + l.tileH / 2) / (l.tileH + 8)) * l.columns
        + Math.floor((x - l.boardX + l.tileW / 2) / (l.tileW + 8)), index);
    }
  }
  assert.equal(boardLayout(288, 350).columns, 3);
  assert.equal(boardLayout(396, 252).columns, 4);
});
