/**
 * Liest den Bon aus einer Picnic-Lieferung.
 *
 * Picnic schickt zu jeder Lieferung eine E-Mail ("Dein Bon"). Kopiert man
 * sie und fügt sie hier ein, entsteht daraus eine Liste zum Einbuchen --
 * ohne Zugangsdaten, ohne Umweg über einen fremden Dienst, ohne dass
 * irgendetwas die Küche verlässt. Es ist der eigene Beleg, und er wird auf
 * dem eigenen Gerät gelesen.
 *
 * Aus der hübschen Tabelle der E-Mail wird beim Kopieren eine schlichte
 * Folge von Zeilen. Ein Artikel sieht darin so aus:
 *
 *     1                              <- Anzahl
 *     Mylos Kritharaki<TAB><TAB>     <- Bildbeschreibung, endet auf Tabs
 *     Mylos Kritharaki               <- Bezeichnung
 *     500g                           <- Größe
 *     15% Rabatt                     <- gibt es nur manchmal
 *     1                              <- Preis, in drei Zeilen zerlegt
 *     69
 *     .
 *
 * Verlässlich daran ist die **Größenzeile**: Sie steht bei jedem Artikel und
 * sieht anders aus als alles andere im Bon. Sie ist deshalb der Anker, und
 * Bezeichnung wie Anzahl werden von dort aus rückwärts gelesen. Die Preise
 * werden gar nicht erst angefasst -- sie zerfallen beim Kopieren in einzelne
 * Ziffernzeilen und interessieren für den Vorrat nicht.
 *
 * Der abfotografierte Kassenzettel aus dem Laden sieht ganz anders aus und
 * hat deshalb einen eigenen Leser (`tillreceipt.js`). Welcher von beiden
 * zuständig ist, entscheidet `readReceipt` weiter unten.
 */

import { parseTillReceipt } from './tillreceipt.js';

/**
 * Eine Größenangabe: "500g", "1 Stück", "4 Stück", "1kg Netz", "500ml",
 * "1L", "für 7L". Der Zusatz hinten ("Netz") gehört dazu.
 */
const SIZE = /^(für\s+)?\d+([.,]\d+)?\s*(g|kg|mg|ml|cl|l|St(?:ü|ue)ck|Stk|Bund|Rolle|Packung|Beutel|Paar)\b(\s+\w+)?$/i;

/** Zeilen, die zwar auffällig aussehen, aber kein Artikel sind. */
const BADGE = /(%\s*(Ersatz-)?Rabatt|^jetzt\s|^\d+\s*(für|f\.)\s*\d+$)/i;

/** Ab hier ist der Warenkorb zu Ende und es kommen nur noch Summen. */
const FOOTER = /^(Pfand|Flaschen|T(ü|ue)ten|Zwischensumme|Eingereichtes|Recycle|Gesamtbetrag|Mwst|Du sparst|Trinkgeld|Liefer)/i;

const MONTHS = [
  'januar', 'februar', 'märz', 'maerz', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'dezember',
];

/** Ordnungszahl des Monats, 0-basiert -- "märz" und "maerz" sind derselbe. */
function monthIndex(name) {
  const i = MONTHS.indexOf(String(name).toLowerCase());
  if (i < 0) return null;
  return i >= 3 ? i - 1 : i; // "maerz" ist ein Zweitname für denselben Monat
}

/** "Mittwoch 5 August 2026" -> "2026-08-05" */
export function parseReceiptDate(text) {
  const match = /(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/.exec(String(text ?? ''));
  if (!match) return null;
  const month = monthIndex(match[2]);
  if (month === null) return null;
  const day = Number(match[1]);
  if (!(day >= 1 && day <= 31)) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Setzt zwischen Zahl und Einheit ein Leerzeichen: "500g" -> "500 g".
 * So steht es auch sonst überall in der App ("Passata 400 g").
 */
export function tidySize(size) {
  return String(size ?? '').trim().replace(/^(\D*)(\d+(?:[.,]\d+)?)\s*([A-Za-zäöüÄÖÜ]+)/, (_, pre, num, unit) =>
    `${pre}${num} ${unit}`,
  );
}

/**
 * Der Name, unter dem der Artikel im Vorrat stehen soll.
 *
 * Die Größe gehört dazu -- "Frischkäse 300 g" und "Frischkäse 150 g" sind
 * zwei verschiedene Dinge im Schrank. Nur "1 Stück" bleibt weg: Das sagt
 * nichts über die Packung, sondern nur, dass es eines ist.
 */
export function suggestedName({ name, size }) {
  const tidy = tidySize(size);
  if (!tidy || /^1\s*St(ü|ue)ck$/i.test(tidy)) return name;
  return `${name} ${tidy}`;
}

/**
 * Liest einen kopierten Picnic-Bon.
 *
 * @returns {{orderNo:string|null, date:string|null, items:Array<{name:string,size:string,qty:number}>}}
 */
export function parseReceipt(text) {
  const raw = String(text ?? '').replace(/ /g, ' ');
  const lines = raw.split(/\r?\n/);

  // Kein `\s` in der Nummer: Das schlösse den Zeilenumbruch mit ein und
  // zöge die Anzahl des ersten Artikels mit in die Bestellnummer.
  const orderNo = /Bestellnr\.?[ \t]*([0-9][0-9-]{4,})/i.exec(raw)?.[1] ?? null;
  const date = parseReceiptDate(/Lieferung von ([^\n.]+)/i.exec(raw)?.[1] ?? '');

  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const size = lines[i].trim();
    if (!SIZE.test(size)) continue;

    // Rückwärts: die Bezeichnung steht unmittelbar davor.
    let j = i - 1;
    while (j >= 0 && !lines[j].trim()) j--;
    const name = lines[j]?.trim() ?? '';
    if (!name || FOOTER.test(name) || BADGE.test(name) || /^[\d.,€%]+$/.test(name)) continue;

    // Davor steht dieselbe Bezeichnung noch einmal als Bildbeschreibung,
    // erkennbar an den Tabulatoren dahinter. Sie wird übersprungen.
    let k = j - 1;
    while (k >= 0 && !lines[k].trim()) k--;
    if (lines[k]?.trimEnd().trim() === name) {
      k--;
      while (k >= 0 && !lines[k].trim()) k--;
    }

    // Und davor die Anzahl. Fehlt sie, ist es eines.
    const before = lines[k]?.trim() ?? '';
    const qty = /^\d{1,2}$/.test(before) ? Number(before) : 1;

    items.push({ name, size, qty: qty > 0 ? qty : 1 });
  }

  return { orderNo, date, items };
}

/** Woran ein Picnic-Bon zu erkennen ist. */
const PICNIC_MARKER = /(Bestellnr|Lieferung von|Dein Bon|Picnic)/i;

/** Woran ein Kassenbon aus dem Laden zu erkennen ist. */
const TILL_MARKER = /(Posten\s*:|osten\s*:|R(ü|ue)ckstellnummer|Kundenbeleg|EC[- ]Cash|Girocard|MwSt|(€|EUR)\s*[x×]|^SUMME$)/im;

/**
 * Liest einen Bon -- gleich welcher Herkunft.
 *
 * Es gibt zwei Sorten, und sie sehen einander in nichts ähnlich: die
 * kopierte Picnic-E-Mail und der abfotografierte Kassenzettel aus dem Laden.
 * Welche vorliegt, soll niemand vorher ansagen müssen; erkennbar ist es am
 * Text selbst.
 *
 * Der Kassenbon-Leser kommt dabei nur zum Zug, wenn der Text sich auch wie
 * ein Bon liest -- mit Beträgen, mit "Posten", mit einem Fußteil. Denn für
 * ihn ist jede Zeile mit ein paar Buchstaben ein möglicher Artikel; ohne
 * diese Hürde machte ein versehentlich eingefügter Satz ein Produkt daraus.
 *
 * @param {string} text
 * @param {{brands?: string[]}} [options] Marken aus dem eigenen Vorrat
 * @returns {{kind:'picnic'|'till', orderNo:string|null, date:string|null,
 *            posten?:number|null, items:Array<{name:string,size:string,qty:number}>}}
 */
export function readReceipt(text, options = {}) {
  const picnic = { kind: 'picnic', posten: null, ...parseReceipt(text) };
  if (PICNIC_MARKER.test(text) && picnic.items.length) return picnic;

  const till = { kind: 'till', ...parseTillReceipt(text, options) };
  const istBon = TILL_MARKER.test(text) || till.evidence;
  if (istBon && till.items.length > picnic.items.length) return till;

  return picnic;
}
