/**
 * Der Punkt auf dem App-Symbol.
 *
 * Er zeigt dieselbe Zahl wie der Reiter "Ablauf": was innerhalb der
 * Warnfrist aufgebraucht werden sollte, samt dem, was schon abgelaufen ist.
 * Die Einkaufsliste zählt bewusst nicht mit -- die braucht keine
 * Aufmerksamkeit, solange man zu Hause ist, und ein Punkt, der immer da ist,
 * wird nach zwei Wochen nicht mehr gelesen. Kein Punkt soll heißen: nichts
 * liegt an.
 *
 * Was der Punkt nicht kann: sich von selbst ändern. Eine Web-App rechnet
 * nur, während sie läuft. Die Zahl entsteht also in dem Augenblick, in dem
 * die App zuletzt offen war, und steht dann so lange, bis sie wieder geöffnet
 * wird. Er ist ein Merkzettel, kein Wecker -- und genau so ist er unter
 * "Mehr" auch beschrieben.
 */

/** Ob dieses Gerät überhaupt einen Punkt setzen kann. */
export function supportsBadge(nav = globalThis.navigator) {
  return typeof nav?.setAppBadge === 'function' && typeof nav?.clearAppBadge === 'function';
}

/**
 * Setzt oder löscht den Punkt.
 *
 * @returns {Promise<'gesetzt'|'leer'|'nicht-moeglich'|'verweigert'>}
 */
export async function applyBadge(count, { enabled = true, nav = globalThis.navigator } = {}) {
  if (!supportsBadge(nav)) return 'nicht-moeglich';
  try {
    if (!enabled || !(count > 0)) {
      await nav.clearAppBadge();
      return 'leer';
    }
    await nav.setAppBadge(count);
    return 'gesetzt';
  } catch {
    // Auf dem iPhone wirft der Aufruf, wenn die Mitteilungs-Erlaubnis fehlt.
    return 'verweigert';
  }
}

/**
 * Holt die Erlaubnis, die der Punkt auf manchen Geräten braucht.
 *
 * Auf dem iPhone hängt er an der Mitteilungs-Erlaubnis -- ohne die bleibt das
 * Symbol leer. Auf Android braucht es sie nicht; dort gibt es entweder keine
 * Frage oder sie ist folgenlos. Deshalb ist ein "nein" hier kein Abbruch:
 * Der Punkt wird trotzdem versucht, und was daraus wurde, steht danach unter
 * "Mehr".
 *
 * Gefragt wird nur auf Knopfdruck. Eine Erlaubnisfrage beim Starten ist die
 * sicherste Art, ein "nein" zu bekommen, das sich nie wieder zurücknehmen
 * lässt.
 *
 * @returns {Promise<'nicht-noetig'|'erlaubt'|'verweigert'>}
 */
export async function askNotificationPermission({ notification = globalThis.Notification } = {}) {
  if (typeof notification?.requestPermission !== 'function') return 'nicht-noetig';
  if (notification.permission === 'granted') return 'erlaubt';
  // Ein einmal abgelehntes "nein" lässt sich per Skript nicht neu erfragen;
  // ein weiterer Aufruf kehrte nur wirkungslos zurück.
  if (notification.permission === 'denied') return 'verweigert';
  try {
    return (await notification.requestPermission()) === 'granted' ? 'erlaubt' : 'verweigert';
  } catch {
    return 'verweigert';
  }
}

/**
 * Der Satz, der unter dem Schalter steht.
 *
 * Er soll den tatsächlichen Zustand sagen, nicht die Absicht: Wer den
 * Schalter umlegt und danach nie einen Punkt sieht, soll hier lesen können,
 * woran es liegt.
 */
export function describeBadgeState({ enabled, supported, result, count }) {
  if (!supported) return 'Dieses Gerät kann keinen Punkt auf dem Symbol anzeigen.';
  if (!enabled) return 'Aus — das Symbol bleibt unverändert.';
  if (result === 'verweigert') {
    return 'Ohne Erlaubnis für Mitteilungen bleibt das Symbol leer. Auf dem iPhone lässt sie sich in den Einstellungen unter dieser App nachtragen.';
  }
  if (!(count > 0)) return 'An — gerade läuft nichts demnächst ab, das Symbol bleibt frei.';
  return count === 1
    ? 'An — das Symbol zeigt gerade eine 1.'
    : `An — das Symbol zeigt gerade eine ${count}.`;
}
