/**
 * Die Satzpause.
 *
 * Eine Uhr, die nach dem Eintragen eines Satzes von selbst losläuft. Sie
 * ist der Grund, warum man das Handy zwischen den Sätzen überhaupt in die
 * Hand nimmt -- und der einzige Teil der App, der von der Uhrzeit abhängt.
 *
 * Deshalb steht hier kein `setInterval` und kein Zustand, sondern nur eine
 * Rechnung: aus Startzeitpunkt, Dauer und "jetzt" wird ausgerechnet, wo die
 * Uhr steht. Das hat einen handfesten Vorteil gegenüber einem
 * mitzählenden Zähler: Handys halten Zeitgeber an, sobald der Bildschirm
 * ausgeht. Ein Zähler stünde nach dem Aufwachen zu hoch; eine Rechnung
 * stimmt immer, weil sie nichts zählt, sondern nachsieht.
 */

export const REST_CHOICES = [60, 90, 120, 180, 240];

/**
 * Wo steht die Pausenuhr?
 *
 * @returns {{remaining:number, elapsed:number, progress:number, done:boolean}}
 */
export function restState(startedAt, seconds, now = new Date()) {
  const dauer = Math.max(0, seconds ?? 0);
  const vergangen = Math.max(0, (new Date(now) - new Date(startedAt)) / 1000);
  const rest = Math.max(0, dauer - vergangen);

  return {
    remaining: rest,
    elapsed: vergangen,
    progress: dauer ? Math.min(1, vergangen / dauer) : 1,
    done: rest <= 0,
  };
}

/**
 * Wie lange die Pause nach diesem Satz dauern soll.
 *
 * Schwere Grundübungen brauchen mehr Pause als Seitheben -- nicht als
 * Lehrmeinung, sondern als Erfahrungswert, den die App als Vorschlag
 * einträgt. Verändern lässt sie sich mit einem Tipp, und der eingestellte
 * Wert gilt dann für diesen Satz.
 */
export function suggestRest(exercise, base = 120) {
  if (exercise?.kind === 'zeit') return Math.round(base * 0.5);
  if ((exercise?.repTarget ?? 10) <= 6) return Math.round(base * 1.5);
  if ((exercise?.repTarget ?? 10) >= 12) return Math.round(base * 0.75);
  return base;
}

/**
 * Ob die Uhr in dieser Runde gerade abgelaufen ist.
 *
 * Braucht es, weil das Signal genau einmal kommen soll: Die Oberfläche
 * fragt im Sekundentakt nach, und ohne diesen Vergleich vibrierte das Handy
 * ab dem Ablauf durchgehend weiter.
 */
export const justFinished = (vorher, jetzt) => !vorher.done && jetzt.done;
