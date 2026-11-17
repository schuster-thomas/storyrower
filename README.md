# StoryRower

Rowing as a story you live through: live data from a rowing machine (starting with the **Domyos Woodrower**) drives a boat through a level with a dramatic arc. It starts idyllic, then things escalate (volcanic eruption, tidal wave …), you have to escape, and the workout winds down gently at the end.

What counts is not maximum effort but how well you stay inside the **target bands** for watts, stroke rate and 500 m split.

**Live:** <https://schuster-thomas.github.io/storyrower/> · Play: <https://schuster-thomas.github.io/storyrower/#/play> · Device & diagnostics: <https://schuster-thomas.github.io/storyrower/#/diagnose>

- 📄 [Concept](CONCEPT.md)
- 🖼️ [First UI mock-up](screenshots/)
- 🔌 [BLE proof of concept and results](poc/ble/RESULTS.md)

## Status
| Milestone | State |
|---|---|
| 0 – BLE PoC (Woodrower data via Web Bluetooth) | ✅ Woodrower speaks FTMS, stable for 10 min ([results](poc/ble/RESULTS.md)) |
| 1 – Data layer + simulator + diagnostics view | ✅ |
| 2 – Greybox game (incl. heart rate display) | ✅ playable with rower or simulator |
| 3 – Story engine + audio | ✅ story beats, reactive effects, placeholder soundtrack |
| 4 – Level "Iceland Volcano Run" | in progress: ✅ graphics levels & metrics, ✅ world look (water, sky, terrain) · next: set pieces, boat, music, polish |

## Development
Requires Node.js 24.

```bash
npm install
npm run dev      # http://localhost:5173 (also reachable via LAN IP)
npm test         # tests, incl. the real Woodrower recordings
npm run build    # typecheck + build to dist/
```

Every push to `main` is tested, built and published to GitHub Pages by GitHub Actions.

Development shortcuts for the game: `#/play?speed=30` runs the workout clock 30× faster, `#/play?at=990` starts at second 990 (the finale of a 20-minute workout), `#/play?beat=eruption` starts 5 s before a story beat (`calm`, `birds`, `tremor`, `ash`, `eruption`, `wave`, `escape`, `sunset`). The "Simulator (autopilot)" source rows by itself and follows the targets.

### Recording a session
Everything is recorded automatically from the moment a rower (or simulator) is connected: every Bluetooth packet with a timestamp, plus game events (`game-start` with settings and all sections, `game-section` on every target change, `game-snapshot` every 5 s with values, zones, wave distance and fps, `visibility`, `error`, `game-finish`). Download it from the results screen, the in-game "i" overlay or **Device & diagnostics**. The recording lives in memory only – reloading the page loses it. Recordings can be replayed in Device & diagnostics.

### Game (`src/game/`, `src/workout/`)
- `workout/workout.ts` – turns the settings (min/max watts and stroke rate, duration) into the training curve and its five story phases
- `workout/scoring.ts` – target-band zones, time in band, coins, stars and the distance to the tidal wave (no game over)
- `game/scene/RiverScene.ts` – Three.js greybox world: endless river, boat with stroke-synced oars, volcano, tidal wave, camera
- `game/hud/Hud.ts` – HUD with phase progress and band bars
- `app/connection.ts` – one shared rower session plus optional heart-rate monitor for setup, game and diagnostics
- `story/story.ts` – story engine: places a level's beats on any training curve, derives ongoing effects (ash, lava bombs, birds) and a smoothly blended environment from the workout time
- `game/scene/Effects.ts` – ash, embers, bow spray, lava bombs with splash rings, puffins
- `game/scene/quality.ts` – graphics levels (low/medium/high/auto), auto-adjustment by frame rate, frame statistics
- `game/scene/Water.ts`, `Sky.ts`, `Terrain.ts` – water shader (waves, foam, wake, sky reflection), gradient sky with sun, clouds and snow-capped mountains, rolling hills with basalt columns, lupines and waterfalls
- `audio/AudioEngine.ts` – procedural placeholder soundtrack (Web Audio): music layers faded by intensity, splash per real stroke, ambience and story effects

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
