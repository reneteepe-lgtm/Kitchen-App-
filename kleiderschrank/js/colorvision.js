/**
 * Welche Farbe hat das auf dem Foto?
 *
 * Das ist die eine Frage, die sich aus einem Bild zuverlässig beantworten
 * lässt, ohne irgendetwas zu verschicken und ohne ein gelerntes Modell:
 * Farbe *steht* im Bild, sie muss nicht erkannt, sondern nur ausgezählt
 * werden. (Ob das Teil ein Hemd oder eine Bluse ist, steht dort nicht --
 * das ist eine ganz andere Aufgabe, siehe README.)
 *
 * Drei Dinge machen den Unterschied zwischen "geht so" und "stimmt meistens":
 *
 *  1. **Gerechnet wird in Lab, nicht in RGB.** In RGB liegt ein warmes
 *     Grau näher an Braun als an Grau. Lab ist so gebaut, dass Abstände
 *     ungefähr dem entsprechen, was das Auge als Unterschied sieht -- und
 *     genau das wird hier gebraucht: die *nächste* Farbe, nicht die
 *     rechnerisch ähnlichste.
 *  2. **Der Hintergrund fliegt raus.** Kleidung wird auf dem Bett, dem
 *     Boden oder vor der Wand fotografiert. Ohne diesen Schritt ist das
 *     Ergebnis die Farbe der Bettdecke.
 *  3. **Die Mitte zählt mehr.** Wer ein Teil fotografiert, hält es in die
 *     Mitte. Was am Rand liegt, ist im Zweifel nicht gemeint.
 */

import { COLORS } from './slots.js';

/**
 * Farben, gegen die abgeglichen wird.
 *
 * "Gemustert" ist keine Farbe, sondern ein Befund -- ein Pixel kann nicht
 * gemustert sein. Es entsteht weiter unten aus der Verteilung und darf hier
 * nicht mitspielen, sonst zöge es als bloßer Lila-Ton echte Treffer ab.
 */
const PALETTE = COLORS.filter((color) => color.id !== 'bunt');

// --- Farbraum ------------------------------------------------------------

const linear = (kanal) => {
  const c = kanal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** sRGB nach CIE-Lab (Weißpunkt D65). */
export function rgbToLab(r, g, b) {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);

  // Nach XYZ und gleich auf den Weißpunkt normiert.
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export const labDistance = (p, q) =>
  Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Die Palette einmal vorgerechnet -- sonst je Bildpunkt fünfzehn Umrechnungen. */
const PALETTE_LAB = PALETTE.map((color) => {
  const [r, g, b] = hexToRgb(color.hex);
  return { id: color.id, lab: rgbToLab(r, g, b) };
});

/** Welche Farbe der Palette liegt am nächsten? */
export function nearestColor(lab) {
  let beste = null;
  for (const eintrag of PALETTE_LAB) {
    const abstand = labDistance(lab, eintrag.lab);
    if (!beste || abstand < beste.abstand) beste = { id: eintrag.id, abstand };
  }
  return beste;
}

// --- Auszählen -----------------------------------------------------------

/** Ab diesem Abstand gilt ein Bildpunkt als "wie der Hintergrund". */
const HINTERGRUND_ABSTAND = 14;

/**
 * Schätzt die Hintergrundfarbe aus dem Rahmen des Bildes.
 *
 * Der Median statt des Mittelwerts, weil ein Ärmel, der in den Rand ragt,
 * einen Mittelwert verzieht -- und dann würde ausgerechnet das Kleidungs-
 * stück als Hintergrund weggeworfen.
 */
function randfarbe(daten, breite, hoehe) {
  const rand = Math.max(1, Math.round(Math.min(breite, hoehe) * 0.08));
  const werte = { r: [], g: [], b: [] };

  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const amRand = x < rand || y < rand || x >= breite - rand || y >= hoehe - rand;
      if (!amRand) continue;
      const i = (y * breite + x) * 4;
      if (daten[i + 3] < 128) continue;
      werte.r.push(daten[i]);
      werte.g.push(daten[i + 1]);
      werte.b.push(daten[i + 2]);
    }
  }

  if (!werte.r.length) return null;
  const median = (liste) => liste.sort((a, b) => a - b)[Math.floor(liste.length / 2)];
  return rgbToLab(median(werte.r), median(werte.g), median(werte.b));
}

/**
 * Zählt die Farben eines Bildes aus.
 *
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number}} bild
 * @returns {{colors:Array<{id:string, share:number}>, suggestion:string[],
 *            patterned:boolean, confident:boolean}}
 */
export function dominantColors(bild, { hintergrundEntfernen = true } = {}) {
  const { data, width, height } = bild ?? {};
  if (!data?.length || !width || !height) {
    return { colors: [], suggestion: [], patterned: false, confident: false };
  }

  const hintergrund = hintergrundEntfernen ? randfarbe(data, width, height) : null;
  const mitte = { x: (width - 1) / 2, y: (height - 1) / 2 };
  const radius = Math.hypot(mitte.x, mitte.y) || 1;

  // Zweimal zählen: einmal ohne Hintergrund, und -- falls davon fast nichts
  // übrig bleibt -- ersatzweise mit allem. Ein schwarzes Hemd auf schwarzem
  // Grund sähe sonst aus wie ein leeres Bild.
  const gewichte = new Map();
  const gewichteRoh = new Map();
  let summe = 0;
  let summeRoh = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;

      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      const treffer = nearestColor(lab);

      // Was in der Mitte liegt, ist gemeint; was am Rand liegt, vielleicht.
      const abstandZurMitte = Math.hypot(x - mitte.x, y - mitte.y) / radius;
      const gewicht = Math.max(0.05, 1 - abstandZurMitte ** 2);

      gewichteRoh.set(treffer.id, (gewichteRoh.get(treffer.id) ?? 0) + gewicht);
      summeRoh += gewicht;

      if (hintergrund && labDistance(lab, hintergrund) < HINTERGRUND_ABSTAND) continue;
      gewichte.set(treffer.id, (gewichte.get(treffer.id) ?? 0) + gewicht);
      summe += gewicht;
    }
  }

  const genugUebrig = summeRoh > 0 && summe / summeRoh >= 0.15;
  const gezaehlt = genugUebrig ? gewichte : gewichteRoh;
  const gesamt = genugUebrig ? summe : summeRoh;
  if (!gesamt) return { colors: [], suggestion: [], patterned: false, confident: false };

  const colors = [...gezaehlt.entries()]
    .map(([id, gewicht]) => ({ id, share: gewicht / gesamt }))
    .sort((a, b) => b.share - a.share);

  return { colors, ...bewerte(colors) };
}

/**
 * Aus der Verteilung wird ein Vorschlag.
 *
 * Die Schwellen sind bewusst zurückhaltend. Ein falsch gesetztes Grün, das
 * niemand bemerkt, ist schlimmer als gar kein Vorschlag: Es steht danach in
 * den Daten, geht in die gelernten Vorlieben ein und erklärt sich nie.
 * Deshalb wird im Zweifel nichts vorgeschlagen.
 */
function bewerte(colors) {
  const stark = colors.filter((farbe) => farbe.share >= 0.12);
  const oben = colors[0];

  // Kein Ton trägt das Bild, aber drei sind deutlich da: gemustert.
  const patterned = oben.share < 0.5 && stark.length >= 3;
  if (patterned) return { suggestion: ['bunt'], patterned: true, confident: true };

  const confident = oben.share >= 0.35;
  if (!confident) return { suggestion: [], patterned: false, confident: false };

  // Die zweite Farbe nur, wenn sie wirklich mitspielt -- ein weißer Streifen
  // macht aus einem blauen Hemd kein blau-weißes.
  const zweite = colors[1];
  const suggestion =
    zweite && zweite.share >= 0.25 ? [oben.id, zweite.id] : [oben.id];

  return { suggestion, patterned: false, confident: true };
}

// --- Aus einem Foto ------------------------------------------------------

/**
 * Rechnet ein Foto auf ein winziges Raster herunter und liest es aus.
 *
 * 64 Pixel Kantenlänge reichen für eine Farbfrage vollkommen und machen aus
 * einer halben Sekunde Rechnen ein paar Millisekunden. Das Herunterrechnen
 * mittelt nebenbei die Bildpunkte -- Stoffstruktur und Rauschen fallen
 * dabei von selbst weg.
 */
export async function colorsFromPhoto(blob, { raster = 64 } = {}) {
  const bitmap = await createImageBitmap(blob);

  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(raster, raster)
      : Object.assign(document.createElement('canvas'), { width: raster, height: raster });

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, raster, raster);
  bitmap.close?.();

  return dominantColors(ctx.getImageData(0, 0, raster, raster));
}
