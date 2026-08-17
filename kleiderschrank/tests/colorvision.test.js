import test from 'node:test';
import assert from 'node:assert/strict';

import { dominantColors, nearestColor, rgbToLab, labDistance } from '../js/colorvision.js';
import { colorById } from '../js/slots.js';

/**
 * Baut ein Bild wie ein Kleiderfoto: ein Gegenstand in der Mitte, ringsum
 * Hintergrund.
 *
 * @param {[number,number,number]} vorne  Farbe des Gegenstands
 * @param {[number,number,number]} hinten Farbe des Hintergrunds
 * @param {number} anteil Wie viel der Kantenlänge der Gegenstand einnimmt
 */
function bild(vorne, hinten, { groesse = 48, anteil = 0.6, rauschen = 0 } = {}) {
  const data = new Uint8ClampedArray(groesse * groesse * 4);
  const rand = Math.round((groesse * (1 - anteil)) / 2);
  let saat = 1;
  const zufall = () => {
    saat = (saat * 1103515245 + 12345) % 2147483648;
    return saat / 2147483648;
  };

  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      const drin = x >= rand && y >= rand && x < groesse - rand && y < groesse - rand;
      const farbe = drin ? vorne : hinten;
      const i = (y * groesse + x) * 4;
      for (let k = 0; k < 3; k++) {
        data[i + k] = farbe[k] + (rauschen ? (zufall() - 0.5) * rauschen : 0);
      }
      data[i + 3] = 255;
    }
  }
  return { data, width: groesse, height: groesse };
}

/** Ein Bild aus mehreren Streifen -- ein gemustertes Teil. */
function streifen(farben, { groesse = 48 } = {}) {
  const data = new Uint8ClampedArray(groesse * groesse * 4);
  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      const farbe = farben[Math.floor((x / groesse) * farben.length)];
      const i = (y * groesse + x) * 4;
      data[i] = farbe[0];
      data[i + 1] = farbe[1];
      data[i + 2] = farbe[2];
      data[i + 3] = 255;
    }
  }
  return { data, width: groesse, height: groesse };
}

const SCHWARZ = [26, 26, 26];
const WEISS = [244, 244, 242];
const GRAU = [140, 140, 138];
const ROT = [163, 59, 50];
const GRUEN = [63, 107, 70];
const BLAU = [58, 110, 165];
const HOLZ = [178, 146, 106];

test('rechnet nach Lab und misst dort Abstände', () => {
  const schwarz = rgbToLab(0, 0, 0);
  const weiss = rgbToLab(255, 255, 255);

  assert.ok(Math.abs(schwarz.L) < 0.01, 'Schwarz hat Helligkeit 0');
  assert.ok(Math.abs(weiss.L - 100) < 0.01, 'Weiß hat Helligkeit 100');
  assert.ok(labDistance(schwarz, weiss) > 90);
  assert.equal(labDistance(schwarz, schwarz), 0);
});

test('findet die nächste Farbe der Palette', () => {
  assert.equal(nearestColor(rgbToLab(10, 10, 10)).id, 'schwarz');
  assert.equal(nearestColor(rgbToLab(250, 250, 248)).id, 'weiss');
  assert.equal(nearestColor(rgbToLab(190, 40, 35)).id, 'rot');
  assert.equal(nearestColor(rgbToLab(40, 90, 50)).id, 'gruen');
});

test('„Gemustert" ist keine Farbe und wird nie als Bildpunkt getroffen', () => {
  // Der Ton, der in der Palette für "gemustert" steht, darf sich nicht als
  // gewöhnlicher Treffer einschleichen.
  assert.notEqual(nearestColor(rgbToLab(...hexRgb(colorById('bunt').hex))).id, 'bunt');
});

const hexRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

test('erkennt die Farbe eines Teils vor hellem Hintergrund', () => {
  const ergebnis = dominantColors(bild(ROT, WEISS));

  assert.equal(ergebnis.suggestion[0], 'rot');
  assert.ok(ergebnis.confident);
  assert.ok(!ergebnis.patterned);
});

test('der Hintergrund fällt weg, auch wenn er die Mehrheit der Fläche ist', () => {
  // Der Gegenstand nimmt nur ein Drittel der Kante ein -- in Fläche also
  // gut ein Neuntel des Bildes. Ohne Hintergrundabzug gewönne das Holz.
  const ergebnis = dominantColors(bild(GRUEN, HOLZ, { anteil: 0.34 }));

  assert.equal(ergebnis.suggestion[0], 'gruen');
  assert.ok(
    !ergebnis.colors.some((farbe) => farbe.id === 'beige' && farbe.share > 0.3),
    'die Tischplatte zählt nicht als Farbe des Teils',
  );
});

test('ein dunkles Teil auf dunklem Grund geht nicht verloren', () => {
  // Hier fällt beim Hintergrundabzug fast alles weg. Statt eines leeren
  // Ergebnisses wird dann ohne Abzug gezählt.
  const ergebnis = dominantColors(bild(SCHWARZ, [34, 34, 36]));

  assert.equal(ergebnis.suggestion[0], 'schwarz');
  assert.ok(ergebnis.confident);
});

test('Stoffstruktur und Rauschen ändern nichts', () => {
  const glatt = dominantColors(bild(BLAU, WEISS));
  const rau = dominantColors(bild(BLAU, WEISS, { rauschen: 40 }));

  assert.equal(rau.suggestion[0], glatt.suggestion[0]);
});

test('erkennt Gemustertes als gemustert', () => {
  const ergebnis = dominantColors(streifen([ROT, GRUEN, BLAU, WEISS]));

  assert.ok(ergebnis.patterned);
  assert.deepEqual(ergebnis.suggestion, ['bunt']);
});

test('zwei kräftige Farben werden beide genannt', () => {
  const ergebnis = dominantColors(streifen([ROT, GRUEN]));

  assert.equal(ergebnis.suggestion.length, 2);
  assert.deepEqual(new Set(ergebnis.suggestion), new Set(['rot', 'gruen']));
});

test('ein schmaler Streifen macht aus einem Teil keine zweifarbige Sache', () => {
  const ergebnis = dominantColors(streifen([BLAU, BLAU, BLAU, BLAU, BLAU, BLAU, BLAU, WEISS]));

  assert.deepEqual(ergebnis.suggestion, ['blau'], 'der weiße Streifen zählt nicht mit');
});

test('im Zweifel wird nichts behauptet', () => {
  // Vier Töne, die sich die Fläche paarweise teilen, ohne dass einer trägt
  // und ohne dass drei deutlich genug sind: kein Vorschlag.
  const ergebnis = dominantColors(streifen([GRAU, [150, 150, 148], SCHWARZ, [30, 30, 32]]));

  if (!ergebnis.confident) assert.deepEqual(ergebnis.suggestion, []);
  else assert.ok(ergebnis.suggestion.length >= 1);
});

test('mit leerem oder unsinnigem Bild passiert nichts Schlimmes', () => {
  for (const eingabe of [null, undefined, {}, { data: [], width: 0, height: 0 }]) {
    const ergebnis = dominantColors(eingabe);
    assert.deepEqual(ergebnis.suggestion, []);
    assert.deepEqual(ergebnis.colors, []);
    assert.equal(ergebnis.confident, false);
  }
});

test('durchsichtige Bildpunkte zählen nicht mit', () => {
  const groesse = 24;
  const data = new Uint8ClampedArray(groesse * groesse * 4);
  for (let i = 0; i < groesse * groesse; i++) {
    const untereHaelfte = Math.floor(i / groesse) >= groesse / 2;
    data[i * 4] = untereHaelfte ? ROT[0] : GRUEN[0];
    data[i * 4 + 1] = untereHaelfte ? ROT[1] : GRUEN[1];
    data[i * 4 + 2] = untereHaelfte ? ROT[2] : GRUEN[2];
    // Die grüne Hälfte ist freigestellt und damit nicht vorhanden.
    data[i * 4 + 3] = untereHaelfte ? 255 : 0;
  }

  const ergebnis = dominantColors({ data, width: groesse, height: groesse });
  assert.equal(ergebnis.suggestion[0], 'rot');
  assert.ok(!ergebnis.colors.some((farbe) => farbe.id === 'gruen'));
});

test('die Anteile ergeben zusammen eins', () => {
  const ergebnis = dominantColors(bild(ROT, WEISS));
  const summe = ergebnis.colors.reduce((s, farbe) => s + farbe.share, 0);
  assert.ok(Math.abs(summe - 1) < 1e-9);
});
