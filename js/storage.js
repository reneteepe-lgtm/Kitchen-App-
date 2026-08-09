/**
 * Persistenz.
 *
 * Die App spricht nie direkt mit localStorage, sondern immer mit `Store`.
 * `Store` kennt seinerseits nur einen Adapter mit zwei Methoden (`read`,
 * `write`). Ein Cloud-Backend lässt sich damit später einhängen, ohne dass
 * irgendeine Zeile Anwendungslogik angefasst werden muss.
 *
 * Drei Entscheidungen sind bereits auf späteren Zwei-Geräte-Sync ausgelegt:
 *
 *  1. Jeder Datensatz trägt `updatedAt`. Beim Zusammenführen zweier Stände
 *     gewinnt der jüngere Schreibvorgang (Last-Write-Wins).
 *  2. Gelöscht wird nur weich (`deleted: true`). Eine harte Löschung wäre
 *     beim Merge nicht von "kennt den Datensatz noch nicht" unterscheidbar
 *     und würde von einem alten Gerät wieder auferstehen.
 *  3. Buchungen (`events`) werden nie verändert, nur angehängt. Zwei
 *     Ereignislisten lassen sich dadurch konfliktfrei vereinigen.
 */

export const COLLECTIONS = ['products', 'lots', 'events', 'wishes'];

const emptyState = () => ({
  products: {},
  lots: {},
  events: {},
  // Von Hand auf die Einkaufsliste geschriebene Einträge.
  wishes: {},
  settings: {},
});

/** Adapter für den Browser. */
export class LocalStorageAdapter {
  constructor(key = 'kuechenvorrat.v1', storage = globalThis.localStorage) {
    this.key = key;
    this.storage = storage;
  }

  async read() {
    try {
      const raw = this.storage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error('Konnte gespeicherte Daten nicht lesen:', err);
      return null;
    }
  }

  async write(state) {
    this.storage.setItem(this.key, JSON.stringify(state));
  }
}

/** Adapter ohne Persistenz -- für Tests. */
export class MemoryAdapter {
  constructor(initial = null) {
    this.state = initial;
  }
  async read() {
    return this.state;
  }
  async write(state) {
    this.state = JSON.parse(JSON.stringify(state));
  }
}

export class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = emptyState();
    this.listeners = new Set();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    const loaded = await this.adapter.read();
    if (loaded) this.state = { ...emptyState(), ...loaded };
    return this;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #notify() {
    for (const listener of this.listeners) listener(this.state);
  }

  /**
   * Schreibvorgänge werden serialisiert, damit zwei schnell aufeinander
   * folgende Buchungen sich nicht gegenseitig überschreiben.
   */
  #persist() {
    this.writeQueue = this.writeQueue
      .then(() => this.adapter.write(this.state))
      .catch((err) => console.error('Speichern fehlgeschlagen:', err));
    return this.writeQueue;
  }

  /** Alle lebenden Datensätze einer Collection. */
  all(collection) {
    return Object.values(this.state[collection] ?? {}).filter((r) => !r.deleted);
  }

  byId(collection, id) {
    const record = this.state[collection]?.[id];
    return record && !record.deleted ? record : undefined;
  }

  async put(collection, record) {
    const stored = { ...record, updatedAt: new Date().toISOString() };
    this.state[collection][record.id] = stored;
    await this.#persist();
    this.#notify();
    return stored;
  }

  /** Mehrere Änderungen als ein Schreib-/Render-Vorgang. */
  async putMany(entries) {
    const now = new Date().toISOString();
    for (const [collection, record] of entries) {
      this.state[collection][record.id] = { ...record, updatedAt: now };
    }
    await this.#persist();
    this.#notify();
  }

  async remove(collection, id) {
    const existing = this.state[collection]?.[id];
    if (!existing) return;
    this.state[collection][id] = {
      ...existing,
      deleted: true,
      updatedAt: new Date().toISOString(),
    };
    await this.#persist();
    this.#notify();
  }

  getSetting(key, fallback) {
    return this.state.settings?.[key] ?? fallback;
  }

  async setSetting(key, value) {
    this.state.settings = { ...this.state.settings, [key]: value };
    await this.#persist();
    this.#notify();
  }

  // --- Sicherung und späterer Sync ---------------------------------------

  export() {
    return JSON.stringify({ ...this.state, exportedAt: new Date().toISOString() }, null, 2);
  }

  /**
   * Führt einen fremden Stand mit dem eigenen zusammen.
   *
   * Genau die Operation, die ein späterer Cloud-Sync braucht: Buchungen
   * werden vereinigt, alles andere per jüngstem `updatedAt` entschieden.
   */
  async merge(incoming) {
    for (const collection of COLLECTIONS) {
      const remote = incoming?.[collection] ?? {};
      const local = this.state[collection];
      for (const [id, record] of Object.entries(remote)) {
        const mine = local[id];
        if (!mine) {
          local[id] = record;
        } else if (collection !== 'events' && (record.updatedAt ?? '') > (mine.updatedAt ?? '')) {
          local[id] = record;
        }
      }
    }
    this.state.settings = { ...(incoming?.settings ?? {}), ...this.state.settings };
    await this.#persist();
    this.#notify();
  }

  async replaceAll(incoming) {
    this.state = { ...emptyState(), ...incoming };
    delete this.state.exportedAt;
    await this.#persist();
    this.#notify();
  }
}

export function newId(prefix) {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
