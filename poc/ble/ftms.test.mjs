// Run: node poc/ble/ftms.test.mjs
import assert from 'node:assert/strict';
import { parseRowerData, parseFeature, parseMachineStatus, parseTrainingStatus, fromHex, formatPace } from './ftms.js';

// Flags 0x082C: SPM+strokes (bit0=0), distance, pace, power, elapsed time
// SPM 24.5 (0x31), strokes 120, distance 1234 m, pace 125 s (2:05), 214 W, 300 s
let r = parseRowerData(fromHex('2c 08 31 78 00 d2 04 00 7d 00 d6 00 2c 01'));
assert.deepEqual(r, { flags: 0x082c, strokeRate: 24.5, strokeCount: 120, totalDistance: 1234, pace: 125, power: 214, elapsedTime: 300 });
assert.equal(formatPace(r.pace), '2:05');

// "More Data" set (bit 0 = 1) → no SPM/strokes, power only
r = parseRowerData(fromHex('21 00 96 00'));
assert.deepEqual(r, { flags: 0x0021, power: 150 });

// Energy (bit 8) + heart rate (bit 9)
r = parseRowerData(fromHex('00 03 30 10 00 0a 00 f0 00 05 8c'));
assert.equal(r.strokeRate, 24); assert.equal(r.strokeCount, 16);
assert.equal(r.totalEnergy, 10); assert.equal(r.energyPerHour, 240); assert.equal(r.energyPerMinute, 5);
assert.equal(r.heartRate, 140);

// Packet too short → error instead of a crash
r = parseRowerData(fromHex('2c 08 31'));
assert.ok(r.error);

// Extra bytes → warning
r = parseRowerData(fromHex('21 00 96 00 ff'));
assert.ok(r.warning);

// Feature: cadence, distance, pace, expended energy, elapsed time, power
const f = parseFeature(fromHex('26 52 00 00 00 00 00 00'));
assert.deepEqual(f.machine, ['Cadence', 'Total Distance', 'Pace', 'Expended Energy', 'Elapsed Time', 'Power Measurement']);

// Real packet from the Domyos Woodrower (Domyos-ROW-0254, recorded 2026-11-16)
// Flags 0x0BAE: SPM+strokes, avg SPM, distance, pace, power, resistance, energy, HR, time – 23 bytes
r = parseRowerData(fromHex('ae 0b 5a 00 00 5a 00 00 00 b8 00 37 00 01 00 00 00 02 01 04 00 02 00'));
assert.deepEqual(r, { flags: 0x0bae, strokeRate: 45, strokeCount: 0, avgStrokeRate: 45, totalDistance: 0, pace: 184, power: 55, resistance: 1, totalEnergy: 0, energyPerHour: 258, energyPerMinute: 4, heartRate: 0, elapsedTime: 2 });
r = parseRowerData(fromHex('ae 0b 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00'));
assert.deepEqual(r, { flags: 0x0bae, strokeRate: 0, strokeCount: 0, avgStrokeRate: 0, totalDistance: 0, pace: 0, power: 0, resistance: 1, totalEnergy: 0, energyPerHour: 0, energyPerMinute: 0, heartRate: 0, elapsedTime: 0 });

// Machine Status / Training Status from the Woodrower
assert.deepEqual(parseMachineStatus(fromHex('07 3c')), { event: 'Resistance changed', resistance: 6 });
assert.deepEqual(parseMachineStatus(fromHex('02 02')), { event: 'Stopped/paused', by: 'pause' });
assert.deepEqual(parseTrainingStatus(fromHex('01 0d')), { status: 'Manual mode (quick start)' });

console.log('ftms.js: all tests passed');
