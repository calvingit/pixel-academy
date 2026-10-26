/** 数字花园的静态底色与边缘植物；装饰不表达答案或游戏状态。 */
export function drawNumberGarden(ctx: CanvasRenderingContext2D, skin: 'garden' | 'autumn' | 'snow' = 'garden'): void {
  ctx.save();
  const palette = {
    garden: { ground: '#edf2e6', leaf: '#a7bd95', flower: '#e5c777' },
    autumn: { ground: '#f5eddb', leaf: '#c5ab7e', flower: '#cb8e52' },
    snow: { ground: '#e9f2f2', leaf: '#abc5c8', flower: '#fffef8' },
  }[skin];
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, 360, 620);
  for (const x of [3, 354]) {
    for (const y of [80, 190, 330, 480, 598]) {
      ctx.fillStyle = palette.leaf;
      ctx.fillRect(x, y, 2, 15);
      ctx.fillRect(x - 2, y + 5, 6, 3);
      ctx.fillStyle = palette.flower;
      ctx.fillRect(x - 1, y - 2, 4, 4);
    }
  }
  const rect = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  };
  if (skin === 'autumn') {
    rect(188, 22, 4, 16, '#89734c'); rect(177, 10, 26, 19, '#c79256');
    rect(181, 16, 4, 4, '#9b5038'); rect(195, 21, 4, 4, '#9b5038');
  } else if (skin === 'snow') {
    rect(176, 17, 28, 21, '#ac8a67'); rect(172, 11, 36, 7, '#fffef8');
    rect(187, 26, 6, 12, '#71644e'); rect(197, 22, 4, 5, '#fffef8');
  } else {
    rect(178, 13, 24, 22, '#7da8a8'); rect(182, 19, 3, 5, '#294e3c');
    rect(195, 19, 3, 5, '#294e3c'); rect(187, 28, 6, 2, '#294e3c');
  }
  ctx.restore();
}
