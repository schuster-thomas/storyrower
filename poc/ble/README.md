# Milestone 0: BLE proof of concept (completed)

Goal: find out **whether and how** the Domyos Woodrower delivers live data over Bluetooth LE, and capture a real workout recording as the basis for the simulator.

**Result:** standard FTMS, stable over 10 minutes → [RESULTS.md](RESULTS.md).

The original test page has been retired. Everything it did – connect, live values, service explorer (read/subscribe any characteristic), FTMS control point, recording, replay, demo data – lives in the app: **Device & diagnostics** (`src/diagnostics/`), live at <https://schuster-thomas.github.io/storyrower/#/diagnose>. It is still in the git history if needed.

| File | Purpose |
|---|---|
| `RESULTS.md` | What the PoC found |
| `recordings/` | Real Woodrower recordings (used by the app's tests and replay) |
