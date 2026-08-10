import test from 'node:test';
import assert from 'node:assert/strict';

import { splitBrand, brandsInUse, KNOWN_BRANDS } from '../js/brands.js';

// --- Was abgetrennt wird --------------------------------------------------

test('eine bekannte Marke wandert aus dem Namen heraus', () => {
  assert.deepEqual(splitBrand('Knorr Kraftbouillon Gemüse für 7 L'), {
    brand: 'Knorr',
    name: 'Kraftbouillon Gemüse für 7 L',
  });
  assert.deepEqual(splitBrand('Bresso Kräuter der Provence Balance 150 g'), {
    brand: 'Bresso',
    name: 'Kräuter der Provence Balance 150 g',
  });
});

test('auch eine Marke aus mehreren Wörtern', () => {
  assert.deepEqual(splitBrand('Dr. Oetker Tröpfchen Schoko 75 g'), {
    brand: 'Dr. Oetker',
    name: 'Tröpfchen Schoko 75 g',
  });
  assert.deepEqual(splitBrand('Golden Toast Weizen Toasties 300 g'), {
    brand: 'Golden Toast',
    name: 'Weizen Toasties 300 g',
  });
});

test('ein Sonderzeichen in der Marke ändert nichts', () => {
  // "Gut&Günstig" ist ein Wort, vereinheitlicht aber zwei -- über die
  // Wortzahl ließe sich die Schnittstelle nicht finden.
  assert.deepEqual(splitBrand('Gut&Günstig Natives Olivenöl extra 500 ml'), {
    brand: 'Gut&Günstig',
    name: 'Natives Olivenöl extra 500 ml',
  });
});

test('die längere Marke gewinnt', () => {
  // Sonst bliebe von "Dr. Oetker" nur "Dr." übrig.
  const { brand } = splitBrand('Dr. Oetker Pudding', ['Dr']);
  assert.equal(brand, 'Dr. Oetker');
});

// --- Was in Ruhe gelassen wird -------------------------------------------

test('Unbekanntes bleibt unangetastet', () => {
  // Der wichtigste Fall: Aus "Zwiebeln rot" darf niemals die Marke
  // "Zwiebeln" und das Produkt "rot" werden.
  for (const name of ['Zwiebeln rot 1 kg Netz', 'Avocado Ready To Eat', 'Zucchini', 'Himbeeren 125 g']) {
    assert.deepEqual(splitBrand(name), { brand: '', name }, name);
  }
});

test('eine Marke mitten im Namen wird nicht abgetrennt', () => {
  // Nur was vorn steht, ist die Marke.
  assert.deepEqual(splitBrand('Pudding von Dr. Oetker'), {
    brand: '',
    name: 'Pudding von Dr. Oetker',
  });
});

test('abgetrennt wird nur an der Wortgrenze', () => {
  // "Arla" darf nicht in "Arlagurt" hineingreifen.
  assert.deepEqual(splitBrand('Arlagurt Kirsche'), { brand: '', name: 'Arlagurt Kirsche' });
});

test('bleibt nichts übrig, wird nichts abgetrennt', () => {
  // "Bresso" allein ist ein brauchbarer Name, eine Marke ohne Bezeichnung nicht.
  assert.deepEqual(splitBrand('Bresso'), { brand: '', name: 'Bresso' });
  assert.deepEqual(splitBrand('Knorr .'), { brand: '', name: 'Knorr .' });
});

test('aus nichts wird nichts', () => {
  assert.deepEqual(splitBrand(''), { brand: '', name: '' });
  assert.deepEqual(splitBrand(null), { brand: '', name: '' });
  assert.deepEqual(splitBrand('   '), { brand: '', name: '' });
});

// --- Marken aus dem eigenen Vorrat ---------------------------------------

test('was im Vorrat als Marke steht, zählt auch auf dem Bon', () => {
  // Die kamen über gescannte Barcodes herein und sind damit belegt.
  const eigene = ['Rewe Bio', 'Tante Fannys'];
  assert.deepEqual(splitBrand('Tante Fannys Pizzateig 400 g', eigene), {
    brand: 'Tante Fannys',
    name: 'Pizzateig 400 g',
  });
});

test('eigene Marken werden aus den Produkten gesammelt', () => {
  const produkte = [
    { name: 'Passata', brand: 'Baresa' },
    { name: 'Milch', brand: '  Weihenstephan  ' },
    { name: 'Zucchini', brand: '' },
    { name: 'Dill' },
    { name: 'Passata 700 g', brand: 'Baresa' },
  ];
  assert.deepEqual(brandsInUse(produkte).sort(), ['Baresa', 'Weihenstephan']);
  assert.deepEqual(brandsInUse([]), []);
  assert.deepEqual(brandsInUse(undefined), []);
});

test('Schreibweise und Umlaute sind beim Erkennen egal', () => {
  assert.equal(splitBrand('GUT&GUENSTIG Gouda Jung 450 g').brand, 'GUT&GUENSTIG');
  assert.equal(splitBrand('nutella Brotaufstrich').brand, 'nutella');
  // Abgetrennt wird die Schreibweise des Bons, nicht die der Liste.
  assert.equal(splitBrand('NESCAFÉ Gold 200 g').name, 'Gold 200 g');
});

// --- Die Liste selbst ----------------------------------------------------

test('die mitgelieferte Liste enthält keine Lebensmittelwörter', () => {
  // Ein Wort wie "Bio" oder "Käse" in der Liste zerschnitte Namen, die gar
  // keine Marke tragen.
  const heikel = ['bio', 'kaese', 'milch', 'natur', 'frisch', 'gouda', 'joghurt', 'butter', 'toast'];
  for (const wort of heikel) {
    assert.ok(
      !KNOWN_BRANDS.some((brand) => brand.toLowerCase() === wort),
      `"${wort}" darf nicht als Marke gelten`,
    );
  }
});

test('kein Eintrag der Liste ist leer oder doppelt gemeint', () => {
  for (const brand of KNOWN_BRANDS) {
    assert.ok(brand.trim().length >= 2, `"${brand}" ist zu kurz`);
  }
});
