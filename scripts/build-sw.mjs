// 生成离线 Service Worker（PLAN.md M6）：npm run build 在 tsc 之后执行本脚本，
// 由 web/sw.source.js 模板生成 web/sw.js（构建产物，不提交）。
// 零第三方依赖（node:crypto / node:fs）。职责：
// 1. 从 dist 入口模块出发解析静态 ESM import 闭包，得到预缓存清单
//    （入口页 / 与 /style.css 之外全部为 dist 内脚本——练习数据随构建进入
//    产物，缓存脚本即缓存了当前可用练习数据，运行时不发在线内容请求）；
// 2. 对清单内每个资源计算 SHA-256，连同模板哈希生成版本标记
//    assets-v1-<12 位十六进制>（格式见 src/game/number-puzzle/offline.ts）；
// 3. 替换模板占位符写出 web/sw.js。任一清单文件缺失即构建失败（快速失败，
//    避免生成必然安装失败的缓存清单）。
// 版本与清理决策的可测逻辑在 offline.ts，本脚本与生成的 sw.js 与其保持一致。
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 预缓存入口：两个页面的主模块（tsc 产物）。 */
export const SW_ENTRY_MODULES = ['dist/game/number-puzzle/main.js', 'dist/game/hanzi-hero/main.js'];
/** 静态页面资源（相对仓库根；'/' 即 web/index.html，'/hanzi.html' 即 web/hanzi.html）。 */
export const STATIC_PRECACHE_URLS = [
  '/', '/style.css', '/hanzi.html', '/hanzi.css',
  ...['tree', 'mountain', 'sun', 'moon', 'river', 'fire', 'mouth', 'ear', 'ming', 'xiu', 'kan']
    .map(name => `/img/hanzi-hero/${name}.svg`),
];
/** 静态 URL → 仓库内文件路径映射；dist 模块之外的 URL 必须在此登记。 */
const STATIC_FILE_FOR_URL = Object.freeze({
  '/': 'web/index.html',
  '/style.css': 'web/style.css',
  '/hanzi.html': 'web/hanzi.html',
  '/hanzi.css': 'web/hanzi.css',
  ...Object.fromEntries(['tree', 'mountain', 'sun', 'moon', 'river', 'fire', 'mouth', 'ear', 'ming', 'xiu', 'kan']
    .map(name => [`/img/hanzi-hero/${name}.svg`, `web/img/hanzi-hero/${name}.svg`])),
});
export const SW_TEMPLATE_PATH = 'web/sw.source.js';
export const SW_OUTPUT_PATH = 'web/sw.js';

/**
 * 提取编译后 ESM 中的静态相对导入说明符。先粗略剥离块注释与行注释，
 * 再匹配 `import ... from '...'` / `export ... from '...'` 与 `import '...'`。
 * 动态 import() 在本工程不存在（另有检查）；误报会在闭包解析时因文件缺失
 * 快速失败，漏报由 tests/offline.test.mjs 的关键模块清单断言兜底。
 */
export function extractRelativeImports(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const withoutLineComments = withoutBlockComments
    .split('\n')
    .map(line => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n');
  const specifiers = new Set();
  const patterns = [
    /(?:^|[\r\n;({\s])(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|[\r\n;({\s])import\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of withoutLineComments.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
}

/** 相对说明符 → dist 内相对路径（posix 分隔）。 */
export function resolveSpecifier(fromModule, specifier) {
  const joined = join(dirname(fromModule), specifier);
  return joined.split('\\').join('/').replace(/^\.\//, '');
}

/**
 * 从入口模块解析完整 import 闭包，返回排序后的 dist 相对路径列表。
 * 任一文件缺失（tsc 产物与清单不一致）直接抛错。
 */
export async function collectDistClosure(entryModule) {
  const seen = new Set();
  const queue = [entryModule];
  while (queue.length) {
    const modulePath = queue.pop();
    if (seen.has(modulePath)) continue;
    seen.add(modulePath);
    const source = await readFile(join(rootPath, modulePath), 'utf8');
    for (const specifier of extractRelativeImports(source)) {
      queue.push(resolveSpecifier(modulePath, specifier));
    }
  }
  return [...seen].sort();
}

/** dist 相对路径 → 预缓存 URL 清单（排序，保证清单与版本确定性）。 */
export function buildPrecacheUrls(distModules) {
  return [...STATIC_PRECACHE_URLS, ...distModules.map(module => `/${module}`)].sort();
}

/** URL → 仓库内文件路径（静态 URL 按映射，其余必须是 /dist/ 产物）。 */
export function fileForPrecacheUrl(url) {
  const mapped = Object.hasOwn(STATIC_FILE_FOR_URL, url) ? STATIC_FILE_FOR_URL[url] : null;
  if (mapped) return mapped;
  if (!url.startsWith('/dist/')) throw new Error(`Unexpected precache URL: ${url}`);
  return url.slice(1);
}

/**
 * 版本标记：对「URL + 内容 SHA-256」清单与额外材料（模板哈希）做整体 SHA-256，
 * 取 12 位十六进制；任一资源内容或清单组成变化都会改变版本。
 */
export function computeAssetVersion(entries, extras = []) {
  const hash = createHash('sha256');
  const lines = [...entries.map(entry => `${entry.url} ${entry.sha256}`), ...extras].sort();
  for (const line of lines) hash.update(line + '\n');
  return `assets-v1-${hash.digest('hex').slice(0, 12)}`;
}

/** 用版本与清单实例化模板；模板缺占位符或替换后有残留均抛错。 */
export function renderSwSource(template, version, urls) {
  if (!template.includes("'__APP_VERSION__'")) throw new Error('sw template version placeholder missing');
  if (!template.includes('__PRECACHE_URLS__')) throw new Error('sw template url placeholder missing');
  const withVersion = template.replaceAll("'__APP_VERSION__'", JSON.stringify(version));
  const withUrls = withVersion.replaceAll('__PRECACHE_URLS__', JSON.stringify(urls, null, 2));
  if (withUrls.includes('__APP_VERSION__') || withUrls.includes('__PRECACHE_URLS__')) {
    throw new Error('sw template placeholder not replaced');
  }
  return withUrls;
}

async function sha256File(file) {
  const buffer = await readFile(join(rootPath, file));
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const template = await readFile(join(rootPath, SW_TEMPLATE_PATH), 'utf8');
  const distModules = [...new Set((await Promise.all(SW_ENTRY_MODULES.map(entry => collectDistClosure(entry)))).flat())].sort();
  const urls = buildPrecacheUrls(distModules);
  const entries = [];
  for (const url of urls) {
    entries.push({ url, sha256: await sha256File(fileForPrecacheUrl(url)) });
  }
  const version = computeAssetVersion(entries, [`template ${createHash('sha256').update(template).digest('hex')}`]);
  const output = renderSwSource(template, version, urls);
  await writeFile(join(rootPath, SW_OUTPUT_PATH), output);
  console.log(`sw.js 已生成：版本 ${version}，预缓存 ${urls.length} 个资源（dist 模块 ${distModules.length} 个）。`);
}

// 直接执行时生成产物；被测试导入时只提供函数（tests/offline.test.mjs）。
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
