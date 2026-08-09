/**
 * Oberfläche.
 *
 * Hält keine eigene Wahrheit: Jede Änderung geht in den Store, der Store
 * meldet sich zurück, und daraufhin wird neu gezeichnet. Dadurch kann die
 * Anzeige nicht vom gespeicherten Bestand abweichen.
 */

import { Store, LocalStorageAdapter } from './storage.js';
import { Pantry, DEFAULT_SETTINGS, stockOf, lotsFor, daysUntil } from './model.js';
import { BarcodeScanner, isScanSupported, lookupBarcode, stripBrand, suggestProduct } from './barcode.js';
import { stockAnswer } from './search.js';
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
export const APP_VERSION = '1.10.0';

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
  renderBackfill();
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
    parts.push(`MHD ${relativeDays(expiry.days)}`);
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
          `${relativeDays(days)} · ${formatDateLong(lot.bestBefore)}`,
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
    ? `${plural(products, 'Produkt', 'Produkte')}, ${plural(events, 'Buchung', 'Buchungen')} gespeichert.`
    : 'Noch nichts gespeichert.';
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
          lot.bestBefore ? `bis ${formatDateLong(lot.bestBefore)}` : 'ohne Datum',
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
  $('#product-min').value = String(product?.minStock ?? 1);
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
    ? `${plural(lot.qty, 'Packung', 'Packungen')}, haltbar bis ${formatDateLong(lot.bestBefore)}`
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
  $('#stock-bb').value = '';
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
    await scanner.start(
      $('#scan-video'),
      (barcode) => handleScan(barcode, hint),
      (status) => {
        // Auf Geräten ohne eingebaute Erkennung wird die Bibliothek beim
        // ersten Scan nachgeladen. Ohne Rückmeldung wirkt die App in dem
        // Moment eingefroren.
        hint.textContent =
          status === 'preparing' ? 'Scanner wird vorbereitet…' : 'Barcode ins Bild halten…';
      },
    );
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

// --- Datensicherung -------------------------------------------------------

function exportBackup() {
  const blob = new Blob([store.export()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kuechenvorrat-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Sicherung gespeichert');
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

  $('#btn-reset-forecasts').addEventListener('click', resetAllForecasts);
  $('#btn-backfill').addEventListener('click', backfillBrands);
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    if (file) await importBackup(file);
    e.target.value = '';
  });
}

async function main() {
  await store.init();
  store.subscribe(render);

  $('#app-version').textContent = APP_VERSION;
  $('#setting-lead').value = String(store.getSetting('leadDays', DEFAULT_SETTINGS.leadDays));
  $('#setting-expiry').value = String(
    store.getSetting('expiryWarnDays', DEFAULT_SETTINGS.expiryWarnDays),
  );

  wire();
  switchView(activeView);
  render();

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
