import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS,
  estimateConsumptionRate,
  projectDepletion,
  confidenceOf,
  assessProduct,
} from '../js/forecast.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS).toISOString();

/** Verbrauch von `count` Packungen im Abstand von `every` Tagen. */
function consumeSeries(count, every, { type = 'consume', qty = 1 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    type,
    qty,
    ts: daysAgo((i + 1) * every),
  }));
}

test('ohne Historie liefert die Schätzung den Prior', () => {
  const rate = estimateConsumptionRate({
    events: [],
    observedSince: daysAgo(0),
    now: NOW,
  });
  assert.ok(Math.abs(rate.ratePerDay - 1 / 21) < 1e-9);
  assert.equal(rate.evidence, 0);
  assert.equal(confidenceOf(rate).level, 'learning');
});

test('bei viel Historie konvergiert die Rate gegen den echten Verbrauch', () => {
  // Eine Packung alle 7 Tage über ein halbes Jahr => 1/7 pro Tag.
  const events = consumeSeries(26, 7);
  const rate = estimateConsumptionRate({
    events,
    observedSince: daysAgo(26 * 7),
    now: NOW,
  });
  const truth = 1 / 7;
  // 20 % Toleranz: der Prior zieht die Schätzung dauerhaft leicht zur
  // Ausgangsannahme. Bei drei Wochen Reichweite sind das gut drei Tage --
  // vom Vorlauf der Einkaufsliste ohnehin abgedeckt.
  assert.ok(
    Math.abs(rate.ratePerDay - truth) / truth < 0.2,
    `erwartet ~${truth}, war ${rate.ratePerDay}`,
  );
  assert.equal(confidenceOf(rate).level, 'good');
});

test('die Zeitgewichtung lässt die Rate nicht gegen null driften', () => {
  // Gleichbleibender Verbrauch über sehr lange Zeit: Die Abwertung alter
  // Buchungen darf die Rate nicht systematisch nach unten ziehen, weil das
  // Beobachtungsfenster mitgewichtet wird.
  const short = estimateConsumptionRate({
    events: consumeSeries(15, 4),
    observedSince: daysAgo(60),
    now: NOW,
  });
  const long = estimateConsumptionRate({
    events: consumeSeries(180, 4),
    observedSince: daysAgo(720),
    now: NOW,
  });
  assert.ok(
    Math.abs(short.ratePerDay - long.ratePerDay) / short.ratePerDay < 0.2,
    `kurz ${short.ratePerDay} vs. lang ${long.ratePerDay}`,
  );
});

test('die Schätzung nähert sich nach einer Verhaltensänderung der neuen Rate', () => {
  // Früher täglich eine Packung, ab der Umstellung nur noch alle 14 Tage.
  // Ausgewertet wird dieselbe Geschichte einmal kurz und einmal lang nach
  // der Umstellung.
  const rateAfter = (sinceChange) => {
    const heavyPhase = Array.from({ length: 120 }, (_, i) => ({
      type: 'consume',
      qty: 1,
      ts: daysAgo(sinceChange + i),
    }));
    const lightPhase = consumeSeries(Math.floor(sinceChange / 14), 14);
    return estimateConsumptionRate({
      events: [...heavyPhase, ...lightPhase],
      observedSince: daysAgo(sinceChange + 120),
      now: NOW,
    }).ratePerDay;
  };

  const soon = rateAfter(30);
  const later = rateAfter(150);
  const newTruth = 1 / 14;

  // Kein Sprung: kurz nach der Umstellung wirkt die alte Phase noch nach.
  assert.ok(soon > later, `keine Anpassung: ${soon} -> ${later}`);
  assert.ok(later > newTruth, `unter die neue Rate gefallen: ${later}`);
  // Aber deutliche Bewegung in die richtige Richtung.
  assert.ok(later < soon / 2, `zu träge: ${soon} -> ${later}`);
});

test('Kaufhistorie trägt die Prognose, wenn Verbrauch nicht gebucht wurde', () => {
  // Wer nur beim Einkauf nachträgt, soll trotzdem eine Prognose bekommen.
  const purchases = consumeSeries(10, 10, { type: 'purchase', qty: 2 });
  const rate = estimateConsumptionRate({
    events: purchases,
    observedSince: daysAgo(100),
    now: NOW,
  });
  assert.equal(rate.source, 'purchases');
  // 2 Packungen alle 10 Tage => 0,2 pro Tag.
  assert.ok(Math.abs(rate.ratePerDay - 0.2) / 0.2 < 0.2, `war ${rate.ratePerDay}`);
});

test('gebuchter Verbrauch wird nicht mit den Nachkäufen doppelt gezählt', () => {
  // Wer sauber mitpflegt, bucht beides: Einkauf und Verbrauch. Die Rate
  // darf dadurch nicht doppelt so hoch ausfallen wie bei jemandem, der nur
  // eine der beiden Spuren pflegt.
  const consumeOnly = estimateConsumptionRate({
    events: consumeSeries(20, 7),
    observedSince: daysAgo(140),
    now: NOW,
  });
  const both = estimateConsumptionRate({
    events: [...consumeSeries(20, 7), ...consumeSeries(20, 7, { type: 'purchase' })],
    observedSince: daysAgo(140),
    now: NOW,
  });
  assert.ok(
    Math.abs(both.ratePerDay - consumeOnly.ratePerDay) < 1e-9,
    `${consumeOnly.ratePerDay} vs. ${both.ratePerDay}`,
  );
});

test('Reichweite und Unsicherheitsband sind plausibel geordnet', () => {
  const rate = estimateConsumptionRate({
    events: consumeSeries(20, 7),
    observedSince: daysAgo(140),
    now: NOW,
  });
  const projection = projectDepletion(4, rate, NOW);
  assert.ok(projection.daysLeft > 20 && projection.daysLeft < 40, `war ${projection.daysLeft}`);
  assert.ok(projection.earliest < projection.emptyOn);
  assert.ok(projection.emptyOn < projection.latest);
});

test('leerer Bestand ergibt Reichweite null, unbekannte Rate ergibt keine Prognose', () => {
  const rate = estimateConsumptionRate({ events: [], observedSince: daysAgo(1), now: NOW });
  assert.equal(projectDepletion(0, rate, NOW).daysLeft, 0);
  assert.equal(projectDepletion(3, { ratePerDay: 0, sd: 0 }, NOW).daysLeft, null);
});

test('assessProduct meldet Nachkaufbedarf mit der richtigen Dringlichkeit', () => {
  const product = { id: 'p1', name: 'Nudeln', minStock: 1, createdAt: daysAgo(140) };
  const events = consumeSeries(20, 7);

  const empty = assessProduct({ product, stock: 0, events, now: NOW });
  assert.equal(empty.need.reason, 'empty');

  const low = assessProduct({ product, stock: 1, events, now: NOW });
  assert.equal(low.need.reason, 'below-min');

  // Bei 1/7 pro Tag reichen zwei Packungen 14 Tage -- mit 7 Tagen Vorlauf
  // noch kein Fall für die Einkaufsliste, mit 20 Tagen Vorlauf schon.
  assert.equal(assessProduct({ product, stock: 2, events, now: NOW, leadDays: 7 }).need, null);
  assert.equal(
    assessProduct({ product, stock: 2, events, now: NOW, leadDays: 20 }).need.reason,
    'running-out',
  );
});

test('Buchungen in der Zukunft verfälschen die Rate nicht', () => {
  const events = [
    ...consumeSeries(10, 7),
    { type: 'consume', qty: 99, ts: new Date(NOW.getTime() + 5 * DAY_MS).toISOString() },
  ];
  const rate = estimateConsumptionRate({ events, observedSince: daysAgo(70), now: NOW });
  assert.ok(rate.ratePerDay < 0.3, `Ausreißer aus der Zukunft eingerechnet: ${rate.ratePerDay}`);
});
