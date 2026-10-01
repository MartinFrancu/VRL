// What makes this work in a hall with no internet.
//
// Everything the app is — four files and three icons — is taken on the first
// visit and served from the phone from then on. After that first load there is
// no network call at all, which is the whole point: a venue's Wi-Fi is not
// something to depend on, and neither is a signal in a sports hall.
//
// Stale-while-revalidate, rather than cache-first or network-first. Cache-first
// would mean a fix pushed on the Saturday morning never arriving; network-first
// would mean a dead signal making the app slow to open, which is exactly when
// it needs to open. So: answer from the cache at once, fetch in the background,
// and the next opening has the new version. A version behind is a fair price
// for never waiting.

const CACHE = 'vrl-v2';

const SHELL = [
  './',
  './index.html',
  './solo.js',
  './windows.js',
  './manifest.webmanifest',
  './qr.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  // Take over straight away rather than waiting for every tab to close. A
  // referee who reloads because something looked wrong means "give me the new
  // one", and honouring that beats being careful about a tab nobody has open.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only ever our own files. Nothing else is asked for — there is no API to
  // call and no font to fetch — so anything else is not ours to answer.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });

      const fromNetwork = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        // Offline is the expected case, not a failure. If there is something in
        // the cache the caller already has it; if there is not, the error is
        // the honest answer.
        .catch(() => cached ?? Promise.reject(new Error('offline and not cached')));

      return cached ?? fromNetwork;
    })
  );
});
