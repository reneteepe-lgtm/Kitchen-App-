/**
 * Oberfläche.
 *
 * Hält keine eigene Wahrheit: Jede Änderung geht in den Store, der Store
 * meldet sich zurück, und daraufhin wird neu gezeichnet. Dadurch kann die
 * Anzeige nicht vom gespeicherten Bestand abweichen.
 */

import { Store, LocalStorageAdapter, requestPersistence } from './storage.js';
import { backupStatus, describeBackupAge, formatBytes, snoozeUntil } from './backup.js';
import { applyBadge, askNotificationPermission, describeBadgeState, supportsBadge } from './badge.js';
import { Pantry, DEFAULT_SETTINGS, stockOf, lotsFor, daysUntil } from './model.js';
import { BarcodeScanner, isScanSupported, lookupBarcode, stripBrand, suggestProduct } from './barcode.js';
import { normalize, stockAnswer } from './search.js';
import { parseReceipt, suggestedName } from './receipt.js';
import { brandsInUse, splitBrand } from './brands.js';
import { duplicateGroups, findTwin, mergedProduct } from './dedupe.js';
import { estimateBestBefore, learnShelfLife } from './shelflife.js';
import {
  CATEGORIES,
  categoriesInShoppingOrder,
  categoryById,
  categoryOf,
  groupByCategory,
  guessCategory,
} from './categories.js';
import {
  describeForecast,
  describeRate,
  formatDate,
  formatDateLong,
  relativeDays,
  humanDuration,
  plural,
} from './format.js';

/**
 * Bei jeder Veröffentlichung erhöhen -- und dieselbe Nummer im Cache-Namen
 * in `sw.js` mitziehen. Wird unter "Mehr" angezeigt, damit auf dem Handy
 * nachprüfbar ist, welcher Stand gerade läuft.
 */
export const APP_VERSION = '1.19.1';

const $ = (sel) => document.querySelector(sel);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const store = new Store(new LocalStorageAdapter());
const pantry = new Pantry(store);
const scanner = new BarcodeScanner();

let activeView = 'pantry';
let searchTerm = '';
let toastTimer = null;

// --- Anzeige --------------------------------------------------------------

function render() {
  renderPantry();
  renderShopping();
  renderExpiry();
  renderBadges();
  renderStats();
  renderBackup();
  renderBackfill();
  renderBrandSplit();
  renderMerge();
  renderLastImport();
  syncAppBadge();
  // Die Detailansicht ist ein eigener Dialog, der über der Liste liegt.
  // Ohne diesen Aufruf zeigte sie nach einer Änderung weiter den Stand von
  // vor dem Öffnen -- man ändert eine Haltbarkeit und sieht das alte Datum.
  if (detailProductId) renderDetail(detailProductId);
}

/**
 * Setzt Marke und Bezeichnung untereinander in eine Zeile.
 *
 * Die Marke steht klein darüber, weil sie beim Suchen im Schrank hilft,
 * aber nicht die Sache selbst benennt: "Baresa" über "Tomaten passiert".
 * Fehlt sie -- bei allem, was nicht gescannt wurde --, bleibt die Zeile
 * unverändert einzeilig.
 */
function labelInto(container, name, brand) {
  if (brand) container.appendChild(el('span', 'item-brand', brand));
  container.appendChild(el('span', 'item-name', name));
}

/** Eine Zeile mit Bestand, Prognose und den beiden Buchungsknöpfen. */
function pantryRow(assessment) {
  const { product, stock } = assessment;
  const forecast = describeForecast(assessment);
  const row = el('li', 'item');

  const main = el('button', 'item-main');
  labelInto(main, product.name, product.brand);

  const expiry = assessment.expiry;
  const parts = [forecast.text];
  if (expiry && expiry.days <= pantry.settings.expiryWarnDays) {
    // Die Tilde sagt: geschätzt, nicht von der Packung abgelesen.
    parts.push(`MHD ${expiry.lot?.estimated ? '~ ' : ''}${relativeDays(expiry.days)}`);
  }
  main.appendChild(el('span', `item-note tone-${forecast.tone}`, parts.join(' · ')));
  main.addEventListener('click', () => openDetail(product.id));

  const chip = el('span', stock > 0 ? 'stock-chip' : 'stock-chip is-empty', String(stock));

  const minus = el('button', 'step', '−');
  minus.title = 'Eine Packung verbraucht';
  minus.setAttribute('aria-label', `Eine Packung ${product.name} verbraucht`);
  minus.disabled = stock <= 0;
  minus.addEventListener('click', async () => {
    await pantry.consume(product.id, 1);
    toast(`${product.name}: 1 verbraucht`, true);
  });

  const plus = el('button', 'step step-plus', '+');
  plus.title = 'Einbuchen';
  plus.setAttribute('aria-label', `${product.name} einbuchen`);
  plus.addEventListener('click', () => openStockDialog(product));

  row.append(main, chip, minus, plus);
  return row;
}

function renderPantry() {
  const list = $('#pantry-list');
  const searching = searchTerm.length > 0;

  if (searching) {
    // Bei einer Suche zählt die Trefferqualität, nicht das Fach: Wer sucht,
    // will die Antwort oben sehen und nicht erst eine Überschrift.
    const items = pantry.search(searchTerm).map((match) => pantry.assess(match.product));
    list.replaceChildren(...items.map(pantryRow));
    renderSearchAnswer(pantry.search(searchTerm));
    $('#pantry-empty').hidden = true;
    return;
  }

  renderSearchAnswer(null);
  const items = pantry.assessAll();

  // Nach Fächern gruppiert, damit sich der Vorrat wie ein Schrank liest.
  const groups = groupByCategory(items);
  const nodes = [];
  for (const { category, items: entries } of groups) {
    const heading = el('li', 'group-head');
    heading.appendChild(el('span', 'group-icon', category.icon));
    heading.appendChild(el('span', null, category.label));
    heading.appendChild(el('span', 'group-count', String(entries.length)));
    nodes.push(heading, ...entries.map(pantryRow));
  }

  list.replaceChildren(...nodes);
  $('#pantry-empty').hidden = items.length > 0;
  $('#pantry-empty').innerHTML =
    'Noch nichts erfasst.<br />Leg oben rechts das erste Produkt an oder scanne einen Barcode.';
}

/**
 * Beantwortet die Frage, die man beim Suchen tatsächlich hat: Haben wir das
 * noch? Eine Liste allein beantwortet sie nicht -- schon gar nicht die
 * leere Liste, die genauso aussieht wie "gibt es nicht".
 */
function renderSearchAnswer(matches) {
  const box = $('#search-answer');
  if (!matches) {
    box.hidden = true;
    return;
  }

  const answer = stockAnswer(matches);
  box.replaceChildren();
  box.hidden = false;
  box.className = `answer answer-${answer.kind}`;

  if (answer.kind === 'have') {
    box.appendChild(el('strong', null, `Ja — ${answer.stock} da`));
    box.appendChild(el('span', null, answer.product.name));
    return;
  }

  if (answer.kind === 'empty') {
    box.appendChild(el('strong', null, 'Nein — nichts mehr da'));
    box.appendChild(el('span', null, `${answer.product.name} ist erfasst, aber leer`));
    return;
  }

  box.appendChild(el('strong', null, 'Nicht im Vorrat'));
  box.appendChild(el('span', null, `„${searchTerm}“ ist hier nirgends erfasst`));
  const add = el('button', 'button answer-action', 'Anlegen');
  add.type = 'button';
  add.addEventListener('click', () => openProductDialog(null, { name: searchTerm }));
  box.appendChild(add);
}

/** Warum steht das hier? In einem Satz, den man im Laden versteht. */
function shoppingReason(item) {
  switch (item.need.reason) {
    case 'empty':
      return 'leer';
    case 'below-min':
      return `nur noch ${item.stock} — Mindestbestand ${item.product.minStock}`;
    default:
      return item.projection.daysLeft === null
        ? `${item.stock} vorhanden`
        : `reicht noch ${humanDuration(item.projection.daysLeft)} — ${item.stock} vorhanden`;
  }
}

/**
 * Ein selbst notierter Eintrag.
 *
 * Steht laut Vorrat noch etwas davon da, sagt die Zeile das deutlich --
 * und bietet gleich an, den Bestand zu berichtigen. Denn wer im Laden
 * steht, weiß es besser als die App.
 */
function manualRow({ wish, product, stock }) {
  const row = el('li', `item${wish.done ? ' is-done' : ''}`);

  // Antippen hakt ab -- die Geste, die man von einer Einkaufsliste erwartet.
  const main = el('button', 'item-main');
  labelInto(main, wish.text, product?.brand);

  const note = wish.done
    ? { text: 'erledigt', tone: 'empty' }
    : product && stock > 0
      ? { text: `Laut Vorrat noch ${stock} da`, tone: 'warn' }
      : { text: product ? 'nichts mehr da' : 'nur notiert', tone: 'empty' };
  main.appendChild(el('span', `item-note tone-${note.tone}`, note.text));

  main.setAttribute('aria-pressed', String(!!wish.done));
  main.title = wish.done ? 'Haken entfernen' : 'Abhaken';
  main.addEventListener('click', () => pantry.setWishDone(wish.id, !wish.done));

  const actions = el('div', 'row-actions');

  // Wie viele mitzubringen sind. Antippen zählt hoch und springt nach neun
  // wieder auf eins -- ein Dialog für eine einstellige Zahl wäre im Laden
  // umständlicher als ein zweiter Tipp.
  const qty = wish.qty ?? 1;
  const qtyChip = el('button', `qty-chip${qty > 1 ? ' is-many' : ''}`, `${qty}×`);
  qtyChip.type = 'button';
  qtyChip.title = 'Stückzahl ändern';
  qtyChip.setAttribute('aria-label', `${wish.text}: ${qty} Stück, antippen zum Erhöhen`);
  qtyChip.addEventListener('click', () => pantry.setWishQty(wish.id, qty >= 9 ? 1 : qty + 1));
  actions.appendChild(qtyChip);

  if (!wish.done && product && stock > 0) {
    // Der eine Fall, den die App nicht selbst entscheiden kann: Die Zahl
    // stimmt nicht. Als Korrektur gebucht, damit die Prognose sauber bleibt.
    const fix = el('button', 'chip-button', 'Ist leer');
    fix.type = 'button';
    fix.title = 'Bestand auf null setzen';
    fix.addEventListener('click', async () => {
      await pantry.setStock(product.id, 0);
      toast(`${product.name}: Bestand auf 0 gesetzt`, true);
    });
    actions.appendChild(fix);
  }

  const drop = el('button', 'step', '×');
  drop.title = 'Von der Liste nehmen';
  drop.setAttribute('aria-label', `${wish.text} von der Liste nehmen`);
  drop.addEventListener('click', async () => {
    await pantry.removeWish(wish.id);
    toast(`${wish.text} von der Liste genommen`);
  });

  const bought = el('button', 'step step-plus', '+');
  bought.title = 'Gekauft und eingeräumt';
  bought.setAttribute('aria-label', `${wish.text} einbuchen`);
  bought.addEventListener('click', () => {
    // Die notierte Stückzahl gleich vorbelegen -- sie ist ja der Grund,
    // warum sie überhaupt dransteht.
    if (product) openStockDialog(product, { wishId: wish.id, qty });
    // Noch kein Produkt: erst anlegen, der Eintrag verschwindet danach.
    else openProductDialog(null, { name: wish.text, wishId: wish.id, stock: qty });
  });

  actions.append(drop, bought);
  row.append(main, actions);
  return row;
}

/** Rückmeldung beim Tippen in der Einkaufsliste. */
function renderWishHint(text) {
  const box = $('#wish-hint');
  const query = text.trim();
  if (query.length < 2) {
    box.hidden = true;
    return;
  }

  const answer = stockAnswer(pantry.search(query));
  if (answer.kind !== 'have') {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  box.className = 'answer answer-warn';
  box.replaceChildren(
    el('strong', null, `${answer.product.name}: noch ${answer.stock} da`),
    el('span', null, 'Trotzdem notieren? Dann einfach bestätigen.'),
  );
}

/**
 * Die Kategorie eines Listeneintrags.
 *
 * Hängt ein Produkt daran, gilt dessen Fach. Frei Notiertes wie "Alufolie"
 * hat keins -- dort ist der Text die einzige Auskunft, und die reicht.
 */
const entryCategory = (entry) =>
  entry.product ? categoryOf(entry.product) : guessCategory(entry.wish.text);

/** Eine Zwischenüberschrift für einen Kategorie-Block. */
function groupHeading(category, count) {
  const heading = el('li', 'group-head');
  heading.appendChild(el('span', 'group-icon', category.icon));
  heading.appendChild(el('span', null, category.label));
  heading.appendChild(el('span', 'group-count', String(count)));
  return heading;
}

function renderManual() {
  const entries = pantry.manualList();
  const open = entries.filter((entry) => !entry.wish.done);
  const done = entries.filter((entry) => entry.wish.done);

  // Nach Gängen sortiert, damit man den Markt in einem Zug durchläuft.
  const groups = groupByCategory(open, {
    order: categoriesInShoppingOrder(),
    categoryFor: entryCategory,
  });

  const nodes = [];
  for (const { category, items } of groups) {
    nodes.push(groupHeading(category, items.length), ...items.map(manualRow));
  }

  // Erledigtes sammelt sich unten in einem Block -- sonst zerrisse es die
  // Gänge, durch die man gerade läuft.
  if (done.length) {
    const heading = el('li', 'group-head');
    heading.appendChild(el('span', 'group-icon', '✓'));
    heading.appendChild(el('span', null, 'Erledigt'));
    heading.appendChild(el('span', 'group-count', String(done.length)));
    nodes.push(heading, ...done.map(manualRow));
  }

  $('#manual-list').replaceChildren(...nodes);
  $('#manual-head').hidden = entries.length === 0;
  $('#manual-empty').hidden = entries.length > 0;
  $('#clear-done').hidden = done.length === 0;
  // Kurz halten: Der Knopf teilt sich die Zeile mit der Überschrift.
  $('#clear-done').textContent = `Erledigte weg (${done.length})`;
  return entries.length;
}

function renderShopping() {
  const list = $('#shopping-list');
  const items = pantry.shoppingList();

  const suggestionRow = (item) => {
      const row = el('li', 'item');
      const main = el('button', 'item-main');
      labelInto(main, item.product.name, item.product.brand);

      const tone = item.need.urgency === 3 ? 'empty' : item.need.urgency === 2 ? 'urgent' : 'soon';
      main.appendChild(el('span', `item-note tone-${tone}`, shoppingReason(item)));
      main.addEventListener('click', () => openDetail(item.product.id));

      const actions = el('div', 'row-actions');

      // Ablehnen muss möglich sein: Nicht alles, was leer ist, wird auch
      // nachgekauft. Ohne diesen Knopf stünde es bis zum nächsten Kauf
      // unverrückbar da und die Vorschläge verlören ihren Wert.
      const skip = el('button', 'step', '×');
      skip.title = 'Diesmal nicht';
      skip.setAttribute('aria-label', `${item.product.name} diesmal nicht`);
      skip.addEventListener('click', async () => {
        await pantry.snoozeSuggestion(item.product.id);
        toast(`${item.product.name}: vorerst kein Vorschlag mehr`, true);
      });

      const take = el('button', 'chip-button chip-accept', 'Auf die Liste');
      take.type = 'button';
      take.addEventListener('click', async () => {
        await pantry.acceptSuggestion(item.product);
      });

      actions.append(skip, take);
      row.append(main, actions);
      return row;
  };

  // Dieselbe Gangfolge wie die Einkaufsliste darunter, damit sich beim
  // Übernehmen nichts umsortiert.
  const groups = groupByCategory(items, {
    order: categoriesInShoppingOrder(),
    categoryFor: entryCategory,
  });

  const nodes = [];
  for (const { category, items: entries } of groups) {
    nodes.push(groupHeading(category, entries.length), ...entries.map(suggestionRow));
  }
  list.replaceChildren(...nodes);

  renderManual();
  // Überschrift und Einleitung nur zeigen, wenn darunter auch etwas steht.
  $('#auto-head').hidden = items.length === 0;
  $('#auto-intro').hidden = items.length === 0;
}

function renderExpiry() {
  const list = $('#expiry-list');
  const items = pantry.expiringSoon();

  list.replaceChildren(
    ...items.map(({ lot, product, days }) => {
      const row = el('li', 'item');
      const main = el('button', 'item-main');
      labelInto(main, product.name, product.brand);
      main.appendChild(
        el(
          'span',
          `item-note tone-${days < 0 ? 'urgent' : days <= 2 ? 'urgent' : 'soon'}`,
          `${relativeDays(days)} · ${lot.estimated ? '~ ' : ''}${formatDateLong(lot.bestBefore)}`,
        ),
      );
      main.addEventListener('click', () => openDetail(product.id));

      const chip = el('span', 'stock-chip', String(lot.qty));

      const used = el('button', 'step', '−');
      used.title = 'Aufgebraucht';
      used.setAttribute('aria-label', `Eine Packung ${product.name} verbraucht`);
      used.addEventListener('click', async () => {
        await pantry.consume(product.id, 1);
        toast(`${product.name}: 1 verbraucht`, true);
      });

      row.append(main, chip, used);
      return row;
    }),
  );
  $('#expiry-empty').hidden = items.length > 0;
}

function renderBadges() {
  /*
   * Zwei Zahlen statt einer Summe: Was man sich selbst notiert hat, ist
   * verbindlich -- die Vorschläge der App sind es nicht. Zusammengezählt
   * sah der Einkauf größer aus, als er war, und man wusste vor dem
   * Antippen nicht, wovon die Zahl eigentlich sprach.
   *
   * Abgehakte Einträge zählen nicht mit. Sie liegen zwar noch unten im
   * Erledigt-Block, sind aber besorgt -- die Zahl am Reiter beantwortet
   * die Frage "wie viel steht noch aus".
   */
  const manual = pantry.manualList().filter((entry) => !entry.wish.done).length;
  const suggestions = pantry.shoppingList().length;
  const expiry = pantry.expiringSoon().length;

  const badgeManual = $('#badge-manual');
  badgeManual.textContent = String(manual);
  badgeManual.hidden = manual === 0;
  badgeManual.title = plural(manual, 'Eintrag auf der Liste', 'Einträge auf der Liste');

  const badgeSuggest = $('#badge-suggest');
  badgeSuggest.textContent = String(suggestions);
  badgeSuggest.hidden = suggestions === 0;
  badgeSuggest.title = plural(suggestions, 'Vorschlag der App', 'Vorschläge der App');

  // Vorgelesen ergäben zwei nackte Zahlen nebeneinander keinen Sinn.
  const spoken = [];
  if (manual) spoken.push(plural(manual, 'Eintrag auf der Liste', 'Einträge auf der Liste'));
  if (suggestions) spoken.push(plural(suggestions, 'Vorschlag', 'Vorschläge'));
  const tabShopping = $('.tab[data-view="shopping"]');
  if (spoken.length) tabShopping.setAttribute('aria-label', `Einkauf: ${spoken.join(', ')}`);
  else tabShopping.removeAttribute('aria-label');

  const badgeExpiry = $('#badge-expiry');
  badgeExpiry.textContent = String(expiry);
  badgeExpiry.hidden = expiry === 0;
}

function renderStats() {
  const products = pantry.products().length;
  const events = pantry.events().length;
  $('#data-stats').textContent = products
    ? `${plural(products, 'Produkt', 'Produkte')}, ${plural(events, 'Buchung', 'Buchungen')}` +
      ` — ${formatBytes(store.usedBytes())}.`
    : 'Noch nichts gespeichert.';
}

/**
 * Der Zustand der Sicherung -- einmal ausführlich unter "Daten", einmal als
 * Erinnerung dort, wo man tatsächlich hinsieht.
 */
function renderBackup() {
  const status = backupStatus({
    lastBackupAt: store.getSetting('lastBackupAt', null),
    remindAfterAt: store.getSetting('backupRemindAfter', null),
    productCount: pantry.products().length,
  });

  const line = $('#backup-state');
  line.textContent = `Zuletzt gesichert: ${describeBackupAge(status.days)}.`;
  line.classList.toggle('is-warn', status.state !== 'frisch' && status.state !== 'nichts');

  const reminder = $('#backup-reminder');
  reminder.hidden = !status.remind;
  if (status.remind) {
    $('#backup-reminder-text').textContent =
      status.state === 'nie'
        ? 'Dein Vorrat liegt nur auf diesem Handy und ist noch nie gesichert worden. Geht das Gerät verloren, ist die Arbeit weg.'
        : `Zuletzt gesichert ${describeBackupAge(status.days)}. Der Vorrat liegt nur auf diesem Handy.`;
  }
}

/**
 * Der Punkt auf dem App-Symbol.
 *
 * Läuft bei jeder Änderung mit, damit die Zahl in dem Augenblick stimmt, in
 * dem die App zugeklappt wird -- länger kann sie ohnehin nicht stimmen.
 */
let lastBadge = null;

async function syncAppBadge() {
  const enabled = store.getSetting('badgeEnabled', false) === true;
  const count = pantry.expiringSoon().length;

  // Nicht bei jedem Neuzeichnen erneut ans System melden.
  const key = `${enabled}:${count}`;
  if (key === lastBadge) return;
  lastBadge = key;

  const result = await applyBadge(count, { enabled });
  $('#badge-state').textContent = describeBadgeState({
    enabled,
    supported: supportsBadge(),
    result,
    count,
  });
}

/**
 * Was der Browser über die Haltbarkeit dieser Daten sagt.
 *
 * Steht bewusst dabei: "auf Widerruf" ist keine Panikmeldung, sondern der
 * Grund, warum die Sicherung wichtig ist -- und in dem Fall hilft es zu
 * wissen, dass die App auf dem Startbildschirm besser dasteht als im Browser.
 */
function renderStorageState(mode) {
  // Bewusst in der ruhigen Schrift: Das ist eine Auskunft, keine Aufgabe.
  // Die Warnfarbe bleibt der Zeile vorbehalten, zu der es einen Knopf gibt.
  $('#storage-state').textContent =
    mode === 'dauerhaft'
      ? 'Der Browser hat zugesagt, diese Daten zu behalten.'
      : mode === 'auf-widerruf'
        ? 'Der Browser behält die Daten nur auf Widerruf. Liegt die App auf dem Startbildschirm, ist die Zusage meist verbindlich.'
        : 'Dieser Browser sagt nichts darüber, wie lange er die Daten behält.';
}

// --- Detailansicht --------------------------------------------------------

/** Welches Produkt die Detailansicht gerade zeigt, oder null. */
let detailProductId = null;

function openDetail(productId) {
  if (!store.byId('products', productId)) return;
  detailProductId = productId;
  renderDetail(productId);
  $('#dlg-detail').showModal();
}

function renderDetail(productId) {
  const product = store.byId('products', productId);
  if (!product) {
    $('#dlg-detail').close();
    return;
  }

  const assessment = pantry.assess(product);
  const body = $('#detail-body');
  body.replaceChildren();

  const category = categoryById(categoryOf(product));
  const head = el('div', 'detail-head');
  if (product.brand) head.appendChild(el('p', 'detail-brand', product.brand));
  head.appendChild(el('h2', null, product.name));
  head.appendChild(
    el(
      'p',
      'detail-sub',
      `${category.icon} ${category.label} · ${assessment.stock} im Vorrat · Mindestbestand ${product.minStock}`,
    ),
  );
  body.appendChild(head);

  // Prognose
  const forecastSection = el('div', 'detail-section');
  forecastSection.appendChild(el('h3', null, 'Prognose'));
  const grid = el('dl', 'stat-grid');

  const stat = (label, value) => {
    const box = el('div', 'stat');
    box.appendChild(el('dt', null, label));
    box.appendChild(el('dd', null, value));
    return box;
  };

  const { projection, rate, confidence } = assessment;
  grid.append(
    stat('Reicht noch', assessment.stock > 0 ? humanDuration(projection.daysLeft) : 'leer'),
    stat('Voraussichtlich leer', projection.emptyOn ? formatDate(projection.emptyOn) : '—'),
    stat('Verbrauch', describeRate(rate) || '—'),
    stat('Datenlage', confidence.label),
  );
  forecastSection.appendChild(grid);

  if (projection.earliest && projection.latest && confidence.level !== 'learning') {
    forecastSection.appendChild(
      el(
        'p',
        'field-hint',
        // Kein Satzpunkt: Das kurze Datumsformat endet bereits auf einen.
        `Wahrscheinlich zwischen ${formatDate(projection.earliest)} und ${formatDate(projection.latest)}`,
      ),
    );
  }
  if (confidence.level === 'learning') {
    forecastSection.appendChild(
      el('p', 'field-hint', 'Noch zu wenig Buchungen für eine belastbare Schätzung.'),
    );
  }
  body.appendChild(forecastSection);

  // Chargen
  const lots = lotsFor(pantry.lots(), product.id);
  const lotSection = el('div', 'detail-section');
  lotSection.appendChild(el('h3', null, 'Im Schrank'));
  if (lots.length === 0) {
    lotSection.appendChild(el('p', 'field-hint', 'Nichts da.'));
  } else {
    lotSection.appendChild(
      el('p', 'field-hint', 'Antippen, um die Haltbarkeit zu ändern oder Packungen aufzuteilen.'),
    );
    for (const lot of lots) {
      const days = lot.bestBefore ? daysUntil(lot.bestBefore) : null;
      const state = days === null ? '' : days < 0 ? ' is-expired' : days <= 5 ? ' is-soon' : '';
      const row = el('button', `lot-row${state}`);
      row.type = 'button';
      row.appendChild(el('span', null, plural(lot.qty, 'Packung', 'Packungen')));
      row.appendChild(
        el(
          'span',
          'lot-date',
          lot.bestBefore
            ? `bis ${formatDateLong(lot.bestBefore)}${lot.estimated ? ' (geschätzt)' : ''}`
            : 'ohne Datum',
        ),
      );
      row.addEventListener('click', () => openLotDialog(product, lot));
      lotSection.appendChild(row);
    }
  }
  body.appendChild(lotSection);

  // Aktionen
  const actions = el('div', 'detail-section');
  actions.appendChild(el('h3', null, 'Ändern'));

  const inventory = el('label', 'field');
  inventory.appendChild(el('span', null, 'Bestand korrigieren'));
  inventory.appendChild(
    el('span', 'field-hint', 'Zählt nicht als Verbrauch und verfälscht die Prognose nicht.'),
  );
  const inventoryInput = el('input');
  inventoryInput.type = 'number';
  inventoryInput.min = '0';
  inventoryInput.step = '1';
  inventoryInput.value = String(assessment.stock);
  inventory.appendChild(inventoryInput);
  actions.appendChild(inventory);

  const applyRow = el('div', 'button-row');
  const applyBtn = el('button', 'button', 'Bestand übernehmen');
  applyBtn.addEventListener('click', async () => {
    await pantry.setStock(product.id, Number(inventoryInput.value));
    $('#dlg-detail').close();
    toast(`${product.name}: Bestand gesetzt`, true);
  });
  applyRow.appendChild(applyBtn);
  actions.appendChild(applyRow);

  // Nur anbieten, wenn es überhaupt etwas zu verwerfen gibt.
  if (pantry.eventsFor(product.id).length) {
    const resetRow = el('div', 'button-row');
    const resetBtn = el('button', 'button', 'Prognose zurücksetzen');
    resetBtn.addEventListener('click', async () => {
      if (!confirm(`Verbrauchsbuchungen von „${product.name}" verwerfen?\n\nDer Bestand bleibt.`)) return;
      await pantry.resetForecast(product.id);
      toast(`${product.name}: Prognose zurückgesetzt`);
    });
    resetRow.appendChild(resetBtn);
    actions.appendChild(resetRow);
  }

  const editRow = el('div', 'button-row');
  const editBtn = el('button', 'button', 'Bearbeiten');
  editBtn.addEventListener('click', () => {
    $('#dlg-detail').close();
    openProductDialog(product);
  });
  const deleteBtn = el('button', 'button button-danger', 'Löschen');
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`„${product.name}“ wirklich löschen?`)) return;
    await pantry.deleteProduct(product.id);
    $('#dlg-detail').close();
    toast(`${product.name} gelöscht`);
  });
  editRow.append(editBtn, deleteBtn);
  actions.appendChild(editRow);

  const closeRow = el('div', 'button-row');
  const closeBtn = el('button', 'button button-ghost', 'Schließen');
  closeBtn.addEventListener('click', () => $('#dlg-detail').close());
  closeRow.appendChild(closeBtn);
  actions.appendChild(closeRow);

  body.appendChild(actions);
}

// --- Dialoge --------------------------------------------------------------

let editingProduct = null;
/** Einkaufslisten-Eintrag, der mit dem Anlegen erledigt ist. */
let productWishId = null;

/** Füllt die Kategorieauswahl einmalig. */
function fillCategorySelect() {
  const select = $('#product-category');
  const auto = el('option', null, 'Automatisch');
  auto.value = '';
  select.appendChild(auto);
  for (const category of CATEGORIES) {
    const option = el('option', null, `${category.icon}  ${category.label}`);
    option.value = category.id;
    select.appendChild(option);
  }
}

/** Zeigt bei "Automatisch" an, wohin das Produkt gerade einsortiert würde. */
function syncCategoryHint() {
  const hint = $('#product-category-hint');
  if ($('#product-category').value) {
    hint.textContent = 'Fest gewählt.';
    return;
  }
  const guess = categoryById(
    guessCategory(`${$('#product-brand').value} ${$('#product-name').value}`),
  );
  hint.textContent = `Nach dem Namen: ${guess.icon} ${guess.label}`;
}

function openProductDialog(product = null, prefill = {}) {
  editingProduct = product;
  productWishId = prefill.wishId ?? null;
  $('#product-title').textContent = product ? 'Produkt bearbeiten' : 'Produkt anlegen';
  $('#product-name').value = product?.name ?? prefill.name ?? '';
  $('#product-min').value = String(product?.minStock ?? 0);
  $('#product-brand').value = product?.brand ?? prefill.brand ?? '';
  $('#product-barcode').value = product?.barcode ?? prefill.barcode ?? '';
  // Fehlt das Feld (Daten aus einer älteren Fassung), gilt "vorschlagen".
  $('#product-suggest').checked = product ? product.suggest !== false : true;

  // "Automatisch" heißt: aus dem Namen ableiten, auch wenn der sich später
  // noch ändert. Erst eine bewusste Wahl legt die Kategorie fest.
  $('#product-category').value = product?.category ?? '';
  syncCategoryHint();
  // Beim Bearbeiten wäre ein zweites Bestandsfeld neben der Inventur verwirrend.
  $('#product-initial').hidden = !!product;
  $('#product-stock').value = String(prefill.stock ?? 1);
  $('#product-bb').value = '';
  $('#dlg-product').showModal();
  if (!product) setTimeout(() => $('#product-name').focus(), 50);
}

let lotTarget = null;

/**
 * Dialog für eine einzelne Charge: Datum ändern oder einen Teil davon mit
 * einem eigenen Datum herauslösen.
 */
function openLotDialog(product, lot) {
  lotTarget = lot;
  $('#lot-title').textContent = product.name;
  $('#lot-info').textContent = lot.bestBefore
    ? `${plural(lot.qty, 'Packung', 'Packungen')}, haltbar bis ${formatDateLong(lot.bestBefore)}` +
      (lot.estimated ? ' (geschätzt)' : '')
    : `${plural(lot.qty, 'Packung', 'Packungen')} ohne Haltbarkeitsdatum`;
  $('#lot-bb').value = lot.bestBefore ?? '';
  // Aufteilen ergibt nur Sinn, wenn mehr als eine Packung in der Charge ist.
  $('#lot-split-field').hidden = lot.qty < 2;
  $('#lot-qty').max = String(lot.qty);
  $('#lot-qty').value = String(lot.qty);
  $('#dlg-lot').showModal();
}

let stockTarget = null;
/** Ob der Einbuch-Dialog aus dem Scanner heraus geöffnet wurde. */
let stockFromScan = false;
/** Der Einkaufslisten-Eintrag, der mit dem Einbuchen erledigt ist. */
let stockWishId = null;

function openStockDialog(product, { fromScan = false, wishId = null, qty = 1 } = {}) {
  stockTarget = product;
  stockFromScan = fromScan;
  stockWishId = wishId;
  $('#stock-title').textContent = `${product.name} einbuchen`;
  $('#stock-qty').value = String(Math.max(1, Number(qty) || 1));
  // Vorbelegt, nicht festgelegt: Wer das Datum von der Packung abliest,
  // überschreibt es -- und genau daraus lernt die App dann.
  const geschaetzt = guessBestBefore(product);
  $('#stock-bb').value = geschaetzt ?? '';
  $('#stock-bb-hint').hidden = !geschaetzt;
  $('#stock-split').checked = false;
  $('#stock-again-row').hidden = !fromScan;
  syncStockDialog();
  $('#dlg-stock').showModal();
}

/**
 * Hält den Einbuch-Dialog im Einklang mit Menge und Umschalter.
 *
 * Bei einer einzelnen Packung gibt es nichts aufzuteilen -- dann bleibt
 * der Umschalter verborgen und es steht nur ein Datumsfeld da.
 */
function syncStockDialog() {
  const qty = Math.max(1, Math.round(Number($('#stock-qty').value) || 1));
  const canSplit = qty > 1;
  const split = canSplit && $('#stock-split').checked;

  $('#stock-split-row').hidden = !canSplit;
  $('#stock-single').hidden = split;
  $('#stock-dates').hidden = !split;

  if (!split) return;

  // Vorhandene Eingaben beim Ändern der Menge nicht wegwerfen.
  const previous = [...$('#stock-dates').querySelectorAll('input')].map((i) => i.value);
  const list = $('#stock-dates');
  list.replaceChildren();

  for (let i = 0; i < qty; i++) {
    const row = el('label', 'date-row');
    row.appendChild(el('span', null, `Packung ${i + 1}`));
    const input = el('input');
    input.type = 'date';
    input.value = previous[i] ?? $('#stock-bb').value ?? '';
    row.appendChild(input);
    list.appendChild(row);
  }
}

/**
 * Das geschätzte Haltbarkeitsdatum für ein Produkt.
 *
 * Was für dieses Produkt gelernt wurde, schlägt jede Faustregel: Wer einmal
 * ein echtes Datum eingetragen hat, hat damit gesagt, wie lange es hält.
 *
 * @returns {string|null} null, wenn abgeschaltet oder nichts zu schätzen ist
 */
function guessBestBefore(product, from = new Date()) {
  if (store.getSetting('estimateExpiry', true) === false) return null;
  if (!product) return null;
  return estimateBestBefore({
    text: `${product.brand ?? ''} ${product.name ?? ''}`,
    // `categoryOf` liefert die Kennung selbst, kein Objekt.
    categoryId: categoryOf(product),
    learned: product.shelfLifeDays ?? null,
    from,
  });
}

/**
 * Merkt sich, wie lange dieses Produkt hält.
 *
 * Nur bei einem von Hand eingetragenen Datum -- eine Schätzung von sich
 * selbst lernen zu lassen, verfestigte bloß den ersten Fehlgriff.
 */
async function rememberShelfLife(product, bestBefore) {
  if (!product || !bestBefore) return;
  const days = learnShelfLife(bestBefore);
  if (!days || product.shelfLifeDays === days) return;
  await pantry.updateProduct(pantry.product(product.id) ?? product, { shelfLifeDays: days });
}

/** Liest aus dem Dialog, was einzubuchen ist. */
function stockDialogBatches() {
  const qty = Math.max(1, Math.round(Number($('#stock-qty').value) || 1));
  if ($('#stock-dates').hidden) {
    return [{ qty, bestBefore: $('#stock-bb').value || null }];
  }
  return [...$('#stock-dates').querySelectorAll('input')].map((input) => ({
    qty: 1,
    bestBefore: input.value || null,
  }));
}

async function submitStockDialog() {
  if (!stockTarget) return;
  const product = stockTarget;
  const batches = stockDialogBatches();
  const total = batches.reduce((sum, b) => sum + b.qty, 0);

  // Steht dort noch genau der Vorschlag, war es eine Schätzung. Was
  // abgeändert wurde, ist abgelesen -- und daraus wird gelernt.
  const vorschlag = guessBestBefore(product);
  for (const batch of batches) {
    batch.estimated = Boolean(batch.bestBefore) && batch.bestBefore === vorschlag;
  }
  const eigenes = batches.find((b) => b.bestBefore && !b.estimated);
  if (eigenes) await rememberShelfLife(product, eigenes.bestBefore);

  await pantry.addStockBatches(product.id, batches);
  // Gekauft und eingeräumt: Der Eintrag auf der Einkaufsliste hat sich erledigt.
  if (stockWishId) await pantry.removeWish(stockWishId);

  toast(`${product.name}: ${total} eingebucht`, true);
  stockTarget = null;
  stockWishId = null;
}

function toast(message, undoable = false) {
  clearTimeout(toastTimer);
  $('#toast-text').textContent = message;
  $('#toast-undo').hidden = !undoable;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('#toast').hidden = true;
  }, undoable ? 6000 : 3000);
}

// --- Scanner --------------------------------------------------------------

async function startScan() {
  const dialog = $('#dlg-scan');
  const hint = $('#scan-hint');
  hint.textContent = 'Kamera wird gestartet…';
  dialog.showModal();

  try {
    await scanner.start($('#scan-video'), (barcode) => handleScan(barcode, hint), {
      onStatus: (status) => {
        // Auf Geräten ohne eingebaute Erkennung wird die Bibliothek beim
        // ersten Scan nachgeladen. Ohne Rückmeldung wirkt die App in dem
        // Moment eingefroren.
        hint.textContent =
          status === 'preparing' ? 'Scanner wird vorbereitet…' : 'Barcode ins Bild halten…';
      },
      // Der weiße Rahmen ist nicht bloß Zierde: Sein Inhalt wird zuerst und
      // in voller Schärfe durchsucht.
      frameEl: $('.scan-frame'),
    });
  } catch (err) {
    hint.textContent = 'Kamera nicht verfügbar. Bitte den Zugriff erlauben.';
    console.error(err);
  }
}

function stopScan() {
  scanner.stop();
  $('#dlg-scan').close();
}

async function handleScan(barcode, hint) {
  const known = pantry.findByBarcode(barcode);

  if (known) {
    // Nicht stillschweigend einbuchen: Ohne Rückfrage ginge das
    // Haltbarkeitsdatum verloren, und genau beim Einräumen nach dem Einkauf
    // hat man die Packung in der Hand und kann es ablesen.
    navigator.vibrate?.(60);
    stopScan();
    openStockDialog(known, { fromScan: true });
    return;
  }

  navigator.vibrate?.([40, 60, 40]);
  hint.textContent = 'Unbekannt — wird nachgeschlagen…';
  const hit = await lookupBarcode(barcode);
  stopScan();

  const suggestion = suggestProduct(hit);

  /*
   * Steht dasselbe Produkt schon im Vorrat, nur ohne Barcode?
   *
   * Genau das passiert, wenn es über einen Bon hereinkam: Der Bon liefert
   * keine Barcodes. Ohne diesen Griff entstünde beim Scannen ein zweiter
   * Eintrag derselben Sache. Stattdessen bekommt der vorhandene den Barcode
   * -- ab dann wird er beim Scannen sofort gefunden.
   */
  const twin = findTwin(pantry.products(), suggestion, (product) => !product.barcode);
  if (twin) {
    await pantry.updateProduct(twin, { barcode });
    openStockDialog(twin, { fromScan: true });
    toast(`Barcode zu „${twin.name}“ ergänzt`);
    return;
  }

  openProductDialog(null, { name: suggestion.name, brand: suggestion.brand, barcode });
  if (!hit) toast('Produkt nicht in der Datenbank — bitte Namen eintragen');
}

// --- Prognosen zurücksetzen -----------------------------------------------

async function resetAllForecasts() {
  const products = pantry.products();
  if (!products.length) return;

  const buchungen = pantry.events().length;
  const bestaetigt = confirm(
    `Alle Verbrauchsbuchungen verwerfen?\n\n` +
      `${buchungen} Buchungen aus ${products.length} Produkten werden gelöscht, ` +
      `damit die App von vorn lernt.\n\n` +
      `Bestand, Haltbarkeitsdaten und Einkaufsliste bleiben unverändert. ` +
      `Rückgängig machen lässt sich das nicht.`,
  );
  if (!bestaetigt) return;

  const count = await pantry.resetAllForecasts();
  toast(`${plural(count, 'Prognose', 'Prognosen')} zurückgesetzt`);
}

// --- Marken nachtragen ----------------------------------------------------

/**
 * Produkte, denen die Marke fehlt, obwohl ein Barcode vorliegt.
 *
 * Alles, was vor Einführung des Markenfelds gescannt wurde, trägt sie
 * fest im Namen ("Baresa Tomaten passiert"). Ohne diesen Weg müsste man
 * jedes Produkt von Hand aufteilen.
 */
function backfillCandidates() {
  return pantry.products().filter((product) => product.barcode && !product.brand);
}

/**
 * Produkte, bei denen die Marke noch im Namen steckt.
 *
 * Betrifft alles, was vor dieser Fassung über einen Bon hereinkam: Dort gab
 * es kein eigenes Markenfeld, und "Gut&Günstig Frischkäse Natur" stand als
 * ein Stück im Namen.
 */
function brandSplitCandidates() {
  const known = brandsInUse(pantry.products());
  return pantry
    .products()
    .filter((product) => !String(product.brand ?? '').trim())
    .map((product) => ({ product, ...splitBrand(product.name, known) }))
    .filter((entry) => entry.brand);
}

function renderBrandSplit() {
  const candidates = brandSplitCandidates();
  $('#split-card').hidden = candidates.length === 0;
  if (!candidates.length) return;

  // Zwei Beispiele dazu: So sieht man, was gleich passiert, statt es zu ahnen.
  const beispiele = candidates
    .slice(0, 2)
    .map((entry) => `„${entry.brand}“ + „${entry.name}“`)
    .join(', ');
  $('#split-info').textContent =
    `Bei ${plural(candidates.length, 'Produkt', 'Produkten')} steckt die Marke noch im Namen — etwa ${beispiele}.`;
}

async function splitBrands() {
  const candidates = brandSplitCandidates();
  if (!candidates.length) return;

  const writes = candidates.map(({ product, brand, name }) => [
    'products',
    { ...product, brand, name },
  ]);
  await store.putMany(writes);
  toast(`Bei ${plural(candidates.length, 'Produkt', 'Produkten')} die Marke abgetrennt`);
}

/**
 * Zieht den Mindestbestand einmalig auf null.
 *
 * Bis Fassung 1.17 stand er beim Anlegen auf eins. Das schlägt aber schon
 * an, wenn noch genau eine Packung da ist -- bei einem frisch erfassten
 * Vorrat also bei fast allem gleichzeitig, und die Einkaufsliste war voll
 * mit Dingen, von denen noch etwas da war.
 *
 * Angefasst wird nur, was noch auf genau diesem alten Standardwert steht.
 * Wer bei den Nudeln bewusst drei eingetragen hat, behält seine drei -- eine
 * absichtlich gesetzte Schwelle stillschweigend niederzureißen wäre schlimmer
 * als ein Vorschlag zu viel.
 *
 * @returns {Promise<number>} wie viele Produkte geändert wurden
 */
async function migrateMinStock() {
  if (store.getSetting('minStockZeroed', false) === true) return 0;

  const betroffen = pantry.products().filter((product) => Number(product.minStock) === 1);
  if (betroffen.length) {
    await store.putMany(betroffen.map((product) => ['products', { ...product, minStock: 0 }]));
  }
  await store.setSetting('minStockZeroed', true);
  return betroffen.length;
}

/**
 * Zieht schon vergebene Schätzungen nach, wenn die Erfahrungswerte besser
 * geworden sind.
 *
 * Die Tabellen in `js/shelflife.js` und `js/categories.js` lernen mit jeder
 * Korrektur dazu -- "Bresso ist Frischkäse", "Kritharaki sind Nudeln". Ohne
 * diesen Schritt behielte eine einmal falsch geschätzte Charge ihr Datum für
 * immer, und gerade die zu lang geschätzten fallen niemandem auf: Die
 * Warnung bleibt einfach aus.
 *
 * Angefasst wird ausschließlich, was als Schätzung gekennzeichnet ist. Ein
 * von der Packung abgelesenes Datum ist unantastbar.
 */
const ESTIMATE_REVISION = 2;

async function refreshEstimates() {
  if (store.getSetting('estimateRevision', 0) >= ESTIMATE_REVISION) return 0;

  const writes = [];
  for (const lot of pantry.lots()) {
    if (!lot.estimated || !lot.bestBefore) continue;
    const product = pantry.product(lot.productId);
    if (!product) continue;
    // Ab dem Einbuchen gerechnet -- dasselbe Kaufdatum wie damals.
    const neu = guessBestBefore(product, lot.addedAt ? new Date(lot.addedAt) : new Date());
    if (neu && neu !== lot.bestBefore) writes.push(['lots', { ...lot, bestBefore: neu }]);
  }
  if (writes.length) await store.putMany(writes);
  await store.setSetting('estimateRevision', ESTIMATE_REVISION);
  return writes.length;
}

// --- Doppelte zusammenführen ----------------------------------------------

function renderMerge() {
  const groups = duplicateGroups(pantry.products());
  $('#merge-card').hidden = groups.length === 0;
  if (!groups.length) return;

  const beispiele = groups
    .slice(0, 2)
    .map(([keep]) => `„${[keep.brand, keep.name].filter(Boolean).join(' ')}“`)
    .join(', ');
  $('#merge-info').textContent =
    `${plural(groups.length, 'Produkt steht', 'Produkte stehen')} doppelt im Vorrat — ${beispiele}.`;
}

/**
 * Führt doppelte Produkte zusammen.
 *
 * Nichts geht dabei verloren: Chargen, Buchungen und Einkaufszettel-Einträge
 * werden auf den bleibenden Eintrag umgehängt, bevor der andere verschwindet.
 * Der Bestand ist danach die Summe, und die Prognose rechnet mit der
 * gemeinsamen Geschichte -- vorher hatte jede Hälfte nur ihre eigene.
 */
async function mergeDuplicates() {
  const groups = duplicateGroups(pantry.products());
  if (!groups.length) return;

  const mapping = { ...store.getSetting('receiptMap', {}) };
  const writes = [];
  const wegfallen = [];

  for (const [keep, ...others] of groups) {
    const ids = others.map((product) => product.id);
    wegfallen.push(...ids);

    for (const lot of pantry.lots()) {
      if (ids.includes(lot.productId)) writes.push(['lots', { ...lot, productId: keep.id }]);
    }
    for (const event of pantry.events()) {
      if (ids.includes(event.productId)) writes.push(['events', { ...event, productId: keep.id }]);
    }
    for (const wish of store.all('wishes')) {
      if (ids.includes(wish.productId)) writes.push(['wishes', { ...wish, productId: keep.id }]);
    }
    writes.push(['products', mergedProduct(keep, others)]);

    // Gemerkte Bon-Zuordnungen dürfen nicht ins Leere zeigen.
    for (const [text, productId] of Object.entries(mapping)) {
      if (ids.includes(productId)) mapping[text] = keep.id;
    }
  }

  await store.putMany(writes);
  for (const id of wegfallen) await store.remove('products', id);
  await store.setSetting('receiptMap', mapping);
  toast(`${plural(groups.length, 'Produkt', 'Produkte')} zusammengeführt`);
}

function renderBackfill() {
  const candidates = backfillCandidates();
  $('#backfill-card').hidden = candidates.length === 0;
  if (candidates.length) {
    $('#backfill-info').textContent =
      `${plural(candidates.length, 'Produkt hat', 'Produkte haben')} einen Barcode, aber keine Marke.`;
  }
}

async function backfillBrands() {
  const candidates = backfillCandidates();
  if (!candidates.length) return;

  const button = $('#btn-backfill');
  button.disabled = true;
  let updated = 0;

  try {
    for (const [index, product] of candidates.entries()) {
      button.textContent = `Suche… (${index + 1}/${candidates.length})`;
      const hit = await lookupBarcode(product.barcode);
      const brand = hit?.brand?.trim();
      if (!brand) continue;

      // Nur ergänzen, nie ersetzen: Der Name behält alles außer der
      // vorangestellten Marke, damit eigene Zusätze erhalten bleiben.
      await pantry.updateProduct(product, {
        brand,
        name: stripBrand(product.name, brand),
      });
      updated += 1;
    }

    toast(
      updated
        ? `${plural(updated, 'Marke', 'Marken')} nachgetragen`
        : 'Keine Marken gefunden — bitte von Hand eintragen',
    );
  } finally {
    button.disabled = false;
    button.textContent = 'Jetzt nachtragen';
  }
}

// --- Bon einlesen ---------------------------------------------------------

/**
 * Ab dieser Passung wird ein vorhandenes Produkt vorgeschlagen.
 *
 * Darunter wird lieber ein neues angelegt: Ein falsch zugeordneter Einkauf
 * verdirbt die Prognose zweier Produkte auf einmal -- des getroffenen und
 * des gemeinten. Ein Produkt zu viel ist in einem Wisch gelöscht.
 */
const RECEIPT_MATCH = 0.7;

/** Was der Bon zuletzt ergeben hat, zwischen Prüfen und Einbuchen. */
let receiptDraft = null;

/**
 * Sucht zu einer Bon-Zeile das passende Produkt.
 *
 * Zuerst wird nachgesehen, ob dieselbe Bezeichnung schon einmal zugeordnet
 * wurde -- eine bestätigte Zuordnung schlägt jedes Raten. Deshalb muss man
 * das nur beim ersten Einkauf durchgehen.
 */
function matchReceiptItem(item, mapping) {
  const key = normalize(item.name);
  const remembered = mapping[key];
  if (remembered && pantry.product(remembered)) return { productId: remembered, sure: true };

  /*
   * Zuerst der Wortvergleich, erst danach die Suche.
   *
   * Dasselbe Produkt schreibt sich auf zwei Wegen verschieden -- gescannt
   * "Frischkäse Natur 300g" mit Marke "Gut & Günstig", vom Bon
   * "Gut&Günstig Frischkäse Natur 300 g". Die Suche findet das nicht: Sie
   * verzeiht Tippfehler in einem kurzen Suchwort, nicht abweichende
   * Schreibweisen in einem langen Namen. Ohne diesen Schritt entstand bei
   * jedem Bon ein zweiter Eintrag derselben Sache.
   */
  const geteilt = splitBrand(suggestedName(item), brandsInUse(pantry.products()));
  const twin = findTwin(pantry.products(), geteilt);
  if (twin) return { productId: twin.id, sure: true };

  const [best] = pantry.search(suggestedName(item));
  const fallback = best ?? pantry.search(item.name)[0];
  if (fallback && fallback.score >= RECEIPT_MATCH) {
    return { productId: fallback.product.id, sure: false };
  }
  return { productId: null, sure: false };
}

function receiptRow(entry, index) {
  const row = el('li', 'receipt-row');

  const take = el('input');
  take.type = 'checkbox';
  take.checked = entry.take;
  take.setAttribute('aria-label', `${entry.item.name} einbuchen`);
  take.addEventListener('change', () => {
    entry.take = take.checked;
    row.classList.toggle('is-off', !take.checked);
    updateReceiptButton();
  });

  // Genau so, wie es nachher im Vorrat steht -- mit der Marke klein darüber.
  // Wer hier etwas Falsches sieht, kann es vor dem Buchen noch abwählen.
  const label = el('div', 'receipt-name');
  const geteilt = splitBrand(suggestedName(entry.item), brandsInUse(pantry.products()));
  labelInto(label, geteilt.name, geteilt.brand);
  if (entry.item.qty > 1) {
    label.lastChild.appendChild(el('span', 'receipt-qty', ` ×${entry.item.qty}`));
  }

  // Wohin gebucht wird. Eine Auswahlliste statt einer Suche: Sie öffnet auf
  // dem Handy die Systemauswahl, und die ist mit einer Hand bedienbar.
  const target = el('select');
  target.id = `receipt-target-${index}`;
  target.setAttribute('aria-label', `Ziel für ${entry.item.name}`);
  const neu = el('option', null, 'Neu anlegen');
  neu.value = '';
  target.appendChild(neu);
  for (const product of pantry.products()) {
    const option = el('option', null, product.name);
    option.value = product.id;
    target.appendChild(option);
  }
  target.value = entry.productId ?? '';
  target.classList.toggle('is-new', !entry.productId);
  target.addEventListener('change', () => {
    entry.productId = target.value || null;
    entry.chosen = true;
    target.classList.toggle('is-new', !entry.productId);
  });

  // Was die App an Haltbarkeit annimmt, gehört vor das Buchen -- sonst
  // merkt man einen Fehlgriff erst, wenn die Warnung zu früh oder zu spät
  // kommt.
  const bis = receiptBestBefore(entry);
  // Mit Jahr: "MHD ~ 5.8." sähe bei einem Datum in zwei Jahren aus wie
  // der Liefertag selbst.
  if (bis) label.appendChild(el('span', 'receipt-bb', ` · MHD ~ ${formatDateLong(bis)}`));

  row.classList.toggle('is-off', !entry.take);
  row.append(take, label, target);
  return row;
}

/**
 * Das geschätzte Haltbarkeitsdatum einer Bon-Zeile.
 *
 * Für ein schon vorhandenes Produkt zählt, was dafür gelernt wurde; für ein
 * neues muss die Schätzung aus Name und Fach kommen, das Produkt gibt es ja
 * noch nicht.
 */
function receiptBestBefore(entry) {
  const from = receiptDraft?.bon?.date ? new Date(receiptDraft.bon.date) : new Date();
  const vorhanden = entry.productId ? pantry.product(entry.productId) : null;
  if (vorhanden) return guessBestBefore(vorhanden, from);
  const geteilt = splitBrand(suggestedName(entry.item), brandsInUse(pantry.products()));
  return guessBestBefore({ name: geteilt.name, brand: geteilt.brand }, from);
}

/**
 * Der Knopf sagt, was gleich passiert.
 *
 * Abwählen soll sichtbar wirken -- sonst weiß man nach dem Durchsehen nicht,
 * ob man wirklich etwas verändert hat.
 */
function updateReceiptButton() {
  const button = $('#receipt-book');
  const gewaehlt = (receiptDraft?.entries ?? []).filter((e) => e.take);
  const packungen = gewaehlt.reduce((sum, e) => sum + e.item.qty, 0);
  button.disabled = packungen === 0;
  button.textContent = packungen === 0
    ? 'Nichts ausgewählt'
    : `${plural(packungen, 'Packung', 'Packungen')} einbuchen`;
}

function openReceipt(text) {
  const bon = parseReceipt(text);
  const hint = $('#receipt-hint');

  if (!bon.items.length) {
    hint.textContent =
      'Daraus konnte ich keine Artikel lesen. Ist der ganze Bon kopiert — von „Dein Bon“ bis unten?';
    hint.classList.add('is-warn');
    return;
  }

  const seen = store.getSetting('receiptOrders', []);
  const mapping = store.getSetting('receiptMap', {});
  const entries = bon.items.map((item) => ({
    item,
    take: true,
    chosen: false,
    ...matchReceiptItem(item, mapping),
  }));
  receiptDraft = { bon, entries };

  $('#receipt-title').textContent = bon.date
    ? `Lieferung vom ${formatDateLong(bon.date)}`
    : 'Bon einlesen';

  const known = bon.orderNo && seen.includes(bon.orderNo);
  const neue = entries.filter((e) => !e.productId).length;
  $('#receipt-note').textContent = known
    ? 'Diesen Bon hast du schon einmal eingebucht — noch einmal, und alles zählt doppelt.'
    : `${plural(entries.length, 'Artikel', 'Artikel')}, davon ${neue} noch nicht im Vorrat. Bitte kurz durchsehen.`;
  $('#receipt-note').classList.toggle('is-warn', known);

  $('#receipt-list').replaceChildren(...entries.map(receiptRow));
  updateReceiptButton();
  hint.textContent = '';
  hint.classList.remove('is-warn');
  $('#dlg-receipt').showModal();
}

/**
 * Bucht ein, was ausgewählt ist.
 *
 * Ohne Haltbarkeitsdatum: Das steht auf der Packung und nicht im Bon, und
 * zwanzig Abfragen hintereinander wäre keine Erleichterung. Es lässt sich
 * hinterher im Vorrat je Produkt nachtragen -- darauf weist der Hinweis am
 * Ende hin.
 */
async function bookReceipt() {
  if (!receiptDraft) return;
  const { bon, entries } = receiptDraft;
  const mapping = { ...store.getSetting('receiptMap', {}) };

  // Alles mitschreiben, was dieser Bon angerichtet hat. Nur so lässt er sich
  // später in einem Zug zurücknehmen, statt zwanzig Zeilen von Hand.
  const spur = {
    orderNo: bon.orderNo,
    date: bon.date,
    at: new Date().toISOString(),
    lots: [],
    events: [],
    products: [],
    keys: [],
    packs: 0,
  };

  let angelegt = 0;
  for (const entry of entries) {
    if (!entry.take) continue;
    let productId = entry.productId;
    if (!productId) {
      // Die Marke steht auf dem Bon vorn im Namen. Getrennt gehalten, steht
      // sie im Vorrat klein darüber -- wie bei allem Gescannten auch.
      const { brand, name } = splitBrand(suggestedName(entry.item), brandsInUse(pantry.products()));
      const product = await pantry.createProduct({ name, brand });
      productId = product.id;
      spur.products.push(product.id);
      angelegt++;
    }
    // Ab dem Lieferdatum gerechnet, nicht ab heute: Wer den Bon erst drei
    // Tage später einliest, bekommt sonst drei Tage geschenkt.
    const product = pantry.product(productId);
    const bestBefore = guessBestBefore(product, bon.date ? new Date(bon.date) : new Date());
    const lots = await pantry.addStock(productId, entry.item.qty, bestBefore, Boolean(bestBefore));
    const lot = Array.isArray(lots) ? lots[0] : lots;
    if (lot) {
      spur.lots.push(lot.id);
      // Die Einkaufsbuchung hängt an der ersten Charge und ist darüber
      // eindeutig wiederzufinden.
      const event = pantry.events().find((e) => e.type === 'purchase' && e.lotId === lot.id);
      if (event) spur.events.push(event.id);
    }
    // Die Zuordnung merken -- beim nächsten Bon läuft diese Zeile durch.
    const key = normalize(entry.item.name);
    mapping[key] = productId;
    spur.keys.push(key);
    spur.packs += entry.item.qty;
  }

  await store.setSetting('receiptMap', mapping);
  if (bon.orderNo) {
    const seen = store.getSetting('receiptOrders', []);
    // Nur die letzten Bons merken; die Liste soll nicht ewig wachsen.
    await store.setSetting('receiptOrders', [...seen.filter((n) => n !== bon.orderNo), bon.orderNo].slice(-30));
  }
  await store.setSetting('lastImport', spur);

  $('#dlg-receipt').close();
  $('#receipt-input').value = '';
  receiptDraft = null;
  $('#receipt-hint').textContent = angelegt
    ? `${plural(angelegt, 'Produkt', 'Produkte')} neu angelegt. Haltbarkeitsdaten kannst du im Vorrat nachtragen.`
    : 'Haltbarkeitsdaten kannst du im Vorrat nachtragen.';
  toast(`${plural(spur.packs, 'Packung', 'Packungen')} eingebucht`);
}

/**
 * Nimmt den zuletzt eingelesenen Bon vollständig zurück.
 *
 * Der Fall dahinter: Beim Kopieren ist eine Zeile abhandengekommen, und man
 * merkt es erst hinterher. Ohne diesen Weg müsste man zwanzig Chargen einzeln
 * wieder löschen und die neu angelegten Produkte hinterher auch noch.
 *
 * Zurückgenommen wird nur, was dieser Bon selbst angelegt hat. Ein Produkt,
 * das inzwischen anderswoher Bestand oder Buchungen hat, bleibt stehen --
 * es gehört nicht mehr allein zu diesem Bon.
 */
async function undoLastImport() {
  const spur = store.getSetting('lastImport', null);
  if (!spur) return;

  // Einmal nachfragen: Ein Fehlgriff kostete zwanzig Buchungen, und einen
  // Weg zurück gibt es dafür nicht -- nur den Bon noch einmal einzulesen.
  const bestaetigt = confirm(
    `${plural(spur.packs ?? 0, 'Packung', 'Packungen')} wieder ausbuchen?\n\n` +
      'Was dieser Bon angelegt hat, wird entfernt. Was du seitdem verbraucht ' +
      'oder von Hand geändert hast, bleibt.',
  );
  if (!bestaetigt) return;

  // In einem Zug schreiben statt vierzig Mal: Sonst zeichnet sich die App
  // bei jedem einzelnen Löschen neu.
  const writes = [];
  for (const id of spur.lots ?? []) {
    const lot = store.byId('lots', id);
    if (lot) writes.push(['lots', { ...lot, deleted: true }]);
  }
  for (const id of spur.events ?? []) {
    const event = store.byId('events', id);
    if (event) writes.push(['events', { ...event, deleted: true }]);
  }
  if (writes.length) await store.putMany(writes);

  for (const id of spur.products ?? []) {
    const hatChargen = pantry.lots().some((l) => l.productId === id);
    const hatBuchungen = pantry.events().some((e) => e.productId === id);
    if (!hatChargen && !hatBuchungen) await pantry.deleteProduct(id);
  }

  // Zuordnungen, die jetzt ins Leere zeigen, mitnehmen.
  const mapping = { ...store.getSetting('receiptMap', {}) };
  for (const key of spur.keys ?? []) {
    if (mapping[key] && !pantry.product(mapping[key])) delete mapping[key];
  }
  await store.setSetting('receiptMap', mapping);

  if (spur.orderNo) {
    const seen = store.getSetting('receiptOrders', []);
    await store.setSetting('receiptOrders', seen.filter((n) => n !== spur.orderNo));
  }
  await store.setSetting('lastImport', null);

  $('#receipt-hint').textContent = '';
  $('#receipt-hint').classList.remove('is-warn');
  toast(`${plural(spur.packs ?? 0, 'Packung', 'Packungen')} wieder ausgebucht`);
}

/** Die Zeile "Zuletzt eingelesen" mitsamt dem Knopf zum Zurücknehmen. */
function renderLastImport() {
  const spur = store.getSetting('lastImport', null);
  const box = $('#receipt-last');
  box.hidden = !spur;
  if (!spur) return;
  const wann = spur.date ? `Lieferung vom ${formatDateLong(spur.date)}` : 'Zuletzt eingelesen';
  $('#receipt-last-text').textContent = `${wann} — ${plural(spur.packs ?? 0, 'Packung', 'Packungen')} eingebucht.`;
}

// --- Datensicherung -------------------------------------------------------

/**
 * Legt eine Sicherung ab.
 *
 * Auf dem iPhone führt der übliche Weg -- ein Link mit `download` -- in einer
 * vom Startbildschirm gestarteten App oft ins Leere: Die Datei landet
 * bestenfalls kommentarlos irgendwo, schlimmstenfalls passiert gar nichts.
 * Deshalb zuerst das Teilen-Menü, das dort zu Hause ist: Ablage in "Dateien",
 * an sich selbst schicken, in die Wolke legen -- die Wahl bleibt beim Nutzer,
 * und man sieht, dass etwas passiert ist.
 *
 * @returns {Promise<boolean>} ob die Sicherung wirklich abgelegt wurde
 */
async function exportBackup() {
  const json = store.export();
  const name = `kuechenvorrat-${new Date().toISOString().slice(0, 10)}.json`;

  const file = typeof File === 'function' ? new File([json], name, { type: 'application/json' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Küchenvorrat — Sicherung' });
      return true;
    } catch (err) {
      // Abgebrochen ist kein Fehler, aber auch keine Sicherung.
      if (err?.name === 'AbortError') return false;
      // Alles andere: unten den gewöhnlichen Weg versuchen.
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Sichern und das Ergebnis vermerken -- daran hängt die Erinnerung. */
async function runBackup() {
  const done = await exportBackup();
  if (!done) return;
  await store.setSetting('lastBackupAt', new Date().toISOString());
  await store.setSetting('backupRemindAfter', null);
  toast('Sicherung abgelegt');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !data.products) {
      toast('Das sieht nicht nach einer Sicherung aus');
      return;
    }
    const merge = confirm(
      'Mit den vorhandenen Daten zusammenführen?\n\n' +
        'OK = zusammenführen (nichts geht verloren)\n' +
        'Abbrechen = vorhandene Daten ersetzen',
    );
    if (merge) await store.merge(data);
    else await store.replaceAll(data);
    toast(merge ? 'Sicherung zusammengeführt' : 'Sicherung eingelesen');
  } catch (err) {
    console.error(err);
    toast('Datei konnte nicht gelesen werden');
  }
}

// --- Verdrahtung ----------------------------------------------------------

function switchView(view) {
  activeView = view;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  }
  for (const section of document.querySelectorAll('.view')) {
    section.hidden = section.id !== `view-${view}`;
  }
}

function wire() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  }

  $('#search').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderPantry();
  });

  // Schon beim Tippen zeigen, ob davon noch etwas da ist -- danach im Laden
  // zu stehen und es erst dort zu merken, hilft niemandem.
  $('#wish-input').addEventListener('input', (e) => renderWishHint(e.target.value));

  $('#clear-done').addEventListener('click', async () => {
    const count = await pantry.clearDoneWishes();
    if (count) toast(`${plural(count, 'Eintrag', 'Einträge')} weggeräumt`);
  });

  // Vor dem Einkauf in einem Zug alles übernehmen, was die App vorschlägt.
  $('#accept-all').addEventListener('click', async () => {
    const items = pantry.shoppingList();
    for (const item of items) await pantry.acceptSuggestion(item.product);
    if (items.length) toast(`${plural(items.length, 'Vorschlag', 'Vorschläge')} übernommen`);
  });
  $('#wish-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#wish-input').value.trim();
    if (!text) return;

    // "3 Milch" heißt drei Packungen -- die Zahl gehört nicht in den Namen.
    const { qty, text: label } = Pantry.parseQuantity(text);
    // Den besten Treffer verknüpfen, damit die Zeile den Bestand kennt.
    const [best] = pantry.search(label);
    await pantry.addWish(label, best?.product.id ?? null, qty);

    $('#wish-input').value = '';
    renderWishHint('');
  });

  fillCategorySelect();
  $('#product-category').addEventListener('change', syncCategoryHint);
  $('#product-name').addEventListener('input', syncCategoryHint);
  $('#product-brand').addEventListener('input', syncCategoryHint);

  $('#btn-add').addEventListener('click', () => openProductDialog());
  $('#btn-scan').hidden = !isScanSupported();
  $('#btn-scan').addEventListener('click', startScan);
  $('#scan-close').addEventListener('click', stopScan);
  $('#dlg-scan').addEventListener('close', () => scanner.stop());
  $('#dlg-scan').addEventListener('cancel', () => scanner.stop());

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  // Merken, dass die Detailansicht zu ist -- sonst würde sie bei jeder
  // späteren Änderung im Hintergrund weitergezeichnet.
  $('#dlg-detail').addEventListener('close', () => {
    detailProductId = null;
  });

  $('#form-product').addEventListener('submit', async (e) => {
    const name = $('#product-name').value.trim();
    if (!name) {
      e.preventDefault();
      return;
    }
    const brand = $('#product-brand').value.trim();
    const minStock = Number($('#product-min').value) || 0;
    const barcode = $('#product-barcode').value.trim() || null;
    const suggest = $('#product-suggest').checked;
    const category = $('#product-category').value || null;

    if (editingProduct) {
      await pantry.updateProduct(editingProduct, { name, brand, minStock, barcode, suggest, category });
      toast(`${name} gespeichert`);
    } else {
      const product = await pantry.createProduct({ name, brand, minStock, barcode, suggest, category });
      const initial = Number($('#product-stock').value) || 0;
      if (initial > 0) await pantry.addStock(product.id, initial, $('#product-bb').value || null);
      if (productWishId) await pantry.removeWish(productWishId);
      toast(`${name} angelegt`);
    }
    editingProduct = null;
    productWishId = null;
  });

  $('#stock-qty').addEventListener('input', syncStockDialog);
  $('#stock-split').addEventListener('change', syncStockDialog);
  $('#form-stock').addEventListener('submit', submitStockDialog);

  // Beim Einräumen scannt man mehrere Sachen hintereinander -- dieser Weg
  // führt nach dem Einbuchen direkt zurück vor die Kamera.
  $('#stock-again').addEventListener('click', async () => {
    await submitStockDialog();
    $('#dlg-stock').close();
    startScan();
  });

  $('#form-lot').addEventListener('submit', async () => {
    if (!lotTarget) return;
    const bestBefore = $('#lot-bb').value || null;
    const qty = Number($('#lot-qty').value) || lotTarget.qty;

    if (qty >= lotTarget.qty) await pantry.setLotExpiry(lotTarget.id, bestBefore);
    else await pantry.splitLot(lotTarget.id, qty, bestBefore);

    toast('Haltbarkeit gespeichert', true);
    lotTarget = null;
  });

  $('#lot-discard').addEventListener('click', async () => {
    if (!lotTarget) return;
    const count = lotTarget.qty;
    await pantry.discardLot(lotTarget.id);
    $('#dlg-lot').close();
    // Als Entsorgung gebucht, damit die Prognose nicht fälschlich steigt.
    toast(`${plural(count, 'Packung', 'Packungen')} entsorgt`, true);
    lotTarget = null;
  });

  $('#toast-undo').addEventListener('click', async () => {
    if (await pantry.undo()) toast('Rückgängig gemacht');
    else $('#toast').hidden = true;
  });

  $('#setting-lead').addEventListener('change', (e) => {
    store.setSetting('leadDays', Math.max(0, Number(e.target.value) || 0));
  });
  $('#setting-expiry').addEventListener('change', (e) => {
    store.setSetting('expiryWarnDays', Math.max(0, Number(e.target.value) || 0));
  });

  $('#setting-estimate').addEventListener('change', (e) => {
    store.setSetting('estimateExpiry', e.target.checked);
  });

  $('#setting-badge').addEventListener('change', async (e) => {
    const wanted = e.target.checked;
    // Fragen darf man nur, solange der Tipp der Nutzerin noch nachwirkt --
    // hier, im Handler des Schalters, ist der richtige Augenblick.
    if (wanted) await askNotificationPermission();
    // Beim nächsten Durchlauf soll wirklich gesetzt werden, auch wenn Zahl
    // und Schalterstellung sich sonst nicht geändert hätten.
    lastBadge = null;
    await store.setSetting('badgeEnabled', wanted);
  });

  $('#btn-receipt').addEventListener('click', () => openReceipt($('#receipt-input').value));
  $('#receipt-book').addEventListener('click', bookReceipt);
  $('#btn-receipt-clear').addEventListener('click', () => {
    $('#receipt-input').value = '';
    $('#receipt-hint').textContent = '';
    $('#receipt-hint').classList.remove('is-warn');
    $('#receipt-input').focus();
  });
  $('#receipt-undo').addEventListener('click', undoLastImport);

  $('#btn-reset-forecasts').addEventListener('click', resetAllForecasts);
  $('#btn-backfill').addEventListener('click', backfillBrands);
  $('#btn-split').addEventListener('click', splitBrands);
  $('#btn-merge').addEventListener('click', mergeDuplicates);
  $('#btn-export').addEventListener('click', runBackup);
  $('#backup-now').addEventListener('click', runBackup);
  $('#backup-later').addEventListener('click', async () => {
    // Nicht abschalten, nur vertagen: Der Grund für die Erinnerung besteht
    // ja weiter.
    await store.setSetting('backupRemindAfter', snoozeUntil());
  });
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    if (file) await importBackup(file);
    e.target.value = '';
  });
}

async function main() {
  await store.init();

  // Vor dem ersten Zeichnen und vor dem Abonnement: So läuft die Umstellung
  // genau einmal durch, ohne dass die Liste dabei zweimal aufgebaut wird.
  const gesenkt = await migrateMinStock();
  const nachgezogen = await refreshEstimates();

  store.subscribe(render);

  $('#app-version').textContent = APP_VERSION;
  $('#setting-lead').value = String(store.getSetting('leadDays', DEFAULT_SETTINGS.leadDays));
  $('#setting-expiry').value = String(
    store.getSetting('expiryWarnDays', DEFAULT_SETTINGS.expiryWarnDays),
  );
  $('#setting-estimate').checked = store.getSetting('estimateExpiry', true) !== false;
  $('#setting-badge').checked = store.getSetting('badgeEnabled', false) === true;
  $('#setting-badge').disabled = !supportsBadge();

  wire();
  switchView(activeView);
  render();

  // Nicht stillschweigend: Eine Änderung am eigenen Bestand soll man
  // mitbekommen, auch wenn man sie selbst veranlasst hat.
  if (gesenkt) {
    toast(`Mindestbestand bei ${plural(gesenkt, 'Produkt', 'Produkten')} auf 0 gesetzt`);
  } else if (nachgezogen) {
    toast(`Haltbarkeit bei ${plural(nachgezogen, 'Charge', 'Chargen')} neu geschätzt`);
  }

  /*
   * Beim Zuklappen noch einmal nachrechnen.
   *
   * Die Zahl auf dem Symbol bleibt genau so stehen, wie sie in diesem
   * Augenblick war -- bis die App wieder geöffnet wird. Ist die letzte
   * Buchung eine Minute her, wäre sonst der Stand von davor eingefroren.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastBadge = null;
      syncAppBadge();
    }
  });

  // Gleich beim Start, aber ohne den ersten Aufbau aufzuhalten: Der Browser
  // entscheidet still, und die Antwort steht danach unter "Mehr".
  requestPersistence().then(renderStorageState);

  setupServiceWorker();
}

/**
 * Registriert den Service Worker und sorgt dafür, dass eine neue Fassung
 * ohne Zutun ankommt.
 *
 * Ohne das hier bekäme man ein Update erst beim übernächsten Start: Der
 * Worker liefert zuerst aus dem Cache und holt das Neue nur im Hintergrund.
 * Für den Offline-Betrieb ist das richtig, als Update-Weg zu umständlich --
 * erst recht auf dem Handy, wo eine App selten wirklich beendet wird.
 */
function setupServiceWorker() {
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
    .then((registration) => {
      // Von sich aus sieht der Browser nur alle paar Stunden nach.
      registration.update().catch(() => {});
    })
    .catch(() => {
      /* Offline-Betrieb ist ein Extra, kein Muss. */
    });
}

main();
