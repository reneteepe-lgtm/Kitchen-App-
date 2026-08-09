import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter } from '../js/storage.js';
import { Pantry, stockOf } from '../js/model.js';
import { stockAnswer } from '../js/search.js';

async function freshPantry() {
  const store = await new Store(new MemoryAdapter()).init();
  return new Pantry(store);
}

test('ein von Hand notierter Eintrag landet auf der Liste', async () => {
  const pantry = await freshPantry();
  await pantry.addWish('Backpulver');

  const list = pantry.manualList();
  assert.equal(list.length, 1);
  assert.equal(list[0].wish.text, 'Backpulver');
  assert.equal(list[0].product, null);
  assert.equal(list[0].stock, 0);
});

test('leere Eingaben werden nicht notiert', async () => {
  const pantry = await freshPantry();
  assert.equal(await pantry.addWish('   '), null);
  assert.equal(await pantry.addWish(''), null);
  assert.equal(pantry.manualList().length, 0);
});

test('ein Eintrag zeigt den Bestand des verknüpften Produkts', async () => {
  // Der Kern der Sache: Wer "Passata" notiert, obwohl noch fünf da sind,
  // soll das sehen, bevor er im Laden steht.
  const pantry = await freshPantry();
  const passata = await pantry.createProduct({ name: 'Passata 400 g' });
  await pantry.addStock(passata.id, 5);

  await pantry.addWish('Passata', passata.id);

  const [entry] = pantry.manualList();
  assert.equal(entry.product.name, 'Passata 400 g');
  assert.equal(entry.stock, 5);
});

test('die Suche verknüpft den Eintrag auch bei ungenauer Schreibweise', async () => {
  const pantry = await freshPantry();
  const joghurt = await pantry.createProduct({ name: 'Joghurt natur 500 g' });
  await pantry.addStock(joghurt.id, 2);

  const [best] = pantry.search('jogurt');
  await pantry.addWish('jogurt', best.product.id);

  const [entry] = pantry.manualList();
  assert.equal(entry.product.id, joghurt.id);
  assert.equal(entry.stock, 2);
});

test('ist der Bestand doch leer, sinkt der Hinweis auf null', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Passata' });
  await pantry.addStock(p.id, 3);
  await pantry.addWish('Passata', p.id);

  // Der Fall "die App sagt drei, im Schrank steht nichts".
  await pantry.setStock(p.id, 0);

  assert.equal(pantry.manualList()[0].stock, 0);
  // Als Korrektur gebucht, damit die Verbrauchsprognose unberührt bleibt.
  const types = pantry.eventsFor(p.id).map((e) => e.type);
  assert.deepEqual(types, ['purchase', 'correction']);
});

test('von Hand notierte Produkte erscheinen nicht doppelt', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Olivenöl', minStock: 1 });
  await pantry.addStock(p.id, 1);
  await pantry.consume(p.id, 1);

  // Leer -- also stünde es automatisch auf der Liste.
  assert.equal(pantry.shoppingList().length, 1);

  await pantry.addWish('Olivenöl', p.id);
  assert.equal(pantry.shoppingList().length, 0, 'automatischer Eintrag muss weichen');
  assert.equal(pantry.manualList().length, 1);
});

test('ein Eintrag ohne Produktbezug verdrängt nichts', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Olivenöl', minStock: 1 });
  await pantry.addStock(p.id, 1);
  await pantry.consume(p.id, 1);

  await pantry.addWish('Alufolie');
  assert.equal(pantry.shoppingList().length, 1);
  assert.equal(pantry.manualList().length, 1);
});

test('erledigte Einträge lassen sich entfernen', async () => {
  const pantry = await freshPantry();
  const wish = await pantry.addWish('Backpulver');

  await pantry.removeWish(wish.id);
  assert.equal(pantry.manualList().length, 0);
});

test('Einträge behalten die Reihenfolge, in der sie notiert wurden', async () => {
  const pantry = await freshPantry();
  for (const name of ['Erstes', 'Zweites', 'Drittes']) {
    await pantry.addWish(name);
    await new Promise((r) => setTimeout(r, 2));
  }
  assert.deepEqual(
    pantry.manualList().map((e) => e.wish.text),
    ['Erstes', 'Zweites', 'Drittes'],
  );
});

test('ein Eintrag überlebt das Löschen seines Produkts', async () => {
  // Sonst zeigte die Liste eine leere Zeile oder stürzte ab.
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Passata' });
  await pantry.addWish('Passata', p.id);
  await pantry.deleteProduct(p.id);

  const [entry] = pantry.manualList();
  assert.equal(entry.wish.text, 'Passata');
  assert.equal(entry.product, null);
  assert.equal(entry.stock, 0);
});

test('Einträge werden gesichert und beim Zusammenführen behalten', async () => {
  const a = await freshPantry();
  await a.addWish('Backpulver');

  const b = new Pantry(await new Store(new MemoryAdapter()).init());
  await b.store.replaceAll(JSON.parse(a.store.export()));
  assert.equal(b.manualList().length, 1);

  await b.addWish('Alufolie');
  await a.store.merge(JSON.parse(b.store.export()));
  assert.deepEqual(
    a.manualList().map((e) => e.wish.text).sort(),
    ['Alufolie', 'Backpulver'],
  );
});

test('die Suche beantwortet die Frage nach dem Vorrat', async () => {
  const pantry = await freshPantry();
  const nudeln = await pantry.createProduct({ name: 'Barilla Fusilli 500 g' });
  await pantry.addStock(nudeln.id, 3);
  const reis = await pantry.createProduct({ name: 'Basmatireis 1 kg' });
  await pantry.addStock(reis.id, 1);
  await pantry.consume(reis.id, 1);

  assert.equal(stockAnswer(pantry.search('fusilli')).kind, 'have');
  assert.equal(stockAnswer(pantry.search('fusilli')).stock, 3);
  assert.equal(stockAnswer(pantry.search('basmati')).kind, 'empty');
  assert.equal(stockAnswer(pantry.search('kaffee')).kind, 'unknown');
});

test('gelöschte Produkte tauchen in der Suche nicht mehr auf', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Kaffee' });
  await pantry.addStock(p.id, 2);
  assert.equal(stockOf(pantry.lots(), p.id), 2);

  await pantry.deleteProduct(p.id);
  assert.equal(stockAnswer(pantry.search('kaffee')).kind, 'unknown');
});
