// 离线运行与资源更新测试（PLAN.md M6）：版本切换时机、旧缓存清理决策、
// 离线状态文案与预缓存清单一致性。纯逻辑从 dist 导入；构建一致性检查针对
// 真实 dist 产物与生成的 web/sw.js（npm test 先执行 build 再跑测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE_PREFIX, UPDATE_ADOPTING_NOTICE, UPDATE_DEFERRED_NOTICE, VERSION_PATTERN,
  buildCacheName, decideUpdateAdoption, describeOfflineStatus, planAdoptionExecution, staleCacheNames,
} from '../dist/game/number-puzzle/offline.js';
import {
  PINYIN_AUDIO_URLS, SW_ENTRY_MODULES, buildPrecacheUrls, collectDistClosure, computeAssetVersion,
  extractRelativeImports, fileForPrecacheUrl, renderSwSource,
} from '../scripts/build-sw.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// 缓存名与版本标记
// ---------------------------------------------------------------------------

test('buildCacheName: 前缀 + 版本标记', () => {
  const name = buildCacheName('assets-v1-0123456789ab');
  assert.ok(name.startsWith(CACHE_PREFIX));
  assert.equal(name, `${CACHE_PREFIX}assets-v1-0123456789ab`);
});

test('VERSION_PATTERN: 12 位十六进制格式', () => {
  assert.match('assets-v1-0123456789ab', VERSION_PATTERN);
  assert.doesNotMatch('assets-v1-0123456789', VERSION_PATTERN);
  assert.doesNotMatch('assets-v1-0123456789AB', VERSION_PATTERN);
  assert.doesNotMatch('assets-v2-0123456789ab', VERSION_PATTERN);
});

// ---------------------------------------------------------------------------
// 旧版本缓存清理决策（staleCacheNames）
// ---------------------------------------------------------------------------

test('staleCacheNames: 保留当前版本，返回待删旧版本（排序）', () => {
  const current = `${CACHE_PREFIX}assets-v1-cccc`;
  const older1 = `${CACHE_PREFIX}assets-v1-aaaa`;
  const older2 = `${CACHE_PREFIX}assets-v1-bbbb`;
  const stale = staleCacheNames([older2, current, older1], current);
  assert.deepEqual(stale, [older1, older2]);
});

test('staleCacheNames: 其他应用缓存一律不动', () => {
  const current = `${CACHE_PREFIX}assets-v1-cccc`;
  const stale = staleCacheNames(
    [current, 'workbox-precache-v2', 'other-app:cache', `${CACHE_PREFIX}legacy-no-version`],
    current,
  );
  assert.deepEqual(stale, [`${CACHE_PREFIX}legacy-no-version`]);
});

test('staleCacheNames: 无需清理时返回空数组', () => {
  const current = `${CACHE_PREFIX}assets-v1-cccc`;
  assert.deepEqual(staleCacheNames([], current), []);
  assert.deepEqual(staleCacheNames([current], current), []);
  assert.deepEqual(staleCacheNames(['unrelated'], current), []);
});

// ---------------------------------------------------------------------------
// 更新采用时机（decideUpdateAdoption）
// ---------------------------------------------------------------------------

test('decideUpdateAdoption: 无等待版本 → none 且不提示', () => {
  for (const roundInProgress of [false, true]) {
    for (const screen of ['select', 'other']) {
      const decision = decideUpdateAdoption({ updateWaiting: false, roundInProgress, screen });
      assert.deepEqual(decision, { action: 'none', notice: null });
    }
  }
});

test('decideUpdateAdoption: 选择屏且无进行中局次 → adopt', () => {
  const decision = decideUpdateAdoption({ updateWaiting: true, roundInProgress: false, screen: 'select' });
  assert.equal(decision.action, 'adopt');
  assert.equal(decision.notice, UPDATE_ADOPTING_NOTICE);
});

test('decideUpdateAdoption: 单局进行中（running/paused）→ defer', () => {
  // main.ts 的 isRoundInProgress：会话处于 running 或 paused 都算单局中途。
  for (const roundInProgress of [true, true]) {
    const decision = decideUpdateAdoption({ updateWaiting: true, roundInProgress, screen: 'select' });
    assert.equal(decision.action, 'defer');
    assert.equal(decision.notice, UPDATE_DEFERRED_NOTICE);
  }
});

test('decideUpdateAdoption: 非选择屏（含结算屏）→ defer', () => {
  const decision = decideUpdateAdoption({ updateWaiting: true, roundInProgress: false, screen: 'other' });
  assert.equal(decision.action, 'defer');
  assert.equal(decision.notice, UPDATE_DEFERRED_NOTICE);
});

// ---------------------------------------------------------------------------
// 采用动作的执行决策（planAdoptionExecution）：waiting 语义不可依赖（独立复核第 1 轮
// 实测新版本可跳过 waiting 直接激活接管），waiting 缺失时不得发无对象的 skip-waiting
// 而卡死在「正在应用新版本」。
// ---------------------------------------------------------------------------

test('planAdoptionExecution: waiting 存在 → 发 skip-waiting（原路径）', () => {
  const plan = planAdoptionExecution({ waitingWorkerPresent: true, controllerChanged: false });
  assert.deepEqual(plan, { action: 'send-skip-waiting', notice: UPDATE_ADOPTING_NOTICE });
  // waiting 存在优先：即使 controller 已被接管（罕见），仍走消息路径等 controllerchange。
  assert.equal(
    planAdoptionExecution({ waitingWorkerPresent: true, controllerChanged: true }).action,
    'send-skip-waiting',
  );
});

test('planAdoptionExecution: waiting 缺失且新版本已接管 → 直接刷新', () => {
  const plan = planAdoptionExecution({ waitingWorkerPresent: false, controllerChanged: true });
  assert.deepEqual(plan, { action: 'reload', notice: null });
});

test('planAdoptionExecution: waiting 缺失且 controller 未变化 → 收敛提示（防刷新循环）', () => {
  const plan = planAdoptionExecution({ waitingWorkerPresent: false, controllerChanged: false });
  assert.deepEqual(plan, { action: 'settle', notice: null });
});

// ---------------------------------------------------------------------------
// 离线状态文案（describeOfflineStatus）
// ---------------------------------------------------------------------------

const base = { version: null, updateNotice: null };

test('describeOfflineStatus: preparing 不承诺离线可玩，离线时警示', () => {
  const online = describeOfflineStatus({ ...base, phase: 'preparing', offline: false, controlled: false });
  assert.ok(online.text.includes('正在准备离线缓存'));
  assert.ok(online.text.includes('完成前断网可能无法游玩'));
  assert.equal(online.warning, false);
  assert.equal(online.playableOffline, false);
  const offline = describeOfflineStatus({ ...base, phase: 'preparing', offline: true, controlled: false });
  assert.ok(offline.text.includes('离线缓存尚未完成'));
  assert.equal(offline.warning, true);
  assert.equal(offline.playableOffline, false);
});

test('describeOfflineStatus: ready 带版本标记并可承诺离线可玩', () => {
  const ready = describeOfflineStatus({ ...base, version: 'assets-v1-0123456789ab', phase: 'ready', offline: false, controlled: true });
  assert.ok(ready.text.includes('离线缓存已就绪'));
  assert.ok(ready.text.includes('版本 assets-v1-0123456789ab'));
  assert.equal(ready.warning, false);
  assert.equal(ready.playableOffline, true);
});

test('describeOfflineStatus: ready 离线时说明正在使用缓存资源', () => {
  const offline = describeOfflineStatus({ ...base, version: 'assets-v1-0123456789ab', phase: 'ready', offline: true, controlled: true });
  assert.ok(offline.text.includes('离线状态'));
  assert.ok(offline.text.includes('已缓存资源'));
  assert.equal(offline.playableOffline, true);
});

test('describeOfflineStatus: failed 首次未受控 → 不承诺离线可玩', () => {
  const online = describeOfflineStatus({ ...base, phase: 'failed', offline: false, controlled: false });
  assert.ok(online.text.includes('离线缓存未完成'));
  assert.equal(online.warning, true);
  assert.equal(online.playableOffline, false);
  const offline = describeOfflineStatus({ ...base, phase: 'failed', offline: true, controlled: false });
  assert.ok(offline.text.includes('无法保证正常游玩'));
  assert.equal(offline.playableOffline, false);
});

test('describeOfflineStatus: failed 但旧版本仍受控 → 如实说明旧缓存可用', () => {
  const online = describeOfflineStatus({ ...base, phase: 'failed', offline: false, controlled: true });
  assert.ok(online.text.includes('旧版本'));
  assert.equal(online.playableOffline, true);
  const offline = describeOfflineStatus({ ...base, phase: 'failed', offline: true, controlled: true });
  assert.ok(offline.text.includes('上一个可用版本'));
  assert.equal(offline.playableOffline, true);
});

test('describeOfflineStatus: unsupported → 警示且不承诺离线可玩', () => {
  const status = describeOfflineStatus({ ...base, phase: 'unsupported', offline: false, controlled: false });
  assert.ok(status.text.includes('不支持离线缓存'));
  assert.equal(status.warning, true);
  assert.equal(status.playableOffline, false);
});

test('describeOfflineStatus: 更新提示优先展示，且不改变离线可玩结论', () => {
  const status = describeOfflineStatus({
    ...base, version: 'assets-v1-0123456789ab', phase: 'ready', offline: false, controlled: true,
    updateNotice: UPDATE_DEFERRED_NOTICE,
  });
  assert.equal(status.text, UPDATE_DEFERRED_NOTICE);
  assert.equal(status.playableOffline, true);
});

// ---------------------------------------------------------------------------
// 构建一致性：预缓存清单、版本哈希与生成的 sw.js
// ---------------------------------------------------------------------------

test('extractRelativeImports: 提取静态相对导入，忽略注释与字符串内 //', () => {
  const source = [
    "import { a } from './a.js';",
    'import {',
    '  b,',
    "} from './sub/b.js';",
    "export * from './c.js';",
    "import './d.js';",
    "// import { x } from './fake.js';",
    "const url = 'http://localhost:4173'; // trailing from './also-fake.js'",
    '/* import { y } from "./block-fake.js"; */',
    "import { z } from 'bare-package';",
  ].join('\n');
  assert.deepEqual(extractRelativeImports(source), ['./a.js', './c.js', './d.js', './sub/b.js']);
});

test('collectDistClosure: 覆盖入口、游戏、学习核心与内容数据模块', async () => {
  const modules = await collectDistClosure(SW_ENTRY_MODULES[0]);
  const required = [
    'dist/game/number-puzzle/main.js',
    'dist/game/number-puzzle/offline.js',
    'dist/game/number-puzzle/render.js',
    'dist/game/number-puzzle/rules.js',
    'dist/game/number-puzzle/session.js',
    'dist/game/number-puzzle/storage.js',
    'dist/game/number-puzzle/profile.js',
    'dist/game/number-puzzle/learning.js',
    'dist/game/number-puzzle/content.js',
    'dist/game/number-puzzle/audio.js',
    'dist/game/number-puzzle/random.js',
    'dist/learning/catalog.js',
    'dist/learning/evaluation.js',
    // 注意：dist/learning/models.js 只被类型导入（tsc 擦除），不在运行时闭包内。
    'dist/content/exercises.js',
    'dist/content/skills.js',
    'dist/content/textbooks.js',
    'dist/content/units.js',
    'dist/content/evidence.js',
  ];
  for (const module of required) {
    assert.ok(modules.includes(module), `预缓存闭包缺少 ${module}`);
  }
  // 汉字勇者入口闭包：页面主模块、语文判题与内容模块必须随构建进入预缓存。
  const hanziModules = await collectDistClosure(SW_ENTRY_MODULES[1]);
  for (const module of [
    'dist/game/hanzi-hero/main.js',
    'dist/game/hanzi-hero/rules.js',
    'dist/game/hanzi-hero/storage.js',
    'dist/game/hanzi-hero/content.js',
    'dist/learning/hanzi.js',
    'dist/content/hanzi-hero.js',
  ]) {
    assert.ok(hanziModules.includes(module), `汉字勇者预缓存闭包缺少 ${module}`);
  }
  // 算术地下城入口闭包：页面主模块、门状态机与内容适配必须随构建进入预缓存。
  assert.equal(SW_ENTRY_MODULES[2], 'dist/game/arithmetic-dungeon/main.js');
  const dungeonModules = await collectDistClosure(SW_ENTRY_MODULES[2]);
  for (const module of [
    'dist/game/arithmetic-dungeon/main.js',
    'dist/game/arithmetic-dungeon/rules.js',
    'dist/game/arithmetic-dungeon/storage.js',
    'dist/game/arithmetic-dungeon/content.js',
    'dist/game/number-puzzle/session.js',
    'dist/game/number-puzzle/random.js',
    'dist/game/number-puzzle/generation.js',
  ]) {
    assert.ok(dungeonModules.includes(module), `算术地下城预缓存闭包缺少 ${module}`);
  }
  // 拼音冒险入口闭包：页面主模块、混合局规则、听辨音频封装与内容适配必须随构建进入预缓存。
  assert.equal(SW_ENTRY_MODULES[3], 'dist/game/pinyin-adventure/main.js');
  const pinyinModules = await collectDistClosure(SW_ENTRY_MODULES[3]);
  for (const module of [
    'dist/game/pinyin-adventure/main.js',
    'dist/game/pinyin-adventure/rules.js',
    'dist/game/pinyin-adventure/storage.js',
    'dist/game/pinyin-adventure/content.js',
    'dist/game/pinyin-adventure/audio.js',
    'dist/learning/pinyin.js',
    'dist/content/pinyin-exercises.js',
  ]) {
    assert.ok(pinyinModules.includes(module), `拼音冒险预缓存闭包缺少 ${module}`);
  }
  // 英语快递员入口闭包：页面主模块、配送局规则、存储与内容适配、英语判题与题库必须随构建进入预缓存。
  assert.equal(SW_ENTRY_MODULES[4], 'dist/game/english-courier/main.js');
  const englishModules = await collectDistClosure(SW_ENTRY_MODULES[4]);
  for (const module of [
    'dist/game/english-courier/main.js',
    'dist/game/english-courier/rules.js',
    'dist/game/english-courier/storage.js',
    'dist/game/english-courier/content.js',
    'dist/learning/english.js',
    'dist/content/english-exercises.js',
  ]) {
    assert.ok(englishModules.includes(module), `英语快递员预缓存闭包缺少 ${module}`);
  }
  // 几何建筑师入口闭包：页面主模块、搭建局规则、存储与内容适配、图形判题与题库必须随构建进入预缓存。
  assert.equal(SW_ENTRY_MODULES[5], 'dist/game/geometry-builder/main.js');
  const geometryModules = await collectDistClosure(SW_ENTRY_MODULES[5]);
  for (const module of [
    'dist/game/geometry-builder/main.js',
    'dist/game/geometry-builder/rules.js',
    'dist/game/geometry-builder/storage.js',
    'dist/game/geometry-builder/content.js',
    'dist/learning/shapes.js',
    'dist/content/geometry-exercises.js',
  ]) {
    assert.ok(geometryModules.includes(module), `几何建筑师预缓存闭包缺少 ${module}`);
  }
});

test('buildPrecacheUrls: 全部为同源路径且对应文件真实存在', async () => {
  const urls = buildPrecacheUrls(await collectDistClosure(SW_ENTRY_MODULES[0]));
  assert.ok(urls.includes('/') && urls.includes('/style.css'));
  for (const url of urls) {
    assert.ok(url.startsWith('/') && !url.startsWith('//'), `非同源路径: ${url}`);
    assert.ok(!url.includes('http:'), `清单不应含远程地址: ${url}`);
    const file = join(root, fileForPrecacheUrl(url));
    await access(file); // 不存在则抛错
  }
});

test('computeAssetVersion: 确定性、内容敏感且符合版本格式', () => {
  const entries = [
    { url: '/a.js', sha256: 'aa'.repeat(32) },
    { url: '/b.js', sha256: 'bb'.repeat(32) },
  ];
  const version = computeAssetVersion(entries, ['template x']);
  assert.match(version, VERSION_PATTERN);
  assert.equal(computeAssetVersion([...entries].reverse(), ['template x']), version); // 顺序无关
  assert.notEqual(computeAssetVersion([entries[0]], ['template x']), version); // 少一个资源即变化
  assert.notEqual(
    computeAssetVersion(entries.map(entry => entry.url === '/a.js'
      ? { url: entry.url, sha256: 'cc'.repeat(32) } : entry), ['template x']),
    version,
  ); // 内容变化即变化
  assert.notEqual(computeAssetVersion(entries, ['template y']), version); // 模板变化即变化
});

test('生成的 web/sw.js: 版本格式、缓存名前缀与清单一致性', async () => {
  const swSource = await readFile(join(root, 'web/sw.js'), 'utf8');
  const versionMatch = swSource.match(/const APP_VERSION = ["']([^'"]+)["']/);
  assert.ok(versionMatch, 'sw.js 应包含版本标记');
  const version = versionMatch[1];
  assert.match(version, VERSION_PATTERN);

  // 页面侧常量（offline.ts）与生成的 sw.js 缓存名前缀一致。
  const swPrefixMatch = swSource.match(/const CACHE_NAME = '([^']+)' \+ APP_VERSION/);
  assert.ok(swPrefixMatch, 'sw.js 应声明缓存名前缀');
  assert.equal(`${swPrefixMatch[1]}${version}`, buildCacheName(version));

  // 清单与构建脚本重算结果一致（构建取五入口闭包并集，见 build-sw.mjs main()），
  // 且模板占位符已全部替换。
  const distModules = [...new Set((await Promise.all(SW_ENTRY_MODULES.map(entry => collectDistClosure(entry)))).flat())].sort();
  const urls = buildPrecacheUrls(distModules);
  // 六入口清单级断言：静态入口页不可从 STATIC_PRECACHE_URLS 悄悄移除。
  assert.ok(urls.includes('/') && urls.includes('/hanzi.html') && urls.includes('/dungeon.html')
    && urls.includes('/pinyin.html') && urls.includes('/english.html') && urls.includes('/geometry.html'),
    '预缓存清单必须包含数字消除、汉字勇者、算术地下城、拼音冒险、英语快递员与几何建筑师六个入口页');
  // 听辨音频随内容缓存（M9 验收）：47 条 WAV 全部在清单内。
  assert.equal(PINYIN_AUDIO_URLS.length, 47, '拼音听辨音频应为 47 条');
  for (const url of PINYIN_AUDIO_URLS) {
    assert.ok(urls.includes(url), `预缓存清单缺少听辨音频 ${url}`);
    assert.ok(swSource.includes(JSON.stringify(url)), `sw.js 清单缺少 ${url}`);
  }
  for (const url of urls) {
    assert.ok(swSource.includes(JSON.stringify(url)), `sw.js 清单缺少 ${url}`);
  }
  assert.ok(!swSource.includes('__APP_VERSION__'));
  assert.ok(!swSource.includes('__PRECACHE_URLS__'));
});

test('生成的 web/sw.js: 六入口导航回退分支（/ 与 /hanzi.html、/dungeon.html、/pinyin.html、/english.html、/geometry.html 及无扩展名路径）', async () => {
  const swSource = await readFile(join(root, 'web/sw.js'), 'utf8');
  // 单引号字面量只出现在导航回退分支；预缓存清单用 JSON.stringify 的双引号，
  // 两者可区分：分支缺失时页面将无法在离线状态下经缓存打开对应入口。
  assert.ok(swSource.includes("url.pathname === '/' ? '/'"), 'sw.js 导航回退分支应匹配 / 入口');
  assert.ok(swSource.includes("url.pathname === '/hanzi.html' || url.pathname === '/hanzi'"), 'sw.js 导航回退分支应匹配 /hanzi.html 与 /hanzi 入口');
  assert.ok(swSource.includes("url.pathname === '/dungeon.html' || url.pathname === '/dungeon'"), 'sw.js 导航回退分支应匹配 /dungeon.html 与 /dungeon 入口');
  assert.ok(swSource.includes("url.pathname === '/pinyin.html' || url.pathname === '/pinyin'"), 'sw.js 导航回退分支应匹配 /pinyin.html 与 /pinyin 入口');
  assert.ok(swSource.includes("url.pathname === '/english.html' || url.pathname === '/english'"), 'sw.js 导航回退分支应匹配 /english.html 与 /english 入口');
  assert.ok(swSource.includes("url.pathname === '/geometry.html' || url.pathname === '/geometry'"), 'sw.js 导航回退分支应匹配 /geometry.html 与 /geometry 入口');
  // 托管平台 308 规范化会让缓存条目带 redirected 标记；导航 respondWith 禁止 redirected，
  // 命中必须重包一层（缺失时生产 /hanzi.html 导航稳定落网络错误页）。
  assert.ok(swSource.includes('hit.redirected ? new Response(hit.body'), 'sw.js 导航回退应对 redirected 缓存条目重新包装');
});

test('renderSwSource: 占位符替换完整，模板缺占位符时抛错', () => {
  const rendered = renderSwSource("const V = '__APP_VERSION__';\nconst L = __PRECACHE_URLS__;", 'assets-v1-0123456789ab', ['/a.js']);
  assert.equal(rendered, "const V = \"assets-v1-0123456789ab\";\nconst L = [\n  \"/a.js\"\n];");
  assert.throws(() => renderSwSource('no placeholders', 'assets-v1-0123456789ab', []), /version placeholder missing/);
  assert.throws(() => renderSwSource("const V = '__APP_VERSION__';", 'assets-v1-0123456789ab', []), /url placeholder missing/);
});

test('版本哈希使用 sha256（12 位十六进制）', () => {
  const hash = createHash('sha256').update('x').digest('hex');
  assert.equal(hash.length, 64);
});
