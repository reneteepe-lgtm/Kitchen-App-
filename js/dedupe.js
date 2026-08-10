/**
 * Erkennt, wann zwei Einträge dasselbe Produkt meinen.
 *
 * Dasselbe Produkt kommt auf zwei Wegen in den Vorrat, und beide schreiben
 * es anders:
 *
 *     gescannt:  Marke "Gut & Günstig"  Name "Frischkäse Natur 300g"
 *     vom Bon:   Marke "Gut&Günstig"    Name "Frischkäse Natur 300 g"
 *
 * Für das Auge dasselbe, für einen Zeichenvergleich zwei Dinge. Die Suche
 * hilft hier nicht weiter: Die ist fürs Tippen gebaut -- sie verzeiht
 * Tippfehler in einem kurzen Suchwort, nicht abweichende Schreibweisen in
 * einem langen Namen.
 *
 * Stattdessen bekommt jedes Produkt einen Schlüssel aus seinen Wörtern:
 * vereinheitlicht, Zahl und Einheit getrennt ("300g" wird zu "300 g"),
 * Füllwörter weg, sortiert. Stimmen zwei Schlüssel überein, ist es dasselbe.
 *
 * Der Schlüssel ist bewusst streng. Die Größe bleibt darin, damit
 * "Frischkäse 300 g" und "Frischkäse 150 g" zwei Dinge bleiben -- das sind
 * sie im Schrank auch. Lieber ein Doppel übersehen als zwei verschiedene
 * Sachen zusammenwerfen: Ersteres sieht man und kann es beheben, Letzteres
 * verdirbt stillschweigend den Bestand.
 */

import { normalize } from './search.js';

/** Wörter, die nichts unterscheiden. "Gut&Günstig" und "Gut und Günstig". */
const FILLER = new Set(['und', 'u', 'the', 'and', 'de', 'di']);

/** Schreibweisen derselben Einheit. */
const UNITS = new Map([
  ['gr', 'g'],
  ['gramm', 'g'],
  ['kilo', 'kg'],
  ['kilogramm', 'kg'],
  ['liter', 'l'],
  ['ltr', 'l'],
  ['milliliter', 'ml'],
  ['stk', 'stueck'],
  ['st', 'stueck'],
  ['pck', 'packung'],
  ['pkg', 'packung'],
]);

/**
 * Zerlegt Marke und Bezeichnung in vergleichbare Wörter.
 *
 * Der Schritt, auf den es ankommt: Zwischen Zahl und Buchstabe kommt ein
 * Leerzeichen. Ohne ihn wären "300g" und "300 g" verschiedene Wörter, und
 * genau daran scheitert der Vergleich sonst.
 */
export function productTokens(text) {
  const spaced = String(text ?? '')
    .replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, '$1 $2')
    .replace(/([a-zA-ZäöüÄÖÜß])(\d)/g, '$1 $2');

  return normalize(spaced)
    .split(' ')
    .filter(Boolean)
    .map((word) => UNITS.get(word) ?? word)
    .filter((word) => !FILLER.has(word));
}

/**
 * Der Schlüssel eines Produkts.
 *
 * Sortiert und ohne Wiederholungen: Die Reihenfolge der Wörter unterscheidet
 * nicht -- "Frischkäse Natur" und "Natur Frischkäse" sind dasselbe.
 *
 * @param {{brand?:string, name?:string}} product
 */
export function productKey(product) {
  const words = productTokens(`${product?.brand ?? ''} ${product?.name ?? ''}`);
  return [...new Set(words)].sort().join(' ');
}

/** Ob zwei Einträge dasselbe Produkt meinen. */
export function sameProduct(a, b) {
  const key = productKey(a);
  return key !== '' && key === productKey(b);
}

/**
 * Sucht im Vorrat das Produkt, das dasselbe meint.
 *
 * @param {Array} products
 * @param {{brand?:string, name?:string}} candidate
 * @param {(p:object) => boolean} [accept]  zusätzliche Bedingung
 */
export function findTwin(products, candidate, accept = () => true) {
  const key = productKey(candidate);
  if (!key) return undefined;
  return (products ?? []).find((product) => accept(product) && productKey(product) === key);
}

/**
 * Gruppen von Produkten, die dasselbe meinen.
 *
 * Innerhalb einer Gruppe steht vorn, was bleiben sollte: Ein Produkt mit
 * Barcode ist die bessere Kennung -- es lässt sich wiederfinden, indem man
 * die Packung noch einmal scannt. Danach zählt das Alter, damit die längere
 * Geschichte erhalten bleibt.
 *
 * @returns {Array<Array<object>>} nur Gruppen ab zwei Einträgen
 */
export function duplicateGroups(products) {
  const byKey = new Map();
  for (const product of products ?? []) {
    const key = productKey(product);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(product);
  }

  const groups = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    groups.push(
      [...group].sort((a, b) => {
        const barcode = Number(Boolean(b.barcode)) - Number(Boolean(a.barcode));
        if (barcode) return barcode;
        return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
      }),
    );
  }
  return groups;
}

/**
 * Was der bleibende Eintrag von den anderen übernimmt.
 *
 * Nichts wird dabei überschrieben -- ergänzt wird nur, wo etwas fehlt. Der
 * Mindestbestand ist die Ausnahme: Dort gilt der höhere, sonst schlüge die
 * Zusammenführung stillschweigend eine Warnschwelle nieder.
 */
export function mergedProduct(keep, others) {
  const merged = { ...keep };
  for (const other of others ?? []) {
    if (!merged.barcode && other.barcode) merged.barcode = other.barcode;
    if (!String(merged.brand ?? '').trim() && other.brand) merged.brand = other.brand;
    if (!String(merged.note ?? '').trim() && other.note) merged.note = other.note;
    if (!merged.category && other.category) merged.category = other.category;
    merged.minStock = Math.max(Number(merged.minStock) || 0, Number(other.minStock) || 0);
    // Ein einmal abgelehnter Vorschlag bleibt abgelehnt.
    if (other.suggest === false) merged.suggest = false;
    // Das ältere Anlegedatum gewinnt: Die Prognose rechnet mit dem Zeitraum,
    // über den beobachtet wurde.
    if (String(other.createdAt ?? '') && String(other.createdAt) < String(merged.createdAt ?? '')) {
      merged.createdAt = other.createdAt;
    }
  }
  return merged;
}
