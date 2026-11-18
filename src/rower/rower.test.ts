import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  UUID, encodeMachineStatus, encodeWoodrowerData, fromHex, formatPace, paceFromPower, parseFeature,
  parseMachineStatus, parseRowerData, parseTrainingStatus, powerFromPace,
} from './ftms';
import { parseRecording } from './recording';
import { RowerSession } from './session';
import { SimulatorSource } from './sources/simulator';
import type { PacketSource, PacketSourceEvents, RowerEvent } from './types';

const rec = (name: string) => JSON.parse(readFileSync(new URL(`../../poc/ble/recordings/${name}`, import.meta.url), 'utf8'));
const SHORT = 'woodrower-2026-11-16-18-56-39.json';
const LONG = 'woodrower-2026-11-16-19-13-47-10min.json';

/** Source without behaviour – packets are fed into the session directly. */
const nullSource = (): PacketSource => ({
  info: { kind: 'replay', label: 'test' },
  start: async () => {}, stop: () => {},
  on: <K extends keyof PacketSourceEvents>(_e: K, _fn: PacketSourceEvents[K]) => () => {},
});

function runRecording(name: string) {
  const session = new RowerSession(nullSource());
  const events: RowerEvent[] = [];
  session.on((e) => events.push(e));
  for (const p of parseRecording(rec(name)).packets) session.handlePacket(p);
  return { session, events, of: <T extends RowerEvent['type']>(t: T) => events.filter((e): e is Extract<RowerEvent, { type: T }> => e.type === t) };
}

describe('FTMS decoder', () => {
  it('parses a real Woodrower packet', () => {
    expect(parseRowerData(fromHex('ae 0b 5a 00 00 5a 00 00 00 b8 00 37 00 01 00 00 00 02 01 04 00 02 00'))).toEqual({
      flags: 0x0bae, strokeRate: 45, strokeCount: 0, avgStrokeRate: 45, totalDistance: 0, pace: 184, power: 55,
      resistance: 1, totalEnergy: 0, energyPerHour: 258, energyPerMinute: 4, heartRate: 0, elapsedTime: 2,
    });
  });

  it('handles spec variants (More Data, short and long packets)', () => {
    expect(parseRowerData(fromHex('21 00 96 00'))).toEqual({ flags: 0x21, power: 150 });
    expect(parseRowerData(fromHex('2c 08 31')).error).toBeTruthy();
    expect(parseRowerData(fromHex('21 00 96 00 ff')).warning).toBeTruthy();
  });

  it('encoder and decoder round-trip', () => {
    const v = { strokeRate: 24.5, strokeCount: 120, avgStrokeRate: 23, totalDistance: 70000, pace: 125, power: 214,
      resistance: 6, totalEnergy: 48, energyPerHour: 836, energyPerMinute: 13, heartRate: 140, elapsedTime: 608 };
    const { flags, ...back } = parseRowerData(encodeWoodrowerData(v));
    expect(flags).toBe(0x0bae);
    expect(back).toEqual(v);
  });

  it('status, features, conversions', () => {
    expect(parseMachineStatus(fromHex('07 3c'))).toEqual({ kind: 'resistance', level: 6 });
    expect(parseMachineStatus(fromHex('02 02'))).toEqual({ kind: 'stopped', by: 'pause' });
    expect(parseMachineStatus(encodeMachineStatus({ kind: 'started' }))).toEqual({ kind: 'started' });
    expect(parseTrainingStatus(fromHex('01 0d'))).toBe('Manual mode (quick start)');
    expect(parseFeature(fromHex('a6 56 00 00 04 00 00 00')).target).toEqual(['Resistance Target']);
    // real Woodrower packet: 55 W ↔ 184 s/500 m
    expect(Math.abs(paceFromPower(55) - 184)).toBeLessThan(2);
    expect(Math.abs(powerFromPace(184) - 55)).toBeLessThan(2);
    expect(formatPace(125)).toBe('2:05');
    expect(formatPace(119.6)).toBe('2:00');
  });
});

describe('Recordings', () => {
  it('stores game events next to the packets and still replays the file', () => {
    const session = new RowerSession(nullSource());
    const { packets } = parseRecording(rec(LONG));
    for (const p of packets.slice(0, 200)) session.handlePacket(p);
    session.logEvent('game-section', { index: 3 });
    const json = JSON.parse(JSON.stringify(session.recorder.toJSON()));
    expect(json.events).toHaveLength(1);
    expect(json.events[0]).toMatchObject({ type: 'game-section', data: { index: 3 }, t: packets[199].t });
    expect(parseRecording(json).packets).toHaveLength(200);
  });

  it('stitches PoC files with timestamps that jump back into one timeline', () => {
    const raw = rec(SHORT);
    const joined = { ...raw, packets: [...raw.packets, ...raw.packets] };
    const { packets } = parseRecording(joined);
    for (let i = 1; i < packets.length; i++) expect(packets[i].t).toBeGreaterThanOrEqual(packets[i - 1].t);
    expect(packets.filter((p) => p.kind === 'read').length).toBe(12);
  });
});

describe('RowerSession with the real 10-minute recording', () => {
  const r = runRecording(LONG);

  it('detects every stroke exactly once', () => {
    const strokes = r.of('stroke');
    const last = r.session.sample!;
    expect(last.strokeCount).toBe(242);
    // The console restarts the session at 0 → every stroke 1…242 exactly once
    expect(strokes.map((s) => s.count)).toEqual(Array.from({ length: 242 }, (_, i) => 1 + i));
  });

  it('filters duplicate packets', () => {
    const raw = r.of('raw').filter((e) => e.packet.uuid === UUID.ROWER_DATA);
    const dup = raw.filter((e) => e.duplicate).length;
    expect(dup / raw.length).toBeGreaterThan(0.5);
    expect(r.of('sample').length).toBe(raw.length - dup);
  });

  it('ends with the same totals as the console', () => {
    const s = r.session.sample!;
    expect(s.distance).toBe(1689);
    expect(s.energy).toBe(48);
    expect(s.heartRate).toBeNull();
  });

  it('smooths watts: a single 167 W stroke does not cause a jump', () => {
    const samples = r.of('sample').map((e) => e.sample);
    const peak = samples.find((s) => s.power === 167)!;
    expect(peak).toBeDefined();
    expect(peak.powerSmoothed).toBeLessThan(120);
    // in the easy part (100–240 s device time) the smoothed mean is close to 55 W
    const easy = samples.filter((s) => s.elapsedTime! > 120 && s.elapsedTime! < 230);
    const mean = easy.reduce((a, s) => a + s.powerSmoothed, 0) / easy.length;
    expect(mean).toBeGreaterThan(48);
    expect(mean).toBeLessThan(62);
  });

  it('reports resistance changes and pause/resume', () => {
    expect(r.of('resistance').map((e) => e.level)).toEqual([4, 6, 7, 6, 7]);
    const pr = r.events.filter((e) => e.type === 'paused' || e.type === 'resumed').map((e) => e.type);
    expect(pr[0]).toBe('resumed');
    expect(pr.length).toBeGreaterThanOrEqual(1);
  });

  it('reads the device info', () => {
    const info = r.session.info;
    expect(info['Manufacturer Name']).toBe('DECATHLON');
    expect(info['Model Number']).toBe('8604435');
    expect(String(info['Firmware Revision'])).toContain('Console: 2.5.0');
  });
});

describe('Smoothing over strokes', () => {
  /** Feeds strokes like the Woodrower: counter step first, the stroke's watts ~1.5 s later. */
  function rowStrokes(watts: number[]) {
    const session = new RowerSession(nullSource());
    let t = 0, count = 0, power = 0;
    const send = () => session.handlePacket({
      t, uuid: UUID.ROWER_DATA, kind: 'notify',
      data: encodeWoodrowerData({ strokeRate: 26, strokeCount: count, avgStrokeRate: 26, totalDistance: count * 8, pace: power ? paceFromPower(power) : 0,
        power, resistance: 7, totalEnergy: 0, energyPerHour: 0, energyPerMinute: 0, heartRate: 0, elapsedTime: Math.floor(t / 1000) }),
    });
    // smoothed[i] = value once stroke i is complete (read at the next counter step)
    const smoothed: number[] = [];
    for (const [i, w] of watts.entries()) {
      count++; send(); t += 1600;
      if (i > 0) smoothed.push(session.sample!.powerSmoothed);
      power = w; send(); t += 700;
    }
    count++; send();
    smoothed.push(session.sample!.powerSmoothed);
    return smoothed;
  }

  it('ignores outlier strokes, also two of them one stroke apart', () => {
    expect(Math.max(...rowStrokes([90, 92, 88, 91, 212, 90, 89, 92]).slice(2))).toBeLessThanOrEqual(92);
    expect(Math.max(...rowStrokes([92, 92, 92, 92, 174, 93, 174, 92, 92]).slice(2))).toBeLessThanOrEqual(93);
  });

  it('accepts a real sprint once the second hard stroke confirms it', () => {
    const s = rowStrokes([90, 90, 90, 90, 160, 160, 160]);
    expect(s[4]).toBe(90);
    expect(s[5]).toBe(160);
  });

  it('follows a real change of pace after two strokes', () => {
    const s = rowStrokes([90, 90, 90, 90, 120, 120, 120]);
    expect(s[5]).toBe(120);
    const down = rowStrokes([110, 110, 110, 110, 75, 75]);
    expect(down[5]).toBe(75);
  });

  it('counts a stroke with the same watts as the one before', () => {
    // 4 × 100 W in a row → the console sends no new watts after the first one
    const s = rowStrokes([60, 60, 60, 100, 100, 100]);
    expect(s[4]).toBe(100);
  });

  it('keeps the 20-minute session free of outlier jumps', () => {
    const r = runRecording('storyrower-2026-11-18-06-58-14-20min.json');
    const samples = r.of('sample').map((e) => e.sample);
    const spike = samples.find((s) => s.power === 212)!;
    expect(spike).toBeDefined();
    expect(spike.powerSmoothed).toBeLessThan(110);
    // the console reported single strokes up to 212 W; the smoothed value never got near that
    expect(Math.max(...samples.map((s) => s.powerSmoothed))).toBeLessThan(150);
  });
});

describe('Short recording: auto-pause', () => {
  it('detects when rowing stops', () => {
    const r = runRecording(SHORT);
    const types = r.events.filter((e) => e.type === 'paused' || e.type === 'resumed').map((e) => e.type);
    expect(types).toEqual(['resumed', 'paused']);
    expect(r.session.sample!.rowing).toBe(false);
    expect(r.session.sample!.powerSmoothed).toBe(0);
  });
});

describe('Simulator', () => {
  function simulate(power: number | ((s: number) => number), seconds: number) {
    const sim = new SimulatorSource(typeof power === 'number' ? { power } : { profile: power });
    const session = new RowerSession(sim);
    const events: RowerEvent[] = [];
    session.on((e) => events.push(e));
    for (let i = 0; i < seconds * 4; i++) sim.step(250);
    return { session, events };
  }

  it('rows realistically at 100 W', () => {
    const { session, events } = simulate(100, 120);
    const s = session.sample!;
    expect(s.rowing).toBe(true);
    expect(s.powerSmoothed).toBeGreaterThan(85);
    expect(s.powerSmoothed).toBeLessThan(115);
    expect(s.strokeRate).toBeGreaterThan(22);
    expect(s.strokeRate).toBeLessThan(32);
    const strokes = events.filter((e) => e.type === 'stroke').length;
    expect(strokes).toBeGreaterThan(48);
    expect(strokes).toBeLessThan(64);
    // 100 W ≈ 2:39/500 m → about 370 m in 120 s
    expect(s.distance).toBeGreaterThan(330);
    expect(s.distance).toBeLessThan(400);
  });

  it('pauses and resumes like the real device', () => {
    const { events } = simulate((t) => (t < 30 || t > 60 ? 80 : 0), 90);
    const pr = events.filter((e) => e.type === 'paused' || e.type === 'resumed').map((e) => e.type);
    expect(pr).toEqual(['resumed', 'paused', 'resumed']);
  });
});
