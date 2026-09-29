const CACHE_NAME = 'lich-cua-vy-v4';

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
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.includes(self.location.origin));
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});
