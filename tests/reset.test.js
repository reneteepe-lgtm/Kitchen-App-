import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter } from '../js/storage.js';
import { Pantry, stockOf } from '../js/model.js';
import { DAY_MS } from '../js/forecast.js';

async function freshPantry() {
  const store = await new Store(new MemoryAdapter()).init();
  return new Pantry(store);
}

/** Ein Produkt mit Historie, wie sie beim Herumtippen entsteht. */
async function withHistory(pantry, name = 'Nudeln') {
  const product = await pantry.createProduct({ name, minStock: 1 });
  await pantry.addStock(product.id, 5);
  await pantry.consume(product.id, 1);
  await pantry.consume(product.id, 1);
  await pantry.addStock(product.id, 2);
  return product;
}

test('Zurücksetzen löscht die Buchungen und lässt den Bestand stehen', async () => {
  const pantry = await freshPantry();
  const product = await withHistory(pantry);
  const before = stockOf(pantry.lots(), product.id);
  assert.ok(pantry.eventsFor(product.id).length >= 4);

  assert.equal(await pantry.resetForecast(product.id), true);

  assert.equal(pantry.eventsFor(product.id).length, 0, 'keine Buchung bleibt übrig');
  assert.equal(stockOf(pantry.lots(), product.id), before, 'der Bestand darf sich nicht ändern');
});

test('nach dem Zurücksetzen lernt die App wieder von vorn', async () => {
  const pantry = await freshPantry();
  const product = await withHistory(pantry);

  await pantry.resetForecast(product.id);

  const assessment = pantry.assess(pantry.products()[0]);
  assert.equal(assessment.confidence.level, 'learning');
  assert.equal(assessment.rate.evidence, 0);
});

test('der Beobachtungsbeginn wandert auf jetzt', async () => {
  // Sonst zählte die Zeit davor als Zeitraum ohne Verbrauch und die
  // geschätzte Rate fiele gegen null -- die App verspräche eine viel zu
  // lange Reichweite.
  const pantry = await freshPantry();
  const store = pantry.store;

  const alt = await pantry.createProduct({ name: 'Reis' });
  await store.put('products', {
    ...store.byId('products', alt.id),
    createdAt: new Date(Date.now() - 200 * DAY_MS).toISOString(),
  });
  await pantry.addStock(alt.id, 2);

  await pantry.resetForecast(alt.id);
  const product = pantry.products()[0];
  assert.ok(product.observedSince, 'observedSince muss gesetzt sein');

  const rate = pantry.assess(product).rate;
  assert.ok(rate.observedDays < 1, `Beobachtungszeitraum war ${rate.observedDays} Tage`);

  // Und die Reichweite bleibt in einem sinnvollen Rahmen statt ins
  // Unendliche zu laufen.
  const projection = pantry.assess(product).projection;
  assert.ok(projection.daysLeft < 120, `Reichweite war ${projection.daysLeft} Tage`);
});

test('Zurücksetzen betrifft nur das gewählte Produkt', async () => {
  const pantry = await freshPantry();
  const a = await withHistory(pantry, 'Nudeln');
  const b = await withHistory(pantry, 'Reis');

  await pantry.resetForecast(a.id);

  assert.equal(pantry.eventsFor(a.id).length, 0);
  assert.ok(pantry.eventsFor(b.id).length >= 4, 'das andere Produkt bleibt unberührt');
});

test('alles auf einmal zurücksetzen', async () => {
  const pantry = await freshPantry();
  await withHistory(pantry, 'Nudeln');
  await withHistory(pantry, 'Reis');
  await withHistory(pantry, 'Mehl');

  assert.equal(await pantry.resetAllForecasts(), 3);
  assert.equal(pantry.events().length, 0);

  for (const product of pantry.products()) {
    assert.ok(stockOf(pantry.lots(), product.id) > 0, `${product.name} hat seinen Bestand verloren`);
    assert.equal(pantry.assess(product).confidence.level, 'learning');
  }
});

test('nach dem Zurücksetzen zählen neue Buchungen wieder', async () => {
  const pantry = await freshPantry();
  const product = await withHistory(pantry);
  await pantry.resetForecast(product.id);

  await pantry.consume(product.id, 1);
  const events = pantry.eventsFor(product.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'consume');
});

test('Zurücksetzen rührt Einkaufsliste und Haltbarkeit nicht an', async () => {
  const pantry = await freshPantry();
  const product = await pantry.createProduct({ name: 'Joghurt', minStock: 2 });
  await pantry.addStock(product.id, 3, '2026-12-01');
  await pantry.addWish('Joghurt', product.id);

  await pantry.resetForecast(product.id);

  assert.equal(pantry.manualList().length, 1);
  assert.equal(pantry.lots()[0].bestBefore, '2026-12-01');
});

test('ein unbekanntes Produkt lässt sich nicht zurücksetzen', async () => {
  const pantry = await freshPantry();
  assert.equal(await pantry.resetForecast('gibtsnicht'), false);
});
