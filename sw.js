/* Service worker: online, every file comes from the network (and is saved);
 * offline, the site opens from the saved copy and shows the last data it loaded. */
const CACHE = 'movie-tracker-v10';

const SHELL = [
  './', 'index.html', 'browse.html', 'trends.html', 'manifest.webmanifest',
  'static/site.css', 'static/sound.js', 'static/intro-envelope.js', 'static/opening.js', 'static/matrix.js', 'static/decode.js', 'static/terminal.js', 'static/lib.js', 'static/charts.js',
  'static/today.js', 'static/browse.js', 'static/trends.js',
  'static/icon-192.png', 'static/icon-512.png'
];
const AUDIO = ['static/intro.mp3', 'static/ambience.mp3'];   // large and optional: saved if possible, never blocks the install
const DATA = ['data/history.csv', 'data/status.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Save the data too, so the very first offline visit has something to show.
    await Promise.all(DATA.concat(AUDIO).map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);               // network first: always the latest data
      if (response.status === 200) cache.put(request, response.clone());
      return response;
    } catch (err) {
      const saved = await cache.match(request, { ignoreSearch: true });
      if (saved) return saved;                             // offline: the last copy that was loaded
      if (request.mode === 'navigate') return cache.match('index.html');
      throw err;
    }
  })());
});
