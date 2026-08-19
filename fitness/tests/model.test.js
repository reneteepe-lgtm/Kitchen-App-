import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryAdapter, Store } from '../js/storage.js';
import {
  createExercise,
  addExercise,
  addExercises,
  updateExercise,
  removeExercise,
  withHistory,
  createSet,
  logSet,
  removeSet,
  startSession,
  endSession,
  openSession,
  staleSessions,
  closeStaleSessions,
  setsOfSession,
  setsOfExercise,
  workingSets,
  effectiveWeight,
  volume,
  sessionSummary,
  lastPerformance,
} from '../js/model.js';

const frischerStore = () => new Store(new MemoryAdapter()).init();

const vorStunden = (stunden) => new Date(Date.now() - stunden * 60 * 60 * 1000);

test('legt eine Übung an und rät, was sie ist', () => {
  const uebung = createExercise({ name: 'Bankdrücken' });

  assert.equal(uebung.muscle, 'brust');
  assert.equal(uebung.equipment, 'langhantel');
  assert.equal(uebung.kind, 'gewicht');
  assert.equal(uebung.repTarget, 6);
  assert.deepEqual(uebung.touched, []);
});

test('speichert und findet Übungen', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Kniebeugen' });

  assert.equal(store.all('exercises').length, 1);
  assert.equal(store.byId('exercises', uebung.id).name, 'Kniebeugen');
});

test('was von Hand geändert wurde, überlebt eine Umbenennung', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Rudern' });
  assert.equal(uebung.repTarget, 6);

  await updateExercise(store, uebung.id, { repTarget: 15 });
  const umbenannt = await updateExercise(store, uebung.id, { name: 'Kabelrudern eng' });

  assert.equal(umbenannt.repTarget, 15, 'die eigene Angabe bleibt');
  assert.equal(umbenannt.equipment, 'kabel', 'der Rest wird neu geraten');
});

/**
 * Der Grund, warum Übungen nur weich gelöscht werden: Ein Training von
 * früher darf nicht rückwirkend verschwinden.
 */
test('eine entfernte Übung nimmt ihre Sätze nicht mit', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Beinpresse' });
  await logSet(store, { exerciseId: uebung.id, weight: 100, reps: 10 });

  await removeExercise(store, uebung.id);

  assert.equal(store.all('exercises').length, 0, 'aus dem Verzeichnis verschwunden');
  assert.equal(store.all('sets').length, 1, 'im Protokoll aber noch da');
  assert.equal(store.allIncludingRemoved('exercises').length, 1, 'der Name bleibt auffindbar');
});

test('legt mehrere Übungen auf einmal an', async () => {
  const store = await frischerStore();
  const neue = await addExercises(store, ['Bankdrücken', 'Klimmzüge', 'Plank']);

  assert.equal(neue.length, 3);
  assert.equal(store.all('exercises').length, 3);
  assert.equal(store.all('exercises').find((ex) => ex.name === 'Plank').kind, 'zeit', 'geraten wird wie sonst auch');
});

/**
 * Zwei Einträge derselben Übung wären zwei getrennte Verläufe, und keiner
 * davon stimmte.
 */
test('was es schon gibt, wird übersprungen -- auch anders geschrieben', async () => {
  const store = await frischerStore();
  await addExercise(store, { name: 'Klimmzüge' });

  const neue = await addExercises(store, ['Klimmzuege', 'Dips', 'Dips']);

  assert.deepEqual(neue.map((ex) => ex.name), ['Dips']);
  assert.equal(store.all('exercises').length, 2);
});

test('rechnet die Geschichte einer Übung aus, statt sie mitzuschreiben', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Klimmzüge' });
  await logSet(store, { exerciseId: uebung.id, reps: 8 });
  await logSet(store, { exerciseId: uebung.id, reps: 7 });

  const [angereichert] = withHistory(store.all('exercises'), store.all('sets'));

  assert.equal(angereichert.setCount, 2);
  assert.ok(angereichert.lastDoneAt, 'weiß, wann sie zuletzt dran war');
});

// --- Einheiten -----------------------------------------------------------

test('der erste Satz eröffnet die Einheit von selbst', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Bankdrücken' });

  assert.equal(store.all('sessions').length, 0);
  const satz = await logSet(store, { exerciseId: uebung.id, weight: 60, reps: 8 });

  assert.equal(store.all('sessions').length, 1, 'ohne Knopf "Training starten"');
  assert.equal(satz.sessionId, store.all('sessions')[0].id);
});

test('weitere Sätze landen in derselben Einheit', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Bankdrücken' });

  const erster = await logSet(store, { exerciseId: uebung.id, weight: 60, reps: 8 });
  const zweiter = await logSet(store, { exerciseId: uebung.id, weight: 60, reps: 7 });

  assert.equal(zweiter.sessionId, erster.sessionId);
  assert.equal(store.all('sessions').length, 1);
});

test('nach einer beendeten Einheit fängt der nächste Satz eine neue an', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Bankdrücken' });

  const erster = await logSet(store, { exerciseId: uebung.id, weight: 60, reps: 8 });
  await endSession(store, erster.sessionId);
  const zweiter = await logSet(store, { exerciseId: uebung.id, weight: 60, reps: 8 });

  assert.notEqual(zweiter.sessionId, erster.sessionId);
});

/**
 * Das Beenden ist der Schritt, den man vergisst: Man packt die Tasche und
 * geht. Ohne diese Grenze liefe die Einheit vom Montag am Mittwoch noch.
 */
test('eine vergessene Einheit gilt nach ein paar Stunden als beendet', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Kniebeugen' });

  const gestern = vorStunden(20);
  const session = await startSession(store, { startedAt: gestern.toISOString() });
  await logSet(store, {
    exerciseId: uebung.id,
    sessionId: session.id,
    weight: 80,
    reps: 5,
    at: gestern.toISOString(),
  });

  assert.equal(openSession(store.all('sessions'), store.all('sets')), null);

  const offen = staleSessions(store.all('sessions'), store.all('sets'));
  assert.equal(offen.length, 1);
  assert.equal(offen[0].endedAt, gestern.toISOString(), 'sie endete beim letzten Satz, nicht jetzt');

  assert.equal(await closeStaleSessions(store), 1);
  assert.ok(store.byId('sessions', session.id).endedAt);
});

test('eine Einheit, in der gerade trainiert wird, bleibt offen', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Kniebeugen' });
  const satz = await logSet(store, { exerciseId: uebung.id, weight: 80, reps: 5 });

  const laufend = openSession(store.all('sessions'), store.all('sets'));
  assert.equal(laufend?.id, satz.sessionId);
  assert.equal(staleSessions(store.all('sessions'), store.all('sets')).length, 0);
});

// --- Sätze ---------------------------------------------------------------

test('nimmt Kommazahlen so entgegen, wie man sie tippt', () => {
  const satz = createSet({ exerciseId: 'x', sessionId: 'y', weight: '62,5', reps: '8' });

  assert.equal(satz.weight, 62.5);
  assert.equal(satz.reps, 8);
  assert.equal(satz.seconds, null);
});

test('ein gelöschter Satz verschwindet aus dem Protokoll', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Curls' });
  const satz = await logSet(store, { exerciseId: uebung.id, weight: 15, reps: 12 });

  await removeSet(store, satz.id);
  assert.equal(store.all('sets').length, 0);
});

test('Aufwärmsätze bleiben aus der Rechnung heraus', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Bankdrücken' });
  await logSet(store, { exerciseId: uebung.id, weight: 20, reps: 15, warmup: true });
  await logSet(store, { exerciseId: uebung.id, weight: 80, reps: 5 });

  const alle = store.all('sets');
  assert.equal(alle.length, 2);
  assert.equal(workingSets(alle).length, 1);

  const karte = new Map(store.all('exercises').map((ex) => [ex.id, ex]));
  assert.equal(volume(alle, karte), 400, 'nur der Arbeitssatz zählt');
});

test('Körpergewichtsübungen bewegen den Menschen mit', async () => {
  const uebung = createExercise({ name: 'Klimmzüge' });
  const satz = createSet({ exerciseId: uebung.id, sessionId: 's', weight: 10, reps: 5 });

  assert.equal(effectiveWeight(satz, uebung, 80), 90, 'Körpergewicht plus Zusatz');
  assert.equal(effectiveWeight(satz, uebung, null), 10, 'ohne Angabe lieber zu wenig als erfunden');

  const hantel = createExercise({ name: 'Bankdrücken' });
  assert.equal(effectiveWeight({ weight: 60 }, hantel, 80), 60, 'sonst zählt nur die Hantel');
});

test('gehaltene Zeit trägt kein Volumen bei', () => {
  const planke = createExercise({ name: 'Planke' });
  const satz = createSet({ exerciseId: planke.id, sessionId: 's', seconds: 60 });

  assert.equal(volume([satz], new Map([[planke.id, planke]])), 0);
});

test('fasst eine Einheit zusammen', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Kniebeugen' });
  await logSet(store, { exerciseId: uebung.id, weight: 80, reps: 5 });
  await logSet(store, { exerciseId: uebung.id, weight: 80, reps: 5 });

  const session = store.all('sessions')[0];
  const karte = new Map(store.all('exercises').map((ex) => [ex.id, ex]));
  const zusammen = sessionSummary(session, store.all('sets'), karte);

  assert.equal(zusammen.setCount, 2);
  assert.equal(zusammen.reps, 10);
  assert.equal(zusammen.volume, 800);
  assert.deepEqual(zusammen.exerciseIds, [uebung.id]);
});

test('sortiert Sätze nach Einheit und nach Übung', async () => {
  const store = await frischerStore();
  const a = await addExercise(store, { name: 'Bankdrücken' });
  const b = await addExercise(store, { name: 'Rudern' });
  await logSet(store, { exerciseId: a.id, weight: 60, reps: 8 });
  await logSet(store, { exerciseId: b.id, weight: 50, reps: 10 });

  const session = store.all('sessions')[0];
  assert.equal(setsOfSession(store.all('sets'), session.id).length, 2);
  assert.equal(setsOfExercise(store.all('sets'), a.id).length, 1);
});

/**
 * "Letztes Mal" ist die letzte *Einheit*, nicht der letzte Satz: Wer heute
 * schon zwei Sätze gemacht hat, will als Vergleich das vollständige Bild
 * vom letzten Training sehen.
 */
test('findet das letzte Mal, an dem diese Übung dran war', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Bankdrücken' });

  const alt = await startSession(store, { startedAt: vorStunden(72).toISOString() });
  await logSet(store, { exerciseId: uebung.id, sessionId: alt.id, weight: 60, reps: 8, at: vorStunden(72).toISOString() });
  await logSet(store, { exerciseId: uebung.id, sessionId: alt.id, weight: 60, reps: 7, at: vorStunden(71).toISOString() });

  const heute = await logSet(store, { exerciseId: uebung.id, weight: 62.5, reps: 6 });

  const letztes = lastPerformance(store.all('sets'), uebung.id, { exceptSessionId: heute.sessionId });
  assert.equal(letztes.sessionId, alt.id);
  assert.equal(letztes.sets.length, 2);

  const ohneAusnahme = lastPerformance(store.all('sets'), uebung.id);
  assert.equal(ohneAusnahme.sessionId, heute.sessionId);
});
