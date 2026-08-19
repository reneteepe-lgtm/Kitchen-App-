import test from 'node:test';
import assert from 'node:assert/strict';

import { createExercise, createSet } from '../js/model.js';
import {
  toDisplay,
  fromDisplay,
  formatWeight,
  formatVolume,
  formatSet,
  formatSetGroup,
  formatClock,
  formatDuration,
  formatChange,
  relativeDay,
  daysBetween,
  plural,
} from '../js/format.js';

const bank = createExercise({ name: 'Bankdrücken' });
const klimm = createExercise({ name: 'Klimmzüge' });
const planke = createExercise({ name: 'Planke' });

/**
 * Der Grund, warum es diese beiden Funktionen gibt: Gespeichert wird
 * ausnahmslos in Kilogramm. Ein Umschalten der Anzeige darf keine einzige
 * gespeicherte Zahl verändern.
 */
test('rechnet nur für die Anzeige um, hin und zurück', () => {
  assert.equal(toDisplay(100, 'kg'), 100);
  assert.equal(Math.round(toDisplay(100, 'lb')), 220);

  const zurueck = fromDisplay(toDisplay(62.5, 'lb'), 'lb');
  assert.ok(Math.abs(zurueck - 62.5) < 1e-9, 'die Umrechnung verliert nichts');
});

test('schreibt Gewichte mit Komma und ohne überflüssige Null', () => {
  assert.equal(formatWeight(62.5, 'kg'), '62,5 kg');
  assert.equal(formatWeight(60, 'kg'), '60 kg');
  assert.equal(formatWeight(60, 'kg', { suffix: false }), '60');
});

test('Volumen wird ab einer Tonne zur Tonne', () => {
  assert.equal(formatVolume(840, 'kg'), '840 kg');
  assert.equal(formatVolume(12400, 'kg'), '12,4 t');
});

/**
 * Die drei Übungsarten sehen verschieden aus, weil sie verschieden sind.
 */
test('schreibt einen Satz in der Sprache seiner Übungsart', () => {
  assert.equal(formatSet(createSet({ weight: 80, reps: 8 }), bank, 'kg'), '80 kg × 8');
  assert.equal(formatSet(createSet({ weight: 0, reps: 8 }), klimm, 'kg'), '8 Wdh.');
  assert.equal(formatSet(createSet({ weight: 10, reps: 8 }), klimm, 'kg'), '+10 kg × 8');
  assert.equal(formatSet(createSet({ seconds: 45 }), planke, 'kg'), '45 s');
});

test('fasst gleiche Sätze zusammen, statt sie dreimal zu schreiben', () => {
  const gleich = [
    createSet({ weight: 80, reps: 8 }),
    createSet({ weight: 80, reps: 8 }),
    createSet({ weight: 80, reps: 8 }),
  ];
  assert.equal(formatSetGroup(gleich, bank, 'kg'), '3 × 80 kg × 8');

  const gemischt = [createSet({ weight: 80, reps: 8 }), createSet({ weight: 80, reps: 6 })];
  assert.equal(formatSetGroup(gemischt, bank, 'kg'), '80 kg × 8 · 80 kg × 6');
});

test('die Pausenuhr zeigt Sekunden immer zweistellig', () => {
  assert.equal(formatClock(90), '1:30');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(-5), '0:00', 'unter null gibt es keine Pause');
});

test('Trainingsdauer wird ab einer Stunde zur Stundenangabe', () => {
  assert.equal(formatDuration(48), '48 min');
  assert.equal(formatDuration(75), '1:15 h');
});

test('Veränderungen bekommen ein echtes Minuszeichen', () => {
  assert.equal(formatChange(0.12), '+12 %');
  assert.equal(formatChange(-0.08), '−8 %');
  assert.equal(formatChange(0), '±0 %');
});

test('zählt Tage über Kalendertage, nicht über Stunden', () => {
  const gesternAbend = new Date();
  gesternAbend.setDate(gesternAbend.getDate() - 1);
  gesternAbend.setHours(23, 0, 0, 0);

  const heuteFrueh = new Date();
  heuteFrueh.setHours(1, 0, 0, 0);

  assert.equal(daysBetween(gesternAbend, heuteFrueh), 1, 'zwei Stunden, aber ein Tag');
  assert.equal(relativeDay(gesternAbend, heuteFrueh), 'gestern');
});

test('plural', () => {
  assert.equal(plural(1, 'Satz', 'Sätze'), '1 Satz');
  assert.equal(plural(3, 'Satz', 'Sätze'), '3 Sätze');
});
