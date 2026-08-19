/**
 * Persistenz.
 *
 * Dieselbe Bauweise wie in den beiden Apps nebenan: Die App spricht nie
 * direkt mit localStorage, sondern immer mit `Store`, und `Store` kennt nur
 * einen Adapter mit `read` und `write`.
 *
 * Drei Collections, weil drei Dinge mit sehr verschiedener Lebensdauer
 * gespeichert werden:
 *
 *  - **Übungen** (`exercises`) ändern sich selten und werden nachgeschlagen.
 *  - **Trainingspläne** (`plans`) sind eine Reihenfolge von Übungen und
 *    sonst nichts. Sie halten kein Gewicht und keine Satzzahl fest -- das
 *    steht im Protokoll und ändert sich jede Woche.
 *  - **Einheiten** (`sessions`) sind der Rahmen eines Trainings: wann es
 *    anfing, wann es zu Ende war, und nach welchem Plan.
 *  - **Sätze** (`sets`) sind das eigentliche Protokoll -- und der Grund,
 *    warum es diese App gibt.
 *
 * Ein Satz ist bewusst ein eigener Datensatz und keine Zeile in der
 * Einheit. Beim Training entsteht alle zwei Minuten einer; als Liste
 * innerhalb der Einheit müsste jedes Mal der ganze Trainingstag neu
 * geschrieben werden, und zwei Geräte am selben Training überschrieben sich
 * gegenseitig komplett statt nur den einen strittigen Satz. Als eigener
 * Datensatz ist ein Satz das, was er in Wirklichkeit auch ist: ein
 * Ereignis mit Zeitstempel.
 *
 * Für einen späteren Sync gilt wie nebenan: Jeder Datensatz trägt
 * `updatedAt`, beim Zusammenführen gewinnt der jüngere Schreibvorgang, und
 * gelöscht wird nur weich -- eine harte Löschung wäre beim Zusammenführen
 * nicht von "kennt den Datensatz noch nicht" zu unterscheiden und käme vom
 * anderen Gerät zurück.
 */

export const COLLECTIONS = ['exercises', 'plans', 'sessions', 'sets'];

/**
 * Bittet den Browser, diese Daten dauerhaft zu behalten.
 *
 * Ohne diese Bitte gelten sie als "bei Gelegenheit entbehrlich" -- Safari
 * verwirft Daten von Seiten, die länger nicht besucht wurden, von sich aus.
 * Ein Trainingstagebuch über zwei Jahre ist das Letzte, was man so verlieren
 * möchte. Die Bitte kostet nichts und wird stillschweigend gewährt oder
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
  /** Die Übungen, die jemand tatsächlich macht. */
  exercises: {},
  /** Trainingspläne: welche Übungen in welcher Reihenfolge. */
  plans: {},
  /** Trainingseinheiten -- ein Datum, ein Anfang, ein Ende. */
  sessions: {},
  /** Jeder einzelne Satz. Das Gedächtnis der App. */
  sets: {},
  settings: {},
});

/** Adapter für den Browser. */
export class LocalStorageAdapter {
  constructor(key = 'training.v1', storage = globalThis.localStorage) {
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
   * folgende Änderungen sich nicht gegenseitig überschreiben. Im Training
   * ist das keine Theorie: Satz eintragen und Pausenuhr starten passieren
   * in derselben Zehntelsekunde.
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

  /**
   * Auch das, was gelöscht wurde.
   *
   * Braucht der Verlauf: Ein Training von vor einem Jahr enthält Sätze
   * einer Übung, die im Verzeichnis längst nicht mehr steht. Ohne ihren
   * Namen stünde dort eine leere Zeile -- und ein Training, das man nicht
   * mehr lesen kann, hätte man auch nicht aufschreiben müssen.
   */
  allIncludingRemoved(collection) {
    return Object.values(this.state[collection] ?? {});
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

  /** Mehrere Änderungen als ein Schreib- und Zeichenvorgang. */
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

  /** Wie viel Platz die Daten belegen, in Bytes. */
  usedBytes() {
    const json = JSON.stringify(this.state);
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length;
  }

  /**
   * Führt einen fremden Stand mit dem eigenen zusammen.
   *
   * Genau die Operation, die ein späterer Sync braucht. Sätze werden dabei
   * nur ergänzt und nie überschrieben: Wer am Handy trainiert und am Tablet
   * nachträgt, hat zwei Listen von Ereignissen, keine zwei Fassungen
   * derselben Sache.
   */
  async merge(incoming) {
    for (const collection of COLLECTIONS) {
      const remote = incoming?.[collection] ?? {};
      const local = this.state[collection];
      for (const [id, record] of Object.entries(remote)) {
        const mine = local[id];
        if (!mine) {
          local[id] = record;
        } else if (collection !== 'sets' && (record.updatedAt ?? '') > (mine.updatedAt ?? '')) {
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
