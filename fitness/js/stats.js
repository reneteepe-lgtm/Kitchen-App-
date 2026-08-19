/**
 * Die Auswertung.
 *
 * Alles hier ist eine reine Funktion über Sätzen. Nichts wird gespeichert,
 * nichts mitgeführt, nichts fortgeschrieben -- jede Zahl auf dem Bildschirm
 * wird aus dem Protokoll neu gerechnet. Das ist ein bisschen mehr Arbeit
 * für den Rechner und sehr viel weniger Ärger für alle anderen: Ein
 * nachgetragener oder gelöschter Satz ändert damit rückwirkend jede Zahl,
 * die von ihm abhängt, und es gibt keinen Zwischenstand, der auseinander
 * laufen könnte.
 *
 * Die Größenordnung erlaubt das mühelos. Wer fünf Jahre lang viermal die
 * Woche trainiert, hat rund 25 000 Sätze -- eine Liste, die ein Handy in
 * ein paar Millisekunden durchgeht.
 */

import { effectiveWeight, volume, workingSets, setsOfExercise, byTime } from './model.js';

// --- Tage und Wochen -----------------------------------------------------

/**
 * Der Tagesschlüssel in Ortszeit.
 *
 * Bewusst nicht `toISOString().slice(0, 10)`: Das rechnet nach Greenwich
 * um, und ein Satz um 23:30 mitteleuropäischer Sommerzeit gehörte dann zum
 * nächsten Tag. Das Training war aber am Abend, nicht am Morgen danach.
 */
export function dayKey(dateish) {
  const d = new Date(dateish);
  const monat = String(d.getMonth() + 1).padStart(2, '0');
  const tag = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${monat}-${tag}`;
}

/** Montag null Uhr der Woche, in der dieser Zeitpunkt liegt. */
export function startOfWeek(dateish = new Date()) {
  const d = new Date(dateish);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 ist Sonntag. Der Sonntag gehört hier zur Woche davor.
  const versatz = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - versatz);
  return d;
}

export const sameWeek = (a, b) => startOfWeek(a).getTime() === startOfWeek(b).getTime();

// --- Ein einzelner Satz --------------------------------------------------

/**
 * Schätzt aus einem Satz das Gewicht für eine einzige Wiederholung.
 *
 * Formel nach Epley: `Gewicht × (1 + Wiederholungen / 30)`. Sie ist die
 * gebräuchlichste, kommt ohne Tabelle aus und ist in dem Bereich, um den es
 * geht, genau genug.
 *
 * Ihre Grenze ist bekannt und wird deshalb mitgeführt: Oberhalb von zwölf
 * Wiederholungen schätzt sie zu hoch, weil dort die Ausdauer den Ausschlag
 * gibt und nicht die Kraft. Die App rechnet trotzdem weiter -- aber
 * `reliable` steht dann auf `false`, und die Anzeige sagt es dazu.
 *
 * @returns {{value:number, reliable:boolean}|null}
 */
export function estimate1RM(weight, reps) {
  if (!(weight > 0) || !(reps >= 1)) return null;
  if (reps === 1) return { value: weight, reliable: true };
  return { value: weight * (1 + reps / 30), reliable: reps <= 12 };
}

/** Dasselbe für einen Satz, mit Körpergewicht, wo es dazugehört. */
export function set1RM(set, exercise, bodyweight = null) {
  if (exercise?.kind === 'zeit') return null;
  return estimate1RM(effectiveWeight(set, exercise, bodyweight), set.reps);
}

/**
 * Vergleicht zwei Sätze danach, welcher der stärkere war.
 *
 * Über das geschätzte Maximalgewicht, nicht über das aufgelegte: 100 kg mal
 * 3 ist mehr als 90 kg mal 8 -- aber 60 kg mal 12 ist mehr als 70 kg mal 5,
 * und beides sähe man einer Gewichtsspalte allein nicht an.
 */
export function strongerSet(a, b, exercise, bodyweight = null) {
  if (exercise?.kind === 'zeit') return (a?.seconds ?? 0) >= (b?.seconds ?? 0) ? a : b;
  const wertA = set1RM(a, exercise, bodyweight)?.value ?? 0;
  const wertB = set1RM(b, exercise, bodyweight)?.value ?? 0;
  if (wertA === wertB) return (a.reps ?? 0) >= (b.reps ?? 0) ? a : b;
  return wertA > wertB ? a : b;
}

// --- Bestwerte -----------------------------------------------------------

/**
 * Die Bestwerte einer Übung.
 *
 * Drei Stück, weil sie drei verschiedene Fragen beantworten: Was ist das
 * schwerste, das ich je bewegt habe? Wie oft schaffe ich es maximal? Und
 * wie stark bin ich, wenn man beides zusammenrechnet?
 */
export function records(sets, exercise, bodyweight = null) {
  const arbeit = workingSets(sets).sort(byTime);
  if (!arbeit.length) return null;

  let schwerster = null;
  let meiste = null;
  let bester = null;
  let laengster = null;

  for (const satz of arbeit) {
    const gewicht = effectiveWeight(satz, exercise, bodyweight);

    if (satz.reps > 0 && (!schwerster || gewicht > effectiveWeight(schwerster, exercise, bodyweight))) {
      schwerster = satz;
    }
    if (satz.reps > 0 && (!meiste || satz.reps > meiste.reps)) meiste = satz;
    if (satz.reps > 0) bester = bester ? strongerSet(bester, satz, exercise, bodyweight) : satz;
    if (satz.seconds > 0 && (!laengster || satz.seconds > laengster.seconds)) laengster = satz;
  }

  return {
    heaviest: schwerster,
    mostReps: meiste,
    best: bester,
    best1RM: bester ? set1RM(bester, exercise, bodyweight) : null,
    longest: laengster,
  };
}

/**
 * Ist dieser Satz ein neuer Bestwert -- gemessen an allem davor?
 *
 * Wird beim Eintragen aufgerufen, damit die App es im selben Moment sagen
 * kann. Ein Bestwert, den man erst drei Wochen später in einer Auswertung
 * entdeckt, ist keiner mehr, sondern eine Fußnote.
 */
export function newRecords(set, previousSets, exercise, bodyweight = null) {
  if (set.warmup) return [];
  const vorher = records(previousSets, exercise, bodyweight);
  const gewicht = effectiveWeight(set, exercise, bodyweight);
  const treffer = [];

  if (!vorher) {
    // Der allererste Satz einer Übung ist kein Bestwert, sondern ein Anfang.
    return [];
  }

  if (exercise?.kind === 'zeit') {
    if (set.seconds > (vorher.longest?.seconds ?? 0)) treffer.push('seconds');
    return treffer;
  }

  if (set.reps > 0 && gewicht > effectiveWeight(vorher.heaviest ?? set, exercise, bodyweight)) {
    treffer.push('weight');
  }
  if (set.reps > (vorher.mostReps?.reps ?? 0)) treffer.push('reps');

  const neu = set1RM(set, exercise, bodyweight)?.value ?? 0;
  const alt = vorher.best1RM?.value ?? 0;
  // Ein halbes Prozent Abstand, damit Rundungsreste keinen Bestwert feiern.
  if (neu > alt * 1.005) treffer.push('estimate');

  return treffer;
}

// --- Verläufe ------------------------------------------------------------

/**
 * Der Verlauf einer Übung, ein Punkt je Trainingstag.
 *
 * Je Tag der beste Satz und nicht jeder einzelne: Ein Trainingstag ist eine
 * Leistung, und eine Kurve mit fünf Punkten pro Tag zeigt nur noch, in
 * welcher Reihenfolge die Sätze schwächer wurden.
 *
 * @param {'e1rm'|'top'|'volume'|'reps'|'seconds'} metric
 */
export function dailySeries(sets, exercise, metric = 'e1rm', bodyweight = null) {
  const proTag = new Map();

  for (const satz of workingSets(sets).sort(byTime)) {
    const tag = dayKey(satz.at);
    const bisher = proTag.get(tag) ?? { date: tag, value: 0, at: satz.at };
    const gewicht = effectiveWeight(satz, exercise, bodyweight);

    let wert = 0;
    if (metric === 'e1rm') wert = set1RM(satz, exercise, bodyweight)?.value ?? 0;
    else if (metric === 'top') wert = satz.reps > 0 ? gewicht : 0;
    else if (metric === 'reps') wert = satz.reps ?? 0;
    else if (metric === 'seconds') wert = satz.seconds ?? 0;
    else if (metric === 'volume') wert = bisher.value + gewicht * (satz.reps ?? 0);

    proTag.set(tag, { date: tag, at: satz.at, value: metric === 'volume' ? wert : Math.max(bisher.value, wert) });
  }

  return [...proTag.values()].filter((punkt) => punkt.value > 0).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Volumen je Woche, lückenlos.
 *
 * Wochen ohne Training stehen als Null darin. Sie einfach wegzulassen wäre
 * die freundlichere, aber falsche Kurve: Sie zeigte eine gleichmäßige
 * Steigerung, wo in Wirklichkeit drei Wochen Pause waren.
 */
export function weeklyVolume(sets, exercisesById, { weeks = 8, now = new Date(), bodyweight = null } = {}) {
  const buckets = [];
  const start = startOfWeek(now);

  for (let i = weeks - 1; i >= 0; i--) {
    const von = new Date(start);
    von.setDate(von.getDate() - i * 7);
    const bis = new Date(von);
    bis.setDate(bis.getDate() + 7);
    buckets.push({ weekStart: von, from: von.toISOString(), to: bis.toISOString(), volume: 0, sets: 0, sessions: new Set() });
  }

  for (const satz of workingSets(sets)) {
    const bucket = buckets.find((b) => satz.at >= b.from && satz.at < b.to);
    if (!bucket) continue;
    bucket.volume += volume([satz], exercisesById, bodyweight);
    bucket.sets += 1;
    bucket.sessions.add(satz.sessionId);
  }

  return buckets.map(({ sessions, ...bucket }) => ({ ...bucket, sessions: sessions.size }));
}

/**
 * Wie sich das Volumen entwickelt: die zweite Hälfte gegen die erste.
 *
 * Zwei Hälften statt "letzte Woche gegen vorletzte", weil einzelne Wochen
 * zu sehr schwanken -- ein Urlaub oder eine Erkältung macht aus jedem
 * Wochenvergleich einen Absturz.
 *
 * @returns {{change:number|null, direction:'hoch'|'runter'|'gleich'}}
 */
export function trend(buckets) {
  const werte = buckets.map((b) => b.volume ?? b.value ?? 0);
  if (werte.length < 4) return { change: null, direction: 'gleich' };

  const mitte = Math.floor(werte.length / 2);
  const summe = (liste) => liste.reduce((a, b) => a + b, 0);
  const frueher = summe(werte.slice(0, mitte));
  const spaeter = summe(werte.slice(mitte));

  if (!frueher) return { change: null, direction: spaeter > 0 ? 'hoch' : 'gleich' };

  const change = (spaeter - frueher) / frueher;
  // Unter fünf Prozent ist es Rauschen und keine Entwicklung.
  const direction = change > 0.05 ? 'hoch' : change < -0.05 ? 'runter' : 'gleich';
  return { change, direction };
}

/**
 * Wie sich das Volumen auf die Muskelgruppen verteilt.
 *
 * Nicht als Note, sondern als Bild: Die App sagt nicht, dass sechs Prozent
 * Rücken zu wenig sind. Sie zeigt die sechs Prozent, und der Rest ergibt
 * sich von selbst.
 */
export function muscleShare(sets, exercisesById, bodyweight = null) {
  const proGruppe = new Map();

  for (const satz of workingSets(sets)) {
    const exercise = exercisesById.get?.(satz.exerciseId) ?? exercisesById[satz.exerciseId];
    if (!exercise) continue;
    // Zeitübungen tragen kein Volumen bei; damit der Rumpf trotzdem
    // auftaucht, zählen sie hier mit ihren Sekunden als Ersatzgröße.
    const beitrag =
      exercise.kind === 'zeit'
        ? (satz.seconds ?? 0) * 0.5
        : effectiveWeight(satz, exercise, bodyweight) * (satz.reps ?? 0);
    proGruppe.set(exercise.muscle, (proGruppe.get(exercise.muscle) ?? 0) + beitrag);
  }

  const gesamt = [...proGruppe.values()].reduce((a, b) => a + b, 0);
  return [...proGruppe.entries()]
    .map(([muscle, wert]) => ({ muscle, value: wert, share: gesamt ? wert / gesamt : 0 }))
    .sort((a, b) => b.value - a.value);
}

// --- Einheiten und Regelmäßigkeit ---------------------------------------

/** Einheiten in der laufenden Woche, gemessen am Wochenziel. */
export function weekSummary(sessions, { goal = 3, now = new Date() } = {}) {
  const start = startOfWeek(now).toISOString();
  const count = sessions.filter((s) => s.startedAt >= start).length;
  return { count, goal, reached: count >= goal, remaining: Math.max(0, goal - count) };
}

/**
 * Wie viele Wochen in Folge das Ziel erreicht wurde.
 *
 * Die laufende Woche zählt nur mit, wenn sie das Ziel schon erreicht hat --
 * sonst risse die Serie jeden Montagmorgen ab, obwohl niemand etwas
 * versäumt hat.
 */
export function weekStreak(sessions, { goal = 3, now = new Date() } = {}) {
  if (!sessions.length) return 0;

  const proWoche = new Map();
  for (const session of sessions) {
    const woche = startOfWeek(session.startedAt).getTime();
    proWoche.set(woche, (proWoche.get(woche) ?? 0) + 1);
  }

  let woche = startOfWeek(now);
  let serie = 0;

  if ((proWoche.get(woche.getTime()) ?? 0) < goal) woche.setDate(woche.getDate() - 7);

  while ((proWoche.get(woche.getTime()) ?? 0) >= goal) {
    serie += 1;
    woche = new Date(woche.getTime());
    woche.setDate(woche.getDate() - 7);
  }

  return serie;
}

/** Die Eckdaten für die Startseite. */
export function totals(sets, sessions, exercisesById, bodyweight = null) {
  const arbeit = workingSets(sets);
  return {
    sessions: sessions.length,
    sets: arbeit.length,
    reps: arbeit.reduce((summe, satz) => summe + (satz.reps ?? 0), 0),
    volume: volume(sets, exercisesById, bodyweight),
  };
}

/**
 * Übungen, die zuletzt trainiert wurden -- mit dem, was dabei herauskam.
 *
 * Grundlage für "Weiter wie letztes Mal" auf der Startseite.
 */
export function recentExercises(sets, exercises, limit = 6) {
  const zuletzt = new Map();
  for (const satz of sets) {
    const bisher = zuletzt.get(satz.exerciseId);
    if (!bisher || satz.at > bisher) zuletzt.set(satz.exerciseId, satz.at);
  }

  return exercises
    .filter((exercise) => zuletzt.has(exercise.id))
    .map((exercise) => ({ exercise, at: zuletzt.get(exercise.id) }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** Alle Bestwerte, die zuletzt aufgestellt wurden -- neueste zuerst. */
export function recentRecords(sets, exercises, bodyweight = null, limit = 5) {
  const gefunden = [];

  for (const exercise of exercises) {
    const eigene = setsOfExercise(sets, exercise.id);
    const arbeit = workingSets(eigene);
    // Vom jüngsten Satz rückwärts: Der erste, der ein Bestwert war, ist der
    // aktuelle Bestwert dieser Übung.
    for (let i = arbeit.length - 1; i >= 0; i--) {
      const treffer = newRecords(arbeit[i], arbeit.slice(0, i), exercise, bodyweight);
      if (treffer.length) {
        gefunden.push({ exercise, set: arbeit[i], kinds: treffer, at: arbeit[i].at });
        break;
      }
    }
  }

  return gefunden.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
