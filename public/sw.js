const CACHE_NAME = 'lich-cua-vy-v7';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const incomingCall = payload.incomingCall === true;
  event.waitUntil(self.registration.showNotification(payload.title || 'Lịch của Vy 🌷', {
    body: payload.body || 'Vy ơi, kiểm tra lịch làm việc nha.',
    tag: payload.tag || 'lich-cua-vy',
    icon: payload.icon || '/app-icon.jpg?v=2',
    badge: payload.badge || '/app-icon.jpg?v=2',
    requireInteraction: incomingCall,
    renotify: incomingCall,
    silent: false,
    vibrate: incomingCall ? (payload.vibrate || [450, 180, 450, 180, 800]) : undefined,
    actions: incomingCall ? [{ action: 'accept', title: 'Nhan' }, { action: 'decline', title: 'Tu choi' }] : [],
    data: { url: payload.url || '/', incomingCall, callerRole: payload.callerRole, callType: payload.callType }
  }).then(() => incomingCall
    ? self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => windows.forEach((client) => client.postMessage({
      type: 'incoming-call',
      role: payload.callerRole === 'admin' ? 'vy' : 'admin',
      callType: payload.callType === 'voice' ? 'voice' : 'video',
      url: payload.url || '/'
    })))
    : undefined));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (event.notification.data?.incomingCall && event.action) target.searchParams.set('callAction', event.action);
  const targetUrl = target.href;
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
    existing.postMessage({ type: 'notification-navigation', url: targetUrl, action: event.action || '' });
    return existing;
  }));
});
