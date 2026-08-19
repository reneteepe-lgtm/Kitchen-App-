/**
 * Was für eine Übung ist das?
 *
 * Beim Anlegen soll niemand Muskelgruppe, Gerät und Übungsart aus drei
 * Auswahlmenüs zusammenklicken -- man steht dabei im Studio, zwischen zwei
 * Sätzen, mit einer Hand am Handy. Deshalb wird alles, was sich aus dem
 * Namen ablesen lässt, aus dem Namen abgelesen:
 *
 *  - **Muskelgruppe**, damit die Auswertung sagen kann, was zu kurz kommt.
 *  - **Gerät**, weil davon abhängt, in welchen Schritten das Gewicht
 *    überhaupt steigen kann: An der Langhantel sind es 2,5 kg, am Block
 *    einer Maschine oft 5.
 *  - **Art**, weil eine Übung entweder Gewicht mal Wiederholungen ist, oder
 *    nur Wiederholungen (Klimmzüge), oder eine gehaltene Zeit (Planke).
 *    Diese drei brauchen verschiedene Eingabefelder und verschiedene
 *    Bestwerte.
 *
 * Jede dieser Angaben ist von Hand überschreibbar; was einmal von Hand
 * gesetzt wurde, wird nie wieder überstimmt.
 */

import { normalize, words } from './text.js';

/**
 * Die Muskelgruppen, in der Reihenfolge, in der Trainingspläne sie
 * gewöhnlich aufführen: erst die großen Gruppen des Oberkörpers, dann die
 * Arme, dann die Beine, dann der Rumpf.
 */
export const MUSCLES = [
  {
    id: 'brust',
    label: 'Brust',
    icon: '🫁',
    keywords: [
      'bankdruecken', 'bank', 'bench', 'schraegbank', 'negativbank', 'butterfly',
      'fliegende', 'chestpress', 'brustpresse', 'liegestuetz', 'liegestuetze',
      'pushup', 'pushups', 'dips', 'ueberzuege', 'pullover',
    ],
  },
  {
    id: 'ruecken',
    label: 'Rücken',
    icon: '🦅',
    keywords: [
      'klimmzug', 'klimmzuege', 'pullup', 'pullups', 'chinup', 'latzug', 'lat',
      'rudern', 'row', 'langhantelrudern', 'kabelrudern', 'tbar', 'facepull',
      'reversebutterfly', 'hyperextension', 'ruecken', 'kreuzheben', 'deadlift',
      'shrugs', 'nackenziehen',
    ],
  },
  {
    id: 'schultern',
    label: 'Schultern',
    icon: '🏋️',
    keywords: [
      'schulterdruecken', 'schulterpresse', 'militarypress', 'overheadpress',
      'nackendruecken', 'seitheben', 'frontheben', 'arnolddruecken', 'upright',
      'schulter', 'delt', 'delts',
    ],
  },
  {
    id: 'arme',
    label: 'Arme',
    icon: '💪',
    keywords: [
      'bizeps', 'curl', 'curls', 'hammercurl', 'scottcurl', 'konzentrationscurl',
      'trizeps', 'trizepsdruecken', 'frenchpress', 'kickback', 'unterarm',
      'handgelenk', 'engesbankdruecken',
    ],
  },
  {
    id: 'beine',
    label: 'Beine',
    icon: '🦵',
    keywords: [
      'kniebeuge', 'kniebeugen', 'squat', 'squats', 'frontkniebeuge', 'beinpresse',
      'legpress', 'beinstrecker', 'beinbeuger', 'ausfallschritt', 'ausfallschritte',
      'lunge', 'lunges', 'wadenheben', 'waden', 'hipthrust', 'hueftheben',
      'rumaenisches', 'goblet', 'stepup', 'bulgarian', 'bulgarische',
    ],
  },
  {
    id: 'rumpf',
    label: 'Rumpf',
    icon: '🧍',
    keywords: [
      'planke', 'plank', 'unterarmstuetz', 'seitstuetz', 'crunch', 'crunches',
      'situp', 'situps', 'beinheben', 'russiantwist', 'kaefer', 'deadbug',
      'bauch', 'rumpf', 'hollow', 'ausrollen', 'abrollen',
    ],
  },
  {
    id: 'ganzkoerper',
    label: 'Ganzkörper',
    icon: '🤸',
    keywords: [
      'burpee', 'burpees', 'clean', 'umsetzen', 'snatch', 'reissen', 'thruster',
      'kettlebellswing', 'swing', 'farmerswalk', 'schlittenschieben',
    ],
  },
];

/**
 * Geräte -- und mit ihnen die kleinste Steigerung, die überhaupt möglich
 * ist.
 *
 * Diese Zahl ist der Grund, warum das Gerät überhaupt erfasst wird: Ein
 * Vorschlag "mach nächstes Mal 1 kg mehr" ist an einer Maschine mit
 * 5-kg-Blöcken nicht auszuführen, und an der Langhantel ist er es nur, wenn
 * man Zusatzscheiben besitzt, die die wenigsten Studios haben.
 */
export const EQUIPMENT = [
  { id: 'langhantel', label: 'Langhantel', short: 'LH', increment: 2.5 },
  { id: 'kurzhantel', label: 'Kurzhantel', short: 'KH', increment: 2 },
  { id: 'maschine', label: 'Maschine', short: 'Ma', increment: 5 },
  { id: 'kabel', label: 'Kabelzug', short: 'Ka', increment: 2.5 },
  { id: 'kettlebell', label: 'Kettlebell', short: 'KB', increment: 4 },
  { id: 'koerper', label: 'Körpergewicht', short: 'KG', increment: 1.25 },
];

/**
 * Die drei Arten von Übungen.
 *
 * `koerper` hat trotzdem ein Gewichtsfeld: Wer Klimmzüge mit Gurt und
 * Scheibe macht, trägt dort das Zusatzgewicht ein. Es ist dasselbe Feld wie
 * bei `gewicht`, meint aber etwas anderes -- deshalb steht in der Eingabe
 * "Zusatz" statt "Gewicht".
 */
export const KINDS = [
  { id: 'gewicht', label: 'Gewicht × Wdh.', unit: 'kg' },
  { id: 'koerper', label: 'Wiederholungen', unit: 'kg Zusatz' },
  { id: 'zeit', label: 'Zeit halten', unit: 's' },
];

export const muscleById = (id) => MUSCLES.find((m) => m.id === id) ?? MUSCLES[0];
export const equipmentById = (id) => EQUIPMENT.find((e) => e.id === id) ?? EQUIPMENT[0];
export const kindById = (id) => KINDS.find((k) => k.id === id) ?? KINDS[0];

/** Um wie viel darf das Gewicht bei dieser Übung überhaupt steigen? */
export const incrementFor = (exercise) => equipmentById(exercise?.equipment).increment;

// --- Aus dem Namen ablesen ----------------------------------------------

/**
 * Übungen, die mit dem eigenen Körpergewicht gemacht werden.
 *
 * Sie stehen hier und nicht bei den Geräten, weil der Name sie eindeutig
 * verrät: Ein Klimmzug ist immer einer, egal an welcher Stange.
 */
const KOERPER_UEBUNGEN = [
  'klimmzug', 'klimmzuege', 'pullup', 'pullups', 'chinup', 'liegestuetz',
  'liegestuetze', 'pushup', 'pushups', 'dips', 'burpee', 'burpees', 'crunch',
  'crunches', 'situp', 'situps', 'beinheben', 'ausfallschritt', 'ausfallschritte',
  'stepup', 'hyperextension',
];

/** Übungen, bei denen eine Zeit zählt und keine Wiederholung. */
const ZEIT_UEBUNGEN = [
  'planke', 'plank', 'unterarmstuetz', 'seitstuetz', 'hollow', 'wandsitz',
  'haengen', 'deadhang', 'farmerswalk',
];

/**
 * Grundübungen: viel Gewicht, wenige Wiederholungen.
 *
 * Der Unterschied ist keine Geschmacksfrage, sondern steckt in der
 * Statistik: Für eine Kniebeuge mit acht Wiederholungen lässt sich das
 * Maximalgewicht brauchbar schätzen, für einen Seitheben-Satz mit
 * fünfzehn nicht mehr. Deshalb schlägt die App bei Grundübungen von
 * vornherein einen niedrigeren Wiederholungsbereich vor.
 */
const GRUNDUEBUNGEN = [
  'kniebeuge', 'kniebeugen', 'squat', 'squats', 'kreuzheben', 'deadlift',
  'bankdruecken', 'bench', 'schulterdruecken', 'militarypress', 'overheadpress',
  'rudern', 'klimmzug', 'klimmzuege', 'beinpresse', 'hipthrust', 'clean', 'snatch',
];

/**
 * Wie deutlich trifft eines dieser Stichwörter den Namen?
 *
 * Zurück kommt die Länge des längsten Treffers, nicht bloß ja/nein -- und
 * genau daran entscheidet sich weiter unten die Muskelgruppe. "Rumänisches
 * Kreuzheben" enthält beides: `kreuzheben` (Rücken) und `rumaenisches`
 * (Beine). Das längere Stichwort ist das genauere, und es gewinnt.
 */
const treffergroesse = (name, liste) => {
  const teile = words(name);
  const ganz = normalize(name).replace(/ /g, '');
  let laengster = 0;
  for (const stichwort of liste) {
    const getroffen =
      ganz.includes(stichwort) ||
      teile.some((wort) => wort.startsWith(stichwort) || wort.endsWith(stichwort));
    if (getroffen) laengster = Math.max(laengster, stichwort.length);
  }
  return laengster;
};

const trifft = (name, liste) => treffergroesse(name, liste) > 0;

/** Welche Muskelgruppe steckt im Namen? */
export function guessMuscle(name) {
  let beste = { id: 'ganzkoerper', groesse: 0 };
  for (const muskel of MUSCLES) {
    const groesse = treffergroesse(name, muskel.keywords);
    if (groesse > beste.groesse) beste = { id: muskel.id, groesse };
  }
  return beste.id;
}

/**
 * Welches Gerät?
 *
 * Zuerst die ausdrücklichen Angaben ("KH Schrägbankdrücken", "Kabelrudern"),
 * dann die Übungen, die ihr Gerät selbst mitbringen. Was übrig bleibt, ist
 * im Zweifel eine Langhantelübung -- das ist im Studio die häufigste
 * Antwort und die, bei der eine falsche Annahme am wenigsten Schaden
 * anrichtet: 2,5 kg Schritte gehen überall.
 */
export function guessEquipment(name) {
  const ganz = normalize(name).replace(/ /g, '');

  if (/\bkh\b|kurzhantel|dumbbell|db /.test(normalize(name)) || ganz.includes('kurzhantel')) {
    return 'kurzhantel';
  }
  if (/\blh\b|langhantel|barbell/.test(normalize(name)) || ganz.includes('langhantel')) {
    return 'langhantel';
  }
  if (ganz.includes('kabel') || ganz.includes('block') || ganz.includes('seil')) return 'kabel';
  if (ganz.includes('kettlebell') || ganz.includes('kugelhantel')) return 'kettlebell';
  if (trifft(name, KOERPER_UEBUNGEN) || trifft(name, ZEIT_UEBUNGEN)) return 'koerper';
  if (
    ganz.includes('maschine') ||
    ganz.includes('presse') ||
    ganz.includes('latzug') ||
    ganz.includes('beinstrecker') ||
    ganz.includes('beinbeuger') ||
    ganz.includes('butterfly')
  ) {
    return 'maschine';
  }
  return 'langhantel';
}

export function guessKind(name) {
  if (trifft(name, ZEIT_UEBUNGEN)) return 'zeit';
  if (trifft(name, KOERPER_UEBUNGEN)) return 'koerper';
  return 'gewicht';
}

/**
 * Wie viele Wiederholungen sind das Ziel?
 *
 * Eine Zahl, kein Bereich -- der Bereich entsteht in `progression.js` von
 * selbst: erreicht man das Ziel in allen Sätzen, steigt das Gewicht, und
 * mit dem höheren Gewicht fällt man wieder darunter.
 */
export function guessRepTarget(name, kind = guessKind(name)) {
  if (kind === 'zeit') return 45;
  if (trifft(name, GRUNDUEBUNGEN)) return 6;
  if (kind === 'koerper') return 10;
  return 10;
}

/**
 * Liest alles aus dem Namen, was nicht ausdrücklich angegeben wurde.
 *
 * Angegebene Werte gewinnen immer -- `guessAttributes` ist ein Vorschlag,
 * keine Korrektur.
 */
export function guessAttributes(name, given = {}) {
  const kind = given.kind ?? guessKind(name);
  return {
    muscle: given.muscle ?? guessMuscle(name),
    equipment: given.equipment ?? guessEquipment(name),
    kind,
    repTarget: given.repTarget ?? guessRepTarget(name, kind),
  };
}

/**
 * Ein Vorrat gängiger Übungen für den leeren Anfang.
 *
 * Nur Namen: Muskelgruppe, Gerät und Art fallen aus demselben Erraten
 * heraus wie bei allem, was von Hand eingetippt wird. Eine zweite,
 * gepflegte Liste mit fertigen Angaben würde bei jeder Änderung am Erraten
 * auseinanderlaufen -- und niemand merkte es.
 */
export const CATALOG = [
  'Bankdrücken',
  'Schrägbankdrücken KH',
  'Butterfly',
  'Liegestütze',
  'Dips',
  'Klimmzüge',
  'Latzug',
  'Langhantelrudern',
  'Kabelrudern',
  'Face Pull',
  'Kreuzheben',
  'Schulterdrücken',
  'Seitheben KH',
  'Frontheben KH',
  'Bizepscurls KH',
  'Hammercurls',
  'Trizepsdrücken Kabel',
  'French Press',
  'Kniebeugen',
  'Frontkniebeuge',
  'Beinpresse',
  'Beinstrecker',
  'Beinbeuger',
  'Rumänisches Kreuzheben',
  'Ausfallschritte',
  'Wadenheben',
  'Hip Thrust',
  'Planke',
  'Beinheben',
  'Crunches',
  'Kettlebell Swing',
  'Burpees',
];
