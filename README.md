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
| 4 – Level "Iceland Volcano Run" | in progress: ✅ graphics levels & metrics, ✅ world look (water, sky, terrain), ✅ painted horizon (mountains, volcano, wave), ✅ unified 3D props from a CC0 kit, ✅ shadows & colour grade · art rework ([CONCEPT.md §9.6](CONCEPT.md)): ✅ A – style frames, new camera · ✅ B – scull and rigged rower in time with the real strokes · ✅ C – painted river banks · ✅ F – volcano with flowing lava · ✅ D – puffins · ✅ painted icebergs and rocks · ✅ G – 3D tidal wave · next: see [§11](CONCEPT.md#11-next-steps) |

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
- `game/scene/Effects.ts` – ash, embers, bow spray, lava bombs with splash rings
- `game/scene/Puffins.ts` – puffins sitting on the rocks in the river (turning their heads), taking off when the boat comes close or the earth trembles, a few circling in the calm morning; wing beat and head turns in the vertex shader, two instanced draw calls
- `game/scene/TidalWave.ts` – the tidal wave in the finale: a procedural 3D breaker (long back slope, curling crest over a hollow, foam streaks down the face, churning foot, spray thrown ahead of the lip); the break peels along the wave and the wall heaves
- `game/scene/PaintedProps.ts` – icebergs and rocks in the water, painted from all sides; the icebergs bob on the swell
- `game/scene/quality.ts` – graphics levels (low/medium/high/auto), auto-adjustment by frame rate, frame statistics
- `game/scene/RiverScene.ts` preloads boat, painted layers and model kit while the setup screen is open; the game view stays dark ("Loading the fjord…") until they and the first stretch of fjord are ready, and the workout clock only starts then
- `game/scene/Fjord.ts` – the world layout: a narrow river built in 100 m chunks (water, icebergs, fallback banks); the bank lines are shared with the water shader and the painted sections
- `game/scene/Volcano.ts` – the volcano at the end of the valley: a painted plane whose lava mask lets fresh lava run down the grooves with the story, a plume of painted ash puffs, a lava fountain, crater glow and volcanic lightning
- `game/scene/PaintedShore.ts` – the painted river banks (basalt cliffs left, glacier right): 120 m sections in two variants, chained with mirroring, with lupine cards, waterfall sheets, foam and spray on top. How they are made: [CONCEPT.md §9.7](CONCEPT.md#97-how-a-levels-world-is-made-matte-painting-pipeline); how further levels reuse it: [§12](CONCEPT.md#12-building-further-levels)
- `game/scene/Water.ts`, `Sky.ts` – water shader (waves, shallows, milky meltwater before the glacier, foam, wake, sky reflection), gradient sky with sun and clouds
- `audio/AudioEngine.ts` – procedural placeholder soundtrack (Web Audio): music layers faded by intensity, splash per real stroke, ambience and story effects

### Art direction (`docs/art/`, `scripts/concepts/`)
The visual target since the art rework (see [CONCEPT.md §9.6](CONCEPT.md)): style frames from the game camera and model sheets for the rower and boat, puffins, glacier ice and shore props, generated with the OpenAI image API (`gpt-image-2`) from the original mock-up.

```bash
node scripts/concepts/generate.mjs   # needs gpt_api_key; skips existing images, --force to redo
```
The first experiment with photo-scanned river sections (Poly Haven scans baked in Blender) was dropped for the stylised look; its scripts stay in `scripts/blender/` and `scripts/sections/` as a starting point for the Blender kits.

### Boat and rower (`scripts/blender/boat.py`, `scripts/tripo/`, `src/assets/models/boat.glb`)
A racing single scull (hull with red stripes, wing riggers, sliding seat, foot stretcher, sculls with hatchet blades) built by a Blender script, with a rower generated by Tripo3D from an A-pose reference image with closed fists (`docs/art/ref-rower-fists.jpg`; the auto-rig has no finger bones) and rigged there (Mixamo skeleton). Blender sits the rower on the seat facing the stern, closes the fists on the grips and sets the feet on the stretcher with IK (pole angles searched per limb so elbows point out and knees up; the fist is measured from the mesh (centre, width, knuckle row) and placed per frame so its centre sits on the handle axis, the knuckle row turned onto the handle mainly by forearm rotation plus at most 20° of wrist tilt, checked against the technique references `docs/art/stroke-front.jpg` and `stroke-side.jpg`; `DEBUG_HANDS=1` prints offsets and angles per frame), swings the body and bakes one stroke: catch at 0 %, finish at 35 %, next catch at 100 %. The oar angle is solved per frame from the body (straight arms through catch, drive and recovery, drawn in only at the finish), part of the forearm rotation is moved from the wrist into the forearm (no pinched wrists), and the span/inboard keep the fists apart at mid-drive. `src/game/scene/Boat.ts` scrubs that clip with the phase of the real stroke, so the rower moves in time with you; the blades splash at the catch and leave puddles at the finish.

```bash
node scripts/tripo/tripo.mjs image assets/raw/concepts/ref-rower-fists.png --name rower2 --faces 16000
node scripts/tripo/rig.mjs <task id> --name rower2         # → assets/raw/tripo/rower2.rigged.model.glb
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --factory-startup --python scripts/blender/boat.py -- assets/raw/boat --rower assets/raw/tripo/rower2.rigged.model.glb --preview   # --close: hand close-ups
node scripts/blender/contact.mjs assets/raw/boat           # preview renders → contact sheet
node scripts/boat/build.mjs                                # → src/assets/models/boat.glb (~260 KB)
```

### 3D models (`scripts/models/`, `src/assets/models/`)
Shore boulders and (for now) the icebergs come from one CC0 kit – Quaternius' Stylized Nature MegaKit. See [CREDITS.md](CREDITS.md).

```bash
# expects the extracted pack in assets/raw/packs/nature-megakit/ (download: quaternius.itch.io/stylized-nature-megakit, free standard version)
npm run models:build   # selected models → src/assets/models/nature.glb (meshopt + WebP, ~0.6 MB)
```
`dev/models.html?m=Rock_Medium_1,Pine_1` (dev server) renders models side by side for picking. `src/game/scene/NatureKit.ts` loads the bundle and places models with instancing; `Post.ts` adds the colour grade, vignette and (on high) bloom.

### Painted backdrops (`scripts/backdrops/`, `src/assets/backdrops/`)
The mountain panorama around the fjord is a painted layer generated with the OpenAI image API. The panorama (`far-mountains`, 3072 px wide) is made with `gpt-image-2` on a flat magenta background and keyed out by `process.mjs`; the older layers use `gpt-image-1.5` with a transparent background. Prompts live in `scripts/backdrops/spec.mjs`.

```bash
npm run backdrops:generate   # needs the API key in the environment variable gpt_api_key; skips existing images
npm run backdrops:process    # trim, resize and compress to WebP into src/assets/backdrops/
npm run backdrops:sheet      # contact sheet for a quick visual check
```
Raw images stay in `assets/raw/` (not committed). `src/game/scene/Backdrop.ts` places the layers and grades them with the phase light and haze.

### Volcano (`scripts/blender/volcano.py`, `scripts/painted/volcano.mjs`)
The volcano is made like the river banks ([CONCEPT.md §9.7](CONCEPT.md#97-how-a-levels-world-is-made-matte-painting-pipeline)), but stays a plane (it is 700–780 m away): Blender renders a blockout with hint colours on magenta and, pixel-aligned, a lava mask (R = lava channel, G = distance down the channel, B = crater). The image model paints the calm volcano over the blockout; the game's shader fills the grooves with lava as the eruption goes on and lets it cool after the escape.

```bash
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --factory-startup --python scripts/blender/volcano.py -- assets/raw/painted/volcano
node scripts/painted/paint.mjs volcano     # → assets/raw/painted/volcano/painted.png
node scripts/painted/volcano.mjs           # keys the magenta, packs painting, mask and ash puffs into src/assets/painted/
```

### Icebergs and rocks in the water (`scripts/blender/props.py`, `scripts/painted/props.mjs`)
Four icebergs and four rocks (incl. the puffins' rock and a basalt sea stack) as coloured blockouts, rendered in a row from five directions (four sides and from above), each view painted by the image model (the later views get the first one as a reference), the backgrounds filled with the objects' edge colours, then projected back: every face takes the view that sees it most squarely and unhidden.

```bash
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --factory-startup --python scripts/blender/props.py -- assets/raw/painted/ice --kind ice
node scripts/painted/props.mjs ice          # paint the five views (rocks: same with "rocks")
node scripts/painted/props.mjs ice fill
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --factory-startup --python scripts/blender/props.py -- assets/raw/painted/ice --kind ice --paint
node scripts/painted/props.mjs ice build    # → src/assets/painted/ice.glb
```

### Puffins (`scripts/tripo/puffin-ref.mjs`, `scripts/blender/puffin.py`, `scripts/puffin/build.mjs`)
Two Tripo3D models: standing (from the model sheet) and flying with the wings spread straight out (reference from `puffin-ref.mjs`), so the game can bend the wings in the vertex shader.

```bash
node scripts/tripo/puffin-ref.mjs
node scripts/tripo/tripo.mjs image assets/raw/puffin/ref-flying.png --name puffin-flying --faces 4000
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --factory-startup --python scripts/blender/puffin.py -- assets/raw/tripo/puffin-flying.pbr_model.glb assets/raw/puffin/flying.glb --pose flying --yaw 90
node scripts/puffin/build.mjs               # → src/assets/models/puffin-standing.glb, puffin-flying.glb
```

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
