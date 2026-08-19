import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, MemoryAdapter, LocalStorageAdapter, requestPersistence, COLLECTIONS } from '../js/storage.js';

const frisch = () => new Store(new MemoryAdapter()).init();

test('legt an, liest und schreibt fort', async () => {
  const store = await frisch();
  await store.put('exercises', { id: 'a', name: 'Bankdrücken' });

  assert.equal(store.byId('exercises', 'a').name, 'Bankdrücken');
  assert.ok(store.byId('exercises', 'a').updatedAt, 'jeder Datensatz trägt seinen Zeitstempel');
});

test('ein neuer Store übernimmt, was im Adapter liegt', async () => {
  const adapter = new MemoryAdapter();
  const erster = await new Store(adapter).init();
  await erster.put('sets', { id: 's1', reps: 8 });

  const zweiter = await new Store(adapter).init();
  assert.equal(zweiter.all('sets').length, 1);
});

/**
 * Weiches Löschen ist kein Selbstzweck: Eine harte Löschung wäre beim
 * Zusammenführen zweier Geräte nicht von "kennt den Datensatz noch nicht"
 * zu unterscheiden -- und käme vom anderen Gerät zurück.
 */
test('gelöscht wird nur weich', async () => {
  const store = await frisch();
  await store.put('sets', { id: 's1', reps: 8 });
  await store.remove('sets', 's1');

  assert.equal(store.all('sets').length, 0);
  assert.equal(store.byId('sets', 's1'), undefined);
  assert.equal(store.allIncludingRemoved('sets').length, 1);
  assert.equal(store.allIncludingRemoved('sets')[0].deleted, true);
});

test('meldet jede Änderung genau einmal', async () => {
  const store = await frisch();
  let meldungen = 0;
  store.subscribe(() => (meldungen += 1));

  await store.put('sets', { id: 's1', reps: 8 });
  await store.putMany([
    ['sets', { id: 's2', reps: 8 }],
    ['sets', { id: 's3', reps: 8 }],
  ]);

  assert.equal(meldungen, 2, 'mehrere Änderungen zusammen sind ein Zeichenvorgang');
  assert.equal(store.all('sets').length, 3);
});

test('Einstellungen liegen neben den Daten', async () => {
  const store = await frisch();
  assert.equal(store.getSetting('unit', 'kg'), 'kg');

  await store.setSetting('unit', 'lb');
  assert.equal(store.getSetting('unit', 'kg'), 'lb');
});

test('die Sicherung enthält alles und lässt sich wieder einspielen', async () => {
  const store = await frisch();
  await store.put('exercises', { id: 'a', name: 'Kniebeugen' });
  await store.setSetting('weeklyGoal', 4);

  const sicherung = JSON.parse(store.export());
  for (const collection of COLLECTIONS) assert.ok(sicherung[collection]);
  assert.ok(sicherung.exportedAt);

  const anderer = await frisch();
  await anderer.replaceAll(sicherung);

  assert.equal(anderer.byId('exercises', 'a').name, 'Kniebeugen');
  assert.equal(anderer.getSetting('weeklyGoal'), 4);
  assert.equal(anderer.state.exportedAt, undefined, 'der Zeitstempel der Sicherung bleibt draußen');
});

/**
 * Genau die Operation, die ein späterer Sync zwischen zwei Geräten braucht.
 */
test('beim Zusammenführen gewinnt der jüngere Stand', async () => {
  const store = await frisch();
  await store.put('exercises', { id: 'a', name: 'Bankdrücken' });

  await store.merge({
    exercises: {
      a: { id: 'a', name: 'Bankdrücken eng', updatedAt: '2099-01-01T00:00:00.000Z' },
      b: { id: 'b', name: 'Rudern', updatedAt: '2020-01-01T00:00:00.000Z' },
    },
  });

  assert.equal(store.byId('exercises', 'a').name, 'Bankdrücken eng');
  assert.equal(store.byId('exercises', 'b').name, 'Rudern', 'Unbekanntes kommt dazu');
});

/**
 * Sätze sind Ereignisse und keine zwei Fassungen derselben Sache: Wer am
 * Handy trainiert und am Tablet nachträgt, hat zwei Listen, die sich
 * ergänzen.
 */
test('Sätze werden beim Zusammenführen nur ergänzt', async () => {
  const store = await frisch();
  await store.put('sets', { id: 's1', reps: 8 });

  await store.merge({
    sets: {
      s1: { id: 's1', reps: 99, updatedAt: '2099-01-01T00:00:00.000Z' },
      s2: { id: 's2', reps: 10 },
    },
  });

  assert.equal(store.byId('sets', 's1').reps, 8, 'der eigene Satz bleibt, wie er war');
  assert.equal(store.byId('sets', 's2').reps, 10);
});

test('dieselbe Sicherung zweimal einlesen ändert nichts', async () => {
  const store = await frisch();
  await store.put('sets', { id: 's1', reps: 8 });

  const sicherung = JSON.parse(store.export());
  await store.merge(sicherung);
  await store.merge(sicherung);

  assert.equal(store.all('sets').length, 1);
});

test('sagt, wie viel Platz die Daten brauchen', async () => {
  const store = await frisch();
  const leer = store.usedBytes();
  await store.put('sets', { id: 's1', reps: 8, weight: 60 });

  assert.ok(store.usedBytes() > leer);
});

test('der Browser-Adapter überlebt kaputte Daten', async () => {
  const kaputt = {
    getItem: () => '{kein json',
    setItem: () => {},
  };
  const store = await new Store(new LocalStorageAdapter('test', kaputt)).init();

  assert.deepEqual(store.all('sets'), [], 'lieber leer starten als gar nicht');
});

test('ohne Speicher-API wird die Dauerhaftigkeit nicht behauptet', async () => {
  assert.equal(await requestPersistence(undefined), 'unbekannt');
  assert.equal(await requestPersistence({ persist: async () => true }), 'dauerhaft');
  assert.equal(await requestPersistence({ persist: async () => false }), 'auf-widerruf');
});
