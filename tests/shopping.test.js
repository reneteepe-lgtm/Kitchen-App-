import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter } from '../js/storage.js';
import { Pantry } from '../js/model.js';
import { DAY_MS } from '../js/forecast.js';

async function freshPantry() {
  const store = await new Store(new MemoryAdapter()).init();
  return new Pantry(store);
}

/** Ein Produkt, das leer ist und deshalb vorgeschlagen wird. */
async function emptyProduct(pantry, name, options = {}) {
  const product = await pantry.createProduct({ name, minStock: 1, ...options });
  await pantry.addStock(product.id, 1);
  await pantry.consume(product.id, 1);
  return product;
}

const suggestedNames = (pantry) => pantry.shoppingList().map((i) => i.product.name);
const listedNames = (pantry) => pantry.manualList().map((e) => e.wish.text);

test('ein Vorschlag lässt sich auf die Einkaufsliste übernehmen', async () => {
  const pantry = await freshPantry();
  const oel = await emptyProduct(pantry, 'Olivenöl');
  assert.deepEqual(suggestedNames(pantry), ['Olivenöl']);

  await pantry.acceptSuggestion(oel);

  assert.deepEqual(suggestedNames(pantry), [], 'aus den Vorschlägen verschwunden');
  assert.deepEqual(listedNames(pantry), ['Olivenöl'], 'auf der Einkaufsliste gelandet');
  assert.equal(pantry.manualList()[0].product.id, oel.id, 'mit dem Produkt verknüpft');
});

test('ein Vorschlag lässt sich ablehnen und ruht danach', async () => {
  // Nicht alles, was leer ist, wird sofort nachgekauft.
  const pantry = await freshPantry();
  const tabs = await emptyProduct(pantry, 'Spülmaschinentabs');

  await pantry.snoozeSuggestion(tabs.id, 30);
  assert.deepEqual(suggestedNames(pantry), []);

  // Nach Ablauf der Frist wieder da.
  const later = new Date(Date.now() + 31 * DAY_MS);
  assert.deepEqual(
    pantry.shoppingList(later).map((i) => i.product.name),
    ['Spülmaschinentabs'],
  );
});

test('ein versehentlich abgelehnter Vorschlag lässt sich zurückholen', async () => {
  // Der Toast bietet "Rückgängig" an -- das muss auch das Ablehnen
  // umfassen und nicht die davor liegende Buchung treffen.
  const pantry = await freshPantry();
  const tabs = await emptyProduct(pantry, 'Spülmaschinentabs');
  await pantry.snoozeSuggestion(tabs.id);
  assert.deepEqual(suggestedNames(pantry), []);

  assert.equal(await pantry.undo(), true);
  assert.deepEqual(suggestedNames(pantry), ['Spülmaschinentabs']);
  assert.equal(pantry.products()[0].snoozedUntil, null);
});

test('Rückgängig nach dem Ablehnen fasst den Bestand nicht an', async () => {
  const pantry = await freshPantry();
  const p = await pantry.createProduct({ name: 'Mehl', minStock: 1 });
  await pantry.addStock(p.id, 2);
  await pantry.consume(p.id, 2);

  await pantry.snoozeSuggestion(p.id);
  await pantry.undo();

  // Die Verbrauchsbuchung davor muss unberührt bleiben.
  assert.equal(pantry.eventsFor(p.id).filter((e) => e.type === 'consume').length, 1);
  assert.deepEqual(suggestedNames(pantry), ['Mehl']);
});

test('ein abgelehnter Vorschlag landet nicht auf der Einkaufsliste', async () => {
  const pantry = await freshPantry();
  const tabs = await emptyProduct(pantry, 'Spülmaschinentabs');
  await pantry.snoozeSuggestion(tabs.id);

  assert.deepEqual(listedNames(pantry), []);
});

test('nach einem Kauf gilt die Ablehnung nicht mehr', async () => {
  // Sonst schwiege die App auch beim nächsten Leerstand noch.
  const pantry = await freshPantry();
  const tabs = await emptyProduct(pantry, 'Spülmaschinentabs');
  await pantry.snoozeSuggestion(tabs.id, 30);

  await pantry.addStock(tabs.id, 1);
  assert.equal(pantry.products().find((p) => p.id === tabs.id).snoozedUntil, null);

  await pantry.consume(tabs.id, 1);
  assert.deepEqual(suggestedNames(pantry), ['Spülmaschinentabs']);
});

test('ein Produkt kann dauerhaft aus den Vorschlägen genommen werden', async () => {
  const pantry = await freshPantry();
  const tabs = await emptyProduct(pantry, 'Spülmaschinentabs');

  await pantry.updateProduct(tabs, { suggest: false });
  assert.deepEqual(suggestedNames(pantry), []);

  // Auch in ferner Zukunft still -- anders als beim zeitweisen Ablehnen.
  const later = new Date(Date.now() + 400 * DAY_MS);
  assert.deepEqual(pantry.shoppingList(later), []);
});

test('neu angelegte Produkte werden standardmäßig vorgeschlagen', async () => {
  const pantry = await freshPantry();
  const p = await emptyProduct(pantry, 'Mehl');
  assert.equal(p.suggest, true);
  assert.deepEqual(suggestedNames(pantry), ['Mehl']);
});

test('Produkte aus älteren Sicherungen werden weiter vorgeschlagen', async () => {
  // Vor dieser Version gab es das Feld nicht; fehlt es, gilt "vorschlagen".
  const pantry = await freshPantry();
  await pantry.store.replaceAll({
    products: { p1: { id: 'p1', name: 'Altbestand', minStock: 1, createdAt: '2026-01-01T00:00:00Z' } },
    lots: {},
    events: {},
    wishes: {},
    settings: {},
  });
  assert.deepEqual(suggestedNames(pantry), ['Altbestand']);
});

// --- Abhaken im Laden ---------------------------------------------------

test('ein Eintrag lässt sich abhaken und wieder freigeben', async () => {
  const pantry = await freshPantry();
  const wish = await pantry.addWish('Alufolie');

  await pantry.setWishDone(wish.id, true);
  assert.equal(pantry.manualList()[0].wish.done, true);

  await pantry.setWishDone(wish.id, false);
  assert.equal(pantry.manualList()[0].wish.done, false);
});

test('Abgehaktes rutscht ans Ende der Liste', async () => {
  const pantry = await freshPantry();
  const erst = await pantry.addWish('Erstes');
  await new Promise((r) => setTimeout(r, 2));
  await pantry.addWish('Zweites');
  await new Promise((r) => setTimeout(r, 2));
  await pantry.addWish('Drittes');

  await pantry.setWishDone(erst.id, true);
  assert.deepEqual(listedNames(pantry), ['Zweites', 'Drittes', 'Erstes']);
});

test('abgehakte Einträge lassen sich gesammelt wegräumen', async () => {
  const pantry = await freshPantry();
  const a = await pantry.addWish('Alufolie');
  const b = await pantry.addWish('Backpulver');
  await pantry.addWish('Chili');

  await pantry.setWishDone(a.id, true);
  await pantry.setWishDone(b.id, true);

  assert.equal(await pantry.clearDoneWishes(), 2);
  assert.deepEqual(listedNames(pantry), ['Chili']);
});

test('ohne Abgehaktes räumt das Wegräumen nichts weg', async () => {
  const pantry = await freshPantry();
  await pantry.addWish('Chili');
  assert.equal(await pantry.clearDoneWishes(), 0);
  assert.deepEqual(listedNames(pantry), ['Chili']);
});

test('Abhaken allein bucht noch keinen Bestand ein', async () => {
  // Im Wagen liegen heißt nicht im Schrank stehen.
  const pantry = await freshPantry();
  const p = await emptyProduct(pantry, 'Olivenöl');
  const wish = await pantry.acceptSuggestion(p);

  await pantry.setWishDone(wish.id, true);
  assert.equal(pantry.manualList()[0].stock, 0);
  assert.equal(pantry.eventsFor(p.id).filter((e) => e.type === 'purchase').length, 1);
});

test('unbekannte Einträge und Produkte führen zu keiner Änderung', async () => {
  const pantry = await freshPantry();
  assert.equal(await pantry.setWishDone('gibtsnicht', true), null);
  assert.equal(await pantry.snoozeSuggestion('gibtsnicht'), null);
});
