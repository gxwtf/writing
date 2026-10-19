/* 作文积累本 PWA Service Worker
 *
 * 策略（本站为 SSO 鉴权的数据型应用，离线不可用，故只做静态资源缓存）：
 *   - /_next/static/*：内容带哈希、可长期缓存 → cache-first
 *   - 图片 / 字体 / 图标等静态文件 → stale-while-revalidate
 *   - 页面、Server Action、/api/*：完全不拦截，始终走网络
 *     （避免把登录态页面写进缓存，也避免读到过期的作文数据）
 */
const CACHE = 'gxwtf-writing-v1';

const PRECACHE = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isImmutable(pathname) {
  return pathname.startsWith('/_next/static/');
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/fonts/') ||
    pathname.startsWith('/splash/') ||
    /\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|otf)$/i.test(pathname)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isImmutable(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
