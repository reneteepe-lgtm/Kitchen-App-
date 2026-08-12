/**
 * Liest einen abfotografierten Kassenbon aus dem Laden.
 *
 * Der Picnic-Bon kommt als E-Mail und ist sauber aufgebaut. Der Zettel vom
 * Edeka ist das Gegenteil: schmal bedruckt, abgekürzt, und was hier ankommt,
 * hat vorher die Texterkennung des iPhones durchlaufen ("Text auswählen" im
 * Foto). Die liest den Bon **spaltenweise** -- erst alle Bezeichnungen, dann
 * den ganzen Preisblock am Stück:
 *
 *     Herz.M.Pf1. Tomaten Herz. Avocados     <- zwei Artikel in einer Zeile
 *     G&G Tomaten pass.                      <- abgekürzt
 *     Bresso Balanc 2,39 € x 2               <- Anzahl hängt am Preis
 *     Gerv. Hüttenkä 1,99 € x
 *     2                                      <- ... manchmal umgebrochen
 *     Rückstellnummer: 0083147
 *     Posten: 23
 *     SUMME
 *     ...
 *     66586698的686紀99655                    <- der Preisblock, unbrauchbar
 *
 * Daraus folgt der Zuschnitt dieses Lesers:
 *
 *  - **Preise werden nicht gelesen.** Sie stehen in einer eigenen Spalte, die
 *    beim Abfotografieren regelmäßig zu Zeichensalat zerfällt, und sie
 *    interessieren für den Vorrat nicht. Was zählt, ist die Bezeichnung.
 *  - **Die Anzahl schon**, denn die steht als "€ x 2" mitten in der
 *    Namensspalte und ist gut lesbar.
 *  - **"Posten: 23" ist die Probe.** Der Bon sagt selbst, wie viele Packungen
 *    er enthält. Stimmt das mit dem Gelesenen überein, ist der Bon
 *    vollständig; stimmt es nicht, sagt die App das, statt stillschweigend
 *    einen halben Einkauf einzubuchen.
 *
 * Zwei Artikel in einer Zeile sind der eigentliche Ärger. Getrennt wird nur
 * an einem belegbaren Anhaltspunkt: einer bekannten Marke oder einer
 * Abkürzung mit Punkt ("Herz.", "Exqu.") -- beides steht auf einem Kassenbon
 * am Anfang eines Artikels und nirgends sonst.
 */

import { normalize } from './search.js';
import { KNOWN_BRANDS } from './brands.js';

/** Ab hier ist der Warenkorb zu Ende; danach kommen nur noch Summen. */
const FOOTER =
  /^(SUMME|Zwischensumme|Gesamt|Zu zahlen|R(ü|ue)ckstell|Posten\s*:|osten\s*:|Geg(eben)?\b|R(ü|ue)ckgeld|Bar\b|EC[- ]|Karten?zahlung|Mastercard|astercard|Visa|Girocard|Mwst|MwSt|USt|Steuer|Netto\s+Brutto|TSE|Signatur|Trans-?Nr|Beleg\s*-?\s*Nr)/i;

/** Zeilen, die auf einem Bon stehen, aber keine Ware sind. */
const NOISE = [
  /^\d{4,}/, // Postleitzahl, Kassennummer, Kartennummer
  /^\d{1,2}[.:]\d{2}\b/, // Uhrzeit
  /^\d{1,2}\.\d{1,2}\.\d{2,4}/, // Datum
  /^(EUR|Preis|Menge|St(ü|ue)ck|Stk|Summe|Bon|Kasse|Markt|Datum|Uhrzeit|Tel|Fax|www|http)\b/i,
  /(GmbH|e\.K\.|Str\.|Stra(ß|ss)e|Filiale|Ihr Einkauf|Vielen Dank|Wir danken|Kundenkarte|Deutschland-?Card|Payback|Punkte|Gutschein|Rabatt)/i,
  /^[*=_-]{2,}/,
];

/**
 * Was auf einem deutschen Kassenbon vorkommen darf.
 *
 * Alles andere ist Zeichensalat aus der Texterkennung. Der Preisblock im
 * Beispiel oben zerfiel in "~-ONNE", "西mg" und "AAABAAAAAA為A" -- lauter
 * Zeilen, die an genau einem fremden Zeichen zu erkennen sind. Diese Prüfung
 * ist deshalb wirksamer als jede Wortliste.
 */
const ALLOWED = /^[A-Za-zÄÖÜäöüßÀ-ÿ0-9 .,:;&%+'"!?()/–—x×*€-]+$/;

/** Mindestens ein richtiges Wort -- drei Buchstaben am Stück. */
const WORDY = /[A-Za-zÄÖÜäöüß]{3,}/;

/**
 * Anzahl und Preis am Zeilenende: "2,39 € x 2".
 *
 * Die Anzahl darf fehlen -- dann steht sie eine Zeile tiefer, weil die
 * Texterkennung dort umgebrochen hat.
 */
const TIMES = /\s*(?:\d+[.,]\d{2})?\s*(?:€|EUR)\s*[x×]\s*(\d{1,2})?\s*$/i;

/** Ein Preis mit Steuerkennzeichen am Zeilenende: "2,99 A", "1,39 AW". */
const PRICE_TAIL = /\s+-?\d+[.,]\d{2}\s*[A-Z]{0,2}\s*$/;

/** Eine eigene Zeile mit Anzahl und Einzelpreis: "2 x 1,19". */
const COUNT_LINE = /^(\d{1,2})\s*(?:St(?:ü|ue)?ck?|Stk)?\s*[x×]\s*\d+[.,]\d{2}/i;

/** Anzahl vorne an der Zeile: "2 x Butter". */
const COUNT_LEAD = /^(\d{1,2})\s*[x×]\s+(?=\D)/;

/**
 * Eine Abkürzung mit Punkt: "Herz.", "Exqu.", "Gerv.".
 *
 * Auf dem Kassenbon steht so etwas immer **vorn** an einem Artikel -- es ist
 * die abgeschnittene Marke. Taucht es mitten in einer Zeile auf, sind dort
 * zwei Artikel zusammengerutscht.
 */
const ABBREV_TOKEN = /^[A-ZÄÖÜ][a-zäöüß]{1,8}\.$/;

/**
 * Abkürzungen, wie sie der Kassendrucker setzt.
 *
 * Die Zeile hat vierzehn Zeichen, also wird gekürzt, bis es passt. Für den
 * Vorrat ist das doppelt schlecht: "G&G Frischk." liest sich schlecht, und
 * die App erkennt daran weder das Fach noch die Haltbarkeit -- "Frischk."
 * ist eben kein Frischkäse.
 *
 * Aufgelöst wird nur, was eindeutig ist. Bei allem anderen bleibt die
 * Abkürzung stehen; sobald sie einmal einem Produkt zugeordnet wurde, merkt
 * sich die App das ohnehin und die Zeile läuft beim nächsten Einkauf durch.
 *
 * Schlüssel sind vereinheitlicht (`normalize`), es zählt der ganze Baustein
 * -- "tomat" trifft "Tomat." und nie "Tomaten".
 */
export const ABBREVIATIONS = new Map([
  // Handelsmarken
  ['g g', 'Gut&Günstig'],
  ['gg', 'Gut&Günstig'],
  ['gut guenstig', 'Gut&Günstig'],
  // Marken, die der Drucker kappt
  ['exqu', 'Exquisa'],
  ['gerv', 'Gervais'],
  ['milr', 'Milram'],
  ['topp', 'Toppits'],
  ['weihenst', 'Weihenstephan'],
  ['ruegenw', 'Rügenwalder'],
  ['kerryg', 'Kerrygold'],
  ['landl', 'Landliebe'],
  ['philad', 'Philadelphia'],
  ['balanc', 'Balance'],
  ['fitl', 'fitline'],
  // Milchprodukte
  ['frischk', 'Frischkäse'],
  ['frischka', 'Frischkäse'],
  ['frischkae', 'Frischkäse'],
  ['huettenka', 'Hüttenkäse'],
  ['huettenkae', 'Hüttenkäse'],
  ['jogh', 'Joghurt'],
  ['joghu', 'Joghurt'],
  ['naturjogh', 'Naturjoghurt'],
  ['natjogh', 'Naturjoghurt'],
  ['vollm', 'Vollmilch'],
  ['weidem', 'Weidemilch'],
  ['buttermi', 'Buttermilch'],
  ['schlags', 'Schlagsahne'],
  ['sauerr', 'Sauerrahm'],
  ['schmelzk', 'Schmelzkäse'],
  ['kaes', 'Käse'],
  // Fleisch
  ['h schnitzel', 'Hähnchenschnitzel'],
  ['haehnch', 'Hähnchen'],
  ['hackfl', 'Hackfleisch'],
  ['schweinen', 'Schweinenacken'],
  ['rinderh', 'Rinderhack'],
  ['gefluegel', 'Geflügel'],
  // Obst, Gemüse, Trockenware
  ['pass', 'passiert'],
  ['tomat', 'Tomaten'],
  ['zwieb', 'Zwiebeln'],
  ['kartoff', 'Kartoffeln'],
  ['karott', 'Karotten'],
  ['moehr', 'Möhren'],
  ['papr', 'Paprika'],
  ['gurk', 'Gurken'],
  ['banan', 'Bananen'],
  ['broetch', 'Brötchen'],
  ['baguett', 'Baguette'],
  ['spaetzlepf', 'Spätzlepfanne'],
  ['nudelpf', 'Nudelpfanne'],
  ['mineralw', 'Mineralwasser'],
  ['apfels', 'Apfelsaft'],
  ['orangens', 'Orangensaft'],
]);

/** "12.08.2026" oder "12.08.26" -> "2026-08-12" */
export function parseTillDate(text) {
  const match = /\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/.exec(String(text ?? ''));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Löst die Abkürzungen in einer Bezeichnung auf.
 *
 * Punkte trennen dabei Bausteine: "Frischk.fitl." sind zwei. Findet sich für
 * keinen Baustein eine Auflösung, bleibt das Wort so stehen, wie es war --
 * aus "Herz.M.Pf1." darf kein "Herz M Pf1" werden, nur weil zerlegt wurde.
 */
export function expandAbbrev(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  return words.map(expandWord).join(' ').trim();
}

function expandWord(word) {
  // Erst das ganze Wort: "H.Schnitzel" ist als Ganzes ein Hähnchenschnitzel.
  const whole = ABBREVIATIONS.get(normalize(word));
  if (whole) return whole;

  const parts = word.split('.').filter(Boolean);
  if (parts.length < 2) return word;

  const found = parts.map((part) => ABBREVIATIONS.get(normalize(part)) ?? null);
  if (!found.some(Boolean)) return word;
  return parts.map((part, i) => found[i] ?? part).join(' ');
}

/**
 * Zerteilt eine Zeile, in der mehrere Artikel zusammengerutscht sind.
 *
 * Getrennt wird nur vor einer bekannten Marke oder einer Abkürzung mit
 * Punkt, und nur so, dass links wie rechts mindestens zwei Wörter stehen
 * bleiben. Ein falsch zerschnittener Name legt zwei Unsinns-Produkte an;
 * ein nicht zerschnittener ist bloß ein Name zu lang und fällt beim
 * Durchsehen auf.
 *
 * @param {string} line
 * @param {string[]} [brands] Marken aus dem eigenen Vorrat -- die sind belegt
 * @returns {string[]}
 */
export function splitGlued(line, brands = []) {
  const words = String(line ?? '').split(/\s+/).filter(Boolean);
  if (words.length < 4) return words.length ? [words.join(' ')] : [];

  const known = new Set(
    [...brands, ...KNOWN_BRANDS].map(normalize).filter((brand) => brand.length >= 4),
  );

  const cuts = [];
  let last = 0;
  for (let i = 1; i < words.length; i++) {
    const startsArticle = ABBREV_TOKEN.test(words[i]) || known.has(normalize(words[i]));
    if (!startsArticle) continue;
    // Beidseitig mindestens zwei Wörter, sonst bleibt eine Abkürzung allein
    // stehen und aus "Exqu." würde ein Produkt.
    if (i - last < 2 || words.length - i < 2) continue;
    cuts.push(i);
    last = i;
  }
  if (!cuts.length) return [words.join(' ')];

  const pieces = [];
  let from = 0;
  for (const cut of [...cuts, words.length]) {
    pieces.push(words.slice(from, cut).join(' '));
    from = cut;
  }
  return pieces;
}

/** Taugt die Zeile als Bezeichnung? */
function isArticle(line, caseMatters) {
  if (!line || line.length > 60) return false;
  if (!ALLOWED.test(line)) return false;
  if (!WORDY.test(line)) return false;
  if (NOISE.some((pattern) => pattern.test(line))) return false;
  // Auf dem Bon stehen die Bezeichnungen gemischt geschrieben ("G&G
  // Frischkäse"), Kopf und Fuß in Großbuchstaben ("SUMME", "EDEKA"). Das
  // gilt aber nur, wenn dieser Bon überhaupt Kleinbuchstaben zeigt.
  if (caseMatters && !/[a-zäöüß]/.test(line)) return false;
  return true;
}

/**
 * Liest einen abfotografierten Kassenbon.
 *
 * @param {string} text
 * @param {{brands?: string[]}} [options]
 * @returns {{orderNo:string|null, date:string|null, posten:number|null,
 *            evidence:boolean, items:Array<{name:string,size:string,qty:number}>}}
 */
export function parseTillReceipt(text, { brands = [] } = {}) {
  const raw = String(text ?? '').replace(/ /g, ' ');
  const all = raw.split(/\r?\n/).map((line) => line.trim());

  const date = parseTillDate(raw);
  // "Posten: 23" -- der Bon zählt seine Packungen selbst. Ohne Wortgrenze
  // vor "osten" bliebe auch "Kosten: 23" hängen, und das ist etwas anderes.
  const posten = Number(/\bP?osten\s*:?\s*(\d{1,3})\b/.exec(raw)?.[1] ?? NaN);
  const nummer = /(?:R(?:ü|ue)ckstell|Beleg|Bon)-?\s*(?:nummer|nr)\.?:?\s*(\d{3,})/i.exec(raw)?.[1] ?? null;
  // Nummer und Tag zusammen: Eine Bonnummer wiederholt sich über die Wochen,
  // an einem Tag aber nicht. Nur so taugt sie als Schutz vor dem doppelten
  // Einbuchen.
  const orderNo = nummer ? (date ? `${date}-${nummer}` : nummer) : null;

  let end = all.length;
  let fussteil = false;
  for (let i = 0; i < all.length; i++) {
    if (FOOTER.test(all[i])) {
      end = i;
      fussteil = true;
      break;
    }
  }

  /*
   * Ist das überhaupt ein Kassenbon?
   *
   * Diese Frage muss der Leser selbst beantworten. Anders als beim
   * Picnic-Bon, der seine Artikel an der Größenzeile festmacht, ist hier
   * jede Zeile mit ein paar Buchstaben ein möglicher Artikel -- ein
   * versehentlich eingefügter Satz würde sonst als Ware im Vorrat landen.
   * Ein Bon nennt Beträge, oder er nennt seine Posten, oder er hat einen
   * Fußteil. Irgendetwas davon muss da sein.
   */
  const evidence = fussteil || Number.isFinite(posten) || /\d+[.,]\d{2}/.test(raw);
  const block = all.slice(0, end);
  const caseMatters = block.filter((line) => /[a-zäöüß]/.test(line)).length >= 3;

  const items = [];
  for (let i = 0; i < block.length; i++) {
    let line = block[i];
    if (!line) continue;

    let qty = 0;

    // Anzahl und Preis am Ende der Zeile: "2,39 € x 2"
    const times = TIMES.exec(line);
    if (times) {
      line = line.slice(0, times.index).trim();
      qty = Number(times[1] ?? 0);
      if (!qty) {
        // Umgebrochen -- die Anzahl steht allein in der nächsten Zeile.
        const next = block[i + 1] ?? '';
        if (/^\d{1,2}$/.test(next)) {
          qty = Number(next);
          i++;
        }
      }
    } else {
      line = line.replace(PRICE_TAIL, '').trim();
    }

    // Anzahl vorne: "2 x Butter"
    const lead = COUNT_LEAD.exec(line);
    if (lead) {
      qty = Number(lead[1]);
      line = line.slice(lead[0].length).trim();
    }

    if (!isArticle(line, caseMatters)) continue;

    // Oder in einer eigenen Zeile darunter: "2 x 1,19"
    if (!qty) {
      const below = COUNT_LINE.exec(block[i + 1] ?? '');
      if (below) {
        qty = Number(below[1]);
        i++;
      }
    }
    if (!(qty >= 1 && qty <= 99)) qty = 1;

    /*
     * Sind mehrere Artikel zusammengerutscht, gehört die Anzahl zum letzten.
     * Der Preis steht auf dem Bon rechts neben seinem eigenen Artikel, und
     * beim Zusammenrutschen landet er hinter dem, zu dem er gehört.
     */
    const pieces = splitGlued(line, brands);
    pieces.forEach((piece, index) => {
      const name = expandAbbrev(piece);
      if (!isArticle(name, caseMatters)) return;
      items.push({ name, size: '', qty: index === pieces.length - 1 ? qty : 1 });
    });
  }

  return { orderNo, date, posten: Number.isFinite(posten) ? posten : null, evidence, items };
}
