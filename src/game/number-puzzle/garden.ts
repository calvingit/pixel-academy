/** 数字花园的静态装饰；沿用棋盘坐标，题面与反馈由渲染器覆盖在上方。 */
export function drawNumberGarden(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  const rect = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  rect(0, 0, 360, 620, '#64cff6');
  for (const [x, y] of [[0, 65], [288, 110], [78, 184]] as const) {
    rect(x, y + 8, 58, 14, '#e9fbff');
    rect(x + 12, y, 30, 26, '#fffef3');
  }
  ctx.fillStyle = '#85ccba';
  ctx.beginPath();
  ctx.moveTo(0, 280);
  ctx.lineTo(72, 174);
  ctx.lineTo(170, 274);
  ctx.lineTo(268, 166);
  ctx.lineTo(360, 250);
  ctx.lineTo(360, 620);
  ctx.lineTo(0, 620);
  ctx.closePath();
  ctx.fill();
  rect(0, 314, 360, 306, '#8ccd59');
  rect(0, 314, 360, 6, '#c2e87c');
  for (const x of [0, 348]) {
    rect(x + 3, 340, 6, 260, '#76503a');
    for (let y = 348; y < 590; y += 62) {
      rect(x, y, 12, 30, '#429858');
      rect(x, y, 7, 16, '#80c95b');
    }
  }
  for (let i = 0; i < 24; i++) {
    const x = (i * 43 + 4) % 354;
    const y = 338 + (i * 37) % 276;
    rect(x, y, 3, 6, '#3e8e51');
    rect(x - 2, y - 2, 7, 3, i % 2 ? '#ffcb58' : '#f59dba');
    rect(x, y - 4, 3, 7, '#fff5c1');
  }
  // 蓝蓝只作装饰，不表达生命值、判题或分数。
  const palette: Record<string, string> = { b: '#2688cd', c: '#adefff', k: '#163849', p: '#ff9caf' };
  const sprite = ['..bbbbbbbb..', '.bccccccccb.', 'bccccccccccb', 'bcckccckcccb', 'bcckccckcccb', 'bppcckcccppb', '.bccccccccb.', '..bb..bb....'];
  sprite.forEach((row, y) => [...row].forEach((pixel, x) => {
    const color = palette[pixel];
    if (color) rect(162 + x * 3, 8 + y * 3, 3, 3, color);
  }));
  ctx.restore();
}
