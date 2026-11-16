# StoryRower – Konzept (Entwurf v0.1)

> Rudern als erlebte Geschichte: Die Live-Daten des **Domyos Woodrower** treiben ein Boot durch ein Level mit Dramaturgie – idyllischer Start, Eskalation (Vulkan, Kaiju, Erdbeben …), Flucht, ruhiger Ausklang.

Stand: 16.11.2026 · Status: Ideenphase, noch kein Code

---

## 1. Vision in einem Satz

Ein Intervalltraining, das sich nicht wie ein Intervalltraining anfühlt: Die **Trainingskurve ist die Spannungskurve** der Geschichte.

| Trainingsphase | Story-Phase | Beispiel „Iceland Volcano Run“ |
|---|---|---|
| Warm-up (locker) | Idylle | Fjord, Wasserfälle, Papageitaucher |
| Steigerung | Vorboten | Grollen, Wellen, erste Asche |
| Belastung / Intervalle | Eskalation & Flucht | Ausbruch, Lavaregen, Flutwelle |
| Peak | Finale | Durch die Engstelle, Welle im Nacken |
| Cool-down | Ausklang | Offenes Meer, Sonnenuntergang |

Der vorhandene Screenshot ([screenshots/](screenshots/)) zeigt genau diese Richtung: Third-Person hinter dem Boot, Phasenleiste oben, HUD unten mit Distanz, Watt, SPM, 500m-Zeit.

---

## 2. Kernmechanik

### 2.1 Belohnt wird Zielerfüllung, nicht Maximalleistung
- Pro Phase gibt es **Zielbänder** für Watt, SPM und 500m-Zeit (abgeleitet aus den Nutzervorgaben).
- Im Band = Boot hält Abstand zur Bedrohung, Münzen/Combo, ruhige Kamera.
- Zu niedrig = Bedrohung kommt näher (Welle wächst im Rückspiegel, Kamera wackelt).
- Zu hoch = sanfter Hinweis („Kräfte sparen!“), *keine* Belohnung – schützt vor Überlastung.
- **Kein Game Over.** Die Geschichte läuft immer zu Ende, nur die Bewertung (Sterne/Score) ändert sich. Wer im Training scheitert, hört sonst auf.

### 2.2 Vorab-Einstellungen
- min./max. Watt · min./max. SPM · Gesamtdauer
- Daraus generiert ein **Workout-Generator** eine Kurve (Warm-up → Rampe → Intervalle → Peak → Cool-down). Die 500m-Zielzeit wird aus der Wattzahl berechnet (Concept2-Formel: `pace = 500 · (2.8 / W)^(1/3)` s), damit die drei Bänder zueinander passen.
- Später: Presets („30 min locker“, „Pyramide“, „4×4 min“), FTP-/Leistungstest-Level.

### 2.3 Story-Engine (datengetrieben)
Ein Level ist **keine feste Zeitachse**, sondern eine Liste von Story-Beats mit Intensitätsstufe. Die Engine legt die Beats auf die generierte Trainingskurve:

```
Level „Iceland Volcano Run“
  beats:
    - idyll_fjord        intensity: 0     min_duration: 3 min
    - first_tremor       intensity: 1
    - ash_rain           intensity: 2
    - eruption           intensity: 3     (Peak)
    - tsunami_chase      intensity: 3
    - open_sea_sunset    intensity: 0     (Cool-down)
```

Vorteil: Ein Level funktioniert für 20 und für 60 Minuten. Kürzere Trainings lassen Zwischen-Beats weg, längere strecken Idylle/Loops.

### 2.4 Schlagsynchronität
Die Ruderfigur und die Ruderblätter sollen **im Takt des echten Schlags** rudern. Das ist für das Mittendrin-Gefühl wichtiger als jede Grafik. Problem: FTMS liefert nur die Schlagfrequenz (und ggf. den Schlagzähler), keinen Ruderzyklus. → Animation aus Schlagzähler-Änderungen und SPM interpolieren; im PoC prüfen, wie oft und mit welcher Latenz Daten kommen.

---

## 3. Datenübertragung vom Woodrower (größtes technisches Risiko)

### Was bekannt ist
- Der Woodrower hat Bluetooth LE und funktioniert mit Decathlons App **e-Connected** sowie mit **Kinomap**, angeblich auch mit weiteren Ruder-Apps.
- Moderne Domyos-Geräte nutzen meist den Standard **FTMS** (Fitness Machine Service, UUID `0x1826`), Charakteristik **Rower Data** `0x2AD1`: Schlagfrequenz, Schlagzähler, Distanz, Pace/500m, Leistung, Zeit.
- **Nicht offiziell bestätigt:** In Decathlons Entwickler-Repo stehen nur Laufbänder und Crosstrainer auf der FTMS-Liste. Ältere Domyos-Geräte nutzten ein proprietäres Protokoll. Einsteigergeräte setzen FTMS teils unvollständig um (z. B. fehlende Felder, Watt nur geschätzt).
- BLE-Geräte erlauben meist **nur eine Verbindung gleichzeitig**: e-Connected/Kinomap müssen während des Tests geschlossen sein.

### Proof of Concept – Ablauf
1. **Ohne Code (10 Minuten):** App *nRF Connect* auf dem Tablet installieren, Woodrower scannen, Services ansehen. Ist `0x1826` / `0x2AD1` vorhanden? Notify einschalten, rudern, Rohdaten beobachten.
2. **Minimal-Webseite (Web Bluetooth):** Eine HTML-Seite verbindet sich, abonniert Rower Data, parst die Flags und zeigt Rohbytes und Werte live an. Läuft direkt in Chrome auf dem Samsung-Tablet und auf dem PC.
3. **Aufzeichnen:** Eine 10-Minuten-Session als JSON mitschneiden. Damit entsteht ein **Simulator**, mit dem man später am Schreibtisch entwickelt, ohne zu rudern.
4. **Bewerten:** Update-Rate (typisch 1 Hz?), Latenz, welche Felder sinnvoll sind, wie plausibel die Watt-Werte sind, ob der Schlagzähler genau genug für die Animation ist.

**Falls kein FTMS:** Proprietäres Protokoll per Sniffing nachbauen (Android-HCI-Log von e-Connected) – machbar, aber deutlich mehr Aufwand. Notfalls Herzfrequenzgurt (Standard-BLE) als Ersatz-Steuergröße.

---

## 4. Plattform: Website, App oder beides?

### Schlüsselfakt: Web Bluetooth
| Plattform | Web Bluetooth im Browser |
|---|---|
| Android-Tablet (Chrome/Samsung Internet) | ✅ ja |
| Windows/macOS/Linux-Laptop (Chrome, Edge) | ✅ ja (Bluetooth-Adapter nötig) |
| iPad / iPhone (Safari **und alle anderen iOS-Browser**) | ❌ nein (Apple/WebKit) – nur Umweg über Apps wie *Bluefy* |
| Firefox (alle Plattformen) | ❌ nein |

Dein Zielgerät **Samsung Galaxy Tab S9 (SM-X710, Snapdragon 8 Gen 2)** ist leistungsstark – für stilisiertes Three.js-3D mit 60 fps völlig ausreichend, wenn man vernünftig optimiert.

### Optionen im Vergleich

| | **A: Reine Web-App / PWA** | **B: Web-App + Capacitor-Hülle** | **C: Native Engine (Unity / Godot)** |
|---|---|---|---|
| Android-Tablet | ✅ | ✅ | ✅ |
| PC/Laptop | ✅ im Browser | ✅ im Browser | ✅ eigener Build |
| iPad | ❌ (nur Bluefy-Umweg) | ✅ über App Store / TestFlight | ✅ |
| Entwicklung/Iteration | sehr schnell, nur Reload | schnell (Web), nativer Build nur zum Release | langsamer, große Toolchain |
| Verteilung | Link genügt, Updates sofort | Web sofort; Stores mit Review | Stores / APK |
| Kosten | ~0 € (GitHub/Cloudflare Pages) | Apple Developer 99 €/Jahr für iPad | wie B |
| Grafik-Obergrenze | gut (WebGL/WebGPU), Asset-Größe beachten | wie A | am höchsten, bester Editor für Level-Bau |
| BLE-Zugriff | Web Bluetooth (Chromium) | Native BLE-Plugin, überall | Native Plugins (teils kostenpflichtig) |
| Bildschirm bleibt an | Wake Lock API ✅ | ✅ | ✅ |
| Lernkurve (TS/Three.js vorhanden?) | niedrig | niedrig + etwas Capacitor | hoch, neue Sprache/Engine |

### Empfehlung: **A jetzt, B später**
- Start als **PWA mit TypeScript + Three.js (Vite)**. Deckt Tablet und PC sofort ab, ohne Installation, Hosting kostenlos.
- Die Datenquelle von Anfang an **abstrahieren**:
  ```
  RowerSource
   ├─ WebBluetoothFtmsSource   (Chrome: Android, PC)
   ├─ CapacitorBleFtmsSource   (später: iPad, Android-App)
   └─ SimulatorSource          (Aufzeichnung/Tastatur – Entwicklung ohne Rudergerät)
  ```
- Wenn iPad wichtig wird: dieselbe Web-App mit **Capacitor** einpacken und das BLE-Plugin anbinden. Kein Neuschreiben nötig.
- Unity/Godot nur, wenn sich herausstellt, dass Grafik/Level-Bau im Browser zur Bremse wird. Das wäre ein späterer, bewusster Schritt.

---

## 5. Grafik & Stil

**Ziel:** stilisiert, freundlich, hell, arcadig – „Mario-Kart-Niveau“, kein Simulator.

**Realistische Einordnung:** Der Screenshot ist ein KI-Konzeptbild. Diese Detailtiefe (Wasserfälle, Rauch, Licht) ist in Echtzeit nur mit viel Asset-Arbeit erreichbar. Machbar und gut aussehend im Browser ist:
- **Low-/Mid-Poly mit Toon-/Gradient-Shading**, kräftige Farbpaletten, Nebel für Tiefe
- **Endlos-Fluss-Prinzip:** Das Boot fährt geradeaus, die Welt wird in Abschnitten (Chunks) davor erzeugt und dahinter entfernt – spart Leistung und ermöglicht beliebige Längen
- Effekte über Partikel und Shader (Lava-Glühen, Asche, Gischt), Kamera-Shake, Farb-/Lichtwechsel je Intensität
- Hintergründe (Skyline, Vulkan, Kaiju-Silhouette) teils als **2D-Billboards/Skybox-Ebenen** – sehr effektiv, sehr günstig
- Assets: freie CC0-Pakete (z. B. Kenney, Quaternius, Poly Pizza) für den Start, später eigene oder KI-gestützte Modelle

**Rechtliches:** Kein „Godzilla“ – ein **eigenes Kaiju** mit eigenem Namen und Design (Hommage, keine Kopie). Gilt genauso für Musik und Logos.

---

## 6. HUD (aus dem Screenshot weiterentwickelt)

- **Oben links:** Levelname + Phase („Phase 3/5 – Rising Fury“)
- **Oben Mitte:** Phasen-Fortschritt bis zum Ziel
- **Unten:** vier Kacheln – Distanz, Watt, SPM, 500m. Jede mit **Ist-Wert groß** und einem **Bandbalken**, der das Zielband farbig zeigt (grün = im Band, gelb = knapp, rot/blau = zu hoch/zu niedrig).
- **Neu:** kleine Vorschau der nächsten Phase („In 0:30: Ausbruch! Ziel 180–220 W“). Damit kann man sich auf Intervalle einstellen.
- Große Ziffern, hoher Kontrast – das Tablet steht ~1–1,5 m entfernt, man schwitzt, man bewegt sich.

### 6.1 Diagnose-Ansicht (Pflicht im fertigen Tool)
Wunsch nach dem BLE-PoC: Die Testansicht bleibt im fertigen Tool erhalten.
- **Eigener Bildschirm „Gerät & Diagnose“** im Menü, nutzbar auch ohne Level: verbinden, alle Live-Werte als Kacheln, Update-Rate, Geräteinfos, Status-Events, Protokoll mit Rohdaten.
- **Ein-/ausblendbares Overlay im Spiel** (z. B. Tipp auf ein Symbol in der Ecke): Rohwerte, geglättete Werte, Paketrate, Verbindungsstatus. Das Spiel läuft dahinter weiter.
- **Aufzeichnen & Abspielen** wie im PoC: Jede Session lässt sich als JSON speichern und später im Simulator abspielen. Das ist auch die Grundlage für Fehlerberichte.
- Technisch: Die Diagnose-Ansicht hängt am selben `RowerSource`-Interface wie das Spiel. Sie zeigt daher genau die Daten, die das Spiel bekommt.

---

## 7. Vor- und Nachteile des Gesamtkonzepts

### Vorteile
- **Echte Motivationslücke:** Bestehende Ruder-Apps sind Videostrecken (Kinomap) oder Zahlen/Rennen. Narrative Dramaturgie mit Zielbändern ist selten.
- **Trainingswissenschaftlich sinnvoll:** Zielbänder statt „so viel wie möglich“, Warm-up und Cool-down sind in die Story eingebaut.
- **Ein Level, viele Trainings:** Der Workout-Generator plus datengetriebene Beats ergeben einen hohen Wiederspielwert.
- **Günstiger Start:** PWA, statisches Hosting, keine Server, keine Kosten.
- **Offener Standard:** Wenn FTMS klappt, funktionieren auch andere Rudergeräte (Concept2 PM5, viele China-Rower). Das öffnet die Tür für andere Nutzer.

### Nachteile / Risiken
| Risiko | Schwere | Gegenmaßnahme |
|---|---|---|
| ~~Woodrower spricht kein (vollständiges) FTMS~~ | ✅ erledigt | PoC am 16.11.2026: Standard-FTMS, siehe [poc/ble/ERGEBNIS.md](poc/ble/ERGEBNIS.md) |
| iPad ohne Web Bluetooth | mittel | Capacitor-Hülle später; Datenquelle abstrahiert |
| Asset-/Grafikaufwand unterschätzt | **hoch** | Stil bewusst einfach halten, Billboards, CC0-Assets, *ein* Level richtig gut statt drei halb |
| Watt-Werte am Woodrower ungenau/geschätzt | mittel | Zielbänder alternativ über SPM + Pace; Kalibrierfaktor in den Einstellungen |
| Daten nur ~1 Hz → Animation ruckelt | mittel | Interpolation, Animation aus SPM ableiten |
| Langzeitmotivation nach dem 5. Mal | mittel | Mehrere Levels, Zufallsereignisse, Bestzeiten/Sterne, Statistiken |
| Akku/Hitze bei 60 min 3D auf dem Tablet | niedrig–mittel | FPS-Limit (z. B. 30/60 wählbar), Auflösungs-Skalierung, Netzteil |
| Umfang wächst (Scope Creep) | hoch | Strikte Meilensteine, siehe unten |

---

## 8. Meilensteine

| # | Meilenstein | Ergebnis | Grobaufwand |
|---|---|---|---|
| **0** | **BLE-PoC** | nRF-Connect-Check + Webseite zeigt Live-Werte des Woodrowers, JSON-Aufzeichnung | 1–2 Abende |
| 1 | Daten-Layer + Simulator | `RowerSource`-Interface, Simulator mit Aufzeichnung/Tastatur | 1–2 Abende |
| 2 | Graybox-Spiel | Boot auf endlosem Fluss, Geschwindigkeit = Pace, HUD mit Zielbändern, Workout-Generator | 1–2 Wochenenden |
| 3 | Story-Engine | Beats, Intensitätsstufen, Kamera/Licht/Wetter reagieren | 1–2 Wochenenden |
| 4 | Erstes schönes Level | z. B. „Iceland Volcano Run“ mit Assets, Effekten, Sound | mehrere Wochen |
| 5 | Auswertung & PWA | Ergebnis-Screen, Verlauf (lokal), installierbar, Offline-Fähigkeit | 1 Wochenende |
| 6 | iPad | Capacitor-Build + BLE-Plugin | 1–2 Wochenenden |

Meilenstein 0 entscheidet über alles Weitere. Erst danach lohnt sich das Repo-Setup mit Build-Tooling.

---

## 9. Offene Fragen

1. ~~Welches Level zuerst?~~ **Entschieden (16.11.2026): „Iceland Volcano Run“.** Idyllischer Start mit isländischer Landschaft, Wasserfällen und Papageitauchern → Vulkanausbruch → Flucht vor der Flutwelle → Ausklang. Kaiju/Tokio kommt später.
2. Hast du einen Herzfrequenzgurt? Puls wäre eine gute zweite Steuergröße.
3. Sound/Musik: dynamischer Soundtrack je Intensität? (Großer Effekt auf die Stimmung, moderater Aufwand.)
4. Soll das Spiel später öffentlich sein (andere Rudergeräte, Englisch) oder erstmal nur für dich?
5. Speichern der Trainings: nur lokal, oder Export (z. B. FIT/TCX für Strava)?

---

### Quellen
- [Decathlon domyos-developers (GitHub)](https://www.github.com/Decathlon/domyos-developers) – FTMS-Geräteliste
- [Kinomap: What is the FTMS protocol](https://support.kinomap.com/hc/en-us/articles/360015335632-What-is-the-FTMS-protocol)
- [Decathlon: Domyos Woodrower user guide](https://support.decathlon.co.uk/domyos-woodrower-user-guide-and-repairs)
- [Decathlon: e-Connected](https://support.decathlon.co.uk/e-connected)
- [iliuta.github.io (RowerTrain, Woodrower-Hinweis)](https://iliuta.github.io)
