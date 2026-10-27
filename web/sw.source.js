// 数字消除离线 Service Worker（PLAN.md M6）。
// 本文件是模板：scripts/build-sw.mjs 在构建时把 '占位符' 替换为实际的
// 版本标记与预缓存清单后生成 web/sw.js（构建产物，不提交）。
//
// 版本与缓存策略（与 src/game/number-puzzle/offline.ts 保持一致）：
// - 缓存名 = 'pixel-academy:number-puzzle:' + 版本标记（构建时对全部预缓存
//   资源内容做 SHA-256 得出），入口、脚本、样式或随构建进入产物的练习数据
//   任何变化都会生成新版本号；
// - install 阶段把清单内资源全部写入新缓存，任一失败则新 SW 安装失败，
//   旧版本继续服务（不会出现半套资源）；
// - 不自动 skipWaiting：等待中的新版本由页面在「非单局中途」时机
//   （选择屏且无进行中局次，见 offline.ts decideUpdateAdoption）发送
//   skip-waiting 消息后激活；单局中途页面不发网络请求，不会被换用新旧资源；
// - activate 阶段清理同前缀旧版本缓存（与 offline.ts staleCacheNames 同策略），
//   其他前缀的缓存不动，然后 clients.claim 并向各页面广播 cache-ready；
// - fetch 仅拦截同源 GET：清单内资源缓存优先，未命中回网络并回填；导航请求
//   回退入口页；离线且缓存缺失时返回可理解的提示页；清单外请求不拦截；
// - 不依赖远程字体、CDN 脚本或任何在线内容请求（预缓存清单全部为同源路径）。
'use strict';

const APP_VERSION = '__APP_VERSION__';
const CACHE_NAME = 'pixel-academy:number-puzzle:' + APP_VERSION;
const CACHE_PREFIX = 'pixel-academy:number-puzzle:';
const PRECACHE_URLS = __PRECACHE_URLS__;
const PRECACHE_SET = new Set(PRECACHE_URLS);

// 导航请求离线且缓存缺失时的兜底页（资源缺失提示，M6 验收）。
const FALLBACK_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>数字消除 · 离线提示</title></head>'
  + '<body style="font-family:sans-serif;line-height:1.7;padding:28px 20px;max-width:30em;margin:0 auto;">'
  + '<h1 style="font-size:20px;">暂时无法打开游戏</h1>'
  + '<p>当前处于离线状态，页面资源没有完整缓存。</p>'
  + '<p>请联网后重新打开本页，等待页面显示「离线缓存已就绪」后，再断网使用。</p>'
  + '</body></html>';

function offlineFallbackHtml() {
  return new Response(FALLBACK_HTML, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function resourceOfflineText() {
  return new Response('offline and resource not cached', {
    status: 504,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll 任一资源失败即整体失败 → 新 SW 不激活，旧版本继续服务。
    await cache.addAll(PRECACHE_URLS);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // 只清理本应用前缀下非当前版本的缓存（offline.ts staleCacheNames 同策略）。
    const stale = names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    await Promise.all(stale.map(name => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'cache-ready', version: APP_VERSION });
    }
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'skip-waiting') {
    // 页面在安全时机（非单局中途）请求切换：激活后走 activate 清理旧缓存。
    self.skipWaiting();
  } else if (data.type === 'query-version' && event.source) {
    event.source.postMessage({ type: 'cache-ready', version: APP_VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // 入口页离线回退：'/'（数字消除，含 ?preview=candidate）、'/hanzi.html'、'/hanzi'
      // （汉字勇者，含 ?nosw）、'/dungeon.html'、'/dungeon'（算术地下城）、
      // '/pinyin.html'、'/pinyin'（拼音冒险）与 '/english.html'、'/english'（英语快递员）
      // 均为清单内入口；查询参数不影响匹配（ignoreSearch）。
      // '/hanzi'、'/dungeon'、'/pinyin'、'/english' 兜底：生产 Pages 曾把 /hanzi.html 规范化 308
      // 到 /hanzi，旧访客可能持有该 URL；无扩展名路径同样回退到缓存的对应入口页。
      const entryPath = url.pathname === '/' ? '/'
        : (url.pathname === '/hanzi.html' || url.pathname === '/hanzi') ? '/hanzi.html'
        : (url.pathname === '/dungeon.html' || url.pathname === '/dungeon') ? '/dungeon.html'
        : (url.pathname === '/pinyin.html' || url.pathname === '/pinyin') ? '/pinyin.html'
        : (url.pathname === '/english.html' || url.pathname === '/english') ? '/english.html'
        : null;
      if (entryPath) {
        const hit = await cache.match(entryPath, { ignoreSearch: true });
        // Pages 等托管平台对 /hanzi.html 的 308 规范化会让缓存条目带 redirected 标记
        // （install 的 addAll 跟随重定向写入）；导航 respondWith 禁止 redirected 响应，
        // 命中时必须重包一层去掉标记，否则在线与离线导航都落网络错误页。
        if (hit) return hit.redirected ? new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: hit.headers }) : hit;
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(entryPath, response.clone());
          return response;
        } catch {
          return offlineFallbackHtml();
        }
      }
      try {
        return await fetch(request);
      } catch {
        return offlineFallbackHtml();
      }
    })());
    return;
  }

  // 清单外请求（如 favicon）不拦截，交给浏览器直接走网络。
  if (!PRECACHE_SET.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request);
    if (hit) return hit;
    try {
      // 缓存被外部清理时自愈：联网取回并回填清单内资源。
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return resourceOfflineText();
    }
  })());
});
