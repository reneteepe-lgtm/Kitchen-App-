import test from 'node:test';
import assert from 'node:assert/strict';

import {
  backupStatus,
  describeBackupAge,
  formatBytes,
  snoozeUntil,
  MIN_PRODUCTS,
  REMIND_AFTER_DAYS,
  SNOOZE_DAYS,
} from '../js/backup.js';
import { Store, MemoryAdapter, requestPersistence } from '../js/storage.js';

const NOW = new Date('2026-08-09T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const status = (over) =>
  backupStatus({ lastBackupAt: null, remindAfterAt: null, productCount: 40, now: NOW, ...over });

// --- Wann erinnert wird ---------------------------------------------------

test('ohne nennenswerten Vorrat wird nicht erinnert', () => {
  // Drei Produkte wieder einzutippen dauert fünf Minuten -- dafür soll
  // niemand behelligt werden.
  const s = status({ productCount: MIN_PRODUCTS - 1 });
  assert.equal(s.state, 'nichts');
  assert.equal(s.remind, false);
});

test('sobald etwas zu verlieren ist, wird erinnert', () => {
  const s = status({ productCount: MIN_PRODUCTS });
  assert.equal(s.state, 'nie');
  assert.equal(s.remind, true);
});

test('eine frische Sicherung schweigt', () => {
  const s = status({ lastBackupAt: daysAgo(3) });
  assert.equal(s.state, 'frisch');
  assert.equal(s.remind, false);
  assert.equal(s.days, 3);
});

test('eine alte Sicherung meldet sich wieder', () => {
  assert.equal(status({ lastBackupAt: daysAgo(REMIND_AFTER_DAYS - 1) }).remind, false);
  assert.equal(status({ lastBackupAt: daysAgo(REMIND_AFTER_DAYS) }).remind, true);
  assert.equal(status({ lastBackupAt: daysAgo(REMIND_AFTER_DAYS) }).state, 'faellig');
});

test('weggewischt heißt eine Woche Ruhe', () => {
  const bis = snoozeUntil(NOW);
  assert.equal(status({ remindAfterAt: bis }).remind, false, 'jetzt Ruhe');

  const spaeter = new Date(NOW.getTime() + (SNOOZE_DAYS + 1) * 24 * 60 * 60 * 1000);
  assert.equal(
    backupStatus({ lastBackupAt: null, remindAfterAt: bis, productCount: 40, now: spaeter }).remind,
    true,
    'danach wieder',
  );
});

test('das Vertagen verschweigt den Zustand nicht', () => {
  // Unter "Daten" soll weiter stehen, dass nichts gesichert ist -- nur die
  // Erinnerung über der Liste hält sich zurück.
  const s = status({ remindAfterAt: snoozeUntil(NOW) });
  assert.equal(s.state, 'nie');
  assert.equal(s.remind, false);
});

test('eine verstellte Uhr macht kein negatives Alter', () => {
  const morgen = new Date(NOW.getTime() + 86400000).toISOString();
  const s = status({ lastBackupAt: morgen });
  assert.equal(s.days, 0);
  assert.equal(s.state, 'frisch');
});

// --- Wie es dasteht -------------------------------------------------------

test('das Alter wird in Worten gesagt', () => {
  assert.equal(describeBackupAge(null), 'noch nie');
  assert.equal(describeBackupAge(0), 'heute');
  assert.equal(describeBackupAge(1), 'gestern');
  assert.equal(describeBackupAge(5), 'vor 5 Tagen');
  assert.equal(describeBackupAge(21), 'vor 3 Wochen');
  assert.equal(describeBackupAge(90), 'vor 3 Monaten');
});

test('die Größe bleibt kurz genug für eine Zeile', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(146432), '143 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2,0 MB');
});

// --- Was der Speicher hergibt --------------------------------------------

test('die Größe der Daten lässt sich ablesen', async () => {
  const store = await new Store(new MemoryAdapter()).init();
  const leer = store.usedBytes();
  assert.ok(leer > 0 && leer < 200, `leer sind es ${leer} Bytes`);

  await store.put('products', { id: 'p1', name: 'Milch 1 l', minStock: 1 });
  assert.ok(store.usedBytes() > leer, 'wächst mit dem Inhalt');
});

test('ein Browser ohne Speicherzusage wird nicht als Fehler behandelt', async () => {
  assert.equal(await requestPersistence(undefined), 'unbekannt');
  assert.equal(await requestPersistence({}), 'unbekannt');
});

test('eine bereits gewährte Zusage wird nicht erneut erfragt', async () => {
  let gefragt = 0;
  const mode = await requestPersistence({
    persisted: async () => true,
    persist: async () => { gefragt++; return true; },
  });
  assert.equal(mode, 'dauerhaft');
  assert.equal(gefragt, 0, 'manche Browser zählen jede Anfrage gegen die App');
});

test('eine abgelehnte Bitte wird als solche gemeldet', async () => {
  assert.equal(
    await requestPersistence({ persisted: async () => false, persist: async () => false }),
    'auf-widerruf',
  );
  assert.equal(
    await requestPersistence({ persisted: async () => false, persist: async () => true }),
    'dauerhaft',
  );
});

test('wirft der Browser dabei, läuft die App trotzdem weiter', async () => {
  const mode = await requestPersistence({
    persisted: async () => { throw new Error('nicht erlaubt'); },
    persist: async () => true,
  });
  assert.equal(mode, 'unbekannt');
});
