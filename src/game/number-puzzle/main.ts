import type { Exercise, Grade } from '../../learning/models.js';
import { evaluateAnswer } from '../../learning/evaluation.js';
import { createRound, clickTile, completeResolve, timeoutRound, reviveRound, startQuestion, useHint,
  useExtraTime, failRound, QUESTION_MS, EXTRA_TIME_MS, ELIMINATE_MS, FILL_MS, RULES_VERSION } from './rules.js';
import type { RoundState, ClickOutcome } from './rules.js';
import { createRuntimeRng, restoreSeededRng } from './random.js';
import { ALL_GRADES, GRADE_NAMES, describeAvailability, loadGameContent } from './content.js';
import type { GameContent } from './content.js';
import { selectRoundExercises, GENERATION_VERSION } from './generation.js';
import { NumberPuzzleRenderer } from './render.js';
import { RoundSession } from './session.js';
import { GameAudio } from './audio.js';
import { LegacyStorage } from './storage.js';
import { createProfile, openProfileStore, ConflictError, PersistenceError, PRODUCTS, buy, consume, rename,
  collectMistake, rewardCourse, rewardReview, settleChallenge } from './profile.js';
import type { Profile, ProfileStore, SavedChallenge, Product, Avatar, Skin } from './profile.js';
import { COURSES, selectCourseExercises, taskIdentity, taskText, explainTask } from './learning.js';
import { decideUpdateAdoption, describeOfflineStatus, planAdoptionExecution } from './offline.js';
import type { OfflinePhase, UpdateScreen } from './offline.js';

type ScreenId = 'error' | 'select' | 'availability' | 'game' | 'result' | 'shop' | 'courses' | 'review' | 'profile';
const CHALLENGE_CONTENT_VERSION = `${GENERATION_VERSION}:${RULES_VERSION}`;
const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};
const text = (id: string, value: string): void => { $(id).textContent = value; };
const button = (label: string, action: () => void, disabled = false): HTMLButtonElement => {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
  element.disabled = disabled; element.addEventListener('click', action); return element;
};
const avatarArt = (avatar: Avatar): string => {
  const color = { lanlan: '#2688cd', cat: '#d29551', rabbit: '#f1cfcb', owl: '#976e51' }[avatar];
  const ears = avatar === 'rabbit' ? '<rect x="13" y="1" width="8" height="23" rx="3"/><rect x="28" y="1" width="8" height="23" rx="3"/>'
    : avatar === 'cat' || avatar === 'owl' ? '<path d="M7 24V7L22 17M27 17L42 7V24"/>' : '';
  const face = avatar === 'owl' ? '<g fill="#fffbe5" stroke="#193b38" stroke-width="2"><circle cx="17" cy="29" r="7"/><circle cx="33" cy="29" r="7"/></g><g fill="#193b38"><circle cx="17" cy="29" r="2"/><circle cx="33" cy="29" r="2"/><path d="M22 36h6l-3 6z"/></g>'
    : `<path d="M17 28v5m16-5v5m-12 5h8${avatar === 'cat' ? 'M3 34l9 2m26 0 9-2M3 40l9-2m26 0 9 2' : ''}" stroke="#193b38" stroke-width="3" fill="none"/>`;
  return `<svg viewBox="0 0 50 50" aria-hidden="true"><g fill="${color}" stroke="#193b38" stroke-width="2">${ears}<rect x="6" y="16" width="38" height="30" rx="9"/></g>${face}</svg>`;
};

class NumberPuzzleApp {
  private readonly session = new RoundSession(() => Date.now());
  private profile: Profile = createProfile();
  private store: ProfileStore | null = null;
  private recoveryStore: ProfileStore | null = null;
  private busy = false;
  private screen: ScreenId = 'select';
  private readonly renderer: NumberPuzzleRenderer;
  private readonly audio = new GameAudio();
  private practiceBoard: RoundState | null = null;
  private lastResult: Profile['records'][number] | null = null;
  private courseId: string | null = null;
  private animation: { before: RoundState; outcome: Extract<ClickOutcome, { type: 'correct' }>; drawn: boolean } | null = null;
  private reviewFilter = 'pending';
  private readonly select: (grades: readonly Grade[]) => readonly Exercise[];
  private offlinePhase: OfflinePhase = 'preparing';
  private offlineVersion: string | null = null;
  private updateWaiting = false;
  private updateNoticeText: string | null = null;
  private awaitingAdoption = false;
  private swRegistration: ServiceWorkerRegistration | null = null;
  private readonly initialController: ServiceWorker | null = this.swSupported() ? navigator.serviceWorker.controller : null;

  constructor(private readonly content: GameContent, private readonly preview: boolean) {
    this.select = preview ? content.preview : content.select;
    this.renderer = new NumberPuzzleRenderer($('board-canvas'), { onTileClick: index => this.run(() => this.answer(index)) });
    this.wireUi();
    this.wireOfflineStatus();
    setInterval(() => this.tick(), 100);
  }

  async initialize(): Promise<void> {
    if (!this.preview) {
      try {
        this.store = await openProfileStore();
        this.recoveryStore = this.store;
        this.profile = await this.store.load(() => {
          const initial = createProfile();
          try {
            const legacy = new LegacyStorage(localStorage);
            const settings = legacy.loadSettings();
            initial.grades = [...settings.selectedGrades]; initial.soundOn = settings.soundOn;
            initial.legacyRecords = legacy.loadFinishedRecords(); initial.recentIds = [...legacy.loadRecentExerciseIds()];
          } catch { this.notice('旧设置无法读取；新版档案已独立初始化，旧数据未删除。'); }
          return initial;
        });
        if (this.profile.challenge) await this.change(draft => {
          const c = draft.challenge!;
          if (c.contentVersion !== CHALLENGE_CONTENT_VERSION) {
            draft.challenge = null; this.notice('上局内容版本已变更，不能继续；金币和历史记录保留。'); return;
          }
          this.capture(c);
          c.paused = true; c.deadline = null;
        });
      } catch (error) {
        this.store = null; this.notice(`档案无法读取，进入临时模式：${this.message(error)}`);
      }
    } else {
      this.profile.coins = 0; this.profile.cards = { time: 0, hint: 0, revive: 0, rename: 0 };
    }
    this.audio.setMuted(!this.profile.soundOn);
    this.showScreen('select');
    (window as unknown as Record<string, unknown>).__pixelAcademyBooted = true;
  }

  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  private notice(message: string): void { text('app-notice', message); $('app-notice').hidden = false; }
  private run(action: () => Promise<void>): void {
    if (this.busy) return;
    $('app-notice').hidden = true;
    this.busy = true; document.body.setAttribute('aria-busy', 'true');
    void action().catch(async error => {
      let message = this.message(error);
      if (error instanceof ConflictError && this.store) {
        try { this.profile = await this.store.load(createProfile); }
        catch (readError) {
          this.store = null; message = `无法同步档案：${this.message(readError)}`;
          if (this.profile.challenge) this.session.pause(this.profile.challenge);
        }
        this.practiceBoard = null;
      }
      if (error instanceof PersistenceError) {
        this.store = null;
        if (this.profile.challenge) this.session.pause(this.profile.challenge);
      }
      this.notice(message);
    }).finally(() => { this.busy = false; document.body.removeAttribute('aria-busy'); this.render();
      if (document.hidden && this.profile.challenge && !this.profile.challenge.paused) this.run(() => this.pause());
      if (this.updateWaiting) this.evaluateUpdateAdoption(); });
  }
  private async change(change: (draft: Profile) => void, persistentOnly = false): Promise<void> {
    if (persistentOnly && (!this.store || this.preview)) throw new Error('临时／预览模式不能购买、用卡或持久领奖');
    if (this.store) this.profile = await this.store.commit(this.profile, change);
    else { const next = structuredClone(this.profile); change(next); this.profile = next; }
  }
  private capture(c: SavedChallenge): void {
    c.remainingMs = this.session.remaining(c);
  }
  private activate(c: SavedChallenge, kind: SavedChallenge['timerKind'], milliseconds: number): void {
    this.session.start(c, kind, milliseconds);
  }
  private wireUi(): void {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="grade"]')) input.addEventListener('change', () => this.run(async () => {
      const grades = ALL_GRADES.filter(g => document.querySelector<HTMLInputElement>(`input[name="grade"][value="${g}"]`)?.checked);
      await this.change(p => { p.grades = grades; });
    }));
    for (const id of ['shop', 'courses', 'review', 'profile'] as const) $(`btn-open-${id}`).onclick = () => { this.courseId = null; this.showScreen(id); };
    for (const element of document.querySelectorAll<HTMLButtonElement>('[data-home]')) element.onclick = () => this.showScreen('select');
    $('btn-to-availability').onclick = () => this.showScreen('availability');
    $('btn-back-select').onclick = () => this.showScreen('select');
    $('btn-start').onclick = () => this.run(() => this.startRound());
    $('btn-again').onclick = () => this.run(() => this.startRound());
    $('btn-return').onclick = () => this.showScreen('select');
    $('btn-restore').onclick = () => { this.practiceBoard = null; this.showScreen('game'); };
    $('btn-discard-round').onclick = () => this.run(() => this.abandon(false));
    $('btn-game-return').onclick = () => this.run(() => this.abandon(false));
    $('btn-restart').onclick = () => this.run(() => this.abandon(true));
    $('btn-pause').onclick = () => this.run(() => this.togglePause());
    $('btn-resume').onclick = () => this.run(() => this.togglePause());
    $('btn-ready').onclick = () => this.run(async () => {
      await this.change(p => { const c = p.challenge!; c.state = startQuestion(c.state); this.activate(c, 'question', QUESTION_MS); });
    });
    $('btn-hint').onclick = () => this.run(() => this.useCard('hint'));
    $('btn-time').onclick = () => this.run(() => this.useCard('time'));
    $('btn-revive').onclick = () => this.run(() => this.revive());
    $('btn-end').onclick = () => this.run(async () => { await this.change(p => { p.challenge!.state = failRound(p.challenge!.state); this.settle(p); }); this.showScreen('result'); });
    $('revive-dialog').addEventListener('cancel', event => { event.preventDefault(); ($('btn-end') as HTMLButtonElement).focus(); });
    $('preview-close').onclick = () => ($('preview-dialog') as HTMLDialogElement).close();
    $('btn-sound').onclick = () => this.run(async () => {
      await this.change(p => { p.soundOn = !p.soundOn; }); this.audio.setMuted(!this.profile.soundOn);
    });
    $('btn-clear-records').onclick = () => this.run(async () => {
      if (!await this.confirm('清除成绩？金币、课程、错题和领奖记录会保留。')) return;
      await this.change(p => { p.records = []; p.legacyRecords = []; }, true);
    });
    $('btn-reset').onclick = () => this.run(async () => {
      if (!await this.confirm('重置全部本机档案？金币、卡片、装扮、昵称、学习进度、当前局和成绩将全部清除，无法撤销。')) return;
      const store = this.store ?? this.recoveryStore;
      if (!store || this.preview) throw new Error('本地存储不可用，无法重置档案');
      this.profile = await store.reset(); this.store = store;
      this.practiceBoard = null; this.courseId = null; this.showScreen('select');
    });
    $('nickname-form').onsubmit = event => { event.preventDefault(); this.run(async () => {
      const value = ($('nickname') as HTMLInputElement).value;
      await this.change(p => rename(p, value), true); this.notice('昵称已保存。');
    }); };
    $('review-filter').onchange = () => { this.reviewFilter = ($('review-filter') as HTMLSelectElement).value; this.renderReview(); };
    $('btn-practice-explain').onclick = () => this.run(async () => {
      await this.change(p => { p.practice!.revealed = true; p.practice!.passed = false; });
    });
    $('btn-practice-next').onclick = () => this.run(() => this.nextPractice());
    $('btn-mastered').onclick = () => this.run(async () => {
      await this.change(p => { const practice = p.practice!; if (!practice.reviewId || practice.correct !== 1) throw new Error('请先答对本题');
        p.mistakes[practice.reviewId]!.mastered = true; p.practice = null; });
      this.practiceBoard = null; this.showScreen('review');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.profile.challenge && !this.profile.challenge.paused) {
        this.run(async () => { await this.pause(); });
      }
    });
    window.addEventListener('pagehide', () => {
      if (this.store && this.profile.challenge && !this.busy) this.run(() => this.pause());
    });
    window.addEventListener('resize', () => this.fitBoard());
    window.visualViewport?.addEventListener('resize', () => this.fitBoard());
  }
  private async confirm(message: string): Promise<boolean> {
    const resumeOnCancel = !!this.profile.challenge && !this.profile.challenge.paused;
    if (resumeOnCancel) await this.pause();
    text('confirm-message', message);
    const dialog = $('confirm-dialog') as HTMLDialogElement;
    dialog.returnValue = ''; dialog.showModal();
    return new Promise((resolve, reject) => dialog.addEventListener('close', () => {
      const accepted = dialog.returnValue === 'yes';
      if (!accepted && resumeOnCancel) void this.togglePause().then(() => resolve(false), reject);
      else resolve(accepted);
    }, { once: true }));
  }
  private showScreen(id: ScreenId): void {
    this.screen = id; document.body.dataset.screen = id;
    if (id === 'result') this.audio.play('finish');
    for (const section of document.querySelectorAll<HTMLElement>('.screen')) section.hidden = section.id !== `screen-${id}`;
    if (id !== 'game') this.renderer.stop();
    this.render();
    if (this.updateWaiting) this.evaluateUpdateAdoption();
  }
  private render(): void {
    text('wallet', this.preview ? '候选预览 · 不读写正式档案' : !this.store ? '临时模式 · 金币和进度不保存' : `${this.profile.nickname || '小小探险家'} · ${this.profile.coins} 金币`);
    $('player-avatar').innerHTML = avatarArt(this.profile.avatar);
    document.body.dataset.skin = this.profile.skin;
    $('storage-notice').hidden = this.preview || this.store !== null;
    $('preview-banner').hidden = !this.preview;
    $('result-preview-note').hidden = !this.preview;
    $('records-section').hidden = this.preview;
    $('main-nav').hidden = this.preview || this.screen === 'game';
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="grade"]')) input.checked = this.profile.grades.includes(Number(input.value) as Grade);
    ($('btn-to-availability') as HTMLButtonElement).disabled = !this.profile.grades.length;
    $('select-empty-hint').hidden = this.profile.grades.length > 0;
    text('select-open-hint', '可任意选择一个或多个年级。当前开放：一年级、二年级（数学）。');
    $('restore-offer').hidden = !this.profile.challenge && !this.profile.practice;
    text('restore-offer-text', this.profile.practice ? '有尚未完成的课程或复习，可继续学习。' : '新版挑战进度已保存，恢复后手动继续。');
    text('btn-sound', this.profile.soundOn ? '音效 开' : '音效 关');
    $('btn-sound').setAttribute('aria-pressed', String(this.profile.soundOn));
    if (this.screen === 'select') this.renderRecords();
    if (this.screen === 'availability') {
      const report = describeAvailability(this.select, this.profile.grades, { preview: this.preview });
      text('availability-status', report.statusText ?? '动态出题 · 每局 10 题 · 每题 10 秒 · 最多复活 2 次');
      ($('btn-start') as HTMLButtonElement).disabled = !report.startable;
      text('availability-inventory', `加时卡 ${this.profile.cards.time} · 提醒卡 ${this.profile.cards.hint} · 复活卡 ${this.profile.cards.revive}。开始前可去商店准备道具。`);
    }
    if (this.screen === 'game') this.renderGame();
    if (this.screen === 'result') this.renderResult();
    if (this.screen === 'shop') this.renderShop();
    if (this.screen === 'courses') this.renderCourses();
    if (this.screen === 'review') this.renderReview();
    if (this.screen === 'profile') this.renderProfile();
    this.syncDialog();
  }
  private renderRecords(): void {
    const list = $('records-list'); list.replaceChildren();
    for (const r of [...this.profile.records].reverse().slice(0, 10)) {
      const item = document.createElement('li'); item.textContent = `${r.passed ? '通关' : '挑战结束'} · ${r.score} 分 · 首次答对 ${r.firstTryCount}/${r.total} · +${r.coins} 金币`; list.append(item);
    }
    for (const r of [...this.profile.legacyRecords].reverse().slice(0, Math.max(0, 10 - list.children.length))) {
      const item = document.createElement('li'); item.textContent = `历史成绩 · ${r.score} 分 · 首次答对 ${r.firstTryCount}/${r.questions.length}（不补发金币）`; list.append(item);
    }
    $('records-empty').hidden = list.children.length > 0;
  }
  private async startRound(): Promise<void> {
    if ((this.profile.challenge || this.profile.practice) && !await this.confirm('开始新挑战将放弃当前局未结算金币或当前小练习进度，已消耗道具不退回。')) return;
    const rng = createRuntimeRng(); const candidates = this.select(this.profile.grades);
    const selected = this.preview ? candidates : selectRoundExercises(candidates, this.content.gradeOf, rng, this.profile.recentIds);
    const state = createRound({ exercises: selected, gradeOf: this.content.gradeOf, rng });
    await this.change(p => {
      p.practice = null;
      p.challenge = { id: crypto.randomUUID(), grades: [...p.grades], state, rngState: rng.snapshotState(), contentVersion: CHALLENGE_CONTENT_VERSION,
        paused: false, remainingMs: QUESTION_MS, deadline: Date.now() + QUESTION_MS, timerKind: 'question' };
      p.recentIds = state.questions.map(q => q.exerciseId);
    });
    this.practiceBoard = null; this.showScreen('game');
  }
  private currentExercise(c: SavedChallenge): Exercise {
    const question = c.state.questions[c.state.questionIndex]!;
    const exercise = this.select(c.grades).find(e => e.id === question.exerciseId);
    if (!exercise || taskIdentity(exercise.task) !== taskIdentity(question.task)) throw new Error('题目已不在当前内容范围，无法继续');
    return exercise;
  }
  private recordInterruption(p: Profile, c: SavedChallenge, reason: 'wrong' | 'timeout', exercise: Exercise): void {
    if (!this.preview) collectMistake(p, exercise, this.content.gradeOf(exercise), reason);
    c.timerKind = null; c.deadline = null; c.remainingMs = 0;
    if (c.state.phase === 'finished') this.settle(p);
  }
  private settle(p: Profile): void {
    const c = p.challenge!;
    if (this.store && !this.preview) {
      settleChallenge(p, c, new Date().toISOString()); this.lastResult = p.records.at(-1) ?? null;
    } else {
      const s = c.state;
      this.lastResult = { id: c.id, at: new Date().toISOString(), score: s.score, firstTryCount: s.firstTryCount,
        totalWrongCount: s.totalWrongCount, totalTimeoutCount: s.totalTimeoutCount, revivals: s.revivals,
        completed: s.questionIndex, total: s.questions.length, passed: s.result === 'passed', coins: 0 };
      p.challenge = null;
    }
  }
  private async answer(index: number): Promise<void> {
    if (this.profile.practice) { await this.answerPractice(index); return; }
    const c = this.profile.challenge;
    if (!c || c.paused || c.state.phase !== 'asking') return;
    let correct = false;
    let animation: typeof this.animation = null;
    await this.change(p => {
      const active = p.challenge!; this.capture(active);
      const exercise = this.currentExercise(active);
      if (active.remainingMs <= 0) {
        active.state = timeoutRound(active.state); this.recordInterruption(p, active, 'timeout', exercise); return;
      }
      const rng = restoreSeededRng(active.rngState);
      const before = active.state;
      const step = clickTile(active.state, index, rng); active.state = step.state; active.rngState = rng.snapshotState();
      if (step.outcome.type === 'wrong') this.recordInterruption(p, active, 'wrong', exercise);
      if (step.outcome.type === 'correct') {
        animation = { before, outcome: step.outcome, drawn: false };
        correct = true; this.activate(active, 'resolve', step.outcome.fill ? ELIMINATE_MS + FILL_MS : ELIMINATE_MS);
      }
    });
    this.animation = animation;
    this.audio.play(correct ? 'correct' : 'wrong');
    if (!this.profile.challenge) this.showScreen('result');
  }
  private tick(): void {
    const c = this.profile.challenge;
    if (this.screen === 'game' && c) this.renderCountdown();
    if (!c || c.paused || !c.timerKind || c.deadline === null || c.deadline > Date.now() || this.busy) return;
    this.run(async () => {
      await this.change(p => {
        const active = p.challenge!; this.capture(active);
        if (active.remainingMs > 0) return;
        if (active.timerKind === 'resolve') {
          this.animation = null;
          active.state = completeResolve(active.state);
          if (active.state.phase === 'finished') this.settle(p);
          else this.activate(active, active.state.phase === 'asking' ? 'question' : null, QUESTION_MS);
        } else {
          const exercise = this.currentExercise(active); active.state = timeoutRound(active.state);
          this.recordInterruption(p, active, 'timeout', exercise);
        }
      });
      if (!this.profile.challenge) this.showScreen('result');
    });
  }
  private async pause(): Promise<void> {
    if (!this.profile.challenge || this.profile.challenge.paused) return;
    await this.change(p => { const c = p.challenge!; this.session.pause(c); });
  }
  private async togglePause(): Promise<void> {
    if (!this.profile.challenge) return;
    if (!this.profile.challenge.paused) { await this.pause(); return; }
    await this.change(p => { const c = p.challenge!; this.session.resume(c); });
  }
  private async useCard(card: 'hint' | 'time'): Promise<void> {
    await this.change(p => {
      const c = p.challenge!; if (!c || c.paused) throw new Error('当前不能使用道具');
      this.capture(c);
      if (c.state.phase === 'asking' && c.remainingMs <= 0) throw new Error('时间已到，不能使用道具');
      c.state = card === 'hint' ? useHint(c.state) : useExtraTime(c.state);
      consume(p, card);
      if (card === 'time') this.activate(c, 'question', c.remainingMs + EXTRA_TIME_MS);
    }, true);
  }
  private async revive(): Promise<void> {
    await this.change(p => {
      const c = p.challenge!; const next = reviveRound(c.state);
      if (p.cards.revive === 0) buy(p, 'revive');
      consume(p, 'revive'); c.state = next; c.paused = false; this.activate(c, null, QUESTION_MS);
    }, true);
  }
  private async abandon(restart: boolean): Promise<void> {
    if (!await this.confirm(this.profile.challenge ? '放弃本局未结算金币？已消耗的道具不会退回。' : '退出当前小练习？课程阅读进度和已发放奖励保留。')) return;
    await this.change(p => { p.challenge = null; p.practice = null; }); this.practiceBoard = null;
    if (restart) await this.startRound(); else this.showScreen('select');
  }
  private renderCountdown(): void {
    const c = this.profile.challenge!;
    const remaining = this.session.remaining(c);
    text('countdown', c.state.phase === 'asking' ? `剩余 ${(remaining / 1000).toFixed(1)} 秒` : c.state.phase === 'ready' ? '准备继续 · 暂未计时' : '已停止计时');
  }
  private renderGame(): void {
    const practice = this.profile.practice; const c = this.profile.challenge;
    if (!practice && !c) { this.showScreen('select'); return; }
    this.renderer.setSkin(this.profile.skin);
    $('challenge-tools').hidden = !!practice;
    $('practice-tools').hidden = !practice;
    ($('btn-pause') as HTMLButtonElement).disabled = !!practice;
    ($('btn-restart') as HTMLButtonElement).hidden = !!practice;
    let state: RoundState;
    if (practice) {
      if (!this.practiceBoard) {
        const exercise = practice.exercises[Math.min(practice.index, practice.exercises.length - 1)]!;
        this.practiceBoard = createRound({ exercises: [exercise], gradeOf: this.content.gradeOf, rng: createRuntimeRng() });
      }
      state = this.practiceBoard;
      text('countdown', `不限时 · 第 ${Math.min(practice.index + 1, practice.exercises.length)}/${practice.exercises.length} 题`);
      const exercise = practice.exercises[Math.min(practice.index, practice.exercises.length - 1)]!;
      text('practice-feedback', practice.revealed || practice.answered ? explainTask(exercise.task) : '先独立作答，也可以免费查看讲解。');
      ($('btn-practice-explain') as HTMLButtonElement).disabled = practice.revealed || practice.answered;
      $('btn-practice-next').hidden = !practice.answered && !practice.revealed;
      text('btn-practice-next', practice.reviewId ? '再练一次' : '下一题');
      $('btn-mastered').hidden = !practice.reviewId || practice.correct !== 1;
      text('game-mode', practice.courseId ? '课程小练习 · 全部独立答对可完成课程' : '错题复习 · 免费不限时');
    } else {
      state = c!.state;
      this.renderCountdown(); text('game-mode', `已复活 ${state.revivals}/2 · 答错 ${state.totalWrongCount} · 超时 ${state.totalTimeoutCount}`);
      text('btn-hint', `提醒卡 ${this.profile.cards.hint}`);
      text('btn-time', `加时 +5秒 ${this.profile.cards.time}`);
      const canSpend = !!this.store && !this.preview && !c!.paused;
      ($('btn-hint') as HTMLButtonElement).disabled = !canSpend || state.totalWrongCount < 2 || state.hintUsed || !this.profile.cards.hint || !['ready', 'asking'].includes(state.phase);
      ($('btn-time') as HTMLButtonElement).disabled = !canSpend || state.timeUsed || !this.profile.cards.time || state.phase !== 'asking';
      text('hint-condition', state.totalWrongCount < 2 ? `整局再答错 ${2 - state.totalWrongCount} 次开放提醒卡；超时不计入。` : state.hintUsed ? '本题提醒已使用。' : '提醒卡已开放，每题限一张。');
    }
    if (state.phase === 'resolving' && this.animation) {
      if (!this.animation.drawn) {
        this.renderer.reset(this.animation.before); this.renderer.applyCorrect(this.animation.outcome); this.animation.drawn = true;
      }
    } else {
      this.renderer.reset(state.phase === 'resolving' ? { ...state, questionIndex: Math.max(0, state.questionIndex - 1) } : state);
    }
    if (c?.paused) this.renderer.pause(); else { this.renderer.resume(); this.renderer.start(); }
    this.fitBoard();
    const paused = !!c?.paused;
    const ready = c?.state.phase === 'ready';
    const visibleQuestion = state.questions[state.questionIndex];
    text('game-task', ready && !state.hintUsed || paused ? '题面已遮住，继续答题后显示。'
      : visibleQuestion ? `${taskText(visibleQuestion.task)} 使用方向键选择数字块，回车作答。` : '正在结算。');
    $('pause-overlay').hidden = !paused && (!ready || state.hintUsed);
    $('board-canvas').style.visibility = paused || ready && !state.hintUsed ? 'hidden' : 'visible';
    text('pause-title', paused ? 'Ⅱ 冒险休息站' : '准备好了吗？');
    text('pause-hint', ready && !paused ? '可先使用提醒卡，再继续答题。' : '剩余时间与道具使用情况已保留。');
    $('btn-resume').hidden = !paused;
    $('btn-ready').hidden = !ready || paused;
    text('btn-pause', paused ? '继续' : '暂停');
  }
  private syncDialog(): void {
    const dialog = $('revive-dialog') as HTMLDialogElement;
    const c = this.profile.challenge;
    if (this.screen !== 'game' || !c || c.state.phase !== 'interrupted') { if (dialog.open) dialog.close(); return; }
    text('revive-message', `${c.state.interruption === 'wrong' ? '这次选错了' : '时间到了'}。剩余复活次数 ${2 - c.state.revivals}，已有复活卡 ${this.profile.cards.revive}。`);
    text('btn-revive', this.profile.cards.revive ? '使用复活卡' : `购买并使用 · 15 金币（余额 ${this.profile.coins}，购买后 ${Math.max(0, this.profile.coins - 15)}）`);
    ($('btn-revive') as HTMLButtonElement).disabled = !this.store || this.preview || (!this.profile.cards.revive && this.profile.coins < 15);
    text('revive-reason', !this.store || this.preview ? '临时／预览模式不能消耗正式道具。' : !this.profile.cards.revive && this.profile.coins < 15 ? `还差 ${15 - this.profile.coins} 金币，可以结束挑战并免费学习。` : '复活后重答本题，本题不再获得答题金币。');
    if (!dialog.open) { dialog.showModal(); ($('btn-end') as HTMLButtonElement).focus(); }
  }
  private renderResult(): void {
    const r = this.lastResult ?? this.profile.records.at(-1);
    if (!r) return;
    text('result-title', r.passed ? `通关！${'★'.repeat(r.firstTryCount === 10 ? 3 : r.firstTryCount >= 8 ? 2 : 1)}` : '挑战结束，继续学习吧');
    text('result-score', `总分 ${r.score} · 已完成 ${r.completed}/${r.total}`);
    text('result-first-try', `首次答对 ${r.firstTryCount}/${r.total} · 辅助完成 ${r.completed - r.firstTryCount}`);
    text('result-wrong', `答错 ${r.totalWrongCount} 次 · 超时 ${r.totalTimeoutCount} 次 · 复活 ${r.revivals} 次`);
    text('result-coins', this.preview || !this.store ? '临时／预览结果不发放正式金币。' : `本局 +${r.coins} 金币：答题 ${r.firstTryCount * 2}，通关 ${r.passed ? 5 : 0}，全首次答对 ${r.passed && r.firstTryCount === r.total ? 5 : 0}。`);
  }
  private renderShop(): void {
    const list = $('shop-list'); list.replaceChildren();
    for (const product of PRODUCTS) {
      const card = document.createElement('article'); card.className = 'product-card';
      const title = document.createElement('h3'); title.textContent = product.name;
      const info = document.createElement('p');
      const owned = product.kind === 'avatar' ? this.profile.avatars.includes(product.id as Avatar) : product.kind === 'skin' ? this.profile.skins.includes(product.id as Skin) : false;
      const description = product.kind === 'card' ? `消耗品 · 库存 ${this.profile.cards[product.id as keyof Profile['cards']]}` : '永久解锁';
      info.textContent = `${description} · ${product.price} 金币${!owned && this.profile.coins < product.price ? ` · 还差 ${product.price - this.profile.coins}` : ''}`;
      if (product.kind === 'avatar') { const art = document.createElement('div'); art.className = 'avatar-art'; art.innerHTML = avatarArt(product.id as Avatar); card.append(art); }
      card.append(title, info);
      if (product.kind !== 'card') card.append(button('预览', () => this.previewItem(product)));
      card.append(button(owned ? '已拥有' : `购买 ${product.price} 金币`, () => this.run(async () => {
        if (!await this.confirm(`购买${product.name}？花费 ${product.price} 金币，购买后余额 ${this.profile.coins - product.price}。`)) return;
        await this.change(p => buy(p, product.id), true); this.notice(`已购买${product.name}${product.kind === 'card' ? '' : '，可点击装备'}。`);
      }), owned || !this.store || this.preview || this.profile.coins < product.price));
      if (product.kind !== 'card' && owned) card.append(button('装备', () => this.run(async () => {
        await this.change(p => { if (product.kind === 'avatar') p.avatar = product.id as Avatar; else p.skin = product.id as Skin; }, true);
      })));
      list.append(card);
    }
    $('default-equipment').replaceChildren(button('使用默认头像', () => this.run(async () => { await this.change(p => { p.avatar = 'lanlan'; }, true); })), button('使用默认皮肤', () => this.run(async () => { await this.change(p => { p.skin = 'garden'; }, true); })));
  }
  private previewItem(product: Product): void {
    text('preview-title', `${product.name} · ${product.price} 金币`);
    const body = $('preview-body'); body.replaceChildren();
    if (product.kind === 'avatar') { body.className = 'avatar-art large'; body.innerHTML = avatarArt(product.id as Avatar); }
    else {
      body.className = 'skin-preview';
      const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 620; body.append(canvas);
      const renderer = new NumberPuzzleRenderer(canvas, { onTileClick: () => {} });
      const exercise = this.content.select([1]).find(e => e.task.kind === 'number' && e.task.value === 3)!;
      renderer.reset(createRound({ exercises: [exercise], gradeOf: this.content.gradeOf, rng: createRuntimeRng() }));
      renderer.setSkin(product.id as Skin); renderer.start();
      ($('preview-dialog') as HTMLDialogElement).addEventListener('close', () => renderer.stop(), { once: true });
    }
    ($('preview-dialog') as HTMLDialogElement).showModal();
  }
  private renderProfile(): void {
    ($('nickname') as HTMLInputElement).value = this.profile.nickname;
    text('rename-info', this.profile.nickname ? `改名卡库存 ${this.profile.cards.rename}，成功改名消耗一张。` : '首次设置昵称免费，1～8 个字符。');
    text('collection-summary', `已拥有 ${this.profile.avatars.length}/4 个头像、${this.profile.skins.length}/3 款皮肤。`);
    const next = PRODUCTS.find(p => p.kind === 'avatar' && !this.profile.avatars.includes(p.id as Avatar) || p.kind === 'skin' && !this.profile.skins.includes(p.id as Skin));
    text('collection-target', next ? `下一个收藏目标：${next.name}，${next.price} 金币，还差 ${Math.max(0, next.price - this.profile.coins)}。` : '所有首版装扮都已收集！');
  }
  private renderCourses(): void {
    const list = $('courses-list'); list.replaceChildren();
    const course = COURSES.find(c => c.id === this.courseId);
    if (!course) {
      for (const item of COURSES.filter(c => this.profile.grades.includes(c.grade))) {
        const card = document.createElement('article'); card.className = 'product-card';
        const progress = this.profile.courses[item.id];
        const title = document.createElement('h3'); title.textContent = `${item.title} · ${GRADE_NAMES[item.grade]}`;
        const info = document.createElement('p'); info.textContent = progress?.rewarded ? '已完成 · 可免费再学，不重复领奖' : progress ? '学习中 · 首次完成 +10 金币' : '未学习 · 首次完成 +10 金币';
        card.append(title, info, button('进入学习', () => this.run(async () => {
          await this.change(p => { p.courses[item.id] ??= { stage: 'reading', rewarded: false }; });
          this.courseId = item.id;
        }))); list.append(card);
      }
      if (!list.children.length) list.textContent = '请在首页选择有课程的年级。当前课程覆盖一年级、二年级。';
      return;
    }
    const stage = this.profile.courses[course.id]?.stage ?? 'reading';
    const title = document.createElement('h3'); title.textContent = course.title;
    const paragraph = document.createElement('p'); paragraph.textContent = course.explanation;
    list.append(title, paragraph);
    list.append(button('阅读完成，查看示例', () => this.run(async () => {
      await this.change(p => { p.courses[course.id] = { stage: 'example', rewarded: p.courses[course.id]?.rewarded ?? false }; });
    })));
    if (stage !== 'reading') {
      const example = document.createElement('p'); example.className = 'example'; example.textContent = `${taskText(course.example)}\n${explainTask(course.example)}`; list.append(example);
      list.append(button('示例已理解，开始三题小练习', () => this.run(async () => {
        if (!await this.canStartPractice()) return;
        const exercises = selectCourseExercises(course, this.content.select([course.grade]), createRuntimeRng());
        await this.change(p => { p.courses[course.id] = { stage: 'practice', rewarded: p.courses[course.id]?.rewarded ?? false };
          p.challenge = null; p.practice = { courseId: course.id, reviewId: null, exercises, index: 0, correct: 0, revealed: false, answered: false, passed: true }; });
        this.practiceBoard = null; this.showScreen('game');
      })));
    }
    list.append(button('返回课程列表', () => { this.courseId = null; this.renderCourses(); }));
  }
  private async canStartPractice(): Promise<boolean> {
    return !this.profile.challenge && !this.profile.practice || await this.confirm('开始练习会放弃当前挑战收益或当前小练习进度，是否继续？');
  }
  private approvedOriginal(exercise: Exercise, grade: Grade): Exercise | undefined {
    const id = taskIdentity(exercise.task);
    return this.content.select([grade]).find(e => taskIdentity(e.task) === id);
  }
  private renderReview(): void {
    const list = $('review-list'); list.replaceChildren();
    for (const [id, entry] of Object.entries(this.profile.mistakes)) {
      if (!this.profile.grades.includes(entry.grade)) continue;
      if (this.reviewFilter === 'mastered' ? !entry.mastered : entry.mastered || (this.reviewFilter === 'timeout' ? entry.wrongs > 0 : entry.wrongs === 0)) continue;
      const approved = this.approvedOriginal(entry.exercise, entry.grade);
      const card = document.createElement('article'); card.className = 'product-card';
      const title = document.createElement('h3'); title.textContent = taskText(entry.exercise.task);
      const info = document.createElement('p'); info.textContent = `${entry.wrongs ? '错题' : '待练习'} · 答错 ${entry.wrongs} · 超时 ${entry.timeouts} · ${entry.rewarded ? '本题奖励已领取' : entry.wrongs ? '首次独立复习答对 +2 金币' : '超时练习不发金币'}`;
      card.append(title, info);
      const explanation = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = '免费查看原题讲解';
      const paragraph = document.createElement('p'); paragraph.textContent = explainTask(entry.exercise.task);
      explanation.append(summary, paragraph); card.append(explanation);
      if (entry.mastered) card.append(button('撤销已学会', () => this.run(async () => { await this.change(p => { p.mistakes[id]!.mastered = false; }); })));
      card.append(button(approved ? '开始复习' : '历史题暂不在审核范围', () => this.run(async () => {
        if (!approved || !await this.canStartPractice()) return;
        await this.change(p => { p.challenge = null; p.practice = { courseId: null, reviewId: id, exercises: [approved], index: 0, correct: 0, revealed: false, answered: false, passed: true }; });
        this.practiceBoard = null; this.showScreen('game');
      }), !approved));
      list.append(card);
    }
    if (!list.children.length) list.textContent = '当前所选年级下没有符合条件的记录。';
  }
  private async answerPractice(index: number): Promise<void> {
    const practice = this.profile.practice!; const board = this.practiceBoard;
    if (!board || practice.answered) return;
    const value = board.board[index]; if (value === undefined || value === null) return;
    const exercise = practice.exercises[practice.index]!;
    if (!this.approvedOriginal(exercise, this.content.gradeOf(exercise))) throw new Error('原题已不在当前审核范围，暂不可练习');
    const correct = evaluateAnswer(exercise.task, value);
    let reward = 0;
    await this.change(p => {
      const active = p.practice!;
      active.answered = true;
      if (correct) active.correct++;
      else {
        active.passed = false;
        if (!this.preview) collectMistake(p, exercise, this.content.gradeOf(exercise), 'wrong');
      }
      if (correct && active.reviewId && this.store && !this.preview) {
        reward = rewardReview(p, active.reviewId, !active.revealed);
      }
    });
    this.notice(correct ? reward ? '独立复习答对，+2 金币。' : '答对了！本题没有新增金币奖励。' : '再看一遍讲解，下次再试。');
    this.audio.play(correct ? 'correct' : 'wrong');
  }
  private async nextPractice(): Promise<void> {
    const practice = this.profile.practice!;
    if (practice.reviewId) {
      await this.change(p => { p.practice!.answered = false; p.practice!.revealed = false; p.practice!.correct = 0; p.practice!.passed = true; });
      this.practiceBoard = null; return;
    }
    let message = '';
    await this.change(p => {
      const active = p.practice!; active.index++;
      if (active.index === active.exercises.length) {
        if (active.passed && active.correct === 3) {
          const reward = this.store && !this.preview ? rewardCourse(p, active.courseId!) : 0;
          message = reward ? '课程完成，首次学习 +10 金币！' : this.store ? '复习完成，本课程奖励已领取。' : '临时学习完成，无法持久保存或领取金币。';
        } else message = '本轮尚未全部独立答对。可重新开始三题小练习，学习始终免费。';
        p.practice = null;
      } else { active.answered = false; active.revealed = false; }
    });
    if (message) this.notice(message);
    this.practiceBoard = null;
    if (!this.profile.practice) this.showScreen('courses');
  }
  private fitBoard(): void {
    if (this.screen !== 'game') return;
    this.renderer.fitDisplay($('board-wrap').clientWidth - 20, Math.max(434, window.innerHeight - 260));
  }
  private swSupported(): boolean {
    return 'serviceWorker' in navigator && window.isSecureContext;
  }

  private swControlled(): boolean {
    return this.swSupported() && navigator.serviceWorker.controller !== null;
  }

  private isRoundInProgress(): boolean {
    return this.profile.challenge !== null || this.profile.practice !== null || this.busy;
  }

  private updateScreen(): UpdateScreen {
    return this.screen === 'select' ? 'select' : 'other';
  }

  /** 注册 Service Worker 并跟踪缓存状态；不支持或注册失败时如实提示，不影响游玩。 */
  private wireOfflineStatus(): void {
    this.offlinePhase = this.swSupported()
      ? (this.swControlled() ? 'ready' : 'preparing')
      : 'unsupported';
    window.addEventListener('online', () => this.renderOfflineNotice());
    window.addEventListener('offline', () => this.renderOfflineNotice());
    this.renderOfflineNotice();
    if (!this.swSupported()) return;
    navigator.serviceWorker.addEventListener('message', event => this.onSwMessage(event));
    navigator.serviceWorker.addEventListener('controllerchange', () => this.onControllerChange());
    navigator.serviceWorker.register('/sw.js').then(registration => {
      this.swRegistration = registration;
      this.syncRegistrationState(registration);
      registration.addEventListener('updatefound', () => this.onUpdateFound(registration));
    }).catch(() => {
      // 注册失败（如首次安装阶段断网）：未完成缓存，不承诺离线可玩。
      this.offlinePhase = this.swControlled() ? this.offlinePhase : 'failed';
      this.renderOfflineNotice();
    });
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'query-version' });
    }
  }

  /** 依据注册对象同步安装/等待状态：首次安装失败→failed；出现等待版本→评估采用时机。 */
  private syncRegistrationState(registration: ServiceWorkerRegistration): void {
    const installing = registration.installing;
    if (installing && !this.swControlled()) {
      installing.addEventListener('statechange', () => {
        if (installing.state === 'redundant' && !this.swControlled()) {
          this.offlinePhase = 'failed'; // 预缓存未完成，新 SW 未激活
          this.renderOfflineNotice();
        }
      });
    }
    if (registration.waiting) this.markUpdateWaiting();
    this.renderOfflineNotice();
  }

  /** updatefound：新版本安装中；installed（已有旧版本控制）→ 进入等待。 */
  private onUpdateFound(registration: ServiceWorkerRegistration): void {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && this.swControlled()) this.markUpdateWaiting();
      if (worker.state === 'redundant' && !this.swControlled()) {
        this.offlinePhase = 'failed'; // 首次安装失败
        this.renderOfflineNotice();
      }
    });
  }

  private markUpdateWaiting(): void {
    if (this.updateWaiting) return;
    this.updateWaiting = true;
    this.evaluateUpdateAdoption();
  }

  /** 决定等待中的新版本何时生效（offline.ts decideUpdateAdoption）；选择屏且非单局中途即采用。 */
  private evaluateUpdateAdoption(): void {
    if (!this.updateWaiting || this.awaitingAdoption) return;
    const decision = decideUpdateAdoption({
      updateWaiting: true,
      roundInProgress: this.isRoundInProgress(),
      screen: this.updateScreen(),
    });
    this.updateNoticeText = decision.notice;
    this.renderOfflineNotice();
    if (decision.action !== 'adopt') return;
    // waiting 语义不可依赖（可能被浏览器跳过而直通激活，见 offline.ts planAdoptionExecution）：
    // waiting 缺失时按 controller 是否已接管决定刷新或收敛，不发无对象的 skip-waiting。
    const plan = planAdoptionExecution({
      waitingWorkerPresent: this.swRegistration?.waiting != null,
      controllerChanged: this.controllerChangedSinceLoad(),
    });
    if (plan.action === 'send-skip-waiting') {
      this.awaitingAdoption = true;
      this.swRegistration!.waiting!.postMessage({ type: 'skip-waiting' });
    } else if (plan.action === 'reload') {
      window.location.reload();
    } else {
      this.updateWaiting = false;
      this.updateNoticeText = null;
      this.renderOfflineNotice();
    }
  }

  private controllerChangedSinceLoad(): boolean {
    const controller = this.swSupported() ? navigator.serviceWorker.controller : null;
    return controller !== null && controller !== this.initialController;
  }

  /** controllerchange：首次激活（claim）同样触发；仅页面主动请求切换后才刷新页面。 */
  private onControllerChange(): void {
    if (!this.awaitingAdoption) return;
    this.awaitingAdoption = false;
    if (this.isRoundInProgress()) return; // 双保险：任何情况下不打断单局
    this.updateWaiting = false;
    this.updateNoticeText = null;
    window.location.reload();
  }

  /** SW 广播 cache-ready（激活或对 query-version 的应答）：记录版本标记并提示就绪。 */
  private onSwMessage(event: MessageEvent): void {
    const data = event.data as { type?: unknown; version?: unknown } | null;
    if (!data || data.type !== 'cache-ready') return;
    this.offlinePhase = 'ready';
    this.offlineVersion = typeof data.version === 'string' ? data.version : null;
    this.renderOfflineNotice();
  }

  /** 离线状态提示行：文案与警示级别由 describeOfflineStatus 推导，更新提示优先。 */
  private renderOfflineNotice(): void {
    const status = describeOfflineStatus({
      phase: this.offlinePhase,
      offline: !navigator.onLine,
      controlled: this.swControlled(),
      version: this.offlineVersion,
      updateNotice: this.updateNoticeText,
    });
    const notice = $('offline-notice');
    notice.textContent = status.text;
    notice.classList.toggle('status-warning', status.warning);
    notice.hidden = false;
  }

}

async function boot(): Promise<void> {
  (window as unknown as Record<string, unknown>).__pixelAcademyBooted = true;
  document.body.inert = true;
  try {
    const app = new NumberPuzzleApp(loadGameContent(), new URLSearchParams(location.search).get('preview') === 'candidate');
    await app.initialize();
  } catch (error) {
    $('screen-error').hidden = false; text('error-message', `游戏无法启动：${error instanceof Error ? error.message : String(error)}`);
    (window as unknown as Record<string, unknown>).__pixelAcademyBooted = true;
  } finally { document.body.inert = false; }
}
void boot();
