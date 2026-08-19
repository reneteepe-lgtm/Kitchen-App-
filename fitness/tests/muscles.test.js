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
 * Die Liste, mit der wirklich trainiert wird -- und was die App aus jedem
 * Namen herauslesen muss.
 *
 * Der Vorrat in `muscles.js` ist nur eine Liste von Namen; alles andere
 * fällt aus dem Erraten heraus. Diese Tabelle ist die Gegenprobe: Sie hält
 * fest, was dabei herauskommen soll, und schlägt an, wenn eine spätere
 * Änderung am Erraten eine dieser Übungen verschiebt.
 */
const ERWARTET = [
  ['Bankdrücken', 'brust', 'langhantel', 'gewicht'],
  ['Schrägbankdrücken', 'brust', 'langhantel', 'gewicht'],
  ['Kurzhantel Bankdrücken', 'brust', 'kurzhantel', 'gewicht'],
  ['Kurzhantel Schrägbankdrücken', 'brust', 'kurzhantel', 'gewicht'],
  ['Butterfly / Fliegende', 'brust', 'maschine', 'gewicht'],
  ['Dips', 'brust', 'koerper', 'koerper'],
  ['Klimmzüge', 'ruecken', 'koerper', 'koerper'],
  ['Latzug', 'ruecken', 'maschine', 'gewicht'],
  ['Rudern vorgebeugt (Langhantel)', 'ruecken', 'langhantel', 'gewicht'],
  ['Kabelrudern sitzend', 'ruecken', 'kabel', 'gewicht'],
  ['Kreuzheben', 'ruecken', 'langhantel', 'gewicht'],
  ['Schulterdrücken (Langhantel)', 'schultern', 'langhantel', 'gewicht'],
  ['Kurzhantel Schulterdrücken', 'schultern', 'kurzhantel', 'gewicht'],
  ['Seitheben', 'schultern', 'kurzhantel', 'gewicht'],
  ['Frontheben', 'schultern', 'kurzhantel', 'gewicht'],
  ['Face Pulls', 'schultern', 'kabel', 'gewicht'],
  ['Bizepscurls (Langhantel)', 'arme', 'langhantel', 'gewicht'],
  ['Kurzhantel Bizepscurls', 'arme', 'kurzhantel', 'gewicht'],
  ['Hammercurls', 'arme', 'kurzhantel', 'gewicht'],
  ['Trizepsdrücken am Kabel', 'arme', 'kabel', 'gewicht'],
  ['French Press', 'arme', 'langhantel', 'gewicht'],
  ['Kniebeugen', 'beine', 'langhantel', 'gewicht'],
  ['45-Grad Beinpresse', 'beine', 'maschine', 'gewicht'],
  ['Beinstrecker', 'beine', 'maschine', 'gewicht'],
  ['Beinbeuger', 'beine', 'maschine', 'gewicht'],
  ['Ausfallschritte', 'beine', 'koerper', 'koerper'],
  ['Wadenheben', 'beine', 'maschine', 'gewicht'],
  ['Crunches', 'rumpf', 'koerper', 'koerper'],
  ['Plank', 'rumpf', 'koerper', 'zeit'],
  ['Beinheben hängend', 'rumpf', 'koerper', 'koerper'],
];

test('jede Übung aus dem Vorrat wird richtig eingeordnet', () => {
  for (const [name, muskel, geraet, art] of ERWARTET) {
    const geraten = guessAttributes(name);
    assert.equal(geraten.muscle, muskel, `${name}: Muskelgruppe`);
    assert.equal(geraten.equipment, geraet, `${name}: Gerät`);
    assert.equal(geraten.kind, art, `${name}: Art`);
    assert.ok(geraten.repTarget > 0, `${name}: ohne Ziel`);
  }
});

test('der Vorrat und die geprüfte Tabelle bleiben beieinander', () => {
  assert.deepEqual(CATALOG, ERWARTET.map(([name]) => name));
});

/**
 * "Beinheben hängend" hat einmal als Zeitübung gegolten, weil "hängend"
 * auf das Stichwort für den Dead Hang passte. Gehalten wird dabei nichts --
 * gezählt werden Wiederholungen.
 */
test('hängende Übungen sind keine gehaltenen', () => {
  assert.equal(guessKind('Beinheben hängend'), 'koerper');
  assert.equal(guessKind('Dead Hang'), 'zeit');
});

/**
 * Ohne diese Zuordnung liefen Seitheben und Hammercurls als
 * Langhantelübungen und bekämen 2,5-kg-Schritte vorgeschlagen -- an einer
 * 8-kg-Kurzhantel ist das ein Drittel mehr Gewicht.
 */
test('Übungen, deren Gerät im Namen nicht steht, bekommen es trotzdem', () => {
  assert.equal(incrementFor({ equipment: guessEquipment('Seitheben') }), 2);
  assert.equal(incrementFor({ equipment: guessEquipment('Hammercurls') }), 2);
});
