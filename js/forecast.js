/**
 * Verbrauchsprognose.
 *
 * Ziel: aus wenigen, unregelmäßigen Buchungen eine belastbare Aussage
 * ableiten, wann ein Produkt voraussichtlich leer ist.
 *
 * Modell: Gamma-Poisson.
 *   Der Verbrauch pro Tag wird als Poisson-Prozess mit unbekannter Rate
 *   angenommen. Die Rate bekommt einen Gamma-Prior, damit die Schätzung
 *   bei ein bis zwei Datenpunkten nicht ins Absurde kippt, sich mit
 *   wachsender Historie aber vollständig an die echten Daten anpasst.
 *
 *   Prior:     rate ~ Gamma(alpha0, beta0),  alpha0 = priorRate * beta0
 *   Posterior: rate ~ Gamma(alpha0 + n, beta0 + d)
 *   Schätzer:  E[rate] = (alpha0 + n) / (beta0 + d)
 *
 * Zeitgewichtung: Buchungen verlieren mit einer Halbwertszeit an Gewicht.
 * Dadurch folgt die Prognose einer Verhaltensänderung (neue Diät, Besuch
 * ausgezogen), statt ewig am Durchschnitt der letzten Jahre zu kleben.
 * Konsequenterweise wird auch der Beobachtungszeitraum gleich gewichtet --
 * sonst würde die Rate systematisch zu niedrig geschätzt.
 */

export const DAY_MS = 86_400_000;

export const FORECAST_DEFAULTS = {
  /**
   * Halbwertszeit des Gewichts einer Buchung, in Tagen.
   * Zwei Monate: kurz genug, um einer geänderten Gewohnheit in absehbarer
   * Zeit zu folgen, lang genug, dass bei einem Kaufrhythmus von ein bis
   * vier Wochen noch mehrere Buchungen im Fenster liegen.
   */
  halfLifeDays: 60,
  /** Stärke des Priors, ausgedrückt in "Pseudo-Beobachtungstagen". */
  priorStrengthDays: 10,
  /** Angenommene Rate ohne jede Historie: eine Packung in drei Wochen. */
  priorRatePerDay: 1 / 21,
};

const LN2 = Math.LN2;

const toMs = (value) => (value instanceof Date ? value.getTime() : new Date(value).getTime());

/** Gewicht einer Buchung, die `ageDays` Tage zurückliegt. */
function weightAt(ageDays, halfLifeDays) {
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Effektive Länge eines Beobachtungsfensters unter Zeitgewichtung:
 * das Integral des Gewichts über den Zeitraum.
 *
 * Ohne diese Korrektur stünde eine abgewertete Ereigniszahl einer vollen
 * Tageszahl gegenüber und die Rate fiele mit der Zeit gegen null.
 */
function effectiveWindow(spanDays, halfLifeDays) {
  if (spanDays <= 0) return 0;
  const tau = halfLifeDays / LN2;
  return tau * (1 - Math.pow(0.5, spanDays / halfLifeDays));
}

/**
 * Gewichtete Summe der Mengen einer Ereignisliste.
 * @returns {number} effektive Anzahl verbrauchter/gekaufter Packungen
 */
function weightedQuantity(events, nowMs, halfLifeDays) {
  let sum = 0;
  for (const event of events) {
    const ageDays = (nowMs - toMs(event.ts)) / DAY_MS;
    if (ageDays < 0) continue; // Buchung in der Zukunft: ignorieren
    sum += (event.qty ?? 0) * weightAt(ageDays, halfLifeDays);
  }
  return sum;
}

/**
 * Schätzt die Verbrauchsrate eines Produkts.
 *
 * @param {object} params
 * @param {Array}  params.events     Alle Events des Produkts (jeglicher Typ).
 * @param {string|Date} params.observedSince  Ab wann wir das Produkt beobachten.
 * @param {Date}   [params.now]
 * @param {object} [params.config]
 * @returns {{ratePerDay:number, sd:number, evidence:number, observedDays:number, source:string}}
 */
export function estimateConsumptionRate({ events = [], observedSince, now = new Date(), config = {} }) {
  const cfg = { ...FORECAST_DEFAULTS, ...config };
  const nowMs = toMs(now);

  const consumeEvents = events.filter((e) => e.type === 'consume');
  const purchaseEvents = events.filter((e) => e.type === 'purchase');

  const startMs = observedSince
    ? toMs(observedSince)
    : Math.min(nowMs, ...events.map((e) => toMs(e.ts)).filter(Number.isFinite));

  const spanDays = Math.max(0, (nowMs - startMs) / DAY_MS);
  const observedDays = effectiveWindow(spanDays, cfg.halfLifeDays);

  const consumed = weightedQuantity(consumeEvents, nowMs, cfg.halfLifeDays);
  const purchased = weightedQuantity(purchaseEvents, nowMs, cfg.halfLifeDays);

  // Welche Buchungen messen den Verbrauch?
  //
  // Verbrauchsbuchungen sind die direkte Auskunft. Sie sind aber nur so
  // vollständig, wie im Alltag tatsächlich mitgepflegt wird -- und wer
  // wochenlang nichts abhakt, hat deshalb nicht nichts gegessen. Würde man
  // die Lücken als "null Verbrauch beobachtet" werten, fiele die Rate gegen
  // null und die App meldete Nachschubbedarf nie.
  //
  // Nachkäufe sind die zweite Spur derselben Sache: Solange der Vorrat im
  // Mittel gleich groß bleibt, ist über längere Zeit gekaufte Menge gleich
  // verbrauchte Menge. Deshalb zählt, welche der beiden Spuren mehr Verbrauch
  // belegt -- nicht beide addiert, das wäre Doppelzählung.
  const signal = Math.max(consumed, purchased);
  let source = 'default';
  if (signal > 0) source = purchased > consumed ? 'purchases' : 'consumption';

  const beta0 = cfg.priorStrengthDays;
  const alpha0 = Math.max(cfg.priorRatePerDay, 1e-9) * beta0;

  const alpha = alpha0 + signal;
  const beta = beta0 + observedDays;

  return {
    ratePerDay: alpha / beta,
    sd: Math.sqrt(alpha) / beta,
    evidence: signal,
    observedDays,
    source,
  };
}

/**
 * Wie sehr darf man der Schätzung trauen? Getrieben von der Menge echter
 * Beobachtungen -- nicht von der Rate selbst.
 * @returns {{level:'learning'|'rough'|'good', label:string}}
 */
export function confidenceOf(rate) {
  if (rate.evidence < 1.5) return { level: 'learning', label: 'lernt noch' };
  if (rate.evidence < 4) return { level: 'rough', label: 'grobe Schätzung' };
  return { level: 'good', label: 'gut geschätzt' };
}

/**
 * Rechnet Bestand + Rate in eine Reichweite um.
 *
 * @param {number} stock  Bestand in Packungen.
 * @param {object} rate   Ergebnis von estimateConsumptionRate.
 * @param {Date}   [now]
 * @returns {{daysLeft:number|null, emptyOn:Date|null, earliest:Date|null, latest:Date|null}}
 */
export function projectDepletion(stock, rate, now = new Date()) {
  if (!(stock > 0)) {
    return { daysLeft: 0, emptyOn: new Date(toMs(now)), earliest: null, latest: null };
  }
  if (!(rate.ratePerDay > 0)) {
    return { daysLeft: null, emptyOn: null, earliest: null, latest: null };
  }

  const nowMs = toMs(now);
  const addDays = (days) => new Date(nowMs + Math.min(days, 3650) * DAY_MS);

  // Ein Sigma um die geschätzte Rate ergibt das Unsicherheitsband.
  // Schnellerer Verbrauch => früheres Datum, und umgekehrt.
  const fast = rate.ratePerDay + rate.sd;
  const slow = Math.max(rate.ratePerDay - rate.sd, rate.ratePerDay * 0.25);

  const daysLeft = stock / rate.ratePerDay;
  return {
    daysLeft,
    emptyOn: addDays(daysLeft),
    earliest: addDays(stock / fast),
    latest: addDays(stock / slow),
  };
}

/**
 * Vollständige Einschätzung eines Produkts: Rate, Reichweite, Vertrauen
 * und ob es auf die Einkaufsliste gehört.
 *
 * @param {object} params
 * @param {object} params.product
 * @param {number} params.stock
 * @param {Array}  params.events
 * @param {Date}   [params.now]
 * @param {object} [params.config]
 * @param {number} [params.leadDays] Vorlauf: so viele Tage vorher aufnehmen.
 */
export function assessProduct({ product, stock, events, now = new Date(), config = {}, leadDays = 7 }) {
  const rate = estimateConsumptionRate({
    events,
    // `observedSince` setzt den Beobachtungsbeginn neu, wenn die Prognose
    // zurückgesetzt wurde. Ohne das zählte die Zeit davor als Zeitraum
    // ohne Verbrauch und drückte die geschätzte Rate nach unten.
    observedSince: product.observedSince ?? product.createdAt,
    now,
    config,
  });
  const projection = projectDepletion(stock, rate, now);
  const confidence = confidenceOf(rate);

  const minStock = product.minStock ?? 0;
  let need = null;
  if (stock <= 0) {
    need = { reason: 'empty', urgency: 3, text: 'leer' };
  } else if (stock <= minStock) {
    need = { reason: 'below-min', urgency: 2, text: `unter Mindestbestand (${minStock})` };
  } else if (
    confidence.level !== 'learning' &&
    projection.daysLeft !== null &&
    projection.daysLeft <= leadDays
  ) {
    /*
     * "Geht bald aus" nur, wenn die Schätzung etwas taugt.
     *
     * Solange zu wenig beobachtet wurde, kommt die Reichweite fast
     * vollständig aus dem Vorwissen -- und das schlug hier zurück: Ein eben
     * erst angelegtes Produkt hatte eine gerade so kurze Reichweite, dass es
     * sich noch am Tag des Einkaufs selbst zum Nachkaufen vorschlug. Nach dem
     * Einlesen eines Bons stand die halbe Lieferung sofort wieder auf der
     * Einkaufsliste.
     *
     * Leer und unter Mindestbestand bleiben davon unberührt: Das sind
     * abgezählte Tatsachen, keine Schätzungen.
     */
    need = { reason: 'running-out', urgency: 1, text: 'geht bald aus' };
  }

  return { rate, projection, confidence, need, stock };
}
