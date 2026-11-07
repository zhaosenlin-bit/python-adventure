// Service Worker for caching Pyodide (Production Silent Mode)
// 每次替换 public/pyodide 下的运行时文件时，必须把 CACHE_NAME 的版本号 +1，
// 否则老用户浏览器里缓存的 wasm / lock 文件会和新的 loader 配对，出现
// "Lock file ABI version doesn't match Pyodide ABI version"。
const CACHE_NAME = 'pyodide-cache-v2';
const PYODIDE_FILES = [
  '/pyodide/pyodide.js',
  '/pyodide/pyodide.asm.js',
  '/pyodide/pyodide.asm.wasm',
  '/pyodide/python_stdlib.zip',
  '/pyodide/pyodide-lock.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Silent caching - no console output in production
      return cache.addAll(PYODIDE_FILES.map(url => new Request(url, { cache: 'reload' })))
        .catch(() => {
          // Silently ignore cache failures
        });
    }).catch(() => {
      // Silently ignore errors
    })
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 清理旧版本缓存，避免新旧运行时文件混用
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/pyodide/')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).catch(() => {
          // Return empty response on network failure
          return new Response('', { status: 503 });
        });
      }).catch(() => {
        return fetch(event.request);
      })
    );
  }
});
