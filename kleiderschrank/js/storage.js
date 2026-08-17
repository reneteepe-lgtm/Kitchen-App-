/**
 * Persistenz.
 *
 * Dieselbe Bauweise wie in der Küchen-App nebenan: Die App spricht nie
 * direkt mit localStorage, sondern immer mit `Store`, und `Store` kennt nur
 * einen Adapter mit `read` und `write`. Ein Cloud-Backend ließe sich später
 * einhängen, ohne eine Zeile Anwendungslogik anzufassen.
 *
 * Drei Entscheidungen sind auf späteren Zwei-Geräte-Sync ausgelegt:
 *
 *  1. Jeder Datensatz trägt `updatedAt`; beim Zusammenführen gewinnt der
 *     jüngere Schreibvorgang.
 *  2. Gelöscht wird nur weich (`deleted: true`). Eine harte Löschung wäre
 *     beim Merge nicht von "kennt den Datensatz noch nicht" zu
 *     unterscheiden und käme vom alten Gerät zurück.
 *  3. Bewertungen (`ratings`) werden nie verändert, nur angehängt. Zwei
 *     Bewertungslisten lassen sich dadurch konfliktfrei vereinigen -- und
 *     genau davon lebt das Training: Es ist die Summe aller Urteile, nicht
 *     ein Zustand, den zwei Geräte gegeneinander überschreiben könnten.
 *
 * Was hier bewusst *nicht* liegt: die Fotos. Die gingen in localStorage
 * nach zwei Dutzend Teilen zu Ende; sie wohnen in `photos.js`.
 */

export const COLLECTIONS = ['items', 'outfits', 'ratings'];

/**
 * Bittet den Browser, diese Daten dauerhaft zu behalten.
 *
 * Ohne diese Bitte gelten sie als "bei Gelegenheit entbehrlich" -- Safari
 * verwirft Daten von Seiten, die länger nicht besucht wurden, von sich aus.
 * Ein abfotografierter Kleiderschrank ist zu viel Arbeit, um ihn so zu
 * verlieren. Die Bitte kostet nichts und wird stillschweigend gewährt oder
 * abgelehnt; gefragt wird der Mensch in keinem Fall.
 *
 * @returns {Promise<'dauerhaft'|'auf-widerruf'|'unbekannt'>}
 */
export async function requestPersistence(storage = globalThis.navigator?.storage) {
  if (typeof storage?.persist !== 'function') return 'unbekannt';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      return 'dauerhaft';
    }
    return (await storage.persist()) ? 'dauerhaft' : 'auf-widerruf';
  } catch {
    return 'unbekannt';
  }
}

const emptyState = () => ({
  /** Die Kleidungsstücke. */
  items: {},
  /** Zusammengestellte und gespeicherte Outfits. */
  outfits: {},
  /** Jedes "gefällt mir" und "nicht mein Stil" -- die Grundlage des Trainings. */
  ratings: {},
  settings: {},
});

/** Adapter für den Browser. */
export class LocalStorageAdapter {
  constructor(key = 'kleiderschrank.v1', storage = globalThis.localStorage) {
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
   * folgende Änderungen sich nicht gegenseitig überschreiben.
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

  /** Mehrere Änderungen als ein Schreib- und Render-Vorgang. */
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
   * Wie viel Platz die Daten belegen, in Bytes -- ohne die Fotos, die
   * woanders liegen.
   */
  usedBytes() {
    const json = JSON.stringify(this.state);
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length;
  }

  /**
   * Führt einen fremden Stand mit dem eigenen zusammen.
   *
   * Genau die Operation, die ein späterer Sync braucht: Bewertungen werden
   * vereinigt, alles andere per jüngstem `updatedAt` entschieden.
   */
  async merge(incoming) {
    for (const collection of COLLECTIONS) {
      const remote = incoming?.[collection] ?? {};
      const local = this.state[collection];
      for (const [id, record] of Object.entries(remote)) {
        const mine = local[id];
        if (!mine) {
          local[id] = record;
        } else if (collection !== 'ratings' && (record.updatedAt ?? '') > (mine.updatedAt ?? '')) {
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
