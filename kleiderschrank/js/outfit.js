/**
 * Der Vorschlag.
 *
 * Hier läuft alles zusammen: was im Schrank hängt, wie das Wetter wird,
 * wo man hin will und was die App bisher über den Geschmack gelernt hat.
 * Heraus kommen ein paar vollständige Kombinationen, jede mit einer
 * Begründung, die man nachlesen kann.
 *
 * Zwei Entscheidungen prägen das Ergebnis:
 *
 *  1. **Wetter schlägt Geschmack.** Ein Outfit, in dem man friert, ist kein
 *    gutes Outfit, auch wenn es das Lieblingshemd enthält. Die Wärme hat
 *    deshalb das größte Gewicht -- der gelernte Geschmack entscheidet unter
 *    den Kombinationen, die ohnehin passen.
 *  2. **Nicht das beste Outfit, sondern ein paar gute.** Wer jeden Morgen
 *    denselben Vorschlag bekommt, hört nach einer Woche auf zu schauen.
 *    Vorschläge müssen sich daher deutlich voneinander unterscheiden, und
 *    "Mehr erstellen" führt zu wirklich anderen, nicht zu leicht
 *    abgewandelten.
 */

import { featuresOf, preferenceScore } from './preferences.js';
import { isNeutral } from './slots.js';
import { daysSince } from './model.js';

/** Wo soll es hingehen? Bestimmt, wie schick die Teile sein dürfen. */
export const OCCASIONS = [
  { id: 'alltag', label: 'Alltag', target: 2, min: 1, max: 3 },
  { id: 'arbeit', label: 'Arbeit', target: 3, min: 2, max: 4 },
  { id: 'sport', label: 'Sport & zu Hause', target: 0, min: 0, max: 1 },
  { id: 'ausgehen', label: 'Ausgehen', target: 3, min: 2, max: 4 },
  { id: 'festlich', label: 'Festlich', target: 4, min: 3, max: 4 },
];

export const occasionById = (id) => OCCASIONS.find((o) => o.id === id) ?? OCCASIONS[0];

/**
 * Wie warm muss das Outfit sein? 0 bis 5, dieselbe Skala wie bei den Teilen.
 *
 * Gerechnet wird nicht mit dem Höchstwert des Tages, sondern mit einer
 * Mischung aus Höchst- und Tiefstwert. Wer morgens bei vier Grad losgeht,
 * hat nichts davon, dass es nachmittags zwölf werden -- die Jacke muss
 * trotzdem mit.
 */
export function targetWarmth(weather) {
  if (!weather || (weather.tempMax === null && weather.tempMin === null)) return 2;
  const max = weather.tempMax ?? weather.tempMin;
  const min = weather.tempMin ?? weather.tempMax;
  const gefuehlt = max * 0.6 + min * 0.4;

  if (gefuehlt >= 26) return 0;
  if (gefuehlt >= 21) return 1;
  if (gefuehlt >= 14) return 2;
  if (gefuehlt >= 8) return 3;
  if (gefuehlt >= 2) return 4;
  return 5;
}

/** Braucht es heute eine Jacke? */
export const needsOuter = (weather) => targetWarmth(weather) >= 3 || (weather?.rainChance ?? 0) >= 50;

/** Und eine Mütze? */
export const needsHeadwear = (weather) => targetWarmth(weather) >= 5;

/**
 * Die Baupläne eines Outfits.
 *
 * Ein Kleid ersetzt Oberteil und Hose -- deshalb zwei Baupläne statt eines
 * mit Sonderfall. Welcher zum Zuge kommt, entscheidet der Schrank: Wer
 * keine Kleider besitzt, bekommt nie einen Kleid-Vorschlag, ohne dass das
 * irgendwo als Bedingung stünde.
 */
export const BLUEPRINTS = [
  { id: 'klassisch', required: ['top', 'bottom', 'shoes'] },
  { id: 'kleid', required: ['dress', 'shoes'] },
];

// --- Bewertung -----------------------------------------------------------

/**
 * Die Gewichte der einzelnen Gesichtspunkte.
 *
 * Sie stehen hier zusammen und nicht verstreut im Code, weil ihr Verhältnis
 * zueinander die ganze Persönlichkeit der App ausmacht -- und weil man beim
 * Nachjustieren alle auf einmal sehen können muss.
 */
export const WEIGHTS = {
  wetter: 3,
  anlass: 2,
  vorlieben: 2,
  farbe: 1.2,
  frische: 0.8,
  regen: 1,
};

/**
 * Wie warm ist diese Kombination?
 *
 * Die Kernteile werden gemittelt, die Jacke kommt obendrauf: Ein T-Shirt
 * unter einem Wintermantel ist kein Problem -- die äußere Schicht bestimmt,
 * was man draußen spürt. Deshalb ist die Jacke ein Zuschlag und kein
 * weiterer Mittelwert, der sie wegmitteln würde.
 */
export function outfitWarmth(items) {
  const core = items.filter((item) => ['top', 'bottom', 'dress', 'shoes'].includes(item.slot));
  const outer = items.find((item) => item.slot === 'outer');
  const head = items.find((item) => item.slot === 'headwear');

  const base = core.length
    ? core.reduce((sum, item) => sum + (item.warmth ?? 2), 0) / core.length
    : 2;

  return base + (outer ? Math.max(0, (outer.warmth ?? 3) - 2) * 0.8 : 0) + (head ? 0.3 : 0);
}

/**
 * Farbharmonie.
 *
 * Die Regel ist die einfachste, die trägt: Eine Farbe auf ruhigem Grund
 * sieht fast immer gut aus, zwei gehen, drei werden zum Kostüm. Neutrale
 * zählen nicht mit -- ein Outfit aus Schwarz, Grau und Beige ist keine
 * dreifarbige Angelegenheit.
 */
export function colorHarmony(items) {
  const bunt = new Set();
  for (const item of items) {
    for (const color of item.colors ?? []) if (!isNeutral(color)) bunt.add(color);
  }
  return [0.85, 1, 0.72, 0.45][Math.min(bunt.size, 3)];
}

/**
 * Wie lange lag das schon herum? 0 = gestern getragen, 1 = lange nicht.
 *
 * Das ist der Gesichtspunkt, der einen Schrank überhaupt erst nutzbar
 * macht: Ohne ihn schlägt jede solche App immer wieder die drei Teile vor,
 * die schon oben liegen.
 */
export function freshness(items, from = new Date()) {
  if (!items.length) return 1;
  const werte = items.map((item) => {
    const tage = daysSince(item.lastWornAt, from);
    if (tage === null) return 1; // Noch nie getragen -- höchste Zeit.
    return Math.min(1, tage / 21);
  });
  return werte.reduce((sum, n) => sum + n, 0) / werte.length;
}

/**
 * Bewertet eine fertige Kombination.
 *
 * Gibt nicht nur die Summe zurück, sondern die einzelnen Teilnoten. Die
 * Begründung unter dem Vorschlag ("warm genug für 2 Grad") ist nichts
 * anderes als die stärkste dieser Noten -- sie wird nicht nachträglich
 * erfunden, sondern ist genau der Grund, aus dem das Outfit gewonnen hat.
 */
export function scoreOutfit(items, { weather, occasion, model, now = new Date() } = {}) {
  const ziel = targetWarmth(weather);
  const anlass = occasionById(occasion);

  const waerme = outfitWarmth(items);
  const wetter = 1 - Math.min(1, Math.abs(waerme - ziel) / 3);

  const formalitaet = items.length
    ? items.reduce((sum, item) => sum + (item.formality ?? 2), 0) / items.length
    : 2;
  const passung = 1 - Math.min(1, Math.abs(formalitaet - anlass.target) / 2.5);

  const regenrisiko = (weather?.rainChance ?? 0) >= 50;
  const dicht = items.some((item) => item.waterproof);
  const regen = regenrisiko ? (dicht ? 1 : 0.3) : 0.6;

  const farbe = colorHarmony(items);
  const frisch = freshness(items, now);
  const vorlieben = model ? preferenceScore(featuresOf(items), model) : 0;

  const breakdown = { wetter, anlass: passung, vorlieben, farbe, frische: frisch, regen };
  const score =
    wetter * WEIGHTS.wetter +
    passung * WEIGHTS.anlass +
    vorlieben * WEIGHTS.vorlieben +
    farbe * WEIGHTS.farbe +
    frisch * WEIGHTS.frische +
    regen * WEIGHTS.regen;

  return { score, breakdown, warmth: waerme, formality: formalitaet };
}

// --- Vorschläge bauen ----------------------------------------------------

/**
 * Zufall, der sich wiederholen lässt.
 *
 * Ohne Saat käme bei jedem Neuzeichnen der Startseite ein anderes Outfit
 * heraus -- die Liste flackerte bei jedem Tastendruck. Mit Saat bleibt der
 * Vorschlag stehen, bis jemand "Mehr erstellen" drückt.
 */
export function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Die Teile eines Fachs, die für diesen Anlass in Frage kommen.
 *
 * Der Rückfall am Ende ist wichtiger, als er aussieht: Wer nur
 * Jogginghosen besitzt, soll für "Arbeit" trotzdem einen Vorschlag
 * bekommen -- einen schlechten, aber einen. Eine leere Seite mit dem
 * Hinweis "nichts Passendes gefunden" hilft beim Anziehen nicht.
 */
export function candidatesFor(items, slot, occasion) {
  const imFach = items.filter((item) => item.slot === slot);
  const anlass = occasionById(occasion);
  const passend = imFach.filter(
    (item) => (item.formality ?? 2) >= anlass.min && (item.formality ?? 2) <= anlass.max,
  );
  return passend.length ? passend : imFach;
}

/**
 * Baut Vorschläge.
 *
 * Der Ablauf in drei Schritten, damit die Zahl der Kombinationen nicht
 * explodiert: Erst wird je Fach vorsortiert (wie gut passt das einzelne
 * Teil zu Wetter und Anlass?), dann werden nur die besten Handvoll je Fach
 * miteinander kombiniert, und erst diese vollständigen Outfits bekommen
 * die richtige Note. Ein Schrank mit 200 Teilen erzeugt so ein paar Hundert
 * Kombinationen statt Millionen.
 *
 * @returns {Array<{itemIds:string[], items:object[], score:number, breakdown:object, reason:string}>}
 */
export function suggestOutfits(items, options = {}) {
  const {
    weather = null,
    occasion = 'alltag',
    model = null,
    count = 4,
    seed = 1,
    now = new Date(),
    breite = 4,
  } = options;

  const lebende = items.filter((item) => !item.deleted);
  const random = seededRandom(seed);
  const ziel = targetWarmth(weather);
  const gefunden = [];

  for (const blueprint of BLUEPRINTS) {
    const slots = [...blueprint.required];
    if (needsOuter(weather)) slots.push('outer');
    if (needsHeadwear(weather)) slots.push('headwear');
    // Accessoires kommen mit, sobald es welche gibt. Sie sind es, die aus
    // "angezogen" ein Outfit machen -- und wer eine Uhr erfasst hat, trägt
    // sie ohnehin jeden Tag.
    if (lebende.some((item) => item.slot === 'accessory')) slots.push('accessory');

    // Die Vorauswahl je Fach.
    const pools = [];
    let vollstaendig = true;
    for (const slot of slots) {
      const kandidaten = candidatesFor(lebende, slot, occasion);
      if (!kandidaten.length) {
        // Ohne Jacke oder Mütze geht es zur Not auch; ohne Schuhe nicht.
        if (blueprint.required.includes(slot)) vollstaendig = false;
        continue;
      }
      pools.push(
        kandidaten
          .map((item) => ({ item, vor: einzelnote(item, { ziel, occasion, model, now, random }) }))
          .sort((a, b) => b.vor - a.vor)
          .slice(0, breite)
          .map((eintrag) => eintrag.item),
      );
    }
    if (!vollstaendig || !pools.length) continue;

    for (const kombination of kartesisch(pools)) {
      const bewertung = scoreOutfit(kombination, { weather, occasion, model, now });
      gefunden.push({
        itemIds: kombination.map((item) => item.id),
        items: kombination,
        // Ein Hauch Zufall, damit bei gleichwertigen Kombinationen nicht
        // immer dieselbe gewinnt.
        score: bewertung.score + random() * JITTER.kombination,
        breakdown: bewertung.breakdown,
        warmth: bewertung.warmth,
      });
    }
  }

  gefunden.sort((a, b) => b.score - a.score);

  return waehleVerschiedene(gefunden, count).map((vorschlag) => ({
    ...vorschlag,
    reason: explain(vorschlag, { weather, occasion }),
  }));
}

/**
 * Wie viel Zufall in die Auswahl kommt.
 *
 * Das ist die Stellschraube hinter "Mehr erstellen", und sie ist heikler,
 * als sie aussieht. Zu wenig, und jede Saat liefert dasselbe Outfit -- der
 * Knopf tut dann sichtbar nichts. Zu viel, und der Vorschlag ist bloß
 * gewürfelt; das Wollhemd landet im August auf der Startseite.
 *
 * Die Werte sind deshalb an den Gewichten gemessen, gegen die sie
 * antreten: `teil` liegt in der Größenordnung eines einzelnen
 * Gesichtspunkts der Vorauswahl (die zusammen etwa 5,6 ergeben), und
 * `kombination` bleibt deutlich unter dem Wettergewicht von 3. Ähnlich
 * gute Sachen tauschen so die Plätze, unpassende steigen nicht auf.
 */
export const JITTER = { teil: 1.2, kombination: 0.4 };

/** Vorsortierung eines einzelnen Teils -- grob, aber schnell. */
function einzelnote(item, { ziel, occasion, model, now, random }) {
  const anlass = occasionById(occasion);
  const waerme = 1 - Math.min(1, Math.abs((item.warmth ?? 2) - ziel) / 4);
  const passung = 1 - Math.min(1, Math.abs((item.formality ?? 2) - anlass.target) / 3);
  const tage = daysSince(item.lastWornAt, now);
  const frisch = tage === null ? 1 : Math.min(1, tage / 21);
  const gemocht = model?.weights?.get(`teil:${item.id}`)?.weight ?? 0;

  return waerme * 2 + passung * 1.5 + frisch * 0.6 + gemocht * 1.5 + random() * JITTER.teil;
}

/** Alle Kombinationen aus je einem Teil pro Fach. */
function* kartesisch(pools, index = 0, gewaehlt = []) {
  if (index === pools.length) {
    yield [...gewaehlt];
    return;
  }
  for (const item of pools[index]) {
    gewaehlt.push(item);
    yield* kartesisch(pools, index + 1, gewaehlt);
    gewaehlt.pop();
  }
}

/**
 * Wählt aus den besten Kombinationen die aus, die sich voneinander
 * unterscheiden.
 *
 * Ohne diesen Schritt wären die vier Vorschläge viermal dasselbe Outfit mit
 * wechselnden Schuhen -- rechnerisch die vier besten Ergebnisse, praktisch
 * ein einziger Vorschlag. Verlangt wird deshalb: mindestens zwei Teile
 * anders als bei jedem schon gewählten.
 */
export function waehleVerschiedene(vorschlaege, count, mindestUnterschied = 2) {
  const gewaehlt = [];

  for (const vorschlag of vorschlaege) {
    if (gewaehlt.length >= count) break;
    const zuAehnlich = gewaehlt.some((anderer) => {
      const gemeinsam = vorschlag.itemIds.filter((id) => anderer.itemIds.includes(id)).length;
      return vorschlag.itemIds.length - gemeinsam < mindestUnterschied;
    });
    if (!zuAehnlich) gewaehlt.push(vorschlag);
  }

  // Lieber ein ähnlicher vierter Vorschlag als eine Lücke: Bei einem kleinen
  // Schrank gibt es schlicht nicht genug wirklich verschiedene Outfits.
  for (const vorschlag of vorschlaege) {
    if (gewaehlt.length >= count) break;
    if (!gewaehlt.includes(vorschlag)) gewaehlt.push(vorschlag);
  }

  return gewaehlt;
}

/**
 * Warum dieses Outfit?
 *
 * Genannt wird der Gesichtspunkt, der tatsächlich den Ausschlag gab -- und
 * wenn keiner hervorsticht, wird auch nichts behauptet. Eine erfundene
 * Begründung ("passt perfekt zu dir!") ist schlimmer als keine: Sie ist das
 * Erste, was auffällt, wenn sie nicht stimmt.
 */
export function explain(vorschlag, { weather, occasion } = {}) {
  const { breakdown = {} } = vorschlag;
  const anlass = occasionById(occasion);

  if ((weather?.rainChance ?? 0) >= 50 && breakdown.regen >= 1) return 'Hält den Regen ab';
  if (breakdown.wetter >= 0.9 && weather?.tempMax !== null && weather?.tempMax !== undefined) {
    const grad = Math.round((weather.tempMin ?? weather.tempMax) ?? 0);
    return `Warm genug für ${grad} °C`;
  }
  if (breakdown.vorlieben >= 0.12) return 'Nah an deinem Stil';
  if (breakdown.frische >= 0.95) return 'Lange nicht getragen';
  if (breakdown.farbe >= 1) return 'Farblich stimmig';
  if (breakdown.anlass >= 0.9) return `Passend für ${anlass.label}`;
  return '';
}

/**
 * Was dem Schrank fehlt, um überhaupt etwas vorschlagen zu können.
 *
 * Beantwortet die Frage der leeren Startseite: nicht "nichts gefunden",
 * sondern "dir fehlen noch Schuhe".
 */
export function missingSlots(items) {
  const vorhanden = new Set(items.filter((item) => !item.deleted).map((item) => item.slot));
  const fehlt = [];

  if (!vorhanden.has('shoes')) fehlt.push('shoes');
  // Oberteil und Hose zusammen sind ersetzbar durch ein Kleid -- deshalb
  // fehlen sie nur, wenn es auch kein Kleid gibt.
  if (!vorhanden.has('dress')) {
    if (!vorhanden.has('top')) fehlt.push('top');
    if (!vorhanden.has('bottom')) fehlt.push('bottom');
  }
  return fehlt;
}
