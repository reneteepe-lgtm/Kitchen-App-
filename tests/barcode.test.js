import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { suggestProduct, stripBrand, isNativeScanSupported, ZBAR_TYPES } from '../js/barcode.js';

const VENDOR = new URL('../vendor/zbar-wasm/zbar-wasm.mjs', import.meta.url);

test('Marke und Bezeichnung werden getrennt übernommen', () => {
  assert.deepEqual(suggestProduct({ brand: 'Barilla', name: 'Fusilli', quantity: '500 g' }), {
    brand: 'Barilla',
    name: 'Fusilli 500 g',
  });
  assert.deepEqual(suggestProduct({ brand: 'Baresa', name: 'Tomaten passiert', quantity: '' }), {
    brand: 'Baresa',
    name: 'Tomaten passiert',
  });
});

test('die Mengenangabe bleibt bei der Bezeichnung', () => {
  // "Passata 400 g" und "Passata 700 g" sind im Vorrat zwei Dinge.
  assert.equal(suggestProduct({ brand: 'Mutti', name: 'Passata', quantity: '700 g' }).name, 'Passata 700 g');
});

test('eine im Namen wiederholte Marke wird nicht doppelt gezeigt', () => {
  assert.deepEqual(suggestProduct({ brand: 'Baresa', name: 'Baresa Passata', quantity: '400 g' }), {
    brand: 'Baresa',
    name: 'Passata 400 g',
  });
});

test('ohne Bezeichnung tritt die Marke an ihre Stelle', () => {
  // Besser der Markenname als eine leere Zeile.
  assert.deepEqual(suggestProduct({ brand: 'Ja!', name: '', quantity: '' }), {
    brand: '',
    name: 'Ja!',
  });
});

test('ohne Marke bleibt nur die Bezeichnung', () => {
  assert.deepEqual(suggestProduct({ brand: '', name: 'Passata', quantity: '' }), {
    brand: '',
    name: 'Passata',
  });
  assert.deepEqual(suggestProduct(null), { brand: '', name: '' });
});

test('eine vorangestellte Marke lässt sich vom Namen abtrennen', () => {
  // Produkte aus früheren Fassungen tragen die Marke fest im Namen.
  assert.equal(stripBrand('Baresa Tomaten passiert 500 g', 'Baresa'), 'Tomaten passiert 500 g');
  assert.equal(stripBrand('BARESA Passata', 'baresa'), 'Passata', 'Schreibweise egal');
  assert.equal(stripBrand('  Mutti   Passata  ', 'Mutti'), 'Passata');
});

test('abgetrennt wird nur, was wirklich vorne steht', () => {
  assert.equal(stripBrand('Tomaten passiert Baresa', 'Baresa'), 'Tomaten passiert Baresa');
  assert.equal(stripBrand('Passata', 'Mutti'), 'Passata');
});

test('der Name wird nie ganz aufgezehrt', () => {
  // Sonst stünde eine leere Zeile im Vorrat.
  assert.equal(stripBrand('Baresa', 'Baresa'), 'Baresa');
  assert.equal(stripBrand('Passata', ''), 'Passata');
  assert.equal(stripBrand('', 'Baresa'), '');
});

test('ohne BarcodeDetector im Browser meldet die App keine native Erkennung', () => {
  // In Node gibt es die Schnittstelle nicht -- dieselbe Lage wie auf iOS.
  assert.equal(isNativeScanSupported(), false);
});

/**
 * Diese Namen sind eine Kopplung an die Fremdbibliothek: Sie heißen dort
 * `ZBAR_EAN13` und nicht `EAN-13`. Ein Vertippen oder eine Umbenennung durch
 * ein Update fällt sonst nicht auf -- der Scanner würde einfach nie etwas
 * finden, ohne einen Fehler zu melden.
 */
test('die Formatnamen stimmen mit denen der ZBar-Bibliothek überein', async () => {
  const bundle = await readFile(VENDOR, 'utf8');
  for (const name of ZBAR_TYPES) {
    assert.ok(bundle.includes(name), `${name} kommt in der Bibliothek nicht vor`);
  }
});

test('QR-Codes werden bewusst nicht als Produktcode akzeptiert', async () => {
  // Auf Verpackungen steht oft zusätzlich ein QR-Code. Würde der akzeptiert,
  // landete statt der Artikelnummer eine Web-Adresse im Vorrat.
  const bundle = await readFile(VENDOR, 'utf8');
  assert.ok(bundle.includes('ZBAR_QRCODE'), 'Testvoraussetzung: ZBar kennt QR-Codes');
  assert.ok(!ZBAR_TYPES.has('ZBAR_QRCODE'));
});
