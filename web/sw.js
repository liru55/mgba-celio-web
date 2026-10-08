const CACHE = 'mgba-celio-web-v32';
const FILES = ['./','index.html','app.js','ui.js','skins.js','rom-library.js','vendor/fflate.min.js','vendor/pdf.min.js','vendor/pdf.worker.min.js','memory-viewer.js','celio-serial.js','link-session.js','offline.js','screen-effects.js','shaders/xbrz-pass0.glsl','shaders/xbrz-pass1.glsl','controller.js','storage.js','styles.css','help.html','mgba.js','mgba.wasm','manifest.webmanifest','icon-256.png','icon-512.png'];
async function prepare() {
  const cache = await caches.open(CACHE);
  // No expiry: keep the complete app until the user clears it or the browser evicts it.
  await cache.addAll(FILES.map(file => new Request(new URL(file, self.registration.scope), {cache:'reload'})));
}
async function status() {
  const cache = await caches.open(CACHE);
  const present = await Promise.all(FILES.map(file => cache.match(new URL(file, self.registration.scope))));
  return {ready:present.every(Boolean), count:present.filter(Boolean).length, total:FILES.length};
}
self.addEventListener('install', e => e.waitUntil(prepare().then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mgba-celio-web-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', e => {
  e.waitUntil((async () => {
    try {
      if (e.data === 'PREPARE') await prepare();
      if (e.data === 'CLEAR') await Promise.all((await caches.keys()).filter(k => k.startsWith('mgba-celio-web-')).map(k => caches.delete(k)));
      e.ports[0]?.postMessage(await status());
    } catch (error) { e.ports[0]?.postMessage({error:error.message}); }
  })());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  // Only app files are handled; ROM and save data never enter this cache.
  const url = new URL(e.request.url);
  if (!FILES.some(file => new URL(file, self.registration.scope).pathname === url.pathname)) return;
  e.respondWith(fetch(e.request).catch(async () => {
    const cached = await (await caches.open(CACHE)).match(e.request, {ignoreSearch:true});
    return cached || Response.error();
  }));
});
