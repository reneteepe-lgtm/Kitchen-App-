/**
 * Die Fotos.
 *
 * Ein Kleiderschrank ohne Bilder ist eine Liste von Wörtern -- und niemand
 * erkennt sein blaues Hemd an dem Wort "Hemd", wenn drei blaue Hemden im
 * Schrank hängen. Die Bilder sind hier also nicht Zierde, sondern das,
 * woran man ein Teil überhaupt wiedererkennt.
 *
 * Sie liegen deshalb in IndexedDB und nicht bei den übrigen Daten:
 * localStorage ist bei etwa fünf Megabyte zu Ende, das wären zwei Dutzend
 * Fotos. IndexedDB hat diese Grenze nicht.
 *
 * Verkleinert wird vor dem Speichern, nicht beim Anzeigen. Ein Handyfoto
 * hat heute vier Megabyte; auf eine Kachel von wenigen Zentimetern wird es
 * ohnehin heruntergerechnet. Wer die volle Auflösung behält, bezahlt sie
 * bei jedem Öffnen der Übersicht noch einmal.
 */

const DB_NAME = 'kleiderschrank-fotos';
const STORE = 'fotos';

/**
 * Längste Kante des gespeicherten Bildes.
 *
 * 640 Pixel decken die größte Darstellung in der App (die Detailansicht auf
 * einem großen Handy mit dreifacher Pixeldichte wäre knapp darüber, aber
 * dort schadet ein Hauch Unschärfe nichts). Darunter würde man es in der
 * Detailansicht sehen, darüber wächst nur der Speicher.
 */
export const MAX_EDGE = 640;

/**
 * Zielgröße unter Beibehaltung des Seitenverhältnisses.
 *
 * Kleine Bilder werden nie vergrößert -- das kostete Platz und brächte
 * kein einziges Detail zurück.
 */
export function targetSize(width, height, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) return { width, height };
  const factor = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/**
 * Verkleinert ein ausgewähltes Bild.
 *
 * JPEG statt PNG: Es geht um Fotos, und PNG wäre hier um ein Vielfaches
 * größer, ohne dass man den Unterschied sähe.
 *
 * @param {Blob} file
 * @returns {Promise<Blob>}
 */
export async function shrinkImage(file, { maxEdge = MAX_EDGE, quality = 0.75 } = {}) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, maxEdge);

  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Unter welchem Schlüssel das anzuzeigende Bild eines Teils liegt.
 *
 * Von jedem Foto werden zwei Fassungen aufbewahrt: das Original als JPEG
 * und, wenn das Freistellen gelungen ist, der Freisteller als PNG. Beide zu
 * behalten kostet ein paar hundert Kilobyte und macht den Schalter
 * "freigestellt" umkehrbar -- sonst wäre der Hintergrund nach einem
 * Fingertipp unwiederbringlich fort.
 */
export const CUTOUT_SUFFIX = '-frei';

export const photoKeyOf = (item) => {
  if (!item?.photoId) return null;
  return item.cutout ? `${item.photoId}${CUTOUT_SUFFIX}` : item.photoId;
};

/** Beide Fassungen eines Teils -- zum Löschen und zum Vergessen der Adresse. */
export const photoKeysOf = (item) =>
  item?.photoId ? [item.photoId, `${item.photoId}${CUTOUT_SUFFIX}`] : [];

/** Fotoablage in IndexedDB. */
export class PhotoStore {
  #db = null;

  async open(indexedDB = globalThis.indexedDB) {
    if (this.#db) return this;
    this.#db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this;
  }

  #tx(mode) {
    return this.#db.transaction(STORE, mode).objectStore(STORE);
  }

  #run(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(id, blob) {
    await this.#run(this.#tx('readwrite').put(blob, id));
    return id;
  }

  /** @returns {Promise<Blob|undefined>} */
  async get(id) {
    return this.#run(this.#tx('readonly').get(id));
  }

  async remove(id) {
    return this.#run(this.#tx('readwrite').delete(id));
  }

  async keys() {
    return this.#run(this.#tx('readonly').getAllKeys());
  }

  async usedBytes() {
    const blobs = await this.#run(this.#tx('readonly').getAll());
    return blobs.reduce((sum, blob) => sum + (blob?.size ?? 0), 0);
  }
}

/** Ablage im Arbeitsspeicher -- für Tests und für Browser ohne IndexedDB. */
export class MemoryPhotoStore {
  constructor() {
    this.map = new Map();
  }
  async open() {
    return this;
  }
  async put(id, blob) {
    this.map.set(id, blob);
    return id;
  }
  async get(id) {
    return this.map.get(id);
  }
  async remove(id) {
    this.map.delete(id);
  }
  async keys() {
    return [...this.map.keys()];
  }
  async usedBytes() {
    return [...this.map.values()].reduce((sum, blob) => sum + (blob?.size ?? 0), 0);
  }
}

/**
 * Öffnet die Fotoablage -- und weicht aus, wenn der Browser sie verweigert.
 *
 * Safari im privaten Modus etwa lässt IndexedDB zwar öffnen, aber nicht
 * schreiben. Die App soll dann ohne Bilder weiterlaufen statt beim Start
 * stehenzubleiben.
 */
export async function openPhotoStore(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return new MemoryPhotoStore();
  try {
    return await new PhotoStore().open(indexedDB);
  } catch (err) {
    console.warn('Fotoablage nicht verfügbar, Bilder gelten nur für diese Sitzung:', err);
    return new MemoryPhotoStore();
  }
}

/**
 * Hält die Adressen der angezeigten Bilder.
 *
 * `URL.createObjectURL` belegt Speicher, bis die Adresse ausdrücklich
 * freigegeben wird. Bei einer Übersicht, die bei jeder Änderung neu
 * gezeichnet wird, wäre das ein Leck, das mit jedem Tastendruck wächst --
 * deshalb wird pro Kleidungsstück genau eine Adresse angelegt und
 * wiederverwendet.
 */
export class PhotoUrls {
  constructor(store) {
    this.store = store;
    this.urls = new Map();
  }

  /** @returns {Promise<string|null>} */
  async urlFor(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    const blob = await this.store.get(id);
    const url = blob ? URL.createObjectURL(blob) : null;
    this.urls.set(id, url);
    return url;
  }

  /** Nach dem Austauschen eines Fotos: die alte Adresse gilt nicht mehr. */
  forget(id) {
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }

  clear() {
    for (const id of [...this.urls.keys()]) this.forget(id);
  }
}
