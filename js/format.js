/**
 * Aufbereitung der Zahlen für die Anzeige.
 *
 * Die Prognose ist eine Schätzung, und die Formulierung soll das zeigen:
 * Bei dünner Datenlage steht dort bewusst kein Datum, sondern der Hinweis,
 * dass noch gelernt wird. Ein exakt wirkendes Datum, das auf zwei Buchungen
 * beruht, wäre schlechter als gar keine Angabe.
 */

// Kurz halten: Die Angaben stehen in schmalen Listenzeilen neben dem Namen,
// und ein umbrechendes Datum macht die Zeile doppelt so hoch.
const dateFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' });
const dateFormatLong = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export const formatDate = (d) => (d ? dateFormat.format(new Date(d)) : '');
export const formatDateLong = (d) => (d ? dateFormatLong.format(new Date(d)) : '');

/** "in 3 Tagen", "morgen", "seit 2 Tagen abgelaufen" */
export function relativeDays(days) {
  if (days === null || days === undefined) return '';
  if (days < -1) return `seit ${Math.abs(days)} Tagen abgelaufen`;
  if (days === -1) return 'seit gestern abgelaufen';
  if (days === 0) return 'läuft heute ab';
  if (days === 1) return 'läuft morgen ab';
  return `noch ${days} Tage`;
}

/** Reichweite in einer Einheit, die zur Größenordnung passt. */
export function humanDuration(days) {
  if (days === null || days === undefined) return '';
  if (days < 1) return 'weniger als einen Tag';
  if (days < 14) return `${Math.round(days)} Tage`;
  if (days < 70) return `${Math.round(days / 7)} Wochen`;
  if (days < 730) return `${Math.round(days / 30)} Monate`;
  return 'über zwei Jahre';
}

/**
 * Der Prognosesatz für eine Produktzeile.
 * @returns {{text:string, tone:'empty'|'urgent'|'soon'|'ok'|'unknown'}}
 */
export function describeForecast(assessment) {
  const { stock, projection, confidence } = assessment;

  if (stock <= 0) return { text: 'leer', tone: 'empty' };
  if (projection.daysLeft === null) return { text: 'Reichweite unbekannt', tone: 'unknown' };

  // Ohne belastbare Historie wird kein Datum versprochen.
  if (confidence.level === 'learning') {
    return { text: 'Verbrauch wird noch gelernt', tone: 'unknown' };
  }

  const days = Math.round(projection.daysLeft);
  const qualifier = confidence.level === 'rough' ? 'etwa ' : '';
  const tone = days <= 3 ? 'urgent' : days <= 10 ? 'soon' : 'ok';

  return {
    text: `reicht ${qualifier}${humanDuration(projection.daysLeft)} (bis ${formatDate(projection.emptyOn)})`,
    tone,
  };
}

/** Wie oft wird nachgekauft? Menschlicher als "0,143 pro Tag". */
export function describeRate(rate) {
  if (!(rate.ratePerDay > 0)) return '';
  const daysPerPack = 1 / rate.ratePerDay;
  if (daysPerPack < 1) return `${(rate.ratePerDay).toFixed(1)} pro Tag`;
  return `1 alle ${humanDuration(daysPerPack)}`;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
