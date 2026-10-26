import { scenes } from './scenes.js';
import { drawScene } from './render.js';

const byId = (id) => document.getElementById(id);
const screen = byId('screen');
const canvas = byId('scene');
const choices = byId('choices');
const feedback = byId('feedback');
const pauseButton = byId('pause');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let current = 0;
let paused = false;
let frame = 0;
let lastTime = 0;

scenes.forEach((scene,index) => {
  const button = document.createElement('button');
  button.className = 'game-link';
  button.style.setProperty('--swatch',scene.palette[0]);
  button.innerHTML = `<span class="game-icon" aria-hidden="true">${scene.icon}</span><span class="game-name">${scene.title}<small>${scene.english}</small></span><span class="game-number">${String(index+1).padStart(2,'0')}</span>`;
  button.addEventListener('click',() => showScene(index));
  byId('game-list').append(button);
});

function selectChoice(button) {
  for(const choice of choices.children) choice.setAttribute('aria-pressed',String(choice===button));
  feedback.textContent = `✓ 已选「${button.textContent}」 · 仅演示视觉反馈`;
}

function showScene(index) {
  current = (index+scenes.length)%scenes.length;
  const scene = scenes[current];
  screen.dataset.game = scene.id;
  byId('game-title').textContent = scene.title;
  byId('scene-counter').textContent = `${String(current+1).padStart(2,'0')} / 09`;
  byId('scene-caption').textContent = scene.caption;
  byId('world-title').textContent = scene.world;
  byId('world-description').textContent = scene.description;
  byId('task').textContent = scene.task;
  byId('task').style.whiteSpace = 'pre-line';
  if(scene.id==='pinyin') {
    const button = document.createElement('button');
    button.className = 'sound-preview';
    button.textContent = '◖))';
    button.setAttribute('aria-label','声音按钮视觉演示（无语音）');
    button.addEventListener('click',() => { feedback.textContent = '♪ 声音按钮已点亮 · 此原型不播放语音'; button.style.background = '#ffed9d'; });
    byId('task').replaceChildren(button);
  }
  byId('palette').replaceChildren(...scene.palette.map(color => {
    const swatch=document.createElement('span'); swatch.style.background=color; swatch.title=color; return swatch;
  }));
  choices.replaceChildren(...scene.choices.map((label,i) => {
    const button=document.createElement('button');
    button.className='choice';
    button.textContent=label;
    button.setAttribute('aria-pressed','false');
    button.style.setProperty('--tile',scene.id==='number'?'#b2eaff':['#ffb4a4','#ffe170','#cbb3f0'][i%3]);
    if(scene.id==='hanzi' || scene.id==='idiom') button.style.setProperty('--tile','#fff0bf');
    if(scene.id==='geometry') button.style.setProperty('--tile',['#ff9e8e','#ffe15a','#8de69c'][i]);
    if(scene.id==='courier') { button.style.fontSize='5cqi'; button.style.aspectRatio='1.25'; }
    button.addEventListener('click',() => selectChoice(button));
    return button;
  }));
  for(const [i,button] of [...byId('game-list').children].entries()) button.setAttribute('aria-current',String(i===current));
  feedback.textContent='点一点，试试选中效果';
  setPaused(false);
  drawScene(canvas,scene.id);
}

function animate(time) {
  if(time-lastTime>100) { drawScene(canvas,scenes[current].id,time); lastTime=time; }
  frame=requestAnimationFrame(animate);
}

function setPaused(value) {
  paused=value;
  byId('pause-layer').hidden=!value;
  pauseButton.setAttribute('aria-pressed',String(value));
  pauseButton.textContent=value?'▶ 继续':'Ⅱ 暂停';
  choices.inert=value;
  byId('task').inert=value;
  cancelAnimationFrame(frame);
  if(!value && !reducedMotion.matches && !document.hidden) frame=requestAnimationFrame(animate);
  if(value) byId('resume').focus();
}

pauseButton.addEventListener('click',() => { const wasPaused=paused; setPaused(!paused); if(wasPaused) pauseButton.focus(); });
byId('resume').addEventListener('click',() => { setPaused(false); pauseButton.focus(); });
byId('reset').addEventListener('click',() => showScene(current));
byId('previous').addEventListener('click',() => showScene(current-1));
byId('next').addEventListener('click',() => showScene(current+1));
document.addEventListener('keydown',event => { if(event.key==='Escape' && paused) { setPaused(false); pauseButton.focus(); } });
document.addEventListener('visibilitychange',() => { cancelAnimationFrame(frame); if(!document.hidden && !paused && !reducedMotion.matches) frame=requestAnimationFrame(animate); });
reducedMotion.addEventListener('change',() => { setPaused(paused); drawScene(canvas,scenes[current].id); });
showScene(0);
