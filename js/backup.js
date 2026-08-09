/**
 * Wann muss an eine Sicherung erinnert werden?
 *
 * Der Vorrat liegt allein auf diesem Gerät. Das ist Absicht -- niemand muss
 * ein Konto anlegen, und niemand sonst sieht, was in eurer Küche steht --,
 * hat aber eine Kehrseite: Geht das Handy verloren oder räumt der Browser
 * auf, ist die ganze Arbeit fort. Dagegen hilft nur eine Sicherung, und an
 * die denkt von selbst niemand.
 *
 * Die Erinnerung darf deshalb sein, aber sie darf nicht nerven. Drei Regeln
 * halten sie zurück:
 *
 *  - Sie kommt erst, wenn wirklich etwas zu verlieren ist. Bei drei erfassten
 *    Produkten wäre der Verlust in fünf Minuten wieder aufgeholt.
 *  - Sie kommt nicht öfter als nötig. Wer sie wegwischt, hat eine Woche Ruhe.
 *  - Sie verschwindet von selbst, sobald gesichert wurde.
 */

/** Ab so vielen Produkten lohnt die Sicherung überhaupt. */
export const MIN_PRODUCTS = 5;

/** Nach so vielen Tagen ohne Sicherung wird erinnert. */
export const REMIND_AFTER_DAYS = 14;

/** So lange ist Ruhe, wenn die Erinnerung weggewischt wurde. */
export const SNOOZE_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {object} input
 * @param {string|null} input.lastBackupAt  ISO-Zeitpunkt der letzten Sicherung
 * @param {string|null} input.remindAfterAt ISO-Zeitpunkt, bis zu dem Ruhe ist
 * @param {number} input.productCount
 * @param {Date} [input.now]
 * @returns {{state:'nichts'|'nie'|'frisch'|'faellig', days:number|null, remind:boolean}}
 *          `days` ist das Alter der letzten Sicherung in Tagen, oder null.
 */
export function backupStatus({ lastBackupAt, remindAfterAt, productCount, now = new Date() }) {
  const days = lastBackupAt === null || lastBackupAt === undefined
    ? null
    : Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / DAY);

  // Ein Zeitstempel aus der Zukunft wäre eine verstellte Uhr -- dann lieber
  // wie "gerade eben" behandeln als mit negativem Alter rechnen.
  const age = days === null ? null : Math.max(0, days);

  if (productCount < MIN_PRODUCTS) return { state: 'nichts', days: age, remind: false };

  const state = age === null ? 'nie' : age >= REMIND_AFTER_DAYS ? 'faellig' : 'frisch';
  if (state === 'frisch') return { state, days: age, remind: false };

  const quiet = remindAfterAt ? new Date(remindAfterAt).getTime() > now.getTime() : false;
  return { state, days: age, remind: !quiet };
}

/** Der Zeitpunkt, bis zu dem nach dem Wegwischen Ruhe ist. */
export function snoozeUntil(now = new Date()) {
  return new Date(now.getTime() + SNOOZE_DAYS * DAY).toISOString();
}

/** "vor 3 Tagen", "heute" -- für die Zeile unter "Daten". */
export function describeBackupAge(days) {
  if (days === null || days === undefined) return 'noch nie';
  if (days === 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 14) return `vor ${days} Tagen`;
  if (days < 60) return `vor ${Math.round(days / 7)} Wochen`;
  return `vor ${Math.round(days / 30)} Monaten`;
}

/** "143 KB" -- knapp genug für eine Zeile unter dem Knopf. */
export function formatBytes(bytes) {
  if (!(bytes > 0)) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`.replace('.', ',');
}
