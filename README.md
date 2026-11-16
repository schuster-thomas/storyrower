# StoryRower

Rudern als erlebte Geschichte: Die Live-Daten eines Rudergeräts (zuerst der **Domyos Woodrower**) treiben ein Boot durch ein Level mit Dramaturgie. Es beginnt idyllisch, dann eskaliert die Lage (Vulkanausbruch, Flutwelle …), man muss fliehen, und am Ende klingt das Training locker aus.

Belohnt wird nicht Maximalleistung, sondern wie gut man die **Zielbereiche** für Watt, Schlagfrequenz und 500m-Zeit trifft.

- 📄 [Konzept](KONZEPT.md)
- 🖼️ [Erster Interface-Entwurf](screenshots/)
- 🔌 [Meilenstein 0: BLE-Proof-of-Concept](poc/ble/), live: <https://schuster-thomas.github.io/storyrower/poc/ble/>

## Status
| Meilenstein | Stand |
|---|---|
| 0 – BLE-PoC (Woodrower-Daten per Web Bluetooth) | Testseite fertig, Test am Gerät offen |
| 1 – Daten-Layer + Simulator | – |
| 2 – Graybox-Spiel | – |
| 3 – Story-Engine | – |
| 4 – Level „Iceland Volcano Run“ | – |

## Plattform
Web-App (PWA, TypeScript + Three.js) für Chrome auf Android-Tablets und PCs. iPad später über eine Capacitor-App, weil iOS-Browser kein Web Bluetooth können.
