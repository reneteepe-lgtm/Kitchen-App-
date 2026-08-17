/**
 * Das Wetter.
 *
 * Ein Vorschlag ohne Wetter ist raten. Bei zwei Grad und Regen ist die
 * Frage nicht, was gut aussieht, sondern was gut aussieht *und* warm hält --
 * und das ist der einzige Grund, warum diese App überhaupt ins Netz geht.
 *
 * Bezogen von [Open-Meteo](https://open-meteo.com/): kein Konto, kein
 * Schlüssel, keine Anmeldung, freie Nutzung für den privaten Gebrauch. Damit
 * bleibt die App das, was sie sein soll -- etwas, das man aufmacht und das
 * funktioniert.
 *
 * Übertragen wird ausschließlich der Ort, für den die Vorhersage gilt.
 * Welche Kleidung jemand besitzt, was er anzieht und was ihm gefällt,
 * verlässt das Gerät nie.
 *
 * Der letzte Abruf wird aufbewahrt. Wer morgens ohne Empfang in den Schrank
 * schaut, bekommt die Vorhersage von vorhin statt gar keiner -- mit einem
 * ehrlichen Hinweis, wie alt sie ist.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** So lange gilt ein Abruf als aktuell. */
export const FRESH_MINUTES = 180;

/**
 * Die Wettercodes, die für die Kleiderfrage einen Unterschied machen.
 *
 * Open-Meteo liefert die WMO-Codes in voller Feinheit -- vom "leichten
 * Sprühregen" bis zum "starken Graupelschauer". Für die Frage "Jacke oder
 * nicht" reichen sechs Zustände; alles darüber wäre Genauigkeit, die
 * niemandem beim Anziehen hilft.
 */
export const CONDITIONS = {
  klar: { id: 'klar', label: 'Klar', icon: '☀️' },
  bewoelkt: { id: 'bewoelkt', label: 'Bewölkt', icon: '☁️' },
  nebel: { id: 'nebel', label: 'Nebel', icon: '🌫️' },
  regen: { id: 'regen', label: 'Regen', icon: '🌧️' },
  schnee: { id: 'schnee', label: 'Schnee', icon: '🌨️' },
  gewitter: { id: 'gewitter', label: 'Gewitter', icon: '⛈️' },
};

export function conditionOf(code) {
  if (code === 0 || code === 1) return CONDITIONS.klar;
  if (code === 2 || code === 3) return CONDITIONS.bewoelkt;
  if (code === 45 || code === 48) return CONDITIONS.nebel;
  // Die WMO-Skala endet bei 99. Die Obergrenze steht bewusst da: Ohne sie
  // wäre jeder unbekannte Wert ein Gewitter -- die alarmierendste aller
  // Auskünfte, ausgerechnet für den Fall, dass man nichts weiß.
  if (code >= 95 && code <= 99) return CONDITIONS.gewitter;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CONDITIONS.schnee;
  if (code >= 51 && code <= 82) return CONDITIONS.regen;
  return CONDITIONS.bewoelkt;
}

/**
 * Macht aus der Antwort von Open-Meteo das, was die App braucht.
 *
 * Als eigene Funktion, damit sie ohne Netz prüfbar ist -- und damit ein
 * Umzug zu einem anderen Wetterdienst genau eine Stelle betrifft.
 */
export function parseForecast(payload, place = null, now = new Date()) {
  const daily = payload?.daily ?? {};
  const current = payload?.current ?? {};
  const code = daily.weather_code?.[0] ?? current.weather_code ?? 3;

  return {
    place,
    tempMin: numberOrNull(daily.temperature_2m_min?.[0]),
    tempMax: numberOrNull(daily.temperature_2m_max?.[0]),
    tempNow: numberOrNull(current.temperature_2m),
    rainChance: numberOrNull(daily.precipitation_probability_max?.[0]) ?? 0,
    windMax: numberOrNull(daily.wind_speed_10m_max?.[0]) ?? 0,
    code,
    condition: conditionOf(code),
    fetchedAt: now.toISOString(),
  };
}

const numberOrNull = (value) => (Number.isFinite(value) ? value : null);

/**
 * Sucht einen Ort nach Namen.
 *
 * Bewusst über die Eingabe eines Ortsnamens statt über die Standortabfrage
 * des Browsers: Die kostet eine Erlaubnisfrage beim ersten Start -- die
 * sicherste Art, ein "nein" zu bekommen -- und der Ort ändert sich bei den
 * meisten Menschen selten. Wer möchte, kann den Standort trotzdem
 * verwenden; die App fragt danach erst auf Knopfdruck.
 */
export async function searchPlaces(query, { fetch = globalThis.fetch, count = 6 } = {}) {
  const name = String(query ?? '').trim();
  if (name.length < 2) return [];

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=${count}&language=de&format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Ortssuche fehlgeschlagen (${response.status})`);

  const payload = await response.json();
  return (payload?.results ?? []).map(toPlace);
}

function toPlace(result) {
  return {
    id: String(result.id ?? `${result.latitude},${result.longitude}`),
    name: result.name,
    // Bundesland und Land dazu, weil es in Deutschland mehrere Neustadt
    // gibt und die Liste sonst sechs Mal dasselbe Wort zeigte.
    region: result.admin1 ?? '',
    country: result.country ?? '',
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

/** "Wallenhorst, Niedersachsen" */
export function placeLabel(place) {
  if (!place) return '';
  return [place.name, place.region || place.country].filter(Boolean).join(', ');
}

/** Holt die Vorhersage für heute. */
export async function fetchWeather(place, { fetch = globalThis.fetch, now = new Date() } = {}) {
  if (!place) throw new Error('Kein Ort gewählt');

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max',
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
    forecast_days: '1',
  });

  const response = await fetch(`${FORECAST_URL}?${params}`);
  if (!response.ok) throw new Error(`Wetterabruf fehlgeschlagen (${response.status})`);
  return parseForecast(await response.json(), place, now);
}

/** Den Standort des Geräts holen -- nur auf ausdrücklichen Wunsch. */
export async function locateDevice({ geolocation = globalThis.navigator?.geolocation } = {}) {
  if (!geolocation) throw new Error('Dieses Gerät kann den Standort nicht bestimmen.');
  const position = await new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 600000 });
  });
  return {
    id: 'geraet',
    name: 'Mein Standort',
    region: '',
    country: '',
    latitude: Math.round(position.coords.latitude * 1000) / 1000,
    longitude: Math.round(position.coords.longitude * 1000) / 1000,
  };
}

// --- Anzeige -------------------------------------------------------------

export function isFresh(weather, now = new Date(), maxMinutes = FRESH_MINUTES) {
  if (!weather?.fetchedAt) return false;
  return now.getTime() - new Date(weather.fetchedAt).getTime() < maxMinutes * 60 * 1000;
}

const degrees = (value) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value);

/** "−2,5 bis −0,6 °C" */
export function describeTemperature(weather) {
  if (!weather) return '';
  if (weather.tempMin === null && weather.tempMax === null) return '';
  if (weather.tempMin === null || weather.tempMax === null) {
    return `${degrees(weather.tempMax ?? weather.tempMin)} °C`;
  }
  return `${degrees(weather.tempMin)} bis ${degrees(weather.tempMax)} °C`;
}

/** Die eine Zeile unter "Outfit des Tages". */
export function describeWeather(weather) {
  if (!weather) return 'Ort noch nicht gewählt';
  const parts = [placeLabel(weather.place), describeTemperature(weather)].filter(Boolean);
  if (weather.rainChance >= 40) parts.push(`${Math.round(weather.rainChance)} % Regen`);
  return parts.join(' · ');
}

/**
 * Wie alt die Angabe ist -- aber nur, wenn sie alt genug ist, dass es
 * jemanden interessiert.
 */
export function describeAge(weather, now = new Date()) {
  if (!weather?.fetchedAt) return '';
  const minutes = Math.floor((now.getTime() - new Date(weather.fetchedAt).getTime()) / 60000);
  if (minutes < FRESH_MINUTES) return '';
  if (minutes < 1440) return `Stand von vor ${Math.floor(minutes / 60)} Stunden`;
  const days = Math.floor(minutes / 1440);
  return days === 1 ? 'Stand von gestern' : `Stand von vor ${days} Tagen`;
}
