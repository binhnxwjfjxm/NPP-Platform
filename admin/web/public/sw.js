const CACHE_NAME = 'admin-mcp-npp-static-v2';
const OFFLINE_URL = '/offline.html';
const STATIC_PATH_PREFIXES = ['/_next/static/', '/icons/'];
const STATIC_PATHS = [
  '/manifest.webmanifest',
  OFFLINE_URL,
  '/icons/admin-180.png',
  '/icons/admin-192.png',
  '/icons/admin-512.png',
  '/icons/admin-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_PATHS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return STATIC_PATHS.includes(url.pathname)
    || STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  if (!isStaticAsset(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });

      return cached || refresh;
    }),
  );
});
