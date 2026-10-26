const ink = '#233a48';

// 场景采用 180 × 250 逻辑像素，统一放大两倍，文字交给 HTML 保持清晰。
export function drawScene(canvas, id, time = 0) {
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.save();
  c.scale(2, 2);
  const r = (x,y,w,h,color) => { c.fillStyle=color; c.fillRect(Math.round(x),Math.round(y),w,h); };
  const poly = (points,color) => { c.fillStyle=color; c.beginPath(); points.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill(); };
  const box = (x,y,w,h,color,border=ink) => { r(x,y,w,h,border); r(x+2,y+2,w-4,h-4,color); };
  const cloud = (x,y,s=1) => { r(x,y+4*s,30*s,7*s,'#e9fbff'); r(x+5*s,y,15*s,13*s,'#e9fbff'); r(x+10*s,y-3*s,8*s,4*s,'#fffef3'); r(x+3*s,y+11*s,24*s,3*s,'#b6e9ed'); };
  const tree = (x,y,s=1,pine=false) => {
    r(x-3*s,y,7*s,30*s,'#76503a'); r(x,y,2*s,29*s,'#b8874b');
    if(pine) { for(let i=0;i<3;i++) { const a=10+i*4; poly([[x,y-33*s+i*12*s],[x-a*s,y-8*s+i*12*s],[x+a*s,y-8*s+i*12*s]],i%2?'#25866b':'#14664f'); } }
    else { r(x-16*s,y-16*s,34*s,19*s,'#226850'); r(x-21*s,y-12*s,43*s,10*s,'#226850'); r(x-15*s,y-25*s,29*s,24*s,'#429858'); r(x-8*s,y-31*s,19*s,29*s,'#429858'); r(x-18*s,y-15*s,19*s,14*s,'#66b854'); r(x-9*s,y-26*s,13*s,15*s,'#80c95b'); r(x+8*s,y-17*s,8*s,9*s,'#32764c'); r(x-13*s,y-21*s,5*s,5*s,'#a5db66'); }
  };
  const grass = (start=165) => {
    r(0,start,180,250-start,'#8ccd59'); r(0,start,180,4,'#c2e87c');
    for(let i=0;i<75;i++) { const x=(i*37+9)%180,y=start+9+(i*23)%Math.max(10,241-start); r(x,y,3,2,i%3?'#6db852':'#b9df67'); if(i%5===0) r(x+1,y-2,1,3,'#519c51'); }
  };
  const flowers = () => { for(let i=0;i<16;i++){ const x=(i*43+5)%177,y=176+(i*17)%67; r(x,y,2,6,'#3e8e51'); r(x-2,y,6,3,i%2?'#ffcb58':'#f59dba'); r(x,y-2,2,7,i%2?'#ffcb58':'#f59dba'); r(x,y,2,2,'#fff5c1'); } };
  const castle = (x,y) => { r(x,y+8,24,38,'#b6cbd0'); r(x+4,y+4,5,42,'#f7e4bb'); r(x+18,y,6,46,'#e7d6ad'); r(x+18,y-7,2,8,'#495b65'); poly([[x+20,y-7],[x+28,y-4],[x+20,y-1]],'#fa6a66'); r(x+6,y+15,3,6,'#658799'); r(x+19,y+10,3,6,'#658799'); r(x+11,y+29,5,17,'#658799'); };
  const sprite = (rows,x,y,s,palette) => rows.forEach((row,j)=>[...row].forEach((v,i)=> { if(palette[v]) r(x+i*s,y+j*s,s,s,palette[v]); }));
  const palettes = { '#':ink, w:'#fff8dd', k:'#163849', b:'#42b9fa', B:'#2688cd', c:'#adefff', p:'#ff9caf', o:'#f7953d', O:'#c45e32', g:'#5aab48', G:'#2d7848', y:'#ffdb58', s:'#ffd2a1', h:'#76452f', r:'#e9545b', t:'#b1865c' };
  const blob = (x,y) => sprite(['....bbbb....','..bbccccbb..','.bccccccccb.','bccccccccccb','bcckccckcccb','bcckccckcccb','bppcckcccppb','.bccccccccb.','..bbccccbb..','..BB....BB..'],x,y,3,palettes);
  const hero = (x,y,hat='g') => sprite(['....hhhh....','...hhhhhh...','..gggggggg..','.gggggggggg.','..sssssshh..','..sksssksh..','..sssssssh..','...sssss....','..ggggggss..','.sggggggss..','.sggyygg....','..gggggg....','..hhh.hh....','.hhhh.hhh...'].map(row=>row.replaceAll('g',hat)),x,y,2,palettes);
  const fox = (x,y) => sprite(['o.........o.','oow.....woo.','ooow...wooo.','oooooooooooo','.ookooookoo.','.oowooowwoo.','..wwkkwwww..','...wwwww....','..bbbbbbb...','.bbbbbbbyy..','.bbbbbbbyy..','..bbbbb.....','..OO.OO.....','.OOO.OOO....'],x,y,3,palettes);
  const bunny = (x,y,s=2) => sprite(['..ww..ww....','..wp..pw....','..wp..pw....','..ww..ww....','.wwwwwwww...','wwwwwwwwww..','wwkwwwwkww..','wppwwwwppw..','.wwwkkwww...','..wwwwww....','.wwwwwwww...','wwwwwwwwww..','..ww..ww....'],x,y,s,palettes);
  const robot = (x,y) => sprite(['.....b......','....byb.....','.....b......','..kkkkkkkk..','.kwwwwwwwwk.','kwkkkkkkkkwk','kwkcckkcckwk','kwkkkkkkkkwk','.kwwwwwwwwk.','..kkkkkkkk..','..bwwwwwb...','.bbwwbwwbb..','..bwwwwwb...','..BB...BB...'],x,y,3,palettes);
  const star = (x,y,color='#ffe565') => { r(x+3,y,3,11,color); r(x,y+4,9,3,color); r(x+1,y+2,7,7,color); r(x+2,y+2,2,2,'#fff7c1'); };
  const bob = Math.round(Math.sin(time/400)*2);
  const sky = () => { r(0,0,180,250,'#64cff6'); cloud(4,31); cloud(130,53,.8); cloud(80,93,.6); poly([[0,160],[35,113],[55,144],[90,104],[130,146],[180,108],[180,185],[0,185]],'#85ccba'); poly([[0,171],[30,146],[75,169],[119,131],[180,167],[180,190],[0,190]],'#66b28e'); };
  sky();
  if(id==='dungeon') {
    r(0,0,180,250,'#35374f');
    for(let row=0;row<14;row++) for(let col=-1;col<7;col++) { const x=col*32+(row%2)*16,y=row*19; box(x,y,31,18,(row+col)%3?'#4b4963':'#55516c','#292e45'); r(x+3,y+3,24,2,'#66607a'); }
    poly([[43,165],[43,104],[53,82],[71,70],[106,70],[129,89],[137,111],[137,165]],'#a3896b');
    poly([[54,167],[54,109],[63,91],[78,83],[101,83],[118,96],[126,112],[126,167]],'#282e41');
    box(62,104,57,65,'#674736'); for(let i=0;i<5;i++) r(66+i*10,107,2,59,'#926442'); r(87,113,4,53,'#352e32'); box(99,135,5,7,'#f2bb53');
    for(const x of [12,154]) { box(x,120,11,6,'#a07950'); r(x+4,125,4,17,'#5a3b32'); poly([[x,119],[x+2,108-bob],[x+6,102],[x+9,111],[x+12,119]],'#ffac37'); poly([[x+3,119],[x+6,109],[x+9,119]],'#fff3a6'); }
    for(let i=0;i<4;i++) box(22-i*9,164+i*9,136+i*18,10,'#79717b');
    hero(24,104,'r');
    sprite(['....gggg....','...gggggg...','..gggggggg..','.ggkgggkggg.','gggkgggkgggg','gggggggggggg','.GGGGGGGGGG.'],126,143,3,palettes); star(137,132);
    r(0,193,180,57,'#656077');
  } else if(id==='island') {
    r(0,124,180,126,'#23b3d1');
    for(let i=0;i<35;i++) r((i*37)%180,130+(i*13)%107,12+i%9,2,i%2?'#9be8dc':'#54cfdf');
    poly([[0,193],[23,191],[53,177],[105,176],[148,194],[180,188],[180,250],[0,250]],'#fff0b7'); poly([[0,202],[42,193],[71,183],[122,192],[180,203],[180,250],[0,250]],'#f6d58a');
    poly([[40,125],[69,92],[79,110],[107,97],[135,125]],'#9cc6ba'); r(40,125,97,4,'#f1d59c');
    const palm=(x,y,flip=1)=> { for(let i=0;i<7;i++) { r(x+flip*Math.floor(i*i/9),y-i*7,7,9,'#96683c'); r(x+flip*Math.floor(i*i/9),y-i*7,2,7,'#dba35a'); } const top=x+flip*4; for(let j=-2;j<=2;j++) poly([[top,y-47],[top+j*15,y-62+Math.abs(j)*7],[top+j*20,y-40],[top+j*13,y-48]],j%2?'#287f52':'#3ca35c'); };
    palm(13,180,1); palm(159,187,-1);
    box(48,109,85,64,'#fffbe3');
    poly([[65,128],[75,143],[93,149],[113,138],[120,119],[125,122],[125,144],[110,158],[87,161],[72,153],[63,140]],'#634a30');
    poly([[66,130],[77,145],[95,151],[116,139],[121,124],[122,142],[108,154],[87,157],[74,150]],'#ffd948'); r(118,119,5,9,'#4b8845');
    star(141,156); star(35,179);
  } else if(id==='pinyin') {
    for(let i=0;i<6;i++) cloud((i*53)%180,100+(i*31)%130,.7+(i%2)*.3);
    const island=(x,y,s)=> { poly([[x,y],[x+50*s,y],[x+31*s,y+38*s],[x+17*s,y+26*s]],'#899eaa'); poly([[x+9*s,y+7*s],[x+27*s,y+14*s],[x+22*s,y+31*s]],'#bdd4cc'); r(x-2*s,y-4*s,54*s,6*s,'#66ad5b'); r(x+3*s,y-7*s,43*s,4*s,'#99d66a'); tree(x+19*s,y-17*s,.45*s); };
    island(4,151,.65); island(119,125,1); island(66,201,.7); castle(139,83);
    sprite(['......bbbb....','..b..bbbbbb...','.bbbbooooob...','bbbbboccocob..','bbbbbbcccccbb.','.bbbbckckccbbb','..bbbccyccccbb','...bbbccccbbb.','...oobbbbb....','..ooo..oo.....'],14,94+bob,3,palettes);
  } else {
    grass(id==='hanzi'?132:163);
    if(id==='courier') {
      poly([[55,144],[72,144],[100,185],[134,250],[87,250],[74,194],[45,163]],'#f7d88e');
      for(let i=0;i<9;i++) { const x=56+i*5,y=155+i*10; r(x,y,8,4,'#ba814b'); r(x+1,y+1,6,2,'#c29556'); }
      for(const [x,y] of [[6,132],[117,117],[144,145]]) { box(x,y,28,31,'#fff0c4'); poly([[x-4,y],[x+14,y-19],[x+33,y]],'#b8594d'); for(let k=0;k<5;k++) r(x+k*6,y-1-k%2*3,5,3,'#e98463'); box(x+10,y+15,8,16,'#9f6f43'); box(x+3,y+6,6,7,'#8bceda'); }
      box(128,175,39,31,'#b48148'); box(130,177,35,25,'#f9e4a0'); for(let i=0;i<5;i++) r(124+i*10,165,10,12,i%2?'#fff5d6':'#ed6f60');
      sprite(['...g....','..gg....','.rrrrrr.','rrrrrrrr','rrrrrrrr','.rrrrrr.','..rrrr..'],139,182,2,palettes); fox(36,137+bob);
      tree(4,113,.8); tree(176,124,.7);
    } else if(id==='geometry') {
      castle(146,109); tree(12,146,.7); tree(164,157,.65); robot(10,100+bob);
      r(48,177,91,4,'#ad874c'); box(61,140,29,20,'#3c9bff'); box(92,140,29,20,'#3c9bff'); box(77,120,29,20,'#ffdb40');
      poly([[72,120],[91,100],[111,120]],ink); poly([[77,117],[91,105],[106,117]],'#ff7166');
      for(const x of [67,107]) { box(x,160,21,17,'#53cf78'); r(x+4,163,12,2,'#a3f197'); }
      star(135,107); star(150,100); star(164,107);
    } else if(id==='idiom') {
      tree(1,140,1.4); tree(163,140,1); tree(123,111,.8); flowers();
      poly([[37,177],[54,150],[55,117],[80,116],[83,150],[105,175],[91,181],[65,167],[52,186]],'#684833');
      poly([[43,174],[62,147],[62,123],[75,122],[76,151],[96,175],[84,174],[68,159],[54,179]],'#b78046');
      box(53,114,29,9,'#eed1a0','#775237'); r(59,117,16,2,'#ba8e60'); bunny(48,86+bob,2); bunny(96,150,2.3);
      for(let i=0;i<4;i++) { r(133+i*9,160,3,19,'#946a44'); r(131+i*9,166,12,3,'#c59558'); }
    } else if(id==='detective') {
      tree(13,128,1.1); tree(166,132,.9); tree(121,105,.7);
      box(122,146,36,6,'#d9a05e'); r(122,156,36,4,'#a67442'); r(125,160,3,9,'#4c544b'); r(153,160,3,9,'#4c544b');
      r(167,102,3,67,'#34495a'); box(162,102,13,15,'#ffe890'); r(160,100,17,3,'#34495a');
      hero(18,70,'t'); box(46,80,15,15,'#c8eff0'); r(44,95,4,10,'#675641'); r(49,82,7,2,'#fffbe3'); flowers();
    } else if(id==='hanzi') {
      for(const [x,y,s] of [[8,110,.9],[164,114,1],[42,152,.9],[92,143,1],[146,154,.85]]) tree(x,y,s,x===92);
      hero(8,47+bob); flowers();
    } else {
      castle(142,106); tree(4,143,.8); tree(174,163,.85); flowers(); blob(7,42+bob); star(53,114); star(136,107);
    }
  }
  if(id!=='dungeon' && id!=='pinyin') { tree(-8,221,1); tree(187,221,1.1); }
  if(id==='dungeon') { r(0,240,180,10,'#34334d'); }
  for(let i=0;i<5;i++) { const x=12+(i*41)%160, y=97+(i*29)%86; if((i+Math.floor(time/700))%3===0) star(x,y,id==='dungeon'?'#f7c879':'#fff6b0'); }
  c.restore();
}
