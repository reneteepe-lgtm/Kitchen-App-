import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { suggestName, isNativeScanSupported, ZBAR_TYPES } from '../js/barcode.js';

const VENDOR = new URL('../vendor/zbar-wasm/zbar-wasm.mjs', import.meta.url);

test('Produktnamen aus der Datenbank werden lesbar zusammengesetzt', () => {
  assert.equal(
    suggestName({ brand: 'Barilla', name: 'Fusilli', quantity: '500 g' }),
    'Barilla Fusilli 500 g',
  );
  assert.equal(suggestName({ brand: '', name: 'Passata', quantity: '' }), 'Passata');
  assert.equal(suggestName({ brand: 'Ja!', name: '', quantity: '1 l' }), 'Ja! 1 l');
  assert.equal(suggestName(null), '');
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
