# Meilenstein 0: BLE-Proof-of-Concept

Ziel: herausfinden, **ob und wie** der Domyos Woodrower seine Live-Daten per Bluetooth LE liefert, und eine echte Trainingsaufzeichnung als Grundlage für den Simulator gewinnen.

| Datei | Zweck |
|---|---|
| `index.html` | Testseite: verbinden, Live-Werte, Service-Explorer, Protokoll, Aufzeichnung (JSON), Wiedergabe, Demo |
| `ftms.js` | FTMS-Konstanten und Parser für *Rower Data* (`0x2AD1`), Feature, Control Point |
| `ftms.test.mjs` | Parser-Tests: `node poc/ble/ftms.test.mjs` |

Keine Abhängigkeiten, kein Build. Die Seite braucht nur einen statischen Webserver.

---

## Vorbereitung (gilt für alle Tests)
- Woodrower einschalten (Konsole aufwecken – ein paar Schläge rudern).
- **e-Connected, Kinomap & Co. auf allen Geräten schließen**, Handy-Bluetooth ggf. aus. Das Gerät nimmt meist nur eine Verbindung an.
- Browser: **Chrome** (Android/Windows) oder Edge. Firefox und alle iOS-Browser können kein Web Bluetooth.

## Schritt 1 – Schnellcheck ohne Code (nRF Connect)
1. App **nRF Connect for Mobile** (Nordic Semiconductor) aus dem Play Store auf das Tablet.
2. *Scan* → Woodrower suchen (Name vermutlich „Domyos…“ o. ä.) → *Connect*.
3. Notieren / Screenshot:
   - Gibt es den Service **Fitness Machine** (`0x1826`)?
   - Darin **Rower Data** (`0x2AD1`)? → Pfeil-Symbol (Notify) antippen, rudern, kommen Werte?
   - Falls *kein* FTMS: alle Service-UUIDs notieren (die langen Nummern).

## Schritt 2 – Testseite am PC (falls der PC Bluetooth hat)
```bash
npx --yes http-server@14.1.1 poc/ble -p 8080 -c-1
```
Dann in Chrome `http://localhost:8080` öffnen → **Mit Rudergerät verbinden**.

## Schritt 3 – Testseite auf dem Samsung-Tablet
Web Bluetooth läuft nur über `https://` oder `localhost`. Bis das GitHub-Repo mit GitHub Pages steht, gibt es zwei Wege:

**a) Chrome-Flag (ohne Kabel, einfachster Weg)**
1. Am PC den Server wie in Schritt 2 starten (Windows-Firewall: Zugriff im *privaten* Netzwerk erlauben).
2. PC-IP herausfinden (`ipconfig` → IPv4-Adresse, z. B. `192.168.178.20`).
3. Auf dem Tablet in Chrome: `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → `http://192.168.178.20:8080` eintragen → *Enabled* → Chrome neu starten.
4. `http://192.168.178.20:8080` öffnen.

**b) USB-Portweiterleitung** (Entwickleroptionen + USB-Debugging am Tablet)
1. Tablet per USB anschließen, am PC in Chrome `chrome://inspect/#devices` → *Port forwarding* → `8080` → `localhost:8080`.
2. Auf dem Tablet `http://localhost:8080` öffnen.

**c) Später:** GitHub Pages → einfach die https-URL öffnen.

## Was die Seite tut
- **Mit Rudergerät verbinden:** zeigt nur Geräte mit FTMS. Taucht der Woodrower nicht auf → **Alle Geräte…** probieren.
- Liest Geräteinfo + FTMS-Features, abonniert automatisch Rower Data, Machine Status, Training Status, Control Point und Puls.
- **Service-Explorer:** zeigt alle sichtbaren Services/Characteristics; *lesen* / *abonnieren* per Klick (Rohdaten als Hex im Protokoll).
- **Control anfordern / Start senden:** Manche Geräte senden erst nach einem FTMS-*Start*. Nur nötig, wenn beim Rudern keine Daten kommen.
- **Aufzeichnung:** Jedes Paket wird mit Zeitstempel mitgeschnitten → *Aufzeichnung herunterladen* (JSON). Bildschirm bleibt dabei an.
- **Aufzeichnung abspielen / Demo-Daten:** zum Testen ohne Rudergerät.

## Testprotokoll – bitte festhalten
1. Taucht der Woodrower unter „Mit Rudergerät verbinden“ auf (= FTMS)? Gerätename?
2. Welche Felder kommen? (SPM, Schläge, Distanz, Pace, Watt, Zeit, Puls?)
3. **Update-Rate** (Kachel) – ~1 Hz oder schneller?
4. Reagieren die Werte schnell auf Tempowechsel? (Gefühlte Verzögerung in Sekunden)
5. Sind die Watt plausibel? (Locker ~80–120 W, zügig ~150–250 W)
6. Kommen Daten nur nach *Start senden*?
7. Bricht die Verbindung ab (z. B. bei Bildschirm-Aus)?
8. **10 Minuten mit Tempowechseln rudern** (3 min locker, 4× 30 s zügig / 30 s locker, 3 min locker) und die JSON-Datei herunterladen → nach `poc/ble/recordings/` legen.

Mit dieser Aufzeichnung baue ich in Meilenstein 1 den Simulator.
