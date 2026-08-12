import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTillReceipt,
  parseTillDate,
  expandAbbrev,
  splitGlued,
} from '../js/tillreceipt.js';
import { readReceipt } from '../js/receipt.js';

/**
 * Ein echter Edeka-Bon, abfotografiert und mit der Texterkennung des iPhones
 * ausgelesen -- mitsamt allem, was dabei schiefging: zwei Artikel in einer
 * Zeile, umgebrochene Anzahlen, und ein Preisblock, der zu Zeichensalat
 * zerfallen ist.
 */
const EDEKA = `Herz.M.Pf1. Tomaten Herz. Avocados
Frye Eier
G&G Weizensandwich
G&G Tomaten pass.
Topp. Backpapier Alpro Joghurt Exqu. Frischk.fitl.
G&G Frischkäse
Bresso Balanc 2,39 € x 2
Milr. Frischkäse
Gerv. Hüttenkä 1,99 € x
2
Hansano Weidemilch
G&G Naturjoghurt
Arla H-Milch 1,89 € x
4
G&G H.Schnitzel
G&G Spätzlepf 3,69 € x
2
Rückstellnummer: 0083147
osten: 23
SUMME
€
astercard
€
EUR
2,99 A
1,39 AW
~-ONNE
4G8_
10~7
66586698的686紀99655
西mg
AAABAAAAAA為A
7,56
A
4,99
7,38 A
49,33`;

test('liest den ganzen Einkauf aus dem abfotografierten Bon', () => {
  const bon = parseTillReceipt(EDEKA);
  const namen = bon.items.map((item) => item.name);

  assert.deepEqual(namen, [
    'Herz.M.Pf1. Tomaten',
    'Herz. Avocados',
    'Frye Eier',
    'Gut&Günstig Weizensandwich',
    'Gut&Günstig Tomaten passiert',
    'Toppits Backpapier',
    'Alpro Joghurt',
    'Exquisa Frischkäse fitline',
    'Gut&Günstig Frischkäse',
    'Bresso Balance',
    'Milram Frischkäse',
    'Gervais Hüttenkäse',
    'Hansano Weidemilch',
    'Gut&Günstig Naturjoghurt',
    'Arla H-Milch',
    'Gut&Günstig Hähnchenschnitzel',
    'Gut&Günstig Spätzlepfanne',
  ]);
});

test('die Anzahl hängt am richtigen Artikel', () => {
  const bon = parseTillReceipt(EDEKA);
  const menge = Object.fromEntries(bon.items.map((item) => [item.name, item.qty]));

  assert.equal(menge['Bresso Balance'], 2);
  assert.equal(menge['Gervais Hüttenkäse'], 2, 'umgebrochene Anzahl');
  assert.equal(menge['Arla H-Milch'], 4, 'umgebrochene Anzahl');
  assert.equal(menge['Gut&Günstig Spätzlepfanne'], 2);
  assert.equal(menge['Frye Eier'], 1);
});

test('die Probe geht auf: der Bon nennt 23 Posten, gelesen sind 23', () => {
  const bon = parseTillReceipt(EDEKA);
  const packungen = bon.items.reduce((sum, item) => sum + item.qty, 0);
  assert.equal(bon.posten, 23);
  assert.equal(packungen, 23);
});

test('Bonnummer und Tag zusammen als Kennung', () => {
  const bon = parseTillReceipt(EDEKA);
  // Ohne Datum auf dem Ausschnitt bleibt die nackte Nummer.
  assert.equal(bon.orderNo, '0083147');

  const mitDatum = parseTillReceipt(`12.08.2026\n${EDEKA}`);
  assert.equal(mitDatum.date, '2026-08-12');
  assert.equal(mitDatum.orderNo, '2026-08-12-0083147');
});

test('der Preisblock wird gar nicht erst gelesen', () => {
  const bon = parseTillReceipt(EDEKA);
  for (const item of bon.items) {
    assert.ok(!/\d+,\d{2}/.test(item.name), `Preis im Namen: ${item.name}`);
    assert.ok(!/[的紀西為~_]/.test(item.name), `Zeichensalat im Namen: ${item.name}`);
  }
});

test('Kopf und Fuß des Bons bleiben draußen', () => {
  const bon = parseTillReceipt(`EDEKA Musterstraße 12
50667 Köln
Tel. 0221/123456
12.08.2026 17:43
G&G Naturjoghurt 0,89 A
Hansano Weidemilch 1,19 A
SUMME 2,08
Vielen Dank für Ihren Einkauf`);

  assert.deepEqual(bon.items.map((i) => i.name), [
    'Gut&Günstig Naturjoghurt',
    'Hansano Weidemilch',
  ]);
});

test('Preis mit Steuerkennzeichen fällt vom Namen ab', () => {
  const bon = parseTillReceipt('Hansano Weidemilch 1,19 A\nG&G Butter 2,49 AW\nPosten: 2');
  assert.deepEqual(bon.items.map((i) => i.name), ['Hansano Weidemilch', 'Gut&Günstig Butter']);
});

test('ein Gewicht im Namen ist kein Preis', () => {
  const bon = parseTillReceipt('Gouda am Stück 0,25 kg\nPosten: 1');
  assert.deepEqual(bon.items.map((i) => i.name), ['Gouda am Stück 0,25 kg']);
});

test('Anzahl in einer eigenen Zeile darunter', () => {
  const bon = parseTillReceipt('Bresso Balance\n2 x 2,39\nPosten: 2');
  assert.deepEqual(bon.items, [{ name: 'Bresso Balance', size: '', qty: 2 }]);
});

test('Anzahl vorne an der Zeile', () => {
  const bon = parseTillReceipt('3 x Hansano Weidemilch\nPosten: 3');
  assert.deepEqual(bon.items, [{ name: 'Hansano Weidemilch', size: '', qty: 3 }]);
});

// --- Zerteilen ------------------------------------------------------------

test('getrennt wird an Marke und Abkürzung', () => {
  assert.deepEqual(
    splitGlued('Topp. Backpapier Alpro Joghurt Exqu. Frischk.fitl.'),
    ['Topp. Backpapier', 'Alpro Joghurt', 'Exqu. Frischk.fitl.'],
  );
  assert.deepEqual(
    splitGlued('Herz.M.Pf1. Tomaten Herz. Avocados'),
    ['Herz.M.Pf1. Tomaten', 'Herz. Avocados'],
  );
});

test('Marken aus dem eigenen Vorrat zählen mit', () => {
  assert.deepEqual(
    splitGlued('Frye Eier Hofgut Landbrot', ['Hofgut']),
    ['Frye Eier', 'Hofgut Landbrot'],
  );
  // Ohne diese Marke bleibt die Zeile ganz -- geraten wird nicht.
  assert.deepEqual(splitGlued('Frye Eier Hofgut Landbrot'), ['Frye Eier Hofgut Landbrot']);
});

test('ein einzelnes Wort wird nie abgetrennt', () => {
  // Sonst stünde "Exqu." allein als Produkt im Vorrat.
  assert.deepEqual(splitGlued('Bananen Chiquita Exqu.'), ['Bananen Chiquita Exqu.']);
  assert.deepEqual(splitGlued('Alpro Soja Joghurt'), ['Alpro Soja Joghurt']);
});

test('gewöhnliche Namen bleiben unangetastet', () => {
  for (const name of [
    'G&G Tomaten pass.',
    'Arla H-Milch 3,8%',
    'Ritter Sport Vollmilch Nuss',
    'Zwiebeln rot 500 g',
  ]) {
    assert.deepEqual(splitGlued(name), [name], name);
  }
});

// --- Abkürzungen ----------------------------------------------------------

test('löst Abkürzungen auf', () => {
  assert.equal(expandAbbrev('G&G Frischk.'), 'Gut&Günstig Frischkäse');
  assert.equal(expandAbbrev('Exqu. Frischk.fitl.'), 'Exquisa Frischkäse fitline');
  assert.equal(expandAbbrev('G&G H.Schnitzel'), 'Gut&Günstig Hähnchenschnitzel');
  assert.equal(expandAbbrev('G&G Tomaten pass.'), 'Gut&Günstig Tomaten passiert');
});

test('was unbekannt ist, bleibt stehen wie es war', () => {
  assert.equal(expandAbbrev('Herz.M.Pf1. Tomaten'), 'Herz.M.Pf1. Tomaten');
  assert.equal(expandAbbrev('Frye Eier'), 'Frye Eier');
  assert.equal(expandAbbrev('Hansano Weidemilch'), 'Hansano Weidemilch');
});

test('ganze Wörter werden nicht für Abkürzungen gehalten', () => {
  assert.equal(expandAbbrev('Tomaten Passata'), 'Tomaten Passata');
  assert.equal(expandAbbrev('Kartoffeln festkochend'), 'Kartoffeln festkochend');
});

// --- Datum ----------------------------------------------------------------

test('liest das Kaufdatum', () => {
  assert.equal(parseTillDate('12.08.2026 17:43'), '2026-08-12');
  assert.equal(parseTillDate('05.01.26'), '2026-01-05');
  assert.equal(parseTillDate('kein Datum'), null);
  assert.equal(parseTillDate('45.13.2026'), null);
});

// --- Weiche ---------------------------------------------------------------

const PICNIC = `Dein Bon
Bestellnr. 12345-678
Lieferung von Mittwoch 5 August 2026
1
Mylos Kritharaki\t\t
Mylos Kritharaki
500g
2
Alpro Sojadrink\t\t
Alpro Sojadrink
1L`;

test('erkennt selbst, welcher Bon vorliegt', () => {
  const a = readReceipt(PICNIC);
  assert.equal(a.kind, 'picnic');
  assert.deepEqual(a.items.map((i) => i.name), ['Mylos Kritharaki', 'Alpro Sojadrink']);

  const b = readReceipt(EDEKA);
  assert.equal(b.kind, 'till');
  assert.equal(b.items.length, 17);
  assert.equal(b.posten, 23);
});

test('leerer Text ergibt nichts, aber wirft nicht', () => {
  const bon = readReceipt('');
  assert.deepEqual(bon.items, []);
  assert.equal(parseTillReceipt(null).items.length, 0);
});

test('Zeichensalat allein ergibt keine Artikel', () => {
  const bon = parseTillReceipt('~-ONNE\n4G8_\n66586698的686紀99655\n西mg\nAAABAAAAAA為A');
  assert.deepEqual(bon.items, []);
});

test('irgendein Text ist noch kein Bon', () => {
  for (const text of [
    'Hallo, das ist kein Bon.',
    'Denk bitte an die Milch\nund an Brot',
    'Einkaufsliste:\nTomaten\nGurken\nJoghurt',
  ]) {
    assert.deepEqual(readReceipt(text).items, [], text);
  }
});

test('ein Bon ohne Fußteil reicht, wenn Beträge dabeistehen', () => {
  const bon = readReceipt('Hansano Weidemilch 1,19 A\nG&G Naturjoghurt 0,89 A');
  assert.equal(bon.kind, 'till');
  assert.deepEqual(bon.items.map((i) => i.name), ['Hansano Weidemilch', 'Gut&Günstig Naturjoghurt']);
});
