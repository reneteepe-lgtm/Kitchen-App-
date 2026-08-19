/**
 * Fachlogik: Übungen, Einheiten, Sätze.
 *
 * Drei Datensätze mit drei sehr verschiedenen Lebensläufen:
 *
 *  - Eine **Übung** (`exercise`) ist ein Nachschlagewerk-Eintrag. Sie wird
 *    einmal angelegt und danach jahrelang benutzt.
 *  - Eine **Einheit** (`session`) ist der Rahmen eines Trainings: Sie fängt
 *    an, wenn der erste Satz eingetragen wird, und hört auf, wenn jemand
 *    fertig ist -- oder von selbst, wenn jemand das Beenden vergisst.
 *  - Ein **Satz** (`set`) ist ein Ereignis. Er wird eingetragen und danach
 *    nur noch gelesen; korrigiert wird er, solange er auf dem Bildschirm
 *    steht, und danach praktisch nie mehr.
 *
 * Was hier bewusst *nicht* mitgeschrieben wird: eine Anstrengungsnote je
 * Satz. Sie stünde als viertes Feld im Weg, und die Eingabe eines Satzes
 * muss zwischen zwei Sätzen in den Trainingsablauf passen -- drei
 * Fingertipps, nicht fünf. Was die Übung hergibt, verrät ohnehin die
 * Wiederholungszahl.
 */

import { newId } from './storage.js';
import { guessAttributes } from './muscles.js';
import { normalize } from './text.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Die Felder, die von Hand gesetzt und danach nie wieder überstimmt werden. */
const GERATENE_FELDER = ['muscle', 'equipment', 'kind', 'repTarget'];

export const DEFAULT_SETTINGS = {
  /** Angezeigte Einheit. Gespeichert wird immer in Kilogramm. */
  unit: 'kg',
  /** Wie viele Einheiten pro Woche angestrebt werden. */
  weeklyGoal: 3,
  /** Vorgeschlagene Satzpause in Sekunden. */
  restSeconds: 120,
  /**
   * Das eigene Körpergewicht in Kilogramm, freiwillig.
   *
   * Ohne diese Angabe zählen Klimmzüge und Liegestütze im Volumen mit null
   * Kilogramm -- also gar nicht. Das ist der Grund, warum danach überhaupt
   * gefragt wird, und der einzige Zweck, für den die Zahl verwendet wird.
   */
  bodyweight: null,
  /**
   * Nach wie vielen Stunden ohne neuen Satz eine Einheit als beendet gilt.
   *
   * Braucht es, weil das Beenden der Schritt ist, den man vergisst: Man
   * packt die Tasche und geht. Ohne diese Grenze liefe die Einheit vom
   * Montag am Mittwoch noch, und der Mittwoch stünde in ihr drin.
   */
  autoCloseHours: 6,
};

const zahl = (wert) => {
  const n = typeof wert === 'string' ? Number(wert.replace(',', '.')) : Number(wert);
  return Number.isFinite(n) ? n : null;
};

/** Aufsteigend nach Zeitpunkt -- die Reihenfolge, in der trainiert wurde. */
export const byTime = (a, b) => (a.at ?? '').localeCompare(b.at ?? '');

// --- Übungen -------------------------------------------------------------

export function createExercise(data) {
  const name = String(data.name ?? '').trim();
  const guessed = guessAttributes(name, data);

  return {
    id: data.id ?? newId('ex'),
    name,
    ...guessed,
    note: String(data.note ?? '').trim(),
    touched: [...(data.touched ?? [])],
    createdAt: data.createdAt ?? new Date().toISOString(),
  };
}

export async function addExercise(store, data) {
  const exercise = createExercise(data);
  await store.put('exercises', exercise);
  return exercise;
}

/**
 * Legt mehrere Übungen auf einmal an -- aus dem Vorrat gängiger Übungen.
 *
 * In einem Schreibvorgang und einem Zeichenvorgang: Wer zehn Übungen
 * antippt, wartet sonst zehn Mal auf dasselbe.
 *
 * Was es schon gibt, wird übersprungen. Verglichen wird über `normalize`,
 * damit „Klimmzüge" und „Klimmzuege" nicht zweimal im Verzeichnis landen --
 * zwei Einträge derselben Übung wären zwei getrennte Verläufe, und keiner
 * davon stimmte.
 */
export async function addExercises(store, names) {
  const vorhanden = new Set(store.all('exercises').map((exercise) => normalize(exercise.name)));
  const neue = [];

  for (const name of names) {
    const schluessel = normalize(name);
    if (!schluessel || vorhanden.has(schluessel)) continue;
    vorhanden.add(schluessel);
    neue.push(createExercise({ name }));
  }

  if (neue.length) await store.putMany(neue.map((exercise) => ['exercises', exercise]));
  return neue;
}

/**
 * Ändert eine Übung.
 *
 * Wird der Name geändert, wird alles neu geraten -- außer dem, was jemand
 * selbst gesetzt hat. Wer das Wiederholungsziel einer Übung einmal auf
 * fünf gestellt hat, will nicht, dass eine Umbenennung es wieder auf zehn
 * schiebt. Deshalb merkt sich der Datensatz in `touched`, was von Hand kam.
 */
export async function updateExercise(store, id, changes) {
  const existing = store.byId('exercises', id);
  if (!existing) return undefined;

  const touched = new Set([
    ...(existing.touched ?? []),
    ...Object.keys(changes).filter((feld) => GERATENE_FELDER.includes(feld)),
  ]);
  const name = changes.name !== undefined ? String(changes.name).trim() : existing.name;

  const kept = {};
  for (const feld of GERATENE_FELDER) {
    if (touched.has(feld)) kept[feld] = changes[feld] ?? existing[feld];
  }

  return store.put('exercises', {
    ...existing,
    ...changes,
    name,
    ...guessAttributes(name, kept),
    touched: [...touched],
  });
}

/**
 * Eine Übung wird nur weich gelöscht -- ihre Sätze bleiben liegen.
 *
 * Das ist Absicht: Wer eine Übung aus dem Verzeichnis nimmt, will sie nicht
 * mehr vorgeschlagen bekommen. Er will aber nicht, dass das Training von
 * vor zwei Jahren rückwirkend nie stattgefunden hat.
 */
export async function removeExercise(store, id) {
  await store.remove('exercises', id);
}

/**
 * Reichert Übungen mit ihrer Geschichte an: wann zuletzt, wie oft.
 *
 * Gerechnet und nicht gespeichert. Eine mitgeführte Zahl im Datensatz wäre
 * schneller, ginge aber beim ersten gelöschten oder nachgetragenen Satz
 * gegen die Wirklichkeit -- und niemand merkte es.
 */
export function withHistory(exercises, sets) {
  const zuletzt = new Map();
  const anzahl = new Map();

  for (const satz of sets) {
    anzahl.set(satz.exerciseId, (anzahl.get(satz.exerciseId) ?? 0) + 1);
    const bisher = zuletzt.get(satz.exerciseId);
    if (!bisher || (satz.at ?? '') > bisher) zuletzt.set(satz.exerciseId, satz.at);
  }

  return exercises.map((exercise) => ({
    ...exercise,
    lastDoneAt: zuletzt.get(exercise.id) ?? null,
    setCount: anzahl.get(exercise.id) ?? 0,
  }));
}

// --- Einheiten -----------------------------------------------------------

export function createSession(data = {}) {
  const startedAt = data.startedAt ?? new Date().toISOString();
  return {
    id: data.id ?? newId('ses'),
    startedAt,
    endedAt: data.endedAt ?? null,
    /**
     * Nach welchem Plan trainiert wurde -- wenn nach einem.
     *
     * Die Einheit merkt sich den Plan, nicht umgekehrt: Ein Plan, der sich
     * alle vergangenen Trainings merkte, wüchse mit jeder Woche, und ein
     * geänderter Plan schriebe die Geschichte um. Der Name steht deshalb
     * zusätzlich in `label`: Er gilt für diesen Tag, auch wenn der Plan
     * später umbenannt oder gelöscht wird.
     */
    planId: data.planId ?? null,
    label: String(data.label ?? '').trim(),
    createdAt: data.createdAt ?? startedAt,
  };
}

export async function startSession(store, data = {}) {
  const session = createSession(data);
  await store.put('sessions', session);
  return session;
}

export async function endSession(store, id, when = new Date()) {
  const session = store.byId('sessions', id);
  if (!session || session.endedAt) return session;
  return store.put('sessions', { ...session, endedAt: when.toISOString() });
}

/**
 * Die Einheit, die gerade läuft -- wenn eine läuft.
 *
 * "Läuft" heißt: nicht beendet und vor weniger als `autoCloseHours` Stunden
 * zuletzt angefasst. Der Zustand wird abgeleitet und nicht in den
 * Einstellungen mitgeführt; ein zweites Mal gespeichert wäre er ein zweiter
 * Ort, an dem er falsch stehen kann.
 */
export function openSession(sessions, sets, now = new Date(), hours = DEFAULT_SETTINGS.autoCloseHours) {
  const grenze = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const letzteBeruehrung = lastTouch(sets);

  return (
    sessions
      .filter((s) => !s.endedAt)
      .filter((s) => (letzteBeruehrung.get(s.id) ?? s.startedAt) > grenze)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
}

/** Wann in jeder Einheit zuletzt ein Satz eingetragen wurde. */
function lastTouch(sets) {
  const map = new Map();
  for (const satz of sets) {
    const bisher = map.get(satz.sessionId);
    if (!bisher || (satz.at ?? '') > bisher) map.set(satz.sessionId, satz.at);
  }
  return map;
}

/**
 * Einheiten, die offen geblieben sind, obwohl das Training längst vorbei
 * ist -- mit dem Zeitpunkt, an dem sie tatsächlich zu Ende waren.
 *
 * Das ist der letzte Satz und nicht "jetzt": Ein Training, das um 19 Uhr
 * aufhörte und um 8 Uhr am nächsten Morgen geschlossen wird, dauerte nicht
 * dreizehn Stunden.
 */
export function staleSessions(sessions, sets, now = new Date(), hours = DEFAULT_SETTINGS.autoCloseHours) {
  const grenze = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const letzteBeruehrung = lastTouch(sets);

  return sessions
    .filter((s) => !s.endedAt)
    .filter((s) => (letzteBeruehrung.get(s.id) ?? s.startedAt) <= grenze)
    .map((s) => ({ session: s, endedAt: letzteBeruehrung.get(s.id) ?? s.startedAt }));
}

/** Schließt, was offen geblieben ist. Wird beim Start der App aufgerufen. */
export async function closeStaleSessions(store, now = new Date()) {
  const hours = store.getSetting('autoCloseHours', DEFAULT_SETTINGS.autoCloseHours);
  const offen = staleSessions(store.all('sessions'), store.all('sets'), now, hours);
  if (!offen.length) return 0;

  await store.putMany(offen.map(({ session, endedAt }) => ['sessions', { ...session, endedAt }]));
  return offen.length;
}

// --- Sätze ---------------------------------------------------------------

export function createSet(data) {
  const at = data.at ?? new Date().toISOString();
  return {
    id: data.id ?? newId('set'),
    sessionId: data.sessionId,
    exerciseId: data.exerciseId,
    /** Bei Körpergewichtsübungen das Zusatzgewicht, sonst das Gewicht. */
    weight: zahl(data.weight) ?? 0,
    reps: data.reps === null || data.reps === undefined ? null : Math.max(0, Math.round(zahl(data.reps) ?? 0)),
    seconds: data.seconds === null || data.seconds === undefined ? null : Math.max(0, Math.round(zahl(data.seconds) ?? 0)),
    /**
     * Aufwärmsätze zählen nicht.
     *
     * Sie stünden sonst in jedem Bestwert und in jedem Volumen mit drin und
     * machten beides zu einer Aussage über die Tagesform beim Aufwärmen.
     */
    warmup: Boolean(data.warmup),
    at,
  };
}

/**
 * Trägt einen Satz ein -- und macht dabei nebenbei alles auf, was dafür
 * offen sein muss.
 *
 * Es gibt bewusst keinen Knopf "Training starten". Ein Training fängt an,
 * wenn der erste Satz steht; alles andere wäre ein Schritt, den man
 * vergessen kann und dessen Vergessen später wehtut.
 */
export async function logSet(store, data, now = new Date()) {
  let sessionId = data.sessionId;

  if (!sessionId) {
    const hours = store.getSetting('autoCloseHours', DEFAULT_SETTINGS.autoCloseHours);
    const laufend = openSession(store.all('sessions'), store.all('sets'), now, hours);
    sessionId = laufend?.id ?? (await startSession(store, { startedAt: now.toISOString() })).id;
  }

  const satz = createSet({ ...data, sessionId, at: data.at ?? now.toISOString() });
  await store.put('sets', satz);
  return satz;
}

export async function updateSet(store, id, changes) {
  const existing = store.byId('sets', id);
  if (!existing) return undefined;
  return store.put('sets', createSet({ ...existing, ...changes }));
}

export async function removeSet(store, id) {
  await store.remove('sets', id);
}

export const setsOfSession = (sets, sessionId) =>
  sets.filter((s) => s.sessionId === sessionId).sort(byTime);

export const setsOfExercise = (sets, exerciseId) =>
  sets.filter((s) => s.exerciseId === exerciseId).sort(byTime);

/** Die Arbeitssätze -- ohne das Aufwärmen. */
export const workingSets = (sets) => sets.filter((s) => !s.warmup);

/**
 * Das Gewicht, das bei diesem Satz tatsächlich bewegt wurde.
 *
 * Bei Körpergewichtsübungen ist das der Mensch plus Zusatzgewicht. Ohne
 * angegebenes Körpergewicht bleibt nur das Zusatzgewicht übrig -- lieber
 * eine zu kleine Zahl als eine erfundene.
 */
export function effectiveWeight(set, exercise, bodyweight = null) {
  const zusatz = set.weight ?? 0;
  if (exercise?.kind !== 'koerper') return zusatz;
  return (zahl(bodyweight) ?? 0) + zusatz;
}

/**
 * Volumen: Gewicht mal Wiederholungen, über beliebig viele Sätze.
 *
 * Die eine Zahl, an der sich Trainingsumfang über Wochen vergleichen lässt.
 * Zeitübungen tragen nichts bei -- eine gehaltene Planke bewegt kein
 * Gewicht, und sie in Kilogramm umzurechnen wäre eine Erfindung.
 */
export function volume(sets, exercisesById, bodyweight = null) {
  let summe = 0;
  for (const satz of workingSets(sets)) {
    const exercise = exercisesById.get?.(satz.exerciseId) ?? exercisesById[satz.exerciseId];
    if (exercise?.kind === 'zeit' || !satz.reps) continue;
    summe += effectiveWeight(satz, exercise, bodyweight) * satz.reps;
  }
  return summe;
}

/** Alles, was über einer Einheit in der Liste steht. */
export function sessionSummary(session, sets, exercisesById, bodyweight = null) {
  const eigene = setsOfSession(sets, session.id);
  const arbeit = workingSets(eigene);
  const ende = session.endedAt ?? eigene.at(-1)?.at ?? session.startedAt;

  return {
    setCount: arbeit.length,
    reps: arbeit.reduce((summe, satz) => summe + (satz.reps ?? 0), 0),
    seconds: arbeit.reduce((summe, satz) => summe + (satz.seconds ?? 0), 0),
    volume: volume(eigene, exercisesById, bodyweight),
    exerciseIds: [...new Set(arbeit.map((satz) => satz.exerciseId))],
    /** Dauer in Minuten, gerundet. Ohne Sätze gibt es keine. */
    minutes: arbeit.length
      ? Math.max(1, Math.round((new Date(ende) - new Date(session.startedAt)) / 60000))
      : 0,
  };
}

/**
 * Wie diese Übung beim letzten Mal lief.
 *
 * "Letztes Mal" ist die letzte Einheit, in der sie vorkam -- nicht die
 * letzten drei Sätze. Wer heute schon zwei Sätze gemacht hat, will als
 * Vergleich trotzdem das vollständige Bild vom letzten Training sehen.
 */
export function lastPerformance(sets, exerciseId, { exceptSessionId = null } = {}) {
  const eigene = setsOfExercise(sets, exerciseId).filter(
    (satz) => satz.sessionId !== exceptSessionId,
  );
  if (!eigene.length) return null;

  const letzteEinheit = eigene.at(-1).sessionId;
  const saetze = eigene.filter((satz) => satz.sessionId === letzteEinheit);

  return { sessionId: letzteEinheit, at: saetze.at(-1).at, sets: saetze };
}
