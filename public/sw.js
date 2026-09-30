const CACHE_NAME = 'lich-cua-vy-v5';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || 'Lịch của Vy 🌷', {
    body: payload.body || 'Vy ơi, kiểm tra lịch làm việc nha.',
    tag: payload.tag || 'lich-cua-vy',
    data: { url: payload.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (!existing) return clients.openWindow(targetUrl);
    await existing.focus();
    if (typeof existing.navigate === 'function') {
      try {
        await existing.navigate(targetUrl);
        return existing;
      } catch {
        // Dùng postMessage nếu trình duyệt không cho service worker điều hướng trực tiếp.
      }
    }
    existing.postMessage({ type: 'notification-navigation', url: targetUrl });
    return existing;
  }));
});
