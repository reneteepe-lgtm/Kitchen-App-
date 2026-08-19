/**
 * Die Geometrie der Diagramme.
 *
 * Reine Rechnung, kein DOM: Hier entstehen nur Zahlen und Pfadangaben, das
 * Zeichnen macht `app.js`. Der Zuschnitt hat einen praktischen Grund --
 * eine Kurve, die falsch liegt, lässt sich so in einem Test festnageln,
 * statt sie am Handy nachzumessen.
 *
 * Bibliothek ist keine im Spiel. Zwei Diagrammarten (eine Linie, ein paar
 * Balken) sind ein paar Dutzend Zeilen; eine Diagrammbibliothek wäre um ein
 * Vielfaches größer als diese ganze App.
 */

/**
 * Der Wertebereich einer Achse.
 *
 * Nicht bei null anfangen, sondern etwas unterhalb des kleinsten Werts:
 * Eine Kurve von 100 auf 105 kg wäre über einer Nullachse eine waagerechte
 * Linie -- und genau der Unterschied ist das, was man sehen will. Dass die
 * Achse nicht bei null steht, sagt die Beschriftung darunter dazu.
 */
export function range(values, { padding = 0.1 } = {}) {
  const zahlen = values.filter((wert) => Number.isFinite(wert));
  if (!zahlen.length) return { min: 0, max: 1 };

  const min = Math.min(...zahlen);
  const max = Math.max(...zahlen);
  if (min === max) {
    // Ein einziger Wert (oder lauter gleiche): eine Linie in der Mitte.
    const luft = Math.abs(min) * 0.1 || 1;
    return { min: min - luft, max: max + luft };
  }

  const luft = (max - min) * padding;
  return { min: min - luft, max: max + luft };
}

/**
 * Punkte einer Verlaufskurve in Bildkoordinaten.
 *
 * @param {number[]} values
 * @returns {{points:{x:number,y:number}[], line:string, area:string, min:number, max:number}}
 */
export function linePath(values, { width = 300, height = 120, padding = 8 } = {}) {
  const { min, max } = range(values);
  const innenBreite = width - padding * 2;
  const innenHoehe = height - padding * 2;
  const spanne = max - min || 1;

  const points = values.map((wert, i) => ({
    x: padding + (values.length === 1 ? innenBreite / 2 : (i / (values.length - 1)) * innenBreite),
    // Bildkoordinaten wachsen nach unten, Gewichte nach oben.
    y: padding + innenHoehe - ((wert - min) / spanne) * innenHoehe,
  }));

  if (!points.length) return { points, line: '', area: '', min, max };

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1).x.toFixed(1)} ${height - padding} L${points[0].x.toFixed(1)} ${height - padding} Z`;

  return { points, line, area, min, max };
}

/**
 * Balken für die Wochen.
 *
 * Die Höhe bezieht sich immer auf den größten Balken der Reihe, nicht auf
 * einen festen Maßstab: Verglichen werden die Wochen untereinander, und
 * eine Reihe, in der alle Balken zwei Pixel hoch sind, weil vor einem Jahr
 * einmal mehr los war, vergleicht gar nichts.
 */
export function barLayout(values, { width = 300, height = 90, gap = 6, minHeight = 3 } = {}) {
  if (!values.length) return [];

  const max = Math.max(...values, 0);
  const balkenBreite = (width - gap * (values.length - 1)) / values.length;

  return values.map((wert, i) => {
    const hoehe = max > 0 ? Math.max(wert > 0 ? minHeight : 0, (wert / max) * height) : 0;
    return {
      x: i * (balkenBreite + gap),
      y: height - hoehe,
      width: balkenBreite,
      height: hoehe,
      value: wert,
    };
  });
}

/**
 * Der Fortschrittsring: Wie viel Umfang eingefärbt wird.
 *
 * SVG zeichnet Ringe über die Strichlücke -- der Umfang minus dem Anteil,
 * der bleiben soll.
 */
export function ringDash(percent, radius) {
  const umfang = 2 * Math.PI * radius;
  const anteil = Math.max(0, Math.min(1, percent));
  return { circumference: umfang, offset: umfang * (1 - anteil) };
}
