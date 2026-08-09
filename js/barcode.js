/**
 * Barcode-Scan über die Handykamera und Namensauflösung.
 *
 * Die Erkennung gibt es in zwei Ausführungen hinter einer gemeinsamen
 * Schnittstelle (`detect(video) -> string|null`):
 *
 *  1. `NativeDetector` nutzt die eingebaute `BarcodeDetector`-Schnittstelle
 *     des Browsers. Schnell, kostet nichts an Ladezeit -- gibt es aber nur
 *     auf Android.
 *  2. `WasmDetector` bringt die Erkennung selbst mit (ZBar als WebAssembly).
 *     Nötig auf iPhone und iPad: Apple hat die Schnittstelle nie
 *     implementiert, und weil dort alle Browser WebKit verwenden, hilft auch
 *     kein anderer Browser.
 *
 * Der Kamerazugriff selbst funktioniert auf beiden Systemen -- es fehlt auf
 * iOS nur der Erkenner, und genau der wird hier nachgereicht. Geladen wird
 * die Bibliothek erst, wenn sie gebraucht wird, damit Android-Geräte die
 * knapp 250 KB gar nicht erst herunterladen.
 */

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

/** Formate, die auf Lebensmittelverpackungen vorkommen. */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

/**
 * Dieselben Formate in ZBars eigener Benennung -- die Namen kommen wörtlich
 * aus der Bibliothek und lauten `ZBAR_EAN13`, nicht etwa `EAN-13`.
 *
 * Bewusst ohne QR-Codes: Die stehen oft zusätzlich auf der Packung und
 * würden sonst statt des Produktcodes erkannt.
 */
export const ZBAR_TYPES = new Set([
  'ZBAR_EAN13',
  'ZBAR_EAN8',
  'ZBAR_UPCA',
  'ZBAR_UPCE',
  'ZBAR_CODE128',
  'ZBAR_I25',
  'ZBAR_ISBN13',
  'ZBAR_ISBN10',
]);

/** Auf diese Breite wird das Kamerabild vor der Erkennung verkleinert. */
const SCAN_WIDTH = 800;

export function isNativeScanSupported() {
  return typeof globalThis.BarcodeDetector === 'function';
}

/** Ob überhaupt gescannt werden kann -- also ob es eine Kamera gibt. */
export function isScanSupported() {
  return !!navigator.mediaDevices?.getUserMedia;
}

class NativeDetector {
  async init() {
    this.detector = new globalThis.BarcodeDetector({ formats: NATIVE_FORMATS });
  }

  async detect(video) {
    const [hit] = await this.detector.detect(video);
    return hit?.rawValue ?? null;
  }
}

class WasmDetector {
  async init() {
    ({ scanImageData: this.scan } = await import('../vendor/zbar-wasm/zbar-wasm.mjs'));
    this.canvas = document.createElement('canvas');
    // Wir lesen jedes Bild einmal aus; ohne diesen Hinweis wandert die
    // Zeichenfläche auf die GPU und jedes getImageData wird teuer.
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  async detect(video) {
    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) return null;

    // Verkleinern: Ein volles 1080p-Bild kostet ein Vielfaches an Rechenzeit,
    // ohne die Trefferquote bei Strichcodes zu verbessern.
    const scale = Math.min(1, SCAN_WIDTH / w);
    this.canvas.width = Math.round(w * scale);
    this.canvas.height = Math.round(h * scale);
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);

    const image = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const symbols = await this.scan(image);

    for (const symbol of symbols) {
      if (!ZBAR_TYPES.has(symbol.typeName)) continue;
      const value = symbol.decode();
      if (value) return value;
    }
    return null;
  }
}

/** Wählt den Erkenner, den dieses Gerät hergibt. */
export async function createDetector() {
  const detector = isNativeScanSupported() ? new NativeDetector() : new WasmDetector();
  await detector.init();
  return detector;
}

export class BarcodeScanner {
  #stream = null;
  #timer = null;
  #detector = null;
  #video = null;
  #busy = false;

  /**
   * Startet die Kamera und meldet jeden erkannten Code an `onDetect`.
   * Derselbe Code wird nicht zweimal hintereinander gemeldet.
   *
   * @param {HTMLVideoElement} videoEl
   * @param {(code:string) => void} onDetect
   * @param {(status:'preparing'|'ready') => void} [onStatus]
   *        Meldet, dass der Erkenner geladen wird -- auf iOS dauert das beim
   *        allerersten Mal einen Moment.
   */
  async start(videoEl, onDetect, onStatus) {
    if (!isScanSupported()) throw new Error('Dieses Gerät hat keine nutzbare Kamera.');

    this.#video = videoEl;
    this.#stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });

    videoEl.srcObject = this.#stream;
    await videoEl.play();

    onStatus?.(isNativeScanSupported() ? 'ready' : 'preparing');
    const detector = await createDetector();
    // Zwischen Kamerastart und geladenem Erkenner kann abgebrochen worden
    // sein -- dann darf keine Schleife mehr anlaufen.
    if (!this.#stream) return;
    this.#detector = detector;
    onStatus?.('ready');

    let last = null;
    let lastAt = 0;
    this.#timer = setInterval(async () => {
      // Die WebAssembly-Erkennung braucht länger als das Intervall lang ist.
      // Ohne diese Sperre stapeln sich die Aufrufe und das Bild ruckelt.
      if (this.#busy || !this.#detector || videoEl.readyState < 2) return;
      this.#busy = true;
      try {
        const value = await this.#detector.detect(videoEl);
        if (!value) return;
        const now = Date.now();
        // Die Kamera liefert denselben Code viele Male pro Sekunde.
        if (value === last && now - lastAt < 2500) return;
        last = value;
        lastAt = now;
        onDetect(value);
      } catch {
        // Einzelne fehlgeschlagene Bilder sind normal, nicht meldenswert.
      } finally {
        this.#busy = false;
      }
    }, 250);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#detector = null;
    this.#busy = false;
    if (this.#video) {
      this.#video.srcObject = null;
      this.#video = null;
    }
  }
}

/**
 * Schlägt einen Barcode in der offenen Produktdatenbank Open Food Facts nach.
 *
 * Reine Bequemlichkeit: schlägt der Aufruf fehl (offline, Produkt unbekannt),
 * bleibt das Anlegen per Hand möglich. Deshalb wird hier nie geworfen.
 *
 * @returns {Promise<{name:string, brand:string, quantity:string}|null>}
 */
export async function lookupBarcode(barcode, { signal, timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const fields = 'product_name,product_name_de,brands,quantity';
    const response = await fetch(
      `${OFF_ENDPOINT}/${encodeURIComponent(barcode)}.json?fields=${fields}`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const name = (p.product_name_de || p.product_name || '').trim();
    if (!name) return null;

    return {
      name,
      brand: (p.brands || '').split(',')[0].trim(),
      quantity: (p.quantity || '').trim(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Zerlegt einen Treffer in Marke und Bezeichnung.
 *
 * Beides getrennt zu halten lohnt sich in der Anzeige: Die Marke steht
 * klein über dem Namen ("Baresa" / "Tomaten passiert"), statt ihn in der
 * schmalen Zeile zu verdrängen. Die Mengenangabe gehört zur Bezeichnung --
 * "Passata 400 g" und "Passata 700 g" sind im Vorrat zwei verschiedene
 * Dinge.
 *
 * @returns {{name:string, brand:string}}
 */
export function suggestProduct(hit) {
  if (!hit) return { name: '', brand: '' };

  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const brand = clean(hit.brand);
  let name = clean([hit.name, hit.quantity].filter(Boolean).join(' '));

  // Manche Einträge wiederholen die Marke im Produktnamen ("Baresa Baresa
  // Passata"). Einmal reicht, und zwar oben.
  if (brand && name.toLowerCase().startsWith(brand.toLowerCase())) {
    name = clean(name.slice(brand.length));
  }

  // Ohne Bezeichnung ist die Marke besser als gar nichts.
  if (!name) return { name: brand, brand: '' };
  return { name, brand };
}
