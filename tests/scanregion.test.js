import test from 'node:test';
import assert from 'node:assert/strict';

import { scanRegion, visibleRegion } from '../js/barcode.js';

/**
 * Der Sucherrahmen liegt auf dem Bildschirm, der Strichcode in den
 * Bildpunkten der Kamera. Dazwischen steht `object-fit: cover`, und das ist
 * keine gerade Umrechnung: Ein hochkant gehaltenes Telefon schneidet von
 * einem 16:9-Kamerabild links und rechts kräftig ab. Wer den Rahmen naiv als
 * "die mittleren 50 Prozent des Kamerabildes" nähme, durchsuchte einen ganz
 * anderen Fleck als den, auf den gezielt wird.
 */

/** Ein Video, das so tut, als käme es von der Kamera. */
const video = (vw, vh, box) => ({
  videoWidth: vw,
  videoHeight: vh,
  getBoundingClientRect: () => ({
    left: box.left, top: box.top, width: box.width, height: box.height,
    right: box.left + box.width, bottom: box.top + box.height,
  }),
});

const rect = (left, top, width, height) => ({
  getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
});

test('der Ausschnitt liegt dort, wo der Sucherrahmen hinzeigt', () => {
  // Telefon hochkant, 390x844. Kamera liefert 1920x1080 quer.
  // cover: 844/1080 = 0,781 -> das Bild wird auf 1500x844 skaliert, also
  // links und rechts je 555 Punkte abgeschnitten.
  const v = video(1920, 1080, { left: 0, top: 0, width: 390, height: 844 });
  // Sucherrahmen genau in der Mitte des Bildschirms.
  const region = scanRegion(v, rect(45, 372, 300, 100), 0);

  const scale = 844 / 1080;
  const offX = (390 - 1920 * scale) / 2;
  assert.equal(region.x, Math.round((45 - offX) / scale));
  assert.equal(region.y, Math.round(372 / scale));
  assert.equal(region.w, Math.round(300 / scale));
  assert.equal(region.h, Math.round(100 / scale));
});

test('ein mittiger Rahmen ergibt einen mittigen Ausschnitt', () => {
  const v = video(1920, 1080, { left: 0, top: 0, width: 390, height: 844 });
  const region = scanRegion(v, rect(45, 372, 300, 100), 0);
  const mitteX = region.x + region.w / 2;
  const mitteY = region.y + region.h / 2;
  assert.ok(Math.abs(mitteX - 960) <= 1, `waagerecht mittig, ist ${mitteX}`);
  assert.ok(Math.abs(mitteY - 540) <= 1, `senkrecht mittig, ist ${mitteY}`);
});

test('der Rand wird ringsum zugegeben, nicht einseitig', () => {
  const v = video(1920, 1080, { left: 0, top: 0, width: 390, height: 844 });
  const eng = scanRegion(v, rect(45, 372, 300, 100), 0);
  const weit = scanRegion(v, rect(45, 372, 300, 100), 0.25);

  assert.ok(weit.w > eng.w && weit.h > eng.h, 'wird größer');
  assert.equal(Math.round(weit.w / eng.w * 100), 150, '25 % je Seite');
  assert.ok(Math.abs((weit.x + weit.w / 2) - (eng.x + eng.w / 2)) <= 1, 'Mitte bleibt');
  assert.ok(Math.abs((weit.y + weit.h / 2) - (eng.y + eng.h / 2)) <= 1, 'Mitte bleibt');
});

test('ein Rahmen weiter oben liefert einen Ausschnitt weiter oben', () => {
  const v = video(1920, 1080, { left: 0, top: 0, width: 390, height: 844 });
  const oben = scanRegion(v, rect(45, 200, 300, 100), 0);
  const unten = scanRegion(v, rect(45, 600, 300, 100), 0);
  assert.ok(oben.y < unten.y);
  assert.equal(oben.x, unten.x, 'seitlich unverändert');
});

test('der Ausschnitt bleibt im Bild', () => {
  const v = video(1920, 1080, { left: 0, top: 0, width: 390, height: 844 });
  // Rahmen ragt oben aus dem Bildschirm heraus.
  const region = scanRegion(v, rect(-100, -80, 300, 100), 0.5);
  assert.ok(region.x >= 0 && region.y >= 0, 'kein negativer Anfang');
  assert.ok(region.x + region.w <= 1920, 'nicht über die Breite hinaus');
  assert.ok(region.y + region.h <= 1080, 'nicht über die Höhe hinaus');
});

test('das Video im Querformat wird oben und unten beschnitten', () => {
  // Umgekehrter Fall: breites Fenster, hochkantes Kamerabild.
  const v = video(720, 1280, { left: 0, top: 0, width: 800, height: 400 });
  const region = scanRegion(v, rect(250, 150, 300, 100), 0);
  const mitteY = region.y + region.h / 2;
  assert.ok(Math.abs(mitteY - 640) <= 1, `senkrecht mittig, ist ${mitteY}`);
});

test('ein Rahmen, der fast alles umfasst, lohnt keinen Ausschnitt', () => {
  // Dann wäre das Kopieren teurer als der gesparte Rest.
  const v = video(1920, 1080, { left: 0, top: 0, width: 1920, height: 1080 });
  assert.equal(scanRegion(v, rect(0, 0, 1920, 1080), 0), null);
  assert.equal(scanRegion(v, rect(20, 20, 1880, 1040), 0.5), null);
});

test('ohne brauchbare Maße gilt das ganze Bild', () => {
  const v = video(1920, 1080, { left: 0, top: 0, width: 390, height: 844 });
  assert.equal(scanRegion(v, null), null, 'kein Rahmen');
  assert.equal(scanRegion(video(0, 0, { left: 0, top: 0, width: 390, height: 844 }), rect(0, 0, 10, 10)), null,
    'Kamera liefert noch kein Bild');
  assert.equal(scanRegion(v, rect(45, 372, 0, 0)), null, 'Rahmen noch nicht gemessen');
  assert.equal(scanRegion(null, rect(45, 372, 300, 100)), null, 'gar kein Video');
});

test('der Ausschnitt ist deutlich kleiner als das ganze Bild', () => {
  // Darum geht es: weniger Bildpunkte durchrechnen, dafür in voller Schärfe.
  const v = video(1920, 1080, { left: 0, top: 0, width: 390, height: 844 });
  const region = scanRegion(v, rect(45, 372, 281, 164), 0.22);
  const anteil = (region.w * region.h) / (1920 * 1080);
  assert.ok(anteil < 0.35, `Ausschnitt ist ${Math.round(anteil * 100)} % des Bildes`);
});

// --- Was überhaupt auf dem Schirm steht ----------------------------------

test('vom Kamerabild ist auf einem hochkanten Telefon nur ein Streifen zu sehen', () => {
  // Das ist der Kern der Sache: 390 x 844 Fenster, 1280 x 720 Kamera.
  // `cover` vergrößert auf 1500 x 844 -- links und rechts fällt fast alles
  // weg. Wer den ganzen Rahmen durchsucht, rechnet zu drei Vierteln an
  // Bildpunkten, die niemand sieht.
  const v = video(1280, 720, { left: 0, top: 0, width: 390, height: 844 });
  const sicht = visibleRegion(v);

  assert.equal(sicht.h, 720, 'senkrecht ist alles zu sehen');
  assert.ok(sicht.w < 1280 * 0.3, `waagerecht nur ${sicht.w} von 1280`);
  const anteil = (sicht.w * sicht.h) / (1280 * 720);
  assert.ok(anteil < 0.3, `${Math.round(anteil * 100)} % des Bildes`);
});

test('der sichtbare Streifen liegt mittig', () => {
  const v = video(1280, 720, { left: 0, top: 0, width: 390, height: 844 });
  const sicht = visibleRegion(v);
  // Auf einen halben Bildpunkt genau -- bei ungerader Breite geht es nicht auf.
  assert.ok(Math.abs(sicht.x + sicht.w / 2 - 640) <= 1, `waagerecht: ${sicht.x + sicht.w / 2}`);
  assert.ok(Math.abs(sicht.y + sicht.h / 2 - 360) <= 1, `senkrecht: ${sicht.y + sicht.h / 2}`);
});

test('der Sucherausschnitt liegt im sichtbaren Streifen', () => {
  // Sonst zielte man auf etwas, das gar nicht durchsucht wird.
  const v = video(1280, 720, { left: 0, top: 0, width: 390, height: 844 });
  const sicht = visibleRegion(v, 0.25);
  const sucher = scanRegion(v, rect(55, 380, 281, 164));
  assert.ok(sucher.x >= sicht.x && sucher.x + sucher.w <= sicht.x + sicht.w);
  assert.ok(sucher.y >= sicht.y && sucher.y + sucher.h <= sicht.y + sicht.h);
});

test('die Zugabe greift über den Bildschirmrand hinaus, nicht über das Bild', () => {
  const v = video(1280, 720, { left: 0, top: 0, width: 390, height: 844 });
  const eng = visibleRegion(v, 0);
  const weit = visibleRegion(v, 0.25);
  assert.ok(weit.w > eng.w, 'greift weiter');
  assert.ok(weit.w <= 1280 && weit.x >= 0, 'aber nie über das Kamerabild hinaus');
  assert.equal(weit.h, 720, 'senkrecht war schon alles drin');
});

test('passt das Bild genau ins Fenster, gibt es nichts abzuschneiden', () => {
  const v = video(1280, 720, { left: 0, top: 0, width: 1280, height: 720 });
  assert.equal(visibleRegion(v), null, 'dann gilt das ganze Bild');
});

test('ohne laufende Kamera gibt es keinen sichtbaren Bereich', () => {
  assert.equal(visibleRegion(null), null);
  assert.equal(visibleRegion(video(0, 0, { left: 0, top: 0, width: 390, height: 844 })), null);
  assert.equal(visibleRegion(video(1280, 720, { left: 0, top: 0, width: 0, height: 0 })), null);
});
