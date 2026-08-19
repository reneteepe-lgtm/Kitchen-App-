import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryAdapter, Store } from '../js/storage.js';
import { addExercise, logSet, startSession, createSet, openSession } from '../js/model.js';
import {
  createPlan,
  addPlan,
  updatePlan,
  removePlan,
  moveExercise,
  planExercises,
  lastUsedAt,
  useCount,
  plansByTurn,
  nextPlan,
  planProgress,
  nextInPlan,
  planDone,
  startPlan,
  planFromSession,
} from '../js/plans.js';

const frischerStore = () => new Store(new MemoryAdapter()).init();

const vorTagen = (tage) => {
  const d = new Date();
  d.setDate(d.getDate() - tage);
  return d.toISOString();
};

const einheit = (id, planId, tage) => ({ id, planId, startedAt: vorTagen(tage) });

test('ein Plan ist eine Reihenfolge von Übungen', () => {
  const plan = createPlan({ name: ' Push ', exerciseIds: ['a', 'b', 'c'] });

  assert.equal(plan.name, 'Push');
  assert.deepEqual(plan.exerciseIds, ['a', 'b', 'c']);
});

test('dieselbe Übung steht nur einmal im Plan', () => {
  assert.deepEqual(createPlan({ exerciseIds: ['a', 'b', 'a'] }).exerciseIds, ['a', 'b']);
});

test('mehrere Pläne stehen nebeneinander', async () => {
  const store = await frischerStore();
  await addPlan(store, { name: 'Push', exerciseIds: ['a'] });
  await addPlan(store, { name: 'Pull', exerciseIds: ['b'] });

  assert.equal(store.all('plans').length, 2);
});

test('die Reihenfolge lässt sich ändern', () => {
  assert.deepEqual(moveExercise(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveExercise(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
  assert.deepEqual(moveExercise(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'], 'oben ist oben');
  assert.deepEqual(moveExercise(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'], 'unten ist unten');
});

test('ein geänderter Plan behält seine Kennung', async () => {
  const store = await frischerStore();
  const plan = await addPlan(store, { name: 'Push', exerciseIds: ['a'] });
  const geaendert = await updatePlan(store, plan.id, { name: 'Push schwer', exerciseIds: ['a', 'b'] });

  assert.equal(geaendert.id, plan.id);
  assert.equal(geaendert.name, 'Push schwer');
  assert.deepEqual(geaendert.exerciseIds, ['a', 'b']);
  assert.equal(store.all('plans').length, 1);
});

/**
 * Eine entfernte Übung darf den Plan nicht stillschweigend kürzen -- die
 * Oberfläche soll sagen können, dass da etwas fehlt.
 */
test('eine entfernte Übung fällt heraus und wird gezählt', () => {
  const plan = createPlan({ exerciseIds: ['a', 'weg', 'b'] });
  const { exercises, missing } = planExercises(plan, new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]));

  assert.deepEqual(exercises.map((ex) => ex.id), ['a', 'b']);
  assert.equal(missing, 1);
});

test('ein gelöschter Plan nimmt seine Trainings nicht mit', async () => {
  const store = await frischerStore();
  const plan = await addPlan(store, { name: 'Push', exerciseIds: ['a'] });
  await startSession(store, { planId: plan.id, label: plan.name });

  await removePlan(store, plan.id);

  assert.equal(store.all('plans').length, 0);
  const session = store.all('sessions')[0];
  assert.equal(session.planId, plan.id);
  assert.equal(session.label, 'Push', 'der Name bleibt am Training stehen');
});

// --- Rotation ------------------------------------------------------------

test('zählt, wann ein Plan zuletzt dran war', () => {
  const sessions = [einheit('s1', 'push', 9), einheit('s2', 'push', 2), einheit('s3', 'pull', 5)];

  assert.equal(lastUsedAt('push', sessions), sessions[1].startedAt);
  assert.equal(useCount('push', sessions), 2);
  assert.equal(lastUsedAt('beine', sessions), null);
});

/**
 * Die ganze Rotation: Der am längsten nicht trainierte Plan ist dran. Bei
 * Push/Pull/Beine kommt genau die Abfolge heraus, die man ohnehin im Kopf
 * hat.
 */
test('dran ist, was am längsten nicht dran war', () => {
  const plans = [
    { id: 'push', name: 'Push' },
    { id: 'pull', name: 'Pull' },
    { id: 'beine', name: 'Beine' },
  ];
  const sessions = [einheit('s1', 'push', 1), einheit('s2', 'pull', 3), einheit('s3', 'beine', 5)];

  assert.equal(nextPlan(plans, sessions).id, 'beine');
  assert.deepEqual(plansByTurn(plans, sessions).map((e) => e.plan.id), ['beine', 'pull', 'push']);
});

test('ein noch nie trainierter Plan steht ganz vorn', () => {
  const plans = [{ id: 'push', name: 'Push' }, { id: 'neu', name: 'Neu' }];
  const sessions = [einheit('s1', 'push', 30)];

  assert.equal(nextPlan(plans, sessions).id, 'neu');
});

// --- Fortschritt im Plan -------------------------------------------------

const satz = (exerciseId, extra = {}) =>
  createSet({ id: `${exerciseId}-${Math.random()}`, sessionId: 'heute', exerciseId, reps: 8, weight: 60, ...extra });

test('hakt ab, was im Plan schon gemacht ist', () => {
  const plan = createPlan({ exerciseIds: ['bank', 'rudern'] });
  const saetze = [satz('bank'), satz('bank'), satz('bank'), satz('rudern')];

  const fortschritt = planProgress(plan, saetze, { targetFor: () => 3 });

  assert.deepEqual(fortschritt[0], { exerciseId: 'bank', done: 3, target: 3, complete: true });
  assert.deepEqual(fortschritt[1], { exerciseId: 'rudern', done: 1, target: 3, complete: false });
  assert.equal(nextInPlan(fortschritt).exerciseId, 'rudern');
  assert.equal(planDone(fortschritt), false);
});

test('Aufwärmsätze haken nichts ab', () => {
  const plan = createPlan({ exerciseIds: ['bank'] });
  const saetze = [satz('bank', { warmup: true }), satz('bank', { warmup: true })];

  assert.equal(planProgress(plan, saetze, { targetFor: () => 2 })[0].done, 0);
});

test('erkennt einen abgearbeiteten Plan', () => {
  const plan = createPlan({ exerciseIds: ['bank'] });
  const fortschritt = planProgress(plan, [satz('bank')], { targetFor: () => 1 });

  assert.equal(planDone(fortschritt), true);
  assert.equal(nextInPlan(fortschritt), null);
});

// --- Starten -------------------------------------------------------------

test('ein gestartetes Training kennt seinen Plan', async () => {
  const store = await frischerStore();
  const plan = await addPlan(store, { name: 'Push', exerciseIds: ['a'] });

  const session = await startPlan(store, plan);

  assert.equal(session.planId, plan.id);
  assert.equal(session.label, 'Push');
  assert.equal(store.all('sessions').length, 1);
});

/**
 * Sonst bliebe eine leere Einheit im Verlauf zurück, nur weil jemand den
 * Plan erst nach dem Öffnen der App gewählt hat.
 */
test('eine schon laufende Einheit wird übernommen, nicht verdoppelt', async () => {
  const store = await frischerStore();
  const plan = await addPlan(store, { name: 'Push', exerciseIds: ['a'] });
  const laufend = await startSession(store);

  const session = await startPlan(store, plan, { running: laufend });

  assert.equal(session.id, laufend.id);
  assert.equal(session.planId, plan.id);
  assert.equal(store.all('sessions').length, 1);
});

test('Sätze nach dem Start landen in der Einheit des Plans', async () => {
  const store = await frischerStore();
  const uebung = await addExercise(store, { name: 'Bankdrücken' });
  const plan = await addPlan(store, { name: 'Push', exerciseIds: [uebung.id] });

  const session = await startPlan(store, plan);
  const satz = await logSet(store, { exerciseId: uebung.id, weight: 60, reps: 8 });

  assert.equal(satz.sessionId, session.id);
  assert.equal(openSession(store.all('sessions'), store.all('sets')).planId, plan.id);
});

/**
 * Der bequemste Weg zu einem Plan: einmal trainieren und danach sagen
 * "so wieder".
 */
test('aus einem gelaufenen Training wird ein Plan', async () => {
  const store = await frischerStore();
  const bank = await addExercise(store, { name: 'Bankdrücken' });
  const rudern = await addExercise(store, { name: 'Rudern' });

  await logSet(store, { exerciseId: bank.id, weight: 60, reps: 8 });
  await logSet(store, { exerciseId: rudern.id, weight: 50, reps: 10 });
  await logSet(store, { exerciseId: bank.id, weight: 60, reps: 7 });

  const session = store.all('sessions')[0];
  const plan = await planFromSession(store, session, store.all('sets'), 'Ganzkörper');

  assert.deepEqual(plan.exerciseIds, [bank.id, rudern.id], 'jede Übung einmal, in der Reihenfolge des Trainings');
  assert.equal(store.byId('sessions', session.id).planId, plan.id, 'die Einheit zählt für die Rotation mit');
});
