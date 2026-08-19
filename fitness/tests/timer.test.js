import test from 'node:test';
import assert from 'node:assert/strict';

import { restState, suggestRest, justFinished } from '../js/timer.js';
import { createExercise } from '../js/model.js';

const start = new Date('2026-08-19T18:00:00Z');
const spaeter = (sekunden) => new Date(start.getTime() + sekunden * 1000);

/**
 * Der Grund, warum die Uhr rechnet statt zählt: Handys halten Zeitgeber an,
 * sobald der Bildschirm ausgeht. Ein Zähler stünde nach dem Aufwachen zu
 * hoch; eine Rechnung stimmt immer.
 */
test('die Uhr rechnet aus der Uhrzeit, nicht aus Ticks', () => {
  const stand = restState(start, 120, spaeter(30));

  assert.equal(stand.remaining, 90);
  assert.equal(stand.elapsed, 30);
  assert.equal(stand.progress, 0.25);
  assert.equal(stand.done, false);
});

test('nach dem Ende bleibt sie bei null stehen', () => {
  const stand = restState(start, 120, spaeter(300));

  assert.equal(stand.remaining, 0);
  assert.equal(stand.done, true);
  assert.equal(stand.progress, 1);
});

test('eine Pause ohne Dauer ist sofort vorbei', () => {
  assert.equal(restState(start, 0, start).done, true);
});

test('schwere Übungen bekommen längere Pausen vorgeschlagen', () => {
  const kniebeuge = createExercise({ name: 'Kniebeugen' });
  const seitheben = createExercise({ name: 'Seitheben KH', repTarget: 15 });
  const planke = createExercise({ name: 'Planke' });

  assert.equal(suggestRest(kniebeuge, 120), 180);
  assert.equal(suggestRest(seitheben, 120), 90);
  assert.equal(suggestRest(planke, 120), 60);
});

/**
 * Das Signal soll genau einmal kommen. Ohne diesen Vergleich vibrierte das
 * Handy ab dem Ablauf durchgehend weiter.
 */
test('das Ende wird genau einmal gemeldet', () => {
  const laeuft = restState(start, 60, spaeter(30));
  const fertig = restState(start, 60, spaeter(61));
  const immerNochFertig = restState(start, 60, spaeter(62));

  assert.equal(justFinished(laeuft, fertig), true);
  assert.equal(justFinished(fertig, immerNochFertig), false);
});
