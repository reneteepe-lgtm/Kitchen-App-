/**
 * Trainingspläne.
 *
 * Ein Plan ist eine **Reihenfolge von Übungen** und sonst nichts. Kein
 * Gewicht, keine Satzzahl, keine Wochentage.
 *
 * Das ist die wichtigste Entscheidung an dieser Stelle, und sie ist
 * bewusst so getroffen: Gewichte gehören ins Protokoll, nicht in den Plan.
 * Ein Plan, in dem „Bankdrücken 3 × 8 @ 60 kg" stünde, wäre nach zwei
 * Wochen falsch -- und dann hätte man zwei Wahrheiten über dasselbe
 * Training, eine im Plan und eine im Verlauf. So gibt es nur eine: Was
 * heute drankommt, rechnet `progression.js` aus dem aus, was zuletzt
 * wirklich passiert ist. Der Plan sagt allein, *welche* Übungen und in
 * welcher Reihenfolge.
 *
 * Deshalb steht hier auch nichts über Wochentage. Wer dreimal die Woche
 * Push, Pull und Beine macht, hält keinen Kalender ein -- er nimmt den
 * Plan, der am längsten nicht dran war. Genau das schlägt `nextPlan` vor.
 */

import { newId } from './storage.js';
import { startSession, workingSets } from './model.js';

export function createPlan(data = {}) {
  return {
    id: data.id ?? newId('plan'),
    name: String(data.name ?? '').trim(),
    /** Die Übungen in der Reihenfolge, in der sie trainiert werden. */
    exerciseIds: [...new Set(data.exerciseIds ?? [])],
    createdAt: data.createdAt ?? new Date().toISOString(),
  };
}

export async function addPlan(store, data) {
  const plan = createPlan(data);
  await store.put('plans', plan);
  return plan;
}

export async function updatePlan(store, id, changes) {
  const existing = store.byId('plans', id);
  if (!existing) return undefined;
  return store.put('plans', createPlan({ ...existing, ...changes }));
}

/**
 * Ein gelöschter Plan nimmt seine Trainings nicht mit.
 *
 * Die Einheiten behalten ihre `planId` und ihren Namen im `label` -- was im
 * März nach dem alten Plan trainiert wurde, hat im März stattgefunden,
 * auch wenn es den Plan im Mai nicht mehr gibt.
 */
export async function removePlan(store, id) {
  await store.remove('plans', id);
}

/** Eine Übung an eine Stelle im Plan schieben. */
export function moveExercise(exerciseIds, exerciseId, richtung) {
  const liste = [...exerciseIds];
  const von = liste.indexOf(exerciseId);
  const nach = von + richtung;
  if (von < 0 || nach < 0 || nach >= liste.length) return liste;

  liste[von] = liste[nach];
  liste[nach] = exerciseId;
  return liste;
}

/**
 * Die Übungen eines Plans, in der Reihenfolge des Plans.
 *
 * Übungen, die es nicht mehr gibt, fallen heraus -- ihre Zahl wird
 * mitgeliefert, damit die Oberfläche es sagen kann, statt den Plan
 * stillschweigend kürzer zu machen.
 */
export function planExercises(plan, exercisesById) {
  const gefunden = (plan?.exerciseIds ?? [])
    .map((id) => exercisesById.get?.(id) ?? exercisesById[id])
    .filter(Boolean);

  return { exercises: gefunden, missing: (plan?.exerciseIds ?? []).length - gefunden.length };
}

/** Wann zuletzt nach diesem Plan trainiert wurde. */
export function lastUsedAt(planId, sessions) {
  return (
    sessions
      .filter((session) => session.planId === planId)
      .map((session) => session.startedAt)
      .sort()
      .at(-1) ?? null
  );
}

/** Wie oft nach diesem Plan trainiert wurde. */
export const useCount = (planId, sessions) =>
  sessions.filter((session) => session.planId === planId).length;

/**
 * Die Pläne in der Reihenfolge, in der sie dran wären.
 *
 * Der am längsten nicht trainierte zuerst; noch nie benutzte ganz vorn.
 * Das ist die ganze Rotation -- bei einem Push-Pull-Beine-Plan kommt
 * dabei genau die Abfolge heraus, die man ohnehin im Kopf hat.
 */
export function plansByTurn(plans, sessions) {
  return [...plans]
    .map((plan) => ({ plan, lastUsedAt: lastUsedAt(plan.id, sessions) }))
    .sort((a, b) => {
      if (a.lastUsedAt === b.lastUsedAt) return a.plan.name.localeCompare(b.plan.name, 'de');
      if (!a.lastUsedAt) return -1;
      if (!b.lastUsedAt) return 1;
      return a.lastUsedAt.localeCompare(b.lastUsedAt);
    });
}

/** Welcher Plan als Nächstes dran wäre. */
export const nextPlan = (plans, sessions) => plansByTurn(plans, sessions)[0]?.plan ?? null;

/**
 * Wie weit man in einem Plan ist.
 *
 * Die Zielzahl der Sätze kommt von außen -- sie steht nicht im Plan,
 * sondern folgt daraus, wie viele Sätze beim letzten Mal gemacht wurden.
 * Wer eine Übung einmal mit vier statt drei Sätzen macht, verschiebt damit
 * nicht seinen Plan.
 */
export function planProgress(plan, sessionSets, { targetFor = () => 3 } = {}) {
  const gemacht = workingSets(sessionSets);

  return (plan?.exerciseIds ?? []).map((exerciseId) => {
    const done = gemacht.filter((satz) => satz.exerciseId === exerciseId).length;
    const target = Math.max(1, targetFor(exerciseId));
    return { exerciseId, done, target, complete: done >= target };
  });
}

/** Die nächste Übung, die im Plan noch offen ist. */
export const nextInPlan = (fortschritt) => fortschritt.find((eintrag) => !eintrag.complete) ?? null;

/** Alles abgehakt? */
export const planDone = (fortschritt) =>
  fortschritt.length > 0 && fortschritt.every((eintrag) => eintrag.complete);

/**
 * Startet ein Training nach diesem Plan.
 *
 * Läuft schon eine Einheit, in der noch nichts steht, wird sie übernommen
 * statt eine zweite danebenzustellen -- sonst bliebe eine leere Einheit im
 * Verlauf zurück, nur weil jemand den Plan erst nach dem Öffnen der App
 * gewählt hat.
 */
export async function startPlan(store, plan, { running = null, now = new Date() } = {}) {
  if (running) {
    return store.put('sessions', { ...running, planId: plan.id, label: plan.name });
  }
  return startSession(store, { planId: plan.id, label: plan.name, startedAt: now.toISOString() });
}

/** Ein vergangenes Training als Plan sichern. */
export async function planFromSession(store, session, sets, name) {
  const eigene = workingSets(sets.filter((satz) => satz.sessionId === session.id));
  const reihenfolge = [...new Set(eigene.map((satz) => satz.exerciseId))];

  const plan = await addPlan(store, { name, exerciseIds: reihenfolge });
  // Die Einheit bekommt den Plan nachträglich zugeordnet, damit die
  // Rotation weiß, dass er heute schon dran war.
  await store.put('sessions', { ...session, planId: plan.id, label: session.label || name });
  return plan;
}
