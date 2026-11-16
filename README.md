# StoryRower

Rowing as a story you live through: live data from a rowing machine (starting with the **Domyos Woodrower**) drives a boat through a level with a dramatic arc. It starts idyllic, then things escalate (volcanic eruption, tidal wave …), you have to escape, and the workout winds down gently at the end.

What counts is not maximum effort but how well you stay inside the **target bands** for watts, stroke rate and 500 m split.

**Live:** <https://schuster-thomas.github.io/storyrower/> · Device & diagnostics: <https://schuster-thomas.github.io/storyrower/#/diagnose>

- 📄 [Concept](CONCEPT.md)
- 🖼️ [First UI mock-up](screenshots/)
- 🔌 [BLE proof of concept and results](poc/ble/RESULTS.md)

## Status
| Milestone | State |
|---|---|
| 0 – BLE PoC (Woodrower data via Web Bluetooth) | ✅ Woodrower speaks FTMS, stable for 10 min ([results](poc/ble/RESULTS.md)) |
| 1 – Data layer + simulator + diagnostics view | ✅ |
| 2 – Greybox game (incl. heart rate display) | – |
| 3 – Story engine + audio | – |
| 4 – Level "Iceland Volcano Run" | – |

## Development
Requires Node.js 24.

```bash
npm install
npm run dev      # http://localhost:5173 (also reachable via LAN IP)
npm test         # tests, incl. the real Woodrower recordings
npm run build    # typecheck + build to dist/
```

Every push to `main` is tested, built and published to GitHub Pages by GitHub Actions.

### Data layer (`src/rower/`)
```
PacketSource ── BluetoothSource   Web Bluetooth (Chrome: Android, Windows, macOS)
             ├─ ReplaySource      replays recordings (1×–64×)
             └─ SimulatorSource   simulates a Woodrower (keyboard / power profile)
        │  raw FTMS packets (uuid, bytes, time)
        ▼
RowerSession  decodes · drops duplicates · detects strokes and pauses
              · smooths watts/pace (6 s) · records everything
        │  RowerEvents: sample, stroke, paused/resumed, resistance, raw, …
        ▼
Game  and  diagnostics view (src/diagnostics/) – same data path
```

All three sources produce exactly the Woodrower's packet format, so the same code runs at the desk and on the rower.

## Platform
Web app (PWA, TypeScript + Three.js) for Chrome on Android tablets and PCs. iPad later via a Capacitor app, because iOS browsers don't support Web Bluetooth.
