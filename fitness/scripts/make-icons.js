/**
 * Erzeugt die App-Symbole: `node fitness/scripts/make-icons.js`
 *
 * Warum ein Skript und keine abgelegten Bilddateien? Weil die Symbole sonst
 * beim ersten Farbwechsel auseinanderlaufen: Das SVG wäre geändert, die
 * PNGs blieben, wie sie waren -- und auf dem Startbildschirm bliebe
 * monatelang das alte Blau stehen, ohne dass es im Code irgendwo sichtbar
 * wäre.
 *
 * Gezeichnet wird ohne Bibliothek, mit Abstandsfunktionen: Für jeden
 * Bildpunkt wird ausgerechnet, wie weit er von der nächsten Form entfernt
 * ist. Das kostet ein paar Zeilen mehr als ein fertiger Zeichensatz, dafür
 * sind die Kanten bei jeder Größe glatt, und das Projekt bleibt ohne
 * Abhängigkeiten.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BLAU = [0x2f, 0x5a, 0xa8];
const WEISS = [0xff, 0xff, 0xff];

// --- Formen --------------------------------------------------------------
// Alle Maße in Anteilen der Kantenlänge, damit dieselbe Zeichnung für 180
// wie für 512 Pixel gilt. Negativ heißt "innerhalb der Form".

const laenge = (x, y) => Math.hypot(x, y);

/** Abstand zu einem Balken mit runden Enden. */
function balken(px, py, x0, y0, x1, y1, dicke) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const laengeQuadrat = dx * dx + dy * dy;
  const t = laengeQuadrat
    ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / laengeQuadrat))
    : 0;
  return laenge(px - (x0 + t * dx), py - (y0 + t * dy)) - dicke / 2;
}

/** Abstand zu einem Rechteck mit runden Ecken. */
function rundesRechteck(px, py, halbBreite, halbHoehe, radius) {
  const dx = Math.abs(px - 0.5) - (halbBreite - radius);
  const dy = Math.abs(py - 0.5) - (halbHoehe - radius);
  const aussen = laenge(Math.max(dx, 0), Math.max(dy, 0));
  return aussen + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Die Kurzhantel.
 *
 * Waagerecht und nicht schräg: Schräg sieht auf einem großen Bild besser
 * aus, aber bei 40 Pixeln in der Reiterleiste des Betriebssystems werden
 * aus den vier Scheiben vier Fusseln. Waagerecht bleibt bei jeder Größe
 * eine Hantel.
 *
 * Vier Scheiben statt zwei, weil eine einzelne Scheibe je Seite mit der
 * Stange zu einem Kreuz verschmilzt.
 */
function hantel(px, py, groesse = 1) {
  // Um die Mitte skalieren, damit dieselbe Hantel für das randlose Symbol
  // kleiner gezeichnet werden kann.
  const x = (px - 0.5) / groesse + 0.5;
  const y = (py - 0.5) / groesse + 0.5;

  return Math.min(
    // Stange
    balken(x, y, 0.22, 0.5, 0.78, 0.5, 0.072),
    // Innere Scheiben
    balken(x, y, 0.32, 0.305, 0.32, 0.695, 0.105),
    balken(x, y, 0.68, 0.305, 0.68, 0.695, 0.105),
    // Äußere Scheiben
    balken(x, y, 0.2, 0.375, 0.2, 0.625, 0.09),
    balken(x, y, 0.8, 0.375, 0.8, 0.625, 0.09),
  );
}

// --- Zeichnen ------------------------------------------------------------

/**
 * Zeichnet ein Symbol in einen Pixelpuffer.
 *
 * Jeder Bildpunkt wird dreifach abgetastet. Ohne diese Glättung hätten die
 * runden Enden der Scheiben bei kleinen Größen eine Treppe statt einer
 * Kante.
 */
function zeichne(groesse, { randlos }) {
  const pixel = Buffer.alloc(groesse * groesse * 4);
  const abtastungen = 3;
  const hantelGroesse = randlos ? 0.72 : 1;

  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      let grundflaeche = 0;
      let zeichnung = 0;

      for (let sy = 0; sy < abtastungen; sy++) {
        for (let sx = 0; sx < abtastungen; sx++) {
          const px = (x + (sx + 0.5) / abtastungen) / groesse;
          const py = (y + (sy + 0.5) / abtastungen) / groesse;

          // Randlos: volle Fläche, weil das Betriebssystem selbst
          // zuschneidet. Sonst ein abgerundetes Quadrat.
          if (randlos || rundesRechteck(px, py, 0.5, 0.5, 0.225) < 0) grundflaeche++;
          if (hantel(px, py, hantelGroesse) < 0) zeichnung++;
        }
      }

      const gesamt = abtastungen * abtastungen;
      const deckung = grundflaeche / gesamt;
      const strich = zeichnung / gesamt;

      const i = (y * groesse + x) * 4;
      for (let kanal = 0; kanal < 3; kanal++) {
        pixel[i + kanal] = Math.round(BLAU[kanal] * (1 - strich) + WEISS[kanal] * strich);
      }
      pixel[i + 3] = Math.round(255 * deckung);
    }
  }

  return pixel;
}

// --- PNG schreiben -------------------------------------------------------

const CRC_TABELLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABELLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function block(typ, daten) {
  const laengeBuffer = Buffer.alloc(4);
  laengeBuffer.writeUInt32BE(daten.length);
  const inhalt = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const pruefsumme = Buffer.alloc(4);
  pruefsumme.writeUInt32BE(crc32(inhalt));
  return Buffer.concat([laengeBuffer, inhalt, pruefsumme]);
}

function alsPng(pixel, groesse) {
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(groesse, 0);
  kopf.writeUInt32BE(groesse, 4);
  kopf[8] = 8; // Bits je Kanal
  kopf[9] = 6; // Echtfarbe mit Alphakanal
  // Jede Zeile bekommt ein führendes Filter-Byte; 0 heißt "unverändert".
  const zeilen = Buffer.alloc(groesse * (groesse * 4 + 1));
  for (let y = 0; y < groesse; y++) {
    zeilen[y * (groesse * 4 + 1)] = 0;
    pixel.copy(zeilen, y * (groesse * 4 + 1) + 1, y * groesse * 4, (y + 1) * groesse * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block('IHDR', kopf),
    block('IDAT', deflateSync(zeilen, { level: 9 })),
    block('IEND', Buffer.alloc(0)),
  ]);
}

// --- SVG -----------------------------------------------------------------

/** Dieselbe Zeichnung als Vektor -- für Browser, die sie in jeder Größe wollen. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Kurzhantel">
  <rect width="100" height="100" rx="22.5" fill="#2f5aa8"/>
  <g fill="none" stroke="#ffffff" stroke-linecap="round">
    <path d="M22 50h56" stroke-width="7.2"/>
    <path d="M32 30.5v39" stroke-width="10.5"/>
    <path d="M68 30.5v39" stroke-width="10.5"/>
    <path d="M20 37.5v25" stroke-width="9"/>
    <path d="M80 37.5v25" stroke-width="9"/>
  </g>
</svg>
`;

// --- Los -----------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), svg);

const dateien = [
  ['icon-180.png', 180, false],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable.png', 512, true],
];

for (const [name, groesse, randlos] of dateien) {
  writeFileSync(join(OUT, name), alsPng(zeichne(groesse, { randlos }), groesse));
  console.log(`${name} (${groesse}px)`);
}
