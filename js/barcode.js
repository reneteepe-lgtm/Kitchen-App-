/**
 * Barcode-Scan über die Handykamera und Namensauflösung.
 *
 * Erkannt wird mit der `BarcodeDetector`-Schnittstelle des Browsers -- ohne
 * Fremdbibliothek, damit die App auch offline vollständig lädt. Die
 * Schnittstelle gibt es auf Android-Chrome; auf iOS/Safari fehlt sie bis
 * heute. Deshalb ist die manuelle Eingabe kein Notbehelf, sondern ein
 * gleichwertiger Weg: `isScanSupported()` entscheidet nur, ob der
 * Kamera-Knopf überhaupt angeboten wird.
 */

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];

export function isScanSupported() {
  return typeof globalThis.BarcodeDetector === 'function' && !!navigator.mediaDevices?.getUserMedia;
}

export class BarcodeScanner {
  #stream = null;
  #timer = null;
  #detector = null;
  #video = null;

  /**
   * Startet die Kamera und meldet jeden erkannten Code an `onDetect`.
   * Derselbe Code wird nicht zweimal hintereinander gemeldet.
   */
  async start(videoEl, onDetect) {
    if (!isScanSupported()) throw new Error('Dieses Gerät kann keine Barcodes scannen.');

    this.#video = videoEl;
    this.#detector = new globalThis.BarcodeDetector({ formats: FORMATS });
    this.#stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });

    videoEl.srcObject = this.#stream;
    await videoEl.play();

    let last = null;
    let lastAt = 0;
    this.#timer = setInterval(async () => {
      if (!this.#detector || videoEl.readyState < 2) return;
      try {
        const [hit] = await this.#detector.detect(videoEl);
        if (!hit?.rawValue) return;
        const now = Date.now();
        // Die Kamera liefert denselben Code viele Male pro Sekunde.
        if (hit.rawValue === last && now - lastAt < 2500) return;
        last = hit.rawValue;
        lastAt = now;
        onDetect(hit.rawValue);
      } catch {
        // Einzelne fehlgeschlagene Frames sind normal, nicht meldenswert.
      }
    }, 250);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#detector = null;
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

/** Baut aus einem Treffer einen brauchbaren Produktnamen. */
export function suggestName(hit) {
  if (!hit) return '';
  return [hit.brand, hit.name, hit.quantity].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
