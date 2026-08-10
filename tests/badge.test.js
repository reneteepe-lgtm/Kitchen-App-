import test from 'node:test';
import assert from 'node:assert/strict';

import { applyBadge, askNotificationPermission, describeBadgeState, supportsBadge } from '../js/badge.js';

/** Ein Gerät, das den Punkt kann -- und mitschreibt, was verlangt wurde. */
function geraet({ wirft = false } = {}) {
  const ruf = [];
  return {
    ruf,
    setAppBadge: async (n) => {
      if (wirft) throw new Error('keine Erlaubnis');
      ruf.push(['setzen', n]);
    },
    clearAppBadge: async () => {
      if (wirft) throw new Error('keine Erlaubnis');
      ruf.push(['loeschen']);
    },
  };
}

// --- Wann ein Punkt erscheint --------------------------------------------

test('eine Zahl größer null landet auf dem Symbol', async () => {
  const nav = geraet();
  assert.equal(await applyBadge(3, { enabled: true, nav }), 'gesetzt');
  assert.deepEqual(nav.ruf, [['setzen', 3]]);
});

test('ohne etwas Ablaufendes bleibt das Symbol frei', async () => {
  // Ein Punkt, der immer da ist, wird nach zwei Wochen nicht mehr gelesen.
  const nav = geraet();
  assert.equal(await applyBadge(0, { enabled: true, nav }), 'leer');
  assert.deepEqual(nav.ruf, [['loeschen']]);
});

test('ausgeschaltet wird der Punkt weggeräumt, nicht nur nicht gesetzt', async () => {
  // Sonst bliebe die letzte Zahl für immer auf dem Startbildschirm stehen.
  const nav = geraet();
  assert.equal(await applyBadge(5, { enabled: false, nav }), 'leer');
  assert.deepEqual(nav.ruf, [['loeschen']]);
});

test('ein Gerät ohne diese Möglichkeit ist kein Fehlerfall', async () => {
  assert.equal(await applyBadge(3, { enabled: true, nav: {} }), 'nicht-moeglich');
  assert.equal(await applyBadge(3, { enabled: true, nav: undefined }), 'nicht-moeglich');
  assert.equal(supportsBadge({}), false);
  assert.equal(supportsBadge({ setAppBadge: () => {} }), false, 'löschen gehört dazu');
  assert.equal(supportsBadge(geraet()), true);
});

test('verweigert das System, läuft die App weiter', async () => {
  // Auf dem iPhone wirft der Aufruf ohne Mitteilungs-Erlaubnis.
  assert.equal(await applyBadge(2, { enabled: true, nav: geraet({ wirft: true }) }), 'verweigert');
});

// --- Die Erlaubnis --------------------------------------------------------

test('ohne Mitteilungs-Schnittstelle wird nicht gefragt', async () => {
  assert.equal(await askNotificationPermission({ notification: undefined }), 'nicht-noetig');
  assert.equal(await askNotificationPermission({ notification: {} }), 'nicht-noetig');
});

test('eine schon erteilte Erlaubnis wird nicht erneut erfragt', async () => {
  let gefragt = 0;
  const mode = await askNotificationPermission({
    notification: { permission: 'granted', requestPermission: async () => { gefragt++; return 'granted'; } },
  });
  assert.equal(mode, 'erlaubt');
  assert.equal(gefragt, 0);
});

test('ein einmal gegebenes Nein wird nicht nachgebohrt', async () => {
  // Ein weiterer Aufruf kehrte ohnehin wirkungslos zurück.
  let gefragt = 0;
  const mode = await askNotificationPermission({
    notification: { permission: 'denied', requestPermission: async () => { gefragt++; return 'denied'; } },
  });
  assert.equal(mode, 'verweigert');
  assert.equal(gefragt, 0);
});

test('bei offener Frage wird einmal gefragt', async () => {
  for (const [antwort, erwartet] of [['granted', 'erlaubt'], ['denied', 'verweigert'], ['default', 'verweigert']]) {
    const mode = await askNotificationPermission({
      notification: { permission: 'default', requestPermission: async () => antwort },
    });
    assert.equal(mode, erwartet, `Antwort ${antwort}`);
  }
});

test('wirft die Frage selbst, gilt das als Nein', async () => {
  const mode = await askNotificationPermission({
    notification: { permission: 'default', requestPermission: async () => { throw new Error('nope'); } },
  });
  assert.equal(mode, 'verweigert');
});

// --- Was darunter steht ---------------------------------------------------

test('der Satz unter dem Schalter sagt den wirklichen Zustand', () => {
  const s = (over) => describeBadgeState({ enabled: true, supported: true, result: 'gesetzt', count: 3, ...over });

  assert.match(s({ supported: false }), /kann keinen Punkt/);
  assert.match(s({ enabled: false }), /^Aus/);
  assert.match(s({ count: 0, result: 'leer' }), /bleibt frei/);
  assert.match(s({ count: 1 }), /eine 1\./);
  assert.match(s({ count: 7 }), /eine 7\./);
});

test('wer den Schalter umlegt und nichts sieht, erfährt warum', () => {
  const text = describeBadgeState({ enabled: true, supported: true, result: 'verweigert', count: 3 });
  assert.match(text, /Erlaubnis/);
  assert.match(text, /iPhone/, 'mit dem Weg, es nachzuholen');
});

test('nicht unterstützt schlägt alles andere', () => {
  // Sonst stünde dort "zeigt gerade eine 3", wo nie etwas erscheinen wird.
  const text = describeBadgeState({ enabled: true, supported: false, result: 'nicht-moeglich', count: 3 });
  assert.match(text, /kann keinen Punkt/);
});
