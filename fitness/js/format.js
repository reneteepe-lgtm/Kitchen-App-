/**
 * Aufbereitung der Zahlen für die Anzeige.
 *
 * Zwei Dinge passieren hier, die sonst überall im Code verstreut wären:
 *
 *  1. **Einheiten.** Gespeichert wird ausnahmslos in Kilogramm, angezeigt
 *     wird, was eingestellt ist. Ein Umschalten auf Pfund ändert deshalb
 *     keine einzige gespeicherte Zahl -- und ein Zurückschalten auch nicht.
 *     Wer Gewichte in der Anzeigeeinheit speicherte, hätte nach dem ersten
 *     Umschalten ein Protokoll, in dem 100 mal 100 heißt und mal 45.
 *  2. **Nachkommastellen.** Gewichte im Studio sind 2,5er-Schritte;
 *     "62,50 kg" und "62,5000000001 kg" sind beide falsch. Gerundet wird
 *     einmal, hier.
 */

const LB_JE_KG = 2.20462262185;

export const UNITS = [
  { id: 'kg', label: 'Kilogramm', short: 'kg' },
  { id: 'lb', label: 'Pfund (lb)', short: 'lb' },
];

/** Kilogramm in die Anzeigeeinheit. */
export const toDisplay = (kg, unit = 'kg') =>
  unit === 'lb' ? (kg ?? 0) * LB_JE_KG : (kg ?? 0);

/** Aus der Anzeigeeinheit zurück in Kilogramm -- so wird gespeichert. */
export const fromDisplay = (wert, unit = 'kg') =>
  unit === 'lb' ? (wert ?? 0) / LB_JE_KG : (wert ?? 0);

/** Zahl mit deutschem Komma und höchstens einer Nachkommastelle. */
export function formatNumber(wert, maximumFractionDigits = 1) {
  return Number(wert ?? 0).toLocaleString('de-DE', { maximumFractionDigits });
}

/** "62,5 kg" -- ohne die Null hinter dem Komma, wenn keine nötig ist. */
export function formatWeight(kg, unit = 'kg', { suffix = true } = {}) {
  const wert = toDisplay(kg, unit);
  const text = formatNumber(wert, unit === 'lb' ? 0 : 1);
  return suffix ? `${text} ${unit}` : text;
}

/**
 * Volumen -- die Zahl, die schnell sechsstellig wird.
 *
 * Ab einer Tonne wird umgerechnet: "12,4 t" liest man auf einen Blick,
 * "12 400 kg" muss man zählen.
 */
export function formatVolume(kg, unit = 'kg') {
  const wert = toDisplay(kg, unit);
  if (unit === 'lb') return `${formatNumber(wert, 0)} lb`;
  if (wert >= 1000) return `${formatNumber(wert / 1000, 1)} t`;
  return `${formatNumber(wert, 0)} kg`;
}

/**
 * Ein Satz in einer Zeile.
 *
 * Die drei Übungsarten sehen bewusst verschieden aus, weil sie verschieden
 * sind: "80 kg × 8" ist eine Gewichtsübung, "8 Wdh." eine mit dem eigenen
 * Körper, "+10 kg × 8" eine mit Zusatzgewicht, "45 s" eine gehaltene.
 */
export function formatSet(set, exercise, unit = 'kg') {
  if (exercise?.kind === 'zeit') return `${set.seconds ?? 0} s`;

  const wdh = `${set.reps ?? 0} Wdh.`;
  if (exercise?.kind === 'koerper') {
    return set.weight ? `+${formatWeight(set.weight, unit)} × ${set.reps ?? 0}` : wdh;
  }
  return `${formatWeight(set.weight, unit)} × ${set.reps ?? 0}`;
}

/** Mehrere Sätze zusammengefasst: "3 × 8 @ 80 kg" statt drei gleicher Zeilen. */
export function formatSetGroup(sets, exercise, unit = 'kg') {
  if (!sets.length) return '';

  const gleich =
    sets.every((satz) => satz.weight === sets[0].weight) &&
    sets.every((satz) => satz.reps === sets[0].reps) &&
    sets.every((satz) => satz.seconds === sets[0].seconds);

  if (gleich && sets.length > 1) {
    return `${sets.length} × ${formatSet(sets[0], exercise, unit)}`;
  }
  return sets.map((satz) => formatSet(satz, exercise, unit)).join(' · ');
}

// --- Zeit ----------------------------------------------------------------

const datumKurz = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' });
const datumLang = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const wochentag = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
const uhrzeit = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (d) => (d ? datumKurz.format(new Date(d)) : '');
export const formatDateLong = (d) => (d ? datumLang.format(new Date(d)) : '');
export const formatWeekday = (d) => (d ? wochentag.format(new Date(d)) : '');
export const formatTime = (d) => (d ? uhrzeit.format(new Date(d)) : '');

const tagesAnfang = (d) => {
  const kopie = new Date(d);
  kopie.setHours(0, 0, 0, 0);
  return kopie;
};

/** Ganze Tage zwischen zwei Zeitpunkten -- über Kalendertage, nicht über Stunden. */
export function daysBetween(dateish, now = new Date()) {
  if (!dateish) return null;
  return Math.round((tagesAnfang(now) - tagesAnfang(dateish)) / 86400000);
}

/** "heute", "gestern", "vor 3 Tagen", "vor 2 Wochen" */
export function relativeDay(dateish, now = new Date()) {
  const tage = daysBetween(dateish, now);
  if (tage === null) return '';
  if (tage <= 0) return 'heute';
  if (tage === 1) return 'gestern';
  if (tage < 7) return `vor ${tage} Tagen`;
  if (tage < 14) return 'vor einer Woche';
  if (tage < 60) return `vor ${Math.round(tage / 7)} Wochen`;
  if (tage < 365) return `vor ${Math.round(tage / 30)} Monaten`;
  return 'vor über einem Jahr';
}

/** Die Pausenuhr: "1:30". Sekunden immer zweistellig. */
export function formatClock(seconds) {
  const gesamt = Math.max(0, Math.round(seconds ?? 0));
  const min = Math.floor(gesamt / 60);
  const sek = gesamt % 60;
  return `${min}:${String(sek).padStart(2, '0')}`;
}

/** Trainingsdauer: "48 min", "1:15 h" */
export function formatDuration(minutes) {
  const min = Math.max(0, Math.round(minutes ?? 0));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
}

export const plural = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;

/** "+12 %" / "−8 %" -- mit echtem Minuszeichen, nicht mit Bindestrich. */
export function formatChange(change) {
  if (change === null || change === undefined) return '';
  const prozent = Math.round(change * 100);
  if (prozent === 0) return '±0 %';
  return `${prozent > 0 ? '+' : '−'}${Math.abs(prozent)} %`;
}
