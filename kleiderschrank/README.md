# Mein Kleiderschrank

Eine kleine Web-App, die morgens die Frage beantwortet, die man sich sowieso
stellt: **Was ziehe ich heute an?**

Sie kennt den eigenen Schrank, das Wetter am eigenen Ort und den eigenen
Geschmack — und schlägt daraus vollständige Outfits vor, mit einer
Begründung, die man nachlesen kann.

Läuft im Browser, ohne Konto, ohne Server, ohne Installation. Auf dem Handy
lässt sie sich zum Startbildschirm hinzufügen und verhält sich dann wie eine
App.

## Was sie kann

- **Schrank erfassen** — Foto machen, Bezeichnung eintippen, fertig. Fach,
  Wärme, Anlass und Farbe liest die App aus dem Namen ab; „Wollpullover
  grau" wird ohne weiteres Zutun zu einem warmen Oberteil für den Alltag in
  Grau. Was nicht stimmt, lässt sich in einem Aufklapper korrigieren — und
  eine einmal von Hand gesetzte Angabe wird nie wieder überstimmt.
- **Farbe aus dem Foto** — steht im Namen keine Farbe, zählt die App sie
  aus dem Bild aus: Hintergrund weg, Mitte gewichtet, Abgleich mit der
  Palette im Lab-Farbraum. Auch „gemustert" erkennt sie, wenn kein Ton das
  Bild trägt. Gerechnet wird auf dem Gerät, ohne Netz. Was im Namen steht,
  hat immer Vorrang — und wo das Bild nicht eindeutig ist, wird nichts
  behauptet.
- **Outfit des Tages** — vollständige Kombinationen aus Oberteil, Hose,
  Schuhen und, wenn das Wetter es verlangt, Jacke und Mütze. Bei zwei Grad
  kommt die Jacke mit, bei achtzig Prozent Regenwahrscheinlichkeit gewinnt,
  was dicht hält.
- **Wetter** — vom eigenen Ort, bezogen von [Open-Meteo](https://open-meteo.com/).
  Ohne Empfang gilt der letzte Stand, und darunter steht, wie alt er ist.
- **Trainieren** — „gefällt mir" oder „nicht mein Stil", ein Outfit nach dem
  anderen. Daraus lernt die App Farben, Marken, Schnitte und einzelne
  Lieblingsstücke. Was sie zu wissen glaubt, steht im Trainingszentrum in
  Worten da — samt Belegen („Schwarz · 5/6").
- **Rotation** — was lange nicht an war, wird bevorzugt vorgeschlagen. Ohne
  das schlägt so eine App immer wieder die drei Teile vor, die ohnehin schon
  oben liegen.
- **Eigene Outfits** — selbst zusammenstellen, merken, „heute anziehen"
  antippen. Jedes Tragen zählt beim Outfit *und* bei jedem Teil darin.
- **Vergessene Teile** — was seit Monaten unangetastet hängt, steht auf einer
  eigenen Liste. Nicht als Vorwurf, sondern als Angebot.

## Was sie nicht tut

Es geht **nichts an einen Server**. Gelernt wird auf dem Gerät, gerechnet
wird auf dem Gerät, gespeichert wird auf dem Gerät. Der einzige Aufruf nach
draußen ist die Wetterabfrage, und übertragen wird dabei ausschließlich der
Ort, für den die Vorhersage gelten soll — nicht, was im Schrank hängt, nicht,
was angezogen wurde, nicht, was gefällt.

Es gibt kein Konto, keine Anmeldung und keinen Schlüssel, der irgendwann
abläuft.

Sie erkennt auch **nicht am Foto, was für ein Kleidungsstück** das ist. Das
ist keine Nachlässigkeit, sondern eine Abwägung — die Begründung steht
weiter unten unter [„Warum die Art des Teils nicht aus dem Bild
kommt"](#warum-die-art-des-teils-nicht-aus-dem-bild-kommt).

## Loslegen

### Auf dem Handy nutzen (empfohlen)

Die App besteht nur aus statischen Dateien und läuft über GitHub Pages:

1. Im Repository unter **Settings → Pages** als Quelle den Branch wählen, auf
   dem dieser Code liegt, Ordner `/ (root)`.
2. Nach ein paar Minuten ist sie unter
   `https://<benutzername>.github.io/Kitchen-App-/kleiderschrank/` erreichbar.
3. Die Seite auf dem Handy öffnen und über das Browsermenü **„Zum
   Startbildschirm hinzufügen"** wählen.

Danach läuft sie auch offline.

### Lokal ausprobieren

```bash
npm run serve       # http://localhost:8080/kleiderschrank/
```

Ein Server ist nötig, weil die App aus ES-Modulen besteht — über `file://`
lädt der Browser die nicht.

### Tests

```bash
npm test
```

Läuft über beide Apps im Repository.

### Symbole

Die App-Symbole werden erzeugt, nicht abgelegt:

```bash
npm run icons
```

Das Skript zeichnet den Kleiderbügel aus Abstandsfunktionen und schreibt SVG
und PNG in `icons/`. Wer die Farbe ändern will, ändert sie an einer Stelle
und lässt neu erzeugen — sonst bliebe auf dem Startbildschirm monatelang das
alte Grün stehen.

### Eine neue Fassung veröffentlichen

Änderungen auf den Branch pushen, den GitHub Pages bedient. Auf den Handys
kommt die neue Fassung beim nächsten Öffnen von selbst an.

Eine Sache ist dabei von Hand zu pflegen: die Versionsnummer an **beiden**
Stellen, weil der Service Worker als eigenständige Datei läuft und nichts aus
der App importieren kann.

- `js/app.js` → `APP_VERSION`
- `sw.js` → `CACHE` (`kleiderschrank-v<nummer>`)

`npm test` schlägt fehl, wenn die beiden auseinanderlaufen.

## Wie die Vorschläge entstehen

Der Reihe nach, weil jeder Schritt eine eigene Entscheidung ist:

1. **Wie warm muss es sein?** Aus Höchst- und Tiefstwert des Tages wird eine
   Zielwärme von 0 bis 5. Gerechnet wird mit beiden Werten, nicht nur mit dem
   Höchstwert: Wer morgens bei vier Grad losgeht, hat nichts davon, dass es
   nachmittags zwölf werden.
2. **Was kommt in Frage?** Je Fach werden die Teile vorsortiert — nach
   Wärme, Anlass, wie lange sie nicht an waren und ob sie gefallen. Nur die
   besten paar je Fach werden weiterverwendet, sonst wüchse die Zahl der
   Kombinationen ins Unermessliche.
3. **Kombinieren und bewerten.** Jede vollständige Kombination bekommt eine
   Note aus sechs Gesichtspunkten: Wetter (Gewicht 3), Anlass (2), gelernter
   Geschmack (2), Farbharmonie (1,2), Regen (1) und wie lange die Teile nicht
   an waren (0,8). Das Wetter wiegt am schwersten — ein Outfit, in dem man
   friert, ist keines, auch wenn das Lieblingshemd drinsteckt.
4. **Auswählen.** Nicht die vier besten Ergebnisse, sondern vier, die sich in
   mindestens zwei Teilen unterscheiden. Sonst wären es viermal dasselbe
   Outfit mit wechselnden Schuhen.

Die Begründung unter jedem Vorschlag („Warm genug für −2 °C", „Hält den
Regen ab") ist keine Verzierung: Es ist der Gesichtspunkt, der tatsächlich
den Ausschlag gab. Wo keiner hervorsticht, steht auch nichts.

## Wie die Farbe aus dem Foto kommt

Farbe ist die eine Frage, die ein Bild wirklich beantwortet: Sie *steht*
darin und muss nicht erkannt, sondern nur ausgezählt werden. Vier Schritte,
in `js/colorvision.js`:

1. **Klein rechnen.** Das Foto wird auf 64 × 64 Bildpunkte gebracht. Das
   genügt für eine Farbfrage vollkommen, macht aus einer halben Sekunde
   Rechnen ein paar Millisekunden — und mittelt nebenbei Stoffstruktur und
   Bildrauschen weg.
2. **Hintergrund abziehen.** Kleidung wird auf dem Bett, dem Boden oder vor
   der Wand fotografiert. Aus dem Rahmen des Bildes wird der Median genommen
   (nicht der Mittelwert — ein Ärmel, der in den Rand ragt, verzöge den) und
   alles verworfen, was ihm nahekommt. Bleibt dabei fast nichts übrig, wird
   ohne Abzug gezählt: Ein schwarzes Hemd auf schwarzem Grund soll nicht als
   leeres Bild enden.
3. **Mitte gewichten.** Wer ein Teil fotografiert, hält es in die Mitte. Was
   am Rand liegt, zählt weniger.
4. **In Lab vergleichen.** Nicht in RGB — dort liegt ein warmes Grau näher
   an Braun als an Grau. Lab ist so gebaut, dass Abstände ungefähr dem
   entsprechen, was das Auge als Unterschied sieht.

Vorgeschlagen wird nur, was deutlich ist: eine Farbe ab 35 % Flächenanteil,
eine zweite ab 25 %, und „gemustert", wenn kein Ton das Bild trägt, aber
mindestens drei deutlich vorkommen. Sonst steht da nichts. Ein falsch
gesetztes Grün, das niemand bemerkt, ist schlimmer als gar keine Angabe: Es
steht danach in den Daten, geht in die gelernten Vorlieben ein und erklärt
sich nie.

## Warum die Art des Teils nicht aus dem Bild kommt

Die naheliegende Frage ist, warum die App nicht auch erkennt, *dass* das ein
Hemd ist. Drei Wege gäbe es, und alle drei kosten mehr, als sie bringen:

- **Ein gelerntes Modell mitliefern.** Machbar, aber es lädt fünf bis
  zwanzig Megabyte ins Gerät und trifft bei Kleidung trotzdem oft daneben —
  die gängigen Modelle unterscheiden „Pullover" und „Sweatshirt" nicht, und
  ein Hemd auf einem Bügel ist für sie etwas anderes als eines auf dem Bett.
  Die App wäre langsamer, größer und läge trotzdem regelmäßig falsch.
- **Einen Bilddienst im Netz fragen.** Das widerspricht dem, wofür diese App
  gebaut ist: Es würde jedes Foto aus dem Schrank an einen fremden Server
  schicken. Dazu bräuchte es einen Schlüssel, der bezahlt wird und abläuft,
  und einen eigenen Server, um ihn zu verstecken.
- **Im Netz abgleichen wie beim Barcode.** Beim Küchenvorrat nebenan
  funktioniert das, weil ein Barcode eine eindeutige Nummer ist und es dazu
  eine freie Datenbank gibt. Für ein Foto von Kleidung gibt es beides nicht
  — keine eindeutige Kennung und keinen frei nutzbaren Dienst ohne Schlüssel
  und Kosten.

Der Name leistet dasselbe zuverlässiger und kostet einen Fingertipp:
„Wollpullover grau" ist getippt, bevor ein Modell geladen wäre, und die
Zuordnung stimmt. Deshalb liest die App aus dem Bild nur das, was dort
wirklich eindeutig steht — die Farbe — und aus dem Namen den Rest.

## Wie das Lernen funktioniert

Jedes bewertete Outfit wird in eine Handvoll Merkmale zerlegt — Farben,
Farbpaare, Marken, wie schick, wie warm, und die einzelnen Teile. Für jedes
Merkmal wird gezählt, wie oft es in einem gemochten und wie oft in einem
abgelehnten Outfit vorkam; das Gewicht ist der Anteil daraus, gedämpft um
zwei Scheinbelege.

Das ist absichtlich das einfachste Verfahren, das trägt, und es hat drei
Eigenschaften, die auf einem Privatgerät mehr wert sind als Raffinesse:

- **Es ist erklärbar.** „Schwarz: fünf von sechs Mal gemocht" kann man
  anzeigen. Eine gelernte Zahlenkolonne könnte man nur glauben.
- **Es hängt nicht an der Reihenfolge.** Es gibt keine Lernrate, die falsch
  eingestellt sein kann, und dieselben Urteile ergeben immer denselben Stand
   — auch wenn zwei Geräte ihre Bewertungen später zusammenwerfen.
- **Es ist vorsichtig.** Ein einzelnes Urteil bewegt ein Gewicht nur ein
  Drittel des Weges, und behauptet wird nur, wofür es mindestens zwei Belege
  gibt.

Der Trainingsfortschritt in Prozent ist deshalb kein Balken für eine Arbeit,
die irgendwann fertig ist, sondern eine Aussage darüber, wie belastbar die
Vorschläge gerade sind: 60 % zählt die Menge der Urteile, 40 % wie breit sie
über den Schrank streuen. Zwanzig Urteile über dieselben drei Teile sagen
nichts über den Rest.

## Aufbau

| Datei | Wofür |
| --- | --- |
| `js/app.js` | Oberfläche: ein Zustand, ein Zeichenweg |
| `js/model.js` | Kleidungsstücke, Outfits, Bewertungen |
| `js/storage.js` | Persistenz, weiches Löschen, Zusammenführen zweier Stände |
| `js/photos.js` | Fotos: verkleinern und in IndexedDB ablegen |
| `js/colorvision.js` | Die Farbe aus dem Foto auszählen |
| `js/slots.js` | Fach, Wärme, Anlass und Farbe aus dem Namen ablesen |
| `js/outfit.js` | Kombinationen bauen und bewerten |
| `js/preferences.js` | Die gelernten Stilvorlieben |
| `js/weather.js` | Ortssuche und Vorhersage |
| `js/text.js` | Schreibweisen vereinheitlichen, Suche |

Die Daten liegen in `localStorage`, die Fotos in IndexedDB. Getrennt, weil
`localStorage` bei etwa fünf Megabyte zu Ende ist — das wären zwei Dutzend
Fotos.

Jeder Datensatz trägt `updatedAt`, gelöscht wird nur weich, und Bewertungen
werden nie geändert, sondern nur angehängt. Damit ließe sich später ein Sync
zwischen zwei Geräten einhängen, ohne die Anwendungslogik anzufassen.
