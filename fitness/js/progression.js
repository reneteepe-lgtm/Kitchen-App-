/**
 * Was steht heute an?
 *
 * Die Frage, für die man sonst im alten Heft blättert. Die App beantwortet
 * sie mit einem Vorschlag, der aus einer einzigen Regel folgt: **Ziel
 * erreicht, dann mehr Gewicht.**
 *
 * Das ist absichtlich das einfachste Verfahren, das trägt -- doppelte
 * Progression, wie sie in jedem Anfängerplan steht:
 *
 *  1. Ein Gewicht wird so lange beibehalten, bis alle Sätze das
 *     Wiederholungsziel erreichen.
 *  2. Dann steigt das Gewicht um den kleinsten Schritt, den das Gerät
 *     hergibt -- und die Wiederholungen fallen von selbst wieder darunter.
 *
 * Was hier bewusst *nicht* passiert: eine Formel, die aus Wochenvolumen und
 * geschätztem Maximalgewicht ein Tagesgewicht errechnet. Solche Vorschläge
 * kann man nicht nachvollziehen, und was man nicht nachvollziehen kann,
 * befolgt man im Studio auch nicht.
 *
 * Der Vorschlag ist immer nur ein Vorschlag. Er steht in den Eingabefeldern
 * schon drin und lässt sich mit zwei Fingertipps überschreiben.
 */

import { workingSets, byTime } from './model.js';
import { incrementFor } from './muscles.js';

/** Auf ein Gewicht runden, das man auch tatsächlich auflegen kann. */
export function roundToIncrement(kg, increment) {
  if (!(increment > 0)) return Math.round(kg * 2) / 2;
  return Math.round(kg / increment) * increment;
}

/** Die Sätze der letzten Trainings dieser Übung, jüngste Einheit zuletzt. */
function bySession(sets) {
  const gruppen = new Map();
  for (const satz of workingSets(sets).sort(byTime)) {
    if (!gruppen.has(satz.sessionId)) gruppen.set(satz.sessionId, []);
    gruppen.get(satz.sessionId).push(satz);
  }
  return [...gruppen.values()];
}

const schwerster = (saetze) => saetze.reduce((a, b) => ((b.weight ?? 0) > (a.weight ?? 0) ? b : a));

/**
 * Verfehlt eine Einheit ihr Ziel deutlich?
 *
 * "Deutlich" heißt: der beste Satz lag drei Wiederholungen unter dem Ziel.
 * Eine einzelne solche Einheit ist ein schlechter Tag -- zu wenig Schlaf,
 * zu spät gegessen. Zwei hintereinander sind ein Muster, und dann ist
 * weniger Gewicht der schnellere Weg nach oben.
 */
const deutlichVerfehlt = (saetze, ziel) =>
  Math.max(...saetze.map((satz) => satz.reps ?? 0)) <= ziel - 3;

/**
 * Der Vorschlag für die nächste Einheit dieser Übung.
 *
 * @param {object} exercise
 * @param {Array} sets Alle Sätze dieser Übung, in beliebiger Reihenfolge
 * @returns {{weight:number, reps:number|null, seconds:number|null, setCount:number,
 *            kind:'neu'|'steigern'|'halten'|'entlasten', reason:string}}
 */
export function suggestNext(exercise, sets) {
  const ziel = exercise?.repTarget ?? 10;
  const schritt = incrementFor(exercise);
  const einheiten = bySession(sets);

  if (!einheiten.length) {
    const anfang = {
      zeit: 'Noch nie gemacht — halte, so lange es sauber geht.',
      koerper: 'Noch nie gemacht — mach so viele, wie sauber gehen.',
      gewicht: 'Noch nie gemacht — such dir ein Gewicht, mit dem du das Ziel sicher schaffst.',
    };
    return {
      weight: 0,
      reps: exercise?.kind === 'zeit' ? null : ziel,
      seconds: exercise?.kind === 'zeit' ? ziel : null,
      setCount: 3,
      kind: 'neu',
      reason: anfang[exercise?.kind] ?? anfang.gewicht,
    };
  }

  const letzte = einheiten.at(-1);
  const vorletzte = einheiten.at(-2);

  // Zeitübungen kennen kein Gewicht; bei ihnen wächst die Zeit.
  if (exercise?.kind === 'zeit') {
    const beste = Math.max(...letzte.map((satz) => satz.seconds ?? 0));
    const geschafft = beste >= ziel;
    return {
      weight: 0,
      reps: null,
      seconds: geschafft ? Math.round((beste + 10) / 5) * 5 : ziel,
      setCount: letzte.length,
      kind: geschafft ? 'steigern' : 'halten',
      reason: geschafft
        ? `${beste} s gehalten — nimm zehn Sekunden dazu.`
        : `Zuletzt ${beste} s. Ziel sind ${ziel} s.`,
    };
  }

  const top = schwerster(letzte);
  const gewicht = top.weight ?? 0;
  const alleGeschafft = letzte.every((satz) => (satz.reps ?? 0) >= ziel);
  const besteWdh = Math.max(...letzte.map((satz) => satz.reps ?? 0));

  /**
   * Klimmzüge und Liegestütze ohne Zusatzgewicht wachsen in
   * Wiederholungen, nicht in Kilogramm. Wer sechs Klimmzüge schafft,
   * hängt sich nicht als Nächstes eine Scheibe um -- er macht sieben.
   * Erst wer ohnehin mit Gurt trainiert, steigert wieder am Gewicht.
   */
  if (exercise?.kind === 'koerper' && alleGeschafft && !gewicht) {
    return {
      weight: 0,
      reps: besteWdh + 1,
      seconds: null,
      setCount: letzte.length,
      kind: 'steigern',
      reason: `Letztes Mal ${besteWdh} Wdh. — versuch eine mehr.`,
    };
  }

  if (alleGeschafft) {
    return {
      weight: roundToIncrement(gewicht + schritt, schritt),
      reps: ziel,
      seconds: null,
      setCount: letzte.length,
      kind: 'steigern',
      reason:
        letzte.length === 1
          ? `Letztes Mal ${besteWdh} Wdh. geschafft — leg ${formatSchritt(schritt)} drauf.`
          : `Letztes Mal alle ${letzte.length} Sätze mit ${ziel} Wdh. — leg ${formatSchritt(schritt)} drauf.`,
    };
  }

  if (vorletzte && deutlichVerfehlt(letzte, ziel) && deutlichVerfehlt(vorletzte, ziel)) {
    return {
      weight: Math.max(schritt, roundToIncrement(gewicht * 0.9, schritt)),
      reps: ziel,
      seconds: null,
      setCount: letzte.length,
      kind: 'entlasten',
      reason: 'Zwei Trainings unter dem Ziel — geh zehn Prozent runter und arbeite dich neu hoch.',
    };
  }

  // Alle Wiederholungen des letzten Mals, nicht nur die beste: "8 von 8"
  // klänge, als wäre das Ziel erreicht -- dabei sind es die Sätze danach,
  // an denen es hängt.
  const verlauf = letzte.map((satz) => satz.reps ?? 0).join(', ');

  return {
    weight: gewicht,
    reps: ziel,
    seconds: null,
    setCount: letzte.length,
    kind: 'halten',
    reason:
      exercise?.kind === 'koerper' && !gewicht
        ? `Zuletzt ${verlauf} Wdh. — dabei bleiben, bis alle Sätze auf ${ziel} stehen.`
        : `Zuletzt ${verlauf} Wdh. — dasselbe Gewicht, bis alle Sätze auf ${ziel} stehen.`,
  };
}

const formatSchritt = (kg) =>
  `${kg.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg`;

/**
 * Der Vorschlag für eine Übung mitten in der laufenden Einheit.
 *
 * Unterscheidet sich vom Vorschlag für den nächsten Trainingstag: Wer heute
 * schon zwei Sätze gemacht hat, will für den dritten dasselbe Gewicht
 * sehen, das gerade auf der Stange liegt -- nicht das Ziel für nächste
 * Woche.
 */
export function suggestForToday(exercise, sets, sessionId) {
  const heute = workingSets(sets)
    .filter((satz) => satz.sessionId === sessionId)
    .sort(byTime);

  if (heute.length) {
    const letzter = heute.at(-1);
    return {
      weight: letzter.weight ?? 0,
      reps: exercise?.kind === 'zeit' ? null : (letzter.reps ?? exercise?.repTarget ?? 10),
      seconds: exercise?.kind === 'zeit' ? letzter.seconds : null,
      setCount: heute.length + 1,
      kind: 'halten',
      reason: `Satz ${heute.length + 1} heute.`,
    };
  }

  // Vor dem ersten Satz zählt allein, was an den Tagen davor war.
  return suggestNext(exercise, sets.filter((satz) => satz.sessionId !== sessionId));
}
