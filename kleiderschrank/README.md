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

Läuft über alle Apps im Repository.

### Symbole

Die App-Symbole werden erzeugt, nicht abgelegt:

```bash
npm run icons:kleiderschrank
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
