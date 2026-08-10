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
  iPhone. Name und Marke kommen aus der offenen Produktdatenbank
  [Open Food Facts](https://world.openfoodfacts.org/); die Marke steht klein
  über der Bezeichnung.
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

## Bon einlesen

Wer online bestellt, will die Lieferung nicht von Hand abtippen. Unter
**Mehr → Bon einlesen** lässt sich die Bon-E-Mail einer
[Picnic](https://picnic.app)-Lieferung einfügen: kopieren, einfügen,
durchsehen, einbuchen.

Bewusst über die E-Mail und nicht über eine Schnittstelle. Picnic hat keine
offene Schnittstelle; die nachgebauten Zugänge verlangen die Zugangsdaten des
Kontos, an dem eine Zahlungsart hängt, brauchen einen Server dazwischen (der
Browser darf fremde Seiten nicht direkt abfragen) und können jederzeit
wegbrechen. Der Bon dagegen ist der eigene Beleg, und er wird auf dem eigenen
Gerät gelesen — nichts verlässt das Telefon.

### Wie der Bon gelesen wird

Beim Kopieren wird aus der Tabelle der E-Mail eine schlichte Folge von
Zeilen. Ein Artikel sieht darin so aus:

```
1                              ← Anzahl
Mylos Kritharaki<TAB><TAB>     ← Bildbeschreibung
Mylos Kritharaki               ← Bezeichnung
500g                           ← Größe
15% Rabatt                     ← nur manchmal
1                              ← Preis, in drei Zeilen zerlegt
69
.
```

Anker ist die **Größenzeile**: Sie steht bei jedem Artikel und sieht anders
aus als alles andere im Bon. Bezeichnung und Anzahl werden von dort aus
rückwärts gelesen. Die Preise werden gar nicht erst angefasst — sie zerfallen
beim Kopieren in einzelne Ziffernzeilen und wären nur eine Fehlerquelle.
Pfand, Tüten, Zwischensumme und Mehrwertsteuer stehen im selben Format wie
ein Artikel und werden deshalb ausdrücklich ausgeschlossen.

Die Größe wandert in den Namen: `Broccoli 500 g`. Denn „Frischkäse 300 g" und
„Frischkäse 150 g" sind zwei verschiedene Dinge im Schrank. Nur „1 Stück"
bleibt weg — das sagt nichts über die Packung.

### Die Marke aus dem Namen lösen

Beim Scannen liefert die Produktdatenbank die Marke getrennt mit. Auf einem
Bon steht sie einfach vorn im Namen: `Gut&Günstig Frischkäse Natur`. Damit
sie auch dort klein über der Bezeichnung stehen kann, muss sie abgetrennt
werden — und dabei ist Raten gefährlich: Aus „Zwiebeln rot" dürfte niemals
die Marke „Zwiebeln" und das Produkt „rot" werden.

Abgetrennt wird deshalb nur, was aus einer von zwei Quellen als Marke
**bekannt** ist (`js/brands.js`):

1. den Marken, die im eigenen Vorrat schon stehen — die stammen aus
   gescannten Barcodes und sind damit belegt, nicht geraten;
2. einer mitgelieferten Liste geläufiger Marken aus deutschen Supermärkten.

Alles andere bleibt unangetastet. Ein Name mit Marke drin ist harmlos; ein
falsch zerschnittener ist Unsinn im Vorrat. Die längste passende Marke
gewinnt (sonst bliebe von „Dr. Oetker" nur „Dr."), getrennt wird nur an einer
Wortgrenze („Arla" greift nicht in „Arlagurt"), und wenn hinterher nichts
Sinnvolles übrig bliebe, wird gar nicht getrennt.

Die Schnittstelle im Text lässt sich nicht über die Wortzahl finden:
„Gut&Günstig" ist ein Wort, vereinheitlicht aber zwei. Stattdessen wird der
Originaltext Zeichen für Zeichen verlängert, bis seine vereinheitlichte Form
der Marke entspricht — so bleibt die Schreibweise des Bons erhalten.

Für Produkte, die vor dieser Fassung über einen Bon hereinkamen, erscheint
unter **Mehr** die Karte **„Marken abtrennen"**. Sie zeigt, wie viele es
betrifft und zwei Beispiele, und verschwindet, sobald nichts mehr offen ist.

### Dasselbe Produkt auf zwei Wegen

Ein Produkt kommt gescannt oder vom Bon herein, und beide Wege schreiben es
anders:

```
gescannt:  Marke "Gut & Günstig"   Name "Frischkäse Natur 300g"
vom Bon:   Marke "Gut&Günstig"     Name "Frischkäse Natur 300 g"
```

Fürs Auge dasselbe, für einen Zeichenvergleich zwei Dinge — und die Suche
hilft hier nicht: Die ist fürs Tippen gebaut, verzeiht Tippfehler in einem
kurzen Suchwort, nicht abweichende Schreibweisen in einem langen Namen. Ohne
eigenen Vergleich entstand deshalb bei jedem Bon ein zweiter Eintrag
derselben Sache.

`js/dedupe.js` gibt jedem Produkt einen Schlüssel aus seinen Wörtern:
vereinheitlicht, Zahl und Einheit getrennt (`300g` wird zu `300 g`),
Füllwörter (`und`) weg, Einheiten vereinheitlicht (`gr` → `g`), sortiert.
Gleiche Schlüssel heißen: dasselbe Produkt.

Der Schlüssel ist bewusst streng. Die Größe bleibt darin, damit „Frischkäse
300 g" und „Frischkäse 150 g" zwei Dinge bleiben — das sind sie im Schrank
auch. Und ein Produkt ganz ohne Marke gilt nicht als dasselbe wie eines mit:
Es könnte von jedem Hersteller sein. Lieber ein Doppel übersehen als zwei
verschiedene Sachen zusammenwerfen — Ersteres sieht man und kann es beheben,
Letzteres verdirbt stillschweigend den Bestand.

Das greift an drei Stellen:

- **Beim Bon-Einlesen** wird der Schlüssel vor der Suche geprüft. Ein
  gescanntes Produkt wird dadurch sicher wiedergefunden.
- **Beim Scannen** bekommt ein Produkt, das ohne Barcode im Vorrat steht
  (also über einen Bon kam), den Barcode ergänzt, statt ein zweites Mal
  angelegt zu werden. Ab dann wird es beim Scannen sofort gefunden.
- **Für schon vorhandene Doppel** erscheint unter **Mehr** die Karte
  **„Doppelte zusammenführen"**. Bestand, Buchungen und
  Einkaufszettel-Einträge wandern auf den Eintrag mit Barcode — der ist die
  bessere Kennung, weil man ihn durch erneutes Scannen wiederfindet. Fehlt
  ein Barcode auf beiden Seiten, gewinnt der ältere Eintrag. Ergänzt wird nur,
  wo etwas fehlt; nichts wird überschrieben, und der höhere Mindestbestand
  gilt.

Nach dem Zusammenführen rechnet die Prognose mit der gemeinsamen Geschichte —
vorher hatte jede Hälfte nur ihre eigene.

### Warum nichts ungefragt gebucht wird

Picnic liefert **keine Barcodes** mit, nur Bezeichnungen. Die App muss also
raten, welches Produkt im Vorrat gemeint ist, und Geratenes wird nicht
stillschweigend gebucht: Die Prüfliste zeigt je Zeile, wohin sie geht, und
lässt beides ändern — Ziel und Ob-überhaupt. Ein falsch zugeordneter Einkauf
verdürbe die Prognose gleich zweier Produkte.

Jede bestätigte Zuordnung wird gemerkt (Bezeichnung → Produkt). Ab dem
zweiten oder dritten Einkauf läuft deshalb das meiste von allein durch. Die
Bestellnummer wird ebenfalls vermerkt, damit ein zweites Einlesen desselben
Bons auffällt, bevor alles doppelt zählt.

Gebucht wird **ohne** Haltbarkeitsdatum. Das steht auf der Packung und nicht
im Bon, und zwanzig Abfragen hintereinander wären keine Erleichterung —
nachtragen lässt es sich im Vorrat je Produkt.

### Wenn etwas schiefging

**„Feld leeren"** wirft den eingefügten Text weg. Auf dem Handy ist einen
langen Text von Hand zu markieren und zu löschen unnötig mühsam.

**„Diesen Bon zurücknehmen"** macht einen eingebuchten Bon vollständig
rückgängig — der Fall, dass beim Kopieren eine Zeile fehlte und man es erst
hinterher merkt. Ohne diesen Weg müsste man zwanzig Chargen einzeln löschen
und die neu angelegten Produkte hinterher auch noch.

Zurückgenommen wird nur, was dieser Bon selbst angelegt hat: seine Chargen,
seine Einkaufsbuchungen und die Produkte, die es vorher nicht gab. Ein
Produkt, das inzwischen anderswoher Bestand oder Buchungen hat, bleibt
stehen — es gehört nicht mehr allein zu diesem Bon. Die Bestellnummer wird
wieder freigegeben, damit derselbe Bon erneut eingelesen werden kann, und
Zuordnungen, die ins Leere zeigen würden, werden aufgeräumt.

Dafür wird einmal nachgefragt. Ein Fehlgriff kostete zwanzig Buchungen, und
einen Weg zurück gibt es dafür nicht — nur den Bon noch einmal einzulesen.

## Punkt auf dem App-Symbol

Unter **Mehr → Einstellungen** lässt sich ein Punkt auf dem Startbildschirm
einschalten. Er zeigt dieselbe Zahl wie der Reiter *Ablauf*: was innerhalb
der Warnfrist aufgebraucht werden sollte, samt dem, was schon abgelaufen ist.

Die Einkaufsliste zählt bewusst **nicht** mit. Die braucht keine
Aufmerksamkeit, solange man zu Hause ist — die schaut man im Laden an. Ein
Punkt, der ständig da ist, wird nach zwei Wochen nicht mehr gelesen; kein
Punkt soll heißen: nichts liegt an.

**Was der Punkt nicht kann, ist wichtiger als was er kann:** Eine Web-App
rechnet nur, während sie läuft. Die Zahl entsteht in dem Augenblick, in dem
die App zuletzt offen war — deshalb wird beim Zuklappen (`visibilitychange`)
noch einmal nachgerechnet — und steht dann so lange, bis die App wieder
geöffnet wird. Kommt am Donnerstag etwas dazu, zählt sie nicht von selbst
hoch. Er ist ein Merkzettel, kein Wecker, und genau so steht es auch im
Schalter. Für einen echten Wecker bräuchte es Push-Mitteilungen und dafür
einen Dienst im Netz.

Aus, bis jemand ihn einschaltet. Gefragt wird erst beim Umlegen des
Schalters, nicht beim Start: Eine Erlaubnisfrage aus dem Nichts ist die
sicherste Art, ein „nein“ zu bekommen, das sich nicht zurücknehmen lässt.
Auf dem iPhone hängt der Punkt an der Mitteilungs-Erlaubnis (ab iOS 16.4, nur
vom Startbildschirm aus), auf Android braucht es sie nicht. Unter dem
Schalter steht der tatsächliche Zustand — auch dann, wenn das Gerät es nicht
kann oder die Erlaubnis fehlt.

## Sicherung

Der Vorrat liegt allein auf dem jeweiligen Gerät. Das ist Absicht — niemand
muss ein Konto anlegen, und niemand sonst sieht, was in eurer Küche steht.
Die Kehrseite: Geht das Handy verloren oder räumt der Browser auf, ist die
ganze Arbeit fort. Drei Dinge halten dagegen:

**Die App bittet den Browser, die Daten zu behalten**
(`navigator.storage.persist()`). Ohne diese Bitte gelten sie als bei
Gelegenheit entbehrlich; Safari verwirft Daten von Seiten, die länger nicht
besucht wurden, ohnehin von sich aus. Die Bitte kostet nichts und wird still
gewährt oder abgelehnt — je nach Browser danach, ob die App auf dem
Startbildschirm liegt. Was dabei herauskam, steht unter **Mehr → Daten**.

**Unter „Daten" steht, wann zuletzt gesichert wurde**, wie viele Produkte und
Buchungen gespeichert sind und wie viel Platz das belegt. Bei etwa fünf
Megabyte ist `localStorage` zu Ende — so lässt sich am Gerät ablesen, ob das
je ein Thema wird.

**Ist es lange her, erinnert die App** — aber über der Vorratsliste, nicht
unter „Mehr", denn dort sähe die Erinnerung niemand. Sie hält sich an drei
Regeln: Sie kommt erst ab fünf erfassten Produkten (vorher wäre der Verlust
in fünf Minuten aufgeholt), nach vierzehn Tagen ohne Sicherung, und wer sie
wegwischt, hat eine Woche Ruhe. Unter „Daten" bleibt der Zustand derweil
sichtbar — vertagt ist nicht erledigt.

Gesichert wird über das Teilen-Menü, wo es das gibt. Auf dem iPhone führt der
übliche Weg — ein Link mit `download` — in einer vom Startbildschirm
gestarteten App oft ins Leere: Die Datei landet bestenfalls kommentarlos
irgendwo. Über das Teilen-Menü landet sie dort, wo man sie hinlegt, und man
sieht, dass etwas passiert ist.

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

## Prognosen zurücksetzen

Beim Einpflegen entstehen Buchungen, die nichts über den tatsächlichen
Verbrauch aussagen — ein paarmal auf `+` und `−` getippt, und die App hält
das für Gewohnheit. Unter **Mehr → Prognosen zurücksetzen** lässt sich die
gesamte Verbrauchshistorie verwerfen; für einzelne Produkte steht derselbe
Knopf in der Detailansicht, sobald es dort etwas zu verwerfen gibt.

Verworfen werden ausschließlich die Buchungen. **Bestand, Haltbarkeitsdaten
und Einkaufsliste bleiben unangetastet**, und danach zählt jede neue Buchung
wieder normal.

Dabei wandert auch der Beobachtungsbeginn (`observedSince`) auf jetzt. Ohne
das zählte die Zeit vor dem Zurücksetzen als Zeitraum ohne Verbrauch — die
geschätzte Rate fiele gegen null und die App verspräche eine viel zu lange
Reichweite.

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

## Marke und Bezeichnung

Wird ein Produkt gescannt, übernimmt die App Marke und Bezeichnung
**getrennt** und stellt sie übereinander:

```
BARESA
Tomaten passiert 500 g
```

Das hält die Zeile lesbar: Die Marke hilft beim Wiedererkennen im Regal,
benennt aber nicht die Sache selbst und würde den Namen in der schmalen
Zeile sonst verdrängen. Ohne Marke — bei allem, was von Hand angelegt wurde
— bleibt die Zeile unverändert.

Drei Dinge hängen mit daran:

- **Die Mengenangabe gehört zur Bezeichnung.** „Passata 500 g" und
  „Passata 700 g" sind im Vorrat zwei verschiedene Dinge; der Name bricht
  deshalb notfalls auf zwei Zeilen um, statt abgeschnitten zu werden.
- **Die Marke ist suchbar.** „baresa" findet die Passata. Ein gleich guter
  Treffer in der Bezeichnung steht aber vorn — wer „Passata" tippt, meint
  das Produkt und nicht die Firma, die zufällig so heißt.
- **Die Marke fließt in die Kategorie ein.** Bei „Miracel Whip" steckt der
  entscheidende Hinweis genau dort und nicht in der Bezeichnung.

Nachtragen oder ändern lässt sich die Marke jederzeit im Produktdialog.

### Produkte aus früheren Fassungen

Alles, was gescannt wurde, bevor es das Markenfeld gab, trägt die Marke fest
im Namen („Baresa Tomaten passiert 500 g") und hat kein eigenes Feld — die
Anzeige findet dort nichts zum Hochsetzen.

Für diese Fälle erscheint unter **Mehr** ein Abschnitt *Marken nachtragen*.
Er ist nur sichtbar, solange es Produkte mit Barcode und ohne Marke gibt,
schlägt sie über den Barcode nach und trennt sie vom Namen ab. Angefasst
wird nur, was beides erfüllt: Von Hand angelegte Produkte ohne Barcode und
solche mit bereits gesetzter Marke bleiben unberührt.

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

Deshalb trägt der Reiter auch **zwei Zahlen** statt einer Summe: gefüllt, was
auf eurer Liste steht, und daneben umrandet, was die App bloß vorschlägt.
Abgehaktes zählt nicht mit — die erste Zahl beantwortet die Frage „wie viel
steht noch aus". Als Summe sah der Einkauf größer aus, als er war, und man
wusste vor dem Antippen nicht, wovon die Zahl eigentlich sprach.

**Einkaufsliste** — was ihr tatsächlich kauft. Sie entsteht nur durch eure
Entscheidung: über das Feld **„Was fehlt noch?"** oder durch Übernehmen eines
Vorschlags.

- **Die Stückzahl** steht als antippbarer Chip in der Zeile („3×"). Ein Tipp
  zählt hoch, nach neun beginnt sie wieder bei eins — ein Dialog für eine
  einstellige Zahl wäre im Laden umständlicher als ein zweiter Tipp. Größere
  Mengen schreibt man gleich mit: **„12 Eier"** ergibt zwölf Stück.
  Packungsgrößen bleiben dabei unangetastet — „500 g Mehl" ist eine Packung,
  keine fünfhundert.
- **Antippen** hakt einen Eintrag ab (durchgestrichen, rutscht ans Ende) —
  die Geste für den Laden. Abhaken bucht bewusst noch nichts ein: Im Wagen
  liegen heißt nicht im Schrank stehen.
- **`+`** bucht ein, samt Haltbarkeitsdatum — der Schritt für zu Hause. Die
  notierte Stückzahl ist dabei vorbelegt; der Eintrag verschwindet danach.
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

### Warum das Scannen schnell geht

Ein EAN-13 besteht aus 95 Strichen. Ob er gelesen wird, hängt fast nur daran,
wie viele Bildpunkte auf einen Strich entfallen — unter zwei bis drei
verschwimmt er, und der Scan scheitert nicht einmal sichtbar, er findet
einfach nichts. Daran hängen vier Entscheidungen:

**Die Kamera wird um ein großes Bild gebeten.** Ohne Angabe liefern viele
Browser 640×480. Gemessen an derselben Packung im selben Abstand: bei 640×480
9 von 20 Bildern erkannt, bei 1280×720 alle 20.

**Durchsucht wird der Sucherrahmen, nicht der Sensor.** Ein hochkant
gehaltenes Telefon zeigt von einem 16:9-Kamerabild nur einen schmalen
senkrechten Streifen — bei 390×844 Fenster und 1280×720 Kamera ganze 26 %
der Fläche. Der weiße Rahmen wird auf Kamerapunkte umgerechnet und in voller
Schärfe durchsucht; das ist rund ein Zwölftel des Bildes. Jeder vierte
Versuch nimmt stattdessen alles, was auf dem Schirm steht, damit ein Code
über oder unter dem Rahmen nicht übersehen wird.

Das ist zugleich eine Korrektur: Vorher wurde der ganze Sensor durchsucht,
und der Scanner konnte den Code einer Packung melden, die daneben lag und gar
nicht im Bild war. Gelesen wird jetzt, was man sieht.

**Verkleinert wird nicht mehr.** Das Bild vor der Erkennung auf 800 Punkte zu
schrumpfen kostet genau die Feinheit, auf die es ankommt: bei einem Code mit
drei Bildpunkten je Strich wurden verkleinert 2 von 20 Bildern erkannt, im
Ausschnitt 20 von 20.

**Jedes Kamerabild wird angesehen.** Vorher lief alle 250 ms ein Versuch —
vier Bilder von dreißig. Beim Zielen ist die Hand unruhig und der Autofokus
sucht, die meisten Bilder sind unbrauchbar; wer nur jedes achte ansieht,
verpasst die scharfen. Über `requestVideoFrameCallback` wird jetzt jedes
Bild geprüft, sobald es da ist, und der nächste Versuch erst angesetzt, wenn
der vorige durch ist. Gemessen an einem Video, in dem nur jedes zwölfte Bild
scharf ist: 1,3 s vorher, 0,46 s jetzt.

Dazu kennt ZBar nur noch die Formate, die auf Verpackungen vorkommen (statt
zusätzlich QR, PDF417, Code 39, Codabar, Databar) und tastet jede zweite
Zeile ab: zusammen 38 ms je Bild vorher, 14 ms jetzt.

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
js/backup.js        Wann an eine Sicherung erinnert wird
js/badge.js         Der Punkt auf dem App-Symbol
js/receipt.js       Liest den Bon einer Picnic-Lieferung
js/brands.js        Trennt bekannte Marken vom Produktnamen
js/dedupe.js        Erkennt, wann zwei Einträge dasselbe Produkt meinen
js/format.js        Aufbereitung der Zahlen für die Anzeige
js/app.js           Verdrahtung von Daten und Oberfläche
vendor/zbar-wasm/   Barcode-Erkennung für iOS (LGPL, siehe Ordner-README)
tests/              Tests der Rechenlogik
```

Kein Build-Schritt: Was im Repository liegt, ist das, was im Browser läuft.
Einzige Fremdkomponente ist die Barcode-Erkennung unter `vendor/` — und die
wird nur auf Geräten geladen, die sie brauchen.
