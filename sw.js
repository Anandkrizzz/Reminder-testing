/* sw.js (Member 1): offline cache + notifications */
const CACHE = 'medtracker-v1';
const ASSETS = ['./', './index.html', './reminder-engine.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so edits show up), cache as the offline fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});

// Tapping a notification or one of its buttons (Taken / Snooze)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const doseId = (e.notification.data || {}).doseId || '';
  const action = e.action || 'open';
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) {
      all[0].postMessage({ type: 'notification-action', action, doseId });
      return all[0].focus();
    }
    return clients.openWindow('./?action=' + encodeURIComponent(action) + '&dose=' + encodeURIComponent(doseId));
  })());
});

// Test: a timer inside the service worker (works while the tab is closed, for a few minutes at most)
self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'schedule-test') {
    e.waitUntil(new Promise(resolve => setTimeout(() => {
      self.registration.showNotification('Test reminder (service worker timer)', {
        body: 'Fired after ' + Math.round(m.delayMs / 1000) + ' seconds',
        tag: 'sw-test', requireInteraction: true
      }).then(resolve);
    }, m.delayMs)));
  }
});
