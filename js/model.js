/**
 * Fachlogik: Produkte, Chargen, Buchungen.
 *
 * Ein Produkt ist die Sorte ("Fusilli 500g"). Der Bestand hängt aber an
 * Chargen (`lots`), weil dieselbe Sorte mit unterschiedlichen Mindest-
 * haltbarkeitsdaten im Schrank steht. Verbraucht wird nach FEFO -- was
 * zuerst abläuft, geht zuerst raus. Das ist die Reihenfolge, in der man
 * ohnehin greifen sollte, und nur so stimmen die MHD-Warnungen.
 */

import { newId } from './storage.js';
import { assessProduct, DAY_MS } from './forecast.js';

export const EVENT_TYPES = {
  PURCHASE: 'purchase',
  CONSUME: 'consume',
  DISCARD: 'discard',
  CORRECTION: 'correction',
};

export const DEFAULT_SETTINGS = {
  /** So viele Tage Vorlauf, bevor etwas auf die Einkaufsliste wandert. */
  leadDays: 7,
  /** Ab wann ein MHD als "läuft ab" gilt. */
  expiryWarnDays: 5,
};

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export function daysUntil(dateish, from = today()) {
  if (!dateish) return null;
  const target = new Date(dateish);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - from.getTime()) / DAY_MS);
}

/** Chargen eines Produkts, in der Reihenfolge, in der sie verbraucht werden. */
export function lotsFor(lots, productId) {
  return lots
    .filter((lot) => lot.productId === productId && lot.qty > 0)
    .sort((a, b) => {
      // Ohne MHD ans Ende: Vorräte mit Ablaufdatum haben Vorrang.
      if (!a.bestBefore && !b.bestBefore) return (a.addedAt ?? '').localeCompare(b.addedAt ?? '');
      if (!a.bestBefore) return 1;
      if (!b.bestBefore) return -1;
      return a.bestBefore.localeCompare(b.bestBefore);
    });
}

export function stockOf(lots, productId) {
  return lots.reduce((sum, lot) => (lot.productId === productId ? sum + (lot.qty ?? 0) : sum), 0);
}

/**
 * Die Charge, die am dringendsten aufgebraucht werden sollte.
 * @returns {{lot:object, days:number}|null}
 */
export function nextExpiry(lots, productId, from = today()) {
  const withDate = lotsFor(lots, productId).filter((lot) => lot.bestBefore);
  if (!withDate.length) return null;
  const lot = withDate[0];
  return { lot, days: daysUntil(lot.bestBefore, from) };
}

/**
 * Verteilt eine Verbrauchsmenge nach FEFO auf die Chargen.
 *
 * Reine Funktion -- sie ändert nichts, sondern beschreibt nur, welche
 * Chargen wie stark schrumpfen. Das macht sie testbar und hält die
 * Schreibvorgänge an einer Stelle.
 *
 * @returns {{updates:Array<{lot:object, qty:number}>, taken:number, short:number}}
 */
export function planConsumption(lots, productId, qty) {
  const queue = lotsFor(lots, productId);
  const updates = [];
  let remaining = qty;

  for (const lot of queue) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    updates.push({ lot, qty: lot.qty - take });
    remaining -= take;
  }

  return { updates, taken: qty - remaining, short: remaining };
}

/**
 * Bündelt Store-Zugriffe zu den Vorgängen, die die Oberfläche kennt.
 */
export class Pantry {
  /**
   * Zustand vor der letzten Buchung, für "Rückgängig".
   * Auf dem Handy vertippt man sich beim schnellen Abhaken leicht, und eine
   * falsche Buchung verzerrt sonst dauerhaft die Prognose.
   * @type {{lots:Array, eventIds:Array<string>, label:string}|null}
   */
  #undo = null;

  constructor(store) {
    this.store = store;
  }

  get settings() {
    return {
      leadDays: this.store.getSetting('leadDays', DEFAULT_SETTINGS.leadDays),
      expiryWarnDays: this.store.getSetting('expiryWarnDays', DEFAULT_SETTINGS.expiryWarnDays),
    };
  }

  products() {
    return this.store.all('products').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  lots() {
    return this.store.all('lots');
  }

  events() {
    return this.store.all('events');
  }

  eventsFor(productId) {
    return this.events().filter((e) => e.productId === productId);
  }

  findByBarcode(barcode) {
    if (!barcode) return undefined;
    return this.products().find((p) => p.barcode === barcode);
  }

  async createProduct({ name, barcode = null, minStock = 1, note = '' }) {
    const product = {
      id: newId('p'),
      name: name.trim(),
      barcode: barcode || null,
      minStock: Number(minStock) || 0,
      note,
      createdAt: new Date().toISOString(),
    };
    await this.store.put('products', product);
    return product;
  }

  async updateProduct(product, changes) {
    return this.store.put('products', { ...product, ...changes });
  }

  async deleteProduct(productId) {
    const lots = this.lots().filter((l) => l.productId === productId);
    for (const lot of lots) await this.store.remove('lots', lot.id);
    await this.store.remove('products', productId);
    // Buchungen bleiben stehen: sie sind die Historie, kein Bestand.
  }

  #event(productId, type, qty, extra = {}) {
    return {
      id: newId('e'),
      ts: new Date().toISOString(),
      productId,
      type,
      qty,
      ...extra,
    };
  }

  /** Merkt sich die betroffenen Chargen im Zustand *vor* der Änderung. */
  #snapshot(lotIds, eventIds, label) {
    const lots = this.lots();
    this.#undo = {
      lots: lotIds.map((id) => lots.find((l) => l.id === id)).filter(Boolean).map((l) => ({ ...l })),
      newLotIds: lotIds.filter((id) => !lots.some((l) => l.id === id)),
      eventIds,
      label,
    };
  }

  get undoLabel() {
    return this.#undo?.label ?? null;
  }

  /** Macht die zuletzt gebuchte Änderung rückgängig. */
  async undo() {
    if (!this.#undo) return false;
    const { lots, newLotIds, eventIds } = this.#undo;
    this.#undo = null;

    if (lots.length) await this.store.putMany(lots.map((lot) => ['lots', lot]));
    for (const id of newLotIds) await this.store.remove('lots', id);
    for (const id of eventIds) await this.store.remove('events', id);
    return true;
  }

  /** Einkauf einbuchen: eine neue Charge anlegen. */
  async addStock(productId, qty, bestBefore = null) {
    const [lot] = await this.addStockBatches(productId, [{ qty, bestBefore }]);
    return lot;
  }

  /**
   * Einkauf mit unterschiedlichen Haltbarkeitsdaten einbuchen.
   *
   * Drei Joghurts aus demselben Einkauf können drei verschiedene Daten
   * tragen. Jedes Datum bekommt deshalb seine eigene Charge -- nur so kann
   * die App später sagen, welche Packung zuerst weg muss.
   *
   * Gebucht wird trotzdem ein einziger Einkauf: Für die Verbrauchsprognose
   * zählt, wie viel gekauft wurde, nicht auf wie viele Daten es sich
   * verteilt.
   *
   * @param {string} productId
   * @param {Array<{qty:number, bestBefore?:string|null}>} batches
   * @returns {Promise<Array>} die angelegten Chargen
   */
  async addStockBatches(productId, batches) {
    const now = new Date().toISOString();
    const lots = [];

    // Gleiche Daten zusammenfassen: Wer dreimal dasselbe Datum einträgt,
    // will eine Charge zu drei Stück, nicht drei Zeilen im Schrank.
    const byDate = new Map();
    for (const batch of batches ?? []) {
      const amount = Math.max(0, Math.round(Number(batch?.qty) || 0));
      if (amount <= 0) continue;
      const key = batch?.bestBefore || '';
      byDate.set(key, (byDate.get(key) ?? 0) + amount);
    }

    for (const [bestBefore, qty] of byDate) {
      lots.push({ id: newId('l'), productId, qty, bestBefore: bestBefore || null, addedAt: now });
    }
    if (!lots.length) return [];

    const total = lots.reduce((sum, lot) => sum + lot.qty, 0);
    const event = this.#event(productId, EVENT_TYPES.PURCHASE, total, { lotId: lots[0].id });
    this.#snapshot(lots.map((lot) => lot.id), [event.id], `${total} eingebucht`);

    await this.store.putMany([
      ...lots.map((lot) => ['lots', lot]),
      ['events', event],
    ]);
    return lots;
  }

  /**
   * Das Haltbarkeitsdatum einer vorhandenen Charge setzen oder entfernen.
   *
   * Bewusst ohne Buchung: Am Bestand ändert sich nichts, und für die
   * Verbrauchsprognose ist ein nachgetragenes Datum ohne Bedeutung.
   */
  async setLotExpiry(lotId, bestBefore) {
    const lot = this.store.byId('lots', lotId);
    if (!lot) return null;
    this.#snapshot([lot.id], [], 'Haltbarkeit geändert');
    return this.store.put('lots', { ...lot, bestBefore: bestBefore || null });
  }

  /**
   * Einen Teil einer Charge herauslösen und ihm ein eigenes Datum geben.
   *
   * Für den Fall, dass erst beim Einräumen auffällt, dass nicht alle
   * Packungen gleich lang halten. Der Bestand bleibt unverändert, es wird
   * nur anders aufgeteilt -- deshalb auch hier keine Buchung.
   *
   * @returns {Promise<object|null>} die abgetrennte Charge
   */
  async splitLot(lotId, qty, bestBefore) {
    const lot = this.store.byId('lots', lotId);
    if (!lot) return null;

    const amount = Math.max(1, Math.round(Number(qty) || 1));
    // Die ganze Charge abzutrennen hieße nur, ihr Datum zu ändern.
    if (amount >= lot.qty) {
      await this.setLotExpiry(lotId, bestBefore);
      return this.store.byId('lots', lotId);
    }

    const split = {
      id: newId('l'),
      productId: lot.productId,
      qty: amount,
      bestBefore: bestBefore || null,
      addedAt: lot.addedAt,
    };
    this.#snapshot([lot.id, split.id], [], 'Charge aufgeteilt');
    await this.store.putMany([
      ['lots', { ...lot, qty: lot.qty - amount }],
      ['lots', split],
    ]);
    return split;
  }

  /**
   * Eine Charge entsorgen -- abgelaufen, verdorben, aussortiert.
   *
   * Wird als `discard` gebucht und nicht als Verbrauch: Weggeworfenes sagt
   * nichts darüber aus, wie schnell etwas aufgebraucht wird, und würde die
   * Prognose sonst zu hoch ansetzen.
   */
  async discardLot(lotId) {
    const lot = this.store.byId('lots', lotId);
    if (!lot || lot.qty <= 0) return false;

    const event = this.#event(lot.productId, EVENT_TYPES.DISCARD, lot.qty, { lotId: lot.id });
    this.#snapshot([lot.id], [event.id], `${lot.qty} entsorgt`);
    await this.store.putMany([
      ['lots', { ...lot, qty: 0 }],
      ['events', event],
    ]);
    return true;
  }

  /**
   * Verbrauch buchen. Nimmt nach FEFO aus den Chargen.
   * @returns {{taken:number, short:number}} tatsächlich gebucht / nicht gedeckt
   */
  async consume(productId, qty = 1, type = EVENT_TYPES.CONSUME) {
    const amount = Math.max(1, Math.round(Number(qty) || 1));
    const { updates, taken, short } = planConsumption(this.lots(), productId, amount);
    if (taken <= 0) return { taken: 0, short };

    const event = this.#event(productId, type, taken);
    this.#snapshot(updates.map(({ lot }) => lot.id), [event.id], `${taken} verbraucht`);

    const writes = updates.map(({ lot, qty: next }) => ['lots', { ...lot, qty: next }]);
    writes.push(['events', event]);
    await this.store.putMany(writes);
    return { taken, short };
  }

  /**
   * Bestand direkt setzen (Inventur).
   *
   * Bewusst als `correction` gebucht und nicht als Verbrauch: eine Korrektur
   * sagt nichts darüber aus, wie schnell etwas weggeht, und darf die
   * Prognose deshalb nicht verfälschen.
   */
  async setStock(productId, qty, bestBefore = null) {
    const target = Math.max(0, Math.round(Number(qty) || 0));
    const current = stockOf(this.lots(), productId);
    if (target === current) return;

    if (target > current) {
      const lot = {
        id: newId('l'),
        productId,
        qty: target - current,
        bestBefore: bestBefore || null,
        addedAt: new Date().toISOString(),
      };
      const event = this.#event(productId, EVENT_TYPES.CORRECTION, target - current);
      this.#snapshot([lot.id], [event.id], `Bestand auf ${target} gesetzt`);
      await this.store.putMany([
        ['lots', lot],
        ['events', event],
      ]);
      return;
    }

    const { updates } = planConsumption(this.lots(), productId, current - target);
    const event = this.#event(productId, EVENT_TYPES.CORRECTION, current - target);
    this.#snapshot(updates.map(({ lot }) => lot.id), [event.id], `Bestand auf ${target} gesetzt`);

    const writes = updates.map(({ lot, qty: next }) => ['lots', { ...lot, qty: next }]);
    writes.push(['events', event]);
    await this.store.putMany(writes);
  }

  /** Alles, was die Oberfläche über ein Produkt wissen muss. */
  assess(product, now = new Date()) {
    const lots = this.lots();
    const stock = stockOf(lots, product.id);
    const assessment = assessProduct({
      product,
      stock,
      events: this.eventsFor(product.id),
      now,
      leadDays: this.settings.leadDays,
    });
    return { product, ...assessment, expiry: nextExpiry(lots, product.id) };
  }

  assessAll(now = new Date()) {
    return this.products().map((p) => this.assess(p, now));
  }

  /**
   * Einkaufsliste: alles, was leer ist, unter dem Mindestbestand liegt oder
   * demnächst ausgeht. Dringendstes zuerst.
   */
  shoppingList(now = new Date()) {
    return this.assessAll(now)
      .filter((item) => item.need)
      .sort((a, b) => {
        if (b.need.urgency !== a.need.urgency) return b.need.urgency - a.need.urgency;
        const da = a.projection.daysLeft ?? Infinity;
        const db = b.projection.daysLeft ?? Infinity;
        return da - db;
      });
  }

  /** Chargen, deren MHD bald erreicht ist oder schon überschritten wurde. */
  expiringSoon(now = new Date()) {
    const limit = this.settings.expiryWarnDays;
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const byProduct = new Map(this.products().map((p) => [p.id, p]));

    return this.lots()
      .filter((lot) => lot.qty > 0 && lot.bestBefore && byProduct.has(lot.productId))
      .map((lot) => ({ lot, product: byProduct.get(lot.productId), days: daysUntil(lot.bestBefore, from) }))
      .filter((entry) => entry.days <= limit)
      .sort((a, b) => a.days - b.days);
  }
}
