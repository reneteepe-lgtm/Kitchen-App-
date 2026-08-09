import test from 'node:test';
import assert from 'node:assert/strict';

import { normalize, editDistance, scoreMatch, searchProducts, stockAnswer } from '../js/search.js';

const products = [
  { id: 'p1', name: 'Barilla Fusilli 500 g', barcode: '4006381333931' },
  { id: 'p2', name: 'Joghurt natur 500 g', barcode: null },
  { id: 'p3', name: 'Crème fraîche', barcode: null },
  { id: 'p4', name: 'Müsli Schoko', barcode: null },
  { id: 'p5', name: 'Basmatireis 1 kg', barcode: null },
  { id: 'p6', name: 'Olivenöl 750 ml', barcode: null },
];

const stocks = { p1: 3, p2: 0, p3: 2, p4: 1, p5: 0, p6: 0 };
const stockOf = (product) => stocks[product.id] ?? 0;

const namesFor = (query) => searchProducts(products, query, stockOf).map((m) => m.product.name);

test('Schreibweisen werden vereinheitlicht', () => {
  assert.equal(normalize('Müsli'), 'muesli');
  assert.equal(normalize('Crème fraîche'), 'creme fraiche');
  assert.equal(normalize('Weißbrot'), 'weissbrot');
  assert.equal(normalize('Olivenöl 750 ml'), 'olivenoel 750 ml');
  assert.equal(normalize('  '), '');
});

test('der Editierabstand bricht über der Grenze ab', () => {
  assert.equal(editDistance('reis', 'reis'), 0);
  assert.equal(editDistance('jogurt', 'joghurt'), 1);
  assert.equal(editDistance('abc', 'xyz', 1), 2);
  assert.equal(editDistance('', 'abc'), 3);
});

test('genaue Eingaben finden das Produkt', () => {
  assert.deepEqual(namesFor('Joghurt natur 500 g'), ['Joghurt natur 500 g']);
});

test('ein Wort aus der Mitte des Namens genügt', () => {
  assert.deepEqual(namesFor('fusilli'), ['Barilla Fusilli 500 g']);
});

test('Umlaute muss man nicht tippen', () => {
  assert.deepEqual(namesFor('muesli'), ['Müsli Schoko']);
  assert.deepEqual(namesFor('musli'), ['Müsli Schoko']);
  assert.deepEqual(namesFor('creme fraiche'), ['Crème fraîche']);
  assert.deepEqual(namesFor('olivenoel'), ['Olivenöl 750 ml']);
});

test('kleine Tippfehler werden verziehen', () => {
  assert.deepEqual(namesFor('jogurt'), ['Joghurt natur 500 g']);
  assert.deepEqual(namesFor('basmatireise'), ['Basmatireis 1 kg']);
});

test('Wortteile sind gewollte Treffer', () => {
  // Wer "öl" tippt, sucht das Olivenöl. Enthaltene Silben zählen deshalb,
  // auch wenn sie mitten im Wort stehen.
  assert.deepEqual(namesFor('oel'), ['Olivenöl 750 ml']);
  assert.deepEqual(namesFor('eis'), ['Basmatireis 1 kg']);
});

test('bei ganz kurzen Eingaben wird nicht geraten', () => {
  // "mus" steckt nicht in "muesli" -- und bei drei Buchstaben wird nicht
  // zusätzlich unscharf gesucht, sonst passt am Ende alles auf alles.
  assert.deepEqual(namesFor('mus'), []);
  assert.deepEqual(namesFor('jgh'), []);
});

test('unähnliche Wörter gleicher Länge sind kein Treffer', () => {
  assert.deepEqual(namesFor('brot'), []);
  assert.deepEqual(namesFor('zucker'), []);
});

test('ein eingetippter Barcode findet das Produkt', () => {
  assert.deepEqual(namesFor('4006381333931'), ['Barilla Fusilli 500 g']);
});

test('Vorhandenes steht vor Leerem', () => {
  const withStock = [
    { id: 'a', name: 'Nudeln breit', barcode: null },
    { id: 'b', name: 'Nudeln schmal', barcode: null },
  ];
  const stock = { a: 0, b: 4 };
  const result = searchProducts(withStock, 'nudeln', (p) => stock[p.id]);
  assert.equal(result[0].product.name, 'Nudeln schmal');
});

test('genauere Treffer stehen vor unscharfen', () => {
  const list = [
    { id: 'a', name: 'Joghurt griechisch', barcode: null },
    { id: 'b', name: 'Jogurtdressing', barcode: null },
  ];
  const result = searchProducts(list, 'joghurt', () => 1);
  assert.equal(result[0].product.name, 'Joghurt griechisch');
});

test('eine leere Eingabe liefert nichts', () => {
  assert.deepEqual(namesFor(''), []);
  assert.deepEqual(namesFor('   '), []);
});

test('scoreMatch bewertet von genau nach großzügig', () => {
  assert.equal(scoreMatch('joghurt natur 500 g', 'Joghurt natur 500 g'), 1);
  assert.ok(scoreMatch('joghurt', 'Joghurt natur') > scoreMatch('natur', 'Joghurt natur'));
  assert.ok(scoreMatch('natur', 'Joghurt natur') > scoreMatch('jogurt', 'Joghurt natur'));
  assert.equal(scoreMatch('', 'Joghurt'), null);
});

// --- Die eigentliche Frage: habe ich das noch? --------------------------

test('vorhandenes Produkt wird als vorhanden gemeldet', () => {
  const answer = stockAnswer(searchProducts(products, 'fusilli', stockOf));
  assert.equal(answer.kind, 'have');
  assert.equal(answer.stock, 3);
});

test('bekanntes, aber leeres Produkt wird von unbekanntem unterschieden', () => {
  const empty = stockAnswer(searchProducts(products, 'basmatireis', stockOf));
  assert.equal(empty.kind, 'empty');
  assert.equal(empty.product.name, 'Basmatireis 1 kg');

  const unknown = stockAnswer(searchProducts(products, 'kaffee', stockOf));
  assert.equal(unknown.kind, 'unknown');
});

test('gibt es das Produkt mehrfach, zählt das vorrätige', () => {
  const list = [
    { id: 'a', name: 'Nudeln alt', barcode: null },
    { id: 'b', name: 'Nudeln neu', barcode: null },
  ];
  const stock = { a: 0, b: 2 };
  const answer = stockAnswer(searchProducts(list, 'nudeln', (p) => stock[p.id]));
  assert.equal(answer.kind, 'have');
  assert.equal(answer.product.name, 'Nudeln neu');
});
