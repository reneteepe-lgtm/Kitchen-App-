/**
 * Die Oberfläche.
 *
 * Ein einziger Zustand, ein einziger Zeichenweg: Jede Änderung geht in den
 * `Store`, der Store meldet sich, und daraufhin wird die sichtbare Ansicht
 * neu aufgebaut. Es gibt keinen zweiten Weg, an dem sich die Anzeige und
 * die Daten auseinanderentwickeln könnten.
 *
 * Der Aufbau folgt der Reihenfolge, in der man die App benutzt:
 * Start (was ziehe ich heute an?), Schrank (was habe ich?), Erfassen,
 * Outfits (was habe ich mir gemerkt?), Trainingszentrum (was weiß die App?).
 */

import { Store, LocalStorageAdapter, requestPersistence } from './storage.js';
import {
  openPhotoStore,
  PhotoUrls,
  shrinkImage,
  photoKeyOf,
  photoKeysOf,
  CUTOUT_SUFFIX,
} from './photos.js';
import { colorsFromPhoto } from './colorvision.js';
import { cutoutPhoto } from './cutout.js';
import { defaultLayout, mergeLayout, placedItems, clampPosition, hasLayout } from './layout.js';
import {
  addItem,
  updateItem,
  wearItems,
  wearOutfit,
  saveOutfit,
  rateOutfit,
  itemsOf,
  isComplete,
  forgottenItems,
  daysSince,
  createItem,
  VERDICT,
  DEFAULT_SETTINGS,
} from './model.js';
import {
  SLOTS,
  COLORS,
  slotById,
  colorById,
  guessAttributes,
  formalityLabel,
  FORMALITY_LEVELS,
} from './slots.js';
import { featuresOf, learn, trainingProgress, describePreferences } from './preferences.js';
import { suggestOutfits, OCCASIONS, occasionById, missingSlots } from './outfit.js';
import {
  searchPlaces,
  fetchWeather,
  locateDevice,
  describeWeather,
  describeAge,
  isFresh,
  placeLabel,
} from './weather.js';
import { searchItems } from './text.js';

/**
 * Bei jeder Veröffentlichung erhöhen -- und dieselbe Nummer in `sw.js`
 * mitziehen. Ein Test wacht darüber, dass beide übereinstimmen.
 */
const APP_VERSION = '1.2.0';

/**
 * In welcher Reihenfolge die Teile eines Outfits im Raster liegen.
 *
 * Nicht dieselbe wie im Schrank: Hier zählt, was ein gutes Bild ergibt.
 * Die Jacke zuerst und die Hose in der Mitte füllen das Raster ohne Lücke,
 * weil die Hose zwei Zeilen hoch ist und die kurzen Kacheln sich um sie
 * herum legen.
 */
const TILE_ORDER = ['outer', 'top', 'headwear', 'bottom', 'dress', 'accessory', 'shoes'];

const TALL_SLOTS = new Set(['bottom', 'dress']);

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

/** Wie `replaceChildren`, aber ohne die Falle oben. */
const setChildren = (node, ...children) => node.replaceChildren(...vorhandene(children));

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

const plural = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;

// --- Zustand -------------------------------------------------------------

const state = {
  view: 'home',
  /** Die Saat der Vorschläge. Erst „Mehr erstellen" ändert sie. */
  seed: 1,
  trainingSeed: 1000,
  filter: null,
  query: '',
  editing: null,
  pendingPhoto: null,
  formColors: [],
  /** Was auf dem Foto zu sehen war -- getrennt, weil der Name Vorrang hat. */
  photoColors: [],
  compose: {},
  placeResults: [],
  /** Was gerade auf der Anordnungsfläche liegt. */
  layout: { items: [], positions: {}, outfitId: null },
};

let store;
let photos;
let photoUrls;

/** Wird bei jedem Zeichnen frisch aus den Bewertungen gerechnet. */
let model = { weights: new Map(), count: 0 };

const items = () => store.all('items');
const outfits = () => store.all('outfits');
const ratings = () => store.all('ratings');
const occasion = () => store.getSetting('occasion', 'alltag');
const weatherNow = () => store.getSetting('weather', null);

// --- Start ---------------------------------------------------------------

async function main() {
  store = await new Store(new LocalStorageAdapter()).init();
  photos = await openPhotoStore();
  photoUrls = new PhotoUrls(photos);

  $('#app-version').textContent = APP_VERSION;

  buildStaticParts();
  wireEvents();

  store.subscribe(() => render());
  render();

  // Nach dem ersten Zeichnen, damit nichts davon den Start aufhält.
  requestPersistence();
  refreshWeather({ quiet: true });
  registerServiceWorker();
}

/** Alles, was sich nie ändert und deshalb nur einmal gebaut wird. */
function buildStaticParts() {
  const slotSelect = $('#item-slot');
  for (const slot of SLOTS) {
    slotSelect.append(el('option', { value: slot.id, text: slot.label }));
  }

  $('#item-colors').append(
    ...COLORS.map((color) =>
      el('button', {
        type: 'button',
        class: 'swatch',
        style: `background:${color.hex}`,
        'aria-label': color.label,
        'aria-pressed': 'false',
        dataset: { color: color.id },
        onclick: () => toggleFormColor(color.id),
      }),
    ),
  );

  $('#occasion-choice').append(
    ...OCCASIONS.map((anlass) =>
      el('button', {
        type: 'button',
        class: 'chip',
        text: anlass.label,
        dataset: { occasion: anlass.id },
        onclick: () => store.setSetting('occasion', anlass.id),
      }),
    ),
  );

}

/**
 * Die Filterleiste über dem Schrank.
 *
 * Sie wird bei jedem Zeichnen neu gebaut, weil nur die Fächer darin stehen
 * sollen, in denen wirklich etwas hängt. Ein Knopf "Kleider & Einteiler"
 * über einem Schrank ohne Kleider führt zu genau einem Ergebnis: einer
 * leeren Seite, die man selbst herbeigetippt hat.
 */
function renderSlotFilter(alle) {
  const belegt = new Set(alle.map((teil) => teil.slot));

  $('#slot-filter').replaceChildren(
    el('button', {
      type: 'button',
      class: 'chip',
      text: 'Alles',
      'aria-pressed': String(state.filter === null),
      onclick: () => setFilter(null),
    }),
    ...SLOTS.filter((slot) => belegt.has(slot.id)).map((slot) =>
      el('button', {
        type: 'button',
        class: 'chip',
        text: `${slot.icon} ${slot.label}`,
        'aria-pressed': String(state.filter === slot.id),
        onclick: () => setFilter(slot.id),
      }),
    ),
  );
}

function wireEvents() {
  for (const tab of $$('.tab[data-view]')) {
    tab.addEventListener('click', () => show(tab.dataset.view));
  }

  $('#btn-add').addEventListener('click', () => openItemForm(null));
  $('#btn-settings').addEventListener('click', () => show('more'));
  $('#open-training').addEventListener('click', () => show('training'));
  $('#train-now').addEventListener('click', () => show('training'));
  $('#intro-action').addEventListener('click', () => show('training'));
  $('#btn-all-outfits').addEventListener('click', () => show('outfits'));
  $('#btn-compose').addEventListener('click', openCompose);
  $('#weather-line').addEventListener('click', () => show('more'));

  $('#btn-more').addEventListener('click', () => {
    state.seed += 1;
    renderHome();
  });

  $('#wardrobe-search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderWardrobe();
  });

  // Formular für ein Teil
  $('#item-name').addEventListener('input', updateGuessLine);
  $('#item-photo').addEventListener('change', onPhotoChosen);
  $('#toggle-details').addEventListener('click', () => setDetailsOpen($('#item-details').hidden));
  $('#item-warmth').addEventListener('input', updateRangeLabels);
  $('#item-formality').addEventListener('input', updateRangeLabels);
  $('#item-cutout').addEventListener('change', zeigeVorschau);
  $('#form-item').addEventListener('submit', onItemSubmit);
  $('#form-compose').addEventListener('submit', onComposeSubmit);
  $('#form-layout').addEventListener('submit', onLayoutSubmit);
  $('#layout-auto').addEventListener('click', () => {
    state.layout.positions = defaultLayout(state.layout.items);
    renderLayoutStage();
    toast('Neu angeordnet.');
  });

  // Einstellungen
  $('#place-form').addEventListener('submit', onPlaceSearch);
  $('#btn-locate').addEventListener('click', onLocate);
  $('#btn-refresh-weather').addEventListener('click', () => refreshWeather({ force: true }));
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

function setFilter(slot) {
  state.filter = slot;
  renderWardrobe();
}

function render() {
  model = learn(ratings());

  renderHome();
  if (state.view === 'wardrobe') renderWardrobe();
  if (state.view === 'outfits') renderOutfits();
  if (state.view === 'training') renderTraining();
  if (state.view === 'more') renderMore();
}

// --- Startseite ----------------------------------------------------------

function renderHome() {
  const alle = items();
  const fortschritt = trainingProgress(ratings(), alle);

  // Der Ring
  const radius = 52;
  const umfang = 2 * Math.PI * radius;
  const bogen = $('#ring-value');
  bogen.style.strokeDasharray = String(umfang);
  bogen.style.strokeDashoffset = String(umfang * (1 - fortschritt.percent / 100));

  $('#ring-percent').textContent = `${fortschritt.percent} %`;
  $('#training-state').textContent = fortschritt.label;
  $('#training-headline').textContent = `Deine App ist zu ${fortschritt.percent} % trainiert`;
  $('#training-sub').textContent =
    fortschritt.count === 0
      ? 'Trainiere deine Stilvorlieben'
      : `${plural(fortschritt.count, 'Urteil', 'Urteile')} · ${Math.round(fortschritt.coverage * 100)} % des Schranks`;
  $('#training-hint').textContent = fortschritt.hint;

  $('#intro-text').textContent =
    alle.length === 0
      ? 'Fotografiere ein paar Kleidungsstücke — schon aus einer Handvoll baut die App vollständige Outfits.'
      : 'Deine App lernt aus jedem Urteil, das du fällst. Komm täglich zurück, um deinen Trainingsfortschritt zu sehen.';

  // Wetterzeile
  const wetter = weatherNow();
  const alter = describeAge(wetter);
  $('#weather-line').textContent = [describeWeather(wetter), alter].filter(Boolean).join(' · ');

  renderSuggestions(alle);
  renderSavedStrip();
}

function renderSuggestions(alle) {
  const behaelter = $('#suggestions');
  const leer = $('#suggestions-empty');
  behaelter.replaceChildren();

  const fehlt = missingSlots(alle);
  if (fehlt.length) {
    behaelter.hidden = true;
    leer.hidden = false;
    leer.replaceChildren(
      document.createTextNode(
        alle.length === 0
          ? 'Noch nichts im Schrank. '
          : `Für ein vollständiges Outfit fehlt noch: ${fehlt.map((slot) => slotById(slot).label).join(', ')}. `,
      ),
      el('br'),
      el('button', {
        type: 'button',
        class: 'link-button',
        text: 'Teil erfassen',
        onclick: () => openItemForm(null),
      }),
    );
    return;
  }

  behaelter.hidden = false;
  leer.hidden = true;

  const vorschlaege = suggestOutfits(alle, {
    weather: weatherNow(),
    occasion: occasion(),
    model,
    count: DEFAULT_SETTINGS.suggestionCount,
    seed: state.seed,
  });

  behaelter.append(
    ...vorschlaege.map((vorschlag) =>
      outfitCard(vorschlag.items, {
        label: labelFor(vorschlag),
        reason: vorschlag.reason,
        onclick: () => openSuggestion(vorschlag),
      }),
    ),
  );
}

function renderSavedStrip() {
  const behaelter = $('#saved-strip');
  const alle = items();
  const gespeichert = outfits().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  behaelter.replaceChildren();
  $('#saved-empty').hidden = gespeichert.length > 0;
  behaelter.hidden = gespeichert.length === 0;

  behaelter.append(
    ...gespeichert.slice(0, 8).map((outfit) =>
      outfitCard(itemsOf(outfit, alle), {
        label: outfit.label || 'Outfit',
        reason: outfit.wornCount ? `${plural(outfit.wornCount, 'Mal', 'Mal')} getragen` : '',
        onclick: () => openSavedOutfit(outfit),
      }),
    ),
  );
}

/**
 * Die Überschrift eines Vorschlags.
 *
 * Zusammengesetzt aus Anlass und Wetter, weil genau das die Frage ist, die
 * er beantwortet -- "Alltag bei Regen" sagt mehr als jeder ausgedachte
 * Name.
 */
function labelFor(vorschlag) {
  const anlass = occasionById(occasion());
  const wetter = weatherNow();

  if (!wetter) return anlass.label;
  if ((wetter.rainChance ?? 0) >= 50) return `${anlass.label} bei Regen`;
  if (wetter.tempMax !== null && wetter.tempMax !== undefined) {
    const grad = Math.round(wetter.tempMax);
    if (grad <= 0) return `${anlass.label} im Frost`;
    if (grad <= 8) return `${anlass.label} im Kalten`;
    if (grad >= 25) return `${anlass.label} in der Hitze`;
  }
  return anlass.label;
}

/** Eine Outfit-Karte: das Raster der Teile, darunter Name und Begründung. */
function outfitCard(teile, { label, reason = '', onclick, wide = false } = {}) {
  const karte = el('button', {
    type: 'button',
    class: `outfit-card${wide ? ' wide' : ''}`,
    onclick,
  });

  karte.append(tileGrid(teile));
  karte.append(
    el(
      'div',
      { class: 'outfit-foot' },
      el('span', { class: 'tag', text: label }),
      reason ? el('span', { class: 'reason', text: reason }) : null,
    ),
  );
  return karte;
}

function tileGrid(teile) {
  const raster = el('div', { class: 'tile-grid' });
  const sortiert = [...teile].sort(
    (a, b) => TILE_ORDER.indexOf(a.slot) - TILE_ORDER.indexOf(b.slot),
  );

  /*
   * Ob die Hose zwei Zeilen hoch sein darf.
   *
   * Sie soll es sein -- eine Hose in einer quadratischen Kachel ist ein
   * Streifen Stoff in der Mitte. Aber sie belegt damit eine Zelle mehr,
   * und sobald das eine zusätzliche Zeile kostet, steht die halbe Karte
   * leer.
   *
   * Bei drei Spalten geht die hohe Kachel genau dann umsonst durch, wenn
   * die Zahl der Teile nicht glatt durch drei teilbar ist: Dann ist in der
   * letzten Zeile ohnehin Platz übrig, den sie sich nimmt. Bei drei oder
   * sechs Teilen füllen die quadratischen Kacheln die Zeilen exakt -- da
   * bleibt sie flach.
   */
  const hoch = sortiert.length % 3 !== 0;

  for (const teil of sortiert) {
    const kachel = el('div', {
      class: `tile${hoch && TALL_SLOTS.has(teil.slot) ? ' tile-tall' : ''}`,
    });
    fillTile(kachel, teil);
    raster.append(kachel);
  }
  return raster;
}

/**
 * Füllt eine Kachel -- mit dem Foto, sobald es da ist.
 *
 * Das Bild kommt aus IndexedDB und damit nicht sofort. Bis dahin steht die
 * Ersatzdarstellung; ohne sie klappten die Karten beim Nachladen sichtbar
 * zusammen.
 */
function fillTile(kachel, teil, { withName = true } = {}) {
  kachel.append(blankTile(teil, { withName }));

  const schluessel = photoKeyOf(teil);
  if (!schluessel) return;

  photoUrls.urlFor(schluessel).then((url) => {
    if (!url) return;
    kachel.replaceChildren(el('img', { src: url, alt: teil.name, loading: 'lazy' }));
  });
}

/**
 * Die Ersatzdarstellung für Teile ohne Foto.
 *
 * Der Name steht nur dort mit drin, wo er sonst nirgends steht -- im
 * Outfit-Raster. Im Schrank steht er ohnehin unter der Kachel, und zweimal
 * dasselbe Wort übereinander liest niemand als zwei Angaben, sondern als
 * Fehler.
 */
function blankTile(teil, { withName = true } = {}) {
  const farbe = colorById(teil.colors?.[0]);
  return el(
    'span',
    {
      class: 'tile-blank',
      style: farbe ? `background: color-mix(in srgb, ${farbe.hex} 22%, transparent)` : undefined,
    },
    el('span', { class: 'tile-emoji', text: slotById(teil.slot)?.icon ?? '👕' }),
    withName ? el('span', { class: 'tile-name', text: teil.name }) : null,
  );
}

// --- Schrank -------------------------------------------------------------

function renderWardrobe() {
  const alle = items();
  const raster = $('#wardrobe-grid');
  raster.replaceChildren();

  $('#wardrobe-count').textContent = alle.length
    ? plural(alle.length, 'Teil', 'Teile')
    : '';

  renderSlotFilter(alle);
  $('#wardrobe-empty').hidden = alle.length > 0;

  let gezeigt = alle;
  if (state.query.trim()) gezeigt = searchItems(state.query, gezeigt);
  if (state.filter) gezeigt = gezeigt.filter((teil) => teil.slot === state.filter);

  if (!gezeigt.length && alle.length) {
    raster.append(el('p', { class: 'empty-state', text: 'Nichts gefunden.' }));
    return;
  }

  // Ohne Filter nach Fächern gruppiert -- so, wie ein Schrank aufgeräumt ist.
  if (!state.filter && !state.query.trim()) {
    for (const slot of SLOTS) {
      const imFach = gezeigt.filter((teil) => teil.slot === slot.id);
      if (!imFach.length) continue;
      raster.append(
        el(
          'div',
          { class: 'slot-head' },
          el('h2', { text: `${slot.icon} ${slot.label}` }),
          el('span', { text: String(imFach.length) }),
        ),
        ...imFach.map(itemCard),
      );
    }
    return;
  }

  raster.append(...gezeigt.map(itemCard));
}

function itemCard(teil) {
  const bild = el('div', { class: 'item-thumb' });
  fillTile(bild, teil, { withName: false });

  const tage = daysSince(teil.lastWornAt);
  const unterzeile =
    tage === null
      ? 'noch nie getragen'
      : tage === 0
        ? 'heute getragen'
        : tage === 1
          ? 'gestern getragen'
          : `vor ${tage} Tagen`;

  return el(
    'button',
    { type: 'button', class: 'item-card', onclick: () => openItemDetail(teil) },
    bild,
    el('span', { class: 'item-name', text: teil.name }),
    el('span', { class: 'item-sub', text: unterzeile }),
  );
}

// --- Outfits -------------------------------------------------------------

function renderOutfits() {
  const liste = $('#outfit-list');
  const alle = items();
  const gespeichert = outfits().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  liste.replaceChildren();
  $('#outfits-empty').hidden = gespeichert.length > 0;

  liste.append(
    ...gespeichert.map((outfit) => {
      const teile = itemsOf(outfit, alle);
      const vollstaendig = isComplete(outfit, alle);
      return outfitCard(teile, {
        wide: true,
        label: outfit.label || 'Outfit',
        reason: vollstaendig
          ? outfit.wornCount
            ? `${plural(outfit.wornCount, 'Mal', 'Mal')} getragen`
            : 'noch nie getragen'
          : 'ein Teil fehlt inzwischen',
        onclick: () => openSavedOutfit(outfit),
      });
    }),
  );
}

// --- Trainingszentrum ----------------------------------------------------

function renderTraining() {
  const alle = items();
  const fortschritt = trainingProgress(ratings(), alle);

  $('#progress-fill').style.width = `${fortschritt.percent}%`;
  $('#progress-percent').textContent = `${fortschritt.percent} %`;
  $('#progress-detail').textContent = fortschritt.hint;

  const buehne = $('#training-stage');
  buehne.replaceChildren();

  if (missingSlots(alle).length) {
    buehne.append(
      el('p', {
        class: 'empty-state',
        text: 'Zum Trainieren braucht die App genug Teile für ein vollständiges Outfit.',
      }),
    );
  } else {
    const [vorschlag] = suggestOutfits(alle, {
      weather: weatherNow(),
      occasion: occasion(),
      model,
      count: 1,
      seed: state.trainingSeed,
    });

    if (vorschlag) {
      buehne.append(
        el(
          'div',
          { class: 'stack' },
          outfitCard(vorschlag.items, {
            wide: true,
            label: labelFor(vorschlag),
            reason: vorschlag.reason,
            onclick: () => openSuggestion(vorschlag),
          }),
          el(
            'div',
            { class: 'verdict-row' },
            el(
              'button',
              {
                type: 'button',
                class: 'verdict',
                onclick: () => judge(vorschlag, VERDICT.DISLIKE),
              },
              icon('i-cross', 'icon icon-sm'),
              el('span', { text: 'Nicht mein Stil' }),
            ),
            el(
              'button',
              {
                type: 'button',
                class: 'verdict verdict-yes',
                onclick: () => judge(vorschlag, VERDICT.LIKE),
              },
              icon('i-check', 'icon icon-sm'),
              el('span', { text: 'Gefällt mir' }),
            ),
          ),
        ),
      );
    }
  }

  renderTaste(alle);
}

function renderTaste(alle) {
  const geschmack = describePreferences(model, alle);
  const hatEtwas = geschmack.liked.length > 0 || geschmack.disliked.length > 0;

  $('#taste-section').hidden = !hatEtwas;
  if (!hatEtwas) return;

  const zuChips = (zeilen) =>
    zeilen.map((zeile) =>
      el('span', {
        class: 'chip chip-static chip-good',
        text: `${zeile.label} · ${zeile.likes}/${zeile.likes + zeile.dislikes}`,
      }),
    );

  $('#taste-liked').replaceChildren(...zuChips(geschmack.liked));
  $('#taste-disliked').replaceChildren(
    ...geschmack.disliked.map((zeile) =>
      el('span', {
        class: 'chip chip-static',
        text: `${zeile.label} · ${zeile.dislikes}/${zeile.likes + zeile.dislikes}`,
      }),
    ),
  );
  $('#taste-disliked-block').hidden = geschmack.disliked.length === 0;
}

async function judge(vorschlag, verdict) {
  await rateOutfit(store, {
    itemIds: vorschlag.itemIds,
    verdict,
    features: featuresOf(vorschlag.items),
    context: { occasion: occasion(), temp: weatherNow()?.tempMax ?? null },
  });

  // Weiter zum nächsten -- sonst stünde nach dem Urteil dasselbe Outfit da.
  state.trainingSeed += 1;
  toast(verdict === VERDICT.LIKE ? 'Gemerkt: gefällt dir' : 'Gemerkt: eher nicht');
}

// --- Einstellungen -------------------------------------------------------

function renderMore() {
  const ort = store.getSetting('place', null);
  $('#place-current').textContent = ort
    ? `Wetter für ${placeLabel(ort)}.`
    : 'Noch kein Ort gewählt — ohne ihn schlägt die App ohne Wetter vor.';

  for (const chip of $$('#occasion-choice .chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.occasion === occasion()));
  }

  const bytes = store.usedBytes();
  $('#storage-line').textContent = `${(bytes / 1024).toFixed(1)} kB Daten, ${plural(items().length, 'Teil', 'Teile')}, ${plural(outfits().length, 'Outfit', 'Outfits')}.`;

  const vergessen = forgottenItems(items());
  $('#forgotten-line').textContent = vergessen.length
    ? `${plural(vergessen.length, 'Teil hängt', 'Teile hängen')} seit Monaten unangetastet im Schrank.`
    : 'Nichts, was seit Monaten unangetastet hängt.';

  $('#forgotten-list').replaceChildren(
    ...vergessen.slice(0, 10).map((teil) =>
      el(
        'button',
        { type: 'button', class: 'result-row', onclick: () => openItemDetail(teil) },
        el('span', { text: teil.name }),
        el('small', {
          text: teil.lastWornAt ? `zuletzt vor ${daysSince(teil.lastWornAt)} Tagen` : 'nie getragen',
        }),
      ),
    ),
  );
}

async function onPlaceSearch(event) {
  event.preventDefault();
  const eingabe = $('#place-input').value;
  const ergebnisse = $('#place-results');
  ergebnisse.replaceChildren(el('p', { class: 'muted fineprint', text: 'Suche …' }));

  try {
    const treffer = await searchPlaces(eingabe);
    if (!treffer.length) {
      ergebnisse.replaceChildren(el('p', { class: 'muted fineprint', text: 'Kein Ort gefunden.' }));
      return;
    }
    ergebnisse.replaceChildren(
      ...treffer.map((ort) =>
        el(
          'button',
          { type: 'button', class: 'result-row', onclick: () => choosePlace(ort) },
          el('span', { text: ort.name }),
          el('small', { text: [ort.region, ort.country].filter(Boolean).join(', ') }),
        ),
      ),
    );
  } catch (err) {
    console.error(err);
    ergebnisse.replaceChildren(
      el('p', { class: 'muted fineprint', text: 'Die Ortssuche ist gerade nicht erreichbar.' }),
    );
  }
}

async function choosePlace(ort) {
  await store.setSetting('place', ort);
  $('#place-results').replaceChildren();
  $('#place-input').value = '';
  await refreshWeather({ force: true });
}

async function onLocate() {
  try {
    const ort = await locateDevice();
    await choosePlace(ort);
  } catch {
    toast('Standort nicht verfügbar. Ort bitte von Hand suchen.');
  }
}

/**
 * Holt das Wetter -- höchstens so oft, wie es sich ändern kann.
 *
 * `quiet` beim Start: Ein Fehler soll dort nichts melden. Wer ohne Empfang
 * in den Schrank schaut, bekommt den letzten Stand und keine Fehlermeldung.
 */
async function refreshWeather({ force = false, quiet = false } = {}) {
  const ort = store.getSetting('place', null);
  if (!ort) return;
  if (!force && isFresh(weatherNow())) return;

  try {
    const wetter = await fetchWeather(ort);
    await store.setSetting('weather', wetter);
    if (force) toast(`Wetter für ${placeLabel(ort)} aktualisiert`);
  } catch (err) {
    console.warn('Wetter nicht erreichbar:', err);
    if (!quiet) toast('Wetter nicht erreichbar — der letzte Stand bleibt stehen.');
  }
}

function onExport() {
  const blob = new Blob([store.export()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const heute = new Date().toISOString().slice(0, 10);

  const link = el('a', { href: url, download: `kleiderschrank-${heute}.json` });
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
  if (!confirm('Wirklich alle Teile, Outfits und Urteile löschen? Das lässt sich nicht rückgängig machen.')) {
    return;
  }
  for (const teil of items()) {
    for (const schluessel of photoKeysOf(teil)) await photos.remove(schluessel);
  }
  photoUrls.clear();
  await store.replaceAll({});
  toast('Alles gelöscht.');
}

// --- Ein Teil erfassen ---------------------------------------------------

function openItemForm(teil) {
  state.editing = teil?.id ?? null;
  state.pendingPhoto = null;
  state.formColors = teil ? [...(teil.colors ?? [])] : [];
  state.photoColors = [];

  $('#item-form-title').textContent = teil ? 'Teil ändern' : 'Neues Teil';
  $('#item-name').value = teil?.name ?? '';
  $('#item-brand').value = teil?.brand ?? '';
  $('#item-slot').value = teil?.slot ?? 'top';
  $('#item-warmth').value = String(teil?.warmth ?? 2);
  $('#item-formality').value = String(teil?.formality ?? 2);
  $('#item-waterproof').checked = Boolean(teil?.waterproof);
  $('#item-photo').value = '';

  // Der Freistell-Schalter gilt für das Foto, das gerade gewählt wird.
  // Beim Öffnen zeigt er, wie das Teil bisher gespeichert ist -- zu sehen
  // ist er aber erst, wenn es auch etwas zu schalten gibt.
  $('#item-cutout').checked = Boolean(teil?.cutout);
  $('#cutout-row').hidden = !teil?.hasCutout;

  const vorschau = $('#photo-preview');
  vorschau.replaceChildren(icon('i-camera'), el('span', { text: 'Foto' }));
  if (teil?.photoId) {
    photoUrls.urlFor(teil.photoId).then((url) => {
      if (url && state.editing === teil.id) {
        vorschau.replaceChildren(el('img', { src: url, alt: '' }));
      }
    });
  }

  setDetailsOpen(Boolean(teil));
  updateRangeLabels();
  updateSwatches();
  updateGuessLine();

  $('#dlg-item').showModal();
  if (!teil) setTimeout(() => $('#item-name').focus(), 50);
}

function setDetailsOpen(open) {
  $('#item-details').hidden = !open;
  $('#toggle-details').textContent = open ? 'Weniger anzeigen' : 'Stimmt nicht ganz';
  $('#guessed').hidden = open;
}

const farbnamen = (ids) =>
  ids.map((id) => colorById(id)?.label.toLowerCase()).filter(Boolean);

/**
 * Der Satz, der zeigt, was die App verstanden hat.
 *
 * Er steht da, während man tippt. Das ist der ganze Trick beim Erfassen:
 * Wer sieht, dass "Wollpullover grau" richtig verstanden wurde, klappt die
 * Auswahlfelder nie auf.
 *
 * Steht die Farbe nicht im Namen, sondern kommt aus dem Foto, wird das
 * dazugeschrieben. Eine Angabe, die aus dem Nichts auftaucht, wird sonst
 * entweder übersehen oder für einen Fehler gehalten.
 */
function updateGuessLine() {
  const name = $('#item-name').value;
  const ausDemFoto = state.photoColors;

  if (!name.trim()) {
    $('#guessed-text').textContent = ausDemFoto.length
      ? `Auf dem Foto: ${farbnamen(ausDemFoto).join(', ')}. Fehlt noch die Bezeichnung.`
      : 'Schreib die Bezeichnung — den Rest liest die App daraus ab.';
    return;
  }

  const geraten = guessAttributes(name);
  const farben = geraten.colors.length ? geraten.colors : ausDemFoto;

  const teile = [
    slotById(geraten.slot)?.one ?? 'Teil',
    ['sehr luftig', 'luftig', 'leicht', 'mittelwarm', 'warm', 'sehr warm'][geraten.warmth],
    formalityLabel(geraten.formality).toLowerCase(),
    ...farbnamen(farben),
  ];
  if (geraten.waterproof) teile.push('regenfest');

  const ausDemBild = !geraten.colors.length && ausDemFoto.length;
  $('#guessed-text').textContent =
    `Erkannt: ${teile.join(' · ')}${ausDemBild ? ' — Farbe aus dem Foto' : ''}`;

  // Die Auswahlfelder folgen mit, damit beim Aufklappen nichts anderes
  // dasteht, als eben noch angezeigt wurde.
  if (!state.editing) {
    $('#item-slot').value = geraten.slot;
    $('#item-warmth').value = String(geraten.warmth);
    $('#item-formality').value = String(geraten.formality);
    $('#item-waterproof').checked = geraten.waterproof;
    state.formColors = farben;
    updateRangeLabels();
    updateSwatches();
  }
}

function updateRangeLabels() {
  const waerme = Number($('#item-warmth').value);
  const anlass = Number($('#item-formality').value);
  $('#warmth-out').textContent = ['sehr luftig', 'luftig', 'leicht', 'mittelwarm', 'warm', 'sehr warm'][waerme];
  $('#formality-out').textContent = FORMALITY_LEVELS[anlass]?.label ?? '';
}

function toggleFormColor(id) {
  state.formColors = state.formColors.includes(id)
    ? state.formColors.filter((farbe) => farbe !== id)
    : [...state.formColors, id];
  updateSwatches();
}

function updateSwatches() {
  for (const knopf of $$('#item-colors .swatch')) {
    knopf.setAttribute('aria-pressed', String(state.formColors.includes(knopf.dataset.color)));
  }
}

async function onPhotoChosen(event) {
  const datei = event.target.files?.[0];
  if (!datei) return;

  try {
    state.pendingPhoto = { original: await shrinkImage(datei), cutout: null };
    zeigeVorschau();
  } catch (err) {
    console.error(err);
    toast('Dieses Bild ließ sich nicht verarbeiten.');
    return;
  }

  /*
   * Freistellen -- getrennt und mit eigenem Auffangnetz.
   *
   * Es darf misslingen: `cutoutPhoto` gibt von sich aus `null` zurück, wenn
   * das Ergebnis nicht taugt, und dann bleibt schlicht das Foto mit
   * Hintergrund. Ein halbiertes Hemd wäre schlechter als eine Bettdecke im
   * Bild.
   */
  try {
    const frei = await cutoutPhoto(state.pendingPhoto.original);
    if (frei) {
      state.pendingPhoto.cutout = frei.blob;
      $('#item-cutout').checked = true;
      zeigeVorschau();
    }
    $('#cutout-row').hidden = !frei;
  } catch (err) {
    console.warn('Freistellen nicht möglich:', err);
    $('#cutout-row').hidden = true;
  }

  /*
   * Die Farbe aus dem Bild lesen.
   *
   * Getrennt vom Verkleinern und mit eigenem Auffangnetz: Wenn das
   * Auszählen schiefgeht, soll das Foto trotzdem gespeichert werden. Eine
   * fehlende Farbe ist ein Schönheitsfehler, ein verlorenes Foto nicht.
   */
  try {
    // Am Freisteller gelesen, wenn es einen gibt: Ohne Hintergrund ist die
    // Farbe eindeutig, weil dann gar nichts anderes mehr im Bild ist.
    const gesehen = await colorsFromPhoto(state.pendingPhoto.cutout ?? state.pendingPhoto.original);
    state.photoColors = gesehen.suggestion;

    // Beim Ändern nur ergänzen, nie überschreiben: Wer die Farbe einmal
    // von Hand gesetzt hat, will sie nicht durch ein neues Foto verlieren.
    if (!state.editing || !state.formColors.length) applyColorSources();
  } catch (err) {
    console.warn('Farbe ließ sich nicht aus dem Bild lesen:', err);
    state.photoColors = [];
  }
}

/**
 * Zeigt die Fassung des Fotos, die auch gespeichert würde.
 *
 * Damit ist der Schalter "freigestellt" keine Ankündigung, sondern zeigt
 * sofort, was dabei herauskommt.
 */
function zeigeVorschau() {
  const foto = state.pendingPhoto;
  if (!foto) return;

  const freigestellt = $('#item-cutout').checked && foto.cutout;
  const url = URL.createObjectURL(freigestellt ? foto.cutout : foto.original);
  $('#photo-preview').replaceChildren(el('img', { src: url, alt: '' }));
}

/**
 * Legt fest, wer bei der Farbe das letzte Wort hat: der Name.
 *
 * Wer "Wollpullover grau" tippt, hat die Frage beantwortet -- dann muss das
 * Bild nicht mitreden. Nur wo im Namen keine Farbe steht, zählt, was auf
 * dem Foto zu sehen war.
 */
function applyColorSources() {
  const ausDemNamen = guessAttributes($('#item-name').value).colors;
  state.formColors = ausDemNamen.length ? ausDemNamen : [...state.photoColors];
  updateSwatches();
  updateGuessLine();
}

async function onItemSubmit(event) {
  // Kein preventDefault: `method="dialog"` schließt den Dialog, und das ist
  // die Rückmeldung, dass das Speichern angekommen ist. Gespeichert wird
  // gleich anschließend.
  const name = $('#item-name').value.trim();
  if (!name) {
    event.preventDefault();
    return;
  }

  const angaben = {
    name,
    brand: $('#item-brand').value.trim(),
    slot: $('#item-slot').value,
    warmth: Number($('#item-warmth').value),
    formality: Number($('#item-formality').value),
    colors: [...state.formColors],
    waterproof: $('#item-waterproof').checked,
  };

  const foto = state.pendingPhoto;
  const bearbeitet = state.editing;
  state.pendingPhoto = null;

  // Beim Ändern ohne neues Foto gilt, was schon abgelegt ist -- sonst wäre
  // der Schalter dort ohne Wirkung.
  const hatFreisteller = foto
    ? Boolean(foto.cutout)
    : Boolean(bearbeitet && store.byId('items', bearbeitet)?.hasCutout);
  const freigestellt = $('#item-cutout').checked && hatFreisteller;

  /** Beide Fassungen ablegen -- der Schalter soll umkehrbar bleiben. */
  const legeAb = async (id) => {
    await photos.put(id, foto.original);
    if (foto.cutout) await photos.put(`${id}${CUTOUT_SUFFIX}`, foto.cutout);
    for (const schluessel of photoKeysOf({ photoId: id })) photoUrls.forget(schluessel);
  };

  if (bearbeitet) {
    if (foto) await legeAb(bearbeitet);
    await updateItem(store, bearbeitet, {
      ...angaben,
      cutout: freigestellt,
      hasCutout: hatFreisteller,
      ...(foto ? { photoId: bearbeitet } : {}),
    });
    toast('Geändert.');
  } else {
    const teil = await addItem(store, {
      ...angaben,
      hasPhoto: Boolean(foto),
      cutout: freigestellt,
      hasCutout: hatFreisteller,
    });
    if (foto) await legeAb(teil.id);
    toast(`„${teil.name}" ist im Schrank.`);
  }

  state.editing = null;
}

// --- Ein Teil ansehen ----------------------------------------------------

function openItemDetail(teil) {
  const koerper = $('#detail-body');
  const bild = el('div', { class: 'detail-photo' });
  fillTile(bild, teil, { withName: false });

  const tage = daysSince(teil.lastWornAt);
  const zeilen = [
    ['Fach', slotById(teil.slot)?.label ?? '—'],
    ['Wärme', ['sehr luftig', 'luftig', 'leicht', 'mittelwarm', 'warm', 'sehr warm'][teil.warmth]],
    ['Anlass', formalityLabel(teil.formality)],
    ['Farbe', (teil.colors ?? []).map((id) => colorById(id)?.label).filter(Boolean).join(', ') || '—'],
    ['Getragen', teil.wornCount ? plural(teil.wornCount, 'Mal', 'Mal') : 'noch nie'],
    ['Zuletzt', tage === null ? '—' : tage === 0 ? 'heute' : `vor ${plural(tage, 'Tag', 'Tagen')}`],
  ];

  setChildren(
    koerper,
    bild,
    el(
      'div',
      { class: 'detail-title' },
      teil.brand ? el('span', { class: 'detail-brand', text: teil.brand }) : null,
      el('h2', { text: teil.name }),
    ),
    teil.waterproof ? el('div', { class: 'chips' }, el('span', { class: 'chip chip-static chip-good', text: 'Hält Regen ab' })) : null,
    el('div', { class: 'detail-rows' }, ...zeilen.map(([links, rechts]) =>
      el('div', { class: 'detail-row' }, el('span', { text: links }), el('span', { text: rechts })),
    )),
    el(
      'div',
      { class: 'row-buttons' },
      el('button', {
        type: 'button',
        class: 'button button-primary',
        text: 'Heute getragen',
        onclick: async () => {
          await wearItems(store, [teil.id]);
          $('#dlg-detail').close();
          toast('Notiert.');
        },
      }),
      el('button', {
        type: 'button',
        class: 'button',
        text: 'Ändern',
        onclick: () => {
          $('#dlg-detail').close();
          openItemForm(store.byId('items', teil.id) ?? teil);
        },
      }),
    ),
    el(
      'div',
      { class: 'row-buttons' },
      el('button', {
        type: 'button',
        class: 'button button-danger',
        text: 'Aussortieren',
        onclick: async () => {
          if (!confirm(`„${teil.name}" aussortieren?`)) return;
          for (const schluessel of photoKeysOf(teil)) {
            await photos.remove(schluessel);
            photoUrls.forget(schluessel);
          }
          await store.remove('items', teil.id);
          $('#dlg-detail').close();
          toast('Aussortiert.');
        },
      }),
      el('button', { type: 'button', class: 'button button-ghost', text: 'Schließen', 'data-close': true }),
    ),
  );

  $('#dlg-detail').showModal();
}

// --- Ein Outfit ansehen --------------------------------------------------

function openSuggestion(vorschlag) {
  showOutfitDialog({
    teile: vorschlag.items,
    titel: labelFor(vorschlag),
    reason: vorschlag.reason,
    aktionen: [
      {
        text: 'Merken',
        klasse: 'button button-primary',
        run: async () => {
          await saveOutfit(store, {
            itemIds: vorschlag.itemIds,
            label: labelFor(vorschlag),
            occasion: occasion(),
          });
          toast('Outfit gemerkt.');
        },
      },
      {
        text: 'Heute anziehen',
        klasse: 'button',
        run: async () => {
          await wearItems(store, vorschlag.itemIds);
          toast('Schönen Tag.');
        },
      },
    ],
    urteil: vorschlag,
  });
}

function openSavedOutfit(outfit) {
  const teile = itemsOf(outfit, items());
  showOutfitDialog({
    teile,
    outfit,
    titel: outfit.label || 'Outfit',
    reason: isComplete(outfit, items()) ? '' : 'Ein Teil davon ist nicht mehr im Schrank.',
    aktionen: [
      {
        text: 'Anordnen',
        klasse: 'button',
        run: () => {
          // Erst im nächsten Durchlauf -- der Dialog schließt gerade.
          setTimeout(() => openLayout({ items: teile, outfit, titel: outfit.label || 'Outfit' }), 0);
        },
      },
      {
        text: 'Heute anziehen',
        klasse: 'button button-primary',
        run: async () => {
          await wearOutfit(store, outfit.id);
          toast('Schönen Tag.');
        },
      },
      {
        text: 'Verwerfen',
        klasse: 'button button-danger',
        run: async () => {
          await store.remove('outfits', outfit.id);
          toast('Outfit verworfen.');
        },
      },
    ],
  });
}

function showOutfitDialog({ teile, titel, reason, aktionen, urteil, outfit = null }) {
  const dialog = $('#dlg-outfit');
  const koerper = $('#outfit-body');

  setChildren(
    koerper,
    el('h2', { text: titel }),
    reason ? el('p', { class: 'muted', text: reason }) : null,
    // Wer das Outfit einmal ausgelegt hat, soll es so wiedersehen. Ohne
    // eigene Anordnung ist das Raster die bessere Darstellung: Es füllt die
    // Fläche und lässt kein Teil klein in einer Ecke sitzen.
    hasLayout(outfit) ? layoutStage(teile, outfit.layout) : tileGrid(teile),
    el(
      'div',
      { class: 'stack-tight' },
      ...teile.map((teil) =>
        el(
          'button',
          {
            type: 'button',
            class: 'result-row',
            onclick: () => {
              dialog.close();
              openItemDetail(teil);
            },
          },
          el('span', { text: teil.name }),
          el('small', { text: slotById(teil.slot)?.label ?? '' }),
        ),
      ),
    ),
    el(
      'div',
      { class: 'row-buttons' },
      ...aktionen.map((aktion) =>
        el('button', {
          type: 'button',
          class: aktion.klasse,
          text: aktion.text,
          onclick: async () => {
            await aktion.run();
            dialog.close();
          },
        }),
      ),
    ),
    urteil
      ? el(
          'div',
          { class: 'verdict-row' },
          el('button', {
            type: 'button',
            class: 'verdict',
            text: 'Nicht mein Stil',
            onclick: async () => {
              await judge(urteil, VERDICT.DISLIKE);
              dialog.close();
            },
          }),
          el('button', {
            type: 'button',
            class: 'verdict verdict-yes',
            text: 'Gefällt mir',
            onclick: async () => {
              await judge(urteil, VERDICT.LIKE);
              dialog.close();
            },
          }),
        )
      : null,
    el('button', { type: 'button', class: 'button button-ghost', text: 'Schließen', 'data-close': true }),
  );

  dialog.showModal();
}

// --- Eigenes Outfit bauen ------------------------------------------------

function openCompose() {
  state.compose = {};
  renderCompose();
  $('#dlg-compose').showModal();
}

function renderCompose() {
  const behaelter = $('#compose-slots');
  const alle = items();
  behaelter.replaceChildren();

  for (const slot of SLOTS) {
    const imFach = alle.filter((teil) => teil.slot === slot.id);
    if (!imFach.length) continue;

    behaelter.append(
      el(
        'div',
        { class: 'stack-tight' },
        el('h3', { text: `${slot.icon} ${slot.label}` }),
        el(
          'div',
          { class: 'pick-grid' },
          ...imFach.map((teil) => {
            const bild = el('div', { class: 'pick-thumb' });
            fillTile(bild, teil, { withName: false });

            return el(
              'button',
              {
                type: 'button',
                class: 'pick',
                dataset: { slot: slot.id, item: teil.id },
                'aria-pressed': String(state.compose[slot.id] === teil.id),
                onclick: () => {
                  // Zweites Antippen wählt wieder ab -- ein Fach darf leer
                  // bleiben, eine Mütze gehört nicht zu jedem Outfit.
                  state.compose[slot.id] = state.compose[slot.id] === teil.id ? null : teil.id;
                  markCompose();
                },
              },
              bild,
              el('span', { class: 'pick-name', text: teil.name }),
              el('span', { class: 'pick-check' }, icon('i-check')),
            );
          }),
        ),
      ),
    );
  }

  markCompose();
}

/**
 * Zeichnet nur die Auswahl nach, nicht die ganze Liste.
 *
 * Ein vollständiger Neuaufbau bei jedem Antippen setzte den Dialog auf
 * Anfang zurück -- wer unten bei den Schuhen wählt, säße nach dem Tippen
 * wieder oben bei den Oberteilen.
 */
function markCompose() {
  for (const chip of $$('#compose-slots .pick')) {
    chip.setAttribute(
      'aria-pressed',
      String(state.compose[chip.dataset.slot] === chip.dataset.item),
    );
  }

  const gewaehlt = Object.values(state.compose).filter(Boolean);
  $('#compose-hint').textContent = gewaehlt.length
    ? `${plural(gewaehlt.length, 'Teil', 'Teile')} gewählt.`
    : 'Wähle die Teile aus, die zusammengehören.';
}

function onComposeSubmit(event) {
  const gewaehlt = Object.values(state.compose).filter(Boolean);
  if (gewaehlt.length < 2) {
    event.preventDefault();
    toast('Ein Outfit braucht mindestens zwei Teile.');
    return;
  }

  const teile = gewaehlt.map((id) => store.byId('items', id)).filter(Boolean);

  // Erst im nächsten Durchlauf: Dieser Dialog schließt sich gerade selbst
  // (`method="dialog"`), und zwei offene Dialoge zugleich verträgt der
  // Browser nicht.
  setTimeout(() => openLayout({ items: teile, titel: 'Outfit anordnen' }), 0);
}

// --- Ein Outfit auf der Fläche anordnen ----------------------------------

/**
 * Öffnet die Anordnungsfläche.
 *
 * Zwei Wege führen hierher: ein frisch zusammengestelltes Outfit (dann ohne
 * `outfit`) und ein gespeichertes, das umgeräumt werden soll.
 */
function openLayout({ items: teile, outfit = null, titel = 'Outfit anordnen' }) {
  state.layout = {
    items: teile,
    positions: outfit ? mergeLayout(outfit.layout, teile) : defaultLayout(teile),
    outfitId: outfit?.id ?? null,
  };

  $('#layout-title').textContent = titel;
  $('#layout-label').value = outfit?.label ?? '';
  $('#layout-save').textContent = outfit ? 'Anordnung sichern' : 'Outfit speichern';

  renderLayoutStage();
  $('#dlg-layout').showModal();
}

/**
 * Ein Outfit, wie es ausgelegt wurde -- nur zum Ansehen.
 *
 * Dieselbe Fläche wie beim Anordnen, aber ohne Griffe: In der Übersicht
 * würde man sonst beim Scrollen versehentlich etwas verschieben.
 */
function layoutStage(teile, layout) {
  const buehne = el('div', { class: 'layout-stage' });

  for (const { item, position, z } of placedItems(teile, layout)) {
    const stueck = el('div', {
      class: 'layout-piece',
      style: `left:${position.x * 100}%; top:${position.y * 100}%; width:${position.scale * 100}%; z-index:${z}`,
    });
    fillTile(stueck, item, { withName: false });
    buehne.append(stueck);
  }

  return buehne;
}

function renderLayoutStage() {
  const buehne = $('#layout-stage');
  buehne.replaceChildren();

  for (const { item, position, z } of placedItems(state.layout.items, state.layout.positions)) {
    const stueck = el('button', {
      type: 'button',
      class: 'layout-piece',
      'aria-label': `${item.name} verschieben`,
      style: `left:${position.x * 100}%; top:${position.y * 100}%; width:${position.scale * 100}%; z-index:${z}`,
    });

    fillTile(stueck, item, { withName: false });
    macheZiehbar(stueck, item.id);
    buehne.append(stueck);
  }
}

/**
 * Macht ein Teil mit dem Finger verschiebbar.
 *
 * Verschoben wird um die Strecke, die der Finger zurücklegt, und nicht auf
 * den Finger hin: Sonst spränge das Teil beim Antippen mit seiner Mitte
 * unter die Fingerspitze, und man verlöre genau die Stelle, die man
 * eigentlich treffen wollte.
 *
 * `pointer`-Ereignisse statt `touch` und `mouse` getrennt -- ein Weg für
 * Finger, Maus und Stift.
 */
function macheZiehbar(knoten, itemId) {
  knoten.addEventListener('pointerdown', (event) => {
    event.preventDefault();

    const flaeche = $('#layout-stage').getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const anfang = state.layout.positions[itemId];

    knoten.setPointerCapture(event.pointerId);
    knoten.classList.add('dragging');

    const bewegen = (e) => {
      const stelle = clampPosition({
        ...anfang,
        x: anfang.x + (e.clientX - start.x) / flaeche.width,
        y: anfang.y + (e.clientY - start.y) / flaeche.height,
      });
      state.layout.positions[itemId] = stelle;
      knoten.style.left = `${stelle.x * 100}%`;
      knoten.style.top = `${stelle.y * 100}%`;
    };

    const loslassen = () => {
      knoten.classList.remove('dragging');
      knoten.removeEventListener('pointermove', bewegen);
      knoten.removeEventListener('pointerup', loslassen);
      knoten.removeEventListener('pointercancel', loslassen);
    };

    knoten.addEventListener('pointermove', bewegen);
    knoten.addEventListener('pointerup', loslassen);
    knoten.addEventListener('pointercancel', loslassen);
  });
}

async function onLayoutSubmit() {
  const { items: teile, positions, outfitId } = state.layout;
  const name = $('#layout-label').value.trim();

  if (outfitId) {
    const outfit = store.byId('outfits', outfitId);
    if (outfit) {
      await store.put('outfits', { ...outfit, layout: positions, label: name || outfit.label });
      toast('Anordnung gesichert.');
    }
    return;
  }

  await saveOutfit(store, {
    itemIds: teile.map((teil) => teil.id),
    label: name || 'Eigenes Outfit',
    layout: positions,
    occasion: occasion(),
  });
  toast('Outfit gespeichert.');
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
    // Mitten in einer Eingabe nicht dazwischenfunken. Der neue Stand liegt
    // dann bereits im Cache und ist beim nächsten Start von selbst da.
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
export { APP_VERSION, createItem };
