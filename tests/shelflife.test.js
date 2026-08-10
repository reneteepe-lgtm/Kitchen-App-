import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shelfLifeDays,
  estimateBestBefore,
  learnShelfLife,
  CATEGORY_SHELF_LIFE,
  KEYWORD_SHELF_LIFE,
} from '../js/shelflife.js';

// --- Was wie lange hält ---------------------------------------------------

test('das Fach gibt den Grundwert', () => {
  assert.equal(shelfLifeDays('Kritharaki 500 g', 'pasta'), 540);
  assert.equal(shelfLifeDays('Kichererbsen', 'sauce'), 540);
  assert.equal(shelfLifeDays('Erbsen', 'frozen'), 180);
});

test('ein Stichwort im Namen schlägt das Fach', () => {
  // Beide liegen im Kühlregal, halten aber ganz verschieden lange.
  assert.equal(shelfLifeDays('Frische Vollmilch 3,5%', 'dairy'), 8);
  assert.equal(shelfLifeDays('Arla LactoFREE H-Milch 1,5%', 'dairy'), 365);
  assert.equal(shelfLifeDays('Haltbare Protein Milch', 'dairy'), 180);
});

test('das genauere Stichwort gewinnt', () => {
  // Sonst machte "milch" die "h-milch" wieder zunichte.
  assert.ok(shelfLifeDays('H-Milch 1 l', 'dairy') > shelfLifeDays('Vollmilch 1 l', 'dairy'));
  assert.equal(shelfLifeDays('Norwegischer Räucherlachs', 'meat'), 10, 'nicht die 4 vom Lachs');
});

test('deutsche Zusammensetzungen werden getroffen', () => {
  assert.equal(shelfLifeDays('Kraftbouillon Gemüse', 'produce'), 540);
  assert.equal(shelfLifeDays('Bio-Frischkäse', 'dairy'), 21);
  assert.equal(shelfLifeDays('Kartoffelsalat', 'produce'), 4, 'Salat, nicht Kartoffel');
});

test('kurze Stämme greifen nur als ganzes Wort', () => {
  // "Brei" endet auf "ei" -- daraus darf kein Ei mit drei Wochen werden.
  assert.notEqual(shelfLifeDays('Kartoffelbrei', 'potato'), 21);
  assert.equal(shelfLifeDays('Eier 10 Stück', 'dairy'), 21);
});

test('für Haushaltssachen wird nichts geschätzt', () => {
  // Alufolie und Spülmittel haben kein Datum, das jemanden interessiert.
  assert.equal(shelfLifeDays('Alufolie', 'household'), null);
  assert.equal(shelfLifeDays('Irgendwas', 'other'), null);
  assert.equal(shelfLifeDays('Irgendwas', null), null);
});

test('die Tabellen bleiben in sich stimmig', () => {
  for (const [stem, days] of KEYWORD_SHELF_LIFE) {
    assert.ok(stem === stem.toLowerCase(), `"${stem}" muss klein geschrieben sein`);
    assert.ok(days >= 1 && days <= 2000, `"${stem}" hat ${days} Tage`);
  }
  for (const [id, days] of Object.entries(CATEGORY_SHELF_LIFE)) {
    assert.ok(days === null || (days >= 1 && days <= 2000), `${id} hat ${days}`);
  }
});

// --- Vom Kaufdatum zum Haltbarkeitsdatum ---------------------------------

test('gerechnet wird ab dem Kaufdatum', () => {
  assert.equal(
    estimateBestBefore({ text: 'Frischkäse Natur', categoryId: 'dairy', from: '2026-08-05' }),
    '2026-08-26',
  );
  assert.equal(
    estimateBestBefore({ text: 'Himbeeren', categoryId: 'produce', from: '2026-08-05' }),
    '2026-08-08',
  );
});

test('was für dieses Produkt gelernt wurde, schlägt jede Faustregel', () => {
  assert.equal(
    estimateBestBefore({ text: 'Himbeeren', categoryId: 'produce', learned: 10, from: '2026-08-05' }),
    '2026-08-15',
  );
});

test('ohne Anhaltspunkt wird kein Datum erfunden', () => {
  assert.equal(estimateBestBefore({ text: 'Alufolie', categoryId: 'household' }), null);
  assert.equal(estimateBestBefore({}), null);
  assert.equal(estimateBestBefore({ text: 'Milch', categoryId: 'dairy', from: 'kein Datum' }), null);
});

// --- Was aus einem eingetragenen Datum zu lernen ist ---------------------

test('aus Kauf- und Haltbarkeitsdatum ergibt sich die Haltbarkeit', () => {
  assert.equal(learnShelfLife('2026-08-26', new Date('2026-08-05')), 21);
  assert.equal(learnShelfLife('2027-08-05', new Date('2026-08-05')), 365);
});

test('unsinnige Abstände taugen nicht als Regel', () => {
  // Ein Datum in der Vergangenheit ist ein Vertipper oder ein Restposten --
  // beides sagt nichts über den nächsten Kauf.
  assert.equal(learnShelfLife('2026-08-01', new Date('2026-08-05')), null);
  assert.equal(learnShelfLife('2026-08-05', new Date('2026-08-05')), null);
  assert.equal(learnShelfLife('2040-01-01', new Date('2026-08-05')), null, 'über fünf Jahre');
  assert.equal(learnShelfLife(null), null);
  assert.equal(learnShelfLife('kein Datum'), null);
});

// --- Was das Fach vom Stichwort trennt -----------------------------------

test('ein Stichwort für Frisches gilt nicht für die Konserve', () => {
  // Genau der Fehlgriff, der sonst entstünde: "Tomate" heißt acht Tage,
  // aber eine Flasche Passata steht bei den Konserven und hält Monate.
  assert.equal(shelfLifeDays('Tomaten 500 g', 'produce'), 8);
  assert.equal(shelfLifeDays('Baresa Tomaten passiert 500 g', 'sauce'), 540);
  assert.equal(shelfLifeDays('Tiefkühlerbsen', 'frozen'), 180);
});

test('was unabhängig vom Fach gilt, gilt überall', () => {
  // "Dose" sagt etwas über die Haltbarkeit, ganz gleich was drin ist.
  assert.equal(shelfLifeDays('Thunfisch in Öl Dose', 'meat'), 730);
  assert.equal(shelfLifeDays('Kichererbsen Dose', 'potato'), 730);
});

test('häufig gekaufte Sonderfälle sitzen', () => {
  // Bresso ist immer Frischkäse, egal was sonst auf der Packung steht,
  // und Kritharaki sind Nudeln.
  assert.equal(shelfLifeDays('Bresso Kräuter der Provence Balance 150 g', 'dairy'), 25);
  assert.equal(shelfLifeDays('Mylos Kritharaki 500 g', 'pasta'), 540);
});
