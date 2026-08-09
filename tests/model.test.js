import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter } from '../js/storage.js';
import { Pantry, planConsumption, stockOf, lotsFor, nextExpiry, daysUntil } from '../js/model.js';
import { DAY_MS } from '../js/forecast.js';

const isoDay = (offsetDays) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

async function freshPantry() {
  const store = await new Store(new MemoryAdapter()).init();
  return new Pantry(store);
}

const lot = (id, productId, qty, bestBefore = null, addedAt = '2026-01-01T00:00:00Z') => ({
  id,
  productId,
  qty,
  bestBefore,
  addedAt,
});

test('Bestand ist die Summe aller Chargen', () => {
  const lots = [lot('l1', 'p1', 2), lot('l2', 'p1', 3), lot('l3', 'p2', 5)];
  assert.equal(stockOf(lots, 'p1'), 5);
  assert.equal(stockOf(lots, 'p2'), 5);
  assert.equal(stockOf(lots, 'p3'), 0);
});

test('Chargen mit MHD werden zuerst verbraucht, früheste zuerst', () => {
  const lots = [
    lot('spaet', 'p1', 1, '2026-12-01'),
    lot('ohne', 'p1', 1, null),
    lot('frueh', 'p1', 1, '2026-07-01'),
  ];
  assert.deepEqual(
    lotsFor(lots, 'p1').map((l) => l.id),
    ['frueh', 'spaet', 'ohne'],
  );
});

test('planConsumption nimmt nach FEFO und meldet Unterdeckung', () => {
  const lots = [lot('a', 'p1', 2, '2026-07-01'), lot('b', 'p1', 3, '2026-09-01')];

  const one = planConsumption(lots, 'p1', 1);
  assert.equal(one.taken, 1);
  assert.equal(one.short, 0);
  assert.deepEqual(one.updates, [{ lot: lots[0], qty: 1 }]);

  // Über eine Charge hinaus: erste wird geleert, zweite angebrochen.
  const three = planConsumption(lots, 'p1', 3);
  assert.equal(three.taken, 3);
  assert.deepEqual(
    three.updates.map((u) => [u.lot.id, u.qty]),
    [
      ['a', 0],
      ['b', 2],
    ],
  );

  const tooMuch = planConsumption(lots, 'p1', 9);
  assert.equal(tooMuch.taken, 5);
  assert.equal(tooMuch.short, 4);
});

test('planConsumption verändert die übergebenen Chargen nicht', () => {
  const lots = [lot('a', 'p1', 2)];
  planConsumption(lots, 'p1', 2);
  assert.equal(lots[0].qty, 2);
});

test('Einkauf und Verbrauch verändern den Bestand und schreiben Buchungen', async () => {
  const pantry = await freshPantry();
  const nudeln = await pantry.createProduct({ name: 'Fusilli 500g', minStock: 2 });

  await pantry.addStock(nudeln.id, 4);
  assert.equal(stockOf(pantry.lots(), nudeln.id), 4);

  const result = await pantry.consume(nudeln.id, 1);
  assert.deepEqual(result, { taken: 1, short: 0 });
  assert.equal(stockOf(pantry.lots(), nudeln.id), 3);

  const events = pantry.eventsFor(nudeln.id);
  assert.deepEqual(
    events.map((e) => [e.type, e.qty]),
    [
      ['purchase', 4],
      ['consume', 1],
    ],
  );
});

test('Verbrauch über den Bestand hinaus bucht nur, was da ist', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Reis' });
  await pantry.addStock(p.id, 2);

  const result = await pantry.consume(p.id, 5);
  assert.deepEqual(result, { taken: 2, short: 3 });
  assert.equal(stockOf(pantry.lots(), p.id), 0);
  assert.equal(pantry.eventsFor(p.id).filter((e) => e.type === 'consume')[0].qty, 2);
});

test('Verbrauch bei leerem Bestand schreibt keine Buchung', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Salz' });

  const result = await pantry.consume(p.id, 1);
  assert.deepEqual(result, { taken: 0, short: 1 });
  assert.equal(pantry.eventsFor(p.id).length, 0);
});

test('Inventur wird als Korrektur gebucht, nicht als Verbrauch', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Mehl' });
  await pantry.addStock(p.id, 5);

  await pantry.setStock(p.id, 2);
  assert.equal(stockOf(pantry.lots(), p.id), 2);

  // Entscheidend: eine Korrektur darf die Verbrauchsprognose nicht anheben.
  const types = pantry.eventsFor(p.id).map((e) => e.type);
  assert.deepEqual(types, ['purchase', 'correction']);

  await pantry.setStock(p.id, 6);
  assert.equal(stockOf(pantry.lots(), p.id), 6);
});

test('Chargen mit nahem MHD werden gemeldet, ferne nicht', async () => {
  const pantry = await freshPantry();
  const joghurt = await pantry.createProduct({ name: 'Joghurt' });
  await pantry.addStock(joghurt.id, 2, isoDay(2));
  await pantry.addStock(joghurt.id, 3, isoDay(60));

  const warnings = pantry.expiringSoon();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].days, 2);
  assert.equal(warnings[0].product.name, 'Joghurt');

  const expiry = nextExpiry(pantry.lots(), joghurt.id);
  assert.equal(expiry.days, 2);
});

test('abgelaufene Chargen erscheinen mit negativer Restlaufzeit', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Sahne' });
  await pantry.addStock(p.id, 1, isoDay(-3));

  const warnings = pantry.expiringSoon();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].days, -3);
});

test('Einkaufsliste sortiert Leeres vor Knappem', async () => {
  const pantry = await freshPantry();
  const leer = await pantry.createProduct({ name: 'Olivenöl', minStock: 1 });
  const knapp = await pantry.createProduct({ name: 'Nudeln', minStock: 2 });
  const genug = await pantry.createProduct({ name: 'Salz', minStock: 1 });

  await pantry.addStock(leer.id, 1);
  await pantry.consume(leer.id, 1);
  await pantry.addStock(knapp.id, 2);
  await pantry.addStock(genug.id, 20);

  const list = pantry.shoppingList();
  assert.deepEqual(
    list.map((i) => [i.product.name, i.need.reason]),
    [
      ['Olivenöl', 'empty'],
      ['Nudeln', 'below-min'],
    ],
  );
});

test('gelöschte Produkte verschwinden samt Chargen aus dem Bestand', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Kaffee' });
  await pantry.addStock(p.id, 3);

  await pantry.deleteProduct(p.id);
  assert.equal(pantry.products().length, 0);
  assert.equal(stockOf(pantry.lots(), p.id), 0);
});

test('Produkte werden über den Barcode wiedergefunden', async () => {
  const pantry = await freshPantry();
  await pantry.createProduct({ name: 'Passata', barcode: '4001234567890' });

  assert.equal(pantry.findByBarcode('4001234567890').name, 'Passata');
  assert.equal(pantry.findByBarcode('0000000000000'), undefined);
  assert.equal(pantry.findByBarcode(null), undefined);
});

test('daysUntil ignoriert die Uhrzeit', () => {
  const from = new Date('2026-06-01T23:30:00Z');
  from.setHours(0, 0, 0, 0);
  assert.equal(daysUntil('2026-06-01', from), 0);
  assert.equal(daysUntil('2026-06-04', from), 3);
  assert.equal(daysUntil(null, from), null);
});
