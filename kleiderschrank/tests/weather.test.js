import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseForecast,
  conditionOf,
  searchPlaces,
  fetchWeather,
  placeLabel,
  describeTemperature,
  describeWeather,
  describeAge,
  isFresh,
  FRESH_MINUTES,
} from '../js/weather.js';

/** Eine Antwort, wie Open-Meteo sie liefert. */
const antwort = {
  current: { temperature_2m: -1.8, weather_code: 71 },
  daily: {
    temperature_2m_max: [-0.6],
    temperature_2m_min: [-2.5],
    precipitation_probability_max: [20],
    weather_code: [71],
    wind_speed_10m_max: [11.2],
  },
};

const ort = { id: '1', name: 'Wallenhorst', region: 'Niedersachsen', country: 'Deutschland', latitude: 52.35, longitude: 8.0 };

/** Ein `fetch`, das eine feste Antwort gibt -- und mitschreibt, wonach gefragt wurde. */
function fakeFetch(payload, { ok = true, status = 200 } = {}) {
  const aufrufe = [];
  const fn = async (url) => {
    aufrufe.push(String(url));
    return { ok, status, json: async () => payload };
  };
  fn.aufrufe = aufrufe;
  return fn;
}

test('macht aus der Antwort das, was die App braucht', () => {
  const jetzt = new Date('2026-01-15T08:00:00Z');
  const wetter = parseForecast(antwort, ort, jetzt);

  assert.equal(wetter.tempMin, -2.5);
  assert.equal(wetter.tempMax, -0.6);
  assert.equal(wetter.tempNow, -1.8);
  assert.equal(wetter.rainChance, 20);
  assert.equal(wetter.condition.id, 'schnee');
  assert.equal(wetter.place.name, 'Wallenhorst');
  assert.equal(wetter.fetchedAt, jetzt.toISOString());
});

test('kommt mit einer lückenhaften Antwort zurecht', () => {
  const wetter = parseForecast({}, null);

  assert.equal(wetter.tempMin, null);
  assert.equal(wetter.tempMax, null);
  assert.equal(wetter.rainChance, 0);
  assert.ok(wetter.condition, 'ein Zustand steht immer da');
  assert.equal(describeTemperature(wetter), '', 'ohne Werte wird nichts behauptet');
});

test('fasst die Wettercodes auf das zusammen, was für Kleidung zählt', () => {
  assert.equal(conditionOf(0).id, 'klar');
  assert.equal(conditionOf(3).id, 'bewoelkt');
  assert.equal(conditionOf(45).id, 'nebel');
  assert.equal(conditionOf(61).id, 'regen');
  assert.equal(conditionOf(80).id, 'regen');
  assert.equal(conditionOf(73).id, 'schnee');
  assert.equal(conditionOf(95).id, 'gewitter');
  assert.equal(conditionOf(999).id, 'bewoelkt', 'was niemand kennt, ist bewölkt');
});

test('sucht Orte und gibt nur zurück, was gebraucht wird', async () => {
  const fetch = fakeFetch({
    results: [
      { id: 2809346, name: 'Wallenhorst', admin1: 'Niedersachsen', country: 'Deutschland', latitude: 52.35, longitude: 8.0 },
    ],
  });

  const treffer = await searchPlaces('Wallenhorst', { fetch });

  assert.equal(treffer.length, 1);
  assert.deepEqual(treffer[0], {
    id: '2809346',
    name: 'Wallenhorst',
    region: 'Niedersachsen',
    country: 'Deutschland',
    latitude: 52.35,
    longitude: 8.0,
  });
  assert.match(fetch.aufrufe[0], /language=de/);
});

test('fragt bei zu kurzer Eingabe gar nicht erst', async () => {
  const fetch = fakeFetch({ results: [] });
  assert.deepEqual(await searchPlaces('W', { fetch }), []);
  assert.equal(fetch.aufrufe.length, 0, 'kein Aufruf für einen einzelnen Buchstaben');
});

test('holt die Vorhersage für den gewählten Ort', async () => {
  const fetch = fakeFetch(antwort);
  const wetter = await fetchWeather(ort, { fetch, now: new Date('2026-01-15T08:00:00Z') });

  assert.equal(wetter.tempMin, -2.5);
  assert.match(fetch.aufrufe[0], /latitude=52\.35/);
  assert.match(fetch.aufrufe[0], /longitude=8/);
  assert.match(fetch.aufrufe[0], /forecast_days=1/);
});

test('ein fehlgeschlagener Abruf bleibt nicht unbemerkt', async () => {
  const fetch = fakeFetch(null, { ok: false, status: 503 });
  await assert.rejects(() => fetchWeather(ort, { fetch }), /503/);
  await assert.rejects(() => fetchWeather(null, { fetch }), /Kein Ort/);
});

test('weiß, wann ein Abruf zu alt ist', () => {
  const jetzt = new Date('2026-01-15T12:00:00Z');
  const vorMinuten = (m) => ({ fetchedAt: new Date(jetzt.getTime() - m * 60000).toISOString() });

  assert.ok(isFresh(vorMinuten(30), jetzt));
  assert.ok(!isFresh(vorMinuten(FRESH_MINUTES + 1), jetzt));
  assert.ok(!isFresh(null, jetzt));
  assert.ok(!isFresh({}, jetzt));
});

test('sagt, wie alt die Angabe ist -- aber erst, wenn es zählt', () => {
  const jetzt = new Date('2026-01-15T12:00:00Z');
  const vorStunden = (h) => ({ fetchedAt: new Date(jetzt.getTime() - h * 3600000).toISOString() });

  assert.equal(describeAge(vorStunden(1), jetzt), '', 'frisch genug: kein Hinweis');
  assert.equal(describeAge(vorStunden(5), jetzt), 'Stand von vor 5 Stunden');
  assert.equal(describeAge(vorStunden(30), jetzt), 'Stand von gestern');
  assert.equal(describeAge(vorStunden(72), jetzt), 'Stand von vor 3 Tagen');
});

test('schreibt Temperaturen, wie man sie hier liest', () => {
  const wetter = parseForecast(antwort, ort);
  assert.equal(describeTemperature(wetter), '-2,5 bis -0,6 °C');

  const nurEiner = parseForecast({ daily: { temperature_2m_max: [21.5] } }, ort);
  assert.equal(describeTemperature(nurEiner), '21,5 °C');
});

test('die Zeile unter „Outfit des Tages"', () => {
  assert.equal(placeLabel(ort), 'Wallenhorst, Niedersachsen');
  assert.equal(
    describeWeather(parseForecast(antwort, ort)),
    'Wallenhorst, Niedersachsen · -2,5 bis -0,6 °C',
  );

  const nass = parseForecast(
    { ...antwort, daily: { ...antwort.daily, precipitation_probability_max: [80] } },
    ort,
  );
  assert.match(describeWeather(nass), /80 % Regen/, 'Regen gehört in die Zeile');

  assert.equal(describeWeather(null), 'Ort noch nicht gewählt');
});
