/**
 * Die Oberfläche.
 *
 * Ein einziger Zustand, ein einziger Zeichenweg: Jede Änderung geht in den
 * `Store`, der Store meldet sich, und daraufhin wird die sichtbare Ansicht
 * neu aufgebaut. Es gibt keinen zweiten Weg, an dem sich die Anzeige und
 * die Daten auseinanderentwickeln könnten.
 *
 * Der Aufbau folgt der Reihenfolge, in der man die App benutzt:
 * Start (bin ich diese Woche dran gewesen, was steht an?), Übungen,
 * Eintragen, Verlauf, Fortschritt.
 *
 * Eine Ausnahme vom "alles neu zeichnen" gibt es: die Pausenuhr. Sie
 * schreibt jede halbe Sekunde in drei Knoten und rührt den Rest der Seite
 * nicht an -- ein vollständiger Neuaufbau im Sekundentakt würde jede
 * Eingabe unterbrechen, die gerade läuft.
 */

import { Store, LocalStorageAdapter, requestPersistence } from './storage.js';
import {
  DEFAULT_SETTINGS,
  addExercise,
  updateExercise,
  removeExercise,
  withHistory,
  logSet,
  removeSet,
  endSession,
  openSession,
  closeStaleSessions,
  setsOfSession,
  setsOfExercise,
  workingSets,
  sessionSummary,
  lastPerformance,
  effectiveWeight,
} from './model.js';
import {
  MUSCLES,
  EQUIPMENT,
  KINDS,
  CATALOG,
  muscleById,
  equipmentById,
  kindById,
  guessAttributes,
  incrementFor,
} from './muscles.js';
import {
  records,
  newRecords,
  dailySeries,
  weeklyVolume,
  muscleShare,
  weekSummary,
  weekStreak,
  trend,
  totals,
  recentExercises,
  recentRecords,
} from './stats.js';
import { suggestNext, suggestForToday } from './progression.js';
import { searchExercises } from './text.js';
import { linePath, barLayout, ringDash } from './chart.js';
import { restState, suggestRest, justFinished } from './timer.js';
import {
  UNITS,
  toDisplay,
  fromDisplay,
  formatNumber,
  formatWeight,
  formatVolume,
  formatSet,
  formatSetGroup,
  formatDate,
  formatDateLong,
  formatWeekday,
  formatTime,
  relativeDay,
  formatClock,
  formatDuration,
  formatChange,
  plural,
} from './format.js';

/**
 * Bei jeder Veröffentlichung erhöhen -- und dieselbe Nummer in `sw.js`
 * mitziehen. Ein Test wacht darüber, dass beide übereinstimmen.
 */
const APP_VERSION = '1.0.0';

/** Wie viele Wochen die Balken auf der Fortschrittsseite zeigen. */
const WOCHEN = 8;

const METRICS = [
  { id: 'e1rm', label: 'Kraft', hint: 'geschätztes Maximalgewicht für eine Wiederholung' },
  { id: 'top', label: 'Gewicht', hint: 'schwerster Satz des Tages' },
  { id: 'reps', label: 'Wdh.', hint: 'beste Wiederholungszahl des Tages' },
  { id: 'volume', label: 'Volumen', hint: 'Gewicht mal Wiederholungen, über den ganzen Tag' },
];

const ZEIT_METRICS = [
  { id: 'seconds', label: 'Zeit', hint: 'längster gehaltener Satz des Tages' },
];

// --- Kleine Werkzeuge ----------------------------------------------------

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Baut ein Element -- kürzer als drei Zeilen createElement je Knoten. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...vorhandene(children));
  return node;
}

/**
 * Wirft weg, was gar nicht gezeichnet werden soll.
 *
 * Nötig, weil `bedingung ? element : null` die übliche Schreibweise für
 * "nur manchmal" ist -- und `append`/`replaceChildren` aus einem `null`
 * ohne Murren das Wort "null" auf dem Bildschirm machen.
 */
const vorhandene = (children) =>
  children.filter((child) => child !== null && child !== undefined && child !== false);

const setChildren = (node, ...children) => node.replaceChildren(...vorhandene(children));

/** Dasselbe für SVG, das seinen eigenen Namensraum braucht. */
function svgEl(tag, props = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...vorhandene(children));
  return node;
}

/** Ein Symbol aus der Sammlung oben in index.html. */
const icon = (name, klasse = 'icon') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', klasse);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
};

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2600);
}

/** Kurzes Rütteln, wo das Gerät es kann -- für Bestwerte und das Pausenende. */
const buzz = (muster) => navigator.vibrate?.(muster);

const parseNumber = (text) => {
  const zahl = Number(String(text ?? '').replace(',', '.').trim());
  return Number.isFinite(zahl) ? zahl : null;
};

// --- Zustand -------------------------------------------------------------

const state = {
  view: 'home',
  query: '',
  muscleFilter: null,
  /** Der Dialog zum Eintragen. */
  log: { exerciseId: null, picking: true, search: '' },
  /** Die Übung, die gerade im Formular steht. */
  editing: null,
  detailExercise: null,
  detailSession: null,
  progress: { exerciseId: null, metric: 'e1rm' },
  /** Die laufende Pause: `{ startedAt, seconds }` oder `null`. */
  rest: null,
  restLast: { done: true },
};

let store;
let restInterval;

const exercisesRaw = () => store.all('exercises');
const sets = () => store.all('sets');
const sessions = () => store.all('sessions');
const exercises = () => withHistory(exercisesRaw(), sets());

/** Auch gelöschte Übungen -- der Verlauf braucht ihre Namen. */
const exerciseMap = () =>
  new Map(store.allIncludingRemoved('exercises').map((exercise) => [exercise.id, exercise]));

const unit = () => store.getSetting('unit', DEFAULT_SETTINGS.unit);
const bodyweight = () => store.getSetting('bodyweight', DEFAULT_SETTINGS.bodyweight);
const weeklyGoal = () => store.getSetting('weeklyGoal', DEFAULT_SETTINGS.weeklyGoal);
const restLength = () => store.getSetting('restSeconds', DEFAULT_SETTINGS.restSeconds);
const autoCloseHours = () => store.getSetting('autoCloseHours', DEFAULT_SETTINGS.autoCloseHours);

/** Die Einheit, die gerade läuft -- oder `null`. */
const liveSession = () => openSession(sessions(), sets(), new Date(), autoCloseHours());

// --- Start ---------------------------------------------------------------

async function main() {
  store = await new Store(new LocalStorageAdapter()).init();

  $('#app-version').textContent = APP_VERSION;

  // Vergessene Einheiten schließen, bevor irgendetwas gezeichnet wird --
  // sonst stünde beim Öffnen kurz das Training von vorgestern als laufend da.
  await closeStaleSessions(store);

  buildStaticParts();
  wireEvents();

  store.subscribe(() => render());
  render();

  // Nach dem ersten Zeichnen, damit nichts davon den Start aufhält.
  requestPersistence();
  registerServiceWorker();
}

/** Alles, was sich nie ändert und deshalb nur einmal gebaut wird. */
function buildStaticParts() {
  for (const [id, liste, feld] of [
    ['#exercise-muscle', MUSCLES, 'label'],
    ['#exercise-equipment', EQUIPMENT, 'label'],
    ['#exercise-kind', KINDS, 'label'],
  ]) {
    $(id).append(...liste.map((eintrag) => el('option', { value: eintrag.id, text: eintrag[feld] })));
  }

  $('#unit-choice').append(
    ...UNITS.map((einheit) =>
      el('button', {
        type: 'button',
        class: 'chip',
        text: einheit.label,
        dataset: { unit: einheit.id },
        onclick: () => store.setSetting('unit', einheit.id),
      }),
    ),
  );

  $('#catalog-chips').append(
    ...CATALOG.map((name) =>
      el('button', {
        type: 'button',
        class: 'chip',
        text: name,
        onclick: () => {
          $('#exercise-name').value = name;
          updateGuessLine();
        },
      }),
    ),
  );
}

function wireEvents() {
  for (const tab of $$('.tab[data-view]')) {
    tab.addEventListener('click', () => show(tab.dataset.view));
  }

  $('#btn-log').addEventListener('click', () => openLog(null));
  $('#btn-start-set').addEventListener('click', () => openLog(null));
  $('#btn-settings').addEventListener('click', () => show('more'));
  $('#open-progress').addEventListener('click', () => show('progress'));
  $('#btn-all-sessions').addEventListener('click', () => show('history'));
  $('#btn-new-exercise').addEventListener('click', () => openExerciseForm(null));
  $('#btn-end-session').addEventListener('click', onEndSession);

  $('#exercise-search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderExercises();
  });

  // Die Pausenuhr
  $('#btn-rest-plus').addEventListener('click', () => {
    if (!state.rest) return;
    state.rest = { ...state.rest, seconds: state.rest.seconds + 30 };
    tickRest();
  });
  $('#btn-rest-stop').addEventListener('click', stopRest);

  // Satz eintragen
  $('#log-exercise-button').addEventListener('click', () => {
    state.log.picking = true;
    renderLog();
    $('#log-search').focus();
  });
  $('#log-search').addEventListener('input', (event) => {
    state.log.search = event.target.value;
    renderLogResults();
  });
  $('#log-form').addEventListener('submit', onLogSubmit);
  for (const knopf of $$('[data-step]')) {
    knopf.addEventListener('click', () => stepField(knopf.dataset.step, Number(knopf.dataset.dir)));
  }

  // Übung anlegen und ändern
  $('#exercise-name').addEventListener('input', updateGuessLine);
  $('#toggle-details').addEventListener('click', () => setDetailsOpen($('#exercise-details').hidden));
  $('#exercise-kind').addEventListener('change', updateRangeLabels);
  $('#exercise-target').addEventListener('input', updateRangeLabels);
  $('#form-exercise').addEventListener('submit', onExerciseSubmit);

  // Fortschritt
  $('#progress-exercise').addEventListener('change', (event) => {
    state.progress.exerciseId = event.target.value;
    renderProgress();
  });

  // Einstellungen
  $('#setting-goal').addEventListener('input', (event) => {
    $('#goal-out').textContent = plural(Number(event.target.value), 'Einheit', 'Einheiten');
  });
  $('#setting-goal').addEventListener('change', (event) =>
    store.setSetting('weeklyGoal', Number(event.target.value)),
  );
  $('#setting-rest').addEventListener('input', (event) => {
    $('#rest-out').textContent = formatClock(Number(event.target.value));
  });
  $('#setting-rest').addEventListener('change', (event) =>
    store.setSetting('restSeconds', Number(event.target.value)),
  );
  $('#setting-bodyweight').addEventListener('change', (event) => {
    const kg = fromDisplay(parseNumber(event.target.value) ?? 0, unit());
    store.setSetting('bodyweight', kg > 0 ? kg : null);
  });

  $('#btn-export').addEventListener('click', onExport);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', onImport);
  $('#btn-reset').addEventListener('click', onReset);

  // Jeder Dialog schließt über seinen eigenen Abbrechen-Knopf.
  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close]');
    if (closer) closer.closest('dialog')?.close();
  });
}

// --- Ansichten wechseln --------------------------------------------------

function show(view) {
  state.view = view;
  for (const section of $$('.view')) section.hidden = section.id !== `view-${view}`;
  for (const tab of $$('.tab[data-view]')) {
    // `aria-current` kennt kein "false": Es wird gesetzt oder entfernt.
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
  render();
}

function render() {
  renderHome();
  if (state.view === 'exercises') renderExercises();
  if (state.view === 'history') renderHistory();
  if (state.view === 'progress') renderProgress();
  if (state.view === 'more') renderMore();

  if ($('#dlg-log').open) renderLogInfo();
  if ($('#dlg-detail').open) renderExerciseDetail();
  if ($('#dlg-session').open) renderSessionDetail();
}

// --- Startseite ----------------------------------------------------------

function renderHome() {
  const alleEinheiten = sessions();
  const woche = weekSummary(alleEinheiten, { goal: weeklyGoal() });

  // Der Ring
  const radius = 52;
  const { circumference, offset } = ringDash(woche.goal ? woche.count / woche.goal : 0, radius);
  const bogen = $('#ring-value');
  bogen.setAttribute('stroke-dasharray', String(circumference));
  bogen.setAttribute('stroke-dashoffset', String(offset));
  $('#ring-count').textContent = String(woche.count);
  $('#ring-goal').textContent = `von ${woche.goal}`;

  $('#week-headline').textContent = woche.reached
    ? 'Wochenziel geschafft'
    : woche.count === 0
      ? 'Noch nichts trainiert'
      : `Noch ${plural(woche.remaining, 'Einheit', 'Einheiten')}`;

  $('#week-sub').textContent = woche.count
    ? `${plural(woche.count, 'Einheit', 'Einheiten')} seit Montag`
    : `Dein Ziel sind ${plural(woche.goal, 'Einheit', 'Einheiten')} pro Woche`;

  const serie = weekStreak(alleEinheiten, { goal: weeklyGoal() });
  $('#streak-line').textContent = serie
    ? `${plural(serie, 'Woche', 'Wochen')} in Folge am Ziel`
    : 'Jede Woche zählt für sich.';

  renderLive();
  renderNextStrip();
  renderRecentSessions();
}

/** Die laufende Einheit. */
function renderLive() {
  const laufend = liveSession();
  $('#live-card').hidden = !laufend;
  if (!laufend) return;

  const eigene = setsOfSession(sets(), laufend.id);
  const summary = sessionSummary(laufend, sets(), exerciseMap(), bodyweight());
  const namen = exerciseMap();

  setChildren(
    $('#live-stats'),
    stat(formatDuration(summary.minutes), 'Dauer'),
    stat(String(summary.setCount), 'Sätze'),
    stat(formatVolume(summary.volume, unit()), 'Volumen'),
  );

  // Nur die letzten Sätze: Wer sechzehn Sätze hinter sich hat, will beim
  // Aufklappen nicht scrollen, sondern wissen, was er zuletzt gemacht hat.
  const letzte = eigene.slice(-4).reverse();
  setChildren(
    $('#live-sets'),
    ...letzte.map((satz) => {
      const exercise = namen.get(satz.exerciseId);
      return el(
        'div',
        { class: `set-row${satz.warmup ? ' warmup' : ''}` },
        el('span', { class: 'set-number', text: '·' }),
        el('span', { class: 'set-value', text: `${exercise?.name ?? 'Übung'} · ${formatSet(satz, exercise, unit())}` }),
        el('span', { class: 'set-note', text: formatTime(satz.at) }),
      );
    }),
  );
}

const stat = (wert, beschriftung) =>
  el('div', { class: 'stat' }, el('strong', { text: wert }), el('span', { text: beschriftung }));

/**
 * Die Vorschläge für heute.
 *
 * Was zuletzt trainiert wurde, in der Reihenfolge, in der es zuletzt dran
 * war -- mit dem Gewicht, das laut Verlauf als Nächstes ansteht. Damit
 * beantwortet die Startseite die Frage, für die man sonst das alte Heft
 * aufschlägt.
 */
function renderNextStrip() {
  const alleSaetze = sets();
  const liste = recentExercises(alleSaetze, exercises(), 8);

  $('#next-empty').hidden = liste.length > 0;

  setChildren(
    $('#next-strip'),
    ...liste.map(({ exercise, at }) => {
      const vorschlag = suggestNext(exercise, setsOfExercise(alleSaetze, exercise.id));
      return el(
        'button',
        { type: 'button', class: 'next-card', onclick: () => openLog(exercise.id) },
        el('p', { class: 'eyebrow' }, el('span', { class: 'dot' }), el('span', { text: `${muscleById(exercise.muscle).label} · ${relativeDay(at)}` })),
        el('h3', { text: exercise.name }),
        el('p', { class: 'next-target', text: zielText(exercise, vorschlag) }),
        el('p', { class: 'next-reason', text: vorschlag.reason }),
      );
    }),
  );
}

/** "62,5 kg × 8" als Ziel, in der Sprache der jeweiligen Übungsart. */
function zielText(exercise, vorschlag) {
  if (exercise.kind === 'zeit') return `${vorschlag.seconds ?? 0} s`;
  if (exercise.kind === 'koerper') {
    return vorschlag.weight
      ? `+${formatWeight(vorschlag.weight, unit())} × ${vorschlag.reps}`
      : `${vorschlag.reps} Wdh.`;
  }
  return `${formatWeight(vorschlag.weight, unit())} × ${vorschlag.reps}`;
}

function renderRecentSessions() {
  const liste = [...sessions()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 3);
  $('#sessions-empty').hidden = liste.length > 0;
  setChildren($('#recent-sessions'), ...liste.map(sessionRow));
}

function sessionRow(session) {
  const summary = sessionSummary(session, sets(), exerciseMap(), bodyweight());
  const namen = exerciseMap();
  const uebungen = summary.exerciseIds
    .map((id) => namen.get(id)?.name)
    .filter(Boolean)
    .join(', ');

  return el(
    'button',
    { type: 'button', class: 'row-item', onclick: () => openSessionDetail(session.id) },
    el(
      'span',
      { class: 'row-main' },
      el('span', {
        class: 'row-title',
        text: session.label || `${formatWeekday(session.startedAt)}, ${formatDate(session.startedAt)}`,
      }),
      el('span', { class: 'row-sub', text: uebungen || 'Ohne Sätze' }),
    ),
    el(
      'span',
      { class: 'row-right' },
      el('strong', { text: `${summary.setCount} Sätze` }),
      el('span', { text: formatVolume(summary.volume, unit()) }),
    ),
  );
}

// --- Übungen -------------------------------------------------------------

function renderExercises() {
  const alle = exercises();
  const alleSaetze = sets();

  renderMuscleFilter(alle);

  let gezeigt = state.query.trim() ? searchExercises(state.query, alle) : alle;
  if (state.muscleFilter) gezeigt = gezeigt.filter((ex) => ex.muscle === state.muscleFilter);
  if (!state.query.trim()) {
    // Ohne Suche: zuletzt trainiert zuerst, Unbenutztes ans Ende.
    gezeigt = [...gezeigt].sort(
      (a, b) =>
        (b.lastDoneAt ?? '').localeCompare(a.lastDoneAt ?? '') || a.name.localeCompare(b.name, 'de'),
    );
  }

  $('#exercises-empty').hidden = alle.length > 0;

  setChildren(
    $('#exercise-list'),
    ...gezeigt.map((exercise) => {
      const eigene = setsOfExercise(alleSaetze, exercise.id);
      const best = records(eigene, exercise, bodyweight());
      const letzte = lastPerformance(alleSaetze, exercise.id);

      return el(
        'button',
        { type: 'button', class: 'row-item', onclick: () => openExerciseDetail(exercise.id) },
        el('span', { class: 'row-emoji', text: muscleById(exercise.muscle).icon }),
        el(
          'span',
          { class: 'row-main' },
          el('span', { class: 'row-title', text: exercise.name }),
          el('span', {
            class: 'row-sub',
            text: letzte
              ? `${relativeDay(letzte.at)} · ${formatSetGroup(workingSets(letzte.sets), exercise, unit())}`
              : 'Noch nicht trainiert',
          }),
        ),
        best?.best
          ? el(
              'span',
              { class: 'row-right' },
              el('strong', { text: formatSet(best.heaviest ?? best.best, exercise, unit()) }),
              el('span', { text: 'Bestwert' }),
            )
          : null,
      );
    }),
  );
}

/**
 * Die Filterleiste über den Übungen.
 *
 * Sie zeigt nur Muskelgruppen, zu denen es auch Übungen gibt. Ein Knopf
 * "Rumpf" über einem Verzeichnis ohne Rumpfübungen führt zu genau einem
 * Ergebnis: einer leeren Seite, die man selbst herbeigetippt hat.
 */
function renderMuscleFilter(alle) {
  const belegt = new Set(alle.map((exercise) => exercise.muscle));

  setChildren(
    $('#muscle-filter'),
    el('button', {
      type: 'button',
      class: 'chip',
      text: 'Alle',
      'aria-pressed': String(state.muscleFilter === null),
      onclick: () => setMuscleFilter(null),
    }),
    ...MUSCLES.filter((muskel) => belegt.has(muskel.id)).map((muskel) =>
      el('button', {
        type: 'button',
        class: 'chip',
        text: `${muskel.icon} ${muskel.label}`,
        'aria-pressed': String(state.muscleFilter === muskel.id),
        onclick: () => setMuscleFilter(muskel.id),
      }),
    ),
  );
}

function setMuscleFilter(id) {
  state.muscleFilter = id;
  renderExercises();
}

// --- Verlauf -------------------------------------------------------------

function renderHistory() {
  const alle = [...sessions()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  $('#history-empty').hidden = alle.length > 0;
  $('#history-count').textContent = alle.length ? plural(alle.length, 'Einheit', 'Einheiten') : '';

  const knoten = [];
  let letzterMonat = '';

  for (const session of alle) {
    const monat = new Date(session.startedAt).toLocaleDateString('de-DE', {
      month: 'long',
      year: 'numeric',
    });
    if (monat !== letzterMonat) {
      knoten.push(el('p', { class: 'month-head', text: monat }));
      letzterMonat = monat;
    }
    knoten.push(sessionRow(session));
  }

  setChildren($('#history-list'), ...knoten);
}

// --- Fortschritt ---------------------------------------------------------

function renderProgress() {
  const alleSaetze = sets();
  const namen = exerciseMap();

  // Volumen je Woche
  const wochen = weeklyVolume(alleSaetze, namen, { weeks: WOCHEN, bodyweight: bodyweight() });
  const balken = barLayout(wochen.map((w) => w.volume), { width: 300, height: 90 });

  setChildren(
    $('#volume-chart'),
    svgEl(
      'svg',
      { viewBox: '0 0 300 90', role: 'img', 'aria-label': 'Volumen der letzten Wochen' },
      ...balken.map((b) =>
        svgEl('rect', {
          class: b.value > 0 ? 'chart-bar' : 'chart-bar chart-bar-empty',
          x: b.x.toFixed(1),
          y: b.value > 0 ? b.y.toFixed(1) : 87,
          width: b.width.toFixed(1),
          height: b.value > 0 ? b.height.toFixed(1) : 3,
          rx: 4,
        }),
      ),
    ),
    el(
      'div',
      { class: 'chart-labels' },
      ...wochen.map((w) => el('span', { text: formatDate(w.weekStart) })),
    ),
  );

  const richtung = trend(wochen);
  const marke = $('#volume-trend');
  // Eine leere Marke wäre ein grauer Fleck ohne Aussage.
  marke.hidden = richtung.change === null;
  marke.textContent = richtung.change === null ? '' : formatChange(richtung.change);
  marke.className = `tag ${richtung.direction === 'hoch' ? 'tag-good' : richtung.direction === 'runter' ? 'tag-warn' : ''}`;

  const diese = wochen.at(-1);
  $('#volume-note').textContent = diese
    ? `Diese Woche ${formatVolume(diese.volume, unit())} in ${plural(diese.sets, 'Satz', 'Sätzen')}. Verglichen werden die letzten vier Wochen mit den vier davor.`
    : '';

  renderExerciseChart();
  renderRecords();
  renderMuscleShares();

  const gesamt = totals(alleSaetze, sessions(), namen, bodyweight());
  setChildren(
    $('#totals-row'),
    stat(String(gesamt.sessions), 'Einheiten'),
    stat(String(gesamt.sets), 'Sätze'),
    stat(formatNumber(gesamt.reps, 0), 'Wdh.'),
    stat(formatVolume(gesamt.volume, unit()), 'Volumen'),
  );
}

function renderExerciseChart() {
  const alleSaetze = sets();
  const trainiert = exercises().filter((exercise) => exercise.setCount > 0);
  const auswahl = $('#progress-exercise');

  if (!trainiert.length) {
    auswahl.replaceChildren(el('option', { text: 'Noch keine Übung trainiert' }));
    setChildren($('#exercise-chart'), el('p', { class: 'empty-state', text: 'Trag ein paar Sätze ein — dann steht hier eine Kurve.' }));
    $('#exercise-note').textContent = '';
    setChildren($('#metric-choice'));
    return;
  }

  if (!trainiert.some((exercise) => exercise.id === state.progress.exerciseId)) {
    // Vorbelegt wird die Übung mit den meisten Sätzen: Sie hat die längste
    // Kurve und damit die einzige, die beim ersten Blick etwas zeigt.
    state.progress.exerciseId = [...trainiert].sort((a, b) => b.setCount - a.setCount)[0].id;
  }

  auswahl.replaceChildren(
    ...trainiert
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((exercise) =>
        el('option', {
          value: exercise.id,
          text: exercise.name,
          selected: exercise.id === state.progress.exerciseId,
        }),
      ),
  );

  const exercise = trainiert.find((e) => e.id === state.progress.exerciseId);
  const moeglich = exercise.kind === 'zeit' ? ZEIT_METRICS : METRICS;
  if (!moeglich.some((m) => m.id === state.progress.metric)) state.progress.metric = moeglich[0].id;

  setChildren(
    $('#metric-choice'),
    ...moeglich.map((metric) =>
      el('button', {
        type: 'button',
        class: 'chip',
        text: metric.label,
        'aria-pressed': String(state.progress.metric === metric.id),
        onclick: () => {
          state.progress.metric = metric.id;
          renderExerciseChart();
        },
      }),
    ),
  );

  const reihe = dailySeries(
    setsOfExercise(alleSaetze, exercise.id),
    exercise,
    state.progress.metric,
    bodyweight(),
  );

  if (reihe.length < 2) {
    setChildren(
      $('#exercise-chart'),
      el('p', {
        class: 'empty-state',
        text: 'Ein einzelner Trainingstag ergibt noch keine Kurve. Ab dem zweiten wird es eine.',
      }),
    );
    $('#exercise-note').textContent = '';
    return;
  }

  const werte = reihe.map((punkt) => punkt.value);
  const kurve = linePath(werte, { width: 300, height: 120, padding: 10 });

  setChildren(
    $('#exercise-chart'),
    svgEl(
      'svg',
      { viewBox: '0 0 300 120', role: 'img', 'aria-label': `Verlauf: ${exercise.name}` },
      svgEl('path', { class: 'chart-area', d: kurve.area }),
      svgEl('path', { class: 'chart-line', d: kurve.line }),
      ...kurve.points
        // Nur die Enden bekommen einen Punkt; bei dreißig Trainingstagen
        // wäre die Kurve sonst eine Perlenkette.
        .filter((_, i) => i === 0 || i === kurve.points.length - 1)
        .map((punkt) => svgEl('circle', { class: 'chart-dot', cx: punkt.x.toFixed(1), cy: punkt.y.toFixed(1), r: 4 })),
    ),
    el(
      'div',
      { class: 'chart-labels' },
      el('span', { text: formatDate(reihe[0].at) }),
      el('span', { text: formatDate(reihe.at(-1).at) }),
    ),
  );

  $('#exercise-note').textContent = metrikSatz(exercise, reihe);
}

/** Was unter der Kurve steht: der letzte Wert und die Entwicklung. */
function metrikSatz(exercise, reihe) {
  const erster = reihe[0].value;
  const letzter = reihe.at(-1).value;
  const metric = state.progress.metric;
  const wert =
    metric === 'reps'
      ? `${Math.round(letzter)} Wdh.`
      : metric === 'seconds'
        ? `${Math.round(letzter)} s`
        : metric === 'volume'
          ? formatVolume(letzter, unit())
          : formatWeight(letzter, unit());

  const teile = [`Zuletzt ${wert}`];
  if (erster > 0) teile.push(`${formatChange((letzter - erster) / erster)} seit ${formatDate(reihe[0].at)}`);
  if (metric === 'e1rm') {
    teile.push('geschätzt aus Gewicht und Wiederholungen — über zwölf Wiederholungen wird die Schätzung großzügig');
  }
  return `${teile.join(' · ')}.`;
}

function renderRecords() {
  const liste = recentRecords(sets(), exercises(), bodyweight(), 6);
  $('#records-empty').hidden = liste.length > 0;

  const worte = { weight: 'Gewicht', reps: 'Wiederholungen', estimate: 'Kraft', seconds: 'Zeit' };

  setChildren(
    $('#records-list'),
    ...liste.map(({ exercise, set, kinds, at }) =>
      el(
        'div',
        { class: 'row-item', role: 'listitem' },
        el('span', { class: 'row-emoji' }, icon('i-trophy', 'icon')),
        el(
          'span',
          { class: 'row-main' },
          el('span', { class: 'row-title', text: exercise.name }),
          el('span', {
            class: 'row-sub',
            text: `${kinds.map((k) => worte[k]).join(' und ')} · ${relativeDay(at)}`,
          }),
        ),
        el('span', { class: 'row-right' }, el('strong', { text: formatSet(set, exercise, unit()) })),
      ),
    ),
  );
}

function renderMuscleShares() {
  const seitWochen = new Date();
  seitWochen.setDate(seitWochen.getDate() - WOCHEN * 7);
  const jung = sets().filter((satz) => satz.at >= seitWochen.toISOString());

  const anteile = muscleShare(jung, exerciseMap(), bodyweight());

  // Ein Balken bei null Prozent will erklärt werden: Ohne angegebenes
  // Körpergewicht bewegen Klimmzüge rechnerisch nichts.
  const stillerNuller = !bodyweight() && anteile.some(({ share }) => share === 0);

  setChildren(
    $('#muscle-shares'),
    ...(anteile.length
      ? anteile.map(({ muscle, share }) =>
          el(
            'div',
            { class: 'share-row' },
            el('span', { class: 'share-label', text: `${muscleById(muscle).icon} ${muscleById(muscle).label}` }),
            el('span', { class: 'share-track' }, el('span', { class: 'share-fill', style: `width:${Math.round(share * 100)}%` })),
            el('span', { class: 'share-value', text: `${Math.round(share * 100)} %` }),
          ),
        )
      : [el('p', { class: 'empty-state', text: 'Noch nichts trainiert in den letzten Wochen.' })]),
    stillerNuller
      ? el('p', {
          class: 'muted fineprint',
          text: 'Bei null Prozent fehlt das Körpergewicht: Klimmzüge und Liegestütze zählen erst mit, wenn du es in den Einstellungen angibst.',
        })
      : null,
  );
}

// --- Einstellungen -------------------------------------------------------

function renderMore() {
  $('#setting-goal').value = String(weeklyGoal());
  $('#goal-out').textContent = plural(weeklyGoal(), 'Einheit', 'Einheiten');
  $('#setting-rest').value = String(restLength());
  $('#rest-out').textContent = formatClock(restLength());

  for (const chip of $$('#unit-choice .chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.unit === unit()));
  }

  const kg = bodyweight();
  // Nur setzen, wenn das Feld nicht gerade beschrieben wird -- sonst
  // springt der Wert unter den Fingern.
  if (document.activeElement !== $('#setting-bodyweight')) {
    $('#setting-bodyweight').value = kg ? formatNumber(toDisplay(kg, unit()), 1) : '';
  }

  const bytes = store.usedBytes();
  $('#storage-line').textContent = `${plural(sets().length, 'Satz', 'Sätze')} in ${plural(sessions().length, 'Einheit', 'Einheiten')} — ${(bytes / 1024).toFixed(0)} kB.`;
}

// --- Satz eintragen ------------------------------------------------------

/**
 * Öffnet den Dialog zum Eintragen.
 *
 * Ohne Übung öffnet er die Suche, mit Übung gleich das Zahlenfeld. Beides
 * kommt vor: Vom Startbildschirm aus weiß man schon, was man macht; vom
 * Pluszeichen aus noch nicht.
 */
function openLog(exerciseId) {
  state.log = { exerciseId, picking: !exerciseId, search: '' };
  $('#log-search').value = '';

  renderLog();
  if (exerciseId) fillLogInputs();

  $('#dlg-log').showModal();
  if (!exerciseId) $('#log-search').focus();
}

const logExercise = () =>
  state.log.exerciseId ? store.byId('exercises', state.log.exerciseId) : null;

function renderLog() {
  const exercise = logExercise();

  $('#log-picker').hidden = !state.log.picking;
  $('#log-form').hidden = state.log.picking;

  $('#log-exercise-name').textContent = exercise?.name ?? 'Übung wählen';
  $('#log-muscle').textContent = exercise
    ? `${muscleById(exercise.muscle).label} · ${equipmentById(exercise.equipment).label}`
    : 'Antippen zum Wechseln';

  if (state.log.picking) renderLogResults();
  else renderLogInfo();
}

/** Die Trefferliste der Übungssuche. */
function renderLogResults() {
  const alle = exercises();
  const suche = state.log.search.trim();
  const treffer = suche
    ? searchExercises(suche, alle)
    : recentExercises(sets(), alle, 12).map((eintrag) => eintrag.exercise);

  const vorschlaege = treffer.length
    ? treffer
    : [...alle].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  setChildren(
    $('#log-results'),
    ...vorschlaege.slice(0, 20).map((exercise) => {
      const letzte = lastPerformance(sets(), exercise.id);
      return el(
        'button',
        { type: 'button', class: 'row-item', onclick: () => chooseExercise(exercise.id) },
        el('span', { class: 'row-emoji', text: muscleById(exercise.muscle).icon }),
        el(
          'span',
          { class: 'row-main' },
          el('span', { class: 'row-title', text: exercise.name }),
          el('span', {
            class: 'row-sub',
            text: letzte
              ? `${relativeDay(letzte.at)} · ${formatSetGroup(workingSets(letzte.sets), exercise, unit())}`
              : 'Noch nicht trainiert',
          }),
        ),
      );
    }),
    // Anlegen steht immer zur Verfügung, auch wenn es Treffer gibt: Man
    // sucht "Rudern", findet drei Ruderübungen -- und will trotzdem die
    // vierte anlegen. Und im leeren Verzeichnis ist es der einzige Weg
    // überhaupt.
    suche || !alle.length
      ? el(
          'button',
          {
            type: 'button',
            class: 'row-item',
            onclick: () => {
              $('#dlg-log').close();
              openExerciseForm(null, suche);
            },
          },
          el('span', { class: 'row-emoji' }, icon('i-plus', 'icon')),
          el(
            'span',
            { class: 'row-main' },
            el('span', { class: 'row-title', text: suche ? `„${suche}" anlegen` : 'Erste Übung anlegen' }),
            el('span', { class: 'row-sub', text: 'Muskelgruppe und Gerät liest die App aus dem Namen' }),
          ),
        )
      : null,
  );
}

function chooseExercise(id) {
  state.log.exerciseId = id;
  state.log.picking = false;
  renderLog();
  fillLogInputs();
}

/**
 * Schreibt den Vorschlag in die Zahlenfelder.
 *
 * Getrennt vom übrigen Zeichnen, und das ist der Punkt: Alles andere im
 * Dialog wird bei jeder Änderung neu aufgebaut. Die Eingabefelder werden
 * nur angefasst, wenn es einen Grund gibt -- sonst überschriebe der
 * nächste Zeichenvorgang, was gerade getippt wird.
 */
function fillLogInputs() {
  const exercise = logExercise();
  if (!exercise) return;

  const laufend = liveSession();
  const vorschlag = laufend
    ? suggestForToday(exercise, setsOfExercise(sets(), exercise.id), laufend.id)
    : suggestNext(exercise, setsOfExercise(sets(), exercise.id));

  $('#log-weight').value = vorschlag.weight
    ? formatNumber(toDisplay(vorschlag.weight, unit()), 1)
    : '';
  $('#log-reps').value =
    exercise.kind === 'zeit' ? String(vorschlag.seconds ?? '') : String(vorschlag.reps ?? '');
  $('#log-warmup').checked = false;

  renderLogInfo();
}

/** Alles im Dialog außer den Zahlenfeldern. */
function renderLogInfo() {
  const exercise = logExercise();
  if (!exercise) return;

  const alleSaetze = sets();
  const laufend = liveSession();
  const vorschlag = laufend
    ? suggestForToday(exercise, setsOfExercise(alleSaetze, exercise.id), laufend.id)
    : suggestNext(exercise, setsOfExercise(alleSaetze, exercise.id));

  $('#log-suggestion').textContent = vorschlag.reason;

  // Die Beschriftungen richten sich nach der Art der Übung.
  const zeit = exercise.kind === 'zeit';
  $('#stepper-weight').hidden = zeit;
  $('#log-weight-label').textContent =
    exercise.kind === 'koerper' ? `Zusatz (${unit()})` : `Gewicht (${unit()})`;
  $('#log-reps-label').textContent = zeit ? 'Sekunden' : 'Wiederholungen';

  // Was heute schon steht
  const heute = laufend
    ? setsOfSession(alleSaetze, laufend.id).filter((satz) => satz.exerciseId === exercise.id)
    : [];

  $('#log-today-head').textContent = heute.length
    ? `Heute: ${plural(heute.length, 'Satz', 'Sätze')}`
    : '';

  setChildren(
    $('#log-today'),
    ...heute.map((satz, i) =>
      el(
        'div',
        { class: `set-row${satz.warmup ? ' warmup' : ''}` },
        el('span', { class: 'set-number', text: String(i + 1) }),
        el('span', { class: 'set-value', text: formatSet(satz, exercise, unit()) }),
        satz.warmup ? el('span', { class: 'set-note', text: 'Aufwärmen' }) : null,
        el(
          'button',
          {
            type: 'button',
            class: 'icon-button-mini',
            'aria-label': 'Satz löschen',
            onclick: () => removeSet(store, satz.id),
          },
          icon('i-trash'),
        ),
      ),
    ),
  );

  const letzte = lastPerformance(alleSaetze, exercise.id, { exceptSessionId: laufend?.id });
  $('#log-last').textContent = letzte
    ? `Letztes Mal (${relativeDay(letzte.at)}): ${formatSetGroup(workingSets(letzte.sets), exercise, unit())}`
    : 'Noch keine Aufzeichnung zu dieser Übung.';
}

/** Plus und Minus an den Zahlenfeldern. */
function stepField(feld, richtung) {
  const exercise = logExercise();
  const input = feld === 'weight' ? $('#log-weight') : $('#log-reps');
  const schritt =
    feld === 'weight'
      ? unit() === 'lb'
        ? 5
        : incrementFor(exercise)
      : exercise?.kind === 'zeit'
        ? 5
        : 1;

  const jetzt = parseNumber(input.value) ?? 0;
  // Auf ein Vielfaches des Schritts einrasten: Wer 61 kg eingetippt hat und
  // dann auf Plus tippt, meint 62,5 und nicht 63,5.
  const gerastert = Math.round(jetzt / schritt) * schritt;
  const neu = Math.max(0, gerastert + richtung * schritt);

  input.value = neu ? formatNumber(neu, 2) : '';
}

async function onLogSubmit(event) {
  // Ohne das schlösse das Formular den Dialog -- und wer drei Sätze macht,
  // müsste ihn dreimal neu öffnen.
  event.preventDefault();

  const exercise = logExercise();
  if (!exercise) return;

  const zeit = exercise.kind === 'zeit';
  const zweitesFeld = parseNumber($('#log-reps').value) ?? 0;

  if (!(zweitesFeld > 0)) {
    toast(zeit ? 'Wie lange hast du gehalten?' : 'Wie viele Wiederholungen?');
    $('#log-reps').focus();
    return;
  }

  const gewicht = fromDisplay(parseNumber($('#log-weight').value) ?? 0, unit());
  const warmup = $('#log-warmup').checked;

  // Für den Bestwert-Vergleich zählt alles, was *vor* diesem Satz war.
  const vorher = setsOfExercise(sets(), exercise.id);

  const satz = await logSet(store, {
    exerciseId: exercise.id,
    weight: zeit ? 0 : gewicht,
    reps: zeit ? null : zweitesFeld,
    seconds: zeit ? zweitesFeld : null,
    warmup,
  });

  const bestwerte = newRecords(satz, vorher, exercise, bodyweight());
  if (bestwerte.length) {
    buzz([40, 60, 40]);
    toast(`Bestwert! ${formatSet(satz, exercise, unit())}`);
  } else {
    toast(warmup ? 'Aufwärmsatz eingetragen.' : `${formatSet(satz, exercise, unit())} eingetragen.`);
  }

  if (!warmup) startRest(suggestRest(exercise, restLength()));

  // Für den nächsten Satz stehen bleiben lassen, was gerade eingetragen
  // wurde -- der zweite Satz hat fast immer dasselbe Gewicht.
  $('#log-warmup').checked = false;
  renderLogInfo();
}

// --- Die Pausenuhr -------------------------------------------------------

function startRest(seconds) {
  state.rest = { startedAt: new Date().toISOString(), seconds };
  state.restLast = { done: false };
  tickRest();
  if (!restInterval) restInterval = setInterval(tickRest, 500);
}

function stopRest() {
  state.rest = null;
  clearInterval(restInterval);
  restInterval = undefined;
  $('#rest-card').hidden = true;
}

function tickRest() {
  if (!state.rest) return stopRest();

  const stand = restState(state.rest.startedAt, state.rest.seconds);

  if (justFinished(state.restLast, stand)) {
    buzz([120, 80, 120]);
    toast('Pause vorbei.');
  }
  state.restLast = stand;

  // Eine halbe Minute nach dem Ende verschwindet die Uhr von selbst: Wer
  // dann noch nicht weitermacht, macht eine längere Pause und braucht keine
  // Uhr, die auf null steht.
  if (stand.elapsed > state.rest.seconds + 30) return stopRest();

  const karte = $('#rest-card');
  karte.hidden = false;
  karte.classList.toggle('endspurt', stand.remaining <= 10);

  $('#rest-remaining').textContent = stand.done ? 'Los' : formatClock(stand.remaining);
  $('#rest-total').textContent = stand.done
    ? 'Pause vorbei'
    : `von ${formatClock(state.rest.seconds)}`;
  $('#rest-fill').style.width = `${Math.round((1 - stand.progress) * 100)}%`;
}

// --- Übung anlegen und ändern -------------------------------------------

function openExerciseForm(exercise, vorgabe = '') {
  state.editing = exercise?.id ?? null;

  $('#exercise-form-title').textContent = exercise ? 'Übung ändern' : 'Neue Übung';
  $('#exercise-name').value = exercise?.name ?? vorgabe;
  $('#exercise-muscle').value = exercise?.muscle ?? 'brust';
  $('#exercise-equipment').value = exercise?.equipment ?? 'langhantel';
  $('#exercise-kind').value = exercise?.kind ?? 'gewicht';
  $('#exercise-target').value = String(exercise?.repTarget ?? 10);
  $('#exercise-catalog').hidden = Boolean(exercise) || Boolean(vorgabe);

  setDetailsOpen(Boolean(exercise));
  updateGuessLine();
  $('#dlg-exercise').showModal();
}

function setDetailsOpen(offen) {
  $('#exercise-details').hidden = !offen;
  $('#toggle-details').textContent = offen ? 'Vorschlag übernehmen' : 'Stimmt nicht ganz';
  if (offen) updateRangeLabels();
}

/**
 * Der Satz darüber, was die App aus dem Namen gelesen hat.
 *
 * Er steht da, bevor irgendetwas gespeichert ist -- wer widerspricht, tut
 * es sofort und nicht erst, wenn ihm in drei Wochen eine seltsame
 * Auswertung auffällt.
 */
function updateGuessLine() {
  const name = $('#exercise-name').value;
  const offen = !$('#exercise-details').hidden;

  const geraten = guessAttributes(name, offen ? leseDetails() : {});
  if (!offen) {
    $('#exercise-muscle').value = geraten.muscle;
    $('#exercise-equipment').value = geraten.equipment;
    $('#exercise-kind').value = geraten.kind;
    $('#exercise-target').value = String(geraten.repTarget);
  }

  $('#guessed-text').textContent = name.trim()
    ? `${muscleById(geraten.muscle).label} · ${equipmentById(geraten.equipment).label} · ${kindById(geraten.kind).label} · Ziel ${zielBeschriftung(geraten.kind, geraten.repTarget)}`
    : 'Muskelgruppe und Gerät liest die App aus dem Namen.';

  updateRangeLabels();
}

const zielBeschriftung = (kind, wert) => (kind === 'zeit' ? `${wert} s` : `${wert} Wdh.`);

function updateRangeLabels() {
  const kind = $('#exercise-kind').value;
  const wert = Number($('#exercise-target').value);
  $('#target-out').textContent = zielBeschriftung(kind, wert);
  $('#exercise-target-label').firstChild.textContent =
    kind === 'zeit' ? 'Zeitziel: ' : 'Wiederholungsziel: ';
}

const leseDetails = () => ({
  muscle: $('#exercise-muscle').value,
  equipment: $('#exercise-equipment').value,
  kind: $('#exercise-kind').value,
  repTarget: Number($('#exercise-target').value),
});

async function onExerciseSubmit(event) {
  const name = $('#exercise-name').value.trim();
  if (!name) {
    event.preventDefault();
    return;
  }

  const offen = !$('#exercise-details').hidden;
  const angaben = offen ? leseDetails() : {};

  if (state.editing) {
    await updateExercise(store, state.editing, { name, ...angaben });
    toast('Übung geändert.');
  } else {
    const neu = await addExercise(store, { name, ...angaben });
    toast(`„${neu.name}" angelegt.`);
    // Gleich weiter zum Eintragen: Eine Übung legt man nicht zum Spaß an,
    // sondern weil man sie gerade machen will.
    openLog(neu.id);
  }

  state.editing = null;
}

// --- Eine Übung ansehen --------------------------------------------------

function openExerciseDetail(id) {
  state.detailExercise = id;
  renderExerciseDetail();
  $('#dlg-detail').showModal();
}

function renderExerciseDetail() {
  const exercise = store.byId('exercises', state.detailExercise);
  const koerper = $('#detail-body');
  if (!exercise) {
    setChildren(koerper, el('p', { class: 'empty-state', text: 'Diese Übung gibt es nicht mehr.' }));
    return;
  }

  const eigene = setsOfExercise(sets(), exercise.id);
  const best = records(eigene, exercise, bodyweight());
  const vorschlag = suggestNext(exercise, eigene);
  const namen = new Map(sessions().map((s) => [s.id, s]));

  // Die letzten Trainingstage, jüngster zuerst.
  const nachEinheit = new Map();
  for (const satz of eigene) {
    if (!nachEinheit.has(satz.sessionId)) nachEinheit.set(satz.sessionId, []);
    nachEinheit.get(satz.sessionId).push(satz);
  }
  const tage = [...nachEinheit.entries()].reverse().slice(0, 6);

  setChildren(
    koerper,
    el(
      'div',
      { class: 'detail-head' },
      el(
        'div',
        {},
        el('p', { class: 'eyebrow' }, el('span', { class: 'dot' }), el('span', { text: `${muscleById(exercise.muscle).label} · ${equipmentById(exercise.equipment).label}` })),
        el('p', { class: 'detail-title', text: exercise.name }),
      ),
      el('button', { type: 'button', class: 'icon-button', 'aria-label': 'Schließen', 'data-close': true }, icon('i-cross')),
    ),

    best
      ? el(
          'div',
          { class: 'stat-row' },
          // Ein "Schwerster: 0 kg" bei Klimmzügen ohne Zusatzgewicht wäre
          // kein Bestwert, sondern eine leere Zeile.
          best.heaviest && effectiveWeight(best.heaviest, exercise, bodyweight()) > 0
            ? stat(formatWeight(effectiveWeight(best.heaviest, exercise, bodyweight()), unit()), 'Schwerster')
            : null,
          best.mostReps ? stat(`${best.mostReps.reps}`, 'Meiste Wdh.') : null,
          best.best1RM ? stat(formatWeight(best.best1RM.value, unit()), 'Kraft (1RM)') : null,
          best.longest ? stat(`${best.longest.seconds} s`, 'Längster') : null,
        )
      : el('p', { class: 'muted', text: 'Noch kein Satz eingetragen.' }),

    el('p', { class: 'muted suggestion-line', text: vorschlag.reason }),

    el(
      'div',
      { class: 'row-buttons' },
      el(
        'button',
        {
          type: 'button',
          class: 'button button-primary',
          onclick: () => {
            $('#dlg-detail').close();
            openLog(exercise.id);
          },
        },
        'Satz eintragen',
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'button',
          onclick: () => {
            $('#dlg-detail').close();
            openExerciseForm(exercise);
          },
        },
        'Ändern',
      ),
    ),

    tage.length
      ? el(
          'div',
          { class: 'stack-tight' },
          el('h3', { text: 'Die letzten Male' }),
          ...tage.map(([sessionId, saetze]) => {
            const session = namen.get(sessionId);
            return el(
              'div',
              { class: 'set-row' },
              el('span', { class: 'set-number', text: '·' }),
              el('span', {
                class: 'set-value',
                text: formatSetGroup(workingSets(saetze), exercise, unit()) || 'nur Aufwärmen',
              }),
              el('span', { class: 'set-note', text: session ? relativeDay(session.startedAt) : '' }),
            );
          }),
        )
      : null,

    el(
      'div',
      { class: 'row-buttons' },
      el(
        'button',
        {
          type: 'button',
          class: 'button button-danger',
          onclick: async () => {
            if (!confirm(`„${exercise.name}" aus dem Verzeichnis nehmen? Die eingetragenen Sätze bleiben im Verlauf stehen.`)) return;
            await removeExercise(store, exercise.id);
            $('#dlg-detail').close();
            toast('Übung entfernt.');
          },
        },
        'Übung entfernen',
      ),
    ),
  );
}

// --- Eine Einheit ansehen ------------------------------------------------

function openSessionDetail(id) {
  state.detailSession = id;
  renderSessionDetail();
  $('#dlg-session').showModal();
}

function renderSessionDetail() {
  const session = store.byId('sessions', state.detailSession);
  const koerper = $('#session-body');
  if (!session) {
    setChildren(koerper, el('p', { class: 'empty-state', text: 'Diese Einheit gibt es nicht mehr.' }));
    return;
  }

  const namen = exerciseMap();
  const eigene = setsOfSession(sets(), session.id);
  const summary = sessionSummary(session, sets(), namen, bodyweight());

  // Nach Übung gruppieren, in der Reihenfolge, in der sie drankamen.
  const gruppen = new Map();
  for (const satz of eigene) {
    if (!gruppen.has(satz.exerciseId)) gruppen.set(satz.exerciseId, []);
    gruppen.get(satz.exerciseId).push(satz);
  }

  setChildren(
    koerper,
    el(
      'div',
      { class: 'detail-head' },
      el(
        'div',
        {},
        el('p', { class: 'eyebrow' }, el('span', { class: 'dot' }), el('span', { text: formatWeekday(session.startedAt) })),
        el('p', { class: 'detail-title', text: formatDateLong(session.startedAt) }),
        el('p', { class: 'muted fineprint', text: `${formatTime(session.startedAt)}${session.endedAt ? ` bis ${formatTime(session.endedAt)}` : ' — läuft noch'}` }),
      ),
      el('button', { type: 'button', class: 'icon-button', 'aria-label': 'Schließen', 'data-close': true }, icon('i-cross')),
    ),

    el(
      'div',
      { class: 'stat-row' },
      stat(formatDuration(summary.minutes), 'Dauer'),
      stat(String(summary.setCount), 'Sätze'),
      stat(formatVolume(summary.volume, unit()), 'Volumen'),
    ),

    ...[...gruppen.entries()].map(([exerciseId, saetze]) => {
      const exercise = namen.get(exerciseId);
      return el(
        'div',
        { class: 'stack-tight' },
        el('h3', { text: exercise?.name ?? 'Entfernte Übung' }),
        ...saetze.map((satz, i) =>
          el(
            'div',
            { class: `set-row${satz.warmup ? ' warmup' : ''}` },
            el('span', { class: 'set-number', text: String(i + 1) }),
            el('span', { class: 'set-value', text: formatSet(satz, exercise, unit()) }),
            satz.warmup ? el('span', { class: 'set-note', text: 'Aufwärmen' }) : null,
            el(
              'button',
              {
                type: 'button',
                class: 'icon-button-mini',
                'aria-label': 'Satz löschen',
                onclick: () => removeSet(store, satz.id),
              },
              icon('i-trash'),
            ),
          ),
        ),
      );
    }),

    !session.endedAt
      ? el(
          'div',
          { class: 'row-buttons' },
          el(
            'button',
            {
              type: 'button',
              class: 'button',
              onclick: async () => {
                await endSession(store, session.id);
                toast('Einheit beendet.');
              },
            },
            'Einheit beenden',
          ),
        )
      : null,

    el(
      'div',
      { class: 'row-buttons' },
      el(
        'button',
        {
          type: 'button',
          class: 'button button-danger',
          onclick: async () => {
            if (!confirm('Diese Einheit mit allen Sätzen löschen?')) return;
            for (const satz of eigene) await removeSet(store, satz.id);
            await store.remove('sessions', session.id);
            $('#dlg-session').close();
            toast('Einheit gelöscht.');
          },
        },
        'Einheit löschen',
      ),
    ),
  );
}

async function onEndSession() {
  const laufend = liveSession();
  if (!laufend) return;

  const summary = sessionSummary(laufend, sets(), exerciseMap(), bodyweight());
  await endSession(store, laufend.id);
  stopRest();
  toast(`Fertig: ${plural(summary.setCount, 'Satz', 'Sätze')}, ${formatVolume(summary.volume, unit())}.`);
}

// --- Sicherung -----------------------------------------------------------

function onExport() {
  const blob = new Blob([store.export()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const heute = new Date().toISOString().slice(0, 10);

  const link = el('a', { href: url, download: `training-${heute}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function onImport(event) {
  const datei = event.target.files?.[0];
  event.target.value = '';
  if (!datei) return;

  try {
    const daten = JSON.parse(await datei.text());
    await store.merge(daten);
    toast('Sicherung eingelesen.');
  } catch (err) {
    console.error(err);
    toast('Diese Datei ließ sich nicht lesen.');
  }
}

async function onReset() {
  if (!confirm('Wirklich alle Übungen, Einheiten und Sätze löschen? Das lässt sich nicht rückgängig machen.')) {
    return;
  }
  await store.replaceAll({});
  stopRest();
  toast('Alles gelöscht.');
}

// --- Offlinebetrieb ------------------------------------------------------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Ob diese Seite schon von einem Worker bedient wird. Beim allerersten
  // Besuch übernimmt einer erstmalig, und das ist kein Update -- ohne diese
  // Unterscheidung lüde die App bei jedem Erstbesuch grundlos neu.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    // Mitten im Training nicht dazwischenfunken. Der neue Stand liegt dann
    // bereits im Cache und ist beim nächsten Start von selbst da.
    if (document.querySelector('dialog[open]')) return;
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker
    .register('sw.js')
    .then((registration) => registration.update().catch(() => {}))
    .catch(() => {
      /* Offline-Betrieb ist ein Extra, kein Muss. */
    });
}

main();

// Für die Tests: der Wert, den `sw.js` spiegeln muss.
export { APP_VERSION };
