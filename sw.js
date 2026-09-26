// Service worker: lưu toàn bộ file app vào bộ nhớ đệm để chạy offline.
// Khi sửa code: tăng VERSION để máy người dùng tải bản mới.
const VERSION = 'vbs-v6';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/scout-report.css', 'css/tactics.css',
  'js/app.js', 'js/logic.js', 'js/store.js', 'js/export.js', 'js/ai.js', 'js/video.js',
  'js/ai-live.js', 'js/tactics.js', 'js/scout-report.js',
  'data/roster-lpbank.json', 'data/opponents.json', 'data/scout/xmls-thanh-hoa.json',
  'fonts/bvp-400-latin-ext.woff2', 'fonts/bvp-400-latin.woff2', 'fonts/bvp-400-vietnamese.woff2', 'fonts/bvp-600-latin-ext.woff2', 'fonts/bvp-600-latin.woff2', 'fonts/bvp-600-vietnamese.woff2', 'fonts/bvp-700-latin-ext.woff2', 'fonts/bvp-700-latin.woff2', 'fonts/bvp-700-vietnamese.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Lấy từ bộ nhớ đệm trước (nhanh, chạy được khi mất mạng), đồng thời cập nhật ngầm khi có mạng.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => { if (res.ok) cache.put(key, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || new Response('Offline', { status: 503 });
    }),
  );
});
