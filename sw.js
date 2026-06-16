const CACHE = 'vtol-manual-v10';
const ASSETS = [
  './',
  './index.html',
  './manual.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (API, CDN fonts)
  const isHTML = url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/');

  if (isHTML) {
    // Network-first for HTML: always try to get the latest version,
    // fall back to cache only when offline.
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first for fonts and other static assets.
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (!response || response.status !== 200 || response.type === 'opaque') return response;
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return response;
        });
      })
    );
  }
});
