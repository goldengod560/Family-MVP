const CACHE = 'family-nfl-picks-v0930';
const ASSETS = ['./','./index.html','./styles.css?v=0930','./config.js?v=0930','./api.mjs?v=0930','./app.js?v=0930','./logic.mjs?v=0930','./report.mjs?v=0930','./manifest.webmanifest?v=0930'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('family-nfl-picks-') && key !== CACHE)
          .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
