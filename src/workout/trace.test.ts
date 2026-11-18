import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, generateWorkout } from './workout';
import { WorkoutTrace, summarize } from './trace';

describe('workout trace', () => {
  const w = generateWorkout(DEFAULT_SETTINGS);
  const seg = w.segments[0];

  it('keeps one point per second of workout time', () => {
    const trace = new WorkoutTrace();
    for (let t = 0; t < 10; t += 1 / 60) trace.add(t, 100, 24, 120, seg);
    expect(trace.points).toHaveLength(10);
    expect(trace.points[3].powerBand).toEqual([seg.power.lo, seg.power.hi]);
  });

  it('sums up a workout', () => {
    const trace = new WorkoutTrace();
    for (let t = 0; t < 60; t++) trace.add(t, t < 30 ? 100 : 140, t < 30 ? 22 : 26, t < 30 ? null : 130 + (t % 3), seg);
    const s = summarize(trace.points, { time: 60, distance: 250, strokes: 24, energy: 12.4 });
    expect(s.avgPower).toBe(120);
    expect(s.maxPower).toBe(140);
    expect(s.avgSpm).toBe(24);
    expect(s.avgPace).toBe(120);          // 250 m in 60 s → 2:00 /500 m
    expect(s.avgHr).toBe(131);
    expect(s.maxHr).toBe(132);
    expect(s.energy).toBe(12);
  });

  it('copes without heart rate, distance or energy', () => {
    const trace = new WorkoutTrace();
    trace.add(0, 0, 0, null, seg);
    const s = summarize(trace.points, { time: 0, distance: 0, strokes: 0, energy: null });
    expect(s).toMatchObject({ avgPace: null, avgHr: null, maxHr: null, energy: null, avgPower: 0 });
  });
});
