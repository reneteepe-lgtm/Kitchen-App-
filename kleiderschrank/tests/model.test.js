import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryAdapter, Store } from '../js/storage.js';
import {
  createItem,
  addItem,
  updateItem,
  wearItems,
  wearOutfit,
  saveOutfit,
  rateOutfit,
  itemsOf,
  isComplete,
  countBySlot,
  forgottenItems,
  wearRate,
  daysSince,
  VERDICT,
} from '../js/model.js';

const frischerStore = () => new Store(new MemoryAdapter()).init();

const vorTagen = (tage) => new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString();

test('legt ein Kleidungsstück an und rät, was es ist', async () => {
  const item = createItem({ name: 'Wollpullover grau', brand: 'Uniqlo' });

  assert.equal(item.slot, 'top');
  assert.equal(item.warmth, 4);
  assert.deepEqual(item.colors, ['grau']);
  assert.equal(item.wornCount, 0);
  assert.equal(item.lastWornAt, null);
  assert.equal(item.photoId, null, 'ohne Foto kein Fotoschlüssel');
});

test('ein Teil mit Foto trägt seinen Fotoschlüssel', () => {
  const item = createItem({ name: 'Sneaker weiß', hasPhoto: true });
  assert.equal(item.photoId, item.id, 'genau ein Foto je Teil, unter derselben Kennung');
});

test('speichert und findet Kleidungsstücke', async () => {
  const store = await frischerStore();
  const item = await addItem(store, { name: 'Chino beige' });

  assert.equal(store.all('items').length, 1);
  assert.equal(store.byId('items', item.id).name, 'Chino beige');
});

test('was von Hand geändert wurde, überlebt eine Umbenennung', async () => {
  const store = await frischerStore();
  const item = await addItem(store, { name: 'Jacke' });
  assert.equal(item.warmth, 4);

  await updateItem(store, item.id, { warmth: 1 });
  const umbenannt = await updateItem(store, item.id, { name: 'Übergangsjacke' });

  assert.equal(umbenannt.warmth, 1, 'die eigene Angabe bleibt');
  assert.equal(umbenannt.slot, 'outer', 'der Rest wird neu geraten');
});

test('eine Umbenennung ordnet neu ein, solange nichts von Hand gesetzt wurde', async () => {
  const store = await frischerStore();
  const item = await addItem(store, { name: 'Hemd weiß' });
  assert.equal(item.slot, 'top');

  const umbenannt = await updateItem(store, item.id, { name: 'Chelsea Boots braun' });
  assert.equal(umbenannt.slot, 'shoes');
  assert.deepEqual(umbenannt.colors, ['braun']);
});

test('Tragen wird bei jedem Teil gezählt', async () => {
  const store = await frischerStore();
  const hemd = await addItem(store, { name: 'Hemd weiß' });
  const hose = await addItem(store, { name: 'Chino beige' });

  await wearItems(store, [hemd.id, hose.id]);
  await wearItems(store, [hemd.id]);

  assert.equal(store.byId('items', hemd.id).wornCount, 2);
  assert.equal(store.byId('items', hose.id).wornCount, 1);
  assert.equal(daysSince(store.byId('items', hemd.id).lastWornAt), 0);
});

test('ein getragenes Outfit zählt beim Outfit und bei jedem Teil', async () => {
  const store = await frischerStore();
  const hemd = await addItem(store, { name: 'Hemd weiß' });
  const schuh = await addItem(store, { name: 'Sneaker weiß' });
  const outfit = await saveOutfit(store, { itemIds: [hemd.id, schuh.id], label: 'Alltag' });

  await wearOutfit(store, outfit.id);

  assert.equal(store.byId('outfits', outfit.id).wornCount, 1);
  assert.equal(store.byId('items', hemd.id).wornCount, 1);
  assert.equal(store.byId('items', schuh.id).wornCount, 1);
});

test('ein Outfit merkt, wenn ein Teil fehlt', async () => {
  const store = await frischerStore();
  const hemd = await addItem(store, { name: 'Hemd weiß' });
  const schuh = await addItem(store, { name: 'Sneaker weiß' });
  const outfit = await saveOutfit(store, { itemIds: [hemd.id, schuh.id] });

  assert.ok(isComplete(outfit, store.all('items')));

  await store.remove('items', schuh.id);
  assert.ok(!isComplete(outfit, store.all('items')), 'aussortierte Teile machen es unvollständig');
  assert.equal(itemsOf(outfit, store.all('items')).length, 1);
});

test('Bewertungen werden nur angehängt, nie geändert', async () => {
  const store = await frischerStore();
  await rateOutfit(store, { itemIds: ['a'], verdict: VERDICT.LIKE, features: ['farbe:schwarz'] });
  await rateOutfit(store, { itemIds: ['a'], verdict: VERDICT.DISLIKE, features: ['farbe:rot'] });

  const bewertungen = store.all('ratings');
  assert.equal(bewertungen.length, 2, 'zwei Urteile über dasselbe Teil bleiben beide stehen');
  assert.equal(bewertungen.filter((r) => r.verdict === VERDICT.LIKE).length, 1);
});

test('zählt den Schrank nach Fächern', async () => {
  const store = await frischerStore();
  for (const name of ['Hemd weiß', 'T-Shirt schwarz', 'Chino beige', 'Sneaker weiß']) {
    await addItem(store, { name });
  }

  assert.deepEqual(countBySlot(store.all('items')), { top: 2, bottom: 1, shoes: 1 });
});

test('findet Teile, die nur noch Platz brauchen', () => {
  const alt = createItem({ name: 'Hemd rot', createdAt: vorTagen(400), lastWornAt: vorTagen(300) });
  const nie = createItem({ name: 'Kleid grün', createdAt: vorTagen(400) });
  const neu = createItem({ name: 'Sneaker weiß', createdAt: vorTagen(10) });
  const oft = createItem({ name: 'Jeans blau', createdAt: vorTagen(400), lastWornAt: vorTagen(2) });

  const vergessen = forgottenItems([alt, nie, neu, oft]).map((item) => item.name);

  assert.ok(vergessen.includes('Hemd rot'));
  assert.ok(vergessen.includes('Kleid grün'), 'nie getragen zählt auch');
  assert.ok(!vergessen.includes('Sneaker weiß'), 'was erst seit zehn Tagen da ist, ist nicht vergessen');
  assert.ok(!vergessen.includes('Jeans blau'));
});

test('behauptet keine Tragehäufigkeit, solange ein Teil neu ist', () => {
  const neu = createItem({ name: 'Jeans blau', createdAt: vorTagen(7), wornCount: 1 });
  assert.equal(wearRate(neu), null, 'eine Woche und einmal getragen ist keine Statistik');

  const eingelebt = createItem({ name: 'Jeans blau', createdAt: vorTagen(60), wornCount: 10 });
  assert.equal(Math.round(wearRate(eingelebt)), 5, 'zehn Mal in 60 Tagen: fünf Mal im Monat');
});
