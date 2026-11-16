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

## Auffälligkeiten / noch offen
- **Kurze Aufzeichnung:** 95 s, davon ca. 50 s Rudern (30 Schläge, 124 m, 18–55 W). Für den Simulator und für die Bewertung von Latenz und Watt-Plausibilität fehlt noch die **10-Minuten-Session mit Tempowechseln**.
- **SPM wirkt hoch:** Die Konsole meldet 43–49 spm. Aus dem Schlagzähler ergeben sich im selben Zeitraum ca. 36 spm. Möglicherweise wurden schnelle, kurze Testschläge gerudert. In der langen Aufzeichnung mit der Anzeige an der Konsole vergleichen.
- **Latenz** (Gefühl: Wie schnell reagieren die Werte auf einen Tempowechsel?) und **Verbindungsstabilität** über eine längere Zeit sind noch nicht bewertet.
- **Widerstand setzen** (Target Resistance per Control Point) wird laut Features unterstützt. Das ist für später interessant (Flutwelle = schwereres Wasser), aber noch nicht getestet.

## Konsequenzen für Meilenstein 1
- `RowerSource` liefert normalisierte Events: `sample` (≈1 Hz, nur bei Änderung), `stroke` (Schlagzähler +1), `paused` / `resumed`, `resistance`.
- Doppelte Pakete filtern, sonst sieht das Spiel eine Scheinrate von 4 Hz.
- Simulator spielt diese JSON-Aufzeichnungen ab und erzeugt zusätzlich synthetische Workouts (gleiches Paketformat `0x0BAE`).
