import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const appVersion = (source) => source.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
const cacheVersion = (source) => source.match(/const CACHE\s*=\s*'kuechenvorrat-v([^']+)'/)?.[1];

/**
 * Die Versionsnummer steht an zwei Stellen, weil der Service Worker als
 * eigenständige Datei läuft und nichts aus der App importieren kann.
 *
 * Laufen die beiden auseinander, merkt das im Betrieb niemand -- die App
 * zeigt dann eine neue Nummer an, während der Worker unter dem alten
 * Cache-Namen weiterläuft und weiterhin die alten Dateien ausliefert.
 * Genau davor schützt dieser Test.
 */
test('App-Version und Cache-Version stimmen überein', async () => {
  const app = appVersion(await read('../js/app.js'));
  const cache = cacheVersion(await read('../sw.js'));

  assert.ok(app, 'APP_VERSION in js/app.js nicht gefunden');
  assert.ok(cache, 'Cache-Name in sw.js nicht gefunden');
  assert.equal(
    cache,
    app,
    `sw.js liegt auf ${cache}, js/app.js auf ${app} -- beide müssen gleich sein`,
  );
});

test('die Versionsnummer hat die Form x.y.z', async () => {
  assert.match(appVersion(await read('../js/app.js')), /^\d+\.\d+\.\d+$/);
});

/**
 * Der Service Worker liefert nur aus, was in seiner Dateiliste steht. Fehlt
 * dort ein Modul, funktioniert die App online einwandfrei und bricht offline
 * an einer einzigen Stelle -- schwer zu bemerken und noch schwerer
 * zuzuordnen.
 */
test('der Service Worker kennt alle Programmdateien', async () => {
  const sw = await read('../sw.js');
  const dateien = [
    './index.html',
    './app.css',
    './js/app.js',
    './js/model.js',
    './js/storage.js',
    './js/forecast.js',
    './js/barcode.js',
    './js/format.js',
    './vendor/zbar-wasm/zbar-wasm.mjs',
    './vendor/zbar-wasm/zbar.wasm',
  ];
  for (const datei of dateien) {
    assert.ok(sw.includes(`'${datei}'`), `${datei} fehlt in der Liste in sw.js`);
  }
});

test('der Service Worker holt die Dateien am Browser-Cache vorbei', async () => {
  // Ohne 'reload' liefert GitHub Pages minutenlang die vorige Fassung, und
  // das Update landete gar nicht erst im Cache des Workers.
  const sw = await read('../sw.js');
  assert.match(sw, /cache:\s*'reload'/);
});
