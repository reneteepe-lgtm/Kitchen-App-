/**
 * Suche im Vorrat.
 *
 * Gesucht wird typischerweise im Laden, mit einer Hand, in Eile -- und
 * selten mit genau der Schreibweise, unter der etwas erfasst wurde. Wer
 * "jogurt" tippt, meint den "Joghurt natur 500 g", und wer "creme fraiche"
 * eingibt, soll die "Crème fraîche" finden.
 *
 * Deshalb wird in drei Stufen gesucht, von genau nach großzügig, und das
 * Ergebnis danach sortiert. Eine unscharfe Suche gibt es erst ab vier
 * Zeichen: Bei "ei" wäre sonst alles ein Treffer.
 */

/**
 * Vereinheitlicht Schreibweisen: Groß/Klein, Umlaute, Akzente,
 * Satzzeichen. "Crème fraîche" und "creme fraiche" werden damit gleich,
 * ebenso "Müsli" und "Muesli".
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

/**
 * Levenshtein-Abstand mit Obergrenze.
 *
 * Sobald feststeht, dass der Abstand größer als `max` ist, wird abgebrochen
 * -- die Suche läuft bei jedem Tastendruck über den ganzen Vorrat.
 */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > max) return max + 1;
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/**
 * Abschlag für Treffer in der Marke statt in der Bezeichnung. Gerade so
 * viel, dass ein gleich guter Namenstreffer vorne steht.
 */
const BRAND_WEIGHT = 0.9;

/** Wie viele Zeichen dürfen bei dieser Suchlänge danebenliegen? */
function tolerance(query) {
  if (query.length < 4) return 0;
  return query.length <= 6 ? 1 : 2;
}

/**
 * Bewertet, wie gut ein Name zur Suche passt.
 * @returns {number|null} 0..1, oder null wenn es kein Treffer ist
 */
export function scoreMatch(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (!q) return null;

  if (n === q) return 1;
  if (n.startsWith(q)) return 0.95;

  const words = n.split(' ');
  // Ein Wort im Namen beginnt mit der Eingabe: "fusilli" findet
  // "Barilla Fusilli 500 g".
  if (words.some((word) => word.startsWith(q))) return 0.85;
  if (n.includes(q)) return 0.7;

  // Unscharf: gegen den ganzen Namen und gegen jedes einzelne Wort.
  const max = tolerance(q);
  if (max === 0) return null;

  let best = Infinity;
  for (const candidate of [n, ...words]) {
    // Nur ähnlich lange Wörter vergleichen, sonst gilt "reis" als "brei".
    if (Math.abs(candidate.length - q.length) > max) continue;
    const distance = editDistance(q, candidate, max);
    if (distance < best) best = distance;
  }
  if (best > max) return null;
  return Math.max(0.3, 0.65 - best * 0.15);
}

/**
 * Durchsucht den Vorrat.
 *
 * @param {Array} products
 * @param {string} query
 * @param {(product:object) => number} stockOf  Bestand zu einem Produkt
 * @returns {Array<{product:object, stock:number, score:number}>}
 */
export function searchProducts(products, query, stockOf) {
  const q = normalize(query);
  if (!q) return [];

  const matches = [];
  for (const product of products) {
    let score;
    if (product.barcode && product.barcode === query.trim()) {
      // Ein eingetippter Barcode zählt als voller Treffer.
      score = 1;
    } else {
      // Auch die Marke ist suchbar -- "baresa" soll die Passata finden.
      // Sie zählt aber etwas weniger: Wer "Passata" eingibt, meint das
      // Produkt und nicht die Firma, die zufällig so heißt.
      const byName = scoreMatch(query, product.name);
      const brandHit = product.brand ? scoreMatch(query, product.brand) : null;
      const byBrand = brandHit === null ? null : brandHit * BRAND_WEIGHT;
      score = byName === null ? byBrand : byBrand === null ? byName : Math.max(byName, byBrand);
    }
    if (score === null) continue;
    matches.push({ product, stock: stockOf(product), score });
  }

  return matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Bei gleicher Passung zuerst zeigen, was tatsächlich da ist.
    if ((b.stock > 0) !== (a.stock > 0)) return b.stock > 0 ? 1 : -1;
    return a.product.name.localeCompare(b.product.name, 'de');
  });
}

/**
 * Die eigentliche Frage im Laden: Habe ich das noch?
 *
 * @param {Array} matches Ergebnis von `searchProducts`
 * @returns {{kind:'have'|'empty'|'unknown', product?:object, stock:number}}
 */
export function stockAnswer(matches) {
  if (!matches.length) return { kind: 'unknown', stock: 0 };

  const available = matches.find((m) => m.stock > 0);
  if (available) return { kind: 'have', product: available.product, stock: available.stock };

  // Bekannt, aber gerade nichts davon da -- ein wichtiger Unterschied zu
  // "kennt die App gar nicht".
  return { kind: 'empty', product: matches[0].product, stock: 0 };
}
