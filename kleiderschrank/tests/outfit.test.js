import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createRating, VERDICT } from '../js/model.js';
import { featuresOf, learn } from '../js/preferences.js';
import {
  suggestOutfits,
  targetWarmth,
  needsOuter,
  needsHeadwear,
  outfitWarmth,
  colorHarmony,
  freshness,
  candidatesFor,
  waehleVerschiedene,
  missingSlots,
  scoreOutfit,
  seededRandom,
} from '../js/outfit.js';

/** Ein Schrank, wie ihn jemand nach ein paar Wochen Erfassen hat. */
function schrank() {
  return [
    createItem({ name: 'T-Shirt schwarz' }),
    createItem({ name: 'T-Shirt weiß' }),
    createItem({ name: 'Oxfordhemd hellblau' }),
    createItem({ name: 'Wollpullover grau' }),
    createItem({ name: 'Hoodie olivgrün' }),

    createItem({ name: 'Jeans blau' }),
    createItem({ name: 'Chino beige' }),
    createItem({ name: 'Anzughose schwarz' }),
    createItem({ name: 'Shorts khaki' }),

    createItem({ name: 'Sneaker weiß' }),
    createItem({ name: 'Chelsea Boots braun' }),
    createItem({ name: 'Sandalen braun' }),

    createItem({ name: 'Regenjacke grün' }),
    createItem({ name: 'Wintermantel schwarz' }),
    createItem({ name: 'Jeansjacke blau' }),

    createItem({ name: 'Beanie anthrazit' }),
    createItem({ name: 'Armbanduhr silber' }),
  ];
}

const wetter = (tempMin, tempMax, rainChance = 0) => ({
  tempMin,
  tempMax,
  tempNow: tempMax,
  rainChance,
  windMax: 5,
  code: rainChance >= 50 ? 61 : 3,
  condition: { id: rainChance >= 50 ? 'regen' : 'bewoelkt' },
  fetchedAt: new Date().toISOString(),
  place: { name: 'Wallenhorst' },
});

const slotsOf = (vorschlag) => vorschlag.items.map((item) => item.slot);

test('rechnet die nötige Wärme aus dem Tag, nicht aus dem Höchstwert', () => {
  assert.equal(targetWarmth(wetter(28, 34)), 0);
  assert.equal(targetWarmth(wetter(18, 25)), 1);
  assert.equal(targetWarmth(wetter(10, 18)), 2);
  assert.equal(targetWarmth(wetter(4, 12)), 3);
  assert.equal(targetWarmth(wetter(-1, 5)), 4);
  assert.equal(targetWarmth(wetter(-8, -2)), 5);

  // Ein kalter Morgen zählt mit, auch wenn es mittags warm wird.
  assert.ok(
    targetWarmth(wetter(2, 16)) > targetWarmth(wetter(12, 16)),
    'derselbe Höchstwert, aber ein kalter Morgen verlangt mehr',
  );
});

test('ohne Wetter wird nichts behauptet', () => {
  assert.equal(targetWarmth(null), 2);
  assert.equal(targetWarmth({ tempMin: null, tempMax: null }), 2);
});

test('weiß, wann es eine Jacke braucht', () => {
  assert.ok(!needsOuter(wetter(16, 24)));
  assert.ok(needsOuter(wetter(4, 12)));
  assert.ok(needsOuter(wetter(18, 24, 80)), 'bei Regen auch im Warmen');
  assert.ok(!needsHeadwear(wetter(4, 12)));
  assert.ok(needsHeadwear(wetter(-8, -2)));
});

test('die äußere Schicht bestimmt, was man draußen spürt', () => {
  const tshirt = createItem({ name: 'T-Shirt schwarz' });
  const jeans = createItem({ name: 'Jeans blau' });
  const sneaker = createItem({ name: 'Sneaker weiß' });
  const mantel = createItem({ name: 'Wintermantel schwarz' });

  const ohne = outfitWarmth([tshirt, jeans, sneaker]);
  const mit = outfitWarmth([tshirt, jeans, sneaker, mantel]);

  assert.ok(mit > ohne + 1.5, 'der Mantel wird nicht weggemittelt');
});

test('eine Farbe auf ruhigem Grund gewinnt, drei verlieren', () => {
  const neutral = [createItem({ name: 'Hemd weiß' }), createItem({ name: 'Chino beige' })];
  const einAkzent = [...neutral, createItem({ name: 'Schal rot' })];
  const bunt = [
    createItem({ name: 'Hemd rot' }),
    createItem({ name: 'Hose grün' }),
    createItem({ name: 'Schal lila' }),
  ];

  assert.ok(colorHarmony(einAkzent) > colorHarmony(neutral));
  assert.ok(colorHarmony(neutral) > colorHarmony(bunt));
});

test('was lange hängt, wird bevorzugt', () => {
  const tage = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  const gestern = [createItem({ name: 'Jeans blau', lastWornAt: tage(1) })];
  const lange = [createItem({ name: 'Jeans blau', lastWornAt: tage(60) })];
  const nie = [createItem({ name: 'Jeans blau' })];

  assert.ok(freshness(lange) > freshness(gestern));
  assert.equal(freshness(nie), 1, 'nie getragen ist höchste Zeit');
});

test('baut vollständige Outfits', () => {
  const vorschlaege = suggestOutfits(schrank(), { weather: wetter(14, 20), count: 4 });

  assert.ok(vorschlaege.length > 0);
  for (const vorschlag of vorschlaege) {
    const slots = slotsOf(vorschlag);
    const hatKleid = slots.includes('dress');
    if (!hatKleid) {
      assert.ok(slots.includes('top'), 'ein Oberteil gehört dazu');
      assert.ok(slots.includes('bottom'), 'eine Hose gehört dazu');
    }
    assert.ok(slots.includes('shoes'), 'Schuhe gehören immer dazu');
    assert.equal(vorschlag.itemIds.length, new Set(vorschlag.itemIds).size, 'kein Teil doppelt');
  }
});

test('bei Kälte kommt eine Jacke mit, bei Wärme nicht', () => {
  const kalt = suggestOutfits(schrank(), { weather: wetter(-4, 2), count: 3 });
  for (const vorschlag of kalt) {
    assert.ok(slotsOf(vorschlag).includes('outer'), 'bei −4 °C ohne Jacke geht niemand los');
  }

  const warm = suggestOutfits(schrank(), { weather: wetter(18, 27), count: 3 });
  for (const vorschlag of warm) {
    assert.ok(!slotsOf(vorschlag).includes('outer'), 'bei 27 °C bleibt die Jacke im Schrank');
  }
});

test('bei Kälte werden warme Teile gewählt', () => {
  const [kalt] = suggestOutfits(schrank(), { weather: wetter(-6, -1), count: 1 });
  const [warm] = suggestOutfits(schrank(), { weather: wetter(20, 28), count: 1 });

  assert.ok(outfitWarmth(kalt.items) > outfitWarmth(warm.items) + 1);
  assert.ok(slotsOf(kalt).includes('headwear'), 'bei −6 °C auch eine Mütze');
});

test('bei Regen gewinnt, was dicht hält', () => {
  const vorschlaege = suggestOutfits(schrank(), { weather: wetter(8, 14, 90), count: 2 });
  assert.ok(
    vorschlaege[0].items.some((item) => item.waterproof),
    'der beste Vorschlag hält den Regen ab',
  );
  assert.equal(vorschlaege[0].reason, 'Hält den Regen ab');
});

test('der Anlass grenzt ein, was in Frage kommt', () => {
  const items = schrank();

  const fuerSport = candidatesFor(items, 'bottom', 'sport').map((i) => i.name);
  assert.ok(!fuerSport.includes('Anzughose schwarz'), 'die Anzughose ist kein Sportkleidungsstück');

  const fuerFestlich = candidatesFor(items, 'bottom', 'festlich').map((i) => i.name);
  assert.ok(fuerFestlich.includes('Anzughose schwarz'));
  assert.ok(!fuerFestlich.includes('Shorts khaki'));
});

test('ein Schrank ohne Passendes bekommt trotzdem einen Vorschlag', () => {
  // Nur Jogginghosen -- für "Arbeit" ist nichts dabei. Eine leere Seite
  // hülfe beim Anziehen nicht.
  const duerftig = [
    createItem({ name: 'Jogginghose grau' }),
    createItem({ name: 'Hoodie schwarz' }),
    createItem({ name: 'Sneaker weiß' }),
  ];

  const vorschlaege = suggestOutfits(duerftig, { weather: wetter(12, 18), occasion: 'arbeit' });
  assert.equal(vorschlaege.length, 1);
  assert.equal(vorschlaege[0].itemIds.length, 3);
});

test('die Vorschläge unterscheiden sich voneinander', () => {
  const vorschlaege = suggestOutfits(schrank(), { weather: wetter(12, 18), count: 4 });
  assert.ok(vorschlaege.length >= 3);

  for (let i = 0; i < vorschlaege.length; i++) {
    for (let j = i + 1; j < vorschlaege.length; j++) {
      const gemeinsam = vorschlaege[i].itemIds.filter((id) => vorschlaege[j].itemIds.includes(id));
      assert.ok(
        vorschlaege[i].itemIds.length - gemeinsam.length >= 2,
        'zwei Vorschläge dürfen nicht dasselbe Outfit mit anderen Schuhen sein',
      );
    }
  }
});

test('dieselbe Saat ergibt denselben Vorschlag, eine andere einen anderen', () => {
  const items = schrank();
  const a = suggestOutfits(items, { weather: wetter(12, 18), seed: 1 });
  const b = suggestOutfits(items, { weather: wetter(12, 18), seed: 1 });
  const c = suggestOutfits(items, { weather: wetter(12, 18), seed: 99 });

  assert.deepEqual(
    a.map((v) => v.itemIds),
    b.map((v) => v.itemIds),
    'ohne Zutun bleibt der Vorschlag stehen',
  );
  assert.notDeepEqual(
    a.map((v) => v.itemIds),
    c.map((v) => v.itemIds),
    '„Mehr erstellen" führt zu etwas anderem',
  );
});

test('der gelernte Geschmack verschiebt die Reihenfolge', () => {
  const items = schrank();
  const hoodie = items.find((item) => item.name === 'Hoodie olivgrün');
  const hemd = items.find((item) => item.name === 'Oxfordhemd hellblau');

  const mitVorliebe = learn(
    Array.from({ length: 6 }, () =>
      createRating({
        itemIds: [hoodie.id],
        verdict: VERDICT.LIKE,
        features: featuresOf([hoodie]),
      }),
    ).concat(
      Array.from({ length: 6 }, () =>
        createRating({
          itemIds: [hemd.id],
          verdict: VERDICT.DISLIKE,
          features: featuresOf([hemd]),
        }),
      ),
    ),
  );

  const ohne = suggestOutfits(items, { weather: wetter(10, 16), count: 4, seed: 7 });
  const mit = suggestOutfits(items, { weather: wetter(10, 16), count: 4, seed: 7, model: mitVorliebe });

  const kommtVor = (vorschlaege, id) => vorschlaege.some((v) => v.itemIds.includes(id));

  assert.ok(kommtVor(mit, hoodie.id), 'das gemochte Teil taucht auf');
  assert.ok(!kommtVor(mit, hemd.id), 'das abgelehnte nicht mehr');
  assert.ok(ohne.length > 0);
});

test('bewertet ein Outfit nachvollziehbar', () => {
  const outfit = [
    createItem({ name: 'Wollpullover grau' }),
    createItem({ name: 'Jeans blau' }),
    createItem({ name: 'Chelsea Boots braun' }),
  ];

  const kalt = scoreOutfit(outfit, { weather: wetter(2, 8) });
  const heiss = scoreOutfit(outfit, { weather: wetter(24, 32) });

  assert.ok(kalt.score > heiss.score, 'Wollpullover im August ist kein guter Vorschlag');
  assert.ok(kalt.breakdown.wetter > heiss.breakdown.wetter);
  for (const wert of Object.values(kalt.breakdown)) {
    assert.ok(wert >= -1 && wert <= 1, 'jede Teilnote liegt zwischen -1 und 1');
  }
});

test('behauptet keine Begründung, wo keine ist', () => {
  const vorschlaege = suggestOutfits(schrank(), { weather: wetter(12, 18), count: 4 });
  for (const vorschlag of vorschlaege) {
    assert.equal(typeof vorschlag.reason, 'string');
  }
});

test('sagt, was dem Schrank fehlt', () => {
  assert.deepEqual(missingSlots(schrank()), []);

  assert.deepEqual(missingSlots([createItem({ name: 'Hemd weiß' })]), ['shoes', 'bottom']);

  // Ein Kleid ersetzt Oberteil und Hose -- dann fehlen die nicht.
  const mitKleid = [createItem({ name: 'Sommerkleid geblümt' }), createItem({ name: 'Sneaker weiß' })];
  assert.deepEqual(missingSlots(mitKleid), []);
});

test('wählt verschiedene aus und füllt notfalls auf', () => {
  const kandidaten = [
    { itemIds: ['a', 'b', 'c'] },
    { itemIds: ['a', 'b', 'd'] },
    { itemIds: ['x', 'y', 'z'] },
  ];

  const verschieden = waehleVerschiedene(kandidaten, 2);
  assert.deepEqual(verschieden.map((v) => v.itemIds), [['a', 'b', 'c'], ['x', 'y', 'z']]);

  const aufgefuellt = waehleVerschiedene(kandidaten, 3);
  assert.equal(aufgefuellt.length, 3, 'lieber ein ähnlicher dritter als eine Lücke');
});

test('der Zufall lässt sich wiederholen', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  const werte = Array.from({ length: 5 }, () => a());

  assert.deepEqual(werte, Array.from({ length: 5 }, () => b()));
  for (const wert of werte) assert.ok(wert >= 0 && wert < 1);
});
