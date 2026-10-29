// 찾아줘 서비스 워커: 화면 파일을 휴대폰에 저장해 빠르게 열고, 인터넷이 끊겨도 안내 화면을 보여줌
const VERSION = 'v5';
const STATIC = `static-${VERSION}`;
const PHOTOS = 'photos-v1';
const PRECACHE = ['/', '/admin', '/login', '/offline', '/style.css', '/common.js', '/icons.js', '/app.js', '/admin.js', '/photo-editor.js', '/drop.js',
  '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(STATIC).then(c => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== STATIC && k !== PHOTOS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // 사진: 한 번 받은 사진은 휴대폰에 저장 (사진은 바뀌지 않음)
  if (url.pathname.startsWith('/api/photo/')) {
    e.respondWith((async () => {
      const cache = await caches.open(PHOTOS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && !/no-store/.test(res.headers.get('cache-control') || '')) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  // 사용설명서 PDF는 저장하지 않고 항상 새로 받기
  if (url.pathname.endsWith('.pdf')) return;
  // 나머지 API는 항상 최신 데이터
  if (url.pathname.startsWith('/api/')) return;

  // 화면(HTML): 인터넷 우선, 안 되면 저장된 화면 → 오프라인 안내
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(STATIC)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || caches.match('/offline');
      }
    })());
    return;
  }

  // CSS·JS·아이콘: 저장된 것 먼저 보여주고 뒤에서 새 버전 받아 두기
  e.respondWith((async () => {
    const cache = await caches.open(STATIC);
    const hit = await cache.match(req);
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })());
});
