# Ergebnis BLE-PoC – Domyos Woodrower

Aufzeichnung: [recordings/woodrower-2026-11-16-18-56-39.json](recordings/woodrower-2026-11-16-18-56-39.json) · Samsung SM-X710, Chrome 156 · 16.11.2026

## Kurzfazit
✅ **Der Woodrower spricht Standard-FTMS.** Verbindung, Rower Data, Status-Events und Geräteinfos funktionieren direkt aus Chrome auf dem Tablet, ohne Start-Befehl und ohne proprietäres Protokoll. Das größte technische Risiko des Projekts ist damit erledigt. Die Web-App-Strategie (Chrome + Web Bluetooth) trägt.

## Gerät
| | |
|---|---|
| BLE-Name | `Domyos-ROW-0254` |
| Hersteller / Modell | DECATHLON / 8604435 |
| Firmware | Console 2.5.0 · Bluetooth 2.6.0 · B805 2.5.0 |
| FTMS-Features | Cadence, Total Distance, Pace, Resistance Level, Expended Energy, Heart Rate, Elapsed Time, Power Measurement · Target: Resistance |

## Rower Data (`0x2AD1`)
- Immer dieselben Flags **`0x0BAE`**, 23 Bytes, spec-konform (keine Parserfehler in 381 Paketen):
  SPM + Schlagzähler, Ø-SPM, Distanz, Pace, Leistung, Widerstand, Energie, Puls, Zeit.
- **Paketrate ~4 Hz** (Median 253 ms, 95–394 ms). Aber 75 % der Pakete sind identisch mit dem vorherigen: Die Werte ändern sich effektiv etwa **1× pro Sekunde bzw. pro Schlag**.
- **Schlagzähler** springt pro Schlag um 1, im Abstand von ca. 1,0–1,5 s → als **Schlag-Trigger für die Ruderanimation** nutzbar. Auf ±250 ms genau, weil Pakete alle ~250 ms kommen.
- **Pace und Watt hängen exakt über die Concept2-Formel zusammen** (Abweichung < 2 %). Die Konsole rechnet das eine aus dem anderen. Für das Spiel heißt das: Watt und 500m-Zeit sind gleichwertige Zielgrößen, die Bänder passen automatisch zueinander.
- **Widerstand** wird als Stufe 1–… gemeldet (Rower Data ganzzahlig, Machine Status in 0,1-Schritten: `07 3c` = 6,0).
- **Puls** immer 0: Kein Brustgurt gekoppelt. Kommt ein Gurt an die Konsole, steht der Puls vermutlich gleich mit drin.
- **Auto-Pause:** Hört man auf zu rudern, fallen SPM/Watt/Pace auf 0, die Gerätezeit bleibt stehen, Distanz und Schläge bleiben erhalten.

## Status-Events
| Characteristic | Beobachtet | Bedeutung |
|---|---|---|
| Machine Status `0x2ADA` | `04` | Gestartet/Fortgesetzt |
| | `02 02` | Pausiert |
| | `07 1e` → `07 32` → `07 3c` | Widerstand 3,0 → 5,0 → 6,0 (am Gerät gedreht) |
| Training Status `0x2AD3` | `01 0d` / `01 01` | Manuell (Quick Start) / Leerlauf |

→ Pause und Start lassen sich im Spiel direkt aus den Events erkennen (z. B. Spiel automatisch pausieren).

## 10-Minuten-Test (16.11.2026, 20:13)
Aufzeichnung: [recordings/woodrower-2026-11-16-19-13-47-10min.json](recordings/woodrower-2026-11-16-19-13-47-10min.json)

| | |
|---|---|
| Dauer | 618 s Verbindung, 608 s Gerätezeit |
| Ergebnis | 1.689 m · 242 Schläge · 48 kcal · Widerstand 6–7 |
| Leistung | locker 45–60 W, zügig 85–100 W, Spitze 178 W |
| Schlagfrequenz | 20–30 spm |
| Pakete | 2.474 Rower Data, **0 Fehler**, längste Lücke 716 ms, **kein Verbindungsabbruch** |
| Effektive Datenrate | 1,4 Wertänderungen pro Sekunde |

**Bewertung**
- ✅ **Stabil:** 10 Minuten ohne Abbruch oder Lücke über 1 s.
- ✅ **Schlagfrequenz plausibel:** Aus dem Schlagzähler ergeben sich 24,1 spm, die Konsole meldet Ø 23. Die 43–49 spm aus dem Kurztest waren echte schnelle Testschläge.
- ✅ **Reaktionszeit:** Nach einem kräftigeren Schlag steigen Watt und Pace innerhalb von ~1–2 s (Beispiel: Sekunde 243 → 58 W, 244 → 91 W, 246 → 167 W). Watt und Pace werden **einmal pro Schlag** aktualisiert, in einem eigenen Paket nach dem Schlagzähler.
- ✅ Die Intervalle sind in den Daten klar erkennbar (≈ 55 W locker ↔ 85–100 W zügig). Das Spiel kann darauf gut reagieren.
- ℹ️ Watt schwanken von Schlag zu Schlag deutlich (ein einzelner harter Schlag = 167 W). Für Zielband-Bewertung und Spielgeschwindigkeit **glätten** (z. B. gleitender Mittelwert über 3–4 Schläge), für Effekte wie Gischt den Rohwert nutzen.
- 🐞 PoC-Fehler behoben: Beim erneuten Verbinden sprangen die Zeitstempel zurück, und die Aufzeichnung enthielt beide Sessions. Die Datei oben enthält nur die 10-Minuten-Session.

## Noch offen
- **Widerstand setzen** (Target Resistance per Control Point) wird laut Features unterstützt. Das ist für später interessant (Flutwelle = schwereres Wasser), aber noch nicht getestet.

## Konsequenzen für Meilenstein 1
- `RowerSource` liefert normalisierte Events: `sample` (≈1 Hz, nur bei Änderung), `stroke` (Schlagzähler +1), `paused` / `resumed`, `resistance`.
- Doppelte Pakete filtern, sonst sieht das Spiel eine Scheinrate von 4 Hz.
- Simulator spielt diese JSON-Aufzeichnungen ab und erzeugt zusätzlich synthetische Workouts (gleiches Paketformat `0x0BAE`).
