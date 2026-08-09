# Küchenvorrat

Eine kleine Web-App, um den Überblick über die Vorräte in der Küche zu behalten —
und um abschätzen zu können, wann etwas voraussichtlich zu Ende geht.

Läuft im Browser, ohne Konto, ohne Server, ohne Installation. Auf dem Handy
lässt sie sich zum Startbildschirm hinzufügen und verhält sich dann wie eine App.

## Was sie kann

- **Vorrat sehen** — alle Produkte mit Bestand in Packungen, nach Fächern
  sortiert wie in der Küche: Nudeln & Reis, Saucen, Kühlschrank, Haushalt.
  Einsortiert wird automatisch anhand des Namens.
- **Verbrauch lernen** — aus jeder Buchung schätzt die App, wie schnell etwas
  weggeht, und rechnet daraus aus, wann der Vorrat voraussichtlich leer ist.
- **Nachschlagen** — „Haben wir noch …?" beantwortet die App direkt mit *Ja,
  3 da* oder *Nein, leer*. Sie verzeiht dabei Tippfehler und fehlende Umlaute.
- **Einkaufsliste** — eine echte Liste zum Abhaken, getrennt von den
  Vorschlägen der App. Übernommen wird, was ihr wirklich kauft; der Rest
  lässt sich ablehnen. Steht von etwas laut Vorrat noch was da, sagt die
  Liste das.
- **Mindesthaltbarkeit** — wird bei jedem Einbuchen abgefragt. Liegen mehrere
  Packungen im Schrank, darf jede ihr eigenes Datum haben; die App warnt
  rechtzeitig und verbraucht immer zuerst, was zuerst abläuft.
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

## Kategorien

Der Vorrat ist in dreizehn Fächer geteilt, in der Reihenfolge, in der man
eine Küche durchgeht — Trockenvorrat, Kühlschrank, Frisches, Getränke,
Haushalt. Leere Fächer werden nicht angezeigt.

Die Einkaufsliste nutzt dieselben Fächer, aber **eine andere Reihenfolge**:
den Weg durch den Markt. Siehe [Gangfolge](#gangfolge-im-supermarkt).

Einsortiert wird **automatisch anhand des Namens**. Niemand muss beim
Erfassen eine Kategorie auswählen, und bereits erfasste Produkte landen
sofort im richtigen Fach, ohne dass die gespeicherten Daten angefasst
werden. Wer will, wählt im Produktdialog eine feste Kategorie — die gilt
dann und wird nie überstimmt.

### Wie die Zuordnung rät

Jedes Fach hat eine Liste von Wortstämmen. Getroffen wird ein Stamm, wenn
ein Wort des Produktnamens damit anfängt oder aufhört — deutsche
Zusammensetzungen liefen sonst ins Leere. Drei Regeln machen das Ergebnis
brauchbar:

- **Das letzte Glied entscheidet.** Im Deutschen bestimmt das Grundwort die
  Sache: „Tomatensauce" ist eine Sauce, „Reismehl" ist Mehl. Ohne diesen
  Vorrang landeten beide im falschen Fach.
- **Kurze Stämme gelten nur als ganzes Wort.** Sonst macht „Ei" aus jedem
  „Kartoffelbrei" ein Milchprodukt.
- **Bei gleich starkem Treffer gewinnt das vordere Wort.** Sorte und Marke
  stehen im Deutschen hinten („Müsli Schoko", „Joghurt Erdbeere"), die Ware
  vorne.

Manches ergibt sich aber erst aus der **Wortkombination**. Frische Tomaten
gehören zum Gemüse, passierte und stückige in den Vorratsschrank — das lässt
sich mit einzelnen Stichwörtern nicht trennen. Dafür gibt es `phrases`:
Wortpaare, die zusammen gelten und jedes Einzelwort schlagen.

```
['tomate', 'passiert']   →  Saucen & Konserven
['tomate', 'dose']       →  Saucen & Konserven
```

So bleibt „Dose" ohne Wirkung, wo es nur die Verpackung meint („Kichererbsen
Dose" sind Erbsen), und „gehackt" darf gleichzeitig beim Hackfleisch stehen,
ohne die gehackten Tomaten mitzunehmen.

Zwei weitere Ausnahmen: „Tiefkühl" und „TK" schlagen als Marker sogar die
Wortkombinationen (Tiefkühlerbsen sind Erbsen, gesucht werden sie aber im
Gefrierfach), und „Kaffeebohne" steht in den Getränken, damit der Kaffee
nicht bei den Hülsenfrüchten landet.

Ein paar Markennamen sind direkt hinterlegt, wo sie für nichts anderes
stehen als für die Ware selbst — etwa Miracel Whip und Thomy bei den Saucen.

Passt etwas nicht, sind zwei Wege möglich: die Kategorie am Produkt fest
wählen, oder in `js/categories.js` einen Stamm ergänzen. Letzteres wirkt
für alle Produkte auf einmal.

## Nachschlagen und Einkaufsliste

### „Haben wir noch …?"

Das Suchfeld im Vorrat beantwortet diese Frage als Satz, nicht als Liste —
denn eine leere Trefferliste sieht genauso aus wie „gibt es nicht", und im
Laden ist das ein wichtiger Unterschied:

- **Ja — 3 da**
- **Nein — nichts mehr da** (erfasst, aber leer)
- **Nicht im Vorrat** (nie erfasst) — mit Knopf zum direkten Anlegen

Gesucht wird in drei Stufen, von genau nach großzügig. Umlaute muss man nicht
tippen (`muesli` findet `Müsli`, `creme fraiche` findet `Crème fraîche`), und
ab vier Zeichen werden kleine Tippfehler verziehen (`jogurt` findet
`Joghurt`). Darunter wird bewusst nicht geraten: Bei drei Buchstaben passt
sonst alles auf alles. Ein eingetippter Barcode zählt als voller Treffer.

### Gangfolge im Supermarkt

Beide Listen im Reiter *Einkauf* sind nach Fächern gegliedert — aber nicht
in der Ordnung der Küche, sondern in der des Ladens:

1. 🥕 Obst & Gemüse · 2. 🍞 Frühstück & Brot · 3. 🍝 Nudeln & Reis ·
4. 🥔 Kartoffeln & Hülsenfrüchte · 5. 🥫 Saucen & Konserven ·
6. 🧂 Öl, Essig & Gewürze · 7. 🧁 Backen & Süßes · 8. 🧽 Haushalt ·
9. 🧀 Milch & Käse · 10. 🥩 Fleisch & Fisch · 11. 🧊 Tiefkühl ·
12. 🥤 Getränke · 13. 📦 Sonstiges

Obst und Gemüse liegen in deutschen Supermärkten fast immer gleich hinter
dem Eingang, danach folgen Backwaren und die Regalgassen. Kühlware, Fleisch
und Tiefkühl stehen bewusst hinten: Das entspricht bei den meisten Märkten
dem Rückweg zur Kasse und hält zugleich die Kühlkette kurz. Getränke ganz
zuletzt, weil sie schwer sind und oben auf dem Wagen nichts zu suchen haben.

Auch frei Notiertes wird einsortiert — bei „Alufolie" oder „Brötchen" gibt
es kein Produkt im Vorrat, also entscheidet der Text allein. Abgehaktes
sammelt sich unten in einem eigenen Block, damit es die Gänge nicht
zerreißt, durch die man gerade läuft.

Passt die Reihenfolge nicht zu eurem Markt, steht sie als `SHOPPING_ORDER`
in `js/categories.js` und lässt sich dort umstellen.

### Zwei Listen, absichtlich getrennt

Der Reiter *Einkauf* zeigt zwei Abschnitte, weil es zwei verschiedene Dinge
sind:

**Einkaufsliste** — was ihr tatsächlich kauft. Sie entsteht nur durch eure
Entscheidung: über das Feld **„Was fehlt noch?"** oder durch Übernehmen eines
Vorschlags.

- **Antippen** hakt einen Eintrag ab (durchgestrichen, rutscht ans Ende) —
  die Geste für den Laden. Abhaken bucht bewusst noch nichts ein: Im Wagen
  liegen heißt nicht im Schrank stehen.
- **`+`** bucht ein, samt Haltbarkeitsdatum — der Schritt für zu Hause. Der
  Eintrag verschwindet danach.
- **`×`** nimmt den Eintrag von der Liste.
- **„Erledigte weg"** räumt alle Abgehakten auf einmal ab.

**Vorschläge** — was die App aus Bestand und Verbrauch für nötig hält. Ein
Vorschlag ist eine Vermutung, keine Entscheidung, und lässt sich deshalb
beides:

- **„Auf die Liste"** übernimmt ihn (er verschwindet aus den Vorschlägen,
  damit nichts doppelt dasteht). **„Alle übernehmen"** macht das für den
  ganzen Abschnitt.
- **`×`** lehnt ihn ab: 30 Tage Ruhe. Denn nicht alles, was leer ist, wird
  auch nachgekauft — ohne diese Möglichkeit stünde es bis zum nächsten Kauf
  unverrückbar da und die Vorschläge würden mit der Zeit wertlos. Wird das
  Produkt zwischenzeitlich gekauft, ist die Ablehnung hinfällig.

Für Dinge, die grundsätzlich nicht in den Wocheneinkauf gehören, gibt es im
Produktdialog den Schalter **„Zum Nachkaufen vorschlagen"** — dauerhaft statt
nur für 30 Tage.

### Wenn die App sich irrt

Passt ein Eintrag zu einem erfassten Produkt, verknüpft die App beides. Ist
davon noch etwas da, steht es schon beim Tippen und danach in der Zeile:
*„Laut Vorrat noch 5 da"*. Weil im Zweifel ihr recht habt und nicht die App,
sitzt daneben der Knopf **„Ist leer"** — der setzt den Bestand auf null.

Als Korrektur gebucht, nicht als Verbrauch: Eine falsche Zahl zu berichtigen
sagt nichts darüber aus, wie schnell etwas weggeht, und darf die Prognose
nicht verzerren.

## Haltbarkeit und Chargen

Der Bestand hängt nicht am Produkt, sondern an **Chargen**. Eine Charge ist
„so viele Packungen, die bis zu diesem Datum halten". Dieselbe Sorte kann
deshalb mehrfach im Schrank stehen, mit je eigenem Datum — genau so, wie es
tatsächlich der Fall ist.

Nach dem Datum gefragt wird überall dort, wo Bestand hinzukommt: beim Anlegen
eines Produkts, beim Einbuchen über `+` und nach jedem Scan. Sind es mehrere
Packungen, blendet der Dialog einen Umschalter ein: **„Unterschiedlich lange
haltbar"** gibt jeder Packung ein eigenes Feld. Gleiche Daten fasst die App
danach wieder zu einer Charge zusammen, damit die Liste übersichtlich bleibt.

Nachträglich lässt sich alles korrigieren: In der Detailansicht eines Produkts
ist jede Charge antippbar. Dort kann man

- ein Datum nachtragen oder ändern,
- einen Teil der Packungen herauslösen und ihm ein eigenes Datum geben
  („Gilt für wie viele Packungen?"),
- eine Charge als entsorgt buchen.

Umsortieren und Aufteilen ändern den Bestand nicht und werden deshalb auch
nicht gebucht — sie beschreiben nur genauer, was ohnehin da ist. Entsorgtes
wird als `discard` gebucht und **nicht** als Verbrauch: Was im Müll landet,
sagt nichts darüber aus, wie schnell etwas aufgebraucht wird, und würde die
Prognose sonst zu hoch ansetzen.

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
js/search.js        Nachsichtige Suche und die Antwort "haben wir das?"
js/categories.js    Fächer und die automatische Zuordnung nach Namen
js/format.js        Aufbereitung der Zahlen für die Anzeige
js/app.js           Verdrahtung von Daten und Oberfläche
vendor/zbar-wasm/   Barcode-Erkennung für iOS (LGPL, siehe Ordner-README)
tests/              Tests der Rechenlogik
```

Kein Build-Schritt: Was im Repository liegt, ist das, was im Browser läuft.
Einzige Fremdkomponente ist die Barcode-Erkennung unter `vendor/` — und die
wird nur auf Geräten geladen, die sie brauchen.
