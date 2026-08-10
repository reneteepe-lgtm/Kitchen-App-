/**
 * Wie lange hält sich das ungefähr?
 *
 * Bei zwanzig Artikeln je Lieferung ist es Arbeit, jedes Mindesthaltbarkeits-
 * datum abzutippen -- und dann bleibt das Feld eben leer, und die
 * Ablauf-Warnung, für die es gebaut wurde, läuft ins Leere. Ein geschätztes
 * Datum ist besser als gar keins: Für die Frage "was sollte ich zuerst
 * aufbrauchen?" reicht eine grobe Ordnung völlig.
 *
 * Geschätzt wird aus drei Quellen, in dieser Reihenfolge:
 *
 *  1. **Was für dieses Produkt gelernt wurde.** Wer beim Joghurt einmal ein
 *     echtes Datum einträgt, legt damit fest, wie lange er sich hält --
 *     beim nächsten Kauf gilt das statt jeder Faustregel.
 *  2. **Ein Stichwort im Namen.** "H-Milch" hält Monate, "frische Vollmilch"
 *     eine Woche. Beide stehen im selben Fach, deshalb genügt das Fach hier
 *     nicht.
 *  3. **Das Fach.** Konserven Jahre, Tiefkühl Monate, Obst und Gemüse Tage.
 *
 * Ein geschätztes Datum wird als solches gekennzeichnet (`estimated`) und ist
 * jederzeit überschreibbar. Es soll nie so aussehen, als stünde es auf der
 * Packung.
 */

import { normalize } from './search.js';

/** Haltbarkeit ab Kauf in Tagen, je Fach. `null` heißt: nicht schätzen. */
export const CATEGORY_SHELF_LIFE = {
  pasta: 540,
  potato: 60,
  sauce: 540,
  spice: 730,
  baking: 365,
  breakfast: 90,
  dairy: 14,
  meat: 5,
  produce: 7,
  frozen: 180,
  drinks: 270,
  // Alufolie und Spülmittel haben kein Datum, das jemanden interessiert.
  household: null,
  other: null,
};

/**
 * Stichwörter, die das Fach überstimmen.
 *
 * Getroffen wird, wenn ein Wort des Namens mit dem Stamm anfängt oder aufhört
 * -- wie bei den Fächern, damit "Vollmilch" und "H-Milch" beide greifen. Die
 * Liste steht nach Länge sortiert im Zugriff: Der genauere Treffer gewinnt,
 * sonst machte "milch" die "h-milch" wieder zunichte.
 */
export const KEYWORD_SHELF_LIFE = [
  // Lange haltbar, obwohl es im Kühlregal steht.
  // "H-Milch" wird beim Vereinheitlichen zu zwei Wörtern -- deshalb steht
  // hier die Wortfolge, nicht ein Stamm.
  ['h milch', 365], ['haltbare', 180], ['kondensmilch', 365], ['hartkaese', 60],
  ['parmesan', 90], ['bergkaese', 60],
  // Konserviertes, das oft im Namen gar nicht danach klingt
  ['bouillon', 540], ['bruehe', 540], ['fond', 540], ['brueh', 540],
  // Kühlschrank, nach Verderblichkeit
  ['frischmilch', 8], ['vollmilch', 8], ['rohmilch', 4],
  ['joghurt', 18], ['jogurt', 18], ['skyr', 18], ['quark', 18], ['kefir', 14],
  ['schmand', 21], ['creme fraiche', 21], ['sahne', 14], ['schlagsahne', 14],
  ['frischkaese', 21], ['mozzarella', 21], ['feta', 45], ['gouda', 30],
  ['butter', 40], ['margarine', 60], ['eier', 21],
  // Fleisch und Fisch
  ['hackfleisch', 2], ['hack', 2], ['gehacktes', 2],
  ['fisch', 3], ['lachs', 4], ['garnele', 3], ['raeucherlachs', 10],
  ['wurst', 8], ['salami', 40], ['schinken', 12], ['speck', 30],
  ['haehnchen', 3], ['pute', 3], ['rind', 4], ['schwein', 4], ['steak', 4],
  // Obst und Gemüse, sehr unterschiedlich
  ['beere', 3], ['beeren', 3], ['himbeere', 3], ['erdbeere', 3],
  ['salat', 4], ['rucola', 4], ['spinat', 4],
  ['dill', 5], ['petersilie', 5], ['basilikum', 6], ['schnittlauch', 5],
  ['banane', 5], ['avocado', 5], ['pilz', 5], ['champignon', 5],
  ['brokkoli', 7], ['zucchini', 8], ['gurke', 8], ['tomate', 8],
  ['paprika', 10], ['moehre', 21], ['karotte', 21], ['kohl', 21],
  ['apfel', 21], ['orange', 14], ['zitrone', 21],
  ['zwiebel', 45], ['knoblauch', 60], ['kartoffel', 45], ['kuerbis', 45],
  // Trockenes und Konserven
  ['dose', 730], ['konserve', 730], ['glas', 540],
  ['brot', 5], ['broetchen', 3], ['toast', 12], ['baguette', 3],
  ['mehl', 365], ['zucker', 730], ['salz', 1825], ['reis', 730],
  ['nudel', 540], ['pasta', 540], ['oel', 365], ['essig', 730],
  ['kaffee', 270], ['tee', 540], ['honig', 1095],
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nach Länge sortiert: Der genauere Stamm gewinnt. */
const SORTED_KEYWORDS = [...KEYWORD_SHELF_LIFE].sort((a, b) => b[0].length - a[0].length);

/**
 * Haltbarkeit in Tagen für Marke und Bezeichnung -- oder null.
 *
 * @param {string} text      Marke und Bezeichnung zusammen
 * @param {string|null} categoryId
 * @returns {number|null}
 */
export function shelfLifeDays(text, categoryId) {
  const line = normalize(text);
  const words = line.split(' ').filter(Boolean);

  /*
   * Alle Treffer sammeln und den besten nehmen -- nicht den ersten.
   *
   * Entscheidend ist der Rang: In einem deutschen Wort steht hinten, worum
   * es geht. "Kartoffelsalat" ist ein Salat und hält vier Tage, keine
   * Kartoffel mit sechs Wochen. Ein Stamm am Wortende schlägt deshalb einen
   * am Wortanfang, und erst bei gleichem Rang zählt die Länge.
   */
  let best = null;
  for (const [stem, days] of SORTED_KEYWORDS) {
    let rank = 0;
    if (stem.includes(' ')) {
      // Eine Wortfolge: "H-Milch" wird zu "h milch" und ist kein Wort mehr.
      if (` ${line} `.includes(` ${stem} `)) rank = 4;
    } else if (words.includes(stem)) {
      rank = 3;
    } else if (stem.length < 5) {
      // Kurze Stämme nur als ganzes Wort: "Brei" endet sonst auf "ei",
      // und aus Milchbrei würde ein Ei mit drei Wochen Haltbarkeit.
      rank = 0;
    } else if (words.some((word) => word.endsWith(stem))) {
      rank = 2;
    } else if (words.some((word) => word.startsWith(stem))) {
      rank = 1;
    }
    if (rank && (!best || rank > best.rank)) best = { rank, days };
  }
  if (best) return best.days;
  const fromCategory = CATEGORY_SHELF_LIFE[categoryId];
  return fromCategory ?? null;
}

/**
 * Das geschätzte Mindesthaltbarkeitsdatum als "2026-08-19".
 *
 * @param {object} input
 * @param {string} [input.text]        Marke und Bezeichnung
 * @param {string} [input.categoryId]
 * @param {number} [input.learned]     Für dieses Produkt gelernte Tage
 * @param {Date|string} [input.from]   Kaufdatum, sonst heute
 * @returns {string|null}
 */
export function estimateBestBefore({ text = '', categoryId = null, learned = null, from = new Date() } = {}) {
  const days = Number(learned) > 0 ? Number(learned) : shelfLifeDays(text, categoryId);
  if (!(days > 0)) return null;

  const start = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(start.getTime())) return null;

  const date = new Date(start.getTime() + days * DAY_MS);
  // Auf den lokalen Tag runden, nicht auf UTC: Sonst springt das Datum je
  // nach Uhrzeit um einen Tag.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * Was aus einem selbst eingetragenen Datum zu lernen ist.
 *
 * Aus Kaufdatum und Haltbarkeitsdatum ergibt sich, wie lange dieses Produkt
 * hält. Unsinnige Abstände werden verworfen -- ein Datum in der
 * Vergangenheit ist ein Vertipper oder eine Restposten-Packung, und beides
 * taugt nicht als Regel für den nächsten Kauf.
 *
 * @returns {number|null} Tage, oder null wenn daraus nichts zu lernen ist
 */
export function learnShelfLife(bestBefore, purchasedAt = new Date()) {
  if (!bestBefore) return null;
  const end = new Date(bestBefore);
  const start = purchasedAt instanceof Date ? purchasedAt : new Date(purchasedAt);
  if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) return null;

  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days < 1 || days > 1825) return null;
  return days;
}
