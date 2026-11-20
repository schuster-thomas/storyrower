import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../workout/workout';
import { mergeTrainings, newTrainingId, parseTraining, sortTrainings, type TrainingRecord } from './history';

const rec = (id: string, startedAt: string, distance = 1000): TrainingRecord => ({
  v: 1, id, startedAt, finishedAt: startedAt, level: { id: 'iceland-volcano-run', title: 'Iceland Volcano Run' }, mode: 'story',
  settings: DEFAULT_SETTINGS, plannedDuration: 1200, early: false, device: 'Woodrower',
  summary: { time: 1200, distance, strokes: 500, avgPower: 80, maxPower: 120, avgSpm: 25, avgPace: 150, avgHr: null, maxHr: null, energy: null },
  accuracy: 0.8, stars: 2, points: [],
});

describe('training history', () => {
  it('makes sortable, unique ids from the start time', () => {
    const d = new Date('2026-11-20T09:22:41.123Z');
    expect(newTrainingId(d, () => 0.5)).toBe('2026-11-20T09-22-41-123Z-7fff');
    expect(newTrainingId(d, () => 0.1)).not.toBe(newTrainingId(d, () => 0.2));
  });

  it('lists the newest first', () => {
    const list = sortTrainings([rec('a', '2026-11-01T10:00:00Z'), rec('c', '2026-11-20T10:00:00Z'), rec('b', '2026-11-10T10:00:00Z')]);
    expect(list.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('merges this device and Drive without doubles (this device wins)', () => {
    const here = [rec('a', '2026-11-01T10:00:00Z', 1111), rec('b', '2026-11-10T10:00:00Z')];
    const drive = [rec('a', '2026-11-01T10:00:00Z', 2222), rec('c', '2026-11-20T10:00:00Z')];
    const merged = mergeTrainings(here, drive);
    expect(merged.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(merged.find((r) => r.id === 'a')!.summary.distance).toBe(1111);
  });

  it('only accepts training files', () => {
    expect(parseTraining(rec('a', '2026-11-01T10:00:00Z'))?.id).toBe('a');
    expect(parseTraining({ updatedAt: 'x', workout: {} })).toBeNull();   // the settings file
    expect(parseTraining(null)).toBeNull();
    expect(parseTraining({ ...rec('a', '2026-11-01T10:00:00Z'), v: 2 })).toBeNull();
  });
});
