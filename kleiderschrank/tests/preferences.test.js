import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createRating, VERDICT } from '../js/model.js';
import {
  featuresOf,
  learn,
  preferenceScore,
  trainingProgress,
  describeFeature,
  describePreferences,
  TRAINING_TARGET,
} from '../js/preferences.js';

const teil = (name, extra = {}) => createItem({ name, ...extra });

const schwarzesOutfit = [
  teil('T-Shirt schwarz', { brand: 'Uniqlo' }),
  teil('Jeans schwarz'),
  teil('Sneaker weiß'),
];

const buntesOutfit = [teil('Hemd rot'), teil('Hose grün'), teil('Sneaker weiß')];

const bewerte = (items, verdict) =>
  createRating({ itemIds: items.map((i) => i.id), verdict, features: featuresOf(items) });

test('zerlegt ein Outfit in lernbare Merkmale', () => {
  const merkmale = featuresOf(schwarzesOutfit);

  assert.ok(merkmale.includes('farbe:schwarz'));
  assert.ok(merkmale.includes('farbe:weiss'));
  assert.ok(merkmale.includes('marke:uniqlo'));
  assert.ok(merkmale.some((m) => m.startsWith('stil:')));
  assert.ok(merkmale.some((m) => m.startsWith('waerme:')));
  for (const item of schwarzesOutfit) assert.ok(merkmale.includes(`teil:${item.id}`));
});

test('nur auffällige Farben bilden Paare', () => {
  // Schwarz und Weiß sind neutral -- daraus wird kein Farbpaar gelernt.
  assert.ok(!featuresOf(schwarzesOutfit).some((m) => m.startsWith('paar:')));
  assert.ok(featuresOf(buntesOutfit).includes('paar:gruen+rot'));
});

test('ein leeres Outfit hat keine Merkmale', () => {
  assert.deepEqual(featuresOf([]), []);
});

test('gemochte Merkmale bekommen positives Gewicht', () => {
  const model = learn([bewerte(schwarzesOutfit, VERDICT.LIKE)]);
  assert.ok(model.weights.get('farbe:schwarz').weight > 0);
});

test('ein einzelnes Urteil bewegt das Gewicht nur ein Stück', () => {
  const einmal = learn([bewerte(schwarzesOutfit, VERDICT.LIKE)]);
  assert.ok(
    Math.abs(einmal.weights.get('farbe:schwarz').weight - 1 / 3) < 1e-9,
    'ein Beleg ergibt ein Drittel, keine Gewissheit',
  );

  const oft = learn(Array.from({ length: 8 }, () => bewerte(schwarzesOutfit, VERDICT.LIKE)));
  assert.ok(oft.weights.get('farbe:schwarz').weight > 0.7, 'acht Belege ergeben eine Meinung');
  assert.ok(oft.weights.get('farbe:schwarz').weight < 1, 'aber nie volle Gewissheit');
});

test('widersprüchliche Urteile heben sich auf', () => {
  const model = learn([
    bewerte(schwarzesOutfit, VERDICT.LIKE),
    bewerte(schwarzesOutfit, VERDICT.DISLIKE),
  ]);
  assert.equal(model.weights.get('farbe:schwarz').weight, 0);
});

test('das Ergebnis hängt nicht von der Reihenfolge ab', () => {
  const urteile = [
    bewerte(schwarzesOutfit, VERDICT.LIKE),
    bewerte(buntesOutfit, VERDICT.DISLIKE),
    bewerte(schwarzesOutfit, VERDICT.LIKE),
  ];

  const vorwaerts = learn(urteile);
  const rueckwaerts = learn([...urteile].reverse());

  for (const [merkmal, eintrag] of vorwaerts.weights) {
    assert.equal(eintrag.weight, rueckwaerts.weights.get(merkmal).weight, merkmal);
  }
});

test('bewertet ein Outfit im Sinne des Gelernten', () => {
  const model = learn([
    bewerte(schwarzesOutfit, VERDICT.LIKE),
    bewerte(schwarzesOutfit, VERDICT.LIKE),
    bewerte(buntesOutfit, VERDICT.DISLIKE),
    bewerte(buntesOutfit, VERDICT.DISLIKE),
  ]);

  const gut = preferenceScore(featuresOf(schwarzesOutfit), model);
  const schlecht = preferenceScore(featuresOf(buntesOutfit), model);

  assert.ok(gut > 0, 'das gemochte Outfit steht im Plus');
  assert.ok(schlecht < 0, 'das abgelehnte im Minus');
  assert.ok(gut > schlecht);
});

test('ohne Gelerntes urteilt die App nicht', () => {
  assert.equal(preferenceScore(featuresOf(schwarzesOutfit), learn([])), 0);
  assert.equal(preferenceScore([], null), 0);
});

test('unbekannte Outfits bekommen eine schwache, keine starke Meinung', () => {
  const model = learn(Array.from({ length: 6 }, () => bewerte(schwarzesOutfit, VERDICT.LIKE)));

  const bekannt = preferenceScore(featuresOf(schwarzesOutfit), model);
  const fremd = preferenceScore(featuresOf([teil('Kleid lila'), teil('Pumps rot')]), model);

  assert.ok(Math.abs(fremd) < Math.abs(bekannt));
});

test('der Fortschritt zählt Menge und Abdeckung', () => {
  const schrank = [...schwarzesOutfit, ...buntesOutfit];

  const leer = trainingProgress([], schrank);
  assert.equal(leer.percent, 0);
  assert.equal(leer.level, 'anfang');

  const halb = trainingProgress(
    Array.from({ length: TRAINING_TARGET }, () => bewerte(schwarzesOutfit, VERDICT.LIKE)),
    schrank,
  );
  assert.ok(halb.percent > 60 && halb.percent < 100, 'viele Urteile über nur den halben Schrank');

  const voll = trainingProgress(
    [
      ...Array.from({ length: TRAINING_TARGET }, () => bewerte(schwarzesOutfit, VERDICT.LIKE)),
      ...Array.from({ length: 4 }, () => bewerte(buntesOutfit, VERDICT.DISLIKE)),
    ],
    schrank,
  );
  assert.equal(voll.percent, 100);
  assert.equal(voll.level, 'gut');
});

test('der Hinweis nennt die engste Ursache', () => {
  const kleinerSchrank = trainingProgress([], [teil('Hemd weiß'), teil('Jeans blau')]);
  assert.match(kleinerSchrank.hint, /Teile/, 'bei drei Teilen hilft Bewerten nicht');

  const genugTeile = [...schwarzesOutfit, ...buntesOutfit];
  assert.match(trainingProgress([], genugTeile).hint, /Bewerte/);
  assert.match(
    trainingProgress([bewerte(schwarzesOutfit, VERDICT.LIKE)], genugTeile).hint,
    /Noch \d+ Bewertungen/,
  );
});

test('erklärt Merkmale in Worten', () => {
  const items = [teil('Hemd rot')];
  assert.equal(describeFeature('farbe:schwarz'), 'Schwarz');
  assert.equal(describeFeature('paar:gruen+rot'), 'Grün mit Rot');
  assert.equal(describeFeature('marke:uniqlo'), 'Uniqlo');
  assert.equal(describeFeature('stil:1'), 'Leger');
  assert.equal(describeFeature('basis:ruhig'), 'Ruhige Farben');
  assert.equal(describeFeature(`teil:${items[0].id}`, items), 'Hemd rot');
  assert.equal(describeFeature('teil:weg', items), null, 'aussortierte Teile werden nicht genannt');
});

test('behauptet nichts, wofür es nur einen Beleg gibt', () => {
  const einmal = describePreferences(learn([bewerte(schwarzesOutfit, VERDICT.LIKE)]));
  assert.equal(einmal.liked.length, 0, 'ein Urteil ist keine Vorliebe');

  const model = learn([
    bewerte(schwarzesOutfit, VERDICT.LIKE),
    bewerte(schwarzesOutfit, VERDICT.LIKE),
    bewerte(buntesOutfit, VERDICT.DISLIKE),
    bewerte(buntesOutfit, VERDICT.DISLIKE),
  ]);
  const zusammenfassung = describePreferences(model, [...schwarzesOutfit, ...buntesOutfit]);

  assert.ok(zusammenfassung.liked.some((row) => row.label === 'Schwarz'));
  assert.ok(zusammenfassung.disliked.some((row) => row.label === 'Rot'));
});
