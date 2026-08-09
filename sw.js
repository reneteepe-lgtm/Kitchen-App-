/**
 * Service Worker.
 *
 * Zweck: Die App muss in der Küche funktionieren, auch wenn das WLAN dort
 * schwach ist. Der eigene Code wird deshalb beim ersten Besuch abgelegt und
 * danach zuerst aus dem Cache bedient.
 *
 * Die Produktdatenbank-Abfrage (Open Food Facts) wird bewusst nicht
 * abgefangen -- ein veralteter Produktname aus dem Cache wäre schlechter als
 * ein sauber fehlschlagender Aufruf, den die App ohnehin abfängt.
 */

const CACHE = 'kuechenvorrat-v1';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './js/app.js',
  './js/model.js',
  './js/storage.js',
  './js/forecast.js',
  './js/barcode.js',
  './js/format.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll bricht komplett ab, wenn eine einzige Datei fehlt. Einzeln
      // ablegen heißt: die App ist auch dann offline nutzbar, wenn etwa ein
      // Icon fehlt.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      // Im Hintergrund aktualisieren, damit die nächste Sitzung neuen Code
      // bekommt, ohne dass diese hier auf das Netz warten muss.
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || fromNetwork;
    }),
  );
});
