# Milestone 0: BLE proof of concept (completed)

Goal: find out **whether and how** the Domyos Woodrower delivers live data over Bluetooth LE, and capture a real workout recording as the basis for the simulator.

**Result:** standard FTMS, stable over 10 minutes → [RESULTS.md](RESULTS.md).

> This page is kept as a minimal, dependency-free reference. The maintained version lives in the app: **Device & diagnostics** (`src/diagnostics/`), live at <https://schuster-thomas.github.io/storyrower/#/diagnose>.

| File | Purpose |
|---|---|
| `index.html` | Test page: connect, live values, service explorer, log, recording (JSON), replay, demo |
| `ftms.js` | FTMS constants and parsers for *Rower Data* (`0x2AD1`), Feature, Machine/Training Status, Control Point |
| `ftms.test.mjs` | Parser tests: `node poc/ble/ftms.test.mjs` |
| `recordings/` | Real Woodrower recordings (also used by the app's tests and replay) |

No dependencies, no build. Live: <https://schuster-thomas.github.io/storyrower/poc/ble/>

## Preparation
- Turn on the Woodrower (wake the console with a few strokes).
- **Close e-Connected, Kinomap etc. on all devices.** The rower usually accepts only one connection.
- Browser: **Chrome** (Android/Windows) or Edge. Firefox and all iOS browsers have no Web Bluetooth.

## Running it locally
```bash
npx --yes http-server@14.1.1 poc/ble -p 8080 -c-1
```
Open `http://localhost:8080` in Chrome → **Connect to rower**.

Web Bluetooth only works on `https://` or `localhost`. To test unpushed changes on the tablet:

**a) Chrome flag (no cable)**
1. Start the server on the PC (Windows firewall: allow access on *private* networks).
2. Find the PC's IP (`ipconfig` → IPv4 address, e.g. `192.168.178.20`).
3. On the tablet in Chrome: `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → add `http://192.168.178.20:8080` → *Enabled* → restart Chrome.
4. Open `http://192.168.178.20:8080`.

**b) USB port forwarding** (developer options + USB debugging on the tablet)
1. Connect the tablet via USB, on the PC open `chrome://inspect/#devices` → *Port forwarding* → `8080` → `localhost:8080`.
2. Open `http://localhost:8080` on the tablet.

## What the page does
- **Connect to rower:** lists only FTMS devices. If the Woodrower doesn't show up → try **All devices…**.
- Reads device info + FTMS features, subscribes to Rower Data, Machine Status, Training Status, Control Point and heart rate.
- **Service explorer:** shows all visible services/characteristics; *read* / *subscribe* on click (raw hex in the log).
- **Request control / Send start:** some devices only send data after an FTMS *start*. The Woodrower doesn't need it.
- **Recording:** every packet is captured with a timestamp → *Download recording* (JSON). The screen stays on.
- **Play recording / Demo data:** for testing without a rower.
