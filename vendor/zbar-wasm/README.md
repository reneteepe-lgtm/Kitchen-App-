# zbar-wasm

Fremdkomponente, unverändert übernommen — nur der Verweis auf eine nicht
mitgelieferte Source-Map wurde aus `zbar-wasm.mjs` entfernt.

| | |
|---|---|
| Paket | [`@undecaf/zbar-wasm`](https://github.com/undecaf/zbar-wasm) |
| Version | 0.11.0 |
| Lizenz | LGPL-2.1+ (siehe `LICENSE`) |
| Grundlage | [ZBar](https://github.com/mchehab/zbar), nach WebAssembly übersetzt |

## Wozu

Barcodes werden auf Android von der Browser-Schnittstelle `BarcodeDetector`
erkannt. Auf iOS gibt es die nicht — Apple hat sie nie implementiert, und weil
alle Browser auf iPhone und iPad WebKit verwenden, hilft dort auch kein
anderer Browser. Diese Bibliothek übernimmt die Erkennung an genau dieser
Stelle, damit der Scan auf beiden Systemen funktioniert.

Geladen wird sie erst, wenn sie gebraucht wird: Auf Android bleibt sie
ungenutzt und wird gar nicht erst heruntergeladen.

## Aktualisieren

```bash
npm pack @undecaf/zbar-wasm
tar xzf undecaf-zbar-wasm-*.tgz
cp package/dist/index.mjs  vendor/zbar-wasm/zbar-wasm.mjs
cp package/dist/zbar.wasm  vendor/zbar-wasm/zbar.wasm
cp package/LICENSE         vendor/zbar-wasm/LICENSE
```

Danach in `zbar-wasm.mjs` die letzte Zeile (`//# sourceMappingURL=…`) löschen
und die Versionsangabe oben anpassen. `zbar.wasm` muss neben der `.mjs`-Datei
liegen — die Bibliothek sucht sie relativ zu ihrem eigenen Pfad.

Die Dateiliste im Service Worker (`sw.js`) enthält beide Dateien, damit der
Scanner auch offline verfügbar bleibt.
