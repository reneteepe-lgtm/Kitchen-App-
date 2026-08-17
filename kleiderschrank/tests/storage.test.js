import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryAdapter, Store, newId, requestPersistence, COLLECTIONS } from '../js/storage.js';
import { targetSize, MemoryPhotoStore, PhotoUrls, MAX_EDGE } from '../js/photos.js';
import { normalize, hasStem, searchItems, scoreMatch } from '../js/text.js';
import { createItem } from '../js/model.js';

const frisch = () => new Store(new MemoryAdapter()).init();

test('legt an, liest und löscht weich', async () => {
  const store = await frisch();
  const item = createItem({ name: 'Hemd weiß' });

  await store.put('items', item);
  assert.equal(store.all('items').length, 1);

  await store.remove('items', item.id);
  assert.equal(store.all('items').length, 0, 'gelöschte Datensätze sind fort');
  assert.equal(store.state.items[item.id].deleted, true, 'aber nur weich');
});

test('überlebt einen Neustart', async () => {
  const adapter = new MemoryAdapter();
  const store = await new Store(adapter).init();
  await store.put('items', createItem({ name: 'Jeans blau' }));

  const wieder = await new Store(adapter).init();
  assert.equal(wieder.all('items')[0].name, 'Jeans blau');
});

test('sagt Bescheid, wenn sich etwas geändert hat', async () => {
  const store = await frisch();
  let gerufen = 0;
  store.subscribe(() => gerufen++);

  await store.put('items', createItem({ name: 'Hemd weiß' }));
  await store.setSetting('ort', { name: 'Wallenhorst' });

  assert.equal(gerufen, 2);
});

test('mehrere Änderungen sind ein Vorgang', async () => {
  const store = await frisch();
  let gerufen = 0;
  store.subscribe(() => gerufen++);

  await store.putMany([
    ['items', createItem({ name: 'Hemd weiß' })],
    ['items', createItem({ name: 'Jeans blau' })],
  ]);

  assert.equal(gerufen, 1, 'einmal zeichnen, nicht zweimal');
  assert.equal(store.all('items').length, 2);
});

test('führt zwei Stände zusammen: der jüngere gewinnt', async () => {
  const store = await frisch();
  const item = createItem({ name: 'Hemd weiß' });
  await store.put('items', item);

  await store.merge({
    items: {
      [item.id]: { ...item, name: 'Hemd hellblau', updatedAt: '2999-01-01T00:00:00.000Z' },
    },
  });

  assert.equal(store.byId('items', item.id).name, 'Hemd hellblau');
});

test('Bewertungen werden vereinigt, nicht überschrieben', async () => {
  const store = await frisch();
  await store.put('ratings', { id: 'r1', verdict: 1, features: ['farbe:schwarz'] });

  await store.merge({
    ratings: {
      // Dasselbe Urteil vom anderen Gerät, mit älterem Zeitstempel -- und
      // ein zweites, das nur dort gefällt wurde.
      r1: { id: 'r1', verdict: -1, features: [], updatedAt: '2000-01-01T00:00:00.000Z' },
      r2: { id: 'r2', verdict: 1, features: ['farbe:blau'] },
    },
  });

  assert.equal(store.all('ratings').length, 2, 'das fremde Urteil kommt dazu');
  assert.equal(store.byId('ratings', 'r1').verdict, 1, 'das eigene bleibt unangetastet');
});

test('Sicherung und Wiederherstellung', async () => {
  const store = await frisch();
  await store.put('items', createItem({ name: 'Hemd weiß' }));
  await store.setSetting('ort', { name: 'Wallenhorst' });

  const sicherung = JSON.parse(store.export());
  assert.ok(sicherung.exportedAt);

  const leer = await frisch();
  await leer.replaceAll(sicherung);

  assert.equal(leer.all('items').length, 1);
  assert.equal(leer.getSetting('ort').name, 'Wallenhorst');
  assert.equal(leer.state.exportedAt, undefined, 'der Zeitstempel der Sicherung gehört nicht in die Daten');
});

test('kennt alle Sammlungen, die es gibt', async () => {
  const store = await frisch();
  for (const sammlung of COLLECTIONS) {
    assert.ok(store.state[sammlung], `${sammlung} ist angelegt`);
  }
});

test('Kennungen sind eindeutig und sagen, was sie sind', () => {
  const kennungen = new Set(Array.from({ length: 500 }, () => newId('item')));
  assert.equal(kennungen.size, 500);
  assert.ok([...kennungen][0].startsWith('item_'));
});

test('die Bitte um dauerhaften Speicher scheitert nie laut', async () => {
  assert.equal(await requestPersistence(undefined), 'unbekannt');
  assert.equal(await requestPersistence({ persist: async () => true }), 'dauerhaft');
  assert.equal(await requestPersistence({ persist: async () => false }), 'auf-widerruf');
  assert.equal(
    await requestPersistence({ persisted: async () => true, persist: async () => false }),
    'dauerhaft',
    'schon gewährt: nicht noch einmal fragen',
  );
  assert.equal(
    await requestPersistence({ persist: async () => { throw new Error('nein'); } }),
    'unbekannt',
  );
});

// --- Fotos ---------------------------------------------------------------

test('verkleinert nur, was zu groß ist', () => {
  assert.deepEqual(targetSize(4032, 3024), { width: MAX_EDGE, height: 480 });
  assert.deepEqual(targetSize(3024, 4032), { width: 480, height: MAX_EDGE });
  assert.deepEqual(targetSize(200, 150), { width: 200, height: 150 }, 'kleine Bilder bleiben klein');
  assert.deepEqual(targetSize(0, 0), { width: 0, height: 0 });
});

test('die Fotoablage behält Bilder je Teil', async () => {
  const ablage = new MemoryPhotoStore();
  await ablage.put('item_1', { size: 40_000 });
  await ablage.put('item_2', { size: 60_000 });

  assert.deepEqual(await ablage.keys(), ['item_1', 'item_2']);
  assert.equal(await ablage.usedBytes(), 100_000);

  await ablage.remove('item_1');
  assert.equal(await ablage.get('item_1'), undefined);
});

test('jede Bildadresse wird nur einmal angelegt und wieder freigegeben', async () => {
  const angelegt = [];
  const freigegeben = [];
  globalThis.URL.createObjectURL = (blob) => {
    const url = `blob:${angelegt.length}`;
    angelegt.push(blob);
    return url;
  };
  globalThis.URL.revokeObjectURL = (url) => freigegeben.push(url);

  const ablage = new MemoryPhotoStore();
  await ablage.put('item_1', { size: 10 });
  const urls = new PhotoUrls(ablage);

  const erste = await urls.urlFor('item_1');
  const zweite = await urls.urlFor('item_1');

  assert.equal(erste, zweite, 'dieselbe Adresse, kein zweiter Eintrag');
  assert.equal(angelegt.length, 1);

  assert.equal(await urls.urlFor('ohne-foto'), null);

  urls.clear();
  assert.deepEqual(freigegeben, [erste], 'die Adresse wird wieder freigegeben');
});

// --- Text ----------------------------------------------------------------

test('vereinheitlicht Schreibweisen', () => {
  assert.equal(normalize('Wollpullover GRAU'), 'wollpullover grau');
  assert.equal(normalize('Größe M'), 'groesse m');
  assert.equal(normalize('Levi’s 501'), 'levi s 501');
  assert.equal(normalize('Crème'), 'creme');
  assert.equal(normalize(null), '');
});

test('trifft Wortstämme an den Enden zusammengesetzter Wörter', () => {
  assert.ok(hasStem('Wollpullover', 'pullover'));
  assert.ok(hasStem('Regenjacke', 'regen'));
  assert.ok(!hasStem('Regenjacke', 'mantel'));
});

test('findet Teile über Bezeichnung und Marke', () => {
  const schrank = [
    createItem({ name: 'Oxfordhemd hellblau', brand: 'Uniqlo' }),
    createItem({ name: 'Jeans blau', brand: 'Levis' }),
    createItem({ name: 'Sneaker weiß', brand: 'Nike' }),
  ];

  assert.deepEqual(searchItems('hemd', schrank).map((i) => i.name), ['Oxfordhemd hellblau']);
  assert.deepEqual(searchItems('nike', schrank).map((i) => i.name), ['Sneaker weiß']);
  assert.equal(searchItems('blau', schrank).length, 2);
  assert.deepEqual(searchItems('mantel', schrank), []);

  assert.ok(
    scoreMatch('sneaker', schrank[2]) > scoreMatch('nike', schrank[2]),
    'ein Treffer in der Bezeichnung wiegt schwerer als einer in der Marke',
  );
});
