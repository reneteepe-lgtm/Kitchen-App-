# Küchenvorrat

Eine kleine Web-App, um den Überblick über die Vorräte in der Küche zu behalten —
und um abschätzen zu können, wann etwas voraussichtlich zu Ende geht.

Läuft im Browser, ohne Konto, ohne Server, ohne Installation. Auf dem Handy
lässt sie sich zum Startbildschirm hinzufügen und verhält sich dann wie eine App.

## Was sie kann

- **Vorrat sehen** — alle Produkte mit Bestand in Packungen, auf einen Blick.
- **Verbrauch lernen** — aus jeder Buchung schätzt die App, wie schnell etwas
  weggeht, und rechnet daraus aus, wann der Vorrat voraussichtlich leer ist.
- **Einkaufsliste** — füllt sich automatisch mit allem, was leer ist, unter dem
  Mindestbestand liegt oder demnächst ausgeht.
- **Mindesthaltbarkeit** — pro Charge erfassbar; die App warnt rechtzeitig und
  verbraucht immer zuerst, was zuerst abläuft.
- **Barcode scannen** — Produkte per Kamera erfassen, auf Android wie auf
  iPhone. Namen kommen aus der offenen Produktdatenbank
  [Open Food Facts](https://world.openfoodfacts.org/).
- **Rückgängig** — eine versehentliche Buchung ist ein Fingertipp weit weg.

## Loslegen

### Auf dem Handy nutzen (empfohlen)

Die App besteht nur aus statischen Dateien und kann über GitHub Pages
veröffentlicht werden:

1. Im Repository unter **Settings → Pages** als Quelle den Branch wählen, auf
   dem dieser Code liegt, Ordner `/ (root)`.
2. Nach ein paar Minuten ist sie unter
   `https://<benutzername>.github.io/Kitchen-App-/` erreichbar.
3. Die Seite auf dem Handy öffnen und über das Browsermenü
   **„Zum Startbildschirm hinzufügen"** wählen.

Danach läuft sie auch offline.

### Lokal ausprobieren

```bash
npm run serve       # http://localhost:8080
```

Ein Server ist nötig, weil die App aus ES-Modulen besteht — über `file://`
lädt der Browser die nicht.

### Eine neue Fassung veröffentlichen

Änderungen auf den Branch pushen, den GitHub Pages bedient — das genügt.
Auf den Handys kommt die neue Fassung beim nächsten Öffnen von selbst an:
Die App sieht bei jedem Start nach, ob es etwas Neues gibt, holt es und
lädt sich einmal neu. Welcher Stand gerade läuft, steht unter **Mehr** ganz
unten.

Eine Sache ist dabei von Hand zu pflegen: die Versionsnummer an **beiden**
Stellen, weil der Service Worker als eigenständige Datei läuft und nichts
aus der App importieren kann.

- `js/app.js` → `APP_VERSION`
- `sw.js` → `CACHE` (`kuechenvorrat-v<nummer>`)

Die Nummer im Cache-Namen ist das, was den Browser die Datei überhaupt als
geändert erkennen lässt. Bleibt sie stehen, bemerkt niemand ein Update.
`npm test` schlägt fehl, wenn die beiden Angaben auseinanderlaufen.

### Tests

```bash
npm test
```

Deckt die Rechenlogik ab: Verbrauchsschätzung, Reichweite, Chargenverbrauch
nach Ablaufdatum, Einkaufsliste, Rückgängig, Sicherung und Zusammenführen —
dazu die Stellen, an denen ein Fehler still bliebe: die Formatnamen der
Barcode-Bibliothek, die Dateiliste des Service Workers und der Gleichlauf
der beiden Versionsangaben.

## Zu zweit nutzen

Die Daten liegen zunächst auf dem jeweiligen Gerät. Für den Abgleich gibt es
unter **Mehr → Daten** einen Export und einen Import: Die Sicherung vom einen
Handy auf dem anderen einlesen und dabei **„zusammenführen"** wählen — dann
gehen auf keiner Seite Buchungen verloren.

Für echten, laufenden Sync ist der Unterbau bereits vorbereitet:

- Jeder Datensatz trägt einen Zeitstempel (`updatedAt`); beim Zusammenführen
  gewinnt die jüngere Änderung.
- Gelöscht wird nur weich, damit ein altes Gerät gelöschte Produkte nicht
  wieder auferstehen lässt.
- Buchungen werden nie verändert, nur angehängt — zwei Buchungslisten lassen
  sich deshalb konfliktfrei vereinigen.

Es genügt also, in `js/storage.js` einen weiteren Adapter neben
`LocalStorageAdapter` zu stellen (`read`/`write` gegen eine Datenbank). An der
übrigen Anwendungslogik ändert sich dafür nichts.

## Wie die Prognose funktioniert

Der Verbrauch wird als Poisson-Prozess mit unbekannter Rate modelliert, die
Rate bekommt einen Gamma-Prior (Gamma-Poisson-Modell). Das hat zwei praktische
Folgen:

- **Bei wenig Daten** bleibt die Schätzung stabil, statt aus zwei Buchungen
  eine scheingenaue Aussage zu bauen. Solange zu wenig vorliegt, zeigt die App
  bewusst kein Datum, sondern „Verbrauch wird noch gelernt".
- **Mit wachsender Historie** setzen sich die echten Daten vollständig gegen
  die Ausgangsannahme durch.

Ältere Buchungen verlieren mit einer Halbwertszeit von 60 Tagen an Gewicht.
Ändert sich eine Gewohnheit, folgt die Schätzung innerhalb weniger Wochen,
ohne bei einem einzelnen Ausreißer gleich auszuschlagen.

Zwei Feinheiten, die im Alltag den Unterschied machen:

- **Nachkäufe zählen als Verbrauchsspur.** Wer nicht jede geöffnete Packung
  abhakt, bekommt trotzdem eine Prognose — solange der Vorrat im Mittel gleich
  groß bleibt, entspricht die gekaufte Menge über längere Zeit der verbrauchten.
  Gezählt wird die stärkere der beiden Spuren, nicht ihre Summe.
- **Bestandskorrekturen zählen nicht als Verbrauch.** Eine Inventur ist keine
  Aussage darüber, wie schnell etwas weggeht, und darf die Prognose nicht
  verfälschen.

## Barcode-Scan

Funktioniert auf beiden Systemen, aber auf zwei Wegen:

- **Android** nutzt die eingebaute `BarcodeDetector`-Schnittstelle des
  Browsers. Schnell und ohne zusätzlichen Download.
- **iPhone und iPad** bekommen die Erkennung mitgeliefert
  ([zbar-wasm](vendor/zbar-wasm/), ZBar als WebAssembly, rund 250 KB). Apple
  hat die Schnittstelle nie implementiert, und weil dort alle Browser WebKit
  verwenden, hilft auch kein anderer Browser. Der Kamerazugriff selbst
  funktioniert auf iOS problemlos — es fehlt nur der Erkenner, und genau der
  wird nachgereicht.

Geladen wird die Bibliothek erst beim ersten Scan und nur dort, wo sie fehlt;
Android-Geräte laden sie nie. Danach liegt sie im Cache des Service Workers,
sodass auch das Scannen offline funktioniert.

Beide Wege liefern denselben Code an dieselbe Stelle — sichtbar ist der
Unterschied nur daran, dass auf iOS beim allerersten Scan kurz „Scanner wird
vorbereitet…" steht.

Der Kamerazugriff setzt in beiden Fällen HTTPS voraus. Über GitHub Pages,
Cloudflare Pages oder Netlify ist das automatisch gegeben.

## Aufbau

```
index.html          Oberfläche
app.css             Gestaltung, hell und dunkel
sw.js               Service Worker für den Offline-Betrieb
js/forecast.js      Verbrauchsschätzung und Reichweite
js/model.js         Produkte, Chargen, Buchungen
js/storage.js       Persistenz, austauschbar für späteren Sync
js/barcode.js       Kamera-Scan und Produktdatenbank
js/format.js        Aufbereitung der Zahlen für die Anzeige
js/app.js           Verdrahtung von Daten und Oberfläche
vendor/zbar-wasm/   Barcode-Erkennung für iOS (LGPL, siehe Ordner-README)
tests/              Tests der Rechenlogik
```

Kein Build-Schritt: Was im Repository liegt, ist das, was im Browser läuft.
Einzige Fremdkomponente ist die Barcode-Erkennung unter `vendor/` — und die
wird nur auf Geräten geladen, die sie brauchen.
