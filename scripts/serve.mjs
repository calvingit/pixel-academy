// 本地静态服务（Node 内置 http，无第三方依赖）：
// 提供 M3 数字消除原型页面。/ 与 /style.css 来自 web/，/dist/* 来自 tsc 产物。
// 用法：npm run serve [-- 端口号]，默认 4173。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 4173);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.wav', 'audio/wav'],
]);

function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\0/g, '');
  const relative = clean === '/' ? join('web', 'index.html')
    : clean.startsWith('/dist/') ? join('dist', clean.slice('/dist/'.length))
      : join('web', clean.slice(1));
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) return null; // 拒绝路径穿越
  return file;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const file = resolveFile(url.pathname);
    if (!file) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('forbidden');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': MIME_TYPES.get(extname(file)) ?? 'application/octet-stream',
      // WebKit 媒体栈要求 Content-Length 才肯加载 <audio> 源（对齐生产静态托管行为）。
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`pixel-academy 原型页面: http://127.0.0.1:${port}/`);
  console.log('候选内容预览入口（仅维护者使用）: http://127.0.0.1:%d/?preview=candidate', port);
});
