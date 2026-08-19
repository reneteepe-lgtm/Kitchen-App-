import test from 'node:test';
import assert from 'node:assert/strict';

import {
  guessMuscle,
  guessEquipment,
  guessKind,
  guessRepTarget,
  guessAttributes,
  incrementFor,
  CATALOG,
} from '../js/muscles.js';

test('liest die Muskelgruppe aus dem Namen', () => {
  assert.equal(guessMuscle('Bankdrücken'), 'brust');
  assert.equal(guessMuscle('Klimmzüge'), 'ruecken');
  assert.equal(guessMuscle('Seitheben KH'), 'schultern');
  assert.equal(guessMuscle('Bizepscurls'), 'arme');
  assert.equal(guessMuscle('Kniebeugen'), 'beine');
  assert.equal(guessMuscle('Planke'), 'rumpf');
});

test('deutsche Zusammensetzungen laufen nicht ins Leere', () => {
  assert.equal(guessMuscle('Schrägbankdrücken'), 'brust');
  assert.equal(guessMuscle('Frontkniebeuge'), 'beine');
  assert.equal(guessMuscle('Langhantelrudern'), 'ruecken');
});

test('fehlende Umlaute und Schreibweisen stören nicht', () => {
  assert.equal(guessMuscle('Bankdruecken'), 'brust');
  assert.equal(guessMuscle('KNIEBEUGEN'), 'beine');
});

/**
 * Der Fall, für den in `guessMuscle` überhaupt nach dem *längsten* Treffer
 * gesucht wird: Beide Stichwörter passen, nur eines ist genauer.
 */
test('das genauere Stichwort gewinnt', () => {
  assert.equal(guessMuscle('Kreuzheben'), 'ruecken');
  assert.equal(guessMuscle('Rumänisches Kreuzheben'), 'beine');
  assert.equal(guessMuscle('Enges Bankdrücken'), 'arme');
});

test('was gar nicht zu erkennen ist, gilt als Ganzkörper', () => {
  assert.equal(guessMuscle('Irgendwas Neues'), 'ganzkoerper');
});

test('liest das Gerät aus dem Namen', () => {
  assert.equal(guessEquipment('KH Schrägbankdrücken'), 'kurzhantel');
  assert.equal(guessEquipment('Langhantelrudern'), 'langhantel');
  assert.equal(guessEquipment('Trizepsdrücken Kabel'), 'kabel');
  assert.equal(guessEquipment('Beinpresse'), 'maschine');
  assert.equal(guessEquipment('Klimmzüge'), 'koerper');
  assert.equal(guessEquipment('Kettlebell Swing'), 'kettlebell');
});

test('das Gerät bestimmt, in welchen Schritten das Gewicht steigen kann', () => {
  assert.equal(incrementFor({ equipment: 'langhantel' }), 2.5);
  assert.equal(incrementFor({ equipment: 'maschine' }), 5);
  assert.equal(incrementFor({ equipment: 'kurzhantel' }), 2);
});

test('unterscheidet Gewicht, Körpergewicht und gehaltene Zeit', () => {
  assert.equal(guessKind('Bankdrücken'), 'gewicht');
  assert.equal(guessKind('Klimmzüge'), 'koerper');
  assert.equal(guessKind('Planke'), 'zeit');
});

/**
 * Grundübungen bekommen von vornherein weniger Wiederholungen -- nicht aus
 * Geschmack, sondern weil die Schätzung des Maximalgewichts oberhalb von
 * zwölf Wiederholungen nichts mehr taugt.
 */
test('Grundübungen bekommen ein niedrigeres Wiederholungsziel', () => {
  assert.equal(guessRepTarget('Kniebeugen'), 6);
  assert.equal(guessRepTarget('Seitheben KH'), 10);
  assert.equal(guessRepTarget('Planke'), 45, 'bei Zeitübungen sind es Sekunden');
});

test('angegebene Werte gewinnen gegen das Erraten', () => {
  const geraten = guessAttributes('Bankdrücken', { muscle: 'arme', repTarget: 12 });

  assert.equal(geraten.muscle, 'arme');
  assert.equal(geraten.repTarget, 12);
  assert.equal(geraten.equipment, 'langhantel', 'was nicht angegeben war, wird weiter geraten');
});

/**
 * Der Vorrat gängiger Übungen ist nur eine Liste von Namen. Wenn das
 * Erraten für einen davon danebenliegt, sieht man es hier -- und nicht
 * erst, wenn jemand ihn antippt.
 */
test('jeder Vorschlag aus dem Vorrat wird sinnvoll eingeordnet', () => {
  for (const name of CATALOG) {
    const geraten = guessAttributes(name);
    assert.ok(geraten.muscle, `${name} ohne Muskelgruppe`);
    assert.ok(geraten.repTarget > 0, `${name} ohne Ziel`);
  }

  // Stichproben quer durch die Liste.
  assert.equal(guessAttributes('Beinbeuger').muscle, 'beine');
  assert.equal(guessAttributes('Face Pull').muscle, 'ruecken');
  assert.equal(guessAttributes('Hammercurls').muscle, 'arme');
  assert.equal(guessAttributes('Burpees').kind, 'koerper');
});
