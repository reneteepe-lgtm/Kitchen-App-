import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLOTS,
  FALLBACK_SLOT,
  guessSlot,
  guessWarmth,
  guessFormality,
  guessColors,
  guessWaterproof,
  guessAttributes,
  slotById,
  isNeutral,
} from '../js/slots.js';

/** So, wie die Sachen im Schrank tatsächlich heißen. */
const beispiele = [
  ['Weißes T-Shirt', 'top'],
  ['Oxfordhemd hellblau', 'top'],
  ['Wollpullover grau', 'top'],
  ['Hoodie schwarz', 'top'],
  ['Strickjacke beige', 'top'],

  ['Levi\'s 501 Jeans', 'bottom'],
  ['Chino beige', 'bottom'],
  ['Jogginghose grau', 'bottom'],
  ['Shorts kariert', 'bottom'],
  ['Minirock schwarz', 'bottom'],

  ['Sommerkleid geblümt', 'dress'],
  ['Anzug dunkelblau', 'dress'],
  ['Jumpsuit khaki', 'dress'],

  ['Regenjacke grün', 'outer'],
  ['Wintermantel schwarz', 'outer'],
  ['Blazer marine', 'outer'],
  ['Lederjacke braun', 'outer'],

  ['Nike Air Force 1', 'shoes'],
  ['Chelsea Boots braun', 'shoes'],
  ['Sneaker weiß', 'shoes'],
  ['Gummistiefel', 'shoes'],
  ['Birkenstock Arizona', 'shoes'],

  ['Basecap LA Dodgers', 'headwear'],
  ['Beanie anthrazit', 'headwear'],

  ['Armbanduhr silber', 'accessory'],
  ['Ledergürtel braun', 'accessory'],
  ['Schal grau', 'accessory'],
];

test('ordnet Kleidungsstücke am Namen ein', () => {
  for (const [name, erwartet] of beispiele) {
    assert.equal(guessSlot(name), erwartet, `„${name}" gehört zu ${erwartet}`);
  }
});

test('deutsche Zusammensetzungen tragen ihre Bedeutung hinten', () => {
  // Das ist die Regel, an der eine naive Stichwortsuche scheitert: In allen
  // drei Namen steckt ein Stichwort eines anderen Fachs.
  assert.equal(guessSlot('Jeansjacke'), 'outer');
  assert.equal(guessSlot('Jeans'), 'bottom');
  assert.equal(guessSlot('Sweatjacke'), 'outer');
  assert.equal(guessSlot('Sweatshirt'), 'top');
  assert.equal(guessSlot('Hemdbluse'), 'top');
});

test('kennt nur die Fächer, die es gibt', () => {
  for (const [name] of beispiele) {
    assert.ok(slotById(guessSlot(name)), `${name} landet in einem bekannten Fach`);
  }
  assert.equal(SLOTS.length, new Set(SLOTS.map((s) => s.id)).size, 'keine doppelten Fächer');
});

test('was sich nicht einordnen lässt, landet nicht im Nirgendwo', () => {
  assert.equal(guessSlot('Irgendwas'), FALLBACK_SLOT);
  assert.equal(guessSlot(''), FALLBACK_SLOT);
});

test('schätzt, wie warm ein Teil hält', () => {
  assert.equal(guessWarmth('Tanktop'), 0);
  assert.equal(guessWarmth('T-Shirt weiß'), 1);
  assert.equal(guessWarmth('Wollpullover'), 4);
  assert.equal(guessWarmth('Daunenjacke'), 5);
  assert.equal(guessWarmth('Wintermantel'), 5);

  // Das genauere Stichwort schlägt das allgemeinere.
  assert.ok(
    guessWarmth('Daunenjacke') > guessWarmth('Windbreaker'),
    'Daunen wärmen mehr als ein Windbreaker, obwohl beides Jacken sind',
  );
});

test('schätzt, wo man damit hinkommt', () => {
  assert.equal(guessFormality('Jogginghose'), 0);
  assert.equal(guessFormality('Hoodie'), 1);
  assert.equal(guessFormality('Chino beige'), 2);
  assert.equal(guessFormality('Oxfordhemd'), 3);
  assert.equal(guessFormality('Abendkleid'), 4);
  assert.equal(guessFormality('Irgendwas'), 2, 'ohne Anhaltspunkt: Alltag');
});

test('liest Farben aus dem Namen', () => {
  assert.deepEqual(guessColors('Wollpullover grau'), ['grau']);
  assert.deepEqual(guessColors('Hemd weiß'), ['weiss']);
  assert.deepEqual(guessColors('Kleid geblümt'), ['bunt']);
  assert.deepEqual(guessColors('Hose'), []);

  const mehrfarbig = guessColors('Schal grau blau');
  assert.ok(mehrfarbig.includes('grau') && mehrfarbig.includes('blau'));
});

test('unterscheidet neutrale von auffälligen Farben', () => {
  assert.ok(isNeutral('schwarz'));
  assert.ok(isNeutral('beige'));
  assert.ok(!isNeutral('rot'));
  assert.ok(!isNeutral('bunt'));
});

test('erkennt, was Regen abhält -- und ist im Zweifel dagegen', () => {
  assert.ok(guessWaterproof('Regenjacke'));
  assert.ok(guessWaterproof('Gore-Tex Parka'));
  assert.ok(guessWaterproof('Gummistiefel'));
  assert.ok(!guessWaterproof('Wollmantel'), 'Wolle ist nicht wasserdicht');
  assert.ok(!guessWaterproof('Lederjacke'));
});

test('was von Hand gesagt wurde, wird nicht überstimmt', () => {
  const geraten = guessAttributes('Wollpullover grau');
  assert.equal(geraten.slot, 'top');
  assert.equal(geraten.warmth, 4);

  const gesetzt = guessAttributes('Wollpullover grau', { warmth: 2, colors: ['rot'] });
  assert.equal(gesetzt.warmth, 2, 'die eigene Angabe gilt');
  assert.deepEqual(gesetzt.colors, ['rot']);
  assert.equal(gesetzt.slot, 'top', 'der Rest wird weiter geraten');
});
