// Service worker: lets PetPost open and run without an internet connection.
// Bump VERSION whenever app files change so phones pick up the update.
const VERSION = 'petpost-v41';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/camera.js',
  './js/celebrate.js',
  './js/cloud.js',
  './js/config.js',
  './js/icons.js',
  './js/media.js',
  './js/petcard.js',
  './js/sounds.js',
  './js/stickers.js',
  './js/themes.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts and the pinned database library never change: serve from cache once we have them.
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com') || url.hostname === 'esm.sh') {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // App files: use the network when online (so updates show up right away), the cache when offline.
  event.respondWith(
    fetch(req, { cache: 'no-cache' }) // always ask the server if there is a newer version
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});

// Real phone notifications: show them, and open PetPost on the right screen when one is tapped.
self.addEventListener('push', event => {
  let note = {};
  try { note = event.data.json(); } catch { note = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(note.title || 'PetPost', {
    body: note.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: note.tag,
    data: { url: note.url || '#/notifications' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '#/notifications';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open) { open.postMessage({ type: 'open', url }); return open.focus(); }
    return self.clients.openWindow(new URL(`./${url}`, self.registration.scope).href);
  }));
});
