// Minimal service worker: enables PWA installability without caching.
// Deliberately no offline cache - the app's data files refresh daily during
// slams and a stale-cache bug would be worse than no offline support.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Web push: upset alerts sent by the data refresh (data-pipeline/sendPush.js).
// Payload: { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Smash', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/favicon-64.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
    const existing = tabs.find((t) => 'focus' in t);
    if (existing) { existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  }));
});
