/**
 * Kategorien für den Vorrat.
 *
 * Zwei Dinge leistet diese Datei:
 *
 *  1. Sie legt eine überschaubare Zahl von Fächern fest, sortiert so, wie
 *     man eine Küche durchgeht -- Trockenvorrat, Kühlschrank, Frisches,
 *     Getränke, Haushalt.
 *  2. Sie ordnet ein Produkt allein anhand seines Namens ein. Dadurch muss
 *     beim Erfassen niemand eine Kategorie auswählen, und auch bereits
 *     erfasste Produkte landen sofort im richtigen Fach, ohne dass jemand
 *     sie nachträglich anfassen müsste.
 *
 * Die Zuordnung kann immer von Hand überschrieben werden; eine gesetzte
 * Kategorie gilt und wird nie wieder überstimmt.
 */

import { normalize } from './search.js';

/**
 * Die Fächer in der Reihenfolge, in der sie angezeigt werden.
 *
 * `keywords` sind Wortstämme. Getroffen wird ein Stamm, wenn ein Wort des
 * Produktnamens damit anfängt oder aufhört -- deutsche Zusammensetzungen
 * wie "Vollkornnudeln" oder "Tomatenmark" laufen sonst ins Leere.
 */
export const CATEGORIES = [
  {
    id: 'pasta',
    label: 'Nudeln & Reis',
    icon: '🍝',
    keywords: [
      'nudel', 'spaghetti', 'spagetti', 'penne', 'fusilli', 'farfalle', 'rigatoni',
      'tagliatelle', 'linguine', 'makkaroni', 'lasagne', 'spaetzle', 'tortellini',
      'gnocchi', 'ravioli', 'pasta', 'reis', 'risotto', 'basmati', 'jasminreis',
      'couscous', 'bulgur', 'quinoa', 'polenta',
    ],
  },
  {
    id: 'potato',
    label: 'Kartoffeln & Hülsenfrüchte',
    icon: '🥔',
    keywords: [
      'kartoffel', 'knoedel', 'kloss', 'kloesse', 'pommes', 'roesti',
      'linse', 'linsen', 'bohne', 'bohnen', 'kichererbse', 'erbse', 'erbsen',
      'huelsenfruecht',
    ],
  },
  {
    id: 'sauce',
    label: 'Saucen & Konserven',
    icon: '🥫',
    /**
     * Erst zusammen ergeben diese Wörter eine Konserve: Frische Tomaten
     * gehören zum Gemüse, passierte und stückige in den Vorratsschrank.
     * Als einzelnes Stichwort ginge das nicht -- "Dose" allein sagt nur
     * etwas über die Verpackung ("Kichererbsen Dose" sind Erbsen).
     */
    phrases: [
      ['tomate', 'passiert'],
      ['tomate', 'stueckig'],
      ['tomate', 'gehackt'],
      ['tomate', 'dose'],
      ['tomate', 'konserve'],
    ],
    keywords: [
      'sauce', 'sosse', 'passata', 'passiert', 'stueckig', 'ketchup', 'senf',
      'mayonnaise', 'mayo', 'salatcreme', 'salatmayonnaise',
      // Marken, die für nichts anderes stehen als für die Ware selbst.
      'miracel', 'thomy',
      'pesto', 'tomatenmark', 'mark', 'suppe', 'bruehe',
      'fond', 'ajvar', 'hummus', 'sugo', 'chutney', 'dressing',
    ],
  },
  {
    id: 'spice',
    label: 'Öl, Essig & Gewürze',
    icon: '🧂',
    keywords: [
      'oel', 'olivenoel', 'sonnenblumenoel', 'rapsoel', 'essig', 'balsamico',
      'salz', 'pfeffer', 'paprika', 'curry', 'kuemmel', 'oregano', 'basilikum',
      'thymian', 'rosmarin', 'zimt', 'muskat', 'gewuerz', 'kraeuter', 'chili',
      'knoblauch', 'ingwer', 'kurkuma', 'vanille', 'lorbeer',
    ],
  },
  {
    id: 'baking',
    label: 'Backen & Süßes',
    icon: '🧁',
    keywords: [
      'mehl', 'zucker', 'backpulver', 'hefe', 'staerke', 'speisestaerke',
      'natron', 'schokolade', 'schoko', 'kakao', 'nuss', 'nuesse', 'mandel',
      'rosine', 'kuchen', 'keks', 'gebaeck', 'bonbon', 'suessigkeit',
      'marzipan', 'sahnesteif', 'puddingpulver',
    ],
  },
  {
    id: 'breakfast',
    label: 'Frühstück & Brot',
    icon: '🍞',
    keywords: [
      'brot', 'broetchen', 'toast', 'knaeckebrot', 'zwieback', 'muesli',
      'haferflocke', 'cornflakes', 'flocken', 'marmelade', 'konfituere',
      'gelee', 'honig', 'nutella', 'nussnougatcreme', 'aufstrich',
    ],
  },
  {
    id: 'dairy',
    label: 'Milch & Käse',
    icon: '🧀',
    keywords: [
      'milch', 'joghurt', 'jogurt', 'quark', 'kaese', 'butter', 'margarine',
      'sahne', 'schmand', 'creme', 'frischkaese', 'mozzarella', 'parmesan',
      'gouda', 'feta', 'ei', 'eier', 'buttermilch', 'kefir', 'skyr',
    ],
  },
  {
    id: 'meat',
    label: 'Fleisch & Fisch',
    icon: '🥩',
    keywords: [
      // "gehackt" steht auch hier: Die Kombination mit der Tomate hat
      // Vorrang, allein bezeichnet es das Hackfleisch.
      'fleisch', 'hack', 'hackfleisch', 'gehackt', 'wurst', 'schinken', 'salami', 'speck',
      'haehnchen', 'huhn', 'pute', 'rind', 'schwein', 'lamm', 'steak',
      'fisch', 'lachs', 'thunfisch', 'forelle', 'garnele', 'schnitzel',
      'frikadelle', 'bratwurst', 'gulasch', 'wuerstchen', 'wiener',
    ],
  },
  {
    id: 'produce',
    label: 'Obst & Gemüse',
    icon: '🥕',
    keywords: [
      'apfel', 'aepfel', 'banane', 'birne', 'orange', 'zitrone', 'limette',
      'beere', 'beeren', 'traube', 'melone', 'pfirsich', 'kiwi', 'obst',
      'ananas', 'mango', 'pflaume', 'kirsch', 'dattel', 'feige',
      'tomate', 'gurke', 'salat', 'zwiebel', 'moehre', 'karotte', 'paprika',
      'zucchini', 'aubergine', 'brokkoli', 'blumenkohl', 'spinat', 'kohl',
      'lauch', 'sellerie', 'pilz', 'champignon', 'gemuese', 'avocado',
      'mais', 'spargel', 'kuerbis', 'radieschen', 'rettich', 'fenchel', 'rucola',
    ],
  },
  {
    id: 'frozen',
    label: 'Tiefkühl',
    icon: '🧊',
    /**
     * Anders als sonst schlägt dieser Hinweis alles andere: "Tiefkühlerbsen"
     * sind zwar Erbsen, liegen aber im Gefrierfach -- und genau darum geht es
     * beim Suchen. Solche Marker beschreiben nicht die Ware, sondern wo sie
     * steht, und sind deshalb stärker als jedes Grundwort.
     */
    markers: ['tiefkuehl', 'tk', 'gefrier'],
    keywords: ['speiseeis'],
  },
  {
    id: 'drinks',
    label: 'Getränke',
    icon: '🥤',
    keywords: [
      'wasser', 'saft', 'schorle', 'limonade', 'cola', 'bier', 'wein', 'sekt',
      // "kaffeebohne" eigens aufgeführt: Sonst gewänne das Grundwort
      // "Bohne" und der Kaffee landete bei den Hülsenfrüchten.
      'kaffee', 'kaffeebohne', 'espresso', 'tee', 'kakaopulver', 'sirup', 'getraenk',
    ],
  },
  {
    id: 'household',
    label: 'Haushalt',
    icon: '🧽',
    keywords: [
      'spuelmittel', 'spuelmaschinentab', 'tab', 'tabs', 'waschmittel',
      'weichspueler', 'reiniger', 'putzmittel', 'schwamm', 'lappen',
      'muellbeutel', 'alufolie', 'frischhaltefolie', 'backpapier',
      'klopapier', 'toilettenpapier', 'kuechenrolle', 'papiertuch',
      'zahnpasta', 'seife', 'shampoo', 'batterie', 'kerze',
    ],
  },
  {
    id: 'other',
    label: 'Sonstiges',
    icon: '📦',
    keywords: [],
  },
];

/** Auffangfach für alles, was sich nicht zuordnen lässt. */
export const FALLBACK_CATEGORY = 'other';

const BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

export function categoryById(id) {
  return BY_ID.get(id) ?? BY_ID.get(FALLBACK_CATEGORY);
}

/**
 * Dieselben Fächer, aber in der Reihenfolge eines Einkaufs.
 *
 * Im Vorrat zählt, wo etwas in der Küche steht. Im Laden zählt der Weg
 * durch den Markt, und der ist ein anderer: Obst und Gemüse liegen in
 * deutschen Supermärkten fast immer gleich hinter dem Eingang, danach
 * folgen Backwaren, dann die Regalgassen mit dem Trockensortiment.
 *
 * Kühlware, Fleisch und Tiefkühl stehen bewusst am Ende. Das entspricht
 * bei den meisten Märkten dem Rückweg zur Kasse und hält zugleich die
 * Kühlkette kurz. Getränke ganz zuletzt, weil sie schwer sind und oben
 * auf dem Wagen nichts zu suchen haben.
 */
export const SHOPPING_ORDER = [
  'produce',
  'breakfast',
  'pasta',
  'potato',
  'sauce',
  'spice',
  'baking',
  'household',
  'dairy',
  'meat',
  'frozen',
  'drinks',
  'other',
];

/** Die Fächer in der Reihenfolge, in der man sie im Laden abläuft. */
export function categoriesInShoppingOrder() {
  return SHOPPING_ORDER.map((id) => BY_ID.get(id)).filter(Boolean);
}

/** Deutsche Flexionsendungen, die an einen Wortstamm treten dürfen. */
const ENDINGS = ['', 'n', 'en', 'e', 's', 'es', 'er', 'ln'];

/**
 * Ab dieser Länge darf ein Stamm auch innerhalb einer Zusammensetzung
 * greifen. Kürzere gelten nur als ganzes Wort -- sonst macht das Stichwort
 * "Ei" aus jedem "Kartoffelbrei" ein Milchprodukt.
 */
const MIN_STEM_FOR_PARTIAL = 3;

/** Endet das Wort auf diesen Stamm -- auch in gebeugter Form? */
function endsWithStem(word, stem) {
  return ENDINGS.some((ending) => word.endsWith(stem + ending));
}

/**
 * Bewertet, wie gut ein Stichwort auf ein Wort passt.
 *
 * Entscheidend ist der Vorrang des Suffixes: Im Deutschen bestimmt das
 * letzte Glied einer Zusammensetzung die Sache. "Tomatensauce" ist eine
 * Sauce, nicht eine Tomate; "Reismehl" ist Mehl, nicht Reis. Ohne diesen
 * Vorrang landeten beide im falschen Fach.
 *
 * @returns {number} 0, wenn es nicht passt
 */
function scoreWord(word, stem) {
  if (word === stem) return 3000 + stem.length;
  if (stem.length < MIN_STEM_FOR_PARTIAL) return 0;
  if (endsWithStem(word, stem)) return 2000 + stem.length;
  // Ein Wortanfang zählt schwächer: "Nudelsuppe" ist eher Suppe als Nudel,
  // aber ohne besseren Treffer ist die Nudel-Spur brauchbar.
  if (word.startsWith(stem) && word.length > stem.length) return 1000 + stem.length;
  return 0;
}

/**
 * Rät die Kategorie aus dem Produktnamen.
 *
 * @param {string} name
 * @returns {string} Kennung einer Kategorie, notfalls die Auffangkategorie
 */
export function guessCategory(name) {
  const words = normalize(name).split(' ').filter(Boolean);
  if (!words.length) return FALLBACK_CATEGORY;

  let best = { id: FALLBACK_CATEGORY, score: 0, at: Infinity };

  const consider = (id, score, at) => {
    // Bei gleich starkem Treffer gewinnt das Wort, das vorne steht: Sorte
    // und Marke stehen im Deutschen meist hinten ("Müsli Schoko",
    // "Pizza Salami"), die Ware selbst vorne.
    if (score > best.score || (score === best.score && at < best.at)) {
      best = { id, score, at };
    }
  };

  const hasStem = (stem) => words.some((word) => scoreWord(word, stem) > 0);

  for (const category of CATEGORIES) {
    // Wortkombinationen zuerst: Sie sind spezifischer als jedes Einzelwort
    // und sollen es deshalb schlagen.
    for (const phrase of category.phrases ?? []) {
      if (phrase.every(hasStem)) consider(category.id, 8000, 0);
    }

    for (let i = 0; i < words.length; i++) {
      for (const marker of category.markers ?? []) {
        if (scoreWord(words[i], marker)) consider(category.id, 9000, i);
      }
      for (const stem of category.keywords) {
        const score = scoreWord(words[i], stem);
        if (score) consider(category.id, score, i);
      }
    }
  }

  return best.id;
}

/**
 * Die Kategorie eines Produkts.
 *
 * Eine von Hand gesetzte Kategorie gilt immer. Fehlt sie -- etwa bei
 * Produkten aus einer älteren Fassung der App --, wird sie aus dem Namen
 * abgeleitet, ohne die Daten anzufassen.
 */
export function categoryOf(product) {
  if (product?.category && BY_ID.has(product.category)) return product.category;
  // Die Marke gehört mit in die Betrachtung: Bei "Miracel Whip" steckt der
  // entscheidende Hinweis genau dort und nicht in der Bezeichnung.
  return guessCategory([product?.brand, product?.name].filter(Boolean).join(' '));
}

/**
 * Gruppiert Einträge in die Fächer. Leere Fächer fallen weg, die
 * Reihenfolge innerhalb eines Fachs bleibt wie übergeben.
 *
 * @param {Array} items
 * @param {object} [options]
 * @param {Array}  [options.order] Fächer in der gewünschten Reihenfolge.
 * @param {(item:any) => string} [options.categoryFor]
 *        Wie die Kategorie eines Eintrags zu bestimmen ist. Nötig für
 *        Einkaufslisten-Einträge ohne Produkt -- dort steckt die einzige
 *        Auskunft im Text ("Alufolie").
 * @returns {Array<{category:object, items:Array}>}
 */
export function groupByCategory(items, { order = CATEGORIES, categoryFor } = {}) {
  const pick = categoryFor ?? ((item) => categoryOf(item.product ?? item));
  const buckets = new Map(order.map((category) => [category.id, []]));

  for (const item of items) {
    const id = pick(item);
    // Ein Fach, das in dieser Reihenfolge nicht vorkommt, landet im
    // Auffangfach, statt den Eintrag verschwinden zu lassen.
    (buckets.get(id) ?? buckets.get(FALLBACK_CATEGORY)).push(item);
  }

  return order
    .filter((category) => buckets.get(category.id).length > 0)
    .map((category) => ({ category, items: buckets.get(category.id) }));
}
