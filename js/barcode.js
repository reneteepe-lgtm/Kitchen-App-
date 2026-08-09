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
 *
 * Damit das Scannen nicht zäh wird, hängt alles an drei Einsichten:
 *
 *  - **Auflösung ist die halbe Miete.** Fragt man nicht nach, liefern viele
 *    Browser 640x480. Ein EAN-13 hat 95 Striche; unter zwei bis drei
 *    Bildpunkten je Strich verschwimmt er, und der Scan scheitert nicht
 *    einmal sichtbar -- er findet einfach nichts.
 *  - **Das meiste Kamerabild sieht ohnehin niemand.** Ein hochkantes Telefon
 *    zeigt von einem 16:9-Bild nur einen schmalen senkrechten Streifen, rund
 *    ein Viertel der Fläche. Durchsucht wird deshalb der Sucherrahmen, nicht
 *    der Sensor.
 *  - **Es zählt, wie viele Bilder man ansieht.** Beim Zielen ist die Hand
 *    unruhig und der Autofokus sucht; die meisten Bilder sind unbrauchbar.
 *    Wer viermal je Sekunde hinsieht, verpasst die scharfen. Deshalb wird
 *    jedes Kamerabild geprüft, sobald es da ist.
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

/**
 * Dieselbe Liste als Schalter für ZBar. ISBN-Codes stehen nicht dabei: Sie
 * sind EAN-13 und werden über `ZBAR_EAN13` mit erkannt -- als eigenes Format
 * eingeschaltet, kosteten sie nur zusätzliche Rechenzeit.
 *
 * Ohne diese Einschränkung sucht ZBar in jedem Bild auch nach QR, PDF417,
 * Code 39, Codabar und Databar. Gemessen: 38 ms je Bild statt 25 ms.
 */
export const ZBAR_ENABLED = ['ZBAR_EAN13', 'ZBAR_EAN8', 'ZBAR_UPCA', 'ZBAR_UPCE', 'ZBAR_CODE128', 'ZBAR_I25'];

/**
 * Jede zweite Zeile und Spalte abtasten statt jeder.
 *
 * Gemessen an gestellten Bildern: halbe Rechenzeit (14 statt 27 ms je Bild),
 * ohne dass die Erkennung schlechter würde -- auch nicht bei schräg
 * gehaltener Packung oder an der Grenze der Auflösung, wo der Code bei jeder
 * Einstellung gleichzeitig abreißt.
 */
const ZBAR_DENSITY = 2;

/**
 * Breiter als das wird kein Bild durchgerechnet; darüber wird verkleinert.
 *
 * Verkleinern ist teuer erkauft -- es kostet genau die Feinheit, auf die es
 * ankommt. Gemessen an einem Code mit drei Bildpunkten je Strich, also einer
 * Packung auf Armlänge: auf 800 Punkte verkleinert 2 von 20 Bildern erkannt,
 * in voller Schärfe 20 von 20. Die Grenze liegt deshalb nur dort, wo es ohne
 * sie wirklich zu langsam würde -- auf einem hochkanten Telefon greift sie
 * gar nicht erst.
 */
const SCAN_WIDTH = 1024;

/**
 * So oft wird statt des Suchers alles Sichtbare durchsucht.
 *
 * Der Sucherausschnitt ist der Regelfall und sehr schnell, findet aber
 * nichts, was darüber oder darunter liegt. Jeder vierte Versuch geht deshalb
 * über das ganze Bild, das gerade auf dem Schirm steht.
 */
const WIDE_EVERY = 4;

/** Wie viel Rand um den Sucherrahmen mit durchsucht wird. */
const CROP_MARGIN = 0.22;

/**
 * Wie weit der weite Durchgang über den Bildschirmrand hinausgreift.
 *
 * Hält man die Packung sehr nah, ragt der Code seitlich aus dem Bild --
 * sichtbar ist dann nur seine Mitte, und die allein lässt sich nicht lesen.
 * Ein Viertel Zugabe je Seite fängt genau diesen Fall ab. Weiter zu greifen
 * hieße, wieder Dinge zu lesen, die gar nicht auf dem Schirm stehen.
 */
const WIDE_MARGIN = 0.25;

/**
 * Was von der Kamera verlangt wird.
 *
 * Ohne Angabe liefern viele Browser 640x480. Das reicht für Strichcodes
 * nicht: Gemessen an derselben Packung im selben Abstand wurden bei 640x480
 * 9 von 20 Bildern erkannt, bei 1280x720 alle 20. Ein Strich muss über
 * mindestens zwei bis drei Bildpunkte laufen, sonst verschwimmt er.
 *
 * Alles ist als Wunsch formuliert -- ein Gerät, das es nicht kann, liefert
 * weiter sein Bestes, statt den Zugriff zu verweigern.
 */
const CAMERA = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
    // Ohne durchgehenden Autofokus bleibt das Bild beim Heranführen unscharf.
    advanced: [{ focusMode: 'continuous' }],
  },
  audio: false,
};

export function isNativeScanSupported() {
  return typeof globalThis.BarcodeDetector === 'function';
}

/** Ob überhaupt gescannt werden kann -- also ob es eine Kamera gibt. */
export function isScanSupported() {
  return !!navigator.mediaDevices?.getUserMedia;
}

/** Der Maßstab, mit dem `object-fit: cover` das Bild in den Kasten legt. */
const coverScale = (vw, vh, box) => Math.max(box.width / vw, box.height / vh);

/**
 * Der Teil des Kamerabildes, der überhaupt auf dem Schirm steht.
 *
 * Das ist erstaunlich wenig: Ein Telefon im Hochformat zeigt von einem
 * 16:9-Kamerabild nur einen schmalen senkrechten Streifen -- gemessen an
 * einem 390 x 844 großen Fenster und einem 1280 x 720 großen Kamerabild
 * ganze 26 Prozent. Bisher wurde der ganze Rahmen durchsucht; drei Viertel
 * der Rechenzeit gingen also für Bildpunkte drauf, die niemand sieht.
 *
 * Schlimmer als die verlorene Zeit ist die Verwechslungsgefahr: Auf diesem
 * Weg konnte der Scanner den Code einer Packung melden, die daneben auf dem
 * Tisch lag und gar nicht im Bild war. Was gescannt wird, soll sichtbar sein.
 */
export function visibleRegion(video, margin = 0) {
  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  if (!vw || !vh) return null;

  const box = video.getBoundingClientRect();
  if (!box.width || !box.height) return null;

  const scale = coverScale(vw, vh, box);
  const w = Math.min(vw, Math.round((box.width / scale) * (1 + 2 * margin)));
  const h = Math.min(vh, Math.round((box.height / scale) * (1 + 2 * margin)));
  if (w >= vw * 0.98 && h >= vh * 0.98) return null;
  return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}

/**
 * Rechnet den Sucherrahmen auf dem Bildschirm in Bildpunkte der Kamera um.
 *
 * Das Video wird mit `object-fit: cover` gezeigt: gleichmäßig vergrößert,
 * bis beide Seiten gefüllt sind, der Überstand liegt außerhalb des Bildes.
 * Ein Hochformat-Fenster schneidet von einem 16:9-Kamerabild also links und
 * rechts kräftig ab. Wer den Sucherrahmen einfach als "die mittleren 50 %
 * des Kamerabildes" ansähe, durchsuchte einen ganz anderen Bereich als den,
 * auf den die Nutzerin zielt.
 *
 * @returns {{x:number,y:number,w:number,h:number}|null} null, wenn sich
 *          nichts Sinnvolles ausrechnen lässt -- dann gilt das ganze Bild.
 */
export function scanRegion(video, frame, margin = CROP_MARGIN) {
  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  if (!vw || !vh || !frame) return null;

  const box = video.getBoundingClientRect();
  const aim = frame.getBoundingClientRect();
  if (!box.width || !box.height || !aim.width || !aim.height) return null;

  const scale = coverScale(vw, vh, box);
  const offX = (box.width - vw * scale) / 2;
  const offY = (box.height - vh * scale) / 2;

  const baseW = aim.width / scale;
  const baseH = aim.height / scale;
  // Etwas Rand: Wer zielt, trifft den Rahmen nicht auf den Punkt genau.
  const w = baseW * (1 + 2 * margin);
  const h = baseH * (1 + 2 * margin);
  const x = (aim.left - box.left - offX) / scale - (w - baseW) / 2;
  const y = (aim.top - box.top - offY) / scale - (h - baseH) / 2;

  const left = Math.max(0, Math.min(vw - 1, Math.round(x)));
  const top = Math.max(0, Math.min(vh - 1, Math.round(y)));
  const width = Math.max(1, Math.min(vw - left, Math.round(w)));
  const height = Math.max(1, Math.min(vh - top, Math.round(h)));

  // Ein Ausschnitt, der ohnehin fast alles umfasst, lohnt die Mühe nicht.
  if (width >= vw * 0.95 && height >= vh * 0.95) return null;
  return { x: left, y: top, w: width, h: height };
}

class NativeDetector {
  async init() {
    this.detector = new globalThis.BarcodeDetector({ formats: NATIVE_FORMATS });
  }

  /**
   * Bekommt das Video unverändert, ohne Ausschnitt.
   *
   * Die eingebaute Erkennung steckt in der Grafikschicht des Systems und
   * kommt mit dem vollen Bild ohne Weiteres zurecht. Erst einen Ausschnitt
   * herauszukopieren kostete hier mehr, als es spart -- anders als bei der
   * mitgebrachten Erkennung, die jeden Bildpunkt selbst durchrechnet.
   */
  async detect(video) {
    const [hit] = await this.detector.detect(video);
    return hit?.rawValue ?? null;
  }
}

class WasmDetector {
  async init() {
    const zbar = await import('../vendor/zbar-wasm/zbar-wasm.mjs');
    this.scan = zbar.scanImageData;

    // Ein eigener Erkenner statt des voreingestellten: Der sucht in jedem
    // Bild auch nach QR, PDF417, Code 39 und Databar.
    this.scanner = await zbar.ZBarScanner.create();
    const { ZBarConfigType: cfg, ZBarSymbolType: sym } = zbar;
    this.scanner.setConfig(sym.ZBAR_NONE, cfg.ZBAR_CFG_ENABLE, 0);
    for (const name of ZBAR_ENABLED) {
      this.scanner.setConfig(sym[name], cfg.ZBAR_CFG_ENABLE, 1);
    }
    this.scanner.setConfig(sym.ZBAR_NONE, cfg.ZBAR_CFG_BINARY, 1);
    this.scanner.setConfig(sym.ZBAR_NONE, cfg.ZBAR_CFG_X_DENSITY, ZBAR_DENSITY);
    this.scanner.setConfig(sym.ZBAR_NONE, cfg.ZBAR_CFG_Y_DENSITY, ZBAR_DENSITY);

    this.canvas = document.createElement('canvas');
    // Wir lesen jedes Bild einmal aus; ohne diesen Hinweis wandert die
    // Zeichenfläche auf die GPU und jedes getImageData wird teuer.
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * @param {{x:number,y:number,w:number,h:number}|null} region
   *        Der Ausschnitt, der durchsucht wird -- in voller Schärfe, solange
   *        er nicht breiter als `SCAN_WIDTH` ist. Ohne Angabe gilt das ganze
   *        Kamerabild.
   */
  async detect(video, region) {
    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) return null;

    const src = region ?? { x: 0, y: 0, w, h };
    const scale = Math.min(1, SCAN_WIDTH / src.w);
    this.canvas.width = Math.max(1, Math.round(src.w * scale));
    this.canvas.height = Math.max(1, Math.round(src.h * scale));
    this.ctx.drawImage(
      video,
      src.x, src.y, src.w, src.h,
      0, 0, this.canvas.width, this.canvas.height,
    );

    const image = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const symbols = await this.scan(image, this.scanner);

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

/** Abstand zwischen zwei Versuchen, wenn es keine Bildrückmeldung gibt. */
const FALLBACK_INTERVAL = 60;

export class BarcodeScanner {
  #stream = null;
  #detector = null;
  #video = null;
  #frameEl = null;
  #running = false;
  #timer = null;
  #rvfc = null;
  #attempt = 0;
  #last = null;
  #lastAt = 0;
  #onDetect = null;

  /**
   * Startet die Kamera und meldet jeden erkannten Code an `onDetect`.
   * Derselbe Code wird nicht zweimal hintereinander gemeldet.
   *
   * @param {HTMLVideoElement} videoEl
   * @param {(code:string) => void} onDetect
   * @param {object} [options]
   * @param {(status:'preparing'|'ready') => void} [options.onStatus]
   *        Meldet, dass der Erkenner geladen wird -- auf iOS dauert das beim
   *        allerersten Mal einen Moment.
   * @param {Element} [options.frameEl]
   *        Der Sucherrahmen. Ist er da, wird vorrangig sein Inhalt
   *        durchsucht -- in voller Schärfe und deutlich schneller.
   */
  async start(videoEl, onDetect, options = {}) {
    if (!isScanSupported()) throw new Error('Dieses Gerät hat keine nutzbare Kamera.');
    const { onStatus, frameEl = null } = options;

    this.#video = videoEl;
    this.#frameEl = frameEl;
    this.#running = true;
    this.#attempt = 0;
    this.#last = null;
    this.#lastAt = 0;

    /*
     * Beides gleichzeitig anstoßen. Der Erkenner wird auf iOS erst
     * heruntergeladen (rund 250 KB) -- nacheinander wartete man zweimal,
     * obwohl das eine mit dem anderen nichts zu tun hat.
     */
    onStatus?.(isNativeScanSupported() ? 'ready' : 'preparing');
    const detectorReady = createDetector();
    const streamReady = navigator.mediaDevices.getUserMedia(CAMERA);

    let stream;
    try {
      stream = await streamReady;
    } catch (err) {
      // Sonst bliebe der angefangene Ladevorgang unbeachtet im Raum stehen.
      detectorReady.catch(() => {});
      this.#running = false;
      throw err;
    }
    if (!this.#running) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.#stream = stream;

    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});

    const detector = await detectorReady;
    // Zwischen Kamerastart und geladenem Erkenner kann abgebrochen worden
    // sein -- dann darf keine Schleife mehr anlaufen.
    if (!this.#running) return;
    this.#detector = detector;
    onStatus?.('ready');

    this.#onDetect = onDetect;
    this.#schedule();
  }

  /**
   * Setzt den nächsten Versuch an -- erst wenn der vorige fertig ist.
   *
   * Ein fester Takt wäre hier falsch in beide Richtungen: Die eingebaute
   * Erkennung ist in wenigen Millisekunden durch und langweilte sich bei
   * 250 ms Abstand, die mitgebrachte braucht länger als der Takt und stapelt
   * Aufrufe. `requestVideoFrameCallback` gibt es auf Android wie auf iOS
   * (Safari 15.4) und liefert genau dann ein Bild, wenn die Kamera eines
   * geliefert hat -- kein Bild wird zweimal durchsucht, keins verfällt.
   */
  #schedule() {
    if (!this.#running) return;
    const video = this.#video;
    if (typeof video?.requestVideoFrameCallback === 'function') {
      this.#rvfc = video.requestVideoFrameCallback(() => this.#tick());
    } else {
      this.#timer = setTimeout(() => this.#tick(), FALLBACK_INTERVAL);
    }
  }

  async #tick() {
    if (!this.#running) return;
    const video = this.#video;

    if (this.#detector && video && video.readyState >= 2) {
      try {
        // Der Sucherausschnitt ist der Regelfall; jeder vierte Versuch nimmt
        // alles, was auf dem Schirm steht, damit ein Code über oder unter
        // dem Sucher nicht endlos übersehen wird.
        const wide = this.#attempt % WIDE_EVERY === WIDE_EVERY - 1;
        this.#attempt++;
        const region = wide
          ? visibleRegion(video, WIDE_MARGIN)
          : scanRegion(video, this.#frameEl);

        const value = await this.#detector.detect(video, region);
        if (value) {
          const now = Date.now();
          // Die Kamera liefert denselben Code viele Male pro Sekunde.
          if (value !== this.#last || now - this.#lastAt >= 2500) {
            this.#last = value;
            this.#lastAt = now;
            this.#onDetect?.(value);
          }
        }
      } catch {
        // Einzelne fehlgeschlagene Bilder sind normal, nicht meldenswert.
      }
    }

    this.#schedule();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#rvfc !== null && typeof this.#video?.cancelVideoFrameCallback === 'function') {
      this.#video.cancelVideoFrameCallback(this.#rvfc);
    }
    this.#rvfc = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#detector = null;
    this.#onDetect = null;
    this.#frameEl = null;
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
  const name = stripBrand(clean([hit.name, hit.quantity].filter(Boolean).join(' ')), brand);

  // Ohne Bezeichnung ist die Marke besser als gar nichts.
  if (!name) return { name: brand, brand: '' };
  return { name, brand };
}

/**
 * Trennt eine vorangestellte Marke vom Namen ab.
 *
 * Zwei Fälle brauchen das: Manche Datenbankeinträge wiederholen die Marke
 * im Produktnamen ("Baresa Baresa Passata"), und Produkte aus früheren
 * Fassungen der App tragen sie fest im Namen ("Baresa Tomaten passiert"),
 * weil es damals kein eigenes Feld dafür gab.
 */
export function stripBrand(name, brand) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  const mark = String(brand ?? '').trim();
  if (!mark || !text.toLowerCase().startsWith(mark.toLowerCase())) return text;

  const rest = text.slice(mark.length).trim();
  // Nicht abtrennen, wenn danach nichts übrig bleibt.
  return rest || text;
}
