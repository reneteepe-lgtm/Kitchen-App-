import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const appVersion = (source) => source.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
const cacheVersion = (source) => source.match(/const CACHE\s*=\s*'training-v([^']+)'/)?.[1];

/**
 * Die Versionsnummer steht an zwei Stellen, weil der Service Worker als
 * eigenständige Datei läuft und nichts aus der App importieren kann.
 *
 * Laufen die beiden auseinander, merkt das im Betrieb niemand -- die App
 * zeigt dann eine neue Nummer an, während der Worker unter dem alten
 * Cache-Namen weiterläuft und weiterhin die alten Dateien ausliefert.
 */
test('App-Version und Cache-Version stimmen überein', async () => {
  const app = appVersion(await read('../js/app.js'));
  const cache = cacheVersion(await read('../sw.js'));

  assert.ok(app, 'APP_VERSION in js/app.js nicht gefunden');
  assert.ok(cache, 'Cache-Name in sw.js nicht gefunden');
  assert.equal(cache, app, `sw.js liegt auf ${cache}, js/app.js auf ${app}`);
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

  // Nicht abgeschrieben, sondern nachgesehen: Eine von Hand gepflegte Liste
  // im Test wäre genauso vergesslich wie die in sw.js -- ein neues Modul
  // fiele in beiden zugleich durch.
  const module = (await readdir(new URL('../js/', import.meta.url)))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `./js/${name}`);

  for (const datei of ['./index.html', './app.css', './manifest.webmanifest', ...module]) {
    assert.ok(sw.includes(`'${datei}'`), `${datei} fehlt in der Liste in sw.js`);
  }
});

test('der Service Worker holt die Dateien am Browser-Cache vorbei', async () => {
  const sw = await read('../sw.js');
  assert.match(sw, /cache:\s*'reload'/);
});

/**
 * Das Manifest verweist auf Dateien, die es geben muss -- sonst zeigt der
 * Startbildschirm ein leeres Kästchen, und gemerkt wird das erst auf dem
 * Handy.
 */
test('alle Symbole aus dem Manifest liegen auch da', async () => {
  const manifest = JSON.parse(await read('../manifest.webmanifest'));
  const vorhanden = await readdir(new URL('../icons/', import.meta.url));

  assert.ok(manifest.icons.length >= 3);
  for (const symbol of manifest.icons) {
    const name = symbol.src.replace('icons/', '');
    assert.ok(vorhanden.includes(name), `${symbol.src} fehlt — erzeugt mit scripts/make-icons.js`);
  }

  assert.ok(
    manifest.icons.some((symbol) => symbol.purpose === 'maskable'),
    'ohne randloses Symbol schneidet Android das Logo mitten durch',
  );
});

test('Manifest und Seite nennen dieselbe Farbe', async () => {
  const manifest = JSON.parse(await read('../manifest.webmanifest'));
  const html = await read('../index.html');

  assert.match(html, new RegExp(`name="theme-color" content="${manifest.theme_color}"`));
});

/**
 * Jede Datei, die index.html lädt, muss existieren -- ein Tippfehler im
 * Pfad fällt sonst erst im Browser auf, und auch dort nur als stille
 * Nichtfunktion.
 */
test('index.html verweist nur auf Dateien, die es gibt', async () => {
  const html = await read('../index.html');
  const pfade = [...html.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)].map((treffer) => treffer[1]);

  assert.ok(pfade.length > 3);
  for (const pfad of pfade) {
    await assert.doesNotReject(
      () => readFile(new URL(`../${pfad}`, import.meta.url)),
      `${pfad} wird in index.html geladen, liegt aber nicht da`,
    );
  }
});

/**
 * Die Oberfläche spricht die Knoten über ihre Kennung an. Eine Kennung, die
 * in `app.js` steht, aber nicht in `index.html`, ist ein stiller Ausfall:
 * `$('#…')` liefert `null`, und die Zeile darunter wirft.
 */
test('jede angesprochene Kennung gibt es auch in der Seite', async () => {
  const html = await read('../index.html');
  const app = await read('../js/app.js');

  const vorhanden = new Set([...html.matchAll(/id="([^"]+)"/g)].map((treffer) => treffer[1]));
  const angesprochen = new Set([...app.matchAll(/\$\('#([a-z0-9-]+)'\)/g)].map((treffer) => treffer[1]));

  for (const kennung of angesprochen) {
    assert.ok(vorhanden.has(kennung), `#${kennung} wird in app.js gesucht, steht aber nicht in index.html`);
  }
});
