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
| 4 – Level "Iceland Volcano Run" | in progress: ✅ graphics levels & metrics, ✅ world look (water, sky, terrain), ✅ painted horizon (mountains, volcano, wave), ✅ unified 3D props from a CC0 kit, ✅ shadows & colour grade · next: boat & rower, set pieces, music |

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

### 3D models (`scripts/models/`, `src/assets/models/`)
All props (rocks, pebbles, grass, lupines, bushes, trees, boulder cliffs, icebergs) come from one CC0 kit – Quaternius' Stylized Nature MegaKit – so the look stays consistent. See [CREDITS.md](CREDITS.md).

```bash
# expects the extracted pack in assets/raw/packs/nature-megakit/ (download: quaternius.itch.io/stylized-nature-megakit, free standard version)
npm run models:build   # selected models → src/assets/models/nature.glb (meshopt + WebP, ~0.6 MB)
```
`dev/models.html?m=Rock_Medium_1,Pine_1` (dev server) renders models side by side for picking. `src/game/scene/NatureKit.ts` loads the bundle and places models with instancing; `Post.ts` adds the colour grade, vignette and (on high) bloom.

### Painted backdrops (`scripts/backdrops/`, `src/assets/backdrops/`)
The horizon mountains, the volcano (calm and erupting) and the tidal wave are painted layers (the cliff and iceberg layers are generated too but currently unused – 3D models replaced them) generated with the OpenAI image API (`gpt-image-1.5`, transparent background) using the original mock-up as style reference. Prompts live in `scripts/backdrops/spec.mjs`.

```bash
npm run backdrops:generate   # needs the API key in the environment variable gpt_api_key; skips existing images
npm run backdrops:process    # trim, resize and compress to WebP into src/assets/backdrops/
npm run backdrops:sheet      # contact sheet for a quick visual check
```
Raw images stay in `assets/raw/` (not committed). `src/game/scene/Backdrop.ts` places the layers and grades them with the phase light and haze.

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
