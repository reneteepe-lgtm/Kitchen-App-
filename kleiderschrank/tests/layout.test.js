import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem } from '../js/model.js';
import {
  DEFAULT_POSITIONS,
  clampPosition,
  defaultLayout,
  mergeLayout,
  placedItems,
  stackIndex,
  hasLayout,
  arrangedSlots,
} from '../js/layout.js';

const outfit = () => [
  createItem({ name: 'Basecap LA' }),
  createItem({ name: 'T-Shirt schwarz' }),
  createItem({ name: 'Jeans grau' }),
  createItem({ name: 'Sneaker weiß' }),
  createItem({ name: 'Armbanduhr silber' }),
];

test('jedes Fach hat eine Grundstelle', () => {
  for (const slot of arrangedSlots()) {
    assert.ok(DEFAULT_POSITIONS[slot], `${slot} braucht eine Stelle`);
  }
});

test('die Grundanordnung liegt von Kopf bis Fuß', () => {
  const oben = DEFAULT_POSITIONS.headwear.y;
  const mitte = DEFAULT_POSITIONS.top.y;
  const unten = DEFAULT_POSITIONS.bottom.y;
  const ganzUnten = DEFAULT_POSITIONS.shoes.y;

  assert.ok(oben < mitte, 'die Mütze über dem Oberteil');
  assert.ok(mitte < unten, 'das Oberteil über der Hose');
  assert.ok(unten < ganzUnten, 'die Hose über den Schuhen');

  // Was kein Körperteil belegt, liegt daneben statt auf der Achse.
  assert.ok(Math.abs(DEFAULT_POSITIONS.accessory.x - 0.5) > 0.2);
  assert.ok(Math.abs(DEFAULT_POSITIONS.outer.x - 0.5) > 0.2);
});

test('ordnet ein Outfit vollständig an', () => {
  const teile = outfit();
  const layout = defaultLayout(teile);

  assert.equal(Object.keys(layout).length, teile.length);
  for (const teil of teile) {
    const stelle = layout[teil.id];
    assert.ok(stelle, `${teil.name} hat eine Stelle`);
    assert.ok(stelle.x > 0 && stelle.x < 1);
    assert.ok(stelle.y > 0 && stelle.y < 1);
    assert.ok(stelle.scale > 0 && stelle.scale <= 0.9);
  }
});

test('zwei Teile im selben Fach liegen nicht übereinander', () => {
  const teile = [
    createItem({ name: 'Armbanduhr silber' }),
    createItem({ name: 'Ledergürtel braun' }),
    createItem({ name: 'Sonnenbrille schwarz' }),
  ];
  const layout = defaultLayout(teile);
  const stellen = teile.map((teil) => layout[teil.id]);

  for (let i = 0; i < stellen.length; i++) {
    for (let j = i + 1; j < stellen.length; j++) {
      const abstand = Math.hypot(stellen[i].x - stellen[j].x, stellen[i].y - stellen[j].y);
      assert.ok(abstand > 0.05, 'jedes Teil bleibt greifbar');
    }
  }
});

test('hält jede Stelle auf der Fläche', () => {
  assert.deepEqual(clampPosition({ x: 5, y: -3, scale: 9 }), { x: 0.96, y: 0.04, scale: 0.9 });
  assert.deepEqual(clampPosition({ x: 0.3, y: 0.7, scale: 0.4 }), { x: 0.3, y: 0.7, scale: 0.4 });

  // Auch mit Unsinn kommt etwas Brauchbares heraus.
  const kaputt = clampPosition({ x: NaN, y: undefined, scale: 'viel' });
  assert.ok(Number.isFinite(kaputt.x) && Number.isFinite(kaputt.y) && Number.isFinite(kaputt.scale));
});

test('eine gespeicherte Anordnung bleibt erhalten', () => {
  const teile = outfit();
  const eigene = { [teile[0].id]: { x: 0.2, y: 0.8, scale: 0.5 } };

  const zusammen = mergeLayout(eigene, teile);

  assert.deepEqual(zusammen[teile[0].id], { x: 0.2, y: 0.8, scale: 0.5 }, 'von Hand geschoben');
  assert.deepEqual(
    zusammen[teile[1].id],
    defaultLayout(teile)[teile[1].id],
    'der Rest steht auf der Grundstelle',
  );
});

test('ein neu dazugekommenes Teil bekommt seinen Platz', () => {
  const teile = outfit();
  const alt = defaultLayout(teile.slice(0, 3));

  const zusammen = mergeLayout(alt, teile);

  assert.equal(Object.keys(zusammen).length, teile.length);
  for (const teil of teile) assert.ok(zusammen[teil.id]);
});

test('Stellen für aussortierte Teile fallen weg', () => {
  const teile = outfit();
  const mitLeiche = { ...defaultLayout(teile), item_weg: { x: 0.1, y: 0.1, scale: 0.2 } };

  const zusammen = mergeLayout(mitLeiche, teile);

  assert.ok(!('item_weg' in zusammen), 'was nicht mehr dazugehört, wird nicht mitgeschleppt');
});

test('die Jacke liegt hinten, die Uhr vorn', () => {
  assert.ok(stackIndex('outer') < stackIndex('top'), 'die Jacke hinter dem Oberteil');
  assert.ok(stackIndex('top') < stackIndex('accessory'), 'die Uhr vor allem anderen');
  assert.equal(stackIndex('gibtsnicht'), 0, 'Unbekanntes nach ganz hinten');
});

test('gibt die Teile in Zeichenreihenfolge mit ihren Stellen zurück', () => {
  const teile = outfit();
  const gelegt = placedItems(teile, null);

  assert.equal(gelegt.length, teile.length);

  const reihenfolge = gelegt.map((eintrag) => eintrag.item.slot);
  assert.deepEqual(
    reihenfolge,
    [...reihenfolge].sort((a, b) => stackIndex(a) - stackIndex(b)),
    'von hinten nach vorn',
  );

  const ebenen = gelegt.map((eintrag) => eintrag.z);
  assert.deepEqual(ebenen, [...new Set(ebenen)], 'jede Ebene nur einmal');
  for (const eintrag of gelegt) assert.ok(eintrag.position, 'jedes Teil hat eine Stelle');
});

test('erkennt, ob schon einmal angeordnet wurde', () => {
  assert.ok(!hasLayout(null));
  assert.ok(!hasLayout({}));
  assert.ok(!hasLayout({ layout: {} }));
  assert.ok(hasLayout({ layout: { item_1: { x: 0.5, y: 0.5, scale: 0.3 } } }));
});
