# Mein Training

Eine kleine Web-App fürs Trainingstagebuch: **Wiederholungen und Gewichte
eintragen** — und sehen, dass es vorangeht.

Sie beantwortet die zwei Fragen, für die man sonst im alten Heft blättert:
*Was habe ich beim letzten Mal geschafft?* und *Was nehme ich heute?*

Läuft im Browser, ohne Konto, ohne Server, ohne Installation. Auf dem Handy
lässt sie sich zum Startbildschirm hinzufügen und verhält sich dann wie eine
App.

## Was sie kann

- **Sätze eintragen** — Übung, Gewicht, Wiederholungen, fertig. Das Gewicht
  steht schon drin, bevor man das Feld anfasst: Es ist der Vorschlag aus dem
  eigenen Verlauf. Drei Sätze sind dreimal derselbe Knopf, und der Dialog
  bleibt dabei offen.
- **Trainingspläne** — mehrere Übungen in einer Reihenfolge, unter einem
  Namen: Push, Pull, Beine. Auf der Startseite steht der Plan, der am
  längsten nicht dran war, ganz vorn; ein Tipp auf **Training starten**
  öffnet gleich die erste Übung. Was abgearbeitet ist, hakt sich von selbst
  ab.
- **Übungen anlegen, ohne Formulare auszufüllen** — Muskelgruppe, Gerät und
  Art liest die App aus dem Namen ab. „KH Schrägbankdrücken" wird ohne
  weiteres Zutun zu einer Brustübung mit der Kurzhantel in 2-kg-Schritten.
  Was nicht stimmt, lässt sich in einem Aufklapper korrigieren — und eine
  einmal von Hand gesetzte Angabe wird nie wieder überstimmt.
- **Oder aus der Liste wählen** — unter *Übungen* liegen dreißig gängige
  Übungen nach Muskelgruppen sortiert: antippen, hinzufügen, fertig.
  Angelegt wird nur, was angetippt wurde; ein Verzeichnis voller Übungen,
  die niemand macht, macht jede Suche länger und jede Auswertung unschärfer.
  Was schon dabei ist, steht abgehakt da und lässt sich nicht doppelt
  anlegen.
- **Wissen, was heute drankommt** — nach der Regel, die in jedem
  Anfängerplan steht: alle Sätze am Ziel, also mehr Gewicht. Dazu ein Satz,
  warum („Letztes Mal alle 3 Sätze mit 8 Wdh. — leg 2,5 kg drauf").
- **Bestwerte im selben Moment** — schwerstes Gewicht, meiste
  Wiederholungen, größte Kraft. Sie stehen da, wenn sie passieren, und nicht
  drei Wochen später in einer Auswertung.
- **Fortschritt sehen** — Volumen je Woche als Balken, die geschätzte Kraft
  je Übung als Kurve, die Verteilung auf die Muskelgruppen als Bild.
- **Satzpause** — läuft nach jedem Satz von selbst los, mit Vibration am
  Ende, und richtet sich nach der Übung: Kniebeugen bekommen mehr Pause als
  Seitheben.
- **Aufwärmsätze** — mitschreiben, aber nicht mitzählen. Sie stünden sonst
  in jedem Bestwert und in jedem Volumen mit drin.
- **Kilogramm oder Pfund** — umgestellt wird die Anzeige, nicht der
  Datenbestand.

## Was sie nicht tut

Es geht **nichts an einen Server**. Gerechnet wird auf dem Gerät,
gespeichert wird auf dem Gerät. Diese App ruft nach dem ersten Laden
überhaupt nichts mehr ab — sie funktioniert im Keller genauso wie im WLAN.

Es gibt kein Konto, keine Anmeldung und keinen Schlüssel, der irgendwann
abläuft.

## Loslegen

### Auf dem Handy nutzen (empfohlen)

Die App besteht nur aus statischen Dateien und läuft über GitHub Pages:

1. Im Repository unter **Settings → Pages** als Quelle den Branch wählen, auf
   dem dieser Code liegt, Ordner `/ (root)`.
2. Nach ein paar Minuten ist sie unter
   `https://<benutzername>.github.io/Kitchen-App-/fitness/` erreichbar.
3. Die Seite auf dem Handy öffnen und über das Browsermenü **„Zum
   Startbildschirm hinzufügen"** wählen.

Danach läuft sie auch offline.

### Lokal ausprobieren

```bash
npm run serve       # http://localhost:8080/fitness/
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
npm run icons:fitness
```

Das Skript zeichnet die Hantel aus Abstandsfunktionen und schreibt SVG und
PNG in `icons/`. Wer die Farbe ändern will, ändert sie an einer Stelle und
lässt neu erzeugen — sonst bliebe auf dem Startbildschirm monatelang das
alte Blau stehen.

### Eine neue Fassung veröffentlichen

Änderungen auf den Branch pushen, den GitHub Pages bedient. Auf den Handys
kommt die neue Fassung beim nächsten Öffnen von selbst an.

Eine Sache ist dabei von Hand zu pflegen: die Versionsnummer an **beiden**
Stellen, weil der Service Worker als eigenständige Datei läuft und nichts aus
der App importieren kann.

- `js/app.js` → `APP_VERSION`
- `sw.js` → `CACHE` (`training-v<nummer>`)

`npm test` schlägt fehl, wenn die beiden auseinanderlaufen.

## Wie der Vorschlag entsteht

Doppelte Progression, in zwei Sätzen:

1. Ein Gewicht bleibt so lange stehen, bis **alle** Sätze das
   Wiederholungsziel erreichen.
2. Dann steigt es um den kleinsten Schritt, den das Gerät hergibt — und die
   Wiederholungen fallen von selbst wieder darunter.

Deshalb wird beim Anlegen einer Übung überhaupt nach dem Gerät gefragt: An
der Langhantel sind 2,5 kg der kleinste Schritt, an der Kurzhantel 2, am
Block einer Maschine oft 5. Ein Vorschlag „nimm 1 kg mehr" wäre an einer
Maschine nicht ausführbar.

Zwei Sonderfälle hat die Regel:

- **Körpergewichtsübungen ohne Zusatzgewicht** wachsen in Wiederholungen.
  Wer sechs Klimmzüge schafft, hängt sich nicht als Nächstes eine Scheibe
  um — er macht sieben.
- **Zwei Trainings deutlich unter dem Ziel** führen zu zehn Prozent weniger
  Gewicht. Ein schlechter Tag ist ein schlechter Tag; zwei hintereinander
  sind ein Muster, und dann ist weniger Gewicht der schnellere Weg nach
  oben.

Der Vorschlag steht in den Eingabefeldern schon drin und lässt sich mit zwei
Fingertipps überschreiben. Er ist ein Vorschlag, keine Vorschrift.

## Was in einem Plan steht — und was nicht

Ein Plan ist eine **Reihenfolge von Übungen** und sonst nichts. Kein
Gewicht, keine Satzzahl, keine Wochentage.

Das ist die wichtigste Entscheidung an der Stelle. Ein Plan, in dem
„Bankdrücken 3 × 8 @ 60 kg" stünde, wäre nach zwei Wochen falsch — und dann
gäbe es zwei Wahrheiten über dasselbe Training, eine im Plan und eine im
Verlauf. So gibt es nur eine: Was heute drankommt, folgt aus dem, was
zuletzt wirklich passiert ist. Auch die Satzzahl, an der die Abhakliste
misst, kommt von dort — wer eine Übung einmal mit vier statt drei Sätzen
macht, verschiebt damit nicht seinen Plan.

Und deshalb stehen auch keine Wochentage darin. Wer dreimal die Woche Push,
Pull und Beine macht, hält keinen Kalender ein — er nimmt den Plan, der am
längsten nicht dran war. Genau in dieser Reihenfolge liegen sie auf der
Startseite.

Drei Wege führen zu einem Plan:

- **Zusammenstellen** — „Neuer Plan", Name, Übungen suchen und antippen, die
  Reihenfolge mit den Pfeilen sortieren.
- **Aus einem gelaufenen Training** — im Verlauf eine Einheit öffnen und
  **Als Plan speichern**. Der bequemste Weg: einmal trainieren und danach
  sagen „so wieder".
- **Gar nicht** — ohne Plan zeigt die Startseite wie bisher, was zuletzt
  dran war. Pläne sind ein Angebot, keine Voraussetzung.

Ein gelöschter Plan nimmt seine Trainings nicht mit: Was im März nach dem
alten Plan lief, hat im März stattgefunden. Der Name bleibt deshalb an der
Einheit stehen, auch wenn es den Plan nicht mehr gibt.

## Wie die Kraft geschätzt wird

Aus jedem Satz lässt sich hochrechnen, was für eine einzige Wiederholung
gereicht hätte — nach Epley:

```
Maximalgewicht ≈ Gewicht × (1 + Wiederholungen / 30)
```

Das ist die gebräuchlichste Formel, kommt ohne Tabelle aus und ist im
üblichen Bereich genau genug. Sie ist auch der Grund, warum die App zwei
Sätze überhaupt vergleichen kann: 90 kg mal 8 ist mehr als 100 kg mal 3, und
das sähe man einer Gewichtsspalte allein nicht an.

Ihre Grenze ist bekannt und wird mitgeführt: Oberhalb von zwölf
Wiederholungen schätzt sie zu hoch, weil dort die Ausdauer den Ausschlag
gibt und nicht die Kraft. Die App rechnet weiter, schreibt es aber dazu,
statt es zu verschweigen.

## Was mitzählt und was nicht

- **Aufwärmsätze** zählen nirgends mit — nicht im Volumen, nicht in den
  Bestwerten, nicht im Vorschlag.
- **Körpergewichtsübungen** zählen im Volumen nur mit, wenn in den
  Einstellungen ein Körpergewicht steht. Ohne diese Angabe bewegen
  Klimmzüge rechnerisch nichts, und die App behauptet lieber zu wenig als
  etwas Erfundenes. Sie sagt an der Stelle, wo es auffällt, auch warum.
- **Zeitübungen** tragen kein Volumen bei. Eine gehaltene Planke bewegt kein
  Gewicht; sie in Kilogramm umzurechnen wäre eine Erfindung. Ihr Bestwert
  ist die Zeit.

## Wann eine Einheit anfängt und aufhört

Es gibt keinen Knopf „Training starten". Die Einheit fängt an, wenn der
erste Satz eingetragen wird — alles andere wäre ein Schritt, den man
vergessen kann und dessen Vergessen später wehtut.

Beenden kann man von Hand. Wer es vergisst — und man vergisst es, man packt
die Tasche und geht —, dem schließt die App die Einheit nach sechs Stunden
ohne neuen Satz von selbst, und zwar rückwirkend beim letzten Satz. Ein
Training, das um 19 Uhr aufhörte und am nächsten Morgen geschlossen wird,
dauerte nicht dreizehn Stunden.

## Aufbau

| Datei | Wofür |
| --- | --- |
| `js/app.js` | Oberfläche: ein Zustand, ein Zeichenweg |
| `js/model.js` | Übungen, Einheiten, Sätze |
| `js/storage.js` | Persistenz, weiches Löschen, Zusammenführen zweier Stände |
| `js/plans.js` | Trainingspläne, Reihenfolge und Rotation |
| `js/muscles.js` | Muskelgruppe, Gerät und Art aus dem Namen ablesen |
| `js/stats.js` | Bestwerte, Verläufe, Wochenvolumen, Serie |
| `js/progression.js` | Der Vorschlag fürs nächste Mal |
| `js/chart.js` | Die Geometrie der Diagramme |
| `js/timer.js` | Die Satzpause |
| `js/format.js` | Einheiten und Aufbereitung der Zahlen |
| `js/text.js` | Schreibweisen vereinheitlichen, Suche |

Die Daten liegen in `localStorage`. Jeder Satz ist ein eigener Datensatz mit
Zeitstempel und nicht eine Zeile in der Einheit: So muss beim Eintragen
nicht der ganze Trainingstag neu geschrieben werden, und zwei Geräte am
selben Training überschreiben sich nicht gegenseitig.

Jeder Datensatz trägt `updatedAt`, gelöscht wird nur weich, und Sätze werden
beim Zusammenführen nur ergänzt und nie überschrieben. Damit ließe sich
später ein Sync zwischen zwei Geräten einhängen, ohne die Anwendungslogik
anzufassen.

Keine Bibliothek, kein Build-Schritt: Was im Repository liegt, ist das, was
im Browser läuft.
