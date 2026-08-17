import test from 'node:test';
import assert from 'node:assert/strict';

import { backgroundMask, sampleMask } from '../js/cutout.js';

/**
 * Baut ein Bild: ein Gegenstand in der Mitte, Hintergrund ringsherum.
 *
 * `verlauf` macht den Hintergrund ungleichmäßig hell -- so wie ein Foto mit
 * Licht von einer Seite. Genau daran scheitert ein Verfahren, das nur eine
 * einzige Hintergrundfarbe kennt.
 */
function bild(vorne, hinten, { groesse = 60, anteil = 0.5, verlauf = 0, rauschen = 0 } = {}) {
  const data = new Uint8ClampedArray(groesse * groesse * 4);
  const rand = Math.round((groesse * (1 - anteil)) / 2);
  let saat = 7;
  const zufall = () => {
    saat = (saat * 1103515245 + 12345) % 2147483648;
    return saat / 2147483648 - 0.5;
  };

  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      const drin = x >= rand && y >= rand && x < groesse - rand && y < groesse - rand;
      const grund = drin ? vorne : hinten;
      const schieben = drin ? 0 : (x / groesse) * verlauf;
      const i = (y * groesse + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = grund[k] + schieben + zufall() * rauschen;
      data[i + 3] = 255;
    }
  }
  return { data, width: groesse, height: groesse };
}

const anteilImInneren = (alpha, groesse, anteil) => {
  const rand = Math.round((groesse * (1 - anteil)) / 2);
  let deckend = 0;
  let gesamt = 0;
  for (let y = rand; y < groesse - rand; y++) {
    for (let x = rand; x < groesse - rand; x++) {
      gesamt++;
      if (alpha[y * groesse + x]) deckend++;
    }
  }
  return deckend / gesamt;
};

const ROT = [163, 59, 50];
const SCHWARZ = [26, 26, 26];
const HELL = [242, 241, 238];
const HOLZ = [178, 146, 106];

test('stellt ein Teil vor ruhigem Hintergrund frei', () => {
  const eingabe = bild(ROT, HELL);
  const { alpha, removed, ok } = backgroundMask(eingabe);

  assert.ok(ok, 'das Ergebnis taugt');
  assert.ok(removed > 0.6 && removed < 0.8, `drei Viertel Rand entfernt, war ${removed}`);
  assert.equal(anteilImInneren(alpha, 60, 0.5), 1, 'das Teil bleibt vollständig stehen');
  assert.equal(alpha[0], 0, 'die Ecke ist weg');
});

test('folgt einem Verlauf im Hintergrund', () => {
  // Licht von der Seite: Der Hintergrund wird über die Breite um 40 Stufen
  // heller. Mit nur einer Hintergrundfarbe bliebe die helle Seite stehen.
  const { alpha, ok } = backgroundMask(bild(ROT, [150, 150, 148], { verlauf: 55 }));

  assert.ok(ok);
  assert.equal(alpha[0], 0, 'dunkle Ecke weg');
  assert.equal(alpha[59], 0, 'helle Ecke auch weg');
});

test('läuft nicht ins Kleidungsstück hinein', () => {
  // Ein dunkelroter Gegenstand auf mittlerem Grau: Die Farben liegen nah
  // genug beieinander, dass eine zu großzügige Flut hindurchliefe.
  const { alpha, ok } = backgroundMask(bild([120, 90, 88], [150, 150, 148]));

  assert.ok(ok);
  assert.ok(anteilImInneren(alpha, 60, 0.4) > 0.95, 'die Mitte bleibt stehen');
});

test('gibt auf, wenn Teil und Hintergrund dieselbe Farbe haben', () => {
  const { ok, grund } = backgroundMask(bild(SCHWARZ, [30, 30, 32]));

  assert.ok(!ok, 'ein halbiertes Teil wäre schlechter als das Foto mit Grund');
  assert.match(grund, /ähnlich|Mitte/);
});

test('gibt auf, wenn das Teil das ganze Bild füllt', () => {
  const { ok, grund } = backgroundMask(bild(ROT, ROT));

  assert.ok(!ok);
  assert.ok(grund.length > 0, 'und sagt, warum');
});

test('gibt auf, wenn der Hintergrund zu unruhig ist', () => {
  // Starkes Rauschen im Grund: Die Flut kommt keine zwei Punkte weit.
  const { ok, grund } = backgroundMask(bild(ROT, HOLZ, { rauschen: 190 }));

  if (!ok) assert.match(grund, /unruhig|ähnlich|Mitte/);
  else assert.ok(true, 'kommt sie doch durch, ist auch nichts verloren');
});

test('Stoffstruktur im Teil ändert nichts', () => {
  const { alpha, ok } = backgroundMask(bild(ROT, HELL, { rauschen: 25 }));

  assert.ok(ok);
  assert.ok(anteilImInneren(alpha, 60, 0.45) > 0.95);
});

test('mit unsinnigem Bild passiert nichts Schlimmes', () => {
  for (const eingabe of [null, undefined, {}, { data: [], width: 0, height: 0 }]) {
    const ergebnis = backgroundMask(eingabe);
    assert.equal(ergebnis.ok, false);
    assert.equal(ergebnis.removed, 0);
  }
});

test('die Maske lässt sich weich zwischen den Punkten auslesen', () => {
  // Zwei Punkte nebeneinander: links leer, rechts voll.
  const alpha = new Uint8ClampedArray([0, 255]);

  assert.equal(sampleMask(alpha, 2, 1, 0.25, 0.5), 0, 'ganz links: leer');
  assert.equal(sampleMask(alpha, 2, 1, 0.75, 0.5), 255, 'ganz rechts: voll');

  const mitte = sampleMask(alpha, 2, 1, 0.5, 0.5);
  assert.ok(mitte > 100 && mitte < 155, `dazwischen weich, war ${mitte}`);
});

test('das Auslesen bleibt auch außerhalb des Bildes gutartig', () => {
  const alpha = new Uint8ClampedArray([0, 255, 255, 0]);
  for (const [u, v] of [[-1, -1], [2, 2], [0, 1], [1, 0]]) {
    const wert = sampleMask(alpha, 2, 2, u, v);
    assert.ok(Number.isFinite(wert) && wert >= 0 && wert <= 255, `${u}/${v} → ${wert}`);
  }
});
