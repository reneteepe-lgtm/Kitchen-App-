/**
 * Marke und Bezeichnung auseinanderhalten, wenn beides in einem Namen steckt.
 *
 * Beim Scannen liefert die Produktdatenbank die Marke getrennt mit. Auf einem
 * Bon steht sie dagegen einfach vorn im Namen: "Gut&Günstig Frischkäse Natur",
 * "Dr. Oetker Tröpfchen Schoko". Damit sie auch dort klein über der
 * Bezeichnung stehen kann, muss sie abgetrennt werden.
 *
 * Raten wäre hier gefährlich. Aus "Zwiebeln rot" dürfte niemals die Marke
 * "Zwiebeln" und das Produkt "rot" werden. Abgetrennt wird deshalb nur, was
 * aus einer der beiden Quellen als Marke bekannt ist:
 *
 *  1. den Marken, die im eigenen Vorrat schon stehen -- die stammen aus
 *     gescannten Barcodes und sind damit belegt, nicht geraten;
 *  2. einer mitgelieferten Liste geläufiger Marken aus deutschen Supermärkten.
 *
 * Was in keiner von beiden vorkommt, bleibt unangetastet. Ein Name ohne
 * abgetrennte Marke ist harmlos; ein falsch zerschnittener ist Unsinn im
 * Vorrat.
 */

import { normalize } from './search.js';

/**
 * Geläufige Marken aus deutschen Supermärkten.
 *
 * Vollständig kann diese Liste nie sein, und das muss sie auch nicht: Was
 * hier fehlt, bleibt einfach im Namen stehen, und sobald dasselbe Produkt
 * einmal gescannt wurde, kennt die App die Marke ohnehin aus dem Vorrat.
 *
 * Bewusst nicht aufgenommen sind Wörter, die auch Lebensmittel benennen
 * ("Landliebe" ja, "Bio" nein) -- sonst zerschnitte die Liste Namen, die
 * gar keine Marke tragen.
 */
export const KNOWN_BRANDS = [
  // Handelsmarken
  'Gut&Günstig', 'Gut und Günstig', 'ja!', 'K-Classic', 'Rewe Beste Wahl', 'Rewe Bio',
  'Rewe Feine Welt', 'Edeka', 'Edeka Bio', 'Netto', 'Penny', 'Aldi', 'Lidl', 'Real Quality',
  'Milbona', 'Combino', 'Freeway', 'Alesto', 'Cien', 'Crownfield', 'Baresa', 'Vemondo',
  'Pilos', 'Dulano', 'Chef Select', 'Bellarom', 'Saskia', 'Mibell', 'Golden Sun',
  'Milsani', 'Tandil', 'Sondey', 'Belbake', 'Kania', 'Cucina Nobile', 'Bio Sonne',
  // Molkerei und Kühlregal
  'Alpro', 'Arla', 'Andechser', 'Bärenmarke', 'Bresso', 'Danone', 'Dr. Oetker', 'Ehrmann',
  'Elle & Vire', 'Exquisa', 'Frischli', 'Grünländer', 'Hochland', 'Landliebe', 'Leerdammer',
  'Weihenstephan', 'Müller', 'Müllermilch', 'Zott', 'Almighurt', 'Kerrygold', 'Meggle',
  'Philadelphia', 'Miree', 'Rama', 'Du darfst', 'Alnatura', 'Provamel', 'Oatly', 'Söbbeke',
  'Berchtesgadener Land', 'Milram', 'Bergader', 'Cambozola', 'Galbani', 'Président',
  // Wurst, Fisch, Fleisch
  'Rügenwalder', 'Wiltmann', 'Herta', 'Gutfried', 'Abrahams', 'Followfish', 'Appel',
  'Hawesta', 'Rügen Fisch', 'Wiesenhof', 'Reinert', 'Böklunder', 'Meica', 'Nadler',
  // Trockenware, Nudeln, Reis
  'Barilla', 'Buitoni', 'De Cecco', 'Birkel', 'Miracoli', 'Bernbacher', 'Mylos',
  'Oryza', 'Uncle Bens', "Uncle Ben's", 'Reis-Fit', 'Müllers Mühle', 'Bertolli',
  'Mutti', 'Cirio', 'Zwergenwiese', 'Kühne', 'Hengstenberg', 'Develey', 'Thomy',
  'Miracel Whip', 'Miracle Whip', 'Heinz', 'Hellmanns', "Hellmann's", 'Maggi', 'Knorr',
  'Erasco', 'Sonnen Bassermann', 'Iglo', 'Frosta', 'Bofrost',
  // Backen, Frühstück, Süßes
  'Golden Toast', 'Harry', 'Lieken Urkorn', 'Wasa', 'Kölln', 'Seitenbacher', 'Nestlé',
  'Kellogg', 'Kelloggs', "Kellogg's", 'Schär', 'Aurora', 'Diamant', 'Küchenmeister',
  'Ruf', 'Vahiné', 'Zentis', 'Schwartau', 'Nutella', 'Ferrero', 'Milka', 'Ritter Sport',
  'Lindt', 'Haribo', 'Storck', 'Bahlsen', 'Leibniz', 'Lorenz', 'funny-frisch',
  'Chio', 'Pringles', 'Manner', 'Katjes',
  // Getränke, Kaffee, Tee
  'Coca-Cola', 'Fanta', 'Sprite', 'Pepsi', 'Volvic', 'Gerolsteiner', 'Vittel', 'Adelholzener',
  'Granini', 'Hohes C', 'Rauch', 'Albi', 'Jacobs', 'Dallmayr', 'Tchibo', 'Melitta',
  'Lavazza', 'Segafredo', 'Mövenpick', 'Nescafé', 'Teekanne', 'Meßmer', 'Pukka',
  // Haushalt und Pflege
  'Frosch', 'Pril', 'Somat', 'Persil', 'Lenor', 'Ariel', 'Domestos', 'Sagrotan',
  'Zewa', 'Tempo', 'Nivea', 'Balea', 'Dove', 'Elmex', 'Odol',
  'Signal', 'Colgate', 'Blend-a-med', 'Sensodyne',
];

/** Marken nach Länge, damit "Dr. Oetker" vor "Dr" greift. */
function sortedCandidates(brands) {
  const seen = new Map();
  for (const brand of brands) {
    const key = normalize(brand);
    if (key && !seen.has(key)) seen.set(key, brand);
  }
  return [...seen.entries()].sort((a, b) => b[0].length - a[0].length);
}

/**
 * Trennt eine bekannte Marke vom Anfang eines Namens ab.
 *
 * @param {string} fullName  "Gut&Günstig Frischkäse Natur 300 g"
 * @param {string[]} [known] Zusätzliche Marken, etwa die aus dem eigenen Vorrat
 * @returns {{brand:string, name:string}} Marke leer, wenn nichts sicher passt
 */
export function splitBrand(fullName, known = []) {
  const text = String(fullName ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { brand: '', name: '' };

  const normalized = normalize(text);
  for (const [key, brand] of sortedCandidates([...known, ...KNOWN_BRANDS])) {
    // Nur am Wortende trennen: "Arla" darf nicht in "Arlagurt" greifen.
    if (normalized !== key && !normalized.startsWith(`${key} `)) continue;

    /*
     * Die Schnittstelle im Originaltext suchen.
     *
     * Über die Wortzahl ginge das nicht: "Gut&Günstig" ist ein Wort, wird
     * aber zu "gut guenstig" mit zweien. Deshalb wird der Originaltext Zeichen
     * für Zeichen verlängert, bis seine vereinheitlichte Form der Marke
     * entspricht.
     */
    for (let cut = 1; cut <= text.length; cut++) {
      if (normalize(text.slice(0, cut)) !== key) continue;
      const rest = text.slice(cut).trim();
      // Nichts abtrennen, wenn danach nichts Sinnvolles übrig bleibt:
      // "Bresso" allein ist besser als eine Marke ohne Bezeichnung.
      if (rest.length < 2) return { brand: '', name: text };
      return { brand: text.slice(0, cut).trim(), name: rest };
    }
  }

  return { brand: '', name: text };
}

/** Alle Marken, die im Vorrat schon vorkommen -- die sind belegt. */
export function brandsInUse(products) {
  const brands = new Set();
  for (const product of products ?? []) {
    const brand = String(product?.brand ?? '').trim();
    if (brand) brands.add(brand);
  }
  return [...brands];
}
