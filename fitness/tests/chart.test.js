import test from 'node:test';
import assert from 'node:assert/strict';

import { range, linePath, barLayout, ringDash } from '../js/chart.js';

/**
 * Der Grund, warum die Achse nicht bei null anfängt: Eine Kurve von 100 auf
 * 105 kg wäre über einer Nullachse eine waagerechte Linie -- und genau der
 * Unterschied ist das, was man sehen will.
 */
test('der Wertebereich umschließt die Werte mit etwas Luft', () => {
  const { min, max } = range([100, 105]);

  assert.ok(min < 100 && min > 90);
  assert.ok(max > 105 && max < 110);
});

test('lauter gleiche Werte ergeben eine Linie in der Mitte', () => {
  const { min, max } = range([50, 50, 50]);
  assert.ok(min < 50 && max > 50);
});

test('die Kurve steigt nach oben, nicht nach unten', () => {
  const { points } = linePath([10, 20], { width: 100, height: 100, padding: 10 });

  assert.equal(points.length, 2);
  assert.ok(points[1].y < points[0].y, 'in Bildkoordinaten ist oben der kleinere Wert');
  assert.equal(points[0].x, 10);
  assert.equal(points[1].x, 90);
});

test('ein einzelner Punkt steht in der Mitte', () => {
  const { points } = linePath([42], { width: 100, height: 100, padding: 10 });
  assert.equal(points[0].x, 50);
});

test('die Fläche unter der Kurve ist geschlossen', () => {
  const { area } = linePath([1, 2, 3], { width: 100, height: 100, padding: 10 });
  assert.match(area, /Z$/);
});

test('leere Reihen ergeben keinen Pfad und keinen Fehler', () => {
  const leer = linePath([]);
  assert.equal(leer.line, '');
  assert.deepEqual(barLayout([]), []);
});

/**
 * Verglichen werden die Wochen untereinander -- eine Reihe, in der alle
 * Balken zwei Pixel hoch sind, weil vor einem Jahr einmal mehr los war,
 * vergleicht gar nichts.
 */
test('die Balken beziehen sich auf den größten der Reihe', () => {
  const balken = barLayout([50, 100], { width: 100, height: 100, gap: 0 });

  assert.equal(balken[1].height, 100);
  assert.equal(balken[0].height, 50);
  assert.equal(balken[1].y, 0, 'der größte Balken reicht bis oben');
});

test('eine leere Woche bekommt keine Höhe', () => {
  const balken = barLayout([0, 100], { width: 100, height: 100, gap: 0 });
  assert.equal(balken[0].height, 0);
});

test('der Ring färbt den Umfang anteilig ein', () => {
  const voll = ringDash(1, 10);
  const leer = ringDash(0, 10);
  const halb = ringDash(0.5, 10);

  assert.equal(voll.offset, 0);
  assert.equal(leer.offset, leer.circumference);
  assert.ok(Math.abs(halb.offset - halb.circumference / 2) < 1e-9);
});

test('mehr als voll bleibt voll', () => {
  assert.equal(ringDash(2, 10).offset, 0, 'vier von drei Einheiten sprengen den Ring nicht');
});
