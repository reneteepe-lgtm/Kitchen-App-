/**
 * Den Hintergrund wegnehmen.
 *
 * Ein Kleiderschrank sieht erst dann nach etwas aus, wenn die Teile
 * freigestellt sind: Zehn Fotos mit zehn verschiedenen Bettdecken,
 * Fußböden und Wänden dahinter sind ein Sammelsurium, zehn Freisteller auf
 * ruhigem Grund sind eine Übersicht.
 *
 * Gearbeitet wird ohne gelerntes Modell, mit einem Verfahren, das älter ist
 * als jedes davon: Von den Bildrändern aus wird geflutet, und alles, was
 * dabei erreicht wird, ist Hintergrund. Das trifft genau die Annahme, die
 * bei Kleiderfotos fast immer stimmt -- das Teil liegt in der Mitte, der
 * Grund ringsherum ist einigermaßen einheitlich und hängt zusammen.
 *
 * Zwei Schwellen zugleich, und das ist der ganze Trick:
 *
 *  - **Örtlich** (eng): Ein Bildpunkt gehört zum Hintergrund, wenn er
 *    seinem Nachbarn ähnelt, von dem aus er erreicht wurde. Das lässt die
 *    Flut sanften Verläufen folgen -- Schattenwurf, ungleiches Licht,
 *    Falten in der Bettdecke.
 *  - **Insgesamt** (weit): Zusätzlich muss er der Randfarbe noch grob
 *    ähneln. Ohne diese zweite Bedingung liefe die Flut über kleine Schritte
 *    ins Kleidungsstück hinein und fräße es von außen auf.
 *
 * Und wenn das Ergebnis nicht plausibel ist, wird es verworfen. Ein
 * halbiertes Hemd ist schlechter als ein Foto mit Bettdecke.
 */

import { rgbToLab, labDistance } from './colorvision.js';

/** Wie ähnlich ein Nachbar sein muss, um mitzufluten. */
export const SCHWELLE_OERTLICH = 7;

/** Wie weit ein Punkt insgesamt von der Randfarbe abweichen darf. */
export const SCHWELLE_GESAMT = 26;

/**
 * Berechnet die Hintergrundmaske.
 *
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number}} bild
 * @returns {{alpha:Uint8ClampedArray, removed:number, ok:boolean, grund:string}}
 *   `alpha` ist 0 für Hintergrund und 255 für das Teil.
 */
export function backgroundMask(
  bild,
  { oertlich = SCHWELLE_OERTLICH, gesamt = SCHWELLE_GESAMT } = {},
) {
  const { data, width, height } = bild ?? {};
  if (!data?.length || !width || !height) {
    return { alpha: new Uint8ClampedArray(0), removed: 0, ok: false, grund: 'kein Bild' };
  }

  const anzahl = width * height;
  const lab = new Array(anzahl);
  for (let i = 0; i < anzahl; i++) {
    lab[i] = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }

  const randLab = randfarbe(lab, width, height);
  const istHintergrund = new Uint8Array(anzahl);

  // Fluten von allen Randpunkten aus. Eine eigene Schlange statt Rekursion:
  // Bei einer halben Million Bildpunkten wäre der Aufrufstapel längst voll.
  const schlange = new Int32Array(anzahl);
  let kopf = 0;
  let ende = 0;

  const einreihen = (index) => {
    if (istHintergrund[index]) return;
    istHintergrund[index] = 1;
    schlange[ende++] = index;
  };

  for (let x = 0; x < width; x++) {
    if (labDistance(lab[x], randLab) < gesamt) einreihen(x);
    const unten = (height - 1) * width + x;
    if (labDistance(lab[unten], randLab) < gesamt) einreihen(unten);
  }
  for (let y = 0; y < height; y++) {
    const links = y * width;
    if (labDistance(lab[links], randLab) < gesamt) einreihen(links);
    const rechts = y * width + width - 1;
    if (labDistance(lab[rechts], randLab) < gesamt) einreihen(rechts);
  }

  while (kopf < ende) {
    const index = schlange[kopf++];
    const x = index % width;
    const y = (index - x) / width;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const nachbar = ny * width + nx;
      if (istHintergrund[nachbar]) continue;

      // Beide Bedingungen müssen halten -- siehe oben.
      if (labDistance(lab[nachbar], lab[index]) >= oertlich) continue;
      if (labDistance(lab[nachbar], randLab) >= gesamt) continue;

      einreihen(nachbar);
    }
  }

  const alpha = new Uint8ClampedArray(anzahl);
  let entfernt = 0;
  for (let i = 0; i < anzahl; i++) {
    if (istHintergrund[i]) entfernt++;
    else alpha[i] = 255;
  }

  const removed = entfernt / anzahl;
  return { alpha, removed, ...pruefe(alpha, removed, width, height) };
}

/** Die Randfarbe als Median -- ein Ärmel im Rand soll sie nicht verziehen. */
function randfarbe(lab, width, height) {
  const L = [];
  const a = [];
  const b = [];

  const nimm = (index) => {
    L.push(lab[index].L);
    a.push(lab[index].a);
    b.push(lab[index].b);
  };

  for (let x = 0; x < width; x++) {
    nimm(x);
    nimm((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    nimm(y * width);
    nimm(y * width + width - 1);
  }

  const median = (liste) => liste.sort((p, q) => p - q)[Math.floor(liste.length / 2)];
  return { L: median(L), a: median(a), b: median(b) };
}

/**
 * Taugt das Ergebnis?
 *
 * Drei Prüfungen, jede gegen einen Fehlschlag, den man sonst erst auf dem
 * fertigen Bild sähe:
 *
 *  - **Zu wenig weg**: Der Grund war zu bunt oder zu unruhig, die Flut kam
 *    nicht weit. Das Bild bleibt, wie es ist.
 *  - **Zu viel weg**: Das Teil hat dieselbe Farbe wie der Grund, die Flut
 *    ist hindurchgelaufen. Übrig bliebe ein Fetzen.
 *  - **Mitte weg**: Der sicherste Hinweis darauf, dass das Verfahren das
 *    Falsche gegriffen hat. Wer ein Teil fotografiert, hat es in der Mitte.
 */
function pruefe(alpha, removed, width, height) {
  if (removed < 0.12) return { ok: false, grund: 'Hintergrund zu unruhig' };
  if (removed > 0.92) return { ok: false, grund: 'Teil und Hintergrund zu ähnlich' };

  // Ein kleines Feld in der Mitte, nicht ein einzelner Punkt: Ein Loch
  // zwischen zwei Hosenbeinen läge sonst genau auf dem Prüfpunkt.
  const mx = Math.floor(width / 2);
  const my = Math.floor(height / 2);
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  let deckend = 0;
  let gesehen = 0;

  for (let y = my - radius; y <= my + radius; y++) {
    for (let x = mx - radius; x <= mx + radius; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      gesehen++;
      if (alpha[y * width + x]) deckend++;
    }
  }

  if (gesehen && deckend / gesehen < 0.4) return { ok: false, grund: 'Mitte wurde entfernt' };
  return { ok: true, grund: '' };
}

/**
 * Liest die Maske an einer Stelle zwischen den Bildpunkten aus.
 *
 * Gebraucht, weil die Maske absichtlich kleiner gerechnet wird als das
 * Bild: Das ist nicht nur schneller, das weiche Auslesen macht aus der
 * harten Treppenkante der Maske nebenbei einen sauberen Übergang. Eine
 * pixelgenaue Kante sieht ausgeschnitten aus, eine weiche freigestellt.
 */
export function sampleMask(alpha, breite, hoehe, u, v) {
  const x = Math.min(breite - 1, Math.max(0, u * breite - 0.5));
  const y = Math.min(hoehe - 1, Math.max(0, v * hoehe - 0.5));

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(breite - 1, x0 + 1);
  const y1 = Math.min(hoehe - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  const oben = alpha[y0 * breite + x0] * (1 - fx) + alpha[y0 * breite + x1] * fx;
  const unten = alpha[y1 * breite + x0] * (1 - fx) + alpha[y1 * breite + x1] * fx;
  return oben * (1 - fy) + unten * fy;
}

// --- Im Browser ----------------------------------------------------------

/** Kantenlänge, auf der die Maske gerechnet wird. */
const MASKE = 180;

const leinwand = (breite, hoehe) =>
  typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(breite, hoehe)
    : Object.assign(document.createElement('canvas'), { width: breite, height: hoehe });

const alsBlob = (canvas, typ, guete) =>
  typeof canvas.convertToBlob === 'function'
    ? canvas.convertToBlob({ type: typ, quality: guete })
    : new Promise((fertig) => canvas.toBlob(fertig, typ, guete));

/**
 * Stellt ein Foto frei.
 *
 * @returns {Promise<{blob:Blob, removed:number}|null>} `null`, wenn das
 *   Ergebnis nicht taugt -- dann bleibt das Foto, wie es ist.
 */
export async function cutoutPhoto(datei, { maske = MASKE } = {}) {
  const bitmap = await createImageBitmap(datei);
  const breite = bitmap.width;
  const hoehe = bitmap.height;

  // Klein rechnen für die Maske. Nebenbei fällt dabei die Stoffstruktur
  // weg, an der sich die Flut sonst festbisse.
  const seitenverhaeltnis = breite / hoehe;
  const mb = Math.max(8, Math.round(seitenverhaeltnis >= 1 ? maske : maske * seitenverhaeltnis));
  const mh = Math.max(8, Math.round(seitenverhaeltnis >= 1 ? maske / seitenverhaeltnis : maske));

  const klein = leinwand(mb, mh);
  const kleinCtx = klein.getContext('2d', { willReadFrequently: true });
  kleinCtx.drawImage(bitmap, 0, 0, mb, mh);

  const { alpha, removed, ok } = backgroundMask(kleinCtx.getImageData(0, 0, mb, mh));
  if (!ok) {
    bitmap.close?.();
    return null;
  }

  const gross = leinwand(breite, hoehe);
  const ctx = gross.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const bild = ctx.getImageData(0, 0, breite, hoehe);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const wert = sampleMask(alpha, mb, mh, (x + 0.5) / breite, (y + 0.5) / hoehe);
      bild.data[(y * breite + x) * 4 + 3] = wert;
    }
  }
  ctx.putImageData(bild, 0, 0);

  // PNG, nicht JPEG: JPEG kann keine Durchsichtigkeit, und genau die ist
  // hier das ganze Ergebnis.
  return { blob: await alsBlob(gross, 'image/png'), removed };
}
