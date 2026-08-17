/**
 * Fachlogik: Kleidungsstücke, Outfits, Bewertungen.
 *
 * Drei Arten von Datensätzen, mit drei sehr verschiedenen Lebensläufen:
 *
 *  - Ein **Kleidungsstück** (`item`) ändert sich selten, aber es wird
 *    getragen -- und jedes Tragen ist eine Information: Was oft an ist,
 *    mag man; was seit einem Jahr hängt, hat man vergessen.
 *  - Ein **Outfit** ist eine Zusammenstellung, die jemand behalten wollte.
 *    Vorschläge, die niemand gespeichert hat, werden nicht aufbewahrt --
 *    sie lassen sich jederzeit neu rechnen.
 *  - Eine **Bewertung** (`rating`) wird nie geändert und nie gelöscht. Sie
 *    ist das Gedächtnis des Trainings; ein nachträglich verändertes Urteil
 *    machte den gelernten Stand unerklärlich.
 */

import { newId } from './storage.js';
import { guessAttributes } from './slots.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const VERDICT = { LIKE: 1, DISLIKE: -1 };

export const DEFAULT_SETTINGS = {
  /**
   * Ab wie vielen Tagen ohne Tragen ein Teil als "lange nicht an" gilt.
   * Eine Saison ist die richtige Größenordnung: Wer im August seinen
   * Wintermantel vermisst, hat ein anderes Problem.
   */
  forgottenDays: 120,
  /** Wie viele Vorschläge die Startseite zeigt. */
  suggestionCount: 4,
};

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export function daysSince(dateish, from = today()) {
  if (!dateish) return null;
  const past = new Date(dateish);
  past.setHours(0, 0, 0, 0);
  return Math.round((from.getTime() - past.getTime()) / DAY_MS);
}

// --- Kleidungsstücke -----------------------------------------------------

/**
 * Legt ein Kleidungsstück an -- alles, was nicht gesagt wurde, wird geraten.
 *
 * `photoId` ist bewusst gleich der `id`: Ein Teil hat genau ein Foto, und
 * ein eigener Schlüssel wäre nur eine zweite Stelle, an der etwas
 * auseinanderlaufen kann.
 */
export function createItem(data) {
  const id = data.id ?? newId('item');
  const name = String(data.name ?? '').trim();
  const guessed = guessAttributes(name, data);

  return {
    id,
    name,
    brand: String(data.brand ?? '').trim(),
    ...guessed,
    photoId: data.hasPhoto ? id : null,
    /**
     * Zwei Angaben, und sie sind wirklich zwei:
     *
     * `hasCutout` sagt, dass eine freigestellte Fassung *abgelegt ist*,
     * `cutout`, dass sie *gezeigt wird*. Ohne die Trennung wäre der
     * Schalter eine Einbahnstraße -- wer den Hintergrund einmal wieder
     * einblendet, hätte danach nichts mehr, wovon die App wüsste, dass es
     * auch anders geht.
     */
    cutout: data.cutout ?? false,
    hasCutout: data.hasCutout ?? false,
    favorite: data.favorite ?? false,
    createdAt: data.createdAt ?? new Date().toISOString(),
    wornCount: data.wornCount ?? 0,
    lastWornAt: data.lastWornAt ?? null,
  };
}

export async function addItem(store, data) {
  const item = createItem(data);
  await store.put('items', item);
  return item;
}

/**
 * Ändert ein Kleidungsstück.
 *
 * Wird der Name geändert, werden die *geratenen* Angaben neu geraten -- aber
 * nur die: Wer die Wärme einmal von Hand korrigiert hat, will nicht, dass
 * eine Umbenennung sie wieder überschreibt. Deshalb merkt sich der
 * Datensatz in `touched`, was von Hand gesetzt wurde.
 */
export async function updateItem(store, id, changes) {
  const existing = store.byId('items', id);
  if (!existing) return undefined;

  const touched = new Set([...(existing.touched ?? []), ...Object.keys(changes)]);
  const name = changes.name !== undefined ? String(changes.name).trim() : existing.name;

  const kept = {};
  for (const field of ['slot', 'warmth', 'formality', 'colors', 'waterproof']) {
    if (touched.has(field)) kept[field] = changes[field] ?? existing[field];
  }

  const updated = {
    ...existing,
    ...changes,
    name,
    ...guessAttributes(name, kept),
    touched: [...touched].filter((field) =>
      ['slot', 'warmth', 'formality', 'colors', 'waterproof'].includes(field),
    ),
  };
  return store.put('items', updated);
}

/** Ein Teil wurde getragen -- die wichtigste Rückmeldung, die es gibt. */
export async function wearItems(store, itemIds, when = new Date()) {
  const stamp = when.toISOString();
  const entries = [];
  for (const id of itemIds) {
    const item = store.byId('items', id);
    if (!item) continue;
    entries.push(['items', { ...item, wornCount: (item.wornCount ?? 0) + 1, lastWornAt: stamp }]);
  }
  if (entries.length) await store.putMany(entries);
  return entries.length;
}

/**
 * Wie oft ein Teil pro Monat an ist.
 *
 * Gerechnet ab dem Tag, an dem es erfasst wurde -- ein Teil, das seit einer
 * Woche im Schrank ist und einmal an war, ist nicht "vier Mal im Monat".
 * Unter zwei Wochen wird deshalb gar nichts behauptet.
 */
export function wearRate(item, from = today()) {
  const age = daysSince(item.createdAt, from);
  if (age === null || age < 14) return null;
  return ((item.wornCount ?? 0) / age) * 30;
}

/**
 * Teile, die nur noch Platz brauchen.
 *
 * Nicht als Vorwurf gemeint, sondern als Angebot: Ein Schrank, in dem
 * dreißig Teile hängen, die nie an sind, macht das Suchen für alle anderen
 * schwerer.
 */
export function forgottenItems(items, { forgottenDays = DEFAULT_SETTINGS.forgottenDays } = {}, from = today()) {
  return items
    .filter((item) => {
      const age = daysSince(item.createdAt, from);
      if (age === null || age < forgottenDays) return false;
      const worn = daysSince(item.lastWornAt, from);
      return worn === null || worn >= forgottenDays;
    })
    .sort((a, b) => (a.lastWornAt ?? '').localeCompare(b.lastWornAt ?? ''));
}

/** Was der Schrank hergibt, nach Fächern gezählt. */
export function countBySlot(items) {
  const counts = {};
  for (const item of items) counts[item.slot] = (counts[item.slot] ?? 0) + 1;
  return counts;
}

// --- Outfits -------------------------------------------------------------

export function createOutfit(data) {
  return {
    id: data.id ?? newId('fit'),
    itemIds: [...(data.itemIds ?? [])],
    label: String(data.label ?? '').trim(),
    occasion: data.occasion ?? 'alltag',
    /**
     * Wo die Teile auf der Fläche liegen, in Anteilen der Fläche.
     * Leer heißt: noch nie angefasst -- dann gilt die Grundanordnung aus
     * `layout.js`, und die wird nicht mitgespeichert. Eine ausgerechnete
     * Voreinstellung in den Daten festzuhalten hieße, sie nie wieder
     * verbessern zu können.
     */
    layout: data.layout ?? {},
    createdAt: data.createdAt ?? new Date().toISOString(),
    wornCount: data.wornCount ?? 0,
    lastWornAt: data.lastWornAt ?? null,
  };
}

export async function saveOutfit(store, data) {
  const outfit = createOutfit(data);
  await store.put('outfits', outfit);
  return outfit;
}

/**
 * Ein Outfit wurde getragen: zählt beim Outfit *und* bei jedem Teil darin.
 *
 * Beides zu zählen ist keine Doppelung -- die eine Zahl beantwortet "welche
 * Kombination trage ich gern", die andere "welches Teil trage ich
 * überhaupt". Ein Hemd kann in fünf Outfits stecken und trotzdem selten an
 * sein.
 */
export async function wearOutfit(store, outfitId, when = new Date()) {
  const outfit = store.byId('outfits', outfitId);
  if (!outfit) return undefined;
  await wearItems(store, outfit.itemIds, when);
  return store.put('outfits', {
    ...outfit,
    wornCount: (outfit.wornCount ?? 0) + 1,
    lastWornAt: when.toISOString(),
  });
}

/** Die Teile eines Outfits, in der Reihenfolge der Fächer. */
export function itemsOf(outfit, items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (outfit.itemIds ?? []).map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Ist dieses Outfit noch vollständig?
 *
 * Ein gespeichertes Outfit kann Teile enthalten, die inzwischen aussortiert
 * wurden. Es dann klaglos mit einer Lücke anzuzeigen wäre schlechter als
 * ein ehrlicher Hinweis.
 */
export function isComplete(outfit, items) {
  return itemsOf(outfit, items).length === (outfit.itemIds ?? []).length;
}

// --- Bewertungen ---------------------------------------------------------

/**
 * Hält ein Urteil fest.
 *
 * Die Merkmale werden hier eingefroren und nicht später aus den Teilen neu
 * berechnet. Der Grund ist unscheinbar, aber entscheidend: Wer ein Teil
 * aussortiert, soll damit nicht rückwirkend ändern, was die App gelernt
 * hat. Das Urteil galt dem Outfit, wie es an dem Tag aussah.
 */
export function createRating({ itemIds, verdict, features, context = {} }) {
  return {
    id: newId('rate'),
    itemIds: [...(itemIds ?? [])],
    verdict: verdict >= 0 ? VERDICT.LIKE : VERDICT.DISLIKE,
    features: [...(features ?? [])],
    context,
    createdAt: new Date().toISOString(),
  };
}

export async function rateOutfit(store, rating) {
  const record = createRating(rating);
  await store.put('ratings', record);
  return record;
}
