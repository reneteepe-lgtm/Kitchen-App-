import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter } from '../js/storage.js';
import { Pantry, stockOf } from '../js/model.js';
import { estimateConsumptionRate } from '../js/forecast.js';

async function freshPantry() {
  const store = await new Store(new MemoryAdapter()).init();
  return new Pantry(store);
}

test('ein versehentlicher Verbrauch lässt sich zurücknehmen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Nudeln' });
  await pantry.addStock(p.id, 3);
  await pantry.consume(p.id, 1);
  assert.equal(stockOf(pantry.lots(), p.id), 2);

  assert.equal(await pantry.undo(), true);
  assert.equal(stockOf(pantry.lots(), p.id), 3);

  // Entscheidend: die Fehlbuchung darf auch die Prognose nicht mehr belasten.
  const consumeEvents = pantry.eventsFor(p.id).filter((e) => e.type === 'consume');
  assert.equal(consumeEvents.length, 0);
});

test('ein versehentlicher Einkauf lässt sich zurücknehmen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Reis' });
  await pantry.addStock(p.id, 2);
  await pantry.addStock(p.id, 5);
  assert.equal(stockOf(pantry.lots(), p.id), 7);

  await pantry.undo();
  assert.equal(stockOf(pantry.lots(), p.id), 2);
  assert.equal(pantry.eventsFor(p.id).length, 1);
});

test('Rückgängig wirkt nur einmal', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Mehl' });
  await pantry.addStock(p.id, 4);
  await pantry.consume(p.id, 2);

  assert.equal(await pantry.undo(), true);
  assert.equal(await pantry.undo(), false);
  assert.equal(stockOf(pantry.lots(), p.id), 4);
});

test('Verbrauch über mehrere Chargen wird vollständig zurückgenommen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Joghurt' });
  await pantry.addStock(p.id, 2, '2026-07-01');
  await pantry.addStock(p.id, 3, '2026-09-01');

  await pantry.consume(p.id, 4);
  assert.equal(stockOf(pantry.lots(), p.id), 1);

  await pantry.undo();
  assert.equal(stockOf(pantry.lots(), p.id), 5);
});

test('Daten überstehen Export und Wiedereinlesen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Kaffee', minStock: 2 });
  await pantry.addStock(p.id, 3, '2027-01-01');
  await pantry.consume(p.id, 1);

  const backup = JSON.parse(pantry.store.export());

  const restored = new Pantry(await new Store(new MemoryAdapter()).init());
  await restored.store.replaceAll(backup);

  assert.equal(restored.products()[0].name, 'Kaffee');
  assert.equal(stockOf(restored.lots(), p.id), 2);
  assert.equal(restored.eventsFor(p.id).length, 2);
});

test('Zusammenführen zweier Geräte behält beide Buchungen', async () => {
  // Vorbereitung für späteren Sync: zwei Stände derselben Daten.
  const a = await freshPantry();
  const p = await a.createProduct({ name: 'Nudeln' });
  await a.addStock(p.id, 4);

  const b = new Pantry(await new Store(new MemoryAdapter()).init());
  await b.store.replaceAll(JSON.parse(a.store.export()));

  // Beide buchen unabhängig voneinander.
  await a.consume(p.id, 1);
  await b.consume(p.id, 1);

  await a.store.merge(JSON.parse(b.store.export()));

  const consumes = a.eventsFor(p.id).filter((e) => e.type === 'consume');
  assert.equal(consumes.length, 2, 'Buchungen dürfen sich beim Merge nicht überschreiben');
});

test('gelöschte Produkte kehren beim Zusammenführen nicht zurück', async () => {
  const a = await freshPantry();
  const p = await a.createProduct({ name: 'Salz' });

  const stale = JSON.parse(a.store.export());
  await a.deleteProduct(p.id);
  await a.store.merge(stale);

  assert.equal(a.products().length, 0);
});

test('Korrekturbuchungen heben die Verbrauchsprognose nicht an', async () => {
  // Eine Inventur ist keine Aussage über die Verbrauchsgeschwindigkeit.
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Mehl' });
  await pantry.addStock(p.id, 20);
  await pantry.setStock(p.id, 2);

  const rate = estimateConsumptionRate({
    events: pantry.eventsFor(p.id).filter((e) => e.type === 'correction'),
    observedSince: p.createdAt,
  });
  assert.equal(rate.evidence, 0, 'Korrekturen zählen nicht als Verbrauch');
});
