// 站点部署暂存（Cloudflare Pages/Workers 构建用）：把 web/ 入口与 dist/ 模块
// 合并为单一输出目录 dist-site/，保持 /dist/* 路径与 sw.js 预缓存清单一致。
// 用法：npm run build:site（先执行 npm run build 生成 dist 与 web/sw.js）。
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}/dist-site`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(`${root}/web`, out, { recursive: true });
await cp(`${root}/dist`, `${out}/dist`, { recursive: true });
console.log('dist-site/ 已生成：web/ 入口 + dist/ 模块，供静态托管部署。');
