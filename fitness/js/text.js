/**
 * Schreibweisen vereinheitlichen.
 *
 * Übungen heißen im Studio, wie sie gerade jemand nennt: "Bankdrücken",
 * "Bankdruecken", "Bench Press", "KH Schrägbank". Damit die automatische
 * Einordnung und die Suche darüber nicht stolpern, läuft jeder Name zuerst
 * durch `normalize`.
 */

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    // Akzente abtrennen und verwerfen (é -> e).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Die einzelnen Wörter eines Namens, schon vereinheitlicht. */
export const words = (text) => normalize(text).split(' ').filter(Boolean);

/**
 * Trifft ein Wortstamm irgendwo im Namen?
 *
 * Getroffen wird, wenn ein Wort mit dem Stamm anfängt oder aufhört --
 * deutsche Zusammensetzungen wie "Schrägbankdrücken" oder "Frontkniebeuge"
 * liefen sonst ins Leere.
 */
export function hasStem(name, stem) {
  return words(name).some((word) => word.startsWith(stem) || word.endsWith(stem));
}

/**
 * Bewertet, wie gut eine Übung zur Suchanfrage passt.
 *
 * Gesucht wird während des Trainings, mit einer Hand und oft im Stehen. Die
 * Anfrage ist deshalb kurz und selten vollständig -- "kni" muss die
 * Kniebeuge finden, "bank" das Bankdrücken. Ein Präfix-Treffer irgendwo im
 * Namen genügt; wer mehr tippt, kommt weiter nach oben.
 *
 * @returns {number|null} 0..1, oder null wenn es kein Treffer ist
 */
export function scoreMatch(query, exercise) {
  const q = normalize(query);
  if (!q) return null;

  const name = normalize(exercise.name);

  if (name === q) return 1;
  if (name.startsWith(q)) return 0.9;
  if (words(name).some((word) => word.startsWith(q))) return 0.8;
  if (name.includes(q)) return 0.6;
  // Zusammensetzungen von hinten: "druecken" findet "Bankdruecken".
  if (words(name).some((word) => word.endsWith(q))) return 0.5;
  return null;
}

/**
 * Sucht in Übungen.
 *
 * Sortiert wird nach Treffergüte, bei Gleichstand danach, was zuletzt
 * trainiert wurde. Das ist im Studio die richtige Reihenfolge: Wer "rudern"
 * tippt und drei Ruderübungen im Verzeichnis hat, meint fast immer die,
 * die er auch letzte Woche gemacht hat.
 */
export function searchExercises(query, exercises) {
  return exercises
    .map((exercise) => ({ exercise, score: scoreMatch(query, exercise) }))
    .filter((hit) => hit.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.exercise.lastDoneAt ?? '').localeCompare(a.exercise.lastDoneAt ?? '') ||
        a.exercise.name.localeCompare(b.exercise.name, 'de'),
    )
    .map((hit) => hit.exercise);
}
