const CACHE = 'mgba-celio-web-v9';
const FILES = ['./','index.html','app.js','controller.js','storage.js','styles.css','help.html','mgba.js','mgba.wasm','manifest.webmanifest','icon-256.png','icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mgba-celio-web-') && k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
