import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  FALLBACK_CATEGORY,
  categoryById,
  categoryOf,
  guessCategory,
  groupByCategory,
} from '../js/categories.js';

/** Erwartete Zuordnungen, so wie die Sachen im Laden heißen. */
const examples = [
  ['Barilla Fusilli 500 g', 'pasta'],
  ['Vollkornnudeln', 'pasta'],
  ['Basmatireis 1 kg', 'pasta'],
  ['Spaghetti Nr. 5', 'pasta'],
  ['Gnocchi frisch', 'pasta'],

  ['Kartoffeln festkochend', 'potato'],
  ['Rote Linsen', 'potato'],
  ['Kichererbsen Dose', 'potato'],

  ['Passata 400 g', 'sauce'],
  ['Tomatenmark', 'sauce'],
  ['Pesto Genovese', 'sauce'],
  ['Gemüsebrühe', 'sauce'],
  ['Ketchup', 'sauce'],

  ['Olivenöl 750 ml', 'spice'],
  ['Balsamico Essig', 'spice'],
  ['Meersalz', 'spice'],
  ['Paprikapulver edelsüß', 'spice'],

  ['Weizenmehl Type 405', 'baking'],
  ['Backpulver', 'baking'],
  ['Zartbitterschokolade', 'baking'],
  ['Haselnüsse gemahlen', 'baking'],

  ['Haferflocken 1 kg', 'breakfast'],
  ['Müsli Schoko', 'breakfast'],
  ['Erdbeermarmelade', 'breakfast'],
  ['Vollkorntoast', 'breakfast'],

  ['Joghurt natur 500 g', 'dairy'],
  ['Milch 1 l', 'dairy'],
  ['Gouda jung', 'dairy'],
  ['Schlagsahne', 'dairy'],
  ['Eier Größe M', 'dairy'],

  ['Hackfleisch gemischt', 'meat'],
  ['Lachsfilet', 'meat'],
  ['Hähnchenbrust', 'meat'],
  ['Salami', 'meat'],

  ['Tomaten', 'produce'],
  ['Salatgurke', 'produce'],
  ['Äpfel Elstar', 'produce'],
  ['Zwiebeln', 'produce'],
  ['Champignons', 'produce'],

  ['Tiefkühlerbsen', 'frozen'],
  ['TK Pizza Salami', 'frozen'],
  ['Gefrierbeeren', 'frozen'],

  ['Mineralwasser', 'drinks'],
  ['Apfelsaft', 'drinks'],
  ['Kaffeebohnen 1 kg', 'drinks'],
  ['Schwarzer Tee', 'drinks'],

  ['Spülmaschinentabs', 'household'],
  ['Alufolie', 'household'],
  ['Küchenrolle', 'household'],
  ['Müllbeutel 60 l', 'household'],
];

for (const [name, expected] of examples) {
  test(`„${name}" gehört zu ${expected}`, () => {
    assert.equal(guessCategory(name), expected);
  });
}

test('das letzte Glied einer Zusammensetzung entscheidet', () => {
  // Im Deutschen bestimmt das Grundwort die Sache. Ohne diesen Vorrang
  // landete "Tomatensauce" beim Gemüse und "Reismehl" bei den Nudeln.
  assert.equal(guessCategory('Tomatensauce'), 'sauce');
  assert.equal(guessCategory('Reismehl'), 'baking');
  assert.equal(guessCategory('Kartoffelsalat'), 'produce');
  assert.equal(guessCategory('Vollmilchschokolade'), 'baking');
  assert.equal(guessCategory('Zwiebelsuppe'), 'sauce');
});

test('ein Stichwort mitten im Wort zählt nicht', () => {
  // "Preiselbeeren" enthält "reis" -- gehört aber zum Obst und nicht
  // zu den Nudeln.
  assert.equal(guessCategory('Preiselbeeren'), 'produce');
});

test('sehr kurze Stichwörter greifen nur als ganzes Wort', () => {
  // "Ei" darf nicht aus jedem Wort auf -ei ein Milchprodukt machen.
  assert.equal(guessCategory('Kartoffelbrei'), 'potato');
  assert.equal(guessCategory('Eier Größe M'), 'dairy');
});

test('der Hinweis aufs Gefrierfach schlägt die Warengruppe', () => {
  // Tiefkühlerbsen sind Erbsen -- gesucht werden sie aber im Gefrierfach.
  assert.equal(guessCategory('Tiefkühlerbsen'), 'frozen');
  assert.equal(guessCategory('TK Lachsfilet'), 'frozen');
  assert.equal(guessCategory('Lachsfilet'), 'meat');
});

test('die Verpackung bestimmt nicht die Kategorie', () => {
  assert.equal(guessCategory('Kichererbsen Dose'), 'potato');
  assert.equal(guessCategory('Mais Dose'), 'produce');
});

test('verarbeitete Tomaten sind Konserven, frische sind Gemüse', () => {
  // Erst die Wortkombination macht aus der Tomate eine Konserve.
  assert.equal(guessCategory('Tomaten passiert'), 'sauce');
  assert.equal(guessCategory('Passierte Tomaten'), 'sauce');
  assert.equal(guessCategory('Tomaten stückig'), 'sauce');
  assert.equal(guessCategory('Stückige Tomaten 400 g'), 'sauce');
  assert.equal(guessCategory('Gehackte Tomaten'), 'sauce');
  assert.equal(guessCategory('Tomaten Dose'), 'sauce');

  // Und das Gemüse bleibt Gemüse.
  assert.equal(guessCategory('Tomaten'), 'produce');
  assert.equal(guessCategory('Cocktailtomaten'), 'produce');
  assert.equal(guessCategory('Tomaten Strauch'), 'produce');
});

test('eine Wortkombination schlägt das einzelne Wort, ein Marker aber sie', () => {
  assert.equal(guessCategory('TK passierte Tomaten'), 'frozen');
});

test('Marken, die für nichts anderes stehen, sind zugeordnet', () => {
  assert.equal(guessCategory('Miracel Whip'), 'sauce');
  assert.equal(guessCategory('Miracel Whip Balance 500 ml'), 'sauce');
  assert.equal(guessCategory('Thomy Delikatess Mayonnaise'), 'sauce');
  assert.equal(guessCategory('Salatcreme'), 'sauce');
});

test('Gehacktes bleibt Fleisch', () => {
  // "gehackt" gilt nur zusammen mit der Tomate, nicht für sich allein --
  // sonst landete das Hackfleisch bei den Saucen.
  assert.equal(guessCategory('Gehacktes gemischt'), 'meat');
  assert.equal(guessCategory('Rinderhackfleisch'), 'meat');
});

test('bei gleichwertigen Treffern gewinnt das vordere Wort', () => {
  // Sorte und Marke stehen hinten, die Ware vorne.
  assert.equal(guessCategory('Müsli Schoko'), 'breakfast');
  assert.equal(guessCategory('Joghurt Erdbeere'), 'dairy');
  assert.equal(guessCategory('Kaffeebohnen 1 kg'), 'drinks');
});

test('Unbekanntes landet im Auffangfach', () => {
  assert.equal(guessCategory('Zahnstocher'), FALLBACK_CATEGORY);
  assert.equal(guessCategory('Dingsbums 500 g'), FALLBACK_CATEGORY);
  assert.equal(guessCategory(''), FALLBACK_CATEGORY);
  assert.equal(guessCategory('   '), FALLBACK_CATEGORY);
});

test('Umlaute und Schreibweisen spielen keine Rolle', () => {
  assert.equal(guessCategory('Müsli'), guessCategory('Muesli'));
  assert.equal(guessCategory('MÖHREN'), 'produce');
  assert.equal(guessCategory('olivenöl'), 'spice');
});

// --- Zusammenspiel mit dem Produkt ---------------------------------------

test('eine von Hand gesetzte Kategorie gilt', () => {
  const product = { name: 'Barilla Fusilli', category: 'household' };
  assert.equal(categoryOf(product), 'household', 'die eigene Wahl darf nicht überstimmt werden');
});

test('ohne gesetzte Kategorie wird geraten', () => {
  assert.equal(categoryOf({ name: 'Barilla Fusilli' }), 'pasta');
});

test('eine unbekannte Kategorie fällt auf den Namen zurück', () => {
  // Etwa nach einem Import aus einer Fassung mit anderen Fächern.
  assert.equal(categoryOf({ name: 'Milch 1 l', category: 'gibtsnicht' }), 'dairy');
});

test('categoryById liefert immer ein Fach', () => {
  assert.equal(categoryById('pasta').label, 'Nudeln & Reis');
  assert.equal(categoryById('gibtsnicht').id, FALLBACK_CATEGORY);
  assert.equal(categoryById(undefined).id, FALLBACK_CATEGORY);
});

// --- Gruppieren ----------------------------------------------------------

test('Produkte werden in der festgelegten Reihenfolge gruppiert', () => {
  const items = [
    { product: { name: 'Spülmittel' } },
    { product: { name: 'Milch' } },
    { product: { name: 'Spaghetti' } },
  ];
  const groups = groupByCategory(items);

  assert.deepEqual(
    groups.map((g) => g.category.id),
    ['pasta', 'dairy', 'household'],
    'die Reihenfolge folgt der Kategorienliste, nicht der Eingabe',
  );
});

test('leere Fächer werden nicht angezeigt', () => {
  const groups = groupByCategory([{ product: { name: 'Spaghetti' } }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category.id, 'pasta');
});

test('gruppieren behält alle Einträge', () => {
  const items = [
    { product: { name: 'Milch' } },
    { product: { name: 'Joghurt' } },
    { product: { name: 'Zahnstocher' } },
  ];
    const groups = groupByCategory(items);
  assert.equal(groups.reduce((sum, g) => sum + g.items.length, 0), 3);
  assert.equal(groups.find((g) => g.category.id === 'dairy').items.length, 2);
});

test('gruppieren funktioniert auch mit blanken Produkten', () => {
  const groups = groupByCategory([{ name: 'Milch' }, { name: 'Spaghetti' }]);
  assert.deepEqual(groups.map((g) => g.category.id), ['pasta', 'dairy']);
});

test('jede Kategorie hat Kennung, Namen und Zeichen', () => {
  for (const category of CATEGORIES) {
    assert.ok(category.id, 'Kennung fehlt');
    assert.ok(category.label, `Name fehlt bei ${category.id}`);
    assert.ok(category.icon, `Zeichen fehlt bei ${category.id}`);
    assert.ok(Array.isArray(category.keywords), `Stichwörter fehlen bei ${category.id}`);
  }
  assert.equal(CATEGORIES.at(-1).id, FALLBACK_CATEGORY, 'das Auffangfach steht am Ende');
});

test('keine Kennung kommt doppelt vor', () => {
  const ids = CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});
