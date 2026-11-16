# StoryRower – Concept (draft v0.2)

> Rowing as a story you live through: live data from the **Domyos Woodrower** drives a boat through a level with a dramatic arc – idyllic start, escalation (volcano, kaiju, earthquake …), escape, calm cool-down.

Last updated: 2026-11-16 · Status: milestone 2 done (greybox game playable)

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
| 3 | Story engine | Beats, intensity levels, camera/light/weather react, **audio engine with music layers** | 1–2 weekends |
| 4 | First polished level | "Iceland Volcano Run" with assets, effects, music and sounds | several weeks |
| 5 | Results & PWA | Results screen, **local workout history (IndexedDB)**, JSON export, installable, offline | 1 weekend |
| 6 | iPad | Capacitor build + BLE plugin | 1–2 weekends |

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

## 10. Open questions
- None right now.

---

### Sources
- [Decathlon domyos-developers (GitHub)](https://www.github.com/Decathlon/domyos-developers) – FTMS device list
- [Kinomap: What is the FTMS protocol](https://support.kinomap.com/hc/en-us/articles/360015335632-What-is-the-FTMS-protocol)
- [Decathlon: Domyos Woodrower user guide](https://support.decathlon.co.uk/domyos-woodrower-user-guide-and-repairs)
- [Decathlon: e-Connected](https://support.decathlon.co.uk/e-connected)
- [iliuta.github.io (RowerTrain, Woodrower note)](https://iliuta.github.io)
