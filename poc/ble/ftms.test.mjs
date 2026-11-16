// Aufruf: node poc/ble/ftms.test.mjs
import assert from 'node:assert/strict';
import { parseRowerData, parseFeature, parseMachineStatus, parseTrainingStatus, fromHex, formatPace } from './ftms.js';

// Flags 0x082C: SPM+Strokes (Bit0=0), Distanz, Pace, Leistung, Zeit
// SPM 24.5 (0x31), Strokes 120, Distanz 1234 m, Pace 125 s (2:05), 214 W, 300 s
let r = parseRowerData(fromHex('2c 08 31 78 00 d2 04 00 7d 00 d6 00 2c 01'));
assert.deepEqual(r, { flags: 0x082c, strokeRate: 24.5, strokeCount: 120, totalDistance: 1234, pace: 125, power: 214, elapsedTime: 300 });
assert.equal(formatPace(r.pace), '2:05');

// "More Data" gesetzt (Bit 0 = 1) → keine SPM/Strokes, nur Leistung
r = parseRowerData(fromHex('21 00 96 00'));
assert.deepEqual(r, { flags: 0x0021, power: 150 });

// Energie (Bit 8) + Puls (Bit 9)
r = parseRowerData(fromHex('00 03 30 10 00 0a 00 f0 00 05 8c'));
assert.equal(r.strokeRate, 24); assert.equal(r.strokeCount, 16);
assert.equal(r.totalEnergy, 10); assert.equal(r.energyPerHour, 240); assert.equal(r.energyPerMinute, 5);
assert.equal(r.heartRate, 140);

// Zu kurzes Paket → Fehler statt Absturz
r = parseRowerData(fromHex('2c 08 31'));
assert.ok(r.error);

// Überzählige Bytes → Warnung
r = parseRowerData(fromHex('21 00 96 00 ff'));
assert.ok(r.warning);

// Feature: Cadence, Distance, Pace, Expended Energy, Elapsed Time, Power
const f = parseFeature(fromHex('26 52 00 00 00 00 00 00'));
assert.deepEqual(f.machine, ['Cadence', 'Total Distance', 'Pace', 'Expended Energy', 'Elapsed Time', 'Power Measurement']);

// Echtes Paket vom Domyos Woodrower (Domyos-ROW-0254, Aufzeichnung 16.11.2026)
// Flags 0x0BAE: SPM+Strokes, Ø SPM, Distanz, Pace, Leistung, Widerstand, Energie, Puls, Zeit – 23 Bytes
r = parseRowerData(fromHex('ae 0b 5a 00 00 5a 00 00 00 b8 00 37 00 01 00 00 00 02 01 04 00 02 00'));
assert.deepEqual(r, { flags: 0x0bae, strokeRate: 45, strokeCount: 0, avgStrokeRate: 45, totalDistance: 0, pace: 184, power: 55, resistance: 1, totalEnergy: 0, energyPerHour: 258, energyPerMinute: 4, heartRate: 0, elapsedTime: 2 });
r = parseRowerData(fromHex('ae 0b 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00'));
assert.deepEqual(r, { flags: 0x0bae, strokeRate: 0, strokeCount: 0, avgStrokeRate: 0, totalDistance: 0, pace: 0, power: 0, resistance: 1, totalEnergy: 0, energyPerHour: 0, energyPerMinute: 0, heartRate: 0, elapsedTime: 0 });

// Machine Status / Training Status vom Woodrower
assert.deepEqual(parseMachineStatus(fromHex('07 3c')), { event: 'Widerstand geändert', resistance: 6 });
assert.deepEqual(parseMachineStatus(fromHex('02 02')), { event: 'Gestoppt/Pausiert', by: 'Pause' });
assert.deepEqual(parseTrainingStatus(fromHex('01 0d')), { status: 'Manuell (Quick Start)' });

console.log('ftms.js: alle Tests bestanden');
