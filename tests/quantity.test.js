import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter } from '../js/storage.js';
import { Pantry } from '../js/model.js';

const parse = Pantry.parseQuantity;

async function freshPantry() {
  const store = await new Store(new MemoryAdapter()).init();
  return new Pantry(store);
}

// --- Stückzahl aus dem Text lesen ---------------------------------------

test('eine vorangestellte Zahl wird als Stückzahl gelesen', () => {
  assert.deepEqual(parse('3 Milch'), { qty: 3, text: 'Milch' });
  assert.deepEqual(parse('2 Passata 400 g'), { qty: 2, text: 'Passata 400 g' });
  assert.deepEqual(parse('12 Eier'), { qty: 12, text: 'Eier' });
});

test('die Schreibweise mit x wird ebenso verstanden', () => {
  assert.deepEqual(parse('3x Milch'), { qty: 3, text: 'Milch' });
  assert.deepEqual(parse('3× Milch'), { qty: 3, text: 'Milch' });
  assert.deepEqual(parse('3 x Milch'), { qty: 3, text: 'Milch' });
  assert.deepEqual(parse('2*Joghurt'.replace('*', '* ')), { qty: 2, text: 'Joghurt' });
});

test('Mengenangaben auf der Packung bleiben Teil des Namens', () => {
  // "500 g Mehl" ist eine Packung, keine fünfhundert.
  assert.deepEqual(parse('500 g Mehl'), { qty: 1, text: '500 g Mehl' });
  assert.deepEqual(parse('1 kg Zucker'), { qty: 1, text: '1 kg Zucker' });
  assert.deepEqual(parse('200 ml Sahne'), { qty: 1, text: '200 ml Sahne' });
  assert.deepEqual(parse('400 g Dose Tomaten'), { qty: 1, text: '400 g Dose Tomaten' });
});

test('mit ausdrücklichem x zählt die Zahl trotzdem', () => {
  assert.deepEqual(parse('2x 500 g Mehl'), { qty: 2, text: '500 g Mehl' });
});

test('ohne Zahl bleibt alles wie eingegeben', () => {
  assert.deepEqual(parse('Milch'), { qty: 1, text: 'Milch' });
  assert.deepEqual(parse('Crème fraîche'), { qty: 1, text: 'Crème fraîche' });
  assert.deepEqual(parse(''), { qty: 1, text: '' });
  assert.deepEqual(parse('   '), { qty: 1, text: '' });
});

test('unsinnige Zahlen werden nicht als Menge gedeutet', () => {
  assert.deepEqual(parse('0 Milch'), { qty: 1, text: '0 Milch' });
  assert.deepEqual(parse('250 Blatt Küchenrolle'), { qty: 1, text: '250 Blatt Küchenrolle' });
});

test('eine Zahl ohne folgenden Text bleibt der Text', () => {
  assert.deepEqual(parse('3'), { qty: 1, text: '3' });
  assert.deepEqual(parse('3x'), { qty: 1, text: '3x' });
});

// --- Stückzahl am Eintrag ------------------------------------------------

test('ein Eintrag merkt sich die Stückzahl', async () => {
  const pantry = await freshPantry();
  const wish = await pantry.addWish('Milch', null, 3);
  assert.equal(wish.qty, 3);
  assert.equal(pantry.manualList()[0].wish.qty, 3);
});

test('ohne Angabe steht die Stückzahl auf eins', async () => {
  const pantry = await freshPantry();
  const wish = await pantry.addWish('Alufolie');
  assert.equal(wish.qty, 1);
});

test('die Stückzahl lässt sich ändern', async () => {
  const pantry = await freshPantry();
  const wish = await pantry.addWish('Milch');

  await pantry.setWishQty(wish.id, 4);
  assert.equal(pantry.manualList()[0].wish.qty, 4);
});

test('unsinnige Stückzahlen werden auf eins gezogen', async () => {
  const pantry = await freshPantry();
  const wish = await pantry.addWish('Milch', null, 0);
  assert.equal(wish.qty, 1);

  await pantry.setWishQty(wish.id, -5);
  assert.equal(pantry.manualList()[0].wish.qty, 1);

  await pantry.setWishQty(wish.id, 2.7);
  assert.equal(pantry.manualList()[0].wish.qty, 3, 'wird gerundet');
});

test('Einträge aus früheren Fassungen gelten als einmal', async () => {
  // Vor dieser Version gab es das Feld nicht.
  const pantry = await freshPantry();
  await pantry.store.replaceAll({
    products: {}, lots: {}, events: {},
    wishes: { w1: { id: 'w1', text: 'Milch', productId: null, createdAt: '2026-08-01T00:00:00Z' } },
    settings: {},
  });
  const [entry] = pantry.manualList();
  assert.equal(entry.wish.qty ?? 1, 1);
});

test('ein unbekannter Eintrag lässt sich nicht ändern', async () => {
  const pantry = await freshPantry();
  assert.equal(await pantry.setWishQty('gibtsnicht', 3), null);
});
