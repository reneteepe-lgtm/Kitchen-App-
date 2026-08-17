/**
 * Wie ein Outfit auf der Fläche liegt.
 *
 * Ein Outfit als Liste von Namen ist eine Buchhaltung. Als Bild -- Mütze
 * oben, Oberteil darunter, Hose darunter, Schuhe unten, Uhr daneben -- ist
 * es das, was man sich morgens vorstellt. Deshalb bekommt jedes Teil eine
 * Stelle, und die lässt sich mit dem Finger verschieben.
 *
 * Gespeichert wird in Anteilen der Fläche (0 bis 1), nicht in Pixeln. Auf
 * einem kleinen Handy, einem großen Handy und beim Teilen als Bild kommt
 * damit dieselbe Anordnung heraus; mit Pixelwerten wäre die Uhr auf dem
 * nächsten Gerät neben der Fläche.
 */

import { SLOTS } from './slots.js';

/**
 * Wo ein Teil liegt, wenn niemand es angefasst hat.
 *
 * `x`/`y` ist die Mitte des Teils, `scale` seine Breite -- beides als
 * Anteil der Fläche. Die Werte bilden nach, wie ein Mensch Kleidung zum
 * Fotografieren auslegt: eine senkrechte Achse von Kopf bis Fuß, und was
 * kein Körperteil belegt (Uhr, Tasche), liegt daneben.
 */
export const DEFAULT_POSITIONS = {
  headwear: { x: 0.5, y: 0.14, scale: 0.28 },
  top: { x: 0.5, y: 0.38, scale: 0.46 },
  dress: { x: 0.5, y: 0.45, scale: 0.5 },
  outer: { x: 0.19, y: 0.35, scale: 0.32 },
  bottom: { x: 0.5, y: 0.66, scale: 0.42 },
  shoes: { x: 0.5, y: 0.85, scale: 0.32 },
  accessory: { x: 0.83, y: 0.56, scale: 0.24 },
};

/**
 * Warum die äußeren Stellen nicht dichter am Rand liegen.
 *
 * `x`/`y` ist die *Mitte* eines Teils, seine Kachel reicht also nach allen
 * Seiten über diesen Punkt hinaus -- und die Fläche schneidet ab, was
 * darüber hinausragt. Bei der Mütze ganz oben und den Schuhen ganz unten
 * fällt das sofort auf: ein angeschnittener Schuh sieht nicht nach
 * Absicht aus, sondern nach Fehler. Die Werte oben halten deshalb an
 * beiden Enden eine halbe Kachelhöhe Abstand.
 */

const FALLBACK_POSITION = { x: 0.5, y: 0.5, scale: 0.3 };

/**
 * In welcher Reihenfolge die Teile übereinanderliegen.
 *
 * Die Jacke gehört nach hinten, die Uhr nach vorn -- dieselbe Ordnung wie
 * beim Anziehen. Ohne feste Reihenfolge verdeckte mal die Hose das
 * Oberteil und mal umgekehrt, je nachdem, in welcher Reihenfolge die Teile
 * gerade erfasst wurden.
 */
export const STACK_ORDER = ['outer', 'dress', 'bottom', 'top', 'shoes', 'headwear', 'accessory'];

export const stackIndex = (slot) => {
  const platz = STACK_ORDER.indexOf(slot);
  return platz === -1 ? 0 : platz;
};

/** Hält eine Stelle auf der Fläche -- mit etwas Luft zum Rand. */
export function clampPosition({ x, y, scale }) {
  const groesse = Math.min(0.9, Math.max(0.08, Number(scale) || FALLBACK_POSITION.scale));
  const rand = 0.04;
  return {
    x: Math.min(1 - rand, Math.max(rand, Number(x) || 0)),
    y: Math.min(1 - rand, Math.max(rand, Number(y) || 0)),
    scale: groesse,
  };
}

/**
 * Die Anordnung, mit der ein neues Outfit anfängt.
 *
 * Liegen zwei Teile im selben Fach -- zwei Ketten, zwei Jacken --, werden
 * sie seitlich auseinandergerückt. Übereinander wäre das zweite sonst
 * unsichtbar, und niemand käme darauf, es wegzuziehen.
 */
export function defaultLayout(items) {
  const proFach = new Map();
  for (const teil of items) {
    proFach.set(teil.slot, [...(proFach.get(teil.slot) ?? []), teil]);
  }

  const layout = {};
  for (const [slot, imFach] of proFach) {
    const grund = DEFAULT_POSITIONS[slot] ?? FALLBACK_POSITION;

    imFach.forEach((teil, nummer) => {
      // Der erste bleibt, wo er hingehört; jeder weitere rückt zur Seite.
      const versatz = nummer === 0 ? 0 : (nummer % 2 === 1 ? 1 : -1) * Math.ceil(nummer / 2) * 0.17;
      layout[teil.id] = clampPosition({ ...grund, x: grund.x + versatz });
    });
  }

  return layout;
}

/**
 * Bringt eine gespeicherte Anordnung mit den heutigen Teilen zusammen.
 *
 * Ein Outfit überlebt seine Anordnung: Teile werden aussortiert, neue
 * kommen dazu. Was fehlt, bekommt seinen Platz aus der Grundanordnung; was
 * nicht mehr dazugehört, fällt weg -- sonst wüchse mit jeder Änderung eine
 * Liste von Stellen für Teile, die es nicht mehr gibt.
 */
export function mergeLayout(saved, items) {
  const grund = defaultLayout(items);
  const zusammen = {};

  for (const teil of items) {
    const gespeichert = saved?.[teil.id];
    zusammen[teil.id] = gespeichert ? clampPosition(gespeichert) : grund[teil.id];
  }

  return zusammen;
}

/** Ob überhaupt schon einmal etwas angeordnet wurde. */
export const hasLayout = (outfit) => Boolean(outfit?.layout && Object.keys(outfit.layout).length);

/**
 * Die Teile in Zeichenreihenfolge, jeweils mit ihrer Stelle.
 *
 * @returns {Array<{item:object, position:{x:number,y:number,scale:number}, z:number}>}
 */
export function placedItems(items, layout) {
  const stellen = mergeLayout(layout, items);

  return [...items]
    .sort((a, b) => stackIndex(a.slot) - stackIndex(b.slot))
    .map((item, index) => ({ item, position: stellen[item.id], z: index + 1 }));
}

/** Alle Fächer, die eine eigene Grundstelle haben -- für Tests und Anzeige. */
export const arrangedSlots = () => SLOTS.map((slot) => slot.id).filter((id) => DEFAULT_POSITIONS[id]);
