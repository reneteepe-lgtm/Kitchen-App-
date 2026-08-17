/**
 * Was für ein Teil ist das?
 *
 * Beim Erfassen soll niemand Kategorie, Wärme und Anlass aus Auswahlmenüs
 * zusammenklicken -- nach dem dritten Kleidungsstück hört man damit auf, und
 * ein halb erfasster Schrank kann nichts vorschlagen. Deshalb wird alles,
 * was sich aus dem Namen ablesen lässt, aus dem Namen abgelesen:
 *
 *  - **Fach** ("Oberteile", "Schuhe"), damit ein Outfit weiß, wovon es
 *    genau eins braucht.
 *  - **Wärme** von 0 bis 5, damit das Wetter mitreden kann.
 *  - **Anlass** von 0 bis 4, damit die Jogginghose nicht zum Termin
 *    vorgeschlagen wird.
 *  - **Farbe**, damit Kombinationen sich nicht beißen.
 *
 * Jede dieser Angaben ist von Hand überschreibbar; was einmal von Hand
 * gesetzt wurde, wird nie wieder überstimmt.
 */

import { normalize, words } from './text.js';

/**
 * Die Fächer, in der Reihenfolge, in der ein Outfit angezogen wird --
 * von innen nach außen, von oben nach unten. In genau dieser Reihenfolge
 * werden sie auch angezeigt.
 */
export const SLOTS = [
  {
    id: 'top',
    label: 'Oberteile',
    one: 'Oberteil',
    icon: '👕',
    keywords: [
      'shirt', 'tshirt', 't-shirt', 'longsleeve', 'top', 'tanktop', 'bluse', 'hemd',
      'poloshirt', 'polo', 'pullover', 'pulli', 'sweatshirt', 'sweater', 'hoodie',
      'kapuzenpullover', 'strickjacke', 'cardigan', 'rollkragen', 'weste', 'body',
    ],
  },
  {
    id: 'bottom',
    label: 'Hosen & Röcke',
    one: 'Hose',
    icon: '👖',
    keywords: [
      'hose', 'jeans', 'chino', 'chinos', 'jogginghose', 'sweatpants', 'leggings',
      'shorts', 'bermuda', 'rock', 'minirock', 'cargohose', 'anzughose', 'stoffhose',
    ],
  },
  {
    id: 'dress',
    label: 'Kleider & Einteiler',
    one: 'Kleid',
    icon: '👗',
    /**
     * Ein Kleid ersetzt Oberteil und Hose zugleich -- deshalb ist es ein
     * eigenes Fach und nicht bloß ein besonderes Oberteil. Der Vorschlag
     * baut daraus einen zweiten, gleichwertigen Bauplan.
     */
    keywords: ['kleid', 'sommerkleid', 'abendkleid', 'jumpsuit', 'overall', 'anzug', 'suit'],
  },
  {
    id: 'outer',
    label: 'Jacken & Mäntel',
    one: 'Jacke',
    icon: '🧥',
    keywords: [
      'jacke', 'mantel', 'parka', 'anorak', 'blazer', 'sakko', 'daunenjacke',
      'regenjacke', 'windbreaker', 'steppjacke', 'trenchcoat', 'lederjacke', 'poncho',
    ],
  },
  {
    id: 'shoes',
    label: 'Schuhe',
    one: 'Schuh',
    icon: '👟',
    keywords: [
      'schuh', 'schuhe', 'sneaker', 'turnschuh', 'stiefel', 'boots', 'bootie',
      'halbschuh', 'sandale', 'sandalen', 'pumps', 'ballerina', 'loafer', 'slipper',
      'chelsea', 'gummistiefel', 'flipflop',
    ],
    /**
     * Marken, die für nichts anderes stehen als für die Ware selbst.
     * "Air Force 1" enthält kein einziges Wort, das nach Schuh klingt.
     */
    markers: ['birkenstock', 'doc martens', 'air force', 'air max', 'converse', 'vans'],
  },
  {
    id: 'headwear',
    label: 'Mützen & Caps',
    one: 'Kopfbedeckung',
    icon: '🧢',
    keywords: ['cap', 'basecap', 'muetze', 'beanie', 'hut', 'kappe', 'stirnband', 'bandana'],
  },
  {
    id: 'accessory',
    label: 'Accessoires',
    one: 'Accessoire',
    icon: '⌚',
    keywords: [
      'uhr', 'armbanduhr', 'guertel', 'schal', 'tuch', 'handschuh', 'handschuhe',
      'tasche', 'rucksack', 'brille', 'sonnenbrille', 'kette', 'ring', 'armband',
      'socken', 'strumpf', 'krawatte', 'fliege',
    ],
  },
];

export const FALLBACK_SLOT = 'accessory';

export const slotById = (id) => SLOTS.find((slot) => slot.id === id);
export const slotLabel = (id) => slotById(id)?.label ?? 'Sonstiges';

/**
 * Rät das Fach allein aus dem Namen.
 *
 * Die Feinheit steckt in der Bewertung: Deutsche Zusammensetzungen tragen
 * ihre Bedeutung hinten. Eine "Jeansjacke" ist eine Jacke, keine Jeans; ein
 * "Wollpullover" ein Pullover, keine Wolle. Ein Stichwort, das am Ende
 * eines Wortes sitzt, schlägt deshalb jedes, das vorne oder mittendrin
 * sitzt -- und erst danach entscheidet die Länge.
 */
export function guessSlot(name) {
  const text = normalize(name);
  const parts = words(name);
  let best = { id: null, score: 0 };

  for (const slot of SLOTS) {
    // Marken sind eindeutig und stehen über allem, was der Name sonst hergibt.
    if (slot.markers?.some((marker) => text.includes(normalize(marker)))) {
      return slot.id;
    }

    for (const stem of slot.keywords) {
      const needle = normalize(stem);
      for (const word of parts) {
        let score = 0;
        if (word.endsWith(needle)) score = 200 + needle.length;
        else if (word.startsWith(needle)) score = 100 + needle.length;
        else if (word.includes(needle)) score = needle.length;
        if (score > best.score) best = { id: slot.id, score };
      }
    }
  }

  return best.id ?? FALLBACK_SLOT;
}

// --- Wärme ---------------------------------------------------------------

/**
 * Wie warm hält das Teil? 0 = luftig, 5 = tiefster Winter.
 *
 * Die Skala ist grob mit Absicht. Sie muss nur eine Frage beantworten:
 * Passt das zu heute? Ob ein Pullover 3 oder 3,5 ist, merkt beim Anziehen
 * niemand.
 */
export const WARMTH_BY_SLOT = {
  top: 2,
  bottom: 2,
  dress: 2,
  outer: 4,
  shoes: 2,
  headwear: 3,
  accessory: 1,
};

/** `[Stamm, Wärme]` -- das Kleidungsstück selbst. Das längste Wort gewinnt. */
export const WARMTH_KEYWORDS = [
  ['tanktop', 0], ['top', 0], ['shorts', 0], ['bermuda', 0], ['sandale', 0],
  ['sandalen', 0], ['flipflop', 0], ['bikini', 0], ['sommerkleid', 0],
  ['tshirt', 1], ['shirt', 1], ['polo', 1], ['bluse', 1],
  ['rock', 1], ['ballerina', 1], ['sneaker', 2], ['halbschuh', 2],
  ['hemd', 2], ['longsleeve', 2], ['chino', 2], ['jeans', 2], ['loafer', 2],
  ['sweatshirt', 3], ['hoodie', 3], ['pullover', 3], ['pulli', 3],
  ['strickjacke', 3], ['cardigan', 3], ['jogginghose', 3], ['blazer', 2],
  ['stiefel', 3], ['boots', 3],
  ['jacke', 4], ['lederjacke', 3], ['regenjacke', 3], ['windbreaker', 2],
  ['mantel', 5], ['parka', 5], ['wintermantel', 5], ['steppjacke', 4],
  ['beanie', 4], ['muetze', 4], ['handschuh', 4], ['schal', 4], ['cap', 1],
];

/**
 * Das Material -- und warum es nicht in derselben Liste steht.
 *
 * Ein Stoff *ist* kein Kleidungsstück, er verändert eines. Stünde "woll"
 * einfach zwischen den anderen Stichwörtern, entschiede die Wortlänge, und
 * ein "Wollpullover" wäre so warm wie jeder Pullover -- "pullover" ist
 * nun einmal das längere Wort. Material wirkt deshalb als Grenze:
 *
 *  - `mindestens` zieht nach oben. Ein Wollpullover ist wärmer als ein
 *    Pullover, ein Wollmantel aber nicht kälter als ein Mantel.
 *  - `hoechstens` zieht nach unten: Ein Leinenhemd ist kühler als ein Hemd.
 *
 * `[Stamm, Wert, Richtung]`
 */
export const WARMTH_MATERIALS = [
  ['daune', 5, 'mindestens'],
  ['thermo', 5, 'mindestens'],
  ['gefuettert', 4, 'mindestens'],
  ['woll', 4, 'mindestens'],
  ['strick', 3, 'mindestens'],
  ['fleece', 3, 'mindestens'],
  ['flanell', 3, 'mindestens'],
  ['leinen', 1, 'hoechstens'],
  ['seide', 1, 'hoechstens'],
  ['viskose', 1, 'hoechstens'],
];

export function guessWarmth(name, slot = guessSlot(name)) {
  const parts = words(name);

  let found = null;
  for (const [stem, value] of WARMTH_KEYWORDS) {
    const needle = normalize(stem);
    if (parts.some((word) => word.includes(needle))) {
      if (!found || needle.length > found.length) found = { value, length: needle.length };
    }
  }

  let warmth = found ? found.value : (WARMTH_BY_SLOT[slot] ?? 2);

  for (const [stem, value, richtung] of WARMTH_MATERIALS) {
    const needle = normalize(stem);
    if (!parts.some((word) => word.includes(needle))) continue;
    warmth = richtung === 'mindestens' ? Math.max(warmth, value) : Math.min(warmth, value);
  }

  return warmth;
}

// --- Anlass --------------------------------------------------------------

/**
 * Wie schick ist das Teil? 0 = Sofa und Sport, 4 = festlich.
 *
 * Gemessen wird nicht der Preis, sondern wo man damit hinkommt.
 */
export const FORMALITY_LEVELS = [
  { value: 0, label: 'Sport & zu Hause' },
  { value: 1, label: 'Leger' },
  { value: 2, label: 'Alltag' },
  { value: 3, label: 'Schick' },
  { value: 4, label: 'Festlich' },
];

export const formalityLabel = (value) =>
  FORMALITY_LEVELS.find((level) => level.value === Math.round(value))?.label ?? 'Alltag';

export const FORMALITY_KEYWORDS = [
  ['jogginghose', 0], ['sweatpants', 0], ['trainingshose', 0], ['sporthose', 0],
  ['laufschuh', 0], ['turnschuh', 0], ['fleece', 0], ['schlabber', 0],
  ['hoodie', 1], ['kapuzen', 1], ['sweatshirt', 1], ['tshirt', 1], ['shirt', 1],
  ['sneaker', 1], ['jeans', 1], ['shorts', 1], ['cap', 1], ['beanie', 1],
  ['parka', 1], ['lederjacke', 1], ['flipflop', 0],
  ['chino', 2], ['pullover', 2], ['strickjacke', 2], ['bluse', 2], ['rock', 2],
  ['kleid', 2], ['mantel', 2], ['stiefel', 2], ['boots', 2], ['loafer', 2],
  ['hemd', 3], ['blazer', 3], ['sakko', 3], ['anzughose', 3], ['stoffhose', 3],
  ['pumps', 3], ['halbschuh', 3], ['trenchcoat', 3], ['seide', 3],
  ['anzug', 4], ['abendkleid', 4], ['smoking', 4], ['krawatte', 4], ['fliege', 4],
];

export function guessFormality(name) {
  const parts = words(name);
  let found = null;
  for (const [stem, value] of FORMALITY_KEYWORDS) {
    const needle = normalize(stem);
    if (parts.some((word) => word.includes(needle))) {
      if (!found || needle.length > found.length) found = { value, length: needle.length };
    }
  }
  return found ? found.value : 2;
}

// --- Farben --------------------------------------------------------------

/**
 * Die Farben, die im Namen erkannt werden.
 *
 * `neutral` heißt: passt zu allem. Schwarz, Weiß, Grau, Beige, Marine und
 * Denim sind der Grund, warum die meisten Schränke funktionieren -- sie
 * zählen bei der Farbharmonie nicht als Farbe mit, sondern als Grundlage.
 *
 * `hex` ist nur für die Anzeige da: Ohne Foto bekommt ein Teil eine Kachel
 * in seiner Farbe, damit man es im Schrank trotzdem wiedererkennt.
 */
export const COLORS = [
  { id: 'schwarz', label: 'Schwarz', hex: '#1c1c1c', neutral: true, stems: ['schwarz', 'black'] },
  { id: 'weiss', label: 'Weiß', hex: '#f4f4f2', neutral: true, stems: ['weiss', 'white', 'creme', 'ecru', 'offwhite'] },
  { id: 'grau', label: 'Grau', hex: '#8d8d8a', neutral: true, stems: ['grau', 'grey', 'gray', 'anthrazit'] },
  { id: 'beige', label: 'Beige', hex: '#d6c7ac', neutral: true, stems: ['beige', 'sand', 'khaki', 'camel', 'taupe'] },
  { id: 'braun', label: 'Braun', hex: '#7a5638', neutral: true, stems: ['braun', 'brown', 'cognac', 'rehbraun'] },
  { id: 'navy', label: 'Marine', hex: '#26344d', neutral: true, stems: ['navy', 'marine', 'dunkelblau'] },
  { id: 'denim', label: 'Denim', hex: '#5b7ba3', neutral: true, stems: ['denim', 'jeansblau'] },
  { id: 'blau', label: 'Blau', hex: '#3a6ea5', neutral: false, stems: ['blau', 'blue', 'hellblau'] },
  { id: 'gruen', label: 'Grün', hex: '#3f6b46', neutral: false, stems: ['gruen', 'green', 'oliv', 'olive'] },
  { id: 'rot', label: 'Rot', hex: '#a33b32', neutral: false, stems: ['rot', 'red', 'bordeaux', 'weinrot'] },
  { id: 'rosa', label: 'Rosa', hex: '#d29aa8', neutral: false, stems: ['rosa', 'pink', 'altrosa'] },
  { id: 'lila', label: 'Lila', hex: '#6e5387', neutral: false, stems: ['lila', 'violett', 'flieder'] },
  { id: 'gelb', label: 'Gelb', hex: '#d8b13f', neutral: false, stems: ['gelb', 'yellow', 'senf'] },
  { id: 'orange', label: 'Orange', hex: '#c9713a', neutral: false, stems: ['orange', 'rost', 'terrakotta'] },
  { id: 'bunt', label: 'Gemustert', hex: '#9a8fb0', neutral: false, stems: ['bunt', 'gemustert', 'gebluemt', 'floral', 'kariert', 'gestreift', 'muster'] },
];

export const colorById = (id) => COLORS.find((color) => color.id === id);
export const isNeutral = (id) => colorById(id)?.neutral ?? false;

/**
 * Alle Farben, die im Namen vorkommen -- meist genau eine, manchmal keine.
 *
 * Geprüft wird an Wortgrenzen, nicht irgendwo im Text. Der Grund ist ein
 * Fehler, den man erst sieht, wenn er auftritt: "geblümt" wird beim
 * Vereinheitlichen zu "gebluemt", und darin steckt "blue" -- ein geblümtes
 * Kleid wäre sonst blau.
 *
 * Je Wort zählt nur die genaueste Farbe: "dunkelblau" ist Marine und nicht
 * zusätzlich noch Blau.
 */
export function guessColors(name) {
  const found = [];

  for (const word of words(name)) {
    let best = null;
    for (const color of COLORS) {
      for (const stem of color.stems) {
        const needle = normalize(stem);
        if (!word.startsWith(needle) && !word.endsWith(needle)) continue;
        if (!best || needle.length > best.length) best = { id: color.id, length: needle.length };
      }
    }
    if (best && !found.includes(best.id)) found.push(best.id);
  }

  return found;
}

/**
 * Hält das Teil Regen ab?
 *
 * Nur wenige Sachen tun das wirklich, und im Zweifel lieber nein: Ein
 * falsches Ja schickt jemanden ohne Schutz los.
 */
export const WATERPROOF_STEMS = [
  'regen', 'gore', 'goretex', 'wasserdicht', 'wasserabweisend', 'gummistiefel',
  'anorak', 'windbreaker', 'trenchcoat', 'parka', 'oelzeug',
];

export function guessWaterproof(name) {
  const text = normalize(name);
  return WATERPROOF_STEMS.some((stem) => text.includes(normalize(stem)));
}

/**
 * Alles, was sich aus einem Namen herauslesen lässt, auf einmal.
 *
 * Was der Mensch schon selbst gesagt hat, bleibt unangetastet -- deshalb
 * werden nur fehlende Angaben ergänzt.
 */
export function guessAttributes(name, given = {}) {
  const slot = given.slot ?? guessSlot(name);
  return {
    slot,
    warmth: given.warmth ?? guessWarmth(name, slot),
    formality: given.formality ?? guessFormality(name),
    colors: given.colors?.length ? given.colors : guessColors(name),
    waterproof: given.waterproof ?? guessWaterproof(name),
  };
}
