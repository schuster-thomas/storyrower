# StoryRower – Concept (draft v0.3)

> Rowing as a story you live through: live data from the **Domyos Woodrower** drives a boat through a level with a dramatic arc – idyllic start, escalation (volcano, kaiju, earthquake …), escape, calm cool-down.

Last updated: 2026-11-18 · Status: milestone 4 in progress – banks, boat and rower, volcano, puffins, painted props and tidal wave done; calving, sound and a tablet run-through next (see [§11](#11-next-steps)). Further levels follow the pattern in [§12](#12-building-further-levels).

---

## 1. Vision in one sentence

An interval workout that doesn't feel like an interval workout: **the training curve is the story's tension curve.**

| Training phase | Story phase | Example "Iceland Volcano Run" |
|---|---|---|
| Warm-up (easy) | Idyll | Fjord, waterfalls, puffins |
| Build-up | Omens | Rumbling, swell, first ash |
| Load / intervals | Escalation & escape | Eruption, lava rain, tidal wave |
| Peak | Finale | Through the narrows, wave right behind you |
| Cool-down | Wind-down | Open sea, sunset |

The existing mock-up ([screenshots/](screenshots/)) shows exactly this direction: third-person view behind the boat, phase bar at the top, HUD at the bottom with distance, watts, SPM and 500 m split.

---

## 2. Core mechanics

### 2.1 Reward hitting the target, not maximum effort
- Each phase has **target bands** for watts, SPM and 500 m split (derived from the user's settings).
- In the band = the boat keeps its distance from the threat, coins/combo, calm camera.
- Too low = the threat closes in (the wave grows behind you, camera shake).
- Too high = gentle hint ("Save your strength!"), *no* reward – protects against overdoing it.
- **No game over.** The story always plays to the end; only the rating (stars/score) changes. Failing a workout otherwise makes people quit.

### 2.2 Settings before the start
- min/max watts · min/max SPM · total duration
- A **workout generator** builds a curve from these (warm-up → ramp → intervals → peak → cool-down). The target 500 m split is computed from watts (Concept2 formula: `pace = 500 · (2.8 / W)^(1/3)` s) so the three bands are consistent. The Woodrower itself converts pace and watts with exactly this formula.
- Later: presets ("30 min easy", "pyramid", "4×4 min"), FTP/test levels.

### 2.3 Story engine (data-driven)
A level is **not a fixed timeline** but a list of story beats with an intensity level. The engine lays the beats onto the generated training curve:

```
Level "Iceland Volcano Run"
  beats:
    - idyll_fjord        intensity: 0     min_duration: 3 min
    - first_tremor       intensity: 1
    - ash_rain           intensity: 2
    - eruption           intensity: 3     (peak)
    - tsunami_chase      intensity: 3
    - open_sea_sunset    intensity: 0     (cool-down)
```

Benefit: one level works for 20 and for 60 minutes. Shorter workouts drop intermediate beats, longer ones stretch the idyll or loop.

### 2.4 Stroke sync
The rower figure and the oars should move **in time with the real stroke**. That matters more for immersion than any graphics. FTMS only delivers stroke rate and stroke count, not the stroke cycle, so the animation is driven by stroke-count changes and interpolated with SPM. The PoC showed the stroke counter is accurate to about ±250 ms – good enough.

---

## 3. Data from the Woodrower

**Result of the PoC (2026-11-16): the Woodrower speaks standard FTMS** (Fitness Machine Service `0x1826`, Rower Data `0x2AD1`). Ten minutes of rowing were stable, with no errors and no dropouts. Details: [poc/ble/RESULTS.md](poc/ble/RESULTS.md).

Key facts:
- Packets at ~4 Hz, but values effectively change ~1× per second / per stroke (many duplicate packets).
- Watts and pace update once per stroke and fluctuate strongly → smooth them for scoring and boat speed.
- Pause/resume and resistance changes arrive as Machine Status events.
- BLE devices usually accept **only one connection at a time**: e-Connected/Kinomap must be closed.

---

## 4. Platform: website, app or both?

### Key fact: Web Bluetooth
| Platform | Web Bluetooth in the browser |
|---|---|
| Android tablet (Chrome/Samsung Internet) | ✅ yes |
| Windows/macOS/Linux laptop (Chrome, Edge) | ✅ yes (Bluetooth adapter needed) |
| iPad / iPhone (Safari **and every other iOS browser**) | ❌ no (Apple/WebKit) – only via apps like *Bluefy* |
| Firefox (all platforms) | ❌ no |

The main target device, a **Samsung Galaxy Tab S9 (SM-X710, Snapdragon 8 Gen 2)**, is powerful – plenty for stylised Three.js 3D at 60 fps with sensible optimisation.

### Options compared

| | **A: Web app / PWA only** | **B: Web app + Capacitor wrapper** | **C: Native engine (Unity / Godot)** |
|---|---|---|---|
| Android tablet | ✅ | ✅ | ✅ |
| PC/laptop | ✅ in the browser | ✅ in the browser | ✅ separate build |
| iPad | ❌ (Bluefy workaround only) | ✅ via App Store / TestFlight | ✅ |
| Development speed | very fast, just reload | fast (web), native build only for releases | slower, large toolchain |
| Distribution | a link, instant updates | web instantly; stores with review | stores / APK |
| Cost | ~€0 (GitHub/Cloudflare Pages) | Apple Developer €99/year for iPad | same as B |
| Graphics ceiling | good (WebGL/WebGPU), watch asset size | same as A | highest, best level editor |
| BLE access | Web Bluetooth (Chromium) | native BLE plugin, everywhere | native plugins (some paid) |
| Screen stays on | Wake Lock API ✅ | ✅ | ✅ |
| Learning curve | low | low + some Capacitor | high, new language/engine |

### Decision: **A now, B later**
- **PWA with TypeScript + Three.js (Vite).** Covers tablet and PC immediately, no install, free hosting.
- The data source is abstracted (done in milestone 1):
  ```
  PacketSource
   ├─ BluetoothSource   (Chrome: Android, PC)
   ├─ ReplaySource      (recordings)
   ├─ SimulatorSource   (keyboard / power profile – development without a rower)
   └─ later: Capacitor BLE source for iPad
  ```
- When iPad matters: wrap the same web app with **Capacitor** and plug in the BLE plugin. No rewrite.
- Unity/Godot only if graphics or level building in the browser turns out to be a real bottleneck – a deliberate later step.

---

## 5. Graphics & style

**Goal:** stylised, friendly, bright, arcade-like – "Mario Kart level" polish, not a simulator.

**Reality check:** the mock-up is an AI concept image. That level of detail (waterfalls, smoke, lighting) is only reachable in real time with a lot of asset work. Achievable and good-looking in the browser:
- **Low/mid-poly with toon/gradient shading**, strong palettes, fog for depth
- **Endless river:** the boat moves forward, the world is generated in chunks ahead and removed behind – cheap and allows any length
- Effects with particles and shaders (lava glow, ash, spray), camera shake, colour/light changes per intensity
- Backdrops (volcano, skyline, kaiju silhouette) partly as **2D billboards/skybox layers** – very effective, very cheap
- Assets: free CC0 packs (e.g. Kenney, Quaternius, Poly Pizza) to start, later custom or AI-assisted models

**What actually got us close to the mock-up (2026-11-18):** not hand-built models, but **matte painting**: simple Blender geometry for each river-bank section, painted over by the image model in the game's style and projected back onto the geometry. The banks keep real depth and parallax, the painting brings the detail and light. Things that must stand upright (flowers, falling water) are added on top as 3D cards and shaders. Details in [§9.7](#97-how-a-levels-world-is-made-matte-painting-pipeline); it is the pattern for all further levels ([§12](#12-building-further-levels)).

**Legal:** no "Godzilla" – an **original kaiju** with its own name and design (homage, not a copy). Same for music and logos.

---

## 6. HUD (evolved from the mock-up)

- **Top left:** level name + phase ("Phase 3/5 – Rising Fury")
- **Top centre:** phase progress to the finish
- **Bottom:** tiles for distance, watts, SPM, 500 m split and heart rate. Each with a **large current value** and a **band bar** showing the target band in colour (green = in band, yellow = close, red/blue = too high/too low). Heart rate is display only (no band).
- **New:** a small preview of the next phase ("In 0:30: Eruption! Target 180–220 W") so you can prepare for intervals.
- Large digits, high contrast – the tablet is ~1–1.5 m away, you're sweating and moving.

### 6.1 Diagnostics view (required in the final app)
Kept from the BLE PoC on purpose:
- **Own screen "Device & diagnostics"** in the menu, usable without a level: connect, all live values as tiles, update rate, device info, status events, log with raw data. *(Done in milestone 1.)*
- **Toggleable overlay in-game** (e.g. tap an icon in the corner): raw values, smoothed values, packet rate, connection state. The game keeps running behind it.
- **Record & replay:** every session can be saved as JSON and replayed later. Also the basis for bug reports.
- The diagnostics view is fed by the same `RowerSession` as the game, so it shows exactly the data the game gets.

---

## 7. Pros and cons of the overall concept

### Pros
- **A real gap:** existing rowing apps are video routes (Kinomap) or numbers/races. Story-driven intensity with target bands is rare.
- **Sound training:** target bands instead of "as hard as possible"; warm-up and cool-down are part of the story.
- **One level, many workouts:** the workout generator plus data-driven beats give high replay value.
- **Cheap to run:** PWA, static hosting, no servers, no costs.
- **Open standard:** other FTMS rowers should work too, which opens the door to other users.

### Cons / risks
| Risk | Severity | Mitigation |
|---|---|---|
| ~~Woodrower doesn't speak (full) FTMS~~ | ✅ resolved | PoC on 2026-11-16: standard FTMS, see [poc/ble/RESULTS.md](poc/ble/RESULTS.md) |
| iPad without Web Bluetooth | medium | Capacitor wrapper later; data source abstracted |
| Asset/graphics effort underestimated | **high** | keep the style simple, billboards, CC0 assets, *one* great level instead of three mediocre ones |
| Woodrower watts inaccurate/estimated | medium | bands also via SPM + pace; calibration factor in settings |
| Data only ~1 Hz → choppy animation | low | stroke events + interpolation (validated in the PoC) |
| Long-term motivation after the 5th run | medium | more levels, random events, best times/stars, statistics |
| Battery/heat during 60 min of 3D on the tablet | low–medium | FPS cap (30/60), resolution scaling, charger |
| Scope creep | high | strict milestones, see below |

---

## 8. Milestones

| # | Milestone | Outcome | Rough effort |
|---|---|---|---|
| 0 ✅ | BLE PoC | nRF Connect check + web page with live Woodrower values, JSON recording | 1–2 evenings |
| 1 ✅ | Data layer + simulator | `RowerSession` with Bluetooth/replay/simulator sources, diagnostics view | 1–2 evenings |
| 2 ✅ | Greybox game | Boat on an endless river, speed = pace, HUD with target bands, workout generator, **heart-rate source (Fitbit/strap, display only)** | 1–2 weekends |
| 3 ✅ | Story engine | Beats, intensity levels, camera/light/weather react, **audio engine with music layers** | 1–2 weekends |
| 4 🔶 | First polished level | "Iceland Volcano Run" with assets, effects, music and sounds – banks, boat and rower done; volcano, puffins, wave, sound open ([§11](#11-next-steps)) | several weeks |
| 5 | Results & PWA | Results screen, **local workout history (IndexedDB)**, JSON export, installable, offline | 1 weekend |
| 6 | Level kit | Iceland split into engine + level content, level registry and level choice on the setup screen, scripts take `--level` ([§12](#12-building-further-levels)) | 1 weekend |
| 7 | Second level | Built with the kit, as the test that the pattern carries | 2–3 weekends |
| 8 | iPad | Capacitor build + BLE plugin | 1–2 weekends |

---

## 9. Decisions (as of 2026-11-16)

### 9.1 First level: "Iceland Volcano Run"
Idyllic start with Icelandic landscape, waterfalls and puffins → volcanic eruption → escape from the tidal wave → wind-down. Kaiju/Tokyo comes later.

### 9.2 Heart rate: display only – Fitbit Charge 6 first, chest strap as an option
- The **Fitbit Charge 6** can broadcast heart rate during a workout to fitness equipment. It uses the standard **Heart Rate** service (`0x180D`), just like chest straps (Polar, Garmin, Wahoo …). **One code path covers both.**
- The watch is a **second Bluetooth device** next to the Woodrower. The app gets its own heart-rate source (`HeartRateSource`) that connects in addition. Web Bluetooth can hold several devices at once.
- Without an extra connection: if a strap is paired directly with the Woodrower console, heart rate is already part of the rower data (the field is parsed; so far always 0).
- Priority if both exist: separate HR device over console HR.
- **In the game: display only** (HUD tile, results screen, history). No HR zones, no HR-based mechanics for now.
- Wrist HR reacts more slowly than a chest strap while rowing – fine for display.
- **Diagnostics view:** a second button "Connect heart-rate monitor", own tile with source (watch/strap/console) and data rate.

### 9.3 Dynamic soundtrack: yes
- **Layered music (stems):** a calm base layer (idyll), a percussion layer from "omens" on, a threat layer for eruption/escape. Story intensity crossfades the layers (Web Audio API). All layers run in sync and loop seamlessly.
- **Sound effects:** oar splash synced to the real stroke, ambience (birds, waterfall, rumbling, surf), one-off effects for story events (eruption, wave).
- **Sources:** CC0 or royalty-free music/sounds, or AI-generated with a licence for public use (the game will be public).
- Browser rule: audio only starts after a user action. The level's start button handles that.
- Separate volume for music and effects; music can be turned off (own playlist).

### 9.4 Public and English-only
- The game will be **public** and **English-only**: UI, docs, code comments and commit messages.
- No second language for now. UI strings stay simple; a translation layer can be added later if needed.
- Other rowers: anything with standard FTMS should work without changes. Devices with a proprietary protocol would each need their own source.
- Consequences: assets and music only with licences that allow public distribution; no trademarks in the game (Godzilla, Decathlon logos, etc.).

### 9.5 Storage: local only for now
- Workouts are **stored locally in the browser** (IndexedDB): a summary (date, level, duration, distance, avg watts/SPM/HR, time in band, stars) and a 1-second history for charts.
- Raw recordings (as in the diagnostics view) optionally on top, because they're larger (~1 MB per 10 min).
- Export as a JSON file for backups. Note: clearing browser data deletes local workouts.
- To decide later: export for Strava/Garmin (FIT/TCX), sync between devices.

### 9.6 Art direction rework (2026-11-18)
The first world look (photo scans + low-poly kit + paintings on a narrow river) was too far from the mock-up. New direction:
- **Style:** stylized, saturated, clean shapes – roughly Mario Kart 8. Not photorealistic, but **every object must be recognisable at a glance** (puffins, lupines, waterfalls, glacier ice). No photo scans.
- **Layout:** a wide fjord / glacier lagoon instead of a narrow river. Left: angular, moss-green basalt slopes with snow patches, waterfalls, lupines, puffins. Right: a classic Icelandic glacier with blue ice – the source of the icebergs drifting in the water.
- **Three depth layers:** far = painted panorama layers (ChatGPT image API), mid = stylized Blender geometry with painted textures, near = animated hero models (boat, rower, puffins, icebergs).
- **Rower:** realistic – sits facing the stern; the chase camera behind the boat sees the rower's face. The stroke animation follows the real stroke rate.
- **Tools:** OpenAI image API (concepts, textures, panorama), Tripo3D image-to-3D (organic models), Blender (cleanup, rigging, animation, level building). Performance target: Samsung Galaxy Tab S9 (SM-X710).

**Revised later the same day after playing it:** the wide lagoon felt empty. The river is now **narrow (~30 m)** so you row *through* the landscape; the banks are **not tall everywhere** (open, low stretches with slopes between the cliffs) so it doesn't feel oppressive; the **volcano stays in view** straight ahead as the central element; camera swings are kept small and inside the river.

| Phase | Content | Status |
|---|---|---|
| A | Style frames + model sheets as the visual target; lower camera, glacier water; panorama layers; photo scans removed | ✅ |
| B | Racing single scull and rigged rower, stroke clip driven by the real strokes, blade splashes | ✅ |
| C | Left bank: painted basalt cliffs and open slopes (two section variants), real waterfall sheets with foam, spray and mist, lupine clumps as swaying 3D cards | ✅ |
| D | Puffins (Tripo3D): sit on the rocks in the river and turn their heads, take off when the boat comes close or the earth trembles, circle in the calm morning | ✅ |
| E | Glacier front: painted ice (two variants) ✅; icebergs and rocks in the water painted from all sides, bobbing ✅; a calving event | mostly |
| F | Volcano: painted, with lava flowing down its grooves as the eruption goes on and cooling after the escape, a lava fountain, a plume of painted ash puffs lit from below, crater glow, volcanic lightning | ✅ |
| G | Stylized 3D tidal wave (procedural breaker with curling crest, foam and spray) ✅; tablet profiling of the whole run | mostly |

Each phase ends with an in-game screenshot next to the style frame. Tablet check (2026-11-18): smooth on "High".

### 9.7 How a level's world is made (matte-painting pipeline)
The river runs along −z; the world around it is built from **120 m bank sections**, one kind per side (Iceland: `cliffs` left, `glacier` right, mirrored onto the right bank).

1. **Blockout** (`scripts/blender/painted_shore.py --kind <kind> --variant a|b`): the bank's height profile as a mesh, coloured with flat hint colours (dark grey = basalt columns, green = moss, blue = ice …), plus named marker empties where 3D things go (`Fall_Lower`, `Fall_Upper`, the puffin rock). Three cameras render it: across the river (3072×1024) and up/down the river (1536×1024).
2. **Paint-over** (`scripts/painted/paint.mjs <kind>[-b] side|up|down`): `gpt-image-2` repaints each blockout in the game's style with the style frame and the mock-up as references, keeping the composition pixel-accurate. The prompt says what each hint colour means – and what *not* to paint (flowers and waterfalls come as 3D).
3. **Projection** (same Blender script with `--paint`): each face takes the painting that sees it most squarely (and unhidden), the terrain is cut where the painting shows sky, exported as glTF.
4. **Build** (`scripts/painted/build.mjs <name>`): meshopt + WebP, markers kept → `src/assets/painted/<name>.glb` (~1 MB per section).
5. **In the game** (`src/game/scene/PaintedShore.ts`): sections chained **a, a mirrored, b, b mirrored** (same profile at the joints, so no seams; repeats every 480 m), unlit but fogged and tinted with the story phase. On top: lupine cards (`scripts/painted/sprites.mjs`, transparent sprites), waterfall sheets, foam and spray at the markers.

Rules that keep it working: bank lines are one shared function (`Fjord.ts`, also used by the water shader); every section is painted edge to edge (never an "island"); faces that point along the river get their own paintings (no smears).

## 10. Open questions
- Which level comes second? To decide once Iceland is complete (ideas in §12.5).
- Real music and sounds for Iceland (the soundtrack is still a procedural placeholder): licensed library, AI-generated with a public licence, or commissioned?

---

## 11. Next steps
Order by **impact on the workout's story**: the escalation and the finale take about half of every workout, and that is exactly where the world is still flat (volcano and wave are painted billboards). Each new piece is built straight against the level-kit interfaces from §12.3 (set piece, fauna, threat), so the later split costs little.

| # | Step | Why now | What | Effort |
|---|---|---|---|---|
| 1 ✅ | **Volcano (art phase F)** – done 2026-11-18 | The central element and the climax; before, a flat picture that only swapped calm ↔ erupting | Blockout of cone, crater and lava channels → painted like the banks; at 700–780 m a plane with a pixel-aligned lava mask is enough (no visible parallax). Lava as an emissive shader on the channels that **flows down step by step** with the story (`lava` 0 → 1), lava fountain from the crater (particles), glowing plume with lightning flashes, glow tinting sky and water | 1–2 weekends |
| 2 ✅ | **Puffins (art phase D)** – done 2026-11-18 | The signature of the idyll, in the mock-up and in a beat caption, but not yet in the world | Tripo3D model, wings as separate parts flapped in the vertex shader (instancing, cheap); sitting on the puffin rock and ledges (markers already in the sections), turning heads; **take off** when the boat comes close or at the tremor; small flocks crossing the river | 1 weekend |
| 3 ✅ | **Tidal wave (art phase G)** – done 2026-11-18 | Fills the screen in the finale (camera looks back at it) | 3D wave mesh with a curling, translucent crest, foam and spray, distance driven by the threat value as today | 1 weekend |
| 4 | Glacier life (rest of E) | Makes the right bank move | ✅ icebergs and rocks in the water painted from all sides (2026-11-18); still open: a calving event as a story beat (splash + swell reaching the boat) | 1 evening |
| 5 | Sound pass | Big for immersion, small effort | Real music stems per intensity, waterfall/bird/lava ambience placed in the world | 1 weekend + sourcing |
| 6 | Results & PWA (milestone 5) | Everyday use: history, install on the tablet, offline | as in §8 | 1 weekend |
| 7 | Level kit (milestone 6) | Before level 2 | §12.3 | 1 weekend |

**My recommendation:** 1–3 are done. Next a tablet check of the whole run (frame rate in the eruption and the finale), then steps 4–6 in any order, depending on what you miss most while rowing.

---

## 12. Building further levels
Iceland is the template. Every further level follows the same pattern: **a story arc on the training curve + a painted river world + a few animated hero elements.** Building the second level should mean writing content and prompts, not engine code.

### 12.1 What every level shares (engine – unchanged per level)
- Rower data, workout generator, target bands, scoring, HUD, results, diagnostics
- Story engine: beats anchored to phases, environment blended per phase
- Boat and rower with stroke sync, chase camera (small swings, always inside the river)
- River and water: runs along −z, ~30 m wide, bank lines from the shared function, planar reflections, quality levels
- Painted-section system: 120 m sections, variants a/b chained with mirroring, markers in the glTF, tint by phase
- Preloading, loading screen, auto quality

### 12.2 What a level brings (content)
| Part | Iceland | Made with |
|---|---|---|
| Story | 5 phases, beats + captions, environment per phase (sky, fog, light, water, swell) | `level.ts` (data) |
| Bank kinds | `cliffs` (left), `glacier` (right), two variants each | blockout profile + hint colours + paint prompt → pipeline §9.7 |
| Pop-outs | lupine cards, waterfall sheets | sprite script (`gpt-image-1.5`, transparent) / shaders at markers |
| Backdrop | far mountain panorama | `scripts/backdrops/` |
| Set piece | volcano (calm → erupting) | blockout + painting + shader (step 1 of §11) |
| Fauna / props | puffins, icebergs | Tripo3D + Blender, instancing |
| Threat | tidal wave, lava bombs, ash | effect modules driven by threat/intensity |
| Sound | music stems + ambience | audio files per level |

### 12.3 Refactor before level 2 (milestone 6)
Today Iceland is wired into the engine. To split it:
- `src/levels/<id>/level.ts`: story **plus a world manifest**, e.g. `{ banks: { left: 'cliffs', right: 'glacier' }, backdrop, setPiece: 'volcano', fauna: ['puffins'], props: ['lupines'], threat: 'tidal-wave', loadingText }`; a level registry and a level choice on the setup screen.
- `RiverScene` builds the world from the manifest instead of hard-coding `PaintedShore('cliffs' | 'glacier')`, the volcano, Iceland backdrops and "Loading the fjord…".
- Generic channels in the environment instead of Iceland names: `lava`/`smoke`/`wave` become e.g. `setPiece` (0–1 activity), `haze`, `threat`; the level maps them to its effects.
- Bank kinds become data: profile, hint colours, markers and paint prompt per kind in `levels/<id>/banks.*`, read by `painted_shore.py` and `paint.mjs` (`--level <id> --kind <kind>`); Iceland-specific bits (milky meltwater by the glacier, waterfall markers) become options of a kind.
- Assets per level: `src/assets/levels/<id>/`, raw files in `assets/raw/levels/<id>/` (not committed); a level is loaded only when chosen (lazy import), so more levels don't slow down the start.

### 12.4 Recipe for a new level
1. **Mock-up and arc** – a concept image like `screenshots/` plus the five phases with their mood (idyll → omens → escalation → finale → wind-down) and the beats.
2. **Style frames** – 2–3 frames from the game camera (`scripts/concepts/`) as the visual target and reference for every paint-over.
3. **Bank kinds** – one per side (or the same mirrored), each with variants a/b: profile (where tall, where open), hint colours, markers, prompt. Look at the blockouts before painting.
4. **Paint and project** – side/up/down per section, build, check in the game at several distances; repaint single views if needed.
5. **Pop-outs** – everything that must stand up (plants, trees, lanterns, falling water) as cards or shader sheets at markers.
6. **Backdrop and set piece** – the panorama and the one element the story revolves around.
7. **Fauna and threat** – a few animated models (Tripo3D → Blender) and the threat effect for the finale.
8. **Sound** – stems for the intensities, ambience.
9. **Check** – an in-game screenshot per beat next to the style frame; on the tablet on "High": smooth frame rate, level download ≲ 10 MB.

Rough effort per level with the kit: **2–3 weekends** plus image/model API costs.

### 12.5 Level ideas (all original – no protected characters, places only as inspiration)
- **Kaiju Harbour** – canals of a neon harbour city; an original sea monster rises from the bay, buildings collapse, finale through the closing flood gate.
- **Jungle Rapids** – a river through the rainforest with parrots and ruins; a thunderstorm, the current gets wild, finale before a huge waterfall edge.
- **Canyon Flash Flood** – red rock canyon in the evening sun; storm clouds, flash flood chasing you through the narrows.
- **Arctic Night** – sea ice and northern lights; the ice breaks up, orcas surface, finale between moving floes.

---

### Sources
- [Decathlon domyos-developers (GitHub)](https://www.github.com/Decathlon/domyos-developers) – FTMS device list
- [Kinomap: What is the FTMS protocol](https://support.kinomap.com/hc/en-us/articles/360015335632-What-is-the-FTMS-protocol)
- [Decathlon: Domyos Woodrower user guide](https://support.decathlon.co.uk/domyos-woodrower-user-guide-and-repairs)
- [Decathlon: e-Connected](https://support.decathlon.co.uk/e-connected)
- [iliuta.github.io (RowerTrain, Woodrower note)](https://iliuta.github.io)
