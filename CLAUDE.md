# Arbeitsweise in diesem Repository

Drei Apps in derselben Bauweise: **Küchenvorrat** im Wurzelverzeichnis,
**Mein Kleiderschrank** in `kleiderschrank/`, **Mein Training** in `fitness/`.
Statische Dateien, ES-Module, kein Build-Schritt, keine Abhängigkeiten. Was im
Repository liegt, ist das, was im Browser läuft.

## Veröffentlichen

GitHub Pages liefert den Standard-Branch `claude/kitchen-inventory-app-v3gm0n`
aus. Eine Änderung ist also erst dann auf dem Handy, wenn sie dort liegt.

**Abgesprochen am 19.8.2026: Fertige Änderungen werden als Pull Request
aufgemacht und selbst gemergt** — nicht liegen lassen, nicht vorher fragen.
Danach braucht Pages ein bis zwei Minuten, und die App aktualisiert sich beim
nächsten Öffnen von selbst.

Vor dem Merge:

- `npm test` muss grün sein. Der Befehl läuft über alle drei Apps.
- Bei einer Änderung an einer App die Versionsnummer an **beiden** Stellen
  erhöhen: `js/app.js` (`APP_VERSION`) und `sw.js` (`CACHE`). Ein Test wacht
  darüber, dass die beiden übereinstimmen — aber nicht darüber, dass sie
  erhöht wurden. Bleibt die Nummer stehen, behalten die Handys die alte
  Fassung im Cache, und die Änderung kommt nie an.
- Bei einer neuen Datei unter `js/`: in die Liste in `sw.js` eintragen. Sonst
  läuft die App online einwandfrei und bricht offline an einer Stelle.

## Sprache und Stil

- Alles auf Deutsch: Oberfläche, Kommentare, Commit-Nachrichten, README.
- Kommentare begründen Entscheidungen, statt zu beschreiben, was ohnehin
  dasteht. Wo eine Zeile überrascht, gehört der Grund daneben.
- Bezeichner im Code sind ASCII (`groesse`, `laenge`), Text für Menschen nicht.

## Tests

```bash
npm test                 # alle drei Apps
node --test "fitness/tests/*.test.js"
```

Die Rechenlogik liegt in kleinen Modulen ohne DOM-Zugriff und wird dort
geprüft. Dazu kommen die Stellen, an denen ein Fehler still bliebe: die
Dateiliste des Service Workers, der Gleichlauf der Versionsangaben und die
Kennungen, die `app.js` in `index.html` sucht.
