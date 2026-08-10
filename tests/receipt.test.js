import test from 'node:test';
import assert from 'node:assert/strict';

import { parseReceipt, parseReceiptDate, suggestedName, tidySize } from '../js/receipt.js';

/**
 * Ein echter Bon, so wie er beim Kopieren aus der E-Mail herauskommt --
 * mitsamt der Bildbeschreibung mit den zwei Tabulatoren und den Preisen,
 * die in einzelne Ziffernzeilen zerfallen.
 */
const BON = `Dein Bon

Hallo Rene,

hier ist der Bon zu deiner Lieferung von Mittwoch 5 August 2026.


Besteld\t\tHinzugefügt am Dienstag 4 August
Bestellnr 704-481-1094
1
Zucchini\t\t
Zucchini
1 Stück
0
69
.
1
Broccoli\t\t
Broccoli
500g
1
69
.
1
Knorr Kraftbouillon Gemüse\t\t
Knorr Kraftbouillon Gemüse
für 7L
1
89
.
1
Mylos Kritharaki\t\t
Mylos Kritharaki
500g
15% Rabatt
1
69
.
1
43
.
1
Dill\t\t
Dill
25g
10% Rabatt
1
19
.
1
07
.
1
Gut&Günstig Chicken Burger\t\t
Gut&Günstig Chicken Burger
4 Stück
3
45
.
2
Bresso Kräuter der Provence Balance\t\t
Bresso Kräuter der Provence Balance
150g
4
98
.
1
Abrahams Norwegischer Räucherlachs\t\t
Abrahams Norwegischer Räucherlachs
50g
10% Ersatz-Rabatt
2
59
.
2
33
.
1
Himbeeren\t\t
Himbeeren
125g
jetzt 2.39€
2
99
.
2
39
.
1
Gut&Günstig Natives Olivenöl extra\t\t
Gut&Günstig Natives Olivenöl extra
500ml
4
99
.
1
Zwiebeln rot\t\t
Zwiebeln rot
1kg Netz
1
99
.
1
Arla LactoFREE Laktosefreie H-Milch 1,5%\t\t
Arla LactoFREE Laktosefreie H-Milch 1,5%
1L
10% Ersatz-Rabatt
1
99
.
1
79
.

Pfand\t\t
0
39
.
Flaschen\t\t
0
00
.
Tüten\t\t
0
39
.

Zwischensumme\t\t
50
24
.

Recycle\t\tPfand-tastisch!
Danke, dass du deine Tüten abgegeben hast.

Gesamtbetrag Der Betrag wird 2 Tage nach
der Lieferung abgezogen\t\t
48
41
.
Mwst 7% (€45.24)\t\t
3
17
.
Du sparst\t\t
1
44
.
`;

const bon = parseReceipt(BON);
const namen = bon.items.map((i) => i.name);

// --- Der Kopf -------------------------------------------------------------

test('Bestellnummer und Lieferdatum werden gelesen', () => {
  assert.equal(bon.orderNo, '704-481-1094');
  assert.equal(bon.date, '2026-08-05');
});

test('das Datum versteht deutsche Monatsnamen', () => {
  assert.equal(parseReceiptDate('Mittwoch 5 August 2026'), '2026-08-05');
  assert.equal(parseReceiptDate('Montag 1 Dezember 2026'), '2026-12-01');
  assert.equal(parseReceiptDate('Freitag 13. März 2026'), '2026-03-13');
  assert.equal(parseReceiptDate('Freitag 13 Maerz 2026'), '2026-03-13', 'auch ohne Umlaut');
  assert.equal(parseReceiptDate('irgendwas'), null);
  assert.equal(parseReceiptDate('40 August 2026'), null, 'kein 40. Tag');
});

// --- Die Artikel ----------------------------------------------------------

test('alle Artikel werden gefunden, und nur die', () => {
  assert.equal(bon.items.length, 12, namen.join(' | '));
});

test('die Summen unten zählen nicht als Artikel', () => {
  // Pfand, Tüten, Zwischensumme und Mehrwertsteuer stehen im selben Format.
  for (const wort of ['Pfand', 'Flaschen', 'Tüten', 'Zwischensumme', 'Mwst', 'Du sparst', 'Recycle']) {
    assert.ok(!namen.some((n) => n.includes(wort)), `${wort} ist kein Artikel`);
  }
});

test('Bezeichnung, Größe und Anzahl stehen richtig zusammen', () => {
  assert.deepEqual(bon.items[0], { name: 'Zucchini', size: '1 Stück', qty: 1 });
  assert.deepEqual(bon.items[1], { name: 'Broccoli', size: '500g', qty: 1 });
  assert.deepEqual(bon.items[2], { name: 'Knorr Kraftbouillon Gemüse', size: 'für 7L', qty: 1 });
});

test('eine Anzahl über eins wird übernommen', () => {
  const bresso = bon.items.find((i) => i.name.startsWith('Bresso'));
  assert.equal(bresso.qty, 2);
  assert.equal(bresso.size, '150g');
});

test('ein Rabatt-Schildchen bringt nichts durcheinander', () => {
  // Es steht zwischen Größe und Preis und darf weder Artikel noch Anzahl sein.
  const kritharaki = bon.items.find((i) => i.name.includes('Kritharaki'));
  assert.deepEqual(kritharaki, { name: 'Mylos Kritharaki', size: '500g', qty: 1 });

  const lachs = bon.items.find((i) => i.name.includes('Räucherlachs'));
  assert.equal(lachs.qty, 1, 'nicht die 2 aus dem Rabattpreis');

  const himbeeren = bon.items.find((i) => i.name === 'Himbeeren');
  assert.equal(himbeeren.qty, 1, '"jetzt 2.39€" ist keine Anzahl');
});

test('Größen in allen Schreibweisen werden erkannt', () => {
  const groessen = Object.fromEntries(bon.items.map((i) => [i.name, i.size]));
  assert.equal(groessen['Gut&Günstig Chicken Burger'], '4 Stück');
  assert.equal(groessen['Gut&Günstig Natives Olivenöl extra'], '500ml');
  assert.equal(groessen['Zwiebeln rot'], '1kg Netz');
  assert.equal(groessen['Arla LactoFREE Laktosefreie H-Milch 1,5%'], '1L');
  assert.equal(groessen['Dill'], '25g');
});

test('eine Zahl im Produktnamen wird nicht als Größe missdeutet', () => {
  // "Arla LactoFREE Laktosefreie H-Milch 1,5%" endet auf eine Zahl.
  assert.ok(namen.includes('Arla LactoFREE Laktosefreie H-Milch 1,5%'));
});

// --- Was daraus im Vorrat wird -------------------------------------------

test('die Größe wandert in den Namen', () => {
  // "Frischkäse 300 g" und "Frischkäse 150 g" sind zwei Dinge im Schrank.
  assert.equal(suggestedName({ name: 'Broccoli', size: '500g' }), 'Broccoli 500 g');
  assert.equal(suggestedName({ name: 'Zwiebeln rot', size: '1kg Netz' }), 'Zwiebeln rot 1 kg Netz');
  assert.equal(suggestedName({ name: 'Chicken Burger', size: '4 Stück' }), 'Chicken Burger 4 Stück');
});

test('"1 Stück" sagt nichts über die Packung und bleibt weg', () => {
  assert.equal(suggestedName({ name: 'Zucchini', size: '1 Stück' }), 'Zucchini');
  assert.equal(suggestedName({ name: 'Avocado', size: '' }), 'Avocado');
});

test('zwischen Zahl und Einheit kommt ein Leerzeichen', () => {
  assert.equal(tidySize('500g'), '500 g');
  assert.equal(tidySize('1kg Netz'), '1 kg Netz');
  assert.equal(tidySize('für 7L'), 'für 7 L');
  assert.equal(tidySize('4 Stück'), '4 Stück');
  assert.equal(tidySize(''), '');
});

// --- Was schiefgehen darf -------------------------------------------------

test('aus Unsinn wird nichts erfunden', () => {
  assert.deepEqual(parseReceipt('').items, []);
  assert.deepEqual(parseReceipt(null).items, []);
  assert.deepEqual(parseReceipt('Hallo, wie geht es dir?').items, []);
  assert.equal(parseReceipt('').orderNo, null);
});

test('ein Bon ohne Bildbeschreibungen wird auch gelesen', () => {
  // Manche Mail-Programme kopieren die Bilder nicht mit.
  const schlicht = 'Bestellnr 1-2-3\n1\nBroccoli\n500g\n1\n69\n.\n2\nMilch\n1L\n2\n38\n.\n';
  const { items } = parseReceipt(schlicht);
  assert.deepEqual(items, [
    { name: 'Broccoli', size: '500g', qty: 1 },
    { name: 'Milch', size: '1L', qty: 2 },
  ]);
});

test('fehlt die Anzahl, ist es eines', () => {
  const { items } = parseReceipt('Broccoli\n500g\n');
  assert.deepEqual(items, [{ name: 'Broccoli', size: '500g', qty: 1 }]);
});
