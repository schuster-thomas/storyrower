# StoryRower

Rudern als erlebte Geschichte: Die Live-Daten eines Rudergeräts (zuerst der **Domyos Woodrower**) treiben ein Boot durch ein Level mit Dramaturgie. Es beginnt idyllisch, dann eskaliert die Lage (Vulkanausbruch, Flutwelle …), man muss fliehen, und am Ende klingt das Training locker aus.

Belohnt wird nicht Maximalleistung, sondern wie gut man die **Zielbereiche** für Watt, Schlagfrequenz und 500m-Zeit trifft.

**Live:** <https://schuster-thomas.github.io/storyrower/> · Gerät & Diagnose: <https://schuster-thomas.github.io/storyrower/#/diagnose>

- 📄 [Konzept](KONZEPT.md)
- 🖼️ [Erster Interface-Entwurf](screenshots/)
- 🔌 [BLE-Proof-of-Concept und Ergebnis](poc/ble/ERGEBNIS.md)

## Status
| Meilenstein | Stand |
|---|---|
| 0 – BLE-PoC (Woodrower-Daten per Web Bluetooth) | ✅ Woodrower spricht FTMS, 10 min stabil ([Ergebnis](poc/ble/ERGEBNIS.md)) |
| 1 – Daten-Layer + Simulator + Diagnose-Ansicht | ✅ |
| 2 – Graybox-Spiel | – |
| 3 – Story-Engine | – |
| 4 – Level „Iceland Volcano Run“ | – |

## Entwicklung
Voraussetzung: Node.js 24.

```bash
npm install
npm run dev      # http://localhost:5173 (im LAN auch per IP erreichbar)
npm test         # Tests, u. a. mit den echten Woodrower-Aufzeichnungen
npm run build    # Typecheck + Build nach dist/
```

Jeder Push auf `main` wird per GitHub Actions getestet, gebaut und auf GitHub Pages veröffentlicht.

### Aufbau der Daten-Schicht (`src/rower/`)
```
PacketSource ── BluetoothSource   Web Bluetooth (Chrome: Android, Windows, macOS)
             ├─ ReplaySource      spielt Aufzeichnungen ab (1×–64×)
             └─ SimulatorSource   simuliert einen Woodrower (Tastatur/Leistungsprofil)
        │  rohe FTMS-Pakete (uuid, Bytes, Zeit)
        ▼
RowerSession  dekodiert · filtert Duplikate · erkennt Schläge und Pausen
              · glättet Watt/Pace (6 s) · zeichnet alles auf
        │  RowerEvents: sample, stroke, paused/resumed, resistance, raw, …
        ▼
Spiel  und  Diagnose-Ansicht (src/diagnostics/) – derselbe Datenweg
```

Alle drei Quellen liefern exakt das Paketformat des Woodrowers. Deshalb läuft am Schreibtisch derselbe Code wie am Rudergerät.

## Plattform
Web-App (PWA, TypeScript + Three.js) für Chrome auf Android-Tablets und PCs. iPad später über eine Capacitor-App, weil iOS-Browser kein Web Bluetooth können.
