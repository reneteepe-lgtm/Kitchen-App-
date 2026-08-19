import test from 'node:test';
import assert from 'node:assert/strict';

import { createExercise, createSet } from '../js/model.js';
import { suggestNext, suggestForToday, roundToIncrement } from '../js/progression.js';

const bank = createExercise({ id: 'bank', name: 'Bankdrücken', repTarget: 8 });
const curls = createExercise({ id: 'curls', name: 'Bizepscurls KH', repTarget: 12 });
const planke = createExercise({ id: 'planke', name: 'Planke' });

let nummer = 0;
const satz = (data) =>
  createSet({ id: `set${++nummer}`, exerciseId: data.exerciseId ?? bank.id, ...data });

const einheit = (sessionId, saetze) => saetze.map((s) => satz({ sessionId, ...s }));

test('rundet auf Gewichte, die man auch auflegen kann', () => {
  assert.equal(roundToIncrement(61.3, 2.5), 62.5);
  assert.equal(roundToIncrement(103, 5), 105);
  assert.equal(roundToIncrement(20.4, 2), 20);
});

test('ohne Vorgeschichte gibt es keinen Vorschlag, sondern einen Hinweis', () => {
  const vorschlag = suggestNext(bank, []);

  assert.equal(vorschlag.kind, 'neu');
  assert.equal(vorschlag.weight, 0);
  assert.equal(vorschlag.reps, 8);
});

/**
 * Die eine Regel, aus der alles folgt: Ziel erreicht, also mehr Gewicht.
 */
test('alle Sätze am Ziel: das Gewicht steigt um den kleinsten Schritt', () => {
  const saetze = einheit('s1', [
    { weight: 60, reps: 8 },
    { weight: 60, reps: 8 },
    { weight: 60, reps: 8 },
  ]);

  const vorschlag = suggestNext(bank, saetze);
  assert.equal(vorschlag.kind, 'steigern');
  assert.equal(vorschlag.weight, 62.5, 'Langhantel: 2,5 kg');
  assert.equal(vorschlag.reps, 8);
  assert.equal(vorschlag.setCount, 3, 'so viele Sätze wie letztes Mal');
});

test('das Gerät bestimmt den Schritt', () => {
  const saetze = einheit('s1', [{ exerciseId: curls.id, weight: 14, reps: 12 }]);
  assert.equal(suggestNext(curls, saetze).weight, 14 + 2, 'Kurzhantel: 2 kg');
});

test('Ziel verfehlt: dasselbe Gewicht bleibt stehen', () => {
  const saetze = einheit('s1', [
    { weight: 60, reps: 8 },
    { weight: 60, reps: 6 },
  ]);

  const vorschlag = suggestNext(bank, saetze);
  assert.equal(vorschlag.kind, 'halten');
  assert.equal(vorschlag.weight, 60);
  assert.match(vorschlag.reason, /8, 6/, 'nennt alle Sätze, nicht nur den besten');
});

/**
 * Ein schlechter Tag ist ein schlechter Tag. Zwei hintereinander sind ein
 * Muster -- und dann ist weniger Gewicht der schnellere Weg nach oben.
 */
test('zweimal deutlich unter dem Ziel: zehn Prozent runter', () => {
  const saetze = [
    ...einheit('s1', [{ weight: 100, reps: 4 }]),
    ...einheit('s2', [{ weight: 100, reps: 3 }]),
  ];

  const vorschlag = suggestNext(bank, saetze);
  assert.equal(vorschlag.kind, 'entlasten');
  assert.equal(vorschlag.weight, 90);
});

test('ein einzelner schlechter Tag führt noch zu keiner Entlastung', () => {
  const saetze = [
    ...einheit('s1', [{ weight: 100, reps: 8 }]),
    ...einheit('s2', [{ weight: 100, reps: 4 }]),
  ];

  assert.equal(suggestNext(bank, saetze).kind, 'halten');
});

test('Aufwärmsätze reden beim Vorschlag nicht mit', () => {
  const saetze = einheit('s1', [
    { weight: 20, reps: 20, warmup: true },
    { weight: 60, reps: 8 },
  ]);

  const vorschlag = suggestNext(bank, saetze);
  assert.equal(vorschlag.kind, 'steigern');
  assert.equal(vorschlag.weight, 62.5);
  assert.equal(vorschlag.setCount, 1);
});

/**
 * Wer sechs Klimmzüge schafft, hängt sich nicht als Nächstes eine Scheibe
 * um -- er macht sieben. Erst wer ohnehin mit Gurt trainiert, steigert
 * wieder am Gewicht.
 */
test('Körpergewichtsübungen wachsen in Wiederholungen', () => {
  const klimm = createExercise({ id: 'klimm', name: 'Klimmzüge', repTarget: 6 });
  const ohneZusatz = einheit('s1', [{ exerciseId: klimm.id, weight: 0, reps: 8 }]);

  const vorschlag = suggestNext(klimm, ohneZusatz);
  assert.equal(vorschlag.kind, 'steigern');
  assert.equal(vorschlag.weight, 0);
  assert.equal(vorschlag.reps, 9, 'eine mehr als zuletzt');

  const mitGurt = einheit('s1', [{ exerciseId: klimm.id, weight: 10, reps: 8 }]);
  assert.equal(suggestNext(klimm, mitGurt).weight, 11.25, 'mit Zusatzgewicht wieder in Kilogramm');
});

test('bei Zeitübungen wächst die Zeit statt des Gewichts', () => {
  const gehalten = einheit('s1', [{ exerciseId: planke.id, seconds: 45 }]);
  const vorschlag = suggestNext(planke, gehalten);

  assert.equal(vorschlag.kind, 'steigern');
  assert.equal(vorschlag.seconds, 55);
  assert.equal(vorschlag.weight, 0);

  const kurz = einheit('s1', [{ exerciseId: planke.id, seconds: 30 }]);
  assert.equal(suggestNext(planke, kurz).seconds, 45, 'sonst bleibt das Ziel stehen');
});

/**
 * Mitten im Training zählt, was gerade auf der Stange liegt -- nicht das
 * Ziel für nächste Woche.
 */
test('während der Einheit gilt das Gewicht des letzten Satzes', () => {
  const saetze = [
    ...einheit('alt', [{ weight: 60, reps: 8 }]),
    ...einheit('heute', [{ weight: 62.5, reps: 8 }]),
  ];

  const vorschlag = suggestForToday(bank, saetze, 'heute');
  assert.equal(vorschlag.weight, 62.5);
  assert.equal(vorschlag.setCount, 2, 'der nächste ist der zweite Satz');
});

test('vor dem ersten Satz des Tages zählt allein, was vorher war', () => {
  const saetze = einheit('alt', [{ weight: 60, reps: 8 }]);

  const vorschlag = suggestForToday(bank, saetze, 'heute');
  assert.equal(vorschlag.kind, 'steigern');
  assert.equal(vorschlag.weight, 62.5);
});

test('jeder Vorschlag sagt, warum', () => {
  const saetze = einheit('s1', [{ weight: 60, reps: 8 }]);
  assert.match(suggestNext(bank, saetze).reason, /2,5 kg/);
});
