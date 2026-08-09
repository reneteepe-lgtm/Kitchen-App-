/**
 * Oberfläche.
 *
 * Hält keine eigene Wahrheit: Jede Änderung geht in den Store, der Store
 * meldet sich zurück, und daraufhin wird neu gezeichnet. Dadurch kann die
 * Anzeige nicht vom gespeicherten Bestand abweichen.
 */

import { Store, LocalStorageAdapter } from './storage.js';
import { Pantry, DEFAULT_SETTINGS, stockOf, lotsFor, daysUntil } from './model.js';
import { BarcodeScanner, isScanSupported, lookupBarcode, suggestName } from './barcode.js';
import {
  describeForecast,
  describeRate,
  formatDate,
  formatDateLong,
  relativeDays,
  humanDuration,
  plural,
} from './format.js';

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
}

function matchesSearch(product) {
  if (!searchTerm) return true;
  return product.name.toLowerCase().includes(searchTerm);
}

/** Eine Zeile mit Bestand, Prognose und den beiden Buchungsknöpfen. */
function pantryRow(assessment) {
  const { product, stock } = assessment;
  const forecast = describeForecast(assessment);
  const row = el('li', 'item');

  const main = el('button', 'item-main');
  main.appendChild(el('span', 'item-name', product.name));

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
  const items = pantry.assessAll().filter((a) => matchesSearch(a.product));

  list.replaceChildren(...items.map(pantryRow));
  $('#pantry-empty').hidden = items.length > 0;
  if (searchTerm && items.length === 0) {
    $('#pantry-empty').textContent = 'Nichts gefunden.';
  } else {
    $('#pantry-empty').innerHTML =
      'Noch nichts erfasst.<br />Leg oben rechts das erste Produkt an oder scanne einen Barcode.';
  }
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

function renderShopping() {
  const list = $('#shopping-list');
  const items = pantry.shoppingList();

  list.replaceChildren(
    ...items.map((item) => {
      const row = el('li', 'item');
      const main = el('button', 'item-main');
      main.appendChild(el('span', 'item-name', item.product.name));

      const tone = item.need.urgency === 3 ? 'empty' : item.need.urgency === 2 ? 'urgent' : 'soon';
      main.appendChild(el('span', `item-note tone-${tone}`, shoppingReason(item)));
      main.addEventListener('click', () => openDetail(item.product.id));

      const buy = el('button', 'step step-plus', '+');
      buy.title = 'Gekauft und eingebucht';
      buy.setAttribute('aria-label', `${item.product.name} einbuchen`);
      buy.addEventListener('click', () => openStockDialog(item.product));

      row.append(main, buy);
      return row;
    }),
  );
  $('#shopping-empty').hidden = items.length > 0;
}

function renderExpiry() {
  const list = $('#expiry-list');
  const items = pantry.expiringSoon();

  list.replaceChildren(
    ...items.map(({ lot, product, days }) => {
      const row = el('li', 'item');
      const main = el('button', 'item-main');
      main.appendChild(el('span', 'item-name', product.name));
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
  const shopping = pantry.shoppingList().length;
  const expiry = pantry.expiringSoon().length;

  const badgeShopping = $('#badge-shopping');
  badgeShopping.textContent = String(shopping);
  badgeShopping.hidden = shopping === 0;

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

function openDetail(productId) {
  const product = store.byId('products', productId);
  if (!product) return;

  const assessment = pantry.assess(product);
  const body = $('#detail-body');
  body.replaceChildren();

  const head = el('div', 'detail-head');
  head.appendChild(el('h2', null, product.name));
  head.appendChild(
    el('p', 'detail-sub', `${assessment.stock} im Vorrat · Mindestbestand ${product.minStock}`),
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
    for (const lot of lots) {
      const days = lot.bestBefore ? daysUntil(lot.bestBefore) : null;
      const cls =
        days === null ? 'lot-row' : days < 0 ? 'lot-row is-expired' : days <= 5 ? 'lot-row is-soon' : 'lot-row';
      const row = el('div', cls);
      row.appendChild(el('span', null, plural(lot.qty, 'Packung', 'Packungen')));
      row.appendChild(
        el('span', null, lot.bestBefore ? `MHD ${formatDateLong(lot.bestBefore)}` : 'ohne MHD'),
      );
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
  $('#dlg-detail').showModal();
}

// --- Dialoge --------------------------------------------------------------

let editingProduct = null;

function openProductDialog(product = null, prefill = {}) {
  editingProduct = product;
  $('#product-title').textContent = product ? 'Produkt bearbeiten' : 'Produkt anlegen';
  $('#product-name').value = product?.name ?? prefill.name ?? '';
  $('#product-min').value = String(product?.minStock ?? 1);
  $('#product-barcode').value = product?.barcode ?? prefill.barcode ?? '';
  // Beim Bearbeiten wäre ein zweites Bestandsfeld neben der Inventur verwirrend.
  $('#product-initial').hidden = !!product;
  $('#product-stock').value = String(prefill.stock ?? 1);
  $('#dlg-product').showModal();
  if (!product) setTimeout(() => $('#product-name').focus(), 50);
}

let stockTarget = null;

function openStockDialog(product) {
  stockTarget = product;
  $('#stock-title').textContent = `${product.name} einbuchen`;
  $('#stock-qty').value = '1';
  $('#stock-bb').value = '';
  $('#dlg-stock').showModal();
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
  hint.textContent = 'Barcode ins Bild halten…';
  dialog.showModal();

  try {
    await scanner.start($('#scan-video'), (barcode) => handleScan(barcode, hint));
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
    // Bekanntes Produkt: direkt einbuchen, ohne den Scanner zu verlassen --
    // beim Einräumen scannt man mehrere Sachen hintereinander.
    await pantry.addStock(known.id, 1);
    hint.textContent = `${known.name}: eingebucht (${stockOf(pantry.lots(), known.id)} da)`;
    navigator.vibrate?.(60);
    return;
  }

  navigator.vibrate?.([40, 60, 40]);
  hint.textContent = 'Unbekannt — wird nachgeschlagen…';
  const hit = await lookupBarcode(barcode);
  stopScan();

  openProductDialog(null, { name: suggestName(hit), barcode });
  if (!hit) toast('Produkt nicht in der Datenbank — bitte Namen eintragen');
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
    searchTerm = e.target.value.trim().toLowerCase();
    renderPantry();
  });

  $('#btn-add').addEventListener('click', () => openProductDialog());
  $('#btn-scan').hidden = !isScanSupported();
  $('#btn-scan').addEventListener('click', startScan);
  $('#scan-close').addEventListener('click', stopScan);
  $('#dlg-scan').addEventListener('close', () => scanner.stop());
  $('#dlg-scan').addEventListener('cancel', () => scanner.stop());

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  $('#form-product').addEventListener('submit', async (e) => {
    const name = $('#product-name').value.trim();
    if (!name) {
      e.preventDefault();
      return;
    }
    const minStock = Number($('#product-min').value) || 0;
    const barcode = $('#product-barcode').value.trim() || null;

    if (editingProduct) {
      await pantry.updateProduct(editingProduct, { name, minStock, barcode });
      toast(`${name} gespeichert`);
    } else {
      const product = await pantry.createProduct({ name, minStock, barcode });
      const initial = Number($('#product-stock').value) || 0;
      if (initial > 0) await pantry.addStock(product.id, initial);
      toast(`${name} angelegt`);
    }
    editingProduct = null;
  });

  $('#form-stock').addEventListener('submit', async () => {
    if (!stockTarget) return;
    const qty = Number($('#stock-qty').value) || 1;
    const bestBefore = $('#stock-bb').value || null;
    await pantry.addStock(stockTarget.id, qty, bestBefore);
    toast(`${stockTarget.name}: ${qty} eingebucht`, true);
    stockTarget = null;
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

  $('#setting-lead').value = String(store.getSetting('leadDays', DEFAULT_SETTINGS.leadDays));
  $('#setting-expiry').value = String(
    store.getSetting('expiryWarnDays', DEFAULT_SETTINGS.expiryWarnDays),
  );

  wire();
  switchView(activeView);
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Offline-Betrieb ist ein Extra, kein Muss. */
    });
  }
}

main();
