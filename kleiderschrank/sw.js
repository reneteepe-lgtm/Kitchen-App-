/**
 * Service Worker.
 *
 * Zweck: Vor dem Schrank steht man morgens, oft im Bad, oft ohne
 * brauchbaren Empfang. Der eigene Code wird deshalb beim ersten Besuch
 * abgelegt und danach zuerst aus dem Cache bedient.
 *
 * Der Wetterabruf (Open-Meteo) wird bewusst nicht abgefangen: Ein
 * zwischengespeichertes Wetter von gestern wäre schlechter als ein sauber
 * fehlschlagender Aufruf -- die App hält den letzten Stand selbst vor und
 * schreibt dazu, wie alt er ist.
 */

/**
 * Bei jeder Veröffentlichung erhöhen -- und dieselbe Nummer in
 * `js/app.js` (APP_VERSION) mitziehen. Ein Test wacht darüber, dass beide
 * übereinstimmen.
 *
 * Die Nummer steckt bewusst im Cache-Namen: Sie ist der Auslöser dafür,
 * dass der Browser diese Datei als geändert erkennt, den neuen Worker
 * installiert und der alte Cache verworfen wird.
 */
const CACHE = 'kleiderschrank-v1.2.0';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './js/app.js',
  './js/model.js',
  './js/storage.js',
  './js/photos.js',
  './js/colorvision.js',
  './js/cutout.js',
  './js/layout.js',
  './js/slots.js',
  './js/text.js',
  './js/outfit.js',
  './js/preferences.js',
  './js/weather.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Zwei Dinge auf einmal:
      //   `allSettled` statt `addAll`, weil addAll komplett abbricht, sobald
      //   eine einzige Datei fehlt -- die App soll auch dann offline laufen,
      //   wenn etwa ein Symbol fehlt.
      //
      //   `cache: 'reload'`, weil ein gewöhnlicher Abruf durch den normalen
      //   Browser-Cache ginge. Der liefert bei GitHub Pages minutenlang die
      //   vorige Fassung, und das Update landete gar nicht erst im Cache.
      .then((cache) =>
        Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
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
