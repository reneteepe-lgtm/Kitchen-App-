import test from 'node:test';
import assert from 'node:assert/strict';

import { createExercise, createSet } from '../js/model.js';
import {
  dayKey,
  startOfWeek,
  estimate1RM,
  set1RM,
  strongerSet,
  records,
  newRecords,
  dailySeries,
  weeklyVolume,
  trend,
  muscleShare,
  weekSummary,
  weekStreak,
  totals,
  recentExercises,
  recentRecords,
} from '../js/stats.js';

const bank = createExercise({ id: 'bank', name: 'Bankdrücken' });
const klimm = createExercise({ id: 'klimm', name: 'Klimmzüge' });
const planke = createExercise({ id: 'planke', name: 'Planke' });
const karte = new Map([bank, klimm, planke].map((ex) => [ex.id, ex]));

let laufendeNummer = 0;
const satz = (data) =>
  createSet({
    id: `set${++laufendeNummer}`,
    sessionId: data.sessionId ?? 's1',
    exerciseId: data.exerciseId ?? bank.id,
    ...data,
  });

const vorTagen = (tage, stunde = 18) => {
  const d = new Date();
  d.setDate(d.getDate() - tage);
  d.setHours(stunde, 0, 0, 0);
  return d.toISOString();
};

// --- Tage und Wochen -----------------------------------------------------

/**
 * Der Grund, warum `dayKey` nicht `toISOString().slice(0, 10)` ist: Ein
 * Satz am späten Abend gehört zum Trainingstag, nicht zum nächsten Morgen.
 */
test('der Tagesschlüssel gilt in Ortszeit', () => {
  const abends = new Date();
  abends.setHours(23, 30, 0, 0);

  const erwartet = `${abends.getFullYear()}-${String(abends.getMonth() + 1).padStart(2, '0')}-${String(abends.getDate()).padStart(2, '0')}`;
  assert.equal(dayKey(abends), erwartet);
});

test('die Woche fängt am Montag an', () => {
  // 19. August 2026 ist ein Mittwoch.
  const mittwoch = new Date(2026, 7, 19, 12, 0, 0);
  const montag = startOfWeek(mittwoch);

  assert.equal(montag.getDay(), 1);
  assert.equal(montag.getDate(), 17);

  const sonntag = new Date(2026, 7, 23, 12, 0, 0);
  assert.equal(startOfWeek(sonntag).getDate(), 17, 'der Sonntag gehört zur Woche davor');
});

// --- Ein einzelner Satz --------------------------------------------------

test('schätzt das Maximalgewicht nach Epley', () => {
  assert.equal(estimate1RM(100, 1).value, 100, 'eine Wiederholung ist das Maximum selbst');
  assert.equal(Math.round(estimate1RM(100, 10).value), 133);
  assert.equal(estimate1RM(0, 5), null);
  assert.equal(estimate1RM(100, 0), null);
});

/**
 * Die Formel wird nicht versteckt, wo sie nicht mehr taugt -- sie wird
 * gekennzeichnet. Anzeigen lässt sich das dann als "geschätzt", statt es
 * zu verschweigen.
 */
test('oberhalb von zwölf Wiederholungen gilt die Schätzung als unsicher', () => {
  assert.equal(estimate1RM(60, 12).reliable, true);
  assert.equal(estimate1RM(60, 20).reliable, false);
});

test('vergleicht Sätze über das geschätzte Maximum, nicht über das Gewicht', () => {
  const schwer = satz({ weight: 100, reps: 3 });
  const leicht = satz({ weight: 90, reps: 8 });
  assert.equal(strongerSet(schwer, leicht, bank), leicht, '90 × 8 ist mehr als 100 × 3');

  const wenig = satz({ weight: 70, reps: 5 });
  const viele = satz({ weight: 60, reps: 12 });
  assert.equal(strongerSet(wenig, viele, bank), viele);
});

test('bei Körpergewichtsübungen zählt der Mensch mit', () => {
  const zug = satz({ exerciseId: klimm.id, weight: 0, reps: 10 });
  assert.equal(Math.round(set1RM(zug, klimm, 80).value), 107);
  assert.equal(
    set1RM(zug, klimm, null),
    null,
    'ohne angegebenes Körpergewicht bleibt nichts zu schätzen übrig',
  );
  assert.equal(set1RM(satz({ exerciseId: planke.id, seconds: 60 }), planke), null);
});

// --- Bestwerte -----------------------------------------------------------

test('kennt drei Bestwerte, weil es drei Fragen sind', () => {
  const saetze = [
    satz({ weight: 100, reps: 3 }),
    satz({ weight: 80, reps: 12 }),
    satz({ weight: 90, reps: 8 }),
  ];

  const best = records(saetze, bank);
  assert.equal(best.heaviest.weight, 100, 'das schwerste Gewicht');
  assert.equal(best.mostReps.reps, 12, 'die meisten Wiederholungen');
  assert.equal(best.best.weight, 90, 'die stärkste Leistung insgesamt');
});

test('der allererste Satz einer Übung ist kein Bestwert, sondern ein Anfang', () => {
  const erster = satz({ weight: 60, reps: 8 });
  assert.deepEqual(newRecords(erster, [], bank), []);
});

test('erkennt einen neuen Bestwert im Moment des Eintragens', () => {
  const vorher = [satz({ weight: 60, reps: 8 })];

  assert.deepEqual(newRecords(satz({ weight: 65, reps: 8 }), vorher, bank), ['weight', 'estimate']);
  assert.deepEqual(newRecords(satz({ weight: 60, reps: 10 }), vorher, bank), ['reps', 'estimate']);
  assert.deepEqual(newRecords(satz({ weight: 55, reps: 8 }), vorher, bank), []);
});

test('ein Aufwärmsatz ist nie ein Bestwert', () => {
  const vorher = [satz({ weight: 60, reps: 8 })];
  const aufwaermen = satz({ weight: 100, reps: 10, warmup: true });

  assert.deepEqual(newRecords(aufwaermen, vorher, bank), []);
});

test('bei Zeitübungen zählt die gehaltene Zeit', () => {
  const vorher = [satz({ exerciseId: planke.id, seconds: 45 })];
  const laenger = satz({ exerciseId: planke.id, seconds: 60 });

  assert.deepEqual(newRecords(laenger, vorher, planke), ['seconds']);
  assert.equal(records(vorher, planke).longest.seconds, 45);
});

// --- Verläufe ------------------------------------------------------------

test('der Verlauf hat einen Punkt je Trainingstag, nicht je Satz', () => {
  const saetze = [
    satz({ weight: 60, reps: 8, at: vorTagen(7) }),
    satz({ weight: 60, reps: 6, at: vorTagen(7, 19) }),
    satz({ weight: 65, reps: 8, at: vorTagen(0) }),
  ];

  const reihe = dailySeries(saetze, bank, 'top');
  assert.equal(reihe.length, 2);
  assert.equal(reihe[0].value, 60);
  assert.equal(reihe[1].value, 65, 'je Tag der beste Satz');
});

test('als Volumen wird der Tag aufsummiert, nicht der beste Satz genommen', () => {
  const saetze = [
    satz({ weight: 50, reps: 10, at: vorTagen(1) }),
    satz({ weight: 50, reps: 10, at: vorTagen(1, 19) }),
  ];

  assert.equal(dailySeries(saetze, bank, 'volume')[0].value, 1000);
});

test('zählt das Volumen je Woche und lässt leere Wochen als Lücke stehen', () => {
  const saetze = [
    satz({ weight: 100, reps: 10, at: vorTagen(0) }),
    satz({ weight: 100, reps: 10, at: vorTagen(14) }),
  ];

  const wochen = weeklyVolume(saetze, karte, { weeks: 4 });
  assert.equal(wochen.length, 4);
  assert.equal(wochen.at(-1).volume, 1000, 'diese Woche');
  assert.equal(wochen.at(-2).volume, 0, 'die Pause bleibt sichtbar');
  assert.equal(wochen.at(-3).volume, 1000);
});

test('der Trend vergleicht zwei Hälften und nennt kleine Ausschläge nicht Entwicklung', () => {
  assert.equal(trend([{ volume: 10 }, { volume: 10 }, { volume: 20 }, { volume: 20 }]).direction, 'hoch');
  assert.equal(trend([{ volume: 20 }, { volume: 20 }, { volume: 10 }, { volume: 10 }]).direction, 'runter');
  assert.equal(trend([{ volume: 100 }, { volume: 100 }, { volume: 102 }, { volume: 100 }]).direction, 'gleich');
  assert.equal(trend([{ volume: 10 }, { volume: 10 }]).change, null, 'zwei Wochen sind kein Trend');
});

test('verteilt das Volumen auf die Muskelgruppen', () => {
  const saetze = [
    satz({ exerciseId: bank.id, weight: 100, reps: 10 }),
    satz({ exerciseId: klimm.id, weight: 0, reps: 10 }),
  ];

  const anteile = muscleShare(saetze, karte, 80);
  const brust = anteile.find((a) => a.muscle === 'brust');
  const ruecken = anteile.find((a) => a.muscle === 'ruecken');

  assert.equal(brust.value, 1000);
  assert.equal(ruecken.value, 800, 'Klimmzüge zählen mit dem Körpergewicht');
  assert.ok(Math.abs(brust.share + ruecken.share - 1) < 1e-9);
});

// --- Regelmäßigkeit ------------------------------------------------------

const einheit = (tage) => ({ id: `s${tage}`, startedAt: vorTagen(tage) });

test('zählt die Einheiten der laufenden Woche', () => {
  const montag = startOfWeek(new Date());
  const seitMontag = Math.round((Date.now() - montag.getTime()) / 86400000);

  const einheiten = [einheit(0), einheit(seitMontag + 3)];
  const woche = weekSummary(einheiten, { goal: 3 });

  assert.equal(woche.count, 1, 'die Einheit von letzter Woche zählt nicht mit');
  assert.equal(woche.remaining, 2);
  assert.equal(woche.reached, false);
});

/**
 * Die laufende Woche zählt nur mit, wenn sie das Ziel schon erreicht hat --
 * sonst risse die Serie jeden Montagmorgen ab, obwohl niemand etwas
 * versäumt hat.
 */
test('die Serie reißt nicht am Montagmorgen', () => {
  const letzteWoche = startOfWeek(new Date());
  letzteWoche.setDate(letzteWoche.getDate() - 7);

  const einheiten = [0, 1, 2].map((i) => {
    const d = new Date(letzteWoche);
    d.setDate(d.getDate() + i);
    return { id: `s${i}`, startedAt: d.toISOString() };
  });

  assert.equal(weekStreak(einheiten, { goal: 3 }), 1, 'letzte Woche zählt weiter');
});

test('rechnet die Eckdaten zusammen', () => {
  const saetze = [satz({ weight: 100, reps: 10 }), satz({ weight: 50, reps: 10, warmup: true })];
  const gesamt = totals(saetze, [{ id: 's1' }], karte);

  assert.equal(gesamt.sessions, 1);
  assert.equal(gesamt.sets, 1, 'ohne das Aufwärmen');
  assert.equal(gesamt.reps, 10);
  assert.equal(gesamt.volume, 1000);
});

test('nennt die zuletzt trainierten Übungen in der richtigen Reihenfolge', () => {
  const saetze = [
    satz({ exerciseId: bank.id, weight: 60, reps: 8, at: vorTagen(5) }),
    satz({ exerciseId: klimm.id, reps: 8, at: vorTagen(1) }),
  ];

  const liste = recentExercises(saetze, [bank, klimm, planke]);
  assert.deepEqual(liste.map((e) => e.exercise.id), [klimm.id, bank.id]);
  assert.equal(liste.length, 2, 'was nie dran war, steht nicht dabei');
});

test('sammelt die zuletzt aufgestellten Bestwerte', () => {
  const saetze = [
    satz({ exerciseId: bank.id, weight: 60, reps: 8, at: vorTagen(20) }),
    satz({ exerciseId: bank.id, weight: 70, reps: 8, at: vorTagen(2) }),
    satz({ exerciseId: klimm.id, reps: 8, at: vorTagen(10) }),
  ];

  const liste = recentRecords(saetze, [bank, klimm]);
  assert.equal(liste.length, 1, 'ein einzelner Satz je Übung ergibt noch keinen Bestwert');
  assert.equal(liste[0].exercise.id, bank.id);
  assert.ok(liste[0].kinds.includes('weight'));
});
