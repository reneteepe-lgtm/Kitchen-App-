import test from 'node:test';
import assert from 'node:assert/strict';

import {
  productTokens,
  productKey,
  sameProduct,
  findTwin,
  duplicateGroups,
  mergedProduct,
} from '../js/dedupe.js';

// --- Was als dasselbe gilt ------------------------------------------------

test('gescannt und vom Bon ist dasselbe Produkt', () => {
  // Genau der Fall aus dem Vorrat: einmal über den Barcode, einmal über den
  // Bon hereingekommen -- fürs Auge dasselbe, für einen Zeichenvergleich nicht.
  assert.ok(
    sameProduct(
      { brand: 'Gut & Günstig', name: 'Frischkäse Natur 300g' },
      { brand: 'Gut&Günstig', name: 'Frischkäse Natur 300 g' },
    ),
  );
});

test('das Füllwort "und" unterscheidet nicht', () => {
  assert.ok(
    sameProduct(
      { brand: 'GUT UND GÜNSTIG', name: 'Frischkäse Natur 300g' },
      { brand: 'Gut&Günstig', name: 'Frischkäse Natur 300 g' },
    ),
  );
});

test('Zahl und Einheit werden getrennt gelesen', () => {
  // Daran scheitert der Vergleich sonst: "300g" ist ein Wort, "300 g" zwei.
  assert.deepEqual(productTokens('Milch 1l'), ['milch', '1', 'l']);
  assert.deepEqual(productTokens('Mehl 1kg'), ['mehl', '1', 'kg']);
  assert.ok(sameProduct({ name: 'Milch 1l' }, { name: 'Milch 1 l' }));
  assert.ok(sameProduct({ name: 'Sahne 200ml' }, { name: 'Sahne 200 ml' }));
});

test('Schreibweisen derselben Einheit gelten gleich', () => {
  assert.ok(sameProduct({ name: 'Mehl 1000 gr' }, { name: 'Mehl 1000 g' }));
  assert.ok(sameProduct({ name: 'Saft 1 Liter' }, { name: 'Saft 1 l' }));
});

test('die Marke darf im Namen oder im eigenen Feld stehen', () => {
  assert.ok(
    sameProduct(
      { brand: '', name: 'Arla LactoFREE H-Milch 1,5% 1 L' },
      { brand: 'Arla', name: 'LactoFREE H-Milch 1,5% 1l' },
    ),
  );
});

test('die Reihenfolge der Wörter unterscheidet nicht', () => {
  assert.ok(sameProduct({ name: 'Frischkäse Natur' }, { name: 'Natur Frischkäse' }));
});

// --- Was verschieden bleibt ----------------------------------------------

test('verschiedene Größen bleiben verschiedene Dinge', () => {
  // Im Schrank sind sie es auch. Das ist die wichtigste Grenze: Lieber ein
  // Doppel übersehen als zwei Sachen zusammenwerfen.
  assert.ok(!sameProduct({ name: 'Frischkäse Natur 300 g' }, { name: 'Frischkäse Natur 150 g' }));
  assert.ok(!sameProduct({ name: 'Milch 1 l' }, { name: 'Milch 2 l' }));
});

test('ähnliche Produkte verschiedener Marken bleiben getrennt', () => {
  assert.ok(
    !sameProduct(
      { brand: 'Gut&Günstig', name: 'Gouda Jung Stück 450 g' },
      { brand: 'Roseka', name: 'Gouda Leicht Gerieben 250g' },
    ),
  );
  assert.ok(
    !sameProduct(
      { brand: 'Aldi Milsani', name: 'Frische Vollmilch 3,5% 1l' },
      { brand: 'Schwarzwaldmilch', name: 'Haltbare Protein Milch 1 l' },
    ),
  );
});

test('ein leerer Eintrag ist mit nichts gleich', () => {
  assert.ok(!sameProduct({ name: '' }, { name: '' }));
  assert.ok(!sameProduct({}, {}));
  assert.equal(productKey({ name: '   ' }), '');
});

// --- Den Zwilling finden --------------------------------------------------

test('der Zwilling wird im Vorrat gefunden', () => {
  const products = [
    { id: 'a', brand: 'Baresa', name: 'Passata 400 g' },
    { id: 'b', brand: 'Gut & Günstig', name: 'Frischkäse Natur 300g' },
  ];
  assert.equal(findTwin(products, { brand: 'Gut&Günstig', name: 'Frischkäse Natur 300 g' })?.id, 'b');
  assert.equal(findTwin(products, { name: 'Joghurt' }), undefined);
  assert.equal(findTwin(products, { name: '' }), undefined);
});

test('die Zusatzbedingung wird beachtet', () => {
  // Beim Scannen zählt nur ein Eintrag ohne Barcode: Ein Produkt mit einem
  // anderen Barcode ist ein anderer Artikel.
  const products = [{ id: 'a', name: 'Frischkäse Natur 300g', barcode: '111' }];
  const ohne = (p) => !p.barcode;
  assert.equal(findTwin(products, { name: 'Frischkäse Natur 300 g' }, ohne), undefined);
  assert.equal(findTwin(products, { name: 'Frischkäse Natur 300 g' })?.id, 'a');
});

// --- Gruppen und ihre Reihenfolge ----------------------------------------

const gruppen = duplicateGroups([
  // Wie ein Bon-Produkt aussieht, bevor die Marke abgetrennt wurde.
  { id: 'x1', name: 'Gut&Günstig Frischkäse Natur 300 g', createdAt: '2026-08-09T00:00:00Z' },
  { id: 'x2', brand: 'Gut & Günstig', name: 'Frischkäse Natur 300g', barcode: '4311', createdAt: '2026-08-10T00:00:00Z' },
  { id: 'x3', brand: 'Gut&Günstig', name: 'Frischkäse Natur 300 g', createdAt: '2026-08-01T00:00:00Z' },
  { id: 'y1', name: 'Zucchini', createdAt: '2026-08-01T00:00:00Z' },
]);

test('nur echte Doppel bilden eine Gruppe', () => {
  assert.equal(gruppen.length, 1);
  assert.equal(gruppen[0].length, 3);
  assert.ok(!gruppen[0].some((p) => p.id === 'y1'));
});

test('der Eintrag mit Barcode bleibt vorn', () => {
  // Er ist die bessere Kennung: Man findet ihn wieder, indem man die Packung
  // noch einmal scannt.
  assert.equal(gruppen[0][0].id, 'x2');
});

test('danach zählt das Alter', () => {
  const ohneBarcode = duplicateGroups([
    { id: 'neu', name: 'Milch 1 l', createdAt: '2026-08-10T00:00:00Z' },
    { id: 'alt', name: 'Milch 1l', createdAt: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(ohneBarcode[0][0].id, 'alt');
});

test('ohne Doppel gibt es keine Gruppen', () => {
  assert.deepEqual(duplicateGroups([{ id: 'a', name: 'Zucchini' }]), []);
  assert.deepEqual(duplicateGroups([]), []);
  assert.deepEqual(duplicateGroups(undefined), []);
});

// --- Was der bleibende Eintrag übernimmt ---------------------------------

test('fehlende Angaben werden ergänzt, vorhandene nicht überschrieben', () => {
  const merged = mergedProduct(
    { id: 'a', name: 'Frischkäse Natur 300 g', brand: '', barcode: null, minStock: 1, createdAt: '2026-08-09T00:00:00Z' },
    [{ id: 'b', name: 'Frischkäse', brand: 'Gut & Günstig', barcode: '4311', minStock: 2, createdAt: '2026-08-01T00:00:00Z' }],
  );
  assert.equal(merged.name, 'Frischkäse Natur 300 g', 'der eigene Name bleibt');
  assert.equal(merged.brand, 'Gut & Günstig', 'die fehlende Marke kommt dazu');
  assert.equal(merged.barcode, '4311');
  assert.equal(merged.minStock, 2, 'der höhere Mindestbestand gilt');
  assert.equal(merged.createdAt, '2026-08-01T00:00:00Z', 'das ältere Datum gewinnt');
});

test('eine vorhandene Marke wird nicht ersetzt', () => {
  const merged = mergedProduct(
    { id: 'a', brand: 'Baresa', name: 'Passata' },
    [{ id: 'b', brand: 'Mutti', name: 'Passata' }],
  );
  assert.equal(merged.brand, 'Baresa');
});

test('ein abgelehnter Vorschlag bleibt abgelehnt', () => {
  const merged = mergedProduct({ id: 'a', name: 'Salz', suggest: true }, [{ id: 'b', name: 'Salz', suggest: false }]);
  assert.equal(merged.suggest, false);
});

test('ohne Marke bleibt ein Produkt für sich', () => {
  // "Frischkäse Natur 300 g" ohne jede Marke könnte von jedem Hersteller
  // sein -- das ist weniger, nicht dasselbe.
  assert.ok(
    !sameProduct(
      { name: 'Frischkäse Natur 300 g' },
      { brand: 'Gut&Günstig', name: 'Frischkäse Natur 300 g' },
    ),
  );
});

test('die Marke im Namen zählt genauso wie die im eigenen Feld', () => {
  // So sieht ein Bon-Produkt aus, bevor die Marke abgetrennt wurde.
  assert.ok(
    sameProduct(
      { name: 'Gut&Günstig Frischkäse Natur 300 g' },
      { brand: 'Gut & Günstig', name: 'Frischkäse Natur 300g' },
    ),
  );
});
