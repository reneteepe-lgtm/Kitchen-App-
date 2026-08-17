/**
 * Schreibweisen vereinheitlichen.
 *
 * Kleidung wird erfasst, wie sie gerade heißt: mal "Sweatshirt", mal
 * "Sweat-Shirt", mal "Pullover grün", mal "Pulli gruen". Damit die
 * automatische Einordnung und die Suche darüber nicht stolpern, läuft jeder
 * Name zuerst durch `normalize`.
 */

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    // Akzente abtrennen und verwerfen (é -> e).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Die einzelnen Wörter eines Namens, schon vereinheitlicht. */
export const words = (text) => normalize(text).split(' ').filter(Boolean);

/**
 * Trifft ein Wortstamm irgendwo im Namen?
 *
 * Getroffen wird, wenn ein Wort mit dem Stamm anfängt oder aufhört --
 * deutsche Zusammensetzungen wie "Wollpullover" oder "Regenjacke" liefen
 * sonst ins Leere.
 */
export function hasStem(name, stem) {
  return words(name).some((word) => word.startsWith(stem) || word.endsWith(stem));
}

/**
 * Sucht in Kleidungsstücken -- über Bezeichnung und Marke.
 *
 * Bewusst einfacher als die Suche in der Küchen-App: Vor dem Schrank steht
 * man in Ruhe und mit beiden Händen, und ein Schrank hat selten mehr als
 * ein paar Hundert Teile. Ein Präfix-Treffer genügt.
 *
 * @returns {number|null} 0..1, oder null wenn es kein Treffer ist
 */
export function scoreMatch(query, item) {
  const q = normalize(query);
  if (!q) return null;

  const name = normalize(item.name);
  const brand = normalize(item.brand);

  if (name === q) return 1;
  if (name.startsWith(q)) return 0.9;
  if (words(name).some((word) => word.startsWith(q))) return 0.8;
  if (name.includes(q)) return 0.6;
  if (brand.startsWith(q)) return 0.5;
  if (brand.includes(q)) return 0.4;
  return null;
}

export function searchItems(query, items) {
  return items
    .map((item) => ({ item, score: scoreMatch(query, item) }))
    .filter((hit) => hit.score !== null)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'de'))
    .map((hit) => hit.item);
}
