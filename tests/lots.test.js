import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter } from '../js/storage.js';
import { Pantry, stockOf, lotsFor, nextExpiry } from '../js/model.js';
import { estimateConsumptionRate } from '../js/forecast.js';

async function freshPantry() {
  const store = await new Store(new MemoryAdapter()).init();
  return new Pantry(store);
}

const datesOf = (pantry, productId) =>
  lotsFor(pantry.lots(), productId).map((lot) => [lot.qty, lot.bestBefore]);

test('ein Einkauf kann mehrere Haltbarkeitsdaten tragen', async () => {
  const pantry = await freshPantry();
  const joghurt = await pantry.createProduct({ name: 'Joghurt' });

  await pantry.addStockBatches(joghurt.id, [
    { qty: 2, bestBefore: '2026-08-20' },
    { qty: 1, bestBefore: '2026-08-14' },
  ]);

  assert.equal(stockOf(pantry.lots(), joghurt.id), 3);
  // Nach Ablaufdatum sortiert: das knappste zuerst.
  assert.deepEqual(datesOf(pantry, joghurt.id), [
    [1, '2026-08-14'],
    [2, '2026-08-20'],
  ]);
});

test('mehrere Daten ergeben trotzdem nur eine Einkaufsbuchung', async () => {
  // Für die Prognose zählt die gekaufte Menge, nicht ihre Aufteilung.
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Joghurt' });

  await pantry.addStockBatches(p.id, [
    { qty: 2, bestBefore: '2026-08-20' },
    { qty: 3, bestBefore: '2026-08-25' },
  ]);

  const events = pantry.eventsFor(p.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'purchase');
  assert.equal(events[0].qty, 5);
});

test('gleiche Daten werden zu einer Charge zusammengefasst', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Milch' });

  await pantry.addStockBatches(p.id, [
    { qty: 1, bestBefore: '2026-08-20' },
    { qty: 1, bestBefore: '2026-08-20' },
    { qty: 1, bestBefore: null },
  ]);

  assert.deepEqual(datesOf(pantry, p.id), [
    [2, '2026-08-20'],
    [1, null],
  ]);
});

test('leere oder ungültige Angaben werden übergangen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Reis' });

  await pantry.addStockBatches(p.id, [
    { qty: 0, bestBefore: '2026-08-20' },
    { qty: 2, bestBefore: null },
    { qty: -3, bestBefore: null },
  ]);

  assert.equal(stockOf(pantry.lots(), p.id), 2);
  assert.equal(pantry.eventsFor(p.id).length, 1);
});

test('gar nichts einzubuchen schreibt auch keine Buchung', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Reis' });

  assert.deepEqual(await pantry.addStockBatches(p.id, []), []);
  assert.equal(pantry.eventsFor(p.id).length, 0);
});

test('addStock bleibt der einfache Weg für eine Charge', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Nudeln' });

  const lot = await pantry.addStock(p.id, 3, '2027-01-01');
  assert.equal(lot.qty, 3);
  assert.equal(lot.bestBefore, '2027-01-01');
  assert.equal(stockOf(pantry.lots(), p.id), 3);
});

test('ein Haltbarkeitsdatum lässt sich nachtragen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Sahne' });
  const lot = await pantry.addStock(p.id, 2);
  assert.equal(nextExpiry(pantry.lots(), p.id), null);

  await pantry.setLotExpiry(lot.id, '2026-09-01');
  assert.equal(nextExpiry(pantry.lots(), p.id).lot.bestBefore, '2026-09-01');

  // Nachtragen ist keine Bestandsänderung und darf nichts buchen.
  assert.equal(pantry.eventsFor(p.id).filter((e) => e.type !== 'purchase').length, 0);
});

test('eine Charge lässt sich mit eigenem Datum aufteilen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Joghurt' });
  const lot = await pantry.addStock(p.id, 3, '2026-08-25');

  await pantry.splitLot(lot.id, 1, '2026-08-15');

  assert.equal(stockOf(pantry.lots(), p.id), 3, 'der Bestand darf sich nicht ändern');
  assert.deepEqual(datesOf(pantry, p.id), [
    [1, '2026-08-15'],
    [2, '2026-08-25'],
  ]);
  // Umsortieren im Schrank ist kein Einkauf und kein Verbrauch.
  assert.equal(pantry.eventsFor(p.id).length, 1);
});

test('die ganze Charge abzutrennen ändert nur ihr Datum', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Joghurt' });
  const lot = await pantry.addStock(p.id, 2, '2026-08-25');

  await pantry.splitLot(lot.id, 2, '2026-08-15');

  assert.deepEqual(datesOf(pantry, p.id), [[2, '2026-08-15']]);
});

test('Aufteilen lässt sich zurücknehmen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Joghurt' });
  const lot = await pantry.addStock(p.id, 3, '2026-08-25');

  await pantry.splitLot(lot.id, 1, '2026-08-15');
  await pantry.undo();

  assert.deepEqual(datesOf(pantry, p.id), [[3, '2026-08-25']]);
});

test('Verbrauch nimmt nach dem Aufteilen die knappste Charge zuerst', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Joghurt' });
  const lot = await pantry.addStock(p.id, 3, '2026-08-25');
  await pantry.splitLot(lot.id, 1, '2026-08-15');

  await pantry.consume(p.id, 1);
  assert.deepEqual(datesOf(pantry, p.id), [[2, '2026-08-25']]);
});

test('Entsorgen senkt den Bestand, ohne die Prognose anzuheben', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Sahne' });
  const lot = await pantry.addStock(p.id, 2, '2026-08-01');

  assert.equal(await pantry.discardLot(lot.id), true);
  assert.equal(stockOf(pantry.lots(), p.id), 0);

  const discards = pantry.eventsFor(p.id).filter((e) => e.type === 'discard');
  assert.equal(discards.length, 1);

  // Entscheidend: Weggeworfenes zählt nicht als Verbrauch.
  const rate = estimateConsumptionRate({
    events: pantry.eventsFor(p.id).filter((e) => e.type === 'discard'),
    observedSince: p.createdAt,
  });
  assert.equal(rate.evidence, 0);
});

test('Entsorgen lässt sich zurücknehmen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Sahne' });
  const lot = await pantry.addStock(p.id, 2, '2026-08-01');

  await pantry.discardLot(lot.id);
  await pantry.undo();

  assert.equal(stockOf(pantry.lots(), p.id), 2);
  assert.equal(pantry.eventsFor(p.id).filter((e) => e.type === 'discard').length, 0);
});

test('eine bereits leere Charge lässt sich nicht entsorgen', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Sahne' });
  const lot = await pantry.addStock(p.id, 1);
  await pantry.consume(p.id, 1);

  assert.equal(await pantry.discardLot(lot.id), false);
});

test('unbekannte Chargen führen zu keiner Änderung', async () => {
  const pantry = await freshPantry();
  assert.equal(await pantry.setLotExpiry('gibtsnicht', '2026-08-01'), null);
  assert.equal(await pantry.splitLot('gibtsnicht', 1, '2026-08-01'), null);
  assert.equal(await pantry.discardLot('gibtsnicht'), false);
});
