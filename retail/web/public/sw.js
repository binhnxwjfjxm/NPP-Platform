const STATIC_CACHE = 'hung-phat-retail-static-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('hung-phat-retail-static-') && key !== STATIC_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return;
  event.respondWith(caches.open(STATIC_CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    });
    return cached ?? network;
  }));
});

function safeNotificationPayload(event) {
  try {
    const data = event.data?.json?.();
    if (!data || typeof data !== 'object') return null;
    const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
    return {
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Bán tại quầy',
      body: typeof data.body === 'string' && data.body.trim() ? data.body.trim() : 'Có thông báo mới.',
      url,
      salesOrderId: typeof data.salesOrderId === 'string' ? data.salesOrderId : null,
      orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : null,
      type: typeof data.type === 'string' ? data.type : 'retail_notification',
    };
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const payload = safeNotificationPayload(event);
  if (!payload) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.visibilityState === 'visible') {
        client.postMessage({ type: 'retail:notification-foreground', notification: payload });
      }
    }
    const tag = payload.salesOrderId ? `retail-order-${payload.salesOrderId}` : payload.type;
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-icon-retail.png?v=3',
      badge: '/pwa-icon-retail.png?v=3',
      tag,
      renotify: true,
      data: payload,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification.data && typeof event.notification.data === 'object'
    ? event.notification.data
    : {};
  const relative = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/';
  const target = new URL(relative, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.postMessage({ type: 'retail:notification-open', notification: payload });
      await existing.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});
