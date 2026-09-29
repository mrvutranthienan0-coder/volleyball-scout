// Service worker: lưu toàn bộ file app vào bộ nhớ đệm để chạy offline.
// Khi sửa code: tăng VERSION để máy người dùng tải bản mới.
const VERSION = 'vbs-v13';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/scout-report.css', 'css/tactics.css', 'css/assist.css', 'css/player-panel.css',
  'js/app.js', 'js/logic.js', 'js/store.js', 'js/export.js', 'js/ai.js', 'js/video.js',
  'js/ai-live.js', 'js/tactics.js', 'js/scout-report.js', 'js/assistant.js', 'js/analysis.js', 'js/charts.js', 'js/player-panel.js', 'js/clip-library.js',
  'data/roster-lpbank.json', 'data/opponents.json', 'data/scout/xmls-thanh-hoa.json', 'data/scout/boards-xmls-7-4.json', 'data/scout/players-xmls-thanh-hoa.json',
  'data/photos/opp/index.json', 'data/photos/opp/binh-chung-thong-tin/credits.json', 'data/photos/opp/geleximco-hung-yen/credits.json', 'data/photos/opp/ha-noi-tasco-auto/credits.json', 'data/photos/opp/hcdg-lao-cai/credits.json', 'data/photos/opp/lpbank-ninh-binh/credits.json', 'data/photos/opp/vtv-binh-dien-long-an/credits.json', 'data/photos/opp/xmls-thanh-hoa/credits.json',
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
// Chỉ trang app (gốc phạm vi SW, index.html) dùng chung ô 'index.html'; trang khác (tactics.html, …) lưu đúng URL của nó.
// guide/ (trang hướng dẫn, cần CDN ngoài) không đi qua SW. Không bao giờ ghi phản hồi vào ô khác với yêu cầu của nó.
const SCOPE = new URL(self.registration ? self.registration.scope : './', location.href).pathname;
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
  const rel = url.pathname.slice(SCOPE.length);
  if (rel === 'guide' || rel.startsWith('guide/')) return;
  const appPage = req.mode === 'navigate' && (rel === '' || rel === 'index.html');
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = appPage ? 'index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => {
          // Chỉ lưu khi phản hồi đúng là của yêu cầu (không lưu trang bị chuyển hướng sang chỗ khác vào ô này).
          if (res.ok && !res.redirected && (!appPage || new URL(res.url).pathname.startsWith(SCOPE))) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || new Response('Offline', { status: 503 });
    }),
  );
});
