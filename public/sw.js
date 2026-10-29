const CACHE_NAME = 'lich-cua-vy-v9';
const OFFLINE_ASSET_EXTENSIONS = new Set(['.css', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json', '.png', '.svg', '.txt', '.webmanifest']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch('/offline-precache.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Không tải được danh sách tài nguyên offline.');
    const payload = await response.json();
    const files = Array.isArray(payload.files) ? payload.files : [];
    const cache = await caches.open(CACHE_NAME);
    const shell = ['/', '/index.html', '/app-icon.jpg?v=2', ...files];
    await cache.addAll([...new Set(shell)]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function fetchWithTimeout(request, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
  } catch {
    // Khi mất mạng hoặc mạng yếu, dùng trang app đã được lưu trước đó.
  }
  return (await cache.match(request, { ignoreSearch: true }))
    || (await cache.match('/index.html'))
    || (await cache.match('/'))
    || Response.error();
}

async function handleStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  const extension = url.pathname.slice(url.pathname.lastIndexOf('.')).toLowerCase();
  if (OFFLINE_ASSET_EXTENSIONS.has(extension)) {
    event.respondWith(handleStaticAsset(request));
  }
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
