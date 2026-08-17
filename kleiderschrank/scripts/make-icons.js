/**
 * Erzeugt die App-Symbole: `node kleiderschrank/scripts/make-icons.js`
 *
 * Warum ein Skript und keine abgelegten Bilddateien? Weil die Symbole sonst
 * beim ersten Farbwechsel auseinanderlaufen: Das SVG wäre geändert, die
 * PNGs blieben, wie sie waren -- und auf dem Startbildschirm bliebe monatelang
 * das alte Grün stehen, ohne dass es im Code irgendwo sichtbar wäre.
 *
 * Gezeichnet wird ohne Bibliothek, mit Abstandsfunktionen: Für jeden Bildpunkt
 * wird ausgerechnet, wie weit er von der nächsten Form entfernt ist. Das
 * kostet ein paar Zeilen mehr als ein fertiger Zeichensatz, dafür sind die
 * Kanten bei jeder Größe glatt, und das Projekt bleibt ohne Abhängigkeiten.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const GRUEN = [0x3a, 0x6b, 0x45];
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

/** Abstand zu einem Ring. */
function ring(px, py, cx, cy, radius, dicke) {
  return Math.abs(laenge(px - cx, py - cy) - radius) - dicke / 2;
}

/** Abstand zu einem Rechteck mit runden Ecken. */
function rundesRechteck(px, py, halbBreite, halbHoehe, radius) {
  const dx = Math.abs(px - 0.5) - (halbBreite - radius);
  const dy = Math.abs(py - 0.5) - (halbHoehe - radius);
  const aussen = laenge(Math.max(dx, 0), Math.max(dy, 0));
  return aussen + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Der Kleiderbügel.
 *
 * Ein geschlossener Ring statt eines offenen Hakens: Bei 40 Pixeln in der
 * Reiterleiste des Betriebssystems franst ein offener Haken zu einem
 * Fussel aus, ein Ring bleibt ein Ring.
 */
function buegel(px, py, groesse = 1) {
  // Um die Mitte skalieren, damit derselbe Bügel für das randlose Symbol
  // kleiner gezeichnet werden kann.
  const x = (px - 0.5) / groesse + 0.5;
  const y = (py - 0.5) / groesse + 0.5;

  return Math.min(
    ring(x, y, 0.5, 0.345, 0.072, 0.044),
    // Erst unterhalb des Rings ansetzen (0,345 + 0,072 + halbe Strichdicke),
    // sonst schiebt sich ein weißer Keil in seine Mitte.
    balken(x, y, 0.5, 0.44, 0.5, 0.49, 0.044),
    balken(x, y, 0.5, 0.47, 0.19, 0.675, 0.05),
    balken(x, y, 0.5, 0.47, 0.81, 0.675, 0.05),
    balken(x, y, 0.2, 0.675, 0.8, 0.675, 0.05),
  );
}

// --- Zeichnen ------------------------------------------------------------

/**
 * Zeichnet ein Symbol in einen Pixelpuffer.
 *
 * Jeder Bildpunkt wird dreifach abgetastet. Ohne diese Glättung hätte der
 * schräge Teil des Bügels bei kleinen Größen eine Treppe statt einer Kante.
 */
function zeichne(groesse, { randlos }) {
  const pixel = Buffer.alloc(groesse * groesse * 4);
  const abtastungen = 3;
  const buegelGroesse = randlos ? 0.72 : 1;

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
          if (buegel(px, py, buegelGroesse) < 0) zeichnung++;
        }
      }

      const gesamt = abtastungen * abtastungen;
      const deckung = grundflaeche / gesamt;
      const strich = zeichnung / gesamt;

      const i = (y * groesse + x) * 4;
      for (let kanal = 0; kanal < 3; kanal++) {
        pixel[i + kanal] = Math.round(GRUEN[kanal] * (1 - strich) + WEISS[kanal] * strich);
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
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Kleiderbügel">
  <rect width="100" height="100" rx="22.5" fill="#3a6b45"/>
  <g fill="none" stroke="#ffffff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="50" cy="34.5" r="7.2"/>
    <path d="M50 44v4"/>
    <path d="M50 47 19 67.5h62L50 47z"/>
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
