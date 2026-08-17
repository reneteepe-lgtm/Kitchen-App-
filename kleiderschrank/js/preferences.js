/**
 * Die gelernten Stilvorlieben -- das, was die App "Training" nennt.
 *
 * Was hier passiert, ist absichtlich klein und nachvollziehbar: Jedes
 * Outfit wird in eine Handvoll Merkmale zerlegt ("schwarz", "Sneaker",
 * "leger", "dieses Hemd"), und für jedes Merkmal wird gezählt, wie oft es in
 * einem gemochten und wie oft in einem abgelehnten Outfit vorkam. Das
 * Gewicht ist der Anteil daraus.
 *
 * Diese Bauweise hat drei Eigenschaften, die für eine App auf dem eigenen
 * Handy mehr wert sind als jede Raffinesse:
 *
 *  1. **Sie ist erklärbar.** "Schwarz: fünf von sechs Mal gemocht" lässt
 *     sich anzeigen. Eine gelernte Zahlenkolonne könnte man nur glauben.
 *  2. **Sie hängt nicht an der Reihenfolge.** Es gibt keine Lernrate, die
 *     zu hoch oder zu niedrig sein kann, und kein Ergebnis, das davon
 *     abhängt, in welcher Reihenfolge bewertet wurde. Dieselben Urteile
 *     ergeben immer denselben Stand -- auch wenn zwei Geräte ihre
 *     Bewertungen später zusammenwerfen.
 *  3. **Sie ist vorsichtig.** Ein einzelnes Urteil bewegt ein Gewicht nur
 *     ein Drittel des Weges. Wer einmal auf "gefällt mir nicht" tippt,
 *     verliert nicht seinen halben Schrank.
 *
 * Gelernt wird ausschließlich auf dem Gerät. Es geht nichts an einen Server,
 * und es kommt nichts von einem.
 */

import { normalize } from './text.js';
import { isNeutral, colorById, formalityLabel } from './slots.js';

/**
 * Wie stark ein Merkmal zur Mitte gezogen wird, solange es kaum Belege gibt.
 *
 * Bei 2 bedeutet ein einziges "gefällt mir" ein Gewicht von 1/3 statt 1 --
 * genug, um sich auszuwirken, zu wenig, um eine Regel daraus zu machen.
 */
export const SMOOTHING = 2;

/** So viele Bewertungen gelten als vollständiges Training. */
export const TRAINING_TARGET = 30;

// --- Merkmale ------------------------------------------------------------

/**
 * Zerlegt ein Outfit in die Merkmale, über die gelernt wird.
 *
 * Die Auswahl ist der eigentliche Entwurf. Zu feine Merkmale (die genaue
 * Kombination aller fünf Teile) kämen nie ein zweites Mal vor und wären
 * damit unlernbar; zu grobe ("ein Outfit") unterschieden nichts. Was hier
 * steht, kommt oft genug wieder, um Belege zu sammeln, und trägt trotzdem
 * Geschmack: Farben, Marken, wie schick, wie warm, und die einzelnen Teile.
 */
export function featuresOf(items) {
  if (!items?.length) return [];
  const features = new Set();

  const colors = new Set();
  for (const item of items) {
    features.add(`teil:${item.id}`);
    const brand = normalize(item.brand);
    if (brand) features.add(`marke:${brand}`);
    for (const color of item.colors ?? []) colors.add(color);
  }

  for (const color of colors) features.add(`farbe:${color}`);

  // Farbpaare sagen mehr über Geschmack als einzelne Farben: Wer Grün mag,
  // mag deshalb noch lange nicht Grün mit Rot. Neutrale bleiben außen vor --
  // sie passen ohnehin zu allem und trügen nur Rauschen bei.
  const bunt = [...colors].filter((color) => !isNeutral(color)).sort();
  for (let i = 0; i < bunt.length; i++) {
    for (let j = i + 1; j < bunt.length; j++) features.add(`paar:${bunt[i]}+${bunt[j]}`);
  }

  features.add(`stil:${Math.round(average(items.map((item) => item.formality ?? 2)))}`);
  features.add(`waerme:${Math.round(average(items.map((item) => item.warmth ?? 2)))}`);
  features.add(bunt.length === 0 ? 'basis:ruhig' : bunt.length === 1 ? 'basis:akzent' : 'basis:bunt');

  return [...features];
}

const average = (numbers) =>
  numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;

// --- Lernen --------------------------------------------------------------

/**
 * Zählt die Urteile zu Gewichten zusammen.
 *
 * @returns {{weights: Map<string, {likes:number, dislikes:number, weight:number}>, count:number}}
 */
export function learn(ratings, { smoothing = SMOOTHING } = {}) {
  const weights = new Map();

  for (const rating of ratings) {
    const liked = rating.verdict >= 0;
    for (const feature of rating.features ?? []) {
      const entry = weights.get(feature) ?? { likes: 0, dislikes: 0, weight: 0 };
      if (liked) entry.likes++;
      else entry.dislikes++;
      weights.set(feature, entry);
    }
  }

  for (const entry of weights.values()) {
    const total = entry.likes + entry.dislikes;
    entry.weight = (entry.likes - entry.dislikes) / (total + smoothing);
  }

  return { weights, count: ratings.length };
}

/**
 * Wie sehr entspricht dieses Outfit dem gelernten Geschmack? -1 bis 1.
 *
 * Gemittelt wird über *alle* Merkmale des Outfits, auch über die noch nie
 * bewerteten -- die zählen als 0. Das dämpft absichtlich: Ein Outfit, von
 * dem die App erst eine Kleinigkeit kennt, bekommt keine starke Meinung,
 * sondern eine schwache. Das ist der ehrlichere Zustand.
 */
export function preferenceScore(features, model) {
  if (!features?.length || !model?.weights?.size) return 0;
  const sum = features.reduce((acc, feature) => acc + (model.weights.get(feature)?.weight ?? 0), 0);
  return sum / features.length;
}

// --- Fortschritt ---------------------------------------------------------

/**
 * Wie weit ist das Training?
 *
 * Zwei Dinge zählen, und beide sind nötig:
 *
 *  - **Menge** (60 %): Ohne eine gewisse Zahl von Urteilen ist jedes
 *    Gewicht Zufall.
 *  - **Abdeckung** (40 %): Zwanzig Urteile über dieselben drei Teile sagen
 *    nichts über den Rest des Schranks. Erst wenn die Bewertungen breit
 *    streuen, kennt die App den Schrank und nicht bloß eine Ecke davon.
 *
 * Die Zahl ist deshalb kein Fortschrittsbalken für eine Arbeit, die
 * irgendwann fertig ist, sondern eine Aussage darüber, wie belastbar die
 * Vorschläge gerade sind.
 */
export function trainingProgress(ratings, items, { target = TRAINING_TARGET } = {}) {
  const count = ratings.length;
  const menge = Math.min(1, count / target);

  const bewertet = new Set();
  for (const rating of ratings) for (const id of rating.itemIds ?? []) bewertet.add(id);
  const lebende = items.filter((item) => !item.deleted);
  const abdeckung = lebende.length
    ? lebende.filter((item) => bewertet.has(item.id)).length / lebende.length
    : 0;

  const percent = Math.round((menge * 0.6 + abdeckung * 0.4) * 100);

  return {
    percent,
    count,
    coverage: abdeckung,
    level: percent >= 90 ? 'gut' : percent >= 25 ? 'laeuft' : 'anfang',
    label: percent >= 90 ? 'Gut trainiert' : percent >= 25 ? 'Training läuft' : 'Noch am Anfang',
    hint: describeNextStep({ count, target, coverage: abdeckung, items: lebende, bewertet }),
  };
}

/**
 * Der eine Satz, der sagt, was jetzt hilft.
 *
 * Er nennt immer die *engste* Ursache: Wer erst drei Teile im Schrank hat,
 * dem hilft Bewerten nicht weiter -- dem fehlen Kleidungsstücke.
 */
function describeNextStep({ count, target, coverage, items, bewertet }) {
  if (items.length < 6) return 'Erfasse ein paar Teile mehr, dann kann die App kombinieren.';
  if (count === 0) return 'Bewerte ein paar Vorschläge — danach kennt die App deinen Geschmack.';
  if (count < target) {
    const fehlen = target - count;
    return `Noch ${fehlen} ${fehlen === 1 ? 'Bewertung' : 'Bewertungen'} bis zum vollen Training.`;
  }
  if (coverage < 0.8) {
    const offen = items.filter((item) => !bewertet.has(item.id)).length;
    return `${offen} ${offen === 1 ? 'Teil wurde' : 'Teile wurden'} noch nie bewertet.`;
  }
  return 'Die App kennt deinen Stil. Bewerte weiter, wenn er sich ändert.';
}

// --- Erklären ------------------------------------------------------------

/** Ein Merkmal in Worten -- für die Anzeige im Trainingszentrum. */
export function describeFeature(feature, items = []) {
  const [kind, value] = String(feature).split(':');
  const byId = new Map(items.map((item) => [item.id, item]));

  switch (kind) {
    case 'farbe':
      return colorById(value)?.label ?? value;
    case 'paar': {
      const [a, b] = value.split('+');
      return `${colorById(a)?.label ?? a} mit ${colorById(b)?.label ?? b}`;
    }
    case 'marke':
      return value.replace(/\b\w/g, (c) => c.toUpperCase());
    case 'stil':
      return formalityLabel(Number(value));
    case 'waerme':
      return ['Sehr luftig', 'Luftig', 'Leicht', 'Mittel', 'Warm', 'Sehr warm'][Number(value)] ?? 'Mittel';
    case 'basis':
      return { ruhig: 'Ruhige Farben', akzent: 'Ein Farbakzent', bunt: 'Mehrere Farben' }[value] ?? value;
    case 'teil':
      return byId.get(value)?.name ?? null;
    default:
      return null;
  }
}

/**
 * Was die App zu wissen glaubt -- in zwei kurzen Listen.
 *
 * Gezeigt wird nur, wofür es mindestens zwei Belege gibt. Ein einzelnes
 * Urteil als "das magst du" auszugeben wäre eine Behauptung, die man
 * sofort widerlegen kann -- und danach glaubt niemand mehr die anderen.
 */
export function describePreferences(model, items = [], { minEvidence = 2, limit = 5 } = {}) {
  const rows = [];

  for (const [feature, entry] of model?.weights ?? []) {
    const total = entry.likes + entry.dislikes;
    if (total < minEvidence) continue;
    const label = describeFeature(feature, items);
    if (!label) continue;
    rows.push({ feature, label, weight: entry.weight, likes: entry.likes, dislikes: entry.dislikes });
  }

  const byStrength = (a, b) => Math.abs(b.weight) - Math.abs(a.weight) || b.likes - a.likes;

  return {
    liked: rows.filter((row) => row.weight > 0.15).sort(byStrength).slice(0, limit),
    disliked: rows.filter((row) => row.weight < -0.15).sort(byStrength).slice(0, limit),
  };
}
