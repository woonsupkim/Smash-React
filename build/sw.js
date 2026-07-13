// Minimal service worker: enables PWA installability without caching.
// Deliberately no offline cache - the app's data files refresh daily during
// slams and a stale-cache bug would be worse than no offline support.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
