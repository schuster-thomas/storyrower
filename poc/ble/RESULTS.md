# BLE PoC results – Domyos Woodrower

Recording: [recordings/woodrower-2026-11-16-18-56-39.json](recordings/woodrower-2026-11-16-18-56-39.json) · Samsung SM-X710, Chrome 156 · 2026-11-16

## Summary
✅ **The Woodrower speaks standard FTMS.** Connecting, Rower Data, status events and device info all work straight from Chrome on the tablet – no start command, no proprietary protocol. The project's biggest technical risk is gone, and the web app strategy (Chrome + Web Bluetooth) holds up.

## Device
| | |
|---|---|
| BLE name | `Domyos-ROW-0254` |
| Manufacturer / model | DECATHLON / 8604435 |
| Firmware | Console 2.5.0 · Bluetooth 2.6.0 · B805 2.5.0 |
| FTMS features | Cadence, Total Distance, Pace, Resistance Level, Expended Energy, Heart Rate, Elapsed Time, Power Measurement · Target: Resistance |

## Rower Data (`0x2AD1`)
- Always the same flags **`0x0BAE`**, 23 bytes, spec-compliant (no parser errors in 381 packets):
  SPM + stroke count, avg SPM, distance, pace, power, resistance, energy, heart rate, elapsed time.
- **Packet rate ~4 Hz** (median 253 ms, 95–394 ms). But 75 % of packets are identical to the previous one: values effectively change about **once per second / once per stroke**.
- The **stroke counter** goes up by 1 per stroke, roughly every 1.0–1.5 s → usable as a **stroke trigger for the rowing animation**, accurate to ±250 ms (packet spacing).
- **Pace and watts are linked exactly by the Concept2 formula** (deviation < 2 %). The console computes one from the other. For the game: watts and 500 m split are equivalent targets and the bands automatically match.
- **Resistance** is reported as a level (Rower Data as an integer, Machine Status in 0.1 steps: `07 3c` = 6.0).
- **Heart rate** always 0: no strap paired. With a strap paired to the console it would most likely show up here.
- **Auto-pause:** when you stop rowing, SPM/watts/pace drop to 0, the device clock stops, distance and strokes are kept.

## Status events
| Characteristic | Observed | Meaning |
|---|---|---|
| Machine Status `0x2ADA` | `04` | Started/resumed |
| | `02 02` | Paused |
| | `07 1e` → `07 32` → `07 3c` | Resistance 3.0 → 5.0 → 6.0 (turned on the device) |
| Training Status `0x2AD3` | `01 0d` / `01 01` | Manual (quick start) / idle |

→ Pause and start can be detected directly from events (e.g. auto-pause the game).

## 10-minute test (2026-11-16, 20:13)
Recording: [recordings/woodrower-2026-11-16-19-13-47-10min.json](recordings/woodrower-2026-11-16-19-13-47-10min.json)

| | |
|---|---|
| Duration | 618 s connected, 608 s device time |
| Result | 1,689 m · 242 strokes · 48 kcal · resistance 6–7 |
| Power | easy 45–60 W, hard 85–100 W, peak 178 W |
| Stroke rate | 20–30 spm |
| Packets | 2,474 Rower Data, **0 errors**, longest gap 716 ms, **no disconnects** |
| Effective data rate | 1.4 value changes per second |

**Assessment**
- ✅ **Stable:** 10 minutes with no dropout and no gap over 1 s.
- ✅ **Stroke rate plausible:** the stroke counter gives 24.1 spm, the console reports avg 23. The 43–49 spm in the short test were genuinely fast test strokes.
- ✅ **Response time:** after a harder stroke, watts and pace rise within ~1–2 s (e.g. second 243 → 58 W, 244 → 91 W, 246 → 167 W). Watts and pace update **once per stroke**, in a separate packet after the stroke counter.
- ✅ The intervals are clearly visible in the data (≈ 55 W easy ↔ 85–100 W hard). The game can react to them well.
- ℹ️ Watts vary a lot from stroke to stroke (one hard stroke = 167 W). **Smooth** them for band scoring and boat speed; use the raw value for effects like spray.
- 🐞 PoC bug fixed: reconnecting made timestamps jump back, and the recording contained both sessions. The file above contains only the 10-minute session.

## Still open
- **Setting resistance** (target resistance via Control Point) is supported according to the feature bits. Interesting for later (tidal wave = heavier water), not tested yet.

## Consequences for milestone 1 (implemented)
- The session emits normalised events: `sample` (≈1 Hz, only on change), `stroke` (stroke counter +1), `paused` / `resumed`, `resistance`.
- Duplicate packets are filtered, otherwise the game would see a fake 4 Hz rate.
- The simulator replays these JSON recordings and also generates synthetic workouts (same `0x0BAE` packet format).
