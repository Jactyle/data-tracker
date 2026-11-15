/* Service worker: online, every file comes from the network (and is saved);
 * offline, the site opens from the saved copy and shows the last data it loaded. */
const CACHE = 'movie-tracker-v14';

const SHELL = [
  './', 'index.html', 'browse.html', 'trends.html', 'manifest.webmanifest',
  'static/site.css', 'static/sound.js', 'static/intro-envelope.js', 'static/opening.js', 'static/matrix.js', 'static/decode.js', 'static/ripple.js', 'static/terminal.js', 'static/lib.js', 'static/charts.js', 'static/cloud.js', 'static/compare.js',
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
      // Network first: always the latest files. For scripts, styles and data, `no-cache` makes the browser ask the server
      // whether a file changed (a cheap 304 when it did not) instead of reusing its own copy for the 10 minutes GitHub Pages
      // allows, so a page can never mix a new script with an old one right after a deploy. A page itself is fetched as it
      // came: some browsers refuse to rebuild a navigation request with options, and a page that is a few minutes old
      // does no harm (it only names scripts, and those are always fresh).
      const response = request.mode === 'navigate' ? await fetch(request) : await fetch(request, { cache: 'no-cache' });
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
